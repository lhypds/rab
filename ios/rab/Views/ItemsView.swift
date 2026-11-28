import PhotosUI
import SwiftUI

/// Where a tile of the grid leads: an item on rab, or one on this phone only.
enum Route: Hashable {
    case listing(String)
    case saved(String)
}

/// Which of the items the grid shows: all of them, the ones of one category,
/// or the ones nothing has said the category of yet.
private enum Filter: Hashable {
    case all
    case category(String)
    case unrecognized
}

/// The user's items, as a grid: what is still on this phone only first, then
/// what rab has. Over it, the bar — which spot things are collected onto, the
/// camera that collects them, the brain that has them recognized, and the
/// account — and the categories, to narrow the grid to one.
struct ItemsView: View {
    @Environment(AppModel.self) private var model

    @State private var filter = Filter.all
    @State private var collecting = false
    @State private var account = false
    /// The box that asks which spot things are collected onto is up.
    @State private var choosingSpot = false
    /// And the one that asks which language the app is in.
    @State private var choosingLanguage = false
    /// What recognizing everything could not do, the last time it was asked.
    @State private var trouble: String?
    /// The pages opened from the grid, the last on top.
    @State private var path: [Route] = []
    /// The items picked, while several are being picked at once — a long
    /// press on one starts it: nil while none are. Each by where its tile
    /// leads.
    @State private var picked: Set<Route>?
    /// The boxes that ask about the ones picked: whether to delete them, and
    /// where they are.
    @State private var deletingPicked = false
    @State private var placingPicked = false

    private var listings: [Listing] { model.listings ?? [] }

    /// The items kept on this phone that the server's list does not have: all
    /// of them until the server has answered, and after that the ones that
    /// were never put on rab.
    private var onPhone: [SavedItem] {
        model.listings == nil ? model.items : model.waiting
    }

    /// How many items each category has, for the bar: only the categories
    /// that have any are offered.
    private var counts: [String: Int] {
        var counts: [String: Int] = [:]
        for category in onPhone.filter(\.isRecognized).map({ $0.category ?? "" }) + listings.map({ $0.category ?? "" }) {
            counts[category.isEmpty ? "other" : category, default: 0] += 1
        }
        return counts
    }

    private func shows(_ category: String?, recognized: Bool) -> Bool {
        switch filter {
        case .all: true
        case .unrecognized: !recognized
        case .category(let slug): recognized && ((category ?? "").isEmpty ? "other" : category) == slug
        }
    }

