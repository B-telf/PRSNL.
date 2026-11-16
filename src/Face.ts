import * as THREE from 'three';
import { clamp, damp, lerp } from './spring';

/** Everything the face can show. All values blend smoothly. */
export interface FaceParams {
  /** 1 = eyes open, 0 = shut. */
  open: number;
  /** 0 = oval eyes; +1 = happy arcs (^ ^); −1 = drooping arcs (sleep). */
  arch: number;
  /** Eye size multipliers. */
  eyeW: number;
  eyeH: number;
  /** Inward tilt of the eyes in radians (+ = confident, − = worried). */
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
  open: 1, arch: 0, eyeW: 1, eyeH: 1, tilt: 0.1, lid: 0.2,
  scaleL: 1, scaleR: 1, raiseL: 0, raiseR: 0,
  smile: 0.55, mouthOpen: 0, mouthW: 1, skew: 0.45, dots: 0,
};

const x = (o: Partial<FaceParams>): FaceParams => ({ ...NEUTRAL, tilt: 0, lid: 0, skew: 0, ...o });

/** Built-in expressions. Add your own with `Loop.defineExpression`. */
export const EXPRESSIONS = {
  /** Calm, self-assured: a level lid and a small one-sided smile. */
  neutral: { ...NEUTRAL },
  joy: x({ arch: 1, smile: 1, mouthOpen: 0.7, mouthW: 1.2, raiseL: 0.04, raiseR: 0.04 }),
  happy: x({ arch: 1, smile: 1, mouthW: 1.2, raiseL: 0.03, raiseR: 0.03 }),
  proud: x({ lid: 0.34, tilt: 0.16, smile: 0.95, skew: 0.5, mouthW: 1.25, raiseL: 0.03, raiseR: 0.03 }),
  focused: x({ lid: 0.3, tilt: 0.2, smile: 0.1, mouthW: 0.7, eyeH: 0.92 }),
  quiet: x({ lid: 0.46, smile: 0.25, mouthW: 0.7, eyeH: 0.9 }),
  concerned: x({ tilt: -0.3, smile: -0.4, mouthW: 0.75, eyeH: 0.95, raiseL: 0.03, raiseR: 0.03 }),
  attentive: x({ eyeH: 1.12, eyeW: 1.06, smile: 0.4, mouthW: 0.8, raiseL: 0.03, raiseR: 0.03 }),
  thinking: x({ lid: 0.2, smile: 0, mouthW: 0.6, dots: 1, raiseL: 0.06, raiseR: 0.06 }),
  curious: x({ scaleR: 1.22, raiseR: 0.1, scaleL: 0.9, smile: 0.25, mouthW: 0.65 }),
  surprised: x({ eyeH: 1.16, eyeW: 1.2, smile: 0, mouthOpen: 0.7, mouthW: 0.5, raiseL: 0.06, raiseR: 0.06 }),
  laugh: x({ arch: 1, smile: 1, mouthOpen: 1, mouthW: 1.2, raiseL: 0.06, raiseR: 0.06 }),
  sleepy: x({ lid: 0.6, eyeH: 0.85, smile: 0.2, mouthW: 0.7 }),
  asleep: x({ arch: -1, smile: 0.15, mouthW: 0.5 }),
  wink: x({ smile: 1, skew: 0.5, mouthW: 1.1 }),
} satisfies Record<string, FaceParams>;

export type ExpressionName = keyof typeof EXPRESSIONS;

const W = 760;
const H = 440;
const KEYS = Object.keys(NEUTRAL) as (keyof FaceParams)[];

/**
 * Loop's face: a transparent 2D canvas laid over the front of the head.
 * Drawing in 2D keeps every expression cheap and lets them morph freely.
 */
export class Face {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly params: FaceParams = { ...NEUTRAL };
  target: FaceParams = { ...NEUTRAL };

