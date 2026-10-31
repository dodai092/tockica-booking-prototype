import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN } from '../src/i18n-en.js';
import { t, plural, setLang, getLang } from '../src/i18n.js';
import { hrDate } from '../src/time.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unquote = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return name.endsWith('.js') && name !== 'i18n-en.js' ? [path] : [];
  });
}

// Every t('...') literal in the app code, plus every data-i18n text and attribute in index.html.
function usedStrings() {
  const used = new Map();
  const add = (text, where) => used.set(text, [...(used.get(text) ?? []), where]);
  for (const file of jsFiles(join(root, 'src'))) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) add(unquote(m[2]), file.replace(root, ''));
  }
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?!-attr)[^>]*>([^<]*)</g)) add(m[1].trim(), 'index.html');
  for (const m of html.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    for (const attr of m[1].split(/\s+/)) {
      const value = tag.match(new RegExp(` ${attr}="([^"]*)"`));
      if (value) add(value[1], 'index.html');
    }
  }
  return used;
}

test('every string the app translates has an English entry', () => {
  const missing = [...usedStrings()].filter(([text]) => !Object.hasOwn(EN, text));
  assert.deepEqual(
    missing.map(([text, where]) => `${text}  (${[...new Set(where)].join(', ')})`),
    [],
  );
});

// An entry counts as used when its text appears in the app source or the page. A plain search, not a
// quote parser, so it also finds strings passed through a variable, such as the login labels in session.js.
test('no English entry is unused', () => {
  const source = [...jsFiles(join(root, 'src')), join(root, 'index.html')]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const unused = Object.keys(EN).filter((text) => !source.includes(text.replace(/\n/g, '\\n')));
  assert.deepEqual(unused, []);
});

test('English entries are not Croatian placeholders', () => {
  for (const [text, english] of Object.entries(EN)) {
    assert.notEqual(english.trim(), '', `empty English for "${text}"`);
    assert.doesNotMatch(english, /—/, `em dash in English for "${text}"`);
  }
});

test('t() returns Croatian by default and English after setLang', () => {
  assert.equal(getLang(), 'hr');
  assert.equal(t('Kupi paket'), 'Kupi paket');
  assert.equal(t('Ne postoji u rječniku'), 'Ne postoji u rječniku');
  setLang('en');
  try {
    assert.equal(t('Kupi paket'), 'Buy a pack');
    assert.equal(t('Ne postoji u rječniku'), 'Ne postoji u rječniku');
    assert.equal(t('Pozdrav {ime}', { ime: 'Ana' }), 'Pozdrav Ana');
  } finally {
    setLang('hr');
  }
});

test('plural picks the Croatian forms and the English forms', () => {
  const kredit = ['kredit', 'kredita', 'kredita'];
  const credit = ['credit', 'credits'];
  const hr = (n) => plural(n, kredit, credit);
  assert.equal(hr(1), 'kredit');
  assert.equal(hr(2), 'kredita');
  assert.equal(hr(4), 'kredita');
  assert.equal(hr(5), 'kredita');
  assert.equal(hr(12), 'kredita');
  assert.equal(hr(21), 'kredit');
  assert.equal(hr(22), 'kredita');
  setLang('en');
  try {
    assert.equal(plural(1, kredit, credit), 'credit');
    assert.equal(plural(0, kredit, credit), 'credits');
    assert.equal(plural(2, kredit, credit), 'credits');
  } finally {
    setLang('hr');
  }
});

test('dates keep the Croatian numbers and switch weekday and month names', () => {
  // 31 October 2026 is a Saturday, 10:00 in Zagreb.
  const date = new Date('2026-10-31T09:00:00Z');
  const format = hrDate({ weekday: 'long', day: 'numeric', month: 'numeric' });
  assert.equal(format.format(date), 'subota, 31.10.');
  setLang('en');
  try {
    assert.equal(format.format(date), 'Saturday, 31.10.');
    assert.equal(hrDate({ day: '2-digit', month: 'long' }).format(date), '31. October');
  } finally {
    setLang('hr');
  }
});
