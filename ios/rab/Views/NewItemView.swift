import MapKit
import SwiftUI

/// A photo just taken, on its way into the user's items: its subject is cut
/// out while the form is filled in, to stand on a colour if one is chosen, and
/// Save keeps it in the user's folder and puts it in their items on rab.
struct NewItemView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let original: UIImage

    /// The subject cut out of the photo, with nothing behind it.
    @State private var cutOut: UIImage?
    /// The colour chosen to stand it on; nil is the photo as taken.
    @State private var background: Color?
    /// The subject on that colour.
    @State private var composed: UIImage?
    @State private var processing = true
    @State private var processError: String?

    @State private var kind = Kind.item
    /// The sort of thing it is within its kind: suggested from the photo and
    /// the name until somebody picks one themselves. Empty is none.
    @State private var category = ""
    @State private var categoryPicked = false
    /// What the phone's classifier saw in the photo.
    @State private var seen: [Sighting] = []
    /// The kind was chosen by hand, so the photo no longer decides it.
    @State private var kindPicked = false
    /// The server is being asked what the photo is of.
    @State private var describing = true
    /// The server answered: the category is its, not the phone's own guess.
    @State private var described = false
    /// Why the form was not filled in from the photo, where it was not.
    @State private var describeNote: LocalizedStringKey?
    @State private var title = ""
    @State private var details = ""
    /// The location it is attached to, if any.
    @State private var locationId: String?
    @State private var choosingLocation = false
    @State private var region: Region?

    @State private var saving = false
    @State private var error: String?
    @State private var savedOffline: String?

    private var shown: UIImage {
        (background == nil ? nil : composed) ?? original
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Image(uiImage: shown)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 200)
                        .background(Color.white)
                        .overlay {
                            if processing {
                                ZStack {
                                    Color.white.opacity(0.6)
                                    VStack(spacing: 8) {
                                        ProgressView()
                                        Text("Removing the background…").font(.footnote)
                                    }
                                }
                            }
                        }
                        .listRowInsets(EdgeInsets())
                    if cutOut != nil {
                        BackgroundChoice(selection: $background)
                            .onChange(of: background) { compose() }
                    }
                } footer: {
                    if let processError {
                        Text("The background could not be removed: \(processError)")
                    }
                }

                // What it is — its kind, and the sort of thing within the kind —
                // both filled in from the photo, and anybody's to change.
                Section {
                    Picker("Kind", selection: Binding(get: { kind }, set: { pick(kind: $0) })) {
                        ForEach(Kind.allCases) { Text($0.name).tag($0) }
                    }
                    .pickerStyle(.menu)
                    Picker(selection: Binding(get: { category }, set: { category = $0; categoryPicked = true })) {
                        Text("None").tag("")
                        ForEach(Categories.all[kind] ?? [], id: \.self) { slug in
                            Text(Categories.name(slug)).tag(slug)
                        }
                    } label: {
                        Text("Category")
                    }
                    .pickerStyle(.menu)
                } footer: {
                    Group {
                        if !describing, let describeNote { Text(describeNote) }
                    }
                    // Close under its card, and no further from the name below
                    // than the cards are from each other.
                    .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 0, trailing: 20))
                }
                // The choice belongs with the name under it: closer to it than
                // sections usually stand.
                .listSectionSpacing(12)
                .onChange(of: title) { suggestCategory() }

                Section {
                    TextField("Name", text: $title)
                        .textInputAutocapitalization(.sentences)
                    TextField("Description", text: $details, axis: .vertical)
                        .textInputAutocapitalization(.sentences)
                        .lineLimit(3...8)
                }
                // As close to the location under it as the choice is above it.
                .listSectionSpacing(12)

                // Where it is kept: one of the user's places, or none.
                Section {
                    Button {
                        choosingLocation = true
                    } label: {
                        HStack {
                            Text("Location")
                            Spacer()
                            if let location = model.location(locationId) {
                                Text(verbatim: location.name).foregroundStyle(.secondary)
                            } else {
                                Text("None").foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            // The photo sits close under the title, not a section's gap away.
            .contentMargins(.top, 16, for: .scrollContent)
            // While the photo is being looked at, a toast says so: over the
            // form, at the bottom, and gone when the answer is in.
            .overlay(alignment: .bottom) {
                if describing {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small).tint(.white)
                        Text("Recognizing the photo…")
                    }
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.85), in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: describing)
            .navigationTitle("New item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .disabled(processing)
                    }
                }
            }
            .interactiveDismissDisabled(saving)
            .alert("Saved on this phone", isPresented: Binding(get: { savedOffline != nil }, set: { if !$0 { savedOffline = nil } })) {
                Button("OK") { dismiss() }
            } message: {
                Text("It is not in your items on rab yet: \(savedOffline ?? ""). You can add it from the item's page.")
            }
            .sheet(isPresented: $choosingLocation) {
                LocationPicker(selection: $locationId)
            }
            .task { await removeBackground() }
            .task { await describe() }
            .task { await findArea() }
        }
    }

    private func removeBackground() async {
        do {
            cutOut = try await BackgroundRemover.cutOut(original)
            compose()
        } catch {
            processError = error.localizedDescription
        }
        processing = false
    }

    /// Fills the form in from the photo: the kind, the category, the name and
    /// the description, as rab's server makes them out. Whatever has been
    /// typed or chosen by hand in the meantime is left alone.
    ///
    /// Where the server cannot say, the form says so and is left to be filled
    /// in by hand. The phone's own classifier is not asked for a name — it
    /// calls a pen a computer — and suggests a category only where it is sure,
    /// or where the name that gets typed says which.
    private func describe() async {
        async let sightings = PhotoClassifier.look(at: original)
        do {
            let suggestion = try await model.describe(original)
            described = true
            if !kindPicked { kind = suggestion.kind }
            if !categoryPicked, kind == suggestion.kind { category = suggestion.category }
            if title.isEmpty { title = suggestion.title }
            if details.isEmpty { details = suggestion.description }
        } catch let error as APIError where error.status == 404 || error.status == 503 {
            describeNote = "This server is not set up to fill this in from the photo."
        } catch {
            describeNote = "This could not be filled in from the photo. Fill it in yourself."
        }
        seen = await sightings
        describing = false
        suggestCategory()
    }

    /// A kind chosen by hand: its categories are others, so the category goes
    /// back to the phone's guess among them.
    private func pick(kind chosen: Kind) {
        guard chosen != kind else { return }
        kind = chosen
        kindPicked = true
        categoryPicked = false
        described = false
        suggestCategory()
    }

    /// The phone's guess at the category, unless one has been picked by hand
    /// or the server has given one.
    private func suggestCategory() {
        guard !categoryPicked, !described else { return }
        category = Categories.suggest(kind: kind, seen: seen, title: title) ?? ""
    }

    /// Stands the subject on the colour chosen, if one is.
    private func compose() {
        guard let cutOut, let background else { return composed = nil }
        composed = cutOut.over(UIColor(background))
    }

    /// The area it is offered in is where the phone is; nobody is asked. Looked
    /// up while the form is filled in, so it is there by the time of Save.
    private func findArea() async {
        region = await Area.here()
    }

    private func save() {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return error = String(localized: "Give it a name") }
        error = nil
        saving = true
        Task {
            defer { saving = false }
            do {
                let item = try model.save(image: shown, kind: kind, category: category, title: name, description: details.trimmingCharacters(in: .whitespacesAndNewlines), region: region, locationId: model.location(locationId)?.id)
                do {
                    try await model.publish(item)
                    dismiss()
                } catch {
                    savedOffline = error.localizedDescription
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// What the subject stands on: the photo as it was taken, one of a few plain
/// colours, or any colour from the system's picker.
private struct BackgroundChoice: View {
    @Binding var selection: Color?

    private static let colors: [Color] = [.white, Color(white: 0.9), .black]

    /// The picker's own colour: what it last gave, kept so that it can be
    /// gone back to.
    @State private var custom = Color(red: 0.93, green: 0.9, blue: 0.84)

    var body: some View {
        HStack(spacing: 8) {
            // On one line: the swatches give way, not the word.
            Text("Background").fixedSize()
            Spacer()
            swatch(chosen: selection == nil, label: "Original") {
                Image(systemName: "photo")
                    .font(.system(size: 13))
                    .frame(width: 26, height: 26)
                    .background(Color(white: 0.96), in: Circle())
            } action: {
                selection = nil
            }
            ForEach(Self.colors, id: \.self) { color in
                swatch(chosen: selection == color, label: nil) {
                    Circle().fill(color).frame(width: 26, height: 26)
                } action: {
                    selection = color
                }
            }
            ColorPicker("Other colour", selection: $custom, supportsOpacity: false)
                .labelsHidden()
                .onChange(of: custom) { selection = custom }
        }
        // Each swatch is its own button; the row is not one.
        .buttonStyle(.plain)
    }

    private func swatch(chosen: Bool, label: LocalizedStringKey?, @ViewBuilder _ face: () -> some View, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            face()
                .overlay(Circle().stroke(Color(white: 0.8), lineWidth: 1))
                .padding(3)
                .overlay(Circle().stroke(Color.black, lineWidth: chosen ? 2 : 0))
        }
        .accessibilityLabel(label.map { Text($0) } ?? Text("Background"))
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// The user's locations, to attach an item to one of them — or to a new one,
/// which is a name and a pin on the map.
struct LocationPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @Binding var selection: String?

    @State private var adding = false
    /// Half the screen for the list; all of it once there is a map to move.
    @State private var detent = PresentationDetent.medium

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row(title: Text("None"), chosen: model.location(selection) == nil) { choose(nil) }
                    ForEach(model.locations) { location in
                        row(title: Text(verbatim: location.name), detail: whereabouts(of: location), chosen: location.id == selection) {
                            choose(location.id)
                        }
                    }
                    .onDelete { offsets in
                        for location in offsets.map({ model.locations[$0] }) {
                            if location.id == selection { selection = nil }
                            model.delete(location)
                        }
                    }
                }
                // The way to add one belongs with the list it adds to.
                .listSectionSpacing(12)

                Section {
                    Button {
                        detent = .large
                        adding = true
                    } label: {
                        Label("Add a new location", systemImage: "plus")
                    }
                }
            }
            // The list starts close under the bar, not a section's gap below it.
            .contentMargins(.top, 8, for: .scrollContent)
            .navigationTitle("Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(isPresented: $adding) {
                // The new location is the one the item is attached to.
                NewLocationView { location in choose(location.id) }
            }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        // The list is the account's, on rab: brought up to date when opened.
        .task { await model.loadLocations() }
    }

    /// Where a location is, as a line: the address its pin came to. One added
    /// before addresses were kept has its area's name to go by.
    private func whereabouts(of location: SavedLocation) -> String? {
        guard let address = location.address ?? location.region?.name, !address.isEmpty else { return nil }
        return address
    }

    private func row(title: Text, detail: String? = nil, chosen: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    title
                    if let detail {
                        Text(verbatim: detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if chosen { Image(systemName: "checkmark") }
            }
        }
    }

    private func choose(_ id: String?) {
        selection = id
        dismiss()
    }
}

