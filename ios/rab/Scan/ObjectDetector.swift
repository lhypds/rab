import CoreGraphics
import CoreVideo
import Vision

/// Finds the object a picture is of: the thing the scanner draws its white
/// border round, and what a collected photograph is cut down to. Vision's
/// foreground instance mask — the same that lifts a subject out of its
/// background (see BackgroundRemover) — says which pixels are things and
/// which thing each is; the box round one of them is the answer.
enum ObjectDetector {
    /// The box round the picture's main object, in the picture's own
    /// proportions — 0 to 1 across and down, from the top left — or nil where
    /// nothing stands out from its background.
    static func box(in buffer: CVPixelBuffer) -> CGRect? {
        box(using: VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]))
    }

    static func box(in image: CGImage) -> CGRect? {
        box(using: VNImageRequestHandler(cgImage: image, options: [:]))
    }

    private static func box(using handler: VNImageRequestHandler) -> CGRect? {
        let request = VNGenerateForegroundInstanceMaskRequest()
        do {
            try handler.perform([request])
        } catch {
            return nil
        }
        guard let result = request.results?.first, !result.allInstances.isEmpty else { return nil }
        return mainBox(in: result.instanceMask)
    }

    /// The mask is a small picture whose every pixel is the number of the
    /// thing it belongs to, nothing being 0. Of the things in it, the main
    /// one is the one that fills the most of the picture, counted for more
    /// the nearer the middle it is: what the camera is pointed at.
    static func mainBox(in mask: CVPixelBuffer) -> CGRect? {
        guard CVPixelBufferGetPixelFormatType(mask) == kCVPixelFormatType_OneComponent8 else { return nil }
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(mask) else { return nil }
        let width = CVPixelBufferGetWidth(mask)
        let height = CVPixelBufferGetHeight(mask)
        let rowBytes = CVPixelBufferGetBytesPerRow(mask)
        guard width > 0, height > 0 else { return nil }

        struct Extent {
            var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1, count = 0
        }
        var extents = [Extent](repeating: Extent(), count: 256)
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        for y in 0..<height {
            let row = pixels + y * rowBytes
            for x in 0..<width {
                let label = Int(row[x])
                if label == 0 { continue }
                extents[label].count += 1
                if x < extents[label].minX { extents[label].minX = x }
                if x > extents[label].maxX { extents[label].maxX = x }
                if y < extents[label].minY { extents[label].minY = y }
                if y > extents[label].maxY { extents[label].maxY = y }
            }
        }

        let total = Double(width * height)
        var best: (box: CGRect, score: Double)?
        for extent in extents where extent.count > 0 {
            // A speck is not a thing anybody is photographing.
            let share = Double(extent.count) / total
            guard share >= 0.004 else { continue }
            let box = CGRect(
                x: Double(extent.minX) / Double(width),
                y: Double(extent.minY) / Double(height),
                width: Double(extent.maxX - extent.minX + 1) / Double(width),
                height: Double(extent.maxY - extent.minY + 1) / Double(height)
            )
            // How far its middle is from the picture's: 0 at the centre,
            // about 0.7 in a corner.
            let away = hypot(box.midX - 0.5, box.midY - 0.5)
            let score = share * (1 - min(0.9, away * 1.2))
            if score > (best?.score ?? 0) { best = (box, score) }
        }
        return best?.box
    }
}

extension CGRect {
    /// The box grown by a share of its longer side all round, and kept inside
    /// the picture: the room left round an object when a photograph is cut
    /// down to it.
    func padded(by share: CGFloat) -> CGRect {
        let room = max(width, height) * share
        return insetBy(dx: -room, dy: -room).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
}
