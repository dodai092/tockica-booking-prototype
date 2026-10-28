import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import {
  taughtBy,
  rateOn,
  monthReport,
  setActualInstructor,
  setInstructorRate,
  setBonusSettings,
  setPaid,
  paidEntry,
  summaryText,
  PayrollError,
} from '../src/payroll.js';

const NOW = new Date('2026-12-20T12:00:00Z');

function setup() {
  const store = createStore(NOW);
  store.instructors = [
    { id: 'ins_1', name: 'Mirna', rates: [{ from: '2026-01-01', eur: 20 }] },
    { id: 'ins_2', name: 'Tanja', rates: [{ from: '2026-01-01', eur: 25 }] },
  ];
  let n = 0;
  const addClass = (startsAt, instructorId, extra = {}) => {
    n += 1;
    const session = { id: `c${n}`, name: `Spin ${n}`, instructorId, startsAt, durationMin: 60, bikeCount: 20, ...extra };
    store.classes.push(session);
    return session;
  };
  let b = 0;
  const fill = (classId, count, status = 'attended', guestName = null) => {
    for (let i = 0; i < count; i += 1) {
      b += 1;
      store.bookings.push({ id: `b${b}`, classId, bikeNo: b, accountId: 'acc_test1', guestName, status, creditLotId: null, createdAt: NOW.toISOString() });
    }
  };
  return { store, addClass, fill };
}

const row = (report, id) => report.rows.find((r) => r.instructorId === id);

test('a class belongs to the month of its studio date, so 30 Nov 23:30 UTC is December', () => {
  const { store, addClass } = setup();
  addClass('2026-11-30T12:00:00.000Z', 'ins_1');
  addClass('2026-11-30T23:30:00.000Z', 'ins_1');
  assert.equal(row(monthReport(store, '2026-11', NOW), 'ins_1').taught, 1);
  assert.equal(row(monthReport(store, '2026-12', NOW), 'ins_1').taught, 1);
});

test('a substitute is paid their own rate and the scheduled instructor shows as substituted out', () => {
  const { store, addClass } = setup();
  const session = addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  addClass('2026-12-03T17:00:00.000Z', 'ins_1');
  setActualInstructor(store, session.id, 'ins_2');
  const report = monthReport(store, '2026-12', NOW);
  assert.equal(taughtBy(session), 'ins_2');
  assert.deepEqual([row(report, 'ins_1').taught, row(report, 'ins_1').substitutedOut, row(report, 'ins_1').fee], [1, 1, 20]);
  assert.deepEqual([row(report, 'ins_2').taught, row(report, 'ins_2').substitutedIn, row(report, 'ins_2').fee], [1, 1, 25]);
});

test('setting the scheduled instructor back clears the substitution; an unknown one is refused', () => {
  const { store, addClass } = setup();
  const session = addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  setActualInstructor(store, session.id, 'ins_2');
  setActualInstructor(store, session.id, 'ins_1');
  assert.equal(session.actualInstructorId, undefined);
  assert.throws(() => setActualInstructor(store, session.id, 'nobody'), PayrollError);
});

test('the rate in force on the class date is used, so a raise does not rewrite earlier classes', () => {
  const { store, addClass } = setup();
  addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  addClass('2026-12-12T17:00:00.000Z', 'ins_1');
  setInstructorRate(store, 'ins_1', 30, '2026-12-10');
  assert.equal(rateOn(store.instructors[0], '2026-12-09'), 20);
  assert.equal(rateOn(store.instructors[0], '2026-12-10'), 30);
  assert.equal(row(monthReport(store, '2026-12', NOW), 'ins_1').fee, 50);
});

test('the attendance bonus pays per checked-in bike above the threshold, guests in, no-shows out', () => {
  const { store, addClass, fill } = setup();
  const session = addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  fill(session.id, 16);
  fill(session.id, 2, 'attended', 'mile');
  fill(session.id, 2, 'no_show');
  const mirna = row(monthReport(store, '2026-12', NOW), 'ins_1');
  assert.equal(mirna.riders, 18);
  assert.equal(mirna.bonus, 6);
  assert.equal(mirna.total, 26);
  setBonusSettings(store, { threshold: 10, eur: 1 });
  assert.equal(row(monthReport(store, '2026-12', NOW), 'ins_1').bonus, 8);
});

test('a cancelled class and a class still to come are not paid', () => {
  const { store, addClass } = setup();
  addClass('2026-12-02T17:00:00.000Z', 'ins_1', { cancelled: true });
  addClass('2026-12-28T17:00:00.000Z', 'ins_1');
  const mirna = row(monthReport(store, '2026-12', NOW), 'ins_1');
  assert.deepEqual([mirna.taught, mirna.cancelled, mirna.upcoming, mirna.fee], [0, 1, 1, 0]);
});

test('an instructor with no rate is paid nothing, and bad settings are refused', () => {
  const { store, addClass } = setup();
  store.instructors.push({ id: 'ins_3', name: 'Nova' });
  addClass('2026-12-02T17:00:00.000Z', 'ins_3');
  assert.equal(row(monthReport(store, '2026-12', NOW), 'ins_3').fee, 0);
  assert.throws(() => setInstructorRate(store, 'ins_1', -5, '2026-12-01'), PayrollError);
  assert.throws(() => setBonusSettings(store, { threshold: 25, eur: 2 }), PayrollError);
});

test('a finished class with bookings still marked booked needs a check-in review', () => {
  const { store, addClass, fill } = setup();
  const done = addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  fill(done.id, 3, 'attended');
  fill(done.id, 2, 'booked');
  const clean = addClass('2026-12-03T17:00:00.000Z', 'ins_1');
  fill(clean.id, 2, 'no_show');
  const future = addClass('2026-12-28T17:00:00.000Z', 'ins_1');
  fill(future.id, 4, 'booked');
  const { needsCheckIn } = monthReport(store, '2026-12', NOW);
  assert.deepEqual(needsCheckIn.map((c) => [c.classId, c.open]), [[done.id, 2]]);
});

test('a payout is remembered with its amount, and can be undone', () => {
  const { store } = setup();
  setPaid(store, '2026-12', 'ins_1', { on: true, total: 66, now: NOW });
  assert.deepEqual(paidEntry(store, '2026-12', 'ins_1'), { at: NOW.toISOString(), total: 66 });
  assert.equal(paidEntry(store, '2026-12', 'ins_2'), null);
  assert.equal(paidEntry(store, '2026-11', 'ins_1'), null);
  setPaid(store, '2026-12', 'ins_1', { on: false });
  assert.equal(paidEntry(store, '2026-12', 'ins_1'), null);
});

test('the summary text lists totals, substitutions and every class', () => {
  const { store, addClass, fill } = setup();
  const a = addClass('2026-12-02T17:00:00.000Z', 'ins_1');
  fill(a.id, 17);
  const b = addClass('2026-12-03T17:00:00.000Z', 'ins_2');
  setActualInstructor(store, b.id, 'ins_1');
  const report = monthReport(store, '2026-12', NOW);
  const text = summaryText(report, row(report, 'ins_1'), 'Prosinac 2026', (id) => store.instructors.find((i) => i.id === id).name);
  assert.match(text, /^Prosinac 2026: Mirna/);
  assert.match(text, /Održano treninga: 2/);
  assert.match(text, /preuzeto: 1/);
  assert.match(text, /Bonus: 4,00/);
  assert.match(text, /Ukupno: 44,00/);
  assert.match(text, /17\/20 došlo/);
  assert.match(text, /zamjena za Tanja/);
});
