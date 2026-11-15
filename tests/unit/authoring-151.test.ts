import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const graph = vi.hoisted(() => vi.fn());
vi.mock('/js/graph-model.js', async original => ({ ...await original<typeof import('/js/graph-model.js')>(), ensureGraphModel: graph }));
vi.mock('/js/catalog.js', async original => ({ ...await original<typeof import('/js/catalog.js')>(), loadDoc: vi.fn().mockResolvedValue(undefined) }));
vi.mock('/js/auth.js', async original => ({ ...await original<typeof import('/js/auth.js')>(), docAccess: vi.fn().mockResolvedValue(null) }));
// jsdom does not fetch linked CSS; sheet load/failure is covered by lazy-editor-154e.
vi.mock('/js/styles.js', () => ({ loadStylesheet: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  vi.resetModules(); graph.mockReset(); graph.mockResolvedValue({ docs: [] });
  document.body.innerHTML = '<button id="newDocBtn"></button><button id="editBtn"></button><button id="deleteBtn"></button><div class="app-body"><main id="content">Reader stays here</main></div>';
  document.body.classList.remove('is-editing'); history.replaceState(null, '', '#/Docs/example');
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { document.body.replaceChildren(); document.body.classList.remove('is-editing'); await Promise.resolve(); });
async function setup() {
  const { state } = await import('/js/app-shell.js');
  state.current = { id: 'Docs/example', source: 'Docs', rel: 'example.md', url: '/docs/Docs/example.md', name: 'example.md', body: '# Example\n\nAlpha', meta: { title: 'Example' }, title: 'Example' };
  const authoring = await import('/js/authoring.js'); authoring.setupEditButtons();
  document.getElementById('editBtn')!.click(); return authoring;
}
it('restores a changed hash while dirty, cancels safely, and removes the old editor before approved navigation', async () => {
  const authoring = await setup(); await vi.waitFor(() => expect(document.querySelector('.editor')).toBeTruthy());
  const field = document.querySelector<HTMLElement>('.blk-paragraph [contenteditable]')!;
  field.innerHTML = 'Unsaved'; field.dispatchEvent(new Event('input', { bubbles: true }));
  history.replaceState(null, '', '#/Docs/other');
  const refused = authoring.guardEditorRoute('#/Docs/other');
  expect(location.hash).toBe('#/Docs/example');
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('dialog button[type="button"]')!.click(); expect(await refused).toBe(false);
  expect(field.isConnected).toBe(true); expect(field.textContent).toBe('Unsaved');
  const accepted = authoring.guardEditorRoute('#/Docs/other'); await vi.waitFor(() => expect(document.querySelector('dialog')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click(); expect(await accepted).toBe(true);
  expect(location.hash).toBe('#/Docs/other'); expect(document.querySelector('.editor')).toBeNull(); expect(document.body.classList.contains('is-editing')).toBe(false);
});
it('keeps the reader visible during first-open loading and abandons a mount if navigation wins the race', async () => {
  let release!: (value: { docs: [] }) => void; graph.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await setup(); await vi.waitFor(() => expect(graph).toHaveBeenCalled());
  expect(document.body.classList.contains('is-editing')).toBe(false); expect(document.getElementById('content')!.textContent).toBe('Reader stays here');
  history.replaceState(null, '', '#/Docs/other'); release({ docs: [] });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(document.querySelector('.editor')).toBeNull(); expect(document.body.classList.contains('is-editing')).toBe(false);
});

it('guards project/start-page exits without changing the URL and removes the editor only after Discard', async () => {
  const authoring = await setup(); await vi.waitFor(() => expect(document.querySelector('.editor')).toBeTruthy());
  const field = document.querySelector<HTMLElement>('.blk-paragraph [contenteditable]')!;
  field.innerHTML = 'Unsaved project draft'; field.dispatchEvent(new Event('input', { bubbles: true }));
  const url = location.href;
  const refused = authoring.guardEditorLeave();
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('dialog button[type="button"]')!.click();
  expect(await refused).toBe(false);
  expect(location.href).toBe(url); expect(field.isConnected).toBe(true);
  const accepted = authoring.guardEditorLeave();
  await vi.waitFor(() => expect(document.querySelector('dialog')).toBeTruthy());
  document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click();
  expect(await accepted).toBe(true);
  expect(location.href).toBe(url); expect(document.querySelector('.editor')).toBeNull();
});
