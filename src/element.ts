import { LoopStage, type Anchor } from './LoopStage';
import type { LoopState, MotionLevel } from './Loop';
import type { EyeStyle } from './Face';

/**
 * `<prsnl-loop>` — Loop as a custom element, usable from any framework.
 *
 *   <prsnl-loop skin="deep-teal" eyes="warm-white" motion="expressive"></prsnl-loop>
 *   <prsnl-loop overlay size="180" anchor="bottom-right"></prsnl-loop>
 *
 * Read `.loop` for the character API and `.stage` for placement. Fires
 * `loop-ready`, `loop-tap`, `loop-grab`, `loop-release`, `loop-arrive`, `loop-celebrate`.
 */
export class PrsnlLoopElement extends HTMLElement {
  static observedAttributes = ['skin', 'eyes', 'eye-style', 'motion', 'state', 'glow', 'anchor'];
  stage: LoopStage | null = null;

  get loop() {
    return this.stage?.loop ?? null;
  }

  /** Loop dances while confetti fills the screen. */
  celebrate(): Promise<void> {
    return this.stage ? this.stage.celebrate() : Promise.resolve();
  }

  connectedCallback(): void {
    if (this.stage) return;
    const overlay = this.hasAttribute('overlay');
    if (!overlay) {
      if (getComputedStyle(this).display === 'inline') this.style.display = 'block';
      if (!this.clientHeight) this.style.height = this.style.height || '320px';
    } else {
      this.style.display = 'contents';
    }
    const num = (name: string) => (this.hasAttribute(name) ? Number(this.getAttribute(name)) : undefined);
    const flag = (name: string, fallback: boolean) =>
      this.hasAttribute(name) ? this.getAttribute(name) !== 'false' : fallback;
    this.stage = new LoopStage(overlay ? null : this, {
      overlay,
      size: num('size'),
      margin: num('margin'),
      anchor: (this.getAttribute('anchor') as Anchor) ?? undefined,
      skin: (this.getAttribute('skin') as any) ?? undefined,
      eyeColor: this.getAttribute('eyes') ?? undefined,
      eyeStyle: (this.getAttribute('eye-style') as EyeStyle) ?? undefined,
      motion: (this.getAttribute('motion') as MotionLevel) ?? undefined,
      glow: num('glow'),
      draggable: flag('draggable', true),
      followPointer: flag('follow-pointer', true),
      roam: flag('roam', false),
      shadow: flag('shadow', true),
      returnHome: this.hasAttribute('return-home') ? flag('return-home', true) : undefined,
    });
    const loop = this.stage.loop;
    const state = this.getAttribute('state');
    if (state) loop.setState(state as LoopState);
    for (const type of ['tap', 'grab', 'release', 'arrive', 'celebrate'] as const) {
      loop.on(type, (detail) => this.dispatchEvent(new CustomEvent(`loop-${type}`, { detail, bubbles: true })));
    }
    this.dispatchEvent(new CustomEvent('loop-ready', { detail: { loop, stage: this.stage }, bubbles: true }));
  }

  disconnectedCallback(): void {
    this.stage?.dispose();
    this.stage = null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    const loop = this.loop;
    if (!loop || value === null) return;
    if (name === 'skin') loop.setSkin(value as any);
    else if (name === 'eyes') loop.setEyeColor(value);
    else if (name === 'eye-style') loop.setEyeStyle(value as EyeStyle);
    else if (name === 'motion') loop.setMotion(value as MotionLevel);
    else if (name === 'state') loop.setState(value as LoopState);
    else if (name === 'glow') loop.setGlow(Number(value));
    else if (name === 'anchor') this.stage!.setAnchor(value as Anchor);
  }
}

/** Register `<prsnl-loop>` (safe to call more than once). */
export function defineLoopElement(tag = 'prsnl-loop'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, PrsnlLoopElement);
  }
}
