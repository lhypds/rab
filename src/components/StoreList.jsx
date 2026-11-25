import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation, useSearchParams } from "../ui/index.js";
import { KINDS } from "../utils/kinds.js";
import CategoryIcon from "./CategoryIcon/index.js";
import { dotted } from "./UserName/index.js";
import { storePath } from "../utils/stores.js";

// What the list of stores can be narrowed to, as the list of items beside it:
// one kind at a time, and on or off beside it only the public ones — a store
// with at least one published item on it. "All" is none of that.
const FILTERS = ["all", "published", ...KINDS];

// `carried`: an item being dragged from somewhere else on the screen, which
// any store takes when it is let go over it (`onDropItem`).
export default function StoreList({ stores, username, filterable = false, carried = null, onDropItem }) {
  const { t } = useTranslation();
  const [dropOn, setDropOn] = useState(null);
  // A store takes an item of any kind.
  const takes = (store) => Boolean(onDropItem && carried);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // The filter is in the address, under names of its own so the items' filter
  // in the same address is left alone.
  const wanted = searchParams.get("stores");
  const filter = filterable && KINDS.includes(wanted) ? wanted : "all";
  const published = filterable && searchParams.get("storesPublished") === "1";
  const show = (name, onlyPublished) => {
    const query = new URLSearchParams(searchParams);
    if (name === "all") query.delete("stores");
    else query.set("stores", name);
    if (onlyPublished) query.set("storesPublished", "1");
    else query.delete("storesPublished");
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  // As with items: All lets go of everything, a kind pressed again is let go
  // of, and Published is a switch of its own.
  const press = (name) =>
    name === "all" ? show("all", false) : name === "published" ? show(filter, !published) : show(name === filter ? "all" : name, published);
  const pressed = (name) => (name === "published" ? published : name === "all" ? filter === "all" && !published : filter === name);

  const shown = stores.filter((store) => (filter === "all" || store.kind === filter) && (!published || store.published > 0));

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
              {KINDS.includes(name) && <CategoryIcon kind={name} />}
              {name === "published" ? t("item.published") : name === "service" ? t("mine.skills") : t(`kind.${name}`)}
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
                    <strong>{store.title}</strong>
                    <span className="row-meta">
                      {dotted([
                        <span className="kind-label">
                          <CategoryIcon kind={store.kind} />
                          {t(`store.kinds.${store.kind}`)}
                        </span>,
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
