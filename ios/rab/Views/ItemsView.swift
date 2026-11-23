import PhotosUI
import SwiftUI

/// A photo on its way to becoming an item.
private struct Capture: Identifiable {
    let id = UUID()
    /// Nil opens the camera; a picture skips it.
    let image: UIImage?
}

/// Where a row of the list leads: an item on rab, or one on this phone only.
private enum Route: Hashable {
    case listing(String)
    case saved(String)
}

/// The user's items — loaded from rab, with whatever is still on this phone
/// only under them — and the camera.
struct ItemsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    @State private var capture: Capture?
    @State private var picked: PhotosPickerItem?
    @State private var signingOut = false
    /// The phone will not say where it is, which rab needs to say where an
    /// item is offered: said under the bar until Settings says otherwise.
    @State private var locationDenied = false

    private var listings: [Listing] { model.listings ?? [] }

    /// The items kept on this phone that the server's list does not have: all
    /// of them until the server has answered, and after that the ones that
    /// were never put on rab.
    private var onPhone: [SavedItem] {
        model.listings == nil ? model.items : model.items.filter { $0.remoteId == nil }
    }

    var body: some View {
        NavigationStack {
            Group {
                if listings.isEmpty && onPhone.isEmpty && model.listingsError == nil {
                    ContentUnavailableView {
                        Text("Nothing yet")
                            .fontWeight(.bold)
                            .padding(.bottom, 6)
                    } description: {
                        Text("Take a photo of something you have to rent out. You can give it a plain background, and it goes into your items.")
                    } actions: {
                        if CameraPicker.isAvailable {
                            Button("Take a photo") { capture = Capture(image: nil) }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    List {
                        if let problem = model.listingsError {
                            Text("Your items could not be loaded from rab: \(problem)")
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                        // What rab has: the user's items as the website lists them.
                        ForEach(listings) { listing in
                            NavigationLink(value: Route.listing(listing.id)) {
                                ListingRow(listing: listing)
                            }
                        }
                        // And what is still on this phone only.
                        ForEach(onPhone) { item in
                            NavigationLink(value: Route.saved(item.id)) {
                                ItemRow(item: item)
                            }
                        }
                        .onDelete { offsets in
                            for item in offsets.map({ onPhone[$0] }) { model.delete(item) }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await model.loadListings() }
                }
            }
            .navigationTitle("My items")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .listing(let id): ListingDetailView(listingId: id)
                case .saved(let id): ItemDetailView(itemId: id)
                }
            }
            // Asked each time the list comes on screen.
            .task { await model.loadListings() }
            .task { await model.loadLocations() }
            // Where the phone is, rab has to know: it is the area a new item is
            // offered in. So the system's question is put as soon as somebody
            // is signed in, not first met in the middle of a form — and where
            // the answer is no, the list says so until Settings says yes.
            .task {
                await Area.ask()
                locationDenied = Area.denied
            }
            .onChange(of: scenePhase) { _, phase in
                // Back from Settings, say.
                if phase == .active { locationDenied = Area.denied }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    RabHeader {
                        PhotosPicker(selection: $picked, matching: .images) {
                            Image(systemName: "photo")
                        }
                        .accessibilityLabel("Choose a photo")
                        if CameraPicker.isAvailable {
                            Button { capture = Capture(image: nil) } label: {
                                Image(systemName: "camera")
                            }
                            .accessibilityLabel("Take a photo")
                        }
                        Menu {
                            Text(model.username ?? "")
                            Button("Sign out", role: .destructive) { signingOut = true }
                        } label: {
                            Image(systemName: "person")
                        }
                    }
                    if locationDenied {
                        LocationNotice()
                    }
                }
            }
            // The header is the bar here; the title is still what the item's
            // page calls the way back.
            .toolbar(.hidden, for: .navigationBar)
            .fullScreenCover(item: $capture) { capture in
                CaptureFlow(image: capture.image)
            }
            .onChange(of: picked) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        capture = Capture(image: image)
                    }
                    picked = nil
                }
            }
            .confirmationDialog("Sign out?", isPresented: $signingOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            } message: {
                Text("Your items stay in your folder on this phone.")
            }
        }
    }
}

/// What stands under the bar while the phone may not say where it is: why rab
/// asks, and the way to Settings, which is the only place the answer changes.
private struct LocationNotice: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("rab needs your location: it is the area a new item is offered in.")
            Spacer(minLength: 0)
            if let settings = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: settings)
                    .fixedSize()
            }
        }
        .font(.footnote)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(white: 0.96))
        .overlay(alignment: .bottom) { Divider() }
    }
}

/// The camera, then the new item's form, in one presentation: a photo taken
/// goes straight on to its form without the screen going back in between.
private struct CaptureFlow: View {
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?

    init(image: UIImage?) {
        _image = State(initialValue: image)
    }

    var body: some View {
        if let image {
            NewItemView(original: image)
        } else {
            CameraPicker { taken in
                if let taken { image = taken } else { dismiss() }
            }
            .ignoresSafeArea()
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

/// One of the user's items on rab, as a row.
struct ListingRow: View {
    let listing: Listing

    var body: some View {
        HStack(spacing: 12) {
            RemotePhoto(path: listing.thumb ?? listing.images?.first?.thumb ?? listing.images?.first?.src, fills: true)
                .frame(width: 56, height: 56)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.85)))
            VStack(alignment: .leading, spacing: 4) {
                Text(listing.title).lineLimit(1)
                // The price only where the item has one.
                ((listing.price ?? 0) > 0
                    ? Text(priceText(listing.price ?? 0, listing.currency ?? "")) + Text(verbatim: " · ") + Text((listing.kind ?? .item).name)
                    : Text((listing.kind ?? .item).name))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            // Said of the ones that are on the map; one that is not says nothing.
            if listing.active != false {
                Text("Published").font(.caption2)
            }
        }
        .padding(.vertical, 4)
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

            if let description = listing.description, !description.isEmpty {
                Section {
                    Text(description)
                }
            }

            Section {
                LabeledContent("Kind") { Text((listing.kind ?? .item).name) }
                // Always there, under the kind it belongs to; "None" where it has none.
                LabeledContent("Category") {
                    if let category = listing.category, !category.isEmpty {
                        Text(Categories.name(category))
                    } else {
                        Text("None")
                    }
                }
                if let place = listing.place, !place.isEmpty {
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
        // Spaced as the new item's form is: the same gap between the cards,
        // and the photograph as far under the bar.
        .listSectionSpacing(12)
        .contentMargins(.top, 16, for: .scrollContent)
        .navigationTitle(listing.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        // Asked in a dialog in the middle of the screen, not a sheet at its foot.
        .alert("Delete this item?", isPresented: $confirming) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { delete(listing) }
        } message: {
            Text("It is deleted from rab for good, and any open bookings of it are cancelled.")
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

struct ItemRow: View {
    let item: SavedItem

    var body: some View {
        HStack(spacing: 12) {
            PhotoView(item: item, maxPixel: 96, fills: true)
                .frame(width: 56, height: 56)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.85)))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title).lineLimit(1)
                // The price only where the item has one: the form asks for none.
                (item.price > 0
                    ? Text(priceText(item.price, item.currency)) + Text(verbatim: " · ") + Text((item.kind ?? .item).name)
                    : Text((item.kind ?? .item).name))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(item.remoteId == nil ? "on this phone" : "Published")
                .font(.caption2)
                .foregroundStyle(item.remoteId == nil ? .secondary : .primary)
        }
        .padding(.vertical, 4)
    }
}
