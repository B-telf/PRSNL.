import * as THREE from 'three';

/** Every chain has this many control points (fixed, so shaders can share code). */
export const NODES = 8;

export interface ChainSpec {
  /** Rest positions in body space, listed from the top down. */
  rest: THREE.Vector3[];
  /** How many leading nodes are driven by something else rather than simulated. */
  pinned: number;
  /** Per node: how quickly it chases its place (rad/s). Higher = tighter. */
  freq: number[];
  /** Per node: damping ratio. Lower = more follow-through. */
  damping: number[];
  /** Per node: furthest it may bend away from its rest direction (radians). */
  maxBend: number[];
  /** Per node: how much it takes part in the idle curl. */
  curl: number[];
}

/** Idle and posed shaping of a chain, updated every frame. */
export interface ChainShape {
  /** Phases of the two overlapping curl rhythms. */
  phaseA: number;
  phaseB: number;
  /** Overall curl strength. */
  amount: number;
  /** Opens the chain outward (+) around the body's forward axis. */
  spread: number;
}

const STEP = 1 / 180;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const seg = new THREE.Vector3();
const euler = new THREE.Euler();

const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const catmullD = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t * t);

/**
 * A flexible chain of points that trails behind whatever leads it.
 *
 * Each free node chases a place below its parent, but with its own inertia and
 * drag, so it lags during travel, carries on briefly when the leader changes
 * direction, then curls around to follow. Segment lengths are preserved, so the
 * chain bends like a ribbon rather than stretching like elastic.
 *
 * The simulation runs in the space the character travels through; the result
 * is handed to the vertex shader in body space (see `spineShader`).
 */
export class SoftChain {
  /** Shader uniforms: rest pose and current pose, both in body space. */
  readonly restU: { value: THREE.Vector3[] };
  readonly nowU: { value: THREE.Vector3[] };

  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly pinFrom: THREE.Vector3[] = [];
  private readonly pinTo: THREE.Vector3[] = [];
  private readonly linear = new THREE.Matrix3();
  private fresh = true;

  constructor(readonly spec: ChainSpec) {
    if (spec.rest.length !== NODES) throw new Error(`A chain needs exactly ${NODES} nodes`);
    this.restU = { value: spec.rest.map((v) => v.clone()) };
    this.nowU = { value: spec.rest.map((v) => v.clone()) };
    for (let i = 0; i < NODES; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.pinFrom.push(new THREE.Vector3());
      this.pinTo.push(new THREE.Vector3());
    }
  }

  /** Forget all motion; the next step starts from the rest pose. */
  reset(): void {
    this.fresh = true;
  }

  /** Nudge every free node (a tap, a pop of joy). `impulse` is a velocity. */
  kick(impulse: THREE.Vector3, falloff = 1): void {
    for (let i = this.spec.pinned; i < NODES; i++) {
      this.vel[i].addScaledVector(impulse, falloff * ((i - this.spec.pinned + 1) / (NODES - this.spec.pinned)));
    }
  }

