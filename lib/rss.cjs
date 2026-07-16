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

module.exports = { decode, grab, relTime, parse };
