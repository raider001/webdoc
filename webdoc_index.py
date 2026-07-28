#!/usr/bin/env python3
"""webdoc_index.py - stdlib-only SQLite index for the Web Document Tool.

The browser used to load EVERY document body at boot and index it client-side
(search, page-links, requirement/test traceability). That caps the corpus at a
few thousand files. This module moves indexing to the server so the browser can
lazily fetch only what it displays, letting the tool scale to tens of thousands
of files. It is pure Python standard library (sqlite3 + re), no third-party deps
and no Node - the same constraints as serve.py. Full Markdown RENDERING still
happens client-side; the server only extracts the lightweight index data.

The DB under .webdoc-index/ is a DISPOSABLE CACHE (source of truth = the .md
files): on any schema mismatch or corruption it is rebuilt, never migrated.
Extraction regexes are ported to match the client (catalog.splitMeta,
search.extractHeadings, doclinks link scan, requirements fenced-block parsing) so
server-computed values equal what the old client produced.
"""
import os
import re
import json
import time
import sqlite3
import threading
import hashlib
from concurrent.futures import ThreadPoolExecutor

SCHEMA_VERSION = 3

# ---- extraction regexes (ported from the client) ---------------------------
META_RE = re.compile(r'^﻿?\s*<!--\s*meta\b(.*?)-->\s*', re.I | re.S)
FENCE_OPEN = re.compile(r'^ {0,3}([`~]{3,})')
FENCE_CLOSE = re.compile(r'^ {0,3}([`~]{3,})[ \t]*$')
HEADING_RE = re.compile(r'^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$', re.M)
LINK_RE = re.compile(r'\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>]*>|[^()\s]+)')
META_BLOCK_RE = re.compile(r'<!--\s*meta\s+start\s*(\{.*?\})\s*-->(.*?)<!--\s*meta\s+end\b.*?-->', re.I | re.S)
FENCED_STRIP = re.compile(r'^[ \t]*(`{3,}|~{3,})[^\n]*\n.*?^[ \t]*\1[ \t]*$', re.M | re.S)
INLINE_CODE = re.compile(r'`[^`]*`')
META_REGION_STRIP = re.compile(r'<!--\s*meta\s+start.*?<!--\s*meta\s+end\b.*?-->', re.I | re.S)
HAS_SCHEME = re.compile(r'^(?:[a-z][a-z0-9+.-]*:)', re.I)
INLINE_MD = re.compile(r'[*_`~]')


def split_meta(text):
    """Reproduce catalog.splitMeta: a leading <!--meta ...--> (JSON in an HTML
    comment) is stripped to metadata; the rest is the body. Note this also matches
    <!--meta start ...-->, matching the client's behaviour exactly (a doc opening
    with a requirement block loses that first block from body - intentional parity)."""
    m = META_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    try:
        meta = json.loads(m.group(1).strip())
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    return meta, text[m.end():]


def fenced_ranges(body):
    """Character ranges inside fenced code blocks (line-scan, matches requirements.js
    fencedRanges), so literal <!--meta start--> examples in code fences aren't parsed."""
    ranges = []
    offset = 0
    open_f = None
    for line in body.split('\n'):
        start = offset
        end = offset + len(line)
        if open_f is None:
            o = FENCE_OPEN.match(line)
            if o:
                open_f = (o.group(1)[0], len(o.group(1)), start)
        else:
            c = FENCE_CLOSE.match(line)
            if c and c.group(1)[0] == open_f[0] and len(c.group(1)) >= open_f[1]:
                ranges.append((open_f[2], end))
                open_f = None
        offset = end + 1
    if open_f is not None:
        ranges.append((open_f[2], len(body)))
    return ranges


def in_fence(ranges, pos):
    for a, b in ranges:
        if a <= pos < b:
            return True
    return False


def extract_headings(body):
    s = FENCED_STRIP.sub('', body)
    s = META_REGION_STRIP.sub('', s)
    out = []
    for m in HEADING_RE.finditer(s):
        t = INLINE_MD.sub('', m.group(1)).strip()
        if t:
            out.append(t)
    return out


def extract_links(body):
    """In-body [text](target) links -> list of (raw_target, is_scheme). Mirrors
    doclinks.documentLinks pre-classification (fences / inline code / meta stripped)."""
    s = FENCED_STRIP.sub('', body)
    s = INLINE_CODE.sub('', s)
    s = META_REGION_STRIP.sub('', s)
    out = []
    for m in LINK_RE.finditer(s):
        target = m.group(1).strip()
        if target.startswith('<') and target.endswith('>'):
            target = target[1:-1]
        if not target or target[0] == '#':
            continue
        out.append((target, bool(HAS_SCHEME.match(target))))
    return out


