import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek, isBookable } from '../src/schedule.js';
import { grantPack, balance, NoCreditError } from '../src/ledger.js';
import {
  bookBike,
  takenBikes,
  cancelBooking,
  cancelDeadline,
  upcomingBookings,
  markNoShow,
  joinWaitlist,
  leaveWaitlist,
  onBikeFreed,
  BikeTakenError,
  BikeOutOfRangeError,
  NotBookableError,
  NotFullError,
  AlreadyBookedError,
} from '../src/booking.js';
import { returnCredit } from '../src/ledger.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  return { store, classId: session.id };
}

test('booking a bike spends one credit', () => {
  const { store, classId } = setup();
  const before = balance(store, 'acc_test1', NOW);

  bookBike(store, { classId, bikeNo: 3, accountId: 'acc_test1', now: NOW });

  assert.equal(balance(store, 'acc_test1', NOW), before - 1);
});

test('booking stores the bike, account, status and spent lot', () => {
  const { store, classId } = setup();

  const booking = bookBike(store, { classId, bikeNo: 3, accountId: 'acc_test1', now: NOW });

  assert.equal(booking.classId, classId);
  assert.equal(booking.bikeNo, 3);
  assert.equal(booking.accountId, 'acc_test1');
  assert.equal(booking.status, 'booked');
  assert.ok(booking.creditLotId);
  assert.equal(store.bookings.length, 1);
});

test('same bike cannot be booked twice for one class', () => {
  const { store, classId } = setup();
  bookBike(store, { classId, bikeNo: 7, accountId: 'acc_test1', now: NOW });

  assert.throws(
    () => bookBike(store, { classId, bikeNo: 7, accountId: 'acc_test2', now: NOW }),
    BikeTakenError,
  );
});

test('the same bike number is free in a different class', () => {
  const { store, classId } = setup();
  const other = store.classes.find((c) => c.id !== classId);
  bookBike(store, { classId, bikeNo: 7, accountId: 'acc_test1', now: NOW });

  const booking = bookBike(store, { classId: other.id, bikeNo: 7, accountId: 'acc_test2', now: NOW });

  assert.equal(booking.bikeNo, 7);
});

test('no credit means no booking and no bike taken', () => {
  const { store, classId } = setup();

  assert.throws(
    () => bookBike(store, { classId, bikeNo: 5, accountId: 'acc_nobody', now: NOW }),
    NoCreditError,
  );
  assert.deepEqual(store.bookings, []);
  assert.deepEqual(takenBikes(store, classId), []);
});

test('bike number outside 1 to 20 is rejected', () => {
  const { store, classId } = setup();

  assert.throws(
    () => bookBike(store, { classId, bikeNo: 21, accountId: 'acc_test1', now: NOW }),
    BikeOutOfRangeError,
  );
  assert.throws(
    () => bookBike(store, { classId, bikeNo: 0, accountId: 'acc_test1', now: NOW }),
    BikeOutOfRangeError,
  );
});

test('a guest name is optional', () => {
  const { store, classId } = setup();

  const booking = bookBike(store, {
    classId,
    bikeNo: 9,
    accountId: 'acc_test1',
    guestName: null,
    now: NOW,
  });

  assert.equal(booking.guestName, null);
});

test('booking a class that is not yet bookable is rejected', () => {
  const { store, classId } = setup();

  assert.throws(
    () => bookBike(store, { classId, bikeNo: 1, accountId: 'acc_test1', now: new Date('2026-10-26T12:00:00Z') }),
    NotBookableError,
  );
});

test('takenBikes lists only bikes with a booked status', () => {
  const { store, classId } = setup();
  bookBike(store, { classId, bikeNo: 2, accountId: 'acc_test1', now: NOW });
  bookBike(store, { classId, bikeNo: 11, accountId: 'acc_test2', now: NOW });

  assert.deepEqual(takenBikes(store, classId), [2, 11]);
});

