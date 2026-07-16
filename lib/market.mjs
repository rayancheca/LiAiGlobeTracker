// lib/market.js — pure market math + formatting shared by the UI.
// No DOM, no three.js: everything here is unit-testable under `node --test`.

// Approx FX -> USD, used ONLY to weight market caps consistently. Not for display.
export const FX = {
  USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0067, TWD: 0.031, KRW: 0.00073, HKD: 0.128,
  CNY: 0.14, INR: 0.012, CAD: 0.73, BRL: 0.18, SEK: 0.095, SGD: 0.74, CHF: 1.12,
  AUD: 0.66, ILS: 0.27,
};

export const UP = '#22c55e', DOWN = '#ef4444', FLAT = '#64748b';

const FLAT_BAND = 0.05; // ±% treated as "flat"

export const trendColor = (t) =>
  t == null ? FLAT : t > FLAT_BAND ? UP : t < -FLAT_BAND ? DOWN : FLAT;

export function fmtPct(p) {
  if (p == null) return '—';
  return (p > 0 ? '+' : '') + p.toFixed(2) + '%';
}

export function capUsd(cap, cur) {
  if (!cap) return null;
  return cap * (FX[cur] || 1);
}

export function fmtCap(cap, cur) {
  const usd = capUsd(cap, cur);
  if (!usd) return '—';
  if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
  if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(1) + 'B';
  if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(0) + 'M';
  return '$' + usd.toFixed(0);
}

export function fmtPrice(p, cur) {
  if (p == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur || 'USD',
      maximumFractionDigits: p >= 1000 ? 0 : 2,
    }).format(p);
  } catch {
    return p.toFixed(2);
  }
}

// Cap-weighted country trend + open/closed state, using live quotes when present
// and falling back to the seed values embedded in the dataset.
export function computeCountry(country, quotes) {
  let wSum = 0, tSum = 0, haveLive = false, open = false, withData = 0;
  const rows = country.companies.map((co) => {
    const q = quotes[co.s];
    const price = q?.price ?? co.p;
    const chg = q?.changePct ?? co.ch;
    const cap = q?.cap ?? null;
    const cur = q?.cur ?? 'USD';
    if (q) { haveLive = true; withData++; if (q.state === 'REGULAR') open = true; }
    if (chg != null) {
      const weight = capUsd(cap, cur) || 1; // equal weight when no cap is known
      wSum += weight;
      tSum += weight * chg;
    }
    return { name: co.n, symbol: co.s, price, chg, cap, cur, state: q?.state || null };
  });
  rows.sort((a, b) => (capUsd(b.cap, b.cur) || 0) - (capUsd(a.cap, a.cur) || 0));
  const trend = wSum ? tSum / wSum : null;
  return { trend, open, haveLive, withData, rows };
}

// Global cap-weighted index + breadth across every computed country state.
export function computeWorld(states) {
  let bull = 0, bear = 0, openCount = 0, wSum = 0, tSum = 0;
  for (const s of states) {
    if (s.trend != null) (s.trend >= 0 ? bull++ : bear++);
    if (s.open) openCount++;
    for (const row of s.rows) {
      if (row.chg == null) continue;
      const w = capUsd(row.cap, row.cur) || 1;
      wSum += w;
      tSum += w * row.chg;
    }
  }
  return { world: wSum ? tSum / wSum : null, bull, bear, openCount };
}

// Equirectangular lat/lon -> unit-sphere XYZ matching three.js SphereGeometry UVs.
export function latLonToXYZ(lat, lon, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return {
    x: -r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

// Subsolar point (lat/lon where the sun is overhead) for a given date.
// Approximation: solar declination cosine model + hour angle, no equation of
// time (max error ~4°, invisible at globe scale). Drives the day/night shader.
export function subsolarPoint(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const lat = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365.24);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (12 - hours) * 15;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat, lon };
}
