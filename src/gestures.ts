import type { ExpressionName } from './Face';
import { clamp, easeInOut, envelope } from './spring';

/**
 * Additive offsets a gesture layers on top of Loop's live motion.
 *
 * A gesture only steers Loop's centre (head and upper torso) and its hands.
 * The lower torso, wisps, clothing and chain are never posed directly: they
 * follow through on their own, which is what keeps every gesture fluid.
 */
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
  /** Hand raise in radians. L = screen-left, R = screen-right. */
  armL: number;
  armR: number;
  /** 0…1: the wisps open outward. */
  spread: number;
  /** 0…1: the inner light and outline brighten. */
  light: number;
  /** 0…1: turn to face the user, whatever Loop was looking at. */
  attend: number;
  /** 0…1: hands drawn in close to the chest. */
  handsIn: number;
}

export const zeroPose = (): Pose => ({
  lift: 0, slide: 0, pitch: 0, yaw: 0, roll: 0, stretch: 0, armL: 0, armR: 0, spread: 0, light: 0, attend: 0, handsIn: 0,
});

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
  /** Greeting: turn to the user, rise a little, a loose floating wave. */
  wave: {
    duration: 2.3,
    expression: 'happy',
    apply(p, pose, t) {
      const e = envelope(p, 0.22, 0.3);
      pose.attend = envelope(p, 0.1, 0.3);
      pose.lift = e * 0.12;
      // The hand leads; the body answers each swing a moment later.
      pose.armR = e * (2.05 + Math.sin(t * 8.5) * 0.36);
      pose.roll = -e * (0.05 + Math.sin(t * 8.5 - 0.9) * 0.022);
      pose.armL = e * 0.12;
    },
  },
  /** Acknowledges a saved action. */
  nod: {
    duration: 1.1,
    expression: 'happy',
    apply(p, pose) {
      const e = envelope(p, 0.14, 0.32);
      const dip = Math.max(0, Math.sin(p * TAU * 1.5));
      pose.pitch = e * dip * 0.2;
      pose.lift = -e * dip * 0.035;
    },
  },
  /** A gentle "no": something did not go through. */
  shake: {
    duration: 1.3,
    expression: 'concerned',
    apply(p, pose) {
      const e = envelope(p, 0.14, 0.35);
      pose.yaw = e * Math.sin(p * TAU * 2) * 0.3;
      pose.handsIn = e * 0.4;
    },
  },
  /** Small achievement: the inner light brightens, Loop lifts, the wisps open. */
  lift: {
    duration: 1.9,
    expression: 'joy',
    apply(p, pose) {
      const e = envelope(p, 0.24, 0.42);
      pose.light = envelope(p, 0.16, 0.5);
      pose.lift = e * 0.17;
      pose.spread = e * 0.85;
      pose.stretch = e * 0.02;
      pose.armL = pose.armR = e * 0.55;
    },
  },
  /**
   * Major milestone: one buoyant upward sweep on a curve, a single turn at
   * the top, then a gentle settle. Brief by design.
   */
  flourish: {
    duration: 2.5,
    expression: 'joy',
    apply(p, pose) {
      const rise = envelope(p, 0.3, 0.42);
      pose.lift = rise * 0.62;
      // The path bows out to one side on the way up and returns over the top.
      pose.slide = Math.sin(clamp(p / 0.8, 0, 1) * Math.PI) * 0.26 * (1 - p * 0.4);
      pose.roll = -Math.cos(clamp(p / 0.8, 0, 1) * Math.PI) * 0.1 * envelope(p, 0.1, 0.3);
      pose.yaw = easeInOut(clamp((p - 0.16) / 0.5, 0, 1)) * TAU;
      pose.stretch = envelope(clamp(p / 0.4, 0, 1), 0.3, 0.5) * 0.03;
      pose.armL = pose.armR = rise * 1.9;
      pose.spread = envelope(clamp((p - 0.25) / 0.65, 0, 1), 0.3, 0.5) * 0.9;
      pose.light = envelope(p, 0.2, 0.45);
    },
  },
  /** New outfit: a smooth turn through a three-quarter view, then back. */
  turn: {
    duration: 2.6,
    expression: 'proud',
    apply(p, pose) {
      const e = envelope(p, 0.12, 0.2);
      // Out to one side, hold so it reads, a glance to the other, home.
      const a = easeInOut(clamp(p / 0.3, 0, 1));
      const b = easeInOut(clamp((p - 0.48) / 0.26, 0, 1));
      const c = easeInOut(clamp((p - 0.8) / 0.2, 0, 1));
      pose.yaw = 0.82 * a - 1.3 * b + 0.48 * c;
      pose.lift = e * 0.07;
      pose.armL = pose.armR = e * 0.32;
      pose.attend = e;
    },
  },
  /** A soft, decaying giggle (several quick taps). */
  wiggle: {
    duration: 1.3,
    expression: 'laugh',
    apply(p, pose) {
      const decay = (1 - p) * (1 - p);
      pose.roll = Math.sin(p * TAU * 3.5) * 0.085 * decay;
      pose.spread = envelope(p, 0.15, 0.5) * 0.5;
      pose.lift = envelope(p, 0.15, 0.5) * 0.06;
      pose.armL = pose.armR = envelope(p, 0.12, 0.5) * 0.45;
    },
  },
  /** One eye lifts as Loop leans, curious. */
  tilt: {
    duration: 2.2,
    expression: 'curious',
    apply(p, pose) {
      const e = envelope(p, 0.3, 0.35);
      pose.roll = e * 0.13;
      pose.slide = -e * 0.03;
    },
  },
  /** A slow, contented stretch. */
  stretch: {
    duration: 2.8,
    expression: 'happy',
    apply(p, pose) {
      const e = envelope(p, 0.32, 0.36);
      pose.armL = pose.armR = e * 2.2;
      pose.stretch = e * 0.035;
      pose.lift = e * 0.1;
      pose.pitch = -e * 0.06;
      pose.spread = e * 0.3;
    },
  },
  /** Woken or surprised: a quick lift that eases straight back down. */
  startle: {
    duration: 0.9,
    expression: 'surprised',
    apply(p, pose) {
      const e = envelope(p, 0.1, 0.65);
      pose.lift = e * 0.16;
      pose.stretch = e * 0.03;
      pose.armL = pose.armR = e * 0.9;
      pose.spread = e * 0.6;
    },
  },
} satisfies Record<string, Gesture>;

export type GestureName = keyof typeof GESTURES;

/** Earlier and alternative names that still work with `Loop.play`. */
export const GESTURE_ALIASES: Record<string, GestureName> = {
  celebration: 'flourish',
  celebrate: 'flourish',
  dance: 'flourish',
  spin: 'turn',
  glow: 'lift',
};

