import SwiftUI

/// One item: its photograph, what it says about itself, and where it stands —
/// on this phone only, or in the user's items on rab too.
struct ItemDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let itemId: String

    @State private var publishing = false
    @State private var error: String?
    @State private var deleting = false
    /// The box that asks where the item is is up; and its answer is on its
    /// way to rab.
    @State private var choosingPlace = false
    /// Another place chosen for it, not saved yet.
    @State private var chosenPlace: PlaceChoice?
    /// The photographs are up large, over the screen.
    @State private var viewing: ViewedPhotos?
    /// Which of the photographs the page is turned to.
    @State private var shownPhoto = 0
    /// The box that asks where more photographs come from is up; and its answer.
    @State private var askingSource = false
    @State private var photoSource: PhotoSource?

    var body: some View {
        if let item = model.item(itemId) {
            content(item)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    /// The colour the photograph the page is turned to stands on, where its
    /// background has been removed — or, of an item not on rab yet, is to
    /// be: nil where it is as it was taken.
    private func shownBackdrop(of item: SavedItem) -> String? {
        guard let remoteId = item.remoteId else { return shownPhoto == 0 ? item.backdropColor : nil }
        guard let listing = model.listing(remoteId) else { return nil }
        // The phone has the photographs as they were taken; rab has the
        // cut-outs among them too.
        let originals = listing.originals
        guard originals.indices.contains(shownPhoto),
              let at = listing.images?.firstIndex(where: { $0.src == originals[shownPhoto].src }),
              let cut = listing.cutOut(at: at)
        else { return nil }
        return listing.images?[cut].backdrop
    }

    @ViewBuilder
    private func content(_ item: SavedItem) -> some View {
        List {
            Section {
                let photos = item.allPhotos
                PhotoPager(count: photos.count, shown: $shownPhoto) { index in
                    PhotoView(item: item, file: photos[index], squared: true)
                        // Pressed, it is shown large.
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard let store = model.store else { return }
                            viewing = ViewedPhotos(urls: photos.map { store.photoURL(named: $0) }, first: index)
                        }
                }
                .frame(maxWidth: .infinity)
                // A square, whatever shape the photograph is.
                .aspectRatio(1, contentMode: .fit)
                .background(Color.white)
                .listRowInsets(EdgeInsets())
            }

            // What its main photograph stands on: its subject cut out of its
            // background, on a colour, or the photograph as it was taken. Of
            // one not on rab yet it is only said, and done as it goes up.
            Section {
                // Of the photograph the page is turned to. Of an item not on
                // rab yet only the main one's can be said.
                if item.remoteId != nil || shownPhoto == 0 {
                    BackdropRows(backdrop: shownBackdrop(of: item), error: $error) { hex in
                        try await model.setBackdrop(hex, of: item, photo: shownPhoto)
                    }
                }
                // The photograph the page is turned to, made the main one:
                // not offered of the first, which is it.
                if shownPhoto > 0, item.allPhotos.indices.contains(shownPhoto) {
                    MainPhotoRow(shown: $shownPhoto, error: $error) { index in
                        let names = model.item(item.id)?.allPhotos ?? []
                        guard names.indices.contains(index) else { return }
                        try await model.setMainPhoto(names[index], of: item)
                    }
                }
                // Under it, the brain: has it recognized again.
                RecognizeRow(busy: model.recognizing.contains(item.id)) { recognize(item) }
            } footer: {
                if item.remoteId == nil, item.backdropColor != nil {
                    Text("The background is removed when it goes onto rab.")
                }
            }

            // In the language the app is in: what is written here is that language's.
            // Under those, in a block of its own: one more photograph of it,
            // and another — taken now, or chosen from the ones the phone has.
            Section {
                AddPhotoRows(asking: $askingSource, source: $photoSource, error: $error) { image in
                    try await model.addPhoto(image, to: item)
                }
            }

            // Where it is, above Save: the one of the account's places it was
            // collected at, where it was at one — and any of them, or none,
            // chosen here, and kept when Save is pressed.
            ItemEditor(
                source: ItemDraft(item.words(in: model.language), category: item.category ?? ""),
                placeName: model.place(item.locationId)?.name,
                place: $chosenPlace,
                choosePlace: { choosingPlace = true },
                save: { draft in try await model.save(draft, for: item) },
                savePlace: { place in try await model.setPlace(place, for: item) }
            )

            Section {
                let spots = item.collectedFor.compactMap { model.spot($0)?.title }
                if !spots.isEmpty {
                    LabeledContent("Spot", value: spots.joined(separator: ", "))
                }
                LabeledContent("Taken", value: item.createdAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section {
                if let remoteId = item.remoteId {
                    // In the user's items on rab: published from here, or
                    // not — and only a published one has a page to be
                    // opened and passed around.
                    PublishRow(listingId: remoteId, error: $error)
                    if model.isPublished(remoteId), let page = model.pageURL(of: item) {
                        Link(destination: page) {
                            Label("Open on rab", systemImage: "arrow.up.right.square")
                        }
                        ShareLink(item: page) {
                            Label("Share the link", systemImage: "square.and.arrow.up")
                        }
                    }
                } else {
                    Button {
                        publish(item)
                    } label: {
                        HStack {
                            Label("Add to my items on rab", systemImage: "plus")
                            Spacer()
                            if publishing { ProgressView().controlSize(.small) }
                        }
                    }
                    // What has no name yet has nothing to be listed as.
                    .disabled(publishing || !item.isRecognized || model.recognizing.contains(item.id))
                }
            } footer: {
                if !item.isRecognized {
                    Text("Not recognized yet. Recognize says what it is, and it then goes onto rab.")
                }
            }

            if let error {
                Section {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section {
                Button("Delete", role: .destructive) { deleting = true }
            } footer: {
                if item.remoteId != nil {
                    Text("Deletes it from this phone. On rab it stays until you take it down there.")
                }
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
        .navigationTitle(item.isRecognized ? Text(verbatim: item.words(in: model.language).title) : Text("Not recognized yet"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            // Asked for again by the arrow at the top, not by pulling down.
            ToolbarItem(placement: .topBarTrailing) {
                RefreshButton(scale: 1.3) { await model.loadListings() }
            }
        }
        .fullScreenCover(item: $viewing) { photos in
            // The files' names as they were when it was opened: the row it shows.
            let names = photos.urls.map(\.lastPathComponent)
            PhotoViewer(photos: photos) { index in
                try await model.removePhoto(names[index], from: item)
            }
        }
        // Asked in a dialog in the middle of the screen, not a sheet at its foot.
        .compactChoice(
            isPresented: $choosingPlace,
            title: Text("Location"),
            choices: PlaceChoice.all(model.places),
            name: { $0.name },
            chosen: { isShownPlace($0, of: item) },
            // Only chosen: Save keeps it.
            choose: { choosePlace($0, for: item) }
        )
        .photoSourceChoice(isPresented: $askingSource, source: $photoSource)
        .compactDialog(isPresented: $deleting, title: Text("Delete this item?"), confirm: "Delete") {
            model.delete(item)
            dismiss()
        }
    }

    /// Whether a place in the box is the one the page shows: the one chosen
    /// and not saved yet, or else the one the item is at.
    private func isShownPlace(_ choice: PlaceChoice, of item: SavedItem) -> Bool {
        let current: String = model.place(item.locationId)?.id ?? ""
        let shown: String = chosenPlace?.id ?? current
        return choice.id == shown
    }

    /// A place chosen in the box: kept by Save, and no change at all where
    /// it is the one the item is at already.
    private func choosePlace(_ choice: PlaceChoice, for item: SavedItem) {
        let current: String = model.place(item.locationId)?.id ?? ""
        chosenPlace = choice.id == current ? nil : choice
    }

    /// Has the photograph looked at again, and what the item says it is
    /// written over; one collected for a spot goes onto rab with it.
    private func recognize(_ item: SavedItem) {
        error = nil
        Task {
            do {
                try await model.recognize(item)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func publish(_ item: SavedItem) {
        publishing = true
        error = nil
        Task {
            defer { publishing = false }
            do {
                try await model.publish(item)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
