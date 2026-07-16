// /api/news — global AI-market news, fetched from Google News RSS server-side
// (no CORS, no flaky third-party relay). Parsed to clean JSON, edge-cached 5 min.
//
// Response: { ok, updated, items: [{title, source, url, time}] }

const { parse } = require('../lib/rss.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FEED =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent('artificial intelligence stocks OR AI chip OR AI company earnings') +
  '&hl=en-US&gl=US&ceid=US:en';

const MEM_TTL = 5 * 60 * 1000;
let CACHE = { ts: 0, items: [] };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const now = Date.now();
  if (now - CACHE.ts < MEM_TTL && CACHE.items.length) {
    res.status(200).json({ ok: true, updated: CACHE.ts, items: CACHE.items });
    return;
  }
  try {
    const r = await fetch(FEED, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('http ' + r.status);
    const items = parse(await r.text());
    if (items.length) CACHE = { ts: now, items };
    res.status(200).json({ ok: true, updated: CACHE.ts || now, items });
  } catch (err) {
    if (CACHE.items.length) {
      res.status(200).json({ ok: true, updated: CACHE.ts, stale: true, items: CACHE.items });
    } else {
      res.status(200).json({ ok: false, error: String((err && err.message) || err), items: [] });
    }
  }
};
