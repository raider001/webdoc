// gltf.ts - zero-dependency glTF 2.0 binary (.glb) parser & animation evaluator.

import { M4, emptyBounds, expandBounds, boundsCenter, boundsRadius, quatNormalize, quatSlerp } from './math.js';
import type { Bounds3, Quat, Vec3 } from './math.js';

export interface GlbImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface GlbTexture {
  source: number;
  wrapS: number;
  wrapT: number;
}

export interface GlbMaterial {
  name: string;
  baseColorFactor: [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
  emissiveFactor: Vec3;
  emissiveStrength: number;
  normalScale: number;
  occlusionStrength: number;
  clearcoatFactor: number;
  clearcoatRoughnessFactor: number;
  dielectricF0: number;
  doubleSided: boolean;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  baseColorTexture: number;
  metallicRoughnessTexture: number;
  normalTexture: number;
  occlusionTexture: number;
  emissiveTexture: number;
}

export interface GlbPrimitive {
  /** Interleaved [pos(3), norm(3), tan(4), uv(2)] = 12 floats per vertex. */
  vertices: Float32Array;
  /** Optional interleaved [j0, j1, j2, j3, w0, w1, w2, w3] = 8 floats per vertex for GPU skinning. */
  skinData: Float32Array | null;
  indices: Uint16Array | Uint32Array;
  indexCount: number;
  materialIndex: number;
  hasUV: boolean;
  bounds: Bounds3;
}

export interface GlbMesh {
  name: string;
  primitives: GlbPrimitive[];
}

export interface GlbSkin {
  name: string;
  /** Raw glTF node indices for each joint in skin order. */
  joints: number[];
  /** One column-major 4x4 inverse bind matrix per joint. */
  inverseBindMatrices: Float32Array[];
}

export interface GlbNode {
  nodeIndex: number;
  name: string;
  mesh: number;
  skin: number;
  parent: number;
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
  matrix: Float32Array | null;
}

export interface GlbAnimChannel {
  nodeIndex: number;
  path: 'translation' | 'rotation' | 'scale';
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  times: Float32Array;
  values: Float32Array;
}

export interface GlbAnimation {
  name: string;
  duration: number;
  channels: GlbAnimChannel[];
}

export interface ParsedGlb {
  meshes: GlbMesh[];
  nodes: GlbNode[];
  nodeIndexToPos: Map<number, number>;
  skins: GlbSkin[];
  materials: GlbMaterial[];
  textures: GlbTexture[];
  images: GlbImage[];
  animations: GlbAnimation[];
  bounds: Bounds3;
  center: Vec3;
  radius: number;
  triangleCount: number;
}

export interface NodePose {
  translation?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
}

interface RawGltf {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
  }>;
  skins?: Array<{
    name?: string;
    joints?: number[];
    inverseBindMatrices?: number;
    skeleton?: number;
  }>;
  meshes?: Array<{
    name?: string;
    primitives?: Array<{
      attributes?: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }>;
  }>;
  materials?: Array<{
    name?: string;
    doubleSided?: boolean;
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number;
    emissiveFactor?: number[];
    emissiveTexture?: { index: number };
    normalTexture?: { index: number; scale?: number };
    occlusionTexture?: { index: number; strength?: number };
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      metallicFactor?: number;
      roughnessFactor?: number;
      baseColorTexture?: { index: number };
      metallicRoughnessTexture?: { index: number };
    };
    extensions?: {
      KHR_materials_emissive_strength?: { emissiveStrength?: number };
      KHR_materials_clearcoat?: {
        clearcoatFactor?: number;
        clearcoatRoughnessFactor?: number;
      };
      KHR_materials_ior?: { ior?: number };
      KHR_materials_specular?: { specularFactor?: number };
    };
  }>;
  textures?: Array<{ source?: number; sampler?: number }>;
  samplers?: Array<{ wrapS?: number; wrapT?: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
  }>;
  bufferViews?: Array<{
    buffer?: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  animations?: Array<{
    name?: string;
    channels?: Array<{
      sampler: number;
      target?: { node?: number; path?: string };
    }>;
    samplers?: Array<{
      input: number;
      output: number;
      interpolation?: string;
    }>;
  }>;
}

