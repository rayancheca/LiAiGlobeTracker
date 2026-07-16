// /api/quotes  — reliable Yahoo Finance quote proxy (the "helper")
//
// Why this exists: the browser can't call Yahoo directly (CORS), and the old
// app leaned on free public proxies that constantly failed -> it silently fell
// back to a fake "simulation". This runs server-side, handles Yahoo's
// cookie+crumb auth, batches symbols, and is cached at the CDN edge so we never
// hammer Yahoo. Returns real price / % change / market cap / market state.
//
// Response: { ok, updated, stale, quotes: { SYM: {price, changePct, cap, state, cur, name} } }

const { shape, pick, parseSymbols } = require('../lib/yahoo.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CHUNK = 50;          // symbols per Yahoo request
const CREDS_TTL = 60 * 60 * 1000;   // refresh cookie+crumb hourly
const MEM_TTL = 40 * 1000;          // in-process cache window

// module-scope caches (survive warm invocations)
let CREDS = { cookie: '', crumb: '', ts: 0 };
let CACHE = { ts: 0, quotes: {} };

function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function ensureCreds(force) {
  const now = Date.now();
  if (!force && CREDS.crumb && now - CREDS.ts < CREDS_TTL) return CREDS;

  let cookie = '';
  for (const url of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/']) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      const jar = getSetCookies(r).map((c) => c.split(';')[0]).filter(Boolean);
      if (jar.length) { cookie = jar.join('; '); break; }
    } catch (_) { /* try next */ }
  }

  const cr = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!crumb || crumb.length > 32) throw new Error('bad crumb');

  CREDS = { cookie, crumb, ts: now };
  return CREDS;
}

async function fetchChunk(symbols, creds) {
  const url =
    'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' +
    encodeURIComponent(symbols.join(',')) +
    '&crumb=' + encodeURIComponent(creds.crumb);
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: creds.cookie } });
  if (r.status === 401 || r.status === 403) { const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  return (j.quoteResponse && j.quoteResponse.result) || [];
}

async function fetchQuotes(symbols) {
  let creds = await ensureCreds(false);
  const out = {};
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    let results;
    try {
      results = await fetchChunk(chunk, creds);
    } catch (e) {
      if (e.auth) { creds = await ensureCreds(true); results = await fetchChunk(chunk, creds); }
      else throw e;
    }
    for (const q of results) if (q && q.symbol) out[q.symbol] = shape(q);
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Edge-cache: everyone shares one fetch for ~45s; serve stale while refreshing.
  res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');

  const symbols = parseSymbols(req.query && req.query.symbols);
  if (!symbols.length) { res.status(400).json({ ok: false, error: 'no symbols' }); return; }

  const now = Date.now();
  if (now - CACHE.ts < MEM_TTL && symbols.every((s) => CACHE.quotes[s])) {
    res.status(200).json({ ok: true, updated: CACHE.ts, stale: false, quotes: pick(CACHE.quotes, symbols) });
    return;
  }

  try {
    const quotes = await fetchQuotes(symbols);
    if (Object.keys(quotes).length) {
      CACHE = { ts: now, quotes: { ...CACHE.quotes, ...quotes } };
      res.status(200).json({ ok: true, updated: now, stale: false, quotes });
      return;
    }
    throw new Error('empty');
  } catch (err) {
    // Best-effort: hand back the last good snapshot rather than nothing.
    const have = pick(CACHE.quotes, symbols);
    if (Object.keys(have).length) {
      res.status(200).json({ ok: true, updated: CACHE.ts, stale: true, quotes: have });
    } else {
      res.status(200).json({ ok: false, stale: true, error: String(err && err.message || err), quotes: {} });
    }
  }
};
