// scenes.ts - procedural terrain geometry and GLSL shaders for the 5 viewer environments:
// 0 = studio, 1 = ground, 2 = sky, 3 = seabed, 4 = space.

import type { ViewerScene } from './options.js';

export const SCENE_IDS: Record<ViewerScene, number> = {
  studio: 0,
  ground: 1,
  sky: 2,
  seabed: 3,
  space: 4,
};

export interface TerrainGeometry {
  /** Interleaved [pos(3), norm(3), uv(2)] = 8 floats per vertex. */
  vertices: Float32Array;
  indices: Uint16Array;
  indexCount: number;
}

function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function ridged2(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, z * freq) * 2 - 1);
    n = n * n * weight;
    weight = Math.max(0.2, Math.min(1, n * 1.6));
    sum += n * amp;
    freq *= 2.05;
    amp *= 0.5;
  }
  return sum;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function sampleHeight(kind: 'ground' | 'seabed', x: number, z: number): number {
  const r = Math.hypot(x, z);
  // Level central staging pad (r < 3.1) blending smoothly into sculpted surroundings
  const pad = smoothstep(3.1, 8.8, r);
  const outer = smoothstep(10.5, 40.0, r);

  if (kind === 'seabed') {
    const dunes = Math.sin(x * 0.45 + z * 0.22 + fbm2(x * 0.11, z * 0.11, 3) * 3.2) * 0.26;
    const reef = (ridged2(x * 0.085 + 5.1, z * 0.085 - 3.4, 4) - 0.35) * 3.6;
    const canyon = outer * (fbm2(x * 0.032 - 2.4, z * 0.032 + 5.8, 3) * 6.2);
    return (dunes + reef) * pad + canyon;
  }

  // Ground: smooth, low-profile highland plateau tapering cleanly to y=0 at the outer rim
  const rimTaper = 1.0 - smoothstep(44.0, 74.0, r);
  const rolling = (fbm2(x * 0.055 + 1.4, z * 0.055 + 2.9, 4) - 0.48) * 1.45;
  const knolls = Math.pow(Math.max(0, fbm2(x * 0.095 - 2.8, z * 0.095 + 4.3, 3) - 0.42), 1.5) * 1.85;
  const gentleSlope = outer * (fbm2(x * 0.025 + 6.4, z * 0.025 - 5.2, 3) - 0.42) * 2.4;
  return ((rolling + knolls) * pad + gentleSlope) * rimTaper;
}

/**
 * Build a radially-concentrated 72x72 terrain mesh with exact finite-difference normals.
 * Vertex density is highest around the unit (r < 10) and stretches smoothly to the horizon.
 */
export function buildTerrainMesh(kind: 'ground' | 'seabed'): TerrainGeometry {
  const N = 72;
  const verts = new Float32Array((N + 1) * (N + 1) * 8);
  const extent = 82;

  const mapCoord = (u: number): number => {
    const s = u * 2 - 1;
    return s * (0.36 + 0.64 * s * s) * extent;
  };

  let vo = 0;
  for (let iz = 0; iz <= N; iz++) {
    const vz = iz / N;
    const z = mapCoord(vz);
    for (let ix = 0; ix <= N; ix++) {
      const vx = ix / N;
      const x = mapCoord(vx);
      const y = sampleHeight(kind, x, z);

      const eps = 0.22;
      const hx = sampleHeight(kind, x + eps, z) - sampleHeight(kind, x - eps, z);
      const hz = sampleHeight(kind, x, z + eps) - sampleHeight(kind, x, z - eps);
      let nx = -hx / (2 * eps);
      let ny = 1.0;
      let nz = -hz / (2 * eps);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      verts[vo++] = x;
      verts[vo++] = y;
      verts[vo++] = z;
      verts[vo++] = nx;
      verts[vo++] = ny;
      verts[vo++] = nz;
      verts[vo++] = vx;
      verts[vo++] = vz;
    }
  }

  const idx = new Uint16Array(N * N * 6);
  let io = 0;
  const row = N + 1;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx[io++] = a; idx[io++] = c; idx[io++] = b;
      idx[io++] = b; idx[io++] = c; idx[io++] = d;
    }
  }
  return { vertices: verts, indices: idx, indexCount: idx.length };
}

// ============================================================================
// Fullscreen Sky & Backdrop Dome Shader (renders behind everything, depth off)
// ============================================================================

export const SKY_VS = `
  attribute vec2 aPos;
  varying vec2 vNdc;
  void main() {
    vNdc = aPos;
    gl_Position = vec4(aPos, 0.9999, 1.0);
  }
`;

