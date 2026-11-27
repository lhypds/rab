import SwiftUI
import UIKit

/// Puts the keyboard away when anywhere that is not a text field is pressed:
/// a page's photograph, its other rows, the ground between them. The press
/// still does whatever it would have done — a button under it is pressed —
/// and a press in a field, the one being written in or another, is left to
/// the field.
private struct KeyboardDismisser: UIViewRepresentable {
    func makeUIView(context: Context) -> Watcher { Watcher() }
    func updateUIView(_ view: Watcher, context: Context) {}

    /// Nothing to look at: it is on the page only to find the page's window,
    /// which is where the press is listened for — over everything in it.
    final class Watcher: UIView, UIGestureRecognizerDelegate {
        private var tap: UITapGestureRecognizer?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let tap { tap.view?.removeGestureRecognizer(tap) }
            tap = nil
            guard let window else { return }
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(pressed))
            // The press goes on to whatever is under it as well.
            recognizer.cancelsTouchesInView = false
            recognizer.delegate = self
            window.addGestureRecognizer(recognizer)
            tap = recognizer
        }

        @objc private func pressed() {
            window?.endEditing(true)
        }

        /// Not for a press in a field: that is the field's.
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            var view = touch.view
            while let each = view {
                if each is UITextField || each is UITextView { return false }
                view = each.superview
            }
            return true
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}

extension View {
    /// The keyboard goes away when the page is pressed anywhere but in a field.
    func dismissesKeyboardOnTap() -> some View {
        background(KeyboardDismisser().frame(width: 0, height: 0))
    }
}
