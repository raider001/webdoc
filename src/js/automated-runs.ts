import { apiFetch } from './auth.js';
import { state } from './app-shell.js';
import { loadResults, combinedStatus } from './coverage.js';
import { requirementList, testList, setCoverageStatus } from './requirements.js';
export interface RunCaseInfo { automated: boolean; runnable: boolean; testName?: string; result?: string; lastRun?: string | null; duration?: string | number; failure?: string; outputTail?: string; startedBy?: string; }
export interface RunStatus { id: string; ids: string[]; state: string; output: string; error?: string; cases: Record<string, RunCaseInfo>; duration: number; }
export interface SourceRuns { cases: Record<string, RunCaseInfo>; runs: RunStatus[]; error: string; }
const stores = new Map<string, SourceRuns>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
export function sourceRuns(source: string): SourceRuns {
  if (!stores.has(source)) stores.set(source, { cases: {}, runs: [], error: '' });
  return stores.get(source)!;
}
function notify(): void { for (const fn of listeners) fn(); }
export function watchRuns(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
async function json(url: string, opts?: Parameters<typeof apiFetch>[1]): Promise<any> {
  const response = await apiFetch(url, opts); const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Test runner unavailable');
  return data;
}
export function loadRunCases(source: string, force = false): Promise<void> {
  if (!force && loading.has(source)) return loading.get(source)!;
  const task = (async () => {
    try { const reply = await json('/api/runs?source=' + encodeURIComponent(source)); if (!reply.cases || typeof reply.cases !== 'object') throw new Error('Test runner catalog unavailable'); sourceRuns(source).cases = reply.cases; sourceRuns(source).error = ''; }
    catch (e) { sourceRuns(source).error = String(e instanceof Error ? e.message : e); }
    notify();
  })();
  loading.set(source, task); void task.finally(() => { if (loading.get(source) === task) loading.delete(source); }); return task;
}
export async function startRun(source: string, ids: string[]): Promise<void> {
  const store = sourceRuns(source);
  let run: RunStatus | undefined;
  try {
    const accepted = await json('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WebDoc-Run': '1' }, body: JSON.stringify({ source, ids }) });
    const currentRun: RunStatus = { ...accepted, ids, output: '', cases: {}, duration: 0 }; run = currentRun;
    store.runs.push(currentRun); if (store.runs.length > 32) store.runs.shift(); notify();
    while (currentRun.state !== 'finished') {
      await new Promise(resolve => window.setTimeout(resolve, 350));
      const next: RunStatus = await json('/api/runs/' + accepted.id);
      Object.assign(currentRun, next); notify();
    }
    for (const [id, result] of Object.entries(currentRun.cases)) store.cases[id] = { ...store.cases[id], ...result };
    store.error = currentRun.error || ''; notify();
    await loadRunCases(source, true); store.error = currentRun.error || store.error; notify();
    const results = await loadResults(state.site?.sources ?? []);
    setCoverageStatus(combinedStatus(requirementList(), testList(), results));
    document.dispatchEvent(new window.CustomEvent('webdoc:automated-finished'));
  } catch (e) { store.error = String(e instanceof Error ? e.message : e); if (run) { run.state = 'finished'; run.error = store.error; } notify(); }
}
