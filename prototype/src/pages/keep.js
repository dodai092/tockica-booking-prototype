// The language switch reloads the page. This carries the view across the reload: the scroll position and
// whatever each page registers (selected day, month). Saved only on a language switch and read once on the next load.
const KEY = 'tockica-keep';
let saved = {};
try {
  saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
  sessionStorage.removeItem(KEY);
} catch {
  // No storage: the view starts fresh.
}
const getters = {};

export const restored = (name) => saved[name];
export const restoredScroll = () => saved.scroll ?? 0;
export function keep(name, get) {
  getters[name] = get;
}
export function saveView() {
  const out = { scroll: window.scrollY };
  for (const [name, get] of Object.entries(getters)) out[name] = get();
  try {
    sessionStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // Nothing to do without storage.
  }
}
