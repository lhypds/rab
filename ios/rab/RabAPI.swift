import Foundation

/// What rab's server said when it refused: its sentence, and a code where it
/// gave one (see server/index.js).
struct APIError: LocalizedError {
    let status: Int
    let code: String?
    let message: String
    var errorDescription: String? { message }
}

struct RemoteUser: Decodable {
    let username: String
}

struct AuthReply: Decodable {
    let token: String
    let user: RemoteUser
}

/// A photograph the server stored, named after its own bytes.
struct StoredImage: Decodable {
    let name: String
    let url: String
}

struct ImageRef: Encodable {
    let name: String
    let thumb: String
    let width: Int
    let height: Int
}

/// The photographs an item on rab is to carry (PATCH /api/items/:id): all of
/// them, the ones it had by the names they are kept under and the new ones
/// after them. Nothing else of the item is changed.
struct PicturesBody: Encodable {
    struct Picture: Encodable {
        var name: String
        var thumb: String
        var width: Int?
        var height: Int?
    }

    var images: [Picture]
}

extension PicturesBody.Picture {
    /// One the item has already, from the addresses the server lists it by.
    init(_ picture: Listing.Picture) {
        let file = { (path: String) in path.components(separatedBy: "?")[0].components(separatedBy: "/").last ?? path }
        self.init(
            name: file(picture.src),
            thumb: file(picture.thumb ?? picture.src),
            width: picture.width.map { Int($0) },
            height: picture.height.map { Int($0) }
        )
    }
}

/// The most the server keeps of an item's few words for what it is (WHAT_MAX).
let whatMax = 40

/// An item as the phone registers it, for the server's parseItem: what the
/// thing is — its name, its few words, its category, its description and its
/// photograph — and nothing about having it: no price, not lent out, not for
/// sale, no contacts of its own (it follows its account's), and a place only
/// where it was collected at one of the account's.
struct ItemBody: Encodable {
    var title: String
    /// A few words for what it is (at most `whatMax` characters).
    var what = ""
    var description = ""
    var category = ""
    /// What a price would be in, were there one: the server keeps one for
    /// every item.
    var currency: String
    /// Not lent out — and, no sale price being sent, not for sale either.
    var rentable = false
    /// Reached the way its account is: it writes no contacts of its own and
    /// shows the account's, as they are on the website's account sheet — a
    /// message on rab, until the account puts another first.
    var followContacts = true
    /// The same in each of rab's languages, where the brain has said them.
    var translations: [String: Words]?
    /// Where it is: the one of the account's places it was collected at,
    /// where it was within reach of one (see `Place`) — its pin, the line by
    /// the pin and the area it is in. Left out for one collected anywhere else.
    var latitude: Double?
    var longitude: Double?
    var place: String?
    var region: Region?
    var images: [ImageRef]
    /// The spots it goes on, where any were chosen: the one it was collected
    /// for (see the scanner). Left out, the server puts it on the account's
    /// default spot.
    var spotIds: [String]?
    /// Not on the map yet: what the phone sends is a start, and its owner
    /// finishes it in their items on the website and publishes it from there.
    var active = false
}

/// One of the user's items as the server lists it (GET /api/mine): what the
/// phone's list of items is made of.
struct Listing: Codable, Identifiable, Hashable {
    struct Picture: Codable, Hashable {
        var src: String
        var thumb: String?
        var width: Double?
        var height: Double?
    }

    var id: String
    var title: String
    var what: String?
    var description: String?
    var category: String?
    /// What it says in each of rab's languages, where it has been said in them.
    var translations: [String: Words]?
    var price: Double?
    var currency: String?
    var place: String?
    var region: Region?
    /// Its pin, where it has one (`located`): the two numbers mean nothing
    /// otherwise.
    var located: Bool?
    var latitude: Double?
    var longitude: Double?
    var images: [Picture]?
    var thumb: String?
    var active: Bool?
}

extension Listing {
    /// Its own words: the language it was first named in.
    var own: Words { Words(title: title, what: what ?? "", description: description ?? "") }

