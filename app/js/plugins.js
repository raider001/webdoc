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
/**
 * Dynamically import each named renderer plugin from
 * ../thirdpartyrenderer/<name>.js, tolerating any that are missing or throw.
 * A plugin module registers its renderer(s) with blocks.js (registerBlockRenderer)
 * as an import side effect.
 * @param {string[]} names - plugin ids (bare file stems, from site config's "plugins" list)
 * @returns {Promise<string[]>} the sanitized ids (from `names`) that loaded successfully
 */
export async function loadPlugins(names) {
    if (!Array.isArray(names) || !names.length)
        return [];
    const loaded = [];
    for (const raw of names) {
        const name = String(raw || '').replace(/[^\w-]/g, ''); // plugin ids are bare file stems
        if (!name)
            continue;
        try {
            await import(`../thirdpartyrenderer/${name}.js`);
            loaded.push(name);
        }
        catch (e) {
            console.warn(`[plugins] renderer plugin "${name}" could not be loaded — skipping.`, (e && e.message) || e);
        }
    }
    return loaded;
}
