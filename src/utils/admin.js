// The account that looks after the site (see server/db.js): always there, and
// where a report of an item or a request to delete one is sent.
export const ADMIN_NAME = "_admin";

export function isAdmin(user) {
  return user?.username === ADMIN_NAME;
}
