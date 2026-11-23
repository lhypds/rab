import { Fragment } from "react";
import { Link, useNavigate } from "../../ui/index.js";
import { formatUsername } from "../../utils/format.js";

// Somebody's name, which is the way to their page wherever it is written:
// underlined when pointed at, and pressing it goes there.
//
// `inside` is for a name written within something that is already a link or a
// button — a row that leads to an item, a search result. A link cannot hold
// another, so there the name is a span that acts as one, and a press on it
// stops at the name and does not reach what it is written in.
//
// `state` is what the entry the press opens is to carry (see Link) — that
// there is a step back from it, where the name is pressed somewhere a reader
// will want to return to.
export default function UserName({ name, inside = false, className = "", onClick, state }) {
  const navigate = useNavigate();
  if (!name) return null;
  const to = `/u/${encodeURIComponent(name)}`;
  const classes = className ? `user-link ${className}` : "user-link";
  if (!inside) {
    return (
      <Link className={classes} to={to} state={state} onClick={onClick}>
        {formatUsername(name)}
      </Link>
    );
  }
  const go = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick?.(event);
    navigate(to, { state });
  };
  return (
    <span
      className={classes}
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(event) => {
        if (event.key === "Enter") go(event);
      }}
    >
      {formatUsername(name)}
    </span>
  );
}

// The parts of a line with a dot between them, for a line where one of the
// parts is a name to press and so cannot be joined up as text.
export function dotted(parts) {
  return parts.filter(Boolean).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && " · "}
      {part}
    </Fragment>
  ));
}
