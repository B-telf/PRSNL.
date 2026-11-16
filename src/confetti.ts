/** Confetti colours drawn from Loop's palette. */
export const CONFETTI_COLORS = ['#1b9aa0', '#58cfc9', '#ffc56e', '#ff8a6b', '#f6efe4', '#8a6fd1', '#4f86d9'];

export interface BurstOptions {
  /** Origin in viewport (client) pixels. */
  x: number;
  y: number;
  /** Number of pieces. */
  count?: number;
  /** Direction in degrees: 0 = right, 90 = straight up. */
  angle?: number;
  /** Fan width in degrees. */
  spread?: number;
  /** Launch speed in px/s. */
  speed?: number;
  colors?: string[];
}

interface Piece {
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; rot: number; spin: number;
  flip: number; flipSpeed: number; sway: number;
  color: string; shape: 0 | 1 | 2; life: number; ttl: number;
}

/**
 * Full-screen confetti drawn on a 2D canvas above the page. The canvas never
 * takes pointer input, and it removes itself once every piece has settled.
 */
export class Confetti {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private pieces: Piece[] = [];
  private raf = 0;
  private last = 0;
  private timers: number[] = [];

  /** `zIndex` should sit above the UI the confetti falls over. */
  constructor(private zIndex = 2147483600) {}

  get active(): boolean {
    return this.pieces.length > 0;
  }

  /** Fire a fan of confetti from a point. */
  burst(o: BurstOptions): void {
    const count = o.count ?? 80;
    const angle = ((o.angle ?? 90) * Math.PI) / 180;
    const spread = ((o.spread ?? 70) * Math.PI) / 180;
    const speed = o.speed ?? 900;
    const colors = o.colors ?? CONFETTI_COLORS;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random() * 0.75);
      this.add(o.x, o.y, Math.cos(a) * v, -Math.sin(a) * v, colors);
    }
    this.run();
  }

  /** Let confetti drift down from the top edge for `seconds`. */
  rain(count = 120, seconds = 1.6, colors = CONFETTI_COLORS): void {
    const batches = 12;
    for (let b = 0; b < batches; b++) {
      this.timers.push(
        window.setTimeout(() => {
          for (let i = 0; i < count / batches; i++) {
            this.add(Math.random() * window.innerWidth, -20, (Math.random() - 0.5) * 160, 60 + Math.random() * 260, colors);
          }
          this.run();
        }, (b / batches) * seconds * 1000),
      );
    }
  }

  /** Remove everything immediately. */
  clear(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.pieces = [];
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas?.remove();
    this.canvas = this.ctx = null;
  }

  private add(x: number, y: number, vx: number, vy: number, colors: string[]): void {
    const size = 8 + Math.random() * 8;
    const shape = Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2;
    this.pieces.push({
      x, y, vx, vy,
      w: shape === 2 ? size * 0.45 : size,
      h: shape === 2 ? size * 2.2 : size * (0.5 + Math.random() * 0.4),
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 12,
      flip: Math.random() * Math.PI * 2,
      flipSpeed: 5 + Math.random() * 9,
      sway: Math.random() * Math.PI * 2,
      color: colors[(Math.random() * colors.length) | 0],
      shape,
      life: 0,
      ttl: 5 + Math.random() * 2.5,
    });
  }

  private run(): void {
    if (!this.canvas) {
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${this.zIndex};`;
      document.body.appendChild(c);
      this.canvas = c;
      this.ctx = c.getContext('2d');
    }
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      if (this.pieces.length) this.raf = requestAnimationFrame(tick);
      else this.clear();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private step(dt: number): void {
    const c = this.canvas!;
    const ctx = this.ctx!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const drag = Math.exp(-1.9 * dt);
    this.pieces = this.pieces.filter((p) => {
      p.life += dt;
      // Paper physics: quick launch, heavy drag, then a slow fluttering fall.
      p.vx *= drag;
      p.vy = p.vy * drag + 430 * dt;
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * 45) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      if (p.life > p.ttl || p.y > h + 40) return false;

      ctx.save();
      ctx.globalAlpha = Math.min(1, (p.ttl - p.life) / 0.6);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color;
      if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
      return true;
    });
  }
}
