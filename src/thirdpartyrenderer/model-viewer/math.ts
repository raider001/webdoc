// math.ts - column-major 4x4 matrix, quaternion, and AABB helpers for WebGL.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export const M4 = {
  ident(): Float32Array {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  },

  mul(a: Float32Array, b: Float32Array): Float32Array {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4];
      const b1 = b[c * 4 + 1];
      const b2 = b[c * 4 + 2];
      const b3 = b[c * 4 + 3];
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
      }
    }
    return o;
  },

  trs(t: Vec3, q: Quat, s: Vec3): Float32Array {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0],       (xz - wy) * s[0],       0,
      (xy - wz) * s[1],       (1 - (xx + zz)) * s[1], (yz + wx) * s[1],       0,
      (xz + wy) * s[2],       (yz - wx) * s[2],       (1 - (xx + yy)) * s[2], 0,
      t[0],                   t[1],                   t[2],                   1,
    ]);
  },

  trans(x: number, y: number, z: number): Float32Array {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]);
  },

  scale(sx: number, sy: number, sz: number): Float32Array {
    return new Float32Array([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      0, 0, 0, 1,
    ]);
  },

  rotX(a: number): Float32Array {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ]);
  },

  rotY(a: number): Float32Array {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ]);
  },

  rotZ(a: number): Float32Array {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  },

  persp(fovRad: number, aspect: number, near: number, far: number): Float32Array {
    const t = 1 / Math.tan(fovRad * 0.5);
    const nf = 1 / (near - far);
    return new Float32Array([
      t / aspect, 0, 0, 0,
      0, t, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },

  ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1,
    ]);
  },

  lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
    let zx = eye[0] - target[0];
    let zy = eye[1] - target[1];
    let zz = eye[2] - target[2];
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ]);
  },

  /** Upper-left 3x3 inverse-transpose for transforming normals under non-uniform scale. */
  normalMat3(m: Float32Array): Float32Array {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const det = a00 * b01 + a01 * b11 + a02 * b21;
    if (Math.abs(det) < 1e-10) {
      return new Float32Array([a00, a01, a02, a10, a11, a12, a20, a21, a22]);
    }
    const inv = 1 / det;
    return new Float32Array([
      b01 * inv,
      b11 * inv,
      b21 * inv,
      (-a22 * a01 + a02 * a21) * inv,
      (a22 * a00 - a02 * a20) * inv,
      (-a21 * a00 + a01 * a20) * inv,
      (a12 * a01 - a02 * a11) * inv,
      (-a12 * a00 + a02 * a10) * inv,
      (a11 * a00 - a01 * a10) * inv,
    ]);
  },

  transformPoint(m: Float32Array, x: number, y: number, z: number): Vec3 {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
  },
};

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-8) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Euler XYZ quaternion (R = Rz * Ry * Rx, matching Blender Euler 'XYZ'). */
export function quatFromEulerXYZ(rx: number, ry: number, rz: number): Quat {
  const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + t * (bx - a[0]),
      a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]),
      a[3] + t * (bw - a[3]),
    ]);
  }
  const theta0 = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin((1 - t) * theta0) / sin0;
  const s1 = Math.sin(t * theta0) / sin0;
  return [
    s0 * a[0] + s1 * bx,
    s0 * a[1] + s1 * by,
    s0 * a[2] + s1 * bz,
    s0 * a[3] + s1 * bw,
  ];
}

export function emptyBounds(): Bounds3 {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

export function expandBounds(b: Bounds3, x: number, y: number, z: number): void {
  if (x < b.min[0]) b.min[0] = x;
  if (y < b.min[1]) b.min[1] = y;
  if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x;
  if (y > b.max[1]) b.max[1] = y;
  if (z > b.max[2]) b.max[2] = z;
}

export function boundsCenter(b: Bounds3): Vec3 {
  if (!Number.isFinite(b.min[0])) return [0, 0, 0];
  return [
    (b.min[0] + b.max[0]) * 0.5,
    (b.min[1] + b.max[1]) * 0.5,
    (b.min[2] + b.max[2]) * 0.5,
  ];
}

export function boundsRadius(b: Bounds3): number {
  if (!Number.isFinite(b.min[0])) return 1;
  const dx = (b.max[0] - b.min[0]) * 0.5;
  const dy = (b.max[1] - b.min[1]) * 0.5;
  const dz = (b.max[2] - b.min[2]) * 0.5;
  return Math.max(0.05, Math.hypot(dx, dy, dz));
}
