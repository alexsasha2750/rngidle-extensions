import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCompactEP, parseEP } from '../ep-format.js';

test('EP is written in the game’s short form', () => {
  assert.equal(formatCompactEP(0), '0');
  assert.equal(formatCompactEP(950), '950');
  assert.equal(formatCompactEP(1000), '1k');
  assert.equal(formatCompactEP(12_345_678), '12.3M');
  assert.equal(formatCompactEP(999_960), '1M', 'rounding up crosses into the next suffix');
  assert.equal(formatCompactEP(5e9), '5B');
  assert.equal(formatCompactEP(2.5e12), '2.5T');
  assert.equal(formatCompactEP(3e15), '3Qd');
  assert.equal(formatCompactEP(-4_200_000), '-4.2M');
  assert.equal(formatCompactEP(1.2e70), '1.2e70');
  assert.equal(formatCompactEP('x'), '—');
});

test('what the game shows can be typed back in', () => {
  assert.deepEqual(parseEP('400k').value, 400_000);
  assert.equal(parseEP('2.5M').value, 2_500_000);
  assert.equal(parseEP('1B').value, 1e9);
  assert.equal(parseEP('3e9').value, 3e9);
  assert.equal(parseEP('1,000,000').value, 1e6);
  assert.equal(parseEP(' 12.3m ').value, 12_300_000, 'suffixes are case-insensitive');
  assert.equal(parseEP('7 Qd').value, 7e15);
  assert.equal(parseEP('45').value, 45);
  for (const bad of ['', 'abc', '12 zz', '1.2.3M', '-5M', null, undefined, '12 million']) assert.equal(parseEP(bad), null, `“${bad}” is not an EP`);
});

test('the coarseness of what was typed is reported', () => {
  assert.ok(Math.abs(parseEP('12.3M').relativeStep - 0.05 / 12.3) < 1e-12, 'one decimal: ±0.05 of 12.3');
  assert.ok(Math.abs(parseEP('2M').relativeStep - 0.25) < 1e-12, 'a whole number is coarse');
  assert.equal(parseEP('0').relativeStep, 0);
  for (const value of [1, 15, 950, 12_340, 5_600_000, 8.8e9, 3.3e12]) {
    const back = parseEP(formatCompactEP(value));
    assert.ok(Math.abs(back.value - value) / value <= Math.max(back.relativeStep, 1e-9) * 1.0001 + 1e-9, `${value} → ${formatCompactEP(value)} stays within its own step`);
  }
});