// Marks every bike as taken without spending credit, so waitlist rules can be tested.
function fillClass(store, classId) {
  for (let bikeNo = 1; bikeNo <= 20; bikeNo += 1) {
    store.bookings.push({
      id: `fill_${bikeNo}`,
      classId,
      bikeNo,
      accountId: 'acc_fill',
      guestName: null,
      status: 'booked',
      creditLotId: null,
      createdAt: NOW.toISOString(),
    });
  }
}

function startOf(store, classId) {
  return Date.parse(store.classes.find((c) => c.id === classId).startsAt);
}

test('cancel exactly 6 hours before the class still returns the credit', () => {
  const { store, classId } = setup();
  const booking = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const after = balance(store, 'acc_test1', NOW);
  const cancelAt = new Date(startOf(store, classId) - 6 * 60 * 60 * 1000);

  const cancelled = cancelBooking(store, booking.id, cancelAt);

  assert.equal(cancelled.status, 'cancelled');
  assert.equal(balance(store, 'acc_test1', cancelAt), after + 1);
});

test('cancel 5 hours 59 minutes before forfeits the credit', () => {
  const { store, classId } = setup();
  const booking = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const after = balance(store, 'acc_test1', NOW);
  const cancelAt = new Date(startOf(store, classId) - (5 * 60 + 59) * 60 * 1000);

  const cancelled = cancelBooking(store, booking.id, cancelAt);

  assert.equal(cancelled.status, 'late_cancel');
  assert.equal(balance(store, 'acc_test1', cancelAt), after);
});

test('no-show forfeits the credit', () => {
  const { store, classId } = setup();
  const booking = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const after = balance(store, 'acc_test1', NOW);

  const marked = markNoShow(store, booking.id);

  assert.equal(marked.status, 'no_show');
  assert.equal(balance(store, 'acc_test1', NOW), after);
});

test('a returned credit follows the return rule (return plus 7 days)', () => {
  const { store, classId } = setup();
  // Only credit: a lot that expires in 2 days.
  store.lots = [
    { id: 'short', accountId: 'acc_test1', packId: 'pk_1', expiresAt: '2026-11-22T12:00:00.000Z', remaining: 1, origin: 'purchase' },
  ];
  const booking = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const cancelAt = new Date(startOf(store, classId) - 24 * 60 * 60 * 1000);

  cancelBooking(store, booking.id, cancelAt);

  const returned = store.lots.find((l) => l.origin === 'returned');
  assert.equal(returned.expiresAt, new Date(cancelAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
});

test('waitlist needs a full class', () => {
  const { store, classId } = setup();

  assert.throws(
    () => joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW }),
    NotFullError,
  );
});

test('someone who already has a bike in the class cannot join the waitlist', () => {
  const { store, classId } = setup();
  fillClass(store, classId);
  store.bookings[0].accountId = 'acc_test1';

  assert.throws(
    () => joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW }),
    AlreadyBookedError,
  );
  assert.equal(store.waitlist.length, 0);
});

test('joining the waitlist twice keeps one entry', () => {
  const { store, classId } = setup();
  fillClass(store, classId);

  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });
  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });

  assert.equal(store.waitlist.length, 1);
});

test('freeing a bike mails everyone on the waitlist for that class', () => {
  const { store, classId } = setup();
  fillClass(store, classId);
  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });
  joinWaitlist(store, { classId, accountId: 'acc_test2', now: NOW });

  const mails = onBikeFreed(store, classId, NOW);

  assert.equal(mails.length, 2);
  assert.deepEqual(mails.map((m) => m.to).sort(), ['test1@example.com', 'test2@example.com']);
  assert.equal(mails[0].from, 'info@tockicanai.hr');
  assert.match(mails[0].subject, /Točkica|rezerv|mjesto/i);
  assert.equal(store.outbox.length, 2);
});

