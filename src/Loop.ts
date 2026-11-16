import * as THREE from 'three';
import { EXPRESSIONS, Face, type ExpressionName, type FaceParams, NEUTRAL } from './Face';
import {
  ARM, DIM,
  createFaceGeometry, createHandGeometry, createHeadGeometry, createTorsoGeometry, createWispGeometry,
} from './geometry';
import { GESTURES, zeroPose, type Gesture, type GestureName, type Pose } from './gestures';
import {
  CHAINS, EYE_COLORS, OUTFITS, SKINS, SOULFORMS, soulformFor,
  type ChainName, type EyeColorName, type OutfitName, type Skin, type SkinName,
} from './skins';
import { Spring, clamp, damp, lerp } from './spring';
import { chestSurface, createChain, createCore, createOutfit } from './wearables';

/** How much Loop moves on its own. */
export type MotionLevel = 'still' | 'subtle' | 'expressive';

/** Loop's base state: what it is doing for the user right now. */
export type LoopState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping';

/** Wearable slots. */
export type Slot = 'outfit' | 'chain' | 'eyes';

export interface LoopOptions {
  skin?: SkinName | Skin;
  outfit?: OutfitName;
  chain?: ChainName;
  eyes?: EyeColorName | string;
  motion?: MotionLevel;
  /** Strength of the chest light and body glow, 0…2. */
  glow?: number;
  /** Cumulative "light" the user has earned; sets the Soulform stage. */
  light?: number;
  /** Mesh density multiplier; lower it on weak devices. */
  detail?: number;
  /** Blink, glance around and fidget unprompted. */
  idleLife?: boolean;
  /** Smile / giggle when tapped. Turn off to handle taps yourself. */
  tapReactions?: boolean;
  /** Seconds of idle before Loop falls asleep (0 = never). */
  sleepAfter?: number;
}

export interface LoopEvents {
  tap: { count: number };
  grab: undefined;
  release: undefined;
  arrive: undefined;
  /** A celebration has actually started (it may have been deferred). */
  celebrate: undefined;
  /** Something asked for quiet: stop any confetti. */
  calm: undefined;
  gestureend: { name: string };
  statechange: { state: LoopState; previous: LoopState };
}

type Handler<T> = (payload: T) => void;

const MOTION: Record<MotionLevel, number> = { still: 0, subtle: 0.55, expressive: 1 };
/** Gestures that read as celebration; concern cancels them. */
const FESTIVE = new Set(['dance', 'celebrate', 'spin', 'shuffle', 'wiggle']);
/** Expressions that ask for stillness. */
const QUIETING = new Set(['concerned', 'quiet']);

