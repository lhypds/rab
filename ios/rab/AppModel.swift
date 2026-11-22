import Foundation
import Observation
import UIKit

/// The app's state: which rab server, who is signed in, and their items. The
/// user's own things live in their folder (see UserStore); the two defaults
/// here only say which folder to open next time.
@MainActor
@Observable
final class AppModel {
    static let defaultServer = "https://rab.gcc3.com"
    static let currencies = ["JPY", "CNY", "USD", "EUR"]

    private static let serverKey = "rab:server"
    private static let userKey = "rab:user"

    /// The server the sign-in screen talks to, as typed.
    var server: String {
        didSet { UserDefaults.standard.set(server, forKey: Self.serverKey) }
    }

    private(set) var username: String?
    private(set) var items: [SavedItem] = []
    /// The user's items as rab lists them — what "My items" shows. Nil until
    /// the server has ever answered for this user.
    private(set) var listings: [Listing]?
    /// Why the last asking failed, if it did.
    private(set) var listingsError: String?
    /// The places the user's things can be attached to, in the order added.
    private(set) var locations: [SavedLocation] = []
    private(set) var store: UserStore?
    private var api: RabAPI?

    var isSignedIn: Bool { username != nil }

    init() {
        server = UserDefaults.standard.string(forKey: Self.serverKey) ?? Self.defaultServer
        if let name = UserDefaults.standard.string(forKey: Self.userKey) {
            open(username: name)
        }
    }

    /// Picks a user's folder back up, session and all.
    private func open(username name: String) {
        let store = UserStore(username: name)
        guard let session = store.loadSession(), let url = RabAPI.url(from: session.server) else { return }
        self.store = store
        username = name
        server = session.server
        api = RabAPI(baseURL: url, token: session.token)
        items = store.loadItems()
        listings = store.loadListings()
        locations = store.loadLocations()
        UserDefaults.standard.set(name, forKey: Self.userKey)
    }

    // MARK: - account

    private func serverURL() throws -> URL {
        guard let url = RabAPI.url(from: server) else {
            throw APIError(status: 0, code: "BAD_SERVER", message: String(localized: "That is not a web address"))
        }
        return url
    }

    private static func normalize(_ username: String) -> String {
        username.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCompatibilityMapping.lowercased()
    }

    /// Whether the name is an account on the server.
    func check(username: String) async throws -> Bool {
        try await RabAPI(baseURL: try serverURL()).userExists(Self.normalize(username))
    }

    func signIn(username raw: String, password: String, creating: Bool) async throws {
        let api = RabAPI(baseURL: try serverURL())
        let name = Self.normalize(raw)
        let reply = creating ? try await api.createUser(name, password) : try await api.login(name, password)
        api.token = reply.token
        let store = UserStore(username: reply.user.username)
        try store.saveSession(SavedSession(server: server, token: reply.token))
        self.api = api
        self.store = store
        username = reply.user.username
        items = store.loadItems()
        listings = store.loadListings()
        locations = store.loadLocations()
        UserDefaults.standard.set(username, forKey: Self.userKey)
    }

    /// Ends the session. The folder stays: the items are the user's, not the
    /// session's.
    func signOut() async {
        await api?.logout()
        store?.clearSession()
        UserDefaults.standard.removeObject(forKey: Self.userKey)
        api = nil
        store = nil
        username = nil
        items = []
        listings = nil
        listingsError = nil
        locations = []
    }

    // MARK: - listings

    func listing(_ id: String) -> Listing? {
        listings?.first { $0.id == id }
    }

    /// Asks the server what the user's items are. What it says replaces the
    /// list; where it cannot be asked, the list stays as it last was.
    func loadListings() async {
        guard let api, let store else { return }
        do {
            let fresh = try await api.mine()
            // Signed out, or somebody else signed in, while it was away.
            guard self.store === store else { return }
            listings = fresh
            listingsError = nil
            store.saveListings(fresh)
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            listingsError = error.localizedDescription
        }
    }

