import MapKit
import SwiftUI

/// A photo just taken, on its way into the user's items: the background comes
/// off while the form is filled in, and Save keeps it in the user's folder and,
/// unless told not to, puts it in their items on rab.
struct NewItemView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let original: UIImage

    @State private var processed: UIImage?
    @State private var processing = true
    @State private var processError: String?
    @State private var whiteBackground = true

    @State private var kind = Kind.item
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
        (whiteBackground ? processed : nil) ?? original
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
                    if processed != nil {
                        Toggle("White background", isOn: $whiteBackground)
                    }
                } footer: {
                    if let processError {
                        Text("The background could not be removed: \(processError)")
                    }
                }

                Section {
                    Picker("Kind", selection: $kind) {
                        ForEach(Kind.allCases) { Text($0.name).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    // A thing stands on white; a room is its own background.
                    .onChange(of: kind) { whiteBackground = kind == .item }
                } header: {
                    // Why there is a choice at all, said before it is made.
                    Text("What are you renting out? rab lists things, spaces and services separately, so choose the one people will look for it under.")
                        .textCase(nil)
                        .listRowInsets(EdgeInsets(top: 12, leading: 0, bottom: 8, trailing: 0))
                }
                // The choice belongs with the name under it: closer to it than
                // sections usually stand.
                .listSectionSpacing(12)

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
            .task { await findArea() }
        }
    }

    private func removeBackground() async {
        do {
            processed = try await BackgroundRemover.whiten(original)
        } catch {
            processError = error.localizedDescription
        }
        processing = false
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
                let item = try model.save(image: shown, kind: kind, title: name, description: details.trimmingCharacters(in: .whitespacesAndNewlines), region: region, locationId: model.location(locationId)?.id)
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
    /// The address under the pin, looked up each time the map comes to rest.
    @State private var address: String?
    /// The map has been moved by hand, so the phone's own position no longer
    /// decides where it looks.
    @State private var moved = false
    @State private var saving = false
    @State private var error: String?
    @FocusState private var naming: Bool

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Name", text: $name)
                    .textInputAutocapitalization(.words)
                    .focused($naming)
                    .submitLabel(.done)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
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
                    naming = false
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
                .overlay(alignment: .bottom) {
                    if let center {
                        // As the list will say it: the address, then the numbers.
                        VStack(spacing: 2) {
                            if let address { Text(verbatim: address).lineLimit(2).multilineTextAlignment(.center) }
                            Text(verbatim: String(format: "(%.5f, %.5f)", center.latitude, center.longitude))
                                .foregroundStyle(address == nil ? .primary : .secondary)
                        }
                        .font(.footnote)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 20)
                        .padding(.bottom, 28)
                    }
                }
                // The address follows the pin: asked for once the map has been
                // still for a moment, not at every step of the way there.
                .task(id: center.map { String(format: "%.5f,%.5f", $0.latitude, $0.longitude) }) {
                    guard let center else { return }
                    try? await Task.sleep(for: .milliseconds(400))
                    guard !Task.isCancelled else { return }
                    let found = await Area.describe(latitude: center.latitude, longitude: center.longitude)
                    guard !Task.isCancelled else { return }
                    address = found.address
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
                onAdd(try await model.addLocation(name: trimmedName, latitude: center.latitude, longitude: center.longitude))
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
