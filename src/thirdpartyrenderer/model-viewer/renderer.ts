// renderer.ts - zero-dependency WebGL 1.0 PBR + AgX studio renderer for glTF 2.0 scenes (with GPU skinning & rig testing).

import { M4, quatFromEulerXYZ, quatMul, quatNormalize } from './math.js';
import type { Quat, Vec3 } from './math.js';
import { defaultMaterial, evaluateAnimation, inspectRig } from './gltf.js';
import type { GlbMaterial, ParsedGlb, RigInfo } from './gltf.js';
import type { ExternalTextures, ViewerScene } from './options.js';
import { buildTerrainMesh, SCENE_IDS, SKY_FS, SKY_VS, TERRAIN_FS, TERRAIN_VS } from './scenes.js';

function buildVertexShader(maxJoints: number): string {
  return `
  attribute vec3 aPos;
  attribute vec3 aNorm;
  attribute vec4 aTan;
  attribute vec2 aUV;
  attribute vec4 aJoints;
  attribute vec4 aWeights;
  uniform mat4 uMVP;
  uniform mat4 uModel;
  uniform mat4 uLightVP;
  uniform mat3 uNormalMat;
  uniform float uHasSkin;
  uniform vec4 uJointRows[${maxJoints * 3}];
  varying vec3 vWorldPos;
  varying vec4 vLightPos;
  varying vec3 vNorm;
  varying vec4 vTan;
  varying vec2 vUV;
  void main() {
    vec3 localPos = aPos;
    vec3 localNorm = aNorm;
    vec3 localTan = aTan.xyz;
    if (uHasSkin > 0.5) {
      int j0 = int(aJoints.x + 0.5) * 3;
      int j1 = int(aJoints.y + 0.5) * 3;
      int j2 = int(aJoints.z + 0.5) * 3;
      int j3 = int(aJoints.w + 0.5) * 3;
      vec4 r0 = aWeights.x * uJointRows[j0]     + aWeights.y * uJointRows[j1]     + aWeights.z * uJointRows[j2]     + aWeights.w * uJointRows[j3];
      vec4 r1 = aWeights.x * uJointRows[j0 + 1] + aWeights.y * uJointRows[j1 + 1] + aWeights.z * uJointRows[j2 + 1] + aWeights.w * uJointRows[j3 + 1];
      vec4 r2 = aWeights.x * uJointRows[j0 + 2] + aWeights.y * uJointRows[j1 + 2] + aWeights.z * uJointRows[j2 + 2] + aWeights.w * uJointRows[j3 + 2];
      vec4 p4 = vec4(aPos, 1.0);
      localPos = vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
      localNorm = normalize(vec3(dot(r0.xyz, aNorm), dot(r1.xyz, aNorm), dot(r2.xyz, aNorm)));
      localTan = normalize(vec3(dot(r0.xyz, aTan.xyz), dot(r1.xyz, aTan.xyz), dot(r2.xyz, aTan.xyz)));
    }
    vec4 wp = uModel * vec4(localPos, 1.0);
    vWorldPos = wp.xyz;
    vLightPos = uLightVP * wp;
    vNorm = normalize(uNormalMat * localNorm);
    vTan = vec4(normalize(uNormalMat * localTan), aTan.w);
    vUV = aUV;
    gl_Position = uMVP * vec4(localPos, 1.0);
  }
`;
}

function buildShadowVertexShader(maxJoints: number): string {
  return `
  attribute vec3 aPos;
  attribute vec4 aJoints;
  attribute vec4 aWeights;
  uniform mat4 uLightMVP;
  uniform float uHasSkin;
  uniform vec4 uJointRows[${maxJoints * 3}];
  void main() {
    vec3 localPos = aPos;
    if (uHasSkin > 0.5) {
      int j0 = int(aJoints.x + 0.5) * 3;
      int j1 = int(aJoints.y + 0.5) * 3;
      int j2 = int(aJoints.z + 0.5) * 3;
      int j3 = int(aJoints.w + 0.5) * 3;
      vec4 r0 = aWeights.x * uJointRows[j0]     + aWeights.y * uJointRows[j1]     + aWeights.z * uJointRows[j2]     + aWeights.w * uJointRows[j3];
      vec4 r1 = aWeights.x * uJointRows[j0 + 1] + aWeights.y * uJointRows[j1 + 1] + aWeights.z * uJointRows[j2 + 1] + aWeights.w * uJointRows[j3 + 1];
      vec4 r2 = aWeights.x * uJointRows[j0 + 2] + aWeights.y * uJointRows[j1 + 2] + aWeights.z * uJointRows[j2 + 2] + aWeights.w * uJointRows[j3 + 2];
      vec4 p4 = vec4(aPos, 1.0);
      localPos = vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
    }
    gl_Position = uLightMVP * vec4(localPos, 1.0);
  }
`;
}

const SHADOW_FS_GLSL = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  void main() {
    const vec4 bitShift = vec4(16777216.0, 65536.0, 256.0, 1.0);
    const vec4 bitMask  = vec4(0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0);
    vec4 comp = fract(gl_FragCoord.z * bitShift);
    comp -= comp.xxyz * bitMask;
    gl_FragColor = comp;
  }
`;

const LINE_VS_GLSL = `
  attribute vec3 aPos;
  attribute vec3 aCol;
  uniform mat4 uVP;
  varying vec3 vCol;
  void main() {
    vCol = aCol;
    gl_Position = uVP * vec4(aPos, 1.0);
  }
`;

const LINE_FS_GLSL = `
  precision mediump float;
  varying vec3 vCol;
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
  }
