/** Damped spring. `freq` in rad/s, `damping` as a ratio (1 = no overshoot). */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    value = 0,
    public freq = 8,
    public damping = 0.7,
  ) {
    this.value = value;
    this.target = value;
  }

  update(dt: number): number {
    // Sub-step so stiff springs stay stable on slow frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -2 * this.damping * this.freq * this.velocity - this.freq * this.freq * (this.value - this.target);
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  kick(impulse: number): void {
    this.velocity += impulse;
  }

  snap(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Rises over `a`, holds, falls over the last `r` of a 0..1 timeline. */
export const envelope = (p: number, a = 0.18, r = 0.25) => {
  const up = clamp(p / a, 0, 1);
  const down = clamp((1 - p) / r, 0, 1);
  const s = (x: number) => x * x * (3 - 2 * x);
  return s(up) * s(down);
};
