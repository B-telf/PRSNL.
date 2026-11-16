import * as THREE from 'three';
import { EXPRESSIONS, Face, type ExpressionName, type EyeStyle, type FaceParams, NEUTRAL } from './Face';
import {
  ANCHORS, BODY_HEIGHT, SHAPE,
  createArmGeometry, createBodyGeometry, createFootGeometry, createScreenGeometry, createVisorMask,
} from './geometry';
import { GESTURES, zeroPose, type Gesture, type GestureName, type Pose } from './gestures';
import { EYE_COLORS, SKINS, type EyeColorName, type Skin, type SkinName } from './skins';
import { Spring, clamp, damp, lerp } from './spring';

/** How much Loop moves on its own (catalog: Still / Subtle / Expressive). */
export type MotionLevel = 'still' | 'subtle' | 'expressive';

/** What Loop is doing for the user right now. */
export type LoopState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping';

export interface LoopOptions {
  skin?: SkinName | Skin;
  eyeColor?: EyeColorName | string;
  eyeStyle?: EyeStyle;
  motion?: MotionLevel;
  /** Display brightness, 0…2. */
  glow?: number;
  /** Mesh density multiplier; lower it on weak devices. */
  detail?: number;
  /** Blink, glance around and fidget unprompted. */
  idleLife?: boolean;
  /** Smile / giggle when tapped. Turn off to handle taps yourself. */
  tapReactions?: boolean;
}

export interface LoopEvents {
  tap: { count: number };
  grab: undefined;
  release: undefined;
  arrive: undefined;
  celebrate: undefined;
  gestureend: { name: string };
  statechange: { state: LoopState; previous: LoopState };
}

type Handler<T> = (payload: T) => void;

const MOTION: Record<MotionLevel, number> = { still: 0, subtle: 0.55, expressive: 1 };
const BEND_TOP = 0.95;
const ARM_REST = 0.16;

/**
 * Loop, the PRSNL companion.
 *
 * A `THREE.Group` you can drop into any scene. Its origin is the point on the
 * ground beneath it; it floats above that point. Call `update(dt)` every frame.
 */
export class Loop extends THREE.Group {
  readonly face = new Face();
  /** The visible model (everything except the ground shadow). */
  readonly model = new THREE.Group();
  /** Where Loop is trying to be, in its parent's space. Prefer `moveTo`. */
  readonly goal = new THREE.Vector3();
  /** Height of the ground in parent space, or null if there is none. */
  ground: number | null = 0;
  /** Resting hover height above the ground point. */
  hoverHeight = 0.2;
  idleLife: boolean;
  tapReactions: boolean;