const GLB_MAGIC = 0x46546C67; // "glTF"
const CHUNK_JSON = 0x4E4F534A; // "JSON"
const CHUNK_BIN = 0x004E4942;  // "BIN\0"

const NUM_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const COMP_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

function readComponent(dv: DataView, offset: number, compType: number, normalized: boolean): number {
  let v: number;
  switch (compType) {
    case 5126: return dv.getFloat32(offset, true);
    case 5123: v = dv.getUint16(offset, true); return normalized ? v / 65535 : v;
    case 5125: return dv.getUint32(offset, true);
    case 5122: v = dv.getInt16(offset, true); return normalized ? Math.max(-1, v / 32767) : v;
    case 5121: v = dv.getUint8(offset); return normalized ? v / 255 : v;
    case 5120: v = dv.getInt8(offset); return normalized ? Math.max(-1, v / 127) : v;
    default: throw new Error('Unsupported glTF componentType: ' + compType);
  }
}

function readAccessorFloat(gltf: RawGltf, bin: DataView, accessorIdx: number): Float32Array {
  const acc = gltf.accessors?.[accessorIdx];
  if (!acc) throw new Error('Missing glTF accessor ' + accessorIdx);
  const nc = NUM_COMPONENTS[acc.type];
  if (!nc) throw new Error('Unsupported glTF accessor type ' + acc.type);
  const out = new Float32Array(acc.count * nc);
  if (acc.bufferView === undefined) return out;
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error('Missing glTF bufferView ' + acc.bufferView);
  const bpc = COMP_BYTES[acc.componentType];
  if (!bpc) throw new Error('Unsupported componentType ' + acc.componentType);
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || (bpc * nc);
  const norm = Boolean(acc.normalized);
  for (let i = 0; i < acc.count; i++) {
    const elemOff = base + i * stride;
    for (let c = 0; c < nc; c++) {
      out[i * nc + c] = readComponent(bin, elemOff + c * bpc, acc.componentType, norm);
    }
  }
  return out;
}

function readIndices(gltf: RawGltf, bin: DataView, accessorIdx: number, vertexCount: number): Uint16Array | Uint32Array {
  const acc = gltf.accessors?.[accessorIdx];
  if (!acc || acc.bufferView === undefined) throw new Error('Invalid index accessor ' + accessorIdx);
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) throw new Error('Missing index bufferView ' + acc.bufferView);
  const bpc = COMP_BYTES[acc.componentType];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || bpc;
  const useU32 = vertexCount > 65535 || acc.componentType === 5125;
  const out = useU32 ? new Uint32Array(acc.count) : new Uint16Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    out[i] = readComponent(bin, base + i * stride, acc.componentType, false);
  }
  return out;
}

function computeNormals(pos: Float32Array, idx: Uint16Array | Uint32Array, vc: number): Float32Array {
  const acc = new Float32Array(vc * 3);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    const e1x = pos[i1] - pos[i0], e1y = pos[i1 + 1] - pos[i0 + 1], e1z = pos[i1 + 2] - pos[i0 + 2];
    const e2x = pos[i2] - pos[i0], e2y = pos[i2 + 1] - pos[i0 + 1], e2z = pos[i2 + 2] - pos[i0 + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    acc[i0] += nx; acc[i0 + 1] += ny; acc[i0 + 2] += nz;
    acc[i1] += nx; acc[i1 + 1] += ny; acc[i1 + 2] += nz;
    acc[i2] += nx; acc[i2 + 1] += ny; acc[i2 + 2] += nz;
  }
  for (let i = 0; i < vc; i++) {
    const o = i * 3;
    const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]);
    if (l > 1e-8) {
      acc[o] /= l; acc[o + 1] /= l; acc[o + 2] /= l;
    } else {
      acc[o] = 0; acc[o + 1] = 1; acc[o + 2] = 0;
    }
  }
  return acc;
}

