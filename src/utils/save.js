// ⌘S (Ctrl+S elsewhere) means save, and never "save this page as an HTML
// file" — which is what a browser does with it by default, and is no use to
// anybody on a page that is an app.
//
// Where a form that keeps something is open, the shortcut presses its own
// submit button: the form marks itself with `data-save`, and the button is
// what is pressed rather than the form submitted, so the shortcut can do
// exactly what the button can and no more — nothing while it is disabled.
// Where there is no such form the shortcut does nothing at all.
export function listenForSave() {
  const onKeyDown = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (event.repeat) return;
    // The innermost of them, where sheets are stacked.
    const forms = document.querySelectorAll("form[data-save]");
    forms[forms.length - 1]?.querySelector('button[type="submit"]:not(:disabled)')?.click();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
