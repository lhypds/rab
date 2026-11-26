import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation, useSearchParams } from "../ui/index.js";
import { dotted } from "./UserName/index.js";
import { storePath } from "../utils/stores.js";

// What the list of stores can be narrowed to, as the list of items beside it:
// on or off, only the public ones — a store with at least one published item
// on it. "All" is not that.
const FILTERS = ["all", "published"];

// `carried`: an item being dragged from somewhere else on the screen, which
// any store takes when it is let go over it (`onDropItem`).
export default function StoreList({ stores, username, filterable = false, carried = null, onDropItem }) {
  const { t } = useTranslation();
  const [dropOn, setDropOn] = useState(null);
  // Any store takes any item.
  const takes = (store) => Boolean(onDropItem && carried);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // The filter is in the address, under names of its own so the items' filter
  // in the same address is left alone.
  const published = filterable && searchParams.get("storesPublished") === "1";
  const show = (onlyPublished) => {
    const query = new URLSearchParams(searchParams);
    if (onlyPublished) query.set("storesPublished", "1");
    else query.delete("storesPublished");
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  // As with items: All lets go of everything, and Published is a switch.
  const press = (name) => show(name === "published" ? !published : false);
  const pressed = (name) => (name === "published" ? published : !published);

  const shown = stores.filter((store) => !published || store.published > 0);

  return (
    <>
      <div className="part-heading">
        <h2>{t("store.title")}</h2>
        <span>{stores.length}</span>
      </div>
      {filterable && (
        <div className="tabs" role="group">
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={pressed(name)}
              className={pressed(name) ? "tab active" : "tab"}
              onClick={() => press(name)}
            >
              {name === "published" ? t("item.published") : t("map.all")}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="empty-state">{t(stores.length === 0 ? "store.empty" : "store.noneShown")}</p>
      ) : (
        <ul className="row-list">
          {shown.map((store) => (
            <li
              key={store.id}
              className={dropOn === store.id && takes(store) ? "row-item row-drop" : "row-item"}
              onDragOver={(event) => {
                if (!takes(store)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                if (dropOn !== store.id) setDropOn(store.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDropOn((current) => (current === store.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropOn(null);
                if (takes(store)) onDropItem(store);
              }}
            >
              <div className="row">
                <Link className="row-copy" draggable={false} to={storePath({ owner: username, id: store.id })} state={{ back: true }}>
                  {store.thumb && <img className="row-thumb" src={store.thumb} alt="" width="40" height="40" loading="lazy" />}
                  <span className="row-lines">
                    <strong>
                      {store.title}
                      {store.what && <span className="row-what">{store.what}</span>}
                    </strong>
                    <span className="row-meta">
                      {dotted([
                        // The default store, which every account has.
                        store.default && t("store.default"),
                        t("store.count", { count: store.count }),
                        store.place,
                      ])}
                    </span>
                  </span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
