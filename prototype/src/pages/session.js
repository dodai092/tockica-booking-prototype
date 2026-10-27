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

function seed(now) {
  const store = createStore(now);
  const monday = mondayOf(now);
  for (let w = 0; w < WEEKS_SEEDED; w += 1) {
    generateWeek(store, studioTime.toUtc(`${studioTime.addDays(monday, 7 * w)}T00:00`));
  }
  grantPack(store, 'acc_test1', 'pk_5', now);
  grantPack(store, 'acc_test2', 'pk_5', now);
  return store;
}

export function loadStore() {
  const saved = sessionStorage.getItem(KEY);
  return saved ? JSON.parse(saved) : seed(new Date());
}

export function saveStore(store) {
  sessionStorage.setItem(KEY, JSON.stringify(store));
}

export function resetStore() {
  sessionStorage.removeItem(KEY);
}
