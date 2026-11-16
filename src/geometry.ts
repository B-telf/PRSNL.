import * as THREE from 'three';

/**
 * Loop's proportions ("Streamlined" base). Everything is in model units:
 * the body stands on y = 0 and is ~1.9 units tall; the face looks down +Z.
 */
export const SHAPE = {
  /** Widest radius of the body. */
  radius: 0.74,
  /** Height of the widest point. */
  waistY: 0.8,
  /** Distance from the waist down to the base. */
  lowerH: 0.8,
  /** Distance from the waist up to the crown. */
  upperH: 1.1,
  /** Superellipse exponents: higher = boxier. */
  lowerN: 2.9,
  upperN: 2.55,
  /** How much the sides narrow towards the crown. */
  taper: 0.085,
  /** Front-to-back flattening. */
  depth: 0.93,

  /** Face opening, described on the body surface as (angle, height). */
  visor: {
    y: 1.27,
    halfAngle: 0.98,
    halfHeight: 0.262,
    exponent: 3.3,
    /** Corners droop slightly, like a hood. */
    droop: 0.022,
    inset: 0.075,
  },
} as const;

export const BODY_HEIGHT = SHAPE.waistY + SHAPE.upperH;

/** Body radius at a given height, before the face opening is carved. */
export function radiusAtY(y: number): number {
  const { radius, waistY, lowerH, upperH, lowerN, upperN, taper } = SHAPE;
  if (y >= waistY) {
    const s = Math.min(1, (y - waistY) / upperH);
    const c = Math.pow(Math.max(0, 1 - Math.pow(s, upperN)), 1 / upperN);
    return radius * c * (1 - taper * s);
  }
  const s = Math.min(1, (waistY - y) / lowerH);
  return radius * Math.pow(Math.max(0, 1 - Math.pow(s, lowerN)), 1 / lowerN);
}

/** 0 at the centre of the face opening, 1 on its edge, >1 outside. */
function visorField(theta: number, y: number): number {
  const v = SHAPE.visor;
  const xv = Math.abs(theta / v.halfAngle);
  const yv = Math.abs((y - v.y + v.droop * theta * theta) / v.halfHeight);
  return Math.pow(Math.pow(xv, v.exponent) + Math.pow(yv, v.exponent), 1 / v.exponent);
}

/** Width of the bevelled rim around the opening, in field units. */
const RIM = 0.24;
/** Flat shelf just outside the opening, so its cut edge lies on a smooth surface. */
const SHELF = 0.035;

/** 0 at the opening's edge … 1 where the rim has fully blended into the shell. */
function rimBlend(f: number): number {
  const t = Math.min(1, Math.max(0, (f - 1 - SHELF) / RIM));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/** How far the display sits behind the opening's edge. */
const GLASS_DEPTH = 0.012;

function surfacePoint(theta: number, y: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(theta) * r, y, Math.cos(theta) * r * SHAPE.depth);
}

/**
 * The shell: a tapered capsule with the face opening pressed into it.
 * `detail` scales tessellation (1 ≈ 115k triangles).
 */
