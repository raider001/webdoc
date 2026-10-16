import { mapOpen } from './overlays.js';

const KEY = 'wd-map-split';
let enabled = false;
try { enabled = localStorage.getItem(KEY) === 'true'; } catch { /* storage can be disabled */ }

export function applySplitView(open = mapOpen()): void {
  document.body.classList.toggle('is-map-split', enabled && open);
  document.getElementById('splitBtn')?.setAttribute('aria-pressed', String(enabled));
  const divider = document.getElementById('mapDivider');
  if (divider) divider.hidden = !(enabled && open);
}

export function setupSplitView(): void {
  const btn = document.getElementById('splitBtn');
  const divider = document.createElement('div');
  divider.id = 'mapDivider'; divider.hidden = true; divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize document and map');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-valuemin', '25'); divider.setAttribute('aria-valuemax', '75');
  let width = 50;
  const resize = (value: number) => {
    width = Math.max(25, Math.min(75, value));
    document.body.style.setProperty('--split-reader', width + 'vw');
    divider.setAttribute('aria-valuenow', String(Math.round(width)));
  };
  resize(width);
  document.body.appendChild(divider);
  divider.addEventListener('pointerdown', event => {
    event.preventDefault(); divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener('pointermove', event => {
    if (divider.hasPointerCapture(event.pointerId)) resize(event.clientX / innerWidth * 100);
  });
  divider.addEventListener('pointerup', event => {
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  });
  divider.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); resize(width + (event.key === 'ArrowRight' ? 2 : -2));
    }
  });
  btn?.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(KEY, String(enabled)); } catch { /* preference is optional */ }
    applySplitView();
    if (enabled && !mapOpen()) document.getElementById('graphBtn')?.click();
  });
  applySplitView();
}
