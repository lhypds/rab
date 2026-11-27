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
    let choose: (Choice) -> Void

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
                        title
                            .font(Compact.small)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, Compact.inset)
                            .padding(.top, 2)
                        ScrollView {
                            VStack(spacing: 0) {
                                ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                                    if index > 0 { Divider().padding(.leading, Compact.inset) }
                                    Button {
                                        isPresented = false
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

extension View {
    /// Has one of a few things chosen, in a small box in the middle of the
    /// screen made as the sign-in box is.
    func compactChoice<Choice: Identifiable>(
        isPresented: Binding<Bool>,
        title: Text,
        choices: [Choice],
        name: @escaping (Choice) -> String,
        chosen: @escaping (Choice) -> Bool,
        choose: @escaping (Choice) -> Void
    ) -> some View {
        modifier(CompactChoice(isPresented: isPresented, title: title, choices: choices, name: name, chosen: chosen, choose: choose))
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
    var maxPixel: CGFloat = 1600
    /// Fills the frame it is given, cut at the sides, rather than fitting inside it.
    var fills = false

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                if fills {
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
        .task(id: item.photo) {
            guard let url = model.store?.photoURL(item) else { return }
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
