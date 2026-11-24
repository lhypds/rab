rab
===

Rental and booking, on a map.

`rab` opens on a map. It asks where you are — in words first, then with the browser's
own prompt — and opens there; where it cannot know, it opens on the capital of the
country the request came from. Everything nearby that is out for rent stands on the map
as a pin, with its main photograph over it and its price under it. The row along the
bottom narrows the pins to things, spaces or services; the search in the corner finds a
place inside your country, and the plane in the top bar goes anywhere else.

Three kinds of thing can be rented: a **thing** (a car, a camera, a projector), a
**space** (a home, a meeting room, storage, a music studio) and a **service** (somebody's
time). Each is booked one of two ways, and priced by rules its owner writes: **by the
date** — an ordinary day's price, plus rules for some days of the week or some dates — or
**by the date and the time** — the owner paints the hours of the week it can be had on a
timetable, sets an ordinary hour's price, and adds rules for some days, dates or hours of
the clock. The clock is cut in half hours.

The plus in the top bar publishes one: kind and category, name, description, up to a
hundred photographs (compressed in the browser; the first is the main one), the pricing
rules, a calendar to close the days it cannot be had, the area it is offered in (a town,
a ward, a prefecture — required, and filled in with the city you are in, or the city
the pin stands in once there is one), and optionally a pin on the map. Beside the map is the
name of the area in its middle and a list of everything offered there, pin or no pin.
Preview shows the page all of that comes to before anything is public.

That page (`/i/<id>`) is the booking page and the thing made to be passed around: Share
gives its link and a QR code to save. A visitor picks days with a pickup and a return time, or a day and — on that day's
timetable — the time from and until, and asks; nothing is charged — the owner accepts or declines, and the two settle payment and
pickup by message. The same page is where either side comes back to see where a rental
stands.

The box in the middle of the top bar searches what is out for rent by name. The envelope
is messages: one conversation per person, with every booking request, confirmation,
refusal and cancellation arriving in it as a line of its own. "My items" is what you
have out and who has asked for it; "My rentals" is what you have asked other people for.

On your own page (`/u/<name>`) you can make **pages** of what you have posted: a page of
things is a store, a page of spaces is a space, a page of services is just that. Each has
a name, a word about it, and the items of its kind you tick for it; a store and a space
stand at one of your saved locations, a page of services may or may not. Its address
(`/u/<name>/p/<id>`) shows the map, the items with their prices, and each is booked on its
own page.

Modelled on [`lo`](../lo/lo): the same stack, the same look, the same message sheets.


Run
---

Node 22 or later (the server uses Node's built-in SQLite).

    ./setup.sh        # .env, dependencies, database; finds a Mapbox token in a sibling project
    pnpm run dev      # http://localhost:3016, API and Vite on one port
    pnpm run build    # build the frontend
    ./start.sh        # run the build under pm2 (./restart.sh pulls, builds and restarts)

`.env` holds `PORT`, `PM2_NAME` and `VITE_MAPBOX_TOKEN` — a public Mapbox token, the
only credential there is. Without it everything but the maps still works.


Layout
------

    server/index.js    Express: accounts, items, calendar, bookings, messages, images
    server/db.js       accounts and sessions in SQLite; everything else read from and
                       written to the users' folders
    server/files.js    the users' folders: data/users/<username>/
    server/migrate.js  moves a database from before the folders into them, once
    server/rates.js    pricing rules and hours: by the date, by the date and time
    server/region.js   country of a request, from its address (ipwho.is)
    server/images.js   photo storage, each item's in its own folder
    server/upload.js   a public folder sent as a zip, read for merging into `_public`'s
    src/pages/         HomePage (the map), ItemPage, MinePage, RentalsPage, UserPage, PagePage, AuthPage
    src/components/    MapView, ItemView (the booking page), ItemModal (the form),
                       Calendar, TimeTable (a day's hours, the week's hours), ShareModal, TravelModal, the message sheets, the top bar
    src/ui/            Modal, ActionButton, Select, TextArea, Toast, Router — lo's own
    src/i18n/          English, Chinese, Japanese
    ios/               the iPhone app: photograph a thing, background to white, into My items
                       (its own README is in there)

Looking after the accounts, from the project's root (see `server/cli.js`):

    ./rab user list                      every account
    ./rab user <username> items          what an account has out for rent
    ./rab user <username> pass <new>     give an account a new password, and sign it out everywhere
    ./rab user delete <username>         delete an account and everything it has (stop the server first)

Two accounts are the server's own, made when it first starts and always there: `_public`,
which holds the items listed on someone else's behalf, and `_admin`, which looks after the
site. A report of an item, and a request to delete one of `_public`'s items, are messages
to `_admin` — and only `_admin` deletes those items. It starts with no password, and
cannot be signed in to until it has one; set one with `./rab user _admin pass <new>` and sign in as `_admin` to read them.

`_admin` can also send a whole public folder — `_public`'s folder from another server, or
what a crawler left (`locations.json`, `items/<made>/item.json` and its photographs), at the
top of a zip or inside one folder of it — and have it merged into `_public`'s:

    curl -X POST https://<host>/api/public -H "Authorization: Bearer <token>" --data-binary @public.zip

A place with the same id or the same address as one already kept takes its place; an item
with the same id, or the same `key` in its `source.json`, takes its place and keeps its id;
everything else is added. The answer says what was added, replaced and passed over.

What is kept where: `db.sqlite` holds who is signed in, and nothing else. An account is
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


How a booking moves
-------------------

    pending ──owner accepts──▶ confirmed ──either side──▶ cancelled
       │
       ├──owner declines──▶ declined
       └──renter cancels──▶ cancelled

Asking takes nothing off the calendar, so two people can ask for the same week; only
a confirmed booking marks days as taken, and confirming one declines the requests that
overlap it — for an item booked by the time, the ones whose hours overlap. A day on the calendar is a plain date (`2026-11-19`) with no clock and no
zone. The calendar stores only exceptions — a closed day, a day with its own price —
so an untouched item has no rows at all.