def _split_row(line):
    s = line.strip()
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    cells, cur, i = [], '', 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            cur += s[i + 1]
            i += 2
            continue
        if c == '|':
            cells.append(cur)
            cur = ''
            i += 1
            continue
        cur += c
        i += 1
    cells.append(cur)
    return [c.strip() for c in cells]


def _parse_table(text):
    lines = [l.strip() for l in text.split('\n') if l.strip() and '|' in l]
    if len(lines) < 2:
        return []
    header = [h.lower().replace(' ', '-').strip() for h in _split_row(lines[0])]
    rows = []
    for r in range(2, len(lines)):
        cells = _split_row(lines[r])
        rows.append({header[i]: (cells[i] if i < len(cells) else '').strip() for i in range(len(header))})
    return rows


def _pick(rec, names):
    for n in names:
        if rec.get(n):
            return rec[n]
    return ''


def _split_refs(raw):
    return [s.strip() for s in str(raw).split(',') if s.strip()] if raw else []


def extract_blocks(body, component):
    """Requirement groups + test cases (fence-aware), matching requirements.extractGroups.
    Returns (requirements, tests). Requirement id upper-cased; test id NOT (client parity)."""
    reqs, tests = [], []
    ranges = fenced_ranges(body)
    for m in META_BLOCK_RE.finditer(body):
        if in_fence(ranges, m.start()):
            continue
        try:
            meta = json.loads(m.group(1))
        except Exception:
            meta = None
        rows = _parse_table(m.group(2))
        is_test = bool(meta and (meta.get('test') or meta.get('test-case')))
        if is_test:
            key = meta.get('test') or meta.get('test-case')
            if not (component and key):
                continue
            steps = []
            if isinstance(meta.get('steps'), list):
                for s in meta['steps']:
                    if isinstance(s, dict):
                        a = s.get('action') or ''
                        e = s.get('expected') or s.get('expected-response') or s.get('response') or ''
                        if a or e:
                            steps.append({'action': a, 'expected': e})
            else:
                for row in rows:
                    a = _pick(row, ['action', 'step', 'request', 'do', 'when'])
                    e = _pick(row, ['expected-response', 'expected', 'response', 'result', 'then'])
                    if a or e:
                        steps.append({'action': a, 'expected': e})
            verifies = [str(v) for v in meta['verifies']] if isinstance(meta.get('verifies'), list) \
                else _split_refs(meta.get('verifies') or meta.get('verify') or '')
            tests.append({
                'id': 'T_' + component + '_' + key, 'component': component, 'key': key,
                'name': meta.get('name') or key, 'steps': steps, 'verifies_raw': verifies,
            })
        else:
            group = meta and (meta.get('requirement-group') or meta.get('group'))
            if not (component and group):
                continue
            for row in rows:
                no = _pick(row, ['requirement-no', 'req-no', 'no', 'requirement', '#'])
                if not no:
                    continue
                reqs.append({
                    'id': ('R_' + component + '_' + group + '_' + no).upper(),
                    'component': component, 'group': group, 'no': no,
                    'description': _pick(row, ['description', 'desc']),
                    'trace_to': _split_refs(_pick(row, ['trace-to', 'traceto', 'trace'])),
                })
    return reqs, tests


def fallback_title(doc_id):
    base = doc_id.rsplit('/', 1)[-1]
    base = re.sub(r'[-_]+', ' ', base)
    return re.sub(r'\b\w', lambda m: m.group(0).upper(), base)


# ---- resolution (relink pass), ported from doclinks + requirements ----------
def join_doc_path(base_id, rel):
    rel = re.sub(r'/+$', '', str(rel or ''))
    if rel.startswith('/'):
        segs = str(base_id or '').split('/')[:1]
        rel = re.sub(r'^/+', '', rel)
    else:
        segs = str(base_id or '').split('/')
        if segs:
            segs.pop()
    for seg in rel.split('/'):
        if seg in ('', '.'):
            continue
        if seg == '..':
            if segs:
                segs.pop()
            continue
        segs.append(seg)
    return '/'.join(segs)


def resolve_doc_id(path, base_id, ids, ids_lc):
    """ids: set of ids; ids_lc: dict lower(id)->id. Mirrors doclinks.resolveDocId."""
    if not path:
        return None

    def match(c):
        if not c:
            return None
        if c in ids:
            return c
        return ids_lc.get(c.lower())
    if base_id:
        hit = match(join_doc_path(base_id, path))
        if hit:
            return hit
    hit = match(path)
    if hit:
        return hit
    lower = re.sub(r'^\.?/', '', path).lower()
    for lc, real in ids_lc.items():
        i = real.find('/')
        if i >= 0 and real[i + 1:].lower() == lower:
            return real
    return None


