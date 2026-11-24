import CoreLocation
import Foundation

/// The area an item is offered in, found the way the website finds it: from
/// where the phone is, or from a name typed in. Apple's geocoder stands in for
/// the website's, and gives a circle where that gives a box.
enum Area {
    /// A placemark as a region: the town for a name, the prefecture and
    /// country as the line under it, and its circle squared into a box.
    static func region(from placemark: CLPlacemark) -> Region? {
        let candidates = [placemark.locality, placemark.subAdministrativeArea, placemark.administrativeArea, placemark.name]
        guard let name = candidates.compactMap({ $0 }).first(where: { !$0.isEmpty }) else { return nil }
        let detail = [placemark.administrativeArea, placemark.country]
            .compactMap { $0 }
            .filter { $0 != name }
            .joined(separator: ", ")

        var bbox: [Double]
        if let circle = placemark.region as? CLCircularRegion {
            let latitude = circle.center.latitude
            let longitude = circle.center.longitude
            let spreadLatitude = circle.radius / 111_320
            let spreadLongitude = circle.radius / max(1, 111_320 * cos(latitude * .pi / 180))
            bbox = [longitude - spreadLongitude, latitude - spreadLatitude, longitude + spreadLongitude, latitude + spreadLatitude]
        } else if let location = placemark.location {
            // The website's own fallback for a place without a box.
            let spread = 0.05
            let coordinate = location.coordinate
            bbox = [coordinate.longitude - spread, coordinate.latitude - spread, coordinate.longitude + spread, coordinate.latitude + spread]
        } else {
            return nil
        }
        bbox = [max(-180, bbox[0]), max(-90, bbox[1]), min(180, bbox[2]), min(90, bbox[3])]
        return Region(name: name, detail: detail, bbox: bbox)
    }

    /// The language a place is named in: the one the country it is in writes
    /// it in — Japanese in Japan, Chinese in China — and English everywhere
    /// else, whatever language the phone is in. The website names places the
    /// same way (see addressLanguage there).
    static func locale(for country: String?) -> Locale {
        Locale(identifier: ["JP": "ja", "CN": "zh-Hans"][country?.uppercased() ?? ""] ?? "en")
    }

    /// The placemark for a spot, named in its country's language. The country
    /// is only known once the geocoder has answered, so it is asked in English
    /// and asked again where the country writes its names otherwise.
    static func placemark(at location: CLLocation) async -> CLPlacemark? {
        let english = Locale(identifier: "en")
        guard let first = try? await CLGeocoder().reverseGeocodeLocation(location, preferredLocale: english).first else { return nil }
        let own = locale(for: first.isoCountryCode)
        guard own != english else { return first }
        return (try? await CLGeocoder().reverseGeocodeLocation(location, preferredLocale: own).first) ?? first
    }

    /// The area a typed name means, or nil where the geocoder knows none —
    /// named, like a spot, in the language of the country it is in.
    static func lookUp(_ text: String) async -> Region? {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let english = Locale(identifier: "en")
        guard !query.isEmpty,
              let found = try? await CLGeocoder().geocodeAddressString(query, in: nil, preferredLocale: english).first
        else { return nil }
        let own = locale(for: found.isoCountryCode)
        guard own != english,
              let named = try? await CLGeocoder().geocodeAddressString(query, in: nil, preferredLocale: own).first
        else { return region(from: found) }
        return region(from: named)
    }

    /// What a spot on the map comes to: the area around it, and its address as
    /// a line — street, town, prefecture — as far as the geocoder knows them.
    static func describe(latitude: Double, longitude: Double) async -> (region: Region?, address: String?) {
        let spot = CLLocation(latitude: latitude, longitude: longitude)
        guard let placemark = await placemark(at: spot) else { return (nil, nil) }
        let street = [placemark.subThoroughfare, placemark.thoroughfare].compactMap { $0 }.joined(separator: " ")
        var parts: [String] = []
        for part in [street.isEmpty ? placemark.name : street, placemark.locality, placemark.administrativeArea] {
            if let part, !part.isEmpty, !parts.contains(part) { parts.append(part) }
        }
        return (region(from: placemark), parts.isEmpty ? nil : parts.joined(separator: ", "))
    }

    /// How close to one of the user's places the phone has to be for the place
    /// to be taken as where a new item is: a hundred metres, the width of a
    /// block, which is as near as a phone's fix is sure of.
    static let nearby: CLLocationDistance = 100

    /// Where the phone is, where it is allowed to say.
    @MainActor
    static func position() async -> CLLocationCoordinate2D? {
        await LocationOnce().location()?.coordinate
    }

    /// The area the phone is in, where it is allowed to say.
    @MainActor
    static func here() async -> Region? {
        await whereabouts().region
    }

    /// Where the phone is and the area that is in, where it is allowed to say:
    /// the spot alone where the geocoder knows no area, and neither where the
    /// phone will not say.
    @MainActor
    static func whereabouts() async -> (position: CLLocationCoordinate2D?, region: Region?) {
        guard let location = await LocationOnce().location() else { return (nil, nil) }
        guard let placemark = await placemark(at: location) else { return (location.coordinate, nil) }
        return (location.coordinate, region(from: placemark))
    }

    /// Whether the phone has been told it may not say where it is: by the
    /// user, or by a restriction on the phone. Then only Settings can change
    /// the answer, and asking again does nothing.
    static var denied: Bool {
        switch CLLocationManager().authorizationStatus {
        case .denied, .restricted: true
        default: false
        }
    }

    /// Puts the system's question — may rab know where the phone is — where
    /// it has not been answered yet, and waits for the answer. Asked when the
    /// app opens, so that the question is not first met in the middle of a
    /// form: the area an item is offered in comes from where the phone is.
    @MainActor
    static func ask() async {
        guard CLLocationManager().authorizationStatus == .notDetermined else { return }
        _ = await LocationOnce().location()
    }

    /// The nearest of the user's places to a spot, where one is within
    /// `nearby` of it: the place a thing photographed here is most likely at.
    static func place(near position: CLLocationCoordinate2D, among locations: [SavedLocation]) -> SavedLocation? {
        let here = CLLocation(latitude: position.latitude, longitude: position.longitude)
        let distances = locations.compactMap { location -> (SavedLocation, CLLocationDistance)? in
            guard let latitude = location.latitude, let longitude = location.longitude else { return nil }
            return (location, here.distance(from: CLLocation(latitude: latitude, longitude: longitude)))
        }
        guard let nearest = distances.min(by: { $0.1 < $1.1 }), nearest.1 <= nearby else { return nil }
        return nearest.0
    }
}

/// One fix, asked for once: permission where it has not been given, then the
/// position, then done.
@MainActor
final class LocationOnce: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private var requested = false

    func location() async -> CLLocation? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.delegate = self
            proceed()
        }
    }

    private func proceed() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            guard !requested else { return }
            requested = true
            manager.requestLocation()
        default:
            finish(nil)
        }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }

    // The manager was made on the main thread, so this is where it calls back.

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { proceed() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated { finish(locations.last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated { finish(nil) }
    }
}