`;

const FS_GLSL = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec3 vWorldPos;
  varying vec4 vLightPos;
  varying vec3 vNorm;
  varying vec4 vTan;
  varying vec2 vUV;

  uniform sampler2D uAlb;
  uniform sampler2D uOrm;
  uniform sampler2D uNrm;
  uniform sampler2D uEmi;
  uniform sampler2D uTeamEmi;
  uniform sampler2D uShadowMap;

  uniform vec4 uBaseColorFactor;
  uniform float uMetallicFactor;
  uniform float uRoughnessFactor;
  uniform vec3 uEmissiveFactor;
  uniform float uEmissiveStrength;
  uniform float uNormalScale;
  uniform float uOcclusionStrength;
  uniform float uClearcoat;
  uniform float uClearcoatRoughness;
  uniform float uDielectricF0;
  uniform float uHasNormalMap;
  uniform float uHasTeamEmi;
  uniform float uHasShadow;
  uniform float uAlphaCutoff;

  uniform vec3 uCamPos;
  uniform vec3 uTeamCol;
  uniform float uMode;
  uniform float uShadowR;
  uniform float uShowGrid;
  uniform float uScene;
  uniform float uTime;

  const float PI = 3.14159265359;
  const vec3 WORLD = vec3(0.022, 0.025, 0.030);
  const float SHADOW_TEXEL = 1.0 / 1024.0;

  float unpackDepth(vec4 rgba) {
    const vec4 bitShift = vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0);
    return dot(rgba, bitShift);
  }

  float sampleShadow(vec3 N, vec3 L) {
    if (uHasShadow < 0.5) return 1.0;
    vec3 proj = vLightPos.xyz / max(vLightPos.w, 1e-5) * 0.5 + 0.5;
    if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z <= 0.0 || proj.z >= 1.0) {
      return 1.0;
    }
    float NoL = clamp(dot(N, L), 0.0, 1.0);
    float bias = max(0.0046 * (1.0 - NoL), 0.0018);
    float vis = 0.0;
    for (int ox = -1; ox <= 1; ox++) {
      for (int oy = -1; oy <= 1; oy++) {
        vec2 uv = proj.xy + vec2(float(ox), float(oy)) * SHADOW_TEXEL * 1.35;
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
    // Blender "AgX - Punchy" look: crisp shadow contrast & chroma preservation
    vec3 punch = pow(max(outCol, vec3(1e-5)), vec3(1.22));
    float luma = dot(punch, vec3(0.2126, 0.7152, 0.0722));
    return clamp(mix(vec3(luma), punch, 1.30), 0.0, 1.0);
  }

  vec3 F_Schlick(float u, vec3 f0) {
    float m = clamp(1.0 - u, 0.0, 1.0);
    float m2 = m * m;
    return f0 + (1.0 - f0) * (m2 * m2 * m);
  }

  vec3 areaLight(
    vec3 N, vec3 geomN, vec3 V, vec3 P, vec3 lpos, vec3 lcol, float watts,
    vec3 alb, float rough, float metal, vec3 f0, float coat, float coatRough
  ) {
    vec3 lv = lpos - P;
    float dist = max(1.5, length(lv));
    vec3 L = lv / dist;
    vec3 ldir = normalize(lpos - vec3(0.0, 1.4, 0.0));
    float spotCos = clamp(dot(L, ldir), 0.0, 1.0);
    vec3 rad = (watts / PI) * pow(spotCos, 1.15) / (dist * dist) * lcol;
    vec3 H = normalize(V + L);
    float NoV = abs(dot(N, V)) + 1e-5;
    float NoL = clamp(dot(N, L), 0.0, 1.0);
    float NoH = clamp(dot(N, H), 0.0, 1.0);
    float LoH = clamp(dot(L, H), 0.0, 1.0);
    if (NoL <= 0.0) return vec3(0.0);
    // Energy-conserving GGX with realistic softbox angular broadening (~0.65m light radius)
    float alpha = max(rough * rough, 0.004);
    float alphaP = clamp(alpha + 0.32 / dist, 0.014, 1.0);
    float a2 = alphaP * alphaP;
    float f = (NoH * a2 - NoH) * NoH + 1.0;
    float D = a2 / max(PI * f * f, 1e-6);
    float Vis = 0.5 / max(NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2), 1e-5);
    vec3 F = F_Schlick(LoH, f0);
    vec3 kd = (1.0 - F) * (1.0 - metal);
    vec3 baseBrdf = (kd * alb / PI + D * Vis * F) * NoL;

    if (coat > 0.001) {
      float cNoL = clamp(dot(geomN, L), 0.0, 1.0);
      float cNoH = clamp(dot(geomN, H), 0.0, 1.0);
      float cAlpha = clamp(coatRough * coatRough + 0.24 / dist, 0.008, 1.0);
      float ca2 = cAlpha * cAlpha;
      float cf = (cNoH * ca2 - cNoH) * cNoH + 1.0;
      float cD = ca2 / max(PI * cf * cf, 1e-6);
      float cVis = 0.25 / max(LoH * LoH, 0.06);
      float cF = F_Schlick(LoH, vec3(0.04)).x * coat;
      return (baseBrdf * (1.0 - cF) + vec3(cD * cVis * cF * cNoL)) * rad;
    }
    return baseBrdf * rad;
  }

  const vec3 KEY  = vec3(-5.5, 8.8,  8.2);
  const vec3 FILL = vec3( 8.5, 5.5,  6.5);
  const vec3 RIM  = vec3( 0.0, 6.5, -8.8);
  const vec3 KEYC = vec3(1.0, 0.95, 0.87);
  const vec3 FILC = vec3(0.74, 0.86, 1.0);
  const vec3 RIMC = vec3(0.98, 0.91, 0.82);

  // Analytical split-sum environment BRDF (Karis / UE4) for accurate metallic & dielectric IBL.
  vec3 envBRDFApprox(vec3 f0, float rough, float NoV) {
    const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 c1 = vec4( 1.0,  0.0425,  1.040, -0.040);
    vec4 r = rough * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
    return max(f0 * ab.x + ab.y, vec3(0.0));
  }

  // Roughness-prefiltered studio softbox panel lobe (sharp automotive reflections at low rough, smooth diffuse fade at high rough).
  float studioPanel(vec3 R, vec3 dir, float size, float rough) {
    float d = max(dot(R, normalize(dir)), 0.0);
    float r2 = rough * rough;
    float edgeSoft = mix(0.012, 0.26, r2);
    float crisp = smoothstep(1.0 - size - edgeSoft, 1.0 - size * 0.25 + 0.008, d) * (1.0 - 0.58 * rough);
    float gloss = pow(d, mix(160.0, 2.2, r2)) * mix(1.35, 0.28, rough);
    return crisp + gloss;
  }

  float hash21m(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise2m(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21m(i), hash21m(i + vec2(1.0, 0.0)), f.x),
      mix(hash21m(i + vec2(0.0, 1.0)), hash21m(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  vec3 sampleSceneIBL(vec3 R, float rough, float scene) {
    if (scene > 3.5) {
      // 4: Space — deep cosmos + crisp orbital sun + blue planetary earthshine from below
      vec3 env = mix(vec3(0.045, 0.125, 0.310), vec3(0.006, 0.010, 0.022), smoothstep(-0.55, 0.35, R.y));
      env += vec3(3.30, 3.00, 2.55) * studioPanel(R, vec3(-0.48, 0.56, 0.67), 0.055, rough);
      env += vec3(0.42, 0.72, 1.38) * studioPanel(R, vec3( 0.15, -0.78, -0.60), 0.28, rough);
      env += vec3(1.15, 1.24, 1.45) * studioPanel(R, vec3( 0.00, 0.42, -0.91), 0.09, rough);
      return env;
    }
    if (scene > 2.5) {
      // 3: Seabed — luminous turquoise surface window above + deep marine abyss below
      vec3 env = mix(vec3(0.012, 0.048, 0.075), vec3(0.16, 0.52, 0.60), smoothstep(-0.25, 0.72, R.y));
      env += vec3(1.50, 2.30, 2.40) * studioPanel(R, vec3(-0.20, 0.94, 0.26), 0.20, rough);
      env += vec3(0.50, 1.08, 1.24) * studioPanel(R, vec3( 0.68, 0.40, 0.54), 0.16, rough);
      env += vec3(0.62, 1.18, 1.32) * studioPanel(R, vec3( 0.00, 0.50, -0.86), 0.14, rough);
      return env;
    }
    if (scene > 1.5) {
      // 2: Sky — cobalt zenith, golden horizon + bright cloud-deck bounce from below
      vec3 env = mix(vec3(0.26, 0.30, 0.40), vec3(0.14, 0.34, 0.68), smoothstep(-0.28, 0.65, R.y));
      float horizon = exp(-abs(R.y - 0.05) * mix(16.0, 2.2, rough));
      env += vec3(0.95, 0.72, 0.48) * horizon * (1.0 - 0.45 * rough);
      env += vec3(2.95, 2.45, 1.90) * studioPanel(R, vec3(-0.52, 0.38, 0.76), 0.08, rough);
      env += vec3(0.90, 1.24, 1.75) * studioPanel(R, vec3( 0.72, 0.44, 0.52), 0.13, rough);
      env += vec3(1.90, 1.65, 1.38) * studioPanel(R, vec3( 0.00, 0.42, -0.90), 0.10, rough);
      return env;
    }
    if (scene > 0.5) {
      // 1: Ground — sunlit alpine sky dome + warm earth bounce + golden horizon
      vec3 env = mix(vec3(0.085, 0.080, 0.072), vec3(0.16, 0.36, 0.68), smoothstep(-0.25, 0.65, R.y));
      float horizon = exp(-abs(R.y - 0.08) * mix(18.0, 2.4, rough));
      env += vec3(0.84, 0.70, 0.54) * horizon * (1.0 - 0.48 * rough);
      env += vec3(2.85, 2.50, 2.05) * studioPanel(R, vec3(-0.48, 0.50, 0.72), 0.09, rough);
      env += vec3(0.92, 1.22, 1.65) * studioPanel(R, vec3( 0.74, 0.40, 0.52), 0.12, rough);
      env += vec3(1.95, 1.80, 1.60) * studioPanel(R, vec3( 0.00, 0.46, -0.89), 0.09, rough);
      return env;
    }
    // 0: Studio RoomEnvironment
    vec3 ground = vec3(0.018, 0.021, 0.027);
    vec3 dome   = vec3(0.095, 0.110, 0.135);
    vec3 env = mix(ground, dome, smoothstep(-0.28, 0.65, R.y));

    // Crisp studio horizon reflection band (gives glossy ceramics & curved metals an unmistakable sky-horizon sheen)
    float horizon = exp(-abs(R.y - 0.11) * mix(22.0, 2.6, rough));
    env += vec3(0.55, 0.62, 0.72) * horizon * (1.0 - 0.55 * rough);

    // High-contrast studio overhead & key/rim softboxes (bright crisp reflections on gloss/chrome without washing out matte carbon)
    env += vec3(1.85, 1.82, 1.78) * studioPanel(R, vec3( 0.00,  0.98,  0.14), 0.10, rough);
    env += vec3(2.80, 2.55, 2.25) * studioPanel(R, vec3(-0.55,  0.62,  0.56), 0.08, rough);
    env += vec3(0.95, 1.18, 1.55) * studioPanel(R, vec3( 0.74,  0.40,  0.54), 0.10, rough);
    env += vec3(2.15, 2.02, 1.85) * studioPanel(R, vec3( 0.00,  0.46, -0.89), 0.08, rough);
    return env;
  }

  void main() {
    vec3 V = normalize(uCamPos - vWorldPos);

    if (uMode > 1.5) {
      vec3 alb = vec3(0.030, 0.033, 0.038);
      if (uShowGrid > 0.5) {
        vec2 gcell = abs(fract(vWorldPos.xz - 0.5) - 0.5);
        float gln = 1.0 - smoothstep(0.014, 0.042, min(gcell.x, gcell.y));
        alb += vec3(0.018 * gln * exp(-dot(vWorldPos.xz, vWorldPos.xz) * 0.025));
      }
      vec3 N = vec3(0.0, 1.0, 0.0);
      float rr = length(vWorldPos.xz) / max(uShadowR, 0.8);
      float contact = 1.0 - 0.34 * exp(-rr * rr * 1.6);
      float shFloor = sampleShadow(N, normalize(KEY - vWorldPos));
      float keyVis = mix(0.24, 1.0, shFloor) * contact;
      vec3 f0 = vec3(0.04);
      vec3 col = alb * WORLD * contact
        + areaLight(N, N, V, vWorldPos, KEY,  KEYC, 2200.0, alb, 0.62, 0.0, f0, 0.0, 0.1) * keyVis
        + areaLight(N, N, V, vWorldPos, FILL, FILC,  480.0, alb, 0.62, 0.0, f0, 0.0, 0.1) * (0.6 + 0.4 * contact)
        + areaLight(N, N, V, vWorldPos, RIM,  RIMC, 1050.0, alb, 0.62, 0.0, f0, 0.0, 0.1) * (0.6 + 0.4 * contact);
      gl_FragColor = vec4(agx(col * 0.92), 1.0);
      return;
    }

    vec4 albSample = texture2D(uAlb, vUV);
    float alpha = albSample.a * uBaseColorFactor.a;
    if (uAlphaCutoff > 0.0 && alpha < uAlphaCutoff) discard;

    vec3 linAlb = pow(max(albSample.rgb, vec3(1e-5)), vec3(2.2)) * uBaseColorFactor.rgb;
    vec4 ormSample = texture2D(uOrm, vUV);
    vec4 teamEmiSample = texture2D(uTeamEmi, vUV);

    vec3 baseCol = linAlb;
    if (uTeamCol.r >= 0.0) {
      float mask = uHasTeamEmi > 0.5 ? teamEmiSample.r : 0.65;
      float baseLum = max(dot(linAlb, vec3(0.2126, 0.7152, 0.0722)), 1e-4) / 0.12;
      vec3 recolored = clamp(uTeamCol * baseLum, 0.0, 1.0);
      baseCol = mix(linAlb, recolored, mask);
    }

    float ao = mix(1.0, 0.12 + 0.88 * ormSample.r, uOcclusionStrength);
    float rough = clamp(ormSample.g * uRoughnessFactor, 0.06, 0.98);
    float metal = clamp(ormSample.b * uMetallicFactor, 0.0, 1.0);

    vec3 geomN = normalize(vNorm);
    if (!gl_FrontFacing) geomN = -geomN;
    vec3 N = geomN;
    if (uHasNormalMap > 0.5) {
      vec3 T = normalize(vTan.xyz);
      T = normalize(T - N * dot(N, T));
      vec3 B = cross(N, T) * vTan.w;
      vec3 mapN = texture2D(uNrm, vUV).xyz * 2.0 - 1.0;
      mapN.xy *= uNormalScale;
      mapN = normalize(mapN);
      N = normalize(T * mapN.x + B * mapN.y + N * mapN.z);
    }

    float NoV = max(dot(N, V), 1e-4);
    vec3 R = reflect(-V, N);
    vec3 f0 = mix(vec3(uDielectricF0), baseCol, metal);
    float coat = clamp(uClearcoat, 0.0, 1.0);
    float coatRough = clamp(uClearcoatRoughness, 0.04, 1.0);

    // Real-time PCF directional shadow from key light (uses geometric normal for bias stability)
    float sh = sampleShadow(geomN, normalize(KEY - vWorldPos));
    float keyShadow = mix(0.12, 1.0, sh);

    // Scene-tuned 3-point lighting (strong shadowed key, subtle fill, crisp rim)
    vec3 kCol = KEYC;
    vec3 fCol = FILC;
    vec3 rCol = RIMC;
    vec3 ambBot = vec3(0.022, 0.026, 0.032);
    vec3 ambTop = vec3(0.115, 0.125, 0.148);
    if (uScene > 3.5) {
      kCol = vec3(1.06, 1.00, 0.92);
      fCol = vec3(0.30, 0.56, 1.05);
      rCol = vec3(0.84, 0.92, 1.06);
      ambBot = vec3(0.055, 0.130, 0.280);
      ambTop = vec3(0.025, 0.032, 0.055);
    } else if (uScene > 2.5) {
      kCol = vec3(0.60, 0.98, 1.00);
      fCol = vec3(0.22, 0.64, 0.76);
      rCol = vec3(0.54, 0.92, 0.96);
      ambBot = vec3(0.022, 0.082, 0.108);
      ambTop = vec3(0.105, 0.300, 0.350);
    } else if (uScene > 1.5) {
      kCol = vec3(1.08, 0.92, 0.76);
      fCol = vec3(0.66, 0.84, 1.06);
      rCol = vec3(1.06, 0.88, 0.70);
      ambBot = vec3(0.145, 0.155, 0.190);
      ambTop = vec3(0.130, 0.225, 0.380);
    } else if (uScene > 0.5) {
      kCol = vec3(1.06, 0.95, 0.82);
      fCol = vec3(0.68, 0.84, 1.04);
      rCol = vec3(1.00, 0.90, 0.78);
      ambBot = vec3(0.070, 0.064, 0.056);
      ambTop = vec3(0.130, 0.220, 0.360);
    }

    vec3 lo = areaLight(N, geomN, V, vWorldPos, KEY,  kCol, 2550.0, baseCol, rough, metal, f0, coat, coatRough) * keyShadow * (0.28 + 0.72 * ao)
            + areaLight(N, geomN, V, vWorldPos, FILL, fCol,  560.0, baseCol, rough, metal, f0, coat, coatRough) * (0.22 + 0.78 * ao)
            + areaLight(N, geomN, V, vWorldPos, RIM,  rCol, 1350.0, baseCol, rough, metal, f0, coat, coatRough) * (0.22 + 0.78 * ao);

    // Procedural Scene IBL (deep ambient + shadow-aware glossy/metallic reflections + optional clearcoat)
    vec3 ambIrrad = mix(ambBot, ambTop, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
    vec3 envSpec = sampleSceneIBL(R, rough, uScene) * mix(0.45, 1.0, sh);
    vec3 brdfSpec = envBRDFApprox(f0, rough, NoV);
    vec3 kD = (1.0 - F_Schlick(NoV, f0)) * (1.0 - metal);
    float specAO = clamp(pow(NoV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
    vec3 ibl = kD * ambIrrad * baseCol * ao + envSpec * brdfSpec * specAO;
    if (coat > 0.001) {
      float cNoV = max(dot(geomN, V), 1e-4);
      vec3 cR = reflect(-V, geomN);
      float cF = F_Schlick(cNoV, vec3(0.04)).x * coat;
      vec3 cEnv = sampleSceneIBL(cR, coatRough, uScene) * mix(0.55, 1.0, sh);
      ibl = ibl * (1.0 - cF) + cEnv * cF * specAO;
    }
    // Subtle animated underwater caustics projected onto upward-facing model surfaces in Seabed scene
    if (uScene > 2.5 && uScene < 3.5) {
      vec2 cp = vWorldPos.xz * 0.85 + vec2(uTime * 0.24, -uTime * 0.16);
      float cw = 1.0 - abs(noise2m(cp + noise2m(cp * 1.3 - uTime * 0.15)) - 0.5) * 4.2;
      float caust = pow(clamp(cw, 0.0, 1.0), 2.5) * smoothstep(0.15, 0.85, N.y);
      ibl += vec3(0.14, 0.52, 0.58) * baseCol * caust * 0.55;
    }

    // Calibrated emissive (preserves deep fiery furnace-orange / rich sapphire-cyan under AgX Punchy)
    vec3 emiSample = pow(max(texture2D(uEmi, vUV).rgb, vec3(0.0)), vec3(2.2));
    vec3 emi = emiSample * uEmissiveFactor * min(uEmissiveStrength, 1.65);
    if (uHasTeamEmi > 0.5 && teamEmiSample.g > 0.01) {
      float em = teamEmiSample.g;
      vec3 eCol = mix(vec3(0.92, 0.22, 0.05), vec3(1.0, 0.58, 0.20), clamp(em * 1.4, 0.0, 1.0));
      emi += eCol * (em * 2.0);
    }

    gl_FragColor = vec4(agx((ibl + lo) * 0.94 + emi), alpha);
  }
`;

