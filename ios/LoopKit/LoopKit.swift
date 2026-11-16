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
    public var size: CGFloat = 170
    public var anchor: LoopAnchor = .bottomRight
    /// Gap from the screen edges, in points. Leave room for the home indicator.
    public var margin: CGFloat = 40
    /// "deep-teal", "porcelain" or "graphite".
    public var skin: String = "deep-teal"
    /// "warm-white", "ice-blue", "amber", or any CSS colour such as "#ff8a6b".
    public var eyeColor: String = "warm-white"
    /// Leave nil to follow the device: expressive, or still when Reduce Motion is on.
    public var motion: LoopMotion?
    /// The user can pick Loop up and carry it.
    public var draggable = true
    /// After being carried, Loop floats back to its anchor.
    public var returnsHome = false
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

    // MARK: Things Loop can do

    public func setState(_ state: LoopState) { call("setState", state.rawValue) }

    /// Loop dances and confetti fills the screen.
    public func celebrate() {
        if configuration.haptics { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        call("celebrate")
    }

    /// "wave", "nod", "shake", "stretch", "celebrate", "dance", "spin",
    /// "shuffle", "wiggle", "tilt", "startle".
    public func play(_ gesture: String) { call("play", gesture) }

    /// Flash an expression, then return to the resting one. Names: "happy",
    /// "joy", "laugh", "knowing", "curious", "attentive", "thinking",
    /// "surprised", "sleepy", "unimpressed", "sideEye", "concerned", "sad",
    /// "determined", "wink".
    public func express(_ name: String, seconds: Double = 1.6) { call("express", name, seconds) }

    /// Move Loop's mouth. Call repeatedly with a 0...1 loudness while audio
    /// plays, or use `setState(.speaking)` for automatic movement.
    public func speak(level: Double) { call("speak", level) }

    public func setSkin(_ skin: String) { call("setSkin", skin) }
    public func setEyeColor(_ color: String) { call("setEyeColor", color) }
    /// "oval", "pixel" or "outline".
    public func setEyeStyle(_ style: String) { call("setEyeStyle", style) }
    public func setMotion(_ motion: LoopMotion) { call("setMotion", motion.rawValue) }
    /// Display brightness, 0...2.
    public func setGlow(_ amount: Double) { call("setGlow", amount) }
    /// Confetti amount when celebrating: 0 = none, 1 = default.
    public func setConfetti(_ amount: Double) { call("setParticles", amount) }

    /// Float so Loop's middle sits at a point in screen coordinates.
    public func float(to point: CGPoint) { call("floatTo", point.x, point.y) }
    /// Float back to the resting anchor.
    public func goHome() { call("goHome") }
    public func setAnchor(_ anchor: LoopAnchor) { call("setAnchor", anchor.rawValue) }

    // MARK: Placing Loop on screen

    /// Puts Loop above everything in the scene, including sheets. Touches
    /// that miss Loop pass straight through to your app. Safe to call again.
    public func install(in scene: UIWindowScene) {
        if let overlayWindow, overlayWindow.windowScene === scene { return }
        remove()

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

    /// Takes Loop off screen.
    public func remove() {
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
            "eyeColor": c.eyeColor,
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
