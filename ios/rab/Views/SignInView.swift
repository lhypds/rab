import SwiftUI

/// Signing in, in a box over the items' screen, in two goes like the website: the name first, which says
/// whether it is an account at all, then the password — to open it or, for a
/// name nobody has, to create it. Creating one takes an email address as
/// well, and then the code that is mailed to it.
struct SignInView: View {
    @Environment(AppModel.self) private var model

    @State private var username = ""
    @State private var password = ""
    /// The name has been asked about.
    @State private var checked = false
    /// Nobody has the name; the password will create the account.
    @State private var creating = false
    /// The address a new account is opened with, and the code mailed to it.
    @State private var email = ""
    @State private var code = ""
    /// Whether the server asks a new account for an address and its code: a
    /// setting of the server's, asked about with the name.
    @State private var needsEmail = false
    /// The code has been asked for; the field for it is showing.
    @State private var codeSent = false
    @State private var busy = false
    @State private var error: String?
    /// The server's address is asked for only by somebody who wants to change it.
    @State private var showingServer = false
    @FocusState private var focus: Field?

    private enum Field { case username, password, email, code }

    /// How tall the box is as it first stands: the name, the button and
    /// "Advanced", with the gaps between and the margin round them. What it
    /// is put in the middle of the window by (see RootView).
    static let closedHeight: CGFloat = Compact.row * 2 + 16 + 8 * 2 + Compact.margin * 2

    /// The space between the wordmark, the fields, the button and what is
    /// under it.
    private static let gap: CGFloat = 8

    private var buttonTitle: LocalizedStringKey {
        if !checked { return "Continue" }
        if !creating { return "Sign in" }
        return !needsEmail || codeSent ? "Create account" : "Send code"
    }

    private var ready: Bool {
        guard !busy, !username.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        guard checked else { return true }
        guard password.count >= 6 else { return false }
        guard creating, needsEmail else { return true }
        // A new account: an address to send the code to, then the six digits.
        guard email.contains("@") else { return false }
        return !codeSent || code.count == 6
    }

    var body: some View {
        @Bindable var model = model
        // A small box in the middle of the window, over the items' screen:
        // the fields, the button, and what is under it. Nothing in it moves
        // into place — what appears is there at once.
        VStack(alignment: .leading, spacing: Self.gap) {
            // The fields, in one white box, a line between each two.
            VStack(spacing: 0) {
                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .focused($focus, equals: .username)
                    .submitLabel(.next)
                    .onSubmit(go)
                    .onChange(of: username) {
                        checked = false
                        creating = false
                        codeSent = false
                        code = ""
                        error = nil
                    }
                    .compactRow()
                if checked {
                    Divider().padding(.leading, Compact.inset)
                    SecureField(creating ? "Choose a password" : "Password", text: $password)
                        .textContentType(creating ? .newPassword : .password)
                        .focused($focus, equals: .password)
                        .submitLabel(creating && needsEmail ? .next : .go)
                        .onSubmit { if creating && needsEmail { focus = .email } else { go() } }
                        .compactRow()
                }
                if checked && creating && needsEmail {
                    Divider().padding(.leading, Compact.inset)
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.emailAddress)
                        .focused($focus, equals: .email)
                        .submitLabel(.go)
                        .onSubmit(go)
                        // Another address is another code.
                        .onChange(of: email) {
                            codeSent = false
                            code = ""
                        }
                        .compactRow()
                    if codeSent {
                        Divider().padding(.leading, Compact.inset)
                        TextField("Verification code", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .focused($focus, equals: .code)
                            .onChange(of: code) {
                                code = String(code.filter(\.isNumber).prefix(6))
                            }
                            .compactRow()
                    }
                }
            }
            .background(Color.white, in: RoundedRectangle(cornerRadius: Compact.corner))

            // What the fields are being asked for, said under them.
            Group {
                if creating && codeSent {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Enter the 6-digit code sent to \(email).")
                        Button("Send again") { sendCode() }
                            .disabled(busy)
                    }
                } else if creating && needsEmail {
                    Text("No account is called \(username). Choose a password of 6 characters or more, and give an email address: a verification code is sent to it.")
                } else if creating {
                    Text("No account is called \(username). Choose a password of 6 characters or more to create it.")
                } else if checked {
                    Text("Welcome back, \(username).")
                }
            }
            .font(Compact.small)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Compact.inset)

            // White on black once it can be pressed; grey until then.
            Button(action: go) {
                HStack {
                    Text(buttonTitle)
                    Spacer()
                    if busy { RowSpinner().tint(.white) }
                }
                .foregroundStyle(.white)
                .compactRow()
                .background(ready ? Color.black : Color(white: 0.78), in: RoundedRectangle(cornerRadius: Compact.corner))
            }
            .buttonStyle(.plain)
            // Not `disabled`, which would fade the grey and its word
            // further: it only takes no presses (and `go` checks).
            .allowsHitTesting(ready)

            if let error {
                Text(error)
                    .foregroundStyle(.red)
                    .padding(.horizontal, Compact.inset)
            }

            // "Advanced" is always there; pressing it opens what is under
            // it — the server's address — and pressing it again closes it.
            VStack(alignment: .leading, spacing: 6) {
                Button("Advanced") { showingServer.toggle() }
                    // No fading under the finger either.
                    .buttonStyle(StillButtonStyle())
                // The field's label: close to its field.
                if showingServer { Text("Server") }
            }
            .font(Compact.small)
            .foregroundStyle(.secondary)
            .padding(.horizontal, Compact.inset)
            if showingServer {
                TextField(AppModel.defaultServer, text: $model.server)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: model.server) {
                        checked = false
                        creating = false
                    }
                    .compactRow()
                    .background(Color.white, in: RoundedRectangle(cornerRadius: Compact.corner))
                    // Close under its own label: nearer than two boxes stand.
                    .padding(.top, 4 - Self.gap)
            }
        }
        .font(Compact.font)
        .padding(Compact.margin)
        // A name and a password are short: the box is no wider than they need.
        .frame(width: 260)
        .background(Rab.background, in: RoundedRectangle(cornerRadius: Compact.corner + 4))
        // One shadow, round the box: not one under each thing in it.
        .compositingGroup()
        .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
        .transaction { $0.animation = nil }
        .onAppear { focus = .username }
    }

    private func go() {
        guard ready else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                if !checked {
                    let exists = try await model.check(username: username)
                    if !exists { needsEmail = await model.signupNeedsEmail() }
                    creating = !exists
                    checked = true
                    focus = .password
                } else if creating && needsEmail && !codeSent {
                    try await model.sendCode(username: username, password: password, email: email)
                    codeSent = true
                    focus = .code
                } else {
                    try await model.signIn(username: username, password: password, creating: creating, email: email, code: code)
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Has the code mailed again, for whoever did not get it.
    private func sendCode() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await model.sendCode(username: username, password: password, email: email)
                code = ""
                focus = .code
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