function computeTangents(
  pos: Float32Array,
  nrm: Float32Array,
  uv: Float32Array | null,
  idx: Uint16Array | Uint32Array,
  vc: number,
): Float32Array {
  const out = new Float32Array(vc * 4);
  const tanAcc = new Float64Array(vc * 3);
  const bitAcc = new Float64Array(vc * 3);

  if (uv) {
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
      const u0 = uv[i0 * 2], v0 = uv[i0 * 2 + 1];
      const u1 = uv[i1 * 2], v1 = uv[i1 * 2 + 1];
      const u2 = uv[i2 * 2], v2 = uv[i2 * 2 + 1];
      const du1 = u1 - u0, db1 = -(v1 - v0);
      const du2 = u2 - u0, db2 = -(v2 - v0);
      const det = du1 * db2 - du2 * db1;
      if (Math.abs(det) > 1e-9) {
        const inv = 1 / det;
        const dp1x = pos[p1] - pos[p0], dp1y = pos[p1 + 1] - pos[p0 + 1], dp1z = pos[p1 + 2] - pos[p0 + 2];
        const dp2x = pos[p2] - pos[p0], dp2y = pos[p2 + 1] - pos[p0 + 1], dp2z = pos[p2 + 2] - pos[p0 + 2];
        const tdx = (dp1x * db2 - dp2x * db1) * inv;
        const tdy = (dp1y * db2 - dp2y * db1) * inv;
        const tdz = (dp1z * db2 - dp2z * db1) * inv;
        const bdx = (dp2x * du1 - dp1x * du2) * inv;
        const bdy = (dp2y * du1 - dp1y * du2) * inv;
        const bdz = (dp2z * du1 - dp1z * du2) * inv;
        for (const vi of [i0, i1, i2]) {
          const o = vi * 3;
          tanAcc[o] += tdx; tanAcc[o + 1] += tdy; tanAcc[o + 2] += tdz;
          bitAcc[o] += bdx; bitAcc[o + 1] += bdy; bitAcc[o + 2] += bdz;
        }
      }
    }
  }

  for (let i = 0; i < vc; i++) {
    const o3 = i * 3;
    const o4 = i * 4;
    let nx = nrm[o3], ny = nrm[o3 + 1], nz = nrm[o3 + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-8) { nx /= nl; ny /= nl; nz /= nl; } else { nx = 0; ny = 1; nz = 0; }
    const dotNT = nx * tanAcc[o3] + ny * tanAcc[o3 + 1] + nz * tanAcc[o3 + 2];
    let tx = tanAcc[o3] - nx * dotNT;
    let ty = tanAcc[o3 + 1] - ny * dotNT;
    let tz = tanAcc[o3 + 2] - nz * dotNT;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-8) {
      tx /= tl; ty /= tl; tz /= tl;
    } else {
      const rx = Math.abs(nx) < 0.9 ? 1 : 0;
      const rz = rx ? 0 : 1;
      tx = ny * rz;
      ty = nz * rx - nx * rz;
      tz = -ny * rx;
      const rl = Math.hypot(tx, ty, tz) || 1;
      tx /= rl; ty /= rl; tz /= rl;
    }
    const cx = ny * tz - nz * ty;
    const cy = nz * tx - nx * tz;
    const cz = nx * ty - ny * tx;
    const hand = (cx * bitAcc[o3] + cy * bitAcc[o3 + 1] + cz * bitAcc[o3 + 2]) >= 0 ? 1 : -1;
    out[o4] = tx; out[o4 + 1] = ty; out[o4 + 2] = tz; out[o4 + 3] = hand;
  }
  return out;
}

