import * as THREE from 'three';
import { EXPRESSIONS, Face, type ExpressionName, type FaceParams, NEUTRAL } from './Face';
import {
  ARM, DIM, TORSO_SPINE, WISP_SPINE,
  createFaceGeometry, createHandGeometry, createHeadGeometry, createTorsoGeometry, createWispGeometry,
} from './geometry';
import { GESTURES, GESTURE_ALIASES, zeroPose, type Gesture, type GestureName, type Pose } from './gestures';
import {
  CHAINS, EYE_COLORS, OUTFITS, SKINS, SOULFORMS, soulformFor,
  type ChainName, type EyeColorName, type OutfitName, type Skin, type SkinName,
} from './skins';
import { SoftChain, makeSoft, type ChainShape } from './softbody';
import { Spring, clamp, damp, lerp } from './spring';
import { chestSurface, createChain, createCore, createOutfit, type Soften } from './wearables';

/** How much Loop moves on its own. */
export type MotionLevel = 'still' | 'subtle' | 'expressive';

/** Loop's base state: what it is doing for the user right now. */
export type LoopState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'sleeping';

/** Wearable slots. */
export type Slot = 'outfit' | 'chain' | 'eyes';

/** 'gentle' is an unhurried float, for journeys Loop makes on its own (returning to its dock). */
export type Pace = 'normal' | 'gentle';

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
const TAU = Math.PI * 2;
/** Gestures that read as celebration; concern cancels them. */
const FESTIVE = new Set(['flourish', 'lift', 'wiggle']);
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
 * How it moves: Loop has intention at its centre, softness through its body
 * and flowing motion at its edges. Only the head and upper torso are steered
 * (by travel, dragging, states and gestures). The lower torso, every section
 * of each wisp, each hand, the shirt's hem, the chain and the inner light all
 * follow on their own, each with its own inertia, so nothing moves as one
 * rigid piece.
 *
 * Layers stay independent: the base state, a temporary gesture, a temporary
 * expression, the look (skin and wearables) and growth never overwrite each
 * other.
 */
export class Loop extends THREE.Group {
  readonly face = new Face();
  /** Loop's centre: the head and upper torso, and everything attached to them. */
  readonly model = new THREE.Group();
  /** Where Loop is trying to be, in its parent's space. Prefer `moveTo`. */
  readonly goal = new THREE.Vector3();
  /** Travel velocity, in the parent's space (read-only). */
  readonly velocity = new THREE.Vector3();
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
  private readonly torsoMat: THREE.MeshPhysicalMaterial;
  private readonly wispMat: THREE.MeshPhysicalMaterial;
  private readonly faceMesh: THREE.Mesh;
  private readonly core = createCore();
  private readonly orbit: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly hit: THREE.Mesh;
  private outfitGroup: THREE.Group | null = null;
  private chainMesh: THREE.Mesh | null = null;
  private readonly rimU = { value: new THREE.Color() };
  private readonly rimBase = new THREE.Color();
  private readonly trailGlowU = { value: new THREE.Color(), top: DIM.trailTop };
  private readonly flatU = { value: 0 };
  private readonly flatColorU = { value: new THREE.Color(0.12, 0.12, 0.16) };
  private readonly hemU = { value: new THREE.Vector3() };
  private readonly drapeU = { value: new THREE.Vector3() };

  // Soft body: the long ribbon (with the lower torso) and the short wisp.
  private readonly ribbon = new SoftChain({
    rest: TORSO_SPINE,
    pinned: 2,
    freq: [0, 0, 13, 23, 22, 21, 20, 19],
    damping: [0, 0, 0.7, 0.46, 0.43, 0.4, 0.38, 0.36],
    maxBend: [0, 0, 0.3, 0.7, 0.95, 1.1, 1.2, 1.3],
    curl: [0, 0, 0.06, 0.3, 0.55, 0.8, 1, 1.15],
  });
  private readonly wisp = new SoftChain({
    rest: WISP_SPINE,
    pinned: 2,
    freq: [0, 0, 22, 21, 20, 19, 18, 17],
    damping: [0, 0, 0.48, 0.44, 0.41, 0.38, 0.36, 0.34],
    maxBend: [0, 0, 0.7, 0.9, 1.05, 1.15, 1.25, 1.3],
    curl: [0, 0, 0.25, 0.45, 0.7, 0.9, 1.05, 1.2],
  });
  private readonly ribbonShape: ChainShape = { phaseA: 0, phaseB: 0, amount: 1, spread: 0 };
  private readonly wispShape: ChainShape = { phaseA: 0, phaseB: 0, amount: 1, spread: 0 };
  private readonly wispPins = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly toSim = new THREE.Matrix4();
  private readonly toBody = new THREE.Matrix4();
  private readonly fromSim = new THREE.Matrix4();
  private simFresh = true;

