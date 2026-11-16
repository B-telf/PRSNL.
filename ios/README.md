# Adding Loop to an iOS app

Loop runs inside a transparent web view that sits above your app. You add
**two files** to Xcode and write about five lines of Swift. There is nothing to
install: no packages, no CocoaPods, no network access, no build step.

| File | What it is |
|---|---|
| `ios/LoopKit/LoopKit.swift` | The Swift side: `LoopController` and the `.loopOverlay()` modifier |
| `ios/LoopKit/loop.html` | Loop itself (the Soulform model, motion, wearables, confetti) in one self-contained file |

Requirements: iOS 15 or later, Xcode 15 or later. Works with SwiftUI and UIKit.

> **Status:** the web side (`loop.html` and its bridge) is tested. `LoopKit.swift`
> was written without access to Xcode, so it has not been compiled or run on a
> device yet. If Xcode reports an error, the message and line number are enough
> to fix it quickly.

---

## Step 1 — Add the files to Xcode

1. Open your app's project in Xcode.
2. In Finder, find the `ios/LoopKit` folder (it holds `LoopKit.swift` and `loop.html`).
3. Drag the **LoopKit folder** into Xcode's Project navigator (the file list on
   the left), onto your app's main group.
4. In the dialog that appears, set:
   - **Copy items if needed** (older Xcode) or **Action: Copy files to destination** (newer Xcode): on
   - **Create groups**: selected
   - **Add to targets**: your app target ticked
5. Click **Finish**.

**Check it worked.** Click your project at the top of the navigator, choose your
app target, then open **Build Phases**:

- **Compile Sources** lists `LoopKit.swift`
- **Copy Bundle Resources** lists `loop.html`

If `loop.html` is missing from Copy Bundle Resources, click **+** there and add
it. This is the most common reason Loop does not appear.

## Step 2 — Show Loop

### SwiftUI

Create one `LoopController` and attach it once, near the top of your app.

```swift
import SwiftUI

@main
struct MyApp: App {
    @StateObject private var loop = LoopController()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .loopOverlay(loop)          // shows Loop above everything
                .environmentObject(loop)    // lets any screen talk to Loop
        }
    }
}
```

Run the app. Loop appears in the bottom-right corner, floating above your UI.
You can tap it and drag it; everything else on screen works as before.
To start with an outfit, pass a `LoopConfiguration` (see "Settings at start-up").

### UIKit

```swift
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    let loop = LoopController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // ... your existing window setup ...
        loop.install(in: windowScene)
    }
}
```

## Step 3 — Wire Loop to app moments

Reach the controller from any SwiftUI view with
`@EnvironmentObject var loop: LoopController`, then call it where these moments
happen in the app:

| App moment | Call | Note |
|---|---|---|
| App opens / user returns | `loop.show(); loop.play("wave")` | Welcome warmly. Never abandonment language. |
| User types / dictation starts | `loop.setState(.listening)` | Drive from the real composer or dictation callbacks. |
| Message sent, waiting | `loop.setState(.thinking)` | Tie to the actual pending request, not a guessed delay. |
| Reply appears / speech begins | `loop.setState(.speaking)` | Optionally `loop.setSpeechLevel(0...1)` from real audio. |
| Reply or speech ends or is cancelled | `loop.setSpeechLevel(0); loop.setState(.idle)` | Also on cancel, so the face never stays speaking. |
| Save succeeds | `loop.play("nod")` | After the save succeeds, not on the button press. |
| Goal / milestone verified | `loop.celebrate()` | Dance and full-screen confetti. Visual only; it grants nothing. |
| Small win | `loop.express("joy", seconds: 2)` | |
| Difficult disclosure | `loop.express("concerned", seconds: 3)` | Cancels celebration and confetti; holds the body still. |
| Request / connection failure | `loop.play("shake")` | No progress is deducted. |
| User taps Loop | `loop.onTap = { openAssistant() }` | A tap wakes Loop first, then calls this. |
| Inactivity | automatic | Sleeps after 3 idle minutes (`config.sleepAfter`). Never during listening, thinking or speaking. |
| Equip | `loop.setSkin("glacier"); loop.equip("outfit", "ocean"); loop.equip("chain", "silver"); loop.equip("eyes", "ice"); loop.play("spin")` | |
| Growth | `loop.setLight(90)` | Shows the Soulform stage for the user's cumulative light. |
| Camera / payment / video screen | `loop.remove()` | Hides and stops rendering. `loop.show()` to return. |
| Tear down for good | `loop.destroy()` | Releases the window. |
| Accessibility toggle | `loop.setReducedMotion(true)` | The system Reduce Motion setting is followed by default. |

