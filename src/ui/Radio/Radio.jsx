import styles from "./radio.module.css";

// The house radio button, drawn like the checkbox beside it: a small white
// ring with a black dot in it when it is the one chosen, and its label after
// it. One of a group that shares a `name`; `onChange` is handed its `value`
// when it is picked.
export default function Radio({ name, value, checked, onChange, className, disabled = false, children }) {
  return (
    <label className={[styles.radio, className].filter(Boolean).join(" ")} data-disabled={disabled}>
      <input
        type="radio"
        className={styles.input}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className={styles.ring} aria-hidden="true" />
      {children}
    </label>
  );
}
