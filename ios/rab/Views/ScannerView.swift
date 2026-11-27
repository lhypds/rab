import SwiftUI

/// Collecting: the camera, open until it is closed, with a white border round
/// the object it sees. The round button keeps a photograph of that object for
/// the spot — one thing after another, no form in between: what each of them
/// is gets said afterwards, by the brain over the items.
struct ScannerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    /// The spots what is collected goes onto; none is the account's default one.
    let spots: [Spot]

    @StateObject private var scanner = Scanner()
    /// Where the phone is: what is collected is at the nearest of the
    /// account's places, where one is within a hundred metres.
    @StateObject private var locator = Locator()
    /// How many were collected since the camera was opened, and the last of them.
    @State private var count = 0
    @State private var last: UIImage?
    @State private var taking = false
    @State private var flash = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch scanner.state {
            case .denied:
                notice("rab may not use the camera. Allow it in Settings to collect things.", settings: true)
            case .unavailable:
                notice("This device has no camera.", settings: false)
            default:
                GeometryReader { proxy in
                    ZStack(alignment: .topLeading) {
                        ScannerPreview(session: scanner.session, running: scanner.state == .running)
                        if let box = scanner.box {
                            let frame = Self.place(box, of: scanner.frameSize, in: proxy.size)
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.white, lineWidth: 3)
                                .shadow(color: .black.opacity(0.35), radius: 3)
                                .frame(width: frame.width, height: frame.height)
                                .offset(x: frame.minX, y: frame.minY)
                                .transition(.opacity)
                                .accessibilityHidden(true)
                        }
                    }
                    .animation(.easeOut(duration: 0.12), value: scanner.box)
                }
                .ignoresSafeArea()

                Color.white
                    .opacity(flash ? 0.6 : 0)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }

            VStack(spacing: 0) {
                top
                Spacer()
                if scanner.state == .running || scanner.state == .starting {
                    bottom
                }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .onAppear {
            scanner.start()
            locator.start()
            // The phone is held up at things for minutes: the screen stays on.
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            scanner.stop()
            locator.stop()
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    /// Where a box in the camera's picture is on the screen: the picture
    /// fills the view, cut at whichever sides hang over.
    private static func place(_ box: CGRect, of picture: CGSize, in view: CGSize) -> CGRect {
        guard picture.width > 0, picture.height > 0 else { return .zero }
        let scale = max(view.width / picture.width, view.height / picture.height)
        let shown = CGSize(width: picture.width * scale, height: picture.height * scale)
        let origin = CGPoint(x: (view.width - shown.width) / 2, y: (view.height - shown.height) / 2)
        return CGRect(
            x: origin.x + box.minX * shown.width,
            y: origin.y + box.minY * shown.height,
            width: box.width * shown.width,
            height: box.height * shown.height
        )
    }

    private var top: some View {
        HStack(spacing: 12) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 40, height: 40)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .accessibilityLabel("Done")
            Spacer()
            if !spots.isEmpty {
                Text(verbatim: spots.map(\.title).joined(separator: ", "))
                    .font(Compact.font.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.45), in: Capsule())
            }
            Spacer()
            // As wide as the button opposite, so that the name is in the middle.
            Color.clear.frame(width: 40, height: 40)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var bottom: some View {
        VStack(spacing: 14) {
            Group {
                if let error {
                    Text(error)
                } else if scanner.box == nil {
                    Text("Point the camera at a thing")
                } else {
                    Text("Press the button to collect it")
                }
            }
            .font(Compact.font)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.black.opacity(0.45), in: Capsule())

            HStack {
                // The last one collected, and how many there are: tapped, back
                // to the spot they are on.
                Button {
                    dismiss()
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let last {
                                Image(uiImage: last).resizable().scaledToFill()
                            } else {
                                Color.white.opacity(0.15)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.7)))
                        if count > 0 {
                            Text(verbatim: "\(count)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.black)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.white, in: Capsule())
                                .offset(x: 8, y: -8)
                        }
                    }
                }
                .accessibilityLabel("Collected: \(count)")
                .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: take) {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 66, height: 66)
                        .padding(5)
                        .overlay(Circle().stroke(Color.white, lineWidth: 3))
                }
                .disabled(taking || scanner.state != .running)
                .opacity(scanner.state == .running ? 1 : 0.4)
                .accessibilityLabel("Collect")

                Color.clear.frame(height: 52).frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 24)
        }
        .padding(.bottom, 20)
    }

    private func notice(_ text: LocalizedStringKey, settings: Bool) -> some View {
        VStack(spacing: 16) {
            Text(text)
                .multilineTextAlignment(.center)
            if settings, let url = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: url)
                    .underline()
            }
        }
        .foregroundStyle(.white)
        .padding(32)
    }

    /// Keeps what the camera is pointed at: the next frame's object goes into
    /// the user's folder, for this spot.
    private func take() {
        guard !taking else { return }
        taking = true
        scanner.capture { image in
            taking = false
            guard let image else {
                error = Language.text("The photo could not be read")
                return
            }
            do {
                try model.collect(image, forSpots: spots.map(\.id), at: locator.position)
                error = nil
                last = image
                count += 1
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                flash = true
                withAnimation(.easeOut(duration: 0.25)) { flash = false }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
