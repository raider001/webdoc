import { describe, expect, it } from 'vitest';
import { M4, boundsCenter, boundsRadius, emptyBounds, expandBounds, quatFromEulerXYZ, quatMul, quatSlerp } from '../../src/thirdpartyrenderer/model-viewer/math.js';
import { evaluateAnimation, inspectRig, parseGlb } from '../../src/thirdpartyrenderer/model-viewer/gltf.js';
import { hexToLinearRgb, normalizeViewerOptions, resolveAssetUrl } from '../../src/thirdpartyrenderer/model-viewer/options.js';
import { widgetDefinition } from '../../src/js/widgets.js';
import '../../src/thirdpartyrenderer/model-viewer.js';

/** Build a minimal valid binary glTF 2.0 (.glb) buffer in memory for testing. */
function makeSyntheticGlb(opts: { withAnim?: boolean } = {}): ArrayBuffer {
  // Single right triangle in XY plane, Z=0
  const pos = new Float32Array([
    0, 0, 0,
    2, 0, 0,
    0, 2, 0,
  ]);
  const uv = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
  ]);
  const idx = new Uint16Array([0, 1, 2]);
  const animTimes = new Float32Array([0, 1]);
  const animTrans = new Float32Array([
    0, 0, 0,
    0, 4, 0,
  ]);

  const chunks: Uint8Array[] = [
    new Uint8Array(pos.buffer),
    new Uint8Array(uv.buffer),
    new Uint8Array(idx.buffer),
  ];
  if (opts.withAnim) {
    chunks.push(new Uint8Array(animTimes.buffer), new Uint8Array(animTrans.buffer));
  }

  let totalBin = 0;
  const offsets: number[] = [];
  for (const c of chunks) {
    // 4-byte align each view
    while (totalBin % 4 !== 0) totalBin++;
    offsets.push(totalBin);
    totalBin += c.byteLength;
  }
  while (totalBin % 4 !== 0) totalBin++;
  const binBuf = new Uint8Array(totalBin);
  chunks.forEach((c, i) => binBuf.set(c, offsets[i]));

  const bufferViews = [
    { buffer: 0, byteOffset: offsets[0], byteLength: pos.byteLength },
    { buffer: 0, byteOffset: offsets[1], byteLength: uv.byteLength },
    { buffer: 0, byteOffset: offsets[2], byteLength: idx.byteLength },
  ];
  const accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
  ];
  const animations: unknown[] = [];

  if (opts.withAnim) {
    bufferViews.push(
      { buffer: 0, byteOffset: offsets[3], byteLength: animTimes.byteLength },
      { buffer: 0, byteOffset: offsets[4], byteLength: animTrans.byteLength },
    );
    accessors.push(
      { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'VEC3' },
    );
    animations.push({
      name: 'Lift',
      samplers: [{ input: 3, output: 4, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    });
  }

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Root', mesh: 0 }],
    meshes: [{
      name: 'Tri',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      name: 'Steel',
      pbrMetallicRoughness: {
        baseColorFactor: [0.2, 0.4, 0.6, 1],
        metallicFactor: 0.8,
        roughnessFactor: 0.3,
      },
      emissiveFactor: [0, 0.8, 1],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4.5 } },
    }],
    bufferViews,
    accessors,
    buffers: [{ byteLength: totalBin }],
    ...(opts.withAnim ? { animations } : {}),
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.byteLength);
    jsonBytes = padded;
  }

  const totalLen = 12 + 8 + jsonBytes.byteLength + 8 + binBuf.byteLength;
  const out = new ArrayBuffer(totalLen);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546C67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4E4F534A, true); // JSON
  new Uint8Array(out, 20, jsonBytes.byteLength).set(jsonBytes);
  const binHeader = 20 + jsonBytes.byteLength;
  dv.setUint32(binHeader, binBuf.byteLength, true);
  dv.setUint32(binHeader + 4, 0x004E4942, true); // BIN
  new Uint8Array(out, binHeader + 8, binBuf.byteLength).set(binBuf);
  return out;
}

