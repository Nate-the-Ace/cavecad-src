import AppKit
_ = NSApplication.shared
let items: [(String, NSCursor)] = [("arrow", NSCursor.arrow), ("hand", NSCursor.pointingHand), ("ibeam", NSCursor.iBeam), ("cross", NSCursor.crosshair), ("closedhand", NSCursor.closedHand)]
for (name, c) in items {
    let img = c.image
    let scale: CGFloat = 4
    let w = Int(img.size.width * scale), h = Int(img.size.height * scale)
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let gc = NSGraphicsContext(cgContext: ctx, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = gc
    gc.imageInterpolation = .high
    img.draw(in: NSRect(x: 0, y: 0, width: CGFloat(w), height: CGFloat(h)), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    let out = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: out)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "cursors/\(name).png"))
    print(name, img.size.width, img.size.height, "hot", c.hotSpot.x, c.hotSpot.y)
}