  // Look.
  private skin: Skin = SKINS.pearl;
  private outfit: OutfitName = 'none';
  private chain: ChainName = 'none';
  private glowAmount = 1;
  private light = 0;
  private stage = 0;
  private coreZ = 0;

  // Travel.
  private m = 1;
  private level: MotionLevel = 'expressive';
  private time = 0;
  /** Clock for the idle rhythms; runs slower when Loop is calm or asleep. */
  private life = 0;
  private readonly eased = new THREE.Vector3();
  private readonly px = new Spring(0, 9.5, 0.9);
  private readonly py = new Spring(0, 9.5, 0.9);
  private readonly pz = new Spring(0, 9.5, 0.9);
  private pace: Pace = 'normal';
  private depart = 0;
  private held = false;
  private travelling = false;

  // The centre's own posture.
  private readonly roll = new Spring(0, 11, 0.8);
  private readonly lean = new Spring(0, 11, 0.8);
  private readonly yaw = new Spring(0, 8, 0.85);
  private readonly pitch = new Spring(0, 8, 0.85);
  private readonly jelly = new Spring(0, 12, 0.36);
  private readonly headYaw = new Spring(0, 10, 0.75);
  private readonly headPitch = new Spring(0, 10, 0.75);
  private readonly headRoll = new Spring(0, 9, 0.7);

  // Followers.
  private readonly handSprings = [0, 1].map((i) => [0, 1, 2].map(() => new Spring(0, i ? 12.2 : 13, i ? 0.72 : 0.75)));
  private readonly hem = [new Spring(0, 10, 0.3), new Spring(0, 10, 0.3)];
  private readonly drape = [new Spring(0, 8.5, 0.2), new Spring(0, 8.5, 0.2)];
  private readonly coreLag = [new Spring(0, 12, 0.5), new Spring(0, 12, 0.5)];
  private readonly leadPos = new THREE.Vector3();
  private readonly leadVel = new THREE.Vector3();
  private lastYaw = 0;

  // Smoothed weights, so posture blends between states over a few hundred ms.
  private wListen = 0;
  private wThink = 0;
  private wThinkTilt = 0;
  private wSpeak = 0;
  private wSleep = 0;
  private wHush = 0;

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
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();

