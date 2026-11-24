import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadStylesheet } from '/js/styles.js';

afterEach(() => document.querySelectorAll('link[data-test-154e]').forEach(node => node.remove()));

describe('editor stylesheet boundary', () => {
  it('the complete static reader bundle contains no editor action or run controls', () => {
    const seen = new Set<string>();
    function collect(path: string): string {
      if (seen.has(path)) return '';
      seen.add(path);
      const source = readFileSync(path, 'utf8');
      return source + [...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)]
        .map(match => collect(resolve(dirname(path), match[1]))).join('\n');
    }
    const reader = collect(resolve('app/build/islands.js'));
    expect(reader).not.toContain('/js/editor.js');
    expect(reader).not.toContain('/js/automated-runs.js');
    expect(reader).not.toContain('app/svelte/actions/richtext.ts');
    expect(reader).not.toContain('Record manual result');
  });
  it('waits for a real load and shares the request across concurrent actions', async () => {
    const href = '/css/editor.css?load-154e';
    let ready = false;
    const first = loadStylesheet(href);
    expect(loadStylesheet(href)).toBe(first);
    first.then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    const links = document.querySelectorAll<HTMLLinkElement>(`link[href="${href}"]`);
    expect(links).toHaveLength(1);
    links[0].dataset.test154e = '1';
    links[0].dispatchEvent(new Event('load'));
    await first;
    expect(ready).toBe(true);
  });

  it('refuses an unstyled editor and permits a later retry after a failed fetch', async () => {
    const href = '/css/editor.css?retry-154e';
    const first = loadStylesheet(href);
    const failed = expect(first).rejects.toThrow('Could not load the mode stylesheet.');
    document.querySelector<HTMLLinkElement>(`link[href="${href}"]`)!.dispatchEvent(new Event('error'));
    await failed;
    expect(document.querySelector(`link[href="${href}"]`)).toBeNull();
    const retry = loadStylesheet(href);
    expect(retry).not.toBe(first);
    const link = document.querySelector<HTMLLinkElement>(`link[href="${href}"]`)!;
    link.dataset.test154e = '1'; link.dispatchEvent(new Event('load'));
    await retry;
  });

  it('the reader shell fetches no editor sheet, and private shell buttons retain their layout', () => {
    const shell = new DOMParser().parseFromString(readFileSync('app/index.html', 'utf8'), 'text/html');
    expect([...shell.querySelectorAll('link[rel=stylesheet]')].map(link => link.getAttribute('href'))).not.toContain('/css/editor.css');
    expect(readFileSync('app/css/coverage.css', 'utf8')).not.toMatch(/\.runner-|\.run-grid|\.tc-run/);
    expect(readFileSync('app/build/islands.css', 'utf8')).not.toContain('automated-run-controls');
    expect(readFileSync('app/build/islands.css', 'utf8')).not.toContain('cov-run-sources');
    const style = document.createElement('style');
    style.textContent = readFileSync('app/css/app.css', 'utf8'); document.head.append(style);
    const button = shell.getElementById('editBtn')!; document.body.append(button);
    try {
      expect(getComputedStyle(button).display).toBe('none');
      button.hidden = false;
      expect(getComputedStyle(button).display).toBe('inline-flex');
      expect(getComputedStyle(button).position).toBe('absolute');
    } finally { button.remove(); style.remove(); }
  });
});
