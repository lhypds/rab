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
    /// What is done with each photograph, where the camera was opened to add
    /// photographs to an item that is there already — once Done is pressed,
    /// not before: the cross leaves the item as it was. None, each is
    /// collected as a new item the moment it is taken, and the cross takes
    /// those away again.
    var keep: ((UIImage) async throws -> Void)? = nil

    @StateObject private var scanner = Scanner()
    /// Where the phone is: what is collected is at the nearest of the
    /// account's places, where one is within a hundred metres.
    @StateObject private var locator = Locator()
    /// How many were collected since the camera was opened, and the last of them.
    @State private var count = 0
    @State private var last: UIImage?
    /// The photographs taken since the camera was opened, as files, in the
    /// order they were taken; and whether they are up to be looked through.
    @State private var taken: [URL] = []
    @State private var looking: ViewedPhotos?
    /// The items collected since the camera was opened, by their ids: what
    /// the cross takes away again.
    @State private var collected: [String] = []
    /// Done was pressed, and the photographs are on their way to the item.
    @State private var saving = false
    /// The cross was pressed with photographs taken: asked before they go.
    @State private var discarding = false
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

                // The middle of the picture: only a thing under it is seen.
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .light))
                    .foregroundStyle(.white.opacity(0.85))
                    .shadow(color: .black.opacity(0.35), radius: 2)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

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
        .compactDialog(isPresented: $discarding, title: Text("Discard the photos taken?"), confirm: "Discard") {
            discard()
        }
        // The question is asked in the app's black on white; everything else
        // here says its own colours.
        .environment(\.colorScheme, .light)
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .fullScreenCover(item: $looking) { PhotoViewer(photos: $0) }
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
        // The spots' names in the middle, whatever stands at the sides; Done
        // at the right closes the camera.
        ZStack {
            if !spots.isEmpty {
                Text(verbatim: spots.map(\.title).joined(separator: ", "))
                    .font(Compact.font.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.45), in: Capsule())
                    .padding(.horizontal, 76)
            }
            HStack {
                // The cross: out, and nothing taken is kept — asked first,
                // where anything was taken.
                Button {
                    if taken.isEmpty { dismiss() } else { discarding = true }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 40, height: 40)
                        .background(.black.opacity(0.45), in: Circle())
                }
                .disabled(saving)
                .accessibilityLabel("Cancel")
                Spacer()
                Button(action: finish) {
                    Group {
                        if saving {
                            ProgressView().tint(.white)
                        } else {
                            Text("Done").font(Compact.font.weight(.semibold))
                        }
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(.black.opacity(0.45), in: Capsule())
                }
                .disabled(saving || taking)
            }
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
                // The last one taken, and how many there are: pressed, the
                // photographs taken are looked through, the last first.
                Button {
                    if !taken.isEmpty { looking = ViewedPhotos(urls: taken, first: taken.count - 1) }
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
                .disabled(taken.isEmpty)
                .accessibilityLabel("Collected: \(count)")
                .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: take) {
                    Circle()
                        .fill(Color.white)
                        .frame(width: 66, height: 66)
                        .padding(5)
                        .overlay(Circle().stroke(Color.white, lineWidth: 3))
                }
                .disabled(taking || saving || scanner.state != .running)
                .opacity(scanner.state == .running && !taking && !saving ? 1 : 0.4)
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

    /// Done: where the photographs are for an item that is there already,
    /// they go to it now, one after another in the order they were taken —
    /// and the camera closes when the last has gone. One that would not go
    /// stays, with those after it, and the camera with them.
    private func finish() {
        guard let keep, !taken.isEmpty else {
            dismiss()
            return
        }
        saving = true
        error = nil
        Task {
            defer { saving = false }
            while let file = taken.first {
                do {
                    guard let image = UIImage(contentsOfFile: file.path) else { throw BackgroundRemover.Failure.noImage }
                    try await keep(image)
                } catch {
                    self.error = error.localizedDescription
                    return
                }
                taken.removeFirst()
                count = taken.count
                try? FileManager.default.removeItem(at: file)
            }
            dismiss()
        }
    }

    /// The cross, confirmed: what was taken since the camera was opened is
    /// not kept — the items collected are deleted again, the photographs put
    /// by for an item are thrown away.
    private func discard() {
        if keep != nil {
            for file in taken { try? FileManager.default.removeItem(at: file) }
        } else {
            for id in collected {
                if let item = model.item(id) { model.delete(item) }
            }
        }
        dismiss()
    }

    /// Keeps what the camera is pointed at: the next frame's object goes into
    /// the user's folder, for this spot.
    private func take() {
        guard !taking else { return }
        taking = true
        scanner.capture { image in
            guard let image else {
                taking = false
                error = Language.text("The photo could not be read")
                return
            }
            // Taken: the flash and the tap say so at once, whatever keeping
            // it then takes.
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            flash = true
            withAnimation(.easeOut(duration: 0.25)) { flash = false }
            Task {
                // One at a time: the next is not taken until this one is kept.
                defer { taking = false }
                do {
                    if keep != nil {
                        // Put by until Done: the item gets it then.
                        let file = FileManager.default.temporaryDirectory.appendingPathComponent("rab-taken-\(UUID().uuidString).jpg")
                        guard let data = image.jpegData(compressionQuality: 0.92) else { throw BackgroundRemover.Failure.noImage }
                        try data.write(to: file)
                        taken.append(file)
                    } else {
                        let item = try model.collect(image, forSpots: spots.map(\.id), at: locator.position)
                        collected.append(item.id)
                        if let file = model.store?.photoURL(item) { taken.append(file) }
                    }
                    error = nil
                    last = image
                    count += 1
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}
