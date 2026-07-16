import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);

// The import map is the only inline script; the CSP allows it by SHA-256 hash.
// If either side drifts (even a whitespace change), production would silently
// lose the 3D globe — this test turns that into a red build instead.
test('CSP hash in vercel.json matches the inline import map in index.html', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const cfg = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));

  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, 'expected exactly one inline <script> (the import map)');
  assert.match(inline[0][1], /type="importmap"/);

  const hash = createHash('sha256').update(inline[0][2]).digest('base64');
  const csp = cfg.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key === 'Content-Security-Policy')?.value;
  assert.ok(csp, 'vercel.json must ship a Content-Security-Policy header');
  assert.ok(
    csp.includes(`'sha256-${hash}'`),
    `CSP is missing the current import-map hash 'sha256-${hash}' — update vercel.json`
  );
});

test('dataset is well-formed', async () => {
  const src = await readFile(new URL('data.js', root), 'utf8');
  const countries = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
  assert.equal(countries.length, 18);
  for (const c of countries) {
    assert.ok(c.id && c.name && c.code && Number.isFinite(c.lat) && Number.isFinite(c.lon), c.id);
    assert.equal(c.companies.length, 10, `${c.name} should track 10 companies`);
    for (const co of c.companies) assert.ok(co.n && co.s, `${c.name}: ${JSON.stringify(co)}`);
  }
});
