//
//  LoopKit.swift
//  Loop, the PRSNL companion, for iOS.
//
//  Add this file and `loop.html` to your app target. See ios/README.md.
//  Requires iOS 15 or later. No third-party dependencies.
//

import SwiftUI
import UIKit
import WebKit

// MARK: - Options

/// What Loop is doing for the user right now.
public enum LoopState: String {
    case idle, listening, thinking, speaking, sleeping
}

/// Where Loop rests on screen.
public enum LoopAnchor: String {
    case center
    case bottomCenter = "bottom-center"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"
}

/// How much Loop moves on its own.
public enum LoopMotion: String {
    case still, subtle, expressive
}

/// Start-up settings. Change them later through `LoopController`.
public struct LoopConfiguration {
    /// Loop's height in points.
    public var size: CGFloat = 190
    public var anchor: LoopAnchor = .bottomRight
    /// Gap from the screen edges, in points. Leave room for the home indicator.
    public var margin: CGFloat = 40
    /// Body material: "pearl", "smoke", "glacier" or "ember".
    public var skin: String = "pearl"
    /// Upper layer: "none", "ink", "ocean" or "moss".
    public var outfit: String = "none"
    /// "none", "silver" or "gold".
    public var chain: String = "none"
    /// "onyx", "ice" or "amber".
    public var eyes: String = "onyx"
    /// The user's cumulative light; sets the Soulform stage (0, 30, 90, 180).
    public var light: Double = 0
    /// Leave nil to follow the device: expressive, or still when Reduce Motion is on.
    public var motion: LoopMotion?
    /// The user can pick Loop up and carry it.
    public var draggable = true
    /// Off: Loop stays where it is let go. On: a moment later it drifts gently back to its anchor.
    public var returnsHome = false
    /// Seconds of idle before Loop falls asleep (0 = never).
    public var sleepAfter: Double = 180
    /// Play a light haptic when Loop is tapped.
    public var haptics = true

    public init() {}
}

// MARK: - Controller

/// Owns Loop and is how your app talks to it.
///
///     @StateObject private var loop = LoopController()
///     ...
///     loop.setState(.listening)
///     loop.celebrate()
@MainActor
public final class LoopController: NSObject, ObservableObject {
    /// True once Loop has loaded and is on screen.
    @Published public private(set) var isReady = false
    /// Mirrors Loop's current state (it can change by itself, e.g. waking when tapped).
    @Published public private(set) var state: LoopState = .idle

    /// Called when the user taps Loop.
    public var onTap: (() -> Void)?
    /// Called for every event: "ready", "tap", "grab", "release", "arrive",
    /// "celebrate", "gestureend", "statechange", "error".
    public var onEvent: ((_ name: String, _ info: [String: Any]) -> Void)?

    public let configuration: LoopConfiguration
    private var pending: [String] = []
    private var storedWebView: LoopWebView?
    private var overlayWindow: LoopWindow?

    public init(configuration: LoopConfiguration = LoopConfiguration()) {
        self.configuration = configuration
        super.init()
    }

    // MARK: Base state

    /// What Loop is doing: `.idle`, `.listening`, `.thinking`, `.speaking`, `.sleeping`.
    /// Gestures and expressions in progress are left alone.
    public func setState(_ state: LoopState) { call("setState", state.rawValue) }

    /// Drive the mouth from real audio loudness, 0...1, while speaking. Send 0 when playback ends.
    public func setSpeechLevel(_ level: Double) { call("setSpeechLevel", level) }

    // MARK: Reactions

