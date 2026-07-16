// lib/rss.cjs — pure Google News RSS parsing for /api/news (unit-testable).
//
// Security note: decode() intentionally UNESCAPES entities after stripping
// tags, so its output is plain text that may contain literal "<" or "&".
// The frontend must therefore render these fields with textContent, never
// innerHTML (see renderNews in app.js).

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .trim();
}

function grab(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function relTime(pub, now = Date.now()) {
  const t = Date.parse(pub);
  if (!t) return '';
  const mins = Math.max(1, Math.round((now - t) / 60000));
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function parse(xml, { limit = 30, now = Date.now() } = {}) {
  const items = [];
  const blocks = String(xml || '').split('<item>').slice(1);
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
      time: relTime(grab(body, 'pubDate'), now),
    });
    if (items.length >= limit) break;
  }
  return items;
}

// Country names arrive via ?q= — allow letters (any script), spaces, dots,
// hyphens only, bounded length. Everything else is stripped before the value
// is embedded in the Google News query.
function sanitizeCountry(raw) {
  return String(raw || '')
    .replace(/[^\p{L} .\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

const GLOBAL_QUERY = 'artificial intelligence stocks OR AI chip OR AI company earnings';

// Country feed template. Chosen empirically (2026-07-16) over two alternates:
// the QUOTED country name anchors relevance (beats name-collisions like
// "Israel Englander" and generic wire reprints), and "AI market OR technology
// earnings" keeps results market-themed across all tested countries.
function newsQuery(country) {
  return country ? `"${country}" AI market OR technology earnings` : GLOBAL_QUERY;
}

function feedUrl(country) {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(newsQuery(country)) +
    '&hl=en-US&gl=US&ceid=US:en'
  );
}

module.exports = { decode, grab, relTime, parse, sanitizeCountry, newsQuery, feedUrl };
