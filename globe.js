// globe.js — the realistic, interactive 3D Earth.
//
// Photoreal pipeline: NASA Blue Marble day map + bump-mapped terrain + ocean
// specular, night-side city lights blended in a custom shader across a REAL
// day/night terminator (sun position computed from the current UTC time),
// drifting cloud layer, atmosphere rim, starfield.
//
// Everything degrades gracefully: if a texture fails we keep a stylised
// sphere; if WebGL/module loading fails the caller hides the globe entirely.
import { latLonToXYZ, subsolarPoint, trendColor, fmtPct, FLAT } from './lib/market.mjs';

const TEX = {
  day: 'https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-blue-marble.jpg',
  night: 'https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-night.jpg',
  bump: 'https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-topology.png',
  water: 'https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-water.png',
  clouds: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_clouds_1024.png',
};

const R = 1;                    // globe radius
const MARKER_R = 0.016;         // visible dot
const HIT_R = 0.055;            // invisible, easy-to-tap hit target
const IDLE_RESUME_MS = 12000;   // resume auto-rotate after interaction
const FLY_MS = 900;

export async function createGlobe({ canvas, wrap, countries, onSelect, isMobile, reducedMotion }) {
  let THREE, OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch (e) {
    console.warn('3D globe unavailable (module load), running in data-only mode:', e);
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true });
  } catch (e) {
    console.warn('WebGL init failed, running in data-only mode:', e);
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(-0.9, 0.75, 2.9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 1.45; controls.maxDistance = 4.5;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.7;
  controls.autoRotate = !reducedMotion; controls.autoRotateSpeed = 0.4;

  const vec3 = (ll, r) => { const p = latLonToXYZ(ll.lat, ll.lon, r); return new THREE.Vector3(p.x, p.y, p.z); };

  // ---- earth ----------------------------------------------------------------
  const segments = isMobile ? 48 : 96;
  const earthMat = new THREE.MeshPhongMaterial({
    color: 0x0d2038,             // placeholder ocean tint until the day map lands
    shininess: 22,
    specular: new THREE.Color(0x666a77),
  });

  // Inject night-side city lights into the standard Phong shader. The lights
  // fade in across the terminator (dot(normal, sunDir) in view space).
  const nightUniforms = {
    nightMap: { value: null },
    uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
    uNightBoost: { value: 1.4 },
    uHasNight: { value: 0 },
  };
  earthMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, nightUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform sampler2D nightMap;\nuniform vec3 uSunDirView;\nuniform float uNightBoost;\nuniform float uHasNight;')
      .replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_MAP
          float dayness = smoothstep(-0.12, 0.22, dot(normal, uSunDirView));
          vec3 nightLights = texture2D(nightMap, vMapUv).rgb;
          totalEmissiveRadiance += nightLights * (1.0 - dayness) * uNightBoost * uHasNight;
        #endif`);
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, segments, segments), earthMat);
  scene.add(earth);

  // ---- atmosphere rim ---------------------------------------------------------
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.15, 64, 64),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vN;
        void main(){
          float rim = pow(clamp(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.4);
          gl_FragColor = vec4(0.30, 0.58, 1.0, 1.0) * rim * 1.35;
        }`,
    })
  );
  scene.add(atmo);

  // ---- lights (sun follows the real subsolar point) ---------------------------
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8899bb, 0.28));
  const sunWorld = new THREE.Vector3(1, 0, 0);
  function updateSun() {
    const sp = subsolarPoint(new Date());
    sunWorld.copy(vec3(sp, 1)).normalize();
    sun.position.copy(sunWorld).multiplyScalar(10);
    nightUniforms.uSunDirView.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
  }

  // ---- starfield ---------------------------------------------------------------
  {
    const n = isMobile ? 600 : 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 22 + Math.random() * 34, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(b) * Math.cos(a);
      pos[i * 3 + 1] = r * Math.cos(b);
      pos[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      map: dotTexture(THREE, [255, 255, 255]), color: 0xbfd0e8, size: 0.16,
      transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
  }

  // ---- markers ------------------------------------------------------------------
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  const markers = new Map(); // id -> {dot, halo, hit, base, open}
  const haloTex = glowTexture(THREE);
  for (const c of countries) {
    const base = vec3(c, R * 1.012);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_R, 12, 12),
      new THREE.MeshBasicMaterial({ color: FLAT })
    );
    dot.position.copy(base);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, color: FLAT, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.setScalar(0.11); halo.position.copy(base);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(HIT_R, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(base); hit.userData.id = c.id;
    markerGroup.add(dot, halo, hit);
    markers.set(c.id, { dot, halo, hit, base, open: false, phase: base.x * 7 + base.y * 3 });
  }

  // selection ping ring, re-parented onto the selected marker
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.03, 0.037, 40),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.visible = false;
  scene.add(ring);

  // ---- HTML overlays (tooltip + selected label) -----------------------------------
  const tooltip = overlayEl(wrap, 'gtip');
  const label = overlayEl(wrap, 'glabelPin');
  let hoveredId = null, selectedId = null;
  const states = new Map(); // id -> {trend, open}
  const byId = new Map(countries.map((c) => [c.id, c]));

  function overlayText(elm, id) {
    const c = byId.get(id); if (!c) return;
    const st = states.get(id) || {};
    elm.innerHTML = '';
    const name = document.createElement('b'); name.textContent = c.name;
    const pct = document.createElement('span'); pct.textContent = fmtPct(st.trend);
    pct.style.color = trendColor(st.trend);
    elm.append(name, pct);
  }

  function placeOverlay(elm, id, dy) {
    const m = id && markers.get(id);
    if (!m) { elm.style.opacity = '0'; return; }
    const facing = m.base.clone().normalize().dot(camera.position.clone().normalize());
    if (facing < 0.12) { elm.style.opacity = '0'; return; } // behind the limb
    const p = m.base.clone().project(camera);
    const pad = 14;
    const x = Math.min(wrap.clientWidth - pad, Math.max(pad, (p.x * 0.5 + 0.5) * wrap.clientWidth));
    const y = Math.min(wrap.clientHeight - 6, Math.max(34, (-p.y * 0.5 + 0.5) * wrap.clientHeight - dy));
    elm.style.opacity = '1';
    elm.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // ---- picking ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hitMeshes = [...markers.values()].map((m) => m.hit);

  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // Include the earth so markers hidden BEHIND the globe can't be picked.
    const hit = raycaster.intersectObjects([earth, ...hitMeshes], false)[0];
    return hit && hit.object.userData.id ? hit.object.userData.id : null;
  }

  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Second finger = pinch, not a click.
    downAt = downAt ? null : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    pauseAutoRotate();
    flight = null; // grabbing the globe cancels any fly-to
  });
  renderer.domElement.addEventListener('pointercancel', () => { downAt = null; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || e.pointerId !== downAt.id) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    if (moved < 7 && held < 600) {
      const id = pickAt(e.clientX, e.clientY);
      if (id) onSelect?.(id);
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    hoveredId = pickAt(e.clientX, e.clientY);
    renderer.domElement.style.cursor = hoveredId ? 'pointer' : 'grab';
    if (hoveredId && hoveredId !== selectedId) overlayText(tooltip, hoveredId);
  });
  renderer.domElement.addEventListener('pointerleave', () => { hoveredId = null; });

  let idleTimer = 0;
  function pauseAutoRotate() {
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    if (!reducedMotion) idleTimer = setTimeout(() => { controls.autoRotate = true; }, IDLE_RESUME_MS);
  }

  // ---- camera fly-to -----------------------------------------------------------------
  let flight = null;
  function focus(c) {
    const endDir = vec3(c, 1).normalize();
    const startDir = camera.position.clone().normalize();
    const startDist = camera.position.length();
    // Close-up feel, but never so close that a narrow panel crops the globe
    // (and never past maxDistance, or OrbitControls snaps the camera back).
    const endDist = Math.min(
      Math.max(Math.min(Math.max(startDist, 2.1), 2.6), fitDistance() * 0.9),
      controls.maxDistance
    );
    pauseAutoRotate();
    if (reducedMotion) {
      camera.position.copy(endDir).multiplyScalar(endDist);
      camera.lookAt(0, 0, 0);
      return;
    }
    flight = {
      t0: performance.now(),
      startDir, startDist, endDist,
      q: new THREE.Quaternion().setFromUnitVectors(startDir, endDir),
      qt: new THREE.Quaternion(),
    };
  }

  function stepFlight(now) {
    if (!flight) return;
    const k = Math.min(1, (now - flight.t0) / FLY_MS);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    flight.qt.identity().slerp(flight.q, e);
    const dir = flight.startDir.clone().applyQuaternion(flight.qt);
    camera.position.copy(dir).multiplyScalar(flight.startDist + (flight.endDist - flight.startDist) * e);
    camera.lookAt(0, 0, 0);
    if (k >= 1) flight = null;
  }

  // ---- textures (progressive, best-effort) --------------------------------------------
  const loader = new THREE.TextureLoader();
  const load = (url) => new Promise((res) => loader.load(url, (t) => res(t), undefined, () => res(null)));
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 1;

  load(TEX.day).then((day) => {
    if (!day) {
      console.warn('day texture failed to load — keeping stylised globe');
      return addFallbackGrid();
    }
    day.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = Math.min(8, maxAniso);
    earthMat.map = day;
    earthMat.color.set(0xffffff);
    earthMat.needsUpdate = true;
    // Night lights reuse the day map's UV channel (USE_MAP), so only load
    // them once the day map is actually in place.
    load(TEX.night).then((t) => {
      if (!t) return;
      t.colorSpace = THREE.SRGBColorSpace;
      nightUniforms.nightMap.value = t;
      nightUniforms.uHasNight.value = 1;
    });
  });
  load(TEX.bump).then((t) => {
    if (!t) return;
    earthMat.bumpMap = t; earthMat.bumpScale = 0.5; earthMat.needsUpdate = true;
  });
  load(TEX.water).then((t) => {
    if (!t) return;
    earthMat.specularMap = t; earthMat.needsUpdate = true;
  });
  let clouds = null;
  load(TEX.clouds).then((t) => {
    if (!t) return;
    t.colorSpace = THREE.SRGBColorSpace;
    clouds = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.008, segments, segments),
      new THREE.MeshLambertMaterial({ map: t, transparent: true, opacity: 0.85, depthWrite: false })
    );
    scene.add(clouds);
  });

  // Old stylised look as a fallback so a blocked CDN still looks intentional.
  function addFallbackGrid() {
    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(R * 1.001, 24, 16)),
      new THREE.LineBasicMaterial({ color: 0x1e4a6e, transparent: true, opacity: 0.35 })
    );
    scene.add(grid);
  }

  // ---- sizing / lifecycle ---------------------------------------------------------------
  // Distance at which the whole globe fits the panel with a small margin.
  function fitDistance() {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * (w / h));
    return (R * 1.12) / Math.sin(Math.min(vHalf, hHalf));
  }
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // On layout changes (orientation, panel resize) keep the globe in frame;
    // pinch/scroll zoom is untouched because it never triggers a resize.
    // Very tall/narrow panels need more distance than the default zoom-out
    // limit, so grow maxDistance too or OrbitControls would snap us back.
    const fd = fitDistance();
    controls.maxDistance = Math.max(4.5, fd);
    if (!flight && camera.position.length() < fd) {
      camera.position.normalize().multiplyScalar(fd);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    tooltip.style.display = 'none'; // render loop stops; don't strand overlays
    label.style.display = 'none';
    wrap.classList.add('noglobe');
  });

  // ---- render loop -----------------------------------------------------------------------
  let t = 0, last = performance.now();
  (function loop(now = performance.now()) {
    if (lost) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt;

    updateSun();
    if (clouds && !reducedMotion) clouds.rotation.y += dt * 0.006;

    for (const [id, m] of markers) {
      const pulse = !reducedMotion && m.open ? 1.25 + 0.3 * Math.sin(t * 2.4 + m.phase) : 1.05;
      m.halo.scale.setScalar(0.11 * pulse);
      const boost = id === selectedId ? 1.55 : id === hoveredId ? 1.35 : 1;
      m.dot.scale.setScalar(boost);
    }
    if (ring.visible) {
      const k = reducedMotion ? 0.5 : (t % 1.6) / 1.6;
      ring.scale.setScalar(1 + k * 1.1);
      ring.material.opacity = 0.85 * (1 - k);
    }

    stepFlight(now);
    if (!flight) controls.update();
    placeOverlay(tooltip, hoveredId && hoveredId !== selectedId ? hoveredId : null, 14);
    placeOverlay(label, selectedId, 16);
    renderer.render(scene, camera);
  })();

  // ---- public handle -----------------------------------------------------------------------
  return {
    setStates(map) {
      for (const [id, st] of map) {
        states.set(id, st);
        const m = markers.get(id); if (!m) continue;
        m.open = !!st.open;
        const col = new THREE.Color(trendColor(st.trend));
        m.dot.material.color.copy(col);
        m.halo.material.color.copy(col);
      }
      if (selectedId) overlayText(label, selectedId);
    },
    setSelected(id) {
      selectedId = id;
      const m = markers.get(id);
      if (m) {
        ring.visible = true;
        ring.position.copy(m.base);
        ring.lookAt(m.base.clone().multiplyScalar(2));
        ring.material.color.set(trendColor((states.get(id) || {}).trend));
        overlayText(label, id);
      } else {
        ring.visible = false;
      }
    },
    focus,
  };
}

// soft round dot (stars)
function dotTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// bright-core glow (marker halos)
function glowTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function overlayEl(wrap, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.opacity = '0';
  wrap.appendChild(d);
  return d;
}
