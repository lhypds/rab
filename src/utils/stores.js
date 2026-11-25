// Where a store is — what the site shows as a page: under its owner's, as
// /u/<owner>/p/<id>. A store is an item (see server/db.js) and opens at
// /i/<id> as well; this is its own address.
export const storePath = (store) => `/u/${encodeURIComponent(store.owner)}/p/${encodeURIComponent(store.id)}`;

// Where any item is: a store at its own address, anything else at /i/<id>.
export const itemPath = (item) => (item.store && item.owner ? storePath(item) : `/i/${item.id}`);
