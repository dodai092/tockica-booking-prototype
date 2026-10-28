import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { popularSlots, popularInstructors, clientRides, clientHistory } from '../src/analytics.js';

const NOW = new Date('2026-11-20T12:00:00Z');

function setup() {
  const store = createStore(NOW);
  // 17:30 Zagreb on Mon 30 Nov and Mon 7 Dec, 10:00 Zagreb on Tue 1 Dec (all UTC+1).
  store.classes.push(
    { id: 'c1', name: 'A', instructorId: 'ins_1', startsAt: '2026-11-30T16:30:00.000Z', durationMin: 60, bikeCount: 20 },
    { id: 'c2', name: 'A', instructorId: 'ins_1', startsAt: '2026-12-07T16:30:00.000Z', durationMin: 60, bikeCount: 20 },
    { id: 'c3', name: 'B', instructorId: 'ins_2', startsAt: '2026-12-01T09:00:00.000Z', durationMin: 60, bikeCount: 20 },
  );
  let n = 0;
  const add = (classId, accountId, status, guestName = null) => {
    n += 1;
    store.bookings.push({ id: `b${n}`, classId, bikeNo: n, accountId, guestName, status, creditLotId: null, createdAt: NOW.toISOString() });
  };
  return { store, add };
}

test('popular slots group by weekday and studio time, busiest first, cancelled bookings ignored', () => {
  const { store, add } = setup();
  add('c1', 'acc_test1', 'booked');
  add('c2', 'acc_test2', 'attended');
  add('c3', 'acc_test1', 'booked');
  add('c3', 'acc_test2', 'cancelled');
  assert.deepEqual(popularSlots(store), [
    { dayOfWeek: 1, time: '17:30', count: 2 },
    { dayOfWeek: 2, time: '10:00', count: 1 },
  ]);
});

test('popular instructors count bookings per instructor, guests included', () => {
  const { store, add } = setup();
  add('c1', 'acc_test1', 'booked');
  add('c1', 'acc_test1', 'booked', 'mile');
  add('c3', 'acc_test2', 'no_show');
  assert.deepEqual(popularInstructors(store), [
    { id: 'ins_1', name: 'Instruktorica 1', count: 2 },
    { id: 'ins_2', name: 'Instruktor 2', count: 1 },
  ]);
});

test('client rides count only attended classes on the account holder, never guests', () => {
  const { store, add } = setup();
  add('c1', 'acc_test1', 'attended');
  add('c2', 'acc_test1', 'attended', 'mile');
  add('c3', 'acc_test1', 'booked');
  const [first, second] = clientRides(store);
  assert.deepEqual(first, { accountId: 'acc_test1', name: 'Test Klijent 1', rides: 1, next: 50, toNext: 49, milestone: null });
  assert.deepEqual(second, { accountId: 'acc_test2', name: 'Test Klijent 2', rides: 0, next: 50, toNext: 50, milestone: null });
});

test('next milestone moves from 50 to 100 and ends after the 100th', () => {
  const { store, add } = setup();
  for (let i = 0; i < 50; i += 1) add('c1', 'acc_test1', 'attended');
  for (let i = 0; i < 100; i += 1) add('c2', 'acc_test2', 'attended');
  const [a, b] = clientRides(store);
  assert.equal(a.rides, 50);
  assert.equal(a.milestone, 50);
  assert.equal(a.next, 100);
  assert.equal(a.toNext, 50);
  assert.equal(b.next, null);
  assert.equal(b.milestone, 100);
  assert.equal(b.toNext, 0);
});

test('client history counts own attended classes by class and instructor, with first and last visit', () => {
  const { store, add } = setup();
  add('c1', 'acc_test1', 'attended');
  add('c2', 'acc_test1', 'attended');
  add('c3', 'acc_test1', 'attended');
  add('c3', 'acc_test1', 'attended', 'mile');
  add('c1', 'acc_test1', 'booked');
  add('c1', 'acc_test2', 'attended');
  const h = clientHistory(store, 'acc_test1');
  assert.equal(h.name, 'Test Klijent 1');
  assert.equal(h.rides, 3);
  assert.equal(h.guestRides, 1);
  assert.deepEqual(h.byClass, [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
  assert.deepEqual(h.byInstructor.map((i) => [i.id, i.count]), [['ins_1', 2], ['ins_2', 1]]);
  assert.equal(h.first, '2026-11-30T16:30:00.000Z');
  assert.equal(h.last, '2026-12-07T16:30:00.000Z');
});

test('a client who has not ridden has an empty history', () => {
  const { store } = setup();
  const h = clientHistory(store, 'acc_test2');
  assert.deepEqual([h.rides, h.guestRides, h.byClass, h.first, h.last], [0, 0, [], null, null]);
});

test('popular instructors credit the instructor who actually taught', () => {
  const { store, add } = setup();
  store.classes[0].actualInstructorId = 'ins_2';
  add('c1', 'acc_test1', 'booked');
  assert.deepEqual(popularInstructors(store).map((i) => i.id), ['ins_2']);
});
