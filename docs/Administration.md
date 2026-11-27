# Administration

## Accounts

Run these commands from the repository root.

    ./rab user list                      every account
    ./rab user <username> items          what an account has out for rent
    ./rab user <username> pass <new>     give an account a new password, and sign it out everywhere
    ./rab user delete <username>         delete an account and everything it has (stop the server first)

Two accounts are the server's own, made when it first starts and always there: `_public`,
which holds the items listed on someone else's behalf, and `_admin`, which looks after the
site. A report of an item, and a request to delete one of `_public`'s items, are messages
to `_admin` — and only `_admin` deletes those items. It starts with no password, and
cannot be signed in to until it has one; set one with `./rab user _admin pass <new>` and sign in as `_admin` to read them.

## Upload public listings

`_admin` can also send a public folder — `_public`'s folder from another server, or
what a crawler left (`locations.json`, `items/<made>/item.json` and its photographs) — and
have it merged into `_public`'s. `./rab public push` asks the server what it holds already
(`GET /api/public`: each item's id and `source.json` key, each place's id and address),
and sends only the places and items it does not have: the places in one zip, then each
item's folder in a zip of its own, printing each as it goes:

    ./rab public push                                      to this machine's server, on its port
    ./rab public push -u rab.gcc3.com                      to another (or RAB_HOST)
    ./rab public push -f ~/crawled -u rab.gcc3.com         another folder than this source's

Without `-f` it sends this source's own `data/users/_public` (under `RAB_DATA` where that is
set). The folder named may be the public folder itself or hold it as its one folder. It signs in
as `_admin` with the password it asks for (or `RAB_PASSWORD`), or uses `RAB_TOKEN`, a
session token of `_admin`'s, if that is set.

The server and the password can be kept in `.env`, so that nothing needs to be typed:

    RAB_HOST=rab.gcc3.com          where public push, pull, mirror and purge go (-u goes before it)
    RAB_PASSWORD=<password>        _admin's password there (./rab user _admin pass <password> on the server)

Two more go the same way, with the same `-f` and `-u`:

    ./rab public pull              fetch what the server's _public has and the folder does not, or has newer
    ./rab public mirror            push, pull what the server has newer, then delete there what the folder does not have

`pull` is `push` the other way round: it adds the server's missing places to the folder's
`locations.json` and writes each missing item's folder (`GET /api/public/locations`,
`GET /api/public/items/<id>`, a zip), and fetches again each item the server has under the same
id with a newer `updatedAt` than here, replacing the folder here; one newer here is left as it is.
A folder that is not there yet is made. `mirror` sends what `push` sends, fetches what the server
has newer than here (as `pull` does, but not what the folder lacks), then deletes outright on the
server each item, spot and place that the folder has under neither the same id, nor the same key or
address — all in one request, `POST /api/public/delete`, which takes as long as it takes (a server
from before it is sent `DELETE /api/public/items/<id>` and `DELETE /api/public/locations/<id>`
one at a time); open bookings on an item are cancelled first. It says how many it will delete and asks for `yes`; `--yes` skips the
question, and without a terminal it is required. Note that the server adds each new item's
spot to `_public`'s places, so a mirror from a folder whose `locations.json` lacks them deletes them.

To empty `_public` on a server:

    ./rab public purge             delete every item and store of the server's _public
    ./rab public purge -u rab.gcc3.com

It deletes each one outright as `mirror` does (`DELETE /api/public/items/<id>`; open bookings
are cancelled first) and leaves the places. It says how many items and stores it will delete
and asks for `purge` to be typed; `--yes` skips the question, and without a terminal it is required.

Without `./rab`, pushing is

    curl https://<host>/api/public -H "Authorization: Bearer <token>"
    curl -X POST https://<host>/api/public -H "Authorization: Bearer <token>" --data-binary @item.zip

A zip sent holds `locations.json`, or one item (`items/<made>/…`), or both; one with more
items than that is turned away. A place with the same id or the same address as one already
kept takes its place; an item with the same id, or the same `key` in its `source.json`,
takes its place and keeps its id; everything else is added. The answer says what was
added, replaced and passed over.
