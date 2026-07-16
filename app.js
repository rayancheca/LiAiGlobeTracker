// app.js — trackAImarket frontend logic (data polling + panels).
// The 3D earth lives in globe.js; pure market math lives in lib/market.mjs.
// Data comes from our own /api/quotes and /api/news helpers (see /api).
import { trendColor, fmtPct, fmtCap, fmtPrice, computeCountry, computeWorld, UP, DOWN, FLAT } from './lib/market.mjs';
import { createGlobe } from './globe.js';

const COUNTRIES = window.COUNTRIES || [];

// ---- config ---------------------------------------------------------------
const REFRESH_MS = 45000;               // quote poll cadence
const NEWS_MS = 5 * 60 * 1000;
const IS_MOBILE = matchMedia('(max-width: 820px)').matches || 'ontouchstart' in window;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// live quote map: symbol -> {price, changePct, cap, state, cur, name}
let QUOTES = {};
let selectedId = COUNTRIES[0] && COUNTRIES[0].id;
let lastUpdated = 0;
let dataLive = false;
let globe = null;
let pendingFocusId = null; // selection made before the globe finished loading
let newsMode = 'country';  // 'country' follows the selection; 'global' pins the world feed
const newsCache = new Map(); // topic -> { ts, items }
const worldHistory = [];     // session history of the World AI Index (sparkline)
const prevChg = new Map();   // symbol -> last changePct (drives price-flash)
const prevTrend = new Map(); // country id -> last trend
const symHist = new Map();   // symbol -> rolling session prices (row sparklines)
const ctryHist = new Map();  // country id -> rolling session trend (head sparkline)
let prevWorld = null;
const HIST_MAX = 90;

const ALL_SYMBOLS = COUNTRIES.flatMap((c) => c.companies.map((x) => x.s));

// ---- helpers --------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const el = (t, cls, text) => {
  const e = document.createElement(t);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const flag = (code) => `https://flagcdn.com/${code.toLowerCase()}.svg`;

// re-triggerable one-shot animation class
function replayClass(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
}

// filled delta triangle (▲/▼/—) from the inline sprite
function deltaIcon(v) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('width', '8'); svg.setAttribute('height', '8');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', v == null || Math.abs(v) <= 0.05 ? '#i-dash' : v > 0 ? '#i-tri-up' : '#i-tri-down');
  svg.appendChild(use);
  return svg;
}

// tiny inline-SVG sparkline from a value series
function sparkline(values, w, h, color, { area = false, dot = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('aria-hidden', 'true');
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const px = (i) => (i / (values.length - 1)) * (w - 2) + 1;
  const py = (v) => h - 2 - ((v - min) / span) * (h - 4);
  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  if (area) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', `1,${h - 1} ${pts} ${w - 1},${h - 1}`);
    poly.setAttribute('fill', color); poly.setAttribute('opacity', '0.12');
    svg.appendChild(poly);
  }
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill', 'none'); line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round'); line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
  if (dot) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', px(values.length - 1)); c.setAttribute('cy', py(values[values.length - 1]));
    c.setAttribute('r', '1.75'); c.setAttribute('fill', color);
    svg.appendChild(c);
  }
  return svg;
}

// ---- data + UI ------------------------------------------------------------
let quotesInFlight = false;
async function loadQuotes() {
  if (quotesInFlight) return; // interval + visibilitychange can otherwise race
  quotesInFlight = true;
  try {
    const r = await fetch('/api/quotes?symbols=' + encodeURIComponent(ALL_SYMBOLS.join(',')));
    const j = await r.json();
    if (j.quotes && Object.keys(j.quotes).length) {
      QUOTES = { ...QUOTES, ...j.quotes };
      lastUpdated = j.updated || Date.now();
      dataLive = !j.stale;
    } else { dataLive = false; }
  } catch { dataLive = false; }
  finally { quotesInFlight = false; }
  applyData();
}

