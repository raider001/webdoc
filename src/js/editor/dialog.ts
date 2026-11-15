import { elem } from '../dom.js';
let nextId = 0;

/** Native modal supplies inert background and focus containment. All exits restore focus. */
export function openDialog(title: string, content: HTMLElement, options: {
  initial?: HTMLElement; onSubmit?: () => void; onClose?: () => void; restore?: () => void;
} = {}) {
  const previous = document.activeElement as HTMLElement | null;
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const heading = elem('h2', { id: 'editor-dialog-' + ++nextId }, title);
  const form = elem('form', { method: 'dialog' }, heading, content);
  const dialog = elem('dialog', { class: 'modal editor-dialog', 'aria-labelledby': heading.id }, form);
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    if (range?.startContainer.isConnected && selection) { selection.removeAllRanges(); selection.addRange(range); }
    options.restore?.(); options.onClose?.();
  }
  form.addEventListener('submit', e => { e.preventDefault(); options.onSubmit?.(); });
  dialog.addEventListener('cancel', e => { e.preventDefault(); e.stopPropagation(); close(); });
  dialog.addEventListener('close', close);
  // Do not dismiss on a backdrop click: dragging a text selection out is harmless.
  dialog.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key !== 'Tab') return;
    const fields = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    const first = fields[0], last = fields.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
  document.body.append(dialog); dialog.showModal();
  (options.initial || form.querySelector<HTMLElement>('input,button,select,textarea'))?.focus();
  return { element: dialog, form, close };
}
