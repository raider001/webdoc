import type { SiteConfig, ProjectSummary } from './catalog.js';

/** A page bookmark wins over the splash; an explicit project wins over source inference. */
export function projectRoute(site: SiteConfig, search: string, hash: string): { project: string | null; startPage: boolean } {
  const params = new URLSearchParams(search);
  const requested = params.get('project');
  const page = hash.startsWith('#/') ? hash.slice(2).split('?')[0] : '';
  let source = '';
  try { source = decodeURIComponent(page).split('/')[0]; } catch { /* invalid bookmark stays unresolved */ }
  const startPage = !requested && !page &&
    (params.get('view') === 'projects' || (!site.legacy && (site.projects?.length || 0) > 1));
  return { startPage, project: startPage ? null : requested ||
    site.projects?.find(p => p.sources.includes(source))?.name || site.project || null };
}

export function projectUrl(href: string, project: ProjectSummary | null, legacy = false, count = 2): string {
  const url = new URL(href);
  url.searchParams.delete('view');
  url.searchParams.delete('project');
  url.hash = project?.defaultDoc ? '#/' + project.defaultDoc : '';
  if (project && !legacy) url.searchParams.set('project', project.name);
  if (!project && count < 2) url.searchParams.set('view', 'projects');
  return url.href;
}

export function projectMenuModel(projects: ProjectSummary[], current: string | null) {
  return [...projects.map(project => ({ label: project.title, project, current: project.name === current })),
    { label: 'All projects', project: null, current: current === null }];
}

export function menuIndex(key: string, index: number, length: number): number {
  if (!length) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowUp') return (index - 1 + length) % length;
  return index;
}
