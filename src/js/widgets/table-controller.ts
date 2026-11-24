import { createTableReader, tableSource, columnOptions } from './table-data.js';
import type { TableData } from './table-data.js';
import { filters, sorts } from './table-logic.js';
import type { Sort, Row } from './table-logic.js';
import { tableView } from './table-view.js';
import { LiveFetchError } from './live.js';
import type { WidgetContext } from './registry.js';

export function tableController(ctx:WidgetContext) {
  const reader=createTableReader();
  const fallback=ctx.content;
  const source=ctx.options.pagedSource || ctx.options.source;
  const defaultSort=sorts(ctx.options.sortJson || ctx.options.sort || (ctx.options.sortBy ? [{column:String(ctx.options.sortBy),direction:ctx.options.sortDirection || 'asc'}] : []));
  const keep=filters(ctx.options.filtersJson || ctx.options.filters);
  let selected:Sort|undefined,search=String(ctx.options.filter || ''),offset=0,cursors:(string|undefined)[]=[undefined],page=0;
  let next:string|undefined,data:TableData|undefined,worker:Worker|undefined,active:AbortController|undefined;
  let sequence=0,workerData:TableData|undefined;
  const pending=new Map<number,{resolve:(v:{rows:Row[];total:number})=>void;reject:(e:Error)=>void}>();
  const view=tableView(ctx.options,s=>{selected=s;reset();void refresh().catch(ctx.reportError);},delta=>{
    if(data?.manifest) {if(delta>0 && next) {cursors[++page]=next;} else if(delta<0 && page>0) page--;}
    else offset=Math.max(0,offset+delta*size);
    void refresh().catch(ctx.reportError);
  },s=>{search=s;reset();void refresh().catch(ctx.reportError);});
  const size=Math.max(1,Math.min(100,Number(ctx.options.pageSize || 100)));
  function reset():void {offset=page=0;cursors=[undefined];active?.abort();}
  function local(data:TableData,order:Sort[]):Promise<{rows:Row[];total:number}> {
    if(!worker) {
      worker=new Worker(new URL('./table-worker.js',import.meta.url),{type:'module'});
      worker.onmessage=event=> {
        const r=event.data as {id:number;error?:string;rows:Row[];total:number}; const p=pending.get(r.id); if(!p) return;
        pending.delete(r.id); if(r.error) p.reject(new Error(r.error)); else p.resolve(r);
      };
      worker.onerror=event=>{for(const p of pending.values()) p.reject(new Error(event.message)); pending.clear();};
    }
    const id=++sequence;
    const promise=new Promise<{rows:Row[];total:number}>((resolve,reject)=>pending.set(id,{resolve,reject}));
    const columns=columnOptions(ctx.options.columns,data.columns);
    const visible=new Set(columns.map(c=>c.key));
    for(const key of data.columns) if(!visible.has(key)) columns.push({key,label:key,format:'text'});
    const send=workerData===data ? {} : {rows:data.rows,columns}; workerData=data;
    worker.postMessage({id,...send,filters:keep,sort:order,search,offset,limit:size}); return promise;
  }
  async function refresh(signal?:AbortSignal):Promise<void> {
    active?.abort(); const controller=new AbortController(); active=controller;
    const abort=()=>controller.abort(); signal?.addEventListener('abort',abort,{once:true});
    const deadline=setTimeout(()=>controller.abort(),30000);
    const order=selected ? [selected] : defaultSort;
    try {
      data=await reader.read(source,controller.signal);
      if(controller.signal.aborted || ctx.signal.aborted) return;
      if(data.manifest) {
        const src=tableSource(source).src;
        const params=new URLSearchParams({src,filters:JSON.stringify(keep),sort:JSON.stringify(order),limit:String(size),search});
        const cursor=cursors[page]; if(cursor) params.set('cursor',cursor);
        const response=await fetch('/api/data/page?'+params,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
        if(!response.ok) throw new LiveFetchError(response.status);
        const batch=await response.json() as TableData & {next?:string;restarted?:boolean};
        if(controller.signal.aborted || ctx.signal.aborted) return;
        if(batch.restarted) {page=0;cursors=[undefined];}
        next=batch.next; view.update(batch,selected,defaultSort,page>0,!!next);
        fallback.remove();
      } else {
        const batch=await local(data,order);
        if(controller.signal.aborted || ctx.signal.aborted) return;
        if(offset>=batch.total && offset>0) {offset=Math.max(0,Math.floor((batch.total-1)/size)*size);return await refresh();}
        view.update({columns:data.columns,rows:batch.rows},selected,defaultSort,offset>0,offset+size<batch.total,batch.total);
        fallback.remove();
      }
    } catch(error) {
      if(error instanceof LiveFetchError && [401,403,404].includes(error.status)) clear();
      if(!controller.signal.aborted) throw error;
    } finally {clearTimeout(deadline); signal?.removeEventListener('abort',abort); if(active===controller) active=undefined;}
  }
  function clear():void {active?.abort();reader.clear();data=undefined;workerData=undefined;fallback.remove();view.clear();worker?.terminate();worker=undefined;for(const p of pending.values())p.reject(new Error('Table cleared'));pending.clear();}
  function destroy():void {clear();worker?.terminate();for(const p of pending.values())p.reject(new Error('Table closed'));pending.clear();view.destroy();}
  return {root:view.root,refresh,clear,destroy};
}