function applyData() {
  const states = new Map();
  for (const c of COUNTRIES) {
    const s = computeCountry(c, QUOTES);
    c._state = s;
    states.set(c.id, s);
  }
  const { world, bull, bear, openCount } = computeWorld([...states.values()]);

  // rolling session history feeds the sparklines — one sample per data
  // timestamp (applyData also runs on globe-init and tab-visibility, which
  // would otherwise inject duplicate points)
  if (dataLive && lastUpdated !== applyData._histTs) {
    applyData._histTs = lastUpdated;
    if (world != null) { worldHistory.push(world); if (worldHistory.length > HIST_MAX) worldHistory.shift(); }
    for (const c of COUNTRIES) {
      const s = states.get(c.id);
      if (s?.trend != null) {
        const h = ctryHist.get(c.id) || []; h.push(s.trend);
        if (h.length > HIST_MAX) h.shift();
        ctryHist.set(c.id, h);
      }
      for (const co of c.companies) {
        const q = QUOTES[co.s];
        if (q?.price == null) continue;
        const h = symHist.get(co.s) || [];
        if (h[h.length - 1] !== q.price) { h.push(q.price); if (h.length > HIST_MAX) h.shift(); }
        symHist.set(co.s, h);
      }
    }
    renderSparkline();
  }

  // header
  const idx = $('#worldIdx');
  idx.textContent = fmtPct(world);
  idx.style.color = trendColor(world);
  if (prevWorld != null && world != null && Math.abs(world - prevWorld) > 0.001) {
    replayClass(idx, world > prevWorld ? 'roll-up' : 'roll-down');
  }
  prevWorld = world ?? prevWorld;

  const breadth = $('#breadth');
  breadth.innerHTML = '';
  const up = el('span', 'bnum'); up.style.color = UP; up.append(String(bull), deltaIcon(1));
  const down = el('span', 'bnum'); down.style.color = DOWN; down.append(String(bear), deltaIcon(-1));
  const open = el('span', 'bopen', `${openCount} open`);
  breadth.append(up, down, open);
  const bar = $('#breadthFill');
  if (bar && bull + bear > 0) bar.style.transform = `scaleX(${(bull / (bull + bear)).toFixed(3)})`;

  const dot = $('#liveDot');
  dot.className = 'dot ' + (dataLive ? 'ok' : 'warn');
  const pill = $('#livePill');
  if (pill) pill.className = 'live-pill ' + (dataLive ? 'ok' : 'warn');
  $('#liveLabel').textContent = dataLive ? 'LIVE' : 'DELAYED';
  $('#updated').textContent = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—';

  globe?.setStates(states);
  renderList();
  renderDetail();
  renderTicker();
}

// tiny session sparkline of the World AI Index (header) — accent-coloured:
// it's command instrumentation, not market data
function renderSparkline() {
  const holder = $('#spark');
  if (!holder || worldHistory.length < 2) return;
  holder.replaceChildren(sparkline(worldHistory, 64, 18, 'var(--accent)', { dot: true }));
}

// scrolling ticker tape: built once, values updated in place so the CSS
// marquee never restarts mid-scroll; click flies to that company's market
function renderTicker() {
  const track = $('#tickerTrack');
  if (!track) return;
  if (!track.children.length) {
    const build = (hidden) => {
      const frag = document.createDocumentFragment();
      for (const c of COUNTRIES) {
        for (const co of c.companies) {
          const s = el('span', 'titem');
          s.dataset.sym = co.s;
          s.dataset.cid = c.id;
          if (hidden) s.setAttribute('aria-hidden', 'true');
          s.append(el('b', null, co.s), el('i', 'tprice'), el('em', 'tchg'));
          frag.appendChild(s);
        }
      }
      return frag;
    };
    track.append(build(false), build(true)); // duplicate once for a seamless loop
    // walking pace: ~45px/s, duration derived from actual rendered width
    requestAnimationFrame(() => {
      const half = track.scrollWidth / 2;
      if (half > 0 && !REDUCED_MOTION) track.style.animationDuration = Math.round(half / 45) + 's';
    });
    track.addEventListener('click', (e) => {
      const item = e.target.closest('.titem');
      if (item) selectCountry(item.dataset.cid, true);
    });
  }
  for (const node of track.querySelectorAll('.titem')) {
    const q = QUOTES[node.dataset.sym];
    if (!q) continue;
    node.querySelector('.tprice').textContent = fmtPrice(q.price, q.cur);
    const chg = node.querySelector('.tchg');
    chg.textContent = fmtPct(q.changePct);
    chg.style.color = trendColor(q.changePct);
  }
}

