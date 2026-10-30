import { upcomingBookings, cancelDeadline } from './booking.js';
import { clientRides, MILESTONES } from './analytics.js';
import { canPurchase, ONCE_PER_ACCOUNT } from './purchase.js';

// What a Customer sees on their own account page. Pure reads of the store, nothing is changed.
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 7;

const sessionOf = (store, classId) => store.classes.find((c) => c.id === classId);

// Usable credits per lot, earliest expiry first. `expiringSoon` marks lots that run out within a week.
export function creditLots(store, accountId, now) {
  return store.lots
    .filter((l) => l.accountId === accountId && l.remaining > 0 && Date.parse(l.expiresAt) > now.getTime())
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .map((l) => ({
      id: l.id,
      packName: store.packs.find((p) => p.id === l.packId)?.name ?? '',
      remaining: l.remaining,
      expiresAt: l.expiresAt,
      origin: l.origin,
      expiringSoon: Date.parse(l.expiresAt) - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS,
    }));
}

// The booking the Customer rides next, and whether cancelling it now still returns the credit.
export function nextTraining(store, accountId, now) {
  const next = upcomingBookings(store, accountId, now)[0];
  if (!next) return null;
  return { ...next, deadline: cancelDeadline(next.session), freeCancel: now < cancelDeadline(next.session) };
}

// Finished bookings (any status but Booked), newest class first.
export function pastBookings(store, accountId, limit) {
  return store.bookings
    .filter((b) => b.accountId === accountId && b.status !== 'booked')
    .map((booking) => ({ booking, session: sessionOf(store, booking.classId) }))
    .filter(({ session }) => session)
    .sort((a, b) => b.session.startsAt.localeCompare(a.session.startsAt) || a.booking.bikeNo - b.booking.bikeNo)
    .slice(0, limit);
}

// Full classes the Customer is waiting for that have not started.
export function waitlistEntries(store, accountId, now) {
  return store.waitlist
    .filter((w) => w.accountId === accountId)
    .map((entry) => ({ entry, session: sessionOf(store, entry.classId) }))
    .filter(({ session }) => session && Date.parse(session.startsAt) > now.getTime())
    .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
}

// Own rides and the stretch between the last milestone reached and the next one.
export function rideProgress(store, accountId) {
  const { rides, next, toNext } = clientRides(store).find((c) => c.accountId === accountId);
  const base = [...MILESTONES].reverse().find((m) => m <= rides) ?? 0;
  const percent = next ? Math.round(((rides - base) / (next - base)) * 100) : 100;
  return { rides, base, next, toNext, percent };
}

// The intro packs, for an account that has no pack and no rides yet.
export function introOffer(store, accountId) {
  const isNew = !store.lots.some((l) => l.accountId === accountId) && rideProgress(store, accountId).rides === 0;
  if (!isNew) return [];
  return store.packs.filter((p) => ONCE_PER_ACCOUNT.includes(p.id) && canPurchase(store, accountId, p.id));
}
