# The items cache

The server does not hold the public account's items in memory, and does not open their
folders when it starts. `_public` has tens of thousands of items (what the crawlers wrote
down), and none of them is on the map or in a list: only the spots they are on are. So the
server holds a few lines of each public item and reads the item itself from its folder when
its page, or its spot's page, is opened.

Those few lines are the cache: one file,

    data/cache/items/_public.jsonl

with one line per item folder: the folder's name, when the folder was last changed, and what
is kept of the item (its title, category, place, pin, areas, first photograph, whether it is
published, when it was made and changed, and the crawler's key for it from `source.json`).
That is what a spot is placed, counted and dated by, and what `rab public push` is told the
server holds.

Only `_public`'s items are cached. Every spot, every other account's items and every deleted
item are read whole at each start; there are few of them.

## What a start does

A start never waits on the item folders. It takes the file as it is — or nothing, where there
is no file — and begins to answer. Then, between answering, it goes through the folders a few
hundred at a time: each folder's time of last change is held against the one the cache
recorded, the folders that differ or are new are read again, the ones gone are let go, and
the file is written again if anything differed. With no file, that pass is the whole cache
being built while the server runs.

Until the pass ends:

- the map and the lists show every spot, but a spot's items are only those known so far —
  with no file, none at first, and more as they are read;
- an item's own page still opens: a folder not known yet is read when it is asked for;
- `rab public push`, `pull`, `mirror` and `purge` are answered 503 ("still reading its public
  items; try again in a minute"), since what the server would say it holds is not yet all of it;
- folders a crawler puts there are not taken in; they are once it ends.

With the file there, the pass takes a second or two for tens of thousands of items. Without
it, as long as reading every folder takes — but in the background.

## When the cache is written

1. **After a start's pass over the folders, if anything differed** (see above). Where nothing
   differs the file is left as it is.
2. **Thirty seconds after the last change, while the server runs.** A change to a public item
   (a push, a mirror, an edit, a delete, a folder a crawler put there) marks the cache as
   needing to be written. Each change starts the thirty seconds again, so a long push writes
   once, after it ends.
3. **When the server is stopped.** On `pm2 stop`, a restart or Ctrl-C, changes still waiting
   are written before the process exits — as much of a cache still being built as there is,
   too, for the next start to go on from.
4. **When `./rab cache rebuild` is run.** Every folder is read again, whatever its time says,
   and the file is written afresh.

`./rab cache rebuild` reads the folders with eight threads at once, which is most of what
building takes; the pass after a start reads a few at a time instead, so as not to keep the
server from answering.

A folder changed in the last five or six seconds is left out of the file on purpose: it may
still be changing, and is read again at the next start.

The `./rab user …` commands open the same data: they take the file as a start does, wait for
the pass over the folders to end before saying anything, and may write the file too.

## What the cache does not notice

A folder is read again only where its own time of last change has moved. Everything the
server and the crawlers write moves it: they write a file beside the one it replaces and
rename it into place. An `item.json` edited in place by hand does not. After such an edit:

    ./rab cache rebuild      read every item's folder again and rewrite the cache (./rab cache build is the same)
    ./rab restart            for the running server to read it

`cache rebuild` says how many items the cache had wrong, and takes a minute or more with
tens of thousands of items. It can be run with the server up, which goes on with what it
holds until it is restarted. Deleting the `.jsonl` file and restarting does the same: the
server then builds it again in the background, its spots' items filling in as it goes.

A crawler that rewrites an existing item while the server runs is in the same position until
the next start: the item's own page shows what is in the folder, and what its spot shows of
it is what the server held.

## Other things under data/cache/

    data/cache/pins-48/      the pin-sized copy of a photograph, made the first time a pin asks for it

All of `data/cache/` can be deleted; it is made again as it is needed.