describe('model-viewer math', () => {
  it('computes TRS transforms and AABB bounds accurately', () => {
    const m = M4.trs([1, 2, 3], [0, 0, 0, 1], [2, 2, 2]);
    const p = M4.transformPoint(m, 1, 0, 0);
    expect(p).toEqual([3, 2, 3]);

    const b = emptyBounds();
    expandBounds(b, -1, 0, -2);
    expandBounds(b, 3, 4, 2);
    expect(boundsCenter(b)).toEqual([1, 2, 0]);
    expect(boundsRadius(b)).toBeCloseTo(Math.hypot(2, 2, 2), 5);
  });

  it('slerps unit quaternions smoothly and composes Euler XYZ rotations', () => {
    const half = quatSlerp([0, 0, 0, 1], [0, Math.SQRT1_2, 0, Math.SQRT1_2], 0.5);
    expect(Math.hypot(...half)).toBeCloseTo(1, 5);
    expect(half[1]).toBeCloseTo(Math.sin(Math.PI / 8), 4);

    // 90 deg yaw (+Y) maps forward +Z to +X
    const qYaw = quatFromEulerXYZ(0, Math.PI / 2, 0);
    const mYaw = M4.trs([0, 0, 0], qYaw, [1, 1, 1]);
    const fwdYaw = M4.transformPoint(mYaw, 0, 0, 1);
    expect(fwdYaw[0]).toBeCloseTo(1, 5);
    expect(fwdYaw[1]).toBeCloseTo(0, 5);
    expect(fwdYaw[2]).toBeCloseTo(0, 5);

    // Negative X rotation elevates +Z barrel UP (+Y)
    const qPitchUp = quatFromEulerXYZ(-Math.PI / 2, 0, 0);
    const mPitch = M4.trs([0, 0, 0], qPitchUp, [1, 1, 1]);
    const fwdPitch = M4.transformPoint(mPitch, 0, 0, 1);
    expect(fwdPitch[1]).toBeCloseTo(1, 5);

    const qComp = quatMul(qYaw, qPitchUp);
    expect(Math.hypot(...qComp)).toBeCloseTo(1, 5);
  });
});

/** Build a minimal skinned binary glTF 2.0 (.glb) with turret/gun/waist/steer/spin/muzzle bones. */
function makeSyntheticSkinnedGlb(): ArrayBuffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const joints = new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]);
  const weights = new Float32Array([0.5, 0.5, 0, 0, 2.0, 0, 0, 0, 1, 0, 0, 0]); // vert 1 intentionally unnormalized
  const idx = new Uint16Array([0, 1, 2]);
  const boneNames = ['root', 'turret_yaw', 'gun_pitch', 'waist_yaw', 'wheel_FL1_steer', 'wheel_FL2_steer', 'gun_L_barrel_spin', 'muzzle_0'];
  const ibms = new Float32Array(boneNames.length * 16);
  for (let i = 0; i < boneNames.length; i++) {
    ibms.set(M4.ident(), i * 16);
  }

  const chunks: Uint8Array[] = [
    new Uint8Array(pos.buffer),
    joints,
    new Uint8Array(weights.buffer),
    new Uint8Array(idx.buffer),
    new Uint8Array(ibms.buffer),
  ];
  let totalBin = 0;
  const offsets: number[] = [];
  for (const c of chunks) {
    while (totalBin % 4 !== 0) totalBin++;
    offsets.push(totalBin);
    totalBin += c.byteLength;
  }
  while (totalBin % 4 !== 0) totalBin++;
  const binBuf = new Uint8Array(totalBin);
  chunks.forEach((c, i) => binBuf.set(c, offsets[i]));

  // Node 0 = skinned mesh, Nodes 1..8 = joints
  const nodes: unknown[] = [
    { name: 'UnitMesh', mesh: 0, skin: 0 },
    { name: 'root', children: [2, 4, 5, 6] },
    { name: 'turret_yaw', children: [3] },
    { name: 'gun_pitch', children: [7, 8] },
    { name: 'waist_yaw' },
    { name: 'wheel_FL1_steer' },
    { name: 'wheel_FL2_steer' },
    { name: 'gun_L_barrel_spin' },
    { name: 'muzzle_0', translation: [0, 0, 1] },
  ];

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes,
    skins: [{
      name: 'unit_rig',
      joints: [1, 2, 3, 4, 5, 6, 7, 8],
      inverseBindMatrices: 4,
    }],
    meshes: [{
      name: 'Hull',
      primitives: [{
        attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
        indices: 3,
      }],
    }],
    bufferViews: [
      { buffer: 0, byteOffset: offsets[0], byteLength: pos.byteLength },
      { buffer: 0, byteOffset: offsets[1], byteLength: joints.byteLength },
      { buffer: 0, byteOffset: offsets[2], byteLength: weights.byteLength },
      { buffer: 0, byteOffset: offsets[3], byteLength: idx.byteLength },
      { buffer: 0, byteOffset: offsets[4], byteLength: ibms.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: boneNames.length, type: 'MAT4' },
    ],
    buffers: [{ byteLength: totalBin }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.byteLength);
    jsonBytes = padded;
  }
  const totalLen = 12 + 8 + jsonBytes.byteLength + 8 + binBuf.byteLength;
  const out = new ArrayBuffer(totalLen);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546C67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4E4F534A, true);
  new Uint8Array(out, 20, jsonBytes.byteLength).set(jsonBytes);
  const binHeader = 20 + jsonBytes.byteLength;
  dv.setUint32(binHeader, binBuf.byteLength, true);
  dv.setUint32(binHeader + 4, 0x004E4942, true);
  new Uint8Array(out, binHeader + 8, binBuf.byteLength).set(binBuf);
  return out;
}

