import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the exported deck from a folder under a private `deck://local/` origin, so the site's
/// absolute `/_next/...` paths resolve without a web server and without file:// restrictions.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "deck"
    static let startURL = URL(string: "deck://local/")!

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        var file = root.appendingPathComponent(String(path.drop { $0 == "/" })).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else {
            respond(task, url: url, status: 403, data: Data())
            return
        }
        if !FileManager.default.fileExists(atPath: file.path) { file.appendPathExtension("html") }
        guard let data = try? Data(contentsOf: file) else {
            respond(task, url: url, status: 404, data: Data("Not found".utf8))
            return
        }
        respond(task, url: url, status: 200, data: data, type: mimeType(for: file.pathExtension))
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, data: Data, type: String = "text/plain") {
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "txt": return "text/plain; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
