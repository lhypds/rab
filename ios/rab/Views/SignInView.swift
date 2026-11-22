import SwiftUI

/// Signing in, in two goes like the website: the name first, which says
/// whether it is an account at all, then the password — to open it or, for a
/// name nobody has, to create it.
struct SignInView: View {
    @Environment(AppModel.self) private var model

    @State private var username = ""
    @State private var password = ""
    /// The name has been asked about.
    @State private var checked = false
    /// Nobody has the name; the password will create the account.
    @State private var creating = false
    @State private var busy = false
    @State private var error: String?
    /// The server's address is asked for only by somebody who wants to change it.
    @State private var showingServer = false
    @FocusState private var focus: Field?

    private enum Field { case username, password }

    /// Around "Advanced" and "Server": at the fields' left edge, "Advanced" as
    /// far under the button as the button is under the field, and "Server"
    /// close above its own field. A line of text is taller than its letters,
    /// which is what the small numbers allow for; measured on screen.
    private static let headingInsets = EdgeInsets(top: -3, leading: 0, bottom: 4, trailing: 0)
    /// The space between the field, the button and the heading under it.
    private static let gap: CGFloat = 20

    private var buttonTitle: LocalizedStringKey {
        if !checked { return "Continue" }
        return creating ? "Create account" : "Sign in"
    }

    private var ready: Bool {
        !busy && !username.trimmingCharacters(in: .whitespaces).isEmpty && (!checked || password.count >= 6)
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
                            error = nil
                        }
                    if checked {
                        SecureField(creating ? "Choose a password" : "Password", text: $password)
                            .textContentType(creating ? .newPassword : .password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(go)
                    }
                } footer: {
                    if creating {
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
            // The field sits close under the wordmark, not a section's gap below it.
            .contentMargins(.top, 8, for: .scrollContent)
            // A heading is as tall as its text and its insets, no taller.
            .environment(\.defaultMinListHeaderHeight, 0)
            .safeAreaInset(edge: .top, spacing: 0) {
                RabHeader(background: Color(.systemGroupedBackground))
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
                    creating = !exists
                    checked = true
                    focus = .password
                } else {
                    try await model.signIn(username: username, password: password, creating: creating)
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