describe('model-viewer glTF 2.0 (.glb) parser', () => {
  it('parses geometry, synthesizes normals & tangents, and reads KHR_materials_emissive_strength', () => {
    const parsed = parseGlb(makeSyntheticGlb({ withAnim: true }));
    expect(parsed.triangleCount).toBe(1);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.materials[0].emissiveStrength).toBeCloseTo(4.5, 5);
    expect(parsed.materials[0].metallicFactor).toBeCloseTo(0.8, 5);

    const prim = parsed.meshes[0].primitives[0];
    // Vertex 0 normal should point along +Z (right-hand rule for (0,0,0)->(2,0,0)->(0,2,0))
    expect(prim.vertices[3]).toBeCloseTo(0, 5);
    expect(prim.vertices[4]).toBeCloseTo(0, 5);
    expect(prim.vertices[5]).toBeCloseTo(1, 5);
    // Tangent should be unit length
    expect(Math.hypot(prim.vertices[6], prim.vertices[7], prim.vertices[8])).toBeCloseTo(1, 5);

    expect(parsed.animations).toHaveLength(1);
    const pose = evaluateAnimation(parsed.animations[0], 0.5).get(0);
    expect(pose?.translation?.[1]).toBeCloseTo(2.0, 5);
    // Animated vertical bounds should cover the lifted keyframe peak
    expect(parsed.bounds.max[1]).toBeGreaterThan(5.0);
  });

  it('parses skeletal skins, normalizes vertex weights, and classifies canonical rig bones', () => {
    const parsed = parseGlb(makeSyntheticSkinnedGlb());
    expect(parsed.skins).toHaveLength(1);
    expect(parsed.skins[0].joints).toHaveLength(8);
    expect(parsed.skins[0].inverseBindMatrices).toHaveLength(8);
    expect(parsed.nodes[0].skin).toBe(0);

    const prim = parsed.meshes[0].primitives[0];
    expect(prim.skinData).not.toBeNull();
    // Vertex 1 had raw weight 2.0 and should normalize to 1.0
    expect(prim.skinData![8]).toBe(1);
    expect(prim.skinData![12]).toBeCloseTo(1.0, 5);

    const rig = inspectRig(parsed);
    expect(rig.hasSkin).toBe(true);
    expect(rig.bones).toHaveLength(8);
    expect(rig.turretYawNodes).toEqual([2]);
    expect(rig.gunPitchNodes).toEqual([3]);
    expect(rig.waistNodes).toEqual([4]);
    expect(rig.steerFrontNodes).toEqual([5]);
    expect(rig.steerMidNodes).toEqual([6]);
    expect(rig.spinNodes).toEqual([7]);
    expect(rig.muzzleNodes).toEqual([8]);
  });

  it('rejects invalid or truncated GLB buffers', () => {
    expect(() => parseGlb(new ArrayBuffer(8))).toThrow(/too small/i);
    const bad = new ArrayBuffer(24);
    new DataView(bad).setUint32(0, 0x12345678, true);
    expect(() => parseGlb(bad)).toThrow(/invalid glb/i);
  });
});

