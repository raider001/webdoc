// jsdom has no Worker implementation. Exercise the production pure worker logic
// without sockets/HTTP; actual browser threading is kept in production code.
import { beforeEach, vi } from 'vitest';
import { TableLogic } from '/js/widgets/table-logic.js';
class WorkerShim {
  onmessage: ((event:{data:unknown})=>void) | null=null;
  onerror: ((event:{message:string})=>void) | null=null;
  private logic=new TableLogic(); private closed=false;
  postMessage(q:Parameters<TableLogic['query']> extends never ? never : any):void {
    if(this.closed)return;
    try {
      if(q.rows)this.logic.set(q.rows,q.columns || []);
      const result=this.logic.query(q.filters,q.sort,q.search,q.offset,q.limit);
      queueMicrotask(()=>{if(!this.closed)this.onmessage?.({data:{id:q.id,...result}});});
    } catch(error) {this.onerror?.({message:String(error)});}
  }
  terminate():void {this.closed=true;}
}
beforeEach(()=>vi.stubGlobal('Worker',WorkerShim));
