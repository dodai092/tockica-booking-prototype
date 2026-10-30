import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { creditsEnabled, balance } from '../src/ledger.js';
import { bookBike, cancelBooking } from '../src/booking.js';
import { cancelClass, removeFromClass } from '../src/admin.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const HOUR = 60 * 60 * 1000;

// December mode: customers pay at the studio, so booking needs no credit.
function setup() {
  const store = createStore(NOW);
  store.settings.credits = false;
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  return { store, session };
}

test('credits are on unless the setting says false', () => {
  assert.equal(creditsEnabled(createStore(NOW)), true);
  assert.equal(creditsEnabled(setup().store), false);
});

test('without credits an account with none can still book, and nothing is spent', () => {
  const { store, session } = setup();

  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });

  assert.equal(booking.status, 'booked');
  assert.equal(booking.creditLotId, null);
  assert.equal(store.spentLog.length, 0);
  assert.equal(balance(store, 'acc_test1', NOW), 0);
});

test('without credits a cancel in time creates no returned credit', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });

  cancelBooking(store, booking.id, NOW);

  assert.equal(booking.status, 'cancelled');
  assert.equal(store.lots.length, 0);
});

test('without credits the 6 hour rule still labels a late cancel', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });

  cancelBooking(store, booking.id, new Date(Date.parse(session.startsAt) - 2 * HOUR));

  assert.equal(booking.status, 'late_cancel');
});

test('without credits the studio can cancel a class and the mail does not mention credits', () => {
  const { store, session } = setup();
  const at = new Date(Date.parse(session.startsAt) - 2 * HOUR);
  session.releaseOpensAt = new Date(at.getTime() - HOUR).toISOString();
  bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: at });
  store.outbox = [];

  const result = cancelClass(store, session.id, at);

  assert.equal(result.cancelledBookings, 1);
  assert.equal(store.lots.length, 0);
  assert.doesNotMatch(store.outbox[0].body, /kredit/i);
});

test('without credits removing a rider from a class mails no credit line', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  removeFromClass(store, { bookingId: booking.id, reason: 'test', now: NOW });

  assert.equal(booking.status, 'cancelled');
  assert.doesNotMatch(store.outbox[0].body, /kredit/i);
});
