import { test } from 'node:test';
import assert from 'node:assert/strict';
import rss from '../lib/rss.cjs';

const { decode, relTime, parse } = rss;

test('decode strips CDATA and tags, then unescapes entities', () => {
  assert.equal(decode('<![CDATA[Hello <b>world</b>]]>'), 'Hello world');
  assert.equal(decode('A &amp; B &#8217;s'), "A & B ’s");
});

test('decode does not double-decode &amp;lt; into a real tag', () => {
  // "&amp;lt;script&amp;gt;" is the TEXT "&lt;script&gt;" — decoding must
  // yield that literal text, not "<script>".
  assert.equal(decode('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
});

test('decoded output may contain literal HTML — callers must use textContent', () => {
  // A title legitimately containing an entity-encoded tag becomes literal
  // "<img …>" text. Safe with textContent, dangerous with innerHTML.
  const out = decode('Best &lt;img src=x onerror=alert(1)&gt; stocks');
  assert.equal(out, 'Best <img src=x onerror=alert(1)> stocks');
});

test('relTime buckets minutes/hours/days', () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  assert.equal(relTime('2026-07-16T11:30:00Z', now), '30m ago');
  assert.equal(relTime('2026-07-16T07:00:00Z', now), '5h ago');
  assert.equal(relTime('2026-07-13T12:00:00Z', now), '3d ago');
  assert.equal(relTime('garbage', now), '');
});

test('parse extracts items and trims the trailing "- Source"', () => {
  const xml = `<rss><channel>
    <item><title>NVIDIA hits record high - Reuters</title><link>https://example.com/a</link>
      <pubDate>Wed, 15 Jul 2026 12:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
    <item><title><![CDATA[AI chips &amp; the grid]]></title><link>https://example.com/b</link><source>AP</source></item>
  </channel></rss>`;
  const items = parse(xml, { now: Date.parse('2026-07-16T12:00:00Z') });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'NVIDIA hits record high');
  assert.equal(items[0].source, 'Reuters');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].time, '1d ago');
  assert.equal(items[1].title, 'AI chips & the grid');
});

test('parse respects the limit and bad input', () => {
  const xml = Array(40).fill('<item><title>t - S</title></item>').join('');
  assert.equal(parse(xml).length, 30);
  assert.deepEqual(parse(null), []);
});
