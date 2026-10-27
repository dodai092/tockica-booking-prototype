import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { send } from '../src/outbox.js';

const NOW = new Date('2026-11-20T12:00:00Z');

test('send stores the mail with sender and time', () => {
  const store = createStore(NOW);

  const mail = send(store, { to: 'test1@example.com', subject: 'Test', body: 'Tijelo' }, NOW);

  assert.equal(store.outbox.length, 1);
  assert.equal(mail.from, 'info@tockicanai.hr');
  assert.equal(mail.sentAt, NOW.toISOString());
  assert.equal(mail.to, 'test1@example.com');
});
