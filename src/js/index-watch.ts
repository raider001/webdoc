import { projectFetch } from './project.js';
export interface IndexVersion { state?: string; generation?: number; version?: string; }

/** One shared status check for navigation/timer, and at most one refresh in flight. */
export function createIndexWatcher(onChange: () => Promise<void>) {
  let previous: string | undefined;
  let pending: Promise<void> | null = null;
  async function observe(status: IndexVersion): Promise<void> {
    if (status.state !== 'ready' || typeof status.generation !== 'number') return;
    const version = status.version || String(status.generation);
    if (previous === undefined) { previous = version; return; }
    if (previous === version) return;
    previous = version;
    await onChange();
  }
  function check(): Promise<void> {
    if (pending) return pending;
    pending = (async () => {
      const response = await projectFetch('/api/index/status', { cache: 'no-cache', credentials: 'same-origin' });
      if (response.ok) await observe(await response.json());
    })().finally(() => { pending = null; });
    return pending;
  }
  return { check, observe };
}
