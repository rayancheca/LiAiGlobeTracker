import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trendColor, fmtPct, fmtCap, fmtPrice, capUsd,
  computeCountry, computeWorld, latLonToXYZ, subsolarPoint,
  UP, DOWN, FLAT,
} from '../lib/market.mjs';

test('trendColor maps sign and flat band', () => {
  assert.equal(trendColor(1.2), UP);
  assert.equal(trendColor(-0.4), DOWN);
  assert.equal(trendColor(0.01), FLAT);
  assert.equal(trendColor(-0.05), FLAT);
  assert.equal(trendColor(null), FLAT);
});

test('fmtPct formats sign and null', () => {
  assert.equal(fmtPct(1.234), '+1.23%');
  assert.equal(fmtPct(-0.5), '-0.50%');
  assert.equal(fmtPct(null), '—');
});

test('fmtCap converts to USD tiers', () => {
  assert.equal(fmtCap(2.5e12, 'USD'), '$2.50T');
  assert.equal(fmtCap(50e9, 'GBP'), '$63.5B'); // 50B GBP * 1.27
  assert.equal(fmtCap(null, 'USD'), '—');
});

test('fmtPrice uses currency and sane precision', () => {
  assert.equal(fmtPrice(24.72, 'GBP'), '£24.72');
  assert.equal(fmtPrice(28500, 'JPY'), '¥28,500');
  assert.equal(fmtPrice(null, 'USD'), '—');
  assert.equal(fmtPrice(3.5, 'NOPE'), '3.50'); // invalid ISO code falls back
});

const country = {
  id: 'xx', name: 'Testland', code: 'XX', lat: 0, lon: 0,
  companies: [
    { n: 'BigCo', s: 'BIG', p: 10, ch: 1 },
    { n: 'SmallCo', s: 'SML', p: 5, ch: -2 },
  ],
};

test('computeCountry cap-weights live quotes', () => {
  const quotes = {
    BIG: { price: 11, changePct: 2, cap: 9e9, state: 'REGULAR', cur: 'USD' },
    SML: { price: 4, changePct: -1, cap: 1e9, state: 'CLOSED', cur: 'USD' },
  };
  const s = computeCountry(country, quotes);
  // (2*9 + -1*1) / 10 = 1.7
  assert.ok(Math.abs(s.trend - 1.7) < 1e-9);
  assert.equal(s.open, true);
  assert.equal(s.haveLive, true);
  assert.equal(s.rows[0].symbol, 'BIG'); // sorted by USD cap desc
});

test('computeCountry falls back to seeds and equal weight', () => {
  const s = computeCountry(country, {});
  // (1 + -2) / 2 = -0.5 with weight 1 each
  assert.ok(Math.abs(s.trend - -0.5) < 1e-9);
  assert.equal(s.open, false);
  assert.equal(s.haveLive, false);
});

test('computeCountry weights across currencies via FX', () => {
  const quotes = {
    BIG: { price: 1, changePct: 1, cap: 100e9, state: 'CLOSED', cur: 'USD' },
    SML: { price: 1, changePct: -1, cap: 100e9, state: 'CLOSED', cur: 'JPY' }, // ~0.67e9 USD
  };
  const s = computeCountry(country, quotes);
  assert.ok(s.trend > 0.9, `USD cap should dominate JPY cap, got ${s.trend}`);
});

test('computeWorld aggregates breadth and cap-weighted index', () => {
  const a = computeCountry(country, { BIG: { price: 1, changePct: 2, cap: 1e9, state: 'REGULAR', cur: 'USD' }, SML: { price: 1, changePct: 2, cap: 1e9, state: 'REGULAR', cur: 'USD' } });
  const b = computeCountry(country, { BIG: { price: 1, changePct: -1, cap: 1e9, state: 'CLOSED', cur: 'USD' }, SML: { price: 1, changePct: -1, cap: 1e9, state: 'CLOSED', cur: 'USD' } });
  const w = computeWorld([a, b]);
  assert.equal(w.bull, 1);
  assert.equal(w.bear, 1);
  assert.equal(w.openCount, 1);
  assert.ok(Math.abs(w.world - 0.5) < 1e-9);
});

test('latLonToXYZ puts poles and prime meridian where expected', () => {
  const north = latLonToXYZ(90, 0, 1);
  assert.ok(Math.abs(north.y - 1) < 1e-9);
  const gulf = latLonToXYZ(0, 0, 1); // lat 0, lon 0 -> +x axis side in this mapping
  assert.ok(Math.abs(gulf.y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(gulf.x, gulf.z) - 1) < 1e-9);
});

test('subsolarPoint tracks UTC noon and seasons', () => {
  const noonMarch = subsolarPoint(new Date(Date.UTC(2026, 2, 21, 12, 0, 0)));
  assert.ok(Math.abs(noonMarch.lon) < 2, `equinox noon lon ~0, got ${noonMarch.lon}`);
  assert.ok(Math.abs(noonMarch.lat) < 2, `equinox lat ~0, got ${noonMarch.lat}`);
  const juneSolstice = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 0, 0, 0)));
  assert.ok(juneSolstice.lat > 20, `june lat ~+23, got ${juneSolstice.lat}`);
  assert.ok(Math.abs(juneSolstice.lon - 180) < 5 || Math.abs(juneSolstice.lon + 180) < 5, `UTC midnight -> antimeridian, got ${juneSolstice.lon}`);
});
