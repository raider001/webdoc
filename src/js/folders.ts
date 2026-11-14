// folders.ts - the SERVER CONTRACT for folder pages.
//
// Every folder in a source is a page, addressed by its own path (#/Docs/how-to).
// The server decides what that page is - see webdoc_index.Index._level:
//   1. a sibling document with the folder's own path (how-to.md beside how-to/),
//   2. else an index.md inside the folder,
//   3. else a README.md inside it,
//   4. else nothing, and the app GENERATES a page listing the folder's contents.
// This module is only the fetch; folder-view.ts decides how to show the answer.
import { projectFetch } from './project.js';

/** A document listed on a folder page. */
export interface FolderDoc {
  id: string;
  title: string;
  /** withheld (empty) when the document is locked for this reader */
  description: string;
  locked?: boolean;
}

/** A sub-folder listed on a folder page. */
export interface FolderChild {
  name: string;
  path: string;
  /** the sub-folder's page title, or its prettified name */
  title: string;
  description: string;
  /** id of the document that is the sub-folder's page, if it has one */
  page: string | null;
  /** how many documents this reader can see anywhere beneath it */
  docs: number;
}

/** GET /api/index/folder?path= - one folder, as its page needs it. */
export interface FolderInfo {
  path: string;
  name: string;
  title: string;
  /** the document that is this folder's page, or null for a generated page */
  page: FolderDoc | null;
  folders: FolderChild[];
  docs: FolderDoc[];
}

/**
 * Fetch one folder. Resolves null when there is no such folder for this reader -
 * the server answers a folder of hidden pages exactly like a missing one. Any
 * other failure throws, so the router can report it instead of claiming the
 * folder does not exist.
 */
export async function fetchFolder(path: string): Promise<FolderInfo | null> {
  const res = await projectFetch('/api/index/folder?path=' + encodeURIComponent(path), { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Could not load the folder (' + res.status + ')');
  return res.json();
}

/**
 * The id a NEW page for this folder is written to: the sibling file
 * (`Docs/how-to` -> how-to.md beside the folder), so the page's id is the folder
 * path itself. A source root has no sibling - it would sit outside the source -
 * so its page is `index.md` inside it.
 */
export function newFolderPageId(path: string): string {
  return path.includes('/') ? path : path + '/index';
}
