import type { SiteConfig } from './catalog.js';
import { menuIndex, projectMenuModel, projectUrl } from './project-navigation.js';

export function setupProjectMenu(site: SiteConfig, guard: () => Promise<boolean>, go = (url: string) => location.assign(url)): void {
  const button = document.getElementById('brand') as HTMLButtonElement;
  const menu = document.getElementById('projectMenu')!;
  const projects = site.projects || [];
  const current = site.startPage ? null : site.project || null;
  const title = projects.find(p => p.name === current)?.title || site.siteTitle || 'Documentation';
  button.textContent = title;
  button.title = title + ' — switch project';
  button.setAttribute('aria-label', title + ' — switch project');
  const close = (restore = true) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restore) button.focus();
  };
  const items = projectMenuModel(projects, current).map(entry => {
    const item = document.createElement('button');
    item.type = 'button'; item.tabIndex = -1;
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label;
    if (entry.current) {
      item.setAttribute('aria-current', 'true');
      const mark = document.createElement('span');
      mark.className = 'project-current'; mark.textContent = 'Current';
      item.appendChild(mark);
    }
    item.addEventListener('click', async () => {
      close();
      if (await guard()) go(projectUrl(location.href, entry.project, site.legacy, projects.length));
      else button.focus();
    });
    menu.appendChild(item);
    return item;
  });
  const open = (last = false) => {
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    items[last ? items.length - 1 : Math.max(0, projects.findIndex(p => p.name === current))]?.focus();
  };
  button.addEventListener('click', () => menu.hidden ? open() : close());
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); open(event.key === 'ArrowUp');
    } else if (event.key === 'Escape') close();
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      items[menuIndex(event.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length)]?.focus();
    } else if (event.key === 'Tab') close(false);
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) close(false);
  });
  document.addEventListener('focusin', event => {
    if (!menu.hidden && !menu.contains(event.target as Node) && event.target !== button) close(false);
  });
}
