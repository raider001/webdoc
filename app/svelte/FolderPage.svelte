<!--
  The page WebDocs generates for a folder that has no page of its own.

  A folder is reachable at its own path (#/Docs/features). When there is a page
  file for it - a sibling features.md, or an index.md / README.md inside it - the
  router renders that document instead and this component is never mounted. So
  everything here is derived from the folder's contents alone: what is in it,
  each entry's title and description, and how much sits beneath each sub-folder.

  Every string shown is author- or filesystem-supplied (titles, descriptions,
  folder names) and is rendered as text. Links are plain #/ hrefs, so the router's
  hashchange handler does the navigation exactly as it does for an in-body link.

  It renders as an `article.doc` so it inherits the reading view's typography,
  and so the shell's in-page find finds an article to search.
-->
<script lang="ts">
  import { folderIcon, pageIcon, lockIcon, plusIcon } from '/js/icons.js';
  import type { FolderInfo } from '/js/folders.js';
  import { icon } from './actions/icon.js';

  interface Props {
    info: FolderInfo;
    /** offer to write a page for this folder (the server re-checks the write) */
    canWrite?: boolean;
    onCreatePage?: () => void;
  }

  let { info, canWrite = false, onCreatePage }: Props = $props();

  const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);

  // One text node, so the lede reads the same to a screen reader as it looks.
  const summary = $derived([
    info.folders.length ? plural(info.folders.length, 'folder', 'folders') : '',
    info.docs.length ? plural(info.docs.length, 'page', 'pages') : '',
  ].filter(Boolean).join(' · ') || 'This folder is empty.');
</script>

<article class="doc folder-page" data-folder={info.path}>
  <h1>{info.title}</h1>
  <p class="doc-lede">{summary}</p>

  {#if canWrite && onCreatePage}
    <div class="folder-page-write">
      <button type="button" class="btn" onclick={onCreatePage}>
        <span class="folder-page-btn-icon" use:icon={plusIcon}></span>Write a page for this folder
      </button>
      <span class="folder-page-hint">This page is generated from the folder's contents until one is written.</span>
    </div>
  {/if}

  {#if info.folders.length}
    <h2>Folders</h2>
    <ul class="folder-entries">
      {#each info.folders as child (child.path)}
        <li>
          <a class="folder-entry is-folder" href="#/{child.path}" data-path={child.path}>
            <span class="folder-entry-icon" use:icon={folderIcon}></span>
            <span class="folder-entry-text">
              <span class="folder-entry-title">{child.title}</span>
              {#if child.description}<span class="folder-entry-desc">{child.description}</span>{/if}
            </span>
            <span class="folder-entry-count">{plural(child.docs, 'page', 'pages')}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if info.docs.length}
    <h2>Pages</h2>
    <ul class="folder-entries">
      {#each info.docs as doc (doc.id)}
        <li>
          <a class="folder-entry" class:is-locked={doc.locked} href="#/{doc.id}" data-id={doc.id}
             title={doc.locked ? 'Restricted - your account cannot open this page' : undefined}>
            <span class="folder-entry-icon" use:icon={doc.locked ? lockIcon : pageIcon}></span>
            <span class="folder-entry-text">
              <span class="folder-entry-title">{doc.title}</span>
              {#if doc.description}<span class="folder-entry-desc">{doc.description}</span>{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</article>
