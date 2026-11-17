import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Loop "Soulform" proportions. Model units: the tip of the trail touches
 * y = 0, the crest reaches ~3.0, and the face looks down +Z.
 */
export const DIM = {
  height: 3.0,
  /** Centre of the head. */
  headY: 2.33,
  head: { x: 0.64, y: 0.53, z: 0.58 },
  /** Lean / turn pivot for the whole figure (upper chest). */
  pivotY: 1.4,
  /** Everything below this height trails and sways. */
  trailTop: 1.0,
  /** Chest light. */
  coreY: 1.26,
  shoulderY: 1.45,
} as const;

// ───────────────────────────── Head ─────────────────────────────

const CREST_DIR = new THREE.Vector3(-0.5, 0.66, -0.56).normalize();
const CREST_CURL = new THREE.Vector3(-0.62, 0.74, 0.25).normalize();

/** Point on the head surface along unit direction `d`, relative to the head centre. */
export function headPoint(d: THREE.Vector3, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const h = DIM.head;
  const r = 1 / Math.sqrt((d.x / h.x) ** 2 + (d.y / h.y) ** 2 + (d.z / h.z) ** 2);
  // The crest: a soft swell that draws out into a swept, slightly hooked tip.
  const a = Math.max(0, d.dot(CREST_DIR));
  const reach = 0.05 * a ** 3 + 0.5 * a ** 16;
  const hook = 0.2 * a ** 40;
  return out
    .copy(d)
    .multiplyScalar(r + lift)
    .addScaledVector(CREST_DIR, reach)
    .addScaledVector(CREST_CURL, hook);
}

