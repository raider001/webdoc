/**
 * Dynamically import each named renderer plugin from
 * ../thirdpartyrenderer/<name>.js, tolerating any that are missing or throw.
 * A plugin module registers its renderer(s) with blocks.js (registerBlockRenderer)
 * as an import side effect.
 * @param names - plugin ids (bare file stems, from site config's "plugins" list)
 * @returns the sanitized ids (from `names`) that loaded successfully
 */
export declare function loadPlugins(names: string[]): Promise<string[]>;
