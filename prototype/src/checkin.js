const MIN_MS = 60 * 1000;
const OPENS_BEFORE_MS = 30 * MIN_MS;

export class CheckInClosedError extends Error {
  constructor(bookingId) {
    super(`Check-in is closed for ${bookingId}`);
    this.name = 'CheckInClosedError';
  }
}

function endOf(session) {
  return Date.parse(session.startsAt) + session.durationMin * MIN_MS;
}

export function checkInOpen(session, now) {
  const t = now.getTime();
  return t >= Date.parse(session.startsAt) - OPENS_BEFORE_MS && t < endOf(session);
}

function findBooking(store, bookingId) {
  return store.bookings.find((b) => b.id === bookingId);
}

export function checkIn(store, bookingId, now) {
  const booking = findBooking(store, bookingId);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (!checkInOpen(session, now)) throw new CheckInClosedError(bookingId);
  booking.status = 'attended';
  return booking;
}

// Once the class has ended, every booking still "booked" becomes a no-show.
// No waitlist mail here: the class is already over, so the bike has no use to anyone.
export function closeClass(store, classId, now) {
  const session = store.classes.find((c) => c.id === classId);
  if (now.getTime() < endOf(session)) throw new Error(`Class ${classId} has not ended yet`);

  const changed = store.bookings.filter((b) => b.classId === classId && b.status === 'booked');
  for (const booking of changed) booking.status = 'no_show';
  return changed;
}

// Owner correction, allowed after the class has ended.
export function correctStatus(store, bookingId, status, now) {
  const booking = findBooking(store, bookingId);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (now.getTime() < endOf(session)) throw new Error('Correction is only after the class ends');
  booking.status = status;
  return booking;
}
