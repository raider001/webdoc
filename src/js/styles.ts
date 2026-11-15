// Optional mode styles load once, and callers await them before showing that UI.
const pending = new Map<string, Promise<void>>();
export function loadStylesheet(href: string): Promise<void> {
  const existing = pending.get(href);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove(); pending.delete(href);
      reject(new Error('Could not load the mode stylesheet.'));
    };
    document.head.appendChild(link);
  });
  pending.set(href, promise);
  return promise;
}
