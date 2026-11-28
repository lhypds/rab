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

    /// Whether one of the user's items on rab is published: there for
    /// anybody to see, and so with a page worth opening. One the phone has
    /// not been told about is taken as not.
    func isPublished(_ id: String?) -> Bool {
        guard let id else { return false }
        return listing(id)?.active == true
    }

    /// Publishes one of the user's items on rab, or takes it back out of
    /// sight: an item goes up from the phone unpublished.
    func setPublished(_ on: Bool, listing id: String) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        try await api.updateItem(id, active: on)
        if let index = listings?.firstIndex(where: { $0.id == id }) {
            listings?[index].active = on
            if let listings { store?.saveListings(listings) }
        } else {
            // Not in the phone's list yet: asked for again, with it in it.
            await loadListings()
        }
    }

    func imageURL(_ path: String?) -> URL? {
        api?.imageURL(path)
    }

    func pageURL(ofListing id: String) -> URL? {
        api?.pageURL(ofItem: id)
    }

    // MARK: - describing

    /// The most photographs of one thing that are sent to be recognized: its
    /// main one — the first — and the two after it.
    static let describedPhotos = 3

    /// What rab's server makes of a photograph — its category, name and
    /// description, in the phone's language. It throws where the server cannot
    /// say: no key on it, no connection, a picture it would not describe.
    /// With `object`, the photograph is one the scanner took, or is being
    /// recognized as one: an object, to be put in one of the object categories
    /// and given its short category as well.
    /// Given several photographs of the one thing, the main one first, the
    /// first three are looked at.
    func describe(_ images: [UIImage], object: Bool = false) async throws -> Suggestion {
        let small = images.prefix(Self.describedPhotos).compactMap { $0.jpeg(maxSide: 1024, quality: 0.7)?.data }
        guard let api, !small.isEmpty else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        let code = language.rawValue
        var suggestion = try await api.describe(small, language: ["zh", "ja"].contains(code) ? code : "en", object: object)
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
    /// `recognized` is what the server said it is, where the page was filled
    /// in from that (see `suggestion`): its words in every language are then
    /// the item's, with what stands on the page in the language it is in.
    func save(_ draft: ItemDraft, for item: SavedItem, recognized: Suggestion? = nil) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard var fresh = self.item(item.id) else { return }
        let written = Words.written(draft.words, in: language, own: recognized?.own ?? fresh.own, translations: recognized.map(\.translations) ?? fresh.translations)
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
    func save(_ draft: ItemDraft, for listing: Listing, recognized: Suggestion? = nil) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        let written = Words.written(draft.words, in: language, own: recognized?.own ?? listing.own, translations: recognized.map(\.translations) ?? listing.translations)
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

    /// What rab's server says a photographed thing on this phone is, and
    /// nothing more: nothing is written anywhere. The item's page asks this,
    /// shows it, and keeps it when Save is pressed (see `save`). Nil where
    /// it is being asked already.
    /// `first` is the photograph it is gone by first — the one the page is
    /// turned to — by its place among them: the main one, where none is said.
    func suggestion(for item: SavedItem, first: Int = 0) async throws -> Suggestion? {
        guard let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard !recognizing.contains(item.id) else { return nil }
        recognizing.insert(item.id)
        defer { recognizing.remove(item.id) }
        // That photograph, and the first two of the others where it has them.
        var names = item.allPhotos
        if names.indices.contains(first) { names.insert(names.remove(at: first), at: 0) }
        guard let image = UIImage(contentsOfFile: store.photoURL(named: names[0]).path) else { throw BackgroundRemover.Failure.noImage }
        let more = names.dropFirst().prefix(Self.describedPhotos - 1)
            .compactMap { UIImage(contentsOfFile: store.photoURL(named: $0).path) }
        return try await describe([image] + more, object: true)
    }

    /// The same for an item on rab: its first photographs — the main one and
    /// the two after it — are fetched and looked at.
    /// `first` is the address of the photograph it is gone by first.
    func suggestion(for listing: Listing, first: String? = nil) async throws -> Suggestion? {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard !recognizing.contains(listing.id) else { return nil }
        recognizing.insert(listing.id)
        defer { recognizing.remove(listing.id) }
        var pictures = listing.images ?? []
        if let first, let at = pictures.firstIndex(where: { $0.src == first }) {
            pictures.insert(pictures.remove(at: at), at: 0)
        }
        guard let path = pictures.first?.src,
              let image = UIImage(data: try await api.imageData(path))
        else { throw BackgroundRemover.Failure.noImage }
        // One after the first that cannot be fetched is left out.
        var images = [image]
        for picture in pictures.dropFirst().prefix(Self.describedPhotos - 1) {
            if let data = try? await api.imageData(picture.src), let next = UIImage(data: data) { images.append(next) }
        }
        return try await describe(images, object: true)
    }

    /// Says what a photographed thing is — its category among the objects, its
    /// short category, a name and a description, all from rab's server — and
    /// writes that over whatever it said before. It then goes onto rab — onto
    /// the spot it was collected for; one that is there already is changed
    /// there too.
    func recognize(_ item: SavedItem, refreshing: Bool = true) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard let suggestion = try await suggestion(for: item) else { return }
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

    /// The photograph of an item on rab as a file on this phone, to be shared:
    /// fetched whole, and kept among the temporary files, where the system
    /// clears it away.
    func photoFile(of listing: Listing) async throws -> URL {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard let path = listing.images?.first?.src else { throw BackgroundRemover.Failure.noImage }
        let data = try await api.imageData(path)
        let kind = URL(fileURLWithPath: path.components(separatedBy: "?")[0]).pathExtension
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("rab-\(listing.id)")
            .appendingPathExtension(kind.isEmpty ? "jpg" : kind)
        try data.write(to: file, options: .atomic)
        return file
    }

    /// The same for an item on rab: its first photographs are looked at, and
    /// what it says it is written over there.
    func recognize(_ listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard let suggestion = try await suggestion(for: listing) else { return }
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

    /// Deletes an item for good: from rab first, where it is there, and then
    /// the copy this phone keeps. Where rab cannot be reached nothing is
    /// deleted, so the two never come apart.
    func remove(_ item: SavedItem) async throws {
        guard let fresh = self.item(item.id) else { return }
        if let remoteId = fresh.remoteId {
            guard let api else {
                throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
            }
            do {
                try await api.deleteItem(remoteId)
            } catch let error as APIError where error.status == 404 {
                // Already gone from there, which is what was asked for.
            }
            listings?.removeAll { $0.id == remoteId }
            if let listings { store?.saveListings(listings) }
        }
        delete(fresh)
    }

    /// Only the copy this phone keeps: for what was never on rab, or is
    /// already gone from it.
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
        guard store.loadPhoto(item) != nil else { throw BackgroundRemover.Failure.noImage }

        let at = self.place(item.locationId)

        // Every photograph of it, the first first; one added later whose
        // file is gone is left out.
        // One whose background was removed goes up as its cut-out, in its
        // place: the photograph it was made of stays on this phone, for
        // when its background is put back.
        var pictures: [ImageRef] = []
        for name in item.allPhotos {
            guard let image = UIImage(contentsOfFile: store.photoURL(named: name).path) else { continue }
            let main = name == item.photo
            let hex = (main ? item.backdropColor : nil) ?? BackgroundRemover.defaultBackdrop
            // The one made when the button was pressed, as it was shown —
            // or, the main one's file being gone, made again now. A
            // photograph nothing stands out of goes up as it is.
            var cut: PicturesBody.Picture?
            if let made = item.cut(of: name).flatMap({ UIImage(contentsOfFile: store.photoURL(named: $0).path) }) {
                cut = try await upload(made, with: api)
            } else if main, item.backdropColor != nil {
                cut = try await cutOut(image, on: hex, with: api)
            }
            if let cut {
                pictures.append(ImageRef(name: cut.name, thumb: cut.thumb, width: cut.width ?? 1, height: cut.height ?? 1, backdrop: hex))
                if let taken = try? Data(contentsOf: store.photoURL(named: name)) { try? store.keepOriginal(taken, ofCut: cut.name) }
                continue
            }
            let sent = try await upload(image, with: api)
            pictures.append(ImageRef(name: sent.name, thumb: sent.thumb, width: sent.width ?? 1, height: sent.height ?? 1))
        }
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
            images: pictures,
            spotIds: onto.isEmpty ? nil : onto
        )
        let created = try await api.createItem(body)
        // Changed, perhaps, while it was going up: only where it is now is new.
        var published = self.item(item.id) ?? item
        published.remoteId = created.id
        // It is in the server's list now, and so in the phone's — at once, as
        // the server answered it, the newest first: it is no longer among
        // the ones waiting, and would be gone from the grid until the list
        // was next asked for.
        if listings != nil, listing(created.id) == nil {
            listings?.insert(created, at: 0)
            if let listings { store.saveListings(listings) }
        }
        try update(published)
        if refreshing { await loadListings() }
    }

    // MARK: - backgrounds

    /// A photograph's subject, cut out of its background and stood on a
    /// colour, sent up as a photograph is: what an item carries first, as
    /// its main one. Nil where nothing stands out of the photograph.
    private func cutOut(_ image: UIImage, on hex: String, with api: RabAPI) async throws -> PicturesBody.Picture? {
        let subject: UIImage
        do {
            subject = try await BackgroundRemover.cutOut(image)
        } catch BackgroundRemover.Failure.noSubject {
            return nil
        }
        var sent = try await upload(subject.over(UIColor(hex: hex) ?? .white), with: api)
        sent.backdrop = hex
        return sent
    }

    /// Has one photograph of an item on rab — the one at the address given
    /// — cut out of its background and stood on a colour ("#rrggbb"), or,
    /// the colour being nil, puts its background back. The cut-out takes the
    /// photograph's place among the item's: there is still one of it. The
    /// photograph as it was taken is kept on this phone (see
    /// `UserStore.keepOriginal`), and is what goes back up when its
    /// background is put back — which only the phone that has it can do.
    /// What the item has is asked of the server first.
    func setBackdrop(_ hex: String?, ofListing id: String, picture src: String) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard let pictures = try await api.mine().items.first(where: { $0.id == id })?.images,
              let index = pictures.firstIndex(where: { $0.src == src })
        else { throw BackgroundRemover.Failure.noImage }
        var kept = pictures.map { PicturesBody.Picture($0) }
        if let hex {
            // Cut out already.
            guard pictures[index].backdrop == nil else { return }
            let taken = try await takenBytes(of: src, with: api)
            guard let image = UIImage(data: taken) else { throw BackgroundRemover.Failure.noImage }
            guard let cut = try await cutOut(image, on: hex, with: api) else { throw BackgroundRemover.Failure.noSubject }
            // Marked with the cut-out's name too, where the phone has it
            // already; kept and marked, where it is new to it.
            if !store.markOriginal(of: Self.storedName(src), alsoAs: cut.name) { try store.keepOriginal(taken, ofCut: cut.name) }
            kept[index] = cut
        } else {
            guard pictures[index].backdrop != nil else { return }
            let cut = kept[index].name
            guard let file = store.originalURL(ofCut: cut), let image = UIImage(contentsOfFile: file.path) else {
                // Not on this phone. A cut-out from when one was put in
                // front of its photograph, not in its place, has the
                // photograph right after it still — the same size, and as
                // it was taken: taking the cut-out away is all there is to
                // do. Anything else cannot be put back from here.
                let next = index + 1
                if pictures.indices.contains(next), pictures[next].backdrop == nil,
                   let width = pictures[index].width, let height = pictures[index].height,
                   pictures[next].width == width, pictures[next].height == height {
                    kept.remove(at: index)
                    try await api.updateItem(id, PicturesBody(images: kept))
                    await loadListings()
                    return
                }
                throw APIError(status: 0, code: nil, message: Language.text("The original photo is not on this phone"))
            }
            let back = try await upload(image, with: api)
            kept[index] = back
            try await api.updateItem(id, PicturesBody(images: kept))
            // It stays on the phone, marked with the name it has gone back
            // up under: what the next cut-out is made of.
            store.markOriginal(of: cut, alsoAs: back.name)
            await loadListings()
            return
        }
        try await api.updateItem(id, PicturesBody(images: kept))
        await loadListings()
    }

    /// A photograph of an item on rab as it was taken, to make a cut-out
    /// of: the one this phone keeps, where it is marked as that one — the
    /// very bytes, not a copy that has been through rab again — and
    /// fetched from rab otherwise.
    private func takenBytes(of src: String, with api: RabAPI) async throws -> Data {
        if let file = store?.originalURL(ofCut: Self.storedName(src)), let kept = try? Data(contentsOf: file) { return kept }
        return try await api.imageData(src)
    }

    /// The name rab keeps a photograph under, from the address it is at.
    private static func storedName(_ src: String) -> String {
        src.components(separatedBy: "?")[0].components(separatedBy: "/").last ?? src
    }

    /// What one of an item on rab's photographs would be with its
    /// background removed: its subject on white, made here and sent
    /// nowhere — to be looked at, and kept only when Save is pressed (see
    /// `saveBackdrops`). With it the photograph as it was taken, which is
    /// then kept on this phone.
    func cutOutPreview(of src: String) async throws -> (image: UIImage, taken: Data) {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        let taken = try await takenBytes(of: src, with: api)
        guard let image = UIImage(data: taken) else { throw BackgroundRemover.Failure.noImage }
        let cut = try await BackgroundRemover.cutOut(image).over(UIColor(hex: BackgroundRemover.defaultBackdrop) ?? .white)
        return (cut, taken)
    }

    /// The photograph a cut-out on rab was made of, where this phone has
    /// it: what the cut-out would be with its background put back.
    func originalPreview(ofCut src: String) -> UIImage? {
        store?.originalURL(ofCut: Self.storedName(src)).flatMap { UIImage(contentsOfFile: $0.path) }
    }

    /// Keeps on rab what was only looked at till now: the cut-outs made of
    /// some of an item's photographs, each in its photograph's place — by
    /// the photograph's address, with the photograph as it was taken, which
    /// stays on this phone — and the backgrounds put back, by the cut-outs'
    /// addresses. All at once: the item is told its photographs one time.
    ///
    /// `dropped` are cut-outs taken away outright, by their addresses: the
    /// ones whose photograph stands right after them still (see
    /// `Listing.originalAfter`).
    func saveBackdrops(ofListing id: String, cuts: [String: (image: UIImage, taken: Data)], restored: [String], dropped: [String] = []) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard !cuts.isEmpty || !restored.isEmpty || !dropped.isEmpty else { return }
        guard let pictures = try await api.mine().items.first(where: { $0.id == id })?.images else {
            throw BackgroundRemover.Failure.noImage
        }
        var kept = pictures.map { PicturesBody.Picture($0) }
        // The photographs gone back up: each stays on the phone, and is
        // marked with the name it went up under once the item has it.
        var marks: [(was: String, now: String)] = []
        for (index, picture) in pictures.enumerated() {
            if let cut = cuts[picture.src], picture.backdrop == nil {
                var sent = try await upload(cut.image, with: api)
                sent.backdrop = BackgroundRemover.defaultBackdrop
                if !store.markOriginal(of: Self.storedName(picture.src), alsoAs: sent.name) { try store.keepOriginal(cut.taken, ofCut: sent.name) }
                kept[index] = sent
            } else if restored.contains(picture.src), picture.backdrop != nil {
                let name = kept[index].name
                guard let file = store.originalURL(ofCut: name), let image = UIImage(contentsOfFile: file.path) else {
                    throw APIError(status: 0, code: nil, message: Language.text("The original photo is not on this phone"))
                }
                let back = try await upload(image, with: api)
                kept[index] = back
                marks.append((name, back.name))
            }
        }
        // The ones taken away: never the last photograph it has.
        let away = Set(pictures.filter { dropped.contains($0.src) && $0.backdrop != nil }.map { PicturesBody.Picture($0).name })
        let left = kept.filter { !away.contains($0.name) }
        if !left.isEmpty { kept = left }
        try await api.updateItem(id, PicturesBody(images: kept))
        for mark in marks { store.markOriginal(of: mark.was, alsoAs: mark.now) }
        await loadListings()
    }

    /// The same for one of the photographs of an item on this phone, by its
    /// place among them. Of one that is on rab it is done there; of one that
    /// is not yet the cut-out is made here, and goes up with the item.
    func setBackdrop(_ hex: String?, of item: SavedItem, photo index: Int) async throws {
        guard var fresh = self.item(item.id) else { return }
        if let remoteId = fresh.remoteId {
            let there = listing(remoteId)?.images ?? []
            guard there.indices.contains(index) else { throw BackgroundRemover.Failure.noImage }
            try await setBackdrop(hex, ofListing: remoteId, picture: there[index].src)
            return
        }
        guard let store, fresh.allPhotos.indices.contains(index) else { return }
        let name = fresh.allPhotos[index]
        guard let hex else {
            forgetCut(of: &fresh, photo: name)
            try update(fresh)
            return
        }
        // Made here and now, and kept beside the photograph it is made of:
        // what the item's page — and, of the main one, its tile — show
        // from then on.
        guard let image = UIImage(contentsOfFile: store.photoURL(named: name).path) else { throw BackgroundRemover.Failure.noImage }
        let cut = try await BackgroundRemover.cutOut(image).over(UIColor(hex: hex) ?? .white)
        guard let jpeg = cut.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.9) else {
            throw BackgroundRemover.Failure.noImage
        }
        // Changed, perhaps, while it was being made.
        guard var now = self.item(item.id), now.allPhotos.contains(name) else { return }
        forgetCut(of: &now, photo: name)
        var cuts = now.allCuts
        cuts[name] = try store.savePhoto(jpeg.data, id: UUID().uuidString.lowercased())
        if name == now.photo { now.backdrop = hex }
        now.setCuts(cuts)
        try update(now)
    }

    /// Takes away the cut-out an item on this phone has of one of its
    /// photographs, file and all: the photograph is as it was taken again.
    private func forgetCut(of item: inout SavedItem, photo name: String) {
        var cuts = item.allCuts
        if let cut = cuts[name], let store { try? FileManager.default.removeItem(at: store.photoURL(named: cut)) }
        cuts[name] = nil
        item.setCuts(cuts)
    }

    // MARK: - more photographs

    /// A photograph sent up, with its small copy, the way the website's form
    /// sends one: what an item then carries it as.
    private func upload(_ image: UIImage, with api: RabAPI) async throws -> PicturesBody.Picture {
        guard let full = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.82),
              let thumb = image.jpeg(maxSide: 320, quality: 0.62)
        else { throw BackgroundRemover.Failure.noImage }
        let storedFull = try await api.uploadImage(full.data)
        let storedThumb = try await api.uploadImage(thumb.data)
        return PicturesBody.Picture(name: storedFull.name, thumb: storedThumb.name, width: full.width, height: full.height)
    }

    /// Adds a photograph to an item on rab, after the ones it has. What it
    /// has is asked of the server first: the item is told all its
    /// photographs at once, and none it has may be left out.
    private func addPhoto(_ image: UIImage, toListing id: String, with api: RabAPI) async throws {
        let had = try await api.mine().items.first { $0.id == id }
        guard let had else {
            throw APIError(status: 404, code: nil, message: Language.text("The photo could not be read"))
        }
        let sent = try await upload(image, with: api)
        try await api.updateItem(id, PicturesBody(images: (had.images ?? []).map { PicturesBody.Picture($0) } + [sent]))
        await loadListings()
    }

    /// Takes a photograph off an item on rab: the one at the address given.
    /// What the item has is asked of the server first, as for adding. Its
    /// last photograph stays: an item is not left with none.
    private func removePhoto(_ src: String, fromListing id: String, with api: RabAPI) async throws {
        let had = try await api.mine().items.first { $0.id == id }?.images ?? []
        let kept = had.filter { $0.src != src }
        guard kept.count < had.count, !kept.isEmpty else { return }
        try await api.updateItem(id, PicturesBody(images: kept.map { PicturesBody.Picture($0) }))
        await loadListings()
    }

    /// The same for an item on rab.
    func removePhoto(_ src: String, from listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        try await removePhoto(src, fromListing: listing.id, with: api)
    }

    /// Takes one of its photographs off an item on this phone, by its file's
    /// name, and deletes the file. Where it was the first, the next is the
    /// first now; the last one stays. On rab too, where the item is there
    /// with the same photographs in the same order.
    func removePhoto(_ name: String, from item: SavedItem) async throws {
        guard let store, var fresh = self.item(item.id) else { return }
        var names = fresh.allPhotos
        guard names.count > 1, let index = names.firstIndex(of: name) else { return }
        // Which it is on rab, asked before anything is changed here.
        var remote: (id: String, src: String)?
        if let remoteId = fresh.remoteId, let api {
            let there = try await api.mine().items.first { $0.id == remoteId }?.images ?? []
            if there.count == names.count { remote = (remoteId, there[index].src) }
        }
        // Its cut-out goes with it; the others stay with their photographs.
        forgetCut(of: &fresh, photo: name)
        let cuts = fresh.allCuts
        names.remove(at: index)
        fresh.photo = names[0]
        fresh.morePhotos = names.count > 1 ? Array(names.dropFirst()) : nil
        if index == 0, let first = UIImage(contentsOfFile: store.photoURL(named: names[0]).path) {
            fresh.width = Int(first.size.width * first.scale)
            fresh.height = Int(first.size.height * first.scale)
        }
        fresh.setCuts(cuts)
        try update(fresh)
        try? FileManager.default.removeItem(at: store.photoURL(named: name))
        if let remote, let api {
            try await removePhoto(remote.src, fromListing: remote.id, with: api)
        }
    }

    /// Makes one of an item's photographs on rab its main one: the first of
    /// them, the others after it in the order they were in. What the item
    /// has is asked of the server first, as for adding.
    private func setMainPhoto(_ src: String, ofListing id: String, with api: RabAPI) async throws {
        var had = try await api.mine().items.first { $0.id == id }?.images ?? []
        guard let index = had.firstIndex(where: { $0.src == src }), index > 0 else { return }
        had.insert(had.remove(at: index), at: 0)
        try await api.updateItem(id, PicturesBody(images: had.map { PicturesBody.Picture($0) }))
        await loadListings()
    }

    /// The same for an item on rab.
    func setMainPhoto(_ src: String, of listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        try await setMainPhoto(src, ofListing: listing.id, with: api)
    }

    /// Makes one of its photographs the main one of an item on this phone,
    /// by its file's name: the first, the one its tile shows. On rab too,
    /// where the item is there with the same photographs in the same order.
    func setMainPhoto(_ name: String, of item: SavedItem) async throws {
        guard let store, var fresh = self.item(item.id) else { return }
        var names = fresh.allPhotos
        guard let index = names.firstIndex(of: name), index > 0 else { return }
        // Which it is on rab, asked before anything is changed here.
        var remote: (id: String, src: String)?
        if let remoteId = fresh.remoteId, let api {
            let there = try await api.mine().items.first { $0.id == remoteId }?.images ?? []
            if there.count == names.count { remote = (remoteId, there[index].src) }
        }
        // Each cut-out stays with the photograph it was made of.
        let cuts = fresh.allCuts
        names.insert(names.remove(at: index), at: 0)
        fresh.photo = names[0]
        fresh.morePhotos = Array(names.dropFirst())
        if let first = UIImage(contentsOfFile: store.photoURL(named: names[0]).path) {
            fresh.width = Int(first.size.width * first.scale)
            fresh.height = Int(first.size.height * first.scale)
        }
        fresh.setCuts(cuts)
        try update(fresh)
        if let remote, let api {
            try await setMainPhoto(remote.src, ofListing: remote.id, with: api)
        }
    }

    /// One more photograph of an item on this phone: kept in the user's
    /// folder after the ones it has, and added on rab too where the item is
    /// there. One that is not there yet takes them all up when it goes.
    func addPhoto(_ image: UIImage, to item: SavedItem) async throws {
        guard let api, let store else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        guard let jpeg = image.jpeg(maxSide: BackgroundRemover.maxSide, quality: 0.9) else {
            throw BackgroundRemover.Failure.noImage
        }
        guard var fresh = self.item(item.id) else { return }
        let name = try store.savePhoto(jpeg.data, id: UUID().uuidString.lowercased())
        fresh.morePhotos = (fresh.morePhotos ?? []) + [name]
        try update(fresh)
        if let remoteId = fresh.remoteId {
            try await addPhoto(image, toListing: remoteId, with: api)
        }
    }

    /// The same for an item on rab.
    func addPhoto(_ image: UIImage, to listing: Listing) async throws {
        guard let api else {
            throw APIError(status: 0, code: "LOGIN_REQUIRED", message: Language.text("Please sign in"))
        }
        try await addPhoto(image, toListing: listing.id, with: api)
    }

    /// Where a published item is on the website.
    func pageURL(of item: SavedItem) -> URL? {
        guard let api, let remoteId = item.remoteId else { return nil }
        return api.pageURL(ofItem: remoteId)
    }
}