  /**
   * Advance the chain.
   * @param toSim   body space → simulation space
   * @param toBody  simulation space → body space
   * @param pins    where the pinned nodes are now, in body space (defaults to rest)
   */
  step(dt: number, toSim: THREE.Matrix4, toBody: THREE.Matrix4, shape: ChainShape, pins?: THREE.Vector3[]): void {
    const { rest, pinned, freq, damping, maxBend, curl } = this.spec;
    this.linear.setFromMatrix4(toSim);

    for (let i = 0; i < pinned; i++) {
      this.pinFrom[i].copy(this.pinTo[i]);
      this.pinTo[i].copy(pins ? pins[i] : rest[i]).applyMatrix4(toSim);
    }
    if (this.fresh) {
      this.fresh = false;
      for (let i = 0; i < NODES; i++) {
        this.pos[i].copy(i < pinned && pins ? pins[i] : rest[i]).applyMatrix4(toSim);
        this.vel[i].set(0, 0, 0);
        if (i < pinned) this.pinFrom[i].copy(this.pinTo[i]);
      }
    }

    const steps = Math.max(1, Math.ceil(dt / STEP));
    const h = dt / steps;
    if (h > 0) {
      for (let s = 1; s <= steps; s++) {
        // Pinned nodes glide between frames so the free ones never see a jump.
        for (let i = 0; i < pinned; i++) this.pos[i].lerpVectors(this.pinFrom[i], this.pinTo[i], s / steps);

        for (let i = pinned; i < NODES; i++) {
          const parent = this.pos[i - 1];
          const p = this.pos[i];
          const v = this.vel[i];

          // Where this node wants to be: its rest segment, gently curling.
          seg.subVectors(rest[i], rest[i - 1]);
          const w = curl[i] * shape.amount;
          const swing = w * (0.2 * Math.sin(shape.phaseA - i * 0.85) + 0.1 * Math.sin(shape.phaseB - i * 0.6 + 1.3));
          const depth = w * 0.12 * Math.sin(shape.phaseB * 0.83 - i * 0.7 + 2.1);
          euler.set(depth, 0, swing + shape.spread * curl[i] * 0.5);
          seg.applyEuler(euler).applyMatrix3(this.linear);
          const length = seg.length();
          const target = tmpA.copy(parent).add(seg);

          // Inertia plus drag: lags in travel, overshoots a little on a reversal.
          const before = tmpB.copy(p);
          const om = freq[i];
          v.addScaledVector(tmpC.subVectors(target, p), om * om * h).multiplyScalar(Math.max(0, 1 - 2 * damping[i] * om * h));
          p.addScaledVector(v, h);

          // Keep the segment's length, and ease it away from folding back on itself.
          const dir = tmpC.subVectors(p, parent);
          if (dir.lengthSq() < 1e-10) dir.copy(seg);
          dir.normalize();
          const want = tmpD.copy(seg).divideScalar(length || 1);
          const cos = THREE.MathUtils.clamp(dir.dot(want), -1, 1);
          const angle = Math.acos(cos);
          const knee = maxBend[i] * 0.6;
          if (angle > knee) {
            // Free up to the knee, then eased towards the limit: never hit like a stop.
            const sin = Math.sin(angle) || 1;
            const room = maxBend[i] - knee;
            const f = (knee + room * Math.tanh((angle - knee) / room)) / angle;
            dir.multiplyScalar(Math.sin(f * angle) / sin).addScaledVector(want, Math.sin((1 - f) * angle) / sin).normalize();
          }
          p.copy(parent).addScaledVector(dir, length);
          v.subVectors(p, before).divideScalar(h);
        }
      }
    } else {
      for (let i = 0; i < pinned; i++) this.pos[i].copy(this.pinTo[i]);
    }

    for (let i = 0; i < NODES; i++) this.nowU.value[i].copy(this.pos[i]).applyMatrix4(toBody);
  }

  /**
   * Move a body-space point the way the shader moves vertices, so separate
   * objects (the chest light, a wisp's root) stay seated on the soft body.
   */
  deform(point: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.restU.value;
    const n = this.nowU.value;
    let s = 0;
    for (let i = 1; i < NODES - 1; i++) if (point.y < r[i].y) s = i;
    const i0 = Math.max(s - 1, 0);
    const i3 = Math.min(s + 2, NODES - 1);
    const t = THREE.MathUtils.clamp((r[s].y - point.y) / (r[s].y - r[s + 1].y), 0, 1);
    const at = (a: THREE.Vector3[], f: typeof catmull, o: THREE.Vector3) =>
      o.set(
        f(a[i0].x, a[s].x, a[s + 1].x, a[i3].x, t),
        f(a[i0].y, a[s].y, a[s + 1].y, a[i3].y, t),
        f(a[i0].z, a[s].z, a[s + 1].z, a[i3].z, t),
      );
    const c = at(r, catmull, new THREE.Vector3());
    const ct = at(r, catmullD, new THREE.Vector3()).normalize();
    const q = at(n, catmull, new THREE.Vector3());
    const qt = at(n, catmullD, new THREE.Vector3()).normalize();
    const cos = ct.dot(qt);
    const w = new THREE.Vector3().crossVectors(ct, qt);
    const d = new THREE.Vector3().subVectors(point, c);
    const k = 1 / (1 + Math.max(cos, -0.9));
    return out
      .copy(d)
      .multiplyScalar(cos)
      .add(new THREE.Vector3().crossVectors(w, d))
      .addScaledVector(w, w.dot(d) * k)
      .add(q);
  }
}

// ───────────────────────────── Shader side ─────────────────────────────

