import SwiftUI

/// The small arrow that says a list is being asked for again. Drawn here, not
/// the system's "arrow.clockwise": that one's ring does not sit in the middle
/// of its own box, so it wobbles when it is turned. This ring is round the
/// middle of the frame, which is what it turns about.
struct RefreshIcon: View {
    static let side: CGFloat = 14

    var body: some View {
        RefreshArrow()
            .frame(width: Self.side, height: Self.side)
    }
}

/// A ring open at the upper right, with an arrowhead where it ends at the
/// top, going clockwise — the look of the system's arrow.
private struct RefreshArrow: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = side * 0.37
        let head = side * 0.2
        let to = Angle.degrees(270)

        var line = Path()
        // false is clockwise on screen, y growing downwards.
        line.addArc(center: center, radius: radius, startAngle: .degrees(0), endAngle: to, clockwise: false)

        // The arrowhead: two strokes back from a point a little past the
        // ring's end, either side of the way it goes.
        let angle = CGFloat(to.radians)
        let out = CGPoint(x: cos(angle), y: sin(angle))
        let along = CGPoint(x: -sin(angle), y: cos(angle))
        let tip = CGPoint(
            x: center.x + out.x * radius + along.x * head * 0.5,
            y: center.y + out.y * radius + along.y * head * 0.5
        )
        line.addLine(to: tip)
        for way in [CGFloat(1), -1] {
            line.move(to: tip)
            line.addLine(to: CGPoint(
                x: tip.x - along.x * head + out.x * head * way,
                y: tip.y - along.y * head + out.y * head * way
            ))
        }
        return line.strokedPath(StrokeStyle(lineWidth: side * 0.115, lineCap: .round, lineJoin: .round))
    }
}

/// The arrow, going round for as long as it is on screen. The angle comes
/// from the clock, not from an animation begun as it appears: such a one
/// takes the icon's place in the layout along with it and swings it about.
struct SpinningRefreshIcon: View {
    private static let turn: TimeInterval = 0.8

    var body: some View {
        TimelineView(.animation) { timeline in
            let part = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: Self.turn) / Self.turn
            RefreshIcon()
                .rotationEffect(.degrees(part * 360))
        }
    }
}

/// The arrow as a button: pressed, what is on screen is asked for again, and
/// the arrow goes round until the answer has come — for half a second at
/// least, an answer that comes at once otherwise showing nothing.
struct RefreshButton: View {
    /// How large the arrow is drawn, of its own 14 points.
    var scale: CGFloat = 1
    let action: () async -> Void

    @State private var refreshing = false

    var body: some View {
        Button {
            guard !refreshing else { return }
            refreshing = true
            Task {
                async let shortest: Void? = try? Task.sleep(for: .milliseconds(500))
                await action()
                _ = await shortest
                refreshing = false
            }
        } label: {
            Group {
                if refreshing { SpinningRefreshIcon() } else { RefreshIcon() }
            }
            .scaleEffect(scale)
            .frame(width: RefreshIcon.side * scale, height: RefreshIcon.side * scale)
            // Easier to press than it is to see.
            .padding(8)
            .contentShape(Rectangle())
            .padding(-8)
        }
        .accessibilityLabel("Refresh")
    }
}

/// Pulling a list down asks for it again: a small arrow comes out from under
/// the bar, turning with the pull, and goes round while the answer is waited
/// for. Let go short of far enough and nothing is asked.
@available(iOS 18.0, *)
private struct PullToRefresh: ViewModifier {
    /// Whether the room for the arrow is made by moving the whole list down
    /// rather than by a margin at its top: a grouped list jumps when its
    /// margin is changed under it, and does not when it is only moved.
    let shifting: Bool
    let action: () async -> Void

    /// How far down the pull has to go before letting go asks.
    private static let threshold: CGFloat = 56
    /// The room kept for the arrow at the top while it goes round: as far down
    /// as the pull had to go, so that the list stays where it was let go
    /// and only goes back up once the answer has come.
    private static let room: CGFloat = threshold
    /// The arrow goes round for this long at least: an answer that comes at
    /// once would otherwise show nothing at all.
    private static let shortest: Duration = .milliseconds(500)

    /// Where the list is: below zero while pulled down past its top, above
    /// while scrolled into.
    @State private var offset: CGFloat = 0
    @State private var refreshing = false

    private var pull: CGFloat { max(0, -offset) }
    private var armed: Bool { pull >= Self.threshold }

    func body(content: Content) -> some View {
        let room = refreshing ? Self.room : 0
        return held(
            content
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    (geometry.contentOffset.y + geometry.contentInsets.top).rounded()
                } action: { _, new in
                    offset = new
                }
                .onScrollPhaseChange { old, new in
                    // Let go, pulled far enough.
                    if old == .interacting, new != .interacting, armed { refresh() }
                },
            room: room
        )
        .overlay(alignment: .top) { indicator }
        .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, armed in armed }
    }

    /// The list with the room kept at its top: moved down by it, or given
    /// it as a margin.
    @ViewBuilder
    private func held(_ list: some View, room: CGFloat) -> some View {
        if shifting {
            list.offset(y: room)
        } else {
            list.contentMargins(.top, room, for: .scrollContent)
        }
    }

    /// The arrow, in the middle of the gap the pull opens — or of the room
    /// kept for it, going with the list when that is scrolled meanwhile.
    @ViewBuilder
    private var indicator: some View {
        let room = refreshing ? Self.room : 0
        let progress = min(1, pull / Self.threshold)
        Group {
            if refreshing {
                SpinningRefreshIcon()
            } else {
                // Still, until it is asked: it comes out and turns with the
                // pull, and only goes round by itself once let go.
                RefreshIcon()
                    .rotationEffect(.degrees(progress * 270))
                    .opacity(progress)
                    .scaleEffect(0.6 + 0.4 * progress)
            }
        }
        .offset(y: offset < 0 ? (room + pull - RefreshIcon.side) / 2 : (room - RefreshIcon.side) / 2 - offset)
        // Scrolled into: it has gone up with the top of the list.
        .opacity(offset > 4 ? 0 : 1)
        .allowsHitTesting(false)
        .accessibilityHidden(!refreshing)
    }

    private func refresh() {
        guard !refreshing else { return }
        withAnimation(.snappy(duration: 0.2)) { refreshing = true }
        Task {
            let started = ContinuousClock.now
            await action()
            let left = Self.shortest - (ContinuousClock.now - started)
            if left > .zero { try? await Task.sleep(for: left) }
            withAnimation(.snappy(duration: 0.25)) { refreshing = false }
        }
    }
}

extension View {
    /// Pulling this list down runs `action`, under a small arrow that goes
    /// round until it is done. Before iOS 18 a list cannot be asked where it
    /// is, and the system's own spinner stands in.
    ///
    /// `shifting` is for a grouped list, which is moved down whole while the
    /// arrow goes round: its top margin changed under it makes it jump.
    @ViewBuilder
    func pullToRefresh(shifting: Bool = false, _ action: @escaping () async -> Void) -> some View {
        if #available(iOS 18.0, *) {
            modifier(PullToRefresh(shifting: shifting, action: action))
        } else {
            refreshable { await action() }
        }
    }
}
