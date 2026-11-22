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
                // rab's look: black monospace type on white.
                .fontDesign(.monospaced)
                .tint(.black)
                .preferredColorScheme(.light)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if model.isSignedIn {
            ItemsView()
        } else {
            SignInView()
        }
    }
}

/// The top of a screen that has no navigation bar: "rab" at the left, in Gill
/// Sans Bold, and whatever the screen can do at the right.
struct RabHeader<Actions: View>: View {
    var background = Color(.systemBackground)
    @ViewBuilder var actions: Actions

    @ScaledMetric private var titleSize = 34

    var body: some View {
        HStack(spacing: 20) {
            Text(verbatim: "rab")
                .font(.custom("GillSans-Bold", fixedSize: titleSize))
                // The app's monospaced design would otherwise replace the face.
                .fontDesign(nil)
                .fixedSize()
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            actions
                .font(.system(size: 20))
        }
        .padding(.horizontal, 20)
        .padding(.top, 36)
        .padding(.bottom, 12)
        .background(background)
    }
}

extension RabHeader where Actions == EmptyView {
    init(background: Color = Color(.systemBackground)) {
        self.init(background: background) { EmptyView() }
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
                Color(white: 0.96)
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