    /// What it says, in the language the app is in.
    func words(in language: Language) -> Words { Words.of(own, translations, in: language) }
}

/// What the server made of a photograph (POST /api/describe): the listing's
/// category, and a name and a description for it.
struct Suggestion: Decodable {
    var category: String
    /// The short category — the sort of thing it is in a word or two — which
    /// is only said of a photograph sent as an object's (see `describe`).
    var what: String?
    var title: String
    var description: String
    /// The same in all three of rab's languages, by their codes ("en", "zh",
    /// "ja"): only said of a photograph sent as an object's, and missing from
    /// a server from before it said them.
    var translations: [String: Words]?
}

/// One of the account's spots as the server lists it (GET /api/mine): a
/// collection of its items — a shop, a shelf, a room — that the scanner
/// collects things onto.
struct Spot: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    /// The line under its pin, where it has one.
    var place: String?
    var region: Region?
    var latitude: Double?
    var longitude: Double?
    /// Whether it has a pin at all: the two numbers above mean nothing otherwise.
    var located: Bool?
    /// How many items are on it.
    var count: Int?
    var thumb: String?
    /// The spot every account has from the first, named after it.
    var isDefault: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, place, region, latitude, longitude, located, count, thumb
        case isDefault = "default"
    }

    /// Read leniently: a spot is a whole item on the server, and nothing but
    /// its id and its name is needed to list it.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        title = (try? values.decode(String.self, forKey: .title)) ?? ""
        place = try? values.decodeIfPresent(String.self, forKey: .place)
        region = try? values.decodeIfPresent(Region.self, forKey: .region)
        latitude = try? values.decodeIfPresent(Double.self, forKey: .latitude)
        longitude = try? values.decodeIfPresent(Double.self, forKey: .longitude)
        located = try? values.decodeIfPresent(Bool.self, forKey: .located)
        count = try? values.decodeIfPresent(Int.self, forKey: .count)
        thumb = try? values.decodeIfPresent(String.self, forKey: .thumb)
        isDefault = try? values.decodeIfPresent(Bool.self, forKey: .isDefault)
    }
}

/// What an item says it is, as its page has it written: its name, its few
/// words for what it is, its description and its category. What is on the
/// page, what is kept, and what is sent to rab.
struct ItemDraft: Equatable {
    var title: String
    var what: String
    var description: String
    var category: String

    /// The words of it, without the category.
    var words: Words { Words(title: title, what: what, description: description) }

    init(_ words: Words, category: String) {
        self.init(title: words.title, what: words.what, description: words.description, category: category)
    }

    init(title: String, what: String, description: String, category: String) {
        self.title = title
        self.what = what
        self.description = description
        self.category = category
    }

    /// As it is kept: nothing but blanks is nothing, and the few words are
    /// no more than the server keeps.
    var tidy: ItemDraft {
        ItemDraft(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            what: String(what.trimmingCharacters(in: .whitespacesAndNewlines).prefix(whatMax)),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category
        )
    }
}

/// What is changed of an item by recognizing it again, or by saving its page
/// (PATCH /api/items/:id): what it says it is, and nothing else — the rest
/// stays as it was.
struct RecognizedBody: Encodable {
    var title: String
    var what: String
    var description: String
    var category: String
    /// The same in each of rab's languages, where it has been said in them.
    /// Left out, the server keeps what it had.
    var translations: [String: Words]?
}

/// What an item says of itself in one language: its name, its few words for
/// what it is, and its description.
struct Words: Codable, Hashable {
    var title: String
    var what: String
    var description: String