    /// The grid, or what stands in its place while there is nothing to show.
    @ViewBuilder
    private var grid: some View {
        if !model.isSignedIn {
            // Nobody's items: the way in is over this (see RootView).
            Color.clear
        } else if listings.isEmpty && onPhone.isEmpty && model.listingsError == nil {
            ContentUnavailableView {
                Text("Nothing yet")
                    .fontWeight(.bold)
                    .padding(.bottom, 6)
            } description: {
                Text("Open the camera and point it at one thing after another. The brain then says what each of them is.")
                    .font(Compact.font)
            } actions: {
                Button("Start collecting") { collecting = true }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let problem = model.listingsError {
                        Text("Your items could not be loaded from rab: \(problem)")
                            .font(Compact.font)
                            .foregroundStyle(.red)
                    }
                    if let trouble {
                        Text(trouble)
                            .font(Compact.font)
                            .foregroundStyle(.red)
                    }
                    LazyVGrid(columns: ItemGrid.columns, spacing: ItemGrid.gap) {
                        // What is still on this phone only.
                        ForEach(onPhone.filter { shows($0.category, recognized: $0.isRecognized) }) { item in
                            ItemTile(name: item.words(in: model.language).title, busy: model.recognizing.contains(item.id), picked: picked?.contains(.saved(item.id))) {
                                PhotoView(item: item, maxPixel: 120, fills: true)
                            }
                            .pressed(.saved(item.id), path: $path, picked: $picked)
                        }
                        // What rab has: the user's items as the website lists them.
                        ForEach(listings.filter { shows($0.category, recognized: true) }) { listing in
                            ItemTile(name: listing.words(in: model.language).title, busy: model.recognizing.contains(listing.id), picked: picked?.contains(.listing(listing.id))) {
                                RemotePhoto(path: listing.thumb ?? listing.images?.first?.thumb ?? listing.images?.first?.src, fills: true)
                            }
                            .pressed(.listing(listing.id), path: $path, picked: $picked)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
            .pullToRefresh { await model.loadListings() }
        }
    }

    /// The categories, in one line that scrolls sideways: all of them first,
    /// then what is not recognized yet, then each category that has items.
    private var categories: some View {
        let counts = counts
        let unrecognized = onPhone.filter { !$0.isRecognized }.count
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip(Text("All"), count: onPhone.count + listings.count, for: .all)
                if unrecognized > 0 {
                    chip(Text("Not recognized yet"), count: unrecognized, for: .unrecognized)
                }
                ForEach(Categories.all.filter { counts[$0] != nil }, id: \.self) { slug in
                    chip(Text(Categories.name(slug)), count: counts[slug] ?? 0, for: .category(slug))
                }
            }
            .padding(.horizontal, 8)
            // Room over them as well as under: the line scrolls sideways, and
            // cuts off whatever stands against its top edge.
            .padding(.top, 2)
            .padding(.bottom, 6)
        }
        .background(Rab.background)
    }

    private func chip(_ name: Text, count: Int, for choice: Filter) -> some View {
        let chosen = filter == choice
        return Button {
            filter = choice
        } label: {
            (name + Text(verbatim: " \(count)").foregroundStyle(chosen ? Color.white.opacity(0.7) : Color.secondary))
                .font(Compact.font)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .foregroundStyle(chosen ? Color.white : Color.black)
                // No line round it: white on the ground, black when chosen.
                .background(chosen ? Color.black : Color.white, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    var body: some View {
        NavigationStack(path: $path) {
            grid
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Rab.background.ignoresSafeArea())
            .navigationTitle("My items")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .listing(let id): ListingDetailView(listingId: id)
                case .saved(let id): ItemDetailView(itemId: id)
                }
            }
            // Asked each time the grid comes on screen, and when somebody
            // signs in.
            .task(id: model.username) { await model.loadListings() }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    RabHeader(compact: true) {
                        // The camera that collects, one thing after another: the
                        // first of the buttons.
                        Button { collecting = true } label: {
                            BarIcon(name: "camera.viewfinder")
                        }
                        .accessibilityLabel("Start collecting")
                        // The marker: which spot things are collected onto.
                        // Chosen here, and nothing more — the tick says which.
                        Button { choosingSpot = true } label: {
                            HStack(spacing: 3) {
                                SpotIcon()
                                // Which one it is, beside it: on one line, cut
                                // short where the bar has no more room.
                                // The first, and how many more there are.
                                if let spot = model.targetSpots.first {
                                    Text(verbatim: model.targetSpots.count > 1 ? "\(spot.title) +\(model.targetSpots.count - 1)" : spot.title)
                                        .font(Compact.small)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                        .frame(maxWidth: 96, alignment: .leading)
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                            }
                        }
                        .disabled(model.spots.isEmpty)
                        .accessibilityLabel("Spot")
                        // The brain: everything not on rab yet is recognized
                        // and sent up. How many there are stands by it.
                        Button(action: recognizeAll) {
                            HStack(spacing: 3) {
                                if model.recognizingAll {
                                    ProgressView().controlSize(.small).frame(width: BarIcon.side, height: BarIcon.side)
                                } else {
                                    BrainIcon()
                                }
                                if !model.waiting.isEmpty {
                                    Text(verbatim: "\(model.waiting.count)")
                                        .font(Compact.font.weight(.semibold))
                                        .monospacedDigit()
                                }
                            }
                        }
                        .disabled(model.recognizingAll || model.waiting.isEmpty)
                        .accessibilityLabel("Recognize all (\(model.waiting.count))")
                        // The arrow: the items asked for again. In the same
                        // square as the others, and drawn a little inside it:
                        // its line is heavier than theirs, and at the
                        // square's full size it looks the largest of them.
                        RefreshButton(scale: BarIcon.side * 0.8 / RefreshIcon.side) { await model.loadListings() }
                            .frame(width: BarIcon.side, height: BarIcon.side)
                            // A little lower than the middle: the arrowhead
                            // stands up over the ring, and the whole looks
                            // high beside the bar's other icons without.
                            .offset(y: 1.5)
                        // The globe: which language the app is in.
                        Button { choosingLanguage = true } label: {
                            BarIcon(name: "globe")
                        }
                        .accessibilityLabel("Language")
                        Button { account = true } label: {
                            BarIcon(name: "person", scale: 0.84)
                        }
                        .accessibilityLabel(Text(verbatim: model.username ?? ""))
                    }
                    if !listings.isEmpty || !onPhone.isEmpty {
                        categories
                    }
                }
            }
            // While several are picked, what can be done with them, at the
            // foot: how many there are, then recognize, where they are,
            // delete — and the way out of picking.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let picked {
                    // As wide as what is in it and no wider, in the middle.
                    HStack(spacing: 14) {
                        Text("\(picked.count) selected")
                            .font(Compact.small)
                            .monospacedDigit()
                        // The three that do something need something picked;
                        // the way out does not.
                        Button(action: recognizePicked) { BrainIcon(scale: 0.8) }
                            .accessibilityLabel("Recognize again")
                            .disabled(picked.isEmpty)
                            .opacity(picked.isEmpty ? 0.4 : 1)
                        Button { placingPicked = true } label: {
                            SpotIcon().scaleEffect(0.8).frame(width: BarIcon.side * 0.8, height: BarIcon.side)
                        }
                        .accessibilityLabel("Location")
                        .disabled(picked.isEmpty)
                        .opacity(picked.isEmpty ? 0.4 : 1)
                        Button { deletingPicked = true } label: { BarIcon(name: "trash", scale: 0.8) }
                            .accessibilityLabel("Delete")
                            .disabled(picked.isEmpty)
                            .opacity(picked.isEmpty ? 0.4 : 1)
                        Button { self.picked = nil } label: { BarIcon(name: "xmark", scale: 0.6) }
                            .accessibilityLabel("Cancel")
                    }
                    .foregroundStyle(.white)
                    .buttonStyle(StillButtonStyle())
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(Color.black, in: Capsule())
                    .fixedSize()
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 6)
                }
            }
            // The header is the bar here; the title is still what the item's
            // page calls the way back.
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $collecting) {
                ScannerView(spots: model.targetSpots)
            }
            // The account, in the middle of the screen: whose it is, and the
            // way out of it.
            // Which spot things are collected onto, asked the same way.
            .compactChoice(
                isPresented: $choosingSpot,
                title: Text("Collect onto"),
                choices: model.spots,
                name: { $0.title },
                chosen: { spot in model.targetSpots.contains { $0.id == spot.id } },
                // Several, and one at least: the last tick does not come off.
                several: true,
                // The spots come with the items: asking for those again.
                refresh: { await model.loadListings() },
                choose: { model.toggleTargetSpot($0.id) }
            )
            .compactChoice(
                isPresented: $choosingLanguage,
                title: Text("Language"),
                choices: Language.allCases,
                name: { $0.name },
                chosen: { $0 == model.language },
                choose: { model.language = $0 }
            )
            .compactChoice(
                isPresented: $placingPicked,
                title: Text("Location"),
                choices: PlaceChoice.all(model.places),
                name: { $0.name },
                chosen: { _ in false },
                choose: { placePicked($0.place) }
            )
            .compactDialog(
                isPresented: $deletingPicked,
                title: Text("Delete \(picked?.count ?? 0) items?"),
                message: Text("What is on rab is deleted from rab for good."),
                confirm: "Delete"
            ) {
                deletePicked()
            }
            .compactDialog(
                isPresented: $account,
                title: Text(verbatim: model.username ?? ""),
                confirm: "Sign out",
                // Signing in again is all it takes to undo: not in red.
                destructive: false
            ) {
                Task { await model.signOut() }
            }
            // A category whose last item went leaves the grid showing all.
            .onChange(of: counts) { _, counts in
                if case .category(let slug) = filter, counts[slug] == nil { filter = .all }
            }
        }
    }

    /// The ones picked, as what they are — and picking is over: what is done
    /// with them goes on without it.
    private func takePicked() -> (saved: [SavedItem], listings: [Listing]) {
        let routes = picked ?? []
        picked = nil
        var saved: [SavedItem] = []
        var listed: [Listing] = []
        for route in routes {
            switch route {
            case .saved(let id): if let item = model.item(id) { saved.append(item) }
            case .listing(let id): if let listing = model.listing(id) { listed.append(listing) }
            }
        }
        return (saved, listed)
    }

    /// Each of the ones picked is recognized again, one after another: the
    /// tile of the one being looked at turns meanwhile.
    private func recognizePicked() {
        let taken = takePicked()
        trouble = nil
        Task {
            var failed = 0
            var why = ""
            for item in taken.saved {
                do { try await model.recognize(item) } catch { failed += 1; why = error.localizedDescription }
            }
            for listing in taken.listings {
                do { try await model.recognize(listing) } catch { failed += 1; why = error.localizedDescription }
            }
            if failed > 0 { trouble = Language.text("\(failed) could not be done: \(why)") }
        }
    }

    /// Each of the ones picked is put at the place chosen, or at none.
    private func placePicked(_ place: Place?) {
        let taken = takePicked()
        trouble = nil
        Task {
            var failed = 0
            var why = ""
            for item in taken.saved {
                do { try await model.setPlace(place, for: item) } catch { failed += 1; why = error.localizedDescription }
            }
            for listing in taken.listings {
                do { try await model.setPlace(place, for: listing) } catch { failed += 1; why = error.localizedDescription }
            }
            if failed > 0 { trouble = Language.text("\(failed) could not be done: \(why)") }
        }
    }

    /// Each of the ones picked is deleted: from this phone, and from rab
    /// where it is there.
    private func deletePicked() {
        let taken = takePicked()
        trouble = nil
        Task {
            var failed = 0
            var why = ""
            for item in taken.saved {
                do { try await model.remove(item) } catch { failed += 1; why = error.localizedDescription }
            }
            for listing in taken.listings {
                do { try await model.delete(listing) } catch { failed += 1; why = error.localizedDescription }
            }
            if failed > 0 { trouble = Language.text("\(failed) could not be done: \(why)") }
        }
    }

    private func recognizeAll() {
        trouble = nil
        Task {
            if let result = await model.recognizeAll() {
                trouble = Language.text("\(result.failed) could not be done: \(result.why)")
            }
        }
    }
}