  constructor(options: LoopOptions = {}) {
    super();
    this.name = 'Loop';
    this.idleLife = options.idleLife ?? true;
    this.tapReactions = options.tapReactions ?? true;
    this.sleepAfter = options.sleepAfter ?? 180;
    const detail = options.detail ?? 1;
    const flat = this.flatU;
    const flatColor = this.flatColorU;

    const frosted = () => new THREE.MeshPhysicalMaterial({ clearcoat: 0.35, clearcoatRoughness: 0.4, sheen: 0.5, sheenRoughness: 0.5 });
    this.bodyMat = makeSoft(frosted(), { rim: this.rimU, flat, flatColor });
    this.bodyMat.name = 'LoopBody';
    // The torso and wisps bend with their chains and fade out towards their tips.
    const trailing = (chain: SoftChain, name: string) => {
      const mat = makeSoft(frosted(), { chain, rim: this.rimU, trailGlow: this.trailGlowU, flat, flatColor });
      mat.vertexColors = true;
      mat.transparent = true;
      mat.name = name;
      return mat;
    };
    this.torsoMat = trailing(this.ribbon, 'LoopTorso');
    this.wispMat = trailing(this.wisp, 'LoopWisp');

    const torso = new THREE.Mesh(createTorsoGeometry(detail), this.torsoMat);
    torso.name = 'Torso';
    const wispMesh = new THREE.Mesh(createWispGeometry(detail), this.wispMat);
    wispMesh.name = 'Wisp';
    torso.renderOrder = wispMesh.renderOrder = 1;
    // Bent in the shader, so their true bounds are unknown to the culling test.
    torso.frustumCulled = wispMesh.frustumCulled = false;
    this.squash.add(torso, wispMesh, this.core.group);

    const skull = new THREE.Mesh(createHeadGeometry(detail), this.bodyMat);
    skull.name = 'Head';
    const faceMat = new THREE.MeshBasicMaterial({
      map: this.face.texture, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    faceMat.name = 'LoopFace';
    this.faceMesh = new THREE.Mesh(createFaceGeometry(), faceMat);
    this.faceMesh.name = 'Face';
    this.faceMesh.renderOrder = 3;
    this.head.name = 'HeadRig';
    this.head.add(skull, this.faceMesh);
    this.squash.add(this.head);

    // Hands are not attached to anything: they live beside the body and chase it.
    const handGeo = createHandGeometry();
    for (const side of [-1, 1]) {
      const hand = new THREE.Mesh(handGeo, this.bodyMat);
      hand.name = side < 0 ? 'HandL' : 'HandR';
      hand.scale.x = -side; // thumbs point inward
      this.hands.push(hand);
      this.add(hand);
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
    for (const mat of [this.bodyMat, this.torsoMat, this.wispMat]) {
      mat.color.set(s.color);
      mat.roughness = s.roughness;
      mat.sheenColor.set(s.rim);
      mat.emissive.set(s.inner);
    }
    (this.orbit.material as THREE.MeshBasicMaterial).color.set(s.core);
    this.applyGlow();
    return this;
  }

  /** Clothing bends with the body and its free edges follow a beat late. */
  private readonly soften: Soften = (material, sway) =>
    makeSoft(material, {
      chain: this.ribbon,
      sway: { mode: sway, offset: sway === 'hem' ? this.hemU : this.drapeU },
      flat: this.flatU,
      flatColor: this.flatColorU,
    });

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
        this.outfitGroup = createOutfit(def.kind, def.color, this.soften);
        this.outfitGroup.traverse((o) => (o.frustumCulled = false));
        this.squash.add(this.outfitGroup);
      }
      // The chest light and chain rest on whatever is now the outer surface.
      this.coreZ = chestSurface(def?.kind ?? null, 0, DIM.coreY) + 0.012;
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
        this.chainMesh = createChain(def.color, OUTFITS[this.outfit]?.kind ?? null, this.soften);
        this.chainMesh.frustumCulled = false;
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
    if (stage > this.stage && !this.gesture) void this.play('lift');
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
    const inner = s.innerStrength * lerp(0.6, 1, Math.min(g, 1));
    this.bodyMat.emissiveIntensity = this.torsoMat.emissiveIntensity = this.wispMat.emissiveIntensity = inner;
    this.rimBase.set(s.rim).multiplyScalar(0.34 * form.rim * lerp(0.4, 1, Math.min(g, 1)) * (g > 1 ? g : 1));
    this.rimU.value.copy(this.rimBase);
    this.trailGlowU.value.set(s.core).multiplyScalar(0.5 * form.trail * g);
    this.core.set(s.core, form.core * g);
    this.core.group.visible = g > 0.02 && this.flatU.value < 0.5;
    this.orbit.visible = form.orbit && g > 0.02 && this.flatU.value < 0.5;
  }

  /**
   * Review aid: draw Loop as a flat silhouette with no face, light or glow,
   * to judge the movement on its own. `color` is any CSS colour.
   */
  setSilhouette(on: boolean, color?: string): this {
    this.flatU.value = on ? 1 : 0;
    // Written straight to the screen, so keep the colour in display (sRGB) values.
    if (color) this.flatColorU.value.set(color).convertLinearToSRGB();
    this.faceMesh.visible = !on;
    this.applyGlow();
    return this;
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
   * cancel any celebration, running or waiting, and settle the body. 'joy'
   * comes with a small lift of the body and a brighter inner light.
   */
  express(name: ExpressionName | (string & {}), duration: number | { seconds?: number } = 1.6): this {
    if (this.disposed) return this;
    this.requireExpression(name);
    const seconds = typeof duration === 'number' ? duration : (duration.seconds ?? 1.6);
    if (QUIETING.has(name)) this.quiet();
    else if (name === 'joy' && !this.gesture && this._state !== 'sleeping') void this.play('lift');
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
   * (or is replaced). 'celebration' is the milestone flourish; 'spin' is the
   * three-quarter turn.
   */
  play(name: GestureName | 'celebration' | 'spin' | (string & {})): Promise<void> {
    name = GESTURE_ALIASES[name] ?? name;
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
   * Celebrate a verified milestone: one buoyant flourish (and a `LoopStage`
   * adds confetti). If Loop is listening, thinking or speaking, the
   * celebration waits until it is idle again. This is a visual reaction
   * only; it grants nothing.
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
    this.emit('celebrate', undefined);
    void this.play('flourish').then(() => waiting.forEach((resolve) => resolve()));
  }

  /**
   * Drive the mouth from real audio: a 0…1 loudness, called as often as you
   * have data. Pass 0 when playback ends. Only shown while speaking.
   */
  setSpeechLevel(level: number): this {
    this.talkLevel = clamp(level, 0, 1);
    return this;
  }

  /**
   * Float to a point in parent space. `y` is the ground point, not the head.
   * Loop looks where it is going first, then its centre sets off and the rest
   * of the body follows.
   */
  moveTo(x: number, y = this.goal.y, z = this.goal.z, pace: Pace = 'normal'): this {
    if (!this.held && !this.travelling && this.tmp.set(x, y, z).distanceTo(this.position) > 0.2) this.depart = 0.09;
    this.goal.set(x, y, z);
    this.pace = pace;
    this.travelling = true;
    return this;
  }

  /** Jump to a point instantly, with no travel and no trailing. */
  teleport(x: number, y = 0, z = 0): this {
    this.goal.set(x, y, z);
    this.eased.copy(this.goal);
    this.px.snap(x);
    this.py.snap(y);
    this.pz.snap(z);
    this.position.copy(this.goal);
    this.velocity.set(0, 0, 0);
    this.travelling = false;
    this.settle();
    return this;
  }

  /** Drop all follow-through: every trailing part snaps to its place. */
  settle(): this {
    this.simFresh = true;
    return this;
  }

  /** Look at a point in world space; pass null to look around freely. */
  gazeAt(target: THREE.Vector3 | null): this {
    this.hasLookTarget = target !== null;
    if (target) this.lookTarget.copy(target);
    return this;
  }

  /** A tap: wakes Loop if needed, a soft ripple through the body, then `onTap`. */
  poke(strength = 1): this {
    if (this.disposed) return this;
    this.jelly.kick(-0.5 * strength);
    this.ripple(0.9 * strength);
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
        this.tempExpression = 'happy';
        this.tempTimer = 1.1;
      }
    }
    this.emit('tap', { count: this.tapCount });
    this.onTap?.();
    return this;
  }

  /** Send a small wave out through the wisps and hands. */
  private ripple(strength: number): void {
    const scale = this.scale.x * strength;
    this.ribbon.kick(this.tmp.set(-0.5 * scale, 0.5 * scale, 0));
    this.wisp.kick(this.tmp.set(0.6 * scale, 0.45 * scale, 0));
    this.handSprings.forEach((s, i) => {
      s[0].kick((i ? 0.5 : -0.5) * scale);
      s[1].kick(0.5 * scale);
    });
  }

  /**
   * Begin dragging. From here `moveTo` is followed almost directly, so the
   * held point stays with the finger; the fluidity comes from everything else
   * trailing behind it.
   */
  grab(): this {
    this.held = true;
    this.depart = 0;
    this.idleFor = 0;
    this.goal.copy(this.position);
    this.jelly.kick(0.35);
    this.tempExpression = 'surprised';
    this.tempTimer = 0.5;
    this.emit('grab', undefined);
    return this;
  }

  /**
   * Let go. Loop keeps a little of its momentum, glides a short way and
   * settles into a hover there. It does not return anywhere by itself.
   */
  release(): this {
    if (!this.held) return this;
    this.held = false;
    const v = this.tmp.copy(this.velocity).clampLength(0, 7);
    this.goal.copy(this.position).addScaledVector(v, 0.13);
    this.eased.copy(this.goal);
    this.pace = 'normal';
    this.px.snap(this.position.x);
    this.py.snap(this.position.y);
    this.pz.snap(this.position.z);
    this.px.velocity = v.x * 0.75;
    this.py.velocity = v.y * 0.75;
    this.pz.velocity = v.z * 0.75;
    this.travelling = true;
    this.tempExpression = 'happy';
    this.tempTimer = 1;
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
    const k = Math.max(m, 0.25);
    const st = this._state;
    const pose = this.pose;

    // ── Blend posture between states and moods rather than switching.
    const hushed = this.tempExpression !== null && QUIETING.has(this.tempExpression);
    const blend = damp(9, dt);
    this.wListen = lerp(this.wListen, st === 'listening' ? 1 : 0, blend);
    this.wThink = lerp(this.wThink, st === 'thinking' ? 1 : 0, blend);
    this.wSpeak = lerp(this.wSpeak, st === 'speaking' ? 1 : 0, blend);
    this.wSleep = lerp(this.wSleep, st === 'sleeping' ? 1 : 0, damp(5, dt));
    this.wHush = lerp(this.wHush, hushed ? 1 : 0, blend);
    // The head tilt of thinking arrives after the gaze has already lifted.
    this.wThinkTilt = lerp(this.wThinkTilt, this.wThink, damp(4, dt));
    const { wListen, wThink, wSpeak, wSleep, wHush } = this;

    // Calm states slow the whole rhythm; they never stop it.
    this.life += dt * lerp(1, 0.62, wHush) * lerp(1, 0.55, wSleep) * lerp(1, 0.75, wThink);
    const ph = this.life;
    const amp = m * lerp(1, 0.4, wListen) * lerp(1, 0.6, wHush);

    // ── Travel. Held: the grabbed point stays with the finger. Free: look
    // first, then ease away and settle with next to no overshoot.
    const vel = this.velocity;
    if (this.held) {
      const before = this.tmp.copy(this.position);
      this.position.lerp(this.goal, damp(42, dt));
      if (dt > 0) vel.lerp(this.tmp2.subVectors(this.position, before).divideScalar(dt), damp(26, dt));
      this.eased.copy(this.position);
    } else {
      if (this.depart > 0) this.depart -= dt;
      else this.eased.lerp(this.goal, damp(this.pace === 'gentle' ? 1.9 : 5.2, dt));
      const gentle = this.pace === 'gentle';
      for (const [s, v] of [[this.px, this.eased.x], [this.py, this.eased.y], [this.pz, this.eased.z]] as const) {
        s.freq = gentle ? 5.5 : 7.2;
        s.damping = gentle ? 1 : 0.88;
        s.target = v;
        s.update(dt);
      }
      this.position.set(this.px.value, this.py.value, this.pz.value);
      vel.set(this.px.velocity, this.py.velocity, this.pz.velocity);
    }
    const speed = vel.length();
    const toGoal = this.tmp.subVectors(this.goal, this.position);
    const distance = toGoal.length();
    if (this.travelling && !this.held && speed < 0.06 && distance < 0.04) {
      this.travelling = false;
      this.emit('arrive', undefined);
    }

    // ── Gesture layer.
    Object.assign(pose, zeroPose());
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const p = g.t / g.def.duration;
      if (p >= 1) {
        this.gesture = null;
        g.resolve();
        this.emit('gestureend', { name: g.name });
      } else {
        g.def.apply(p, pose, g.t);
      }
    }

    // ── Attention. The eyes go first, the head follows, the body turns least.
    let lookYaw = 0;
    let lookPitch = 0;
    if (st === 'thinking') {
      lookYaw = 0.4;
      lookPitch = -0.3;
    } else if (st !== 'sleeping' && this.hasLookTarget) {
      const origin = this.tmp2.set(0, this.hoverHeight + DIM.headY, 0);
      const local = this.worldToLocal(this.tmpTarget.copy(this.lookTarget)).sub(origin);
      lookYaw = clamp(Math.atan2(local.x, Math.max(local.z, 0.4)), -1.1, 1.1);
      lookPitch = clamp(-Math.atan2(local.y, Math.hypot(local.x, Math.max(local.z, 0.4))), -0.7, 0.7);
    } else if (st !== 'sleeping') {
      lookYaw = this.glanceX;
      lookPitch = this.glanceY;
    }
    // Where Loop is headed (or being carried) takes over its gaze.
    const intent = this.held ? clamp(speed / 3, 0, 1) * 0.85 : this.travelling ? clamp(distance / 0.5, 0, 1) : 0;
    if (intent > 0.01) {
      const dir = this.held ? vel : toGoal;
      const len = dir.length() + 0.35;
      lookYaw = lerp(lookYaw, clamp((dir.x / len) * 0.95, -0.85, 0.85), intent);
      lookPitch = lerp(lookPitch, clamp((-dir.y / len) * 0.6, -0.5, 0.5), intent);
    }
    lookYaw *= 1 - pose.attend;
    lookPitch *= 1 - pose.attend;
    this.yaw.target = lookYaw * 0.2;
    this.pitch.target = lookPitch * 0.1;
    this.headYaw.target = lookYaw * 0.36;
    this.headPitch.target = lookPitch * 0.36;
    const face = this.face;
    const eyeK = damp(16, dt);
    face.lookX = lerp(face.lookX, clamp((lookYaw * 0.44) / 0.3, -1, 1), eyeK);
    face.lookY = lerp(face.lookY, clamp((-lookPitch * 0.54) / 0.3, -1, 1), eyeK);

    // ── The centre leans a little into travel.
    this.roll.target = clamp(-vel.x * 0.045, -0.3, 0.3) * k;
    this.lean.target = clamp(vel.z * 0.04 + vel.y * 0.008, -0.2, 0.2) * k;
    this.headRoll.target = clamp(-vel.x * 0.02, -0.12, 0.12) * k;
    for (const s of [this.roll, this.lean, this.yaw, this.pitch, this.headYaw, this.headPitch, this.headRoll, this.jelly]) {
      s.update(dt);
    }

    // ── Idle: a slow, wandering float. Rise, ease across, sink, return;
    // the rhythms never line up, so the path never quite repeats.
    const bob = (0.034 * Math.sin((ph * TAU) / 5.2) + 0.012 * Math.sin((ph * TAU) / 3.3 + 1.1)) * amp;
    const driftX = (0.022 * Math.sin((ph * TAU) / 6.6 + 0.8) + 0.008 * Math.sin((ph * TAU) / 4.1 + 2)) * amp * (1 + 0.6 * wThink);
    const driftZ = 0.012 * Math.sin((ph * TAU) / 7.3 + 0.3) * amp;
    const idleRoll = 0.023 * Math.sin((ph * TAU) / 5.8 + 0.4) * amp;
    const idlePitch = 0.012 * Math.sin((ph * TAU) / 7.1 + 1.9) * amp;
    const hover = this.hoverHeight * lerp(0.5, 1, m) * lerp(1, 0.55, wSleep);
    const breath = Math.sin((ph * TAU) / 3.6 + 0.6) * 0.006 * Math.max(m, 0.4);

    const model = this.model;
    model.position.set(
      driftX + pose.slide,
      DIM.pivotY + hover + bob + pose.lift - 0.035 * wHush,
      driftZ + 0.3 * wListen * k,
    );
    model.rotation.set(
      this.pitch.value + this.lean.value + pose.pitch + idlePitch + 0.07 * wListen + 0.05 * wHush,
      this.yaw.value + pose.yaw,
      this.roll.value + idleRoll + pose.roll,
      'YXZ',
    );

    // ── A subtle stretch with speed (a few percent), and a soft press when touched.
    const ex = clamp(Math.abs(vel.x) * 0.006, 0, 0.03) * k;
    const ey = clamp(Math.abs(vel.y) * 0.008, 0, 0.04) * k + breath + this.jelly.value + pose.stretch;
    const sy = clamp(1 + ey, 0.9, 1.12);
    const sx = (1 + ex) / Math.sqrt(sy);
    this.squash.scale.set(sx, sy, 1 / Math.sqrt(sy * (1 + ex)));

    // ── Head: carried by the centre, with a small life of its own. It moves
    // least of all, so the face always reads.
    const headAmp = amp * (1 - 0.5 * wSpeak);
    this.head.position.set(0, DIM.headY + 0.012 * Math.sin((ph * TAU) / 3.9 + 0.9) * headAmp - 0.04 * wSleep - 0.012 * wHush, 0);
    this.head.rotation.set(
      this.headPitch.value + pose.pitch * 0.5 + 0.2 * wSleep + 0.09 * wHush + 0.018 * Math.sin((ph * TAU) / 6.1 + 1.7) * headAmp,
      this.headYaw.value,
      this.headRoll.value + 0.03 * Math.sin((ph * TAU) / 4.6 + 2.2) * headAmp + 0.1 * this.wThinkTilt +
        0.05 * wListen + 0.1 * wSleep + pose.roll * 0.35,
      'YXZ',
    );

    this.follow(dt, t, ph, speed);

    // ── Ground shadow: soft, and softer with height.
    const alt = this.ground === null ? 0 : Math.max(0, this.position.y - this.ground);
    const h = alt + hover + bob + pose.lift;
    this.shadow.position.set(model.position.x * 0.6, -alt + 0.004, 0.02);
    const spread = 1 + h * 0.35;
    this.shadow.scale.set(spread, spread, 1);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.26 / (1 + h * 1.6);

    this.updateFace(dt, speed);
  }