    init(title: String, what: String, description: String) {
        self.title = title
        self.what = what
        self.description = description
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? values.decode(String.self, forKey: .title)) ?? ""
        what = (try? values.decode(String.self, forKey: .what)) ?? ""
        description = (try? values.decode(String.self, forKey: .description)) ?? ""
    }

    /// What an item says, in the language asked for: that language's words
    /// where it has been said in it, and the item's own otherwise.
    static func of(_ own: Words, _ translations: [String: Words]?, in language: Language) -> Words {
        guard let words = translations?[language.rawValue], !words.title.isEmpty else { return own }
        return words
    }

    /// What an item says once `new` has been written in `language`: its own
    /// words, and its words in every language. The language written in is
    /// changed. Its own words are the default, which is English (item.json
    /// on the server): they follow only what is written in English — and
    /// whatever is written, where the item is said in no other language.
    static func written(_ new: Words, in language: Language, own: Words, translations: [String: Words]?) -> (own: Words, translations: [String: Words]?) {
        guard var all = translations else { return (new, nil) }
        all[language.rawValue] = new
        return (language == .en ? new : own, all)
    }
}

/// Where an item on rab is said to be (PATCH /api/items/:id): at one of the
/// account's places — its pin, the line by the pin, and its area — or
/// nowhere, which is said outright: the pin and its line as nothing.
struct WhereBody: Encodable {
    var place: Place?

    enum CodingKeys: String, CodingKey {
        case latitude, longitude, place, region
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        guard let place else {
            // The area stays as it was: an item may be offered somewhere
            // without standing on a pin.
            try values.encodeNil(forKey: .latitude)
            try values.encodeNil(forKey: .longitude)
            try values.encodeNil(forKey: .place)
            return
        }
        try values.encode(place.latitude, forKey: .latitude)
        try values.encode(place.longitude, forKey: .longitude)
        try values.encode(place.line, forKey: .place)
        if let region = place.region { try values.encode(region, forKey: .region) }
    }
}

/// One of the account's places as rab keeps them (GET /api/locations) —
/// "Home", "The shop": made on the website, and what a thing collected near
/// one is said to be at.
struct Place: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var address: String?
    var latitude: Double
    var longitude: Double
    var region: Region?

    /// The line written by an item's pin: the place's address, or its name
    /// where it has none.
    var line: String { address?.isEmpty == false ? address! : name }
}

private struct PlacesReply: Decodable {
    let locations: [Place]
}

private struct MineReply: Decodable {
    let items: [Listing]
    /// Missing from a server from before there were spots.
    let spots: [Spot]?
}

struct RemoteItem: Decodable {
    let id: String
}

private struct ItemReply: Decodable {
    let item: RemoteItem
}

private struct Fault: Decodable {
    let error: String?
    let code: String?
}

/// rab's HTTP API, the same one the website uses. The session is the bearer
/// token and nothing else.
final class RabAPI {
    let baseURL: URL
    var token: String?

    init(baseURL: URL, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
    }

    /// The address typed on the sign-in screen as a URL — "rab.gcc3.com" is
    /// taken as https — or nil where it is not one.
    static func url(from server: String) -> URL? {
        var text = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.host != nil
        else { return nil }
        return url
    }

    /// The page of an item on the website, the thing to pass around.
    func pageURL(ofItem id: String) -> URL {
        baseURL.appending(path: "i/\(id)")
    }

    // MARK: - plumbing

