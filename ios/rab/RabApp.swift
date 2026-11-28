import SwiftUI

@main
struct RabApp: App {
    @State private var model = AppModel()

    init() {
        // Any large title is in the wordmark's face: Gill Sans Bold at 34 pt,
        // following the reader's text size.
        let titleFont = UIFont(name: "GillSans-Bold", size: 34).map { UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: $0) }
            ?? UIFont.preferredFont(forTextStyle: .largeTitle)
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: titleFont]
        // No bar down the side of anything that scrolls up and down — the
        // fields of several lines too, which are the system's own text views.
        UIScrollView.appearance().showsVerticalScrollIndicator = false
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // rab's look: black type on white, in the system's own face —
                // not a monospaced one, which gets fewer words into a line.
                // One size of type throughout, unless a thing says otherwise.
                .font(Compact.font)
                // In the language chosen from the top bar, not the phone's.
                .environment(\.locale, model.language.locale)
                .tint(.black)
                .preferredColorScheme(.light)
                // Nothing that scrolls up and down shows a bar for it,
                // anywhere in the app.
                .scrollIndicators(.hidden, axes: .vertical)
        }
    }
}

/// rab's colours.
enum Rab {
    /// The screens' ground: a warm off-white, the same as Voiced's. Cards and
    /// photographs stay white on it.
    static let background = Color(red: 0.96, green: 0.96, blue: 0.94)
}

/// The app's compact measure: the type, the height of a row or a button, and
/// the margins — the same on the sign-in screen and on an item's page, so
/// that as much as can be is on the screen.
enum Compact {
    /// The app's one size of type: what the sign-in box is written in, and
    /// every page and every item's name with it.
    static let font = Font.subheadline
    /// What is said under or beside that, more quietly: a hint, a reason.
    static let small = Font.footnote
    /// A field, a button, a row of a page: all this tall.
    static let row: CGFloat = 32
    /// From the edge of the screen to a box.
    static let margin: CGFloat = 12
    /// From the edge of a box to what is written in it.
    static let inset: CGFloat = 12
    static let corner: CGFloat = 10
    /// Between two boxes.
    static let gap: CGFloat = 8
}

/// A button that looks the same pressed as not: nothing fades or moves under
/// the finger.
struct StillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Rectangle())
    }
}

/// One of the bar's icons: whatever the symbol, drawn inside the same square,
/// so that the four of them are one size.
struct BarIcon: View {
    static let side: CGFloat = 18
    let name: String
    /// How much of the square it fills: a symbol that is all outline to its
    /// edges — the person — looks larger than the others at the same size.
    var scale: CGFloat = 1

    var body: some View {
        Image(systemName: name)
            .resizable()
            .scaledToFit()
            .fontWeight(.regular)
            .frame(width: Self.side * scale, height: Self.side * scale)
            .frame(width: Self.side, height: Self.side)
    }
}

/// A question asked in the middle of the screen, at the app's compact measure
/// rather than the system's, in a box like the sign-in one: what is asked, a
/// line under it where there is more to say, the button that does it, and
/// the way out under that.
private struct CompactDialog: ViewModifier {
    @Binding var isPresented: Bool
    let title: Text
    let message: Text?
    let confirm: LocalizedStringKey
    /// Whether what is confirmed cannot be taken back: it is then in red.
    let destructive: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        content.overlay {
            if isPresented {
                ZStack {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { isPresented = false }
                    // Made as the sign-in box is: on the app's ground, what is
                    // asked at the top where a field would be, the button
                    // that does it under that — white on black, or on red
                    // where it cannot be taken back — and under the button,
                    // quietly, the way out.
                    VStack(alignment: .leading, spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            title
                                .fontWeight(.semibold)
                            if let message {
                                message
                                    .font(Compact.small)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, Compact.inset)
                        .padding(.top, 4)
                        Button {
                            isPresented = false
                            action()
                        } label: {
                            Text(confirm)
                                .foregroundStyle(.white)
                                .compactRow()
                                .background(destructive ? Color.red : Color.black, in: RoundedRectangle(cornerRadius: Compact.corner))
                        }
                        Button {
                            isPresented = false
                        } label: {
                            Text("Cancel")
                                .font(Compact.small)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, Compact.inset)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                    }
                    .buttonStyle(StillButtonStyle())
                    .font(Compact.font)
                    .padding(Compact.margin)
                    .frame(width: 260)
                    .background(Rab.background, in: RoundedRectangle(cornerRadius: Compact.corner + 4))
                    // One shadow, round the box: not one under each thing in it.
                    .compositingGroup()
                    .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
                    .accessibilityAddTraits(.isModal)
                }
            }
        }
        // There at once and gone at once: nothing fades.
        .transaction { $0.animation = nil }
    }
}

