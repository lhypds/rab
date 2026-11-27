import CoreLocation
import Foundation

/// Where the phone is while things are being collected: asked for when the
/// camera opens — permission first, where it has not been given — and kept up
/// to date until it closes. What is collected is said to be at the nearest of
/// the account's places, where one is within reach (see AppModel.place(near:)).
/// Where the phone will not say, nothing is said of where the thing is.
final class Locator: NSObject, ObservableObject, CLLocationManagerDelegate {
    /// The last place the phone said it was; nil until it has, and where it
    /// will not.
    @Published private(set) var position: CLLocationCoordinate2D?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        // A hundred metres is what is being told apart: ten is near enough.
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 5
    }

    func start() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: manager.startUpdatingLocation()
        default: break
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.startUpdatingLocation()
        case .denied, .restricted: position = nil
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // A fix that is not sure of itself to within the reach says nothing
        // about which place this is.
        guard let last = locations.last, last.horizontalAccuracy >= 0, last.horizontalAccuracy <= AppModel.reach else { return }
        position = last.coordinate
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