export function createHeadGeometry(detail = 1): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.SphereGeometry(1, Math.round(160 * detail), Math.round(120 * detail));
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    headPoint(d, 0, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Angular size of the face decal on the front of the head (radians). */
export const FACE = { halfWidth: 0.86, halfHeight: 0.56, centerPitch: -0.1 };

/**
 * A patch that hugs the front of the head and carries the face texture.
 * UVs span the patch, so the face canvas maps straight onto it.
 */
export function createFaceGeometry(): THREE.BufferGeometry {
  const NX = 40;
  const NY = 28;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const d = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NY;
      const yaw = (u * 2 - 1) * FACE.halfWidth;
      const pitch = FACE.centerPitch + (v * 2 - 1) * FACE.halfHeight;
      d.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      headPoint(d, 0.006, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      indices.push(a, a + 1, a + NX + 1, a + 1, a + NX + 2, a + NX + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ───────────────────────────── Swept shapes ─────────────────────────────

/** One cross-section of a swept shape. */
export interface Ring {
  y: number;
  /** Half-width and half-depth. */
  rx: number;
  rz: number;
  /** Centre offset. */
  x?: number;
  z?: number;
  /** Opacity at this height (trails fade out). */
  alpha?: number;
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

function sampleRings(rings: Ring[], s: number): Required<Ring> {
  const n = rings.length - 1;
  const f = Math.min(n - 1e-6, Math.max(0, s * n));
  const i = Math.floor(f);
  const t = f - i;
  const at = (k: number) => rings[Math.min(n, Math.max(0, k))];
  const get = (key: keyof Ring, fallback: number) =>
    catmull(at(i - 1)[key] ?? fallback, at(i)[key] ?? fallback, at(i + 1)[key] ?? fallback, at(i + 2)[key] ?? fallback, t);
  return {
    y: get('y', 0),
    rx: Math.max(0, get('rx', 0)),
    rz: Math.max(0, get('rz', 0)),
    x: get('x', 0),
    z: get('z', 0),
    alpha: Math.min(1, Math.max(0, get('alpha', 1))),
  };
}

/**
 * Builds a smooth tube through a stack of cross-sections. `exponent` shapes
 * the section (2 = ellipse, higher = boxier). Rings with zero radius close
 * the shape; otherwise the ends stay open (as for clothing).
 */
export function sweep(rings: Ring[], opts: { around?: number; along?: number; exponent?: number } = {}): THREE.BufferGeometry {
  const NU = opts.around ?? 72;
  const NV = opts.along ?? rings.length * 10;
  const e = 2 / (opts.exponent ?? 2);
  const positions = new Float32Array(NU * (NV + 1) * 3);
  const colors = new Float32Array(NU * (NV + 1) * 4);
  for (let j = 0; j <= NV; j++) {
    const r = sampleRings(rings, j / NV);
    for (let i = 0; i < NU; i++) {
      const a = (i / NU) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const k = j * NU + i;
      positions[k * 3] = r.x + Math.sign(s) * Math.abs(s) ** e * r.rx;
      positions[k * 3 + 1] = r.y;
      positions[k * 3 + 2] = r.z + Math.sign(c) * Math.abs(c) ** e * r.rz;
      colors.set([1, 1, 1, r.alpha], k * 4);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const a = j * NU + i;
      const b = j * NU + ((i + 1) % NU);
      const c = a + NU;
      const d = b + NU;
      // Rings are listed top to bottom, so this winding faces outward.
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Half-width and half-depth of a ring stack at height `y` (linear between rings). */
export function sectionAt(rings: Ring[], y: number): { rx: number; rz: number } {
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    if (y <= a.y && y >= b.y) {
      const t = a.y === b.y ? 0 : (a.y - y) / (a.y - b.y);
      return { rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t };
    }
  }
  const end = y > rings[0].y ? rings[0] : rings[rings.length - 1];
  return { rx: end.rx, rz: end.rz };
}

/** Front (+Z) surface depth of a ring stack at a point across the chest. */
export function frontZ(rings: Ring[], x: number, y: number, exponent = 2): number {
  const { rx, rz } = sectionAt(rings, y);
  if (rx <= 0) return 0;
  const u = Math.min(1, Math.abs(x) / rx);
  return rz * Math.max(0, 1 - u ** exponent) ** (1 / exponent);
}

// ───────────────────────────── Body ─────────────────────────────

/** Neck, shoulders and chest, flowing down into the long main ribbon. */
export const TORSO: Ring[] = [
  { y: 1.725, rx: 0, rz: 0 },
  { y: 1.71, rx: 0.07, rz: 0.07 },
  { y: 1.67, rx: 0.105, rz: 0.1 },
  { y: 1.59, rx: 0.115, rz: 0.108 },
  { y: 1.53, rx: 0.21, rz: 0.15 },
  { y: 1.47, rx: 0.39, rz: 0.225 },
  { y: 1.38, rx: 0.43, rz: 0.255 },
  { y: 1.22, rx: 0.415, rz: 0.262 },
  { y: 1.05, rx: 0.37, rz: 0.24 },
  { y: 0.9, rx: 0.32, rz: 0.2, x: -0.02 },
  { y: 0.74, rx: 0.27, rz: 0.16, x: -0.07, z: -0.01 },
  { y: 0.58, rx: 0.215, rz: 0.125, x: -0.1, z: -0.03, alpha: 0.95 },
  { y: 0.43, rx: 0.165, rz: 0.095, x: -0.07, z: -0.06, alpha: 0.84 },
  { y: 0.29, rx: 0.115, rz: 0.07, x: 0.01, z: -0.09, alpha: 0.68 },
  { y: 0.17, rx: 0.07, rz: 0.045, x: 0.07, z: -0.1, alpha: 0.48 },
  { y: 0.07, rx: 0.035, rz: 0.025, x: 0.05, z: -0.09, alpha: 0.26 },
  { y: 0.0, rx: 0, rz: 0, x: -0.02, z: -0.08, alpha: 0 },
];

/** The second, shorter ribbon, peeling away to the other side. */
export const WISP: Ring[] = [
  { y: 1.06, rx: 0, rz: 0, x: 0.14 },
  { y: 1.02, rx: 0.11, rz: 0.09, x: 0.14 },
  { y: 0.9, rx: 0.15, rz: 0.11, x: 0.19, z: -0.01 },
  { y: 0.76, rx: 0.135, rz: 0.09, x: 0.27, z: -0.03, alpha: 0.94 },
  { y: 0.62, rx: 0.105, rz: 0.068, x: 0.34, z: -0.05, alpha: 0.78 },
  { y: 0.49, rx: 0.07, rz: 0.046, x: 0.37, z: -0.07, alpha: 0.56 },
  { y: 0.38, rx: 0.035, rz: 0.025, x: 0.33, z: -0.08, alpha: 0.3 },
  { y: 0.3, rx: 0, rz: 0, x: 0.26, z: -0.08, alpha: 0 },
];

export const createTorsoGeometry = (detail = 1) => sweep(TORSO, { around: Math.round(84 * detail), along: Math.round(170 * detail) });
export const createWispGeometry = (detail = 1) => sweep(WISP, { around: Math.round(48 * detail), along: Math.round(70 * detail) });

/** A detached mitten hand, origin at its centre, thumb towards +X. */
export function createHandGeometry(): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.SphereGeometry(1, 40, 30);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  const thumb = new THREE.Vector3(0.78, 0.3, 0.42).normalize();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    // A rounded mitten that narrows towards the wrist, with a soft thumb bump.
    const taper = 1 + 0.16 * d.y;
    const bump = 0.075 * Math.max(0, d.dot(thumb)) ** 5;
    pos.setXYZ(i, d.x * (0.108 * taper + bump), d.y * 0.15 + bump * 0.3, d.z * (0.088 * taper + bump * 0.5));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Shoulder point a hand swings around, and how far out it floats. */
export const ARM = { x: 0.5, y: DIM.shoulderY, z: 0.1, length: 0.47, rest: 0.36 };

// ───────────────────────────── Soft-body layout ─────────────────────────────

/** Centre of a ring stack at height `y` (linear between rings). */
export function centreAt(rings: Ring[], y: number): { x: number; z: number } {
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    if (y <= a.y && y >= b.y) {
      const t = a.y === b.y ? 0 : (a.y - y) / (a.y - b.y);
      return { x: (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
    }
  }
  const end = y > rings[0].y ? rings[0] : rings[rings.length - 1];
  return { x: end.x ?? 0, z: end.z ?? 0 };
}

const along = (rings: Ring[], heights: number[]) =>
  heights.map((y) => {
    const c = centreAt(rings, y);
    return new THREE.Vector3(c.x, y, c.z);
  });

/**
 * Control points down the body. The first two (neck, chest) are the upper
 * torso and move with Loop's intention; the third is the lower torso; the
 * rest are the flexible sections of the long ribbon.
 */
export const TORSO_SPINE = along(TORSO, [1.62, 1.34, 1.02, 0.76, 0.52, 0.31, 0.14, 0.0]);

/** The short wisp: two points rooted in the lower torso, then its flexible sections. */
export const WISP_SPINE = along(WISP, [1.25, 1.04, 0.9, 0.76, 0.62, 0.49, 0.38, 0.3]);
