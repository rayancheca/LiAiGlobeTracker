import { test } from 'node:test';
import assert from 'node:assert/strict';
import yahoo from '../lib/yahoo.cjs';

const { shape, pick, parseSymbols } = yahoo;

test('shape passes through a plain USD quote', () => {
  const s = shape({
    symbol: 'NVDA', regularMarketPrice: 208.6, regularMarketChangePercent: 1.234,
    marketCap: 5.05e12, marketState: 'REGULAR', currency: 'USD', shortName: 'NVIDIA',
  });
  assert.deepEqual(s, { price: 208.6, changePct: 1.23, cap: 5.05e12, state: 'REGULAR', cur: 'USD', name: 'NVIDIA' });
});

test('shape normalises GBp pence prices to GBP but keeps cap (already GBP)', () => {
  const s = shape({
    symbol: 'REL.L', regularMarketPrice: 2472, regularMarketChangePercent: 0.4,
    marketCap: 43e9, marketState: 'REGULAR', currency: 'GBp', shortName: 'RELX',
  });
  assert.equal(s.price, 24.72);
  assert.equal(s.cur, 'GBP');
  assert.equal(s.cap, 43e9);
});

test('shape normalises ILA agorot prices to ILS', () => {
  const s = shape({ symbol: 'NICE.TA', regularMarketPrice: 30120, marketCap: 17.6e9, currency: 'ILA', regularMarketChangePercent: 0.6 });
  assert.equal(s.price, 301.2);
  assert.equal(s.cur, 'ILS');
  assert.equal(s.cap, 17.6e9);
});

test('shape derives changePct from previous close when missing', () => {
  const s = shape({ symbol: 'X', regularMarketPrice: 110, regularMarketPreviousClose: 100, currency: 'USD' });
  assert.equal(s.changePct, 10);
  assert.equal(s.state, 'CLOSED');
});

test('shape tolerates empty quotes', () => {
  const s = shape({ symbol: 'X' });
  assert.equal(s.price, null);
  assert.equal(s.changePct, null);
  assert.equal(s.cap, null);
});

test('pick returns only requested present keys', () => {
  assert.deepEqual(pick({ a: 1, b: 2 }, ['a', 'c']), { a: 1 });
});

test('parseSymbols trims, filters and bounds', () => {
  assert.deepEqual(parseSymbols(' NVDA, ,REL.L '), ['NVDA', 'REL.L']);
  assert.equal(parseSymbols(Array(400).fill('A').join(',')).length, 300);
  assert.deepEqual(parseSymbols(undefined), []);
});