/// A new location: its name, and a map moved until the pin is on the spot. The
/// pin stays in the middle and the map goes under it.
struct NewLocationView: View {
    @Environment(AppModel.self) private var model

    let onAdd: (SavedLocation) -> Void

    @State private var name = ""
    @State private var camera = MapCameraPosition.automatic
    /// What is under the pin; nil until the map has said where it is.
    @State private var center: CLLocationCoordinate2D?
    /// The address under the pin, looked up each time the map comes to rest,
    /// and the user's to write over.
    @State private var address = ""
    /// The map has been moved by hand, so the phone's own position no longer
    /// decides where it looks.
    @State private var moved = false
    @State private var saving = false
    @State private var error: String?
    @FocusState private var editing: Field?

    private enum Field { case name, address }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                // What the location is: its name and its address, which can be
                // written over, and the pin's two numbers, which only the map sets.
                VStack(spacing: 0) {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                        .focused($editing, equals: .name)
                        .submitLabel(.done)
                        .padding(.vertical, 11)
                    Divider()
                    TextField("Address", text: $address, axis: .vertical)
                        .lineLimit(1...2)
                        .focused($editing, equals: .address)
                        .padding(.vertical, 11)
                    Divider()
                    Text(verbatim: center.map { String(format: "%.5f, %.5f", $0.latitude, $0.longitude) } ?? "—")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 11)
                }
                .padding(.horizontal, 16)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                Group {
                    if let error {
                        Text(error).foregroundStyle(.red)
                    } else {
                        Text("Move the map until the pin is on the place. What is attached to it is shown there on rab's map.")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.footnote)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 12)

            Map(position: $camera)
                .mapControls { MapCompass() }
                .onMapCameraChange(frequency: .continuous) { context in
                    center = context.region.center
                }
                .simultaneousGesture(DragGesture().onChanged { _ in
                    moved = true
                    editing = nil
                })
                .overlay {
                    // Its point, not its middle, is on the spot.
                    Image(systemName: "mappin")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(.black)
                        .shadow(color: .white, radius: 1)
                        .offset(y: -17)
                        .allowsHitTesting(false)
                }
                // The address follows the pin: asked for once the map has been
                // still for a moment, not at every step of the way there. A
                // pin that moves takes the address with it, written over or not.
                .task(id: center.map { String(format: "%.5f,%.5f", $0.latitude, $0.longitude) }) {
                    guard let center else { return }
                    try? await Task.sleep(for: .milliseconds(400))
                    guard !Task.isCancelled else { return }
                    let found = await Area.describe(latitude: center.latitude, longitude: center.longitude)
                    guard !Task.isCancelled, let found = found.address else { return }
                    address = found
                }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("New location")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button("Add", action: add)
                        .disabled(trimmedName.isEmpty || center == nil)
                }
            }
        }
        .task {
            // Starts where the phone is, close in, unless the map has already
            // been taken somewhere else.
            guard let here = await Area.position(), !moved else { return }
            camera = .region(MKCoordinateRegion(center: here, latitudinalMeters: 600, longitudinalMeters: 600))
        }
    }

    private func add() {
        guard !trimmedName.isEmpty else { return error = String(localized: "A location needs a name") }
        guard let center else { return }
        error = nil
        saving = true
        Task {
            defer { saving = false }
            do {
                onAdd(try await model.addLocation(
                    name: trimmedName,
                    address: address.trimmingCharacters(in: .whitespacesAndNewlines),
                    latitude: center.latitude,
                    longitude: center.longitude
                ))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