test('the person who cancels is not mailed about the bike they freed', () => {
  const { store, classId } = setup();
  const own = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  for (let bikeNo = 1; bikeNo <= 20; bikeNo += 1) {
    if (bikeNo !== 4) {
      store.bookings.push({ id: `fill_${bikeNo}`, classId, bikeNo, accountId: 'acc_fill', guestName: null, status: 'booked', creditLotId: null, createdAt: NOW.toISOString() });
    }
  }
  // joinWaitlist now refuses acc_test1 (it holds a bike), so seed the entry directly.
  store.waitlist.push({ id: 'wl_seed', classId, accountId: 'acc_test1', createdAt: NOW.toISOString() });
  joinWaitlist(store, { classId, accountId: 'acc_test2', now: NOW });
  store.outbox = [];

  cancelBooking(store, own.id, NOW);

  const freedMails = store.outbox.filter((m) => m.subject.startsWith('Oslobodilo se mjesto'));
  assert.deepEqual(freedMails.map((m) => m.to), ['test2@example.com']);
});

test('freed bike is not held for anyone: first to book takes it', () => {
  const { store, classId } = setup();
  fillClass(store, classId);
  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });
  joinWaitlist(store, { classId, accountId: 'acc_test2', now: NOW });
  store.bookings = store.bookings.filter((b) => b.bikeNo !== 5);
  onBikeFreed(store, classId, NOW);

  assert.equal(takenBikes(store, classId).includes(5), false);
  const booking = bookBike(store, { classId, bikeNo: 5, accountId: 'acc_test2', now: NOW });
  assert.equal(booking.accountId, 'acc_test2');
});

test('booking removes the account from that class waitlist', () => {
  const { store, classId } = setup();
  fillClass(store, classId);
  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });
  store.bookings = store.bookings.filter((b) => b.bikeNo !== 5);

  bookBike(store, { classId, bikeNo: 5, accountId: 'acc_test1', now: NOW });

  assert.equal(store.waitlist.filter((w) => w.accountId === 'acc_test1').length, 0);
});

test('cancelDeadline is 6 hours before the class start', () => {
  const { store, classId } = setup();
  const deadline = cancelDeadline(store.classes.find((c) => c.id === classId));
  assert.equal(deadline.getTime(), startOf(store, classId) - 6 * 60 * 60 * 1000);
});

test('upcomingBookings lists only the account\'s booked, future classes, soonest first', () => {
  const { store, classId } = setup();
  const mine = bookBike(store, { classId, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  const other = bookBike(store, { classId, bikeNo: 4, accountId: 'acc_test2', now: NOW });
  const cancelled = bookBike(store, { classId, bikeNo: 5, accountId: 'acc_test1', now: NOW });
  cancelBooking(store, cancelled.id, NOW);
  const result = upcomingBookings(store, 'acc_test1', NOW);
  assert.deepEqual(result.map((r) => r.booking.id), [mine.id]);
  assert.equal(result[0].session.id, classId);
  assert.ok(!result.some((r) => r.booking.id === other.id));
  const afterStart = new Date(startOf(store, classId) + 1000);
  assert.equal(upcomingBookings(store, 'acc_test1', afterStart).length, 0);
});

test('leaving the waitlist removes only that account from that class', () => {
  const { store, classId } = setup();
  for (let bikeNo = 1; bikeNo <= 20; bikeNo += 1) {
    grantPack(store, 'acc_test2', 'pk_1', NOW);
    bookBike(store, { classId, bikeNo, accountId: 'acc_test2', now: NOW });
  }
  joinWaitlist(store, { classId, accountId: 'acc_test1', now: NOW });

  leaveWaitlist(store, { classId, accountId: 'acc_test2' });
  assert.equal(store.waitlist.length, 1);
  leaveWaitlist(store, { classId, accountId: 'acc_test1' });
  assert.equal(store.waitlist.length, 0);
});
