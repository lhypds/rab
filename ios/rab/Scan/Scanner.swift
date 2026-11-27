import AVFoundation
import CoreImage
import SwiftUI
import UIKit

/// The camera while things are being collected: it shows what it sees, says
/// where the object in front of it is — for the white border — and hands over
/// a photograph of that object when asked.
///
/// The photograph is a frame of the same video the border is found in, not a
/// separate still: a still has another shape and another field of view, and
/// the box found in one would have to be guessed at in the other. A frame of
/// 4K video cut down to one object is as large as an item's photograph is
/// kept anyway.
final class Scanner: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    enum State {
        case starting
        case running
        /// The camera may not be used: only Settings changes that.
        case denied
        /// There is no camera — the simulator.
        case unavailable
    }

    @Published private(set) var state: State = .starting
    /// Where the object is in what the camera sees — 0 to 1 across and down,
    /// from the top left — or nil while it sees none.
    @Published private(set) var box: CGRect?
    /// The shape of what the camera sees, upright: what `box` is a share of.
    @Published private(set) var frameSize = CGSize(width: 9, height: 16)

    let session = AVCaptureSession()

    /// Everything below is touched on this queue only: the session is set up
    /// and started on it, and the frames arrive on it.
    private let queue = DispatchQueue(label: "rab.scanner", qos: .userInitiated)
    private let context = CIContext()
    private var configured = false
    private var lastLook = Date.distantPast
    private var lastSeen = Date.distantPast
    private var waiting: ((UIImage?) -> Void)?

    /// How often the picture is looked at for an object: often enough for the
    /// border to follow the hand, seldom enough to leave the phone cool.
    private static let pace: TimeInterval = 0.12
    /// How long the border stays where it was after the object is lost: one
    /// frame without it is not the object gone.
    private static let patience: TimeInterval = 0.4
    /// The room left round the object in its photograph, as a share of its
    /// longer side.
    private static let margin: CGFloat = 0.08

    /// Asks for the camera where it has not been asked for, and starts it.
    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { allowed in
                if allowed {
                    self.run()
                } else {
                    DispatchQueue.main.async { self.state = .denied }
                }
            }
        default:
            state = .denied
        }
    }

    func stop() {
        queue.async {
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    private func run() {
        queue.async {
            if !self.configured {
                guard self.configure() else {
                    DispatchQueue.main.async { self.state = .unavailable }
                    return
                }
                self.configured = true
            }
            if !self.session.isRunning { self.session.startRunning() }
            DispatchQueue.main.async { self.state = .running }
        }
    }

    private func configure() -> Bool {
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input)
        else { return false }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = session.canSetSessionPreset(.hd4K3840x2160) ? .hd4K3840x2160 : .hd1920x1080
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        // A frame that arrives while the last is still being looked at is
        // dropped: the border follows what is there now.
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else { return false }
        session.addOutput(output)
        // Upright frames: the app is held upright and nowhere else.
        if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }
        return true
    }

    /// A photograph of the object in front of the camera now — the next
    /// frame, cut down to the object with a little room round it, or the
    /// whole frame where no object is found in it. Nil where the frame could
    /// not be made a picture. Answered on the main thread.
    func capture(_ done: @escaping (UIImage?) -> Void) {
        queue.async { self.waiting = done }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let now = Date()
        if let done = waiting {
            waiting = nil
            let image = photograph(of: buffer, cutTo: ObjectDetector.box(in: buffer))
            DispatchQueue.main.async { done(image) }
            return
        }
        guard now.timeIntervalSince(lastLook) >= Self.pace else { return }
        lastLook = now
        let found = ObjectDetector.box(in: buffer)
        if found != nil { lastSeen = now }
        let lost = found == nil && now.timeIntervalSince(lastSeen) > Self.patience
        guard found != nil || lost else { return }
        let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
        DispatchQueue.main.async {
            if self.box != found { self.box = found }
            if self.frameSize != size { self.frameSize = size }
        }
    }

    private func photograph(of buffer: CVPixelBuffer, cutTo box: CGRect?) -> UIImage? {
        let whole = CIImage(cvPixelBuffer: buffer)
        var area = whole.extent
        if let box = box?.padded(by: Self.margin), !box.isEmpty {
            // Core Image counts up from the bottom; the box counts down from the top.
            area = CGRect(
                x: whole.extent.minX + box.minX * whole.extent.width,
                y: whole.extent.minY + (1 - box.maxY) * whole.extent.height,
                width: box.width * whole.extent.width,
                height: box.height * whole.extent.height
            ).integral.intersection(whole.extent)
        }
        guard let rendered = context.createCGImage(whole, from: area) else { return nil }
        return UIImage(cgImage: rendered)
    }
}

/// What the camera sees, filling the view it is given.
struct ScannerPreview: UIViewRepresentable {
    let session: AVCaptureSession
    /// Passed so that the view is looked at again once the camera is running:
    /// only then is there a connection to turn upright.
    let running: Bool

    final class Preview: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> Preview {
        let view = Preview()
        view.backgroundColor = .black
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: Preview, context: Context) {
        if let connection = view.previewLayer.connection, connection.isVideoRotationAngleSupported(90), connection.videoRotationAngle != 90 {
            connection.videoRotationAngle = 90
        }
    }
}
