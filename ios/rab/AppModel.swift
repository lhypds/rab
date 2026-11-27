import CoreLocation
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
    private static func targetKey(_ username: String) -> String { "rab:spot:\(username)" }

    /// The server the sign-in screen talks to, as typed.
    var server: String {
        didSet { UserDefaults.standard.set(server, forKey: Self.serverKey) }
    }

    /// The language the app is in (see Language): the screens', and the one
    /// rab's server is asked to name things in.
    var language = Language.chosen {
        didSet { Language.choose(language) }
    }

    private(set) var username: String?
    private(set) var items: [SavedItem] = []
    /// The user's items as rab lists them — what "My items" shows. Nil until
    /// the server has ever answered for this user.
    private(set) var listings: [Listing]?
    /// Why the last asking failed, if it did.
    private(set) var listingsError: String?
    /// The account's spots as rab lists them, the default one first: what the
    /// scanner collects things onto.
    private(set) var spots: [Spot] = []
    /// The account's places as rab keeps them: what a thing collected near
    /// one is said to be at.
    private(set) var places: [Place] = []
    /// The items being recognized just now, by their ids — the phone's for
    /// one on the phone, rab's for one there.
    private(set) var recognizing: Set<String> = []
    /// Everything not on rab yet is being gone through (see `recognizeAll`).
    private(set) var recognizingAll = false
    /// The spot things are collected onto, by its id: chosen from the top
    /// bar, and remembered for the user. Nil is the account's default spot.
    private(set) var targetSpotIds: [String] = []
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
        spots = store.loadSpots()
        places = store.loadPlaces()
        targetSpotIds = Self.keptTargets(store.username)
        UserDefaults.standard.set(name, forKey: Self.userKey)
    }

    // MARK: - account

    private func serverURL() throws -> URL {
        guard let url = RabAPI.url(from: server) else {
            throw APIError(status: 0, code: "BAD_SERVER", message: Language.text("That is not a web address"))
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

    /// Whether the server asks a new account for an email address and a code.
    func signupNeedsEmail() async -> Bool {
        guard let url = try? serverURL() else { return false }
        return await RabAPI(baseURL: url).signupNeedsEmail()
    }

    /// Has the code that opens a new account mailed to the address.
    func sendCode(username: String, password: String, email: String) async throws {
        let language = self.language.rawValue
        try await RabAPI(baseURL: try serverURL()).sendSignupCode(
            Self.normalize(username), password, email.trimmingCharacters(in: .whitespacesAndNewlines), language: language)
    }

    /// Signs in — or, with `creating`, opens the account: with the address it
    /// is for and the code that was mailed there.
    func signIn(username raw: String, password: String, creating: Bool, email: String = "", code: String = "") async throws {
        let api = RabAPI(baseURL: try serverURL())
        let name = Self.normalize(raw)
        let reply = creating
            ? try await api.createUser(name, password, email.trimmingCharacters(in: .whitespacesAndNewlines), code)
            : try await api.login(name, password)
        api.token = reply.token
        let store = UserStore(username: reply.user.username)
        try store.saveSession(SavedSession(server: server, token: reply.token))
        self.api = api
        self.store = store
        username = reply.user.username
        items = store.loadItems()
        listings = store.loadListings()
        spots = store.loadSpots()
        places = store.loadPlaces()
        targetSpotIds = Self.keptTargets(store.username)
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
        spots = []
        places = []
        recognizing = []
        recognizingAll = false
        targetSpotIds = []
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
            listings = fresh.items
            listingsError = nil
            store.saveListings(fresh.items)
            // A server from before there were spots lists none, and the ones
            // the phone knows are then not forgotten.
            if !fresh.spots.isEmpty {
                spots = fresh.spots
                store.saveSpots(fresh.spots)
            }
            // The account's places too; where they cannot be asked for, the
            // ones the phone knows stand.
            if let fresh = try? await api.places(), self.store === store {
                places = fresh
                store.savePlaces(fresh)
            }
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
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
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

    /// What rab's server makes of a photograph — its category, name and
    /// description, in the phone's language. It throws where the server cannot
    /// say: no key on it, no connection, a picture it would not describe.
    /// With `object`, the photograph is one the scanner took, or is being
    /// recognized as one: an object, to be put in one of the object categories
    /// and given its short category as well.
    func describe(_ image: UIImage, object: Bool = false) async throws -> Suggestion {
        guard let api, let small = image.jpeg(maxSide: 1024, quality: 0.7) else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        let code = language.rawValue
        var suggestion = try await api.describe(small.data, language: ["zh", "ja"].contains(code) ? code : "en", object: object)
        guard object else { return suggestion }
        // A server from before it was asked for objects answers with any
        // category, and no short one.
        if !Categories.objects.contains(suggestion.category) { suggestion.category = "other" }
        suggestion.title = suggestion.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !suggestion.title.isEmpty else {
            throw APIError(status: 422, code: "DESCRIBE_FAILED", message: Language.text("The photo could not be recognized"))
        }
        return suggestion
    }

    // MARK: - spots

    func spot(_ id: String?) -> Spot? {
        guard let id else { return nil }
        return spots.first { $0.id == id }
    }

    /// The spots things are collected onto: the ones chosen that rab still
    /// has, in the order rab lists them — and the account's default one where
    /// that leaves none. Always one at least, where the account has any.
    var targetSpots: [Spot] {
        let chosen = spots.filter { targetSpotIds.contains($0.id) }
        if !chosen.isEmpty { return chosen }
        return (spots.first { $0.isDefault == true } ?? spots.first).map { [$0] } ?? []
    }

    /// Ticks a spot as one of those collected onto, or unticks it — but not
    /// the last one ticked: there is always one.
    func toggleTargetSpot(_ id: String) {
        var ids = targetSpots.map(\.id)
        if let index = ids.firstIndex(of: id) {
            guard ids.count > 1 else { return }
            ids.remove(at: index)
        } else {
            ids.append(id)
        }
        targetSpotIds = ids
        if let username { UserDefaults.standard.set(ids, forKey: Self.targetKey(username)) }
    }

    /// The spots chosen the last time, by a user: several now, and the one
    /// from when only one could be.
    private static func keptTargets(_ username: String) -> [String] {
        let kept = UserDefaults.standard.object(forKey: targetKey(username))
        if let ids = kept as? [String] { return ids }
        if let id = kept as? String { return [id] }
        return []
    }

    /// What is on this phone and not on rab yet: photographs still to be
    /// recognized, and whatever could not be sent up. Newest first.
    var waiting: [SavedItem] {
        items.filter { $0.remoteId == nil }
    }

    /// Keeps a photograph the scanner took, for the spot things are being
    /// collected onto: an item with no name yet, on this phone, until it is
    /// recognized.
    /// `position` is where the phone is, where it will say: the thing is then
    /// at the nearest of the account's places, if one is within reach.
    @discardableResult
    func collect(_ image: UIImage, forSpots spotIds: [String], at position: CLLocationCoordinate2D? = nil) throws -> SavedItem {
        let near = position.flatMap { self.place(near: $0) }
        return try save(image: image, category: "", title: "", what: "", description: "", spotIds: spotIds, locationId: near?.id)
    }

    // MARK: - places

    /// How near one of the account's places the phone has to be for a thing
    /// collected there to be said to be at it: a hundred metres.
    nonisolated static let reach: CLLocationDistance = 100

    func place(_ id: String?) -> Place? {
        guard let id else { return nil }
        return places.first { $0.id == id }
    }

    /// The one of the account's places an item on rab stands at, going by
    /// its pin: the place whose spot the pin is on.
    func place(of listing: Listing) -> Place? {
        guard listing.located == true, let latitude = listing.latitude, let longitude = listing.longitude else { return nil }
        return places.first { abs($0.latitude - latitude) < 0.00002 && abs($0.longitude - longitude) < 0.00002 }
    }

    /// Says where an item on this phone is: at one of the account's places,
    /// or nowhere. On rab too, where the item is there.
    func setPlace(_ place: Place?, for item: SavedItem) async throws {
        guard var fresh = self.item(item.id) else { return }
        fresh.locationId = place?.id
        try update(fresh)
        guard let remoteId = fresh.remoteId, let api else { return }
        try await api.updateItem(remoteId, at: place)
        await loadListings()
    }

    /// The same for an item on rab.
    func setPlace(_ place: Place?, for listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        try await api.updateItem(listing.id, at: place)
        if let index = listings?.firstIndex(where: { $0.id == listing.id }) {
            listings?[index].located = place != nil
            listings?[index].latitude = place?.latitude
            listings?[index].longitude = place?.longitude
            listings?[index].place = place?.line
            if let region = place?.region { listings?[index].region = region }
            if let listings { store?.saveListings(listings) }
        }
        for var copy in items where copy.remoteId == listing.id {
            copy.locationId = place?.id
            try? update(copy)
        }
    }

    /// The nearest of the account's places to a spot, where one is within
    /// `reach` of it; none otherwise.
    func place(near position: CLLocationCoordinate2D) -> Place? {
        let here = CLLocation(latitude: position.latitude, longitude: position.longitude)
        let nearest = places
            .map { ($0, here.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude))) }
            .min { $0.1 < $1.1 }
        guard let nearest, nearest.1 <= Self.reach else { return nil }
        return nearest.0
    }

    // MARK: - editing

    /// What was written on an item's page, kept: on this phone, and on rab —
    /// changed there where it is there already, and registered there where
    /// it is not and now has a name. What was written is in the language the
    /// app is in: that language's words are changed, and the others stand.
    func save(_ draft: ItemDraft, for item: SavedItem) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard var fresh = self.item(item.id) else { return }
        let written = Words.written(draft.words, in: language, own: fresh.own, translations: fresh.translations)
        fresh.title = written.own.title
        fresh.what = written.own.what
        fresh.description = written.own.description
        fresh.translations = written.translations
        fresh.category = draft.category.isEmpty ? nil : draft.category
        try update(fresh)
        if let remoteId = fresh.remoteId {
            try await api.updateItem(remoteId, Self.body(written.own, written.translations, category: draft.category))
            await loadListings()
        } else if fresh.isRecognized {
            try await publish(fresh)
        }
    }

    /// The same for an item on rab: written over there, and in the phone's
    /// own copy of it where it has one.
    func save(_ draft: ItemDraft, for listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        let written = Words.written(draft.words, in: language, own: listing.own, translations: listing.translations)
        try await api.updateItem(listing.id, Self.body(written.own, written.translations, category: draft.category))
        if let index = listings?.firstIndex(where: { $0.id == listing.id }) {
            listings?[index].title = written.own.title
            listings?[index].what = written.own.what
            listings?[index].description = written.own.description
            listings?[index].translations = written.translations
            listings?[index].category = draft.category
            if let listings { store?.saveListings(listings) }
        }
        for var copy in items where copy.remoteId == listing.id {
            copy.title = written.own.title
            copy.what = written.own.what
            copy.description = written.own.description
            copy.translations = written.translations
            copy.category = draft.category.isEmpty ? nil : draft.category
            try? update(copy)
        }
    }

    private static func body(_ own: Words, _ translations: [String: Words]?, category: String) -> RecognizedBody {
        RecognizedBody(title: own.title, what: own.what, description: own.description, category: category, translations: translations)
    }

    // MARK: - recognizing

    /// Says what a photographed thing is — its category among the objects, its
    /// short category, a name and a description, all from rab's server — and
    /// writes that over whatever it said before. It then goes onto rab — onto
    /// the spot it was collected for; one that is there already is changed
    /// there too.
    func recognize(_ item: SavedItem, refreshing: Bool = true) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard !recognizing.contains(item.id) else { return }
        recognizing.insert(item.id)
        defer { recognizing.remove(item.id) }
        guard let image = store.loadPhoto(item) else { throw BackgroundRemover.Failure.noImage }
        let suggestion = try await describe(image, object: true)
        // Deleted while the server was looking at it.
        guard var fresh = self.item(item.id) else { return }
        fresh.category = suggestion.category
        fresh.what = String((suggestion.what ?? "").prefix(whatMax))
        fresh.title = suggestion.title
        fresh.description = suggestion.description
        // In all three languages, where the server said them: what it said
        // before in any of them is written over with the rest.
        fresh.translations = suggestion.translations
        try update(fresh)
        if let remoteId = fresh.remoteId {
            try await api.updateItem(remoteId, Self.recognized(suggestion))
            if refreshing { await loadListings() }
        } else {
            try await publish(fresh, refreshing: refreshing)
        }
    }

    /// The same for an item on rab: its first photograph is fetched, looked
    /// at, and what it says it is written over there.
    func recognize(_ listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard !recognizing.contains(listing.id) else { return }
        recognizing.insert(listing.id)
        defer { recognizing.remove(listing.id) }
        guard let path = listing.images?.first?.src,
              let image = UIImage(data: try await api.imageData(path))
        else { throw BackgroundRemover.Failure.noImage }
        let suggestion = try await describe(image, object: true)
        try await api.updateItem(listing.id, Self.recognized(suggestion))
        // The phone's own copy of it, where it has one, says the same.
        for var copy in items where copy.remoteId == listing.id {
            copy.category = suggestion.category
            copy.what = String((suggestion.what ?? "").prefix(whatMax))
            copy.title = suggestion.title
            copy.description = suggestion.description
            copy.translations = suggestion.translations
            try? update(copy)
        }
        await loadListings()
    }

    private static func recognized(_ suggestion: Suggestion) -> RecognizedBody {
        RecognizedBody(
            title: suggestion.title,
            what: String((suggestion.what ?? "").prefix(whatMax)),
            description: suggestion.description,
            category: suggestion.category,
            translations: suggestion.translations
        )
    }

    /// Goes through everything on this phone that is not on rab yet: what has
    /// no name is recognized and sent up, and what has one and could not be
    /// sent before is sent now. A few at a time. It answers with how many it
    /// could not do, and why the last of them — nothing where all went.
    func recognizeAll() async -> (failed: Int, why: String)? {
        guard !recognizingAll else { return nil }
        recognizingAll = true
        defer { recognizingAll = false }
        let ids = waiting.map(\.id)
        var failed = 0
        var why = ""
        var rest = ids[...]
        while !rest.isEmpty {
            let batch = rest.prefix(3)
            rest = rest.dropFirst(batch.count)
            let faults = await withTaskGroup(of: Error?.self) { group -> [Error] in
                for id in batch {
                    group.addTask { await self.recognizeOrPublish(id) }
                }
                var faults: [Error] = []
                for await fault in group {
                    if let fault { faults.append(fault) }
                }
                return faults
            }
            failed += faults.count
            if let last = faults.last { why = last.localizedDescription }
            // A server that cannot recognize anything, or that nobody is
            // signed in to, will not do the rest either.
            let hopeless = faults.contains { fault in
                guard let fault = fault as? APIError else { return fault is URLError }
                return fault.code == "DESCRIBE_UNAVAILABLE" || fault.status == 401 || fault.status == 0
            }
            if hopeless {
                failed += rest.count
                break
            }
        }
        await loadListings()
        return failed == 0 ? nil : (failed, why)
    }

    /// One of them: nil where it went, and what went wrong where it did not.
    private func recognizeOrPublish(_ id: String) async -> Error? {
        guard let item = item(id), item.remoteId == nil else { return nil }
        do {
            if item.isRecognized {
                try await publish(item, refreshing: false)
            } else {
                try await recognize(item, refreshing: false)
            }
            return nil
        } catch {
            return error
        }
    }

    // MARK: - items

    func item(_ id: String) -> SavedItem? {
        items.first { $0.id == id }
    }

    /// Keeps a photographed thing in the user's folder, newest first.
    func save(image: UIImage, category: String, title: String, what: String, description: String, spotIds: [String] = [], locationId: String? = nil) throws -> SavedItem {
        guard let store else { throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in")) }
        guard let jpeg = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.9) else {
            throw BackgroundRemover.Failure.noImage
        }
        let id = UUID().uuidString.lowercased()
        let photo = try store.savePhoto(jpeg.data, id: id)
        let item = SavedItem(
            id: id,
            category: category.isEmpty ? nil : category,
            title: title,
            what: what.isEmpty ? nil : what,
            description: description,
            // The phone asks for no price: it is registered at none, and set
            // on the website by whoever wants one.
            price: 0,
            currency: "JPY",
            region: nil,
            createdAt: Date(),
            photo: photo,
            width: jpeg.width,
            height: jpeg.height,
            locationId: locationId,
            remoteId: nil,
            spotId: spotIds.first,
            spotIds: spotIds.isEmpty ? nil : spotIds
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

    /// Puts an item in the user's items on rab: the photograph and its small
    /// copy go up first, then the item carrying their names, the way the
    /// website's form does it. What goes up is what the thing is and nothing
    /// more — its name, its few words, its category and its description: no
    /// price, not for rent and not for sale, no way to reach anybody. Those
    /// are its owner's to say on the website, if ever. Where it is goes up
    /// only for a thing collected at one of the account's places.
    func publish(_ item: SavedItem, refreshing: Bool = true) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        // The spots it was collected for, the ones rab still has; where none
        // is left, the item goes on the default one, as any other does.
        let onto = item.collectedFor.filter { spot($0) != nil }
        guard let image = store.loadPhoto(item),
              let full = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.82),
              let thumb = image.jpeg(maxSide: 320, quality: 0.62)
        else { throw BackgroundRemover.Failure.noImage }

        let at = self.place(item.locationId)

        let storedFull = try await api.uploadImage(full.data)
        let storedThumb = try await api.uploadImage(thumb.data)
        let body = ItemBody(
            title: item.title,
            what: item.what ?? "",
            description: item.description ?? "",
            category: item.category ?? "",
            currency: item.currency,
            translations: item.translations,
            // At the place it was collected at, where it was at one.
            latitude: at?.latitude,
            longitude: at?.longitude,
            place: at?.line,
            region: at?.region,
            images: [ImageRef(name: storedFull.name, thumb: storedThumb.name, width: full.width, height: full.height)],
            spotIds: onto.isEmpty ? nil : onto
        )
        let created = try await api.createItem(body)
        // Changed, perhaps, while it was going up: only where it is now is new.
        var published = self.item(item.id) ?? item
        published.remoteId = created.id
        try update(published)
        // It is in the server's list now, and so in the phone's.
        if refreshing { await loadListings() }
    }

    /// Where a published item is on the website.
    func pageURL(of item: SavedItem) -> URL? {
        guard let api, let remoteId = item.remoteId else { return nil }
        return api.pageURL(ofItem: remoteId)
    }
}