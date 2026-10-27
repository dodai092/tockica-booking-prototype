import { newId } from './model.js';
import { isBookable } from './schedule.js';
import { spendCredit, returnCredit } from './ledger.js';
import { send } from './outbox.js';

const HOUR_MS = 60 * 60 * 1000;
const CANCEL_CUTOFF_MS = 6 * HOUR_MS;

export class BikeTakenError extends Error {
  constructor(bikeNo) {
    super(`Bike ${bikeNo} is already booked`);
    this.name = 'BikeTakenError';
  }
}

export class BikeOutOfRangeError extends Error {
  constructor(bikeNo) {
    super(`Bike ${bikeNo} does not exist`);
    this.name = 'BikeOutOfRangeError';
  }
}

export class NotBookableError extends Error {
  constructor(classId) {
    super(`Class ${classId} is not bookable now`);
    this.name = 'NotBookableError';
  }
}

export class NotFullError extends Error {
  constructor(classId) {
    super(`Class ${classId} still has free bikes`);
    this.name = 'NotFullError';
  }
}

export class AlreadyBookedError extends Error {
  constructor(classId) {
    super(`Account already has a bike in class ${classId}`);
    this.name = 'AlreadyBookedError';
  }
}

export function takenBikes(store, classId) {
  return store.bookings
    .filter((b) => b.classId === classId && b.status === 'booked')
    .map((b) => b.bikeNo)
    .sort((a, b) => a - b);
}

export function bookBike(store, { classId, bikeNo, accountId, guestName = null, now }) {
  const session = store.classes.find((c) => c.id === classId);
  if (!isBookable(session, now)) throw new NotBookableError(classId);
  if (!Number.isInteger(bikeNo) || bikeNo < 1 || bikeNo > session.bikeCount) {
    throw new BikeOutOfRangeError(bikeNo);
  }
  if (takenBikes(store, classId).includes(bikeNo)) throw new BikeTakenError(bikeNo);

  // Spend last: a rejected booking must never cost a credit.
  const lot = spendCredit(store, accountId, now);
  const booking = {
    id: newId('bk'),
    classId,
    bikeNo,
    accountId,
    guestName,
    status: 'booked',
    creditLotId: lot.id,
    createdAt: now.toISOString(),
  };
  store.bookings.push(booking);
  // Getting a bike ends the wait for this class.
  store.waitlist = store.waitlist.filter((w) => !(w.classId === classId && w.accountId === accountId));
  return booking;
}

function findBooking(store, bookingId) {
  return store.bookings.find((b) => b.id === bookingId);
}

// Cancelling 6 hours or more before the class returns the credit. Later is a late cancel.
export function cancelBooking(store, bookingId, now) {
  const booking = findBooking(store, bookingId);
  if (booking.status !== 'booked') throw new Error(`Booking ${bookingId} is ${booking.status}`);
  const session = store.classes.find((c) => c.id === booking.classId);

  if (Date.parse(session.startsAt) - now.getTime() >= CANCEL_CUTOFF_MS) {
    booking.status = 'cancelled';
    const lot = store.lots.find((l) => l.id === booking.creditLotId);
    returnCredit(store, lot, now, store.settings.returnedCreditDays);
  } else {
    booking.status = 'late_cancel';
  }

  onBikeFreed(store, booking.classId, now, booking.accountId);
  return booking;
}

export function markNoShow(store, bookingId) {
  const booking = findBooking(store, bookingId);
  if (booking.status !== 'booked') throw new Error(`Booking ${bookingId} is ${booking.status}`);
  booking.status = 'no_show';
  return booking;
}

export function joinWaitlist(store, { classId, accountId, now }) {
  const session = store.classes.find((c) => c.id === classId);
  if (takenBikes(store, classId).length < session.bikeCount) throw new NotFullError(classId);
  const hasBike = store.bookings.some(
    (b) => b.classId === classId && b.accountId === accountId && b.status === 'booked',
  );
  if (hasBike) throw new AlreadyBookedError(classId);

  const existing = store.waitlist.find((w) => w.classId === classId && w.accountId === accountId);
  if (existing) return existing;

  const entry = { id: newId('wl'), classId, accountId, createdAt: now.toISOString() };
  store.waitlist.push(entry);
  return entry;
}

// Mails everyone waiting for this class, except the person who freed the bike.
// Does not hold the bike for anyone.
export function onBikeFreed(store, classId, now, exceptAccountId = null) {
  const session = store.classes.find((c) => c.id === classId);
  return store.waitlist
    .filter((w) => w.classId === classId && w.accountId !== exceptAccountId)
    .map((w) => {
      const account = store.accounts.find((a) => a.id === w.accountId);
      return send(
        store,
        {
          to: account.email,
          subject: `Oslobodilo se mjesto: ${session.name}`,
          body: `Oslobodilo se mjesto na treningu ${session.name}. Tko prvi rezervira, dobiva bajk.`,
        },
        now,
      );
    });
}