function renderList() {
  const list = $('#countryList');
  const rows = COUNTRIES.map((c) => ({ c, s: c._state || {} }))
    .sort((a, b) => (b.s.trend ?? -999) - (a.s.trend ?? -999));
  // the 45s refresh rebuilds the rows — don't strand keyboard focus
  const focusId = list.contains(document.activeElement) ? document.activeElement.dataset?.cid : null;
  list.innerHTML = '';
  for (const { c, s } of rows) {
    const row = el('button', 'crow' + (c.id === selectedId ? ' active' : ''));
    const img = el('img', 'fl'); img.src = flag(c.code); img.alt = ''; img.loading = 'lazy';
    const name = el('span', 'cn', c.name);
    const st = el('span', 'cdot ' + (s.open ? 'open' : 'closed'));
    st.title = s.open ? 'Market open' : 'Market closed';
    const move = el('span', 'cmove');
    const pct = el('span', 'ct', fmtPct(s.trend));
    pct.style.color = trendColor(s.trend);
    const was = prevTrend.get(c.id);
    if (was != null && s.trend != null && Math.abs(s.trend - was) > 0.001) {
      replayClass(pct, s.trend > was ? 'flash-up' : 'flash-down');
    }
    prevTrend.set(c.id, s.trend);
    // magnitude micro-bar: the list scans as a heat ladder without reading numerals
    const bar = el('span', 'cbar');
    const fill = el('i');
    fill.style.background = trendColor(s.trend);
    fill.style.transform = `scaleX(${Math.min(1, Math.max(0.08, Math.abs(s.trend ?? 0) / 5)).toFixed(3)})`;
    bar.appendChild(fill);
    move.append(pct, bar);
    row.append(img, name, st, move);
    row.dataset.cid = c.id;
    row.setAttribute('aria-label', `${c.name} ${fmtPct(s.trend)} ${s.open ? 'market open' : 'market closed'}`);
    row.onclick = () => selectCountry(c.id, true);
    list.appendChild(row);
  }
  if (focusId) list.querySelector(`[data-cid="${focusId}"]`)?.focus();
}

let lastDetailId = null;
function renderDetail() {
  const c = COUNTRIES.find((x) => x.id === selectedId); if (!c) return;
  const s = c._state || computeCountry(c, QUOTES);
  const detail = $('#detail');
  if (lastDetailId && lastDetailId !== c.id && !REDUCED_MOTION) replayClass(detail, 'swap');
  lastDetailId = c.id;

  const dFlag = $('#dFlag');
  dFlag.src = flag(c.code);
  dFlag.alt = c.name + ' flag';
  $('#dName').textContent = c.name;
  const dt = $('#dTrend');
  dt.replaceChildren(deltaIcon(s.trend), document.createTextNode(fmtPct(s.trend)));
  dt.style.color = trendColor(s.trend);
  // roll direction = direction of CHANGE (same country only, never first paint)
  const prevD = renderDetail._prev;
  if (prevD && prevD.id === c.id && s.trend != null && prevD.trend != null && Math.abs(s.trend - prevD.trend) > 0.001) {
    replayClass(dt, s.trend > prevD.trend ? 'roll-up' : 'roll-down');
  }
  renderDetail._prev = { id: c.id, trend: s.trend };
  const badge = $('#dStatus');
  badge.textContent = s.open ? 'OPEN' : 'CLOSED';
  badge.className = 'status ' + (s.open ? 'open' : 'closed');
  const head = $('.dhead');
  if (head) head.className = 'dhead ' + ((s.trend ?? 0) >= 0 ? 'trend-up' : 'trend-down');
  $('#dSub').textContent = s.open
    ? 'Cap-weighted move, live prices'
    : 'Cap-weighted move at last close';
  const dSpark = $('#dSpark');
  if (dSpark) {
    const h = ctryHist.get(c.id);
    dSpark.replaceChildren(h && h.length > 1 ? sparkline(h, 72, 20, trendColor(s.trend), { area: true, dot: true }) : el('span'));
  }
  renderCoords(c);

  const tb = $('#dRows'); tb.innerHTML = '';
  const hasSpark = s.rows.some((r) => (symHist.get(r.symbol) || []).length > 1);
  $('#dTable')?.classList.toggle('nospark', !hasSpark);
  s.rows.forEach((r, i) => {
    const tr = el('tr', i === 0 ? 'rank1' : null);
    const co = el('td', 'co');
    co.append(el('span', 'sy', r.symbol), el('span', 'nm', r.name));
    const spark = el('td', 'sp');
    const h = symHist.get(r.symbol);
    if (h && h.length > 1) spark.appendChild(sparkline(h, 48, 16, trendColor(r.chg), { dot: true }));
    const pr = el('td', 'pr', fmtPrice(r.price, r.cur));
    const cap = el('td', 'cap', fmtCap(r.cap, r.cur));
    const ch = el('td', 'ch', fmtPct(r.chg));
    ch.style.color = trendColor(r.chg);
    const was = prevChg.get(r.symbol);
    if (was != null && r.chg != null && Math.abs(r.chg - was) > 0.001) {
      replayClass(ch, r.chg > was ? 'flash-up' : 'flash-down');
      pr.classList.add('ticked'); // last-tick memory underline, decays via CSS
    }
    prevChg.set(r.symbol, r.chg);
    tr.append(co, spark, pr, cap, ch);
    tb.appendChild(tr);
  });
  renderClock();
}