def resolve_req_ref(raw, component, group, req_ids_upper):
    cands = [raw, 'R_' + component + '_' + raw]
    if group:
        cands.append('R_' + component + '_' + group + '_' + raw)
    for c in cands:
        u = c.upper()
        if u in req_ids_upper:
            return u
    return None


class Index:
    """The SQLite-backed site index. Thread-safe: one connection per thread (WAL),
    a single write lock. Reconcile is incremental (mtime,size + config hash)."""

    def __init__(self, here, sources, index_body=False, index_dir=None):
        self.here = here
        self.sources = sources           # [{name, path, component}]
        self.index_body = index_body
        # index_dir lets a second site (e.g. a big demo) keep its own DB instead of
        # sharing/clobbering the default one when configs differ.
        self.dir = index_dir if index_dir else os.path.join(here, '.webdoc-index')
        self.db_path = os.path.join(self.dir, 'index.db')
        self._local = threading.local()
        self._wlock = threading.RLock()
        self.state = 'building'          # building | ready | error
        self.progress = {'done': 0, 'total': 0}
        os.makedirs(self.dir, exist_ok=True)
        self._ensure_schema()

    # -- connection / schema --
    def _conn(self):
        c = getattr(self._local, 'conn', None)
        if c is None:
            c = sqlite3.connect(self.db_path, timeout=10)
            c.row_factory = sqlite3.Row
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('PRAGMA synchronous=NORMAL')
            c.execute('PRAGMA busy_timeout=8000')
            self._local.conn = c
        return c

    def _config_hash(self):
        payload = json.dumps([[s['name'], s.get('component'), s['path']] for s in self.sources], sort_keys=True)
        return hashlib.sha1((payload + '|body=' + str(self.index_body)).encode('utf-8')).hexdigest()

    def _ensure_schema(self):
        c = self._conn()
        try:
            row = c.execute("SELECT v FROM schema_meta WHERE k='version'").fetchone()
            cfg = c.execute("SELECT v FROM schema_meta WHERE k='config_hash'").fetchone()
            if row and int(row['v']) == SCHEMA_VERSION and cfg and cfg['v'] == self._config_hash():
                return
        except sqlite3.DatabaseError:
            pass
        # rebuild (disposable cache): drop everything, recreate
        with self._wlock:
            c.executescript("""
                DROP TABLE IF EXISTS schema_meta;
                DROP TABLE IF EXISTS doc; DROP TABLE IF EXISTS meta_edge;
                DROP TABLE IF EXISTS heading; DROP TABLE IF EXISTS page_link;
                DROP TABLE IF EXISTS requirement; DROP TABLE IF EXISTS req_trace_to;
                DROP TABLE IF EXISTS test; DROP TABLE IF EXISTS test_verifies;
                DROP TABLE IF EXISTS req_trace_edge; DROP TABLE IF EXISTS req_verified_by;
                DROP TABLE IF EXISTS doc_link_edge; DROP TABLE IF EXISTS doc_fts;
            """)
            c.executescript("""
                CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT);
                CREATE TABLE doc(
                  intid INTEGER PRIMARY KEY AUTOINCREMENT,
                  id TEXT UNIQUE NOT NULL, id_lc TEXT NOT NULL,
                  source TEXT NOT NULL, rel TEXT NOT NULL,
                  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
                  component TEXT, mtime_ns INTEGER NOT NULL, size INTEGER NOT NULL);
                CREATE INDEX doc_source ON doc(source);
                CREATE INDEX doc_id_lc ON doc(id_lc);
                CREATE TABLE meta_edge(from_id TEXT, kind TEXT, to_raw TEXT, ord INTEGER);
                CREATE INDEX meta_edge_from ON meta_edge(from_id);
                CREATE TABLE heading(doc_id TEXT, ord INTEGER, text TEXT);
                CREATE INDEX heading_doc ON heading(doc_id);
                CREATE TABLE page_link(from_id TEXT, raw TEXT, is_scheme INTEGER, ord INTEGER);
                CREATE INDEX page_link_from ON page_link(from_id);
                CREATE TABLE requirement(
                  id TEXT PRIMARY KEY, doc_id TEXT, component TEXT, grp TEXT, no TEXT,
                  description TEXT DEFAULT '', block_ord INTEGER);
                CREATE INDEX requirement_doc ON requirement(doc_id);
                CREATE TABLE req_trace_to(req_id TEXT, raw TEXT, ord INTEGER);
                CREATE INDEX req_trace_to_req ON req_trace_to(req_id);
                CREATE TABLE test(
                  id TEXT PRIMARY KEY, doc_id TEXT, component TEXT, key TEXT, name TEXT,
                  steps_json TEXT, block_ord INTEGER);
                CREATE INDEX test_doc ON test(doc_id);
                CREATE TABLE test_verifies(test_id TEXT, raw TEXT, ord INTEGER);
                CREATE INDEX test_verifies_test ON test_verifies(test_id);
                CREATE TABLE req_trace_edge(src_req TEXT, dst_req TEXT, src_doc TEXT, dst_doc TEXT);
                CREATE TABLE req_verified_by(req_id TEXT, test_id TEXT);
                CREATE TABLE doc_link_edge(from_id TEXT, to_id TEXT, ext_url TEXT);
                CREATE INDEX doc_link_from ON doc_link_edge(from_id);
                CREATE VIRTUAL TABLE doc_fts USING fts5(
                  title, description, headings, body,
                  tokenize='unicode61 remove_diacritics 2');
            """)
            c.execute("INSERT INTO schema_meta(k,v) VALUES('version',?)", (str(SCHEMA_VERSION),))
            c.execute("INSERT INTO schema_meta(k,v) VALUES('config_hash',?)", (self._config_hash(),))
            c.commit()

    # -- parsing one file --
    def _parse(self, doc_id, component, text):
        meta, body = split_meta(text)
        title = (meta.get('title') if isinstance(meta, dict) else None) or fallback_title(doc_id)
        reqs, tests = extract_blocks(body, component) if component else ([], [])
        return {
            'title': title,
            'description': (meta.get('description') if isinstance(meta, dict) else '') or '',
            'assumes': meta.get('assumes') or [] if isinstance(meta, dict) else [],
            'next': meta.get('next') or [] if isinstance(meta, dict) else [],
            'headings': extract_headings(body),
            'links': extract_links(body),
            'requirements': reqs, 'tests': tests, 'body': body,
        }

    def _write_doc(self, c, doc_id, source, rel, component, text, mtime_ns, size):
        self._write_parsed(c, doc_id, source, rel, component, self._parse(doc_id, component, text), mtime_ns, size)

    # Write an ALREADY-parsed doc (parsing is done off-thread during a bulk build).
    def _write_parsed(self, c, doc_id, source, rel, component, p, mtime_ns, size):
        # clear existing child rows for this doc
        for tbl, col in (('heading', 'doc_id'), ('page_link', 'from_id'), ('meta_edge', 'from_id')):
            c.execute('DELETE FROM %s WHERE %s=?' % (tbl, col), (doc_id,))
        old_reqs = [r['id'] for r in c.execute('SELECT id FROM requirement WHERE doc_id=?', (doc_id,))]
        old_tests = [r['id'] for r in c.execute('SELECT id FROM test WHERE doc_id=?', (doc_id,))]
        for rid in old_reqs:
            c.execute('DELETE FROM req_trace_to WHERE req_id=?', (rid,))
        for tid in old_tests:
            c.execute('DELETE FROM test_verifies WHERE test_id=?', (tid,))
        c.execute('DELETE FROM requirement WHERE doc_id=?', (doc_id,))
        c.execute('DELETE FROM test WHERE doc_id=?', (doc_id,))
        # upsert the doc row (keep intid stable if it exists -> stable FTS rowid)
        row = c.execute('SELECT intid FROM doc WHERE id=?', (doc_id,)).fetchone()
        headings_txt = '\n'.join(p['headings'])
        body_txt = p['body'] if self.index_body else ''
        if row:
            intid = row['intid']
            c.execute('UPDATE doc SET source=?,rel=?,title=?,description=?,component=?,mtime_ns=?,size=? WHERE intid=?',
                      (source, rel, p['title'], p['description'], component, mtime_ns, size, intid))
            c.execute('DELETE FROM doc_fts WHERE rowid=?', (intid,))
        else:
            cur = c.execute('INSERT INTO doc(id,id_lc,source,rel,title,description,component,mtime_ns,size) VALUES(?,?,?,?,?,?,?,?,?)',
                            (doc_id, doc_id.lower(), source, rel, p['title'], p['description'], component, mtime_ns, size))
            intid = cur.lastrowid
        c.execute('INSERT INTO doc_fts(rowid,title,description,headings,body) VALUES(?,?,?,?,?)',
                  (intid, p['title'], p['description'], headings_txt, body_txt))
        if p['headings']:
            c.executemany('INSERT INTO heading(doc_id,ord,text) VALUES(?,?,?)',
                          [(doc_id, i, h) for i, h in enumerate(p['headings'])])
        if p['links']:
            c.executemany('INSERT INTO page_link(from_id,raw,is_scheme,ord) VALUES(?,?,?,?)',
                          [(doc_id, raw, 1 if is_scheme else 0, i) for i, (raw, is_scheme) in enumerate(p['links'])])
        edges = [(doc_id, 'assumes', str(a), i) for i, a in enumerate(p['assumes'])] \
            + [(doc_id, 'next', str(n), i) for i, n in enumerate(p['next'])]
        if edges:
            c.executemany('INSERT INTO meta_edge(from_id,kind,to_raw,ord) VALUES(?,?,?,?)', edges)
        for i, r in enumerate(p['requirements']):
            c.execute('INSERT OR REPLACE INTO requirement(id,doc_id,component,grp,no,description,block_ord) VALUES(?,?,?,?,?,?,?)',
                      (r['id'], doc_id, r['component'], r['group'], r['no'], r['description'], i))
            for j, raw in enumerate(r['trace_to']):
                c.execute('INSERT INTO req_trace_to(req_id,raw,ord) VALUES(?,?,?)', (r['id'], raw, j))
        for i, t in enumerate(p['tests']):
            c.execute('INSERT OR REPLACE INTO test(id,doc_id,component,key,name,steps_json,block_ord) VALUES(?,?,?,?,?,?,?)',
                      (t['id'], doc_id, t['component'], t['key'], t['name'], json.dumps(t['steps']), i))
            for j, raw in enumerate(t['verifies_raw']):
                c.execute('INSERT INTO test_verifies(test_id,raw,ord) VALUES(?,?,?)', (t['id'], raw, j))

    # -- global relink: rebuild resolved edges from the raw refs --
    def _relink(self, c):
        c.execute('DELETE FROM req_trace_edge')
        c.execute('DELETE FROM req_verified_by')
        c.execute('DELETE FROM doc_link_edge')
        ids = set()
        ids_lc = {}
        for r in c.execute('SELECT id, id_lc FROM doc'):
            ids.add(r['id'])
            ids_lc[r['id_lc']] = r['id']
        req_ids = set()
        req_meta = {}
        for r in c.execute('SELECT id, doc_id, component, grp FROM requirement'):
            req_ids.add(r['id'])
            req_meta[r['id']] = (r['doc_id'], r['component'], r['grp'])
        # requirement trace-to -> resolved edge (src req -> dst req), doc-level for the map
        for r in c.execute('SELECT req_id, raw FROM req_trace_to'):
            src = r['req_id']
            meta = req_meta.get(src)
            if not meta:
                continue
            tgt = resolve_req_ref(r['raw'], meta[1], meta[2], req_ids)
            if tgt and tgt in req_meta:
                c.execute('INSERT INTO req_trace_edge(src_req,dst_req,src_doc,dst_doc) VALUES(?,?,?,?)',
                          (src, tgt, meta[0], req_meta[tgt][0]))
        # test verifies -> req_verified_by
        for r in c.execute('SELECT id, component FROM test'):
            tid, comp = r['id'], r['component']
            for v in c.execute('SELECT raw FROM test_verifies WHERE test_id=?', (tid,)):
                tgt = resolve_req_ref(v['raw'], comp, None, req_ids)
                if tgt and tgt in req_meta:
                    c.execute('INSERT INTO req_verified_by(req_id,test_id) VALUES(?,?)', (tgt, tid))
        # page links -> doc_link_edge (internal resolved, or external URL)
        for r in c.execute('SELECT from_id, raw, is_scheme FROM page_link'):
            raw = r['raw']
            if r['is_scheme']:
                c.execute('INSERT INTO doc_link_edge(from_id,to_id,ext_url) VALUES(?,?,?)', (r['from_id'], None, raw))
            else:
                hi = raw.find('#')
                clean = (raw[:hi] if hi >= 0 else raw)
                clean = re.sub(r'\.md$', '', clean, flags=re.I)
                clean = re.sub(r'/+$', '', clean)
                tgt = resolve_doc_id(clean, r['from_id'], ids, ids_lc)
                if tgt and tgt != r['from_id']:
                    c.execute('INSERT INTO doc_link_edge(from_id,to_id,ext_url) VALUES(?,?,?)', (r['from_id'], tgt, None))

    # -- reconcile: incremental walk (mtime,size), then relink --
    def reconcile(self):
        try:
            with self._wlock:
                c = self._conn()
                # Bulk-build tuning: skip fsync per commit (safe - the DB is a
                # rebuildable cache), give SQLite a big page cache, and checkpoint the
                # WAL rarely, so a large COLD build isn't throttled by WAL->DB flushes
                # (the fsync-per-checkpoint wall that appears once the DB outgrows RAM).
                c.execute('PRAGMA synchronous=OFF')
                c.execute('PRAGMA cache_size=-262144')       # ~256 MB page cache
                c.execute('PRAGMA wal_autocheckpoint=20000')
                have = {r['id']: (r['mtime_ns'], r['size']) for r in c.execute('SELECT id,mtime_ns,size FROM doc')}
                seen = set()
                files = []
                for s in self.sources:
                    root = s['path']
                    if not os.path.isdir(root):
                        continue
                    for dirpath, dirnames, filenames in os.walk(root):
                        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                        for fn in filenames:
                            if not fn.lower().endswith('.md'):
                                continue
                            files.append((s, os.path.join(dirpath, fn)))
                self.progress = {'done': 0, 'total': len(files)}
                changed = 0
                # Read + parse files in a thread pool: reading 500k tiny files is
                # I/O-bound (each read is dominated by filesystem / AV-scan latency), so
                # overlapping them across threads is the difference between a ~20-minute
                # and a ~2-minute cold build. DB writes stay on THIS thread (SQLite has a
                # single writer); the pool threads only stat/read/parse (no DB access).
                def read_parse(sf):
                    s, fp = sf
                    try:
                        st = os.stat(fp)
                    except OSError:
                        return None
                    rel = os.path.relpath(fp, s['path']).replace('\\', '/')
                    doc_id = s['name'] + '/' + re.sub(r'\.md$', '', rel, flags=re.I)
                    prev = have.get(doc_id)
                    if prev and prev[0] == st.st_mtime_ns and prev[1] == st.st_size:
                        return ('skip', doc_id)
                    try:
                        with open(fp, 'r', encoding='utf-8-sig', errors='replace') as fh:
                            text = fh.read()
                    except OSError:
                        return ('skip', doc_id)
                    return ('doc', doc_id, s['name'], rel, s.get('component'),
                            self._parse(doc_id, s.get('component'), text), st.st_mtime_ns, st.st_size)
                with ThreadPoolExecutor(max_workers=16) as ex:
                    for res in ex.map(read_parse, files, chunksize=64):
                        self.progress['done'] += 1
                        if not res:
                            continue
                        seen.add(res[1])
                        if res[0] == 'skip':
                            continue
                        _, doc_id, source, rel, component, p, mtime_ns, size = res
                        self._write_parsed(c, doc_id, source, rel, component, p, mtime_ns, size)
                        changed += 1
                        if changed % 20000 == 0:
                            c.commit()
                # delete rows for files that disappeared
                for doc_id in list(have.keys()):
                    if doc_id not in seen:
                        self._delete_doc_rows(c, doc_id)
                        changed += 1
                self._relink(c)
                c.commit()
                try:
                    c.execute('PRAGMA wal_checkpoint(TRUNCATE)')   # fold the WAL back, reset synchronous
                except Exception:
                    pass
                c.execute('PRAGMA synchronous=NORMAL')
                self.state = 'ready'
        except Exception as e:
            self.state = 'error'
            print('  ! index reconcile failed:', e)

    def _delete_doc_rows(self, c, doc_id):
        row = c.execute('SELECT intid FROM doc WHERE id=?', (doc_id,)).fetchone()
        if row:
            c.execute('DELETE FROM doc_fts WHERE rowid=?', (row['intid'],))
        for rid in [r['id'] for r in c.execute('SELECT id FROM requirement WHERE doc_id=?', (doc_id,))]:
            c.execute('DELETE FROM req_trace_to WHERE req_id=?', (rid,))
        for tid in [r['id'] for r in c.execute('SELECT id FROM test WHERE doc_id=?', (doc_id,))]:
            c.execute('DELETE FROM test_verifies WHERE test_id=?', (tid,))
        for tbl, col in (('doc', 'id'), ('heading', 'doc_id'), ('page_link', 'from_id'),
                         ('meta_edge', 'from_id'), ('requirement', 'doc_id'), ('test', 'doc_id')):
            c.execute('DELETE FROM %s WHERE %s=?' % (tbl, col), (doc_id,))

    # -- write-path (called from serve.py do_PUT / do_DELETE) --
    def update_doc(self, source, rel, text):
        with self._wlock:
            c = self._conn()
            src = next((s for s in self.sources if s['name'] == source), None)
            if not src:
                return
            doc_id = source + '/' + re.sub(r'\.md$', '', rel, flags=re.I)
            try:
                st = os.stat(os.path.join(src['path'], rel))
                mtime_ns, size = st.st_mtime_ns, st.st_size
            except OSError:
                mtime_ns, size = time.time_ns(), len(text)
            self._write_doc(c, doc_id, source, rel, src.get('component'), text, mtime_ns, size)
            self._relink(c)
            c.commit()

    def delete_doc(self, source, rel):
        with self._wlock:
            c = self._conn()
            doc_id = source + '/' + re.sub(r'\.md$', '', rel, flags=re.I)
            self._delete_doc_rows(c, doc_id)
            self._relink(c)
            c.commit()

    # -- read queries --
    def status(self):
        c = self._conn()
        n = c.execute('SELECT COUNT(*) n FROM doc').fetchone()['n'] if self.state == 'ready' else self.progress['done']
        pct = 100 if self.state == 'ready' else (round(100 * self.progress['done'] / self.progress['total']) if self.progress['total'] else 0)
        return {'state': self.state, 'docs': n, 'pct': pct}

    @staticmethod
    def _fts_query(q):
        terms = re.findall(r'\w+', q or '', re.UNICODE)
        if not terms:
            return None
        return ' '.join('"%s"*' % t for t in terms[:12])

    def search(self, q, limit=50, offset=0):
        c = self._conn()
        mq = self._fts_query(q)
        if not mq:
            return []
        try:
            rows = c.execute(
                """SELECT d.id AS id, d.title AS title,
                          snippet(doc_fts, 2, '[', ']', ' … ', 8) AS snip,
                          bm25(doc_fts, 10.0, 4.0, 2.0, 1.0) AS rank
                   FROM doc_fts JOIN doc d ON d.intid = doc_fts.rowid
                   WHERE doc_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?""",
                (mq, int(limit), int(offset))).fetchall()
        except sqlite3.OperationalError:
            return []
        return [{'id': r['id'], 'title': r['title'], 'snippet': r['snip']} for r in rows]

    def tree(self, path):
        """Children of one folder path ('' or 'Source' or 'Source/sub'): immediate
        sub-folders + docs. Lets the client render the tree lazily, one level at a time."""
        c = self._conn()
        prefix = (path.rstrip('/') + '/') if path else ''
        folders, docs = set(), []
        for r in c.execute('SELECT id, title FROM doc WHERE id LIKE ? ORDER BY id_lc', (prefix + '%',)):
            rest = r['id'][len(prefix):]
            if '/' in rest:
                folders.add(rest.split('/', 1)[0])
            else:
                docs.append({'id': r['id'], 'title': r['title']})
        return {'folders': sorted(folders, key=str.lower), 'docs': docs}

    def resolve(self, base, paths):
        """Resolve in-body link targets to doc ids against the FULL index (the client
        no longer holds every id under lazy boot). Mirrors doclinks.resolveDocId:
        relative-to-base, then as-is, then last-path-segment fallback; case-insensitive."""
        c = self._conn()
        return {p: self._resolve_one(c, base, p) for p in paths}

    def _resolve_one(self, c, base, path):
        if not path:
            return None

        def hit(cand):
            if not cand:
                return None
            r = c.execute('SELECT id FROM doc WHERE id=? LIMIT 1', (cand,)).fetchone()
            if r:
                return r['id']
            r = c.execute('SELECT id FROM doc WHERE id_lc=? LIMIT 1', (cand.lower(),)).fetchone()
            return r['id'] if r else None
        if base:
            h = hit(join_doc_path(base, path))
            if h:
                return h
        h = hit(path)
        if h:
            return h
        lower = re.sub(r'^\.?/', '', path).lower()
        r = c.execute("SELECT id FROM doc WHERE instr(id_lc,'/')>0 AND substr(id_lc, instr(id_lc,'/')+1)=? LIMIT 1",
                      (lower,)).fetchone()
        return r['id'] if r else None

    def graph(self):
        """Whole-graph payload for the map: nodes once + integer-indexed edges (assumes/
        next resolved, requirement-trace doc edges, page links + external URLs)."""
        c = self._conn()
        idx = {}
        nodes = []
        for r in c.execute('SELECT id,title,description,source FROM doc ORDER BY id'):
            idx[r['id']] = len(nodes)
            nodes.append([r['id'], r['title'], r['description'] or ''])
        ext_idx = {}
        ext = []

        def ni(i):
            return idx.get(i, -1)
        edges = []            # [fromIdx, toIdx, type]  type: 0 prereq,1 recnext
        for r in c.execute('SELECT from_id, kind, to_raw FROM meta_edge'):
            f = ni(r['from_id'])
            t = ni(r['to_raw'])
            if f < 0:
                continue
            if r['kind'] == 'assumes':      # assumes P on D -> prereq edge P -> D
                edges.append([t, f, 0])
            else:                           # next S on D -> recnext edge D -> S
                edges.append([f, t, 1])
        traces = []
        seen_tr = set()
        for r in c.execute('SELECT DISTINCT src_doc, dst_doc FROM req_trace_edge'):
            if r['src_doc'] == r['dst_doc']:
                continue
            key = r['src_doc'] + ' ' + r['dst_doc']
            if key in seen_tr:
                continue
            seen_tr.add(key)
            traces.append([ni(r['src_doc']), ni(r['dst_doc'])])
        # Exclude page-link pairs already shown as prereq/recnext/trace, and de-dupe
        # directed links - matching doclinks.js so the map is identical.
        def pk(a, b):
            return (a + '\x00' + b) if a < b else (b + '\x00' + a)
        exclude = set()
        for r in c.execute('SELECT from_id, to_raw FROM meta_edge'):
            exclude.add(pk(r['from_id'], r['to_raw']))
        for r in c.execute('SELECT src_doc, dst_doc FROM req_trace_edge'):
            exclude.add(pk(r['src_doc'], r['dst_doc']))
        plinks = []           # [fromIdx, toIdx or -1, extIndex or -1]
        seen_pl = set()
        for r in c.execute('SELECT from_id, to_id, ext_url FROM doc_link_edge'):
            f = ni(r['from_id'])
            if f < 0:
                continue
            if r['to_id']:
                if r['from_id'] == r['to_id'] or pk(r['from_id'], r['to_id']) in exclude:
                    continue
                dk = r['from_id'] + ' ' + r['to_id']
                if dk in seen_pl:
                    continue
                seen_pl.add(dk)
                plinks.append([f, ni(r['to_id']), -1])
            elif r['ext_url']:
                dk = r['from_id'] + ' ext:' + r['ext_url']
                if dk in seen_pl:
                    continue
                seen_pl.add(dk)
                ei = ext_idx.get(r['ext_url'])
                if ei is None:
                    ei = len(ext)
                    ext_idx[r['ext_url']] = ei
                    ext.append(r['ext_url'])
                plinks.append([f, -1, ei])
        return {'nodes': nodes, 'edges': edges, 'traces': [t for t in traces if t[0] >= 0 and t[1] >= 0],
                'pageLinks': plinks, 'externals': ext}

    def coverage(self):
        """Requirements + tests with resolved trace-from / verified-by / verifies,
        mirroring the client's requirementList()/testList() for the coverage view."""
        c = self._conn()
        reqs = {}
        for r in c.execute('SELECT id,doc_id,component,grp,no,description FROM requirement'):
            reqs[r['id']] = {'id': r['id'], 'docId': r['doc_id'], 'component': r['component'],
                             'group': r['grp'], 'no': r['no'], 'description': r['description'] or '',
                             'traceTo': [], 'traceFrom': [], 'verifiedBy': []}
        for r in c.execute('SELECT src_req,dst_req FROM req_trace_edge'):
            if r['src_req'] in reqs:
                reqs[r['src_req']]['traceTo'].append(r['dst_req'])
            if r['dst_req'] in reqs:
                reqs[r['dst_req']]['traceFrom'].append(r['src_req'])
        for r in c.execute('SELECT req_id,test_id FROM req_verified_by'):
            if r['req_id'] in reqs:
                reqs[r['req_id']]['verifiedBy'].append(r['test_id'])
        tests = {}
        for r in c.execute('SELECT id,doc_id,component,key,name,steps_json FROM test'):
            try:
                steps = json.loads(r['steps_json'] or '[]')
            except Exception:
                steps = []
            tests[r['id']] = {'id': r['id'], 'docId': r['doc_id'], 'component': r['component'],
                              'key': r['key'], 'name': r['name'] or '', 'steps': steps, 'verifies': []}
        for r in c.execute('SELECT req_id,test_id FROM req_verified_by'):
            if r['test_id'] in tests:
                tests[r['test_id']]['verifies'].append(r['req_id'])
        return {'requirements': sorted(reqs.values(), key=lambda x: x['id']),
                'tests': sorted(tests.values(), key=lambda x: x['id'])}