private extension View {
    /// A tile of the grid under the finger. Pressed, it opens its page — or,
    /// while several are being picked, is picked or let go. Held, it starts
    /// the picking, with itself the first picked.
    func pressed(_ route: Route, path: Binding<[Route]>, picked: Binding<Set<Route>?>) -> some View {
        contentShape(Rectangle())
            .onTapGesture {
                if var all = picked.wrappedValue {
                    if all.contains(route) { all.remove(route) } else { all.insert(route) }
                    picked.wrappedValue = all
                } else {
                    path.wrappedValue.append(route)
                }
            }
            .onLongPressGesture(minimumDuration: 0.35) {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                var all = picked.wrappedValue ?? []
                all.insert(route)
                picked.wrappedValue = all
            }
    }
}

/// A photograph the server keeps, filling the frame it is given or fitting
/// inside it. Until it is there the frame holds a placeholder: grey, turning
/// while the picture loads, and a crossed-out picture if it never comes.
struct RemotePhoto: View {
    @Environment(AppModel.self) private var model
    let path: String?
    var fills = false
    /// In a square, whole, with itself blurred where it does not reach the
    /// square's sides (see SquaredPhoto).
    var squared = false
    /// The colour it stands on, for one whose subject was cut out and stood
    /// on one ("#rrggbb"): the room left in the square is then that colour.
    var backdrop: String? = nil

    var body: some View {
        AsyncImage(url: model.imageURL(path)) { phase in
            switch phase {
            case .success(let image):
                if squared {
                    SquaredPhoto(image: image, ground: backdrop.flatMap { UIColor(hex: $0) }.map { Color(uiColor: $0) })
                } else if fills {
                    Color.clear
                        .overlay { image.resizable().scaledToFill() }
                        .clipped()
                } else {
                    image.resizable().scaledToFit()
                }
            case .failure:
                PhotoPlaceholder(loading: false)
            default:
                PhotoPlaceholder(loading: path != nil)
            }
        }
    }
}

/// A photograph in a square, all of it: where it is not square itself, the
/// room left at its sides — or over and under it — is the photograph again,
/// filling the square and blurred, not a blank. One that stands on a plain
/// colour of its own has that colour there instead.
struct SquaredPhoto: View {
    let image: Image
    var ground: Color? = nil

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let ground {
                    ground
                } else {
                    // A little larger than the square, so that the blur's
                    // faded rim is outside it.
                    image.resizable().scaledToFill()
                        .scaleEffect(1.2)
                        .blur(radius: 24)
                }
            }
            .clipped()
            .overlay { image.resizable().scaledToFit() }
            .accessibilityElement(children: .ignore)
    }
}

/// What stands where a photograph will be: a grey field the size of it, with a
/// spinner while the picture is on its way and a picture's outline when there
/// is none to show.
struct PhotoPlaceholder: View {
    var loading = true

    var body: some View {
        Color(white: 0.92)
            .overlay {
                if loading {
                    RowSpinner()
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(Color(white: 0.6))
                }
            }
    }
}

/// A photograph of an item on rab as it will be once Save is pressed: its
/// subject cut out, with the bytes of the photograph as it was taken — or,
/// with none, the photograph as it was taken, put back in a cut-out's place.
///
/// Or, with no picture of its own, a cut-out that is to be taken away, its
/// photograph standing right after it still: `shows` is that photograph's
/// address, shown in the cut-out's place until then.
struct PendingPhoto {
    var image: UIImage? = nil
    var taken: Data? = nil
    var shows: String? = nil
}

/// Asks before a page is left with something on it not saved: while there
/// is, the bar's way back is the page's own, which asks first.
private struct AsksBeforeDiscarding: ViewModifier {
    let unsaved: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var asking = false

    func body(content: Content) -> some View {
        content
            .navigationBarBackButtonHidden(unsaved)
            .toolbar {
                if unsaved {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            asking = true
                        } label: {
                            Image(systemName: "chevron.left").fontWeight(.semibold)
                        }
                        .accessibilityLabel("Back")
                    }
                }
            }
            .compactDialog(isPresented: $asking, title: Text("Discard changes?"), confirm: "Discard") {
                dismiss()
            }
    }
}

