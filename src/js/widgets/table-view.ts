import { columnOptions, formattedCell, cellText } from './table-data.js';
import type { TableData } from './table-data.js';
import { cycle } from './table-logic.js';
import type { Sort } from './table-logic.js';

// At most one page of DOM. Reuse keyed rows and unchanged cells on refresh.
export function tableView(options:Record<string,unknown>,onSort:(sort:Sort|undefined)=>void,onPage:(delta:number)=>void,onSearch:(search:string)=>void) {
  const root=document.createElement('div'); root.className='wd-table-data';
  const controls=document.createElement('div');
  const search=document.createElement('input'); search.type='search'; search.placeholder='Filter table'; search.setAttribute('aria-label','Filter table');
  let debounce:ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input',()=>{clearTimeout(debounce); debounce=setTimeout(()=>onSearch(search.value),150);});
  const previous=document.createElement('button'),next=document.createElement('button'),count=document.createElement('span');
  previous.type=next.type='button'; previous.textContent='Previous'; next.textContent='Next'; count.setAttribute('role','status');
  previous.onclick=()=>onPage(-1); next.onclick=()=>onPage(1); controls.append(search,previous,next,count);
  const table=document.createElement('table'); table.dataset.pagedTable='true'; const head=table.createTHead().insertRow(),body=table.createTBody();
  root.append(controls,table);
  let columns=columnOptions(options.columns); let current:Sort|undefined; let headers='';
  const rows=new Map<string,{element:HTMLTableRowElement;cells:string[]}>();
  function update(data:TableData,sort:Sort|undefined,defaultSort:Sort[],before:boolean,after:boolean,total?:number):void {
    current=sort; columns=columnOptions(options.columns,data.columns);
    const signature=JSON.stringify(columns);
    if(signature!==headers) {
      head.replaceChildren(); rows.clear(); body.replaceChildren();
      for(const c of columns) {
        const th=document.createElement('th'); th.scope='col'; const button=document.createElement('button'); button.type='button';
        button.textContent=c.label; button.title='Sort ascending, descending, then restore default';
        button.onclick=()=>onSort(cycle(current,c.key)); th.append(button); head.append(th);
      }
      headers=signature;
    }
    const effective=sort ? [sort] : defaultSort;
    for(let i=0;i<columns.length;i++) {
      const s=effective.find(s=>s.column===columns[i].key),th=head.cells[i];
      th.setAttribute('aria-sort',s ? s.direction==='asc' ? 'ascending' : 'descending' : 'none');
      th.querySelector('button')!.textContent=columns[i].label+(s ? s.direction==='asc' ? ' ↑' : ' ↓' : '');
    }
    const keep=new Set<string>();
    const occurrences=new Map<string,number>();
    data.rows.forEach((row,index)=> {
      const base=String(row.id ?? row.job ?? row.__seq ?? JSON.stringify(row));
      const occurrence=occurrences.get(base) || 0; occurrences.set(base,occurrence+1);
      const id=base+'#'+occurrence; keep.add(id);
      let cached=rows.get(id);
      if(!cached) { cached={element:document.createElement('tr'),cells:[]}; for(const _c of columns) cached.element.insertCell(); rows.set(id,cached); }
      for(let i=0;i<columns.length;i++) {
        const c=columns[i]; let value=Object.hasOwn(row,c.key) ? row[c.key] : undefined;
        if(c.format==='link' && c.key==='subsection' && typeof row.link==='string') value={label:cellText(value),href:'#/'+row.link};
        const fingerprint=JSON.stringify(value ?? null);
        if(cached.cells[i]!==fingerprint) { cached.element.cells[i].replaceChildren(formattedCell(value,c.format)); cached.cells[i]=fingerprint; }
      }
      // Moving an existing node retains its subtree and focus; no replacement.
      if(body.rows[index]!==cached.element) body.insertBefore(cached.element,body.rows[index] || null);
    });
    for(const [id,cached] of rows) if(!keep.has(id)) {cached.element.remove(); rows.delete(id);}
    previous.disabled=!before; next.disabled=!after; count.textContent=` ${data.rows.length} rows${total===undefined ? '' : ' of '+total}`;
  }
  return {root,update,clear:()=>{rows.clear();body.replaceChildren();},destroy:()=>clearTimeout(debounce)};
}
