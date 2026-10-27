import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack, balance } from '../src/ledger.js';
import { bookBike } from '../src/booking.js';
import {
  checkIn,
  checkInOpen,
  closeClass,
  correctStatus,
  CheckInClosedError,
} from '../src/checkin.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const MIN = 60 * 1000;

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  return { store, session };
}

function book(store, session, bikeNo, accountId) {
  return bookBike(store, { classId: session.id, bikeNo, accountId, now: NOW });
}

test('check-in opens 30 minutes before the class starts', () => {
  const { session } = setup();
  const start = Date.parse(session.startsAt);

  assert.equal(checkInOpen(session, new Date(start - 30 * MIN)), true);
  assert.equal(checkInOpen(session, new Date(start - 31 * MIN)), false);
});

test('check-in closes when the class ends', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const end = Date.parse(session.startsAt) + session.durationMin * MIN;

  assert.throws(() => checkIn(store, booking.id, new Date(end + 1)), CheckInClosedError);
});

test('check-in sets attended and does not change the credit balance', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const before = balance(store, 'acc_test1', NOW);
  const during = new Date(Date.parse(session.startsAt) - 10 * MIN);

  const checked = checkIn(store, booking.id, during);

  assert.equal(checked.status, 'attended');
  assert.equal(balance(store, 'acc_test1', during), before);
});

test('closing a class marks remaining booked bookings as no-show', () => {
  const { store, session } = setup();
  const attended = book(store, session, 1, 'acc_test1');
  book(store, session, 2, 'acc_test2');
  const during = new Date(Date.parse(session.startsAt) - 10 * MIN);
  checkIn(store, attended.id, during);
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);

  const changed = closeClass(store, session.id, end);

  assert.equal(changed.length, 1);
  assert.equal(store.bookings.find((b) => b.bikeNo === 2).status, 'no_show');
  assert.equal(store.bookings.find((b) => b.bikeNo === 1).status, 'attended');
});

test('closing a class before it ends is rejected', () => {
  const { store, session } = setup();
  book(store, session, 1, 'acc_test1');

  assert.throws(() => closeClass(store, session.id, new Date(Date.parse(session.startsAt))));
});

test('owner can correct a no-show to attended after the class', () => {
  const { store, session } = setup();
  const booking = book(store, session, 1, 'acc_test1');
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);
  closeClass(store, session.id, end);

  const corrected = correctStatus(store, booking.id, 'attended', end);

  assert.equal(corrected.status, 'attended');
});

test('closing a class does not mail the waitlist, the class is already over', () => {
  const { store, session } = setup();
  book(store, session, 1, 'acc_test1');
  const end = new Date(Date.parse(session.startsAt) + session.durationMin * MIN + MIN);

  closeClass(store, session.id, end);

  assert.equal(store.outbox.length, 0);
});
