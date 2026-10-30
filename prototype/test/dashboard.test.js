import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike, cancelBooking, joinWaitlist } from '../src/booking.js';
import { creditLots, nextTraining, pastBookings, waitlistEntries, rideProgress, introOffer } from '../src/dashboard.js';

const NOW = new Date('2026-11-20T12:00:00Z');

function setup() {
  const store = createStore(NOW);
  generateWeek(store, studioTime.toUtc('2026-11-30T00:00'));
  const first = store.classes.find((c) => c.name === 'SOUL test');
  const second = store.classes.find((c) => c.name === 'Test tema');
  return { store, first, second };
}

test('credit lots list usable lots by earliest expiry and flag those expiring within 7 days', () => {
  const { store } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  const soon = grantPack(store, 'acc_test1', 'pk_1', NOW);
  soon.expiresAt = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const lots = creditLots(store, 'acc_test1', NOW);

  assert.deepEqual(lots.map((l) => [l.packName, l.remaining, l.expiringSoon]), [['1 trening', 1, true], ['5 treninga', 5, false]]);
});

test('credit lots skip empty and expired lots', () => {
  const { store } = setup();
  grantPack(store, 'acc_test1', 'pk_1', NOW).remaining = 0;
  grantPack(store, 'acc_test1', 'pk_1', NOW).expiresAt = '2026-11-01T00:00:00.000Z';

  assert.deepEqual(creditLots(store, 'acc_test1', NOW), []);
});

test('next training is the earliest booking, with its free-cancel state', () => {
  const { store, first, second } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  bookBike(store, { classId: second.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  bookBike(store, { classId: first.id, bikeNo: 9, accountId: 'acc_test1', now: NOW });

  const next = nextTraining(store, 'acc_test1', NOW);

  assert.equal(next.session.id, first.id);
  assert.equal(next.booking.bikeNo, 9);
  assert.equal(next.freeCancel, true);
});

test('free cancel ends 6 hours before the class', () => {
  const { store, first } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  bookBike(store, { classId: first.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  const late = new Date(Date.parse(first.startsAt) - 5 * 60 * 60 * 1000);

  assert.equal(nextTraining(store, 'acc_test1', late).freeCancel, false);
});

test('next training is null without an upcoming booking', () => {
  const { store } = setup();
  assert.equal(nextTraining(store, 'acc_test1', NOW), null);
});

test('past bookings list every status except Booked, newest class first', () => {
  const { store, first, second } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  const a = bookBike(store, { classId: first.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  const b = bookBike(store, { classId: second.id, bikeNo: 2, accountId: 'acc_test1', now: NOW });
  bookBike(store, { classId: second.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  a.status = 'attended';
  b.status = 'late_cancel';

  const past = pastBookings(store, 'acc_test1', 10);

  assert.deepEqual(past.map((p) => [p.booking.status, p.session.id]), [['late_cancel', second.id], ['attended', first.id]]);
});

test('past bookings are the account own and respect the limit', () => {
  const { store, first } = setup();
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  bookBike(store, { classId: first.id, bikeNo: 1, accountId: 'acc_test2', now: NOW }).status = 'attended';

  assert.deepEqual(pastBookings(store, 'acc_test1', 10), []);
  assert.equal(pastBookings(store, 'acc_test2', 0).length, 0);
});

test('a cancelled booking shows in the past list as cancelled', () => {
  const { store, first } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  const booking = bookBike(store, { classId: first.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  cancelBooking(store, booking.id, NOW);

  assert.equal(pastBookings(store, 'acc_test1', 10)[0].booking.status, 'cancelled');
});

test('waitlist entries are the account own, for classes still to come', () => {
  const { store, first } = setup();
  for (let bikeNo = 1; bikeNo <= first.bikeCount; bikeNo += 1) {
    grantPack(store, 'acc_test2', 'pk_1', NOW);
    bookBike(store, { classId: first.id, bikeNo, accountId: 'acc_test2', now: NOW });
  }
  joinWaitlist(store, { classId: first.id, accountId: 'acc_test1', now: NOW });

  assert.deepEqual(waitlistEntries(store, 'acc_test1', NOW).map((w) => w.session.id), [first.id]);
  assert.deepEqual(waitlistEntries(store, 'acc_test1', new Date(Date.parse(first.startsAt) + 1)), []);
  assert.deepEqual(waitlistEntries(store, 'acc_test2', NOW), []);
});

test('ride progress counts own attended classes toward the next milestone, guests excluded', () => {
  const { store, first } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  bookBike(store, { classId: first.id, bikeNo: 1, accountId: 'acc_test1', now: NOW }).status = 'attended';
  bookBike(store, { classId: first.id, bikeNo: 2, accountId: 'acc_test1', guestName: 'Ana', now: NOW }).status = 'attended';

  assert.deepEqual(rideProgress(store, 'acc_test1'), { rides: 1, base: 0, next: 50, toNext: 49, percent: 2 });
});

test('ride progress starts from the previous milestone after the 50th class', () => {
  const { store } = setup();
  for (let i = 0; i < 60; i += 1) {
    store.bookings.push({ id: `b${i}`, classId: 'x', accountId: 'acc_test1', status: 'attended', bikeNo: 1 });
  }

  assert.deepEqual(rideProgress(store, 'acc_test1'), { rides: 60, base: 50, next: 100, toNext: 40, percent: 20 });
});

test('intro offer is shown to an account with no packs and no rides', () => {
  const { store } = setup();
  assert.deepEqual(introOffer(store, 'acc_test1').map((p) => p.id), ['pk_intro1', 'pk_start3']);
});

test('intro offer is hidden once the account has bought a pack, or ridden', () => {
  const { store } = setup();
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  assert.deepEqual(introOffer(store, 'acc_test1'), []);
  store.bookings.push({ id: 'b', classId: 'x', accountId: 'acc_test2', status: 'attended', bikeNo: 1 });
  assert.deepEqual(introOffer(store, 'acc_test2'), []);
});
