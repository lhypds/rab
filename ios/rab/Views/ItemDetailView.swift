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
                PhotoView(item: item)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 200)
                    .background(Color.white)
                    .listRowInsets(EdgeInsets())
            }

            // Its few words for what it is, then its description, as the website shows them.
            let what = item.what ?? "", description = item.description ?? ""
            if !what.isEmpty || !description.isEmpty {
                Section {
                    if !what.isEmpty { Text(what).fontWeight(.semibold) }
                    if !description.isEmpty { Text(description) }
                }
            }

            Section {
                // Always there; "None" where it has none.
                LabeledContent("Category") {
                    if let category = item.category, !category.isEmpty {
                        Text(Categories.name(category))
                    } else {
                        Text("None")
                    }
                }
                if let spot = model.spot(item.spotId) {
                    LabeledContent("Spot", value: spot.title)
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
                if let url = model.store?.photoURL(item) {
                    ShareLink(item: url) {
                        Label("Share the photo", systemImage: "photo")
                    }
                }
            } footer: {
                if !item.isRecognized {
                    Text("Not recognized yet. The brain at the top says what it is, and it then goes onto rab.")
                } else if item.remoteId == nil {
                    Text("On this phone only, in your folder under data.")
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
        .rabBackground()
        // Compact, as the sign-in screen is: the same type, the same height
        // of row and button, the same margins.
        .compactList()
        .navigationTitle(item.isRecognized ? Text(item.title) : Text("Not recognized yet"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                RecognizeButton(busy: model.recognizing.contains(item.id)) { recognize(item) }
            }
        }
        // Asked in a dialog in the middle of the screen, not a sheet at its foot.
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
