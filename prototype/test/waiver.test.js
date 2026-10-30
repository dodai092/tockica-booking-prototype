import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike } from '../src/booking.js';
import { needsWaiver, signWaiver, signGuestWaiver, WaiverRequiredError } from '../src/waiver.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  return { store, session };
}

function book(store, session, accountId = 'acc_test1') {
  return bookBike(store, { classId: session.id, bikeNo: 1, accountId, now: NOW });
}

test('an account that is not on its first ride needs no waiver', () => {
  const { store } = setup();
  assert.equal(needsWaiver(store, 'acc_test1'), false);
});

test('a first-ride account cannot book until the waiver is signed', () => {
  const { store, session } = setup();
  store.accounts[0].firstRide = true;

  assert.equal(needsWaiver(store, 'acc_test1'), true);
  assert.throws(() => book(store, session), WaiverRequiredError);
  assert.equal(store.bookings.length, 0);
});

test('signing stores the name, date and wording version, and unlocks booking', () => {
  const { store, session } = setup();
  store.accounts[0].firstRide = true;

  const waiver = signWaiver(store, { accountId: 'acc_test1', name: 'Test Klijent 1', now: NOW });

  assert.equal(waiver.name, 'Test Klijent 1');
  assert.equal(waiver.signedAt, NOW.toISOString());
  assert.equal(waiver.version, store.waiverText.version);
  assert.equal(needsWaiver(store, 'acc_test1'), false);
  assert.doesNotThrow(() => book(store, session));
});

test('a waiver is signed once per account', () => {
  const { store } = setup();
  signWaiver(store, { accountId: 'acc_test1', name: 'Test Klijent 1', now: NOW });
  signWaiver(store, { accountId: 'acc_test1', name: 'Test Klijent 1', now: NOW });

  assert.equal(store.waivers.filter((w) => w.accountId === 'acc_test1').length, 1);
});

test('a guest signs at the desk against their booking, not an account', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 2, accountId: 'acc_test1', guestName: 'Ana', now: NOW });

  const waiver = signGuestWaiver(store, { bookingId: booking.id, now: NOW });

  assert.equal(waiver.name, 'Ana');
  assert.equal(waiver.accountId, null);
  assert.equal(waiver.bookingId, booking.id);
});

test('a booking without a guest cannot take a guest waiver', () => {
  const { store, session } = setup();
  const booking = book(store, session);

  assert.throws(() => signGuestWaiver(store, { bookingId: booking.id, now: NOW }), /no guest/);
});
