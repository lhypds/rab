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
    /// The photographs added to it after its first, as files under photos/,
    /// in the order they were taken. Missing from an item with only the one.
    var morePhotos: [String]? = nil

    /// Every photograph of it: the first, then the ones added.
    var allPhotos: [String] { [photo] + (morePhotos ?? []) }

    /// The spot it was collected for with the scanner, if it was: where it
    /// goes on rab once it has a name.
    var spotId: String? = nil
    /// The spots it was collected for, where it was for several: it goes on
    /// each of them. (`spotId` is the first, and all there is in an item from
    /// when there could be only one.)
    var spotIds: [String]? = nil

    /// Every spot it was collected for.
    var collectedFor: [String] { spotIds ?? spotId.map { [$0] } ?? [] }

    /// What it says in each of rab's languages, by their codes: the brain
    /// names a thing in all three at once.
    var translations: [String: Words]? = nil

    /// The colour its main photograph's subject is to stand on once it is on
    /// rab, as "#rrggbb"; "none" — or nothing said — where the photograph
    /// is to be left as it was taken: the background is only removed where
    /// its button was pressed.
    var backdrop: String? = nil

    /// The same as what is done: the colour, or nil for none.
    var backdropColor: String? {
        backdrop == BackgroundRemover.noBackdrop ? nil : backdrop
    }

    /// The main photograph with its subject cut out and stood on that
    /// colour, as a file under photos/: made on the phone when the button
    /// is pressed, shown at once, and what goes up first when the item does.
    var cutPhoto: String? = nil

    /// The same of the photographs after the main one: each cut-out's file,
    /// by the file of the photograph it was made of.
    var moreCuts: [String: String]? = nil

    /// The cut-out made of one of its photographs, where its background has
    /// been removed.
    func cut(of name: String) -> String? { name == photo ? cutPhoto : moreCuts?[name] }

    /// Every cut-out it has, by the file of the photograph it was made of.
    var allCuts: [String: String] {
        var all = moreCuts ?? [:]
        if let cutPhoto { all[photo] = cutPhoto }
        return all
    }

    /// Keeps the cut-outs given, of the photographs it has now: the main
    /// one's as the main one's, whichever photograph that is by now.
    mutating func setCuts(_ all: [String: String]) {
        let names = allPhotos
        cutPhoto = all[photo]
        let rest = all.filter { $0.key != photo && names.contains($0.key) }
        moreCuts = rest.isEmpty ? nil : rest
        if cutPhoto == nil {
            backdrop = BackgroundRemover.noBackdrop
        } else if backdropColor == nil {
            backdrop = BackgroundRemover.defaultBackdrop
        }
    }

    /// Every photograph as its page shows them: each one's cut-out in its
    /// place, where its background has been removed, and the photograph as
    /// it was taken otherwise. The one it was made of is kept, out of sight,
    /// for when its background is put back.
    var shownPhotos: [String] {
        allPhotos.map { cut(of: $0) ?? $0 }
    }

    /// The photograph as it was taken that one of those shown is, or was
    /// made of.
    func original(ofShown name: String) -> String? {
        if allPhotos.contains(name) { return name }
        return allCuts.first { $0.value == name }?.key
    }

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

    /// One of an item's photographs, by its file's name.
    func photoURL(named name: String) -> URL { photos.appendingPathComponent(name) }

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
        for name in item.allPhotos + Array(item.allCuts.values) {
            try? FileManager.default.removeItem(at: photoURL(named: name))
        }
    }

    // MARK: - originals

    /// The photographs as they were taken, kept on this phone for good and
    /// marked: by every name rab keeps one of them under — the cut-out made
    /// of it, and the photograph itself once it has gone back up in the
    /// cut-out's place — the file under photos/ that is it. An item on rab
    /// carries the cut-out where the photograph was; this is where the
    /// photograph is, whenever its background is to be put back, and what
    /// the next cut-out is made of. Several names may be one file's.
    private var originalsFile: URL { folder.appendingPathComponent("originals.json") }

    private func loadOriginals() -> [String: String] { read(originalsFile) ?? [:] }

    /// The photograph as it was taken that what rab keeps under a name is,
    /// or was made of, where this phone has it.
    func originalURL(ofCut name: String) -> URL? {
        guard let file = loadOriginals()[name] else { return nil }
        let url = photoURL(named: file)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Keeps the bytes of the photograph a cut-out on rab was made of,
    /// marked with the cut-out's name.
    func keepOriginal(_ data: Data, ofCut name: String) throws {
        var all = loadOriginals()
        all[name] = try savePhoto(data, id: "original-\(UUID().uuidString.lowercased())")
        try write(all, to: originalsFile)
    }

    /// Marks the photograph kept under one name with another as well: the
    /// cut-out just made of it, or itself, gone back up under a new name.
    /// False where there is none kept under the first.
    @discardableResult
    func markOriginal(of name: String, alsoAs other: String) -> Bool {
        var all = loadOriginals()
        guard let file = all[name], FileManager.default.fileExists(atPath: photoURL(named: file).path) else { return false }
        all[other] = file
        try? write(all, to: originalsFile)
        return true
    }
}
