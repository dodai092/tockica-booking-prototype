// A re-render destroys the control that has focus, which drops keyboard and screen-reader users back to the
// top of the page. keepFocus runs the rebuild, then refocuses the matching control: same name, nearest to
// where the old one sat, else the control now at that position.
const FOCUSABLE = 'button, a[href], input, select, textarea, summary';

const nameOf = (el) => `${el.tagName}|${el.id}|${(el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent ?? el.textContent).trim().slice(0, 40)}`;
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.getClientRects().length > 0);

export function keepFocus(rebuild) {
  const active = document.activeElement;
  const root = active?.closest('dialog[open], .panel');
  const index = root ? focusables(root).indexOf(active) : -1;
  if (index < 0) return rebuild();
  const name = nameOf(active);
  rebuild();
  if (active.isConnected) return undefined;
  const after = focusables(root);
  const same = after.map((el, i) => [el, i]).filter(([el]) => nameOf(el) === name);
  const pick = same.length
    ? same.reduce((a, b) => (Math.abs(b[1] - index) < Math.abs(a[1] - index) ? b : a))[0]
    : after[Math.min(index, after.length - 1)];
  pick?.focus({ preventScroll: true });
  return undefined;
}
