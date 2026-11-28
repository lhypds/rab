import SwiftUI

/// The grid items are shown in: four across on a phone held upright,
/// close together: there are a great many of them.
enum ItemGrid {
    /// How round a photograph's corners are.
    static let corner: CGFloat = 16
    /// Between two photographs, across and down alike.
    static let gap: CGFloat = 8
    /// Four across, always: however wide the phone, not as many as will fit.
    static let columns = Array(repeating: GridItem(.flexible(), spacing: gap, alignment: .top), count: 4)
}

/// A photograph in a grid of items — the user's items, a spot's — with its
/// name on it, as a label, where it has one. Small, name and all: the grid
/// is for finding a thing among many, and its page says the rest.
struct ItemTile<Photo: View>: View {
    let name: String
    /// It is being recognized just now.
    let busy: Bool
    /// It is on this phone only: rab does not have it yet.
    let waiting: Bool
    /// Whether it is one of the ones picked, while several are being picked
    /// at once; nil while none are.
    var picked: Bool? = nil
    @ViewBuilder var photo: Photo

    var body: some View {
        Color.white
            .aspectRatio(1, contentMode: .fit)
            .overlay { photo }
            // The name is a label on the photograph, at its foot: white on a
            // dark band, as many lines as it needs up to three. One with no
            // name yet has no label.
            .overlay(alignment: .bottom) {
                if !name.isEmpty {
                    Text(verbatim: name)
                        // Small: it is a label on a small picture.
                        .font(.system(size: 11))
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(0.55))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: ItemGrid.corner))
            // A faint shadow under the card, to lift it off the page a little.
            .background {
                RoundedRectangle(cornerRadius: ItemGrid.corner)
                    .fill(Color.white)
                    .shadow(color: .black.opacity(0.16), radius: 4, y: 2)
            }
            .overlay {
                if busy {
                    ZStack {
                        Color.white.opacity(0.6)
                        ProgressView().controlSize(.small)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: ItemGrid.corner))
                }
            }
            .overlay(alignment: .topTrailing) {
                // What rab does not have yet says so with a dot.
                if waiting && !busy {
                    Circle()
                        .fill(Color.black)
                        .frame(width: 6, height: 6)
                        .padding(5)
                }
            }
            // While several are being picked: a ring at the top left of each,
            // filled with a tick in the ones picked, which are greyed a little.
            .overlay {
                if picked == true {
                    Color.black.opacity(0.25)
                        .clipShape(RoundedRectangle(cornerRadius: ItemGrid.corner))
                }
            }
            .overlay(alignment: .topLeading) {
                if let picked {
                    Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 17))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(picked ? Color.white : Color.white, picked ? Color.black : Color.clear)
                        .shadow(color: .black.opacity(0.35), radius: 1.5)
                        .padding(4)
                }
            }
            .accessibilityAddTraits(picked == true ? .isSelected : [])
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: name))
        .contentShape(Rectangle())
    }
}

/// The mark for a spot, as the website draws it (the pin beside "Spot" on its
/// publish form): a pin in outline — a drop with a ring in its head — in the
/// same line as the bar's other icons. Drawn here since the system has none
/// like it. As tall as the text it stands in.
struct SpotIcon: View {
    /// The square every icon of the bar is drawn in.
    private let size = BarIcon.side + 2

    var body: some View {
        SpotPin()
            .stroke(style: StrokeStyle(lineWidth: size * 1.7 / 24, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

/// The website's pin, from its 24-point drawing:
/// `M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z` and a ring of 2.5
/// round (12, 9).
private struct SpotPin: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * unit, y: rect.midY - 12 * unit)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: origin.x + x * unit, y: origin.y + y * unit)
        }
        var path = Path()
        path.move(to: point(12, 21))
        path.addCurve(to: point(5, 9), control1: point(12, 21), control2: point(5, 14.8))
        // Over the top, from the left to the right.
        path.addArc(center: point(12, 9), radius: 7 * unit, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
        path.addCurve(to: point(12, 21), control1: point(19, 14.8), control2: point(12, 21))
        path.closeSubpath()
        path.addEllipse(in: CGRect(x: origin.x + 9.5 * unit, y: origin.y + 6.5 * unit, width: 5 * unit, height: 5 * unit))
        return path
    }
}
