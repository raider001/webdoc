// plugins.js - tolerant loader for renderer plugins (core, zero third-party).
// ---------------------------------------------------------------------------
// Reads the optional "plugins" list from site config and dynamically imports
// each one from ../thirdpartyrenderer/<name>.js. A plugin module registers its
// renderer(s) with blocks.js as an import side effect (it is the facade around
// a bring-your-own third-party library).
//
// Loading is deliberately fault-tolerant: a missing or broken plugin file, or a
// plugin whose library is not installed, is logged and skipped. Nothing here can
// stop the application from booting - a default install ships no plugins and
// behaves exactly as it did before this module existed.
// ---------------------------------------------------------------------------

export async function loadPlugins(names) {
  if (!Array.isArray(names) || !names.length) return [];
  const loaded = [];
  for (const raw of names) {
    const name = String(raw || '').replace(/[^\w-]/g, ''); // plugin ids are bare file stems
    if (!name) continue;
    try {
      await import(`../thirdpartyrenderer/${name}.js`);
      loaded.push(name);
    } catch (e) {
      console.warn(`[plugins] renderer plugin "${name}" could not be loaded — skipping.`,
                   (e && e.message) || e);
    }
  }
  return loaded;
}
