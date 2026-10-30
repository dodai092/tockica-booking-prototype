import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike, cancelBooking } from '../src/booking.js';
import { sendReminders } from '../src/reminders.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const HOUR = 60 * 60 * 1000;

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  grantPack(store, 'acc_test2', 'pk_5', NOW);
  const at = (hoursBefore) => new Date(Date.parse(session.startsAt) - hoursBefore * HOUR);
  return { store, session, at };
}

test('a class within 24 hours mails each booked rider once, with bike and free-cancel time', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  bookBike(store, { classId: session.id, bikeNo: 5, accountId: 'acc_test2', now: NOW });
  store.outbox = [];

  const mails = sendReminders(store, at(23));

  assert.deepEqual(mails.map((m) => m.to).sort(), ['test1@example.com', 'test2@example.com']);
  const mail = mails.find((m) => m.to === 'test1@example.com');
  assert.match(mail.body, /^Bok Test,/);
  assert.match(mail.body, /bicikl 4/);
  assert.match(mail.body, /Otkazivanje je besplatno do 04:00 sutra \(6 sati prije treninga\)\. Nakon toga se naplaćuje jedan trening\./);
  assert.doesNotMatch(mail.body, /kredit/);
});

test('a class more than 24 hours away is not reminded yet', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  assert.equal(sendReminders(store, at(25)).length, 0);
});

test('running the reminders again does not mail the same booking twice', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  sendReminders(store, at(23));
  sendReminders(store, at(22));

  assert.equal(store.outbox.length, 1);
});

test('cancelled bookings and classes that already started get no reminder', () => {
  const { store, session, at } = setup();
  const gone = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  cancelBooking(store, gone.id, NOW);
  store.outbox = [];

  assert.equal(sendReminders(store, at(23)).length, 0);

  bookBike(store, { classId: session.id, bikeNo: 6, accountId: 'acc_test2', now: NOW });
  assert.equal(sendReminders(store, at(-1)).length, 0);
});

test('a cancelled class sends no reminders', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  session.cancelled = true;
  store.outbox = [];

  assert.equal(sendReminders(store, at(23)).length, 0);
});

test('inside the 6 hour window the mail says free cancelling is over', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  const [mail] = sendReminders(store, at(5));

  assert.match(mail.body, /Besplatno otkazivanje je prošlo, naplaćuje se jedan trening\./);
});

test('the mail carries a cancel link for that booking', () => {
  const { store, session, at } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  const [mail] = sendReminders(store, at(23), 'https://example.test/app/');

  assert.deepEqual(mail.action, { label: 'Otkaži rezervaciju', url: `https://example.test/app/#racun/otkazi/${booking.id}` });
  assert.doesNotMatch(mail.body, /https?:/);
});

test('the subject and body say tomorrow or today, with the class time', () => {
  const { store, session } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];
  const sundayNoon = new Date(studioTime.toUtc('2026-11-29T12:00'));
  const mondayMorning = new Date(studioTime.toUtc('2026-11-30T06:00'));

  const [tomorrow] = sendReminders(store, sundayNoon);
  assert.match(tomorrow.subject, /^Sutra u \d\d:\d\d: SOUL test$/);

  store.bookings[0].reminderSentAt = null;
  const [today] = sendReminders(store, mondayMorning);
  assert.match(today.subject, /^Danas u /);
});

test('several bikes for one class make one mail per account, guests named', () => {
  const { store, session, at } = setup();
  const a = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  const b = bookBike(store, { classId: session.id, bikeNo: 5, accountId: 'acc_test1', guestName: 'Ana', now: NOW });
  store.outbox = [];

  const mails = sendReminders(store, at(23));

  assert.equal(mails.length, 1);
  assert.match(mails[0].body, /bicikli 4, 5 \(Ana\)/);
  assert.equal(a.reminderSentAt && b.reminderSentAt, at(23).toISOString());
  assert.equal(sendReminders(store, at(22)).length, 0);
});

test('one bike is named in the singular, and the weekday and date are given', () => {
  const { store, session, at } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  const [mail] = sendReminders(store, at(23));

  assert.match(mail.body, /sutra \(ponedjeljak, 30\.11\.\) u 10:00 te čeka SOUL test, bicikl 4\./);
});
