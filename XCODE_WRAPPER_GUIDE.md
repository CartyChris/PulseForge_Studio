# Xcode Wrapper Guide — PulseForge as a native macOS/iOS app

This guide describes how to wrap the production web app in SwiftUI + WKWebView.
Nothing in the studio requires it; this is the path to a dock icon, Keychain
secrets, and eventual AVAudioEngine modules.

## 1. Project setup

- Xcode → New Project → App (SwiftUI, Swift). Bundle id e.g. `com.yourname.pulseforge`.
- Add the built `dist/` folder to the app bundle (or keep serving from the local
  backend — recommended, because the backend also provides the AI API).

## 2. Host the web app

```swift
import SwiftUI
import WebKit

struct StudioWebView: NSViewRepresentable {
  func makeNSView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.mediaTypesRequiringUserActionForPlayback = [] // let audio start on tap
    config.allowsInlineMediaPlayback = true              // iOS target
    let web = WKWebView(frame: .zero, configuration: config)
    web.load(URLRequest(url: URL(string: "http://127.0.0.1:7800")!))
    return web
  }
  func updateNSView(_ view: WKWebView, context: Context) {}
}
```

## 3. Start / connect the backend

Bundle Node or ship the backend as a login-item helper; simplest v1: launch the
existing script when the app starts and wait for health:

```swift
let task = Process()
task.currentDirectoryURL = appSupportPulseForgeDir   // copy of the repo/dist
task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
task.arguments = ["node", "scripts/start.mjs", "--no-open"]
try task.run()
// poll http://127.0.0.1:7800/api/health before showing the webview
```

(For a no-Node distribution later: port `server/` to a small Swift/Vapor or
compiled-Node (pkg/sea) sidecar — the API surface to preserve is
`AI_API_REFERENCE.md`.)

## 4. Microphone permission

- Add `NSMicrophoneUsageDescription` to Info.plist ("PulseForge records vocals and
  instruments you choose to capture.").
- WKWebView (macOS 12+/iOS 15+) forwards `getUserMedia` prompts; implement
  `WKUIDelegate.webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`
  and grant `.grant` for `.microphone` after the system prompt.

## 5. File import/export

Two options that map onto the studio's host adapter:

- **Zero-code**: WKWebView already supports `<input type=file>` and download
  anchors on macOS.
- **Native**: inject a `window.__AIOS_BRIDGE__`-style object (see
  `AI_OS_INTEGRATION_GUIDE.md` — the same bridge works for any host) whose
  `files.pickImport`/`saveExport` use `NSOpenPanel`/`NSSavePanel` via
  `WKScriptMessageHandler`, then call `setHost(new AIOSHostAdapter(bridge))`.

## 6. Keychain for credentials

Implement the bridge's `secrets.get/set` with the Security framework:

```swift
// set
let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                        kSecAttrService as String: "PulseForge",
                        kSecAttrAccount as String: providerId,
                        kSecValueData as String: key.data(using: .utf8)!]
SecItemAdd(q as CFDictionary, nil)
```

Then remove keys from `~/.pulseforge/secrets.json` — the backend accepts
host-supplied keys through the adapter path.

## 7. Replacing Web Audio with AVAudioEngine (later)

Do it module-by-module behind the existing seams:

1. **Recording first** (`src/engine/recorder.ts` ↔ an `AVAudioEngine` input tap
   bridged over the same take/latency API) — biggest latency win.
2. **Master rendering** second: implement `render.ts`'s contract (project JSON →
   Float32 channels) natively; the WAV encoder and event builder are pure TS you
   can port or reuse via JavaScriptCore.
3. Real-time instrument DSP last — Tone.js on Apple Silicon is already comfortable
   for v1 workloads; only move it for plugin hosting or sub-5ms round-trips.

The invariant: `shared/` stays the single source of truth for time math, schemas,
and commands, whatever engine renders the audio.
