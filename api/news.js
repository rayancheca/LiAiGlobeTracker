// /api/news — global AI-market news, fetched from Google News RSS server-side
// (no CORS, no flaky third-party relay). Parsed to clean JSON, edge-cached 5 min.
//
// Response: { ok, updated, items: [{title, source, url, time}] }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FEED =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent('artificial intelligence stocks OR AI chip OR AI company earnings') +
  '&hl=en-US&gl=US&ceid=US:en';

const MEM_TTL = 5 * 60 * 1000;
let CACHE = { ts: 0, items: [] };

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

function grab(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function relTime(pub) {
  const t = Date.parse(pub);
  if (!t) return '';
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function parse(xml) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks) {
    const body = b.split('</item>')[0];
    let title = decode(grab(body, 'title'));
    const source = decode(grab(body, 'source')) || 'News';
    // Google News titles end with " - Source"; trim it for a cleaner card.
    title = title.replace(/\s+-\s+[^-]+$/, '').trim() || title;
    items.push({
      title,
      source,
      url: decode(grab(body, 'link')),
      time: relTime(grab(body, 'pubDate')),
    });
    if (items.length >= 30) break;
  }
  return items;
}

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
