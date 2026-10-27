import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { balance } from '../src/ledger.js';
import { purchasePack, AlreadyPurchasedError } from '../src/purchase.js';

const NOW = new Date('2026-11-05T08:00:00Z');

test('buying a pack adds its classes and reports the price paid', () => {
  const store = createStore(NOW);
  const { lot, priceEur } = purchasePack(store, 'acc_test1', 'pk_5', NOW);

  assert.equal(priceEur, 65);
  assert.equal(lot.origin, 'purchase');
  assert.equal(balance(store, 'acc_test1', NOW), 5);
});

test('a Multisport account pays the Multisport price when the pack has one', () => {
  const store = createStore(NOW);
  assert.equal(purchasePack(store, 'acc_test2', 'pk_1', NOW).priceEur, 8);
  assert.equal(purchasePack(store, 'acc_test2', 'pk_5', NOW).priceEur, 65);
});

test('the beginner pack can be bought once per account', () => {
  const store = createStore(NOW);
  purchasePack(store, 'acc_test1', 'pk_start3', NOW);

  assert.throws(() => purchasePack(store, 'acc_test1', 'pk_start3', NOW), AlreadyPurchasedError);
  assert.equal(balance(store, 'acc_test1', NOW), 3);
  purchasePack(store, 'acc_test2', 'pk_start3', NOW);
});
