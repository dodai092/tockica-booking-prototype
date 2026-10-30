import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike, cancelBooking, markNoShow, joinWaitlist } from '../src/booking.js';
import { canPurchase, purchasePack } from '../src/purchase.js';
import { introOffer } from '../src/dashboard.js';
import { owedClasses, markCharged } from '../src/owed.js';
import { editClass } from '../src/admin.js';
import { sendMilestoneNotes } from '../src/reminders.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const HOUR = 60 * 60 * 1000;

function setup() {
  const store = createStore(NOW);
  store.settings.credits = false;
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  return { store, session };
}

test('the intro packs are 1 class for 10 EUR and 3 for 30 EUR, each bought once, both allowed', () => {
  const store = createStore(NOW);
  const one = store.packs.find((p) => p.id === 'pk_intro1');
  const three = store.packs.find((p) => p.id === 'pk_start3');
  assert.deepEqual([one.classes, one.priceEur, three.classes, three.priceEur], [1, 10, 3, 30]);

  purchasePack(store, 'acc_test1', 'pk_intro1', NOW);

  assert.equal(canPurchase(store, 'acc_test1', 'pk_intro1'), false);
  assert.equal(canPurchase(store, 'acc_test1', 'pk_start3'), true);
  assert.deepEqual(introOffer(createStore(NOW), 'acc_test1').map((p) => p.id), ['pk_intro1', 'pk_start3']);
});

test('a closed day gets no classes when the week is created', () => {
  const store = createStore(NOW);
  store.sculpt.closedDays = ['2026-11-30'];

  generateWeek(store, MONDAY_30_NOV);

  assert.equal(store.classes.length, 0);
  store.sculpt.closedDays = [];
  generateWeek(store, MONDAY_30_NOV);
  assert.equal(store.classes.length, 2);
});

test('late cancels and no-shows are listed as owed until marked charged', () => {
  const { store, session } = setup();
  const late = bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  const noShow = bookBike(store, { classId: session.id, bikeNo: 2, accountId: 'acc_test2', now: NOW });
  const fine = bookBike(store, { classId: session.id, bikeNo: 3, accountId: 'acc_test1', now: NOW });
  cancelBooking(store, late.id, new Date(Date.parse(session.startsAt) - 2 * HOUR));
  markNoShow(store, noShow.id);
  cancelBooking(store, fine.id, NOW);

  assert.deepEqual(owedClasses(store).map((o) => o.booking.id).sort(), [late.id, noShow.id].sort());
  assert.equal(owedClasses(store)[0].account.email.endsWith('@example.com'), true);

  markCharged(store, late.id, NOW);

  assert.deepEqual(owedClasses(store).map((o) => o.booking.id), [noShow.id]);
  assert.throws(() => markCharged(store, fine.id, NOW), /cancelled/);
});

test('editing one class changes it, mails the booked riders once, and the week is not regenerated', () => {
  const { store, session } = setup();
  bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  bookBike(store, { classId: session.id, bikeNo: 2, accountId: 'acc_test1', now: NOW });
  const before = store.classes.length;
  store.outbox = [];

  editClass(store, { classId: session.id, name: 'Nova tema', time: '11:00', instructorId: 'ins_2', themeName: 'Retro', now: NOW });

  assert.equal(session.name, 'Nova tema');
  assert.equal(session.startsAt, studioTime.toUtc('2026-11-30T11:00'));
  assert.equal(session.instructorId, 'ins_2');
  assert.equal(session.themeName, 'Retro');
  assert.equal(store.outbox.length, 1);
  assert.match(store.outbox[0].subject, /Promjena treninga/);

  generateWeek(store, MONDAY_30_NOV);
  assert.equal(store.classes.length, before);
});

