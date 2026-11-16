import * as THREE from 'three';
import { clamp, damp, lerp } from './spring';

/** Everything the display can draw. All values blend smoothly. */
export interface FaceParams {
  /** 1 = eyes open, 0 = shut. */
  open: number;
  /** 0 = oval eyes; +1 = happy arcs (^ ^); −1 = drooping arcs (sleep). */
  arch: number;
  /** Eye size multipliers. */
  eyeW: number;
  eyeH: number;
  /** Inward tilt of the eyes in radians (+ = stern, − = worried). */
  tilt: number;
  /** Upper lid: 0 = none, 1 = eye fully covered from the top. */
  lid: number;
  /** Per-eye scale and lift, for asymmetric looks. L = screen-left. */
  scaleL: number;
  scaleR: number;
  raiseL: number;
  raiseR: number;
  /** −1 frown … +1 smile. */
  smile: number;
  /** 0 closed line … 1 wide open. */
  mouthOpen: number;
  mouthW: number;
  /** Lopsidedness of the mouth, −1 … 1. */
  skew: number;
  /** 0…1: replace the mouth with three "thinking" dots. */
  dots: number;
}

export const NEUTRAL: FaceParams = {
  open: 1, arch: 0, eyeW: 1, eyeH: 1, tilt: 0, lid: 0,
  scaleL: 1, scaleR: 1, raiseL: 0, raiseR: 0,
  smile: 0.55, mouthOpen: 0, mouthW: 1, skew: 0, dots: 0,
};

const x = (o: Partial<FaceParams>): FaceParams => ({ ...NEUTRAL, ...o });

/** Built-in expressions. Add your own with `Loop.defineExpression`. */
export const EXPRESSIONS = {
  neutral: x({}),
  happy: x({ arch: 1, smile: 1, mouthW: 1.25 }),
  joy: x({ arch: 1, smile: 1, mouthOpen: 0.7, mouthW: 1.3 }),
  laugh: x({ arch: 1, smile: 1, mouthOpen: 1, mouthW: 1.2, raiseL: 0.05, raiseR: 0.05 }),
  knowing: x({ smile: 0.8, skew: 0.7, lid: 0.22, mouthW: 1.2 }),
  curious: x({ scaleR: 1.18, raiseR: 0.12, scaleL: 0.92, smile: 0.25, mouthW: 0.7 }),
  attentive: x({ eyeH: 1.08, eyeW: 1.05, smile: 0.4, mouthW: 0.8 }),
  thinking: x({ lid: 0.18, smile: 0, mouthW: 0.6, dots: 1, raiseL: 0.06, raiseR: 0.06 }),
  surprised: x({ eyeH: 1.2, eyeW: 1.25, smile: 0, mouthOpen: 0.75, mouthW: 0.5, raiseL: 0.08, raiseR: 0.08 }),
  sleepy: x({ lid: 0.55, eyeH: 0.85, smile: 0.2, mouthW: 0.7 }),
  asleep: x({ arch: -1, smile: 0.1, mouthW: 0.5 }),
  unimpressed: x({ lid: 0.5, smile: 0, mouthW: 0.7 }),
  sideEye: x({ lid: 0.3, smile: 0.35, skew: -0.5 }),
  concerned: x({ tilt: -0.28, smile: -0.45, mouthW: 0.8, eyeH: 0.95 }),
  sad: x({ tilt: -0.34, smile: -0.8, lid: 0.2, eyeH: 0.9 }),
  determined: x({ tilt: 0.24, lid: 0.2, smile: 0.3, mouthW: 0.9 }),
  wink: x({ scaleL: 1, raiseR: 0, smile: 0.9, skew: 0.4 }),
} satisfies Record<string, FaceParams>;

export type ExpressionName = keyof typeof EXPRESSIONS;
export type EyeStyle = 'oval' | 'pixel' | 'outline';

const W = 752;
const H = 368;
const KEYS = Object.keys(NEUTRAL) as (keyof FaceParams)[];

/**
 * Loop's face: a 2D canvas mapped onto the display as an emissive texture.
 * Drawing in 2D keeps every expression cheap and lets them morph freely.
 */
export class Face {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly params: FaceParams = { ...NEUTRAL };
  target: FaceParams = { ...NEUTRAL };

  color = '#fff1dc';
  /** Optional different colour for the screen-right eye ("Split Accent"). */
  colorRight: string | null = null;
  style: EyeStyle = 'oval';
  /** 0…1 blur halo around lit shapes. */
  glow = 1;
  /** Gaze within the display, −1 … 1. */
  lookX = 0;
  lookY = 0;
  /** Extra eyelid closure from blinking, 0 … 1. */
  blink = 0;
  /** If set, the screen-right eye stays shut (wink). */
  winkRight = 0;
  /** Live mouth opening added on top of the expression (speech). */
  talk = 0;