/// A choice among a few things, asked the same way: the things in one white
/// box, a line between each two and a tick by the one chosen — pressing one
/// chooses it and closes the box — and the way out under them.
private struct CompactChoice<Choice: Identifiable>: ViewModifier {
    @Binding var isPresented: Bool
    let title: Text
    let choices: [Choice]
    let name: (Choice) -> String
    let chosen: (Choice) -> Bool
    /// Several may be chosen: pressing one ticks or unticks it and the box
    /// stays, to be closed with "Done" when the ticks are right.
    let several: Bool
    let choose: (Choice) -> Void
    /// Asks for the choices again, where they can be: a small arrow at the
    /// top right of the box then does it, going round until it is done.
    let refresh: (() async -> Void)?

    @State private var refreshing = false

    /// As many rows as stand without scrolling; more than that scroll.
    private static var shown: Int { 8 }

    func body(content: Content) -> some View {
        content.overlay {
            if isPresented {
                ZStack {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { isPresented = false }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            title
                            Spacer(minLength: 0)
                            if let refresh {
                                Button {
                                    guard !refreshing else { return }
                                    refreshing = true
                                    Task {
                                        // Round for half a second at least: an
                                        // answer that comes at once would
                                        // otherwise show nothing.
                                        async let shortest: Void? = try? Task.sleep(for: .milliseconds(500))
                                        await refresh()
                                        _ = await shortest
                                        refreshing = false
                                    }
                                } label: {
                                    Group {
                                        if refreshing { SpinningRefreshIcon() } else { RefreshIcon() }
                                    }
                                    .scaleEffect(0.85)
                                    // Easier to press than it is to see.
                                    .padding(8)
                                    .contentShape(Rectangle())
                                    .padding(-8)
                                }
                                .accessibilityLabel("Refresh")
                            }
                        }
                        .font(Compact.small)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Compact.inset)
                        .padding(.top, 2)
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                                    if index > 0 { Divider().padding(.leading, Compact.inset) }
                                    Button {
                                        if !several { isPresented = false }
                                        choose(choice)
                                    } label: {
                                        HStack(spacing: 8) {
                                            Text(verbatim: name(choice)).lineLimit(1)
                                            Spacer(minLength: 0)
                                            if chosen(choice) {
                                                Image(systemName: "checkmark")
                                                    .font(Compact.small.weight(.semibold))
                                            }
                                        }
                                        .compactRow()
                                    }
                                    .accessibilityAddTraits(chosen(choice) ? .isSelected : [])
                                }
                            }
                        }
                        .scrollBounceBehavior(.basedOnSize)
                        .frame(height: Compact.row * CGFloat(min(max(choices.count, 1), Self.shown)) + CGFloat(min(max(choices.count, 1), Self.shown) - 1))
                        .background(Color.white, in: RoundedRectangle(cornerRadius: Compact.corner))
                        .clipShape(RoundedRectangle(cornerRadius: Compact.corner))
                        Button {
                            isPresented = false
                        } label: {
                            Group {
                                if several { Text("Done") } else { Text("Cancel") }
                            }
                                .font(Compact.small)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, Compact.inset)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                    }
                    .buttonStyle(StillButtonStyle())
                    .font(Compact.font)
                    .padding(Compact.margin)
                    .frame(width: 260)
                    .background(Rab.background, in: RoundedRectangle(cornerRadius: Compact.corner + 4))
                    // One shadow, round the box: not one under each thing in it.
                    .compositingGroup()
                    .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
                    .accessibilityAddTraits(.isModal)
                }
            }
        }
        // There at once and gone at once: nothing fades.
        .transaction { $0.animation = nil }
    }
}

