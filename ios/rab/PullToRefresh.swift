import SwiftUI

/// The small arrow that says a list is being asked for again.
struct RefreshIcon: View {
    static let side: CGFloat = 14

    var body: some View {
        Image(systemName: "arrow.clockwise")
            .font(.system(size: Self.side, weight: .semibold))
            .frame(width: Self.side, height: Self.side)
    }
}

/// The arrow, going round for as long as it is on screen.
struct SpinningRefreshIcon: View {
    @State private var turned = false

    var body: some View {
        RefreshIcon()
            .rotationEffect(.degrees(turned ? 360 : 0))
            .animation(.linear(duration: 0.8).repeatForever(autoreverses: false), value: turned)
            .onAppear { turned = true }
    }
}

/// Pulling a list down asks for it again: a small arrow comes out from under
/// the bar, turning with the pull, and goes round while the answer is waited
/// for. Let go short of far enough and nothing is asked.
@available(iOS 18.0, *)
private struct PullToRefresh: ViewModifier {
    let action: () async -> Void

    /// How far down the pull has to go before letting go asks.
    private static let threshold: CGFloat = 56
    /// The room kept for the arrow at the top while it goes round.
    private static let room: CGFloat = 28
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
        content
            .contentMargins(.top, refreshing ? Self.room : 0, for: .scrollContent)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                (geometry.contentOffset.y + geometry.contentInsets.top).rounded()
            } action: { _, new in
                offset = new
            }
            .onScrollPhaseChange { old, new in
                // Let go, pulled far enough.
                if old == .interacting, new != .interacting, armed { refresh() }
            }
            .overlay(alignment: .top) { indicator }
            .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, armed in armed }
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
    @ViewBuilder
    func pullToRefresh(_ action: @escaping () async -> Void) -> some View {
        if #available(iOS 18.0, *) {
            modifier(PullToRefresh(action: action))
        } else {
            refreshable { await action() }
        }
    }
}