export function defaultMaterial(): GlbMaterial {
  return {
    name: 'default',
    baseColorFactor: [0.8, 0.8, 0.8, 1],
    metallicFactor: 0.0,
    roughnessFactor: 0.6,
    emissiveFactor: [0, 0, 0],
    emissiveStrength: 1.0,
    normalScale: 1.0,
    occlusionStrength: 1.0,
    clearcoatFactor: 0.0,
    clearcoatRoughnessFactor: 0.1,
    dielectricF0: 0.04,
    doubleSided: true,
    alphaMode: 'OPAQUE',
    alphaCutoff: 0.5,
    baseColorTexture: -1,
    metallicRoughnessTexture: -1,
    normalTexture: -1,
    occlusionTexture: -1,
    emissiveTexture: -1,
  };
}

export function parseGlb(buffer: ArrayBuffer): ParsedGlb {
  if (buffer.byteLength < 20) throw new Error('File is too small to be a valid .glb');
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) throw new Error('Invalid GLB header (expected binary glTF 2.0)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error('Unsupported glTF version: ' + version);

  let offset = 12;
  let gltf: RawGltf | null = null;
  let binBytes: Uint8Array = new Uint8Array(0);

  while (offset + 8 <= buffer.byteLength) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLen > buffer.byteLength) throw new Error('Truncated GLB chunk');
    if (chunkType === CHUNK_JSON) {
      const jsonText = new TextDecoder('utf-8').decode(new Uint8Array(buffer, offset, chunkLen));
      gltf = JSON.parse(jsonText) as RawGltf;
    } else if (chunkType === CHUNK_BIN) {
      binBytes = new Uint8Array(buffer, offset, chunkLen);
    }
    offset += chunkLen;
  }

  if (!gltf) throw new Error('GLB is missing its JSON chunk');
  const binView = new DataView(binBytes.buffer, binBytes.byteOffset, binBytes.byteLength);

  // Extract embedded images
  const images: GlbImage[] = (gltf.images || []).map(img => {
    if (img.bufferView === undefined) return { bytes: new Uint8Array(0), mimeType: img.mimeType || 'image/png' };
    const bv = gltf!.bufferViews?.[img.bufferView];
    if (!bv) return { bytes: new Uint8Array(0), mimeType: img.mimeType || 'image/png' };
    const start = bv.byteOffset || 0;
    return {
      bytes: binBytes.slice(start, start + bv.byteLength),
      mimeType: img.mimeType || 'image/png',
    };
  });

  // Extract textures + samplers
  const samplers = gltf.samplers || [];
  const textures: GlbTexture[] = (gltf.textures || []).map(tx => {
    const smp = tx.sampler !== undefined ? samplers[tx.sampler] : undefined;
    return {
      source: tx.source ?? -1,
      wrapS: smp?.wrapS ?? 10497, // REPEAT
      wrapT: smp?.wrapT ?? 10497,
    };
  });

  // Extract materials
  const materials: GlbMaterial[] = (gltf.materials || []).map(m => {
    const pbr = m.pbrMetallicRoughness || {};
    const bcf = pbr.baseColorFactor;
    const ef = m.emissiveFactor;
    return {
      name: m.name || '',
      baseColorFactor: bcf && bcf.length === 4 ? [bcf[0], bcf[1], bcf[2], bcf[3]] : [1, 1, 1, 1],
      metallicFactor: pbr.metallicFactor ?? 1.0,
      roughnessFactor: pbr.roughnessFactor ?? 1.0,
      emissiveFactor: ef && ef.length === 3 ? [ef[0], ef[1], ef[2]] : [0, 0, 0],
      emissiveStrength: m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1.0,
      normalScale: m.normalTexture?.scale ?? 1.0,
      occlusionStrength: m.occlusionTexture?.strength ?? 1.0,
      clearcoatFactor: m.extensions?.KHR_materials_clearcoat?.clearcoatFactor ?? 0.0,
      clearcoatRoughnessFactor: m.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessFactor ?? 0.1,
      dielectricF0: (() => {
        const ior = m.extensions?.KHR_materials_ior?.ior ?? 1.5;
        const spec = m.extensions?.KHR_materials_specular?.specularFactor ?? 1.0;
        const f = (ior - 1.0) / (ior + 1.0);
        return Math.min(0.25, Math.max(0.01, f * f * spec));
      })(),
      doubleSided: Boolean(m.doubleSided),
      alphaMode: m.alphaMode || 'OPAQUE',
      alphaCutoff: m.alphaCutoff ?? 0.5,
      baseColorTexture: pbr.baseColorTexture?.index ?? -1,
      metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index ?? -1,
      normalTexture: m.normalTexture?.index ?? -1,
      occlusionTexture: m.occlusionTexture?.index ?? -1,
      emissiveTexture: m.emissiveTexture?.index ?? -1,
    };
  });

  // Extract meshes & primitives
  const meshes: GlbMesh[] = (gltf.meshes || []).map(m => {
    const primitives: GlbPrimitive[] = [];
    for (const pr of m.primitives || []) {
      const mode = pr.mode ?? 4;
      if (mode !== 4) continue; // TRIANGLES only
      const attrs = pr.attributes || {};
      if (attrs.POSITION === undefined) continue;
      const pos = readAccessorFloat(gltf!, binView, attrs.POSITION);
      const vc = pos.length / 3;
      const indices = pr.indices !== undefined
        ? readIndices(gltf!, binView, pr.indices, vc)
        : (() => {
            const arr = vc > 65535 ? new Uint32Array(vc) : new Uint16Array(vc);
            for (let i = 0; i < vc; i++) arr[i] = i;
            return arr;
          })();
      const nrm = attrs.NORMAL !== undefined
        ? readAccessorFloat(gltf!, binView, attrs.NORMAL)
        : computeNormals(pos, indices, vc);
      const uv = attrs.TEXCOORD_0 !== undefined
        ? readAccessorFloat(gltf!, binView, attrs.TEXCOORD_0)
        : null;
      const tan = attrs.TANGENT !== undefined
        ? readAccessorFloat(gltf!, binView, attrs.TANGENT)
        : computeTangents(pos, nrm, uv, indices, vc);

      let skinData: Float32Array | null = null;
      if (attrs.JOINTS_0 !== undefined && attrs.WEIGHTS_0 !== undefined) {
        const jArr = readAccessorFloat(gltf!, binView, attrs.JOINTS_0);
        const wArr = readAccessorFloat(gltf!, binView, attrs.WEIGHTS_0);
        skinData = new Float32Array(vc * 8);
        for (let i = 0; i < vc; i++) {
          const o4 = i * 4;
          const o8 = i * 8;
          let w0 = wArr[o4], w1 = wArr[o4 + 1], w2 = wArr[o4 + 2], w3 = wArr[o4 + 3];
          const sum = w0 + w1 + w2 + w3;
          if (sum > 1e-6) {
            const inv = 1 / sum;
            w0 *= inv; w1 *= inv; w2 *= inv; w3 *= inv;
          } else {
            w0 = 1; w1 = 0; w2 = 0; w3 = 0;
          }
          skinData[o8] = jArr[o4];
          skinData[o8 + 1] = jArr[o4 + 1];
          skinData[o8 + 2] = jArr[o4 + 2];
          skinData[o8 + 3] = jArr[o4 + 3];
          skinData[o8 + 4] = w0;
          skinData[o8 + 5] = w1;
          skinData[o8 + 6] = w2;
          skinData[o8 + 7] = w3;
        }
      }

      const vertices = new Float32Array(vc * 12);
      const b = emptyBounds();
      for (let i = 0; i < vc; i++) {
        const o12 = i * 12;
        const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
        expandBounds(b, px, py, pz);
        vertices[o12] = px; vertices[o12 + 1] = py; vertices[o12 + 2] = pz;
        vertices[o12 + 3] = nrm[i * 3]; vertices[o12 + 4] = nrm[i * 3 + 1]; vertices[o12 + 5] = nrm[i * 3 + 2];
        vertices[o12 + 6] = tan[i * 4]; vertices[o12 + 7] = tan[i * 4 + 1]; vertices[o12 + 8] = tan[i * 4 + 2]; vertices[o12 + 9] = tan[i * 4 + 3];
        vertices[o12 + 10] = uv ? uv[i * 2] : 0;
        vertices[o12 + 11] = uv ? uv[i * 2 + 1] : 0;
      }
      primitives.push({
        vertices,
        skinData,
        indices,
        indexCount: indices.length,
        materialIndex: pr.material ?? -1,
        hasUV: Boolean(uv),
        bounds: b,
      });
    }
    return { name: m.name || '', primitives };
  });

  // Extract skins (joint lists + inverse bind matrices)
  const skins: GlbSkin[] = (gltf.skins || []).map(sk => {
    const joints = (sk.joints || []).slice();
    const ibms: Float32Array[] = [];
    if (sk.inverseBindMatrices !== undefined) {
      const flat = readAccessorFloat(gltf!, binView, sk.inverseBindMatrices);
      for (let j = 0; j < joints.length; j++) {
        const start = j * 16;
        if (start + 16 <= flat.length) {
          ibms.push(flat.slice(start, start + 16));
        } else {
          ibms.push(M4.ident());
        }
      }
    } else {
      for (let j = 0; j < joints.length; j++) ibms.push(M4.ident());
    }
    return {
      name: sk.name || '',
      joints,
      inverseBindMatrices: ibms,
    };
  });

  // Flatten node hierarchy parent-first
  const rawNodes = gltf.nodes || [];
  const sceneIdx = gltf.scene ?? 0;
  const roots = gltf.scenes?.[sceneIdx]?.nodes || (rawNodes.length ? [0] : []);
  const nodes: GlbNode[] = [];
  const nodeIndexToPos = new Map<number, number>();
  const visited = new Set<number>();

  function visit(ni: number, parentPos: number): void {
    if (visited.has(ni) || !rawNodes[ni]) return;
    visited.add(ni);
    const nd = rawNodes[ni];
    const myPos = nodes.length;
    nodeIndexToPos.set(ni, myPos);
    const t = nd.translation;
    const r = nd.rotation;
    const s = nd.scale;
    nodes.push({
      nodeIndex: ni,
      name: nd.name || '',
      mesh: nd.mesh ?? -1,
      skin: nd.skin ?? -1,
      parent: parentPos,
      translation: t && t.length === 3 ? [t[0], t[1], t[2]] : [0, 0, 0],
      rotation: r && r.length === 4 ? [r[0], r[1], r[2], r[3]] : [0, 0, 0, 1],
      scale: s && s.length === 3 ? [s[0], s[1], s[2]] : [1, 1, 1],
      matrix: nd.matrix && nd.matrix.length === 16 ? new Float32Array(nd.matrix) : null,
    });
    for (const ch of nd.children || []) visit(ch, myPos);
  }
  for (const r of roots) visit(r, -1);

  // Compute resting-pose world bounds & triangle count
  const worldMats: Float32Array[] = new Array(nodes.length);
  const sceneBounds = emptyBounds();
  let triangleCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const loc = nd.matrix ? nd.matrix : M4.trs(nd.translation, nd.rotation, nd.scale);
    worldMats[i] = nd.parent < 0 ? loc : M4.mul(worldMats[nd.parent], loc);
    if (nd.mesh >= 0 && meshes[nd.mesh]) {
      for (const pr of meshes[nd.mesh].primitives) {
        triangleCount += Math.floor(pr.indexCount / 3);
        const { min, max } = pr.bounds;
        if (!Number.isFinite(min[0])) continue;
        // Transform all 8 AABB corners for tight world bounds
        for (const cx of [min[0], max[0]]) {
          for (const cy of [min[1], max[1]]) {
            for (const cz of [min[2], max[2]]) {
              const p = M4.transformPoint(worldMats[i], cx, cy, cz);
              expandBounds(sceneBounds, p[0], p[1], p[2]);
            }
          }
        }
      }
    }
  }

  // Extract animations
  const animations: GlbAnimation[] = [];
  for (const anim of gltf.animations || []) {
    const channels: GlbAnimChannel[] = [];
    let duration = 0;
    const rawSamplers = anim.samplers || [];
    for (const ch of anim.channels || []) {
      const nodeIndex = ch.target?.node;
      const path = ch.target?.path;
      if (nodeIndex === undefined || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) continue;
      const smp = rawSamplers[ch.sampler];
      if (!smp) continue;
      const times = readAccessorFloat(gltf, binView, smp.input);
      const values = readAccessorFloat(gltf, binView, smp.output);
      if (!times.length) continue;
      const lastT = times[times.length - 1];
      if (lastT > duration) duration = lastT;
      const interp = smp.interpolation === 'STEP' || smp.interpolation === 'CUBICSPLINE' ? smp.interpolation : 'LINEAR';
      channels.push({ nodeIndex, path, interpolation: interp, times, values });
    }
    if (channels.length && duration > 0) {
      animations.push({ name: anim.name || 'Animation', duration, channels });
    }
  }

  // Expand vertical bounds across the first animation cycle so animated parts
  // (e.g. banking wings, pitching hulls, rotating gear) never clip the floor.
  if (animations.length && nodes.length) {
    const anim0 = animations[0];
    const samples = 24;
    const animWorld: Float32Array[] = new Array(nodes.length);
    for (let s = 0; s < samples; s++) {
      const poses = evaluateAnimation(anim0, (s / samples) * anim0.duration);
      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i];
        const pose = poses.get(nd.nodeIndex);
        const loc = !pose && nd.matrix
          ? nd.matrix
          : M4.trs(
              pose?.translation || nd.translation,
              pose?.rotation || nd.rotation,
              pose?.scale || nd.scale,
            );
        animWorld[i] = nd.parent < 0 ? loc : M4.mul(animWorld[nd.parent], loc);
        if (nd.mesh < 0 || nd.skin >= 0 || !meshes[nd.mesh]) continue;
        for (const pr of meshes[nd.mesh].primitives) {
          const { min, max } = pr.bounds;
          if (!Number.isFinite(min[0])) continue;
          for (const cx of [min[0], max[0]]) {
            for (const cy of [min[1], max[1]]) {
              for (const cz of [min[2], max[2]]) {
                const p = M4.transformPoint(animWorld[i], cx, cy, cz);
                if (p[1] < sceneBounds.min[1]) sceneBounds.min[1] = p[1];
                if (p[1] > sceneBounds.max[1]) sceneBounds.max[1] = p[1];
              }
            }
          }
        }
      }
    }
  }

  return {
    meshes,
    nodes,
    nodeIndexToPos,
    skins,
    materials,
    textures,
    images,
    animations,
    bounds: sceneBounds,
    center: boundsCenter(sceneBounds),
    radius: boundsRadius(sceneBounds),
    triangleCount,
  };
}

