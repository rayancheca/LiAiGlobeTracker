// lib/yahoo.cjs — pure helpers for the /api/quotes function (unit-testable).

// Exchanges that quote PRICES in a minor unit while Yahoo reports market cap
// in the major unit (verified against live v7 responses: REL.L price 2472 GBp
// but cap £43B). Normalise so the client only ever sees major units.
const MINOR_UNIT = {
  GBp: 'GBP', // London: pence -> pounds
  GBX: 'GBP',
  ILA: 'ILS', // Tel Aviv: agorot -> shekels
  ZAc: 'ZAR', // Johannesburg: cents -> rand
};

// Shape one raw Yahoo v7 quote into the compact object the frontend consumes.
function shape(q) {
  let changePct = q.regularMarketChangePercent;
  if (typeof changePct !== 'number' && q.regularMarketPrice && q.regularMarketPreviousClose) {
    changePct = ((q.regularMarketPrice - q.regularMarketPreviousClose) / q.regularMarketPreviousClose) * 100;
  }
  let price = q.regularMarketPrice ?? null;
  let cur = q.currency || 'USD';
  const major = MINOR_UNIT[cur];
  if (major) {
    if (price != null) price = price / 100;
    cur = major;
  }
  return {
    price,
    changePct: typeof changePct === 'number' ? +changePct.toFixed(2) : null,
    cap: q.marketCap ?? null, // already major-unit (see MINOR_UNIT note)
    state: q.marketState || 'CLOSED', // REGULAR = open
    cur,
    name: q.shortName || q.longName || q.symbol,
  };
}

// Subset of a quote map for the requested symbols.
function pick(map, keys) {
  const o = {};
  for (const k of keys) if (map[k]) o[k] = map[k];
  return o;
}

// Parse + bound the ?symbols= query string.
function parseSymbols(raw, max = 300) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

module.exports = { shape, pick, parseSymbols, MINOR_UNIT };
