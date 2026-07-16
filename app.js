// trackAImarket — live global AI-stock globe
// Data comes from our own /api/quotes and /api/news helpers (see /api).
// Three.js is loaded lazily inside initGlobe() so that a WebGL/asset failure
// only disables the globe — the live data, country list and news still work.
let THREE, OrbitControls;

const COUNTRIES = window.COUNTRIES || [];

// ---- config ---------------------------------------------------------------
const REFRESH_MS = 45000;               // poll cadence (30–60s bracket)
const NEWS_MS = 5 * 60 * 1000;
const GLOBE_R = 1;
const IS_MOBILE = matchMedia('(max-width: 820px)').matches || 'ontouchstart' in window;

// Approx FX -> USD, used ONLY to weight market caps consistently. Not for display.
const FX = { USD:1, EUR:1.08, GBP:1.27, JPY:0.0067, TWD:0.031, KRW:0.00073, HKD:0.128,
  CNY:0.14, INR:0.012, CAD:0.73, BRL:0.18, SEK:0.095, SGD:0.74, CHF:1.12, AUD:0.66, ILS:0.27 };

const UP = '#22c55e', DOWN = '#ef4444', FLAT = '#64748b';
const trendColor = (t) => (t == null ? FLAT : t > 0.05 ? UP : t < -0.05 ? DOWN : FLAT);

// live quote map: symbol -> {price, changePct, cap, state, cur, name}
let QUOTES = {};
let selectedId = COUNTRIES[0] && COUNTRIES[0].id;
let lastUpdated = 0;
let dataLive = false;

const ALL_SYMBOLS = COUNTRIES.flatMap((c) => c.companies.map((x) => x.s));

// ---- helpers --------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const el = (t, cls, html) => { const e = document.createElement(t); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function fmtPct(p) { if (p == null) return '—'; return (p > 0 ? '+' : '') + p.toFixed(2) + '%'; }
function fmtCap(cap, cur) {
  if (!cap) return '—';
  const usd = cap * (FX[cur] || 1);
  if (usd >= 1e12) return '$' + (usd / 1e12).toFixed(2) + 'T';
  if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(1) + 'B';
  if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(0) + 'M';
  return '$' + usd.toFixed(0);
}
function fmtPrice(p, cur) {
  if (p == null) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: p < 10 ? 2 : p < 1000 ? 2 : 0 }).format(p); }
  catch { return p.toFixed(2); }
}
const flag = (code) => `https://flagcdn.com/${code.toLowerCase()}.svg`;

// cap-weighted country trend + open/closed, using live data where present
function computeCountry(c) {
  let wSum = 0, tSum = 0, haveLive = false, open = false, withData = 0;
  const rows = c.companies.map((co) => {
    const q = QUOTES[co.s];
    const price = q?.price ?? co.p;
    const chg = q?.changePct ?? co.ch;
    const cap = q?.cap ?? null;
    const cur = q?.cur ?? 'USD';
    if (q) { haveLive = true; withData++; if (q.state === 'REGULAR') open = true; }
    const w = cap ? cap * (FX[cur] || 1) : null;
    if (chg != null) {
      const weight = w || 1;               // fall back to equal weight if no cap
      wSum += weight; tSum += weight * chg;
    }
    return { name: co.n, symbol: co.s, price, chg, cap, cur, state: q?.state || null };
  });
  rows.sort((a, b) => (b.cap || 0) - (a.cap || 0));
  const trend = wSum ? tSum / wSum : null;
  return { trend, open, haveLive, withData, rows };
}

// ---- three.js globe -------------------------------------------------------
let renderer, scene, camera, controls, globeGroup, markerGroup, raycaster, pointer;
const markers = new Map();               // id -> {mesh, halo}

