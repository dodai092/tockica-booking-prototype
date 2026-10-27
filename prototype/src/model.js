// Fake seed data for the prototype. Prices are placeholders, not agreed prices.
// Account emails use example.com so no real address is ever used.

// Random part keeps ids unique when a saved store is reloaded in a new page load.
let counter = 0;

export function newId(prefix) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createStore(now) {
  return {
    now: now.toISOString(),
    accounts: [
      { id: 'acc_test1', name: 'Test Klijent 1', email: 'test1@example.com', multisportTag: false },
      { id: 'acc_test2', name: 'Test Klijent 2', email: 'test2@example.com', multisportTag: true },
    ],
    packs: [
      { id: 'pk_1', name: '1 trening', priceEur: 15, multisportPriceEur: 8, classes: 1, validDays: 30 },
      { id: 'pk_5', name: '5 treninga', priceEur: 65, multisportPriceEur: null, classes: 5, validDays: 45 },
      { id: 'pk_start3', name: 'Početni 3 treninga', priceEur: 20, multisportPriceEur: null, classes: 3, validDays: 30 },
    ],
    instructors: [
      { id: 'ins_1', name: 'Instruktorica 1' },
      { id: 'ins_2', name: 'Instruktor 2' },
    ],
    template: [
      { dayOfWeek: 1, time: '10:00', name: 'SOUL test', instructorId: 'ins_1', themeName: null },
      { dayOfWeek: 1, time: '16:30', name: 'Test tema', instructorId: 'ins_2', themeName: 'Tema' },
    ],
    settings: { dayOfWeek: 1, hour: 10, weeksAhead: 2, returnedCreditDays: 7 },
    lots: [],
    classes: [],
    bookings: [],
    waitlist: [],
    spentLog: [],
    restoredLog: [],
    outbox: [],
  };
}
