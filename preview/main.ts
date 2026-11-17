/**
 * Motion pass preview: one scripted sequence played on two stages at once,
 * so the same movement can be judged at playground size and at chat size.
 */
import { Vector3 } from 'three';
import { LoopStage } from '../src/LoopStage';

interface View {
  stage: LoopStage;
  finger: HTMLElement;
  host: HTMLElement;
  /** Where the simulated finger is, in the stage's own units. */
  at: { x: number; y: number };
  /** Where it was when the current beat began. */
  from: { x: number; y: number };
}

function makeView(id: string, size?: number): View {
  const host = document.getElementById(id)!;
  const stage = new LoopStage(host, {
    size,
    fill: 0.44, // leave room to be carried around and to rise

    anchor: 'bottom-center',
    margin: size ? 10 : 24,
    outfit: 'ink',
    chain: 'silver',
    followPointer: false,
    particles: 0, // effects come after the body movement is right
    sleepAfter: 0,
    idleLife: true,
  });
  const finger = document.createElement('div');
  finger.className = 'finger';
  host.appendChild(finger);
  return { stage, finger, host, at: { x: 0, y: 0 }, from: { x: 0, y: 0 } };
}

const views = [makeView('large'), makeView('small', 118)];
Object.assign(window, { views });

// ───────────────────────────── The sequence ─────────────────────────────

const ease = (t: number) => t * t * (3 - 2 * t);

/** A finger path through points given as fractions of the space Loop can move in. */
type Key = { t: number; x: number; y: number; linear?: boolean };

function pathAt(keys: Key[], t: number, from: { x: number; y: number }): { x: number; y: number } {
  let prev = { t: 0, ...from } as Key;
  for (const k of keys) {
    if (t <= k.t) {
      const f = (t - prev.t) / (k.t - prev.t);
      const e = k.linear ? f : ease(f);
      return { x: prev.x + (k.x - prev.x) * e, y: prev.y + (k.y - prev.y) * e };
    }
    prev = k;
  }
  return { x: prev.x, y: prev.y };
}

/** Fractions → stage units for one view. */
function place(view: View, p: { x: number; y: number }): { x: number; y: number } {
  const b = view.stage.bounds();
  return { x: p.x * b.halfWidth * 0.9, y: p.y * b.top * 0.9 };
}

function fraction(view: View): { x: number; y: number } {
  const b = view.stage.bounds();
  const p = view.stage.loop.position;
  return { x: b.halfWidth ? p.x / (b.halfWidth * 0.9) : 0, y: b.top ? p.y / (b.top * 0.9) : 0 };
}

const DRAG: Key[] = [
  { t: 0.75, x: 0.85, y: 0.2 },
  { t: 1.55, x: -0.85, y: 0.45 }, // the reversal to watch
  { t: 2.3, x: 0.55, y: 0.9 },
  { t: 3.1, x: -0.4, y: 0.35 },
  { t: 3.8, x: -0.1, y: 0.55 },
];
// A last sweep at steady speed, let go while still moving.
const FLICK: Key[] = [{ t: 0.55, x: 0.6, y: 0.75, linear: true }];

interface Beat {
  id: string;
  label: string;
  seconds: number;
  note: string;
  start?(v: View): void;
  update?(v: View, t: number, was: number): void;
}

let scripting = false;
const scripted = (fn: () => void) => {
  scripting = true;
  try {
    fn();
  } finally {
    scripting = false;
  }
};

const hold = (v: View) => {
  if (!v.stage.loop.isHeld) v.stage.loop.grab();
  v.from = fraction(v);
};
const drag = (v: View, keys: Key[], t: number) => {
  const p = place(v, pathAt(keys, t, v.from));
  v.at = p;
  v.stage.loop.moveTo(p.x, p.y, 0);
};
const letGo = (v: View) => {
  if (v.stage.loop.isHeld) v.stage.loop.release();
};

