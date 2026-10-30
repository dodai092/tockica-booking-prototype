import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import {
  bookSlot,
  cancelSlot,
  removeSlot,
  markMonthPaid,
  unmarkMonthPaid,
  addClosedDay,
  removeClosedDay,
  cellState,
  mySlots,
  bookableDates,
  rentalStatus,
  SculptError,
} from '../src/sculpt.js';

// Fri 20.11.2026 at 13:00 studio time.
const NOW = new Date('2026-11-20T12:00:00Z');

function setup() {
  const store = createStore(NOW);
  markMonthPaid(store, { trainerId: 'tr_1', month: '2026-11', now: NOW });
  markMonthPaid(store, { trainerId: 'tr_2', month: '2026-11', now: NOW });
  return store;
}

const book = (store, over = {}) => bookSlot(store, { trainerId: 'tr_1', date: '2026-11-23', hour: 10, now: NOW, ...over });
// Runs fn, expects a SculptError and returns it so a test can read its code and message.
function code(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof SculptError, `expected SculptError, got ${e}`);
    return e;
  }
  return assert.fail('expected SculptError, nothing was thrown');
}

test('a trainer with a paid month books a free whole hour', () => {
  const store = setup();
  const slot = book(store);
  assert.deepEqual([slot.trainerId, slot.date, slot.hour], ['tr_1', '2026-11-23', 10]);
  assert.equal(store.sculpt.slots.length, 1);
});

test('a month that is not paid cannot be booked, even inside the 30 days', () => {
  const store = setup();
  const err = code(() => book(store, { date: '2026-12-05' }));
  assert.equal(err.code, 'unpaid');
  assert.match(err.message, /prosinac nije plaćen/i);
});

test('paying the later month opens it, 30 days ahead is the limit', () => {
  const store = setup();
  markMonthPaid(store, { trainerId: 'tr_1', month: '2026-12', now: NOW });
  assert.ok(book(store, { date: '2026-12-20' }));
  assert.equal(code(() => book(store, { date: '2026-12-21' })).code, 'too_far');
});

test('two bookings on one day are the limit, adjacent or not', () => {
  const store = setup();
  book(store, { hour: 9 });
  book(store, { hour: 15 });
  assert.equal(code(() => book(store, { hour: 16 })).code, 'day_full');
});

test('the limit is per trainer: another trainer still books the same day', () => {
  const store = setup();
  book(store, { hour: 9 });
  book(store, { hour: 10 });
  assert.ok(book(store, { trainerId: 'tr_2', hour: 11 }));
});

test('an hour held by another trainer is taken, first come first served', () => {
  const store = setup();
  book(store);
  assert.equal(code(() => book(store, { trainerId: 'tr_2' })).code, 'taken');
});

test('hours outside opening hours, past hours and closed days are refused', () => {
  const store = setup();
  assert.equal(code(() => book(store, { hour: 6 })).code, 'hour_range');
  assert.equal(code(() => book(store, { hour: 21 })).code, 'hour_range');
  assert.equal(code(() => book(store, { date: '2026-11-20', hour: 13 })).code, 'past');
  assert.ok(book(store, { date: '2026-11-20', hour: 14 }));
  addClosedDay(store, '2026-11-24');
  assert.equal(code(() => book(store, { date: '2026-11-24' })).code, 'closed_day');
});

test('a closed day cannot be set while it already has bookings', () => {
  const store = setup();
  book(store);
  assert.throws(() => addClosedDay(store, '2026-11-23'), SculptError);
  removeSlot(store, { slotId: store.sculpt.slots[0].id, reason: 'x', now: NOW });
  addClosedDay(store, '2026-11-23');
  removeClosedDay(store, '2026-11-23');
  assert.deepEqual(store.sculpt.closedDays, []);
});

test('a trainer cancels their own future slot at any time, nobody else can', () => {
  const store = setup();
  const slot = book(store);
  assert.throws(() => cancelSlot(store, { slotId: slot.id, trainerId: 'tr_2', now: NOW }), SculptError);
  cancelSlot(store, { slotId: slot.id, trainerId: 'tr_1', now: NOW });
  assert.equal(store.sculpt.slots.length, 0);
  assert.ok(book(store, { trainerId: 'tr_2' }));
});

