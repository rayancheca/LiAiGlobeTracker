# trackAImarket 🌐

A live 3D globe that tracks the world's top AI companies across 18 markets —
streaming real prices, a **market-cap-weighted** up/down trend for each country,
and breaking AI-market news.

---

## What it does

- **3D globe** (Three.js) with a glowing marker per country. Marker colour = that
  country's cap-weighted move today (green up / red down). Markers pulse while
  the local market is **open**.
- **Live prices** for ~180 AI companies, refreshed every ~45 seconds.
- **Cap-weighted country trend** — bigger companies move the country index more.
- **Market-hours aware** — countries whose exchange is closed are labelled
  `MARKET CLOSED` and show their last-close move instead of pretending to stream.
- **Breaking news** — a global AI-market headline feed.
- **Graceful degradation** — if a device can't run WebGL (or the Three.js CDN is
  unreachable), the globe hides itself and the live data / country list / news
  keep working.

## Why this version is actually live (the fix)

The original build fetched Yahoo Finance directly from the browser through free
public CORS proxies. Those proxies constantly failed, so the app silently fell
back to a random-walk **simulation** (its own badge read *"Real-time
simulation"*). That's why the data looked static/fake.

This version adds a tiny server-side **helper** (two serverless functions) that:

1. calls Yahoo Finance **server-side** (no CORS, proper cookie+crumb auth),
2. batches all symbols into a couple of requests,
3. is **cached at the CDN edge** (`s-maxage`) so Yahoo is never hammered, and
4. returns real price / % change / **market cap** / **market state** per symbol.

No API key required. It's free/best-effort: when a symbol or the feed is
temporarily unavailable it falls back to the last good value.

## Architecture

```
index.html        static frontend (globe + UI), dataset embedded inline
app.js            frontend logic (loads Three.js from a pinned CDN, polls /api)
api/quotes.js     serverless: Yahoo Finance quotes (crumb auth, batched, edge-cached 45s)
api/news.js       serverless: Google News RSS -> JSON (edge-cached 5m)
vercel.json       function config
```

The frontend is a single static file plus one small JS module; the "helper" is
the two `/api` functions. Everything runs on a free Vercel (or Netlify) tier.

## Deploy (free)

### Vercel (recommended)
```bash
npm i -g vercel
vercel            # first run links/creates the project
vercel --prod     # ship it -> gives you https://<name>.vercel.app
```
Or import the GitHub repo at <https://vercel.com/new> — zero config, static site
+ `/api` functions are detected automatically.

### Netlify
Static hosting works out of the box. The `/api` functions would need to be moved
to `netlify/functions/` (Netlify uses a different handler signature) — see the
handlers in `api/` for the logic to port.

### Custom domain
Point `trackAImarket.com` at the deployment in the host's Domains settings once
you own it. Until then the free `*.vercel.app` URL works fine.

## Local development

`vercel dev` runs the static site and the `/api` functions together at
http://localhost:3000.

## Editing the company list

The tracked universe lives inline in `index.html` as `window.COUNTRIES`
(`{ id, name, code, lat, lon, companies:[{ n:name, s:yahooSymbol, p:seedPrice, ch:seedChange }] }`).
Add or remove companies there — symbols must be in **Yahoo Finance** format
(e.g. `NVDA`, `2330.TW`, `ASML.AS`, `005930.KS`).

## Disclaimer

Data is sourced best-effort from public Yahoo Finance endpoints and may be
delayed or occasionally unavailable. For information only — **not investment
advice**.
