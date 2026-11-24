import { cycle } from './table-logic.js';
import type { Sort } from './table-logic.js';

// Ordinary sanitized Markdown tables keep authored cell markup and document links.
// Same worker/keys/click cycle as live-table; never touch requirement/test islands.
export function plainTables(root:HTMLElement,register:(host:Element,destroy:()=>void)=>void):void {
  for(const table of root.querySelectorAll<HTMLTableElement>('table')) {
    if(table.closest('.wd-live,.wd-mounted,.req-group,.wd-plain-table') || table.dataset.pagedTable) continue;
    const original=[...table.tBodies[0]?.rows || []]; if(!original.length) continue;
    const head=table.tHead?.rows[0]; if(!head) continue;
    const host=document.createElement('div'); host.className='wd-plain-table'; table.replaceWith(host); host.append(table);
    const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span');
    previous.type=next.type='button'; previous.textContent='Previous'; next.textContent='Next'; status.setAttribute('role','status');
    const controls=document.createElement('div'); controls.append(previous,next,status); host.prepend(controls);
    const worker=new Worker(new URL('./table-worker.js',import.meta.url),{type:'module'});
    let selected:Sort|undefined,offset=0,request=0,started=false;
    const columns=[...head.cells].map((_cell,i)=>({key:String(i),format:'text'}));
    const labels=[...head.cells].map(c=>c.textContent || '');
    const rows=original.map((tr,i)=>Object.fromEntries([['id',String(i)],...[...tr.cells].map((td,k)=>[String(k),td.textContent || ''])]));
    function refresh():void {
      worker.postMessage({id:++request,...(started ? {} : {rows,columns}),filters:[],sort:selected ? [selected] : [],offset,limit:100}); started=true;
      head!.querySelectorAll('th').forEach((th,i)=> {
        const s=selected?.column===String(i) ? selected : undefined;
        th.setAttribute('aria-sort',s ? s.direction==='asc' ? 'ascending' : 'descending' : 'none');
        th.querySelector('button')!.textContent=labels[i]+(s ? s.direction==='asc' ? ' ↑' : ' ↓' : '');
      });
    }
    [...head.cells].forEach((th,i)=>{const b=document.createElement('button'); b.type='button'; b.textContent=labels[i]; b.onclick=()=>{selected=cycle(selected,String(i));offset=0;refresh();};th.replaceChildren(b);});
    worker.onmessage=event=> {
      const data=event.data as {id:number;indices:number[];total:number}; if(data.id!==request) return;
      table.tBodies[0].replaceChildren(...data.indices.map(i=>original[i])); previous.disabled=offset===0; next.disabled=offset+100>=data.total;
      status.textContent=` ${Math.min(offset+100,data.total)} of ${data.total} rows`;
    };
    previous.onclick=()=>{offset=Math.max(0,offset-100);refresh();};next.onclick=()=>{offset+=100;refresh();};
    table.tBodies[0].replaceChildren(...original.slice(0,100)); refresh(); register(host,()=>worker.terminate());
  }
}
