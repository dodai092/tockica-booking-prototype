import { newId } from './model.js';
import { returnCredit, returnedExpiresAt, creditsEnabled } from './ledger.js';
import { onBikeFreed, takenBikes, BikeTakenError, BikeOutOfRangeError } from './booking.js';
import { send } from './outbox.js';
import { studioTime, hrDate } from './time.js';

const timeFormat = hrDate({ hour: '2-digit', minute: '2-digit' });
const dateFormat = hrDate({ weekday: 'long', day: 'numeric', month: 'numeric' });

export class RestoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RestoreError';
  }
}

// Credits spent and not yet given back: spends, minus cancel returns, minus owner restores.
function outstanding(store, accountId) {
  const spent = store.spentLog.filter((e) => e.accountId === accountId).length;
  const returned = store.lots.filter((l) => l.accountId === accountId && l.origin === 'returned').length;
  const restored = store.restoredLog
    .filter((e) => e.accountId === accountId)
    .reduce((sum, e) => sum + e.count, 0);
  return spent - returned - restored;
}

export function restoreCredit(store, { accountId, count, reason, now }) {
  if (!Number.isInteger(count) || count < 1 || count > outstanding(store, accountId)) {
    throw new RestoreError(`Cannot restore ${count} credit(s) for ${accountId}`);
  }

  const lastSpend = store.spentLog.filter((e) => e.accountId === accountId).at(-1);
  const basis = store.lots.find((l) => l.id === lastSpend.lotId);
  const restored = {
    id: newId('lot'),
    accountId,
    packId: basis.packId,
    expiresAt: returnedExpiresAt(basis, now, store.settings.returnedCreditDays),
    remaining: count,
    origin: 'restore',
  };
  store.lots.push(restored);
  store.restoredLog.push({ accountId, count, reason, at: now.toISOString() });
  return restored;
}

// Owner removes someone from a class. The 6 hour rule does not apply.
export function removeFromClass(store, { bookingId, reason, now }) {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (booking.status !== 'booked') throw new Error(`Booking ${bookingId} is ${booking.status}`);
  const session = store.classes.find((c) => c.id === booking.classId);
  const account = store.accounts.find((a) => a.id === booking.accountId);

  booking.status = 'cancelled';
  booking.removedReason = reason;
  if (booking.creditLotId) {
    const lot = store.lots.find((l) => l.id === booking.creditLotId);
    returnCredit(store, lot, now, store.settings.returnedCreditDays);
  }

  send(
    store,
    {
      to: account.email,
      subject: `Uklonjen si s treninga: ${session.name}`,
      body: `Uklonjen si s treninga ${session.name}. Razlog: ${reason}.${creditsEnabled(store) ? ' Kredit je vraćen.' : ''}`,
    },
    now,
  );
  onBikeFreed(store, booking.classId, now);
  return booking;
}