extension View {
    /// While `unsaved`, going back asks whether what was changed is to be
    /// thrown away.
    func asksBeforeDiscarding(_ unsaved: Bool) -> some View {
        modifier(AsksBeforeDiscarding(unsaved: unsaved))
    }
}

/// The row that says what the main photograph stands on: "Remove background"
/// on one that is as it was taken — its subject is then cut out of its
/// background and stood on white — and "Restore background" on one that has
/// been, which puts it back. Done at once: the cut-out is made on the phone,
/// and is the item's main photograph, with the one it was made of after it.
struct BackdropRows: View {
    /// The colour the subject stands on, as "#rrggbb"; nil where the
    /// photograph is as it was taken.
    let backdrop: String?
    @Binding var error: String?
    /// Has it done: the colour, or nil for the photograph as it was taken.
    let apply: (String?) async throws -> Void

    @State private var busy = false
    /// Why it could not be done, said right under the button: the page's
    /// own line for what went wrong is at its foot, out of sight from here,
    /// and a button that only does nothing looks broken.
    @State private var failure: String?

    var body: some View {
        let removed = backdrop != nil
        Button {
            busy = true
            error = nil
            failure = nil
            Task {
                defer { busy = false }
                do {
                    try await apply(removed ? nil : BackgroundRemover.defaultBackdrop)
                } catch {
                    failure = error.localizedDescription
                }
            }
        } label: {
            HStack {
                if removed {
                    Label("Restore background", systemImage: "arrow.uturn.backward")
                } else {
                    Label("Remove background", systemImage: "person.and.background.dotted")
                }
                Spacer()
                if busy { RowSpinner() }
            }
        }
        .disabled(busy)
        // Another photograph is another matter.
        .onChange(of: backdrop) { failure = nil }

        if let failure {
            Text(failure)
                .font(Compact.small)
                .foregroundStyle(.red)
        }
    }
}

/// The row that makes the photograph shown the item's main one: its first,
/// the one its tile shows. Once it is, the photographs turn back to the
/// first, which it now is.
struct MainPhotoRow: View {
    @Binding var shown: Int
    @Binding var error: String?
    /// Makes the one at this place in the row the main one.
    let makeMain: (Int) async throws -> Void

    @State private var busy = false

    var body: some View {
        Button {
            let chosen = shown
            busy = true
            error = nil
            Task {
                defer { busy = false }
                do {
                    try await makeMain(chosen)
                    withAnimation { shown = 0 }
                } catch {
                    self.error = error.localizedDescription
                }
            }
        } label: {
            HStack {
                Label("Set as main photo", systemImage: "star")
                Spacer()
                if busy { RowSpinner() }
            }
        }
        .disabled(busy)
    }
}

/// The row that publishes one of the user's items on rab, or takes it back
/// out of sight: "Publish" on one that is not, "Unpublish" on one that is.
struct PublishRow: View {
    @Environment(AppModel.self) private var model

    let listingId: String
    @Binding var error: String?

    @State private var busy = false

    var body: some View {
        let published = model.isPublished(listingId)
        Button {
            busy = true
            error = nil
            Task {
                defer { busy = false }
                do {
                    try await model.setPublished(!published, listing: listingId)
                } catch {
                    self.error = error.localizedDescription
                }
            }
        } label: {
            HStack {
                if published {
                    Label("Unpublish", systemImage: "eye.slash")
                } else {
                    Label("Publish", systemImage: "eye")
                }
                Spacer()
                if busy { RowSpinner() }
            }
        }
        .disabled(busy)
    }
}

