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
have it merged into `_public`'s. `./rab push` asks the server what it holds already
(`GET /api/public`: each item's id and `source.json` key, each place's id and address),
and sends only the places and items it does not have: the places in one zip, then each
item's folder in a zip of its own, printing each as it goes:

    ./rab push                                             to this machine's server, on its port
    ./rab push -u rab.gcc3.com                             to another (or RAB_HOST)
    ./rab push -f ~/crawled -u rab.gcc3.com                another folder than this source's

Without `-f` it sends this source's own `data/users/_public` (under `RAB_DATA` where that is
set). The folder named may be the public folder itself or hold it as its one folder. It signs in
as `_admin` with the password it asks for (or `RAB_PASSWORD`), or uses `RAB_TOKEN`, a
session token of `_admin`'s, if that is set. Without `./rab`, the same is

    curl https://<host>/api/public -H "Authorization: Bearer <token>"
    curl -X POST https://<host>/api/public -H "Authorization: Bearer <token>" --data-binary @item.zip

A zip sent holds `locations.json`, or one item (`items/<made>/…`), or both; one with more
items than that is turned away. A place with the same id or the same address as one already
kept takes its place; an item with the same id, or the same `key` in its `source.json`,
takes its place and keeps its id; everything else is added. The answer says what was
added, replaced and passed over.