extension View {
    /// Has one of a few things chosen, in a small box in the middle of the
    /// screen made as the sign-in box is.
    func compactChoice<Choice: Identifiable>(
        isPresented: Binding<Bool>,
        title: Text,
        choices: [Choice],
        name: @escaping (Choice) -> String,
        chosen: @escaping (Choice) -> Bool,
        several: Bool = false,
        refresh: (() async -> Void)? = nil,
        choose: @escaping (Choice) -> Void
    ) -> some View {
        modifier(CompactChoice(isPresented: isPresented, title: title, choices: choices, name: name, chosen: chosen, several: several, choose: choose, refresh: refresh))
    }

    /// Asks before something is done, in a small box in the middle of the
    /// screen: `confirm` names what is done — in red where it cannot be taken
    /// back (`destructive`), as deleting cannot.
    func compactDialog(isPresented: Binding<Bool>, title: Text, message: Text? = nil, confirm: LocalizedStringKey, destructive: Bool = true, action: @escaping () -> Void) -> some View {
        modifier(CompactDialog(isPresented: isPresented, title: title, message: message, confirm: confirm, destructive: destructive, action: action))
    }

    /// A field or a button's label as one compact row: as tall as every
    /// other, and as far in from its box's edge.
    func compactRow() -> some View {
        padding(.horizontal, Compact.inset)
            .frame(maxWidth: .infinity, minHeight: Compact.row, alignment: .leading)
            .contentShape(Rectangle())
    }

    /// A page that is a grouped list, at the compact measure: its type, its
    /// rows' height, its margins and the gaps between its boxes.
    func compactList() -> some View {
        font(Compact.font)
            .environment(\.defaultMinListRowHeight, Compact.row)
            .listSectionSpacing(Compact.gap)
            .contentMargins(.horizontal, Compact.margin, for: .scrollContent)
            .contentMargins(.top, Compact.gap, for: .scrollContent)
    }

    /// A list or form on rab's ground instead of the system's grey or white.
    func rabBackground() -> some View {
        scrollContentBackground(.hidden)
            .background(Rab.background.ignoresSafeArea())
    }
}

/// A row's label with its icon in a column of one width, in the middle of it:
/// the icons of the rows under one another stand in a line, and so do their
/// words, whatever shape each icon is and whatever the row is — a link, a
/// share button, a plain button.
struct RowLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.icon
                .frame(width: 22, alignment: .center)
            configuration.title
        }
    }
}

/// An item's photographs: the one as it is, and several as pages to be
/// swiped through, side by side, with the dots that say which is shown.
struct PhotoPager<Page: View>: View {
    let count: Int
    /// Which of them is shown, counted from nothing: read by the page they
    /// are on, which has a button for the one shown, and set by it to turn
    /// back to the first.
    @Binding var shown: Int
    @ViewBuilder let page: (Int) -> Page

    var body: some View {
        if count <= 1 {
            page(0)
        } else {
            TabView(selection: $shown) {
                ForEach(0..<count, id: \.self) { index in
                    page(index).tag(index)
                }
            }
            .tabViewStyle(.page)
            // The dots on a dark ground: the page under them is white.
            .indexViewStyle(.page(backgroundDisplayMode: .always))
        }
    }
}

/// The photographs an item's page was pressed to show large, and which of
/// them first.
struct ViewedPhotos: Identifiable {
    let urls: [URL]
    let first: Int
    var id: Int { first }
}

/// An item's photographs large, over the whole screen, on black: swiped
/// through side by side, each pinched or pressed twice to be looked at
/// closer, until the cross closes it.
struct PhotoViewer: View {
    @Environment(\.dismiss) private var dismiss
    let photos: ViewedPhotos
    /// Takes the photograph at a place in the row off the item — where the
    /// item's page lets it be: the bin at the top is then there, for every
    /// photograph but an only one.
    var remove: ((Int) async throws -> Void)? = nil
    @State private var shown: Int
    @State private var confirming = false
    @State private var removing = false
    @State private var error: String?

