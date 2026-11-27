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
                        // What is still on this phone only, marked with a dot.
                        ForEach(onPhone.filter { shows($0.category, recognized: $0.isRecognized) }) { item in
                            NavigationLink(value: Route.saved(item.id)) {
                                ItemTile(name: item.words(in: model.language).title, busy: model.recognizing.contains(item.id), waiting: true) {
                                    PhotoView(item: item, maxPixel: 120, fills: true)
                                }
                            }
                        }
                        // What rab has: the user's items as the website lists them.
                        ForEach(listings.filter { shows($0.category, recognized: true) }) { listing in
                            NavigationLink(value: Route.listing(listing.id)) {
                                ItemTile(name: listing.words(in: model.language).title, busy: model.recognizing.contains(listing.id), waiting: false) {
                                    RemotePhoto(path: listing.thumb ?? listing.images?.first?.thumb ?? listing.images?.first?.src, fills: true)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
            .refreshable { await model.loadListings() }
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
        NavigationStack {
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
                        // The marker: which spot things are collected onto.
                        // Chosen here, and nothing more — the tick says which.
                        Button { choosingSpot = true } label: {
                            HStack(spacing: 3) {
                                SpotIcon()
                                // Which one it is, beside it: on one line, cut
                                // short where the bar has no more room.
                                if let spot = model.targetSpot {
                                    Text(verbatim: spot.title)
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
                        // The camera that collects, one thing after another.
                        Button { collecting = true } label: {
                            BarIcon(name: "camera.viewfinder")
                        }
                        .accessibilityLabel("Start collecting")
                        // The brain: everything not on rab yet is recognized
                        // and sent up. How many there are stands by it.
                        Button(action: recognizeAll) {
                            HStack(spacing: 3) {
                                if model.recognizingAll {
                                    ProgressView().controlSize(.small).frame(width: BarIcon.side, height: BarIcon.side)
                                } else {
                                    BarIcon(name: "brain")
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
            // The header is the bar here; the title is still what the item's
            // page calls the way back.
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(isPresented: $collecting) {
                ScannerView(spot: model.targetSpot)
            }
            // The account, in the middle of the screen: whose it is, and the
            // way out of it.
            // Which spot things are collected onto, asked the same way.
            .compactChoice(
                isPresented: $choosingSpot,
                title: Text("Collect onto"),
                choices: model.spots,
                name: { $0.title },
                chosen: { $0.id == model.targetSpot?.id },
                choose: { model.setTargetSpot($0.id) }
            )
            .compactChoice(
                isPresented: $choosingLanguage,
                title: Text("Language"),
                choices: Language.allCases,
                name: { $0.name },
                chosen: { $0 == model.language },
                choose: { model.language = $0 }
            )
            .compactDialog(
                isPresented: $account,
                title: Text(verbatim: model.username ?? ""),
                message: Text("Your items stay in your folder on this phone."),
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

    private func recognizeAll() {
        trouble = nil
        Task {
            if let result = await model.recognizeAll() {
                trouble = Language.text("\(result.failed) could not be done: \(result.why)")
            }
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

    var body: some View {
        AsyncImage(url: model.imageURL(path)) { phase in
            switch phase {
            case .success(let image):
                if fills {
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

/// What stands where a photograph will be: a grey field the size of it, with a
/// spinner while the picture is on its way and a picture's outline when there
/// is none to show.
struct PhotoPlaceholder: View {
    var loading = true

    var body: some View {
        Color(white: 0.92)
            .overlay {
                if loading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(Color(white: 0.6))
                }
            }
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

    var body: some View {
        if let listing = model.listing(listingId) {
            content(listing)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ listing: Listing) -> some View {
        List {
            if let picture = listing.images?.first {
                Section {
                    RemotePhoto(path: picture.src)
                        .frame(maxWidth: .infinity)
                        // The room the picture will take, kept for it while it loads.
                        .aspectRatio(max(0.2, (picture.width ?? 4) / max(1, picture.height ?? 3)), contentMode: .fit)
                        .background(Color.white)
                        .listRowInsets(EdgeInsets())
                }
            }

            // In the language the app is in: what is written here is that language's.
            ItemEditor(source: ItemDraft(listing.words(in: model.language), category: listing.category ?? "")) { draft in
                try await model.save(draft, for: listing)
            }

            if let place = listing.place, !place.isEmpty {
                Section {
                    LabeledContent("Location", value: place)
                }
            }

            if let page = model.pageURL(ofListing: listing.id) {
                Section {
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
                        if deleting { ProgressView() }
                    }
                }
                .disabled(deleting)
            } footer: {
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
        .listStyle(.insetGrouped)
        .rabBackground()
        // Compact, as the sign-in screen is: the same type, the same height
        // of row and button, the same margins.
        .compactList()
        // Pulling the page down takes the keyboard with it.
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(Text(verbatim: listing.words(in: model.language).title))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            // Only a photograph can be looked at again.
            if listing.images?.isEmpty == false {
                ToolbarItem(placement: .topBarTrailing) {
                    RecognizeButton(busy: model.recognizing.contains(listing.id)) { recognize(listing) }
                }
            }
        }
        // Asked in a dialog in the middle of the screen, not a sheet at its foot.
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
                try await model.recognize(listing)
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

/// What an item says about itself, to be written over: its name, its few
/// words for what it is, its description and its category, each under what
/// it is — and Save, which keeps them on this phone and on rab. Save is grey
/// until something has been changed.
struct ItemEditor: View {
    /// What the item says now. Where that changes under the page — the brain
    /// has recognized it again — the page shows the new, unless something
    /// has been typed here in the meantime.
    let source: ItemDraft
    let save: (ItemDraft) async throws -> Void

    @State private var draft: ItemDraft
    /// One of the fields is being written in: the keyboard is up.
    @FocusState private var writing: Bool
    @State private var saving = false
    @State private var error: String?

    init(source: ItemDraft, save: @escaping (ItemDraft) async throws -> Void) {
        self.source = source
        self.save = save
        _draft = State(initialValue: source)
    }

    private var changed: Bool { draft.tidy != source.tidy }
    private var ready: Bool { changed && !saving && !draft.tidy.title.isEmpty }

    /// The object categories, and whatever other one it is in already.
    private var categories: [String] {
        Categories.objects.contains(draft.category) || draft.category.isEmpty ? Categories.objects : [draft.category] + Categories.objects
    }

    var body: some View {
        Section {
            // No grey words inside the fields: each is under what it is.
            field("Name") {
                TextField("", text: $draft.title, axis: .vertical)
                    .lineLimit(1...3)
                    .accessibilityLabel("Name")
                    .focused($writing)
                    // Over the keyboard, the way to put it away: a field of
                    // several lines has no key that does.
                    .toolbar {
                        ToolbarItemGroup(placement: .keyboard) {
                            Spacer()
                            Button("Done") { writing = false }
                        }
                    }
            }
            field("What is it") {
                TextField("", text: $draft.what)
                    .accessibilityLabel("What is it")
                    .focused($writing)
                    .submitLabel(.done)
                    // The server keeps no more than this.
                    .onChange(of: draft.what) { if draft.what.count > whatMax { draft.what = String(draft.what.prefix(whatMax)) } }
            }
            field("Description") {
                TextField("", text: $draft.description, axis: .vertical)
                    .lineLimit(2...10)
                    .accessibilityLabel("Description")
                    .focused($writing)
            }
            // A menu whose own label is the row: the system's picker writes
            // what is chosen in its own size, larger than the page's.
            Menu {
                Picker("Category", selection: $draft.category) {
                    Text("None").tag("")
                    ForEach(categories, id: \.self) { slug in
                        Text(Categories.name(slug)).tag(slug)
                    }
                }
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
        } footer: {
            if let error { Text(error).foregroundStyle(.red) }
        }
        .textInputAutocapitalization(.sentences)
        .onChange(of: source) { old, new in
            // Only what was not being written over follows.
            if draft.tidy == old.tidy { draft = new }
        }

        // White on black once there is something to save; grey until then.
        Section {
            Button(action: commit) {
                HStack {
                    Text("Save")
                    Spacer()
                    if saving { ProgressView().tint(.white) }
                }
                .foregroundStyle(.white)
                .contentShape(Rectangle())
            }
            .buttonStyle(StillButtonStyle())
            .allowsHitTesting(ready)
            .listRowBackground(ready ? Color.black : Color(white: 0.78))
        }
    }

    private func field(_ label: LocalizedStringKey, @ViewBuilder _ input: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Compact.small)
                .foregroundStyle(.secondary)
            input()
        }
        .padding(.vertical, 2)
    }

    private func commit() {
        guard ready else { return }
        writing = false
        let tidy = draft.tidy
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                try await save(tidy)
                draft = tidy
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// The brain: has a photographed thing recognized again. It turns while the
/// server is looking.
struct RecognizeButton: View {
    let busy: Bool
    let action: () -> Void

    var body: some View {
        if busy {
            ProgressView()
        } else {
            Button(action: action) {
                Image(systemName: "brain")
            }
            .accessibilityLabel("Recognize again")
        }
    }
}
