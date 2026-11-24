<!--meta
{ "title": "3D Model Viewer", "description": "Optional WebGL PBR + AgX widget plugin for displaying interactive glTF 2.0 (.glb) 3D models, LODs, and baked textures.", "assumes": ["Docs/features/widget-api"] }
-->

# 3D Model Viewer

The `model-viewer` plugin adds an interactive, zero-dependency WebGL 1.0 PBR + AgX studio viewer for standard **glTF 2.0 (`.glb`)** models. It works offline under WebDoc's strict same-origin Content-Security-Policy without external CDN scripts.

## Enable the plugin

Add `"model-viewer"` to `plugins` in `config.json`:

```json
{
  "plugins": ["mermaid", "model-viewer"]
}
```

## Basic usage

Place a `.glb` file next to your Markdown document (or anywhere under a configured source folder) and wrap an optional caption in a `model-viewer` widget block:

```markdown
<!--meta start {"widget":"model-viewer","src":"./models/tank.glb","title":"Vanguard MK-IV"}-->
Drag to orbit, scroll to zoom, Shift+drag or right-drag to pan, double-click to reset.
<!--meta end {"widget":"model-viewer"}-->
```

The viewer automatically centers the model on the studio floor, frames the camera to its bounding radius, decodes embedded PBR textures (`baseColor`, `metallicRoughness`, `occlusion`, `normal`, `emissive`, and `KHR_materials_emissive_strength`), renders **glTF 2.0 skeletal skins (`JOINTS_0`, `WEIGHTS_0`, `inverseBindMatrices`)** on the GPU, and plays embedded glTF keyframe animations when present.

## Interactive animation & rig testing

Whenever a loaded `.glb` includes embedded animations or a skeleton (`skins`), the viewer automatically reveals a **Rig Test** dock below the canvas (collapsible via the `Rig Test` button) without altering static models:

- **Clip playback & scrubbing:** switch between embedded animation clips or `Rest Pose`, adjust speed (`0.25×`–`2×`), pause, and scrub frame-by-frame.
- **Auto-detected articulation sliders:** standardized bones automatically surface dedicated sliders and quick tests — **Turret Yaw** (`turret*yaw`), **Gun Pitch** (`*gun*pitch`, `*barrel*pitch`), **Steer / Waist** (`waist_yaw`, `*steer`), **Aim Sweep** continuous test pattern, and **Spin Barrels / Rotors** (`*barrel_spin`, `*rotor*spin`).
- **3D overlays:** toggle **Muzzles** to display glowing forward aim rays on every `muzzle_*` bone, or **Bones** to inspect the skeleton hierarchy and joint pivots.
- **Per-bone inspector:** expand *Inspect individual bone* to test arbitrary `Pitch (X)`, `Yaw (Y)`, and `Roll (Z)` rotations on any bone in the rig. All pose and clip settings carry across LOD switches (`LOD0`–`LOD4`).

## LOD switching & baked PBR maps

For assets with multiple level-of-detail meshes and optional external 1K baked texture sheets or team-color recoloring, supply `lods`, `textures`, and `teamColors`:

```markdown
<!--meta start {
  "widget": "model-viewer",
  "title": "Rover",
  "lods": {
    "LOD0": "./rover/rover_lod0.glb",
    "LOD1": "./rover/rover_lod1.glb",
    "LOD2": "./rover/rover_lod2.glb"
  },
  "textures": {
    "albedo": "./rover/baked_1k/albedo_1k.png",
    "normal": "./rover/baked_1k/normal_1k.png",
    "orm": "./rover/baked_1k/orm_1k.png",
    "teamEmissive": "./rover/baked_1k/team_emissive_1k.png"
  },
  "teamColors": true,
  "height": 380
}-->
<!--meta end {"widget":"model-viewer"}-->
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `src` | string | — | Same-origin `.glb` path relative to the document (or `/docs/...`). Required unless `lods` is provided. |
| `lods` | object or array | — | Named `.glb` variants (e.g. `{"LOD0": "...", "LOD1": "..."}`). Renders LOD switcher tabs and caches each mesh on demand. |
| `title` | string | `""` | Label shown in the top-left HUD badge alongside the active LOD and triangle count. |
| `height` | number | auto (`1.618:1`) | Optional fixed viewport height in pixels (`180`–`900`). Omit to size responsively by the golden rectangle (`aspect-ratio: 1.618 / 1`, capped at `min(72vh, 680px)`). |
| `animate` | boolean | `true` | Play the first embedded glTF keyframe animation automatically. |
| `autoRotate` | boolean | `false` | Gently orbit the camera around the model. |
| `showFloor` | boolean | `true` | Render the studio floor with a soft contact shadow. |
| `showGrid` | boolean | `true` | Render subtle 1-unit grid lines on the studio floor. |
| `hover` | number | `0` | Extra vertical clearance above the studio floor (`0`–`4` studio units) for flying or hovering models. |
| `textures` | object | — | Optional external baked PBR map overrides (`albedo`, `normal`, `orm`, `emissive`, `teamEmissive`). |
| `teamColors` | boolean or array | `false` | `true` for the built-in team-color swatches, or an array of `{"name": "...", "color": "#rrggbb"}` entries (`"default"` disables recoloring). |
| `yaw`, `pitch`, `distance` | number | `-0.68`, `0.30`, auto | Initial camera orbit angles (radians) and distance. |

## Performance & lifecycle

- Rendering automatically pauses when the viewport scrolls off-screen (`IntersectionObserver`) or the browser tab is hidden (`visibilitychange`).
- Static models without active animation or auto-rotate render on demand only (zero idle GPU usage).
- Navigating away cancels in-flight fetches and releases all WebGL buffers, textures, and shaders cleanly.