function latLonToVec3(lat, lon, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

async function initGlobe() {
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch (e) {
    console.warn('3D globe unavailable, running in data-only mode:', e);
    disableGlobe();
    return false;
  }
  try {
    buildGlobe();
    return true;
  } catch (e) {
    console.warn('WebGL init failed, running in data-only mode:', e);
    disableGlobe();
    return false;
  }
}

function disableGlobe() {
  const wrap = $('#globeWrap');
  if (wrap) wrap.classList.add('noglobe');
}

function buildGlobe() {
  const canvas = $('#globe');
  const wrap = $('#globeWrap');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.7, 3.1);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.minDistance = 1.7; controls.maxDistance = 5;
  controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  controls.rotateSpeed = 0.6;

  globeGroup = new THREE.Group(); scene.add(globeGroup);

  // ocean sphere
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_R, IS_MOBILE ? 48 : 64, IS_MOBILE ? 48 : 64),
    new THREE.MeshPhongMaterial({ color: 0x0b1c33, emissive: 0x04101f, shininess: 12, specular: 0x0a2a4a })
  );
  globeGroup.add(sphere);

  // graticule (lat/lon grid) for the "terminal" look
  const grid = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(GLOBE_R * 1.001, 24, 16)),
    new THREE.LineBasicMaterial({ color: 0x1e4a6e, transparent: true, opacity: 0.35 })
  );
  globeGroup.add(grid);

  // atmosphere rim
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_R * 1.18, 48, 48),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: 'varying vec3 vN; void main(){ float i=pow(0.62-dot(vN,vec3(0.0,0.0,1.0)),3.0); gl_FragColor=vec4(0.22,0.6,1.0,1.0)*i; }',
    })
  );
  globeGroup.add(atmo);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xbfe3ff, 1.1); key.position.set(3, 2, 4); scene.add(key);

  // starfield
  if (!IS_MOBILE) {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = 20 + Math.random() * 30, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
      pos[i*3] = r*Math.sin(b)*Math.cos(a); pos[i*3+1] = r*Math.cos(b); pos[i*3+2] = r*Math.sin(b)*Math.sin(a); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb6d6, size: 0.08, transparent: true, opacity: 0.5 })));
  }

  markerGroup = new THREE.Group(); globeGroup.add(markerGroup);
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();

  for (const c of COUNTRIES) {
    const p = latLonToVec3(c.lat, c.lon, GLOBE_R * 1.015);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 16),
      new THREE.MeshBasicMaterial({ color: FLAT })
    );
    mesh.position.copy(p); mesh.userData.id = c.id;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTexture(), color: FLAT, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(0.14, 0.14, 1); halo.position.copy(p);
    markerGroup.add(mesh); markerGroup.add(halo);
    markers.set(c.id, { mesh, halo, base: p.clone() });
  }

  renderer.domElement.addEventListener('pointerdown', onPick);
  window.addEventListener('resize', resize);
  resize();

  let t = 0;
  (function loop() {
    requestAnimationFrame(loop);
    t += 0.02;
    for (const [id, m] of markers) {
      const c = COUNTRIES.find((x) => x.id === id);
      const st = c._state || {};
      const pulse = 1 + (st.open ? 0.25 + 0.18 * Math.sin(t * 2 + m.base.x * 5) : 0.05);
      m.halo.scale.set(0.14 * pulse, 0.14 * pulse, 1);
      m.mesh.scale.setScalar(id === selectedId ? 1.6 : 1);
    }
    controls.update();
    renderer.render(scene, camera);
  })();
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); return tex;
}

