import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack, spendCredit, balance } from '../src/ledger.js';
import { bookBike, joinWaitlist } from '../src/booking.js';
import {
  restoreCredit,
  removeFromClass,
  setMultisportTag,
  setPackPrices,
  priceFor,
  RestoreError,
} from '../src/admin.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const HOUR = 60 * 60 * 1000;

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  return { store, session };
}

test('restore cannot exceed spent amount (nothing spent, restore 1 throws)', () => {
  const { store } = setup();

  assert.throws(
    () => restoreCredit(store, { accountId: 'acc_test1', count: 1, reason: 'test', now: NOW }),
    RestoreError,
  );
});

test('restore cannot exceed spent amount (2 spent, restore 3 throws)', () => {
  const { store } = setup();
  spendCredit(store, 'acc_test1', NOW);
  spendCredit(store, 'acc_test1', NOW);

  assert.throws(
    () => restoreCredit(store, { accountId: 'acc_test1', count: 3, reason: 'test', now: NOW }),
    RestoreError,
  );
});

test('restore puts back a spent credit, and cannot restore it twice', () => {
  const { store } = setup();
  spendCredit(store, 'acc_test1', NOW);
  const before = balance(store, 'acc_test1', NOW);

  restoreCredit(store, { accountId: 'acc_test1', count: 1, reason: 'hitno', now: NOW });

  assert.equal(balance(store, 'acc_test1', NOW), before + 1);
  assert.throws(
    () => restoreCredit(store, { accountId: 'acc_test1', count: 1, reason: 'opet', now: NOW }),
    RestoreError,
  );
});

test('restored lot expiry follows the return rule (return plus 7 days)', () => {
  const store = createStore(NOW);
  store.lots = [
    { id: 'l10', accountId: 'acc_test1', packId: 'pk_1', expiresAt: '2026-11-10T00:00:00.000Z', remaining: 1, origin: 'purchase' },
  ];
  spendCredit(store, 'acc_test1', new Date('2026-11-05T00:00:00.000Z'));

  const restored = restoreCredit(store, {
    accountId: 'acc_test1',
    count: 1,
    reason: 'test',
    now: new Date('2026-11-05T00:00:00.000Z'),
  });

  assert.equal(restored.origin, 'restore');
  assert.equal(restored.expiresAt, '2026-11-12T00:00:00.000Z');
});

test('remove from class returns the credit even after the 6 hour cutoff', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const after = balance(store, 'acc_test1', NOW);
  const twoHoursBefore = new Date(Date.parse(session.startsAt) - 2 * HOUR);

  const removed = removeFromClass(store, { bookingId: booking.id, reason: 'test', now: twoHoursBefore });

  assert.equal(removed.status, 'cancelled');
  assert.equal(balance(store, 'acc_test1', twoHoursBefore), after + 1);
});

test('remove from class mails the person and triggers the waitlist', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  // Fill the other 19 bikes so the class is full, then join the waitlist.
  for (let n = 1; n <= 20; n += 1) {
    if (n === 4) continue;
    store.bookings.push({ id: `f${n}`, classId: session.id, bikeNo: n, accountId: 'acc_fill', guestName: null, status: 'booked', creditLotId: null, createdAt: NOW.toISOString() });
  }
  joinWaitlist(store, { classId: session.id, accountId: 'acc_test2', now: NOW });
  store.outbox = [];

  removeFromClass(store, { bookingId: booking.id, reason: 'test', now: NOW });

  const recipients = store.outbox.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['test1@example.com', 'test2@example.com']);
});

test('Multisport tag is set only through setMultisportTag', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const files = [
    ...readdirSync(srcDir).filter((f) => f.endsWith('.js')).map((f) => new URL(f, srcDir)),
    ...readdirSync(new URL('pages/', srcDir)).filter((f) => f.endsWith('.js')).map((f) => new URL(`pages/${f}`, srcDir)),
  ];
  const offenders = files.filter((url) => !url.pathname.endsWith('/admin.js'))
    .filter((url) => /multisportTag\s*=(?!=)/.test(readFileSync(url, 'utf8')));

  assert.deepEqual(offenders.map((u) => u.pathname), []);
});

test('setMultisportTag flips the flag on the account', () => {
  const { store } = setup();

  setMultisportTag(store, 'acc_test1', true);
  assert.equal(store.accounts.find((a) => a.id === 'acc_test1').multisportTag, true);

  setMultisportTag(store, 'acc_test1', false);
  assert.equal(store.accounts.find((a) => a.id === 'acc_test1').multisportTag, false);
});

test('Multisport price applies only when the tag is on', () => {
  const { store } = setup();
  // pk_1: standard 15, Multisport 8. acc_test1 is off, acc_test2 is on (seed).
  assert.equal(priceFor(store, 'acc_test1', 'pk_1'), 15);
  assert.equal(priceFor(store, 'acc_test2', 'pk_1'), 8);
});

test('Multisport price falls back to standard when the Multisport price is null', () => {
  const { store } = setup();
  assert.equal(priceFor(store, 'acc_test2', 'pk_5'), 65);
});

test('setPackPrices updates both prices', () => {
  const { store } = setup();

  const pack = setPackPrices(store, 'pk_1', { priceEur: 16, multisportPriceEur: 9 });

  assert.equal(pack.priceEur, 16);
  assert.equal(pack.multisportPriceEur, 9);
});
