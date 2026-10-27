import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/model.js';
import { studioTime } from '../src/time.js';
import {
  releaseWindowOpensAt,
  nextRelease,
  generateWeek,
  isBookable,
} from '../src/schedule.js';

const NOW = new Date('2026-10-27T08:00:00Z');
const MONDAY_30_NOV = studioTime.toUtc('2026-11-30T00:00');

test('release on Monday 10:00 after the DST change is 09:00 UTC', () => {
  const store = createStore(NOW);
  assert.equal(
    releaseWindowOpensAt(store.settings, new Date('2026-10-26T12:00:00Z')),
    '2026-10-26T09:00:00.000Z',
  );
});

test('release is 10:00 local in summer (08:00 UTC)', () => {
  const store = createStore(NOW);
  assert.equal(
    releaseWindowOpensAt(store.settings, new Date('2026-07-06T12:00:00Z')),
    '2026-07-06T08:00:00.000Z',
  );
});

test('before this week release, the previous release still applies (19 Oct is still summer time)', () => {
  const store = createStore(NOW);
  assert.equal(
    releaseWindowOpensAt(store.settings, new Date('2026-10-26T08:00:00Z')),
    '2026-10-19T08:00:00.000Z',
  );
});

test('nextRelease is the following Monday, and is strictly after now', () => {
  const store = createStore(NOW);
  assert.equal(
    nextRelease(store.settings, new Date('2026-10-26T09:00:00Z')),
    '2026-11-02T09:00:00.000Z',
  );
});

test('generated class starts at the template time in studio time', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const first = store.classes.find((c) => c.name === 'SOUL test');
  assert.equal(first.startsAt, '2026-11-30T09:00:00.000Z');
});

test('generating the same week twice creates no duplicates', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const count = store.classes.length;
  generateWeek(store, MONDAY_30_NOV);
  assert.equal(store.classes.length, count);
});

test('a class opens at the release that is at least 14 days before it starts', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const first = store.classes.find((c) => c.name === 'SOUL test');
  assert.equal(first.releaseOpensAt, '2026-11-16T09:00:00.000Z');
});

test('class is not bookable before its week opens', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  assert.equal(isBookable(session, new Date('2026-10-26T12:00:00Z')), false);
});

test('class is bookable once its release has opened and before it starts', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  assert.equal(isBookable(session, new Date('2026-11-20T12:00:00Z')), true);
});

test('class is not bookable after it starts', () => {
  const store = createStore(NOW);
  generateWeek(store, MONDAY_30_NOV);
  const session = store.classes.find((c) => c.name === 'SOUL test');
  assert.equal(isBookable(session, new Date('2026-11-30T09:00:00Z')), false);
});
