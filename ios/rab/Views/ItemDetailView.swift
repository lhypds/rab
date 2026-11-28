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
    @State private var placing = false
    /// The photographs are up large, over the screen.
    @State private var viewing: ViewedPhotos?

    var body: some View {
        if let item = model.item(itemId) {
            content(item)
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    @ViewBuilder
    private func content(_ item: SavedItem) -> some View {
        List {
            Section {
                let photos = item.allPhotos
                PhotoPager(count: photos.count) { index in
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

            // In the language the app is in: what is written here is that language's.
            ItemEditor(source: ItemDraft(item.words(in: model.language), category: item.category ?? "")) { draft in
                try await model.save(draft, for: item)
            }

            Section {
                // Where it is: the one of the account's places it was collected
                // at, where it was at one — and any of them, or none, chosen here.
                LocationRow(name: model.place(item.locationId)?.name, busy: placing) {
                    choosingPlace = true
                }
                let spots = item.collectedFor.compactMap { model.spot($0)?.title }
                if !spots.isEmpty {
                    LabeledContent("Spot", value: spots.joined(separator: ", "))
                }
                LabeledContent("Taken", value: item.createdAt.formatted(date: .abbreviated, time: .shortened))
            }

            Section {
                if let page = model.pageURL(of: item) {
                    Link(destination: page) {
                        Label("Open on rab", systemImage: "arrow.up.right.square")
                    }
                    ShareLink(item: page) {
                        Label("Share the link", systemImage: "square.and.arrow.up")
                    }
                } else {
                    Button {
                        publish(item)
                    } label: {
                        HStack {
                            Label("Add to my items on rab", systemImage: "plus")
                            Spacer()
                            if publishing { ProgressView() }
                        }
                    }
                    // What has no name yet has nothing to be listed as.
                    .disabled(publishing || !item.isRecognized || model.recognizing.contains(item.id))
                }
                // One more photograph of it, and another: taken now, or
                // chosen from the ones the phone has.
                AddPhotoRows(error: $error) { image in
                    try await model.addPhoto(image, to: item)
                }
            } footer: {
                if !item.isRecognized {
                    Text("Not recognized yet. The brain at the top says what it is, and it then goes onto rab.")
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
            ToolbarItem(placement: .topBarTrailing) {
                RecognizeButton(busy: model.recognizing.contains(item.id)) { recognize(item) }
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
            chosen: { $0.id == (model.place(item.locationId)?.id ?? "") },
            choose: { choice in
                placing = true
                error = nil
                Task {
                    defer { placing = false }
                    do {
                        try await model.setPlace(choice.place, for: item)
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        )
        .compactDialog(isPresented: $deleting, title: Text("Delete this item?"), confirm: "Delete") {
            model.delete(item)
            dismiss()
        }
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