export const SKY_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec2 vNdc;

  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform vec3 uCamFwd;
  uniform float uTanHalfFov;
  uniform float uAspect;
  uniform float uScene;
  uniform float uTime;

  vec3 agx(vec3 c) {
    const mat3 M = mat3(
      0.842479062253094, 0.0423282422610123, 0.0423756549057051,
      0.0784335999999992, 0.878468636469772, 0.0784336,
      0.0792237451477643, 0.0791661274605434, 0.879142973793104
    );
    const mat3 MI = mat3(
      1.19687900512017, -0.0528968517574562, -0.0529716355144438,
      -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
      -0.0990297440797205, -0.0989611768448433, 1.15107367264116
    );
    vec3 v = M * max(c, vec3(1e-10));
    v = (clamp(log2(v), -12.47393, 4.026069) + 12.47393) / 16.5;
    vec3 v2 = v * v;
    vec3 v4 = v2 * v2;
    v = 15.5 * v4 * v2 - 40.14 * v4 * v + 31.96 * v4 - 6.868 * v2 * v + 0.4298 * v2 + 0.1191 * v - 0.00232;
    vec3 outCol = clamp(MI * v, 0.0, 1.0);
    // Subtle punchy look matching the PBR model pass
    vec3 punch = pow(max(outCol, vec3(1e-5)), vec3(1.12));
    float luma = dot(punch, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luma), punch, 1.18), 0.0, 1.0);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm4(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      s += a * noise2(p);
      p = rot * p * 2.04;
      a *= 0.5;
    }
    return s;
  }

  float fbm6(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 6; i++) {
      s += a * noise2(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return s;
  }

  float ridged4(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      float n = 1.0 - abs(noise2(p) * 2.0 - 1.0);
      s += n * n * a;
      p = rot * p * 2.06;
      a *= 0.5;
    }
    return s;
  }

  vec3 starLayer(vec3 d, float scale, float density, float brightness) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash31(id);
    if (r < density) return vec3(0.0);
    vec3 jitter = vec3(hash31(id + 7.1), hash31(id + 13.7), hash31(id + 29.3)) - 0.5;
    float dist = length(f - jitter * 0.58);
    float core = smoothstep(0.15, 0.012, dist);
    float mag = pow((r - density) / (1.0 - density), 2.2);
    float tint = hash31(id + 53.9);
    vec3 col = mix(vec3(0.65, 0.82, 1.0), vec3(1.0, 0.86, 0.64), tint);
    return col * core * mag * brightness;
  }

  // Self-shadowed volumetric cloud plane sample (returns rgb = lit color, a = opacity)
  vec4 sampleCloudPlane(vec2 uv, vec2 sunStep, float coverage, float sunCos, vec3 litCol, vec3 shadowCol) {
    vec2 warp = vec2(fbm4(uv * 0.55 + vec2(1.3, 2.7)), fbm4(uv * 0.55 - vec2(3.1, 1.9))) - 0.5;
    float d0 = fbm6(uv + warp * 0.55);
    float d1 = fbm4(uv + warp * 0.55 + sunStep);
    float dens = smoothstep(coverage, coverage + 0.30, d0);
    float thickness = clamp((d1 - d0) * 3.8 + 0.52, 0.0, 1.0);
    float silver = pow(sunCos, 5.0) * (1.0 - dens * 0.55) * smoothstep(0.1, 0.8, dens);
    vec3 c = mix(shadowCol, litCol, clamp(1.0 - thickness * 0.85, 0.0, 1.0));
    c += vec3(1.4, 1.05, 0.65) * silver * 0.85;
    return vec4(c, dens);
  }

  void main() {
    vec3 rd = normalize(
      uCamFwd
      + uCamRight * (vNdc.x * uAspect * uTanHalfFov)
      + uCamUp    * (vNdc.y * uTanHalfFov)
    );

    // 0: Studio cyclorama
    if (uScene < 0.5) {
      float v = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 bg = mix(vec3(0.025, 0.028, 0.035), vec3(0.082, 0.090, 0.108), smoothstep(0.22, 0.82, v));
      float vig = 1.0 - 0.24 * dot(vNdc, vNdc);
      gl_FragColor = vec4(agx(bg * vig), 1.0);
      return;
    }

    // 1: Ground (crisp golden-hour alpine sky + sculpted clouds + 3-layer mountain panorama)
    if (uScene < 1.5) {
      vec3 sunDir = normalize(vec3(-0.48, 0.36, 0.80));
      float y = clamp(rd.y, -0.2, 1.0);
      vec3 zenith  = vec3(0.032, 0.118, 0.360);
      vec3 midSky  = vec3(0.165, 0.385, 0.720);
      vec3 horizon = vec3(1.020, 0.780, 0.520);
      vec3 col = mix(horizon, midSky, smoothstep(-0.02, 0.24, y));
      col = mix(col, zenith, smoothstep(0.18, 0.80, y));

      float sunCos = max(dot(rd, sunDir), 0.0);
      col += vec3(1.05, 0.72, 0.40) * pow(sunCos, 5.0) * 0.48;
      col += vec3(1.15, 0.94, 0.72) * pow(sunCos, 56.0) * 1.25;
      col += vec3(4.2, 3.6, 2.8) * smoothstep(0.9986, 0.9996, sunCos);

      // Sculpted self-shadowed cumulus clouds overhead
      if (rd.y > 0.015) {
        vec2 cuv = rd.xz / (rd.y + 0.14) * 0.78 + vec2(uTime * 0.004, -uTime * 0.002);
        vec2 sStep = normalize(sunDir.xz) * 0.18;
        vec4 cl = sampleCloudPlane(
          cuv, sStep, 0.46, sunCos,
          vec3(1.28, 1.12, 0.94),
          vec3(0.28, 0.36, 0.52)
        );
        float hFade = smoothstep(0.015, 0.22, rd.y);
        col = mix(col, cl.rgb, cl.a * hFade * 0.82);
      }

      // 3-layer seamless 360-degree alpine mountain panorama (sampled on unit circle, zero atan seam!)
      vec2 dirXZ = normalize(rd.xz + vec2(1e-6, 0.0));
      float mFar  = ridged4(dirXZ * 2.4 + vec2(1.3, 2.1)) * 0.140 + 0.022;
      float mMid  = ridged4(dirXZ * 3.9 + vec2(6.2, 3.1)) * 0.090 + 0.004;
      float mNear = ridged4(dirXZ * 6.4 + vec2(-3.9, 5.7)) * 0.048 - 0.010;

      vec3 farCol  = mix(vec3(0.24, 0.34, 0.50), horizon * 0.78, 0.48 + 0.25 * pow(sunCos, 2.0));
      vec3 midCol  = mix(vec3(0.14, 0.20, 0.30), horizon * 0.42, 0.32);
      vec3 nearCol = vec3(0.075, 0.095, 0.125);

      if (rd.y < mFar)  col = mix(farCol,  col, smoothstep(mFar  - 0.010, mFar,  rd.y));
      if (rd.y < mMid)  col = mix(midCol,  col, smoothstep(mMid  - 0.008, mMid,  rd.y));
      if (rd.y < mNear) col = mix(nearCol, col, smoothstep(mNear - 0.006, mNear, rd.y));

      // Ground hemisphere base color beneath horizon so alpha-faded terrain rim blends invisibly
      vec3 groundHaze = mix(vec3(0.42, 0.46, 0.52), horizon * 0.84, pow(sunCos, 2.0) * 0.55 + 0.25);
      col = mix(groundHaze, col, smoothstep(-0.08, 0.03, rd.y));

      gl_FragColor = vec4(agx(col), 1.0);
      return;
    }

    // 2: Sky (high-altitude golden-hour dome + multi-layer volumetric cloud sea below!)
    if (uScene < 2.5) {
      vec3 sunDir = normalize(vec3(-0.52, 0.28, 0.81));
      float y = rd.y;
      vec3 deepZenith = vec3(0.018, 0.072, 0.260);
      vec3 midAzure   = vec3(0.125, 0.345, 0.680);
      vec3 warmHaze   = vec3(1.120, 0.790, 0.480);
      vec3 deepEarth  = vec3(0.045, 0.105, 0.210);

      vec3 col = mix(deepEarth, warmHaze, smoothstep(-0.42, 0.01, y));
      col = mix(col, midAzure, smoothstep(0.01, 0.32, y));
      col = mix(col, deepZenith, smoothstep(0.28, 0.86, y));

      float sunCos = max(dot(rd, sunDir), 0.0);
      col += vec3(1.15, 0.70, 0.34) * pow(sunCos, 4.5) * 0.58;
      col += vec3(1.25, 0.96, 0.68) * pow(sunCos, 44.0) * 1.45;
      col += vec3(4.8, 4.0, 3.0) * smoothstep(0.9985, 0.9996, sunCos);

      // Upper stratospheric cirrus streaks
      if (rd.y > 0.05) {
        vec2 cuv = rd.xz / (rd.y + 0.22) * 0.62 + vec2(uTime * 0.009, uTime * 0.003);
        float wisps = smoothstep(0.50, 0.82, fbm4(vec2(cuv.x * 2.4, cuv.y * 0.65)));
        vec3 wCol = mix(vec3(0.85, 0.90, 1.0), vec3(1.30, 1.05, 0.82), 0.4 + 0.6 * sunCos);
        col = mix(col, wCol, wisps * smoothstep(0.05, 0.28, rd.y) * 0.44);
      }

      // Two parallax volumetric cloud-sea layers below the aircraft (infinite crisp resolution!)
      if (rd.y < 0.03) {
        float downY = max(-rd.y, 0.032);
        vec2 sStep = normalize(sunDir.xz) * 0.22;

        // Lower distant stratus layer (gives rich depth through breaks in the main cumulus deck)
        vec2 uvLo = rd.xz / (downY + 0.06) * 0.65 + vec2(uTime * 0.025, -uTime * 0.012);
        vec4 clLo = sampleCloudPlane(
          uvLo, sStep * 0.8, 0.36, sunCos,
          vec3(0.88, 0.78, 0.72),
          vec3(0.14, 0.20, 0.34)
        );
        // Main foreground cumulus sea directly beneath the aircraft
        vec2 uvHi = rd.xz / (downY + 0.14) * 1.05 + vec2(uTime * 0.048, -uTime * 0.022);
        vec4 clHi = sampleCloudPlane(
          uvHi, sStep * 1.15, 0.41, sunCos,
          vec3(1.36, 1.16, 0.94),
          vec3(0.22, 0.30, 0.48)
        );

        // Soft horizon atmospheric blend
        float horizonBlend = smoothstep(0.02, -0.14, rd.y);
        vec3 cloudSea = mix(col, clLo.rgb, clLo.a * 0.88);
        cloudSea = mix(cloudSea, clHi.rgb, clHi.a * 0.94);

        // Blend seamlessly into the golden horizon haze near rd.y ~ 0
        vec3 hGlow = mix(vec3(0.45, 0.56, 0.76), warmHaze * 0.95, 0.45 + 0.55 * pow(sunCos, 2.0));
        float distFade = exp(-downY * 5.8);
        cloudSea = mix(cloudSea, hGlow, distFade * 0.88);
        col = mix(col, cloudSea, horizonBlend);
      }

      gl_FragColor = vec4(agx(col), 1.0);
      return;
    }

    // 3: Seabed (luminous ocean surface Snell's window + god-rays + suspended marine snow)
    if (uScene < 3.5) {
      float y = rd.y;
      vec3 abyss   = vec3(0.006, 0.032, 0.062);
      vec3 midSea  = vec3(0.018, 0.125, 0.185);
      vec3 surface = vec3(0.130, 0.520, 0.590);

      vec3 col = mix(abyss, midSea, smoothstep(-0.45, 0.16, y));
      col = mix(col, surface, smoothstep(0.16, 0.76, y));

      // Shimmering ocean surface Snell's window overhead
      if (rd.y > 0.06) {
        vec2 suv = rd.xz / (rd.y + 0.12) * 1.5;
        float w1 = noise2(suv * 2.6 + vec2(uTime * 0.22, -uTime * 0.14));
        float w2 = noise2(suv * 5.2 - vec2(uTime * 0.16, uTime * 0.24));
        float ripple = smoothstep(0.40, 0.76, w1 * 0.58 + w2 * 0.42);
        float snell = smoothstep(0.24, 0.86, rd.y);
        col += vec3(0.46, 0.94, 0.98) * ripple * snell * 0.82;
        col += vec3(0.70, 1.00, 0.98) * pow(max(dot(rd, normalize(vec3(-0.2, 0.95, 0.22))), 0.0), 12.0) * 0.92;
      }

      // Volumetric slanting god-rays (seamless 360-degree unit-circle sampling, zero atan seam)
      vec2 rayDir = normalize(rd.xz + vec2(1e-6, 0.0));
      float r1 = noise2(rayDir * 3.8 + vec2(rd.y * 1.8 + uTime * 0.08, 1.3));
      float r2 = noise2(rayDir * 7.2 + vec2(rd.y * 2.6 - uTime * 0.06, 4.7));
      float shafts = pow(clamp(r1 * 0.58 + r2 * 0.42, 0.0, 1.0), 2.5);
      float rayMask = smoothstep(-0.20, 0.52, rd.y) * (1.0 - smoothstep(0.75, 0.98, rd.y));
      col += vec3(0.13, 0.50, 0.56) * shafts * rayMask * 0.62;

      // Subtle drifting marine snow specks
      vec3 snow = starLayer(normalize(rd + vec3(0.0, -uTime * 0.012, 0.0)), 44.0, 0.985, 0.55);
      col += vec3(0.32, 0.72, 0.76) * length(snow) * 0.35;

      gl_FragColor = vec4(agx(col), 1.0);
      return;
    }

    // 4: Space (crisp starfield + subtle nebula + high-detail planet limb with city lights & ocean glint)
    vec3 col = vec3(0.0020, 0.0032, 0.0075);

    // Subtle cosmic nebula dust lanes along tilted galactic plane (seamless 3D projection, zero atan seam)
    vec3 gDir = normalize(vec3(rd.x * 0.86 - rd.y * 0.50, rd.x * 0.50 + rd.y * 0.86, rd.z));
    float galBand = exp(-abs(gDir.y) * 3.0);
    vec2 nebUV = gDir.xz * 2.2 + vec2(gDir.y * 1.4, -gDir.y * 1.1);
    float n1 = fbm4(nebUV * 1.3 + vec2(2.1, -1.3));
    float n2 = fbm4(nebUV * 2.6 - vec2(4.5, 2.7));
    float dust = smoothstep(0.30, 0.78, n1 * 0.62 + n2 * 0.38);
    col += mix(vec3(0.016, 0.042, 0.105), vec3(0.085, 0.036, 0.095), n2) * dust * galBand * 1.05;
    col += vec3(0.022, 0.068, 0.085) * smoothstep(0.46, 0.82, n2) * galBand * 0.72;

    // Multi-scale crisp starfield
    col += starLayer(rd,  64.0, 0.966, 2.9);
    col += starLayer(rd, 128.0, 0.974, 1.7);
    col += starLayer(rd, 224.0, 0.980, 0.95);

    // Distant orbital sun flare
    vec3 sunDir = normalize(vec3(-0.48, 0.56, 0.67));
    float sc = max(dot(rd, sunDir), 0.0);
    col += vec3(1.0, 0.90, 0.76) * pow(sc, 28.0) * 0.38;
    col += vec3(3.0, 2.8, 2.4) * smoothstep(0.9992, 0.99985, sc);

    // Curved illuminated planetary limb framed slightly lower so starfield breathes cleanly
    vec3 planetCenter = vec3(0.14, -1.78, -1.42);
    float planetR = 1.62;
    float b = dot(planetCenter, rd);
    float c = dot(planetCenter, planetCenter) - planetR * planetR;
    float disc = b * b - c;
    if (disc > 0.0 && b > 0.0) {
      float tHit = b - sqrt(disc);
      vec3 hitP = rd * tHit;
      vec3 pN = normalize(hitP - planetCenter);
      float ndl = dot(pN, sunDir);
      float day = smoothstep(-0.08, 0.22, ndl);

      // High-detail 6-octave domain-warped continents & swirling cyclone clouds (seamless projection, zero longitude seam)
      vec2 puv = vec2(pN.x * 2.6 + pN.z * 1.2, pN.y * 3.6 - pN.z * 1.4);
      vec2 cw = vec2(fbm4(puv * 1.4 + vec2(3.1, -1.7)), fbm4(puv * 1.4 - vec2(2.2, 4.1))) - 0.5;
      float landVal = fbm6(puv * 1.65 + vec2(1.2, 0.4));
      float land = smoothstep(0.48, 0.56, landVal);
      float mtn = smoothstep(0.58, 0.74, landVal);
      float clouds = smoothstep(0.44, 0.70, fbm6(puv * 2.4 + cw * 0.85 + vec2(uTime * 0.003, -0.8)));

      // Deep ocean with crisp solar specular glint + detailed continents
      vec3 ocean = vec3(0.018, 0.068, 0.195);
      vec3 halfV = normalize(sunDir - rd);
      float glint = pow(max(dot(pN, halfV), 0.0), 42.0) * (1.0 - land) * (1.0 - clouds * 0.85) * max(ndl, 0.0);
      ocean += vec3(0.95, 0.85, 0.68) * glint * 0.65;

      vec3 terrain = mix(vec3(0.095, 0.145, 0.088), vec3(0.24, 0.20, 0.14), mtn);
      vec3 surf = mix(ocean, terrain, land);
      surf = mix(surf, vec3(0.86, 0.90, 0.96), clouds * 0.78);

      // Subtle warm city-light clusters on dark nightside continents
      float nightMask = smoothstep(0.06, -0.18, ndl) * land * (1.0 - clouds * 0.7);
      float cities = smoothstep(0.68, 0.84, fbm4(puv * 9.5)) * smoothstep(0.62, 0.88, noise2(puv * 28.0));
      vec3 nightCol = vec3(0.003, 0.008, 0.020) + vec3(1.15, 0.72, 0.30) * cities * nightMask * 0.65;

      // Crisp Rayleigh atmospheric limb scattering + golden sunset terminator band
      float fres = pow(1.0 - max(dot(pN, -rd), 0.0), 3.6);
      float term = exp(-abs(ndl) * 8.5);
      vec3 atmoRim = mix(vec3(0.16, 0.50, 1.12), vec3(1.05, 0.45, 0.18), term * 0.45) * fres * (0.22 + 1.45 * smoothstep(-0.20, 0.35, ndl));
      col = mix(nightCol, surf * (0.28 + 1.18 * max(ndl, 0.0)), day) + atmoRim;
    } else {
      float closest = length(planetCenter - rd * max(b, 0.0));
      float halo = exp(-max(0.0, closest - planetR) * 15.0);
      vec3 limbDir = normalize(rd * max(b, 0.0) - planetCenter);
      float sunSide = smoothstep(-0.35, 0.55, dot(limbDir, sunDir));
      col += vec3(0.15, 0.50, 1.08) * halo * (0.10 + 1.00 * sunSide) * 0.78;
    }

    gl_FragColor = vec4(agx(col), 1.0);
  }
