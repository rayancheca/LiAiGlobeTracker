// /api/news — AI-market news from Google News RSS, fetched server-side
// (no CORS, no flaky third-party relay). Parsed to clean JSON, edge-cached 5 min.
//
// ?q=<country name> scopes the feed to one market (e.g. /api/news?q=Japan);
// omit it for the global AI-market feed. Each topic is cached independently.
//
// Response: { ok, updated, topic, items: [{title, source, url, time}] }

const { parse, sanitizeCountry, feedUrl } = require('../lib/rss.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MEM_TTL = 5 * 60 * 1000;
const MAX_TOPICS = 40; // bound the in-process cache
const CACHE = new Map(); // topic -> { ts, items }

function remember(topic, items) {
  if (CACHE.size >= MAX_TOPICS && !CACHE.has(topic)) {
    let oldest = null;
    for (const [k, v] of CACHE) if (!oldest || v.ts < CACHE.get(oldest).ts) oldest = k;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(topic, { ts: Date.now(), items });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const country = sanitizeCountry(req.query && req.query.q);
  const topic = country || '_global';

  const now = Date.now();
  const hit = CACHE.get(topic);
  if (hit && now - hit.ts < MEM_TTL && hit.items.length) {
    res.status(200).json({ ok: true, updated: hit.ts, topic, items: hit.items });
    return;
  }
  try {
    const r = await fetch(feedUrl(country), { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('http ' + r.status);
    const items = parse(await r.text());
    if (items.length) remember(topic, items);
    res.status(200).json({ ok: true, updated: now, topic, items });
  } catch (err) {
    if (hit && hit.items.length) {
      res.status(200).json({ ok: true, updated: hit.ts, topic, stale: true, items: hit.items });
    } else {
      res.status(200).json({ ok: false, topic, error: String((err && err.message) || err), items: [] });
    }
  }
};
