import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, newId } from '../src/model.js';

const NOW = new Date('2026-10-27T08:00:00Z');

test('store starts with empty bookings, waitlist and spend log', () => {
  const store = createStore(NOW);
  assert.deepEqual(store.bookings, []);
  assert.deepEqual(store.waitlist, []);
  assert.deepEqual(store.spentLog, []);
  assert.deepEqual(store.outbox, []);
});

test('default schedule settings match the spec', () => {
  const store = createStore(NOW);
  assert.deepEqual(store.settings, {
    dayOfWeek: 1,
    hour: 10,
    weeksAhead: 2,
    returnedCreditDays: 7,
  });
});

test('seed accounts have id, name, example.com email and a boolean Multisport tag', () => {
  const store = createStore(NOW);
  assert.ok(store.accounts.length >= 2);
  for (const account of store.accounts) {
    assert.ok(account.id);
    assert.ok(account.name);
    assert.match(account.email, /@example\.com$/);
    assert.equal(typeof account.multisportTag, 'boolean');
  }
});

test('seed packs cover single, five and intro packs with fixed prices', () => {
  const store = createStore(NOW);
  const names = store.packs.map((p) => p.name);
  assert.ok(names.includes('1 trening'));
  assert.ok(names.includes('5 treninga'));
  assert.ok(names.includes('Početni 3 treninga'));
  for (const pack of store.packs) {
    assert.equal(typeof pack.priceEur, 'number');
    assert.ok(pack.validDays > 0);
  }
});

test('seed template has one entry per weekday used by the studio', () => {
  const store = createStore(NOW);
  assert.ok(store.template.length > 0);
  for (const entry of store.template) {
    assert.ok(entry.dayOfWeek >= 1 && entry.dayOfWeek <= 7);
    assert.match(entry.time, /^\d{2}:\d{2}$/);
    assert.ok(entry.instructorId);
  }
});

test('each store gets its own arrays (no shared state)', () => {
  const a = createStore(NOW);
  const b = createStore(NOW);
  a.bookings.push({ id: 'x' });
  assert.deepEqual(b.bookings, []);
});

test('newId returns prefixed, unique ids', () => {
  const first = newId('bk');
  const second = newId('bk');
  assert.match(first, /^bk_/);
  assert.notEqual(first, second);
});