  color = '#16171c';
  /** 0…1 soft glow around the eyes (used by the coloured eyes). */
  glow = 0;
  /** Gaze, −1 … 1. */
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
      this.color + (animated ? this.time.toFixed(2) : '');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);

    const gx = this.lookX * W * 0.05;
    const gy = -this.lookY * H * 0.05;
    const eyeY = H * 0.42 + gy;
    const spread = W * 0.235;
    this.eye(W / 2 - spread + gx, eyeY, -1, p.scaleL, p.raiseL, this.blink);
    this.eye(W / 2 + spread + gx, eyeY, 1, p.scaleR, p.raiseR, Math.max(this.blink, this.winkRight));
    this.mouth(W / 2 + gx * 1.1, H * 0.72 + gy * 0.8);
    this.texture.needsUpdate = true;
  }

  private ink(): void {
    const c = this.ctx;
    c.fillStyle = this.color;
    c.strokeStyle = this.color;
    c.shadowColor = this.color;
    c.shadowBlur = 22 * this.glow;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  private eye(cx: number, cy: number, side: number, scale: number, raise: number, shut: number): void {
    const p = this.params;
    const c = this.ctx;
    const w = 76 * p.eyeW * scale;
    const h = 124 * p.eyeH * scale;
    const arch = clamp(p.arch, -1, 1);
    const a = Math.abs(arch);
    const open = clamp(p.open * (1 - shut), 0, 1);

    c.save();
    c.translate(cx, cy - raise * H);
    // Positive tilt lowers the inner corner of each eye.
    c.rotate(-side * p.tilt);
    this.ink();

    if (a > 0.5) {
      // Arc eye: a dot that stretches sideways and bows.
      const t = (a - 0.5) * 2;
      const half = w * 0.85 * t;
      const bow = w * 0.7 * t * Math.sign(arch);
      c.lineWidth = w * 0.42;
      c.beginPath();
      c.moveTo(-half, bow * 0.5);
      c.quadraticCurveTo(0, -bow * 1.5, half, bow * 0.5);
      c.stroke();
      if (t < 0.08) {
        c.beginPath();
        c.arc(0, 0, w * 0.21, 0, Math.PI * 2);
        c.fill();
      }
    } else {
      const t = a * 2;
      const hh = Math.max(lerp(h, w * 0.42, t) * open, w * 0.14);
      const ww = lerp(w, w * 0.42, t) * lerp(1.2, 1, Math.min(1, open * 3));
      c.save();
      if (p.lid > 0.01) {
        // Flat upper lid: clip away the top of the eye.
        c.beginPath();
        c.rect(-w * 2, -hh / 2 + hh * p.lid, w * 4, h * 2);
        c.clip();
      }
      c.beginPath();
      c.roundRect(-ww / 2, -hh / 2, ww, hh, Math.min(ww, hh) / 2);
      c.fill();
      // A soft catch-light keeps the eyes glossy rather than flat.
      if (open > 0.5 && t < 0.3) {
        c.shadowBlur = 0;
        c.globalAlpha = 0.2 * (1 - t / 0.3);
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.ellipse(-ww * 0.16, -hh * 0.06, ww * 0.13, hh * 0.2, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    c.restore();
  }

  private mouth(cx: number, cy: number): void {
    const p = this.params;
    const c = this.ctx;
    const alpha = 1 - clamp(p.dots, 0, 1);
    const half = 46 * p.mouthW;
    const curve = p.smile * 24;
    const open = clamp(p.mouthOpen + this.talk, 0, 1);

    c.save();
    c.translate(cx, cy);
    this.ink();
    c.shadowBlur = 0;

    if (alpha > 0.02) {
      c.globalAlpha = alpha;
      const lift = p.skew * 12;
      if (open > 0.06) {
        const drop = 12 + open * 40;
        const hw = half * lerp(1, 0.8, open);
        c.beginPath();
        c.moveTo(-hw, -curve * 0.5 + lift);
        c.quadraticCurveTo(0, curve * 0.5, hw, -curve * 0.5 - lift);
        c.bezierCurveTo(hw, drop * 1.25, -hw, drop * 1.25, -hw, -curve * 0.5 + lift);
        c.closePath();
        c.fill();
      } else {
        c.lineWidth = 10;
        c.beginPath();
        c.moveTo(-half, -curve * 0.5 + lift);
        c.quadraticCurveTo(p.skew * half * 0.5, curve * 1.5, half, -curve * 0.5 - lift);
        c.stroke();
      }
    }

    if (p.dots > 0.02) {
      c.globalAlpha = clamp(p.dots, 0, 1);
      for (let i = 0; i < 3; i++) {
        const hop = Math.max(0, Math.sin(this.time * 5.2 - i * 0.9)) * 12;
        c.beginPath();
        c.arc((i - 1) * 34, -hop, 8, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
  }

  dispose(): void {
    this.texture.dispose();
  }
}
