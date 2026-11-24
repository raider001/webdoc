// Pure typed keys and stable ordering. Shared by the worker and offline tests.
export type Row = Record<string, unknown>;
export interface Sort { column: string; direction: 'asc' | 'desc'; }
export interface Filter { column: string; equals?: unknown; in?: unknown[]; }
export interface Column { key: string; format: string; }
export type Key = string | number | null;
const own = (row:Row,key:string):unknown => Object.hasOwn(row,key) ? row[key] : undefined;
export function text(value: unknown): string {
  return value == null ? '' : typeof value === 'object' && 'label' in value ? String((value as {label:unknown}).label) : String(value);
}
export function valueKey(value: unknown, format = 'text'): Key {
  const s = text(value).trim(); if (!s) return null;
  if (format === 'number' || format === 'percent') {
    const n = Number(s.replace(/[,%]/g,''));
    return Number.isFinite(n) ? format === 'percent' && s.endsWith('%') ? n / 100 : n : null;
  }
  if (format === 'datetime') { const n = Date.parse(s); return Number.isFinite(n) ? n : null; }
  if (format === 'duration') {
    const parts = s.split(':').map(Number);
    if (!parts.every(Number.isFinite)) return null;
    return parts.reduce((n,p) => n * 60 + p,0);
  }
  return s.toLowerCase();
}
export function compare(a: Key,b: Key,direction: 'asc'|'desc'): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = a === b ? 0 : a < b ? -1 : 1;
  return direction === 'desc' ? -order : order;
}
export function cycle(current: Sort | undefined,column: string): Sort | undefined {
  return current?.column !== column ? {column,direction:'asc'} : current.direction === 'asc' ? {column,direction:'desc'} : undefined;
}
function list(value: unknown): unknown[] {
  const parsed = typeof value === 'string' ? JSON.parse(value || '[]') as unknown : value ?? [];
  if (!Array.isArray(parsed)) throw new Error('Use a JSON list'); return parsed;
}
export function filters(value: unknown): Filter[] {
  return list(value).map(v => {
    if (!v || typeof v !== 'object') throw new Error('Invalid filter');
    const f = v as Filter;
    if (!f.column || (!(Object.hasOwn(f,'equals')) && !Array.isArray(f.in)) || (f.in && (!f.in.length || f.in.length>32))) throw new Error('Use column and equals, or column and in');
    return f;
  });
}
export function sorts(value: unknown): Sort[] {
  return list(value).map(v => {
    if (!v || typeof v !== 'object') throw new Error('Invalid sort');
    const s = v as Sort;
    if (!s.column || !['asc','desc'].includes(s.direction)) throw new Error('Use column and asc/desc direction');
    return s;
  });
}
export class TableLogic {
  rows: Row[] = [];
  private keys = new Map<string, Key[]>();
  private columns: Column[] = [];
  set(rows: Row[],columns: Column[]): void {
    this.rows=rows; this.columns=columns.map(c=> {
      if(c.format!=='text') return c;
      const values=rows.map(r=>text(own(r,c.key)).trim()).filter(Boolean);
      const format=values.length && values.every(s=>/^[+-]?(?:\d[\d,]*\.?\d*|\.\d+)$/.test(s)) ? 'number'
        : values.length && values.every(s=>/^[+-]?[\d,.]+%$/.test(s)) ? 'percent'
        : values.length && values.every(s=>/^\d+:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)) ? 'duration'
        : values.length && values.every(s=>/^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s))) ? 'datetime' : 'text';
      return {...c,format};
    }); this.keys.clear();
  }
  private columnKeys(column: string): Key[] {
    let cached=this.keys.get(column);
    if (!cached) {
      const fmt=this.columns.find(c=>c.key===column)?.format || 'text';
      cached=this.rows.map(row=>valueKey(own(row,column),fmt)); this.keys.set(column,cached);
    }
    return cached;
  }
  query(keep: Filter[],order: Sort[],search='',offset=0,limit=100): {rows:Row[];total:number;indices:number[]} {
    const sortKeys=order.map(s=>this.columnKeys(s.column));
    const wanted=keep.map(f=>({column:f.column,values:new Set((f.in || [f.equals]).map(text))}));
    const query=search.toLowerCase();
    const indices:number[]=[];
    for (let i=0;i<this.rows.length;i++) {
      const row=this.rows[i];
      if (wanted.every(f=>f.values.has(text(own(row,f.column)))) && (!query || this.columns.some(c=>text(own(row,c.key)).toLowerCase().includes(query)))) indices.push(i);
    }
    indices.sort((a,b)=> {
      for(let i=0;i<order.length;i++) { const cmp=compare(sortKeys[i][a],sortKeys[i][b],order[i].direction); if(cmp) return cmp; }
      return a-b;
    });
    const page=indices.slice(offset,offset+limit);
    return {rows:page.map(i=>this.rows[i]),total:indices.length,indices:page};
  }
}
