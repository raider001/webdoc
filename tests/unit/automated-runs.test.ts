import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import RunControls from '../../app/svelte/RunControls.svelte';
import TestCase from '../../app/svelte/TestCase.svelte';
import { sourceRuns } from '/js/automated-runs.js';
import { groupsByDoc } from '/js/requirements/store.js';
let serial = 0;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); groupsByDoc.clear(); });
function server(cases: Record<string, any>, states: string[] = []): string {
  const source = 'Suite' + (++serial); let polls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      expect((options.headers as Record<string,string>)['X-WebDoc-Run']).toBe('1');
      expect(Object.keys(JSON.parse(options.body as string))).toEqual(['source','ids']);
      return { ok: true, json: async () => ({ id: 'run-'+source, state:'waiting' }) };
    }
    if (url.startsWith('/api/runs/')) {
      const state = states[Math.min(polls++, states.length-1)] || 'finished';
      const finished = state === 'finished';
      if (finished) for (const value of Object.values(cases)) Object.assign(value, { lastRun: '2026-10-12T12:00:00+00:00', duration: .23, startedBy:'page' });
      return { ok:true, json:async () => ({ id:'run-'+source, ids:Object.keys(cases), state, output:'<script>alert(1)</script> tail', duration:.3, cases:finished ? cases : {} }) };
    }
    return { ok:true, json:async () => ({cases}) };
  }));
  return source;
}
describe('automated case and batch controls', () => {
  it('shows Automated, result, actual run time and duration', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true,result:'passed',lastRun:'2026-10-12T11:00:00+00:00',duration:.2}});
    const view=render(RunControls,{source,caseId:'T_Demo_one'});
    await view.findByText('Automated');expect(view.getByText('passed')).toBeTruthy();expect(view.getByText('Duration: 0.2s')).toBeTruthy();expect(view.getByText(/Last ran: 2026/)).toBeTruthy();
  });
  it('keeps a clearly labelled manual recording event', async () => {
    const source=server({T_Demo_one:{automated:false,runnable:false}});const event=vi.fn();document.addEventListener('webdoc:run-test',event,{once:true});
    const view=render(RunControls,{source,caseId:'T_Demo_one'});await view.findByText('Manual');await fireEvent.click(view.getByText('Record manual result'));expect(event).toHaveBeenCalled();expect(view.queryByText('Automated')).toBeNull();
  });
  it('reports unknown real run time without borrowing a feed timestamp', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:false,result:'failed'}});const view=render(RunControls,{source,caseId:'T_Demo_one'});await view.findByText('Last real run unknown');expect((view.getByText('Run now') as HTMLButtonElement).disabled).toBe(true);expect(view.queryByText(/Last ran:/)).toBeNull();
  });
  it.each(['passed','failed'])('shows waiting, running, then %s without reloading and escapes output', async (result) => {
    const source=server({T_Demo_one:{automated:true,runnable:true,result,failure:result==='failed'?'assertion failed':''}},['waiting','running','finished']);
    const view=render(RunControls,{source,caseId:'T_Demo_one'});await view.findByText('Automated');await fireEvent.click(view.getByText('Run now'));
    await waitFor(() => expect(view.container.textContent).toContain('waiting'));await waitFor(() => expect(view.container.textContent).toContain('running'),{timeout:2000});
    await waitFor(() => expect(view.container.textContent).toContain('Last ran: 2026'),{timeout:2500});expect(view.getByText(result)).toBeTruthy();expect(view.getByText('Duration: 0.23s')).toBeTruthy();expect(view.container.querySelector('script')).toBeNull();expect(view.container.querySelector('pre')?.textContent).toContain('<script>');
  });
  it('offers page batch only for configured cases on that page', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true},T_Demo_other:{automated:true,runnable:true},T_Demo_manual:{automated:false,runnable:false}});
    const view=render(RunControls,{source,ids:['T_Demo_one','T_Demo_manual'],scope:'page'});await view.findByText('Run all automated tests on this page');await fireEvent.click(view.getByRole('button'));
    await waitFor(() => expect(sourceRuns(source).runs.length).toBe(1));expect(sourceRuns(source).runs[0].ids).toEqual(['T_Demo_one']);await waitFor(() => expect(sourceRuns(source).runs[0].state).toBe('finished'),{timeout:1500});
  });
  it('offers a source-wide batch including all runnable cases', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true},T_Demo_other:{automated:true,runnable:true}});const view=render(RunControls,{source,scope:'source'});await view.findByText('Run all automated tests for '+source);await fireEvent.click(view.getByRole('button'));await waitFor(() => expect(sourceRuns(source).runs.length).toBe(1));expect(sourceRuns(source).runs[0].ids).toEqual(['T_Demo_one','T_Demo_other']);await waitFor(() => expect(sourceRuns(source).runs[0].state).toBe('finished'),{timeout:1500});
  });
  it('surfaces server refusals and lets the reader retry', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true}});const view=render(RunControls,{source,caseId:'T_Demo_one'});await view.findByText('Run now');vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'Write access required'})})));await fireEvent.click(view.getByText('Run now'));await view.findByRole('alert');expect(view.container.textContent).toContain('Write access required');expect((view.getByText('Run now') as HTMLButtonElement).disabled).toBe(false);
  });
  it('retains the tied test name and escaped output after opening a fresh page', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true,result:'failed',testName:'test_job_fifo',outputTail:'<script>retained output</script>',failure:'retained failure'}});
    const view=render(RunControls,{source,caseId:'T_Demo_one'});await view.findByText('Automated test: test_job_fifo');expect(view.container.querySelector('pre')?.textContent).toContain('retained output');expect(view.container.querySelector('script')).toBeNull();
  });
  it('the real TestCase island contains the new controls and page batch', async () => {
    const source=server({T_Demo_one:{automated:true,runnable:true,result:'passed'}});const rec={id:'T_Demo_one',docId:source+'/tests',component:'Demo',key:'one',name:'One described test',steps:[{action:'Run it',expected:'It passes'}],verifies:[],verifiesRaw:[]};const block={kind:'test' as const,rec,error:null};groupsByDoc.set(rec.docId,[block]);
    const view=render(TestCase,{block});await view.findByText('Automated');expect(view.getByText('Run all automated tests on this page')).toBeTruthy();expect(view.getByText('Action')).toBeTruthy();expect(view.getByText('Expected response')).toBeTruthy();
  });
});
