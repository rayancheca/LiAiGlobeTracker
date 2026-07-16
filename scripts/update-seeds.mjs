// scripts/update-seeds.mjs — refresh the seed prices embedded in data.js.
//
// The p/ch values in data.js only exist for the very first paint (and as a
// fallback if the quote API is unreachable). They drift over time; run this
// against a live instance now and then to re-anchor them to reality.
//
//   node scripts/dev.mjs &
//   node scripts/update-seeds.mjs [--base http://localhost:3000]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3000';

const file = join(root, 'data.js');
const src = await readFile(file, 'utf8');
const countries = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));

const symbols = countries.flatMap((c) => c.companies.map((x) => x.s));
const r = await fetch(`${BASE}/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
const { quotes = {} } = await r.json();

let updated = 0;
const round = (v) => (v >= 1000 ? Math.round(v) : +v.toFixed(2));
for (const c of countries) {
  for (const co of c.companies) {
    const q = quotes[co.s];
    if (!q || q.price == null || q.changePct == null) continue;
    co.p = round(q.price);
    co.ch = +q.changePct.toFixed(2);
    updated++;
  }
}

await writeFile(file, 'window.COUNTRIES = ' + JSON.stringify(countries) + ';\n');
console.log(`updated ${updated}/${symbols.length} seed quotes in data.js`);
