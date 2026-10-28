import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikePosition } from '../src/layout.js';

test('bike 1 is bottom right, bike 11 is bottom left', () => {
  assert.deepEqual(bikePosition(1), { column: 2, row: 11 });
  assert.deepEqual(bikePosition(11), { column: 1, row: 11 });
});

test('numbers climb up each column, skipping the aisle row after the fifth bike', () => {
  assert.deepEqual(bikePosition(5), { column: 2, row: 7 });
  assert.deepEqual(bikePosition(6), { column: 2, row: 5 });
  assert.deepEqual(bikePosition(10), { column: 2, row: 1 });
  assert.deepEqual(bikePosition(20), { column: 1, row: 1 });
});

test('all 20 bikes get a distinct cell', () => {
  const cells = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(bikePosition(i + 1))));
  assert.equal(cells.size, 20);
});

test('bikes stay inside the two columns, off the aisle row and clear of the instructor column', () => {
  for (let bikeNo = 1; bikeNo <= 20; bikeNo += 1) {
    const { column, row } = bikePosition(bikeNo);
    assert.ok(column === 1 || column === 2, `bike ${bikeNo} column ${column}`);
    assert.ok(row >= 1 && row <= 11 && row !== 6, `bike ${bikeNo} row ${row}`);
  }
});
