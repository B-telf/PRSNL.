import type { ExpressionName } from './Face';
import { clamp, easeInOut, envelope, lerp } from './spring';

/** Additive offsets a gesture layers on top of Loop's live motion. */
export interface Pose {
  /** Extra height. */
  lift: number;
  /** Sideways slide. */
  slide: number;
  /** Lean forward (+) / back (−), radians. */
  pitch: number;
  /** Turn left/right, radians. */
  yaw: number;
  /** Tip sideways, radians. */
  roll: number;
  /** Vertical stretch added to 1 (negative squashes). */
  stretch: number;
  /** Arm raise in radians. L = screen-left, R = screen-right. */
  armL: number;
  armR: number;
}

export const zeroPose = (): Pose => ({ lift: 0, slide: 0, pitch: 0, yaw: 0, roll: 0, stretch: 0, armL: 0, armR: 0 });

export interface Gesture {
  /** Seconds. */
  duration: number;
  /** Expression held while the gesture plays. */
  expression?: ExpressionName;
  /** Write offsets for progress `p` (0…1). `t` is seconds since start. */
  apply(p: number, pose: Pose, t: number): void;
}

const TAU = Math.PI * 2;

/** Built-in gestures. Add your own with `Loop.defineGesture`. */
export const GESTURES = {
  /** Small Wave — brief greeting. */
  wave: {
    duration: 1.7,
    expression: 'happy',
    apply(p, pose, t) {
      const e = envelope(p, 0.2, 0.25);
      pose.armR = e * (2.25 + Math.sin(t * 15) * 0.32);
      pose.roll = -e * 0.07;
      pose.lift = e * 0.05;
    },
  },
  /** Satisfied Nod — acknowledges a saved action. */
  nod: {
    duration: 0.95,
    expression: 'happy',
    apply(p, pose) {
      const e = envelope(p, 0.12, 0.3);
      pose.pitch = e * Math.max(0, Math.sin(p * TAU * 2)) * 0.26;
      pose.lift = -pose.pitch * 0.12;
    },
  },
  /** Gentle "no". */
  shake: {
    duration: 1,
    expression: 'concerned',
    apply(p, pose) {
      pose.yaw = envelope(p, 0.12, 0.3) * Math.sin(p * TAU * 2.5) * 0.36;
    },
  },
  /** Pocket Stretch — a tiny standing stretch. */
  stretch: {
    duration: 2.4,
    expression: 'happy',
    apply(p, pose) {
      const e = envelope(p, 0.3, 0.3);
      pose.armL = pose.armR = e * 2.5;
      pose.stretch = e * 0.09;
      pose.lift = e * 0.1;
      pose.pitch = -e * 0.08;
      pose.roll = e * Math.sin(p * TAU) * 0.05;
    },
  },
  /** Celebration: two floaty hops with arms up. */
  celebrate: {
    duration: 1.6,
    expression: 'joy',
    apply(p, pose) {
      const e = envelope(p, 0.1, 0.2);
      const hop = Math.abs(Math.sin(p * Math.PI * 2));
      pose.lift = e * hop * 0.42;
      pose.stretch = e * (hop - 0.45) * 0.14;
      pose.armL = pose.armR = e * (1.9 + hop * 0.5);
      pose.roll = e * Math.sin(p * TAU * 2) * 0.08;
    },
  },
  /** Party dance: side-to-side bounce, a spin in the middle, arms-up finish. */
  dance: {
    duration: 3.6,
    expression: 'joy',
    apply(p, pose) {
      const e = envelope(p, 0.06, 0.1);
      const sway = Math.sin(p * TAU * 3.5);
      const beat = Math.abs(Math.sin(p * TAU * 3.5));
      const finish = clamp((p - 0.84) / 0.08, 0, 1);
      pose.slide = e * sway * 0.24 * (1 - finish);
      pose.roll = -e * sway * 0.17 * (1 - finish);
      pose.lift = e * (beat * 0.2 + finish * 0.22);
      pose.stretch = e * ((beat - 0.5) * 0.2 + finish * 0.08);
      pose.pitch = -e * finish * 0.1;
      pose.armL = e * lerp(1.5 + sway * 0.9, 2.5, finish);
      pose.armR = e * lerp(1.5 - sway * 0.9, 2.5, finish);
      // One full turn through the middle of the dance.
      pose.yaw = easeInOut(clamp((p - 0.4) / 0.26, 0, 1)) * TAU;
    },
  },
  /** Hover & Settle — lifts, turns once, lands. */
  spin: {
    duration: 1.8,
    expression: 'happy',
    apply(p, pose) {
      const e = envelope(p, 0.25, 0.3);
      pose.lift = e * 0.45;
      pose.yaw = easeInOut(p) * TAU;
      pose.armL = pose.armR = e * 0.9;
      pose.stretch = e * 0.05;
    },
  },
  /** Victory Shuffle — a short two-step. */
  shuffle: {
    duration: 1.5,
    expression: 'joy',
    apply(p, pose) {
      const e = envelope(p, 0.12, 0.2);
      const s = Math.sin(p * TAU * 2);
      pose.slide = e * s * 0.16;
      pose.roll = -e * s * 0.13;
      pose.lift = e * Math.abs(Math.cos(p * TAU * 2)) * 0.08;
      pose.armL = e * (0.7 + s * 0.5);
      pose.armR = e * (0.7 - s * 0.5);
    },
  },
  /** Giggle: a quick decaying wobble (used when poked repeatedly). */
  wiggle: {
    duration: 1.1,
    expression: 'laugh',
    apply(p, pose) {
      const decay = (1 - p) * (1 - p);
      pose.roll = Math.sin(p * TAU * 5) * 0.14 * decay;
      pose.stretch = Math.sin(p * TAU * 10) * 0.04 * decay;
      pose.armL = pose.armR = envelope(p, 0.1, 0.5) * 0.6;
    },
  },
  /** Curious Tilt — one eye lifts as Loop leans. */
  tilt: {
    duration: 1.6,
    expression: 'curious',
    apply(p, pose) {
      const e = envelope(p, 0.25, 0.3);
      pose.roll = e * 0.2;
      pose.slide = -e * 0.04;
    },
  },
  /** Startled little jump. */
  startle: {
    duration: 0.7,
    expression: 'surprised',
    apply(p, pose) {
      const e = envelope(p, 0.08, 0.6);
      pose.lift = e * 0.28;
      pose.stretch = e * 0.12;
      pose.armL = pose.armR = e * 1.3;
    },
  },
} satisfies Record<string, Gesture>;

export type GestureName = keyof typeof GESTURES;
