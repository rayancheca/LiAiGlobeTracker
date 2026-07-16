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

// ---- data + UI ------------------------------------------------------------
async function loadQuotes() {
  try {
    const r = await fetch('/api/quotes?symbols=' + encodeURIComponent(ALL_SYMBOLS.join(',')));
    const j = await r.json();
    if (j.quotes && Object.keys(j.quotes).length) {
      QUOTES = { ...QUOTES, ...j.quotes };
      lastUpdated = j.updated || Date.now();
      dataLive = !j.stale;
    } else { dataLive = false; }
  } catch { dataLive = false; }
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

  // header
  $('#worldIdx').textContent = fmtPct(world);
  $('#worldIdx').style.color = trendColor(world);
  const breadth = $('#breadth');
  breadth.innerHTML = '';
  const up = el('span', null, `▲ ${bull}`); up.style.color = UP;
  const down = el('span', null, `▼ ${bear}`); down.style.color = DOWN;
  const open = el('span', null, `${openCount} open`); open.style.color = FLAT;
  breadth.append(up, ' ', down, ' ', open);

  const dot = $('#liveDot');
  dot.className = 'dot ' + (dataLive ? 'ok' : 'warn');
  $('#liveLabel').textContent = dataLive ? 'Live' : 'Reconnecting…';
  $('#updated').textContent = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—';

  globe?.setStates(states);
  renderList();
  renderDetail();
}

function renderList() {
  const list = $('#countryList');
  const rows = COUNTRIES.map((c) => ({ c, s: c._state || {} }))
    .sort((a, b) => (b.s.trend ?? -999) - (a.s.trend ?? -999));
  list.innerHTML = '';
  for (const { c, s } of rows) {
    const row = el('button', 'crow' + (c.id === selectedId ? ' active' : ''));
    const img = el('img', 'fl'); img.src = flag(c.code); img.alt = ''; img.loading = 'lazy';
    const name = el('span', 'cn', c.name);
    const st = el('span', 'cdot ' + (s.open ? 'open' : 'closed'));
    st.title = s.open ? 'Market open' : 'Market closed';
    const pct = el('span', 'ct', fmtPct(s.trend));
    pct.style.color = trendColor(s.trend);
    row.append(img, name, st, pct);
    row.setAttribute('aria-label', `${c.name} ${fmtPct(s.trend)} ${s.open ? 'market open' : 'market closed'}`);
    row.onclick = () => selectCountry(c.id, true);
    list.appendChild(row);
  }
}

function renderDetail() {
  const c = COUNTRIES.find((x) => x.id === selectedId); if (!c) return;
  const s = c._state || computeCountry(c, QUOTES);
  const dFlag = $('#dFlag');
  dFlag.src = flag(c.code);
  dFlag.alt = c.name + ' flag';
  $('#dName').textContent = c.name;
  $('#dTrend').textContent = fmtPct(s.trend);
  $('#dTrend').style.color = trendColor(s.trend);
  const badge = $('#dStatus');
  badge.textContent = s.open ? 'MARKET OPEN' : 'MARKET CLOSED';
  badge.className = 'status ' + (s.open ? 'open' : 'closed');
  $('#dSub').textContent = s.open
    ? 'Cap-weighted move, live prices'
    : 'Cap-weighted move at last close';

  const tb = $('#dRows'); tb.innerHTML = '';
  for (const r of s.rows) {
    const tr = el('tr');
    const co = el('td', 'co');
    co.append(el('span', 'sy', r.symbol), el('span', 'nm', r.name));
    const pr = el('td', 'pr', fmtPrice(r.price, r.cur));
    const cap = el('td', 'cap', fmtCap(r.cap, r.cur));
    const ch = el('td', 'ch', fmtPct(r.chg));
    ch.style.color = trendColor(r.chg);
    tr.append(co, pr, cap, ch);
    tb.appendChild(tr);
  }
}

function selectCountry(id, focus) {
  selectedId = id;
  const c = COUNTRIES.find((x) => x.id === id);
  globe?.setSelected(id);
  if (focus && c) {
    if (globe) globe.focus(c);
    else pendingFocusId = id; // fly there once the globe is ready
  }
  renderList();
  renderDetail();
  if (IS_MOBILE) $('#detail').scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'nearest' });
}

async function loadNews() {
  const box = $('#newsList');
  try {
    const r = await fetch('/api/news');
    const j = await r.json();
    if (!j.items || !j.items.length) throw new Error('empty');
    box.innerHTML = '';
    for (const it of j.items.slice(0, 18)) {
      // textContent only — titles/sources are decoded plain text (see lib/rss.cjs)
      const a = el('a', 'nrow');
      a.href = /^https?:\/\//i.test(it.url || '') ? it.url : '#';
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      const meta = el('div', 'nm');
      meta.appendChild(el('span', null, it.source));
      if (it.time) meta.appendChild(el('span', null, '· ' + it.time));
      a.append(el('div', 'nt', it.title), meta);
      box.appendChild(a);
    }
  } catch {
    if (!box.children.length) box.innerHTML = '<div class="empty">News feed unavailable right now.</div>';
  }
}

// countdown to next refresh
function startCountdown() {
  let next = Date.now() + REFRESH_MS;
  setInterval(() => {
    const s = Math.max(0, Math.round((next - Date.now()) / 1000));
    const e = $('#countdown'); if (e) e.textContent = s + 's';
    if (s <= 0) next = Date.now() + REFRESH_MS;
  }, 1000);
  return { reset: () => (next = Date.now() + REFRESH_MS) };
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
  $('#mktCnt').textContent = COUNTRIES.length + ' countries';
  applyData();          // instant paint from seed data (list / detail / header)
  const cd = startCountdown();
  loadNews();
  initGlobe();          // best-effort; panels never depend on it
  loadQuotes().then(() => cd.reset());
  setInterval(() => { loadQuotes().then(() => cd.reset()); }, REFRESH_MS);
  setInterval(loadNews, NEWS_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadQuotes().then(() => cd.reset());
  });
}

boot();
