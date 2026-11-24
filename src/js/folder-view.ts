// folder-view.ts - show a folder's GENERATED page in the reading view.
//
// The router (main.ts) comes here when a route names a folder that has no page
// file of its own. A folder WITH a page file is just that document, rendered by
// reader.ts like any other; see folders.ts for which file that is.
//
// This mirrors main.ts's showRestricted: the article is replaced by a mounted
// component, so it goes through the same teardown registry, and the chrome
// around it (breadcrumb, TOC, footer, Edit/Delete) is reset so nothing from the
// previous page lingers.
import { elem } from './dom.js';
import { state, el, mustEl, app } from './app-shell.js';
import { teardownMounted, registerMounted } from './reader.js';
import { loadIslands } from './islands.js';
import { announce } from './announce.js';
import { auth } from './auth.js';

import type { FolderInfo } from './folders.js';

/**
 * Replace the article with the folder's generated page. `isCurrent` is the
 * router's staleness check: loading the island is a dynamic import, and a reader
 * who has navigated on in the meantime must not have this page drawn over theirs.
 * Returns false when it gave way to a newer route.
 */
export async function showFolderPage(info: FolderInfo, isCurrent: () => boolean, opts: { preserveScroll?: boolean } = {}): Promise<boolean> {
  const islands = await loadIslands();
  if (!isCurrent()) return false;
  state.current = null;
  state.folder = info.path;
  // Nothing on a generated page can be edited or deleted - it is not a file.
  // Writing one is offered on the page itself instead.
  mustEl('editBtn').hidden = true;
  mustEl('deleteBtn').hidden = true;

  const content = mustEl('content');
  const scroll = opts.preserveScroll ? content.scrollTop : 0;
  teardownMounted(content);
  content.textContent = '';
  const host = elem('div', 'wd-mounted');
  content.appendChild(host);
  const instance = islands.mountFolderPage(host, info, {
    canWrite: auth.canWrite,
    onCreatePage: () => app.createFolderPage ? app.createFolderPage(info.path) : Promise.resolve(),
  });
  registerMounted(host, instance.destroy);

  if (app.setDocChrome) app.setDocChrome(info.path, [], [], []);   // also flushes the mount above
  mustEl('footPrev').hidden = true;
  mustEl('footNext').hidden = true;
  const tocPane = el('toc');
  if (tocPane) tocPane.hidden = true;
  document.title = info.title + ' — ' + ((state.site && state.site.siteTitle) || 'Documentation');
  if (app.setTreeActive) app.setTreeActive(info.path);
  if (opts.preserveScroll) content.scrollTop = scroll;
  else { content.scrollTop = 0; content.focus({ preventScroll: true }); announce('Loaded: ' + info.title); }
  return true;
}
