import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import { generateWeek } from '../src/schedule.js';
import { grantPack } from '../src/ledger.js';
import { bookBike, cancelBooking } from '../src/booking.js';

const NOW = new Date('2026-11-20T12:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');
const HOUR = 60 * 60 * 1000;

function setup() {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  grantPack(store, 'acc_test1', 'pk_5', NOW);
  return { store, session };
}

test('booking mails a confirmation with the bike, the free-cancel time and a cancel button', () => {
  const { store, session } = setup();

  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });

  const [mail] = store.outbox;
  assert.equal(mail.to, 'test1@example.com');
  assert.equal(mail.subject, 'Rezervirano: SOUL test');
  assert.match(mail.body, /^Bok Test,/);
  assert.match(mail.body, /SOUL test, ponedjeljak, 30\.11\. u 10:00, bicikl 4\./);
  assert.match(mail.body, /Otkazivanje je besplatno do 04:00, ponedjeljak, 30\.11\. \(6 sati prije treninga\)\./);
  assert.deepEqual(mail.action, { label: 'Otkaži rezervaciju', url: `https://rezervacije.tockicanai.hr/#racun/otkazi/${booking.id}` });
  assert.doesNotMatch(mail.body, /kredit|https?:/);
});

test('the confirmation names a guest on the bike', () => {
  const { store, session } = setup();

  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', guestName: 'Ana', now: NOW });

  assert.match(store.outbox[0].body, /bicikl 4 \(Ana\)/);
});

test('a rejected booking sends no mail', () => {
  const { store, session } = setup();
  bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  assert.throws(() => bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW }));
  assert.equal(store.outbox.length, 0);
});

test('cancelling in time mails the rider that nothing is charged', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  cancelBooking(store, booking.id, NOW);

  const [mail] = store.outbox;
  assert.equal(mail.to, 'test1@example.com');
  assert.equal(mail.subject, 'Otkazano: SOUL test');
  assert.match(mail.body, /bicikl 4\./);
  assert.match(mail.body, /bez naplate/);
  assert.equal(mail.action, undefined);
});

test('a late cancel mails that one class is charged', () => {
  const { store, session } = setup();
  const booking = bookBike(store, { classId: session.id, bikeNo: 4, accountId: 'acc_test1', now: NOW });
  store.outbox = [];

  cancelBooking(store, booking.id, new Date(Date.parse(session.startsAt) - 2 * HOUR));

  assert.match(store.outbox[0].body, /naplaćuje se jedan trening/);
  assert.doesNotMatch(store.outbox[0].body, /kredit/);
});