function resize() {
  const wrap = $('#globeWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

function onPick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(markerGroup.children.filter((o) => o.isMesh), false)[0];
  if (hit) selectCountry(hit.object.userData.id, true);
}

function focusCamera(c) {
  const target = latLonToVec3(c.lat, c.lon, 3).multiplyScalar(1);
  const start = camera.position.clone();
  const dist = camera.position.length();
  const end = latLonToVec3(c.lat, c.lon, dist);
  let a = 0;
  (function anim() { a += 0.06; if (a > 1) a = 1;
    camera.position.lerpVectors(start, end, a * a * (3 - 2 * a));
    camera.lookAt(0, 0, 0);
    if (a < 1) requestAnimationFrame(anim);
  })();
  controls.autoRotate = false;
  clearTimeout(focusCamera._t); focusCamera._t = setTimeout(() => (controls.autoRotate = true), 8000);
}

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
  let bull = 0, bear = 0, wSum = 0, tSum = 0, anyOpen = 0;
  for (const c of COUNTRIES) {
    const s = computeCountry(c);
    c._state = s;
    if (s.trend != null) { s.trend >= 0 ? bull++ : bear++; }
    if (s.open) anyOpen++;
    // global cap-weighted index
    for (const row of s.rows) {
      if (row.chg == null) continue;
      const w = row.cap ? row.cap * (FX[row.cur] || 1) : 1;
      wSum += w; tSum += w * row.chg;
    }
    const m = markers.get(c.id);
    if (m) { const col = new THREE.Color(trendColor(s.trend)); m.mesh.material.color = col; m.halo.material.color = col; }
  }
  const world = wSum ? tSum / wSum : null;

  // header
  $('#worldIdx').textContent = fmtPct(world);
  $('#worldIdx').style.color = trendColor(world);
  $('#breadth').innerHTML = `<span style="color:${UP}">▲ ${bull}</span> &nbsp; <span style="color:${DOWN}">▼ ${bear}</span> &nbsp; <span style="color:${FLAT}">${anyOpen} open</span>`;
  const dot = $('#liveDot');
  dot.className = 'dot ' + (dataLive ? 'ok' : 'warn');
  $('#liveLabel').textContent = dataLive ? 'Live' : 'Reconnecting…';
  $('#updated').textContent = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—';

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
    row.innerHTML =
      `<img class="fl" src="${flag(c.code)}" alt="" loading="lazy"/>` +
      `<span class="cn">${c.name}</span>` +
      `<span class="cdot ${s.open ? 'open' : 'closed'}" title="${s.open ? 'Market open' : 'Market closed'}"></span>` +
      `<span class="ct" style="color:${trendColor(s.trend)}">${fmtPct(s.trend)}</span>`;
    row.onclick = () => selectCountry(c.id, true);
    list.appendChild(row);
  }
}

function renderDetail() {
  const c = COUNTRIES.find((x) => x.id === selectedId); if (!c) return;
  const s = c._state || computeCountry(c);
  $('#dFlag').src = flag(c.code);
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
    tr.innerHTML =
      `<td class="co"><span class="sy">${r.symbol}</span><span class="nm">${r.name}</span></td>` +
      `<td class="pr">${fmtPrice(r.price, r.cur)}</td>` +
      `<td class="cap">${fmtCap(r.cap, r.cur)}</td>` +
      `<td class="ch" style="color:${trendColor(r.chg)}">${fmtPct(r.chg)}</td>`;
    tb.appendChild(tr);
  }
}

function selectCountry(id, focus) {
  selectedId = id;
  const c = COUNTRIES.find((x) => x.id === id);
  if (focus && c) focusCamera(c);
  renderList(); renderDetail();
  if (IS_MOBILE) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadNews() {
  const box = $('#newsList');
  try {
    const r = await fetch('/api/news'); const j = await r.json();
    if (!j.items || !j.items.length) throw new Error('empty');
    box.innerHTML = '';
    for (const it of j.items.slice(0, 18)) {
      const a = el('a', 'nrow'); a.href = it.url || '#'; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = `<div class="nt">${it.title}</div><div class="nm"><span>${it.source}</span>${it.time ? '<span>· ' + it.time + '</span>' : ''}</div>`;
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

// ---- boot -----------------------------------------------------------------
function boot() {
  if (!COUNTRIES.length) { document.body.innerHTML = '<p style="color:#fff;padding:2rem">Dataset failed to load.</p>'; return; }
  applyData();          // instant paint from seed data (list / detail / header)
  renderDetail();
  const cd = startCountdown();
  loadNews();
  // Globe is best-effort; recolor markers once it's ready.
  initGlobe().then(() => applyData());
  loadQuotes().then(() => cd.reset());
  setInterval(() => { loadQuotes().then(() => cd.reset()); }, REFRESH_MS);
  setInterval(loadNews, NEWS_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQuotes(); } });
}

boot();