  private ctx: CanvasRenderingContext2D;
  private time = 0;
  private lastKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw();
  }

  /** Jump straight to the target expression (no morph). */
  snap(): void {
    Object.assign(this.params, this.target);
  }

  update(dt: number): void {
    this.time += dt;
    const k = damp(13, dt);
    for (const key of KEYS) this.params[key] = lerp(this.params[key], this.target[key], k);
    this.draw();
  }

  private draw(): void {
    const p = this.params;
    const animated = p.dots > 0.02;
    const key =
      KEYS.map((k) => p[k].toFixed(3)).join() +
      [this.lookX, this.lookY, this.blink, this.winkRight, this.talk, this.glow].map((v) => v.toFixed(3)).join() +
      this.color + this.colorRight + this.style + (animated ? this.time.toFixed(2) : '');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.shadowBlur = 0;
    c.globalAlpha = 1;
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);

    const gx = this.lookX * W * 0.085;
    const gy = -this.lookY * H * 0.13;
    const eyeY = H * 0.44 + gy;
    const spread = W * 0.2;

    this.eye(W / 2 - spread + gx, eyeY, -1, p.scaleL, p.raiseL, this.blink, this.color);
    this.eye(
      W / 2 + spread + gx, eyeY, 1, p.scaleR, p.raiseR,
      Math.max(this.blink, this.winkRight), this.colorRight ?? this.color,
    );
    this.mouth(W / 2 + gx * 1.15, H * 0.7 + gy * 0.85);
    this.texture.needsUpdate = true;
  }

  private lit(color: string): void {
    const c = this.ctx;
    c.fillStyle = color;
    c.strokeStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 26 * this.glow;
    c.lineCap = this.style === 'pixel' ? 'butt' : 'round';
    c.lineJoin = 'round';
  }

  private eye(cx: number, cy: number, side: number, scale: number, raise: number, shut: number, color: string): void {
    const p = this.params;
    const c = this.ctx;
    const w = 42 * p.eyeW * scale;
    const h = 112 * p.eyeH * scale;
    const arch = clamp(p.arch, -1, 1);
    const a = Math.abs(arch);
    const open = clamp(p.open * (1 - shut), 0, 1);

    c.save();
    c.translate(cx, cy - raise * H);
    // The small constant counters the lean the curved display adds.
    c.rotate(side * (p.tilt + 0.04));
    this.lit(color);

    if (a > 0.5) {
      // Arc eye: a dot that stretches sideways and bows.
      const t = (a - 0.5) * 2;
      const half = w * 1.25 * t;
      const bow = w * 1.0 * t * Math.sign(arch);
      c.lineWidth = w * 0.72;
      c.beginPath();
      c.moveTo(-half, bow * 0.5);
      c.quadraticCurveTo(0, -bow * 1.5, half, bow * 0.5);
      c.stroke();
      // A zero-length stroke draws nothing in some browsers; keep the dot solid.
      if (t < 0.08) {
        c.beginPath();
        c.arc(0, 0, w * 0.36, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      const t = a * 2;
      const hh = Math.max(lerp(h, w * 0.72, t) * open, w * 0.16);
      const ww = lerp(w, w * 0.72, t) * lerp(1.25, 1, Math.min(1, open * 3));
      if (p.lid > 0.01) {
        // Flat upper lid: clip away the top of the eye.
        c.beginPath();
        c.rect(-w * 2, -hh / 2 + hh * p.lid, w * 4, h * 2);
        c.clip();
      }
      const r = this.style === 'pixel' ? 2 : Math.min(ww, hh) / 2;
      c.beginPath();
      c.roundRect(-ww / 2, -hh / 2, ww, hh, r);
      if (this.style === 'outline') {
        c.lineWidth = 7;
        c.stroke();
      } else {
        c.fill();
      }
    }
    c.restore();
  }

  private mouth(cx: number, cy: number): void {
    const p = this.params;
    const c = this.ctx;
    const alpha = 1 - clamp(p.dots, 0, 1);
    const half = 34 * p.mouthW;
    const curve = p.smile * 22;
    const open = clamp(p.mouthOpen + this.talk, 0, 1);

    c.save();
    c.translate(cx, cy);
    this.lit(this.color);

    if (alpha > 0.02) {
      c.globalAlpha = alpha;
      const lift = p.skew * 9;
      if (open > 0.06) {
        // Open mouth: flat (or curved) top, rounded drop below.
        const drop = 10 + open * 38;
        const hw = half * lerp(1, 0.78, open);
        c.beginPath();
        c.moveTo(-hw, -curve * 0.5 + lift);
        c.quadraticCurveTo(0, curve * 0.5, hw, -curve * 0.5 - lift);
        c.bezierCurveTo(hw, drop * 1.25, -hw, drop * 1.25, -hw, -curve * 0.5 + lift);
        c.closePath();
        c.fill();
      } else {
        c.lineWidth = 9;
        c.beginPath();
        c.moveTo(-half, -curve * 0.5 + lift);
        c.quadraticCurveTo(p.skew * half * 0.5, curve * 1.5, half, -curve * 0.5 - lift);
        c.stroke();
      }
    }

    if (p.dots > 0.02) {
      c.globalAlpha = clamp(p.dots, 0, 1);
      for (let i = 0; i < 3; i++) {
        const phase = this.time * 5.2 - i * 0.9;
        const hop = Math.max(0, Math.sin(phase)) * 11;
        c.beginPath();
        c.arc((i - 1) * 30, -hop, 7.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}