export function createBodyGeometry(detail = 1): THREE.BufferGeometry {
  const NU = Math.round(320 * detail); // around
  const NV = Math.round(180 * detail); // bottom → top
  const v = SHAPE.visor;
  const positions = new Float32Array((NU + 1) * (NV + 1) * 3);
  const uvs = new Float32Array((NU + 1) * (NV + 1) * 2);
  // 0 inside the face rim, 1 on the open shell: lets the material keep the rim matte.
  const masks = new Float32Array((NU + 1) * (NV + 1));
  const p = new THREE.Vector3();

  for (let i = 0; i <= NV; i++) {
    // Sample by angle along the profile so the rounded base and crown stay smooth.
    const phi = (i / NV - 0.5) * Math.PI;
    const s = Math.sin(phi);
    const y =
      s >= 0
        ? SHAPE.waistY + SHAPE.upperH * Math.pow(s, 2 / SHAPE.upperN)
        : SHAPE.waistY - SHAPE.lowerH * Math.pow(-s, 2 / SHAPE.lowerN);
    const baseR = i === 0 || i === NV ? 0 : radiusAtY(y);

    for (let j = 0; j <= NU; j++) {
      // Seam sits at the back (theta = ±PI).
      const theta = (j / NU) * Math.PI * 2 - Math.PI;
      const f = visorField(theta, y);
      // Rim: steep at the opening's edge, easing out into the shell.
      // The shell eases down into the opening with no crease at either end.
      const blend = rimBlend(f);
      const r = baseR === 0 ? 0 : baseR - v.inset * (1 - blend);
      masks[i * (NU + 1) + j] = blend;
      surfacePoint(theta, y, r, p);
      const k = i * (NU + 1) + j;
      positions.set([p.x, p.y, p.z], k * 3);
      uvs.set([j / NU, i / NV], k * 2);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < NV; i++) {
    for (let j = 0; j < NU; j++) {
      const a = i * (NU + 1) + j;
      const b = a + 1;
      const c = a + NU + 1;
      const d = c + 1;
      if (i > 0) indices.push(a, b, c);
      if (i < NV - 1) indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('loopMask', new THREE.BufferAttribute(masks, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Weld normals across the back seam and at the poles so no crease shows.
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  const na = new THREE.Vector3();
  const nb = new THREE.Vector3();
  for (let i = 0; i <= NV; i++) {
    const a = i * (NU + 1);
    const b = a + NU;
    if (i === 0 || i === NV) {
      for (let j = 0; j <= NU; j++) n.setXYZ(a + j, 0, i === 0 ? -1 : 1, 0);
      continue;
    }
    na.fromBufferAttribute(n, a);
    nb.fromBufferAttribute(n, b);
    na.add(nb).normalize();
    n.setXYZ(a, na.x, na.y, na.z);
    n.setXYZ(b, na.x, na.y, na.z);
  }
  return geo;
}

/**
 * The shell's `map`. Its alpha cuts out the face opening (use `alphaTest: 0.5`);
 * it stores a soft gradient across the edge, so the cut-out stays smooth at any
 * zoom instead of following the mesh's facets. Its colour carries gentle baked
 * shading: darker towards the base and inside the rim.
 */
export function createVisorMask(size = 1024): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4).fill(255);
  for (let j = 0; j < size; j++) {
    const phi = ((j + 0.5) / size - 0.5) * Math.PI;
    const sn = Math.sin(phi);
    const y =
      sn >= 0
        ? SHAPE.waistY + SHAPE.upperH * Math.pow(sn, 2 / SHAPE.upperN)
        : SHAPE.waistY - SHAPE.lowerH * Math.pow(-sn, 2 / SHAPE.lowerN);
    // Depth cue: the shell is a touch deeper in tone towards its base.
    const height = 0.8 + 0.2 * Math.min(1, Math.max(0, y / (BODY_HEIGHT * 0.75)));
    for (let i = 0; i < size; i++) {
      const theta = ((i + 0.5) / size) * Math.PI * 2 - Math.PI;
      const f = visorField(theta, y);
      const k = (j * size + i) * 4;
      // Soft occlusion inside the rim, where the shell dips towards the display.
      const shade = Math.round(255 * height * (0.6 + 0.4 * rimBlend(f)));
      data[k] = data[k + 1] = data[k + 2] = shade;
      data[k + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + (f - 1) * 6)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A point on the display, in face coordinates: fx, fy ∈ [-1, 1] across the
 * opening's bounding box. `lift` raises the point off the glass.
 */
export function facePoint(fx: number, fy: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const v = SHAPE.visor;
  const theta = fx * v.halfAngle;
  const y = v.y + fy * v.halfHeight - v.droop * theta * theta;
  return surfacePoint(theta, y, radiusAtY(y) - v.inset - GLASS_DEPTH + lift, out);
}

/**
 * The dark display that sits just behind the face opening, following the
 * shell's curvature.
 * UVs span the opening's bounding box (the face canvas maps straight onto it).
 */
export function createScreenGeometry(detail = 1): THREE.BufferGeometry {
  const RINGS = Math.round(20 * detail);
  const SPOKES = Math.round(96 * detail);
  const e = 2 / SHAPE.visor.exponent;
  // Extends well past the opening, under the rim, so no view angle sees its edge.
  const reach = 1.3;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();

  const push = (fx: number, fy: number) => {
    facePoint(fx, fy, 0, p);
    positions.push(p.x, p.y, p.z);
    uvs.push(fx * 0.5 + 0.5, fy * 0.5 + 0.5);
  };

  push(0, 0);
  for (let r = 1; r <= RINGS; r++) {
    const s = (r / RINGS) * reach;
    for (let k = 0; k < SPOKES; k++) {
      const a = (k / SPOKES) * Math.PI * 2;
      const c = Math.cos(a);
      const si = Math.sin(a);
      push(s * Math.sign(c) * Math.pow(Math.abs(c), e), s * Math.sign(si) * Math.pow(Math.abs(si), e));
    }
  }
  for (let k = 0; k < SPOKES; k++) {
    indices.push(0, 1 + k, 1 + ((k + 1) % SPOKES));
  }
  for (let r = 1; r < RINGS; r++) {
    const a0 = 1 + (r - 1) * SPOKES;
    const b0 = a0 + SPOKES;
    for (let k = 0; k < SPOKES; k++) {
      const k1 = (k + 1) % SPOKES;
      indices.push(a0 + k, b0 + k, b0 + k1, a0 + k, b0 + k1, a0 + k1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Small flipper arm. Its origin is the shoulder; it hangs down −Y. */
export function createArmGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 40, 28);
  geo.scale(0.125, 0.215, 0.14);
  geo.translate(0, -0.15, 0);
  return geo;
}

/** Low rounded foot, origin at its centre. */
export function createFootGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 40, 28);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  // Puff the sphere towards a rounded puck so the foot reads as flat-soled.
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 3;
    const k = 1 / Math.pow(Math.pow(Math.abs(x), n) + Math.pow(Math.abs(y), n) + Math.pow(Math.abs(z), n), 1 / n);
    pos.setXYZ(i, x * k * 0.2, y * k * 0.105, z * k * 0.235);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Where the limbs attach. `side` is −1 or +1 along X. */
export const ANCHORS = {
  shoulder: (side: number) => new THREE.Vector3(side * (radiusAtY(0.74) - 0.02), 0.74, 0.06),
  foot: (side: number) => new THREE.Vector3(side * 0.27, -0.035, 0.05),
  /** Pivot for leaning and turning: roughly behind the face. */
  pivotY: 1.15,
};