describe('model-viewer options & URL resolution', () => {
  it('resolves relative and /docs/ paths and rejects external URLs', () => {
    expect(resolveAssetUrl('Docs/units/tank', './tank.glb')).toBe('/docs/Docs/units/tank.glb');
    expect(resolveAssetUrl('Docs/units/tank', '/docs/Art/unit.glb')).toBe('/docs/Art/unit.glb');
    expect(() => resolveAssetUrl('Docs/units/tank', 'https://evil.example/a.glb')).toThrow(/same-origin/i);
    expect(() => resolveAssetUrl('Docs/units/tank', 'javascript:alert(1)')).toThrow(/same-origin/i);
    expect(() => resolveAssetUrl('Docs/units/tank', '/api/secret')).toThrow(/\/docs\//i);
  });

  it('normalizes LOD maps, external textures, team swatches, and clamped height', () => {
    const cfg = normalizeViewerOptions({
      title: 'Barbswing',
      lods: { LOD0: './lod0.glb', LOD1: './lod1.glb' },
      textures: { albedo: './alb.png', teamEmissive: './te.png' },
      teamColors: true,
      height: 1200,
      hover: 0.75,
    }, 'Art/greyhive/air');

    expect(cfg.title).toBe('Barbswing');
    expect(cfg.hover).toBe(0.75);
    expect(cfg.lods).toEqual([
      { label: 'LOD0', url: '/docs/Art/greyhive/lod0.glb' },
      { label: 'LOD1', url: '/docs/Art/greyhive/lod1.glb' },
    ]);
    expect(cfg.textures.albedo).toBe('/docs/Art/greyhive/alb.png');
    expect(cfg.textures.teamEmissive).toBe('/docs/Art/greyhive/te.png');
    expect(cfg.teamSwatches.length).toBeGreaterThanOrEqual(4);
    expect(cfg.teamSwatches[0].linear[0]).toBe(-1);
    expect(cfg.height).toBe(900);
    expect(hexToLinearRgb('#ffffff')).toEqual([1, 1, 1]);

    const autoCfg = normalizeViewerOptions({ src: './unit.glb' }, 'Art/greyhive/air');
    expect(autoCfg.height).toBeUndefined();
  });
});

describe('model-viewer widget registration', () => {
  it('registers with WebDoc widget registry and renders HUD controls', () => {
    const def = widgetDefinition('model-viewer');
    expect(def).toBeDefined();
    expect(def?.displayName).toBe('3D model viewer');
    expect(def?.editor?.fields?.some(f => f.name === 'src' && f.required)).toBe(true);

    const host = document.createElement('div');
    const content = document.createElement('div');
    content.textContent = 'Caption text';
    const node = def!.render({
      host,
      options: {
        widget: 'model-viewer',
        title: 'Test Unit',
        lods: { LOD0: './u0.glb', LOD1: './u1.glb' },
        teamColors: true,
      },
      innerMarkdown: 'Caption text',
      content,
      innerHTML: 'Caption text',
      docId: 'Docs/demo',
      pageId: 'Docs/demo',
      key: '0',
      depth: 0,
      signal: new AbortController().signal,
      renderContent: () => document.createElement('div'),
      teardown: () => {},
      reportError: () => {},
      guard: fn => fn,
      update: async () => {},
    }) as HTMLElement;

    expect(node.tagName).toBe('FIGURE');
    expect(node.querySelector('canvas.wd-mv-canvas')).not.toBeNull();
    expect(node.querySelectorAll('.wd-mv-hud-tr button')).toHaveLength(2);
    expect(node.querySelectorAll('.wd-mv-swatch').length).toBeGreaterThanOrEqual(4);
    expect(node.querySelector('.wd-mv-rig')).not.toBeNull();
    expect(node.querySelectorAll('.wd-mv-rig input[type="range"]').length).toBe(7);
    expect(node.querySelector('details.wd-mv-bones')).not.toBeNull();
    expect(node.querySelector('figcaption.wd-mv-caption')?.textContent).toBe('Caption text');

    // Clean destroy even if mount never ran
    expect(() => def?.destroy?.({ host } as never)).not.toThrow();
  });
});