export function evaluateAnimation(anim: GlbAnimation, timeSec: number): Map<number, NodePose> {
  const poses = new Map<number, NodePose>();
  const t = anim.duration > 0 ? ((timeSec % anim.duration) + anim.duration) % anim.duration : 0;

  for (const ch of anim.channels) {
    const { times, values, interpolation, path } = ch;
    const n = times.length;
    if (!n) continue;
    const stride = path === 'rotation' ? 4 : 3;
    const cubic = interpolation === 'CUBICSPLINE';
    const elemStride = cubic ? stride * 3 : stride;

    // Binary search for keyframe interval
    let i0 = 0;
    let i1 = 0;
    let alpha = 0;
    if (t <= times[0]) {
      i0 = i1 = 0;
    } else if (t >= times[n - 1]) {
      i0 = i1 = n - 1;
    } else {
      let lo = 0, hi = n - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid; else hi = mid;
      }
      i0 = lo;
      i1 = hi;
      const dt = times[i1] - times[i0];
      alpha = dt > 1e-8 ? (t - times[i0]) / dt : 0;
    }

    const base0 = i0 * elemStride + (cubic ? stride : 0);
    const base1 = i1 * elemStride + (cubic ? stride : 0);

    let pose = poses.get(ch.nodeIndex);
    if (!pose) { pose = {}; poses.set(ch.nodeIndex, pose); }

    if (path === 'rotation') {
      const q0: Quat = [values[base0], values[base0 + 1], values[base0 + 2], values[base0 + 3]];
      if (i0 === i1 || interpolation === 'STEP') {
        pose.rotation = quatNormalize(q0);
      } else {
        const q1: Quat = [values[base1], values[base1 + 1], values[base1 + 2], values[base1 + 3]];
        pose.rotation = quatSlerp(q0, q1, alpha);
      }
    } else {
      const v0: Vec3 = [values[base0], values[base0 + 1], values[base0 + 2]];
      let res: Vec3;
      if (i0 === i1 || interpolation === 'STEP') {
        res = v0;
      } else {
        res = [
          v0[0] + (values[base1] - v0[0]) * alpha,
          v0[1] + (values[base1 + 1] - v0[1]) * alpha,
          v0[2] + (values[base1 + 2] - v0[2]) * alpha,
        ];
      }
      if (path === 'translation') pose.translation = res;
      else pose.scale = res;
    }
  }
  return poses;
}

