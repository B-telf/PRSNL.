import { CHAINS, EYE_COLORS, LoopStage, OUTFITS, SKINS, exportGLB } from '../src/index';
import type { LoopState, MotionLevel } from '../src/index';

const stage = new LoopStage(document.getElementById('stage')!, { roam: true, outfit: 'ink', chain: 'silver' });
const loop = stage.loop;
Object.assign(window, { stage, loop }); // handy in the console

const label = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A row of buttons. Rows given a `selected` value behave like a radio group. */
function buttons(control: string, names: string[], onPick: (name: string) => void, selected?: string, labels?: string[]): void {
  const host = document.querySelector<HTMLElement>(`[data-control="${control}"]`)!;
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = name;
    b.textContent = labels?.[i] ?? label(name);
    if (selected !== undefined) b.setAttribute('aria-pressed', String(name === selected));
    b.addEventListener('click', () => {
      if (selected !== undefined) {
        host.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      }
      onPick(name);
    });
    host.appendChild(b);
  });
}

const showSoulform = () => {
  const { stage: n, name } = loop.soulform;
  document.getElementById('soulform')!.textContent = `0${n} · ${name}`;
};

buttons('state', ['idle', 'listening', 'thinking', 'speaking', 'sleeping'], (s) => loop.setState(s as LoopState), 'idle');
buttons('gesture', loop.gestureNames, (g) => void loop.play(g));
buttons('expression', loop.expressionNames, (e) => loop.express(e, 2.5));
buttons('skin', Object.keys(SKINS), (s) => loop.setSkin(s as keyof typeof SKINS), 'pearl');
buttons('outfit', Object.keys(OUTFITS), (o) => loop.equip('outfit', o), 'ink', ['Pure form', 'Ink tee', 'Ocean tee', 'Moss vest']);
buttons('chain', Object.keys(CHAINS), (c) => loop.equip('chain', c), 'silver');
buttons('eyes', Object.keys(EYE_COLORS), (c) => loop.equip('eyes', c), 'onyx');
buttons('light', ['0', '30', '90', '180'], (l) => { loop.setLight(Number(l)); showSoulform(); }, '0', ['0 light', '30', '90', '180']);
buttons('motion', ['still', 'subtle', 'expressive'], (m) => loop.setMotion(m as MotionLevel), loop.motion);
showSoulform();

document.getElementById('celebrate')!.addEventListener('click', () => void stage.celebrate());

document.querySelector<HTMLInputElement>('#glow')!.addEventListener('input', (e) => {
  loop.setGlow(Number((e.target as HTMLInputElement).value));
});

// Keep the state buttons honest when Loop changes state itself (falling asleep, waking on a tap).
loop.on('statechange', ({ state }) => {
  document.querySelectorAll<HTMLElement>('[data-control="state"] button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.value === state));
  });
});

document.getElementById('download')?.addEventListener('click', async () => {
  const blob = new Blob([await exportGLB(loop)], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'loop.glb';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

setTimeout(() => void loop.play('wave'), 600);
