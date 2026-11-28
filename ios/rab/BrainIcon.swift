import SwiftUI

/// The brain, as the website draws it beside what it has the model make out:
/// seen from above, its two halves side by side — not the system's, which is
/// seen from the side. In outline, in the same square as the bar's other icons.
struct BrainIcon: View {
    /// How much of the bar's square it fills.
    var scale: CGFloat = 1

    var body: some View {
        let side = BarIcon.side * scale
        BrainOutline()
            // Many short strokes in a small box: thinner than the pin's, so
            // that they do not run together.
            .stroke(style: StrokeStyle(lineWidth: side * 1.5 / 24, lineCap: .round, lineJoin: .round))
            .frame(width: side, height: side)
            .frame(width: BarIcon.side, height: BarIcon.side)
    }
}

/// The website's drawing, from its 24-point paths (see ItemModal.jsx): moves,
/// arcs of circles and closings, and nothing else.
private struct BrainOutline: Shape {
    private static let drawing = [
        "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",
        "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",
        "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",
        "M17.599 6.5a3 3 0 0 0 .399-1.375",
        "M6.003 5.125A3 3 0 0 0 6.401 6.5",
        "M3.477 10.896a4 4 0 0 1 .585-.396",
        "M19.938 10.5a4 4 0 0 1 .585.396",
        "M6 18a4 4 0 0 1-1.967-.516",
        "M19.967 17.484A4 4 0 0 1 18 18",
    ]

    private enum Step {
        case move(CGPoint)
        /// An arc of a circle to a point: its radius, whether it is the long
        /// way round, and whether it goes clockwise as seen on the screen.
        case arc(radius: CGFloat, long: Bool, clockwise: Bool, to: CGPoint)
        case close
    }

    /// The drawing read once: every point as it stands in the 24-point box.
    private static let steps: [Step] = drawing.flatMap(read)

    private static func read(_ path: String) -> [Step] {
        var steps: [Step] = []
        var at = CGPoint.zero
        // A letter, then the numbers that go with it: a number ends where the
        // next begins, at a sign or a second point.
        let parts = path.matches(of: #/([MAaZ])([^MAaZ]*)/#)
        for part in parts {
            let numbers = part.2.matches(of: #/-?\d*\.?\d+/#).compactMap { Double($0.0) }.map { CGFloat($0) }
            switch part.1 {
            case "M":
                guard numbers.count >= 2 else { continue }
                at = CGPoint(x: numbers[0], y: numbers[1])
                steps.append(.move(at))
            case "A", "a":
                // Seven numbers an arc; one letter may be followed by several.
                let relative = part.1 == "a"
                for start in stride(from: 0, to: numbers.count - 6, by: 7) {
                    let arc = numbers[start..<start + 7]
                    let first = arc.startIndex
                    let end = CGPoint(
                        x: arc[first + 5] + (relative ? at.x : 0),
                        y: arc[first + 6] + (relative ? at.y : 0)
                    )
                    steps.append(.arc(radius: arc[first], long: arc[first + 3] != 0, clockwise: arc[first + 4] != 0, to: end))
                    at = end
                }
            default:
                steps.append(.close)
            }
        }
        return steps
    }

    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 24
        let origin = CGPoint(x: rect.midX - 12 * unit, y: rect.midY - 12 * unit)
        func point(_ p: CGPoint) -> CGPoint {
            CGPoint(x: origin.x + p.x * unit, y: origin.y + p.y * unit)
        }

        var path = Path()
        var at = CGPoint.zero
        for step in Self.steps {
            switch step {
            case .move(let to):
                path.move(to: point(to))
                at = to
            case .close:
                path.closeSubpath()
            case .arc(var radius, let long, let clockwise, let to):
                // The circle's middle, from the two ends of the arc: off the
                // middle of the line between them, to one side or the other.
                let dx = to.x - at.x
                let dy = to.y - at.y
                let distance = (dx * dx + dy * dy).squareRoot()
                guard distance > 0 else { continue }
                radius = max(radius, distance / 2)
                let off = (radius * radius - distance * distance / 4).squareRoot()
                let side: CGFloat = long == clockwise ? 1 : -1
                let center = CGPoint(
                    x: (at.x + to.x) / 2 + side * off * dy / distance,
                    y: (at.y + to.y) / 2 - side * off * dx / distance
                )
                path.addArc(
                    center: point(center),
                    radius: radius * unit,
                    startAngle: .radians(atan2(at.y - center.y, at.x - center.x)),
                    endAngle: .radians(atan2(to.y - center.y, to.x - center.x)),
                    // The screen's y grows downwards, and there this is the
                    // other way about.
                    clockwise: !clockwise
                )
                at = to
            }
        }
        return path
    }
}