    private func send(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil, type: String? = nil) async throws -> Data {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let type { request.setValue(type, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let fault = try? JSONDecoder().decode(Fault.self, from: data)
            let message = fault?.error ?? Language.text("Request failed (\(status))")
            throw APIError(status: status, code: fault?.code, message: message)
        }
        return data
    }

    private func post<T: Decodable>(_ path: String, _ body: some Encodable) async throws -> T {
        let data = try await send("POST", path, body: try JSONEncoder().encode(body), type: "application/json")
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: - account

    /// Whether a name is an account at all — asked before the password, so the
    /// screen can offer to create one rather than open an account on a typo.
    func userExists(_ username: String) async throws -> Bool {
        do {
            _ = try await send("POST", "api/username", body: try JSONEncoder().encode(["username": username]), type: "application/json")
            return true
        } catch let error as APIError where error.code == "USER_NOT_FOUND" {
            return false
        }
    }

    func login(_ username: String, _ password: String) async throws -> AuthReply {
        try await post("api/login", ["username": username, "password": password])
    }

    /// Whether opening an account on this server asks for an email address
    /// and the code mailed to it. A server from before there was the question
    /// has no answer, which is no.
    func signupNeedsEmail() async -> Bool {
        struct Rules: Decodable { let email: Bool }
        guard let data = try? await send("GET", "api/signup") else { return false }
        return (try? JSONDecoder().decode(Rules.self, from: data))?.email ?? false
    }

    /// The first go at opening an account: a code is mailed to the address,
    /// in the language the phone is set to.
    func sendSignupCode(_ username: String, _ password: String, _ email: String, language: String) async throws {
        let body = ["username": username, "password": password, "email": email, "lang": language]
        _ = try await send("POST", "api/users/code", body: try JSONEncoder().encode(body), type: "application/json")
    }

    /// The second: the code that came back, with the rest, makes the account.
    func createUser(_ username: String, _ password: String, _ email: String, _ code: String) async throws -> AuthReply {
        try await post("api/users", ["username": username, "password": password, "email": email, "code": code])
    }

    func logout() async {
        _ = try? await send("POST", "api/logout")
    }

    // MARK: - items

    /// The bytes are JPEG already reduced on the phone, as the browser sends
    /// them: the server keeps no image library.
    func uploadImage(_ data: Data) async throws -> StoredImage {
        let reply = try await send("POST", "api/images", body: data, type: "image/jpeg")
        return try JSONDecoder().decode(StoredImage.self, from: reply)
    }

    /// The user's items on rab, newest first, and their spots, the default
    /// one first.
    func mine() async throws -> (items: [Listing], spots: [Spot]) {
        let data = try await send("GET", "api/mine")
        let reply = try JSONDecoder().decode(MineReply.self, from: data)
        return (reply.items, reply.spots ?? [])
    }

    /// The account's places, in the order they were added.
    func places() async throws -> [Place] {
        let data = try await send("GET", "api/locations")
        return try JSONDecoder().decode(PlacesReply.self, from: data).locations
    }

    /// The bytes of a photograph the server keeps.
    func imageData(_ path: String) async throws -> Data {
        guard let url = imageURL(path) else {
            throw APIError(status: 0, code: nil, message: Language.text("The photo could not be read"))
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw APIError(status: status, code: nil, message: Language.text("The photo could not be read"))
        }
        return data
    }

    /// A photograph the server keeps, from the path an item gives for it.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    // MARK: - describing

    /// Asks the server what a photograph is of, in the language given ("en",
    /// "zh", "ja"). The bytes are a JPEG reduced on the phone; nothing is kept.
    /// With `object`, the photograph is said to be of an object: the server
    /// then chooses among the object categories only, and says its short
    /// category too.
    func describe(_ data: Data, language: String, object: Bool = false) async throws -> Suggestion {
        var query = [URLQueryItem(name: "lang", value: language)]
        if object { query.append(URLQueryItem(name: "objects", value: "1")) }
        let reply = try await send("POST", "api/describe", query: query, body: data, type: "image/jpeg")
        return try JSONDecoder().decode(Suggestion.self, from: reply)
    }

    /// Says where an item on rab is, leaving the rest of it.
    func updateItem(_ id: String, at place: Place?) async throws {
        _ = try await send("PATCH", "api/items/\(id)", body: try JSONEncoder().encode(WhereBody(place: place)), type: "application/json")
    }

    /// Writes over what an item on rab says it is, leaving the rest of it.
    func updateItem(_ id: String, _ body: RecognizedBody) async throws {
        _ = try await send("PATCH", "api/items/\(id)", body: try JSONEncoder().encode(body), type: "application/json")
    }

    /// Says which photographs an item on rab carries, leaving the rest of it.
    func updateItem(_ id: String, _ body: PicturesBody) async throws {
        _ = try await send("PATCH", "api/items/\(id)", body: try JSONEncoder().encode(body), type: "application/json")
    }

    /// Takes an item off rab for good, with whatever was still open on it.
    func deleteItem(_ id: String) async throws {
        _ = try await send("DELETE", "api/items/\(id)")
    }

    func createItem(_ body: ItemBody) async throws -> RemoteItem {
        let reply: ItemReply = try await post("api/items", body)
        return reply.item
    }
}
