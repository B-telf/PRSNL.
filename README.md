# Loop

Loop is the PRSNL companion: a small ghost that reflects the life the user
chooses to build. This repo is the 3D, interactive implementation of the
**Soulform** design, packaged as a module you can drop into an app.

- **Recognisable silhouette** – a swept head with a crest, a visible gap above a
  wearable torso, two unequal trailing ribbons, detached hands, and an open loop
  of light at the chest.
- **Living motion** – intention at its centre, softness through its body,
  flowing motion at its edges. Only the head and upper torso are steered; the
  lower torso, each section of each wisp, each hand, the shirt's hem, the chain
  and the inner light all follow separately. See [How Loop moves](#how-loop-moves).
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
                     # motion preview at /preview/
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
| Goal / milestone verified | `stage.celebrate()` | One buoyant flourish. Visual only; it grants nothing. |
| Small win | `loop.express('joy', { seconds: 2 })` | The inner light brightens, Loop lifts a little, the wisps open. |
| Difficult disclosure | `loop.express('concerned', { seconds: 3 })` | Cancels celebration and confetti; holds the body still. |
| Request / connection failure | `loop.play('shake')` | No progress is deducted. |
| Tap | `loop.onTap = () => openAssistant()` | A tap wakes Loop first, then calls this. |
| Inactivity | automatic | Loop sleeps after 3 idle minutes (`sleepAfter`). Never during a pending conversation state. |
| Equip | `loop.setSkin('glacier'); loop.equip('outfit', 'ocean'); loop.equip('chain', 'silver'); loop.equip('eyes', 'ice'); loop.play('spin')` | A smooth turn through a three-quarter view and back. |
| Growth | `loop.setLight(90)` | Renders the Soulform stage for the user's cumulative light. |
| Camera / payment / video screen | `stage.remove()` | Hides and stops rendering. `stage.show()` to return. |
| Screen teardown | `stage.destroy()` | Frees everything. A destroyed Loop ignores further calls. |
| Accessibility | `loop.setReducedMotion(true)` | The system Reduce Motion setting is honoured by default. |

## How Loop moves

Nothing moves as one rigid piece. The parts form a chain of followers:

| Part | How it moves |
|---|---|
| Eyes | Go first: they look where Loop is about to travel, or where it is being carried. |
| Head and upper torso | Loop's centre. The only parts that travel, dragging, states and gestures steer directly. The head moves least, so the face always reads. |
| Lower torso | Follows the centre, about 80 ms behind a change of direction. |
| Long ribbon, short wisp | Five and six flexible sections each, simulated separately. They trail in travel, carry on the old way for about a quarter of a second after a reversal, then curl round. At rest they keep curling and relaxing. |
| Each hand | Floats to its own place beside the body about 100 ms late, and drifts independently while idle. Never further than arm's reach. |
| Shirt | Anchored at the shoulders; the hem and sleeve openings swing after a movement and settle. |
| Chain | Anchored at the collar; the hanging links sway a little longer than the shirt, then settle. |
| Inner light | Seated on the chest with a slight lag, breathing on its own rhythm; brightens with joy and dims with concern. |

The trailing parts are spring simulations, not delayed copies, so the same
motion appears whether Loop is carried, travels by itself or plays a gesture.

**Idle.** A slow wandering float built from rhythms that never line up
(5.2 s and 3.3 s vertically, 6.6 s and 4.1 s sideways), within ±1.5% of Loop's
height vertically and ±1% sideways, with 1–2° of body and head tilt.

**Dragging.** The grabbed point closes half the gap to the finger in the first
frame. On release Loop glides briefly on a little of its momentum and settles
where it stopped, with no overshoot. It never returns anywhere by itself;
`returnHome: true` adds a separate, gentle journey back to the anchor a moment
later, and `stage.goHome()` does the same on request.

**States** blend over about a third of a second: listening leans closer and
quietens the drift; thinking lifts the gaze, then tilts the head; speaking keeps
the head steady with small hand movement; concern slows everything and draws the
hands in; sleeping lowers the head and lengthens the rhythm.

Measured on the current build (finger moving at 2 units/s):

| | Measured |
|---|---|
| Hands behind the centre | ~105 ms |
| Wisp tips behind the centre | ~220–240 ms |
| Wisps carry on after a reversal | ~250–280 ms |
| Release: glide, then settled | ~230 ms, ~450 ms, 0.3% overshoot |
| Idle float | ±1.5% vertical, ±1.0% sideways, 1.3° body tilt, 1.7° head tilt |

To tune: chain stiffness, follow-through and bend limits are the `freq`,
`damping` and `maxBend` lists in `src/Loop.ts`; hand, hem and chain springs sit
just below them; idle rhythms are in `Loop.update`. `loop.setSilhouette(true)`
draws Loop as a flat shape with no face or light, to judge movement alone.

## Layering rules

Five independent layers: **base state** (idle, listening, thinking, speaking,
sleeping) · **gesture** (temporary) · **expression** (temporary) · **look**
(skin, outfit, chain, eyes) · **growth** (light).

- A gesture never changes the base state: a nod while listening stays listening.
- Gestures steer only Loop's centre and hands. The rest of the body is never
  posed; it follows through.
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
| `play(gesture)` | `wave` · `nod` · `shake` · `lift` (small win) · `flourish` (milestone; also `celebration`) · `turn` (new outfit; also `spin`) · `stretch` · `wiggle` · `tilt` · `startle` |
| `express(name, seconds)` | `neutral` · `joy` · `concerned` · `focused` · `proud` · `quiet` · `happy` · `attentive` · `curious` · `surprised` · `laugh` · `sleepy` · `wink` |
| `quiet()` | Stop celebrating now |
| `moveTo(x, y, z, pace?)` / `gazeAt(point)` | Float to a point (`'gentle'` for an unhurried journey) / look at a point |
| `setSilhouette(on)` | Review aid: flat shape, no face or light |
| `setMotion(level)` | `still` · `subtle` · `expressive` |
| `on(event, fn)` | `tap` · `grab` · `release` · `arrive` · `celebrate` · `calm` · `gestureend` · `statechange` |
| `defineExpression` / `defineGesture` | Add your own |

`LoopStage` options: `overlay`, `size`, `fill`, `anchor`, `margin`, `followPointer`,
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
| `src/softbody.ts` | The follow-through simulation and the shader that bends meshes with it. |
| `src/Loop.ts` | The character: materials, lead-and-follow motion, layers, interruption rules. |
| `src/gestures.ts` · `src/skins.ts` · `src/confetti.ts` | Gestures; skins, items and Soulform stages; confetti. |
| `src/LoopStage.ts` · `src/element.ts` | Renderer, layout and pointer input; the `<prsnl-loop>` element. |
| `preview/` | The motion-pass preview: one sequence at playground and chat size. |
| `embed/` → `ios/LoopKit/loop.html` | The page native apps load in a web view. |
| `ios/LoopKit/LoopKit.swift` | Swift wrapper. |
| `assets/loop.glb` | Static model (Pearl, Ink tee, silver chain) for other tools. Motion is not in the file. |

## Not built yet

From the design doc's production slots: headwear, scarves and pendants, hoodies
and jackets, gloves and held objects, core emblems, trail patterns, environments.
The attachment points they need (head, collar, chest, hands, trail) exist in the
rig. The body is opaque with a glow at its edges rather than truly see-through,
which keeps it cheap enough for a phone.
