# Loop

Loop is the PRSNL companion character: the "Streamlined" design from the
customization catalog, built as an interactive 3D module you can drop into an app.

- **Procedural model** – tall capsule body, inset dark display, two warm eyes and a
  small mouth, flipper arms, low feet. No external assets to load.
- **Ghost-like motion** – Loop hovers rather than walks. It glides with a soft start
  and a slight overshoot, leans into travel, and its base and feet trail behind and
  wobble to rest.
- **Interactive** – eyes and head follow the pointer, tapping squishes it, it can be
  picked up and carried, and it can float to any point or DOM element.
- **App states** – `idle`, `listening`, `thinking`, `speaking`, `sleeping`, plus
  17 expressions and 10 gestures.
- **Static model file** – `assets/loop.glb` for other engines and tools.

Built on [three.js](https://threejs.org) (peer dependency, r162 or newer). Runs in
any browser or webview.

## Try it

```bash
npm install
npm run dev          # playground at http://localhost:5173
                     # overlay example at /examples/overlay.html
```

## Use it

### 1. As an HTML element (any framework)

```html
<prsnl-loop skin="deep-teal" eyes="warm-white" style="height: 360px"></prsnl-loop>

<script type="module">
  import { defineLoopElement } from '@prsnl/loop';
  defineLoopElement();

  const el = document.querySelector('prsnl-loop');
  el.addEventListener('loop-tap', () => el.loop.play('wave'));
</script>
```

Add `overlay` to float Loop above the whole page instead of inside a box. Only
Loop itself catches pointer input; everything underneath stays clickable.

```html
<prsnl-loop overlay size="170" anchor="bottom-right"></prsnl-loop>
```

Attributes: `skin`, `eyes`, `eye-style`, `motion`, `state`, `glow`, `anchor`,
`size`, `margin`, `overlay`, `draggable`, `follow-pointer`, `roam`, `shadow`,
`return-home`. Events: `loop-ready`, `loop-tap`, `loop-grab`, `loop-release`,
`loop-arrive`.

### 2. From JavaScript

```ts
import { LoopStage } from '@prsnl/loop';

const stage = new LoopStage(document.querySelector('#loop'), { roam: true });
const loop = stage.loop;

loop.setState('listening');            // user is typing or talking
loop.setState('thinking');             // waiting on a response
loop.setState('speaking');             // response is streaming / playing
loop.speak(audioLevel);                // optional: drive the mouth from 0…1 loudness
loop.setState('idle');

await loop.play('nod');                // gestures return a promise
loop.express('joy', 2);                // flash an expression for 2 s

stage.floatToElement(messageBubble);   // glide over next to a DOM element
stage.goHome();
```

### 3. Inside your own three.js scene

```ts
import { Loop } from '@prsnl/loop';

const loop = new Loop();
scene.add(loop);
// each frame:
loop.update(deltaSeconds);
```

`Loop` is a `THREE.Group` whose origin is the ground point beneath it. You handle
rendering and input; call `loop.gazeAt(worldPoint)`, `loop.moveTo(x, y, z)`,
`loop.poke()`, `loop.grab()` / `loop.release()` as needed.

### React

```tsx
function LoopView({ state }: { state: LoopState }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<LoopStage>();
  useEffect(() => {
    stage.current = new LoopStage(host.current!);
    return () => stage.current!.dispose();
  }, []);
  useEffect(() => { stage.current?.loop.setState(state); }, [state]);
  return <div ref={host} style={{ height: 360 }} />;
}
```

In React Native, Flutter or a native shell, host the page in a WebView, or load
`assets/loop.glb` into the platform's own 3D view (see below).

## API

### `Loop`

| | |
|---|---|
| `setState(state)` | `idle` · `listening` · `thinking` · `speaking` · `sleeping` |
| `play(gesture)` | `wave` · `nod` · `shake` · `stretch` · `celebrate` · `spin` · `shuffle` · `wiggle` · `tilt` · `startle` |
| `setExpression(name)` / `express(name, seconds)` | `neutral` · `happy` · `joy` · `laugh` · `knowing` · `curious` · `attentive` · `thinking` · `surprised` · `sleepy` · `asleep` · `unimpressed` · `sideEye` · `concerned` · `sad` · `determined` · `wink` |
| `speak(level?)` | Mouth movement; pass loudness per frame or omit for automatic |
| `moveTo(x, y, z)` / `teleport(x, y, z)` | Glide to, or jump to, a point |
| `gazeAt(point \| null)` | Look at a world point, or look around freely |
| `poke()` / `grab()` / `release()` | Touch reactions |
| `setSkin(name \| Skin)` | `deep-teal` · `porcelain` · `graphite`, or your own material values |
| `setEyeColor(color, right?)` | `warm-white` · `ice-blue` · `amber`, or any CSS colour; optional second colour for the other eye |
| `setEyeStyle(style)` | `oval` · `pixel` · `outline` |
| `setMotion(level)` | `still` · `subtle` · `expressive` (defaults to `still` when the device asks for reduced motion) |
| `setGlow(0…2)` | Display brightness |
| `defineExpression(name, params)` / `defineGesture(name, gesture)` | Add your own |
| `on(event, fn)` | `tap` · `grab` · `release` · `arrive` · `gestureend` · `statechange` |

### `LoopStage`

Creates the renderer, camera, lighting and pointer handling.

| Option | Default | |
|---|---|---|
| `overlay` | `false` | Full-viewport layer above the page |
| `size` | fit | Loop's height in CSS px |
| `anchor` | `bottom-center` | Resting spot: `center`, `bottom-center`, `bottom-left`, `bottom-right` |
| `followPointer` | `true` | Eyes and head track the pointer |
| `draggable` | `true` | Pick up and carry |
| `returnHome` | `true` (contained) | Float back to the anchor after a drag |
| `roam` | `false` | Tap empty space to send Loop there |
| `shadow` | `true` | Ground shadow |

Methods: `floatTo(clientX, clientY)`, `floatToElement(el, side)`, `goHome()`,
`setAnchor(anchor)`, `start()`, `stop()`, `dispose()`.

## The model file

`assets/loop.glb` is the static model in its rest pose (≈73k triangles, six meshes:
`Body`, `Display`, `ArmL`, `ArmR`, `FootL`, `FootR`), about 2 units tall, facing +Z,
with the body's base at the origin. The face is baked into the display's emissive
texture. The hover, trailing and expressions are done in code by this library, so
they are not in the file. To re-export after changing the look, use
**Download loop.glb** in the playground or call `exportGLB(loop)`.

## How it is put together

| File | |
|---|---|
| `src/geometry.ts` | Body profile, face opening, display, limbs. Proportions live in `SHAPE`. |
| `src/Face.ts` | The display: a 2D canvas used as an emissive texture. Expressions are parameter sets that blend. |
| `src/Loop.ts` | The character: materials, springs, hover, trailing bend, states, gestures. |
| `src/gestures.ts` | Gesture definitions. |
| `src/skins.ts` | Shell finishes and eye colours. |
| `src/LoopStage.ts` | Renderer, lighting, layout and pointer interaction. |
| `src/element.ts` | The `<prsnl-loop>` custom element. |

## Catalog coverage

Implemented from the customization catalog: the Streamlined base; Common skins
(Porcelain, Graphite, Deep Teal); Common eye colours (Warm White, Ice Blue, Amber);
Pixel Eyes, Ink Outline and Split Accent; the Still / Subtle / Expressive motion
setting and glow control; Small Wave, Satisfied Nod, Pocket Stretch, Hover & Settle,
Victory Shuffle; Knowing Smile, Curious Tilt, Sleepy Blink, Side-Eye, Unimpressed;
Soft Shadow.

Not built yet: headwear, wearables, held items, spaces, decor, app themes, sounds
and the higher-tier animated skins and effects.
