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

    // MARK: - items

    func item(_ id: String) -> SavedItem? {
        items.first { $0.id == id }
    }

    /// Keeps a photographed thing in the user's folder, newest first.
    func save(image: UIImage, kind: Kind, title: String, description: String, region: Region?, locationId: String?) throws -> SavedItem {
        guard let store else { throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in")) }
        guard let jpeg = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.9) else {
            throw BackgroundRemover.Failure.noImage
        }
        let id = UUID().uuidString.lowercased()
        let photo = try store.savePhoto(jpeg.data, id: id)
        let item = SavedItem(
            id: id,
            kind: kind,
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

    /// A new place, called `name`, at the spot picked on the map. Its area and
    /// its address are looked up from the spot.
    func addLocation(name: String, latitude: Double, longitude: Double) async throws -> SavedLocation {
        guard let store else { throw APIError(status: 0, code: "LOGIN_REQUIRED", message: String(localized: "Please sign in")) }
        let found = await Area.describe(latitude: latitude, longitude: longitude)
        let location = SavedLocation(
            id: UUID().uuidString.lowercased(),
            name: name,
            latitude: latitude,
            longitude: longitude,
            region: found.region,
            address: found.address,
            createdAt: Date()
        )
        locations.append(location)
        try store.saveLocations(locations)
        return location
    }

    /// Forgets a place. What was attached to it is attached to nothing.
    func delete(_ location: SavedLocation) {
        locations.removeAll { $0.id == location.id }
        try? store?.saveLocations(locations)
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
            currency: item.currency,
            price: item.price,
            region: region,
            latitude: location?.longitude == nil ? nil : location?.latitude,
            longitude: location?.latitude == nil ? nil : location?.longitude,
            place: location?.latitude == nil || location?.longitude == nil ? nil : location?.name,
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