const SPINE_GLSL = /* glsl */ `
uniform vec3 uSpineRest[${NODES}];
uniform vec3 uSpineNow[${NODES}];
vec3 loopCR(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float t2 = t * t;
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * b - a - 3.0 * c + d) * t2 * t);
}
vec3 loopCRd(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  return 0.5 * ((c - a) + 2.0 * (2.0 * a - 5.0 * b + 4.0 * c - d) * t + 3.0 * (3.0 * b - a - 3.0 * c + d) * t * t);
}
// Bends a point (and its normal) with the chain: slide along the curve, then
// turn with it, so cross-sections stay round instead of shearing flat.
void loopSpine(inout vec3 p, inout vec3 n) {
  int s = 0;
  for (int i = 1; i < ${NODES - 1}; i++) { if (p.y < uSpineRest[i].y) s = i; }
  int i0 = max(s - 1, 0);
  int i3 = min(s + 2, ${NODES - 1});
  vec3 r0 = uSpineRest[i0]; vec3 r1 = uSpineRest[s]; vec3 r2 = uSpineRest[s + 1]; vec3 r3 = uSpineRest[i3];
  vec3 n0 = uSpineNow[i0]; vec3 n1 = uSpineNow[s]; vec3 n2 = uSpineNow[s + 1]; vec3 n3 = uSpineNow[i3];
  float t = clamp((r1.y - p.y) / (r1.y - r2.y), 0.0, 1.0);
  vec3 c = loopCR(r0, r1, r2, r3, t);
  vec3 ct = normalize(loopCRd(r0, r1, r2, r3, t));
  vec3 q = loopCR(n0, n1, n2, n3, t);
  vec3 qt = normalize(loopCRd(n0, n1, n2, n3, t));
  float cs = dot(ct, qt);
  vec3 w = cross(ct, qt);
  float k = 1.0 / (1.0 + max(cs, -0.9));
  vec3 d = p - c;
  p = q + d * cs + cross(w, d) + w * (dot(w, d) * k);
  n = n * cs + cross(w, n) + w * (dot(w, n) * k);
}
`;

export interface SoftMaterialOptions {
  /** Bend with this chain. */
  chain?: SoftChain;
  /** Extra delayed sway: 'hem' weights it towards a garment's lower edge and sleeves; 'drape' uses a per-vertex `loopSway` attribute. */
  sway?: { mode: 'hem' | 'drape'; offset: { value: THREE.Vector3 } };
  /** Glow along the silhouette. */
  rim?: { value: THREE.Color };
  /** Extra light gathering towards the lower end of a trail. */
  trailGlow?: { value: THREE.Color; top: number };
  /** 0…1: draw as a flat silhouette (for judging motion without detail), and its colour. */
  flat: { value: number };
  flatColor: { value: THREE.Color };
}

/**
 * Teaches a standard three.js material to bend with a chain, sway, glow at its
 * edges and collapse to a flat silhouette on request.
 */
export function makeSoft<T extends THREE.Material>(material: T, o: SoftMaterialOptions): T {
  const key = [o.chain ? 'spine' : '', o.sway?.mode ?? '', o.rim ? 'rim' : '', o.trailGlow ? 'trail' : ''].join('|');
  material.customProgramCacheKey = () => `loop-soft:${key}`;
  material.onBeforeCompile = (shader) => {
    const u = shader.uniforms;
    u.uLoopFlat = o.flat;
    u.uLoopFlatColor = o.flatColor;
    let vert = shader.vertexShader;
    let frag = shader.fragmentShader;
    let vHead = '';
    let fHead = 'uniform float uLoopFlat;\nuniform vec3 uLoopFlatColor;\n';

    if (o.chain) {
      u.uSpineRest = o.chain.restU;
      u.uSpineNow = o.chain.nowU;
      vHead += SPINE_GLSL;
      let pre = 'vec3 loopPos = position;\n';
      if (o.sway) {
        u.uLoopSway = o.sway.offset;
        vHead += 'uniform vec3 uLoopSway;\n';
        if (o.sway.mode === 'drape') {
          vHead += 'attribute float loopSway;\n';
          pre += 'loopPos += uLoopSway * loopSway;\n';
        } else {
          // Anchored at the shoulders; free at the hem and the sleeve openings.
          pre += `float loopHem = clamp((1.5 - position.y) / 0.53, 0.0, 1.0);
          float loopSleeve = clamp((abs(position.x) - 0.46) / 0.26, 0.0, 1.0);
          loopPos += uLoopSway * (loopHem * loopHem + loopSleeve * 0.7);\n`;
        }
      }
      if (o.trailGlow) {
        vHead += 'varying float vLoopTrail;\n';
        pre += `vLoopTrail = clamp((${o.trailGlow.top.toFixed(3)} - position.y) / ${o.trailGlow.top.toFixed(3)}, 0.0, 1.0);\n`;
      }
      vert = vert
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${pre}loopSpine(loopPos, objectNormal);`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = loopPos;');
    }

    if (o.rim) {
      u.uLoopRim = o.rim;
      fHead += 'uniform vec3 uLoopRim;\n';
      let glow = `float loopRim = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      totalEmissiveRadiance += uLoopRim * loopRim * loopRim * (0.35 + loopRim);`;
      if (o.trailGlow) {
        u.uLoopTrailGlow = o.trailGlow;
        fHead += 'uniform vec3 uLoopTrailGlow;\nvarying float vLoopTrail;\n';
        glow += '\ntotalEmissiveRadiance += uLoopTrailGlow * vLoopTrail * vLoopTrail * (0.4 + loopRim);';
      }
      frag = frag.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${glow}`);
    }

    frag = frag.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uLoopFlatColor, uLoopFlat);',
    );
    shader.vertexShader = vHead + vert;
    shader.fragmentShader = fHead + frag;
  };
  return material;
}
