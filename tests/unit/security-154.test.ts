import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { scrubRendered } from '/js/blocks.js';
import { setReadOnly } from '/js/policy.js';
import { startRun } from '/js/automated-runs.js';
import { connectAutomated, disconnectAutomated, rememberAutoUrl, saveManual } from '/js/coverage.js';
import { generateReportHtml } from '/js/report.js';
import TestCase from '../../app/svelte/TestCase.svelte';
import AutomatedTests from '../../app/svelte/AutomatedTests.svelte';
import VerifyingTests from '../../app/svelte/VerifyingTests.svelte';
import type { TestReportData } from '/js/coverage-view.js';
import type { CoverageResults } from '/js/coverage.js';

afterEach(() => { setReadOnly(false); vi.unstubAllGlobals(); });

describe('browser audit replays 154', () => {
  it('shell hidden controls stay out of layout under the shipped display rules', () => {
    const shell = new DOMParser().parseFromString(readFileSync('app/index.html', 'utf8'), 'text/html');
    const styles = document.createElement('style');
    styles.textContent = ['app', 'editor', 'auth'].map(name => readFileSync(`app/css/${name}.css`, 'utf8')).join('\n');
    document.head.append(styles);
    const controls = ['editBtn', 'deleteBtn', 'newDocBtn', 'accountBtn'].map(id => shell.getElementById(id)!);
    document.body.append(...controls);
    try {
      for (const control of controls) {
        expect(control.hidden).toBe(true);
        expect(getComputedStyle(control).display).toBe('none');
        control.hidden = false;
        expect(getComputedStyle(control).display).not.toBe('none');
      }
    } finally {
      controls.forEach(control => control.remove());
      styles.remove();
    }
  });

  it('removes renderer style, SVG foreignObject, SMIL and obfuscated script URLs', () => {
    const host = document.createElement('div');
    host.innerHTML = `<style>body{display:none}</style><svg xmlns="http://www.w3.org/2000/svg" onload="attack()" style="display:none">
      <foreignObject><div><img src=x onerror=attack()></div></foreignObject>
      <animate attributeName="href" values="javascript:attack()"/><set attributeName="href" to="javascript:attack()"/>
      <g style="fill:red" onclick="attack()"><path d="M0 0L1 1" fill="url(https://attacker.example/x)"/>
      <use href="java&#9;script:attack()"/><use href="#safe"/><use href="https://attacker.example/x"/></g></svg>
      <a href="data:text/html,attack" style="display:none" onclick="attack()">link</a><iframe srcdoc="attack"></iframe>`;
    scrubRendered(host);
    expect(host.querySelector('svg path')?.getAttribute('d')).toBe('M0 0L1 1');
    expect(host.querySelectorAll('style,foreignObject,animate,set,iframe,script')).toHaveLength(0);
    expect(host.querySelectorAll('[style],[onclick],[onload],[onerror]')).toHaveLength(0);
    expect(host.querySelector('path')?.hasAttribute('fill')).toBe(false);
    expect([...host.querySelectorAll('use')].map(el => el.getAttribute('href'))).toEqual([null, '#safe', null]);
    expect(host.querySelector('a')?.hasAttribute('href')).toBe(false);
  });

  it('keeps core widget controls and references attached while stripping hostile attributes', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="wd-live"><button type="button">Refresh</button><table><tbody><tr><td>data</td></tr></tbody></table></div>';
    const button = host.querySelector('button')!;
    const body = host.querySelector('tbody')!;
    const click = vi.fn(); button.addEventListener('click', click);
    scrubRendered(host); button.click();
    expect(click).toHaveBeenCalledOnce(); expect(host.contains(button)).toBe(true); expect(host.contains(body)).toBe(true);
  });

  it('read-only test blocks mount no run controls or automation requests', async () => {
    setReadOnly(true);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const block = { kind: 'test', rec: { id:'T_D_one', component:'D', key:'one', name:'One', docId:'Open/overview', steps:[], verifies:[] } };
    const view = render(TestCase, { block });
    await Promise.resolve();
    expect(view.container.querySelector('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('read-only coverage offers no connect, disconnect, add URL or test link controls', () => {
    setReadOnly(true);
    const results = { manual:{}, auto:{}, autoCatalog:[], autoStore:{}, connections:{} } as unknown as CoverageResults;
    const view=render(AutomatedTests, {id:'T_D_one',results,onReload:vi.fn()});
    expect(view.container.querySelector('input,button')).toBeNull();
    const linked=render(VerifyingTests,{reqId:'R_D_X_1', onOpenTest:vi.fn(), onChanged:vi.fn()});
    expect(linked.container.querySelector('input,.cov-vtest-rm')).toBeNull();
  });

  it('read-only policy blocks programmatic run/record/connect calls before fetch', async () => {
    setReadOnly(true); const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    await startRun('Open',['T_D_one']);
    expect(await saveManual({},[])).toBe(false);
    expect(await connectAutomated('T_D_one',{key:'x',name:'x'},[])).toBe(false);
    expect(await disconnectAutomated('T_D_one',{key:'x',name:'x'},[])).toBe(false);
    expect(await rememberAutoUrl('/report.xml','T_D_one',[])).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloaded report has a restrictive CSP matching its actual stylesheet, no style attributes', () => {
    const report=generateReportHtml({title:'<img src=x onerror=attack()>',requirements:[],tests:[],detail:[],reqStatus:new Map(),testStatus:new Map()} as unknown as TestReportData);
    const doc=new DOMParser().parseFromString(report,'text/html');
    const policy=doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!;
    expect(policy).toContain("default-src 'none'"); expect(policy).toContain("script-src 'none'");
    const css=doc.querySelector('style')!.textContent!;
    expect(policy).toContain("'sha256-"+createHash('sha256').update(css).digest('base64')+"'");
    expect(policy).not.toContain('unsafe-inline'); expect(doc.querySelector('[style],script')).toBeNull();
    expect(doc.querySelector('h1')!.textContent).toContain('<img');
  });

  it('boot gates mutation imports after site policy, and runner/control code is lazy', () => {
    const main=readFileSync('app/js/main.js','utf8');
    expect(main.indexOf('setReadOnly(')).toBeLessThan(main.indexOf("await import('./authoring.js')"));
    expect(main).not.toMatch(/^import .*from ['"]\.\/authoring\.js/m);
    const entry=readFileSync('app/build/islands.js','utf8');
    expect(entry).not.toMatch(/^import .*automated-runs/m);
    expect(entry).not.toContain('Record manual result');
    expect(readFileSync('app/index.html','utf8')).not.toMatch(/\sstyle=/i);
  });
});
