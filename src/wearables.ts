import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TORSO, frontZ, sectionAt, sweep, type Ring } from './geometry';

/** Shape of the tee's body; a vest uses the same block with narrower shoulders. */
const TEE: Ring[] = [
  { y: 1.655, rx: 0.14, rz: 0.13 },
  { y: 1.63, rx: 0.19, rz: 0.155 },
  { y: 1.575, rx: 0.36, rz: 0.235 },
  { y: 1.5, rx: 0.48, rz: 0.292 },
  { y: 1.36, rx: 0.505, rz: 0.312 },
  { y: 1.15, rx: 0.505, rz: 0.318 },
  { y: 0.97, rx: 0.515, rz: 0.325 },
];
const VEST: Ring[] = [
  { y: 1.67, rx: 0.15, rz: 0.14 },
  { y: 1.63, rx: 0.19, rz: 0.16 },
  { y: 1.575, rx: 0.33, rz: 0.235 },
  { y: 1.5, rx: 0.44, rz: 0.29 },
  { y: 1.36, rx: 0.465, rz: 0.305 },
  { y: 1.15, rx: 0.455, rz: 0.305 },
  { y: 1.0, rx: 0.46, rz: 0.31 },
];
const SECTION = 2.5;

/** The surface the chain and chest light rest on: clothing if worn, else the body. */
export function chestSurface(kind: 'tee' | 'vest' | null, x: number, y: number): number {
  if (kind === 'tee') return frontZ(TEE, x, y, SECTION);
  if (kind === 'vest') return frontZ(VEST, x, y, SECTION);
  return frontZ(TORSO, x, y);
}

/** How a wearable's material is taught to move: 'hem' for fabric, 'drape' for the chain. */
export type Soften = <T extends THREE.Material>(material: T, sway: 'hem' | 'drape') => T;

/**
 * Bakes a mesh's own placement into its geometry, so every wearable lives in
 * body space and can bend with the body in the vertex shader.
 */
function baked(geo: THREE.BufferGeometry, place: (m: THREE.Object3D) => void, mat: THREE.Material, name: string): THREE.Mesh {
  const dummy = new THREE.Object3D();
  place(dummy);
  dummy.updateMatrix();
  geo.applyMatrix4(dummy.matrix);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  return mesh;
}

const ring = (y: number, rx: number, rz: number, tube: number, mat: THREE.Material, name: string) =>
  baked(new THREE.TorusGeometry(1, tube / rx, 10, 48), (o) => {
    o.rotation.x = Math.PI / 2;
    o.scale.set(rx, rz, rx);
    o.position.y = y;
  }, mat, name);

/**
 * A cropped, boxy tee or a zip vest, fitted over the torso. It stays anchored
 * at the shoulders while its hem and sleeves follow movement a beat late.
 */
export function createOutfit(kind: 'tee' | 'vest', color: string, soften: Soften): THREE.Group {
  const group = new THREE.Group();
  group.name = kind === 'tee' ? 'Tee' : 'Vest';
  const fabric = soften(new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, side: THREE.DoubleSide }), 'hem');
  fabric.name = 'LoopFabric';
  const rings = kind === 'tee' ? TEE : VEST;

  const body = new THREE.Mesh(sweep(rings, { around: 96, along: 60, exponent: SECTION }), fabric);
  body.name = 'OutfitBody';
  group.add(body);

  // Ribbed collar and a rolled hem give the fabric visible thickness.
  const top = rings[0];
  const hem = rings[rings.length - 1];
  group.add(ring(top.y, top.rx, top.rz, kind === 'tee' ? 0.022 : 0.03, fabric, 'Collar'));
  group.add(ring(hem.y, hem.rx, hem.rz, 0.012, fabric, 'Hem'));

  if (kind === 'tee') {
    for (const side of [-1, 1]) {
      const place = (o: THREE.Object3D) => {
        o.position.set(side * 0.535, 1.37, 0);
        o.rotation.z = side * 0.68;
        o.scale.z = 1.12;
      };
      group.add(baked(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 40, 6, true), place, fabric, side < 0 ? 'SleeveL' : 'SleeveR'));
      const cuff = new THREE.TorusGeometry(0.2, 0.012, 8, 40);
      cuff.rotateX(Math.PI / 2);
      cuff.translate(0, -0.15, 0);
      group.add(baked(cuff, place, fabric, 'Cuff'));
    }
  } else {
    // Zip: a slim metal line down the front that follows the chest.
    const metal = soften(new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 1 }), 'hem');
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const y = hem.y + (1.62 - hem.y) * (i / 16);
      pts.push(new THREE.Vector3(0, y, frontZ(VEST, 0, y, SECTION) + 0.004));
    }
    const zip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.011, 8), metal);
    zip.name = 'Zip';
    const pull = baked(new THREE.BoxGeometry(0.03, 0.06, 0.014), (o) => {
      o.position.set(0, 1.5, frontZ(VEST, 0, 1.5, SECTION) + 0.014);
    }, metal, 'ZipPull');
    group.add(zip, pull);
  }
  return group;
}

