import { EYE_COLORS, LoopStage, SKINS, exportGLB } from '../src/index';
import type { EyeStyle, LoopState, MotionLevel } from '../src/index';

const stage = new LoopStage(document.getElementById('stage')!, { roam: true });
const loop = stage.loop;
Object.assign(window, { stage, loop }); // handy in the console

const label = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A row of buttons. `exclusive` rows behave like a radio group. */
function buttons(control: string, names: string[], onPick: (name: string) => void, selected?: string): void {
  const host = document.querySelector<HTMLElement>(`[data-control="${control}"]`)!;
  for (const name of names) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label(name);
    if (selected !== undefined) b.setAttribute('aria-pressed', String(name === selected));
    b.addEventListener('click', () => {
      if (selected !== undefined) {
        host.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      }
      onPick(name);
    });
    host.appendChild(b);
  }
}

buttons('state', ['idle', 'listening', 'thinking', 'speaking', 'sleeping'], (s) => loop.setState(s as LoopState), 'idle');
buttons('gesture', loop.gestureNames, (g) => void loop.play(g));
buttons('expression', loop.expressionNames, (e) => loop.express(e, 2.5));
buttons('skin', Object.keys(SKINS), (s) => loop.setSkin(s as keyof typeof SKINS), 'deep-teal');
buttons('eyes', Object.keys(EYE_COLORS), (c) => loop.setEyeColor(c), 'warm-white');
buttons('eyeStyle', ['oval', 'pixel', 'outline'], (s) => loop.setEyeStyle(s as EyeStyle), 'oval');
buttons('motion', ['still', 'subtle', 'expressive'], (m) => loop.setMotion(m as MotionLevel), loop.motion);

document.querySelector<HTMLInputElement>('#glow')!.addEventListener('input', (e) => {
  loop.setGlow(Number((e.target as HTMLInputElement).value));
});

// Keep the state buttons honest when Loop changes state itself (e.g. woken by a tap).
loop.on('statechange', ({ state }) => {
  document.querySelectorAll('[data-control="state"] button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.textContent!.toLowerCase() === state));
  });
});

document.getElementById('download')!.addEventListener('click', async () => {
  const blob = new Blob([await exportGLB(loop)], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'loop.glb';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

setTimeout(() => void loop.play('wave'), 600);
