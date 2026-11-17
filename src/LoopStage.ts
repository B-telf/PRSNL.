import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Loop, type LoopOptions } from './Loop';
import { Confetti } from './confetti';
import { clamp } from './spring';

export type Anchor = 'center' | 'bottom-center' | 'bottom-left' | 'bottom-right';

export interface LoopStageOptions extends LoopOptions {
  /**
   * `false` (default): Loop lives inside the container element.
   * `true`: a fixed, full-viewport layer above the page. Only Loop itself
   * catches pointer input; everything else passes through to your UI.
   */
  overlay?: boolean;
  /** Loop's on-screen height in CSS px. Default: sized from `fill`. */
  size?: number;
  /** Without `size`: the share of the stage's height Loop takes up (default 0.66). */
  fill?: number;
  /** Where Loop rests. Default 'bottom-center' ('bottom-right' in overlay). */
  anchor?: Anchor;
  /** Gap from the stage edges for the anchor, CSS px. */
  margin?: number;
  /** Eyes and head follow the pointer. */
  followPointer?: boolean;
  /** Loop can be picked up and carried. */
  draggable?: boolean;
  /** A moment after a drag ends, drift gently back to the anchor. Off by default: Loop stays where it is put. */
  returnHome?: boolean;
  /** Tapping empty stage space sends Loop there (not available in overlay). */
  roam?: boolean;
  /** Ground shadow. */
  shadow?: boolean;
  /** Amount of confetti when celebrating: 0 = none, 1 = default. */
  particles?: number;
  /** Cap on device pixel ratio. */
  maxPixelRatio?: number;
  /** Start the render loop immediately. */
  autoStart?: boolean;
}

const LOOP_HEIGHT = 3.15; // model units, trail tip to crest, plus hover
const FOV = 26;

/**
 * Everything needed to put Loop on screen: renderer, camera, lighting and
 * pointer interaction. If you already have a three.js scene, use `Loop`
 * directly instead.
 */
export class LoopStage {
  readonly loop: Loop;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly confetti = new Confetti();
  /** Slow motion for reviewing movement (1 = real time). */
  timeScale = 1;

