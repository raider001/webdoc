"""Bounded SQLite table access, following WebDocs' WAL/index/generation conventions.

Generated datasets are authoritative assets, not disposable requirement caches.
No HTTP, third party dependency, unbounded response, or dynamic SQL from callers.
"""
import base64
import hashlib
import json
import math
import sqlite3
import itertools
from datetime import datetime
from pathlib import Path

SMALL_ROWS = 2000
PAGE_ROWS = 100

def key(value, fmt='text'):
    if isinstance(value, dict):
        value = value.get('label', '')
    if value is None or str(value).strip() == '':
        return 1, 0 if fmt in ('number', 'percent', 'datetime', 'duration') else ''
    text = str(value).strip()
    if fmt in ('number', 'percent', 'datetime', 'duration'):
        try:
            if fmt == 'datetime':
                n = datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp() * 1000
            elif fmt == 'duration' and ':' in text:
                parts = [float(x) for x in text.split(':')]
                n = sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
            else:
                n = float(text.replace(',', '').replace('%', ''))
                if fmt == 'percent' and text.endswith('%'): n /= 100
            return (0, n) if math.isfinite(n) else (1, 0)
        except (ValueError, OverflowError):
            return 1, 0
    return 0, text.lower()

class Tables:
    def __init__(self, path, readonly=False):
        self.path = Path(path)
        self.schemas = {}
        self.counter_defs = None
        if readonly:
            self.c = sqlite3.connect(self.path.resolve().as_uri() + '?mode=ro', uri=True, timeout=8)
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.c = sqlite3.connect(self.path, timeout=8)
            self.c.execute('PRAGMA journal_mode=WAL')
            self.c.execute('PRAGMA synchronous=FULL')
            self.c.executescript('''
                CREATE TABLE IF NOT EXISTS datasets(name TEXT PRIMARY KEY, schema_json TEXT, generation INTEGER DEFAULT 0, total INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, dataset TEXT, id TEXT, owner TEXT);
                CREATE TABLE IF NOT EXISTS consumers(name TEXT PRIMARY KEY, seq INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS counter_defs(dataset TEXT, cols TEXT, PRIMARY KEY(dataset,cols));
                CREATE TABLE IF NOT EXISTS counter_values(dataset TEXT, cols TEXT, vals TEXT, total INTEGER, PRIMARY KEY(dataset,cols,vals));
            ''')
        self.c.row_factory = sqlite3.Row
        self.c.execute('PRAGMA busy_timeout=8000')
        self.c.execute('PRAGMA cache_size=-16384')
        # Keep SQLite's internal sort work out of the system temporary directory.
        # Page queries use LIMIT/top-K; cold schema/index creation is explicit.
        self.c.execute('PRAGMA temp_store=MEMORY')

    def close(self): self.c.close()
    def name(self, dataset): return 't_' + hashlib.sha256(dataset.encode()).hexdigest()[:20]
    def schema(self, dataset):
        if dataset in self.schemas: return self.schemas[dataset]
        r = self.c.execute('SELECT schema_json FROM datasets WHERE name=?', (dataset,)).fetchone()
        if not r: raise ValueError('unknown table: ' + dataset)
        self.schemas[dataset] = json.loads(r[0])
        return self.schemas[dataset]

    def ensure(self, dataset, columns, filter_sorts=()):
        t = self.name(dataset)
        prior = self.c.execute('SELECT schema_json FROM datasets WHERE name=?', (dataset,)).fetchone()
        schema = json.dumps(columns, separators=(',', ':'))
        if prior:
            if prior[0] != schema: raise ValueError('table schema changed; publish a versioned dataset')
            return
        defs = ['id TEXT PRIMARY KEY', 'seq INTEGER UNIQUE NOT NULL', 'payload TEXT NOT NULL', 'owner TEXT NOT NULL']
        for i, col in enumerate(columns):
            typ = 'REAL' if col['format'] in ('number','percent','datetime','duration') else 'TEXT'
            defs += [f'f{i} TEXT NOT NULL', f'e{i} INTEGER NOT NULL', f'v{i} {typ} NOT NULL']
        self.c.execute(f'CREATE TABLE {t} ({",".join(defs)})')
        for i in range(len(columns)):
            self.c.execute(f'CREATE INDEX {t}_s{i} ON {t}(e{i},v{i},seq)')
            self.c.execute(f'CREATE INDEX {t}_f{i} ON {t}(f{i},seq)')
        keys = [c['key'] for c in columns]
        for k, (filters, sort) in enumerate(filter_sorts):
            prefix = ','.join(f'f{keys.index(f)}' for f in filters)
            i = keys.index(sort)
            self.c.execute(f'CREATE INDEX {t}_fs{k} ON {t}({prefix},e{i},v{i},seq)')
        self.c.execute('INSERT INTO datasets(name,schema_json) VALUES (?,?)', (dataset,schema))
        self.c.commit()

    def put(self, dataset, row, owner='', record_change=True):
        columns = self.schema(dataset)
        t = self.name(dataset)
        payload = json.dumps(row, ensure_ascii=False, separators=(',', ':'))
        old = self.c.execute(f'SELECT seq,payload FROM {t} WHERE id=?', (str(row['id']),)).fetchone()
        if old and old['payload'] == payload: return False
        if self.counter_defs is None:
            self.counter_defs = {}
            for definition in self.c.execute('SELECT dataset,cols FROM counter_defs'):
                self.counter_defs.setdefault(definition[0],[]).append(json.loads(definition[1]))
        prior = json.loads(old['payload']) if old and self.counter_defs.get(dataset) else None
        seq = old['seq'] if old else self.c.execute(f'SELECT COALESCE(MAX(seq),0)+1 FROM {t}').fetchone()[0]
        values = [str(row['id']),seq,payload,owner]
        for col in columns:
            value = row.get(col['key'])
            raw = value.get('label','') if isinstance(value,dict) else '' if value is None else str(value)
            values += [raw, *key(value,col['format'])]
        updates = ','.join(f'{c}=excluded.{c}' for c in ['payload','owner'] + [f'{p}{i}' for i in range(len(columns)) for p in ('f','e','v')])
        self.c.execute(f'INSERT INTO {t} VALUES ({",".join("?" for _ in values)}) ON CONFLICT(id) DO UPDATE SET {updates}',values)
        self.c.execute('UPDATE datasets SET generation=generation+1,total=total+? WHERE name=?',(0 if old else 1,dataset))
        for fields in self.counter_defs.get(dataset,[]):
            encode=lambda r:json.dumps([str(r.get(f,'').get('label','') if isinstance(r.get(f),dict) else '' if r.get(f) is None else r.get(f,'')) for f in fields],ensure_ascii=False,separators=(',',':'))
            new_values=encode(row);old_values=encode(prior) if prior is not None else None
            if old_values==new_values:continue
            signature=json.dumps(fields,separators=(',',':'))
            if old_values is not None:
                self.c.execute('UPDATE counter_values SET total=total-1 WHERE dataset=? AND cols=? AND vals=?',(dataset,signature,old_values))
            self.c.execute('INSERT INTO counter_values VALUES (?,?,?,1) ON CONFLICT(dataset,cols,vals) DO UPDATE SET total=total+1',(dataset,signature,new_values))
        if record_change: self.c.execute('INSERT INTO changes(dataset,id,owner) VALUES (?,?,?)',(dataset,str(row['id']),owner))
        return True

    def track_count(self,dataset,fields):
        """Cold one-time facet import; thereafter each row change adjusts counters."""
        fields=sorted(fields);signature=json.dumps(fields,separators=(',',':'))
        if self.c.execute('SELECT 1 FROM counter_defs WHERE dataset=? AND cols=?',(dataset,signature)).fetchone():return
        keys=[c['key'] for c in self.schema(dataset)];columns=','.join('f'+str(keys.index(f)) for f in fields)
        with self.c:
            self.c.execute('INSERT INTO counter_defs VALUES (?,?)',(dataset,signature))
            for row in self.c.execute(f'SELECT {columns},COUNT(*) FROM {self.name(dataset)} GROUP BY {columns}'):
                self.c.execute('INSERT INTO counter_values VALUES (?,?,?,?)',(dataset,signature,json.dumps(list(row)[:-1],ensure_ascii=False,separators=(',',':')),row[-1]))
        self.counter_defs=None

    def get(self,dataset,rid):
        r = self.c.execute(f'SELECT payload FROM {self.name(dataset)} WHERE id=?',(rid,)).fetchone()
        return json.loads(r[0]) if r else None

    def page(self,dataset,filters=None,sort=None,cursor=None,limit=PAGE_ROWS,search='',gate=None, budget=1000):
        """Stable keyset page. Empty values last in both directions. ACL scan bounded.

        Cursor carries query hash and revision; any change restarts this page to
        avoid inconsistent continuation while retaining the reader's settings.
        """
        cols = self.schema(dataset); keys = [c['key'] for c in cols]
        if not 1 <= int(limit) <= 200: raise ValueError('page size must be 1..200')
        filters = filters or []; sort = sort or []
        if len(filters)>16 or len(sort)>4: raise ValueError('too many filters or sorts')
        clauses=[]; args=[]
        for f in filters:
            i = keys.index(f['column'])
            vals = f.get('in', [f.get('equals')])
            if not isinstance(vals,list) or not 1<=len(vals)<=32: raise ValueError('filter needs 1..32 values')
            clauses.append(f'f{i} IN ({",".join("?" for _ in vals)})'); args.extend(str(v) for v in vals)
        order=[]
        for s in sort:
            i=keys.index(s['column']); direction=s.get('direction','asc')
            if direction not in ('asc','desc'): raise ValueError('invalid sort direction')
            order += [(f'e{i}','asc'),(f'v{i}',direction)]
        order += [('seq','asc')]
        if search:
            if len(search)>200: raise ValueError('search too long')
            clauses.append('instr(lower(payload),?)>0'); args.append(search.lower())
        generation=self.c.execute('SELECT generation FROM datasets WHERE name=?',(dataset,)).fetchone()[0]
        signature=hashlib.sha256(json.dumps([dataset,filters,sort,search]).encode()).hexdigest()[:16]
        restart=False
        if cursor:
            try: cur=json.loads(base64.urlsafe_b64decode(cursor))
            except Exception as e: raise ValueError('invalid cursor') from e
            if cur['q']!=signature: raise ValueError('cursor belongs to another query')
            restart=cur['g']!=generation
            if not restart:
                terms=[]
                for i,(col,direction) in enumerate(order):
                    terms.append('('+' AND '.join([f'{c}=?' for c,_ in order[:i]]+[f'{col}{">" if direction=="asc" else "<"}?'])+')')
                    args.extend(cur['k'][:i+1])
                clauses.append('('+' OR '.join(terms)+')')
        # Progress handler prevents expensive unindexed text searches from occupying
        # a server thread indefinitely. Indexed equality/order requests use no timer.
        import time
        deadline=time.perf_counter()+5
        self.c.set_progress_handler(lambda: int(time.perf_counter()>deadline),10000)
        try:
            rows=self.c.execute(f'SELECT payload,owner,{",".join(c for c,_ in order)} FROM {self.name(dataset)}'+(' WHERE '+' AND '.join(clauses) if clauses else '')+' ORDER BY '+','.join(f'{c} {d}' for c,d in order)+' LIMIT ?',args+[min(budget,int(limit)+1) if gate is None else budget]).fetchall()
        finally: self.c.set_progress_handler(None,0)
        out=[]; last=None; more=False
        for r in rows:
            if gate and r['owner'] and not gate(r['owner']): last=r; continue
            if len(out)>=int(limit): more=True; break
            out.append(json.loads(r['payload'])); last=r
        if gate and len(rows)==budget: more=True
        token=None
        if more and last:
            token=base64.urlsafe_b64encode(json.dumps({'q':signature,'g':generation,'k':[last[c] for c,_ in order]}).encode()).decode()
        return {'columns':keys,'rows':out,'next':token,'generation':generation,'restarted':restart}

    def count(self,dataset,filters=()):
        keys=[c['key'] for c in self.schema(dataset)]
        where=[]; args=[]
        for f in filters:
            vals=f.get('in',[f.get('equals')]); where.append(f'f{keys.index(f["column"])} IN ({",".join("?" for _ in vals)})'); args.extend(str(v) for v in vals)
        if not where: return self.c.execute('SELECT total FROM datasets WHERE name=?',(dataset,)).fetchone()[0]
        fields=sorted(f['column'] for f in filters);signature=json.dumps(fields,separators=(',',':'))
        if self.c.execute('SELECT 1 FROM counter_defs WHERE dataset=? AND cols=?',(dataset,signature)).fetchone():
            wanted={f['column']:[str(v) for v in f.get('in',[f.get('equals')])] for f in filters}
            combinations=1
            for values in wanted.values():combinations*=len(values)
            if combinations<=2000:
                return sum((self.c.execute('SELECT total FROM counter_values WHERE dataset=? AND cols=? AND vals=?',(dataset,signature,json.dumps(list(values),ensure_ascii=False,separators=(',',':')))).fetchone() or [0])[0] for values in itertools.product(*(wanted[f] for f in fields)))
        return self.c.execute(f'SELECT COUNT(*) FROM {self.name(dataset)} WHERE '+ ' AND '.join(where),args).fetchone()[0]

    def changes(self,after=0,limit=1000):
        return [dict(r) for r in self.c.execute('SELECT * FROM changes WHERE seq>? ORDER BY seq LIMIT ?',(after,limit))]

    def manifest(self,dataset):
        return {'webdocTable':1,'database':self.path.name,'dataset':dataset,'columns':self.schema(dataset),'smallRows':SMALL_ROWS,'pageSize':PAGE_ROWS}
