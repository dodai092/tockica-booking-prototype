import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import {
  grantPack,
  spendCredit,
  returnCredit,
  balance,
  NoCreditError,
} from '../src/ledger.js';

const NOW = new Date('2026-11-05T08:00:00Z');

function lot(store, overrides) {
  const created = {
    id: `lot_${store.lots.length + 1}`,
    accountId: 'acc_test1',
    packId: 'pk_5',
    expiresAt: '2026-11-20T00:00:00.000Z',
    remaining: 1,
    origin: 'purchase',
    ...overrides,
  };
  store.lots.push(created);
  return created;
}

test('spends the lot that expires first', () => {
  const store = createStore(NOW);
  lot(store, { id: 'late', expiresAt: '2026-11-20T00:00:00.000Z', remaining: 2 });
  lot(store, { id: 'early', expiresAt: '2026-11-10T00:00:00.000Z', remaining: 2 });

  const spent = spendCredit(store, 'acc_test1', NOW);

  assert.equal(spent.id, 'early');
  assert.equal(store.lots.find((l) => l.id === 'early').remaining, 1);
  assert.equal(store.lots.find((l) => l.id === 'late').remaining, 2);
});

test('expired lots are skipped', () => {
  const store = createStore(NOW);
  lot(store, { id: 'expired', expiresAt: '2026-11-04T00:00:00.000Z', remaining: 3 });
  lot(store, { id: 'valid', expiresAt: '2026-11-30T00:00:00.000Z', remaining: 1 });

  assert.equal(spendCredit(store, 'acc_test1', NOW).id, 'valid');
});

test('last credit cannot be spent twice', () => {
  const store = createStore(NOW);
  lot(store, { remaining: 1 });

  spendCredit(store, 'acc_test1', NOW);

  assert.throws(() => spendCredit(store, 'acc_test1', NOW), NoCreditError);
});

test('spending ignores other accounts lots', () => {
  const store = createStore(NOW);
  lot(store, { accountId: 'acc_test2', remaining: 1 });

  assert.throws(() => spendCredit(store, 'acc_test1', NOW), NoCreditError);
});

test('each spend appends one entry to spentLog', () => {
  const store = createStore(NOW);
  lot(store, { id: 'l1', remaining: 2 });

  spendCredit(store, 'acc_test1', NOW);
  spendCredit(store, 'acc_test1', NOW);

  assert.equal(store.spentLog.length, 2);
  assert.equal(store.spentLog[0].accountId, 'acc_test1');
  assert.equal(store.spentLog[0].lotId, 'l1');
});

test('returned credit keeps later expiry when return plus 7 days is later', () => {
  const store = createStore(NOW);
  const original = lot(store, { expiresAt: '2026-11-10T00:00:00.000Z', remaining: 0 });

  const returned = returnCredit(store, original, new Date('2026-11-05T00:00:00.000Z'), 7);

  assert.equal(returned.expiresAt, '2026-11-12T00:00:00.000Z');
  assert.equal(returned.origin, 'returned');
  assert.equal(returned.remaining, 1);
  assert.equal(returned.accountId, 'acc_test1');
});

test('returned credit keeps original expiry when that is later', () => {
  const store = createStore(NOW);
  const original = lot(store, { expiresAt: '2026-12-01T00:00:00.000Z', remaining: 0 });

  const returned = returnCredit(store, original, new Date('2026-11-05T00:00:00.000Z'), 7);

  assert.equal(returned.expiresAt, '2026-12-01T00:00:00.000Z');
});

test('grantPack expires after the pack validity', () => {
  const store = createStore(NOW);
  const granted = grantPack(store, 'acc_test1', 'pk_1', NOW);

  assert.equal(granted.remaining, 1);
  assert.equal(granted.expiresAt, '2026-12-05T08:00:00.000Z');
  assert.equal(granted.origin, 'purchase');
});

test('balance counts only unexpired remaining credits', () => {
  const store = createStore(NOW);
  lot(store, { remaining: 2, expiresAt: '2026-11-30T00:00:00.000Z' });
  lot(store, { remaining: 5, expiresAt: '2026-11-01T00:00:00.000Z' });
  lot(store, { remaining: 1, accountId: 'acc_test2', expiresAt: '2026-11-30T00:00:00.000Z' });

  assert.equal(balance(store, 'acc_test1', NOW), 2);
});
