import SwiftUI

/// Signing in, in two goes like the website: the name first, which says
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

    /// Around "Advanced" and "Server": at the fields' left edge, "Advanced" as
    /// far under the button as the button is under the field, and "Server"
    /// close above its own field. A line of text is taller than its letters,
    /// which is what the small numbers allow for; measured on screen.
    private static let headingInsets = EdgeInsets(top: -3, leading: 0, bottom: 4, trailing: 0)
    /// The space between the field, the button and the heading under it.
    private static let gap: CGFloat = 20

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
        NavigationStack {
            Form {
                Section {
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
                    if checked {
                        SecureField(creating ? "Choose a password" : "Password", text: $password)
                            .textContentType(creating ? .newPassword : .password)
                            .focused($focus, equals: .password)
                            .submitLabel(creating && needsEmail ? .next : .go)
                            .onSubmit { if creating && needsEmail { focus = .email } else { go() } }
                    }
                    if checked && creating && needsEmail {
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
                        if codeSent {
                            TextField("Verification code", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .focused($focus, equals: .code)
                                .onChange(of: code) {
                                    code = String(code.filter(\.isNumber).prefix(6))
                                }
                        }
                    }
                } footer: {
                    if creating && codeSent {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Enter the 6-digit code sent to \(email).")
                            Button("Send again") { sendCode() }
                                .disabled(busy)
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    } else if creating && needsEmail {
                        Text("No account is called \(username). Choose a password of 6 characters or more, and give an email address: a verification code is sent to it.")
                            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    } else if creating {
                        Text("No account is called \(username). Choose a password of 6 characters or more to create it.")
                            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    } else if checked {
                        Text("Welcome back, \(username).")
                            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    }
                }

                Section {
                    Button(action: go) {
                        HStack {
                            Text(buttonTitle)
                            Spacer()
                            if busy { ProgressView().tint(.white) }
                        }
                        .foregroundStyle(.white)
                    }
                    .disabled(!ready)
                    // White on black once it can be pressed; grey until then.
                    .listRowBackground(ready ? Color.black : Color(white: 0.78))
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }

                // "Advanced" is always there; pressing it opens what is under
                // it — the server's address — and pressing it again closes it.
                Section {
                    if showingServer {
                        TextField(AppModel.defaultServer, text: $model.server)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onChange(of: model.server) {
                                checked = false
                                creating = false
                            }
                    }
                } header: {
                    VStack(alignment: .leading, spacing: Self.gap - 6.5) {
                        Button("Advanced") { showingServer.toggle() }
                        // The field's label: close to its field, not a gap away.
                        if showingServer { Text("Server") }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    // As written, not in capitals.
                    .textCase(nil)
                    .listRowInsets(Self.headingInsets)
                }
            }
            .listSectionSpacing(Self.gap)
            .rabBackground()
            // The field sits close under the wordmark, not a section's gap below it.
            .contentMargins(.top, 8, for: .scrollContent)
            // A heading is as tall as its text and its insets, no taller.
            .environment(\.defaultMinListHeaderHeight, 0)
            .safeAreaInset(edge: .top, spacing: 0) {
                RabHeader()
            }
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { focus = .username }
        }
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
