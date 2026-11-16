/**
 * Loop for native shells (iOS WKWebView, Android WebView).
 *
 * A transparent, full-screen page holding Loop in overlay mode. The host app
 * drives it with `LoopBridge.call(method, args)` and receives events through
 * `window.webkit.messageHandlers.loop` (iOS) or `window.LoopHost` (Android).
 * Start-up options come from `window.LoopConfig`, set by the host before load.
 */
import { LoopStage, type Anchor, type LoopStageOptions } from '../src/LoopStage';
import type { LoopState, MotionLevel, Slot } from '../src/Loop';

type Host = {
  LoopConfig?: LoopStageOptions;
  webkit?: { messageHandlers?: { loop?: { postMessage(message: unknown): void } } };
  LoopHost?: { postMessage(json: string): void };
};
const host = window as unknown as Host;

function post(type: string, data: Record<string, unknown> = {}): void {
  const message = { type, ...data };
  host.webkit?.messageHandlers?.loop?.postMessage(message);
  host.LoopHost?.postMessage(JSON.stringify(message));
}

const stage = new LoopStage(null, {
  overlay: true,
  size: 190,
  anchor: 'bottom-right',
  margin: 28,
  ...host.LoopConfig,
});
const loop = stage.loop;

/** Everything the host app can ask Loop to do. */
const methods: Record<string, (...args: any[]) => unknown> = {
  // Base state and reactions
  setState: (state: LoopState) => loop.setState(state),
  setSpeechLevel: (level: number) => loop.setSpeechLevel(level),
  play: (gesture: string) => void loop.play(gesture),
  express: (name: string, seconds?: number) => loop.express(name, seconds),
  setExpression: (name: string) => loop.setExpression(name),
  celebrate: () => void stage.celebrate(),
  quiet: () => loop.quiet(),
  poke: () => loop.poke(),
  // Look and growth
  setSkin: (skin: any) => loop.setSkin(skin),
  equip: (slot: Slot, id: string) => loop.equip(slot, id),
  setLight: (amount: number) => loop.setLight(amount),
  setGlow: (amount: number) => loop.setGlow(amount),
  // Comfort
  setMotion: (level: MotionLevel) => loop.setMotion(level),
  setReducedMotion: (reduced: boolean) => loop.setReducedMotion(reduced),
  setParticles: (amount: number) => stage.setParticles(amount),
  // Placement and visibility
  floatTo: (x: number, y: number) => stage.floatTo(x, y),
  goHome: () => stage.goHome(),
  setAnchor: (anchor: Anchor, margin?: number) => stage.setAnchor(anchor, margin),
  show: () => stage.show(),
  remove: () => stage.remove(),
};

const bridge = {
  call(method: string, args: unknown[] = []): void {
    const fn = methods[method];
    if (!fn) return post('error', { message: `Unknown method "${method}"` });
    try {
      fn(...args);
    } catch (error) {
      post('error', { message: String((error as Error).message ?? error) });
    }
  },
};
Object.assign(window, { LoopBridge: bridge, loop, stage });

loop.on('tap', ({ count }) => post('tap', { count }));
loop.on('grab', () => post('grab'));
loop.on('release', () => post('release'));
loop.on('arrive', () => post('arrive'));
loop.on('celebrate', () => post('celebrate'));
loop.on('gestureend', ({ name }) => post('gestureend', { name }));
loop.on('statechange', ({ state }) => post('statechange', { state }));

// Tell the host where Loop is, so it can let touches everywhere else fall
// through to the app underneath.
let last = '';
function reportRect(): void {
  const r = stage.getScreenRect();
  const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  const key = `${rect.x >> 1},${rect.y >> 1},${rect.width},${rect.height}`;
  if (key !== last) {
    last = key;
    post('rect', rect);
  }
  requestAnimationFrame(reportRect);
}
reportRect();

post('ready');