// mission-control coordinates readout for the selected market
function renderCoords(c) {
  const box = $('#coords');
  if (!box || !c) return;
  const lat = `${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? 'E' : 'W'}`;
  let off = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: c.tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    off = (parts.find((p) => p.type === 'timeZoneName')?.value || '').replace('GMT', 'UTC');
  } catch { /* older engines: omit offset */ }
  box.textContent = `${lat} · ${lon}${off ? ' · ' + off : ''}`;
}

// live local time at the selected exchange
function renderClock() {
  const c = COUNTRIES.find((x) => x.id === selectedId);
  const elc = $('#dClock');
  if (!elc || !c || !c.tz) return;
  elc.title = 'Local time at this exchange';
  try {
    elc.textContent = new Intl.DateTimeFormat('en-GB', {
      timeZone: c.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date());
  } catch { elc.textContent = ''; }
}

function selectCountry(id, focus) {
  const changed = id !== selectedId;
  selectedId = id;
  const c = COUNTRIES.find((x) => x.id === id);
  globe?.setSelected(id);
  if (focus && c) {
    if (globe) globe.focus(c);
    else pendingFocusId = id; // fly there once the globe is ready
  }
  renderList();
  renderDetail();
  history.replaceState(null, '', '?c=' + encodeURIComponent(id));
  if (changed && newsMode === 'country') loadNews();
  else renderNewsTabs();
  if (IS_MOBILE) $('#detail').scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'nearest' });
}

// ---- news (global feed or the selected country's feed) ---------------------
function activeNewsTopic() {
  const c = COUNTRIES.find((x) => x.id === selectedId);
  return newsMode === 'country' && c ? c.name : '';
}

function renderNewsTabs() {
  const c = COUNTRIES.find((x) => x.id === selectedId);
  const tabG = $('#newsTabGlobal'), tabC = $('#newsTabCountry');
  if (!tabG || !tabC) return;
  tabC.textContent = c ? c.name : '—';
  tabG.classList.toggle('active', newsMode === 'global');
  tabC.classList.toggle('active', newsMode === 'country');
  tabG.setAttribute('aria-pressed', String(newsMode === 'global'));
  tabC.setAttribute('aria-pressed', String(newsMode === 'country'));
}

function setNewsMode(mode) {
  if (newsMode === mode) return;
  newsMode = mode;
  loadNews();
}

// "32m ago" / "2h ago" -> minutes (Infinity when unknown)
function ageMinutes(time) {
  const m = /^(\d+)m ago$/.exec(time || '');
  if (m) return +m[1];
  const h = /^(\d+)h ago$/.exec(time || '');
  if (h) return +h[1] * 60;
  return Infinity;
}

function renderNews(items, topicKey) {
  const box = $('#newsList');
  const shown = items.slice(0, 18);
  // skip identical re-renders (5-min refresher usually returns the same
  // payload) — preserves scroll position and avoids replaying entry animations
  const sig = topicKey + '|' + shown.map((it) => it.url).join('␟');
  if (sig === renderNews._sig && box.querySelector('.nrow')) return;
  renderNews._sig = sig;
  box.innerHTML = '';
  const cnt = $('#newsCnt');
  if (cnt) cnt.textContent = String(shown.length);
  shown.forEach((it, i) => {
    // textContent only — titles/sources are decoded plain text (see lib/rss.cjs)
    const age = ageMinutes(it.time);
    const a = el('a', 'nrow' + (age <= 15 ? ' fresh' : ''));
    a.style.setProperty('--i', i);
    a.href = /^https?:\/\//i.test(it.url || '') ? it.url : '#';
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    const title = el('div', 'nt', it.title);
    const meta = el('div', 'nm');
    meta.appendChild(el('span', 'nsrc', it.source));
    if (it.time) meta.appendChild(el('span', null, it.time));
    if (age <= 5) meta.appendChild(el('span', 'nnew', 'NEW'));
    const ext = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ext.setAttribute('class', 'i next'); ext.setAttribute('width', '12'); ext.setAttribute('height', '12');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-ext'); ext.appendChild(use);
    a.append(title, meta, ext);
    box.appendChild(a);
  });
}