const beats: Beat[] = [
  {
    id: 'idle',
    label: 'Idle',
    seconds: 8,
    note: '<strong>Idle.</strong> A slow wandering float: rise, ease across, sink, return. The head barely moves; the hands drift on their own and the wisps keep curling and relaxing.',
    start: (v) => v.stage.loop.setState('idle'),
  },
  {
    id: 'drag',
    label: 'Drag + direction change',
    seconds: 4.2,
    note: '<strong>Drag.</strong> The held point stays with the finger. The body leans in, the hands and wisps trail, and at each reversal the wisps carry on the old way for a moment before curling round.',
    start: hold,
    update: (v, t) => drag(v, DRAG, t),
  },
  {
    id: 'release',
    label: 'Release',
    seconds: 7,
    note: '<strong>Release.</strong> Let go mid-movement: a short glide on what momentum is left, then a soft settle where it stopped. Later, a separate unhurried drift back to its dock.',
    start: hold,
    update: (v, t, was) => {
      if (t < 0.55) drag(v, FLICK, t);
      else letGo(v);
      if (was < 3.6 && t >= 3.6) v.stage.goHome();
    },
  },
  {
    id: 'listening',
    label: 'Listening',
    seconds: 5.5,
    note: '<strong>Listening.</strong> Leans a little closer and the larger drifting quietens, while the wisps stay softly active.',
    start: (v) => v.stage.loop.setState('listening'),
  },
  {
    id: 'celebration',
    label: 'Celebration',
    seconds: 4.6,
    note: '<strong>Celebration.</strong> One buoyant sweep up on a curve with a single turn at the top, then a gentle settle. The wisps trail the turn and open out.',
    start: (v) => {
      v.stage.loop.setState('idle');
      void v.stage.celebrate();
    },
  },
  {
    id: 'concern',
    label: 'Concern',
    seconds: 6,
    note: '<strong>Concern.</strong> Everything slows. The posture softens, the head lowers slightly and the hands come in close. A quiet drift remains, so Loop never looks switched off.',
    start: (v) => v.stage.loop.express('concerned', { seconds: 5 }),
  },
];

// ───────────────────────────── Playback ─────────────────────────────

let index = 0;
let clock = 0;
let playing = true;
let speed = 1;
let last = performance.now();

const noteEl = document.getElementById('note')!;
const beatsEl = document.getElementById('beats')!;
const playEl = document.getElementById('play')!;

function enter(i: number): void {
  index = i;
  clock = 0;
  const beat = beats[i];
  noteEl.innerHTML = beat.note;
  beatsEl.querySelectorAll('button').forEach((b, n) => b.setAttribute('aria-current', String(n === i)));
  scripted(() =>
    views.forEach((v) => {
      // Leaving a drag part-way through always lets go first.
      if (beat.id !== 'drag' && beat.id !== 'release') letGo(v);
      if (beat.id !== 'concern') v.stage.loop.express('neutral', 0.01);
      if (beat.id !== 'listening' && beat.id !== 'celebration') v.stage.loop.setState('idle');
      beat.start?.(v);
    }),
  );
}

function setPlaying(on: boolean): void {
  playing = on;
  playEl.textContent = on ? 'Pause' : 'Play';
  playEl.setAttribute('aria-pressed', String(on));
  if (!on) scripted(() => views.forEach(letGo));
}

beats.forEach((beat, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = beat.label;
  b.addEventListener('click', () => {
    enter(i);
    setPlaying(true);
  });
  beatsEl.appendChild(b);
});
playEl.addEventListener('click', () => {
  if (!playing) enter(index);
  setPlaying(!playing);
});
// The silhouette takes the page's text colour, so it reads in light and dark themes.
const silhouetteEl = document.getElementById('silhouette') as HTMLInputElement;
const applySilhouette = () => {
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1d1e2c';
  views.forEach((v) => v.stage.loop.setSilhouette(silhouetteEl.checked, ink));
};
silhouetteEl.addEventListener('change', applySilhouette);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySilhouette);
new MutationObserver(applySilhouette).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.getElementById('slow')!.addEventListener('change', (e) => {
  speed = (e.target as HTMLInputElement).checked ? 0.5 : 1;
  views.forEach((v) => (v.stage.timeScale = speed));
});

// A real drag by the viewer takes over from the script.
views.forEach((v) => v.stage.loop.on('grab', () => !scripting && setPlaying(false)));

const probe = new Vector3();
function showFinger(v: View): void {
  const loop = v.stage.loop;
  const on = playing && loop.isHeld;
  v.finger.classList.toggle('on', on);
  if (!on) return;
  // The finger rests on Loop's chest, where it was picked up.
  probe.set(v.at.x, v.at.y + 1.75, 0).project(v.stage.camera);
  const x = (probe.x * 0.5 + 0.5) * v.host.clientWidth;
  const y = (-probe.y * 0.5 + 0.5) * v.host.clientHeight;
  v.finger.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000) * speed;
  last = now;
  if (playing) {
    const was = clock;
    clock += dt;
    const beat = beats[index];
    if (clock >= beat.seconds) enter((index + 1) % beats.length);
    else if (beat.update) scripted(() => views.forEach((v) => beat.update!(v, clock, was)));
  }
  views.forEach(showFinger);
}

enter(0);
requestAnimationFrame(tick);
