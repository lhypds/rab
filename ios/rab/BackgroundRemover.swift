import UIKit

/// What a photograph is kept at, and what is said when one cannot be read.
/// (The name is from when the phone cut a subject out of its background.)
enum BackgroundRemover {
    enum Failure: LocalizedError {
        case noImage

        var errorDescription: String? {
            switch self {
            case .noImage: String(localized: "The photo could not be read")
            }
        }
    }

    /// The longest side a photo is kept at, as the website keeps it.
    static let maxSide: CGFloat = 1600
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