/**
 * A curb chain that sits on the collar and drapes onto the chest. The links
 * are one mesh; each carries a `loopSway` weight (0 behind the neck, 1 at the
 * lowest point in front) so the hanging part can swing and settle.
 */
export function createChain(color: string, outfit: 'tee' | 'vest' | null, soften: Soften): THREE.Mesh {
  const COUNT = 58;
  const metal = soften(new THREE.MeshStandardMaterial({ color, roughness: 0.24, metalness: 1 }), 'drape');
  metal.name = 'LoopChain';

  // The path: high around the back of the neck, dropping to the chest in front.
  // On the bare body it sits lower, resting on the slope of the shoulders.
  const top = outfit ? 1.655 : 1.57;
  const point = (a: number, out: THREE.Vector3) => {
    const front = (1 + Math.cos(a)) / 2;
    const x = Math.sin(a) * 0.205;
    const y = top - 0.2 * front ** 2.2;
    const resting = chestSurface(outfit, x, y) + 0.016;
    const behind = -(sectionAt(TORSO, 1.6).rz + 0.05);
    const blend = THREE.MathUtils.smoothstep(Math.cos(a), -0.55, 0.35);
    return out.set(x, y, THREE.MathUtils.lerp(behind, resting, blend));
  };

  const links: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const roll = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    point(a, p);
    point(a + 0.01, next);
    tangent.subVectors(next, p).normalize();
    q.setFromUnitVectors(X, tangent);
    // Alternate links turn a quarter, like a real chain.
    roll.setFromAxisAngle(X, i % 2 ? Math.PI / 2.4 : -0.25);
    q.multiply(roll);
    const link = new THREE.TorusGeometry(0.021, 0.0068, 6, 14);
    link.scale(1.35, 1, 1);
    link.applyMatrix4(m.compose(p, q, new THREE.Vector3(1, 1, 1)));
    const sway = ((1 + Math.cos(a)) / 2) ** 1.6;
    link.setAttribute('loopSway', new THREE.BufferAttribute(new Float32Array(link.getAttribute('position').count).fill(sway), 1));
    links.push(link);
  }
  const mesh = new THREE.Mesh(mergeGeometries(links), metal);
  links.forEach((l) => l.dispose());
  mesh.name = 'Chain';
  return mesh;
}

/**
 * The open loop of light on the chest: PRSNL's signature, present in every skin.
 * `set` chooses its colour and resting strength; `pulse` is the live, per-frame
 * brightness (breathing, joy), which also swells the surrounding halo.
 */
export function createCore(): {
  group: THREE.Group;
  set(color: string, strength: number): void;
  pulse(level: number): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = 'Core';
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const arc = new THREE.TorusGeometry(0.1, 0.0115, 12, 72, Math.PI * 1.76);
  arc.rotateZ(Math.PI * 0.42); // the opening sits at the upper right
  arc.scale(1, 0.56, 1);       // a wide, low loop
  const loop = new THREE.Mesh(arc, ringMat);
  loop.name = 'CoreLoop';

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const haloTex = new THREE.CanvasTexture(canvas);
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), haloMat);
  halo.name = 'CoreHalo';
  halo.position.z = 0.004;
  group.add(halo, loop);

  const base = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  let rest = 1;
  const api = {
    group,
    set(color: string, strength: number) {
      base.set(color);
      haloMat.color.copy(base);
      rest = strength;
      api.pulse(1);
    },
    pulse(level: number) {
      const s = rest * level;
      ringMat.color.copy(base).lerp(white, 0.45).multiplyScalar(Math.min(1.9, 0.6 + s * 0.6));
      haloMat.opacity = Math.min(1, 0.42 * s);
      halo.scale.setScalar(0.8 + 0.2 * level);
    },
    dispose() {
      haloTex.dispose();
    },
  };
  return api;
}
