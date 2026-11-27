import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useLocation, useSearchParams } from "../ui/index.js";
import { dotted } from "./UserName/index.js";
import { spotPath } from "../utils/spots.js";

// What the list of spots can be narrowed to, as the list of items beside it:
// on or off, only the public ones — a spot with at least one published item
// on it. "All" is not that.
const FILTERS = ["all", "published"];

// `carried`: an item being dragged from somewhere else on the screen, which
// any spot takes when it is let go over it (`onDropItem`). With `cards` the
// spots are cards with their photographs rather than rows; `beside` stands
// beside the heading. `onPress` is asked, with the spot and the press,
// before a spot's row goes to its page, and keeps it from going by calling
// preventDefault — as an item's row is (see ItemRow).
export default function SpotList({ spots, username, filterable = false, carried = null, onDropItem, cards = false, beside = null, onPress }) {
  const { t } = useTranslation();
  const [dropOn, setDropOn] = useState(null);
  // Any spot takes any item.
  const takes = (spot) => Boolean(onDropItem && carried);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // The filter is in the address, under names of its own so the items' filter
  // in the same address is left alone.
  const published = filterable && searchParams.get("spotsPublished") === "1";
  const show = (onlyPublished) => {
    const query = new URLSearchParams(searchParams);
    if (onlyPublished) query.set("spotsPublished", "1");
    else query.delete("spotsPublished");
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  // As with items: All lets go of everything, and Published is a switch.
  const press = (name) => show(name === "published" ? !published : false);
  const pressed = (name) => (name === "published" ? published : !published);

  const shown = spots.filter((spot) => !published || spot.published > 0);

  return (
    <>
      <div className="part-heading">
        {/* `beside`: what stands beside the heading — the pair that lays the
            spots out as cards or rows. */}
        <span className="part-head">
          <h2>{t("spot.title")}</h2>
          {beside}
        </span>
        <span>{spots.length}</span>
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
        <p className="empty-state">{t(spots.length === 0 ? "spot.empty" : "spot.noneShown")}</p>
      ) : cards ? (
        <ul className="item-cards">
          {shown.map((spot) => (
            <li key={spot.id} className="item-card">
              <Link className="item-card-link" to={spotPath({ owner: username, id: spot.id })} state={{ back: true }} onClick={onPress && ((event) => onPress(spot, event))}>
                <span className="item-card-photo">{spot.thumb && <img src={spot.thumb} alt="" loading="lazy" />}</span>
                <span className="item-card-lines">
                  <strong>{spot.title}</strong>
                  <span className="item-card-meta">{dotted([t("spot.count", { count: spot.count ?? 0 }), spot.default && t("spot.default"), spot.place])}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="row-list">
          {shown.map((spot) => (
            <li
              key={spot.id}
              className={dropOn === spot.id && takes(spot) ? "row-item row-drop" : "row-item"}
              onDragOver={(event) => {
                if (!takes(spot)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                if (dropOn !== spot.id) setDropOn(spot.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDropOn((current) => (current === spot.id ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropOn(null);
                if (takes(spot)) onDropItem(spot);
              }}
            >
              <div className="row">
                <Link className="row-copy" draggable={false} to={spotPath({ owner: username, id: spot.id })} state={{ back: true }} onClick={onPress && ((event) => onPress(spot, event))}>
                  {spot.thumb && <img className="row-thumb" src={spot.thumb} alt="" width="40" height="40" loading="lazy" />}
                  <span className="row-lines">
                    <strong>
                      {spot.title}
                      {spot.what && <span className="row-what">{spot.what}</span>}
                    </strong>
                    <span className="row-meta">
                      {dotted([
                        // The default spot, which every account has.
                        spot.default && t("spot.default"),
                        spot.place,
                      ])}
                    </span>
                  </span>
                </Link>
                {/* How many items are on it, at the row's right end. */}
                <span className="row-count">{t("spot.count", { count: spot.count ?? 0 })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
