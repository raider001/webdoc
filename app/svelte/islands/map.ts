// islands/map.ts - the document map's mount surface, plus the one way the
// vanilla shell pushes data into it.
//
// IT RETURNS A HANDLE, AND app/js/map-view.js MUST KEEP IT. This is the opposite
// of islands/tree.ts's mount-once islands: a map left mounted while hidden keeps
// a requestAnimationFrame loop alive and keeps window.__graph pointing at a graph
// nobody can see, which is precisely the "two canvas views at once" failure
// tests/test_map_ui.py exists to catch. So the shell mounts on open and destroys
// on close, exactly as islands/coverage.ts's overlay does.
//
// THE TARGET is the STAGE div app/js/overlays.js created inside #graphOverlay at
// boot. That host exists from first paint precisely so the module filling it can
// load late, which means this island needs no ordering against boot() at all.
//
// setMapModel is re-exported rather than reimplemented: the model is fetched by
// the vanilla shell (a module that has not loaded cannot be asked to fetch
// anything, and app/js/overlays.js's requestMapRebuild is what decides a rebuild
// is worth paying for), and this is the door it comes in by.
import { mount, unmount } from 'svelte';
import MapOverlay from '../MapOverlay.svelte';
import { forgetMapEditMode } from '../stores/map.svelte.js';

export { setMapModel } from '../stores/map.svelte.js';

export interface MapOverlayOpts {
  /** close the whole overlay (Escape, or a double-click that opens a document) */
  onClose: () => void;
  /** refetch the server graph model and relayout, after an edit-connections write */
  onRebuild: (animate?: boolean) => Promise<void>;
}

/**
 * The document map.
 * @param target - the stage div inside #graphOverlay
 */
export function mountMapOverlay(target: Element, opts: MapOverlayOpts): { destroy: () => void } {
  const instance = mount(MapOverlay, {
    target: target,
    props: {
      onClose: opts.onClose,
      onRebuild: opts.onRebuild,
    },
  });
  return {
    destroy: () => {
      unmount(instance);
      // Unmounting is what "the map was closed" MEANS, so the one piece of state
      // that must not survive a close is dropped here rather than by the shell.
      // Ordered after the unmount on purpose: MapOverlay's teardown harvests the
      // outgoing controller's state, edit mode included, and this is the answer
      // to it.
      forgetMapEditMode();
    },
  };
}
