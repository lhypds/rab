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

    /// The area a typed name means, or nil where the geocoder knows none.
    static func lookUp(_ text: String) async -> Region? {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, let placemark = try? await CLGeocoder().geocodeAddressString(query).first else { return nil }
        return region(from: placemark)
    }

    /// What a spot on the map comes to: the area around it, and its address as
    /// a line — street, town, prefecture — as far as the geocoder knows them.
    static func describe(latitude: Double, longitude: Double) async -> (region: Region?, address: String?) {
        let spot = CLLocation(latitude: latitude, longitude: longitude)
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(spot).first else { return (nil, nil) }
        let street = [placemark.subThoroughfare, placemark.thoroughfare].compactMap { $0 }.joined(separator: " ")
        var parts: [String] = []
        for part in [street.isEmpty ? placemark.name : street, placemark.locality, placemark.administrativeArea] {
            if let part, !part.isEmpty, !parts.contains(part) { parts.append(part) }
        }
        return (region(from: placemark), parts.isEmpty ? nil : parts.joined(separator: ", "))
    }

    /// Where the phone is, where it is allowed to say.
    @MainActor
    static func position() async -> CLLocationCoordinate2D? {
        await LocationOnce().location()?.coordinate
    }

    /// The area the phone is in, where it is allowed to say.
    @MainActor
    static func here() async -> Region? {
        guard let location = await LocationOnce().location() else { return nil }
        guard let placemark = try? await CLGeocoder().reverseGeocodeLocation(location).first else { return nil }
        return region(from: placemark)
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
