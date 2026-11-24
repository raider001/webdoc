// model-viewer.ts - generic WebGL 1.0 PBR + AgX 3D model viewer widget plugin for WebDoc.
// Supports glTF 2.0 static & skeletal-skinned models, animation playback/scrubbing, and interactive rig/aim testing.
// Enable with "plugins": ["model-viewer"] in config.json.

import { registerWidget } from '../js/widgets.js';
import type { WidgetContext } from '../js/widgets.js';
import { parseGlb } from './model-viewer/gltf.js';
import type { ParsedGlb, RigInfo } from './model-viewer/gltf.js';
import { normalizeViewerOptions, VIEWER_SCENES } from './model-viewer/options.js';
import type { ViewerConfig, ViewerScene } from './model-viewer/options.js';

const SCENE_LABELS: Record<ViewerScene, string> = {
  studio: 'Studio',
  ground: 'Ground',
  sky: 'Sky',
  seabed: 'Seabed',
  space: 'Space',
};
import { StudioRenderer } from './model-viewer/renderer.js';

const STYLE_ATTR = 'data-wd-model-viewer-style';

function ensureStyles(): void {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector(`link[${STYLE_ATTR}]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.setAttribute(STYLE_ATTR, '1');
  try {
    link.href = new URL('./model-viewer/model-viewer.css', import.meta.url).href;
  } catch {
    link.href = '/thirdpartyrenderer/model-viewer/model-viewer.css';
  }
  document.head.append(link);
}

interface RigPanelRefs {
  root: HTMLElement;
  // Animation row
  animRow: HTMLElement;
  playBtn: HTMLButtonElement;
  clipSelect: HTMLSelectElement;
  scrubber: HTMLInputElement;
  timeVal: HTMLSpanElement;
  speedSelect: HTMLSelectElement;
  // Smart rig sliders & toggles row
  rigRow: HTMLElement;
  yawWrap: HTMLElement;
  yawRange: HTMLInputElement;
  yawVal: HTMLSpanElement;
  pitchWrap: HTMLElement;
  pitchRange: HTMLInputElement;
  pitchVal: HTMLSpanElement;
  steerWrap: HTMLElement;
  steerRange: HTMLInputElement;
  steerVal: HTMLSpanElement;
  sweepBtn: HTMLButtonElement;
  spinBtn: HTMLButtonElement;
  muzzlesBtn: HTMLButtonElement;
  bonesBtn: HTMLButtonElement;
  resetPoseBtn: HTMLButtonElement;
  // Manual per-bone inspector
  bonesDetails: HTMLDetailsElement;
  bonesSummary: HTMLElement;
  boneSelect: HTMLSelectElement;
  boneRx: HTMLInputElement;
  boneRxVal: HTMLSpanElement;
  boneRy: HTMLInputElement;
  boneRyVal: HTMLSpanElement;
  boneRz: HTMLInputElement;
  boneRzVal: HTMLSpanElement;
  zeroBoneBtn: HTMLButtonElement;
}

interface ViewerState {
  config: ViewerConfig;
  renderer?: StudioRenderer;
  cache: Map<string, ParsedGlb>;
  activeLod: number;
  rigOpen: boolean;
  isScrubbing: boolean;
  stageEl: HTMLElement;
  badgeEl: HTMLElement;
  statusEl: HTMLElement;
  animBtn: HTMLButtonElement;
  rigBtn: HTMLButtonElement;
  rotBtn: HTMLButtonElement;
  lodBtns: HTMLButtonElement[];
  swatchBtns: HTMLButtonElement[];
  canvas: HTMLCanvasElement;
  rigPanel: RigPanelRefs;
}

const states = new WeakMap<HTMLElement, ViewerState>();

function formatDeg(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${r}°`;
}

function updateBadge(st: ViewerState, parsed?: ParsedGlb): void {
  const lod = st.config.lods[st.activeLod];
  const parts: string[] = [];
  if (st.config.title) parts.push(st.config.title);
  if (lod && (st.config.lods.length > 1 || !st.config.title)) parts.push(lod.label);
  if (parsed) {
    parts.push(`${parsed.triangleCount.toLocaleString()} tris`);
    const rig = st.renderer?.getRigInfo();
    if (rig?.hasSkin) parts.push(`${rig.bones.length} bones`);
  }
  st.badgeEl.textContent = parts.join(' · ') || '3D Model';
}

function makeRangeCtrl(
  labelText: string,
  min: number,
  max: number,
  step: number,
  init: number,
  grow = false,
): { wrap: HTMLElement; range: HTMLInputElement; val: HTMLSpanElement } {
  const wrap = document.createElement('label');
  wrap.className = grow ? 'wd-mv-ctrl wd-mv-ctrl-grow' : 'wd-mv-ctrl';
  const lbl = document.createElement('span');
  lbl.className = 'wd-mv-lbl';
  lbl.textContent = labelText;
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'wd-mv-range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(init);
  const val = document.createElement('span');
  val.className = 'wd-mv-val';
  val.textContent = formatDeg(init);
  wrap.append(lbl, range, val);
  return { wrap, range, val };
}

function createRigPanel(): RigPanelRefs {
  const root = document.createElement('div');
  root.className = 'wd-mv-rig';
  root.hidden = true;

  // Row 1: Animation clip playback + timeline scrubber + speed
  const animRow = document.createElement('div');
  animRow.className = 'wd-mv-rig-row';
  animRow.hidden = true;

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'wd-mv-btn';
  playBtn.textContent = 'Pause';
  playBtn.setAttribute('aria-pressed', 'true');

  const clipWrap = document.createElement('label');
  clipWrap.className = 'wd-mv-ctrl';
  const clipLbl = document.createElement('span');
  clipLbl.className = 'wd-mv-lbl';
  clipLbl.textContent = 'Clip';
  const clipSelect = document.createElement('select');
  clipSelect.className = 'wd-mv-select';
  clipSelect.setAttribute('aria-label', 'Animation clip');
  clipWrap.append(clipLbl, clipSelect);

  const scrub = makeRangeCtrl('Time', 0, 1000, 1, 0, true);
  scrub.val.textContent = '0.00s';

  const speedWrap = document.createElement('label');
  speedWrap.className = 'wd-mv-ctrl';
  const speedLbl = document.createElement('span');
  speedLbl.className = 'wd-mv-lbl';
  speedLbl.textContent = 'Speed';
  const speedSelect = document.createElement('select');
  speedSelect.className = 'wd-mv-select';
  speedSelect.setAttribute('aria-label', 'Animation speed');
  for (const [val, text] of [['0.25', '0.25×'], ['0.5', '0.5×'], ['1', '1×'], ['1.5', '1.5×'], ['2', '2×']]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (val === '1') opt.selected = true;
    speedSelect.append(opt);
  }
  speedWrap.append(speedLbl, speedSelect);

  animRow.append(playBtn, clipWrap, scrub.wrap, speedWrap);

  // Row 2: Smart rig articulation & aim sliders + quick test buttons
  const rigRow = document.createElement('div');
  rigRow.className = 'wd-mv-rig-row';
  rigRow.hidden = true;

  const yawCtrl = makeRangeCtrl('Turret Yaw', -180, 180, 1, 0);
  const pitchCtrl = makeRangeCtrl('Gun Pitch', -35, 60, 1, 0);
  const steerCtrl = makeRangeCtrl('Steer / Waist', -30, 30, 1, 0);

  const sweepBtn = document.createElement('button');
  sweepBtn.type = 'button';
  sweepBtn.className = 'wd-mv-btn';
  sweepBtn.textContent = 'Aim Sweep';
  sweepBtn.setAttribute('aria-pressed', 'false');

  const spinBtn = document.createElement('button');
  spinBtn.type = 'button';
  spinBtn.className = 'wd-mv-btn';
  spinBtn.textContent = 'Spin Barrels';
  spinBtn.setAttribute('aria-pressed', 'false');

  const muzzlesBtn = document.createElement('button');
  muzzlesBtn.type = 'button';
  muzzlesBtn.className = 'wd-mv-btn';
  muzzlesBtn.textContent = 'Muzzles';
  muzzlesBtn.setAttribute('aria-pressed', 'false');

  const bonesBtn = document.createElement('button');
  bonesBtn.type = 'button';
  bonesBtn.className = 'wd-mv-btn';
  bonesBtn.textContent = 'Bones';
  bonesBtn.setAttribute('aria-pressed', 'false');

  const resetPoseBtn = document.createElement('button');
  resetPoseBtn.type = 'button';
  resetPoseBtn.className = 'wd-mv-btn';
  resetPoseBtn.textContent = 'Reset Pose';

  rigRow.append(
    yawCtrl.wrap,
    pitchCtrl.wrap,
    steerCtrl.wrap,
    sweepBtn,
    spinBtn,
    muzzlesBtn,
    bonesBtn,
    resetPoseBtn,
  );

  // Row 3: Manual per-bone pose inspector
  const bonesDetails = document.createElement('details');
  bonesDetails.className = 'wd-mv-bones';
  bonesDetails.hidden = true;

  const bonesSummary = document.createElement('summary');
  bonesSummary.textContent = 'Inspect individual bone';

  const bonesBody = document.createElement('div');
  bonesBody.className = 'wd-mv-bones-body';

  const boneWrap = document.createElement('label');
  boneWrap.className = 'wd-mv-ctrl';
  const boneLbl = document.createElement('span');
  boneLbl.className = 'wd-mv-lbl';
  boneLbl.textContent = 'Bone';
  const boneSelect = document.createElement('select');
  boneSelect.className = 'wd-mv-select';
  boneSelect.setAttribute('aria-label', 'Select skeleton bone');
  boneWrap.append(boneLbl, boneSelect);

  const rxCtrl = makeRangeCtrl('Pitch X', -180, 180, 1, 0);
  const ryCtrl = makeRangeCtrl('Yaw Y', -180, 180, 1, 0);
  const rzCtrl = makeRangeCtrl('Roll Z', -180, 180, 1, 0);

  const zeroBoneBtn = document.createElement('button');
  zeroBoneBtn.type = 'button';
  zeroBoneBtn.className = 'wd-mv-btn';
  zeroBoneBtn.textContent = 'Zero Bone';

  bonesBody.append(boneWrap, rxCtrl.wrap, ryCtrl.wrap, rzCtrl.wrap, zeroBoneBtn);
  bonesDetails.append(bonesSummary, bonesBody);

  root.append(animRow, rigRow, bonesDetails);

  return {
    root,
    animRow,
    playBtn,
    clipSelect,
    scrubber: scrub.range,
    timeVal: scrub.val,
    speedSelect,
    rigRow,
    yawWrap: yawCtrl.wrap,
    yawRange: yawCtrl.range,
    yawVal: yawCtrl.val,
    pitchWrap: pitchCtrl.wrap,
    pitchRange: pitchCtrl.range,
    pitchVal: pitchCtrl.val,
    steerWrap: steerCtrl.wrap,
    steerRange: steerCtrl.range,
    steerVal: steerCtrl.val,
    sweepBtn,
    spinBtn,
    muzzlesBtn,
    bonesBtn,
    resetPoseBtn,
    bonesDetails,
    bonesSummary,
    boneSelect,
    boneRx: rxCtrl.range,
    boneRxVal: rxCtrl.val,
    boneRy: ryCtrl.range,
    boneRyVal: ryCtrl.val,
    boneRz: rzCtrl.range,
    boneRzVal: rzCtrl.val,
    zeroBoneBtn,
  };
}

function syncBoneInspectorSliders(st: ViewerState): void {
  const r = st.renderer;
  const p = st.rigPanel;
  const bname = p.boneSelect.value;
  if (!r || !bname) return;
  const [rx, ry, rz] = r.getBoneOverride(bname);
  p.boneRx.value = String(rx);
  p.boneRxVal.textContent = formatDeg(rx);
  p.boneRy.value = String(ry);
  p.boneRyVal.textContent = formatDeg(ry);
  p.boneRz.value = String(rz);
  p.boneRzVal.textContent = formatDeg(rz);
}

function syncPlayButtons(st: ViewerState): void {
  const r = st.renderer;
  if (!r) return;
  const playing = r.animate && r.activeClipIndex >= 0;
  st.animBtn.setAttribute('aria-pressed', String(playing));
  st.animBtn.textContent = playing ? 'Anim: ON' : 'Anim: OFF';
  st.rigPanel.playBtn.setAttribute('aria-pressed', String(playing));
  st.rigPanel.playBtn.textContent = playing ? 'Pause' : 'Play';
}

function syncRigPanelForScene(st: ViewerState): void {
  const r = st.renderer;
  if (!r) return;
  const p = st.rigPanel;
  const animNames = r.getAnimationNames();
  const hasAnim = animNames.length > 0;
  const rig: RigInfo | null = r.getRigInfo();
  const hasSkin = Boolean(rig?.hasSkin);
  const hasAny = hasAnim || hasSkin;

  st.animBtn.hidden = !hasAnim;
  st.rigBtn.hidden = !hasAny;
  st.rigBtn.setAttribute('aria-pressed', String(hasAny && st.rigOpen));
  p.root.hidden = !(hasAny && st.rigOpen);

  // Animation controls
  p.animRow.hidden = !hasAnim;
  if (hasAnim) {
    const prevClip = r.activeClipIndex;
    p.clipSelect.innerHTML = '';
    animNames.forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = name;
      if (idx === prevClip) opt.selected = true;
      p.clipSelect.append(opt);
    });
    const restOpt = document.createElement('option');
    restOpt.value = '-1';
    restOpt.textContent = 'Rest Pose';
    if (prevClip < 0) restOpt.selected = true;
    p.clipSelect.append(restOpt);

    const dur = r.getActiveClipDuration();
    const cur = r.getAnimTime();
    p.scrubber.value = dur > 0 ? String(Math.round((cur / dur) * 1000)) : '0';
    p.timeVal.textContent = dur > 0 ? `${cur.toFixed(2)}s` : 'Rest';
    syncPlayButtons(st);
  }

  // Smart articulation & aim controls
  p.rigRow.hidden = !hasSkin;
  p.bonesDetails.hidden = !hasSkin;
  if (hasSkin && rig) {
    const hasYaw = rig.turretYawNodes.length > 0;
    const hasPitch = rig.gunPitchNodes.length > 0;
    const hasSteer = rig.waistNodes.length > 0 || rig.steerFrontNodes.length > 0;
    const hasSpin = rig.spinNodes.length > 0;
    const hasMuzzles = rig.muzzleNodes.length > 0;

    p.yawWrap.hidden = !hasYaw;
    p.pitchWrap.hidden = !hasPitch;
    p.steerWrap.hidden = !hasSteer;
    p.sweepBtn.hidden = !(hasYaw || hasPitch);
    p.spinBtn.hidden = !hasSpin;
    p.muzzlesBtn.hidden = !hasMuzzles;

    p.muzzlesBtn.textContent = hasMuzzles ? `Muzzles (${rig.muzzleNodes.length})` : 'Muzzles';
    p.bonesBtn.textContent = `Bones (${rig.bones.length})`;
    p.bonesSummary.textContent = `Inspect individual bone (${rig.bones.length} bones)`;

    p.yawRange.value = String(r.turretYawDeg);
    p.yawVal.textContent = formatDeg(r.turretYawDeg);
    p.pitchRange.value = String(r.gunPitchDeg);
    p.pitchVal.textContent = formatDeg(r.gunPitchDeg);
    p.steerRange.value = String(r.steerDeg);
    p.steerVal.textContent = formatDeg(r.steerDeg);
    p.sweepBtn.setAttribute('aria-pressed', String(r.aimSweep));
    p.spinBtn.setAttribute('aria-pressed', String(r.barrelSpin));
    p.muzzlesBtn.setAttribute('aria-pressed', String(r.showMuzzles));
    p.bonesBtn.setAttribute('aria-pressed', String(r.showBones));

    const prevBone = p.boneSelect.value;
    p.boneSelect.innerHTML = '';
    for (const b of rig.bones) {
      const opt = document.createElement('option');
      opt.value = b.name;
      opt.textContent = b.name;
      if (b.name === prevBone) opt.selected = true;
      p.boneSelect.append(opt);
    }
    syncBoneInspectorSliders(st);
  }
}