  private readonly squash = new THREE.Group();
  private readonly bodyMat: THREE.MeshPhysicalMaterial;
  private readonly limbMat: THREE.MeshPhysicalMaterial;
  private readonly screenMat: THREE.MeshPhysicalMaterial;
  private readonly arms: THREE.Mesh[] = [];
  private readonly feet: THREE.Mesh[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly hit: THREE.Mesh;
  private readonly bend = { value: new THREE.Vector2() };
  private readonly wave = { value: new THREE.Vector3(0, 0, BEND_TOP) };
  /** x, y: sideways wobble of the belly; z: how far the belly bulges. */
  private readonly jellyU = { value: new THREE.Vector3() };
  private readonly rimU = { value: new THREE.Color() };
  private grainTex: THREE.Texture | null = null;

  // Motion state.
  private m = 1;
  private level: MotionLevel = 'expressive';
  private time = 0;
  private readonly eased = new THREE.Vector3();
  private readonly px = new Spring(0, 9, 0.5);
  private readonly py = new Spring(0, 9, 0.5);
  private readonly pz = new Spring(0, 9, 0.5);
  private readonly roll = new Spring(0, 8, 0.3);
  private readonly lean = new Spring(0, 8, 0.34);
  private readonly bendX = new Spring(0, 9, 0.26);
  private readonly bendZ = new Spring(0, 9, 0.26);
  private readonly wobX = new Spring(0, 13, 0.14);
  private readonly wobZ = new Spring(0, 13, 0.14);
  private readonly prevV = new THREE.Vector3();
  private readonly yaw = new Spring(0, 8, 0.8);
  private readonly pitch = new Spring(0, 8, 0.8);
  private readonly jelly = new Spring(0, 14, 0.15);
  private readonly approach = new Spring(0, 4, 0.9);
  private readonly feetX = [new Spring(0, 14, 0.42), new Spring(0, 12.5, 0.38)];
  private readonly feetY = [new Spring(0, 11, 0.3), new Spring(0, 9.5, 0.27)];
  private readonly armSwing = [new Spring(0, 10, 0.26), new Spring(0, 9, 0.24)];
  private held = false;
  private travelling = false;

  // Attention.
  private readonly lookTarget = new THREE.Vector3();
  private hasLookTarget = false;
  private glanceX = 0;
  private glanceY = 0;
  private glanceTimer = 0;
  private nextIdle = 4;
  private nextBlink = 2;
  private blinkT = -1;
  private blinkAgain = false;

  // Expression & state.
  private _state: LoopState = 'idle';
  private baseExpression = 'neutral';
  private tempExpression: string | null = null;
  private tempTimer = 0;
  private readonly expressions = new Map<string, FaceParams>(Object.entries(EXPRESSIONS));
  private readonly gestureDefs = new Map<string, Gesture>(Object.entries(GESTURES));
  private gesture: { name: string; def: Gesture; t: number; resolve: () => void } | null = null;
  private readonly pose: Pose = zeroPose();
  private talkLevel: number | null = null;
  private talkHold = 0;
  private tapCount = 0;
  private tapTimer = 0;

  private readonly handlers = new Map<string, Set<Handler<any>>>();
  private readonly tmp = new THREE.Vector3();

  constructor(options: LoopOptions = {}) {
    super();
    this.name = 'Loop';
    this.idleLife = options.idleLife ?? true;
    this.tapReactions = options.tapReactions ?? true;
    const detail = options.detail ?? 1;

    // The shell's map is plain white with the face opening cut out of its alpha.
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      map: createVisorMask(),
      alphaTest: 0.5,
      alphaToCoverage: true,
      // The rim's inner wall is seen from behind at glancing angles.
      side: THREE.DoubleSide,
    });
    this.bodyMat.name = 'LoopShell';
    this.limbMat = new THREE.MeshPhysicalMaterial();
    this.limbMat.name = 'LoopLimbs';
    this.screenMat = new THREE.MeshPhysicalMaterial({
      color: 0x050606,
      roughness: 0.7,
      envMapIntensity: 0.15,
      emissive: 0xffffff,
      emissiveMap: this.face.texture,
      emissiveIntensity: 1.9,
    });
    this.screenMat.name = 'LoopDisplay';

