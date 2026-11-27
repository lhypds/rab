import Foundation
import SwiftUI

/// The language the app is in: the phone's own to start with, and whichever
/// is chosen from the top bar after that — at once, without the app being
/// opened again. The three the website has.
enum Language: String, CaseIterable, Identifiable {
    case en, zh, ja

    var id: String { rawValue }

    /// Its own name, in itself: what the list of them shows.
    var name: String {
        switch self {
        case .en: "English"
        case .zh: "中文"
        case .ja: "日本語"
        }
    }

    /// What the system calls it: the folder its words are in, and the locale
    /// the screens are drawn in.
    var identifier: String {
        switch self {
        case .en: "en"
        case .zh: "zh-Hans"
        case .ja: "ja"
        }
    }

    var locale: Locale { Locale(identifier: identifier) }

    private static let key = "rab:language"

    /// The one chosen, or the phone's own where none has been — English where
    /// the phone is in none of the three.
    static var chosen: Language {
        if let kept = UserDefaults.standard.string(forKey: key), let language = Language(rawValue: kept) { return language }
        let code = Locale.current.language.languageCode?.identifier ?? "en"
        return Language(rawValue: code) ?? .en
    }

    /// Chooses it: for what is on screen now (see `current`), and for the
    /// next time the app is opened, when the system's own words — its
    /// keyboard's, its permission questions' — follow too.
    static func choose(_ language: Language) {
        UserDefaults.standard.set(language.rawValue, forKey: key)
        UserDefaults.standard.set([language.identifier], forKey: "AppleLanguages")
        current = language
    }

    /// The language words made outside a view are in: an error's sentence, a
    /// line built in code.
    private(set) static var current = chosen

    /// The folder of the app that has a language's words; none for English,
    /// which the words are written in and has no folder of its own.
    private var bundle: Bundle? {
        Bundle.main.path(forResource: identifier, ofType: "lproj").flatMap(Bundle.init(path:))
    }

    /// A sentence in the language chosen: what `String(localized:)` would
    /// give, were the whole phone in it.
    static func text(_ value: String.LocalizationValue) -> String {
        if let bundle = current.bundle { return String(localized: value, bundle: bundle) }
        // English: the sentence as it is written. Asked of a table that does
        // not exist, so that a phone in another language does not answer in
        // its own.
        return String(localized: value, table: "None", bundle: .main)
    }
}