    init(photos: ViewedPhotos, remove: ((Int) async throws -> Void)? = nil) {
        self.photos = photos
        self.remove = remove
        _shown = State(initialValue: photos.first)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            TabView(selection: $shown) {
                ForEach(Array(photos.urls.enumerated()), id: \.offset) { index, url in
                    LargePhoto(url: url).tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: photos.urls.count > 1 ? .automatic : .never))
            .ignoresSafeArea()

            HStack {
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
                if let error {
                    Text(error)
                        .font(Compact.font)
                        .lineLimit(2)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.45), in: Capsule())
                    Spacer()
                }
                // The photograph shown, sent on: to whatever the phone shares with.
                if photos.urls.indices.contains(shown) {
                    ShareLink(item: SharedPhoto(url: photos.urls[shown]), preview: SharePreview(Text("Photo"))) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 16, weight: .semibold))
                            // The arrow stands above the middle of its box.
                            .offset(y: -1)
                            .frame(width: 40, height: 40)
                            .background(.black.opacity(0.45), in: Circle())
                    }
                    .accessibilityLabel("Share the photo")
                }
                // The bin: this photograph off the item. Not an only one.
                if remove != nil, photos.urls.count > 1 {
                    Button {
                        confirming = true
                    } label: {
                        Group {
                            if removing {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "trash").font(.system(size: 16, weight: .semibold))
                            }
                        }
                        .frame(width: 40, height: 40)
                        .background(.black.opacity(0.45), in: Circle())
                    }
                    .disabled(removing)
                    .accessibilityLabel("Delete")
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        // Not the dark scheme: the question below is asked in the app's own
        // black on white, where its buttons can be read.
        .statusBarHidden()
        .alert("Delete this photo?", isPresented: $confirming) {
            Button("Delete", role: .destructive) { removeShown() }
            Button("Cancel", role: .cancel) {}
        }
    }

    /// Takes the photograph shown off the item, and closes: the row it was
    /// one of is another row now.
    private func removeShown() {
        guard let remove else { return }
        removing = true
        error = nil
        Task {
            defer { removing = false }
            do {
                try await remove(shown)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// The photograph the viewer shares: the picture itself, as a JPEG — the file
/// on the phone as it is, one of rab's read from there and written as one, so
/// that what is sent is a photograph and not a link to it.
private struct SharedPhoto: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .jpeg) { photo in
            let name = photo.url.deletingPathExtension().lastPathComponent
            if photo.url.isFileURL, ["jpg", "jpeg"].contains(photo.url.pathExtension.lowercased()) {
                return SentTransferredFile(photo.url)
            }
            let (data, _) = try await URLSession.shared.data(from: photo.url)
            guard let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.9) else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).jpg")
            try jpeg.write(to: file, options: .atomic)
            return SentTransferredFile(file)
        }
    }
}

/// One photograph of the viewer: read whole — off the phone or from rab —
/// and then to be zoomed.
private struct LargePhoto: View {
    let url: URL
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                ZoomablePhoto(image: image)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(.white.opacity(0.6))
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: url) {
            guard image == nil else { return }
            if let (data, _) = try? await URLSession.shared.data(from: url), let loaded = UIImage(data: data) {
                image = loaded
            } else if !Task.isCancelled {
                failed = true
            }
        }
    }
}

/// A photograph fitted to the screen that two fingers make larger, and a
/// double press makes larger and small again.
private struct ZoomablePhoto: UIViewRepresentable {
    let image: UIImage

    final class Zoomer: UIScrollView, UIScrollViewDelegate {
        let picture = UIImageView()

