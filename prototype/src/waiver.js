import { newId } from './model.js';

export class WaiverRequiredError extends Error {
  constructor(accountId) {
    super(`Account ${accountId} must sign the waiver before booking`);
    this.name = 'WaiverRequiredError';
  }
}

function account(store, accountId) {
  return store.accounts.find((a) => a.id === accountId);
}

// Only a first-time rider needs one, and only until it is signed. The flag is the "First time ride?" tick box.
export function needsWaiver(store, accountId) {
  return account(store, accountId)?.firstRide === true
    && !store.waivers.some((w) => w.accountId === accountId);
}

// Signed once per account. A second call returns the signature already on file.
export function signWaiver(store, { accountId, name, now }) {
  const existing = store.waivers.find((w) => w.accountId === accountId);
  if (existing) return existing;
  const waiver = {
    id: newId('wv'),
    accountId,
    bookingId: null,
    name,
    version: store.waiverText.version,
    signedAt: now.toISOString(),
  };
  store.waivers.push(waiver);
  return waiver;
}

// A first-time Guest has no account, so the signature hangs on the booking and takes the booking's guest name.
export function signGuestWaiver(store, { bookingId, now }) {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking.guestName) throw new Error(`Booking ${bookingId} has no guest`);
  const waiver = {
    id: newId('wv'),
    accountId: null,
    bookingId,
    name: booking.guestName,
    version: store.waiverText.version,
    signedAt: now.toISOString(),
  };
  store.waivers.push(waiver);
  return waiver;
}