Calls made before Loop has finished loading are queued and run as soon as it is
ready, so you never need to wait.

### Rules Loop enforces for you

- A gesture never changes the base state: a nod while listening stays listening.
- `express("concerned")` and `express("quiet")` cancel a running or queued
  celebration and clear confetti.
- `celebrate()` during listening, thinking or speaking waits until Loop is idle.
- A new expression replaces the previous one and its timer.

### Rules the app must enforce

- **Loop renders; it does not decide.** `celebrate()` and `setLight()` are
  display calls. Whether something counts as a milestone, and how much light
  the user has, must come from the server's reviewed rules, never from the
  client or from AI reading free text.
- **Missed goals and absence are not failures.** Do not send a negative
  reaction because data is missing. Only an explicit, confirmed miss gets
  `express("concerned")`, followed by a concrete offer to reset.
- **Sensitive rooms stay private** (alcohol, cannabis, nicotine, gambling,
  weight, faith and giving, shopping). React to a reflection, a chosen boundary
  or a protective step, never to volume, dose, spend or the scale. Nothing from
  these rooms should show in a shared skin, badge or animation.
- **Never put private content in a Loop call.** Loop needs only the event type.

### Everything you can call

| Call | What happens |
|---|---|
| `loop.setState(.idle)` | Also `.listening`, `.thinking`, `.speaking`, `.sleeping` |
| `loop.setSpeechLevel(0.6)` | Mouth follows audio loudness while speaking |
| `loop.celebrate()` | Dance and confetti |
| `loop.play("wave")` | `wave`, `nod`, `shake`, `spin`, `celebration`, `stretch`, `shuffle`, `wiggle`, `tilt`, `startle` |
| `loop.express("joy", seconds: 2)` | `neutral`, `joy`, `concerned`, `focused`, `proud`, `quiet`, `happy`, `attentive`, `curious`, `surprised`, `laugh`, `sleepy`, `wink` |
| `loop.quiet()` | Stop celebrating now |
| `loop.setSkin("pearl")` | `pearl`, `smoke`, `glacier`, `ember` |
| `loop.equip("outfit", "ink")` | `none`, `ink`, `ocean`, `moss` |
| `loop.equip("chain", "silver")` | `none`, `silver`, `gold` |
| `loop.equip("eyes", "onyx")` | `onyx`, `ice`, `amber` |
| `loop.setLight(90)` | Soulform stage: 0, 30, 90, 180 are the thresholds |
| `loop.setGlow(1.2)` | Chest light and body glow, 0…2 |
| `loop.setMotion(.subtle)` | `.still`, `.subtle`, `.expressive` |
| `loop.setReducedMotion(true)` | Still when on |
| `loop.setConfetti(0.5)` | Confetti amount, 0 = none |
| `loop.float(to: point)` / `loop.goHome()` | Glide to a screen point / back to the corner |
| `loop.setAnchor(.bottomLeft)` | Change the resting corner |
| `loop.remove()` / `loop.show()` | Hide / bring back |
| `loop.destroy()` | Tear down |

## Step 4 — React to Loop

