import styles from "./checkbox.module.css";

// The house checkbox, the same one tm draws: a small white square with a black
// tick in it when it is on, and its label after it. The box is never filled —
// ticked or not, its ground is paper. `disabled`: it cannot be changed, and
// says so by its cursor.
export default function Checkbox({ checked, onChange, className, disabled = false, title, children }) {
  return (
    <label className={[styles.check, className].filter(Boolean).join(" ")} data-disabled={disabled} title={title}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.box} aria-hidden="true" />
      {children}
    </label>
  );
}