test('editing a class nobody booked sends no mail, and bad input is rejected', () => {
  const { store, session } = setup();
  store.outbox = [];

  editClass(store, { classId: session.id, name: 'Drugo ime', time: '10:00', instructorId: 'ins_1', themeName: null, now: NOW });

  assert.equal(store.outbox.length, 0);
  assert.throws(() => editClass(store, { classId: session.id, name: ' ', time: '10:00', instructorId: 'ins_1', themeName: null, now: NOW }), RangeError);
  assert.throws(() => editClass(store, { classId: session.id, name: 'X', time: '25:00', instructorId: 'ins_1', themeName: null, now: NOW }), RangeError);
});

test('a class has 20 bikes unless the owner changes it, and editing capacity sends no rider mail', () => {
  const { store, session } = setup();
  assert.equal(session.bikeCount, 20);
  bookBike(store, { classId: session.id, bikeNo: 1, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  const sameCapacity = editClass(store, { classId: session.id, name: session.name, time: '10:00', instructorId: session.instructorId, themeName: null, now: NOW });
  assert.equal(sameCapacity.bikeCount, 20);

  editClass(store, { classId: session.id, name: session.name, time: '10:00', instructorId: session.instructorId, themeName: null, bikeCount: 12, now: NOW });
  assert.equal(session.bikeCount, 12);
  assert.equal(store.outbox.length, 0);
  assert.throws(() => bookBike(store, { classId: session.id, bikeNo: 13, accountId: 'acc_test2', now: NOW }));
});

test('capacity stays between the highest booked bike and 20, and raising it on a full class mails the waitlist', () => {
  const { store, session } = setup();
  const edit = (bikeCount) => editClass(store, { classId: session.id, name: session.name, time: '10:00', instructorId: session.instructorId, themeName: null, bikeCount, now: NOW });
  bookBike(store, { classId: session.id, bikeNo: 8, accountId: 'acc_test1', now: NOW });

  assert.throws(() => edit(7), RangeError);
  assert.throws(() => edit(0), RangeError);
  assert.throws(() => edit(21), RangeError);
  assert.throws(() => edit(8.5), RangeError);

  edit(8);
  for (let bikeNo = 1; bikeNo <= 7; bikeNo += 1) bookBike(store, { classId: session.id, bikeNo, accountId: 'acc_test2', now: NOW });
  store.accounts.push({ id: 'acc_late', name: 'Late', email: 'late@example.com', phone: '', multisportTag: false, marketingOptIn: false });
  joinWaitlist(store, { classId: session.id, accountId: 'acc_late', now: NOW });
  store.outbox = [];

  edit(10);
  assert.equal(store.outbox.length, 1);
  assert.match(store.outbox[0].subject, /Oslobodilo se mjesto/);
});

function riderWithAttended(store, count) {
  const past = store.classes.find((c) => c.name === 'Test tema');
  for (let i = 0; i < count; i += 1) {
    store.bookings.push({ id: `old_${i}`, classId: past.id, bikeNo: 1, accountId: 'acc_test1', guestName: null, status: 'attended', creditLotId: null, createdAt: NOW.toISOString() });
  }
}

test('the owner is mailed the day before a rider reaches the 50th class, once', () => {
  const { store, session } = setup();
  riderWithAttended(store, 49);
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];
  const dayBefore = new Date(Date.parse(session.startsAt) - 23 * HOUR);

  const mails = sendMilestoneNotes(store, dayBefore);

  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'info@tockicanai.hr');
  assert.match(mails[0].subject, /50\. trening/);
  assert.match(mails[0].body, /Test Klijent 1/);
  assert.equal(sendMilestoneNotes(store, dayBefore).length, 0);
});

test('no milestone mail for an ordinary rider or for a guest booking', () => {
  const { store, session } = setup();
  riderWithAttended(store, 10);
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const dayBefore = new Date(Date.parse(session.startsAt) - 23 * HOUR);
  assert.equal(sendMilestoneNotes(store, dayBefore).length, 0);

  const other = setup();
  riderWithAttended(other.store, 49);
  bookBike(other.store, { classId: other.session.id, bikeNo: 4, accountId: 'acc_test1', guestName: 'Ana', now: NOW });
  assert.equal(sendMilestoneNotes(other.store, dayBefore).length, 0);
});
