# Loop

Loop is the PRSNL companion: a small ghost that reflects the life the user
chooses to build. This repo is the 3D, interactive implementation of the
**Soulform** design, packaged as a module you can drop into an app.

- **Recognisable silhouette** – a swept head with a crest, a visible gap above a
  wearable torso, two unequal trailing ribbons, detached hands, and an open loop
  of light at the chest.
- **Ghost motion** – Loop hovers. It glides with a soft start and a slight
  overshoot, its head and hands follow a beat behind, and its trail never quite
  stops moving.
- **Wearable** – four body materials, tees and a zip vest, chains, eye colours.
- **Layered behaviour** – base state, gesture, expression, look and growth are
  independent, with the interruption rules from the design doc built in.
- **Celebrate** – one call makes Loop dance while confetti fills the screen.
- **iOS ready** – see [ios/README.md](ios/README.md).

Built on [three.js](https://threejs.org) (peer dependency, r162 or newer). Runs in
any browser or web view. The model is generated in code; there are no assets to load.

## Try it

```bash
npm install
npm run dev          # playground at http://localhost:5173
                     # overlay example at /examples/overlay.html
```

## Use it

### As an HTML element

```html
<prsnl-loop skin="pearl" outfit="ink" chain="silver" style="height: 420px"></prsnl-loop>

<script type="module">
  import { defineLoopElement } from '@prsnl/loop';
  defineLoopElement();
  const el = document.querySelector('prsnl-loop');
  el.addEventListener('loop-tap', () => el.loop.play('wave'));
</script>
```

Add `overlay` to float Loop above the whole page; only Loop itself catches
pointer input.

### From JavaScript

```ts
import { LoopStage } from '@prsnl/loop';

const stage = new LoopStage(null, { overlay: true, size: 190 });
const loop = stage.loop;
```

### Inside your own three.js scene

```ts
import { Loop } from '@prsnl/loop';
const loop = new Loop();
scene.add(loop);
loop.update(deltaSeconds); // every frame
```

## App moment → call

| App moment | Call | Note |
|---|---|---|
| App opens / user returns | `stage.show(); loop.play('wave')` | Welcome warmly. Never abandonment language. |
| User types / dictation starts | `loop.setState('listening')` | Drive from the real composer or dictation callbacks. |
| Message sent, waiting | `loop.setState('thinking')` | Tie to the actual pending request, not a guessed delay. |
| Reply appears / speech begins | `loop.setState('speaking')` | Optionally `loop.setSpeechLevel(0…1)` from real audio. |
| Reply or speech ends or is cancelled | `loop.setSpeechLevel(0); loop.setState('idle')` | |
| Save succeeds | `loop.play('nod')` | After the save succeeds, not on the button press. |
| Goal / milestone verified | `stage.celebrate()` | Visual only. It grants nothing. |
| Small win | `loop.express('joy', { seconds: 2 })` | |
| Difficult disclosure | `loop.express('concerned', { seconds: 3 })` | Cancels celebration and confetti; holds the body still. |
| Request / connection failure | `loop.play('shake')` | No progress is deducted. |
| Tap | `loop.onTap = () => openAssistant()` | A tap wakes Loop first, then calls this. |
| Inactivity | automatic | Loop sleeps after 3 idle minutes (`sleepAfter`). Never during a pending conversation state. |
| Equip | `loop.setSkin('glacier'); loop.equip('outfit', 'ocean'); loop.equip('chain', 'silver'); loop.equip('eyes', 'ice'); loop.play('spin')` | |
| Growth | `loop.setLight(90)` | Renders the Soulform stage for the user's cumulative light. |
| Camera / payment / video screen | `stage.remove()` | Hides and stops rendering. `stage.show()` to return. |
| Screen teardown | `stage.destroy()` | Frees everything. A destroyed Loop ignores further calls. |
| Accessibility | `loop.setReducedMotion(true)` | The system Reduce Motion setting is honoured by default. |

## Layering rules

Five independent layers: **base state** (idle, listening, thinking, speaking,
sleeping) · **gesture** (temporary) · **expression** (temporary) · **look**
(skin, outfit, chain, eyes) · **growth** (light).

- A gesture never changes the base state: a nod while listening stays listening.
- A new expression replaces the previous one and its timer.
- `concerned` and `quiet` cancel a running celebration, any queued celebration,
  and confetti, and hold the body still while they show.
- A celebration requested while listening, thinking or speaking waits until
  Loop is idle again. Concern can cancel it.
- Sleeping never touches growth.

## Look

| | Options |
|---|---|
| `setSkin` | `pearl` (frosted, softly luminous) · `smoke` (graphite, cool inner light) · `glacier` (pale blue glass) · `ember` (warm ivory, amber centre) |
| `equip('outfit', …)` | `none` (pure form) · `ink` tee · `ocean` tee · `moss` zip vest |
| `equip('chain', …)` | `none` · `silver` · `gold` |
| `equip('eyes', …)` | `onyx` · `ice` · `amber` |
| `setGlow(0…2)` | Strength of the chest light and body glow |

The silhouette, face, head gap and trail are identical in every combination.

## Growth

`loop.setLight(amount)` shows the user's cumulative light as one of four stages:

| Light | Stage | What changes |
|---|---|---|
| 0–29 | Quiet spark · Soulform 01 | Soft core, quiet outline |
| 30–89 | Finding rhythm · Soulform 02 | Brighter core, light gathers in the trail |
| 90–179 | Inner light · Soulform 03 | An orbiting mote, clearer core glow |
| 180+ | Resonance · Soulform 04 | Stronger rim light |

**Loop only renders.** What earns light must be decided by a trusted service
from reviewed, typed events. A client call to `celebrate()` or `setLight()`
grants nothing. Earned identity is never removed for a rest day, a hard day or
an absence, and Loop has no state that punishes the user: no sickness, no
"you hurt me", no lost items.

## More of the API

| | |
|---|---|
| `play(gesture)` | `wave` · `nod` · `shake` · `spin` · `celebration` (the dance) · `stretch` · `shuffle` · `wiggle` · `tilt` · `startle` |
| `express(name, seconds)` | `neutral` · `joy` · `concerned` · `focused` · `proud` · `quiet` · `happy` · `attentive` · `curious` · `surprised` · `laugh` · `sleepy` · `wink` |
| `quiet()` | Stop celebrating now |
| `moveTo(x, y, z)` / `gazeAt(point)` | Glide to a point / look at a point |
| `setMotion(level)` | `still` · `subtle` · `expressive` |
| `on(event, fn)` | `tap` · `grab` · `release` · `arrive` · `celebrate` · `calm` · `gestureend` · `statechange` |
| `defineExpression` / `defineGesture` | Add your own |

`LoopStage` options: `overlay`, `size`, `anchor`, `margin`, `followPointer`,
`draggable`, `returnHome`, `roam`, `shadow`, `particles` (confetti amount), plus
every `Loop` option (`skin`, `outfit`, `chain`, `eyes`, `light`, `glow`,
`motion`, `sleepAfter`). Stage methods: `celebrate()`, `floatTo(x, y)`,
`floatToElement(el)`, `goHome()`, `setAnchor()`, `show()`, `remove()`, `destroy()`.

## Files

| File | |
|---|---|
| `src/geometry.ts` | Head and crest, torso and ribbons, hands. Proportions live in `DIM`, `TORSO`, `WISP`. |
| `src/wearables.ts` | Tee, vest, chain and the chest light, fitted to the torso. |
| `src/Face.ts` | The face: a 2D canvas laid on the head. Expressions are blendable parameter sets. |
| `src/Loop.ts` | The character: materials, springs, layers, interruption rules. |
| `src/gestures.ts` · `src/skins.ts` · `src/confetti.ts` | Gestures; skins, items and Soulform stages; confetti. |
| `src/LoopStage.ts` · `src/element.ts` | Renderer, layout and pointer input; the `<prsnl-loop>` element. |
| `embed/` → `ios/LoopKit/loop.html` | The page native apps load in a web view. |
| `ios/LoopKit/LoopKit.swift` | Swift wrapper. |
| `assets/loop.glb` | Static model (Pearl, Ink tee, silver chain) for other tools. Motion is not in the file. |

## Not built yet

From the design doc's production slots: headwear, scarves and pendants, hoodies
and jackets, gloves and held objects, core emblems, trail patterns, environments.
The attachment points they need (head, collar, chest, hands, trail) exist in the
rig. The body is opaque with a glow at its edges rather than truly see-through,
which keeps it cheap enough for a phone.
