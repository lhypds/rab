import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit
import Vision

/// Cuts the subject out of a photograph, so that it can be stood on a plain
/// colour: the picture an item's tile wants, from a kitchen table. Vision
/// finds the subject (its foreground instance mask, as the scanner's
/// ObjectDetector asks for); Core Image clears what is behind it; the colour
/// goes under it after (see UIImage.over). And what a photograph is kept at,
/// and what is said when one cannot be read.
enum BackgroundRemover {
    enum Failure: LocalizedError {
        case noSubject
        case noImage

        var errorDescription: String? {
            switch self {
            case .noSubject: Language.text("No subject was found in the photo")
            case .noImage: Language.text("The photo could not be read")
            }
        }
    }

    /// The longest side a photo is kept at, as the website keeps it.
    static let maxSide: CGFloat = 1600

    /// The colour a subject stands on unless another is chosen: white.
    static let defaultBackdrop = "#ffffff"
    /// What an item on this phone says of its backdrop where its main
    /// photograph is to be left as it was taken.
    static let noBackdrop = "none"

    /// The photo's subject alone, with nothing behind it: clear where the
    /// background was.
    static func cutOut(_ image: UIImage) async throws -> UIImage {
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
            let nothing = CIImage(color: .clear).cropped(to: subject.extent)
            let blend = CIFilter.blendWithMask()
            blend.inputImage = subject
            blend.backgroundImage = nothing
            blend.maskImage = mask
            guard let output = blend.outputImage,
                  let rendered = CIContext().createCGImage(output, from: subject.extent)
            else { throw Failure.noImage }
            return UIImage(cgImage: rendered)
        }.value
    }
}

extension UIColor {
    /// A colour from the way rab writes one: "#rrggbb".
    convenience init?(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }

    /// The colour as rab writes one: "#rrggbb", whatever it was made in.
    var hex: String {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return BackgroundRemover.defaultBackdrop }
        let part = { (value: CGFloat) in Int((min(1, max(0, value)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", part(red), part(green), part(blue))
    }
}

extension UIImage {
    /// A cut-out subject stood on a colour: the colour over the whole picture,
    /// and the subject on it.
    func over(_ color: UIColor) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        format.opaque = true
        let whole = CGRect(origin: .zero, size: size)
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            color.setFill()
            context.fill(whole)
            draw(in: whole)
        }
    }

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