    /// A verified milestone: one buoyant flourish, and confetti fills the screen. If Loop
    /// is listening, thinking or speaking, it waits until idle. Visual only.
    public func celebrate() {
        if configuration.haptics { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        call("celebrate")
    }

    /// "wave", "nod", "shake", "lift" (small win), "celebration" (milestone
    /// flourish), "spin" (three-quarter turn for a new outfit), "stretch",
    /// "wiggle", "tilt", "startle". Plays on top of the current state.
    public func play(_ gesture: String) { call("play", gesture) }

    /// Flash an expression, then return to the resting one: "neutral", "joy",
    /// "concerned", "focused", "proud", "quiet", "happy", "attentive",
    /// "curious", "surprised", "laugh", "sleepy", "wink".
    /// "concerned" and "quiet" also cancel any celebration and confetti.
    public func express(_ name: String, seconds: Double = 1.6) { call("express", name, seconds) }

    /// Stop celebrating right now (cancels the dance, queued celebrations and confetti).
    public func quiet() { call("quiet") }

    // MARK: Look and growth

    /// Body material: "pearl", "smoke", "glacier", "ember".
    public func setSkin(_ skin: String) { call("setSkin", skin) }

    /// Put something on. Slots and items:
    /// "outfit": "none", "ink", "ocean", "moss" · "chain": "none", "silver", "gold" ·
    /// "eyes": "onyx", "ice", "amber".
    public func equip(_ slot: String, _ item: String) { call("equip", slot, item) }

    /// Show the user's cumulative light. Loop renders the matching Soulform
    /// stage. What earns light is decided by your server, never by this call.
    public func setLight(_ amount: Double) { call("setLight", amount) }

    /// Strength of the chest light and body glow, 0...2.
    public func setGlow(_ amount: Double) { call("setGlow", amount) }

    // MARK: Comfort

    public func setMotion(_ motion: LoopMotion) { call("setMotion", motion.rawValue) }
    public func setReducedMotion(_ reduced: Bool) { call("setReducedMotion", reduced) }
    /// Confetti amount when celebrating: 0 = none, 1 = default.
    public func setConfetti(_ amount: Double) { call("setParticles", amount) }

    // MARK: Position and visibility

    /// Float so Loop's middle sits at a point in screen coordinates.
    public func float(to point: CGPoint) { call("floatTo", point.x, point.y) }
    /// Float back to the resting anchor.
    public func goHome() { call("goHome") }
    public func setAnchor(_ anchor: LoopAnchor) { call("setAnchor", anchor.rawValue) }

    /// Hide Loop on screens where it would be in the way (camera, payment,
    /// video). Stops rendering and clears confetti. Call `show()` to return.
    public func remove() {
        call("remove")
        overlayWindow?.isHidden = true
    }

    /// Bring Loop back after `remove()`.
    public func show() {
        overlayWindow?.isHidden = false
        call("show")
    }

    // MARK: Placing Loop on screen

    /// Puts Loop above everything in the scene, including sheets. Touches
    /// that miss Loop pass straight through to your app. Safe to call again.
    public func install(in scene: UIWindowScene) {
        if let overlayWindow, overlayWindow.windowScene === scene { return }
        destroy()

        let host = UIViewController()
        host.view.backgroundColor = .clear
        let view = webView
        view.frame = host.view.bounds
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.view.addSubview(view)

        let window = LoopWindow(windowScene: scene)
        window.loopView = view
        window.rootViewController = host
        window.backgroundColor = .clear
        window.windowLevel = .normal + 1 // above your app and its sheets, below system alerts
        window.isHidden = false          // shown, but never made the key window
        overlayWindow = window
    }

    /// Tear Loop down for good and release its window. Create a new
    /// controller (or call `install` again) to bring it back.
    public func destroy() {
        storedWebView?.removeFromSuperview()
        overlayWindow?.isHidden = true
        overlayWindow = nil
    }

    // MARK: Internals

    fileprivate var webView: LoopWebView {
        if let storedWebView { return storedWebView }

        let content = WKUserContentController()
        content.add(WeakMessageHandler(self), name: "loop")
        content.addUserScript(WKUserScript(
            source: "window.LoopConfig = \(configurationJSON());",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let config = WKWebViewConfiguration()
        config.userContentController = content
        config.allowsInlineMediaPlayback = true

        let view = LoopWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.underPageBackgroundColor = .clear
        view.accessibilityLabel = "Loop"

        if let url = Bundle.main.url(forResource: "loop", withExtension: "html") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            assertionFailure("loop.html is missing from the app bundle. Check its Target Membership.")
        }

        storedWebView = view
        return view
    }

    private func configurationJSON() -> String {
        let c = configuration
        var values: [String: Any] = [
            "size": Double(c.size),
            "anchor": c.anchor.rawValue,
            "margin": Double(c.margin),
            "skin": c.skin,
            "outfit": c.outfit,
            "chain": c.chain,
            "eyes": c.eyes,
            "light": c.light,
            "sleepAfter": c.sleepAfter,
            "draggable": c.draggable,
            "returnHome": c.returnsHome,
        ]
        if let motion = c.motion { values["motion"] = motion.rawValue }
        return Self.json(values) ?? "{}"
    }

    private func call(_ method: String, _ arguments: Any...) {
        guard let args = Self.json(arguments), let name = Self.json([method]) else { return }
        // `name` is a one-element JSON array, which safely quotes the method.
        let script = "window.LoopBridge && LoopBridge.call(\(name)[0], \(args));"
        if isReady {
            webView.evaluateJavaScript(script, completionHandler: nil)
        } else {
            pending.append(script)
            _ = webView // start loading if nothing has yet
        }
    }

    private static func json(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    fileprivate func receive(_ body: Any) {
        guard let info = body as? [String: Any], let type = info["type"] as? String else { return }

        switch type {
        case "rect":
            // Where Loop is on screen; only that area takes touches.
            if let x = info["x"] as? Double, let y = info["y"] as? Double,
               let w = info["width"] as? Double, let h = info["height"] as? Double {
                storedWebView?.touchArea = CGRect(x: x, y: y, width: w, height: h).insetBy(dx: -6, dy: -6)
            }
            return // too frequent to forward
        case "ready":
            isReady = true
            let queued = pending
            pending.removeAll()
            queued.forEach { webView.evaluateJavaScript($0, completionHandler: nil) }
        case "tap":
            if configuration.haptics { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
            onTap?()
        case "statechange":
            if let raw = info["state"] as? String, let new = LoopState(rawValue: raw) { state = new }
        case "error":
            print("Loop:", info["message"] as? String ?? "unknown error")
        default:
            break
        }
        onEvent?(type, info)
    }
}

// MARK: - Window and web view

/// The transparent window Loop lives in. It only claims touches that land on
/// Loop, so the rest of the screen behaves as if the window were not there.
final class LoopWindow: UIWindow {
    weak var loopView: LoopWebView?

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard let loopView else { return false }
        return loopView.touchArea.contains(convert(point, to: loopView))
    }
}

final class LoopWebView: WKWebView {
    /// Loop's on-screen box, in this view's coordinates.
    var touchArea: CGRect = .zero
}

/// Lets the web view report to the controller without keeping it alive forever.
@MainActor
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var controller: LoopController?

    init(_ controller: LoopController) {
        self.controller = controller
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        controller?.receive(message.body)
    }
}

// MARK: - SwiftUI

public extension View {
    /// Shows Loop above the whole screen this view is on.
    ///
    ///     ContentView().loopOverlay(loop)
    func loopOverlay(_ controller: LoopController) -> some View {
        background(LoopInstaller(controller: controller).allowsHitTesting(false))
    }
}

/// An invisible view whose only job is to find the scene and install Loop in it.
private struct LoopInstaller: UIViewRepresentable {
    let controller: LoopController

    func makeUIView(context: Context) -> InstallerView {
        let view = InstallerView()
        view.controller = controller
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: InstallerView, context: Context) {}

    final class InstallerView: UIView {
        weak var controller: LoopController?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let scene = window?.windowScene { controller?.install(in: scene) }
        }
    }
}
