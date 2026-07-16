// scripts/capture.mjs — E2E golden-path check + live README screenshots.
//
// Drives the real app (dev server or a deployed URL) with Playwright:
// asserts the dashboard boots, live quotes arrive, panels populate, the
// globe interactions work — then captures the docs/screenshots walkthrough.
//
//   node scripts/dev.mjs &                      # or any deployed URL
//   npm i --no-save playwright                  # one-off, not a repo dep
//   node scripts/capture.mjs [--base http://localhost:3000]
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, 'docs/screenshots');
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:3000';
const TEXTURE_SETTLE_MS = 9000; // blue-marble + night + clouds are ~2.5 MB

const fail = (msg) => { console.error('✖ ' + msg); process.exitCode = 1; };
const ok = (msg) => console.log('✓ ' + msg);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return page;
}

// ---- desktop golden path -----------------------------------------------------
const page = await newPage({ width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });

await page.locator('.glabel h1').waitFor({ timeout: 15000 });
ok('dashboard booted');

await page.locator('#liveDot.ok').waitFor({ timeout: 90000 });
ok('live quotes arrived (green dot)');

const countries = await page.locator('.crow').count();
if (countries !== 18) fail(`expected 18 country rows, got ${countries}`); else ok('18 country rows');

await page.locator('#dRows tr').first().waitFor({ timeout: 15000 });
const holdings = await page.locator('#dRows tr').count();
if (holdings !== 10) fail(`expected 10 detail rows, got ${holdings}`); else ok('10 companies in detail panel');

await page.locator('.nrow').first().waitFor({ timeout: 45000 });
ok('news headlines loaded');

const tickerItems = await page.locator('.titem').count();
if (tickerItems < 300) fail(`ticker tape too small: ${tickerItems} items`); else ok(`ticker tape running (${tickerItems} items)`);

const coords = (await page.locator('#coords').textContent()) || '';
if (!/°[NS]/.test(coords)) fail(`coordinates readout missing, got "${coords}"`); else ok(`coordinates readout: ${coords}`);

await page.waitForTimeout(TEXTURE_SETTLE_MS); // let earth textures + clouds land
await page.screenshot({ path: join(OUT, '01-live-dashboard.jpg'), type: 'jpeg', quality: 82 });
ok('01-live-dashboard.jpg');

await page.locator('#globeWrap').screenshot({ path: join(OUT, '02-realistic-earth.jpg'), type: 'jpeg', quality: 82 });
ok('02-realistic-earth.jpg');

// fly to Japan: night side + city lights + selection ring + arcs + country news
const newsReq = page.waitForResponse((r) => r.url().includes('/api/news?q=Japan'), { timeout: 20000 }).catch(() => null);
await page.locator('.crow', { hasText: 'Japan' }).click();
await page.waitForTimeout(1800);
const dName = await page.locator('#dName').textContent();
if (dName !== 'Japan') fail(`detail panel should show Japan, got "${dName}"`); else ok('marker/list selection updates detail panel');

const nr = await newsReq;
if (!nr || !nr.ok()) fail('country-scoped news request did not fire for Japan');
else ok('news feed follows the selected country (/api/news?q=Japan)');
const tabLabel = await page.locator('#newsTabCountry').textContent();
if (tabLabel !== 'Japan') fail(`country news tab should read Japan, got "${tabLabel}"`); else ok('news tab label tracks selection');

// Global tab pins the world feed
await page.locator('#newsTabGlobal').click();
await page.waitForTimeout(800);
const globalActive = await page.locator('#newsTabGlobal.active').count();
if (!globalActive) fail('Global news tab did not activate'); else ok('news tabs switch to Global');
await page.locator('#newsTabCountry').click();
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, '03-fly-to-japan-night.jpg'), type: 'jpeg', quality: 82 });
ok('03-fly-to-japan-night.jpg');

await page.locator('#detail').screenshot({ path: join(OUT, '04-country-detail.png') });
ok('04-country-detail.png');

await page.locator('#news').screenshot({ path: join(OUT, '05-breaking-news.png') });
ok('05-breaking-news.png');

// drag to rotate — selection must survive a drag (click-vs-drag logic)
const box = await page.locator('#globe').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx + 100, cy);
await page.mouse.down();
await page.mouse.move(cx - 220, cy + 30, { steps: 25 });
await page.mouse.up();
await page.waitForTimeout(600);
const stillJapan = await page.locator('#dName').textContent();
if (stillJapan !== 'Japan') fail('dragging the globe changed the selection'); else ok('drag rotates without selecting');
await page.locator('#globeWrap').screenshot({ path: join(OUT, '06-drag-rotate.jpg'), type: 'jpeg', quality: 82 });
ok('06-drag-rotate.jpg');

// ---- mobile ---------------------------------------------------------------------
const mob = await newPage({ width: 375, height: 812 });
await mob.goto(BASE, { waitUntil: 'domcontentloaded' });
await mob.locator('#liveDot.ok').waitFor({ timeout: 90000 });
await mob.waitForTimeout(TEXTURE_SETTLE_MS);
await mob.screenshot({ path: join(OUT, '07-mobile.jpg'), type: 'jpeg', quality: 82, fullPage: false });
ok('07-mobile.jpg');

// ---- console hygiene ---------------------------------------------------------------
const real = errors.filter((e) => !/favicon/i.test(e));
if (real.length) fail('console/page errors:\n  ' + real.join('\n  '));
else ok('no console errors');

await browser.close();
console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASS');