async function fetchGlb(url: string, signal: AbortSignal): Promise<ParsedGlb> {
  const res = await fetch(url, { credentials: 'same-origin', signal });
  if (!res.ok) throw new Error(`Could not load 3D model (${res.status}): ${url}`);
  const buf = await res.arrayBuffer();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return parseGlb(buf);
}

async function selectLod(ctx: WidgetContext, st: ViewerState, index: number, preserveCamera: boolean): Promise<void> {
  const lod = st.config.lods[index];
  if (!lod || !st.renderer) return;
  st.activeLod = index;
  st.lodBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));

  let parsed = st.cache.get(lod.url);
  if (!parsed) {
    st.statusEl.textContent = `Loading ${lod.label}…`;
    st.statusEl.hidden = false;
    parsed = await fetchGlb(lod.url, ctx.signal);
    if (ctx.signal.aborted) return;
    st.cache.set(lod.url, parsed);
  }
  await st.renderer.setScene(parsed, ctx.signal, preserveCamera);
  if (ctx.signal.aborted) return;

  st.statusEl.hidden = true;
  updateBadge(st, parsed);
  syncRigPanelForScene(st);
}

registerWidget({
  name: 'model-viewer',
  displayName: '3D model viewer',
  icon: '◇',
  description: 'Interactive WebGL PBR viewer for glTF 2.0 (.glb) 3D models with skeletal animation and rig testing.',
  editor: {
    fields: [
      {
        name: 'src',
        label: 'Model (.glb)',
        type: 'text',
        required: true,
        hint: 'Relative path to a .glb file (e.g. ./models/unit.glb) or /docs/...',
        validate: (value, options) => {
          const hasLods = Boolean(options.lods && typeof options.lods === 'object' && Object.keys(options.lods as object).length);
          const s = String(value || '').trim();
          if (!s && !hasLods) return 'Enter a .glb path';
          if (s && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(s)) return 'Use a same-origin path under this document or /docs/';
          return undefined;
        },
      },
      { name: 'title', label: 'Title', type: 'text', hint: 'Optional label shown in the top-left badge' },
      { name: 'height', label: 'Fixed height (px)', type: 'number', min: 180, max: 900, hint: 'Leave blank for responsive golden-ratio sizing (1.618:1)' },
      { name: 'animate', label: 'Play glTF animation', type: 'boolean', default: true },
      { name: 'autoRotate', label: 'Auto-rotate camera', type: 'boolean', default: false },
      { name: 'showFloor', label: 'Show studio floor', type: 'boolean', default: true },
      { name: 'showGrid', label: 'Show floor grid', type: 'boolean', default: true },
      { name: 'scene', label: 'Scene backdrop', type: 'select', choices: ['studio', 'ground', 'sky', 'seabed', 'space'], default: 'studio' },
      { name: 'hover', label: 'Hover height', type: 'number', default: 0, min: 0, max: 4, hint: 'Lift flying/hovering models above the studio floor (0–4)' },
      { name: 'teamColors', label: 'Show team-color swatches', type: 'boolean', default: false },
    ],
  },

  render(ctx) {
    ensureStyles();
    const config = normalizeViewerOptions(ctx.options, ctx.docId);

    const figure = document.createElement('figure');
    figure.className = 'wd-mv';

    const stage = document.createElement('div');
    stage.className = 'wd-mv-stage';
    if (config.height !== undefined) {
      stage.style.height = `${config.height}px`;
      stage.style.aspectRatio = 'auto';
      stage.style.maxHeight = 'none';
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'wd-mv-canvas';
    canvas.setAttribute('aria-label', config.title ? `3D model: ${config.title}` : 'Interactive 3D model viewer');

    const statusEl = document.createElement('div');
    statusEl.className = 'wd-mv-status';
    statusEl.setAttribute('role', 'status');
    statusEl.textContent = 'Loading 3D model…';

    // Top-left badge
    const hudTL = document.createElement('div');
    hudTL.className = 'wd-mv-hud-tl';
    const badgeEl = document.createElement('span');
    badgeEl.className = 'wd-mv-badge';
    hudTL.append(badgeEl);

    // Top-right LOD tabs (only when multiple LODs exist)
    const hudTR = document.createElement('div');
    hudTR.className = 'wd-mv-hud-tr';
    const lodBtns: HTMLButtonElement[] = [];
    if (config.lods.length > 1) {
      config.lods.forEach((lod, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wd-mv-btn';
        btn.textContent = lod.label;
        btn.setAttribute('aria-pressed', String(idx === 0));
        lodBtns.push(btn);
        hudTR.append(btn);
      });
    }

    // Bottom-left team-color swatches (optional)
    const hudBL = document.createElement('div');
    hudBL.className = 'wd-mv-hud-bl';
    const swatchBtns: HTMLButtonElement[] = [];
    if (config.teamSwatches.length) {
      const wrap = document.createElement('div');
      wrap.className = 'wd-mv-swatches';
      const lbl = document.createElement('span');
      lbl.textContent = 'Team:';
      wrap.append(lbl);
      config.teamSwatches.forEach((sw, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wd-mv-swatch';
        btn.style.background = sw.cssColor;
        btn.title = sw.name;
        btn.setAttribute('aria-label', `Team color: ${sw.name}`);
        btn.setAttribute('aria-pressed', String(idx === 0));
        swatchBtns.push(btn);
        wrap.append(btn);
      });
      hudBL.append(wrap);
    }

    // Bottom-right controls
    const hudBR = document.createElement('div');
    hudBR.className = 'wd-mv-hud-br';

    const rigBtn = document.createElement('button');
    rigBtn.type = 'button';
    rigBtn.className = 'wd-mv-btn';
    rigBtn.hidden = true;
    rigBtn.setAttribute('aria-pressed', 'true');
    rigBtn.textContent = 'Rig Test';
    rigBtn.title = 'Toggle animation and rig/aim test controls';

    const animBtn = document.createElement('button');
    animBtn.type = 'button';
    animBtn.className = 'wd-mv-btn';
    animBtn.hidden = true;
    animBtn.setAttribute('aria-pressed', String(config.animate));
    animBtn.textContent = config.animate ? 'Anim: ON' : 'Anim: OFF';

    const rotBtn = document.createElement('button');
    rotBtn.type = 'button';
    rotBtn.className = 'wd-mv-btn';
    rotBtn.setAttribute('aria-pressed', String(config.autoRotate));
    rotBtn.textContent = config.autoRotate ? 'Spin: ON' : 'Spin: OFF';

    const sceneBtn = document.createElement('button');
    sceneBtn.type = 'button';
    sceneBtn.className = 'wd-mv-btn';
    let curScene: ViewerScene = config.scene;
    sceneBtn.textContent = SCENE_LABELS[curScene];
    sceneBtn.title = 'Cycle environment (Ground, Sky, Seabed, Space, Studio)';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'wd-mv-btn';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset camera (or double-click canvas)';

    hudBR.append(sceneBtn, rigBtn, animBtn, rotBtn, resetBtn);
    stage.append(canvas, hudTL, hudTR, hudBL, hudBR, statusEl);

    const rigPanel = createRigPanel();
    figure.append(stage, rigPanel.root);

    if (ctx.content.childNodes.length && ctx.content.textContent?.trim()) {
      const cap = document.createElement('figcaption');
      cap.className = 'wd-mv-caption';
      cap.append(ctx.content);
      figure.append(cap);
    }

    const st: ViewerState = {
      config,
      cache: new Map(),
      activeLod: 0,
      rigOpen: true,
      isScrubbing: false,
      stageEl: stage,
      badgeEl,
      statusEl,
      animBtn,
      rigBtn,
      rotBtn,
      lodBtns,
      swatchBtns,
      canvas,
      rigPanel,
    };
    updateBadge(st);
    states.set(ctx.host, st);

    lodBtns.forEach((btn, idx) => {
      btn.addEventListener('click', ctx.guard(async () => {
        if (idx === st.activeLod) return;
        await selectLod(ctx, st, idx, true);
      }));
    });

    swatchBtns.forEach((btn, idx) => {
      btn.addEventListener('click', ctx.guard(() => {
        const sw = config.teamSwatches[idx];
        if (!sw || !st.renderer) return;
        st.renderer.teamCol = [...sw.linear];
        swatchBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
        st.renderer.requestSingleRender();
      }));
    });

    const toggleAnimPlayback = () => {
      const r = st.renderer;
      if (!r || !r.hasAnimations()) return;
      if (r.activeClipIndex < 0) {
        r.setActiveClip(0);
        r.animate = true;
        st.rigPanel.clipSelect.value = '0';
      } else {
        r.animate = !r.animate;
      }
      syncPlayButtons(st);
      r.syncLoop();
      r.requestSingleRender();
    };

    animBtn.addEventListener('click', ctx.guard(toggleAnimPlayback));
    rigPanel.playBtn.addEventListener('click', ctx.guard(toggleAnimPlayback));

    rigBtn.addEventListener('click', ctx.guard(() => {
      st.rigOpen = !st.rigOpen;
      rigBtn.setAttribute('aria-pressed', String(st.rigOpen));
      rigPanel.root.hidden = !st.rigOpen;
    }));

    rotBtn.addEventListener('click', ctx.guard(() => {
      if (!st.renderer) return;
      st.renderer.autoRotate = !st.renderer.autoRotate;
      rotBtn.setAttribute('aria-pressed', String(st.renderer.autoRotate));
      rotBtn.textContent = st.renderer.autoRotate ? 'Spin: ON' : 'Spin: OFF';
      st.renderer.syncLoop();
    }));

    sceneBtn.addEventListener('click', ctx.guard(() => {
      if (!st.renderer) return;
      const idx = VIEWER_SCENES.indexOf(curScene);
      curScene = VIEWER_SCENES[(idx + 1) % VIEWER_SCENES.length];
      sceneBtn.textContent = SCENE_LABELS[curScene];
      st.renderer.setSceneType(curScene);
    }));

    resetBtn.addEventListener('click', ctx.guard(() => {
      st.renderer?.resetCamera();
    }));

    // Rig panel handlers
    rigPanel.clipSelect.addEventListener('change', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      const idx = Number(rigPanel.clipSelect.value);
      r.setActiveClip(idx);
      if (idx >= 0) r.animate = true;
      const dur = r.getActiveClipDuration();
      rigPanel.scrubber.value = '0';
      rigPanel.timeVal.textContent = dur > 0 ? '0.00s' : 'Rest';
      syncPlayButtons(st);
    }));

    rigPanel.speedSelect.addEventListener('change', ctx.guard(() => {
      if (!st.renderer) return;
      st.renderer.animSpeed = Number(rigPanel.speedSelect.value) || 1;
    }));

    rigPanel.scrubber.addEventListener('pointerdown', () => { st.isScrubbing = true; });
    rigPanel.scrubber.addEventListener('pointerup', () => { st.isScrubbing = false; });
    rigPanel.scrubber.addEventListener('input', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      if (r.activeClipIndex < 0 && r.hasAnimations()) {
        r.setActiveClip(0);
        rigPanel.clipSelect.value = '0';
      }
      const dur = r.getActiveClipDuration();
      if (dur <= 0) return;
      const t = (Number(rigPanel.scrubber.value) / 1000) * dur;
      r.animate = false;
      syncPlayButtons(st);
      r.syncLoop();
      r.setAnimTime(t);
      rigPanel.timeVal.textContent = `${t.toFixed(2)}s`;
    }));

    rigPanel.yawRange.addEventListener('input', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.turretYawDeg = Number(rigPanel.yawRange.value);
      rigPanel.yawVal.textContent = formatDeg(r.turretYawDeg);
      r.requestSingleRender();
    }));

    rigPanel.pitchRange.addEventListener('input', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.gunPitchDeg = Number(rigPanel.pitchRange.value);
      rigPanel.pitchVal.textContent = formatDeg(r.gunPitchDeg);
      r.requestSingleRender();
    }));

    rigPanel.steerRange.addEventListener('input', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.steerDeg = Number(rigPanel.steerRange.value);
      rigPanel.steerVal.textContent = formatDeg(r.steerDeg);
      r.requestSingleRender();
    }));

    rigPanel.sweepBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.aimSweep = !r.aimSweep;
      rigPanel.sweepBtn.setAttribute('aria-pressed', String(r.aimSweep));
      r.syncLoop();
      r.requestSingleRender();
    }));

    rigPanel.spinBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.barrelSpin = !r.barrelSpin;
      rigPanel.spinBtn.setAttribute('aria-pressed', String(r.barrelSpin));
      r.syncLoop();
      r.requestSingleRender();
    }));

    rigPanel.muzzlesBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.showMuzzles = !r.showMuzzles;
      rigPanel.muzzlesBtn.setAttribute('aria-pressed', String(r.showMuzzles));
      r.requestSingleRender();
    }));

    rigPanel.bonesBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.showBones = !r.showBones;
      rigPanel.bonesBtn.setAttribute('aria-pressed', String(r.showBones));
      r.requestSingleRender();
    }));

    rigPanel.resetPoseBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      if (!r) return;
      r.resetRigPose();
      syncRigPanelForScene(st);
    }));

    rigPanel.boneSelect.addEventListener('change', ctx.guard(() => {
      syncBoneInspectorSliders(st);
    }));

    const applyBoneSlider = () => {
      const r = st.renderer;
      const bname = rigPanel.boneSelect.value;
      if (!r || !bname) return;
      const rx = Number(rigPanel.boneRx.value);
      const ry = Number(rigPanel.boneRy.value);
      const rz = Number(rigPanel.boneRz.value);
      rigPanel.boneRxVal.textContent = formatDeg(rx);
      rigPanel.boneRyVal.textContent = formatDeg(ry);
      rigPanel.boneRzVal.textContent = formatDeg(rz);
      r.setBoneOverride(bname, rx, ry, rz);
    };

    rigPanel.boneRx.addEventListener('input', ctx.guard(applyBoneSlider));
    rigPanel.boneRy.addEventListener('input', ctx.guard(applyBoneSlider));
    rigPanel.boneRz.addEventListener('input', ctx.guard(applyBoneSlider));

    rigPanel.zeroBoneBtn.addEventListener('click', ctx.guard(() => {
      const r = st.renderer;
      const bname = rigPanel.boneSelect.value;
      if (!r || !bname) return;
      r.setBoneOverride(bname, 0, 0, 0);
      syncBoneInspectorSliders(st);
    }));

    return figure;
  },

  async mount(ctx) {
    const st = states.get(ctx.host);
    if (!st) return;
    // Re-apply presentation styles after scrubRendered(host) on strict builds
    if (st.config.height !== undefined) {
      st.stageEl.style.height = `${st.config.height}px`;
      st.stageEl.style.aspectRatio = 'auto';
      st.stageEl.style.maxHeight = 'none';
    }
    st.swatchBtns.forEach((btn, idx) => {
      const sw = st.config.teamSwatches[idx];
      if (sw) btn.style.background = sw.cssColor;
    });
    const renderer = new StudioRenderer(st.canvas, {
      yaw: st.config.yaw,
      pitch: st.config.pitch,
      distance: st.config.distance,
      animate: st.config.animate,
      autoRotate: st.config.autoRotate,
      showFloor: st.config.showFloor,
      showGrid: st.config.showGrid,
      hover: st.config.hover,
      scene: st.config.scene,
    });
    renderer.onFrameTick = (timeSec, durationSec) => {
      if (st.isScrubbing || durationSec <= 0) return;
      st.rigPanel.scrubber.value = String(Math.round((timeSec / durationSec) * 1000));
      st.rigPanel.timeVal.textContent = `${timeSec.toFixed(2)}s`;
    };
    st.renderer = renderer;

    const tasks: Array<Promise<void>> = [selectLod(ctx, st, 0, false)];
    if (Object.keys(st.config.textures).length) {
      tasks.push(renderer.loadExternalTextures(st.config.textures, ctx.signal));
    }
    try {
      await Promise.all(tasks);
    } catch (err) {
      if (ctx.signal.aborted) return;
      st.statusEl.textContent = err instanceof Error ? err.message : String(err);
      st.statusEl.hidden = false;
    }
  },

  destroy(ctx) {
    const st = states.get(ctx.host);
    if (!st) return;
    st.renderer?.destroy();
    st.renderer = undefined;
    st.cache.clear();
    states.delete(ctx.host);
  },
});
