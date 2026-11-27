import Foundation
import SwiftUI
import UIKit

/// An area an item is offered in, as rab's server keeps it: a name, a line
/// saying where that is, and its box as [west, south, east, north].
struct Region: Codable, Hashable {
    var name: String
    var detail: String
    var bbox: [Double]
}

/// One thing photographed on this phone.
struct SavedItem: Codable, Identifiable, Hashable {
    var id: String
    /// The sort of thing it is (see Categories); none where nothing was
    /// suggested or chosen.
    var category: String?
    var title: String
    /// A few words for what it is, kept apart from its name (the website's
    /// "What is it"). Missing from the items saved before the form asked for one.
    var what: String? = nil
    /// Missing from the items saved before the form asked for one.
    var description: String?
    /// Nothing, for an item made since the form stopped asking for one.
    var price: Double
    var currency: String
    /// The area it was photographed in: kept by the items from when the phone
    /// asked where it was. Nothing is made of it any more.
    var region: Region?
    var createdAt: Date
    /// The file under photos/.
    var photo: String
    var width: Int
    var height: Int
    /// The one of the account's places it was collected at, by its id: the
    /// nearest, where the phone was within a hundred metres of one.
    var locationId: String?
    /// rab's own id for it, once it is in "My items" there.
    var remoteId: String?
    /// The spot it was collected for with the scanner, if it was: where it
    /// goes on rab once it has a name.
    var spotId: String? = nil

    /// What it says in each of rab's languages, by their codes: the brain
    /// names a thing in all three at once.
    var translations: [String: Words]? = nil

    /// Its own words: the language it was first named in.
    var own: Words { Words(title: title, what: what ?? "", description: description ?? "") }

    /// What it says, in the language the app is in.
    func words(in language: Language) -> Words { Words.of(own, translations, in: language) }

    /// Whether anything has said what it is yet. What the scanner collects is
    /// a photograph and nothing else until it is recognized.
    var isRecognized: Bool { !title.isEmpty }
}

/// The session kept between launches, with the server it is for.
struct SavedSession: Codable {
    var server: String
    var token: String
}

/// Everything one user has on this phone, in one folder named after them:
///
///     Documents/data/<username>/session.json    the signed-in session
///     Documents/data/<username>/items.json      the items, newest first
///     Documents/data/<username>/listings.json   the items as rab last listed them
///     Documents/data/<username>/spots.json      the spots as rab last listed them
///     Documents/data/<username>/places.json     the account's places as rab last listed them
///     Documents/data/<username>/photos/<id>.jpg the photographs
///
/// Documents is shared with the Files app (see Info.plist), so the folder can
/// be looked at, copied off the phone, or deleted by hand. Signing out leaves
/// it where it is; signing in again finds it.
final class UserStore {
    static let root: URL = FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("data", isDirectory: true)

    let username: String
    let folder: URL

    private var photos: URL { folder.appendingPathComponent("photos", isDirectory: true) }
    private var sessionFile: URL { folder.appendingPathComponent("session.json") }
    private var itemsFile: URL { folder.appendingPathComponent("items.json") }
    private var listingsFile: URL { folder.appendingPathComponent("listings.json") }
    private var spotsFile: URL { folder.appendingPathComponent("spots.json") }
    private var placesFile: URL { folder.appendingPathComponent("places.json") }

    init(username: String) {
        self.username = username
        folder = Self.root.appendingPathComponent(username, isDirectory: true)
        try? FileManager.default.createDirectory(at: photos, withIntermediateDirectories: true)
    }

    /// Who has a folder here.
    static func usernames() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []).sorted()
    }

    /// Forgets a user: the folder and everything in it.
    static func remove(username: String) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(username, isDirectory: true))
    }

    // MARK: - files

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private func read<T: Decodable>(_ file: URL) -> T? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? Self.decoder.decode(T.self, from: data)
    }

    private func write<T: Encodable>(_ value: T, to file: URL) throws {
        try Self.encoder.encode(value).write(to: file, options: .atomic)
    }

    // MARK: - session

    func loadSession() -> SavedSession? { read(sessionFile) }
    func saveSession(_ session: SavedSession) throws { try write(session, to: sessionFile) }
    func clearSession() { try? FileManager.default.removeItem(at: sessionFile) }

    // MARK: - items

    func loadItems() -> [SavedItem] { read(itemsFile) ?? [] }
    func saveItems(_ items: [SavedItem]) throws { try write(items, to: itemsFile) }

    // MARK: - listings

    /// What the server said the user's items were, the last time it was asked:
    /// shown at once on opening, until it has been asked again.
    func loadListings() -> [Listing]? { read(listingsFile) }
    func saveListings(_ listings: [Listing]) { try? write(listings, to: listingsFile) }

    // MARK: - places

    /// The account's places as the server last listed them.
    func loadPlaces() -> [Place] { read(placesFile) ?? [] }
    func savePlaces(_ places: [Place]) { try? write(places, to: placesFile) }

    // MARK: - spots

    /// The account's spots as the server last listed them.
    func loadSpots() -> [Spot] { read(spotsFile) ?? [] }
    func saveSpots(_ spots: [Spot]) { try? write(spots, to: spotsFile) }

    // MARK: - photos

    func photoURL(_ item: SavedItem) -> URL { photos.appendingPathComponent(item.photo) }

    /// Writes the bytes and gives back the file's name.
    func savePhoto(_ data: Data, id: String) throws -> String {
        let name = "\(id).jpg"
        try data.write(to: photos.appendingPathComponent(name), options: .atomic)
        return name
    }

    func loadPhoto(_ item: SavedItem) -> UIImage? {
        UIImage(contentsOfFile: photoURL(item).path)
    }

    func deletePhoto(_ item: SavedItem) {
        try? FileManager.default.removeItem(at: photoURL(item))
    }
}