```swift
loop.onTap = {
    // the user tapped Loop: open the assistant
}

loop.onEvent = { name, info in
    // "ready", "tap", "grab", "release", "arrive", "celebrate", "calm",
    // "gestureend", "statechange", "error"
}
```

`loop.isReady` and `loop.state` are `@Published`, so SwiftUI views can observe them.

## A typical assistant flow

```swift
func send(_ text: String) async {
    loop.setState(.thinking)
    do {
        let reply = try await assistant.reply(to: text)
        loop.setState(.speaking)
        await show(reply)
    } catch {
        loop.play("shake")
    }
    loop.setState(.idle)          // always, including after errors and cancels
}
```

## Settings at start-up

```swift
var config = LoopConfiguration()
config.size = 190               // Loop's height in points
config.anchor = .bottomRight
config.margin = 40              // gap from the screen edges
config.skin = "pearl"
config.outfit = "ink"
config.chain = "silver"
config.eyes = "onyx"
config.light = 0                // the user's cumulative light, from your server
config.sleepAfter = 180         // seconds of idle before sleeping; 0 = never
config.returnsHome = true       // float back to the corner after being carried

let loop = LoopController(configuration: config)
```

Restore the user's saved look by setting these from your stored values before
creating the controller.

## Good to know

- **Touches.** Loop lives in its own transparent window above your app. That
  window only accepts touches that land on Loop; everything else goes to your
  app untouched, including during confetti.
- **Sheets and full-screen covers.** Loop stays visible above them. Call
  `loop.remove()` on screens where you do not want it and `loop.show()` to bring it back.
- **Accessibility.** Unless you set `config.motion`, Loop follows the device: with
  Reduce Motion turned on it starts in its still mode and celebrations use far
  less confetti.
- **Offline and privacy.** `loop.html` is loaded from your app bundle. It makes
  no network requests and needs no permissions or Info.plist changes.
- **App size.** The two files add about 0.6 MB.
- **Battery.** Loop renders continuously while visible. Call `loop.remove()`
  on screens where it is not needed.

## If something is wrong

| What you see | Fix |
|---|---|
| Loop never appears, and the debug build stops with "loop.html is missing from the app bundle" | Add `loop.html` to **Build Phases → Copy Bundle Resources** (Step 1) |
| Loop never appears, no error | Make sure `.loopOverlay(loop)` is on a view that is actually on screen, and that `loop` is a `@StateObject` (not recreated on every redraw) |
| A black or white rectangle covers the screen | The web view was made opaque somewhere; `LoopKit.swift` sets it clear, so check nothing else changes it |
| Buttons under Loop's corner do not respond | Only Loop's own outline blocks touches. Move it with `config.anchor` / `config.margin`, reduce `config.size`, or call `loop.remove()` on that screen |
| Loop sits on the home indicator | Raise `config.margin` |
| Slow or choppy in the Simulator | Expected: the Simulator renders 3D slowly. Test on a real device |
| Xcode: "Cannot find 'LoopController' in scope" | `LoopKit.swift` is not in the app target. Select the file and tick your app under **Target Membership** |

To watch Loop's console while debugging: run the app, open **Safari → Develop →
[your device] → loop.html**. (Enable the Develop menu in Safari's Advanced
settings; on iOS 16.4+ also set `webView.isInspectable = true` in `LoopKit.swift`.)

## Changing Loop itself

`loop.html` is generated from the TypeScript in `src/`. After changing anything
there, rebuild the file and replace the copy in Xcode:

```bash
npm install
npm run build:ios      # rewrites ios/LoopKit/loop.html
```

## Alternative: the static model

`assets/loop.glb` is the 3D model on its own. You can convert it to USDZ (Reality
Converter) and show it with SceneKit or RealityKit, but the file holds only the
shape and materials. The floating motion, expressions, wearables, interaction and
confetti are all code in `loop.html`, so the web view route above is the one
that gives you the character as designed.