interface GpuPrimitive {
  vbo: WebGLBuffer;
  skinVbo: WebGLBuffer | null;
  ibo: WebGLBuffer;
  indexCount: number;
  indexType: number;
  materialIndex: number;
  hasUV: boolean;
}

interface GpuScene {
  parsed: ParsedGlb;
  rig: RigInfo;
  meshes: GpuPrimitive[][];
  textures: Array<WebGLTexture | null>;
  normScale: number;
  rootOffset: Vec3;
  targetY: number;
}

interface ExternalTexSet {
  albedo?: WebGLTexture;
  normal?: WebGLTexture;
  orm?: WebGLTexture;
  emissive?: WebGLTexture;
  teamEmissive?: WebGLTexture;
}

function isPow2(v: number): boolean {
  return (v & (v - 1)) === 0 && v > 0;
}

async function decodeImageSource(bytes: Uint8Array, mimeType: string): Promise<TexImageSource> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mimeType || 'image/png' });
  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode texture image'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class StudioRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly prog: WebGLProgram;
  private readonly shadowProg: WebGLProgram;
  private readonly lineProg: WebGLProgram;
  private readonly skyProg: WebGLProgram;
  private readonly terrainProg: WebGLProgram;
  private readonly shaders: WebGLShader[] = [];
  private readonly anisoExt: EXT_texture_filter_anisotropic | null;
  private readonly maxAniso: number;
  private readonly hasUint32: boolean;
  private readonly maxJoints: number;
  private readonly jointBuf: Float32Array;

  private readonly attr: { pos: number; norm: number; tan: number; uv: number; joints: number; weights: number };
  private readonly uni: Record<string, WebGLUniformLocation | null> = {};
  private readonly shadowAttr: { pos: number; joints: number; weights: number };
  private readonly shadowUni: { lightMvp: WebGLUniformLocation | null; hasSkin: WebGLUniformLocation | null; jointRows: WebGLUniformLocation | null };
  private readonly shadowFbo: WebGLFramebuffer | null;
  private readonly shadowTex: WebGLTexture | null;
  private readonly shadowDepthRb: WebGLRenderbuffer | null;
  private readonly shadowReady: boolean;
  private readonly lineAttr: { pos: number; col: number };
  private readonly lineUniVP: WebGLUniformLocation | null;
  private readonly lineVbo: WebGLBuffer;
  private readonly skyAttrPos: number;
  private readonly skyUni: Record<string, WebGLUniformLocation | null> = {};
  private readonly skyVbo: WebGLBuffer;
  private readonly terrainAttr: { pos: number; norm: number; uv: number };
  private readonly terrainUni: Record<string, WebGLUniformLocation | null> = {};
  private readonly terrainCache = new Map<'ground' | 'seabed', { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }>();

  private readonly fallbackWhite: WebGLTexture;
  private readonly fallbackNormal: WebGLTexture;
  private readonly fallbackBlack: WebGLTexture;
  private readonly floorVbo: WebGLBuffer;
  private readonly floorIbo: WebGLBuffer;

  private scene: GpuScene | null = null;
  private externalTex: ExternalTexSet = {};
  private destroyed = false;

  // Camera & playback state
  public yaw: number;
  public pitch: number;
  public distance: number;
  private autoDistance = 5.8;
  private readonly initYaw: number;
  private readonly initPitch: number;
  private readonly initDistanceOverride?: number;
  private panOffset: Vec3 = [0, 0, 0];

  public animate: boolean;
  public autoRotate: boolean;
  public showFloor: boolean;
  public showGrid: boolean;
  public hover: number;
  public sceneType: ViewerScene;
  public teamCol: Vec3 = [-1, 0, 0];

  // Animation & interactive rig-testing state
  public activeClipIndex = 0;
  public animSpeed = 1.0;
  public turretYawDeg = 0;
  public gunPitchDeg = 0;
  public steerDeg = 0;
  public aimSweep = false;
  public barrelSpin = false;
  public showMuzzles = false;
  public showBones = false;
  public onFrameTick?: (timeSec: number, durationSec: number) => void;
  private readonly boneOverrides = new Map<string, [number, number, number]>();

  private animTime = 0;
  private sceneTime = 0;
  private sweepTime = 0;
  private spinAngleRad = 0;
  private lastFrameMs = 0;
  private rafId = 0;
  private isVisible = true;
  private isRunning = false;

  // Pointer interaction
  private dragMode: 'none' | 'orbit' | 'pan' = 'none';
  private lastX = 0;
  private lastY = 0;

  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private readonly onVisChange: () => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: () => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly onDblClick: () => void;
  private readonly onContextMenu: (e: MouseEvent) => void;

  constructor(
    canvas: HTMLCanvasElement,
    opts: {
      yaw: number;
      pitch: number;
      distance?: number;
      animate: boolean;
      autoRotate: boolean;
      showFloor: boolean;
      showGrid: boolean;
      hover?: number;
      scene?: ViewerScene;
    },
  ) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
      || (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) throw new Error('WebGL is not available in this browser');
    this.gl = gl;

    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic')
      || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
      || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    this.maxAniso = this.anisoExt
      ? Math.min(16, (gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 4)
      : 0;
    this.hasUint32 = Boolean(gl.getExtension('OES_element_index_uint'));

    const maxVertVecs = (gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number) || 128;
    this.maxJoints = Math.min(64, Math.max(16, Math.floor((maxVertVecs - 20) / 3)));
    this.jointBuf = new Float32Array(this.maxJoints * 12);

    this.prog = this.buildProgram(buildVertexShader(this.maxJoints), FS_GLSL);
    this.shadowProg = this.buildProgram(buildShadowVertexShader(this.maxJoints), SHADOW_FS_GLSL);
    this.lineProg = this.buildProgram(LINE_VS_GLSL, LINE_FS_GLSL);
    this.skyProg = this.buildProgram(SKY_VS, SKY_FS);
    this.terrainProg = this.buildProgram(TERRAIN_VS, TERRAIN_FS);
    gl.useProgram(this.prog);

    this.attr = {
      pos: gl.getAttribLocation(this.prog, 'aPos'),
      norm: gl.getAttribLocation(this.prog, 'aNorm'),
      tan: gl.getAttribLocation(this.prog, 'aTan'),
      uv: gl.getAttribLocation(this.prog, 'aUV'),
      joints: gl.getAttribLocation(this.prog, 'aJoints'),
      weights: gl.getAttribLocation(this.prog, 'aWeights'),
    };
    const uniformNames = [
      'uMVP', 'uModel', 'uLightVP', 'uNormalMat', 'uHasSkin', 'uJointRows',
      'uAlb', 'uOrm', 'uNrm', 'uEmi', 'uTeamEmi', 'uShadowMap',
      'uBaseColorFactor', 'uMetallicFactor', 'uRoughnessFactor',
      'uEmissiveFactor', 'uEmissiveStrength', 'uNormalScale', 'uOcclusionStrength',
      'uClearcoat', 'uClearcoatRoughness', 'uDielectricF0',
      'uHasNormalMap', 'uHasTeamEmi', 'uHasShadow', 'uAlphaCutoff',
      'uCamPos', 'uTeamCol', 'uMode', 'uShadowR', 'uShowGrid', 'uScene', 'uTime',
    ];
    for (const k of uniformNames) this.uni[k] = gl.getUniformLocation(this.prog, k);

    this.shadowAttr = {
      pos: gl.getAttribLocation(this.shadowProg, 'aPos'),
      joints: gl.getAttribLocation(this.shadowProg, 'aJoints'),
      weights: gl.getAttribLocation(this.shadowProg, 'aWeights'),
    };
    this.shadowUni = {
      lightMvp: gl.getUniformLocation(this.shadowProg, 'uLightMVP'),
      hasSkin: gl.getUniformLocation(this.shadowProg, 'uHasSkin'),
      jointRows: gl.getUniformLocation(this.shadowProg, 'uJointRows'),
    };

    // 1024x1024 RGBA8 depth-packed shadow map FBO (100% WebGL 1.0 core compatible)
    const sSize = 1024;
    const sTex = gl.createTexture();
    const sFbo = gl.createFramebuffer();
    const sRb = gl.createRenderbuffer();
    let sReady = false;
    if (sTex && sFbo && sRb) {
      gl.bindTexture(gl.TEXTURE_2D, sTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sSize, sSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      gl.bindRenderbuffer(gl.RENDERBUFFER, sRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, sSize, sSize);

      gl.bindFramebuffer(gl.FRAMEBUFFER, sFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sRb);
      sReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.shadowFbo = sFbo;
    this.shadowTex = sTex;
    this.shadowDepthRb = sRb;
    this.shadowReady = sReady;

    this.lineAttr = {
      pos: gl.getAttribLocation(this.lineProg, 'aPos'),
      col: gl.getAttribLocation(this.lineProg, 'aCol'),
    };
    this.lineUniVP = gl.getUniformLocation(this.lineProg, 'uVP');
    this.lineVbo = gl.createBuffer()!;

    this.skyAttrPos = gl.getAttribLocation(this.skyProg, 'aPos');
    for (const k of ['uCamRight', 'uCamUp', 'uCamFwd', 'uTanHalfFov', 'uAspect', 'uScene', 'uTime']) {
      this.skyUni[k] = gl.getUniformLocation(this.skyProg, k);
    }
    this.skyVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.terrainAttr = {
      pos: gl.getAttribLocation(this.terrainProg, 'aPos'),
      norm: gl.getAttribLocation(this.terrainProg, 'aNorm'),
      uv: gl.getAttribLocation(this.terrainProg, 'aUV'),
    };
    for (const k of ['uMVP', 'uLightVP', 'uShadowMap', 'uHasShadow', 'uCamPos', 'uScene', 'uTime', 'uShadowR']) {
      this.terrainUni[k] = gl.getUniformLocation(this.terrainProg, k);
    }

    this.fallbackWhite = this.createSolidTex(255, 255, 255, 255);
    this.fallbackNormal = this.createSolidTex(128, 128, 255, 255);
    this.fallbackBlack = this.createSolidTex(0, 0, 0, 255);

    const floorVerts = new Float32Array([
      -95, 0, -95,  0, 1, 0,  1, 0, 0, 1,  0, 0,
       95, 0, -95,  0, 1, 0,  1, 0, 0, 1,  1, 0,
       95, 0,  95,  0, 1, 0,  1, 0, 0, 1,  1, 1,
      -95, 0,  95,  0, 1, 0,  1, 0, 0, 1,  0, 1,
    ]);
    const floorIdx = new Uint16Array([0, 2, 1, 0, 3, 2]);
    this.floorVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.floorVbo);
    gl.bufferData(gl.ARRAY_BUFFER, floorVerts, gl.STATIC_DRAW);
    this.floorIbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.floorIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, floorIdx, gl.STATIC_DRAW);

    this.initYaw = opts.yaw;
    this.initPitch = opts.pitch;
    this.initDistanceOverride = opts.distance;
    this.yaw = opts.yaw;
    this.pitch = opts.pitch;
    this.distance = opts.distance ?? 5.8;
    this.animate = opts.animate;
    this.autoRotate = opts.autoRotate;
    this.showFloor = opts.showFloor;
    this.showGrid = opts.showGrid;
    this.hover = opts.hover ?? 0;
    this.sceneType = opts.scene ?? 'studio';

    this.onPointerDown = (e: PointerEvent) => {
      this.dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      canvas.style.cursor = 'grabbing';
    };
    this.onPointerMove = (e: PointerEvent) => {
      if (this.dragMode === 'none') return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragMode === 'orbit') {
        this.yaw -= dx * 0.0075;
        this.pitch = Math.max(0.04, Math.min(1.48, this.pitch + dy * 0.0075));
      } else {
        const panScale = this.distance * 0.0014;
        const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
        this.panOffset[0] -= dx * cosY * panScale;
        this.panOffset[2] += dx * sinY * panScale;
        this.panOffset[1] += dy * panScale;
      }
      this.requestSingleRender();
    };
    this.onPointerUp = () => {
      this.dragMode = 'none';
      canvas.style.cursor = 'grab';
    };
    this.onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      this.distance = Math.max(1.2, Math.min(28.0, this.distance * factor));
      this.requestSingleRender();
    };
    this.onDblClick = () => this.resetCamera();
    this.onContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('dblclick', this.onDblClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    this.onVisChange = () => this.syncLoop();
    document.addEventListener('visibilitychange', this.onVisChange);

    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver(entries => {
        this.isVisible = entries[0]?.isIntersecting ?? true;
        this.syncLoop();
      }, { threshold: 0.02 });
      this.io.observe(canvas);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.requestSingleRender());
      this.ro.observe(canvas);
    }
  }

  private buildProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh) || 'Shader compile error';
        gl.deleteShader(sh);
        throw new Error(log);
      }
      this.shaders.push(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'Program link error');
    }
    return prog;
  }

  private createSolidTex(r: number, g: number, b: number, a: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return tex;
  }

  private uploadImageTex(src: TexImageSource, wrapS = 10497, wrapT = 10497): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const w = 'width' in src ? src.width : 0;
    const h = 'height' in src ? src.height : 0;
    if (isPow2(w) && isPow2(h)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (this.anisoExt && this.maxAniso > 1) {
        gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, this.maxAniso);
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    return tex;
  }

  public async loadExternalTextures(textures: ExternalTextures, signal: AbortSignal): Promise<void> {
    const entries: Array<[keyof ExternalTexSet, string]> = [];
    if (textures.albedo) entries.push(['albedo', textures.albedo]);
    if (textures.normal) entries.push(['normal', textures.normal]);
    if (textures.orm) entries.push(['orm', textures.orm]);
    if (textures.emissive) entries.push(['emissive', textures.emissive]);
    if (textures.teamEmissive) entries.push(['teamEmissive', textures.teamEmissive]);

    await Promise.all(entries.map(async ([key, url]) => {
      const res = await fetch(url, { credentials: 'same-origin', signal });
      if (!res.ok) throw new Error(`Failed to load texture ${key} (${res.status})`);
      const buf = await res.arrayBuffer();
      if (signal.aborted || this.destroyed) return;
      const img = await decodeImageSource(new Uint8Array(buf), res.headers.get('content-type') || 'image/png');
      if (signal.aborted || this.destroyed) {
        if ('close' in img && typeof img.close === 'function') img.close();
        return;
      }
      const prev = this.externalTex[key];
      if (prev) this.gl.deleteTexture(prev);
      this.externalTex[key] = this.uploadImageTex(img, this.gl.CLAMP_TO_EDGE, this.gl.CLAMP_TO_EDGE);
      if ('close' in img && typeof img.close === 'function') img.close();
    }));
    this.requestSingleRender();
  }

  private disposeScene(): void {
    if (!this.scene) return;
    const gl = this.gl;
    for (const mesh of this.scene.meshes) {
      for (const pr of mesh) {
        gl.deleteBuffer(pr.vbo);
        if (pr.skinVbo) gl.deleteBuffer(pr.skinVbo);
        gl.deleteBuffer(pr.ibo);
      }
    }
    for (const tex of this.scene.textures) {
      if (tex) gl.deleteTexture(tex);
    }
    this.scene = null;
  }

  public async setScene(parsed: ParsedGlb, signal: AbortSignal, preserveCamera = false): Promise<void> {
    if (this.destroyed || signal.aborted) return;
    const gl = this.gl;

    // Decode embedded textures before disposing previous scene
    const decodedImages: Array<TexImageSource | null> = await Promise.all(
      parsed.images.map(async img => {
        if (!img.bytes.byteLength) return null;
        return await decodeImageSource(img.bytes, img.mimeType);
      }),
    );
    if (this.destroyed || signal.aborted) {
      for (const im of decodedImages) {
        if (im && 'close' in im && typeof im.close === 'function') im.close();
      }
      return;
    }

    this.disposeScene();

    const textures: Array<WebGLTexture | null> = parsed.textures.map(tx => {
      const src = tx.source >= 0 ? decodedImages[tx.source] : null;
      if (!src) return null;
      return this.uploadImageTex(src, tx.wrapS, tx.wrapT);
    });
    for (const im of decodedImages) {
      if (im && 'close' in im && typeof im.close === 'function') im.close();
    }

    const maxJ = this.maxJoints - 1;
    const meshes: GpuPrimitive[][] = parsed.meshes.map(m =>
      m.primitives.map(pr => {
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, pr.vertices, gl.STATIC_DRAW);

        let skinVbo: WebGLBuffer | null = null;
        if (pr.skinData) {
          const clamped = new Float32Array(pr.skinData.length);
          clamped.set(pr.skinData);
          for (let i = 0; i < clamped.length; i += 8) {
            clamped[i] = Math.max(0, Math.min(maxJ, clamped[i]));
            clamped[i + 1] = Math.max(0, Math.min(maxJ, clamped[i + 1]));
            clamped[i + 2] = Math.max(0, Math.min(maxJ, clamped[i + 2]));
            clamped[i + 3] = Math.max(0, Math.min(maxJ, clamped[i + 3]));
          }
          skinVbo = gl.createBuffer()!;
          gl.bindBuffer(gl.ARRAY_BUFFER, skinVbo);
          gl.bufferData(gl.ARRAY_BUFFER, clamped, gl.STATIC_DRAW);
        }

        const ibo = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        const useU32 = pr.indices instanceof Uint32Array && this.hasUint32;
        const idxData = useU32
          ? pr.indices
          : (pr.indices instanceof Uint16Array ? pr.indices : new Uint16Array(pr.indices));
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxData, gl.STATIC_DRAW);

        return {
          vbo,
          skinVbo,
          ibo,
          indexCount: pr.indexCount,
          indexType: useU32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          materialIndex: pr.materialIndex,
          hasUV: pr.hasUV,
        };
      }),
    );

    const rig = inspectRig(parsed);
    const normScale = 2.5 / Math.max(0.05, parsed.radius);
    const minX = Number.isFinite(parsed.bounds.min[0]) ? parsed.bounds.min[0] : -1;
    const maxX = Number.isFinite(parsed.bounds.max[0]) ? parsed.bounds.max[0] : 1;
    const minY = Number.isFinite(parsed.bounds.min[1]) ? parsed.bounds.min[1] : 0;
    const maxY = Number.isFinite(parsed.bounds.max[1]) ? parsed.bounds.max[1] : 2;
    const minZ = Number.isFinite(parsed.bounds.min[2]) ? parsed.bounds.min[2] : -1;
    const maxZ = Number.isFinite(parsed.bounds.max[2]) ? parsed.bounds.max[2] : 1;
    const floorClearance = 0.04 + this.hover;
    const normW = Math.max(maxX - minX, maxZ - minZ) * normScale;
    const normH = (maxY - minY) * normScale;
    const rootOffset: Vec3 = [-parsed.center[0], -minY + floorClearance / normScale, -parsed.center[2]];
    const targetY = Math.max(0.25, normH * 0.48 + floorClearance);

    // Auto-fit camera distance to both vertical height and horizontal span (never crops tall mechs/towers!)
    const tanHalfFov = Math.tan(0.28);
    const fitH = (normH * 0.64) / tanHalfFov + normW * 0.42;
    const fitW = (normW * 0.56) / tanHalfFov + normH * 0.25;
    this.autoDistance = Math.max(4.8, Math.min(12.5, Math.max(fitH, fitW, 5.6)));

    if (parsed.animations.length === 0) {
      this.activeClipIndex = -1;
    } else if (this.activeClipIndex >= parsed.animations.length) {
      this.activeClipIndex = 0;
    }

    this.scene = { parsed, rig, meshes, textures, normScale, rootOffset, targetY };
    if (!preserveCamera) {
      this.distance = this.initDistanceOverride ?? this.autoDistance;
      this.panOffset = [0, 0, 0];
    }
    this.syncLoop();
    this.requestSingleRender();
  }

  public resetCamera(): void {
    this.yaw = this.initYaw;
    this.pitch = this.initPitch;
    this.distance = this.initDistanceOverride ?? this.autoDistance;
    this.panOffset = [0, 0, 0];
    this.requestSingleRender();
  }

  public hasAnimations(): boolean {
    return Boolean(this.scene?.parsed.animations.length);
  }

  public getAnimationNames(): string[] {
    return this.scene ? this.scene.parsed.animations.map(a => a.name) : [];
  }

  public getActiveClipDuration(): number {
    if (!this.scene || this.activeClipIndex < 0) return 0;
    return this.scene.parsed.animations[this.activeClipIndex]?.duration ?? 0;
  }

  public getAnimTime(): number {
    const dur = this.getActiveClipDuration();
    if (dur <= 0) return 0;
    return ((this.animTime % dur) + dur) % dur;
  }

  public setAnimTime(sec: number): void {
    this.animTime = Math.max(0, sec);
    this.requestSingleRender();
  }

  public setActiveClip(index: number): void {
    if (!this.scene) return;
    const n = this.scene.parsed.animations.length;
    this.activeClipIndex = index >= 0 && index < n ? index : -1;
    this.animTime = 0;
    this.syncLoop();
    this.requestSingleRender();
  }

  public getRigInfo(): RigInfo | null {
    return this.scene ? this.scene.rig : null;
  }

  public setBoneOverride(boneName: string, rxDeg: number, ryDeg: number, rzDeg: number): void {
    if (rxDeg === 0 && ryDeg === 0 && rzDeg === 0) {
      this.boneOverrides.delete(boneName);
    } else {
      this.boneOverrides.set(boneName, [rxDeg, ryDeg, rzDeg]);
    }
    this.requestSingleRender();
  }

  public getBoneOverride(boneName: string): [number, number, number] {
    return this.boneOverrides.get(boneName) || [0, 0, 0];
  }

  public resetRigPose(): void {
    this.turretYawDeg = 0;
    this.gunPitchDeg = 0;
    this.steerDeg = 0;
    this.aimSweep = false;
    this.barrelSpin = false;
    this.sweepTime = 0;
    this.spinAngleRad = 0;
    this.boneOverrides.clear();
    this.syncLoop();
    this.requestSingleRender();
  }

  public setSceneType(scene: ViewerScene): void {
    this.sceneType = scene;
    this.syncLoop();
    this.requestSingleRender();
  }

  private getTerrainGpu(kind: 'ground' | 'seabed'): { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number } {
    const cached = this.terrainCache.get(kind);
    if (cached) return cached;
    const geom = buildTerrainMesh(kind);
    const gl = this.gl;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
    const entry = { vbo, ibo, count: geom.indexCount };
    this.terrainCache.set(kind, entry);
    return entry;
  }

  public syncLoop(): void {
    if (this.destroyed) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const clipPlaying = this.animate && this.activeClipIndex >= 0 && this.hasAnimations();
    const animatedBackdrop = this.sceneType === 'seabed' || this.sceneType === 'sky';
    const needsAnim = Boolean(this.scene) && (
      this.autoRotate || clipPlaying || this.aimSweep || this.barrelSpin || animatedBackdrop
    );
    const shouldRun = this.isVisible && !hidden && needsAnim;
    if (shouldRun && !this.isRunning) {
      this.isRunning = true;
      this.lastFrameMs = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.isRunning) {
      this.isRunning = false;
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    }
  }

  public requestSingleRender(): void {
    if (this.destroyed || this.isRunning) return;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(now => {
      this.rafId = 0;
      this.renderFrame(now, 0);
    });
  }

  private readonly tick = (now: number): void => {
    if (this.destroyed || !this.isRunning) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameMs) * 0.001));
    this.lastFrameMs = now;
    this.renderFrame(now, dt);
    if (this.isRunning) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private bindTex(unit: number, tex: WebGLTexture, uniform: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uniform, unit);
  }

  private drawPrimitive(
    vbo: WebGLBuffer,
    skinVbo: WebGLBuffer | null,
    ibo: WebGLBuffer,
    count: number,
    indexType: number,
    model: Float32Array,
    vp: Float32Array,
  ): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (this.attr.pos >= 0) { gl.enableVertexAttribArray(this.attr.pos); gl.vertexAttribPointer(this.attr.pos, 3, gl.FLOAT, false, 48, 0); }
    if (this.attr.norm >= 0) { gl.enableVertexAttribArray(this.attr.norm); gl.vertexAttribPointer(this.attr.norm, 3, gl.FLOAT, false, 48, 12); }
    if (this.attr.tan >= 0) { gl.enableVertexAttribArray(this.attr.tan); gl.vertexAttribPointer(this.attr.tan, 4, gl.FLOAT, false, 48, 24); }
    if (this.attr.uv >= 0) { gl.enableVertexAttribArray(this.attr.uv); gl.vertexAttribPointer(this.attr.uv, 2, gl.FLOAT, false, 48, 40); }

    if (skinVbo) {
      gl.bindBuffer(gl.ARRAY_BUFFER, skinVbo);
      if (this.attr.joints >= 0) { gl.enableVertexAttribArray(this.attr.joints); gl.vertexAttribPointer(this.attr.joints, 4, gl.FLOAT, false, 32, 0); }
      if (this.attr.weights >= 0) { gl.enableVertexAttribArray(this.attr.weights); gl.vertexAttribPointer(this.attr.weights, 4, gl.FLOAT, false, 32, 16); }
      gl.uniform1f(this.uni.uHasSkin, 1.0);
    } else {
      if (this.attr.joints >= 0) { gl.disableVertexAttribArray(this.attr.joints); gl.vertexAttrib4f(this.attr.joints, 0, 0, 0, 0); }
      if (this.attr.weights >= 0) { gl.disableVertexAttribArray(this.attr.weights); gl.vertexAttrib4f(this.attr.weights, 1, 0, 0, 0); }
      gl.uniform1f(this.uni.uHasSkin, 0.0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.uniformMatrix4fv(this.uni.uModel, false, model);
    gl.uniformMatrix3fv(this.uni.uNormalMat, false, M4.normalMat3(model));
    gl.uniformMatrix4fv(this.uni.uMVP, false, M4.mul(vp, model));
    gl.drawElements(gl.TRIANGLES, count, indexType, 0);
  }

  private drawRigOverlay(vp: Float32Array, parsed: ParsedGlb, rig: RigInfo, worldMats: Float32Array[]): void {
    const verts: number[] = [];
    const pushSeg = (a: Vec3, b: Vec3, r: number, g: number, bl: number) => {
      verts.push(a[0], a[1], a[2], r, g, bl, b[0], b[1], b[2], r, g, bl);
    };

    if (this.showBones) {
      for (const bone of rig.bones) {
        const pos = parsed.nodeIndexToPos.get(bone.nodeIndex);
        if (pos === undefined) continue;
        const p = M4.transformPoint(worldMats[pos], 0, 0, 0);
        // Tiny joint cross
        const s = 0.045;
        pushSeg([p[0] - s, p[1], p[2]], [p[0] + s, p[1], p[2]], 0.30, 0.86, 1.0);
        pushSeg([p[0], p[1] - s, p[2]], [p[0], p[1] + s, p[2]], 0.30, 0.86, 1.0);
        pushSeg([p[0], p[1], p[2] - s], [p[0], p[1], p[2] + s], 0.30, 0.86, 1.0);
        // Parent -> child bone line
        if (bone.parentNodeIndex >= 0) {
          const pPos = parsed.nodeIndexToPos.get(bone.parentNodeIndex);
          if (pPos !== undefined) {
            const pp = M4.transformPoint(worldMats[pPos], 0, 0, 0);
            pushSeg(pp, p, 0.22, 0.72, 0.95);
          }
        }
      }
    }

    if (this.showMuzzles) {
      for (const mNodeIdx of rig.muzzleNodes) {
        const pos = parsed.nodeIndexToPos.get(mNodeIdx);
        if (pos === undefined) continue;
        const wm = worldMats[pos];
        const o = M4.transformPoint(wm, 0, 0, 0);
        // Local +Z is canonical weapon forward direction in glTF Y-up
        const tip = M4.transformPoint(wm, 0, 0, 0.75);
        const lx = M4.transformPoint(wm, 0.07, 0, 0);
        const rx = M4.transformPoint(wm, -0.07, 0, 0);
        const uy = M4.transformPoint(wm, 0, 0.07, 0);
        const dy = M4.transformPoint(wm, 0, -0.07, 0);
        pushSeg(o, tip, 1.0, 0.52, 0.14);
        pushSeg(rx, lx, 1.0, 0.80, 0.28);
        pushSeg(dy, uy, 1.0, 0.80, 0.28);
      }
    }

    if (!verts.length) return;
    const gl = this.gl;
    gl.useProgram(this.lineProg);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    if (this.lineAttr.pos >= 0) {
      gl.enableVertexAttribArray(this.lineAttr.pos);
      gl.vertexAttribPointer(this.lineAttr.pos, 3, gl.FLOAT, false, 24, 0);
    }
    if (this.lineAttr.col >= 0) {
      gl.enableVertexAttribArray(this.lineAttr.col);
      gl.vertexAttribPointer(this.lineAttr.col, 3, gl.FLOAT, false, 24, 12);
    }
    gl.uniformMatrix4fv(this.lineUniVP, false, vp);
    gl.drawArrays(gl.LINES, 0, verts.length / 6);
    if (this.lineAttr.pos >= 0) gl.disableVertexAttribArray(this.lineAttr.pos);
    if (this.lineAttr.col >= 0) gl.disableVertexAttribArray(this.lineAttr.col);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
  }

  private drawShadowPass(
    parsed: ParsedGlb,
    meshes: GpuPrimitive[][],
    rootBase: Float32Array,
    modelMats: Float32Array[],
    worldMats: Float32Array[],
    lightVP: Float32Array,
  ): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, 1024, 1024);
    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.shadowProg);

    for (let i = 0; i < parsed.nodes.length; i++) {
      const nd = parsed.nodes[i];
      if (nd.mesh < 0 || !meshes[nd.mesh]) continue;

      const skin = nd.skin >= 0 ? parsed.skins[nd.skin] : undefined;
      if (skin) {
        const count = Math.min(skin.joints.length, this.maxJoints);
        for (let j = 0; j < count; j++) {
          const jPos = parsed.nodeIndexToPos.get(skin.joints[j]);
          const jm = jPos !== undefined ? M4.mul(modelMats[jPos], skin.inverseBindMatrices[j]) : M4.ident();
          const off = j * 12;
          this.jointBuf[off] = jm[0];     this.jointBuf[off + 1] = jm[4];  this.jointBuf[off + 2] = jm[8];   this.jointBuf[off + 3] = jm[12];
          this.jointBuf[off + 4] = jm[1]; this.jointBuf[off + 5] = jm[5];  this.jointBuf[off + 6] = jm[9];   this.jointBuf[off + 7] = jm[13];
          this.jointBuf[off + 8] = jm[2]; this.jointBuf[off + 9] = jm[6];  this.jointBuf[off + 10] = jm[10]; this.jointBuf[off + 11] = jm[14];
        }
        gl.uniform4fv(this.shadowUni.jointRows, this.jointBuf);
      }

      for (const pr of meshes[nd.mesh]) {
        const useSkin = Boolean(skin && pr.skinVbo);
        const drawModel = useSkin ? rootBase : worldMats[i];
        gl.bindBuffer(gl.ARRAY_BUFFER, pr.vbo);
        if (this.shadowAttr.pos >= 0) {
          gl.enableVertexAttribArray(this.shadowAttr.pos);
          gl.vertexAttribPointer(this.shadowAttr.pos, 3, gl.FLOAT, false, 48, 0);
        }
        if (useSkin && pr.skinVbo) {
          gl.bindBuffer(gl.ARRAY_BUFFER, pr.skinVbo);
          if (this.shadowAttr.joints >= 0) {
            gl.enableVertexAttribArray(this.shadowAttr.joints);
            gl.vertexAttribPointer(this.shadowAttr.joints, 4, gl.FLOAT, false, 32, 0);
          }
          if (this.shadowAttr.weights >= 0) {
            gl.enableVertexAttribArray(this.shadowAttr.weights);
            gl.vertexAttribPointer(this.shadowAttr.weights, 4, gl.FLOAT, false, 32, 16);
          }
          gl.uniform1f(this.shadowUni.hasSkin, 1.0);
        } else {
          if (this.shadowAttr.joints >= 0) { gl.disableVertexAttribArray(this.shadowAttr.joints); gl.vertexAttrib4f(this.shadowAttr.joints, 0, 0, 0, 0); }
          if (this.shadowAttr.weights >= 0) { gl.disableVertexAttribArray(this.shadowAttr.weights); gl.vertexAttrib4f(this.shadowAttr.weights, 1, 0, 0, 0); }
          gl.uniform1f(this.shadowUni.hasSkin, 0.0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pr.ibo);
        gl.uniformMatrix4fv(this.shadowUni.lightMvp, false, M4.mul(lightVP, drawModel));
        gl.drawElements(gl.TRIANGLES, pr.indexCount, pr.indexType, 0);
      }
    }

    if (this.shadowAttr.pos >= 0) gl.disableVertexAttribArray(this.shadowAttr.pos);
    if (this.shadowAttr.joints >= 0) gl.disableVertexAttribArray(this.shadowAttr.joints);
    if (this.shadowAttr.weights >= 0) gl.disableVertexAttribArray(this.shadowAttr.weights);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderFrame(_now: number, dt: number): void {
    if (this.destroyed) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    if (this.autoRotate && this.dragMode === 'none') {
      this.yaw += dt * 0.42;
    }
    this.sceneTime += dt;
    const activeClip = (this.scene && this.activeClipIndex >= 0)
      ? this.scene.parsed.animations[this.activeClipIndex]
      : undefined;
    if (this.animate && activeClip) {
      this.animTime += dt * this.animSpeed;
    }
    if (this.aimSweep) {
      this.sweepTime += dt;
    }
    if (this.barrelSpin) {
      this.spinAngleRad = (this.spinAngleRad + dt * Math.PI * 4.0) % (Math.PI * 2.0);
    }

    const baseTargetY = this.scene ? this.scene.targetY : 1.0;
    const target: Vec3 = [
      this.panOffset[0],
      baseTargetY + this.panOffset[1],
      this.panOffset[2],
    ];
    const eye: Vec3 = [
      target[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      target[1] + Math.sin(this.pitch) * this.distance,
      target[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance,
    ];
    const vp = M4.mul(M4.persp(0.56, w / h, 0.05, 180.0), M4.lookAt(eye, target, [0, 1, 0]));
    const lightVP = M4.mul(
      M4.ortho(-4.2, 4.2, -4.2, 4.2, 1.5, 24.0),
      M4.lookAt([-5.5, 8.8, 8.2], [0, baseTargetY * 0.65, 0], [0, 1, 0]),
    );

    let rootBase: Float32Array | null = null;
    let modelMats: Float32Array[] = [];
    let worldMats: Float32Array[] = [];

    if (this.scene) {
      const { parsed, rig, meshes, normScale, rootOffset } = this.scene;
      const poses = activeClip ? evaluateAnimation(activeClip, this.animTime) : null;

      if (activeClip && this.onFrameTick) {
        const dur = activeClip.duration;
        const wrapped = dur > 0 ? ((this.animTime % dur) + dur) % dur : 0;
        this.onFrameTick(wrapped, dur);
      }

      rootBase = M4.mul(
        M4.scale(normScale, normScale, normScale),
        M4.trans(rootOffset[0], rootOffset[1], rootOffset[2]),
      );

      const DEG = Math.PI / 180;
      const effYawRad = (this.turretYawDeg + (this.aimSweep ? 75.0 * Math.sin(this.sweepTime * 1.15) : 0)) * DEG;
      const effPitchRad = (this.gunPitchDeg + (this.aimSweep ? 8.0 + 18.0 * Math.sin(this.sweepTime * 1.85) : 0)) * DEG;
      const steerRad = this.steerDeg * DEG;

      const turretSet = rig.turretYawNodes.length ? new Set(rig.turretYawNodes) : null;
      const pitchSet = rig.gunPitchNodes.length ? new Set(rig.gunPitchNodes) : null;
      const waistSet = rig.waistNodes.length ? new Set(rig.waistNodes) : null;
      const steerFSet = rig.steerFrontNodes.length ? new Set(rig.steerFrontNodes) : null;
      const steerMSet = rig.steerMidNodes.length ? new Set(rig.steerMidNodes) : null;
      const spinSet = rig.spinNodes.length ? new Set(rig.spinNodes) : null;

      // Pass 1: Compute full model-space & studio-world transforms for ALL nodes (joints + meshes)
      modelMats = new Array(parsed.nodes.length);
      worldMats = new Array(parsed.nodes.length);

      for (let i = 0; i < parsed.nodes.length; i++) {
        const nd = parsed.nodes[i];
        const pose = poses?.get(nd.nodeIndex);

        let ox = 0, oy = 0, oz = 0;
        if (turretSet?.has(nd.nodeIndex)) oy += effYawRad;
        if (pitchSet?.has(nd.nodeIndex)) ox -= effPitchRad; // negative local X elevates +Z barrel UP
        if (waistSet?.has(nd.nodeIndex) || steerFSet?.has(nd.nodeIndex)) oy += steerRad;
        if (steerMSet?.has(nd.nodeIndex)) oy += steerRad * 0.45;
        if (this.barrelSpin && spinSet?.has(nd.nodeIndex)) oz += this.spinAngleRad;
        const manual = this.boneOverrides.get(nd.name);
        if (manual) {
          ox += manual[0] * DEG;
          oy += manual[1] * DEG;
          oz += manual[2] * DEG;
        }

        const hasOverride = ox !== 0 || oy !== 0 || oz !== 0;
        let loc: Float32Array;
        if (!pose && !hasOverride && nd.matrix) {
          loc = nd.matrix;
        } else {
          const baseR: Quat = pose?.rotation || nd.rotation;
          const rot: Quat = hasOverride ? quatNormalize(quatMul(baseR, quatFromEulerXYZ(ox, oy, oz))) : baseR;
          loc = M4.trs(pose?.translation || nd.translation, rot, pose?.scale || nd.scale);
        }

        modelMats[i] = nd.parent < 0 ? loc : M4.mul(modelMats[nd.parent], loc);
        worldMats[i] = M4.mul(rootBase, modelMats[i]);
      }

      // Pass 0: Render real-time directional shadow map (with GPU skinning!)
      if (this.shadowReady && this.shadowFbo && this.shadowTex) {
        this.drawShadowPass(parsed, meshes, rootBase, modelMats, worldMats, lightVP);
      }
    }

    // Bind main canvas framebuffer & render fullscreen sky/backdrop dome
    const sceneId = SCENE_IDS[this.sceneType] ?? 0;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.06, 0.07, 0.09, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Compute camera basis vectors for the ray-dir sky shader
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fy * 0 - fz * 1, ry = fz * 0 - fx * 0, rz = fx * 1 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVbo);
    if (this.skyAttrPos >= 0) {
      gl.enableVertexAttribArray(this.skyAttrPos);
      gl.vertexAttribPointer(this.skyAttrPos, 2, gl.FLOAT, false, 0, 0);
    }
    gl.uniform3f(this.skyUni.uCamRight, rx, ry, rz);
    gl.uniform3f(this.skyUni.uCamUp, ux, uy, uz);
    gl.uniform3f(this.skyUni.uCamFwd, fx, fy, fz);
    gl.uniform1f(this.skyUni.uTanHalfFov, Math.tan(0.56 * 0.5));
    gl.uniform1f(this.skyUni.uAspect, w / h);
    gl.uniform1f(this.skyUni.uScene, sceneId);
    gl.uniform1f(this.skyUni.uTime, this.sceneTime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.skyAttrPos >= 0) gl.disableVertexAttribArray(this.skyAttrPos);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    const useShadow = Boolean(this.scene && this.shadowReady && this.shadowTex);

    // Procedural terrain / seabed pass (with real-time PCF cast shadow + alpha-feathered seamless horizon!)
    if (this.sceneType === 'ground' || this.sceneType === 'seabed') {
      const terr = this.getTerrainGpu(this.sceneType);
      gl.useProgram(this.terrainProg);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, terr.vbo);
      if (this.terrainAttr.pos >= 0) { gl.enableVertexAttribArray(this.terrainAttr.pos); gl.vertexAttribPointer(this.terrainAttr.pos, 3, gl.FLOAT, false, 32, 0); }
      if (this.terrainAttr.norm >= 0) { gl.enableVertexAttribArray(this.terrainAttr.norm); gl.vertexAttribPointer(this.terrainAttr.norm, 3, gl.FLOAT, false, 32, 12); }
      if (this.terrainAttr.uv >= 0) { gl.enableVertexAttribArray(this.terrainAttr.uv); gl.vertexAttribPointer(this.terrainAttr.uv, 2, gl.FLOAT, false, 32, 24); }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terr.ibo);
      gl.uniformMatrix4fv(this.terrainUni.uMVP, false, vp);
      gl.uniformMatrix4fv(this.terrainUni.uLightVP, false, lightVP);
      this.bindTex(5, useShadow && this.shadowTex ? this.shadowTex : this.fallbackWhite, this.terrainUni.uShadowMap);
      gl.uniform1f(this.terrainUni.uHasShadow, useShadow ? 1.0 : 0.0);
      gl.uniform3f(this.terrainUni.uCamPos, eye[0], eye[1], eye[2]);
      gl.uniform1f(this.terrainUni.uScene, sceneId);
      gl.uniform1f(this.terrainUni.uTime, this.sceneTime);
      gl.uniform1f(this.terrainUni.uShadowR, 1.9);
      gl.drawElements(gl.TRIANGLES, terr.count, gl.UNSIGNED_SHORT, 0);
      if (this.terrainAttr.pos >= 0) gl.disableVertexAttribArray(this.terrainAttr.pos);
      if (this.terrainAttr.norm >= 0) gl.disableVertexAttribArray(this.terrainAttr.norm);
      if (this.terrainAttr.uv >= 0) gl.disableVertexAttribArray(this.terrainAttr.uv);
    }

    // Bind main PBR program
    gl.useProgram(this.prog);
    gl.uniform3f(this.uni.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(this.uni.uTeamCol, this.teamCol[0], this.teamCol[1], this.teamCol[2]);
    gl.uniform1f(this.uni.uScene, sceneId);
    gl.uniform1f(this.uni.uTime, this.sceneTime);
    gl.uniformMatrix4fv(this.uni.uLightVP, false, lightVP);
    this.bindTex(5, useShadow && this.shadowTex ? this.shadowTex : this.fallbackWhite, this.uni.uShadowMap);
    gl.uniform1f(this.uni.uHasShadow, useShadow ? 1.0 : 0.0);

    // Classic studio floor (studio scene only)
    if (this.sceneType === 'studio' && this.showFloor) {
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.uniform1f(this.uni.uMode, 2.0);
      gl.uniform1f(this.uni.uShadowR, 1.9);
      gl.uniform1f(this.uni.uShowGrid, this.showGrid ? 1.0 : 0.0);
      this.drawPrimitive(this.floorVbo, null, this.floorIbo, 6, gl.UNSIGNED_SHORT, M4.ident(), vp);
    }

    if (!this.scene || !rootBase) return;

    const { parsed, rig, meshes, textures } = this.scene;

    // Pass 2: Draw all mesh primitives (with GPU skeletal skinning when nd.skin >= 0)
    const defMat = defaultMaterial();
    const hasTeamEmi = Boolean(this.externalTex.teamEmissive);
    this.bindTex(4, this.externalTex.teamEmissive || this.fallbackBlack, this.uni.uTeamEmi);
    gl.uniform1f(this.uni.uHasTeamEmi, hasTeamEmi ? 1.0 : 0.0);
    gl.uniform1f(this.uni.uMode, 0.0);

    for (let i = 0; i < parsed.nodes.length; i++) {
      const nd = parsed.nodes[i];
      if (nd.mesh < 0 || !meshes[nd.mesh]) continue;

      const skin = nd.skin >= 0 ? parsed.skins[nd.skin] : undefined;
      if (skin) {
        const count = Math.min(skin.joints.length, this.maxJoints);
        for (let j = 0; j < count; j++) {
          const jPos = parsed.nodeIndexToPos.get(skin.joints[j]);
          const jm = jPos !== undefined ? M4.mul(modelMats[jPos], skin.inverseBindMatrices[j]) : M4.ident();
          const off = j * 12;
          // Pack column-major mat4 into 3 vec4 rows for compact 3x4 GPU skinning
          this.jointBuf[off] = jm[0];     this.jointBuf[off + 1] = jm[4];  this.jointBuf[off + 2] = jm[8];   this.jointBuf[off + 3] = jm[12];
          this.jointBuf[off + 4] = jm[1]; this.jointBuf[off + 5] = jm[5];  this.jointBuf[off + 6] = jm[9];   this.jointBuf[off + 7] = jm[13];
          this.jointBuf[off + 8] = jm[2]; this.jointBuf[off + 9] = jm[6];  this.jointBuf[off + 10] = jm[10]; this.jointBuf[off + 11] = jm[14];
        }
        gl.uniform4fv(this.uni.uJointRows, this.jointBuf);
      }

      for (const pr of meshes[nd.mesh]) {
        const mat: GlbMaterial = pr.materialIndex >= 0 && parsed.materials[pr.materialIndex]
          ? parsed.materials[pr.materialIndex]
          : defMat;

        const albTex = this.externalTex.albedo
          || (mat.baseColorTexture >= 0 ? textures[mat.baseColorTexture] : null)
          || this.fallbackWhite;
        const ormTex = this.externalTex.orm
          || (mat.metallicRoughnessTexture >= 0 ? textures[mat.metallicRoughnessTexture] : null)
          || (mat.occlusionTexture >= 0 ? textures[mat.occlusionTexture] : null)
          || this.fallbackWhite;
        const nrmTex = this.externalTex.normal
          || (mat.normalTexture >= 0 ? textures[mat.normalTexture] : null);
        const emiTex = this.externalTex.emissive
          || (mat.emissiveTexture >= 0 ? textures[mat.emissiveTexture] : null)
          || this.fallbackWhite;

        this.bindTex(0, albTex, this.uni.uAlb);
        this.bindTex(1, ormTex, this.uni.uOrm);
        this.bindTex(2, nrmTex || this.fallbackNormal, this.uni.uNrm);
        this.bindTex(3, emiTex, this.uni.uEmi);

        gl.uniform4f(
          this.uni.uBaseColorFactor,
          mat.baseColorFactor[0], mat.baseColorFactor[1], mat.baseColorFactor[2], mat.baseColorFactor[3],
        );
        gl.uniform1f(this.uni.uMetallicFactor, this.externalTex.orm ? 1.0 : mat.metallicFactor);
        gl.uniform1f(this.uni.uRoughnessFactor, this.externalTex.orm ? 1.0 : mat.roughnessFactor);

        const hasEmiTex = Boolean(this.externalTex.emissive || mat.emissiveTexture >= 0);
        const ef = mat.emissiveFactor;
        const efZero = ef[0] === 0 && ef[1] === 0 && ef[2] === 0;
        if (hasEmiTex && efZero && this.externalTex.emissive) {
          gl.uniform3f(this.uni.uEmissiveFactor, 1, 1, 1);
        } else {
          gl.uniform3f(this.uni.uEmissiveFactor, ef[0], ef[1], ef[2]);
        }
        gl.uniform1f(this.uni.uEmissiveStrength, mat.emissiveStrength);
        gl.uniform1f(this.uni.uNormalScale, mat.normalScale);
        gl.uniform1f(this.uni.uOcclusionStrength, (this.externalTex.orm || mat.occlusionTexture >= 0) ? mat.occlusionStrength : 0.0);
        gl.uniform1f(this.uni.uClearcoat, mat.clearcoatFactor);
        gl.uniform1f(this.uni.uClearcoatRoughness, mat.clearcoatRoughnessFactor);
        gl.uniform1f(this.uni.uDielectricF0, mat.dielectricF0);
        gl.uniform1f(this.uni.uHasNormalMap, nrmTex && pr.hasUV ? 1.0 : 0.0);
        gl.uniform1f(this.uni.uAlphaCutoff, mat.alphaMode === 'MASK' ? mat.alphaCutoff : 0.0);

        if (mat.doubleSided) gl.disable(gl.CULL_FACE);
        else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }

        if (mat.alphaMode === 'BLEND') {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        } else {
          gl.disable(gl.BLEND);
        }

        const useSkin = Boolean(skin && pr.skinVbo);
        const drawModel = useSkin ? rootBase : worldMats[i];
        this.drawPrimitive(pr.vbo, useSkin ? pr.skinVbo : null, pr.ibo, pr.indexCount, pr.indexType, drawModel, vp);
      }
    }

    // Pass 3: Optional 3D muzzle sightlines & skeleton bone overlay
    if ((this.showMuzzles || this.showBones) && rig.hasSkin) {
      this.drawRigOverlay(vp, parsed, rig, worldMats);
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.isRunning = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    this.io?.disconnect();
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisChange);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('dblclick', this.onDblClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);

    this.disposeScene();
    const gl = this.gl;
    for (const tex of Object.values(this.externalTex)) {
      if (tex) gl.deleteTexture(tex);
    }
    this.externalTex = {};
    gl.deleteTexture(this.fallbackWhite);
    gl.deleteTexture(this.fallbackNormal);
    gl.deleteTexture(this.fallbackBlack);
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    if (this.shadowDepthRb) gl.deleteRenderbuffer(this.shadowDepthRb);
    if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
    gl.deleteBuffer(this.floorVbo);
    gl.deleteBuffer(this.floorIbo);
    gl.deleteBuffer(this.lineVbo);
    gl.deleteBuffer(this.skyVbo);
    for (const t of this.terrainCache.values()) {
      gl.deleteBuffer(t.vbo);
      gl.deleteBuffer(t.ibo);
    }
    this.terrainCache.clear();
    for (const sh of this.shaders) gl.deleteShader(sh);
    gl.deleteProgram(this.prog);
    gl.deleteProgram(this.shadowProg);
    gl.deleteProgram(this.lineProg);
    gl.deleteProgram(this.skyProg);
    gl.deleteProgram(this.terrainProg);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
