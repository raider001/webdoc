export function color(node: HTMLElement, value: string) {
  node.style.setProperty('background', value);
  return { update(next: string) { node.style.setProperty('background', next); } };
}
