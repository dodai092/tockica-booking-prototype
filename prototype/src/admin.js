import { newId } from './model.js';
import { returnCredit, returnedExpiresAt } from './ledger.js';
import { onBikeFreed } from './booking.js';
import { send } from './outbox.js';

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
      body: `Uklonjen si s treninga ${session.name}. Razlog: ${reason}. Kredit je vraćen.`,
    },
    now,
  );
  onBikeFreed(store, booking.classId, now);
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
