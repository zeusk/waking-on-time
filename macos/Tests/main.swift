// Headless check of the bundled deck in WebKit: loads each slide, snapshots it, checks that P no
// longer opens a presenter window, and reports any JavaScript errors.
// Usage: deck-test <site-folder | deck.html> <output-folder> <slide>...
import Cocoa
import WebKit

final class Harness: NSObject, WKScriptMessageHandler, WKUIDelegate {
    var errors: [String] = []
    var popup: WKWebView?
    let popupWindow = NSWindow(contentRect: NSRect(x: -8000, y: -8000, width: 1440, height: 860), styleMask: [.borderless], backing: .buffered, defer: false)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        errors.append("\(message.body)")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 860), configuration: configuration)
        popupWindow.contentView = web
        popupWindow.orderFrontRegardless()
        popup = web
        return web
    }
}

let args = CommandLine.arguments
let site = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
var slides = args.dropFirst(3).compactMap { Int($0) }

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let harness = Harness()

let config = WKWebViewConfiguration()
// Let any window.open through without a real keypress, so the presenter check below would catch one.
config.preferences.javaScriptCanOpenWindowsAutomatically = true
config.setURLSchemeHandler(BundleSchemeHandler(root: site), forURLScheme: BundleSchemeHandler.scheme)
config.userContentController.add(harness, name: "err")
config.userContentController.addUserScript(WKUserScript(source: """
    window.addEventListener('error', e => webkit.messageHandlers.err.postMessage('error: ' + e.message + ' @ ' + e.filename + ':' + e.lineno));
    window.addEventListener('unhandledrejection', e => webkit.messageHandlers.err.postMessage('rejection: ' + e.reason));
    const ce = console.error.bind(console);
    console.error = (...a) => { webkit.messageHandlers.err.postMessage('console.error: ' + a.join(' ')); ce(...a); };
    """, injectionTime: .atDocumentStart, forMainFrameOnly: false))

let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1600, height: 900), configuration: config)
web.uiDelegate = harness
// WebKit pauses requestAnimationFrame in off-screen windows. DECK_TEST_VISIBLE=1 keeps the window on
// screen but nearly transparent and click-through, so canvas animations can be checked too.
let visible = ProcessInfo.processInfo.environment["DECK_TEST_VISIBLE"] == "1"
let origin = visible ? NSPoint(x: 0, y: 0) : NSPoint(x: -4000, y: -4000)
let window = NSWindow(contentRect: NSRect(origin: origin, size: NSSize(width: 1600, height: 900)), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
if visible {
    window.alphaValue = 0.01
    window.ignoresMouseEvents = true
}
window.orderFrontRegardless()

func save(_ image: NSImage?, _ name: String) {
    guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { print("snapshot failed: \(name)"); return }
    try? png.write(to: outDir.appendingPathComponent(name))
}

func finish() {
    web.evaluateJavaScript("[navigator.userAgent, document.title, document.querySelectorAll('.stage').length, location.protocol].join(' | ')") { info, _ in
        print("page: \(info ?? "?")")
        print(harness.errors.isEmpty ? "js errors: none" : "js errors:\n" + harness.errors.joined(separator: "\n"))
        exit(harness.errors.isEmpty ? 0 : 1)
    }
}

/// The public deck has no presenter view: pressing P must not open a window.
func noPresenter() {
    web.evaluateJavaScript("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); true") { _, _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if harness.popup != nil { harness.errors.append("pressing P opened a window") }
            print("presenter view: \(harness.popup == nil ? "none (expected)" : "opened (unexpected)")")
            finish()
        }
    }
}

func next() {
    guard !slides.isEmpty else { return noPresenter() }
    let n = slides.removeFirst()
    web.evaluateJavaScript("location.hash = '#\(n)'; true") { _, _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            web.takeSnapshot(with: nil) { image, _ in
                save(image, "slide-\(n).png")
                next()
            }
        }
    }
}

if site.pathExtension == "html" {
    web.loadFileURL(site, allowingReadAccessTo: site.deletingLastPathComponent())
} else {
    web.load(URLRequest(url: BundleSchemeHandler.startURL))
}
DispatchQueue.main.asyncAfter(deadline: .now() + 3) { next() }
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { print("timeout"); exit(2) }
app.run()
