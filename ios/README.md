rab for iPhone
==============

A small companion to rab: go through the things you have with the camera, one
after another, and have them registered on rab — each a photograph with a
name, a few words for what it is, a category and a description. Sign in with
your rab account; everything you make is kept in a folder of your own on the
phone.

    ios/rab.xcodeproj          open in Xcode 16 or later; runs on iOS 17 or later
    ios/rab/RabApp.swift       the app and its look (black on white, compact)
    ios/rab/AppModel.swift     who is signed in, their items, collecting, recognizing and registering
    ios/rab/UserStore.swift    the user's folder: session, items, photographs
    ios/rab/RabAPI.swift       rab's HTTP API, the same one the website uses
    ios/rab/Scan/              the scanner: Scanner (the live camera), ObjectDetector (where the object is)
    ios/rab/Views/             SignInView, ItemsView (the grid and its bar), ItemTile,
                               ScannerView (collecting), ItemDetailView
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

**The items.** One screen: your items as a grid of photographs, four across,
each with its name small under it — what is still on this phone only first,
then what rab has. Over the grid, the categories that have
items, in a line: one of them narrows the grid to it. A tile opens the item's
page.

**The bar.** Four buttons, from the left:

- the marker chooses the spot things are collected onto — one of your spots on
  rab, your default one to start with. It only chooses; the tick says which.
- the camera starts collecting: it stays open, a white border is drawn round
  the object at the middle of the picture (the small cross; a thing off to the
  side is not seen), and the round button keeps a photograph of that object —
  cut down to it, with a little room round — for the spot. One thing after
  another, no form in between.
- the brain has everything that is not on rab yet recognized, a few at a
  time; the number beside it is how many there are. Each photograph goes to
  rab's server, which says its category — one of the object categories only,
  not the places and services — its short category (a word or two: "Coffee
  mug"; kept as the item's "what is it"), a name and a description. All of
  it in English, Chinese and Japanese at once: the grid and the item's page
  show the language the app is in (the globe in the bar). The item
  is then registered on rab, on the spot it was collected for.
- the person shows whose account it is, and signs out.
- the arrow, last on the right, asks rab for the items again.

**What is registered.** What the thing is and nothing more: no price, not for
rent and not for sale, no way to reach you, no place and no area, and not
published. Those are said on the website, by whoever wants the thing offered —
but for publishing, which the item's page here does too: **Publish** on one
that is not, **Unpublish** on one that is. Only a published item shows the
way to its page on rab (**Open on rab**, **Share the link**).

**An item's page.** Its photograph and what it says about itself. The arrow at
the top right asks rab for it again (pulling the page down does not).
The background's button and **Recognize again** under it go by the photograph
the page is turned to: the button removes that one's background, or puts it
back, and it is recognized again from that one and the first two of the
others (three at most): what it is
said to be is written into the fields, and nothing more — **Save** keeps it,
on this phone and on rab. Save also puts onto rab one that is on this phone
only; there is no other button for that. "Add photos" asks where from. "Take a photo" opens the camera again for that
item: each press of the round button is one more photograph, and Done adds
them to it — after the ones it has, on rab too where the item is there; the
cross adds none. "Choose photos" adds some the phone has already. Several
photographs are swiped through side by side, each shown in a square; one
pressed is shown large, and the bin there takes it off the item; the star
there (top right, on any but the first) makes it the item's main photograph —
the first, the one its tile shows — on rab too where the item is there.

In the camera, Done (top right) keeps what was taken and the cross (top left)
throws it away again, asked first; the small photograph at the bottom left is
the last one taken, with how many there are, and opens them to be looked
through.

The border is Vision's foreground instance mask, looked for in the camera's
video several times a second; the photograph is a frame of that same video
(4K where the phone has it), so the box that was drawn is the box that is cut.


Where the data is
-----------------

All of a user's data is in one folder named after them, under `data` in the app's
documents:

    Documents/data/<username>/session.json    the signed-in session and its server
    Documents/data/<username>/items.json      the items, newest first (what was collected for a spot too)
    Documents/data/<username>/spots.json      the spots as rab last listed them
    Documents/data/<username>/photos/<id>.jpg the photographs

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

The simulator has no camera, so nothing can be collected there. For an iPhone the app is
signed with the team of the Apple Development certificate in the keychain
(`DEVELOPMENT_TEAM=<id>` picks another), and the phone has to be paired, unlocked
and in Developer Mode. Or open `ios/rab.xcodeproj`, set your team under Signing &
Capabilities, and run from Xcode.

Finding the object uses `VNGenerateForegroundInstanceMaskRequest`, which is why
iOS 17 is the floor.
