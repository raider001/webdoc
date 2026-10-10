interface Locator { id: string; tag: string; text: string; index: number; }
function locate(element: Element, root: Element): Locator {
  const tag = element.tagName, text = element.textContent || '';
  return { id: element.id, tag, text, index: [...root.querySelectorAll(tag)].filter(node => node.textContent === text).indexOf(element) };
}
function find(locator: Locator, root: Element): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(locator.tag)].find(node => locator.id && node.id === locator.id) ||
    [...root.querySelectorAll<HTMLElement>(locator.tag)].filter(node => node.textContent === locator.text)[locator.index];
}
function path(node: Node, root: Node): number[] {
  const indices: number[] = [];
  while (node !== root && node.parentNode) { indices.unshift([...node.parentNode.childNodes].indexOf(node as ChildNode)); node = node.parentNode; }
  return indices;
}
function follow(root: Node, indices: number[]): Node | undefined {
  let node: Node | undefined = root; for (const index of indices) node = node?.childNodes[index]; return node;
}
/** Capture immediately before a synchronous swap, not before the network await. */
export function captureReadingPosition(pane: HTMLElement, toc: HTMLElement): (article: HTMLElement) => void {
  const oldArticle = pane.querySelector<HTMLElement>('article')!;
  const scrollTop = pane.scrollTop, scrollLeft = pane.scrollLeft, viewport = pane.getBoundingClientRect();
  const anchors = [...oldArticle.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,table,pre,.wd-widget')]
    .filter(node => !node.closest('.wd-live') && node.getBoundingClientRect().height > 0)
    .map(node => ({ node, offset: node.getBoundingClientRect().top - viewport.top }))
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset)).slice(0, 8)
    .map(({ node, offset }) => ({ locator: locate(node, oldArticle), offset }));
  const active = document.activeElement instanceof HTMLElement && oldArticle.contains(document.activeElement) ? document.activeElement : null;
  const focused = active ? locate(active, oldArticle) : null;
  const inputSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd, active.selectionDirection] as const : null;
  const selection = window.getSelection();
  const endpoints = selection?.anchorNode && selection.focusNode && oldArticle.contains(selection.anchorNode) && oldArticle.contains(selection.focusNode) ?
    [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset] as const : null;
  const textPoints = endpoints ? [endpoints[0], endpoints[2]].map(node => {
    const block = node.parentElement?.closest('p,li,pre,h1,h2,h3,h4,h5,h6') || node.parentElement;
    return block ? { locator: locate(block, oldArticle), path: path(node, block), text: node.textContent } : null;
  }) : null;
  const disclosures = [...oldArticle.querySelectorAll<HTMLDetailsElement>('details')].map(node => ({ node, key: node.closest<HTMLElement>('[data-widget-key]')?.dataset.widgetKey, open: node.open }));
  const tocTarget = toc.querySelector<HTMLElement>('a.active')?.dataset.target;
  return article => {
    disclosures.forEach(item => {
      if (!item.key) return;
      const next = [...article.querySelectorAll<HTMLDetailsElement>('details')].find(node => node.closest<HTMLElement>('[data-widget-key]')?.dataset.widgetKey === item.key);
      if (next) { next.open = item.open; if (next !== item.node) next.dataset.readerOpen = String(item.open); }
    });
    if (focused && active && document.activeElement !== active) {
      const next = active.isConnected ? active : find(focused, article); next?.focus({ preventScroll: true });
      if (inputSelection && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
        try { next.setSelectionRange(inputSelection[0], inputSelection[1], inputSelection[2] || undefined); } catch { /* unsupported input type */ }
      }
    }
    if (endpoints && textPoints) {
      const nodes = textPoints.map((point, index) => {
        const original = endpoints[index * 2] as Node; if (original.isConnected) return original;
        const block = point && find(point.locator, article); const node = block && follow(block, point!.path);
        return node?.textContent === point?.text ? node : null;
      });
      if (nodes[0] && nodes[1]) { try { selection?.setBaseAndExtent(nodes[0], endpoints[1], nodes[1], endpoints[3]); } catch { /* changed text cannot retain a range */ } }
    }
    pane.scrollTop = scrollTop; pane.scrollLeft = scrollLeft;
    for (const anchor of anchors) { const node = find(anchor.locator, article); if (node && node.getBoundingClientRect().height > 0) { pane.scrollTop += node.getBoundingClientRect().top - viewport.top - anchor.offset; break; } }
    if (tocTarget) { toc.querySelectorAll('a.active').forEach(node => node.classList.remove('active')); [...toc.querySelectorAll<HTMLElement>('a[data-target]')].find(node => node.dataset.target === tocTarget)?.classList.add('active'); }
  };
}
