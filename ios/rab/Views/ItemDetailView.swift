import SwiftUI

/// One item: its photograph, what it says about itself, and where it stands —
/// on this phone only, or in the user's items on rab too.
struct ItemDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let itemId: String

    @State private var error: String?
    @State private var deleting = false
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
    /// What the server has just said it is, not saved yet.
    @State private var suggested: Suggestion?
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

    /// Which of its photographs the page is turned to. The page shows each
    /// one's cut-out in its place, where it has one: there are as many pages
    /// as photographs.
    private func shownOriginal(of item: SavedItem) -> Int {
        item.allPhotos.indices.contains(shownPhoto) ? shownPhoto : 0
    }

    /// The colour the photograph the page is turned to stands on, where its
    /// background has been removed: nil where it is as it was taken.
    private func shownBackdrop(of item: SavedItem) -> String? {
        let index = shownOriginal(of: item)
        guard let remoteId = item.remoteId else {
            // Not on rab yet: the cut-outs are the phone's own.
            guard item.allPhotos.indices.contains(index), item.cut(of: item.allPhotos[index]) != nil else { return nil }
            return (index == 0 ? item.backdropColor : nil) ?? BackgroundRemover.defaultBackdrop
        }
        // On rab: the one in the same place there says.
        guard let pictures = model.listing(remoteId)?.images, pictures.indices.contains(index) else { return nil }
        return pictures[index].backdrop
    }

    /// Removes the background of the photograph the page is turned to, or
    /// puts it back. What comes of it is in the same place: the page stays
    /// where it is.
    private func setBackdrop(_ hex: String?, of item: SavedItem) async throws {
        try await model.setBackdrop(hex, of: item, photo: shownOriginal(of: item))
    }

    @ViewBuilder
    private func content(_ item: SavedItem) -> some View {
        List {
            Section {
                // Each as its cut-out, where its background has been removed.
                let photos = item.shownPhotos
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
                // Of the photograph the page is turned to.
                BackdropRows(backdrop: shownBackdrop(of: item), error: $error) { hex in
                    try await setBackdrop(hex, of: item)
                }
                // The photograph the page is turned to, made the main one:
                // not offered of the first, which is it, nor of its cut-out.
                if shownOriginal(of: item) > 0, item.shownPhotos.indices.contains(shownPhoto) {
                    MainPhotoRow(shown: $shownPhoto, error: $error) { index in
                        // The photograph itself, where the page is on its cut-out.
                        guard let now = model.item(item.id), now.shownPhotos.indices.contains(index),
                              let name = now.original(ofShown: now.shownPhotos[index])
                        else { return }
                        try await model.setMainPhoto(name, of: item)
                    }
                }
                // Under it, the brain: has it recognized again.
                RecognizeRow(again: item.isRecognized, busy: model.recognizing.contains(item.id)) { recognize(item) }
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
                category: $chosenCategory,
                chooseCategory: { shownCategory = $0; choosingCategory = true },
                describing: $describing,
                suggestion: $suggested,
                // Not on rab yet: Save puts it there, as it is.
                unsent: item.remoteId == nil,
                save: { draft, recognized in try await model.save(draft, for: item, recognized: recognized) },
                savePlace: { place in try await model.setPlace(place, for: item) },
                unsaved: $unsavedFields
            )

            if let remoteId = item.remoteId {
                Section {
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
                }
            }

            if let error {
                Section {
                    Text(error).foregroundStyle(.red)
                }
            }

            Section {
                Button("Delete", role: .destructive) { deleting = true }
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
        .asksBeforeDiscarding(unsavedFields)
        .navigationTitle(item.isRecognized ? Text(verbatim: item.words(in: model.language).title) : Text("Not recognized yet"))
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
        .fullScreenCover(item: $viewing) { photos in
            // The files' names as they were when it was opened: the row it shows.
            let names = photos.urls.map(\.lastPathComponent)
            PhotoViewer(photos: photos) { index in
                // The photograph itself, where what is shown is its cut-out:
                // the two go together.
                let name = model.item(item.id)?.original(ofShown: names[index]) ?? names[index]
                try await model.removePhoto(name, from: item)
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
        // The categories, asked the same way: the row that shows the one it
        // is in puts this up.
        .categoryChoice(isPresented: $choosingCategory, current: shownCategory) { chosenCategory = $0 }
        .photoSourceChoice(isPresented: $askingSource, source: $photoSource)
        .compactDialog(
            isPresented: $deleting,
            title: Text("Delete this item?"),
            message: item.remoteId == nil ? nil : Text("It is deleted from rab for good, and any open bookings of it are cancelled."),
            confirm: "Delete"
        ) {
            // From rab as well, where it is there: the page closes once it
            // is gone, and stays with the reason where it could not be.
            error = nil
            Task {
                do {
                    try await model.remove(item)
                    dismiss()
                } catch {
                    self.error = error.localizedDescription
                }
            }
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
                // Only shown, in the fields: Save keeps it, and sends it up.
                // By the photograph the page is turned to first.
                if let said = try await model.suggestion(for: item, first: shownOriginal(of: item)) { suggested = said }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
