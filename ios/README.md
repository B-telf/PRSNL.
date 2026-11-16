# Adding Loop to an iOS app

Loop runs inside a transparent web view that sits above your app. You add
**two files** to Xcode and write about five lines of Swift. There is nothing to
install: no packages, no CocoaPods, no network access, no build step.

| File | What it is |
|---|---|
| `ios/LoopKit/LoopKit.swift` | The Swift side: `LoopController` and the `.loopOverlay()` modifier |
| `ios/LoopKit/loop.html` | Loop itself (model, motion, confetti) in one self-contained file |

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

## Step 3 — Tell Loop what to do

From any SwiftUI view:

```swift
struct ChatScreen: View {
    @EnvironmentObject var loop: LoopController

    var body: some View {
        VStack {
            Button("Goal reached") { loop.celebrate() }   // dance + full-screen confetti
            Button("Say hi")       { loop.play("wave") }
        }
    }
}
```

Everything you can call:

| Call | What happens |
|---|---|
| `loop.celebrate()` | Loop dances and confetti fills the screen |
| `loop.setState(.idle)` | Resting. Also `.listening`, `.thinking`, `.speaking`, `.sleeping` |
| `loop.play("wave")` | A gesture: `wave`, `nod`, `shake`, `stretch`, `dance`, `spin`, `shuffle`, `wiggle`, `tilt`, `startle` |
| `loop.express("joy", seconds: 2)` | Flash an expression: `happy`, `joy`, `laugh`, `knowing`, `curious`, `attentive`, `surprised`, `sleepy`, `unimpressed`, `sideEye`, `concerned`, `sad`, `determined`, `wink` |
| `loop.speak(level: 0.6)` | Move the mouth from audio loudness (0…1); call it repeatedly while audio plays |
| `loop.float(to: CGPoint(x: 120, y: 300))` | Glide to a point on screen |
| `loop.goHome()` | Glide back to the resting corner |
| `loop.setAnchor(.bottomLeft)` | Change the resting corner |
| `loop.setSkin("porcelain")` | `deep-teal`, `porcelain`, `graphite` |
| `loop.setEyeColor("amber")` | `warm-white`, `ice-blue`, `amber`, or any colour like `"#ff8a6b"` |
| `loop.setEyeStyle("pixel")` | `oval`, `pixel`, `outline` |
| `loop.setMotion(.subtle)` | `.still`, `.subtle`, `.expressive` |
| `loop.setGlow(1.2)` | Display brightness, 0…2 |
| `loop.setConfetti(0.5)` | Confetti amount, 0 = none |
| `loop.remove()` | Take Loop off screen |

Calls made before Loop has finished loading are queued and run as soon as it is
ready, so you never need to wait.

## Step 4 — React to Loop

```swift
loop.onTap = {
    // the user tapped Loop: open the assistant, show a menu, and so on
}

loop.onEvent = { name, info in
    // "ready", "tap", "grab", "release", "arrive", "celebrate",
    // "gestureend", "statechange", "error"
}
```

`loop.isReady` and `loop.state` are `@Published`, so SwiftUI views can observe them.

## A typical assistant flow

```swift
func send(_ text: String) async {
    loop.setState(.thinking)
    let reply = await assistant.reply(to: text)
    loop.setState(.speaking)
    await show(reply)
    loop.setState(.idle)
}

// while the user is typing or dictating
loop.setState(.listening)

// when the user finishes a goal or a streak
loop.celebrate()
```

## Settings at start-up

```swift
var config = LoopConfiguration()
config.size = 150               // Loop's height in points
config.anchor = .bottomLeft
config.margin = 40              // gap from the screen edges
config.skin = "graphite"
config.eyeColor = "ice-blue"
config.motion = .subtle         // leave unset to follow the device's Reduce Motion setting
config.draggable = true
config.returnsHome = true       // float back to the corner after being carried
config.haptics = true

let loop = LoopController(configuration: config)
```

## Good to know

- **Touches.** Loop lives in its own transparent window above your app. That
  window only accepts touches that land on Loop; everything else goes to your
  app untouched, including during confetti.
- **Sheets and full-screen covers.** Loop stays visible above them. Call
  `loop.remove()` on screens where you do not want it, and
  `loop.install(in:)` (or show the view with `.loopOverlay` again) to bring it back.
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
| Buttons under Loop's corner do not respond | Only Loop's own outline blocks touches. Move it with `config.anchor` / `config.margin` or reduce `config.size` |
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
shape and materials. The floating, jelly motion, expressions, interaction and
confetti are all code in `loop.html`, so the web view route above is the one
that gives you the character as designed.
