// Shares one demo store between the pages through sessionStorage.
// Everything in the store is JSON-safe (strings and numbers, no Date objects).
import { createStore } from '../model.js';
import { studioTime } from '../time.js';
import { generateWeek } from '../schedule.js';
import { grantPack } from '../ledger.js';

const KEY = 'tockica-prototype-store';
const WEEKS_SEEDED = 3;

export function mondayOf(now) {
  const iso = now.toISOString();
  return studioTime.addDays(studioTime.localDate(iso), -(studioTime.dayOfWeek(iso) - 1));
}

// Riders Room classes and times from the original site (raspored-tekuci-tjedan).
// The site does not say who teaches which class: the pairing below is a placeholder.
const INSTRUCTORS = [
  { id: 'ins_1', name: 'Melita Mauer' },
  { id: 'ins_2', name: 'Tanja Kenjereš' },
];
const TEMPLATE = [
  [1, '17:45', 'Funky Spin'], [1, '18:45', 'Rhythm Spin'], [1, '19:45', 'Fresh Start Spin'],
  [2, '17:30', 'Power Spin'], [2, '18:30', 'Rise & Spinn'], [2, '19:45', 'GoodVibes Spin'],
  [3, '17:30', 'Afterwork Spin'], [3, '18:30', 'Funky Spin'], [3, '19:30', 'Fresh Start Spin'],
  [4, '18:45', 'ABS-olutely Spin'], [4, '19:45', 'GoodVibes Spin'],
  [5, '17:15', 'TGIF Spin'],
  [6, '10:30', 'Rise & Spinn'], [6, '11:15', 'Pop Spinn'],
].map(([dayOfWeek, time, name], i) => ({
  dayOfWeek, time, name, instructorId: INSTRUCTORS[i % 2].id, themeName: null,
}));

// Creates the template's classes for this week and the next ones. Existing classes are kept.
export function generateUpcoming(store, now) {
  const monday = mondayOf(now);
  for (let w = 0; w < WEEKS_SEEDED; w += 1) {
    generateWeek(store, studioTime.toUtc(`${studioTime.addDays(monday, 7 * w)}T00:00`));
  }
}

function seed(now) {
  const store = createStore(now);
  store.instructors = INSTRUCTORS;
  store.template = TEMPLATE;
  generateUpcoming(store, now);
  grantPack(store, 'acc_test1', 'pk_5', now);
  grantPack(store, 'acc_test2', 'pk_5', now);
  return store;
}

let shared = null;

// One store object for all three tabs, so a change in one shows in the others.
export function loadStore() {
  if (!shared) {
    const saved = sessionStorage.getItem(KEY);
    shared = saved ? JSON.parse(saved) : seed(new Date());
  }
  return shared;
}

export function saveStore(store) {
  sessionStorage.setItem(KEY, JSON.stringify(store));
}

export function resetStore() {
  sessionStorage.removeItem(KEY);
}
