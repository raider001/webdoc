import type { SiteConfig } from './catalog.js';
import { projectUrl } from './project-navigation.js';
import { elem } from './dom.js';

/** Counts come from each project's own index, without changing the active API scope. */
async function pageCount(name: string, label: HTMLElement): Promise<void> {
  try {
    while (label.isConnected) {
      const response = await fetch('/api/index/status?project=' + encodeURIComponent(name), { cache: 'no-cache' });
      if (!response.ok) throw new Error('Count unavailable');
      const status = await response.json();
      if (status.state === 'ready') {
        label.textContent = status.docs + (status.docs === 1 ? ' page' : ' pages');
        return;
      }
      if (status.state === 'error') break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch { /* Cards remain usable if an index is unavailable. */ }
  label.textContent = 'Page count unavailable';
}

export function renderProjectStart(site: SiteConfig): void {
  document.body.classList.add('is-project-start');
  document.title = site.siteTitle || 'Documentation';
  const content = document.getElementById('content')!;
  content.replaceChildren();
  const section = elem('section', 'project-start');
  section.setAttribute('aria-labelledby', 'projectsHeading');
  const heading = elem('h1', '', site.siteTitle || 'Documentation');
  heading.id = 'projectsHeading'; section.appendChild(heading);
  section.appendChild(elem('p', 'project-intro', 'Choose a project to open its documentation.'));
  const cards = elem('div', 'project-cards');
  for (const project of site.projects || []) {
    const card = document.createElement('a');
    card.className = 'project-card';
    card.href = projectUrl(location.href, project, site.legacy);
    card.appendChild(elem('h2', '', project.title));
    card.appendChild(elem('p', 'project-name', project.name));
    if (project.description) card.appendChild(elem('p', 'project-description', project.description));
    const count = elem('p', 'project-page-count', 'Counting pages…');
    card.appendChild(count); cards.appendChild(card);
  }
  section.appendChild(cards); content.appendChild(section);
  [...cards.querySelectorAll<HTMLElement>('.project-page-count')].forEach((label, index) => {
    void pageCount(site.projects![index].name, label);
  });
}