    /// Deletes one of the user's items from rab, and the copy of it this phone
    /// kept from when it was photographed here.
    func delete(_ listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in"))
        }
        do {
            try await api.deleteItem(listing.id)
        } catch let error as APIError where error.status == 404 {
            // Already gone from there, which is what was asked for.
        }
        for copy in items where copy.remoteId == listing.id { delete(copy) }
        listings?.removeAll { $0.id == listing.id }
        if let listings { store?.saveListings(listings) }
    }

    func imageURL(_ path: String?) -> URL? {
        api?.imageURL(path)
    }

    func pageURL(ofListing id: String) -> URL? {
        api?.pageURL(ofItem: id)
    }

    // MARK: - describing

    /// What rab's server makes of a photograph — its kind, category, name and
    /// description, in the phone's language. It throws where the server cannot
    /// say: no key on it, no connection, a picture it would not describe.
    func describe(_ image: UIImage) async throws -> Suggestion {
        guard let api, let small = image.jpeg(maxSide: 1024, quality: 0.7) else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in"))
        }
        let code = Locale.current.language.languageCode?.identifier ?? "en"
        return try await api.describe(small.data, language: ["zh", "ja"].contains(code) ? code : "en")
    }

    // MARK: - items

    func item(_ id: String) -> SavedItem? {
        items.first { $0.id == id }
    }

    /// Keeps a photographed thing in the user's folder, newest first.
    func save(image: UIImage, kind: Kind, category: String, title: String, description: String, region: Region?, locationId: String?) throws -> SavedItem {
        guard let store else { throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in")) }
        guard let jpeg = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.9) else {
            throw BackgroundRemover.Failure.noImage
        }
        let id = UUID().uuidString.lowercased()
        let photo = try store.savePhoto(jpeg.data, id: id)
        let item = SavedItem(
            id: id,
            kind: kind,
            category: category.isEmpty ? nil : category,
            title: title,
            description: description,
            // The phone asks for no price: it is published at none, and set
            // on the website by whoever wants one.
            price: 0,
            currency: "JPY",
            region: region,
            createdAt: Date(),
            photo: photo,
            width: jpeg.width,
            height: jpeg.height,
            locationId: locationId,
            remoteId: nil
        )
        items.insert(item, at: 0)
        try store.saveItems(items)
        return item
    }

    func update(_ item: SavedItem) throws {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[index] = item
        try store?.saveItems(items)
    }

    func delete(_ item: SavedItem) {
        store?.deletePhoto(item)
        items.removeAll { $0.id == item.id }
        try? store?.saveItems(items)
    }

    // MARK: - locations

    func location(_ id: String?) -> SavedLocation? {
        guard let id else { return nil }
        return locations.first { $0.id == id }
    }

    /// A new place, called `name`, at the spot picked on the map, with the
    /// address as the form had it — the one looked up from the spot, or what
    /// the user wrote over it. Its area is looked up from the spot.
    func addLocation(name: String, address: String, latitude: Double, longitude: Double) async throws -> SavedLocation {
        guard let store else { throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in")) }
        let found = await Area.describe(latitude: latitude, longitude: longitude)
        var location = SavedLocation(
            id: UUID().uuidString.lowercased(),
            name: name,
            latitude: latitude,
            longitude: longitude,
            region: found.region,
            address: address.isEmpty ? found.address : address,
            createdAt: Date()
        )
        // Into the account's list on rab too, where the website's form finds
        // it. Should that fail, it goes up the next time the list is loaded.
        if (try? await api?.saveLocation(Self.remote(location))) != nil { location.onRab = true }
        locations.append(location)
        try store.saveLocations(locations)
        return location
    }

    private static func remote(_ location: SavedLocation) -> RemoteLocation {
        RemoteLocation(
            id: location.id,
            name: location.name,
            address: location.address,
            latitude: location.latitude ?? 0,
            longitude: location.longitude ?? 0,
            region: location.region
        )
    }

    /// The account's places are kept on rab — one list, the phone's and the
    /// website's. This brings the phone's copy up to it: what the phone made
    /// and has not yet sent is sent up, and then rab's list is the list. Where
    /// rab cannot be asked, the phone's copy stays as it is.
    func loadLocations() async {
        guard let api, let store else { return }
        guard var remote = try? await api.locations() else { return }
        let known = Set(remote.compactMap(\.id))
        // Only what has never been on rab is sent: a place that was there and
        // is gone was deleted there, and is not put back.
        for local in locations where local.onRab != true && !known.contains(local.id) && local.latitude != nil && local.longitude != nil {
            if let saved = try? await api.saveLocation(Self.remote(local)) { remote.append(saved) }
        }
        // Signed out, or somebody else signed in, while it was away.
        guard self.store === store else { return }
        let before = Dictionary(uniqueKeysWithValues: locations.map { ($0.id, $0) })
        var fresh = remote.compactMap { place -> SavedLocation? in
            guard let id = place.id else { return nil }
            return SavedLocation(
                id: id,
                name: place.name,
                latitude: place.latitude,
                longitude: place.longitude,
                region: place.region,
                address: place.address,
                createdAt: before[id]?.createdAt ?? Date(),
                onRab: true
            )
        }
        // A place the phone made without a spot cannot be on rab; it stays here.
        let listed = Set(fresh.map(\.id))
        fresh += locations.filter { !listed.contains($0.id) && ($0.latitude == nil || $0.longitude == nil) }
        locations = fresh
        try? store.saveLocations(fresh)
    }

    /// Forgets a place. What was attached to it is attached to nothing.
    func delete(_ location: SavedLocation) {
        locations.removeAll { $0.id == location.id }
        try? store?.saveLocations(locations)
        // And from the account's list on rab.
        let api = api
        Task { try? await api?.deleteLocation(location.id) }
    }

    /// Puts an item in the user's items on rab: the photograph and its small
    /// copy go up first, then the item carrying their names, the way the
    /// website's form does it.
    func publish(_ item: SavedItem) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in"))
        }
        // The area is where the phone is: the item's own where it was found
        // when the photo was taken, and looked up now where it was not.
        var item = item
        let location = location(item.locationId)
        if item.region == nil, location?.region == nil {
            item.region = await Area.here()
            try update(item)
        }
        // An item attached to a location is offered where the location is.
        guard let region = location?.region ?? item.region else {
            throw APIError(status: 0, code: "REGION_REQUIRED", message: String(localized: "rab could not tell which area you are in. Allow location and try again."))
        }
        guard let image = store.loadPhoto(item),
              let full = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.82),
              let thumb = image.jpeg(maxSide: 320, quality: 0.62)
        else { throw BackgroundRemover.Failure.noImage }

        let storedFull = try await api.uploadImage(full.data)
        let storedThumb = try await api.uploadImage(thumb.data)
        let body = ItemBody(
            title: item.title,
            description: item.description ?? "",
            kind: (item.kind ?? .item).rawValue,
            category: item.category ?? "",
            currency: item.currency,
            price: item.price,
            region: region,
            latitude: location?.longitude == nil ? nil : location?.latitude,
            longitude: location?.latitude == nil ? nil : location?.longitude,
            // What the website shows by the pin and after the item's name: the
            // address of the place, and its name only where it has no address.
            place: location?.latitude == nil || location?.longitude == nil ? nil : location?.address ?? location?.name,
            images: [ImageRef(name: storedFull.name, thumb: storedThumb.name, width: full.width, height: full.height)]
        )
        let created = try await api.createItem(body)
        var published = item
        published.remoteId = created.id
        try update(published)
        // It is in the server's list now, and so in the phone's.
        await loadListings()
    }

    /// Where a published item is on the website.
    func pageURL(of item: SavedItem) -> URL? {
        guard let api, let remoteId = item.remoteId else { return nil }
        return api.pageURL(ofItem: remoteId)
    }
}
