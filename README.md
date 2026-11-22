rab
===

Rental and booking, on a map.

`rab` opens on a map. It asks where you are — in words first, then with the browser's
own prompt — and opens there; where it cannot know, it opens on the capital of the
country the request came from. Everything nearby that is out for rent stands on the map
as a pin, with its main photograph over it and its price under it. The row along the
bottom narrows the pins to things, spaces or services; the search in the corner finds a
place inside your country, and the plane in the top bar goes anywhere else.

Three kinds of thing can be rented: a **thing** (a car, a camera, a 3D printer), a
**space** (a home, a meeting room, storage, a music studio) and a **service** (somebody's
time). Each is booked one of two ways, and priced by rules its owner writes: **by the
date** — an ordinary day's price, plus rules for some days of the week or some dates — or
**by the date and the time** — the owner paints the hours of the week it can be had on a
timetable, sets an ordinary hour's price, and adds rules for some days, dates or hours of
the clock. The clock is cut in half hours.

The plus in the top bar publishes one: kind and category, name, description, up to a
hundred photographs (compressed in the browser; the first is the main one), the pricing
rules, a calendar to close the days it cannot be had, the area it is offered in (a town,
a ward, a prefecture — required), and optionally a pin on the map. Beside the map is the
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
    server/files.js    the users' folders: data/users/<id>/
    server/migrate.js  moves a database from before the folders into them, once
    server/rates.js    pricing rules and hours: by the date, by the date and time
    server/region.js   country of a request, from its address (ipwho.is)
    server/images.js   photo storage under data/users/<id>/images/
    src/pages/         HomePage (the map), ItemPage, MinePage, RentalsPage, UserPage, AuthPage
    src/components/    MapView, ItemView (the booking page), ItemModal (the form),
                       Calendar, TimeTable (a day's hours, the week's hours), ShareModal, TravelModal, the message sheets, the top bar
    src/ui/            Modal, ActionButton, Select, TextArea, Toast, Router — lo's own
    src/i18n/          English, Chinese, Japanese
    ios/               the iPhone app: photograph a thing, background to white, into My items
                       (its own README is in there)

What is kept where: `db.sqlite` holds the accounts — a name, a password's hash, when
it was made — and who is signed in, and nothing else. Everything an account has is in
a folder of its own, named after the account's id:

    data/users/<id>/items.json      what they have out for rent, each with its calendar's exceptions
    data/users/<id>/bookings.json   every rental they are one side of (the other side holds the same)
    data/users/<id>/messages.json   their side of every conversation
    data/users/<id>/images/         the photographs they uploaded, each named after its own bytes

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
