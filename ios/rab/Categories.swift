import SwiftUI

/// The sorts of thing rab knows — things, places and somebody's time, all in
/// one list: the same slugs the website has (src/utils/categories.js), since
/// the server keeps the slug and the website shows its name.
enum Categories {
    static let all: [String] = [
        "car", "bike", "camera", "video-camera", "drone", "binoculars", "projector", "audio", "musical-instrument", "computer", "game-console", "electronics",
        "kitchen-appliance", "cleaning-appliance", "beauty-appliance", "tools", "camping", "sports", "clothing",
        "home", "meeting-room", "studio", "music-studio", "storage", "event-space", "workspace", "parking",
        "photography", "teaching", "repair", "moving", "cleaning", "design", "3d-printing", "guide", "translation", "music", "fitness", "beauty",
        "massage", "pet-care", "childcare", "care", "cooking", "driver", "delivery", "gardening", "it-support", "programming",
        "videography", "writing", "consulting", "event-help", "handyman",
        "other",
    ]

    /// The categories that are objects — what the scanner's photographs are
    /// recognized as, since a camera pointed at a thing is looking at no room
    /// and nobody's work (OBJECT_CATEGORIES on the website).
    static let objects: [String] = [
        "car", "bike", "camera", "video-camera", "drone", "binoculars", "projector", "audio", "musical-instrument", "computer", "game-console", "electronics",
        "kitchen-appliance", "cleaning-appliance", "beauty-appliance", "tools", "camping", "sports", "clothing",
        "other",
    ]

    /// A category's name, as the website says it.
    static func name(_ slug: String) -> LocalizedStringKey {
        LocalizedStringKey(names[slug] ?? slug)
    }

    /// The same as plain words, in the language the app is in: for what is
    /// drawn from a string, as the app's own boxes of choices are.
    static func text(_ slug: String) -> String {
        Language.text(String.LocalizationValue(names[slug] ?? slug))
    }

    /// What a row says an item is: its category, or just an item where it
    /// has none.
    static func label(_ slug: String?) -> LocalizedStringKey {
        guard let slug, !slug.isEmpty else { return "Item" }
        return name(slug)
    }

    private static let names: [String: String] = [
        "car": "Car", "bike": "Bike", "camera": "Camera", "video-camera": "Video camera", "projector": "Projector",
        "musical-instrument": "Musical instrument", "audio": "Audio gear", "electronics": "Electronics", "tools": "Tools",
        "drone": "Drone", "binoculars": "Binoculars", "computer": "Computer", "game-console": "Game console",
        "kitchen-appliance": "Kitchen appliances", "cleaning-appliance": "Cleaning appliances", "beauty-appliance": "Beauty appliances",
        "camping": "Camping gear", "sports": "Sports gear", "clothing": "Clothing", "other": "Other",
        "home": "Home", "meeting-room": "Meeting room", "studio": "Studio", "music-studio": "Music studio", "storage": "Storage",
        "event-space": "Event space", "workspace": "Workspace", "parking": "Parking",
        "photography": "Photography", "teaching": "Teaching", "repair": "Repair", "moving": "Moving help",
        "cleaning": "Cleaning", "design": "Design", "3d-printing": "3D printing", "guide": "Guide", "translation": "Translation", "music": "Music",
        "fitness": "Fitness", "beauty": "Beauty", "massage": "Massage", "pet-care": "Pet care", "childcare": "Childcare",
        "care": "Care", "cooking": "Cooking", "driver": "Driver", "delivery": "Delivery", "gardening": "Gardening",
        "it-support": "IT support", "programming": "Programming", "videography": "Videography", "writing": "Writing",
        "consulting": "Consulting", "event-help": "Event help", "handyman": "Handyman",
    ]
}
