import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginRole, tabsFor, canOpen } from '../src/roles.js';

test('demo logins map to customer, reception or owner', () => {
  assert.equal(loginRole('acc_test1'), 'customer');
  assert.equal(loginRole('acc_test2'), 'customer');
  assert.equal(loginRole('reception'), 'reception');
  assert.equal(loginRole('owner'), 'owner');
});

test('a trainer login maps to the trainer role and sees only the Sculpt Room', () => {
  assert.equal(loginRole('tr_1'), 'trainer');
  assert.deepEqual(tabsFor('trainer'), ['sculpt']);
  assert.equal(canOpen('trainer', 'raspored'), false);
  assert.equal(canOpen('customer', 'sculpt'), false);
  assert.equal(canOpen('owner', 'sculpt'), false);
});

test('a customer sees only the schedule and their own account page', () => {
  assert.deepEqual(tabsFor('customer'), ['raspored', 'racun']);
});

test('reception sees the schedule and Recepcija, never reports or admin', () => {
  assert.deepEqual(tabsFor('reception'), ['raspored', 'recepcija']);
});

test('the owner sees every page', () => {
  assert.deepEqual(tabsFor('owner'), ['raspored', 'racun', 'recepcija', 'izvjestaji', 'admin']);
});

test('canOpen refuses a staff page for a customer and an unknown page for everyone', () => {
  assert.equal(canOpen('customer', 'admin'), false);
  assert.equal(canOpen('customer', 'recepcija'), false);
  assert.equal(canOpen('reception', 'izvjestaji'), false);
  assert.equal(canOpen('owner', 'admin'), true);
  assert.equal(canOpen('owner', 'nope'), false);
});