        override init(frame: CGRect) {
            super.init(frame: frame)
            delegate = self
            minimumZoomScale = 1
            maximumZoomScale = 5
            showsVerticalScrollIndicator = false
            showsHorizontalScrollIndicator = false
            contentInsetAdjustmentBehavior = .never
            backgroundColor = .clear
            picture.contentMode = .scaleAspectFit
            addSubview(picture)
            let twice = UITapGestureRecognizer(target: self, action: #selector(pressedTwice(_:)))
            twice.numberOfTapsRequired = 2
            addGestureRecognizer(twice)
        }

        required init?(coder: NSCoder) { fatalError("not from a nib") }

        override func layoutSubviews() {
            super.layoutSubviews()
            // Fitted to the view while it is not zoomed; zoomed, it is left
            // where the fingers put it.
            if zoomScale == 1, picture.frame.size != bounds.size {
                picture.frame = CGRect(origin: .zero, size: bounds.size)
                contentSize = bounds.size
            }
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { picture }

        @objc private func pressedTwice(_ press: UITapGestureRecognizer) {
            if zoomScale > 1 {
                setZoomScale(1, animated: true)
            } else {
                // Larger, round where it was pressed.
                let at = press.location(in: picture)
                let size = CGSize(width: bounds.width / 2.5, height: bounds.height / 2.5)
                zoom(to: CGRect(x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height), animated: true)
            }
        }
    }

    func makeUIView(context: Context) -> Zoomer {
        let view = Zoomer()
        view.picture.image = image
        return view
    }

    func updateUIView(_ view: Zoomer, context: Context) {
        if view.picture.image !== image { view.picture.image = image }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // The items' screen is the app; where nobody is signed in, the way in
        // stands over it, in the middle, until somebody is.
        ItemsView()
            .overlay {
                if !model.isSignedIn {
                    // In the middle as it first stands — a name and a button —
                    // and held by its top from then on: what opens in it
                    // (the password, the server's address) opens downwards,
                    // and nothing above that moves. Nor does anything glide.
                    GeometryReader { window in
                        ZStack(alignment: .top) {
                            Color.black.opacity(0.25).ignoresSafeArea()
                            SignInView()
                                .padding(.top, max(Compact.margin, (window.size.height - SignInView.closedHeight) / 2))
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    }
                    .transaction { $0.animation = nil }
                }
            }
    }
}

/// The top of a screen that has no navigation bar: "rab" at the left, in Gill
/// Sans Bold, and whatever the screen can do at the right.
struct RabHeader<Actions: View>: View {
    var background = Rab.background
    /// Lower and tighter: over a screen that is all items, where every line
    /// the bar takes is a row of them not shown.
    var compact = false
    @ViewBuilder var actions: Actions

    @ScaledMetric private var titleSize = 34
    @ScaledMetric private var compactTitleSize = 24

    var body: some View {
        HStack(spacing: compact ? 18 : 20) {
            Text(verbatim: "rab")
                .font(.custom("GillSans-Bold", fixedSize: compact ? compactTitleSize : titleSize))
                .fixedSize()
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            actions
                .font(.system(size: compact ? 18 : 20))
        }
        .padding(.horizontal, compact ? 12 : 20)
        .padding(.top, compact ? 6 : 36)
        .padding(.bottom, compact ? 6 : 12)
        .background(background)
    }
}

extension RabHeader where Actions == EmptyView {
    init(background: Color = Rab.background, compact: Bool = false) {
        self.init(background: background, compact: compact) { EmptyView() }
    }
}

/// A price as a line: "1,500 JPY", "12.5 USD".
func priceText(_ amount: Double, _ currency: String) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 2
    return "\(formatter.string(from: NSNumber(value: amount)) ?? "\(amount)") \(currency)"
}

/// A photograph from the user's folder, read off the main thread and no larger
/// than it will be shown.
struct PhotoView: View {
    @Environment(AppModel.self) private var model
    let item: SavedItem
    /// Which of its photographs, by its file's name: the first where none is said.
    var file: String? = nil
    var maxPixel: CGFloat = 1600
    /// Fills the frame it is given, cut at the sides, rather than fitting inside it.
    var fills = false
    /// In a square, whole, with itself blurred where it does not reach the
    /// square's sides (see SquaredPhoto).
    var squared = false

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                if squared {
                    SquaredPhoto(image: Image(uiImage: image))
                } else if fills {
                    // The frame is the clear colour's; the picture covers it
                    // and what hangs over is cut off.
                    Color.clear
                        .overlay { Image(uiImage: image).resizable().scaledToFill() }
                        .clipped()
                } else {
                    Image(uiImage: image).resizable().scaledToFit()
                }
            } else {
                // Read off the phone in a moment; a placeholder until then.
                PhotoPlaceholder()
            }
        }
        .task(id: file ?? item.photo) {
            guard let url = model.store?.photoURL(named: file ?? item.photo) else { return }
            let pixels = maxPixel * UIScreen.main.scale
            image = await Task.detached(priority: .userInitiated) {
                guard let loaded = UIImage(contentsOfFile: url.path) else { return nil }
                let longest = max(loaded.size.width, loaded.size.height)
                guard longest > pixels else { return loaded }
                let scale = pixels / longest
                return loaded.preparingThumbnail(of: CGSize(width: loaded.size.width * scale, height: loaded.size.height * scale))
            }.value
        }
    }
}
