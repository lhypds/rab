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

/// An item as the server's parseItem reads it. The bare `price` is the one
/// rule it needs: that price, every day.
struct ItemBody: Encodable {
    var title: String
    var description = ""
    var category = ""
    var currency: String
    var mode = "day"
    var price: Double
    var region: Region
    /// The pin, and what the place is called: only for an item attached to a
    /// location that knows where it is. Left out of the request otherwise.
    var latitude: Double?
    var longitude: Double?
    var place: String?
    var images: [ImageRef]
    /// Not on the map yet: what the phone sends is a start, and its owner
    /// finishes it — a price, the rest — in their items on the website and
    /// publishes it from there.
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
    var description: String?
    var category: String?
    var price: Double?
    var currency: String?
    var place: String?
    var region: Region?
    var images: [Picture]?
    var thumb: String?
    var active: Bool?
}

/// What the server made of a photograph (POST /api/describe): the listing's
/// category, and a name and a description for it.
struct Suggestion: Decodable {
    var category: String
    var title: String
    var description: String
}

/// One of the account's places as the server keeps it (GET /api/locations):
/// the same list the website's form chooses from.
struct RemoteLocation: Codable {
    var id: String?
    var name: String
    var address: String?
    var latitude: Double
    var longitude: Double
    var region: Region?
}

private struct LocationsReply: Decodable {
    let locations: [RemoteLocation]
}

private struct LocationReply: Decodable {
    let location: RemoteLocation
}

private struct MineReply: Decodable {
    let items: [Listing]
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
            let message = fault?.error ?? String(localized: "Request failed (\(status))")
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

    /// The user's items on rab, newest first.
    func mine() async throws -> [Listing] {
        let data = try await send("GET", "api/mine")
        return try JSONDecoder().decode(MineReply.self, from: data).items
    }

    /// A photograph the server keeps, from the path an item gives for it.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    // MARK: - locations

    /// The account's places, in the order they were added.
    func locations() async throws -> [RemoteLocation] {
        let data = try await send("GET", "api/locations")
        return try JSONDecoder().decode(LocationsReply.self, from: data).locations
    }

    /// Keeps a place in the account's list, under the id it is sent with.
    func saveLocation(_ location: RemoteLocation) async throws -> RemoteLocation {
        let reply: LocationReply = try await post("api/locations", location)
        return reply.location
    }

    func deleteLocation(_ id: String) async throws {
        _ = try await send("DELETE", "api/locations/\(id)")
    }

    // MARK: - describing

    /// Asks the server what a photograph is of, in the language given ("en",
    /// "zh", "ja"). The bytes are a JPEG reduced on the phone; nothing is kept.
    func describe(_ data: Data, language: String) async throws -> Suggestion {
        let reply = try await send("POST", "api/describe", query: [URLQueryItem(name: "lang", value: language)], body: data, type: "image/jpeg")
        return try JSONDecoder().decode(Suggestion.self, from: reply)
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
