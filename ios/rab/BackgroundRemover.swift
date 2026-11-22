import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

/// Cuts the subject out of a photograph and stands it on white: the picture a
/// listing wants, from a kitchen table. Vision finds the subject (iOS 17's
/// foreground instance mask); Core Image lays it over a white sheet.
enum BackgroundRemover {
    enum Failure: LocalizedError {
        case noSubject
        case noImage

        var errorDescription: String? {
            switch self {
            case .noSubject: String(localized: "No subject was found in the photo")
            case .noImage: String(localized: "The photo could not be read")
            }
        }
    }

    /// The longest side a photo is kept at, as the website keeps it.
    static let maxSide: CGFloat = 1600

    /// The photo with everything behind its subject painted white.
    static func whiten(_ image: UIImage) async throws -> UIImage {
        let source = image.normalized(maxSide: maxSide)
        return try await Task.detached(priority: .userInitiated) {
            guard let cgImage = source.cgImage else { throw Failure.noImage }
            let request = VNGenerateForegroundInstanceMaskRequest()
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try handler.perform([request])
            guard let result = request.results?.first, !result.allInstances.isEmpty else {
                throw Failure.noSubject
            }
            let maskBuffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)

            let subject = CIImage(cgImage: cgImage)
            let mask = CIImage(cvPixelBuffer: maskBuffer)
            let white = CIImage(color: .white).cropped(to: subject.extent)
            let blend = CIFilter.blendWithMask()
            blend.inputImage = subject
            blend.backgroundImage = white
            blend.maskImage = mask
            guard let output = blend.outputImage,
                  let rendered = CIContext().createCGImage(output, from: subject.extent)
            else { throw Failure.noImage }
            return UIImage(cgImage: rendered)
        }.value
    }
}

extension UIImage {
    /// The same picture drawn upright at scale 1 — a camera photo carries its
    /// rotation as a flag, which Vision and JPEG writers do not all read — and
    /// no longer than `maxSide` on its longer side.
    func normalized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > 0 else { return self }
        let scale = min(1, maxSide / longest)
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            draw(in: CGRect(origin: .zero, size: target))
        }
    }

    /// JPEG bytes of the picture reduced to `maxSide`, with the size they came to.
    func jpeg(maxSide: CGFloat, quality: CGFloat) -> (data: Data, width: Int, height: Int)? {
        let small = normalized(maxSide: maxSide)
        guard let data = small.jpegData(compressionQuality: quality) else { return nil }
        return (data, Int(small.size.width), Int(small.size.height))
    }
}