/// One of the user's items on rab: its photograph, what it says about itself,
/// and the way to its page.
struct ListingDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let listingId: String

    @State private var confirming = false
    @State private var deleting = false
    @State private var error: String?
    /// The box that asks where the item is is up; and its answer is on its
    /// way to rab.
    @State private var choosingPlace = false
    /// Another place chosen for it, not saved yet.
    @State private var chosenPlace: PlaceChoice?
    /// The box that asks which category is up; the one the fields say, which
    /// it ticks; and the one chosen in it, on its way into the fields.
    @State private var choosingCategory = false
    @State private var shownCategory = ""
    @State private var chosenCategory: String?
    /// The description is being written in: the button that puts the
    /// keyboard away is up.
    @State private var describing = false
    /// Something written or chosen in the fields is not saved yet.
    @State private var unsavedFields = false
    /// The photographs whose background was removed or put back, looked at
    /// and not kept yet, by their addresses: Save keeps them, and leaving
    /// the page throws them away.
    @State private var pendingPhotos: [String: PendingPhoto] = [:]
    /// What the server has just said it is, not saved yet.
    @State private var suggested: Suggestion?
    /// The photograph is being fetched to be shared; and, fetched, the file
    /// the share sheet is up for.
    @State private var fetchingPhoto = false
    @State private var sharedPhoto: SharedFile?
    /// The box that asks where more photographs come from is up; and its answer.
    @State private var askingSource = false
    @State private var photoSource: PhotoSource?
    /// The photographs are up large, over the screen.
    @State private var viewing: ViewedPhotos?
    /// Which of the photographs the page is turned to.
    @State private var shownPhoto = 0

    /// A place chosen in the box: kept by Save, and no change at all where
    /// it is the one the item is at already. Nowhere, chosen for one that
    /// stands by a pin that is none of the places, is a change.
    private func choosePlace(_ choice: PlaceChoice, for listing: Listing) {
        let current: String = model.place(of: listing)?.id ?? ""
        let pinnedElsewhere: Bool = current.isEmpty && listing.located == true
        let same: Bool = choice.id == current && !pinnedElsewhere
        chosenPlace = same ? nil : choice
    }

    var body: some View {
        if let listing = model.listing(listingId) {
            content(listing)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    /// Whether the photograph at a place in the row can be made the main
    /// one: any but the first, which is it.
    private func canBeMain(_ index: Int, of listing: Listing) -> Bool {
        index > 0 && (listing.images ?? []).indices.contains(index)
    }

    /// The colour the photograph the page is turned to stands on, where its
    /// background is removed — as it will be once saved, where the button
    /// was pressed just now: nil where it is as it was taken.
    private func shownBackdrop(of listing: Listing) -> String? {
        guard let pictures = listing.images, pictures.indices.contains(shownPhoto) else { return nil }
        let picture = pictures[shownPhoto]
        if let pending = pendingPhotos[picture.src] {
            return pending.taken == nil ? nil : BackgroundRemover.defaultBackdrop
        }
        return picture.backdrop
    }

    /// Removes the background of the photograph the page is turned to, or
    /// puts it back — here, to be looked at: nothing goes to rab until Save
    /// is pressed. Pressed again, it is as it was, and there is nothing to
    /// save of it.
    private func setBackdrop(_ hex: String?, of listing: Listing) async throws {
        guard let pictures = model.listing(listing.id)?.images, pictures.indices.contains(shownPhoto) else { return }
        let picture = pictures[shownPhoto]
        if pendingPhotos[picture.src] != nil {
            pendingPhotos[picture.src] = nil
            return
        }
        if hex != nil {
            let made = try await model.cutOutPreview(of: picture.src)
            pendingPhotos[picture.src] = PendingPhoto(image: made.image, taken: made.taken)
        } else if let original = model.originalPreview(ofCut: picture.src) {
            pendingPhotos[picture.src] = PendingPhoto(image: original, taken: nil)
        } else if let after = model.listing(listing.id)?.originalAfter(cutAt: shownPhoto) {
            // Not on this phone, but right after it on rab: a cut-out from
            // when one was put in front of its photograph. It is shown as
            // that photograph, and taken away when Save is pressed.
            pendingPhotos[picture.src] = PendingPhoto(shows: after.src)
        } else {
            throw APIError(status: 0, code: nil, message: Language.text("The original photo is not on this phone"))
        }
    }

    /// One of its photographs as the page shows it: as it will be once
    /// saved, where its background was removed or put back just now, and
    /// as rab has it otherwise.
    @ViewBuilder
    private func shownPhotograph(_ picture: Listing.Picture) -> some View {
        if let image = pendingPhotos[picture.src]?.image {
            SquaredPhoto(image: Image(uiImage: image), ground: pendingPhotos[picture.src]?.taken == nil ? nil : Color.white)
        } else if let shows = pendingPhotos[picture.src]?.shows {
            RemotePhoto(path: shows, squared: true)
        } else {
            RemotePhoto(path: picture.src, squared: true, backdrop: picture.backdrop)
        }
    }

    /// Save: what was looked at is kept on rab.
    private func savePhotos(of listing: Listing) async throws {
        var cuts: [String: (image: UIImage, taken: Data)] = [:]
        var restored: [String] = []
        var dropped: [String] = []
        for (src, pending) in pendingPhotos {
            if let image = pending.image, let taken = pending.taken {
                cuts[src] = (image, taken)
            } else if pending.shows != nil {
                dropped.append(src)
            } else {
                restored.append(src)
            }
        }
        try await model.saveBackdrops(ofListing: listing.id, cuts: cuts, restored: restored, dropped: dropped)
        pendingPhotos = [:]
    }

    /// Makes it so: the row as rab has it now, not as it was when the page
    /// was opened.
    private func makeMain(_ index: Int, of listing: Listing) async throws {
        let sources = (model.listing(listing.id)?.images ?? []).map(\.src)
        guard sources.indices.contains(index) else { return }
        try await model.setMainPhoto(sources[index], of: listing)
    }

    @ViewBuilder
    private func content(_ listing: Listing) -> some View {
        List {
            if let pictures = listing.images, !pictures.isEmpty {
                Section {
                    PhotoPager(count: pictures.count, shown: $shownPhoto) { index in
                        shownPhotograph(pictures[index])
                            // Pressed, it is shown large.
                            .contentShape(Rectangle())
                            .onTapGesture {
                                let urls = pictures.compactMap { model.imageURL($0.src) }
                                guard urls.count == pictures.count else { return }
                                viewing = ViewedPhotos(urls: urls, first: index)
                            }
                    }
                        .frame(maxWidth: .infinity)
                        // A square, whatever shape the photograph is.
                        .aspectRatio(1, contentMode: .fit)
                        .background(Color.white)
                        .listRowInsets(EdgeInsets())
                }
            }

            // What its main photograph stands on: its subject cut out of its
            // background, on a colour, or the photograph as it was taken.
            if listing.images?.isEmpty == false {
                Section {
                    // Of the photograph the page is turned to.
                    BackdropRows(backdrop: shownBackdrop(of: listing), error: $error) { hex in
                        try await setBackdrop(hex, of: listing)
                    }
                    // Under it, the brain: has it recognized again. Only a
                    // photograph can be looked at again.
                    RecognizeRow(busy: model.recognizing.contains(listing.id)) { recognize(listing) }
                    // The photograph the page is turned to, made the main
                    // one: not offered of the first, which is it — nor of
                    // the one the main cut-out was made of, which is it too.
                    if canBeMain(shownPhoto, of: listing) {
                        MainPhotoRow(shown: $shownPhoto, error: $error) { index in
                            try await makeMain(index, of: listing)
                        }
                    }
                    // And under that, the photograph itself sent on, not a
                    // link to it: fetched first, then handed to the share sheet.
                    Button {
                        sharePhoto(listing)
                    } label: {
                        HStack {
                            Label("Share the photo", systemImage: "photo")
                            Spacer()
                            if fetchingPhoto { RowSpinner() }
                        }
                    }
                    .disabled(fetchingPhoto)
                }
            }

            // Under those, in a block of its own: one more photograph of it,
            // and another — taken now, or chosen from the ones the phone has.
            Section {
                AddPhotoRows(asking: $askingSource, source: $photoSource, error: $error) { image in
                    try await model.addPhoto(image, to: listing)
                }
            }

            // In the language the app is in: what is written here is that language's.
            // Where it is, above Save: one of the account's places, to be
            // chosen — or the line by its pin, where it stands at none of
            // them. Chosen, it is kept when Save is pressed.
            ItemEditor(
                source: ItemDraft(listing.words(in: model.language), category: listing.category ?? ""),
                placeName: model.place(of: listing)?.name ?? (listing.located == false ? nil : listing.place),
                place: $chosenPlace,
                choosePlace: { choosingPlace = true },
                category: $chosenCategory,
                chooseCategory: { shownCategory = $0; choosingCategory = true },
                describing: $describing,
                suggestion: $suggested,
                save: { draft, recognized in try await model.save(draft, for: listing, recognized: recognized) },
                savePlace: { place in try await model.setPlace(place, for: listing) },
                more: !pendingPhotos.isEmpty,
                saveMore: { try await savePhotos(of: listing) },
                unsaved: $unsavedFields
            )

            // Published, or not: and only a published one has a page to be
            // opened and passed around — an unpublished one is its owner's
            // alone to see.
            Section {
                PublishRow(listingId: listing.id, error: $error)
                if listing.active == true, let page = model.pageURL(ofListing: listing.id) {
                    Link(destination: page) {
                        Label("Open on rab", systemImage: "arrow.up.right.square")
                    }
                    ShareLink(item: page) {
                        Label("Share the link", systemImage: "square.and.arrow.up")
                    }
                }
            }

            // Last, and asked about before it is done: it cannot be taken back.
            Section {
                Button(role: .destructive) {
                    confirming = true
                } label: {
                    HStack {
                        Text("Delete")
                        Spacer()
                        if deleting { RowSpinner() }
                    }
                }
                .disabled(deleting)
            } footer: {
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .listStyle(.insetGrouped)
        .labelStyle(RowLabelStyle())
        .rabBackground()
        // Compact, as the sign-in screen is: the same type, the same height
        // of row and button, the same margins.
        .compactList()
        // Pulling the page down takes the keyboard with it, and so does
        // pressing anywhere on it that is not a field.
        .scrollDismissesKeyboard(.interactively)
        .dismissesKeyboardOnTap()
        .hideKeyboardButton(shown: describing)
        .asksBeforeDiscarding(unsavedFields || !pendingPhotos.isEmpty)
        .navigationTitle(Text(verbatim: listing.words(in: model.language).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            // Asked for again by the arrow at the top, not by pulling down.
            ToolbarItem(placement: .topBarTrailing) {
                RefreshButton(scale: 1.3) { await model.loadListings() }
                    // A little lower than the middle: the arrowhead stands
                    // up over the ring, and the whole looks high without.
                    .offset(y: 1.5)
            }
        }
        // Asked in a dialog in the middle of the screen, not a sheet at its foot.
        .compactChoice(
            isPresented: $choosingPlace,
            title: Text("Location"),
            choices: PlaceChoice.all(model.places),
            name: { $0.name },
            chosen: { $0.id == (chosenPlace?.id ?? model.place(of: listing)?.id ?? "") },
            // Only chosen: Save keeps it. The one it is at already is no change.
            choose: { choosePlace($0, for: listing) }
        )
        // The categories, asked the same way: the row that shows the one it
        // is in puts this up.
        .categoryChoice(isPresented: $choosingCategory, current: shownCategory) { chosenCategory = $0 }
        .fullScreenCover(item: $viewing) { photos in
            // The addresses as they were when it was opened: the row it shows.
            let sources = (listing.images ?? []).map(\.src)
            PhotoViewer(photos: photos) { index in
                guard sources.indices.contains(index) else { return }
                try await model.removePhoto(sources[index], from: listing)
            }
        }
        .photoSourceChoice(isPresented: $askingSource, source: $photoSource)
        .sheet(item: $sharedPhoto) { photo in
            ShareSheet(file: photo.url)
                .presentationDetents([.medium, .large])
        }
        .compactDialog(
            isPresented: $confirming,
            title: Text("Delete this item?"),
            message: Text("It is deleted from rab for good, and any open bookings of it are cancelled."),
            confirm: "Delete"
        ) {
            delete(listing)
        }
    }

    /// Has its photograph looked at again, and what it says it is — its
    /// category, its few words, its name and its description — written over.
    private func recognize(_ listing: Listing) {
        error = nil
        Task {
            do {
                // Only shown, in the fields: Save keeps it.
                // By the photograph the page is turned to first — the one
                // its cut-out was made of, where it is on a cut-out.
                let pictures = listing.images ?? []
                var first: String?
                if pictures.indices.contains(shownPhoto) {
                    let cut = pictures[shownPhoto].backdrop != nil && pictures.indices.contains(shownPhoto + 1)
                    first = pictures[cut ? shownPhoto + 1 : shownPhoto].src
                }
                if let said = try await model.suggestion(for: listing, first: first) { suggested = said }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func sharePhoto(_ listing: Listing) {
        fetchingPhoto = true
        error = nil
        Task {
            defer { fetchingPhoto = false }
            do {
                sharedPhoto = SharedFile(url: try await model.photoFile(of: listing))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Once it is gone from the list, the page has nothing to show and closes.
    private func delete(_ listing: Listing) {
        deleting = true
        error = nil
        Task {
            defer { deleting = false }
            do {
                try await model.delete(listing)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// The row of an item's page that adds photographs to it. Pressed, it asks
/// where from: the camera, where the device has one — it stays open, and
/// each press of its button is one more photograph — or the photographs the
/// phone has already, several at once. What is chosen is added the moment it
/// is; what is taken, when the camera's Done is pressed.
/// Where photographs added to an item are to come from.
enum PhotoSource: String, Identifiable, CaseIterable {
    case camera, library
    var id: String { rawValue }
    var name: String { Language.text(self == .camera ? "Take a photo" : "Choose photos") }
}

extension View {
    /// The box that asks where photographs are to come from, in the middle
    /// of the screen. It is the page's to put up, not the row's: a box put
    /// up by a row of a list is drawn inside that row. What is chosen is
    /// handed to the row through `source` (see AddPhotoRows).
    func photoSourceChoice(isPresented: Binding<Bool>, source: Binding<PhotoSource?>) -> some View {
        compactChoice(
            isPresented: isPresented,
            title: Text("Add photos"),
            choices: PhotoSource.allCases,
            name: { $0.name },
            chosen: { _ in false },
            choose: { source.wrappedValue = $0 }
        )
    }
}

struct AddPhotoRows: View {
    /// The page's box is up (see `photoSourceChoice`), and what was chosen
    /// in it: taken from here, and put back to nothing, as it is acted on.
    @Binding var asking: Bool
    @Binding var source: PhotoSource?
    @Binding var error: String?
    let add: (UIImage) async throws -> Void

    @State private var taking = false
    @State private var choosing = false
    @State private var chosen: [PhotosPickerItem] = []
    /// How many of the chosen are still to be added.
    @State private var adding = 0

    var body: some View {
        Button {
            // The simulator, and anything else without a camera, has only
            // the library: there is nothing to ask.
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                asking = true
            } else {
                choosing = true
            }
        } label: {
            HStack {
                Label("Add photos", systemImage: "photo.badge.plus")
                Spacer()
                if adding > 0 { RowSpinner() }
            }
        }
        .disabled(adding > 0)
        .onChange(of: source) { _, chosen in
            guard let chosen else { return }
            source = nil
            if chosen == .camera { taking = true } else { choosing = true }
        }
        .fullScreenCover(isPresented: $taking) {
            ScannerView(spots: [], keep: add)
        }
        .photosPicker(isPresented: $choosing, selection: $chosen, maxSelectionCount: 10, matching: .images)
        .onChange(of: chosen) { _, items in
            guard !items.isEmpty else { return }
            chosen = []
            adding = items.count
            error = nil
            Task {
                // One after another, in the order they were chosen.
                for item in items {
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                            throw BackgroundRemover.Failure.noImage
                        }
                        try await add(image)
                    } catch {
                        self.error = error.localizedDescription
                    }
                    adding -= 1
                }
                adding = 0
            }
        }
    }
}

/// A file the share sheet is up for.
struct SharedFile: Identifiable {
    let url: URL
    var id: URL { url }
}

/// The system's share sheet for a file: save it, send it, copy it.
struct ShareSheet: UIViewControllerRepresentable {
    let file: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [file], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// What an item says about itself, to be written over: its name, its few
/// words for what it is, its description and its category, each under what
/// it is — and Save, which keeps them on this phone and on rab. Save is grey
/// until something has been changed.
struct ItemEditor: View {
    /// What the item says now. Where that changes under the page — the brain
    /// has recognized it again — the page shows the new, unless something
    /// has been typed here in the meantime.
    let source: ItemDraft
    /// Where the item is, as it is kept: the name its row shows until
    /// another is chosen.
    let placeName: String?
    /// Another place chosen for it, in the page's box — or nowhere — and not
    /// saved yet: nil while it is where it was. Save keeps it, with the rest.
    @Binding var place: PlaceChoice?
    /// Puts the page's box up: a box put up by a row is drawn inside it.
    let choosePlace: () -> Void
    /// A category chosen in the page's box of them: written into the fields
    /// here as soon as it is, as one typed would be, and nothing after that.
    @Binding var category: String?
    /// Puts that box up, told the category the fields say now: the one it
    /// ticks.
    let chooseCategory: (String) -> Void
    /// Whether the description is the field being written in: the page
    /// then floats a button over the keyboard that puts it away (see
    /// `hideKeyboardButton`) — return starts a new line there.
    @Binding var describing: Bool
    /// What the server has just said it is, asked by the page's Recognize:
    /// written into the fields here, and kept — in every language it was
    /// said in — when Save is pressed. Nothing goes anywhere until then.
    @Binding var suggestion: Suggestion?
    /// Whether it is on this phone only: Save then puts it on rab, changed
    /// here or not.
    let unsent: Bool
    let save: (ItemDraft, Suggestion?) async throws -> Void
    let savePlace: (Place?) async throws -> Void
    /// Whether the page has something else that Save is to keep — a
    /// photograph whose background was removed, looked at and not kept yet
    /// — and what keeps it.
    let more: Bool
    let saveMore: () async throws -> Void
    /// Told whether anything written or chosen here is not saved yet: the
    /// page asks before it is left with that thrown away.
    @Binding var unsaved: Bool

    @Environment(AppModel.self) private var model
    @State private var draft: ItemDraft
    /// One of the fields is being written in: the keyboard is up.
    /// The fields that are written in.
    private enum Field { case name, what, description }

    @FocusState private var writing: Field?
    @State private var saving = false
    @State private var error: String?

    init(
        source: ItemDraft,
        placeName: String?,
        place: Binding<PlaceChoice?>,
        choosePlace: @escaping () -> Void,
        category: Binding<String?>,
        chooseCategory: @escaping (String) -> Void,
        describing: Binding<Bool>,
        suggestion: Binding<Suggestion?>,
        unsent: Bool = false,
        save: @escaping (ItemDraft, Suggestion?) async throws -> Void,
        savePlace: @escaping (Place?) async throws -> Void,
        more: Bool = false,
        saveMore: @escaping () async throws -> Void = {},
        unsaved: Binding<Bool>
    ) {
        self.source = source
        self.placeName = placeName
        _place = place
        self.choosePlace = choosePlace
        _category = category
        self.chooseCategory = chooseCategory
        _describing = describing
        _suggestion = suggestion
        self.unsent = unsent
        self.save = save
        self.savePlace = savePlace
        self.more = more
        self.saveMore = saveMore
        _unsaved = unsaved
        _draft = State(initialValue: source)
    }

    private var written: Bool { draft.tidy != source.tidy }
    private var changed: Bool { written || place != nil || suggestion != nil }
    private var ready: Bool { (changed || unsent || more) && !saving && !draft.tidy.title.isEmpty }

    var body: some View {
        Section {
            // No grey words inside the fields: each is under what it is.
            field("Name", .name) {
                // One line and no more, in the system's own one-line field:
                // it neither grows onto a second line nor scrolls under the
                // finger, as a field that may wrap does when held to one —
                // a name too long for it is followed by the cursor. Its type
                // is said outright: left to itself this kind of box came
                // out a little smaller than the two under it when pressed.
                TextField("", text: $draft.title)
                    .font(Compact.font)
                    .submitLabel(.done)
                    .accessibilityLabel("Name")
                    .focused($writing, equals: .name)
                    // A line break pasted in is taken out as well.
                    .onChange(of: draft.title) { old, new in
                        let kept = oneLine(new, was: old)
                        if kept != draft.title { draft.title = kept }
                    }
            }
            field("What is it", .what) {
                // The same one-line field as the name over it, with the same
                // keyboard: return is "done" on both, and puts it away.
                TextField("", text: $draft.what)
                    .font(Compact.font)
                    .submitLabel(.done)
                    .accessibilityLabel("What is it")
                    .focused($writing, equals: .what)
                    .onChange(of: draft.what) { old, new in
                        var kept = oneLine(new, was: old)
                        // The server keeps no more than this.
                        if kept.count > whatMax { kept = String(kept.prefix(whatMax)) }
                        if kept != draft.what { draft.what = kept }
                    }
            }
            field("Description", .description) {
                TextField("", text: $draft.description, axis: .vertical)
                    .lineLimit(2...10)
                    .accessibilityLabel("Description")
                    .focused($writing, equals: .description)
                    // Return starts a new line here, so there is nothing on
                    // the keyboard that puts it away: the page floats a
                    // button over it while this is the field written in.
                    .onChange(of: writing) { _, now in describing = now == .description }
                    .onDisappear { describing = false }
            }
            // Pressed, the categories are asked in the app's own box in the
            // middle of the screen, as where it is is — not the system's
            // menu, which writes what is chosen in its own, larger size.
            Button {
                writing = nil
                chooseCategory(draft.category)
            } label: {
                HStack(spacing: 4) {
                    Text("Category")
                        .foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Group {
                        if draft.category.isEmpty {
                            Text("None")
                        } else {
                            Text(Categories.name(draft.category))
                        }
                    }
                    .foregroundStyle(.secondary)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(Compact.small)
                        .foregroundStyle(.secondary)
                }
                .font(Compact.font)
                .contentShape(Rectangle())
            }
            // Where it is, last above Save: another place chosen is only
            // shown here until Save keeps it.
            LocationRow(name: place.map(\.name) ?? placeName, busy: false, action: choosePlace)
        } footer: {
            if let error { Text(error).foregroundStyle(.red) }
        }
        .textInputAutocapitalization(.sentences)
        .onChange(of: source) { old, new in
            // Only what was not being written over follows.
            if draft.tidy == old.tidy, suggestion == nil { draft = new }
        }
        .onChange(of: changed, initial: true) { _, now in unsaved = now }
        .onDisappear { unsaved = false }
        .onChange(of: category) { _, chosen in
            // Chosen in the page's box: it is what the fields say now.
            guard let chosen else { return }
            draft.category = chosen
            category = nil
        }
        .onChange(of: suggestion) { _, said in
            // Recognized: what it is said to be is written into the fields,
            // in the language the app is in, for Save to keep.
            guard let said else { return }
            draft = ItemDraft(said.words(in: model.language), category: said.category)
        }

        // White on black once there is something to save; grey until then.
        Section {
            Button(action: commit) {
                HStack {
                    Text("Save")
                    Spacer()
                    if saving { RowSpinner().tint(.white) }
                }
                .foregroundStyle(.white)
                .contentShape(Rectangle())
            }
            .buttonStyle(StillButtonStyle())
            .allowsHitTesting(ready)
            .listRowBackground(ready ? Color.black : Color(white: 0.78))
        }
    }

    /// What was written in a field that is one line's worth, without its
    /// line breaks. Return pressed — a break typed into what was there —
    /// adds nothing, and puts the keyboard away: the field is done. Breaks
    /// that came with something pasted become spaces.
    private func oneLine(_ new: String, was old: String) -> String {
        guard new.contains("\n") else { return new }
        if new.replacingOccurrences(of: "\n", with: "") == old {
            writing = nil
            return old
        }
        return new.replacingOccurrences(of: "\n", with: " ")
    }

    /// A field under what it is. Pressing what it is — or anywhere else in
    /// its row — writes in it, as pressing the field itself does.
    private func field(_ label: LocalizedStringKey, _ which: Field, @ViewBuilder _ input: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Compact.small)
                .foregroundStyle(.secondary)
            input()
        }
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture {
            // A moment later: the page puts the keyboard away at any press
            // that is not in a field (see KeyboardDismiss), this one too,
            // and the field is to be written in after that, not before.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(50))
                writing = which
            }
        }
    }

    private func commit() {
        guard ready else { return }
        writing = nil
        let tidy = draft.tidy
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                // The photographs first: what the page looked at is kept.
                if more { try await saveMore() }
                if written || suggestion != nil || unsent {
                    try await save(tidy, suggestion)
                    draft = tidy
                    suggestion = nil
                }
                if let chosen = place {
                    try await savePlace(chosen.place)
                    place = nil
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// One of the choices of where an item is: one of the account's places, or
/// nowhere.
/// One of the categories an item may be put in, as a line in the box that
/// asks: its slug, or nothing for none.
struct CategoryChoice: Identifiable {
    let id: String

    var name: String { id.isEmpty ? Language.text("None") : Categories.text(id) }

    /// None, then the object categories — and whatever other one the item
    /// is in already, first of them.
    static func all(with current: String) -> [CategoryChoice] {
        let known = Categories.objects.contains(current) || current.isEmpty ? Categories.objects : [current] + Categories.objects
        return [CategoryChoice(id: "")] + known.map { CategoryChoice(id: $0) }
    }
}

extension View {
    /// Asks which category, in the app's own box in the middle of the
    /// screen: `current` is the one ticked.
    func categoryChoice(isPresented: Binding<Bool>, current: String, choose: @escaping (String) -> Void) -> some View {
        compactChoice(
            isPresented: isPresented,
            title: Text("Category"),
            choices: CategoryChoice.all(with: current),
            name: { $0.name },
            chosen: { $0.id == current },
            choose: { choose($0.id) }
        )
    }
}

struct PlaceChoice: Identifiable {
    let place: Place?
    var id: String { place?.id ?? "" }
    var name: String { place?.name ?? Language.text("None") }

    /// Nowhere first, then the account's places in their own order.
    static func all(_ places: [Place]) -> [PlaceChoice] {
        [PlaceChoice(place: nil)] + places.map { PlaceChoice(place: $0) }
    }
}

/// The row of an item's page that says where it is, and opens the choice of
/// where: one of the account's places, by name — or, for an item that stands
/// somewhere that is none of them, the line by its pin.
struct LocationRow: View {
    let name: String?
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text("Location")
                Spacer(minLength: 8)
                Group {
                    if let name, !name.isEmpty {
                        Text(verbatim: name).lineLimit(1)
                    } else {
                        Text("None")
                    }
                }
                .foregroundStyle(.secondary)
                if busy {
                    RowSpinner()
                } else {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(Compact.small)
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(StillButtonStyle())
        .disabled(busy)
    }
}

/// The row with the brain: has a photographed thing recognized again. A
/// wheel turns at its end while the server is looking.
struct RecognizeRow: View {
    /// Whether it has been recognized before: "Recognize again" then, and
    /// "Recognize" of one that has not been yet.
    var again = true
    let busy: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Label {
                    if again { Text("Recognize again") } else { Text("Recognize") }
                } icon: {
                    BrainIcon()
                }
                Spacer()
                if busy { RowSpinner() }
            }
        }
        .disabled(busy)
    }
}
