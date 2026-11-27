// Where a store is — what the site shows as a spot: /s/<id>. A store is an
// item (see server/db.js) and opens at /i/<id> as well, and at its owner's
// /u/<owner>/p/<id> where links from before were made; both are put right
// to this one (see ItemPage).
export const storePath = (store) => `/s/${encodeURIComponent(store.id)}`;

// Where any item is: a store at /s/<id>, anything else at /i/<id>.
// A request ("I need") has a page too, at /r/<id>.
export const requestPath = (request) => `/r/${encodeURIComponent(request.id)}`;
export const itemPath = (item) => (item.kind === "request" ? requestPath(item) : item.store ? storePath(item) : `/i/${encodeURIComponent(item.id)}`);
