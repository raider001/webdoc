// Project identity is in the page URL, so separate tabs remain independent.
let activeProject: string | null = null;
export function setActiveProject(name: string | null): void { activeProject = name; }
export function projectFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, location.origin);
  if (activeProject) url.searchParams.set('project', activeProject);
  return fetch(url.pathname + url.search, init);
}
