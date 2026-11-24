import { TableLogic } from './table-logic.js';
import type { Row, Column, Filter, Sort } from './table-logic.js';
const logic=new TableLogic();
interface Request { id:number; rows?:Row[]; columns?:Column[]; filters:Filter[]; sort:Sort[]; search?:string; offset:number; limit:number; }
globalThis.onmessage = (event: MessageEvent<Request>) => {
  const q=event.data;
  try {
    if(q.rows) logic.set(q.rows,q.columns || []);
    globalThis.postMessage({id:q.id,...logic.query(q.filters,q.sort,q.search,q.offset,q.limit)});
  } catch(error) { globalThis.postMessage({id:q.id,error:error instanceof Error ? error.message : String(error)}); }
};
