// Draws the app icon (vsync ticks with an amber wake-up just before each) to a 1024×1024 PNG.
// Usage: swift make-icon.swift <output.png>
import AppKit

let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

// macOS icon grid: 824 pt body, centred, continuous-looking corners.
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: body, cornerWidth: 186, cornerHeight: 186, transform: nil)
ctx.addPath(shape)
ctx.clip()
let colors = [CGColor(red: 0.09, green: 0.16, blue: 0.24, alpha: 1), CGColor(red: 0.03, green: 0.04, blue: 0.06, alpha: 1)] as CFArray
let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

// Baseline and vsync ticks.
let cyan = CGColor(red: 0.30, green: 0.79, blue: 0.94, alpha: 1)
let amber = CGColor(red: 0.96, green: 0.64, blue: 0.35, alpha: 1)
ctx.setStrokeColor(CGColor(gray: 1, alpha: 0.22))
ctx.setLineWidth(10)
ctx.move(to: CGPoint(x: 160, y: 430))
ctx.addLine(to: CGPoint(x: 864, y: 430))
ctx.strokePath()

let ticks: [CGFloat] = [250, 450, 650, 850]
ctx.setLineCap(.round)
for x in ticks {
    ctx.setStrokeColor(cyan)
    ctx.setLineWidth(22)
    ctx.move(to: CGPoint(x: x, y: 300))
    ctx.addLine(to: CGPoint(x: x, y: 720))
    ctx.strokePath()
    // The wake-up lands a fixed offset before each vsync.
    ctx.setFillColor(amber)
    ctx.fillEllipse(in: CGRect(x: x - 92, y: 520, width: 56, height: 56))
}

image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