export interface RigBoneInfo {
  nodeIndex: number;
  name: string;
  parentNodeIndex: number;
  isMuzzle: boolean;
}

export interface RigInfo {
  hasSkin: boolean;
  bones: RigBoneInfo[];
  turretYawNodes: number[];
  gunPitchNodes: number[];
  waistNodes: number[];
  steerFrontNodes: number[];
  steerMidNodes: number[];
  spinNodes: number[];
  muzzleNodes: number[];
}

export function inspectRig(parsed: ParsedGlb): RigInfo {
  const bones: RigBoneInfo[] = [];
  const seen = new Set<number>();
  const turretYawNodes: number[] = [];
  const gunPitchNodes: number[] = [];
  const waistNodes: number[] = [];
  const steerFrontNodes: number[] = [];
  const steerMidNodes: number[] = [];
  const spinNodes: number[] = [];
  const muzzleNodes: number[] = [];

  for (const sk of parsed.skins) {
    for (const jNodeIdx of sk.joints) {
      if (seen.has(jNodeIdx)) continue;
      seen.add(jNodeIdx);
      const pos = parsed.nodeIndexToPos.get(jNodeIdx);
      if (pos === undefined) continue;
      const nd = parsed.nodes[pos];
      const name = nd.name || `joint_${jNodeIdx}`;
      const parentNodeIndex = nd.parent >= 0 ? parsed.nodes[nd.parent].nodeIndex : -1;
      const isMuzzle = /^muzzle/i.test(name);
      bones.push({ nodeIndex: jNodeIdx, name, parentNodeIndex, isMuzzle });

      if (isMuzzle) {
        muzzleNodes.push(jNodeIdx);
      } else if (/waist.*yaw/i.test(name)) {
        waistNodes.push(jNodeIdx);
      } else if (/turret.*yaw/i.test(name) || /^yaw$/i.test(name)) {
        turretYawNodes.push(jNodeIdx);
      } else if (/(gun|barrel|mortar|rocket|pod|cannon).*pitch/i.test(name) || /^pitch$/i.test(name)) {
        gunPitchNodes.push(jNodeIdx);
      } else if (/F[LR]?2.*steer/i.test(name)) {
        steerMidNodes.push(jNodeIdx);
      } else if (/steer/i.test(name)) {
        steerFrontNodes.push(jNodeIdx);
      } else if (/(barrel_spin|rotor.*spin|turbine.*spin|saw.*spin|auger.*spin)/i.test(name)) {
        spinNodes.push(jNodeIdx);
      }
    }
  }

  return {
    hasSkin: parsed.skins.length > 0 && bones.length > 0,
    bones,
    turretYawNodes,
    gunPitchNodes,
    waistNodes,
    steerFrontNodes,
    steerMidNodes,
    spinNodes,
    muzzleNodes,
  };
}
