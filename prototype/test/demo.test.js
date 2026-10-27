import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek, isBookable } from '../src/schedule.js';
import { takenBikes, joinWaitlist, bookBike } from '../src/booking.js';
import { grantPack } from '../src/ledger.js';
import { checkInOpen } from '../src/checkin.js';
import { addSoonClass, fillClass } from '../src/demo.js';

const NOW = new Date('2026-11-20T12:00:00Z');

test('fillClass takes all 20 bikes, so the waitlist opens', () => {
  const store = createStore(NOW);
  generateWeek(store, studioTime.toUtc('2026-11-30T00:00'));
  const session = store.classes[0];

  fillClass(store, session.id, NOW);

  assert.equal(takenBikes(store, session.id).length, 20);
  assert.doesNotThrow(() => joinWaitlist(store, { classId: session.id, accountId: 'acc_test1', now: NOW }));
});

test('addSoonClass is bookable now and check-in is open now', () => {
  const store = createStore(NOW);
  const session = addSoonClass(store, NOW);

  assert.equal(isBookable(session, NOW), true);
  assert.equal(checkInOpen(session, NOW), true);
});

test('a soon class can be booked by a seed account', () => {
  const store = createStore(NOW);
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  const session = addSoonClass(store, NOW);
  assert.doesNotThrow(() => bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW }));
});
