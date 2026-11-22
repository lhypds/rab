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

/// What is being rented out, as rab's server names it: something owned, a
/// place, or somebody's time.
enum Kind: String, Codable, CaseIterable, Identifiable {
    case item, space, service

    var id: String { rawValue }

    /// As the website's tabs call them.
    var name: LocalizedStringKey {
        switch self {
        case .item: "Things"
        case .space: "Spaces"
        case .service: "Services"
        }
    }
}

/// A place of the user's that things can be attached to — "Home", "The
/// studio": a name, and where the phone was when it was added, if it could say.
struct SavedLocation: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var latitude: Double?
    var longitude: Double?
    /// The area the spot is in.
    var region: Region?
    /// The address the spot came to, as a line.
    var address: String?
    var createdAt: Date
}

/// One thing photographed on this phone.
struct SavedItem: Codable, Identifiable, Hashable {
    var id: String
    /// Missing from the items saved before there was a choice: those are things.
    var kind: Kind?
    var title: String
    /// Missing from the items saved before the form asked for one.
    var description: String?
    /// Nothing, for an item made since the form stopped asking for one.
    var price: Double
    var currency: String
    var region: Region?
    var createdAt: Date
    /// The file under photos/.
    var photo: String
    var width: Int
    var height: Int
    /// The location it is attached to, if any (see SavedLocation).
    var locationId: String?
    /// rab's own id for it, once it is in "My items" there.
    var remoteId: String?
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
///     Documents/data/<username>/locations.json  the places items are attached to
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
    private var locationsFile: URL { folder.appendingPathComponent("locations.json") }

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

    // MARK: - locations

    func loadLocations() -> [SavedLocation] { read(locationsFile) ?? [] }
    func saveLocations(_ locations: [SavedLocation]) throws { try write(locations, to: locationsFile) }

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
