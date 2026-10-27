import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioTime } from '../src/time.js';

test('winter wall time is UTC+1 (DST ended 2026-10-25)', () => {
  assert.equal(studioTime.toUtc('2026-10-26T10:00'), '2026-10-26T09:00:00.000Z');
});

test('summer wall time is UTC+2', () => {
  assert.equal(studioTime.toUtc('2026-07-06T10:00'), '2026-07-06T08:00:00.000Z');
});

test('dayOfWeek: Monday 2026-10-26 is 1', () => {
  assert.equal(studioTime.dayOfWeek('2026-10-26T09:00:00.000Z'), 1);
});

test('dayOfWeek: Sunday 2026-11-01 is 7', () => {
  assert.equal(studioTime.dayOfWeek('2026-11-01T09:00:00.000Z'), 7);
});

test('localDate uses studio date, not UTC date (23:30 UTC is next day in Zagreb)', () => {
  assert.equal(studioTime.localDate('2026-10-25T23:30:00.000Z'), '2026-10-26');
});

test('addDays moves a studio date across a month boundary', () => {
  assert.equal(studioTime.addDays('2026-10-30', 3), '2026-11-02');
});
