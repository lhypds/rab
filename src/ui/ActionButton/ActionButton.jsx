import { Children, cloneElement } from "react";
import styles from "./action.module.css";

export default function ActionButton({
  tooltip,
  // For the buttons that sit against the right edge of something: the tooltip
  // hangs off its own button by default, which is fine in the top bar, is cut
  // off in a list, and runs off the side of a card in a tile's heading.
  tooltipRight = false,
  // The same against a left edge: the box starts at the button's left side and
  // grows inward, so it keeps the margin the button has.
  tooltipLeft = false,
  // For the buttons stacked in a column at the right edge: the tooltip stands
  // to the left of its button rather than under it, where the next button is.
  tooltipBeside = false,
  children,
  href,
  type = "button",
  ...props
}) {
  const icon = Children.only(children);
  // Most of these carry a drawn icon, which wants stroking and a fixed box. A
  // few carry a letter instead — the map's pins are letters, so the button that
  // opens what they stand for is one too — and a letter wants a typeface.
  const shape = icon.type === "svg" ? styles.icon : styles.glyph;
  // An anchor when the press leaves lo altogether. It has to be a real link
  // rather than a button that navigates: a tapped link is what a phone hands to
  // an installed app, and a scripted navigation is what it doesn't.
  const Tag = href ? "a" : "button";
  return (
    <Tag
      {...props}
      {...(href ? { href } : { type })}
      className={[
        styles.actionButton,
        tooltipBeside && styles.tooltipBeside,
        tooltipRight && styles.tooltipRight,
        tooltipLeft && styles.tooltipLeft,
      ]
        .filter(Boolean)
        .join(" ")}
      data-tooltip={tooltip}
      aria-label={props["aria-label"] || tooltip}
    >
      {cloneElement(icon, { className: shape })}
    </Tag>
  );
}