  private readonly tmpTarget = new THREE.Vector3();

  /**
   * Everything that is not steered: lower torso, wisps, hands, hem, chain and
   * inner light each chase the centre with their own inertia.
   */
  private follow(dt: number, t: number, ph: number, speed: number): void {
    const { pose, model, m, wHush, wSleep, wSpeak, wThink } = this;
    const k = Math.max(m, 0.25);

    this.updateMatrix();
    model.updateMatrix();
    this.squash.updateMatrix();
    this.toSim.multiplyMatrices(this.matrix, model.matrix).multiply(this.squash.matrix);
    this.toBody.copy(this.toSim).invert();
    this.fromSim.copy(this.matrix).invert();

    // How the centre is moving, as the body itself feels it.
    const lead = this.tmp.set(0, DIM.pivotY, 0).applyMatrix4(this.toSim);
    if (this.simFresh) this.leadPos.copy(lead);
    if (dt > 0) this.leadVel.lerp(this.tmp2.subVectors(lead, this.leadPos).divideScalar(dt), damp(30, dt));
    this.leadPos.copy(lead);
    const felt = this.tmp2.copy(this.leadVel).applyQuaternion(this.tmpQ.copy(model.quaternion).invert()).divideScalar(this.scale.x || 1);
    const yawNow = model.rotation.y;
    const yawRate = dt > 0 && !this.simFresh ? clamp((yawNow - this.lastYaw) / dt, -8, 8) : 0;
    this.lastYaw = yawNow;

    // ── Lower torso and wisps. They keep curling and relaxing at rest; the
    // curl is small when motion is reduced but never zero.
    const curl = Math.max(m, 0.12) * lerp(1, 0.75, wHush) * (1 + Math.min(speed, 3) * 0.12);
    const a = this.ribbonShape;
    a.phaseA = ph * 1.75;
    a.phaseB = ph * 1.07 + 0.5;
    a.amount = curl;
    a.spread = -pose.spread;
    const b = this.wispShape;
    b.phaseA = ph * 1.45 + 2;
    b.phaseB = ph * 2.05 + 0.7;
    b.amount = curl;
    b.spread = pose.spread;
    if (this.simFresh) {
      this.ribbon.reset();
      this.wisp.reset();
    }
    this.ribbon.step(dt, this.toSim, this.toBody, a);
    // The short wisp is rooted in the lower torso, wherever that has swung to.
    for (let i = 0; i < 2; i++) this.ribbon.deform(WISP_SPINE[i], this.wispPins[i]);
    this.wisp.step(dt, this.toSim, this.toBody, b, this.wispPins);

    // ── Hands: each floats to its own place beside the body, a beat late,
    // and drifts on its own while it waits.
    const drawnIn = clamp(pose.handsIn + 0.8 * wHush, 0, 1);
    const handAmp = Math.max(m, 0.2) * lerp(1, 0.7, wHush);
    this.hands.forEach((hand, i) => {
      const side = i === 0 ? -1 : 1;
      const raise =
        ARM.rest + (i === 0 ? pose.armL : pose.armR) +
        0.1 * wSpeak * (0.6 + 0.5 * Math.sin(t * 2.6 + i * 2.4)) -
        0.14 * wSleep + 0.06 * wThink * i;
      const reach = ARM.length * (1 + Math.min(0.25, raise * 0.06)) * (1 - 0.25 * drawnIn);
      const want = this.tmp.set(
        side * (ARM.x * (1 - 0.5 * drawnIn) + Math.sin(raise) * reach) + 0.02 * Math.sin((ph * TAU) / 3.7 + i * 2.1) * handAmp,
        ARM.y - Math.cos(raise) * reach + 0.1 * drawnIn - 0.05 * wSleep + 0.028 * Math.sin((ph * TAU) / 4.3 + i * 1.3 + 0.5) * handAmp,
        ARM.z + Math.sin(raise) * 0.05 + 0.14 * drawnIn + 0.012 * Math.sin((ph * TAU) / 5.1 + i) * handAmp,
      ).applyMatrix4(this.toSim);
      const s = this.handSprings[i];
      s[0].target = want.x;
      s[1].target = want.y;
      s[2].target = want.z;
      if (this.simFresh) s.forEach((sp) => sp.snap(sp.target));
      else s.forEach((sp) => sp.update(dt));
      // However fast Loop travels, a hand never trails further than arm's reach.
      const behind = Math.hypot(s[0].value - want.x, s[1].value - want.y, s[2].value - want.z);
      const reachMax = 0.3 * this.scale.x;
      if (behind > reachMax) {
        const pull = 1 - reachMax / behind;
        s[0].value += (want.x - s[0].value) * pull;
        s[1].value += (want.y - s[1].value) * pull;
        s[2].value += (want.z - s[2].value) * pull;
      }
      const lagX = s[0].value - want.x;
      const lagY = s[1].value - want.y;
      hand.position.set(s[0].value, s[1].value, s[2].value).applyMatrix4(this.fromSim);
      // Each hand tips with how far it is trailing, like something towed through water.
      hand.quaternion
        .setFromEuler(this.tmpE.set(0.15 - lagY * 1.2, 0, side * (raise * 0.85 - 0.25) + lagX * 1.6))
        .premultiply(model.quaternion);
    });

    // ── Clothing and chain: anchored at the shoulders and collar; the hem and
    // the hanging links swing after a movement and then settle.
    const turn = -yawRate * 0.012;
    this.hem[0].target = clamp(-felt.x * 0.016 + turn, -0.055, 0.055) * k;
    this.hem[1].target = clamp(-felt.z * 0.016, -0.045, 0.045) * k;
    this.drape[0].target = clamp(-felt.x * 0.02 + turn * 1.2, -0.05, 0.05) * k;
    this.drape[1].target = clamp(-felt.z * 0.012, -0.012, 0.03) * k;
    this.coreLag[0].target = clamp(-felt.x * 0.004, -0.018, 0.018) * k;
    this.coreLag[1].target = clamp(-felt.y * 0.004, -0.018, 0.018) * k;
    for (const s of [...this.hem, ...this.drape, ...this.coreLag]) {
      if (this.simFresh) s.snap(0);
      else s.update(dt);
    }
    this.hemU.value.set(this.hem[0].value, Math.abs(this.hem[0].value) * 0.15, this.hem[1].value);
    this.drapeU.value.set(this.drape[0].value, Math.abs(this.drape[0].value) * 0.25, this.drape[1].value);

    // ── Inner light: seated on the chest, breathing on its own slow rhythm,
    // brightening with joy. The outline's glow rises with it.
    const coreAt = this.ribbon.deform(this.tmp.set(0, DIM.coreY, this.coreZ), this.core.group.position);
    coreAt.x += this.coreLag[0].value;
    coreAt.y += this.coreLag[1].value;
    const thinking = wThink * 0.14 * Math.sin(t * 5);
    const glow = 1 + 0.07 * Math.sin((ph * TAU) / 3.4) * Math.max(m, 0.3) + thinking + pose.light * 0.9 - 0.18 * wHush - 0.25 * wSleep;
    this.core.pulse(glow);
    this.rimU.value.copy(this.rimBase).multiplyScalar(1 + pose.light * 0.7);
    if (this.orbit.visible) {
      const o = t * 1.3;
      this.orbit.position.set(Math.sin(o) * 0.62, DIM.coreY + Math.sin(o * 0.7) * 0.22, Math.cos(o) * 0.5);
      (this.orbit.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.25;
    }

    this.simFresh = false;
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

    // Speech: real loudness if the host supplies it, otherwise a natural,
    // restrained babble.
    let talk = 0;
    if (this._state === 'speaking') {
      const tt = this.time;
      talk =
        this.talkLevel ??
        clamp(0.34 + Math.sin(tt * 15) * 0.24 + Math.sin(tt * 8.3 + 1) * 0.2 + Math.sin(tt * 3.1) * 0.14, 0, 0.8);
    }
    face.talk = lerp(face.talk, talk, damp(24, dt));

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
