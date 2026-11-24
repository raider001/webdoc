// options.ts - option normalization, safe resource URL resolution, and color helpers.

import { resolveResourceUrl } from '../../js/doclinks.js';

export interface LodEntry {
  label: string;
  url: string;
}

export interface ExternalTextures {
  albedo?: string;
  normal?: string;
  orm?: string;
  emissive?: string;
  teamEmissive?: string;
}

export interface TeamSwatch {
  name: string;
  cssColor: string;
  /** Linear RGB [r, g, b], or [-1, 0, 0] for "default / no recolor". */
  linear: [number, number, number];
}

export type ViewerScene = 'studio' | 'ground' | 'sky' | 'seabed' | 'space';

export const VIEWER_SCENES: readonly ViewerScene[] = ['studio', 'ground', 'sky', 'seabed', 'space'];

export interface ViewerConfig {
  title: string;
  lods: LodEntry[];
  textures: ExternalTextures;
  teamSwatches: TeamSwatch[];
  /** Explicit pixel height override; omitted uses responsive golden ratio (1.618:1). */
  height?: number;
  scene: ViewerScene;
  animate: boolean;
  autoRotate: boolean;
  showFloor: boolean;
  showGrid: boolean;
  hover: number;
  yaw: number;
  pitch: number;
  distance?: number;
}

export const DEFAULT_TEAM_SWATCHES: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Default', color: 'default' },
  { name: 'Ember', color: '#d9481e' },
  { name: 'Alliance Blue', color: '#3878d8' },
  { name: 'Emerald', color: '#38a858' },
  { name: 'Gold', color: '#d8a628' },
];

const EXTERNAL_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Resolve a model or texture path relative to the current document (or as a
 * root-relative `/docs/...` URL). Rejects external URLs and script schemes so
 * the viewer stays strictly same-origin under WebDoc's CSP.
 */
export function resolveAssetUrl(docId: string, raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) throw new Error('Asset path is empty');
  if (EXTERNAL_SCHEME.test(s)) {
    throw new Error('Only same-origin document paths are supported: ' + s);
  }
  if (s.startsWith('/')) {
    if (!s.startsWith('/docs/')) {
      throw new Error('Root-relative asset paths must start with /docs/: ' + s);
    }
    return s;
  }
  const resolved = resolveResourceUrl(docId, s);
  if (!resolved) throw new Error('Could not resolve asset path: ' + s);
  return resolved;
}

function srgbChannelToLinear(c: number): number {
  return Math.pow(Math.max(0, Math.min(1, c)), 2.2);
}

export function hexToLinearRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
}

function parseTeamSwatches(raw: unknown): TeamSwatch[] {
  if (!raw) return [];
  const list = raw === true
    ? DEFAULT_TEAM_SWATCHES
    : Array.isArray(raw)
      ? raw
      : [];
  const out: TeamSwatch[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const isDef = item.toLowerCase() === 'default';
      out.push({
        name: isDef ? 'Default' : item,
        cssColor: isDef ? '#5a6270' : item,
        linear: isDef ? [-1, 0, 0] : hexToLinearRgb(item),
      });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const color = String(obj.color || 'default').trim();
      const isDef = color.toLowerCase() === 'default';
      out.push({
        name: String(obj.name || (isDef ? 'Default' : color)),
        cssColor: isDef ? '#5a6270' : color,
        linear: isDef ? [-1, 0, 0] : hexToLinearRgb(color),
      });
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function parseScene(raw: unknown): ViewerScene {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'ground' || s === 'land' || s === 'terrain') return 'ground';
  if (s === 'sky' || s === 'air' || s === 'clouds') return 'sky';
  if (s === 'seabed' || s === 'sea' || s === 'ocean' || s === 'navy' || s === 'underwater') return 'seabed';
  if (s === 'space' || s === 'orbit' || s === 'orbital') return 'space';
  return 'studio';
}

export function normalizeViewerOptions(
  options: Record<string, unknown>,
  docId: string,
): ViewerConfig {
  const lods: LodEntry[] = [];
  const rawLods = options.lods;

  if (Array.isArray(rawLods)) {
    for (let i = 0; i < rawLods.length; i++) {
      const entry = rawLods[i] as Record<string, unknown> | string;
      if (typeof entry === 'string') {
        lods.push({ label: `LOD${i}`, url: resolveAssetUrl(docId, entry) });
      } else if (entry && typeof entry === 'object' && entry.src) {
        lods.push({
          label: String(entry.label || `LOD${i}`),
          url: resolveAssetUrl(docId, entry.src),
        });
      }
    }
  } else if (rawLods && typeof rawLods === 'object') {
    for (const [label, path] of Object.entries(rawLods as Record<string, unknown>)) {
      if (typeof path === 'string' && path.trim()) {
        lods.push({ label, url: resolveAssetUrl(docId, path) });
      }
    }
  }

  if (typeof options.src === 'string' && options.src.trim()) {
    const primaryUrl = resolveAssetUrl(docId, options.src);
    if (!lods.some(l => l.url === primaryUrl)) {
      lods.unshift({ label: lods.length ? 'Primary' : 'Model', url: primaryUrl });
    }
  }

  if (!lods.length) {
    throw new Error('Provide a "src" (.glb path) or "lods" map');
  }

  const textures: ExternalTextures = {};
  if (options.textures && typeof options.textures === 'object' && !Array.isArray(options.textures)) {
    const t = options.textures as Record<string, unknown>;
    if (typeof t.albedo === 'string' && t.albedo.trim()) textures.albedo = resolveAssetUrl(docId, t.albedo);
    if (typeof t.normal === 'string' && t.normal.trim()) textures.normal = resolveAssetUrl(docId, t.normal);
    if (typeof t.orm === 'string' && t.orm.trim()) textures.orm = resolveAssetUrl(docId, t.orm);
    if (typeof t.emissive === 'string' && t.emissive.trim()) textures.emissive = resolveAssetUrl(docId, t.emissive);
    if (typeof t.teamEmissive === 'string' && t.teamEmissive.trim()) {
      textures.teamEmissive = resolveAssetUrl(docId, t.teamEmissive);
    }
  }

  const hasHeight = options.height !== undefined && options.height !== null && String(options.height).trim() !== '';
  const heightRaw = hasHeight ? Number(options.height) : NaN;
  const height = Number.isFinite(heightRaw) ? Math.round(clamp(heightRaw, 180, 900)) : undefined;

  const yawRaw = Number(options.yaw);
  const pitchRaw = Number(options.pitch);
  const distRaw = Number(options.distance);
  const hoverRaw = Number(options.hover);

  return {
    title: typeof options.title === 'string' ? options.title.trim() : '',
    lods,
    textures,
    teamSwatches: parseTeamSwatches(options.teamColors),
    height,
    scene: parseScene(options.scene),
    animate: options.animate !== false,
    autoRotate: options.autoRotate === true,
    showFloor: options.showFloor !== false,
    showGrid: options.showGrid !== false,
    hover: Number.isFinite(hoverRaw) ? clamp(hoverRaw, 0, 4) : 0,
    yaw: Number.isFinite(yawRaw) ? yawRaw : -0.68,
    pitch: Number.isFinite(pitchRaw) ? clamp(pitchRaw, 0.04, 1.45) : 0.30,
    distance: Number.isFinite(distRaw) && distRaw > 0 ? distRaw : undefined,
  };
}