`;

// ============================================================================
// Procedural 3D Terrain / Seabed Shader (with real-time PCF cast shadows & micro-bumps)
// ============================================================================

export const TERRAIN_VS = `
  attribute vec3 aPos;
  attribute vec3 aNorm;
  attribute vec2 aUV;
  uniform mat4 uMVP;
  uniform mat4 uLightVP;
  varying vec3 vWorldPos;
  varying vec3 vNorm;
  varying vec2 vUV;
  varying vec4 vLightPos;
  void main() {
    vWorldPos = aPos;
    vNorm = aNorm;
    vUV = aUV;
    vLightPos = uLightVP * vec4(aPos, 1.0);
    gl_Position = uMVP * vec4(aPos, 1.0);
  }
`;

export const TERRAIN_FS = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec3 vWorldPos;
  varying vec3 vNorm;
  varying vec2 vUV;
  varying vec4 vLightPos;

  uniform sampler2D uShadowMap;
  uniform float uHasShadow;
  uniform vec3 uCamPos;
  uniform float uScene;
  uniform float uTime;
  uniform float uShadowR;

  const float SHADOW_TEXEL = 1.0 / 1024.0;

  float unpackDepth(vec4 rgba) {
    const vec4 bitShift = vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0);
    return dot(rgba, bitShift);
  }

  float sampleTerrainShadow(vec3 N, vec3 L) {
    if (uHasShadow < 0.5) return 1.0;
    vec3 proj = vLightPos.xyz / max(vLightPos.w, 1e-5) * 0.5 + 0.5;
    if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
      return 1.0;
    }
    float NoL = clamp(dot(N, L), 0.0, 1.0);
    float bias = max(0.0042 * (1.0 - NoL), 0.0018);
    float vis = 0.0;
    for (int ox = -1; ox <= 1; ox++) {
      for (int oy = -1; oy <= 1; oy++) {
        vec2 uv = proj.xy + vec2(float(ox), float(oy)) * SHADOW_TEXEL * 1.45;
        float d = unpackDepth(texture2D(uShadowMap, uv));
        vis += (proj.z - bias <= d) ? 1.0 : 0.0;
      }
    }
    return vis / 9.0;
  }

  vec3 agx(vec3 c) {
    const mat3 M = mat3(
      0.842479062253094, 0.0423282422610123, 0.0423756549057051,
      0.0784335999999992, 0.878468636469772, 0.0784336,
      0.0792237451477643, 0.0791661274605434, 0.879142973793104
    );
    const mat3 MI = mat3(
      1.19687900512017, -0.0528968517574562, -0.0529716355144438,
      -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
      -0.0990297440797205, -0.0989611768448433, 1.15107367264116
    );
    vec3 v = M * max(c, vec3(1e-10));
    v = (clamp(log2(v), -12.47393, 4.026069) + 12.47393) / 16.5;
    vec3 v2 = v * v;
    vec3 v4 = v2 * v2;
    v = 15.5 * v4 * v2 - 40.14 * v4 * v + 31.96 * v4 - 6.868 * v2 * v + 0.4298 * v2 + 0.1191 * v - 0.00232;
    vec3 outCol = clamp(MI * v, 0.0, 1.0);
    vec3 punch = pow(max(outCol, vec3(1e-5)), vec3(1.14));
    float luma = dot(punch, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luma), punch, 1.20), 0.0, 1.0);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      s += a * noise2(p);
      p = rot * p * 2.03;
      a *= 0.5;
    }
    return s;
  }

  // Sharper dual-layer caustic web with slight chromatic offset
  float causticLayer(vec2 p, float t) {
    vec2 q1 = p * 0.66 + vec2(t * 0.24, -t * 0.16);
    vec2 q2 = p * 0.84 - vec2(t * 0.18, t * 0.26);
    float w1 = abs(noise2(q1 + vec2(noise2(q2), noise2(q1 * 1.35))) - 0.5);
    float w2 = abs(noise2(q2 * 1.45 - vec2(noise2(q1), noise2(q2 * 0.92))) - 0.5);
    float web = 1.0 - min(w1, w2) * 5.2;
    return pow(clamp(web, 0.0, 1.0), 2.8);
  }

  void main() {
    vec3 geomN = normalize(vNorm);
    vec3 V = normalize(uCamPos - vWorldPos);
    float distCam = length(uCamPos - vWorldPos);
    float radXZ = length(vWorldPos.xz);

    // 1: Ground (stratified basalt crags + sunlit highland grass/gravel + real-time cast shadow + micro-bump)
    if (uScene < 1.5) {
      vec3 sunDir = normalize(vec3(-0.48, 0.44, 0.76));
      vec2 xz = vWorldPos.xz;
      float macro = fbm(xz * 0.16);
      float detail = fbm(xz * 1.35);
      float grit = noise2(xz * 7.5);

      // Fragment-level micro-normal perturbation (fades smoothly with distance to prevent aliasing)
      float bumpFade = 1.0 - smoothstep(10.0, 38.0, distCam);
      float eps = 0.08;
      float h0 = detail * 0.75 + grit * 0.25;
      float hx = fbm((xz + vec2(eps, 0.0)) * 1.35) * 0.75 + noise2((xz + vec2(eps, 0.0)) * 7.5) * 0.25;
      float hz = fbm((xz + vec2(0.0, eps)) * 1.35) * 0.75 + noise2((xz + vec2(0.0, eps)) * 7.5) * 0.25;
      float bumpAmp = mix(0.28, 0.52, 1.0 - geomN.y) * bumpFade;
      vec3 N = normalize(geomN + vec3((h0 - hx) * bumpAmp, 0.0, (h0 - hz) * bumpAmp));

      // Geological rock strata on steep faces
      float strata = sin(vWorldPos.y * 5.2 + macro * 3.8) * 0.5 + 0.5;
      vec3 basalt   = mix(vec3(0.055, 0.060, 0.072), vec3(0.110, 0.112, 0.122), strata);
      vec3 scree    = vec3(0.145, 0.128, 0.105);
      vec3 dryGrass = vec3(0.135, 0.138, 0.076);
      vec3 moss     = vec3(0.068, 0.108, 0.055);
      vec3 padEarth = vec3(0.092, 0.086, 0.078);

      float slope = clamp(geomN.y, 0.0, 1.0);
      vec3 alb = mix(basalt, scree, smoothstep(0.60, 0.82, slope));
      vec3 vegCol = mix(moss, dryGrass, smoothstep(0.32, 0.72, macro));
      float vegMask = smoothstep(0.78, 0.94, slope) * smoothstep(0.30, 0.65, macro);
      alb = mix(alb, vegCol, vegMask * 0.82);

      // Subtle compacted basalt-gravel staging clearing under the unit
      float padMask = 1.0 - smoothstep(2.4, 5.2, radXZ);
      alb = mix(alb, padEarth, padMask * 0.75);
      alb *= 0.80 + 0.36 * detail + 0.08 * grit;

      // Real-time PCF directional shadow + soft contact occlusion under the unit
      float rr = radXZ / max(uShadowR, 0.95);
      float contact = 1.0 - 0.38 * exp(-rr * rr * 1.45);
      float sh = sampleTerrainShadow(geomN, normalize(vec3(-5.5, 8.8, 8.2) - vWorldPos));
      float keyVis = mix(0.24, 1.0, sh) * contact;

      float NoL = max(dot(N, sunDir), 0.0);
      // Subtle rock/gravel specular grazing sheen
      vec3 H = normalize(V + sunDir);
      float spec = pow(max(dot(N, H), 0.0), 22.0) * 0.09 * keyVis * (1.0 - vegMask * 0.7);

      vec3 skyAmb = mix(vec3(0.045, 0.052, 0.068), vec3(0.195, 0.310, 0.520), slope);
      vec3 sunCol = vec3(1.65, 1.40, 1.08);
      vec3 col = alb * (skyAmb * (0.50 + 0.50 * contact) + sunCol * NoL * 1.25 * keyVis) + sunCol * spec;

      // Crisp aerial perspective + smooth alpha feather at outer rim so terrain melts seamlessly into SKY_FS
      float fog = 1.0 - exp(-distCam * distCam * 0.00042);
      float sunAmt = pow(max(dot(-V, sunDir), 0.0), 2.0);
      vec3 fogCol = mix(vec3(0.42, 0.46, 0.52), vec3(1.02, 0.78, 0.52) * 0.84, sunAmt * 0.55 + 0.25);
      col = mix(col, fogCol, clamp(fog, 0.0, 1.0));
      float edgeAlpha = 1.0 - smoothstep(46.0, 76.0, radXZ);
      gl_FragColor = vec4(agx(col), edgeAlpha);
      return;
    }

    // 3: Seabed (bump-mapped sand ripples + reef basalt + real-time shadow + chromatic caustics)
    vec3 lightDir = normalize(vec3(-0.22, 0.94, 0.24));
    vec2 xz = vWorldPos.xz;
    float macro = fbm(xz * 0.18);
    float micro = fbm(xz * 2.0);
    float ripplePhase = xz.x * 2.8 + xz.y * 1.2 + macro * 4.8;
    float ripples = sin(ripplePhase) * 0.5 + 0.5;

    // Sand-ripple micro-normal perturbation
    float bumpFade = 1.0 - smoothstep(8.0, 32.0, distCam);
    float ripGrad = cos(ripplePhase) * 0.22 * bumpFade * smoothstep(0.65, 0.92, geomN.y);
    vec3 N = normalize(geomN + vec3(ripGrad * 0.9, 0.0, ripGrad * 0.4));

    vec3 sand = vec3(0.145, 0.172, 0.155) * (0.86 + 0.22 * ripples + 0.14 * micro);
    vec3 reef = vec3(0.045, 0.072, 0.088) * (0.78 + 0.36 * micro);
    float slope = clamp(geomN.y, 0.0, 1.0);
    vec3 alb = mix(reef, sand, smoothstep(0.66, 0.88, slope));

    float rr = radXZ / max(uShadowR, 1.0);
    float contact = 1.0 - 0.42 * exp(-rr * rr * 1.35);
    float sh = sampleTerrainShadow(geomN, normalize(vec3(-5.5, 8.8, 8.2) - vWorldPos));
    float vis = mix(0.32, 1.0, sh) * contact;

    float NoL = max(dot(N, lightDir), 0.0);
    vec3 waterAmb = vec3(0.036, 0.145, 0.195);
    vec3 surfLight = vec3(0.45, 0.92, 0.96);
    vec3 col = alb * (waterAmb * (0.55 + 0.45 * contact) + surfLight * NoL * 0.95 * vis);

    // Chromatic caustic web on upward-facing seabed surfaces
    float cMask = smoothstep(0.42, 0.90, slope) * exp(-radXZ * 0.042) * vis;
    float cR = causticLayer(xz + vec2(0.04, 0.0), uTime);
    float cG = causticLayer(xz, uTime);
    float cB = causticLayer(xz - vec2(0.04, 0.02), uTime);
    col += vec3(cR * 0.18, cG * 0.66, cB * 0.74) * cMask * 1.15;

    float fog = 1.0 - exp(-distCam * 0.036);
    vec3 fogCol = vec3(0.014, 0.088, 0.135);
    col = mix(col, fogCol, clamp(fog, 0.0, 1.0));
    float edgeAlpha = 1.0 - smoothstep(46.0, 76.0, radXZ);
    gl_FragColor = vec4(agx(col), edgeAlpha);
  }
`;