test('the owner removes a slot and the trainer gets a mail with the reason', () => {
  const store = setup();
  const slot = book(store);
  removeSlot(store, { slotId: slot.id, reason: 'Popravak sobe', now: NOW });
  assert.equal(store.sculpt.slots.length, 0);
  assert.equal(store.outbox.length, 1);
  assert.equal(store.outbox[0].to, 'marko.test@example.com');
  assert.match(store.outbox[0].body, /Popravak sobe/);
  assert.match(store.outbox[0].body, /23\.11\. u 10:00/);
});

test('slots already booked survive an unpaid month, new bookings in it do not', () => {
  const store = setup();
  book(store, { date: '2026-11-25' });
  unmarkMonthPaid(store, { trainerId: 'tr_1', month: '2026-11' });
  assert.equal(store.sculpt.slots.length, 1);
  assert.equal(code(() => book(store, { date: '2026-11-26' })).code, 'unpaid');
});

test('marking a month paid records the date, amount and note, and not twice', () => {
  const store = setup();
  const paid = store.sculpt.paidMonths.find((p) => p.trainerId === 'tr_1');
  assert.deepEqual([paid.month, paid.paidOn, paid.amountEur], ['2026-11', '2026-11-20', 100]);
  markMonthPaid(store, { trainerId: 'tr_1', month: '2026-12', now: NOW, note: 'Gotovina' });
  assert.equal(store.sculpt.paidMonths.at(-1).note, 'Gotovina');
  assert.throws(() => markMonthPaid(store, { trainerId: 'tr_1', month: '2026-12', now: NOW }), SculptError);
  assert.throws(() => markMonthPaid(store, { trainerId: 'tr_1', month: '12-2026', now: NOW }), SculptError);
});

test('cellState tells free, mine, taken by name and blocked with a reason', () => {
  const store = setup();
  book(store, { hour: 9 });
  book(store, { trainerId: 'tr_2', hour: 10 });
  const state = (hour, date = '2026-11-23') => cellState(store, 'tr_1', date, hour, NOW);
  assert.equal(state(9).state, 'mine');
  assert.deepEqual([state(10).state, state(10).by], ['taken', 'Iva']);
  assert.equal(state(11).state, 'free');
  assert.deepEqual([state(11, '2026-12-02').state, state(11, '2026-12-02').code], ['blocked', 'unpaid']);
});

test('mySlots lists only upcoming slots of that trainer, earliest first', () => {
  const store = setup();
  book(store, { date: '2026-11-25', hour: 8 });
  book(store, { date: '2026-11-23', hour: 18 });
  book(store, { date: '2026-11-20', hour: 14 });
  book(store, { trainerId: 'tr_2', date: '2026-11-22' });
  const later = mySlots(store, 'tr_1', new Date('2026-11-20T14:30:00Z')).map((s) => `${s.date} ${s.hour}`);
  assert.deepEqual(later, ['2026-11-23 18', '2026-11-25 8']);
});

test('bookableDates runs from today through the days-ahead limit', () => {
  const store = setup();
  const dates = bookableDates(store, NOW);
  assert.deepEqual([dates[0], dates.at(-1), dates.length], ['2026-11-20', '2026-12-20', 31]);
});

test('rental status: ok, ending in the last week of the last paid month, lapsed when this month is unpaid', () => {
  const store = setup();
  assert.equal(rentalStatus(store, 'tr_1', new Date('2026-11-10T12:00:00Z')).status, 'ok');
  assert.equal(rentalStatus(store, 'tr_1', new Date('2026-11-25T12:00:00Z')).status, 'ending');
  markMonthPaid(store, { trainerId: 'tr_1', month: '2026-12', now: NOW });
  assert.equal(rentalStatus(store, 'tr_1', new Date('2026-11-25T12:00:00Z')).status, 'ok');
  assert.equal(rentalStatus(store, 'tr_1', new Date('2026-12-05T12:00:00Z')).status, 'ok');
  assert.equal(rentalStatus(store, 'tr_2', new Date('2026-12-05T12:00:00Z')).status, 'lapsed');
});