async function loadNews(force = false) {
  renderNewsTabs();
  const topic = activeNewsTopic();
  const key = topic || '_global';
  const box = $('#newsList');
  const hit = newsCache.get(key);
  if (!force && hit && Date.now() - hit.ts < NEWS_MS) { renderNews(hit.items, key); return; }
  // stale-while-revalidate: show what we have for THIS topic immediately
  if (hit) renderNews(hit.items, key);
  else box.innerHTML = '<div class="empty">Loading headlines…</div>';
  try {
    const r = await fetch('/api/news' + (topic ? '?q=' + encodeURIComponent(topic) : ''));
    const j = await r.json();
    if (!j.items || !j.items.length) throw new Error('empty');
    newsCache.set(key, { ts: Date.now(), items: j.items });
    if (key === (activeNewsTopic() || '_global')) renderNews(j.items, key); // still the active tab?
  } catch {
    if (!hit && !box.querySelector('.nrow')) {
      box.innerHTML = '<div class="empty">News feed unavailable right now.</div>';
    }
  }
}

// countdown to next refresh: numeric label + draining accent bar
function startCountdown() {
  let next = Date.now() + REFRESH_MS;
  const drain = () => {
    const bar = $('#cdBar');
    if (!bar || REDUCED_MOTION) return;
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = `drain ${REFRESH_MS}ms linear forwards`;
  };
  drain();
  setInterval(() => {
    const s = Math.max(0, Math.round((next - Date.now()) / 1000));
    const e = $('#countdown'); if (e) e.textContent = s + 's';
    if (s <= 0) { next = Date.now() + REFRESH_MS; drain(); }
  }, 1000);
  return { reset: () => { next = Date.now() + REFRESH_MS; drain(); } };
}

async function initGlobe() {
  const wrap = $('#globeWrap');
  try {
    globe = await createGlobe({
      canvas: $('#globe'),
      wrap,
      countries: COUNTRIES,
      onSelect: (id) => selectCountry(id, false),
      isMobile: IS_MOBILE,
      reducedMotion: REDUCED_MOTION,
    });
  } catch (e) {
    console.warn('globe init failed:', e);
    globe = null;
  }
  if (!globe) { wrap.classList.add('noglobe'); return; }
  // colour the markers from whatever data we already have
  applyData();
  globe.setSelected(selectedId);
  if (pendingFocusId) {
    const c = COUNTRIES.find((x) => x.id === pendingFocusId);
    pendingFocusId = null;
    if (c) globe.focus(c);
  }
}

// ---- boot -----------------------------------------------------------------
function boot() {
  if (!COUNTRIES.length) {
    document.body.innerHTML = '<p style="color:#fff;padding:2rem">Dataset failed to load.</p>';
    return;
  }
  const fromUrl = new URLSearchParams(location.search).get('c');
  if (fromUrl && COUNTRIES.some((c) => c.id === fromUrl)) selectedId = fromUrl;

  $('#mktCnt').textContent = String(COUNTRIES.length);
  $('#newsTabGlobal')?.addEventListener('click', () => setNewsMode('global'));
  $('#newsTabCountry')?.addEventListener('click', () => setNewsMode('country'));
  requestAnimationFrame(() => document.body.classList.add('loaded')); // panel stagger

  applyData();          // instant paint from seed data (list / detail / header)
  const cd = startCountdown();
  loadNews();
  initGlobe();          // best-effort; panels never depend on it
  loadQuotes().then(() => cd.reset());
  setInterval(() => { loadQuotes().then(() => cd.reset()); }, REFRESH_MS);
  setInterval(() => loadNews(true), NEWS_MS);
  setInterval(renderClock, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadQuotes().then(() => cd.reset());
  });
}

boot();
