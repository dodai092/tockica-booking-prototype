import { newId } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class NoCreditError extends Error {
  constructor(accountId) {
    super(`No credit left for ${accountId}`);
    this.name = 'NoCreditError';
  }
}

// December runs without credits (customers pay at the studio). Q1 turns them on again.
export const creditsEnabled = (store) => store.settings.credits !== false;

function isUsable(lot, now) {
  return lot.remaining > 0 && Date.parse(lot.expiresAt) > now.getTime();
}

export function grantPack(store, accountId, packId, now) {
  const pack = store.packs.find((p) => p.id === packId);
  const granted = {
    id: newId('lot'),
    accountId,
    packId,
    expiresAt: new Date(now.getTime() + pack.validDays * DAY_MS).toISOString(),
    remaining: pack.classes,
    origin: 'purchase',
  };
  store.lots.push(granted);
  return granted;
}

export function spendCredit(store, accountId, now) {
  const lot = store.lots
    .filter((l) => l.accountId === accountId && isUsable(l, now))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || a.id.localeCompare(b.id))[0];
  if (!lot) throw new NoCreditError(accountId);

  lot.remaining -= 1;
  store.spentLog.push({ accountId, lotId: lot.id, at: now.toISOString() });
  return lot;
}

// A returned credit lasts until the later of the original expiry and return plus N days.
export function returnedExpiresAt(original, now, returnedDays) {
  const returnedUntil = now.getTime() + returnedDays * DAY_MS;
  return new Date(Math.max(Date.parse(original.expiresAt), returnedUntil)).toISOString();
}

export function returnCredit(store, original, now, returnedDays) {
  const returned = {
    id: newId('lot'),
    accountId: original.accountId,
    packId: original.packId,
    expiresAt: returnedExpiresAt(original, now, returnedDays),
    remaining: 1,
    origin: 'returned',
  };
  store.lots.push(returned);
  return returned;
}

// When the credit that runs out first expires, or null when there is none to use.
export function nextExpiry(store, accountId, now) {
  const times = store.lots
    .filter((l) => l.accountId === accountId && isUsable(l, now))
    .map((l) => Date.parse(l.expiresAt));
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

export function balance(store, accountId, now) {
  return store.lots
    .filter((l) => l.accountId === accountId && isUsable(l, now))
    .reduce((sum, l) => sum + l.remaining, 0);
}
