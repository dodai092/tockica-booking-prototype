import { grantPack } from './ledger.js';
import { priceFor } from './admin.js';

// Packs an account may buy only once (the beginner offer).
const ONCE_PER_ACCOUNT = ['pk_start3'];

export class AlreadyPurchasedError extends Error {
  constructor(packId) {
    super(`Pack ${packId} was already bought`);
    this.name = 'AlreadyPurchasedError';
  }
}

export function canPurchase(store, accountId, packId) {
  const bought = store.lots.some((l) => l.accountId === accountId && l.packId === packId && l.origin === 'purchase');
  return !(ONCE_PER_ACCOUNT.includes(packId) && bought);
}

// Stub purchase: no payment, the pack is granted at once. Returns the lot and the price that would be charged.
export function purchasePack(store, accountId, packId, now) {
  if (!canPurchase(store, accountId, packId)) {
    throw new AlreadyPurchasedError(packId);
  }
  const priceEur = priceFor(store, accountId, packId);
  return { lot: grantPack(store, accountId, packId, now), priceEur };
}
