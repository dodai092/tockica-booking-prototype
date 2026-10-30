// Shares one demo store between the pages through sessionStorage.
// Everything in the store is JSON-safe (strings and numbers, no Date objects).
import { createStore } from '../model.js';
import { studioTime } from '../time.js';
import { generateWeek } from '../schedule.js';
import { grantPack } from '../ledger.js';
import { markMonthPaid, bookSlot, nextMonth } from '../sculpt.js';
import { loginRole } from '../roles.js';

const KEY = 'tockica-prototype-store';
const WEEKS_SEEDED = 3;

export function mondayOf(now) {
  const iso = now.toISOString();
  return studioTime.addDays(studioTime.localDate(iso), -(studioTime.dayOfWeek(iso) - 1));
}

// Riders Room classes and times from the original site (raspored-tekuci-tjedan).
// The site does not say who teaches which class: the pairing below is a placeholder.
const INSTRUCTORS = [
  // Rates are placeholders until Dunia confirms them.
  { id: 'ins_1', name: 'Dunia Mando', rates: [{ from: '2026-01-01', eur: 20 }] },
  { id: 'ins_2', name: 'Mirna Zebec', rates: [{ from: '2026-01-01', eur: 20 }] },
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

// Marko paid this month. Iva paid this and next month and holds tomorrow 18:00, so Marko sees a taken hour.
function seedSculpt(store, now) {
  const month = studioTime.localDate(now.toISOString()).slice(0, 7);
  markMonthPaid(store, { trainerId: 'tr_1', month, now, note: 'Gotovina' });
  markMonthPaid(store, { trainerId: 'tr_2', month, now, note: 'Gotovina' });
  markMonthPaid(store, { trainerId: 'tr_2', month: nextMonth(month), now, note: 'Gotovina' });
  bookSlot(store, { trainerId: 'tr_2', date: studioTime.addDays(studioTime.localDate(now.toISOString()), 1), hour: 18, now });
}

function seed(now) {
  const store = createStore(now);
  store.instructors = INSTRUCTORS;
  store.template = TEMPLATE;
  generateUpcoming(store, now);
  grantPack(store, 'acc_test1', 'pk_5', now);
  grantPack(store, 'acc_test2', 'pk_5', now);
  seedSculpt(store, now);
  // December mode: no credits, customers pay at the studio. The demo button in Admin switches it.
  store.settings.credits = false;
  return store;
}

let shared = null;

// One store object for all three tabs, so a change in one shows in the others.
export function loadStore() {
  if (!shared) {
    const saved = sessionStorage.getItem(KEY);
    shared = saved ? JSON.parse(saved) : seed(new Date());
    // A store saved before the Sculpt Room existed gets an empty one.
    shared.sculpt ??= createStore(new Date()).sculpt;
    shared.waiverText ??= createStore(new Date()).waiverText;
    shared.waivers ??= [];
    // Links in mails open this page, so the demo works when clicked.
    shared.settings.appUrl = location.origin + location.pathname;
  }
  return shared;
}

// The demo account is shared by Raspored and Moj profil, so switching it in one shows in the other.
const ACCOUNT_KEY = 'tockica-prototype-account';
export const getDemoAccount = () => sessionStorage.getItem(ACCOUNT_KEY);
export const setDemoAccount = (id) => sessionStorage.setItem(ACCOUNT_KEY, id);

// Who is signed in, as a demo. A customer login is that account's id, a trainer's is "tr_" plus an id; staff logins are "reception" and "owner".
const LOGIN_KEY = 'tockica-prototype-login';
export const LOGINS = [['acc_test1', 'Klijent 1'], ['acc_test2', 'Klijent 2'], ['reception', 'Recepcija'], ['owner', 'Vlasnica'], ['tr_1', 'Trener Marko'], ['tr_2', 'Trener Iva']];
export const getLogin = () => sessionStorage.getItem(LOGIN_KEY) ?? LOGINS[0][0];
export const isCustomer = () => loginRole(getLogin()) === 'customer';
export function setLogin(login) {
  sessionStorage.setItem(LOGIN_KEY, login);
  if (loginRole(login) === 'customer') setDemoAccount(login);
}

export function saveStore(store) {
  sessionStorage.setItem(KEY, JSON.stringify(store));
}

export function resetStore() {
  sessionStorage.removeItem(KEY);
}
