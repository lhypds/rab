# Project layout and storage

Paths are relative to the repository root.

    server/index.js    Express: accounts, items, calendar, bookings, messages, images
    server/db.js       sessions in SQLite; account and listing data read from and
                       written to the users' folders
    server/files.js    the users' folders: data/users/<username>/
    server/migrate.js  moves a database from before the folders into them, once
    server/rates.js    pricing rules and hours: by the date, by the date and time
    server/region.js   country of a request, from its address (ipwho.is)
    server/images.js   photo storage, each item's in its own folder
    server/upload.js   a public folder, or an item of one, sent as a zip, read for merging into `_public`'s
    src/pages/         HomePage (the map), ItemPage, MinePage, RentalsPage, UserPage, PagePage, AuthPage
    src/components/    MapView, ItemView (the booking page), ItemModal (the form),
                       Calendar, TimeTable (a day's hours, the week's hours), ShareModal, TravelModal, the message sheets, the top bar
    src/ui/            Modal, ActionButton, Select, TextArea, Toast, Router — lo's own
    src/i18n/          English, Chinese, Japanese
    ios/               the iPhone app: photograph a thing, background to white, into My items
                       (its own README is in there)

## Data on disk

`db.sqlite` holds who is signed in, and nothing else. An account is
a folder of its own, named after its username, and everything it has is in it:

    data/users/<username>/items/<made>/item.json   one thing they have out for rent, with its calendar's exceptions
    data/users/<username>/items/<made>/<name>      that item's photographs, each named after its own bytes
    data/users/<username>/uploads/                 photographs sent and not yet saved with an item
    data/users/<username>/user.json                the account itself: its id (when it was made, in Unix
                                                   time), its password, its email address, how it is reached
    data/users/<username>/bookings.json            every rental they are one side of (the other side holds the same)
    data/users/<username>/messages.json            their side of every conversation

`<made>` is when the item was made, in Unix time to the millisecond, and is the item's
id: what its address is, and what a booking points at it by.

The server reads the folders when it starts and writes a file back whenever something
in it changes, so one server process owns them; a file edited by hand is picked up at
the next start. A `db.sqlite` from before the folders is moved into them the first
time the server starts, and a copy of it as it was is left at
`db.sqlite.before-folders`. All of it is ignored by git.