    // Soft-body deformation, done in the vertex shader: the base trails behind
    // the head, the belly wobbles sideways and bulges when squashed. The
    // display shares it so the face stays seated in the shell.
    const deform = (rim: boolean) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uLoopBend = this.bend;
      shader.uniforms.uLoopWave = this.wave;
      shader.uniforms.uLoopJelly = this.jellyU;
      shader.vertexShader =
        'uniform vec2 uLoopBend;\nuniform vec3 uLoopWave;\nuniform vec3 uLoopJelly;\n' +
        (rim ? 'attribute float loopMask;\nvarying float vLoopMask;\n' : '') +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          ${rim ? 'vLoopMask = loopMask;' : ''}
          float loopK = clamp((uLoopWave.z - transformed.y) / uLoopWave.z, 0.0, 1.0);
          float loopW = loopK * loopK;
          float loopB = sin(clamp(transformed.y / ${BODY_HEIGHT.toFixed(3)}, 0.0, 1.0) * 3.14159265);
          transformed.xz *= 1.0 + uLoopJelly.z * loopB;
          transformed.xz += uLoopBend * loopW + uLoopJelly.xy * loopB;
          transformed.x += sin(transformed.y * 5.0 + uLoopWave.y) * uLoopWave.x * loopW;
          transformed.z += cos(transformed.y * 4.0 + uLoopWave.y * 0.8) * uLoopWave.x * loopW;`,
        );
      if (rim) addRim(shader, this.rimU, true);
    };
    this.bodyMat.onBeforeCompile = deform(true);
    this.screenMat.onBeforeCompile = deform(false);
    this.limbMat.onBeforeCompile = (shader) => addRim(shader, this.rimU, false);

    const body = new THREE.Mesh(createBodyGeometry(detail), this.bodyMat);
    body.name = 'Body';
    const screen = new THREE.Mesh(createScreenGeometry(detail), this.screenMat);
    screen.name = 'Display';
    this.squash.add(body, screen);

    const armGeo = createArmGeometry();
    const footGeo = createFootGeometry();
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.limbMat);
      arm.name = side < 0 ? 'ArmL' : 'ArmR';
      arm.position.copy(ANCHORS.shoulder(side));
      this.arms.push(arm);
      const foot = new THREE.Mesh(footGeo, this.limbMat);
      foot.name = side < 0 ? 'FootL' : 'FootR';
      foot.position.copy(ANCHORS.foot(side));
      this.feet.push(foot);
      this.squash.add(arm, foot);
    }

    // Invisible, cheap stand-in used for pointer hit-testing.
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial());
    this.hit.scale.set(SHAPE.radius * 1.12, BODY_HEIGHT * 0.56, SHAPE.radius * 1.05);
    this.hit.position.y = BODY_HEIGHT * 0.48;
    this.hit.visible = false;
    this.hit.name = 'HitProxy';
    this.squash.add(this.hit);

    // Lean and turn about a point behind the face so the base swings like a tail.
    this.squash.position.y = -ANCHORS.pivotY;
    this.model.add(this.squash);
    this.add(this.model);

    this.shadow = createShadow();
    this.add(this.shadow);

    this.setSkin(options.skin ?? 'deep-teal');
    this.setEyeColor(options.eyeColor ?? 'warm-white');
    if (options.eyeStyle) this.face.style = options.eyeStyle;
    if (options.glow !== undefined) this.setGlow(options.glow);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setMotion(options.motion ?? (reduce ? 'still' : 'expressive'));
    this.update(0);
  }

  // ───────────────────────────── Appearance ─────────────────────────────

  setSkin(skin: SkinName | Skin): this {
    const s: Skin = typeof skin === 'string' ? SKINS[skin] : skin;
    if (!s) throw new Error(`Unknown Loop skin "${String(skin)}"`);
    const grain = s.grain ?? 0;
    if (grain > 0 && !this.grainTex) this.grainTex = createGrainTexture();
    for (const mat of [this.bodyMat, this.limbMat]) {
      mat.color.set(s.color);
      mat.roughness = s.roughness;
      mat.metalness = s.metalness ?? 0;
      mat.clearcoat = s.clearcoat ?? 0;
      mat.clearcoatRoughness = s.clearcoatRoughness ?? 0.3;
      mat.sheen = s.sheen ?? 0;
      mat.sheenRoughness = 0.55;
      mat.sheenColor.set(s.sheenColor ?? '#ffffff');
      mat.bumpMap = grain > 0 ? this.grainTex : null;
      mat.bumpScale = grain * 0.25;
      mat.needsUpdate = true;
    }
    this.rimU.value.set(s.rim ?? '#000000').multiplyScalar(0.3);
    return this;
  }

  setEyeColor(color: EyeColorName | string, right?: EyeColorName | string | null): this {
    const hex = (c: string) => (EYE_COLORS as Record<string, string>)[c] ?? c;
    this.face.color = hex(color);
    this.face.colorRight = right ? hex(right) : null;
    return this;
  }

  setEyeStyle(style: EyeStyle): this {
    this.face.style = style;
    return this;
  }

  /** Display brightness: 0 = dark, 1 = default, 2 = vivid. */
  setGlow(amount: number): this {
    const g = clamp(amount, 0, 2);
    this.screenMat.emissiveIntensity = 1.9 * g;
    this.face.glow = Math.min(g, 1.4);
    return this;
  }

  setMotion(level: MotionLevel): this {
    this.level = level;
    this.m = MOTION[level];
    return this;
  }

  get motion(): MotionLevel {
    return this.level;
  }

  // ───────────────────────────── Behaviour ─────────────────────────────

  get state(): LoopState {
    return this._state;
  }

  /** Switch what Loop is doing. Changes posture, face and idle behaviour. */
  setState(state: LoopState): this {
    if (state === this._state) return this;
    const previous = this._state;
    this._state = state;
    this.baseExpression = {
      idle: 'neutral', listening: 'attentive', thinking: 'thinking', speaking: 'neutral', sleeping: 'asleep',
    }[state];
    this.talkLevel = null;
    this.emit('statechange', { state, previous });
    return this;
  }

  /** Set the resting expression (until the state changes). */
  setExpression(name: ExpressionName | (string & {})): this {
    this.requireExpression(name);
    this.baseExpression = name;
    return this;
  }

  /** Flash an expression for `seconds`, then return to the resting one. */
  express(name: ExpressionName | (string & {}), seconds = 1.6): this {
    this.requireExpression(name);
    if (this.tempExpression !== name) this.jelly.kick(1.3);
    this.tempExpression = name;
    this.tempTimer = seconds;
    return this;
  }

  defineExpression(name: string, params: Partial<FaceParams>): this {
    this.expressions.set(name, { ...NEUTRAL, ...params });
    return this;
  }

  defineGesture(name: string, gesture: Gesture): this {
    this.gestureDefs.set(name, gesture);
    return this;
  }

  /** Play a gesture. Resolves when it finishes (or is replaced). */
  play(name: GestureName | (string & {})): Promise<void> {
    const def = this.gestureDefs.get(name);
    if (!def) throw new Error(`Unknown Loop gesture "${name}"`);
    this.gesture?.resolve();
    return new Promise((resolve) => {
      this.gesture = { name, def, t: 0, resolve };
    });
  }

  /**
   * Celebrate: Loop dances. On a `LoopStage` this also fills the screen with
   * confetti. Resolves when the dance ends.
   */
  celebrate(): Promise<void> {
    if (this._state === 'sleeping') this.setState('idle');
    this.jelly.kick(2.4);
    this.emit('celebrate', undefined);
    return this.play('dance');
  }

  /**
   * Drive the mouth while speaking. Pass a 0…1 loudness each frame (e.g. from
   * an audio analyser), or call with no argument for automatic babble.
   * Stops by itself shortly after the last call unless state is 'speaking'.
   */
  speak(level?: number): this {
    this.talkLevel = level === undefined ? null : clamp(level, 0, 1);
    this.talkHold = 0.25;
    return this;
  }

  /** Float to a point in parent space. `y` is the ground point, not the head. */
  moveTo(x: number, y = this.goal.y, z = this.goal.z): this {
    this.goal.set(x, y, z);
    this.travelling = true;
    return this;
  }

  /** Jump to a point instantly, with no travel. */
  teleport(x: number, y = 0, z = 0): this {
    this.goal.set(x, y, z);
    this.eased.copy(this.goal);
    this.px.snap(x);
    this.py.snap(y);
    this.pz.snap(z);
    this.position.copy(this.goal);
    return this;
  }

  /** Look at a point in world space; pass null to look around freely. */
  gazeAt(target: THREE.Vector3 | null): this {
    this.hasLookTarget = target !== null;
    if (target) this.lookTarget.copy(target);
    return this;
  }

  /** A tap: jelly squish plus (optionally) a happy reaction. */
  poke(strength = 1): this {
    this.jelly.kick(-3.1 * strength);
    this.wobX.kick((Math.random() - 0.5) * 1.2 * strength);
    this.tapCount = this.tapTimer > 0 ? this.tapCount + 1 : 1;
    this.tapTimer = 0.9;
    if (this.tapReactions) {
      if (this._state === 'sleeping') {
        this.setState('idle');
        void this.play('startle');
      } else if (this.tapCount >= 3) {
        this.tapCount = 0;
        void this.play('wiggle');
      } else {
        this.express('happy', 1.1);
      }
    }
    this.emit('tap', { count: this.tapCount });
    return this;
  }

  /** Begin dragging: Loop follows `moveTo` targets tightly and looks surprised. */
  grab(): this {
    this.held = true;
    this.jelly.kick(2.6);
    this.express('surprised', 0.6);
    this.emit('grab', undefined);
    return this;
  }

  release(): this {
    if (!this.held) return this;
    this.held = false;
    this.jelly.kick(-2);
    this.express('happy', 1);
    this.emit('release', undefined);
    return this;
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** Object to raycast against for pointer hits. */
  get hitTarget(): THREE.Object3D {
    return this.hit;
  }

  /** World-space centre of the body (handy for projecting to screen). */
  getCenter(out = new THREE.Vector3()): THREE.Vector3 {
    return this.hit.getWorldPosition(out);
  }

  // ───────────────────────────── Events ─────────────────────────────

  on<K extends keyof LoopEvents>(type: K, handler: Handler<LoopEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  private emit<K extends keyof LoopEvents>(type: K, payload: LoopEvents[K]): void {
    this.handlers.get(type)?.forEach((h) => h(payload));
  }

  // ───────────────────────────── Frame update ─────────────────────────────

  /** Advance the simulation. `dt` in seconds. */
  update(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.time += dt;
    const t = this.time;
    const m = this.m;
    const asleep = this._state === 'sleeping';

    // ── Travel: ease the target, then follow it on a soft spring → a glide
    // that starts gently, overshoots a touch and settles.
    this.eased.lerp(this.goal, damp(this.held ? 20 : 5.5, dt));
    const freq = this.held ? 13 : 8;
    for (const [s, v] of [[this.px, this.eased.x], [this.py, this.eased.y], [this.pz, this.eased.z]] as const) {
      s.freq = freq;
      s.target = v;
      s.update(dt);
    }
    this.position.set(this.px.value, this.py.value, this.pz.value);
    const vx = this.px.velocity;
    const vy = this.py.velocity;
    const vz = this.pz.velocity;
    const speed = Math.hypot(vx, vy, vz);
    if (this.travelling && !this.held && speed < 0.06 && this.position.distanceTo(this.goal) < 0.04) {
      this.travelling = false;
      this.emit('arrive', undefined);
    }

    // ── Gesture layer.
    const pose = this.pose;
    Object.assign(pose, zeroPose());
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt * 1.15;
      const p = g.t / g.def.duration;
      if (p >= 1) {
        this.gesture = null;
        g.resolve();
        this.emit('gestureend', { name: g.name });
      } else {
        g.def.apply(p, pose, g.t);
      }
    }

    // ── Lean into travel; the base trails behind and wobbles to rest.
    const k = Math.max(m, 0.25);
    const st = this._state;
    this.roll.target = clamp(-vx * 0.06, -0.4, 0.4) * k;
    this.lean.target = clamp(vz * 0.05 + vy * 0.01, -0.3, 0.3) * k;
    this.bendX.target = clamp(-vx * 0.06, -0.26, 0.26) * k;
    this.bendZ.target = clamp(-vz * 0.06, -0.24, 0.24) * k;
    // Jelly: the belly lags behind changes of speed, and the body squashes
    // when it brakes or is pushed upward.
    if (dt > 0) {
      const ax = (vx - this.prevV.x) / dt;
      const ay = (vy - this.prevV.y) / dt;
      const az = (vz - this.prevV.z) / dt;
      this.wobX.target = clamp(-ax * 0.006, -0.16, 0.16) * k;
      this.wobZ.target = clamp(-az * 0.006, -0.14, 0.14) * k;
      this.jelly.target = clamp(-ay * 0.004, -0.14, 0.14) * k;
      this.prevV.set(vx, vy, vz);
    }
    this.roll.update(dt);
    this.lean.update(dt);
    this.bendX.update(dt);
    this.bendZ.update(dt);
    this.wobX.update(dt);
    this.wobZ.update(dt);
    this.jelly.update(dt);
    this.approach.target = st === 'listening' ? 0.32 : 0;
    this.approach.update(dt);

    // ── Attention: turn the head part-way, let the eyes do the rest.
    let lookYaw = 0;
    let lookPitch = 0;
    if (st === 'thinking') {
      lookYaw = 0.42;
      lookPitch = -0.3;
    } else if (!asleep && this.hasLookTarget) {
      const head = this.tmp.set(0, this.hoverHeight + SHAPE.visor.y, 0);
      const local = this.worldToLocal(this.lookTarget.clone()).sub(head);
      lookYaw = clamp(Math.atan2(local.x, Math.max(local.z, 0.4)), -1.1, 1.1);
      lookPitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, Math.max(local.z, 0.4))), -0.8, 0.8);
    } else if (!asleep) {
      lookYaw = this.glanceX;
      lookPitch = this.glanceY;
    }
    this.yaw.target = lookYaw * 0.5;
    this.pitch.target = lookPitch * 0.4;
    this.yaw.update(dt);
    this.pitch.update(dt);
    const face = this.face;
    const eyeK = damp(14, dt);
    face.lookX = lerp(face.lookX, clamp((lookYaw - this.yaw.value) / 0.5, -1, 1), eyeK);
    face.lookY = lerp(face.lookY, clamp(-(lookPitch - this.pitch.value) / 0.4, -1, 1), eyeK);

    // ── Hover: slow layered bob and sway.
    const slow = asleep ? 0.55 : 1;
    const bob = (Math.sin(t * 2.3 * slow) * 0.06 + Math.sin(t * 1.2 * slow + 1.3) * 0.024) * m * (asleep ? 1.4 : 1);
    const sway = Math.sin(t * 0.62 + 0.4) * 0.035 * m;
    const idleRoll = Math.sin(t * 0.81) * 0.024 * m + (st === 'listening' ? 0.07 : 0) + (asleep ? 0.06 : 0);
    const hover = this.hoverHeight * lerp(0.45, 1, m) * (asleep ? 0.45 : 1);
    const breath = Math.sin(t * (asleep ? 1.2 : 2.3) + 0.6) * 0.016 * Math.max(m, 0.4);

    const model = this.model;
    model.position.set(
      sway + pose.slide,
      ANCHORS.pivotY + hover + bob + pose.lift,
      this.approach.value * k,
    );
    model.rotation.set(
      this.pitch.value + this.lean.value + pose.pitch + (st === 'listening' ? 0.09 : 0) + (asleep ? 0.1 : 0),
      this.yaw.value + pose.yaw + Math.sin(t * 0.37) * 0.05 * m,
      this.roll.value + idleRoll + pose.roll,
      'YXZ',
    );

    // ── Squash & stretch, volume-preserving.
    const sy = clamp(
      1 + breath + this.jelly.value + pose.stretch + clamp(Math.abs(vy) * 0.045 + Math.abs(vx) * 0.012, 0, 0.2) * k,
      0.68, 1.4,
    );
    const sxz = 1 / Math.sqrt(sy);
    this.squash.scale.set(sxz, sy, sxz);
    // Squashing pushes the belly out; stretching draws it in.
    const bulge = clamp((1 - sy) * 0.7, -0.1, 0.22) + Math.sin(t * 2.3 + 2.2) * 0.012 * m;
    const wx = this.wobX.value + Math.sin(t * 3.1) * 0.007 * m;
    const wz = this.wobZ.value + Math.cos(t * 2.7) * 0.005 * m;
    this.jellyU.value.set(wx, wz, bulge);

    // ── Trailing bend + hem ripple (shader), and limbs that lag a beat behind.
    this.bend.value.set(this.bendX.value, this.bendZ.value);
    this.wave.value.x = (0.016 + Math.min(speed, 5) * 0.007) * m;
    this.wave.value.y = t * 3.2;

    this.feet.forEach((foot, i) => {
      const side = i === 0 ? -1 : 1;
      const fx = this.feetX[i];
      const fy = this.feetY[i];
      fx.target = this.bendX.value;
      fy.target = clamp(-vy * 0.04, -0.1, 0.12) * k + Math.sin(t * 2.3 + i * 2.2) * 0.022 * m;
      fx.update(dt);
      fy.update(dt);
      const a = ANCHORS.foot(side);
      foot.position.set(a.x + fx.value, a.y + fy.value, a.z + this.bendZ.value);
      foot.rotation.set(-this.bendZ.value * 1.6 + fy.value * 1.5, 0, fx.value * 1.4);
    });

    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const sw = this.armSwing[i];
      sw.target = clamp(vx * 0.14, -0.7, 0.7) * k;
      sw.update(dt);
      const raise =
        ARM_REST + (i === 0 ? pose.armL : pose.armR) +
        Math.sin(t * 2.3 + 0.8 + i) * 0.08 * m +
        clamp(-vy * 0.22, -0.2, 0.9) * k +
        Math.max(0, -this.jelly.value) * 2.2;
      // Keep the shoulders seated on the wobbling, bulging belly.
      const a = ANCHORS.shoulder(side);
      const b = Math.sin((a.y / BODY_HEIGHT) * Math.PI);
      arm.position.set(a.x * (1 + bulge * b) + wx * b, a.y, a.z * (1 + bulge * b) + wz * b);
      arm.rotation.set(-this.bendZ.value * 0.8, 0, side * raise + sw.value);
    });

    // ── Ground shadow: fades and spreads with height.
    const alt = this.ground === null ? 0 : Math.max(0, this.position.y - this.ground);
    const h = alt + hover + bob + pose.lift;
    this.shadow.position.set(model.position.x * 0.6, -alt + 0.004, 0.02);
    const spread = 1 + h * 0.35;
    this.shadow.scale.set(spread * sxz, spread * sxz, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 / (1 + h * 1.6);

    this.updateFace(dt, speed);
  }

  private updateFace(dt: number, speed: number): void {
    const face = this.face;
    const asleep = this._state === 'sleeping';

    // Timed expressions.
    if (this.tempExpression && (this.tempTimer -= dt) <= 0) this.tempExpression = null;
    if (this.tapTimer > 0) this.tapTimer -= dt;
    const name = this.gesture?.def.expression ?? this.tempExpression ?? this.baseExpression;
    face.target = this.expressions.get(name) ?? NEUTRAL;
    face.winkRight = lerp(face.winkRight, name === 'wink' ? 1 : 0, damp(18, dt));

    // Blinking.
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const p = this.blinkT / 0.15;
      face.blink = p >= 1 ? 0 : Math.sin(p * Math.PI);
      if (p >= 1) {
        this.blinkT = -1;
        if (this.blinkAgain) {
          this.blinkAgain = false;
          this.nextBlink = 0.09;
        }
      }
    } else if (!asleep && (this.nextBlink -= dt) <= 0) {
      this.blinkT = 0;
      this.blinkAgain = Math.random() < 0.18;
      this.nextBlink = 2.2 + Math.random() * 3.6;
    }

    // Speech.
    this.talkHold -= dt;
    const speaking = this._state === 'speaking' || this.talkHold > 0;
    let talk = 0;
    if (speaking) {
      const tt = this.time;
      talk =
        this.talkLevel ??
        clamp(0.42 + Math.sin(tt * 17) * 0.3 + Math.sin(tt * 9.3 + 1) * 0.25 + Math.sin(tt * 3.1) * 0.15, 0, 1);
    }
    face.talk = lerp(face.talk, talk, damp(28, dt));

    // Idle life: glance around, and now and then a small gesture.
    if (this.idleLife && this._state === 'idle' && this.m > 0) {
      if ((this.glanceTimer -= dt) <= 0) {
        this.glanceX = 0;
        this.glanceY = 0;
      }
      const busy = this.gesture || this.held || speed > 0.3;
      if (!busy && (this.nextIdle -= dt) <= 0) {
        this.nextIdle = (5 + Math.random() * 7) / lerp(0.6, 1, this.m);
        const r = Math.random();
        if (r < 0.62 || this.hasLookTarget) {
          this.glanceX = (Math.random() - 0.5) * 1.3;
          this.glanceY = (Math.random() - 0.4) * 0.5;
          this.glanceTimer = 1.1 + Math.random() * 1.4;
        } else if (this.m >= 1) {
          void this.play(r < 0.82 ? 'tilt' : 'stretch');
        }
      }
    } else {
      this.glanceX = this.glanceY = 0;
    }

    face.update(dt);
  }

  private requireExpression(name: string): void {
    if (!this.expressions.has(name)) throw new Error(`Unknown Loop expression "${name}"`);
  }

  /** Names available to `setExpression` / `express`. */
  get expressionNames(): string[] {
    return [...this.expressions.keys()];
  }

  /** Names available to `play`. */
  get gestureNames(): string[] {
    return [...this.gestureDefs.keys()];
  }

  /** Free GPU resources. */
  dispose(): void {
    this.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        if (mat.map !== this.face.texture) mat.map?.dispose();
        mat.dispose();
      }
    });
    (this.shadow.material as THREE.MeshBasicMaterial).map?.dispose();
    this.grainTex?.dispose();
    this.face.dispose();
    this.handlers.clear();
  }
}

/**
 * Adds a soft glow at grazing angles so the shell reads as slightly
 * translucent. With `masked`, the face rim is kept matte and glow-free (using
 * the geometry's `loopMask`), so no highlights collect around the display.
 */
function addRim(
  shader: THREE.WebGLProgramParametersWithUniforms, color: { value: THREE.Color }, masked: boolean,
): void {
  shader.uniforms.uLoopRim = color;
  let frag = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    float loopRim = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
    totalEmissiveRadiance += uLoopRim * loopRim * loopRim * loopRim${masked ? ' * vLoopMask' : ''};`,
  );
  if (masked) {
    frag = frag.replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>
      material.roughness = mix(0.9, material.roughness, vLoopMask);
      #ifdef USE_CLEARCOAT
        material.clearcoat *= vLoopMask;
      #endif
      #ifdef USE_SHEEN
        material.sheenColor *= vLoopMask;
      #endif`,
    );
  }
  shader.fragmentShader = 'uniform vec3 uLoopRim;\n' + (masked ? 'varying float vLoopMask;\n' : '') + frag;
}

function createShadow(): THREE.Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const mat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: 0x1a1410,
    transparent: true,
    depthWrite: false,
    opacity: 0.4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.15), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'Shadow';
  mesh.renderOrder = -1;
  return mesh;
}

/** Fine noise used as a bump map for the soft-touch finish. */
function createGrainTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 110 + Math.random() * 60;
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 9);
  return tex;
}
