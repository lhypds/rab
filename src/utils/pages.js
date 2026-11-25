// Where a page is: under its owner's, as /u/<owner>/p/<id>. A page is an item
// (see server/db.js) and opens at /i/<id> as well; this is its own address.
export const pagePath = (page) => `/u/${encodeURIComponent(page.owner)}/p/${encodeURIComponent(page.id)}`;

// Where any item is: a page at its own address, anything else at /i/<id>.
export const itemPath = (item) => (item.page && item.owner ? pagePath(item) : `/i/${item.id}`);
