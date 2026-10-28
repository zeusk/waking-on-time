import Cocoa
import WebKit

/// The deck in a single window: a WKWebView that loads the exported site from the app bundle.
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private static let appName = "Waking Up On Time"
    private var windows: [NSWindow] = []

    private lazy var configuration: WKWebViewConfiguration = {
        let config = WKWebViewConfiguration()
        let site = Bundle.main.resourceURL!.appendingPathComponent("site")
        config.setURLSchemeHandler(BundleSchemeHandler(root: site), forURLScheme: BundleSchemeHandler.scheme)
        config.preferences.isElementFullscreenEnabled = true
        return config
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        let web = makeWindow(configuration: configuration, size: NSSize(width: 1280, height: 760), title: Self.appName)
        web.load(URLRequest(url: BundleSchemeHandler.startURL))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    @discardableResult
    private func makeWindow(configuration: WKWebViewConfiguration, size: NSSize, title: String) -> WKWebView {
        let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: configuration)
        web.navigationDelegate = self
        web.underPageBackgroundColor = .black

        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.backgroundColor = .black
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self
        window.cascadeTopLeft(from: windows.last.map { NSPoint(x: $0.frame.minX, y: $0.frame.maxY) } ?? .zero)
        if windows.isEmpty { window.center() }
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
        windows.append(window)
        return web
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        // Anything outside the bundled deck opens in the user's browser.
        if let url = navigationAction.request.url, url.scheme != BundleSchemeHandler.scheme, url.scheme != "about" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        windows.removeAll { $0 === notification.object as? NSWindow }
    }

    // MARK: Menu

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(Self.appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(Self.appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(Self.appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu: appMenu, title: Self.appName)

        let viewMenu = NSMenu(title: "View")
        let fullScreen = NSMenuItem(title: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.control, .command]
        viewMenu.addItem(fullScreen)
        main.addItem(submenu: viewMenu, title: "View")

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu: windowMenu, title: "Window")

        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}

private extension NSMenu {
    func addItem(submenu: NSMenu, title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        addItem(item)
    }
}
