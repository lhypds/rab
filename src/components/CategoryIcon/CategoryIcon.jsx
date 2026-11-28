import { groupIconParts, iconParts } from "../../utils/categoryIcons.js";
import styles from "./icon.module.css";

// A category's drawing, as an inline icon the size of the type beside it —
// or a theme's (`group`: "" is no theme), where that is what is named.
export default function CategoryIcon({ category, group, className }) {
  return (
    <svg className={className ? `${styles.icon} ${className}` : styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {(group === undefined ? iconParts(category) : groupIconParts(group)).map((part, index) =>
        typeof part === "string" ? (
          // A drawing's parts are in a fixed order and have no other identity.
          // eslint-disable-next-line react/no-array-index-key
          <path key={index} d={part} />
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <circle key={index} cx={part[0]} cy={part[1]} r={part[2]} />
        ),
      )}
    </svg>
  );
}