/**
 * Loop, the PRSNL companion, in its Soulform: a small ghost with a swept
 * head, a wearable torso, two trailing wisps, detached hands and an open
 * loop of light at the chest.
 *
 * A `THREE.Group` you can drop into any scene. Its origin is the point
 * beneath the trail. Call `update(dt)` every frame.
 *
 * Layers stay independent: the base state, a temporary gesture, a temporary
 * expression, the look (skin and wearables) and growth never overwrite each
 * other.
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
  hoverHeight = 0.16;
  idleLife: boolean;
  tapReactions: boolean;
  /** Seconds of idle before sleeping; 0 disables. */
  sleepAfter: number;
  /** Called when Loop is tapped (after it has woken, if it was asleep). */
  onTap: (() => void) | null = null;

  private readonly squash = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hands: THREE.Mesh[] = [];
  private readonly bodyMat: THREE.MeshPhysicalMaterial;
  private readonly trailMat: THREE.MeshPhysicalMaterial;
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly core = createCore();
  private readonly orbit: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly hit: THREE.Mesh;
  private outfitGroup: THREE.Group | null = null;
  private chainMesh: THREE.InstancedMesh | null = null;
  private readonly bend = { value: new THREE.Vector2() };
  private readonly wave = { value: new THREE.Vector3(0, 0, DIM.trailTop) };
  private readonly rimU = { value: new THREE.Color() };
  private readonly trailGlowU = { value: new THREE.Color() };

  // Look.
  private skin: Skin = SKINS.pearl;
  private outfit: OutfitName = 'none';
  private chain: ChainName = 'none';
  private glowAmount = 1;
  private light = 0;
  private stage = 0;

  // Motion.
  private m = 1;
  private level: MotionLevel = 'expressive';
  private time = 0;
  private readonly eased = new THREE.Vector3();
  private readonly px = new Spring(0, 8, 0.5);
  private readonly py = new Spring(0, 8, 0.5);
  private readonly pz = new Spring(0, 8, 0.5);
  private readonly roll = new Spring(0, 8, 0.32);
  private readonly lean = new Spring(0, 8, 0.36);
  private readonly bendX = new Spring(0, 7.5, 0.22);
  private readonly bendZ = new Spring(0, 7.5, 0.22);
  private readonly yaw = new Spring(0, 8, 0.8);
  private readonly pitch = new Spring(0, 8, 0.8);
  private readonly jelly = new Spring(0, 13, 0.18);
  private readonly approach = new Spring(0, 4, 0.9);
  // The head floats a beat behind the body.
  private readonly headX = new Spring(0, 10, 0.3);
  private readonly headY = new Spring(0, 10, 0.34);
  private readonly headYaw = new Spring(0, 9, 0.7);
  private readonly headPitch = new Spring(0, 9, 0.7);
  private readonly handX = [new Spring(0, 9, 0.3), new Spring(0, 8.2, 0.28)];
  private readonly handY = [new Spring(0, 9, 0.32), new Spring(0, 8.2, 0.3)];
  private readonly prevV = new THREE.Vector3();
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
  private idleFor = 0;

  // Layers.
  private _state: LoopState = 'idle';
  private baseExpression = 'neutral';
  private tempExpression: string | null = null;
  private tempTimer = 0;
  private readonly expressions = new Map<string, FaceParams>(Object.entries(EXPRESSIONS));
  private readonly gestureDefs = new Map<string, Gesture>(Object.entries(GESTURES));
  private gesture: { name: string; def: Gesture; t: number; resolve: () => void } | null = null;
  private readonly pose: Pose = zeroPose();
  private pendingCelebration: (() => void)[] | null = null;
  private talkLevel: number | null = null;
  private tapCount = 0;
  private tapTimer = 0;
  private disposed = false;

  private readonly handlers = new Map<string, Set<Handler<any>>>();
  private readonly tmp = new THREE.Vector3();

  constructor(options: LoopOptions = {}) {
    super();
    this.name = 'Loop';
    this.idleLife = options.idleLife ?? true;
    this.tapReactions = options.tapReactions ?? true;
    this.sleepAfter = options.sleepAfter ?? 180;
    const detail = options.detail ?? 1;

    this.bodyMat = new THREE.MeshPhysicalMaterial({ clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.5, sheenRoughness: 0.5 });
    this.bodyMat.name = 'LoopBody';
    this.bodyMat.onBeforeCompile = (shader) => addGlow(shader, this.rimU, null);

    // The torso and wisps fade out towards their tips and sway in the vertex shader.
    this.trailMat = new THREE.MeshPhysicalMaterial({
      clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.5, sheenRoughness: 0.5,
      vertexColors: true, transparent: true,
    });
    this.trailMat.name = 'LoopTrail';
    this.trailMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLoopBend = this.bend;
      shader.uniforms.uLoopWave = this.wave;
      shader.vertexShader =
        'uniform vec2 uLoopBend;\nuniform vec3 uLoopWave;\nvarying float vLoopTrail;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float loopK = clamp((uLoopWave.z - transformed.y) / uLoopWave.z, 0.0, 1.0);
          float loopW = loopK * loopK;
          vLoopTrail = loopK;
          transformed.xz += uLoopBend * loopW;
          transformed.x += sin(transformed.y * 4.2 + uLoopWave.y) * uLoopWave.x * loopW;
          transformed.z += cos(transformed.y * 3.4 + uLoopWave.y * 0.8) * uLoopWave.x * 0.7 * loopW;`,
        );
      addGlow(shader, this.rimU, this.trailGlowU);
    };

    this.faceMat = new THREE.MeshBasicMaterial({
      map: this.face.texture, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.faceMat.name = 'LoopFace';

    const torso = new THREE.Mesh(createTorsoGeometry(detail), this.trailMat);
    torso.name = 'Torso';
    const wisp = new THREE.Mesh(createWispGeometry(detail), this.trailMat);
    wisp.name = 'Wisp';
    torso.renderOrder = wisp.renderOrder = 1;
    this.squash.add(torso, wisp, this.core.group);

    const skull = new THREE.Mesh(createHeadGeometry(detail), this.bodyMat);
    skull.name = 'Head';
    const faceMesh = new THREE.Mesh(createFaceGeometry(), this.faceMat);
    faceMesh.name = 'Face';
    faceMesh.renderOrder = 3;
    this.head.name = 'HeadRig';
    this.head.add(skull, faceMesh);
    this.squash.add(this.head);

    const handGeo = createHandGeometry();
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(handGeo, this.bodyMat);
      hand.name = side < 0 ? 'HandL' : 'HandR';
      hand.scale.x = -side; // thumbs point inward
      this.hands.push(hand);
      this.squash.add(hand);
    }

    // A small mote that circles the chest at higher Soulform stages.
    this.orbit = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }),
    );
    this.orbit.name = 'OrbitMote';
    this.orbit.visible = false;
    this.squash.add(this.orbit);

    // Invisible, cheap stand-in used for pointer hit-testing.
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial());
    this.hit.scale.set(0.78, 1.5, 0.62);
    this.hit.position.y = DIM.height * 0.5;
    this.hit.visible = false;
    this.hit.name = 'HitProxy';
    this.squash.add(this.hit);

    this.squash.position.y = -DIM.pivotY;
    this.model.add(this.squash);
    this.add(this.model);
    this.shadow = createShadow();
    this.add(this.shadow);

    this.light = options.light ?? 0;
    this.stage = soulformFor(this.light);
    this.glowAmount = options.glow ?? 1;
    this.setSkin(options.skin ?? 'pearl');
    this.equip('eyes', options.eyes ?? 'onyx');
    this.equip('outfit', options.outfit ?? 'none');
    this.equip('chain', options.chain ?? 'none');
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setMotion(options.motion ?? (reduce ? 'still' : 'expressive'));
    this.update(0);
  }

  // ───────────────────────────── Look ─────────────────────────────

  /** Body material: 'pearl', 'smoke', 'glacier', 'ember', or your own values. */
  setSkin(skin: SkinName | Skin): this {
    const s: Skin = typeof skin === 'string' ? SKINS[skin] : skin;
    if (!s) throw new Error(`Unknown Loop skin "${String(skin)}"`);
    this.skin = s;
    for (const mat of [this.bodyMat, this.trailMat]) {
      mat.color.set(s.color);
      mat.roughness = s.roughness;
      mat.sheenColor.set(s.rim);
      mat.emissive.set(s.inner);
    }
    (this.orbit.material as THREE.MeshBasicMaterial).color.set(s.core);
    this.applyGlow();
    return this;
  }

  /**
   * Put something on. Slots: 'outfit' (none, ink, ocean, moss),
   * 'chain' (none, silver, gold), 'eyes' (onyx, ice, amber or a CSS colour).
   */
  equip(slot: Slot, id: string): this {
    if (slot === 'eyes') {
      this.face.color = (EYE_COLORS as Record<string, string>)[id] ?? id;
      this.face.glow = id === 'onyx' ? 0 : 0.45;
      return this;
    }
    if (slot === 'outfit') {
      if (!(id in OUTFITS)) throw new Error(`Unknown Loop outfit "${id}"`);
      this.outfit = id as OutfitName;
      if (this.outfitGroup) {
        this.squash.remove(this.outfitGroup);
        disposeTree(this.outfitGroup);
        this.outfitGroup = null;
      }
      const def = OUTFITS[this.outfit];
      if (def) {
        this.outfitGroup = createOutfit(def.kind, def.color);
        this.squash.add(this.outfitGroup);
      }
      // The chest light and chain rest on whatever is now the outer surface.
      this.core.group.position.z = chestSurface(def?.kind ?? null, 0, DIM.coreY) + 0.012;
      return this.equip('chain', this.chain);
    }
    if (slot === 'chain') {
      if (!(id in CHAINS)) throw new Error(`Unknown Loop chain "${id}"`);
      this.chain = id as ChainName;
      if (this.chainMesh) {
        this.squash.remove(this.chainMesh);
        disposeTree(this.chainMesh);
        this.chainMesh = null;
      }
      const def = CHAINS[this.chain];
      if (def) {
        this.chainMesh = createChain(def.color, OUTFITS[this.outfit]?.kind ?? null);
        this.squash.add(this.chainMesh);
      }
      return this;
    }
    throw new Error(`Unknown Loop slot "${String(slot)}"`);
  }

  /** What is currently worn. */
  get look(): { outfit: OutfitName; chain: ChainName } {
    return { outfit: this.outfit, chain: this.chain };
  }

  /** Strength of the chest light and body glow: 0 = off, 1 = default, 2 = vivid. */
  setGlow(amount: number): this {
    this.glowAmount = clamp(amount, 0, 2);
    this.applyGlow();
    return this;
  }

  /**
   * Show the user's cumulative "light". Loop renders the matching Soulform
   * stage; deciding what earns light is the host app's job.
   */
  setLight(amount: number): this {
    this.light = Math.max(0, amount);
    const stage = soulformFor(this.light);
    if (stage > this.stage) this.jelly.kick(1.6);
    this.stage = stage;
    this.applyGlow();
    return this;
  }

  /** Current Soulform stage, 1–4, and its name. */
  get soulform(): { stage: number; name: string } {
    return { stage: this.stage + 1, name: SOULFORMS[this.stage].name };
  }

  private applyGlow(): void {
    const s = this.skin;
    const form = SOULFORMS[this.stage];
    const g = this.glowAmount;
    this.bodyMat.emissiveIntensity = this.trailMat.emissiveIntensity = s.innerStrength * lerp(0.6, 1, Math.min(g, 1));
    this.rimU.value.set(s.rim).multiplyScalar(0.34 * form.rim * lerp(0.4, 1, Math.min(g, 1)) * (g > 1 ? g : 1));
    this.trailGlowU.value.set(s.core).multiplyScalar(0.5 * form.trail * g);
    this.core.set(s.core, form.core * g);
    this.core.group.visible = g > 0.02;
    this.orbit.visible = form.orbit && g > 0.02;
  }

  setMotion(level: MotionLevel): this {
    this.level = level;
    this.m = MOTION[level];
    return this;
  }

  /** Convenience for an accessibility toggle: still when on, expressive when off. */
  setReducedMotion(reduced: boolean): this {
    return this.setMotion(reduced ? 'still' : 'expressive');
  }

  get motion(): MotionLevel {
    return this.level;
  }

  // ───────────────────────────── Behaviour ─────────────────────────────

  get state(): LoopState {
    return this._state;
  }

  /** Switch the base state. Gestures and expressions in progress are left alone. */
  setState(state: LoopState): this {
    if (this.disposed || state === this._state) return this;
    const previous = this._state;
    this._state = state;
    this.baseExpression = {
      idle: 'neutral', listening: 'attentive', thinking: 'thinking', speaking: 'neutral', sleeping: 'asleep',
    }[state];
    this.talkLevel = null;
    this.idleFor = 0;
    this.emit('statechange', { state, previous });
    // A celebration that was waiting for the conversation to finish can run now.
    if (state === 'idle' && this.pendingCelebration) this.startCelebration();
    return this;
  }

  /** Set the resting expression (until the state changes). */
  setExpression(name: ExpressionName | (string & {})): this {
    this.requireExpression(name);
    this.baseExpression = name;
    return this;
  }

  /**
   * Flash an expression, then return to the resting one. A new expression
   * replaces the previous one and its timer. 'concerned' and 'quiet' also
   * cancel any celebration, running or waiting.
   */
  express(name: ExpressionName | (string & {}), duration: number | { seconds?: number } = 1.6): this {
    if (this.disposed) return this;
    this.requireExpression(name);
    const seconds = typeof duration === 'number' ? duration : (duration.seconds ?? 1.6);
    if (QUIETING.has(name)) this.quiet();
    else if (this.tempExpression !== name) this.jelly.kick(1);
    this.tempExpression = name;
    this.tempTimer = seconds;
    this.idleFor = 0;
    return this;
  }

  /** Stop celebrating: cancels festive gestures, queued celebrations and confetti. */
  quiet(): this {
    if (this.gesture && FESTIVE.has(this.gesture.name)) {
      const g = this.gesture;
      this.gesture = null;
      g.resolve();
    }
    this.pendingCelebration?.forEach((resolve) => resolve());
    this.pendingCelebration = null;
    this.emit('calm', undefined);
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

  /**
   * Play a gesture on top of the current state. Resolves when it finishes
   * (or is replaced). 'celebration' is an alias for the dance.
   */
  play(name: GestureName | 'celebration' | (string & {})): Promise<void> {
    if (name === 'celebration') name = 'dance';
    const def = this.gestureDefs.get(name);
    if (!def) throw new Error(`Unknown Loop gesture "${name}"`);
    if (this.disposed) return Promise.resolve();
    if (this._state === 'sleeping') this.setState('idle');
    this.idleFor = 0;
    this.gesture?.resolve();
    return new Promise((resolve) => {
      this.gesture = { name, def, t: 0, resolve };
    });
  }

  /**
   * Celebrate a verified milestone: Loop dances (and a `LoopStage` adds
   * confetti). If Loop is listening, thinking or speaking, the celebration
   * waits until it is idle again. This is a visual reaction only; it grants
   * nothing.
   */
  celebrate(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      (this.pendingCelebration ??= []).push(resolve);
      if (this._state === 'sleeping') this.setState('idle');
      else if (this._state === 'idle') this.startCelebration();
    });
  }

  private startCelebration(): void {
    const waiting = this.pendingCelebration ?? [];
    this.pendingCelebration = null;
    this.tempExpression = null;
    this.jelly.kick(2.2);
    this.emit('celebrate', undefined);
    void this.play('dance').then(() => waiting.forEach((resolve) => resolve()));
  }

  /**
   * Drive the mouth from real audio: a 0…1 loudness, called as often as you
   * have data. Pass 0 when playback ends. Only shown while speaking.
   */
  setSpeechLevel(level: number): this {
    this.talkLevel = clamp(level, 0, 1);
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

  /** A tap: wakes Loop if needed, a soft squish, then `onTap`. */
  poke(strength = 1): this {
    if (this.disposed) return this;
    this.jelly.kick(-2.4 * strength);
    this.tapCount = this.tapTimer > 0 ? this.tapCount + 1 : 1;
    this.tapTimer = 0.9;
    this.idleFor = 0;
    if (this._state === 'sleeping') {
      this.setState('idle');
      if (this.tapReactions) void this.play('startle');
    } else if (this.tapReactions) {
      if (this.tapCount >= 3) {
        this.tapCount = 0;
        void this.play('wiggle');
      } else {
        this.express('happy', 1.1);
      }
    }
    this.emit('tap', { count: this.tapCount });
    this.onTap?.();
    return this;
  }

  /** Begin dragging: Loop follows `moveTo` targets tightly. */
  grab(): this {
    this.held = true;
    this.idleFor = 0;
    this.jelly.kick(2);
    this.express('surprised', 0.6);
    this.emit('grab', undefined);
    return this;
  }

  release(): this {
    if (!this.held) return this;
    this.held = false;
    this.jelly.kick(-1.6);
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

  /** World-space centre of the figure (handy for projecting to screen). */
  getCenter(out = new THREE.Vector3()): THREE.Vector3 {
    return this.hit.getWorldPosition(out);
  }

  // ───────────────────────────── Events ─────────────────────────────

  on<K extends keyof LoopEvents>(type: K, handler: Handler<LoopEvents[K]>): () => void {
    if (this.disposed) return () => {};
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
    if (this.disposed) return;
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.time += dt;
    const t = this.time;
    const m = this.m;
    const st = this._state;
    const asleep = st === 'sleeping';
    // Concern and quiet hold the body still: no bouncing while they show.
    const hushed = this.tempExpression !== null && QUIETING.has(this.tempExpression);
    const live = m * (hushed ? 0.35 : 1);

    // ── Travel: ease the target, then follow it on a soft spring.
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

    // ── Lean into travel; the trail and the head follow a beat behind.
    const k = Math.max(m, 0.25);
    this.roll.target = clamp(-vx * 0.06, -0.4, 0.4) * k;
    this.lean.target = clamp(vz * 0.05 + vy * 0.01, -0.3, 0.3) * k;
    this.bendX.target = clamp(-vx * 0.085, -0.42, 0.42) * k;
    this.bendZ.target = clamp(-vz * 0.085, -0.36, 0.36) * k;
    if (dt > 0) {
      const ax = (vx - this.prevV.x) / dt;
      const ay = (vy - this.prevV.y) / dt;
      this.headX.target = clamp(-ax * 0.004, -0.1, 0.1) * k;
      this.headY.target = clamp(-ay * 0.004 - vy * 0.012, -0.1, 0.1) * k;
      this.jelly.target = clamp(-ay * 0.003, -0.1, 0.1) * k;
      this.prevV.set(vx, vy, vz);
    }
    for (const s of [this.roll, this.lean, this.bendX, this.bendZ, this.headX, this.headY, this.jelly]) s.update(dt);
    this.approach.target = st === 'listening' ? 0.3 : 0;
    this.approach.update(dt);

    // ── Attention: the body turns a little, the head more, the eyes the rest.
    let lookYaw = 0;
    let lookPitch = 0;
    if (st === 'thinking') {
      lookYaw = 0.4;
      lookPitch = -0.28;
    } else if (!asleep && this.hasLookTarget) {
      const origin = this.tmp.set(0, this.hoverHeight + DIM.headY, 0);
      const local = this.worldToLocal(this.lookTarget.clone()).sub(origin);
      lookYaw = clamp(Math.atan2(local.x, Math.max(local.z, 0.4)), -1.1, 1.1);
      lookPitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, Math.max(local.z, 0.4))), -0.7, 0.7);
    } else if (!asleep) {
      lookYaw = this.glanceX;
      lookPitch = this.glanceY;
    }
    this.yaw.target = lookYaw * 0.22;
    this.pitch.target = lookPitch * 0.12;
    this.headYaw.target = lookYaw * 0.34;
    this.headPitch.target = lookPitch * 0.34;
    for (const s of [this.yaw, this.pitch, this.headYaw, this.headPitch]) s.update(dt);
    const face = this.face;
    const eyeK = damp(14, dt);
    face.lookX = lerp(face.lookX, clamp((lookYaw * 0.44) / 0.3, -1, 1), eyeK);
    face.lookY = lerp(face.lookY, clamp((-lookPitch * 0.54) / 0.3, -1, 1), eyeK);

    // ── Hover: slow layered bob and sway.
    const slow = asleep ? 0.55 : 1;
    const bob = (Math.sin(t * 2.1 * slow) * 0.06 + Math.sin(t * 1.1 * slow + 1.3) * 0.025) * live * (asleep ? 1.3 : 1);
    const sway = Math.sin(t * 0.62 + 0.4) * 0.035 * live;
    const idleRoll = Math.sin(t * 0.81) * 0.02 * live + (st === 'listening' ? 0.05 : 0);
    const hover = this.hoverHeight * lerp(0.5, 1, m) * (asleep ? 0.4 : 1);
    const breath = Math.sin(t * (asleep ? 1.2 : 2.1) + 0.6) * 0.012 * Math.max(m, 0.4);

    const model = this.model;
    model.position.set(sway + pose.slide, DIM.pivotY + hover + bob + pose.lift, this.approach.value * k);
    model.rotation.set(
      this.pitch.value + this.lean.value + pose.pitch + (st === 'listening' ? 0.08 : 0),
      this.yaw.value + pose.yaw + Math.sin(t * 0.37) * 0.04 * live,
      this.roll.value + idleRoll + pose.roll,
      'YXZ',
    );

    // ── Soft squash and stretch, volume-preserving.
    const sy = clamp(
      1 + breath + this.jelly.value + pose.stretch + clamp(Math.abs(vy) * 0.035 + Math.abs(vx) * 0.008, 0, 0.14) * k,
      0.75, 1.3,
    );
    const sxz = 1 / Math.sqrt(sy);
    this.squash.scale.set(sxz, sy, sxz);

    // ── Head: floats above the neck, lags the body, nods off when asleep.
    this.head.position.set(
      this.headX.value + Math.sin(t * 1.3 + 1) * 0.012 * live,
      DIM.headY + this.headY.value + Math.sin(t * 2.1 * slow + 0.9) * 0.022 * live + pose.lift * 0.12,
      Math.cos(t * 1.1) * 0.008 * live,
    );
    this.head.rotation.set(
      this.headPitch.value + pose.pitch * 0.7 + (asleep ? 0.22 : 0) + (hushed ? 0.06 : 0),
      this.headYaw.value,
      -this.headX.value * 1.6 + pose.roll * 0.5 + (asleep ? 0.12 : 0) + (st === 'listening' ? 0.06 : 0),
      'YXZ',
    );

    // ── Trail: sweeps behind travel and never quite stops moving.
    this.bend.value.set(this.bendX.value, this.bendZ.value);
    this.wave.value.x = (0.028 + Math.min(speed, 5) * 0.012) * Math.max(m, 0.12);
    this.wave.value.y = t * 2.6 * (asleep ? 0.6 : 1);

    // ── Hands: detached, swinging about the shoulders, a beat late.
    this.hands.forEach((hand, i) => {
      const side = i === 0 ? -1 : 1;
      const hx = this.handX[i];
      const hy = this.handY[i];
      hx.target = clamp(-vx * 0.06, -0.22, 0.22) * k;
      hy.target = clamp(-vy * 0.06, -0.18, 0.22) * k;
      hx.update(dt);
      hy.update(dt);
      const raise =
        ARM.rest + (i === 0 ? pose.armL : pose.armR) +
        Math.sin(t * 2.1 + 0.8 + i * 1.7) * 0.06 * live +
        Math.max(0, -this.jelly.value) * 1.6 +
        (asleep ? -0.12 : 0);
      const reach = ARM.length * (1 + Math.min(0.25, raise * 0.06));
      hand.position.set(
        side * (ARM.x + Math.sin(raise) * reach) + hx.value,
        ARM.y - Math.cos(raise) * reach + hy.value + Math.sin(t * 2.1 + i * 2.4) * 0.02 * live,
        ARM.z + Math.sin(raise) * 0.05,
      );
      hand.rotation.set(0.15, 0, side * (raise * 0.85 - 0.25) + hx.value * 1.2);
    });

    // ── Chest light: a slow pulse, quicker while thinking.
    const pulse = 1 + Math.sin(t * (st === 'thinking' ? 5 : 1.7)) * (st === 'thinking' ? 0.14 : 0.07) * Math.max(m, 0.3);
    this.core.group.scale.setScalar(pulse);
    if (this.orbit.visible) {
      const a = t * 1.3;
      this.orbit.position.set(Math.sin(a) * 0.62, DIM.coreY + Math.sin(a * 0.7) * 0.22, Math.cos(a) * 0.5);
      (this.orbit.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.25;
    }

    // ── Ground shadow: soft, and softer with height.
    const alt = this.ground === null ? 0 : Math.max(0, this.position.y - this.ground);
    const h = alt + hover + bob + pose.lift;
    this.shadow.position.set(model.position.x * 0.6, -alt + 0.004, 0.02);
    const spread = 1 + h * 0.35;
    this.shadow.scale.set(spread * sxz, spread * sxz, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.26 / (1 + h * 1.6);

    this.updateFace(dt, speed);
  }

  private updateFace(dt: number, speed: number): void {
    const face = this.face;
    const asleep = this._state === 'sleeping';

    // Timed expressions.
    if (this.tempExpression && (this.tempTimer -= dt) <= 0) this.tempExpression = null;
    if (this.tapTimer > 0) this.tapTimer -= dt;
    const name = this.tempExpression ?? this.gesture?.def.expression ?? this.baseExpression;
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

    // Speech: real loudness if the host supplies it, otherwise a natural babble.
    let talk = 0;
    if (this._state === 'speaking') {
      const tt = this.time;
      talk =
        this.talkLevel ??
        clamp(0.42 + Math.sin(tt * 17) * 0.3 + Math.sin(tt * 9.3 + 1) * 0.25 + Math.sin(tt * 3.1) * 0.15, 0, 1);
    }
    face.talk = lerp(face.talk, talk, damp(28, dt));

    // Idle life: glance around, fidget now and then, and eventually doze off.
    const resting = this._state === 'idle' && !this.gesture && !this.held && !this.tempExpression && speed < 0.3;
    if (resting) {
      this.idleFor += dt;
      if (this.sleepAfter > 0 && this.idleFor >= this.sleepAfter && !this.pendingCelebration) this.setState('sleeping');
    } else if (this._state !== 'sleeping') {
      this.idleFor = 0;
    }
    if (this.idleLife && this._state === 'idle' && this.m > 0) {
      if ((this.glanceTimer -= dt) <= 0) this.glanceX = this.glanceY = 0;
      if (resting && (this.nextIdle -= dt) <= 0) {
        this.nextIdle = (5 + Math.random() * 7) / lerp(0.6, 1, this.m);
        const r = Math.random();
        if (r < 0.7 || this.hasLookTarget) {
          this.glanceX = (Math.random() - 0.5) * 1.3;
          this.glanceY = (Math.random() - 0.4) * 0.5;
          this.glanceTimer = 1.1 + Math.random() * 1.4;
        } else if (this.m >= 1) {
          const idle = this.idleFor;
          void this.play('tilt');
          this.idleFor = idle; // fidgeting is not activity
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

  /**
   * Tear down for good: frees GPU resources, resolves anything pending and
   * drops every subscription. A disposed Loop ignores all further calls.
   */
  dispose(): void {
    if (this.disposed) return;
    this.gesture?.resolve();
    this.gesture = null;
    this.pendingCelebration?.forEach((resolve) => resolve());
    this.pendingCelebration = null;
    this.disposed = true;
    disposeTree(this);
    this.core.dispose();
    this.face.dispose();
    this.handlers.clear();
    this.onTap = null;
  }

  /** Same as `dispose`. */
  destroy(): void {
    this.dispose();
  }
}

function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!seen.has(mesh.geometry)) mesh.geometry.dispose();
    seen.add(mesh.geometry);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!seen.has(mat)) {
      mat.map?.dispose();
      mat.dispose();
    }
    seen.add(mat);
  });
}

/**
 * Makes the body read as softly translucent: a glow along the silhouette,
 * and (for the trail) extra light gathering towards the tips.
 */
function addGlow(
  shader: THREE.WebGLProgramParametersWithUniforms,
  rim: { value: THREE.Color },
  trail: { value: THREE.Color } | null,
): void {
  shader.uniforms.uLoopRim = rim;
  if (trail) shader.uniforms.uLoopTrailGlow = trail;
  shader.fragmentShader =
    'uniform vec3 uLoopRim;\n' +
    (trail ? 'uniform vec3 uLoopTrailGlow;\nvarying float vLoopTrail;\n' : '') +
    shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float loopRim = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      totalEmissiveRadiance += uLoopRim * loopRim * loopRim * (0.35 + loopRim);
      ${trail ? 'totalEmissiveRadiance += uLoopTrailGlow * vLoopTrail * vLoopTrail * (0.4 + loopRim);' : ''}`,
    );
}

function createShadow(): THREE.Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const mat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: 0x1a1620,
    transparent: true,
    depthWrite: false,
    opacity: 0.25,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.95), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'Shadow';
  mesh.renderOrder = -1;
  return mesh;
}