// The owner changes one class in one week. Riders who booked it are told once. The template is not touched.
// Capacity is 1 to 20 (the room map has 20 bikes) and cannot drop below a bike that is already booked.
export function editClass(store, { classId, name, time, instructorId, themeName, bikeCount, now }) {
  if (!name.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError('Class edit out of range');
  const session = store.classes.find((c) => c.id === classId);
  if (session.cancelled) throw new Error(`Class ${classId} is cancelled`);
  const capacity = bikeCount ?? session.bikeCount;
  const highestBooked = Math.max(0, ...takenBikes(store, classId));
  if (!isInt(capacity, 1, 20) || capacity < highestBooked) throw new RangeError(`Broj bicikala mora biti od ${Math.max(1, highestBooked)} do 20.`);

  const day = studioTime.localDate(session.startsAt);
  const startsAt = studioTime.toUtc(`${day}T${time}`);
  const changed = session.name !== name.trim() || session.startsAt !== startsAt || session.instructorId !== instructorId;
  const raised = capacity > session.bikeCount;
  Object.assign(session, { name: name.trim(), startsAt, instructorId, themeName: themeName || null, bikeCount: capacity });
  if (raised) onBikeFreed(store, classId, now);
  if (!changed) return session;

  const riders = new Set(store.bookings.filter((b) => b.classId === classId && b.status === 'booked').map((b) => b.accountId));
  for (const accountId of riders) {
    const account = store.accounts.find((a) => a.id === accountId);
    send(
      store,
      {
        to: account.email,
        subject: `Promjena treninga: ${session.name}`,
        body: `Tvoj trening je promijenjen: ${session.name}, ${dateFormat.format(new Date(startsAt))} u ${timeFormat.format(new Date(startsAt))}. Rezervacija ostaje. Ako ti novi termin ne odgovara, javi nam se.`,
      },
      now,
    );
  }
  return session;
}

// Staff move a rider to another bike in the same class. The booking, its credit and the 6 hour rule are untouched.
// The class stays as full as before, so the waitlist is not mailed.
export function moveBooking(store, { bookingId, toBikeNo, now }) {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (booking.status !== 'booked') throw new Error(`Booking ${bookingId} is ${booking.status}`);
  const session = store.classes.find((c) => c.id === booking.classId);
  if (!Number.isInteger(toBikeNo) || toBikeNo < 1 || toBikeNo > session.bikeCount) throw new BikeOutOfRangeError(toBikeNo);
  if (takenBikes(store, booking.classId).includes(toBikeNo)) throw new BikeTakenError(toBikeNo);

  const from = booking.bikeNo;
  booking.bikeNo = toBikeNo;
  const account = store.accounts.find((a) => a.id === booking.accountId);
  send(
    store,
    {
      to: account.email,
      subject: `Novi bicikl na treningu: ${session.name}`,
      body: `Tvoj bicikl na treningu ${session.name} je promijenjen s ${from} na ${toBikeNo}.`,
    },
    now,
  );
  return booking;
}

export function setMultisportTag(store, accountId, on) {
  const account = store.accounts.find((a) => a.id === accountId);
  account.multisportTag = on;
  return account;
}

export function setPackPrices(store, packId, { priceEur, multisportPriceEur }) {
  const pack = store.packs.find((p) => p.id === packId);
  pack.priceEur = priceEur;
  pack.multisportPriceEur = multisportPriceEur;
  return pack;
}

// Multisport price only when the account carries the tag and the pack has one.
export function priceFor(store, accountId, packId) {
  const account = store.accounts.find((a) => a.id === accountId);
  const pack = store.packs.find((p) => p.id === packId);
  if (account.multisportTag && pack.multisportPriceEur !== null) return pack.multisportPriceEur;
  return pack.priceEur;
}

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// When bookings open: weekday (1 = Monday), hour, and how many weeks ahead. Classes already
// created keep the release they were created with.
export function setReleaseSettings(store, { dayOfWeek, hour, weeksAhead }) {
  if (!isInt(dayOfWeek, 1, 7) || !isInt(hour, 0, 23) || !isInt(weeksAhead, 1, 8)) {
    throw new RangeError('Release settings out of range');
  }
  Object.assign(store.settings, { dayOfWeek, hour, weeksAhead });
  return store.settings;
}

export function addTemplateEntry(store, { dayOfWeek, time, name, instructorId, themeName = null }) {
  if (!isInt(dayOfWeek, 1, 7) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !name.trim()) {
    throw new RangeError('Template entry out of range');
  }
  const entry = { dayOfWeek, time, name: name.trim(), instructorId, themeName };
  store.template.push(entry);
  return entry;
}

export function removeTemplateEntry(store, index) {
  return store.template.splice(index, 1)[0];
}

// The studio cancels a class: everyone booked gets the credit back and one mail.
export function cancelClass(store, classId, now) {
  const session = store.classes.find((c) => c.id === classId);
  if (session.cancelled) throw new Error(`Class ${classId} is already cancelled`);
  session.cancelled = true;

  const booked = store.bookings.filter((b) => b.classId === classId && b.status === 'booked');
  for (const booking of booked) {
    booking.status = 'cancelled';
    const lot = store.lots.find((l) => l.id === booking.creditLotId);
    if (lot) returnCredit(store, lot, now, store.settings.returnedCreditDays);
    const account = store.accounts.find((a) => a.id === booking.accountId);
    send(
      store,
      {
        to: account.email,
        subject: `Trening je otkazan: ${session.name}`,
        body: `Trening ${session.name} je otkazan.${creditsEnabled(store) ? ' Kredit je vraćen.' : ''}`,
      },
      now,
    );
  }
  store.waitlist = store.waitlist.filter((w) => w.classId !== classId);
  return { cancelledBookings: booked.length };
}