  private readonly opts: Required<Omit<LoopStageOptions, keyof LoopOptions | 'size'>> & { size?: number };
  private readonly container: HTMLElement;
  private readonly hitPad: HTMLDivElement | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private last = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly env: THREE.Texture;
  private raf = 0;
  private running = false;
  private width = 1;
  private height = 1;
  private viewH = 4;
  private readonly home = new THREE.Vector3();
  private pinned = false;
  private homeTimer = 0;
  private hidden = false;
  private pointerId: number | null = null;
  private downAt = { x: 0, y: 0, t: 0 };
  private dragging = false;
  private readonly grabOffset = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement | null, options: LoopStageOptions = {}) {
    const overlay = options.overlay ?? false;
    this.opts = {
      overlay,
      size: options.size,
      fill: options.fill ?? 0.66,
      anchor: options.anchor ?? (overlay ? 'bottom-right' : 'bottom-center'),
      margin: options.margin ?? 24,
      followPointer: options.followPointer ?? true,
      draggable: options.draggable ?? true,
      returnHome: options.returnHome ?? false,
      roam: options.roam ?? false,
      shadow: options.shadow ?? true,
      particles: options.particles ?? 1,
      maxPixelRatio: options.maxPixelRatio ?? 2,
      autoStart: options.autoStart ?? true,
    };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';

    if (overlay) {
      this.container = document.createElement('div');
      this.container.style.cssText =
        'position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;';
      this.canvas.style.pointerEvents = 'none';
      this.hitPad = document.createElement('div');
      this.hitPad.style.cssText =
        'position:absolute;left:0;top:0;pointer-events:auto;touch-action:none;cursor:grab;border-radius:45%;' +
        '-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;';
      this.hitPad.setAttribute('role', 'img');
      this.hitPad.setAttribute('aria-label', 'Loop');
      this.container.append(this.canvas, this.hitPad);
      (container ?? document.body).appendChild(this.container);
    } else {
      if (!container) throw new Error('LoopStage needs a container element unless overlay is true');
      this.container = container;
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute('aria-label', 'Loop');
      container.appendChild(this.canvas);
    }

    // Soft studio lighting: an environment for fill plus a key and a cool rim.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.75;
    const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
    key.position.set(2.5, 5, 4);
    const rim = new THREE.DirectionalLight(0xbfe9ff, 1.8);
    rim.position.set(-3.5, 2.5, -3);
    const fill = new THREE.DirectionalLight(0xffe8d6, 0.5);
    fill.position.set(-3, 1, 4);
    this.scene.add(key, rim, fill);

    this.loop = new Loop(options);
    this.loop.ground = overlay ? null : 0;
    this.loop.traverse((o) => {
      if (o.name === 'Shadow') o.visible = this.opts.shadow;
    });
    this.scene.add(this.loop);
    this.loop.on('celebrate', () => this.fireConfetti());
    this.loop.on('calm', () => this.confetti.clear());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.loop.teleport(this.home.x, this.home.y, this.home.z);

    this.bindPointer();
    const onVisibility = () => (document.hidden ? this.stop() : this.opts.autoStart && !this.hidden && this.start());
    document.addEventListener('visibilitychange', onVisibility);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));
    if (this.opts.autoStart) this.start();
  }

  // ───────────────────────────── Public API ─────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(((now - this.last) / 1000) * this.timeScale);
      this.last = now;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance and draw one frame (called for you while running). */
  frame(dt: number): void {
    this.loop.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.hitPad) this.placeHitPad();
  }

  /**
   * Float so the middle of Loop's body sits at a point in the viewport
   * (client coordinates, as in pointer events).
   */
  floatTo(clientX: number, clientY: number): void {
    const p = this.toWorld(clientX, clientY, 0, this.v);
    this.pinned = true;
    this.loop.moveTo(p.x, p.y - LOOP_HEIGHT * 0.5 - this.loop.hoverHeight, 0);
  }

  /** Float next to a DOM element, e.g. a message bubble or a button. */
  floatToElement(el: Element, side: 'left' | 'right' | 'top' = 'right', gap = 12): void {
    const r = el.getBoundingClientRect();
    const half = this.pixelSize() * 0.3;
    if (side === 'top') this.floatTo(r.left + r.width / 2, r.top - gap - this.pixelSize() / 2);
    else this.floatTo(side === 'right' ? r.right + gap + half : r.left - gap - half, r.top + r.height / 2);
  }

  /** Hide Loop and stop rendering (camera, payment, video screens). Clears confetti. */
  remove(): void {
    this.stop();
    this.confetti.clear();
    this.container.style.visibility = 'hidden';
    if (this.hitPad) this.hitPad.style.pointerEvents = 'none';
    this.hidden = true;
  }

  /** Bring Loop back after `remove()`. */
  show(): void {
    this.hidden = false;
    this.container.style.visibility = '';
    if (this.hitPad) this.hitPad.style.pointerEvents = 'auto';
    this.start();
  }

  /** Loop dances while confetti fills the whole screen. Resolves when the dance ends. */
  celebrate(): Promise<void> {
    return this.loop.celebrate();
  }

  /** Confetti amount for celebrations: 0 = none, 1 = default. */
  setParticles(amount: number): void {
    this.opts.particles = clamp(amount, 0, 2);
  }

  /** Loop's bounding box on screen, in viewport (client) pixels. */
  getScreenRect(): { x: number; y: number; width: number; height: number } {
    const r = this.canvas.getBoundingClientRect();
    const c = this.loop.getCenter(this.v).project(this.camera);
    const height = this.pixelSize();
    const width = height * 0.56;
    return {
      x: r.left + (c.x * 0.5 + 0.5) * r.width - width / 2,
      y: r.top + (-c.y * 0.5 + 0.5) * r.height - height / 2,
      width,
      height,
    };
  }

  private fireConfetti(): void {
    if (this.hidden) return;
    // Calmer for people who asked for less motion; `particles` scales it further.
    const amount = this.opts.particles * (this.loop.motion === 'still' ? 0.3 : 1);
    if (amount <= 0) return;
    const n = (count: number) => Math.round(count * amount);
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Launch speed that carries a piece roughly the height of the screen.
    const reach = Math.max(1100, Math.min(2600, h * 2.3));
    const r = this.getScreenRect();
    const confetti = this.confetti;
    // A pop from Loop, cannons from both bottom corners, then a long drift from above.
    confetti.burst({ x: r.x + r.width / 2, y: r.y + r.height * 0.4, count: n(90), spread: 150, speed: reach * 0.55 });
    window.setTimeout(() => {
      confetti.burst({ x: -10, y: h + 10, count: n(150), angle: 66, spread: 50, speed: reach });
      confetti.burst({ x: w + 10, y: h + 10, count: n(150), angle: 114, spread: 50, speed: reach });
    }, 160);
    window.setTimeout(() => confetti.rain(n(260), 2.6), 350);
  }

  /** Return to the resting anchor. */
  goHome(): void {
    this.pinned = false;
    this.loop.moveTo(this.home.x, this.home.y, this.home.z, 'gentle');
  }

  /** Change where Loop rests. */
  setAnchor(anchor: Anchor, margin = this.opts.margin): void {
    this.opts.anchor = anchor;
    this.opts.margin = margin;
    this.resize();
    if (!this.pinned) this.goHome();
  }

  /** Loop's on-screen height in CSS px. */
  pixelSize(): number {
    return (LOOP_HEIGHT / this.viewH) * this.height;
  }

  dispose(): void {
    this.stop();
    window.clearTimeout(this.homeTimer);
    this.confetti.clear();
    this.resizeObserver.disconnect();
    this.disposers.forEach((d) => d());
    this.loop.dispose();
    this.env.dispose();
    this.renderer.dispose();
    if (this.opts.overlay) this.container.remove();
    else this.canvas.remove();
  }

  /** Same as `dispose`. */
  destroy(): void {
    this.dispose();
  }

  // ───────────────────────────── Layout ─────────────────────────────

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const changed = w !== this.width || h !== this.height;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio));
    this.renderer.setSize(w, h, false);

    // World units visible top-to-bottom at Loop's depth.
    const fitted = LOOP_HEIGHT / this.opts.fill;
    this.viewH = this.opts.size ? (LOOP_HEIGHT * h) / this.opts.size : Math.max(fitted, (LOOP_HEIGHT * 0.9 * h) / w);
    const viewW = (this.viewH * w) / h;
    const unit = this.viewH / h; // world units per CSS px
    const m = this.opts.margin * unit;

    // y = 0 is the ground; keep it a little above the bottom edge.
    const floor = this.opts.size ? m + 0.12 : this.viewH * 0.1;
    const centerY = this.viewH / 2 - floor;
    const dist = this.viewH / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    this.camera.aspect = w / h;
    this.camera.position.set(0, centerY + this.viewH * 0.045, dist);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const edge = viewW / 2 - m - LOOP_HEIGHT * 0.3;
    const a = this.opts.anchor;
    this.home.set(
      a === 'bottom-left' ? -edge : a === 'bottom-right' ? edge : 0,
      a === 'center' ? centerY - LOOP_HEIGHT * 0.5 - this.loop.hoverHeight : 0,
      0,
    );
    if (this.loop && changed && !this.pinned && !this.dragging) this.loop.moveTo(this.home.x, this.home.y, this.home.z);
    if (this.loop && !this.running) this.renderer.render(this.scene, this.camera);
  }

  /** Client coordinates → world point on the plane z = planeZ. */
  private toWorld(clientX: number, clientY: number, planeZ: number, out: THREE.Vector3): THREE.Vector3 {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const t = (planeZ - origin.z) / direction.z;
    return out.copy(direction).multiplyScalar(t).add(origin);
  }

  private hits(clientX: number, clientY: number): boolean {
    this.toWorld(clientX, clientY, 0, this.v); // also primes the raycaster
    return this.raycaster.intersectObject(this.loop.hitTarget, false).length > 0;
  }

  private placeHitPad(): void {
    const pad = this.hitPad!;
    const box = this.getScreenRect();
    const r = this.canvas.getBoundingClientRect();
    pad.style.width = `${box.width}px`;
    pad.style.height = `${box.height}px`;
    pad.style.transform = `translate(${(box.x - r.left).toFixed(1)}px,${(box.y - r.top).toFixed(1)}px)`;
  }

  // ───────────────────────────── Pointer ─────────────────────────────

  private bindPointer(): void {
    const target: HTMLElement = this.hitPad ?? this.canvas;
    const listen = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      el.addEventListener(type, fn as EventListener, { passive: true });
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };

    const onMove = (e: PointerEvent) => {
      if (this.pointerId === e.pointerId) {
        const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
        if (!this.dragging && this.opts.draggable && moved > 3) {
          this.dragging = true;
          this.loop.grab();
          target.style.cursor = 'grabbing';
        }
        if (this.dragging) {
          const p = this.toWorld(e.clientX, e.clientY, 0, this.v).add(this.grabOffset);
          const [x, y] = this.clampToView(p.x, p.y);
          this.loop.moveTo(x, y, 0);
        }
      }
      if (this.opts.followPointer) {
        // Aim at a point in front of Loop so facing the pointer faces the user.
        this.loop.gazeAt(this.toWorld(e.clientX, e.clientY, this.loop.position.z + 2.2, this.v));
      }
      if (!this.hitPad && this.pointerId === null && e.pointerType === 'mouse') {
        this.canvas.style.cursor = this.hits(e.clientX, e.clientY) ? 'grab' : '';
      }
    };

    const onDown = (e: PointerEvent) => {
      if (this.pointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const hit = this.hitPad ? true : this.hits(e.clientX, e.clientY);
      if (!hit) {
        if (this.opts.roam) {
          const p = this.toWorld(e.clientX, e.clientY, 0, this.v);
          const [x, y] = this.clampToView(p.x, p.y - LOOP_HEIGHT * 0.5);
          this.pinned = true;
          this.loop.moveTo(x, y, 0);
        }
        return;
      }
      window.clearTimeout(this.homeTimer);
      this.pointerId = e.pointerId;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.grabOffset.copy(this.loop.position).sub(this.toWorld(e.clientX, e.clientY, 0, this.v));
      this.grabOffset.z = 0;
      target.setPointerCapture?.(e.pointerId);
    };

    const onUp = (e: PointerEvent) => {
      if (this.pointerId !== e.pointerId) return;
      this.pointerId = null;
      target.style.cursor = this.hitPad ? 'grab' : '';
      if (this.dragging) {
        this.dragging = false;
        // Loop keeps a little momentum and settles where it was let go.
        this.loop.release();
        const g = this.loop.goal;
        const [x, y] = this.clampToView(g.x, g.y);
        g.set(x, y, 0);
        this.pinned = true;
        // Returning to the dock, if wanted, is its own unhurried journey later.
        window.clearTimeout(this.homeTimer);
        if (this.opts.returnHome) {
          this.homeTimer = window.setTimeout(() => !this.dragging && this.goHome(), 1400);
        }
      } else if (performance.now() - this.downAt.t < 600) {
        this.loop.poke();
      }
    };

    listen(target, 'pointerdown', onDown);
    listen(window, 'pointermove', onMove);
    listen(window, 'pointerup', onUp);
    listen(window, 'pointercancel', onUp);
    const onLeave = () => this.loop.gazeAt(null);
    listen(document.documentElement, 'pointerleave', onLeave);
  }

  /** The region Loop's ground point can occupy, in the stage's own units. */
  bounds(): { halfWidth: number; top: number; bottom: number } {
    const viewW = (this.viewH * this.width) / this.height;
    const bottom = this.camera.position.y - this.viewH * 0.045 - this.viewH / 2;
    return {
      halfWidth: Math.max(0, viewW / 2 - LOOP_HEIGHT * 0.3),
      top: Math.max(0, bottom + this.viewH - LOOP_HEIGHT - 0.25),
      bottom: Math.min(0, bottom + 0.1),
    };
  }

  private clampToView(x: number, y: number): [number, number] {
    const viewW = (this.viewH * this.width) / this.height;
    const halfW = Math.max(0, viewW / 2 - LOOP_HEIGHT * 0.3);
    const bottom = this.camera.position.y - this.viewH * 0.045 - this.viewH / 2;
    const top = bottom + this.viewH - LOOP_HEIGHT - 0.25;
    return [clamp(x, -halfW, halfW), clamp(y, Math.min(0, bottom + 0.1), Math.max(0, top))];
  }
}
