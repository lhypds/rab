import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation, useSearchParams } from "../ui/index.js";
import { KINDS } from "../utils/kinds.js";
import CategoryIcon from "./CategoryIcon/index.js";
import { dotted } from "./UserName/index.js";
import { pagePath } from "../utils/pages.js";

// What the list of pages can be narrowed to, as the list of items beside it:
// one kind at a time, and on or off beside it only the public ones — a page
// with at least one published item on it. "All" is none of that.
const FILTERS = ["all", "published", ...KINDS];

// `carried`: an item being dragged from somewhere else on the screen, which
// a page of its kind takes when it is let go over it (`onDropItem`).
export default function PageList({ pages, username, filterable = false, carried = null, onDropItem }) {
  const { t } = useTranslation();
  const [dropOn, setDropOn] = useState(null);
  const takes = (page) => Boolean(onDropItem && carried && (carried.kind || "item") === page.kind);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // The filter is in the address, under names of its own so the items' filter
  // in the same address is left alone.
  const wanted = searchParams.get("pages");
  const filter = filterable && KINDS.includes(wanted) ? wanted : "all";
  const published = filterable && searchParams.get("pagesPublished") === "1";
  const show = (name, onlyPublished) => {
    const query = new URLSearchParams(searchParams);
    if (name === "all") query.delete("pages");
    else query.set("pages", name);
    if (onlyPublished) query.set("pagesPublished", "1");
    else query.delete("pagesPublished");
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  // As with items: All lets go of everything, a kind pressed again is let go
  // of, and Published is a switch of its own.
  const press = (name) =>
    name === "all" ? show("all", false) : name === "published" ? show(filter, !published) : show(name === filter ? "all" : name, published);
  const pressed = (name) => (name === "published" ? published : name === "all" ? filter === "all" && !published : filter === name);

  const shown = pages.filter((page) => (filter === "all" || page.kind === filter) && (!published || page.published > 0));

  return (
    <>
      <div className="part-heading">
        <h2>{t("page.title")}</h2>
        <span>{pages.length}</span>
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
        <p className="empty-state">{t(pages.length === 0 ? "page.empty" : "page.noneShown")}</p>
      ) : (
        <ul className="row-list">
          {shown.map((page) => (
            <li
              key={page.id}
              className={dropOn === page.id && takes(page) ? "row-item row-drop" : "row-item"}
              onDragOver={(event) => {
                if (!takes(page)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                if (dropOn !== page.id) setDropOn(page.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDropOn((current) => (current === page.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropOn(null);
                if (takes(page)) onDropItem(page);
              }}
            >
              <div className="row">
                <Link className="row-copy" draggable={false} to={pagePath({ owner: username, id: page.id })} state={{ back: true }}>
                  {page.thumb && <img className="row-thumb" src={page.thumb} alt="" width="40" height="40" loading="lazy" />}
                  <span className="row-lines">
                    <strong>{page.title}</strong>
                    <span className="row-meta">
                      {dotted([
                        <span className="kind-label">
                          <CategoryIcon kind={page.kind} />
                          {t(`page.kinds.${page.kind}`)}
                        </span>,
                        t("page.count", { count: page.count }),
                        page.place,
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
