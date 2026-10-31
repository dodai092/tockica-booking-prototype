// Croatian is the source text. t('Raspored') returns the English entry when the language is English.
// A missing entry falls back to the Croatian text, so an untranslated string shows Croatian, never a key.
import { EN } from './i18n-en.js';

const KEY = 'tockica-lang';
let lang = 'hr';
try {
  if (localStorage.getItem(KEY) === 'en') lang = 'en';
} catch {
  // No storage (private mode, tests): stay on Croatian.
}

export const getLang = () => lang;

// Stores the choice and reloads the page, so every page, sheet and rendered list is built again in the new language.
export function setLang(next) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage the choice lasts for this page load only.
  }
  lang = next;
  // replace() instead of reload() so the browser can play the page crossfade (@view-transition in styles.css). The hash is dropped because a hash-only change is no navigation; the tab is kept by src/pages/keep.js.
  if (typeof location !== 'undefined') location.replace(location.href.split('#')[0]);
}

export function t(text, vars) {
  let out = lang === 'en' && Object.hasOwn(EN, text) ? EN[text] : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  return out;
}

// Croatian has three plural forms (1 kredit, 2 kredita, 5 kredita), English two (1 credit, 2 credits).
// Pass the forms as [one, few, other] for Croatian and [one, other] for English.
export function plural(count, hr, en) {
  if (lang === 'en') return count === 1 ? en[0] : en[1];
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return hr[0];
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return hr[1];
  return hr[2];
}

// Static markup: <span data-i18n> translates its text, data-i18n-attr="aria-label title" translates those attributes.
// The Croatian original is remembered on first call, so calling this again after a change still works.
const originals = new WeakMap();
function original(el, name, read) {
  if (!originals.has(el)) originals.set(el, {});
  const store = originals.get(el);
  if (!(name in store)) store[name] = read();
  return store[name];
}

export function translatePage(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(original(el, 'text', () => el.textContent));
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const attr of el.dataset.i18nAttr.split(/\s+/)) {
      el.setAttribute(attr, t(original(el, attr, () => el.getAttribute(attr))));
    }
  }
}
