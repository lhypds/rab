rab for iPhone
==============

A small companion to rab: photograph a thing, stand it on a plain background if you like,
and put it in your items on rab. Sign in with your rab account; everything you
make is kept in a folder of your own on the phone.

    ios/rab.xcodeproj          open in Xcode 16 or later; runs on iOS 17 or later
    ios/rab/RabApp.swift       the app and its look (black monospace on white)
    ios/rab/AppModel.swift     who is signed in, their items, saving and publishing
    ios/rab/UserStore.swift    the user's folder: session, items, photographs
    ios/rab/RabAPI.swift       rab's HTTP API, the same one the website uses
    ios/rab/BackgroundRemover.swift   Vision finds the subject; Core Image clears what is behind it
    ios/rab/Area.swift         the area an item is offered in, from the phone's position or a name
    ios/rab/Pickers.swift      the camera
    ios/rab/Views/             SignInView, ItemsView, NewItemView, ItemDetailView
    ios/rab/Localizable.xcstrings     English, Chinese, Japanese
    ios/build.sh               build it: for the simulator, or `./build.sh device` for an iPhone
    ios/deploy.sh              build, install on a connected iPhone and open it
    ios/emulate.sh             build and run it in the simulator


What it does
------------

**Sign in.** The name first, then the password — like the website. A name nobody
has is offered as a new account. The server is `https://rab.gcc3.com` unless the
field at the bottom says otherwise (a dev server on the same network, say
`http://192.168.0.79:3016`, works too).

**Take a photo.** The camera button in the top bar (or the photo button, for a
picture already taken). While the form is open, the subject is cut out of its
background; the swatches under the picture stand it on a colour — white, grey,
black or any other — or leave the photo as it was taken, which is how it
starts. Where no subject is found the photo is kept as it is, and the form
says so.

**Put it in your items.** A name, a day's price and its currency, and the area it
is offered in — suggested from where the phone is, or typed and looked up. Save
keeps it on the phone and, with the switch on, publishes it to rab exactly as the
website's form would: the photograph and a small copy are uploaded, then the
item carrying their names. It then shows in "My items" on rab and on the map
there. If publishing fails (no network, say), the item is still saved, and the
item's own page has a button to add it to rab later.


Where the data is
-----------------

All of a user's data is in one folder named after them, under `data` in the app's
documents:

    Documents/data/<username>/session.json    the signed-in session and its server
    Documents/data/<username>/items.json      the items, newest first
    Documents/data/<username>/photos/<id>.jpg the photographs, on the background chosen

The documents folder is shared with the Files app (On My iPhone › rab), so the
folder can be looked at, copied off, or deleted by hand. Signing out keeps the
folder; signing in again as the same name finds it. Two people can use one phone
and never see each other's items.


Building
--------

From the command line:

    ios/emulate.sh               build and run in the simulator (the one running, else an iPhone 17)
    ios/emulate.sh "iPhone Air"  in a particular simulator
    ios/deploy.sh                build, install on the connected iPhone, open it
    ios/build.sh [sim|device]    only build, into ios/build/

The simulator has no camera; use the photo button there. For an iPhone the app is
signed with the team of the Apple Development certificate in the keychain
(`DEVELOPMENT_TEAM=<id>` picks another), and the phone has to be paired, unlocked
and in Developer Mode. Or open `ios/rab.xcodeproj`, set your team under Signing &
Capabilities, and run from Xcode.

Background removal uses `VNGenerateForegroundInstanceMaskRequest`, which is why
iOS 17 is the floor.
