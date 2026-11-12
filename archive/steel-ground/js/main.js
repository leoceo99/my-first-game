import { Game } from './game.js';
import { Renderer } from './render.js';
import { AudioEngine } from './audio.js';
import { SQUADS, BARRAGE, POP_CAP, TYPES, SUPPLY_BASE, SUPPLY_PER_POINT } from './data.js';
import { W, H, HQ } from './map.js';
import { clamp, dist } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const audio = new AudioEngine();
const renderer = new Renderer(canvas);

let state = 'menu';
let paused = false;
let difficulty = 'normal';
let game = new Game({ demo: true, seed: 1944 });
const cam = { x: W / 2, y: H / 2, zoom: 0.8 };
let menuT = 0;
let mode = null; // 'barrage'
let engageMove = true;
let endShownAt = 0;

window.__steel = { get game() { return game; }, cam, get state() { return state; } };

// ---------------------------------------------------------------- camera
function zoomLimits() {
  return { min: Math.max(renderer.w / W, renderer.h / H, 0.3), max: 2.4 };
}
function clampCam() {
  const { min, max } = zoomLimits();
  cam.zoom = clamp(cam.zoom, min, max);
  const hw = renderer.w / 2 / cam.zoom, hh = renderer.h / 2 / cam.zoom;
  cam.x = hw * 2 >= W ? W / 2 : clamp(cam.x, hw, W - hw);
  cam.y = hh * 2 >= H ? H / 2 : clamp(cam.y, hh, H - hh);
}
function toWorld(sx, sy) { return renderer.toWorld(cam, sx, sy); }

window.addEventListener('resize', () => { renderer.resize(); clampCam(); layoutMinimap(); });

// ---------------------------------------------------------------- menu
document.querySelectorAll('#diffSeg button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#diffSeg button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    difficulty = b.dataset.d;
    audio.unlock(); audio.play('click');
  });
});
$('btnStart').addEventListener('click', () => { audio.unlock(); startGame(); });
$('btnHow').addEventListener('click', () => { audio.unlock(); show('howto'); });
$('btnHow2').addEventListener('click', () => show('howto'));
$('btnHowClose').addEventListener('click', () => hide('howto'));
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnRestart').addEventListener('click', () => { hide('pauseMenu'); startGame(); });
$('btnQuit').addEventListener('click', () => toMenu());
$('btnAgain').addEventListener('click', () => { hide('endMenu'); startGame(); });
$('btnMenu').addEventListener('click', () => toMenu());
$('btnPause').addEventListener('click', () => setPaused(!paused));
$('btnMute').addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  $('btnMute').style.opacity = audio.muted ? 0.4 : 1;
});

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function startGame() {
  game = new Game({ audio, difficulty, seed: 1944 });
  state = 'play';
  paused = false;
  mode = null;
  endShownAt = 0;
  hide('menu'); hide('pauseMenu'); hide('endMenu'); hide('modeHint');
  show('hud');
  layoutMinimap();
  cam.zoom = 1.1;
  cam.x = HQ[0].x + 380; cam.y = HQ[0].y - 300;
  clampCam();
  $('toasts').innerHTML = '';
  toast('작전 개시 — 거점을 점령하라!', 'info');
}
function toMenu() {
  state = 'menu';
  paused = false;
  game = new Game({ demo: true, seed: 1944 });
  hide('hud'); hide('pauseMenu'); hide('endMenu'); show('menu');
  cam.zoom = 0.8;
}
function setPaused(p) {
  if (state !== 'play' || game.over) return;
  paused = p;
  if (p) show('pauseMenu'); else hide('pauseMenu');
}
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setPaused(true); });

// ---------------------------------------------------------------- deploy panel
const ICONS = {
  rifle: '<svg viewBox="0 0 34 24"><g fill="currentColor"><circle cx="8" cy="12" r="4"/><circle cx="17" cy="9" r="4"/><circle cx="26" cy="12" r="4"/></g><g stroke="currentColor" stroke-width="1.6"><path d="M8 16v5M17 13v8M26 16v5"/></g></svg>',
  mg: '<svg viewBox="0 0 34 24"><circle cx="9" cy="12" r="4.5" fill="currentColor"/><path d="M12 13h19M27 13l2 5M27 13l-2 5" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>',
  at: '<svg viewBox="0 0 34 24"><circle cx="9" cy="14" r="4.5" fill="currentColor"/><path d="M4 9h24" stroke="currentColor" stroke-width="3.4"/><path d="M28 6l4 3-4 3z" fill="currentColor"/></svg>',
  mortar: '<svg viewBox="0 0 34 24"><path d="M10 20L24 4" stroke="currentColor" stroke-width="3.4"/><ellipse cx="11" cy="20" rx="7" ry="2.5" fill="currentColor"/><path d="M16 14l4 6" stroke="currentColor" stroke-width="1.5"/></svg>',
  tank: '<svg viewBox="0 0 34 24"><rect x="2" y="5" width="22" height="3" rx="1" fill="currentColor"/><rect x="2" y="16" width="22" height="3" rx="1" fill="currentColor"/><rect x="3" y="7" width="20" height="10" rx="2" fill="currentColor" opacity=".7"/><rect x="8" y="8.5" width="9" height="7" rx="2" fill="currentColor"/><rect x="16" y="11" width="16" height="2" fill="currentColor"/></svg>',
  barrage: '<svg viewBox="0 0 34 24"><circle cx="17" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 1v6M17 17v6M6 12h6M22 12h6" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="12" r="2" fill="currentColor"/></svg>',
};
const deployBtns = {};
const grid = $('deployGrid');
SQUADS.forEach((s, i) => {
  const b = document.createElement('button');
  b.className = 'dbtn';
  b.innerHTML = `${ICONS[s.key]}<span class="nm">${s.name}</span><span class="cs">${s.cost}</span><span class="q hidden"></span><i class="prog"></i>`;
  b.title = `${s.name} — ${s.desc} (${i + 1})`;
  b.addEventListener('click', () => requestDeploy(s.key));
  grid.appendChild(b);
  deployBtns[s.key] = b;
});
const barrageBtn = document.createElement('button');
barrageBtn.className = 'dbtn barrage';
barrageBtn.innerHTML = `${ICONS.barrage}<span class="nm">포병 지원</span><span class="cs">${BARRAGE.cost}</span><span class="cd hidden"></span>`;
barrageBtn.title = '포병 지원 사격 (B)';
barrageBtn.addEventListener('click', () => toggleBarrage());
grid.appendChild(barrageBtn);
$('btnCancelMode').addEventListener('click', () => setMode(null));

function requestDeploy(key) {
  if (state !== 'play' || paused) return;
  audio.unlock();
  const r = game.deploy(0, key);
  if (r === true) audio.play('click');
  else {
    audio.play('denied');
    toast(r === 'supply' ? '보급이 부족합니다' : r === 'pop' ? `병력 한도(${POP_CAP}) 초과` : '대기열이 가득 찼습니다', 'bad');
  }
}
function toggleBarrage() {
  if (state !== 'play' || paused) return;
  audio.unlock();
  if (mode === 'barrage') return setMode(null);
  const tm = game.teams[0];
  if (tm.barrageCd > 0) { audio.play('denied'); return toast(`포병 재장전 중 (${Math.ceil(tm.barrageCd)}초)`, 'bad'); }
  if (tm.supply < BARRAGE.cost) { audio.play('denied'); return toast('보급이 부족합니다', 'bad'); }
  setMode('barrage');
}
function setMode(m) {
  mode = m;
  $('modeHint').classList.toggle('hidden', m !== 'barrage');
  barrageBtn.classList.toggle('active', m === 'barrage');
}

// ---------------------------------------------------------------- selection panel
$('btnAll').addEventListener('click', () => {
  game.selection.clear();
  for (const u of game.units) if (u.team === 0 && !u.def.static) game.selection.add(u);
  audio.play('click');
});
$('btnClear').addEventListener('click', () => { game.selection.clear(); audio.play('click'); });
$('btnStop').addEventListener('click', () => { game.stop([...game.selection]); audio.play('click'); });
$('btnEngage').addEventListener('click', () => {
  engageMove = !engageMove;
  $('btnEngage').classList.toggle('on', engageMove);
  $('btnEngage').textContent = engageMove ? '교전 이동' : '강행 이동';
  toast(engageMove ? '교전 이동: 적을 만나면 멈춰서 싸웁니다' : '강행 이동: 적을 무시하고 목표까지 이동합니다', 'info');
});

// ---------------------------------------------------------------- toasts
function toast(text, tone = 'info') {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

// ---------------------------------------------------------------- commands
function commandAt(w, target) {
  const sel = [...game.selection].filter((u) => u.alive);
  if (!sel.length) return false;
  if (target && target.team === 1) {
    game.issueOrder(sel, target.x, target.y, 'attack', target);
    game.addMarker('attack', target.x, target.y);
  } else {
    game.issueOrder(sel, w.x, w.y, engageMove ? 'amove' : 'move');
    game.addMarker('move', w.x, w.y);
  }
  audio.play('order');
  return true;
}

let lastTap = { t: 0, type: null };
function handleTap(sx, sy, { mouse = false, button = 0, shift = false } = {}) {
  if (state !== 'play' || paused) return;
  const w = toWorld(sx, sy);
  if (mode === 'barrage') {
    if (game.callBarrage(0, w.x, w.y)) audio.play('order');
    else { audio.play('denied'); toast('포병 지원을 요청할 수 없습니다', 'bad'); }
    setMode(null);
    return;
  }
  const tol = Math.max(10, 18 / cam.zoom);
  const u = game.unitAt(w.x, w.y, tol, (v) => v.team === 0 || v.seen[0]);
  if (mouse && button === 2) { commandAt(w, u); return; }
  if (u && u.team === 0) {
    const now = performance.now();
    const dbl = now - lastTap.t < 350 && lastTap.type === u.type;
    lastTap = { t: now, type: u.type };
    if (!shift) game.selection.clear();
    if (dbl) {
      const v0 = toWorld(0, 0), v1 = toWorld(renderer.w, renderer.h);
      for (const v of game.units) if (v.team === 0 && v.type === u.type && v.x > v0.x && v.x < v1.x && v.y > v0.y && v.y < v1.y) game.selection.add(v);
    } else {
      for (const v of game.units) if (v.team === 0 && v.squad === u.squad && !v.def.static) game.selection.add(v);
    }
    audio.play('click');
    return;
  }
  if (u && u.team === 1) { commandAt(w, u); return; }
  if (mouse) { if (!shift) game.selection.clear(); return; }
  if (!commandAt(w, null)) {
    // nothing selected: tapping empty ground does nothing
  }
}

function boxSelect(b, add) {
  const a = toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
  const c = toWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
  if (!add) game.selection.clear();
  for (const u of game.units) {
    if (u.team === 0 && !u.def.static && u.x >= a.x && u.x <= c.x && u.y >= a.y && u.y <= c.y) game.selection.add(u);
  }
  if (game.selection.size) audio.play('click');
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let gesture = null;
let box = null;
let hold = null;
let single = null; // { id, sx, sy, x, y, mouse, button, moved, panning, boxing, t }

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (state !== 'play') return;
  if (pointers.size === 2) {
    single = null; box = null; hold = null;
    const [p1, p2] = [...pointers.values()];
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
    gesture = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, zoom: cam.zoom, w: toWorld(cx, cy) };
    return;
  }
  if (pointers.size > 2) return;
  const mouse = e.pointerType === 'mouse';
  single = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, mouse, button: e.button, moved: false, panning: false, boxing: false, t: performance.now(), shift: e.shiftKey };
  if (!mouse) hold = { x: e.clientX, y: e.clientY, k: 0, t0: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (state !== 'play') return;
  if (gesture && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()];
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
    const { min, max } = zoomLimits();
    cam.zoom = clamp((gesture.zoom * d) / gesture.d, min, max);
    cam.x = gesture.w.x - (cx - renderer.w / 2) / cam.zoom;
    cam.y = gesture.w.y - (cy - renderer.h / 2) / cam.zoom;
    clampCam();
    return;
  }
  const s = single;
  if (!s || s.id !== e.pointerId) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  const total = Math.hypot(e.clientX - s.sx, e.clientY - s.sy);
  if (!s.moved && total > (s.mouse ? 5 : 10)) {
    s.moved = true;
    if (s.mouse) {
      if (s.button === 0) s.boxing = true; else s.panning = true;
    } else {
      if (hold && hold.k >= 1) s.boxing = true; else s.panning = true;
      hold = null;
    }
    if (s.boxing) box = { x0: s.sx, y0: s.sy, x1: e.clientX, y1: e.clientY };
  }
  if (s.panning) {
    cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom;
    clampCam();
  } else if (s.boxing && box) {
    box.x1 = e.clientX; box.y1 = e.clientY;
  }
  s.x = e.clientX; s.y = e.clientY;
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (state !== 'play') { single = null; gesture = null; return; }
  if (gesture) {
    if (pointers.size < 2) gesture = null;
    single = null;
    return;
  }
  const s = single;
  if (s && s.id === e.pointerId) {
    if (e.type === 'pointerup') {
      if (s.boxing && box) boxSelect(box, s.shift);
      else if (!s.moved) {
        if (!s.mouse && hold && hold.k >= 1) { /* long press without drag: select squad under finger */ handleTap(s.sx, s.sy, { mouse: false, shift: true }); }
        else handleTap(s.sx, s.sy, { mouse: s.mouse, button: s.button, shift: s.shift });
      }
    }
    single = null; box = null; hold = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state !== 'play') return;
  const before = toWorld(e.clientX, e.clientY);
  const { min, max } = zoomLimits();
  cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0015), min, max);
  cam.x = before.x - (e.clientX - renderer.w / 2) / cam.zoom;
  cam.y = before.y - (e.clientY - renderer.h / 2) / cam.zoom;
  clampCam();
}, { passive: false });

// prevent iOS page zoom / bounce
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.target === canvas || e.target.id === 'minimap') e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- minimap
const mm = $('minimap');
const mctx = mm.getContext('2d');
function layoutMinimap() {
  const r = mm.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mm.width = Math.max(1, Math.round(r.width * dpr));
  mm.height = Math.max(1, Math.round(r.height * dpr));
}
function minimapJump(e) {
  const r = mm.getBoundingClientRect();
  cam.x = ((e.clientX - r.left) / r.width) * W;
  cam.y = ((e.clientY - r.top) / r.height) * H;
  clampCam();
}
let mmDrag = false;
mm.addEventListener('pointerdown', (e) => { mm.setPointerCapture(e.pointerId); mmDrag = true; minimapJump(e); });
mm.addEventListener('pointermove', (e) => { if (mmDrag) minimapJump(e); });
mm.addEventListener('pointerup', () => { mmDrag = false; });
mm.addEventListener('pointercancel', () => { mmDrag = false; });

// ---------------------------------------------------------------- keyboard
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (state !== 'play') return;
  if (e.key === 'Escape') { if (mode) setMode(null); else setPaused(!paused); }
  if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  if (paused) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= SQUADS.length) requestDeploy(SQUADS[n - 1].key);
  if (e.key.toLowerCase() === 'b') toggleBarrage();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); $('btnAll').click(); }
  if (e.key.toLowerCase() === 'h') { game.stop([...game.selection]); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function keyPan(dt) {
  const sp = 900 / cam.zoom * dt;
  if (keys.has('w') || keys.has('arrowup')) cam.y -= sp;
  if (keys.has('s') || keys.has('arrowdown')) cam.y += sp;
  if (keys.has('a') || keys.has('arrowleft')) cam.x -= sp;
  if (keys.has('d') || keys.has('arrowright')) cam.x += sp;
  clampCam();
}

// ---------------------------------------------------------------- HUD
const flagsEl = $('flags');
const flagEls = game.points.map((p) => {
  const d = document.createElement('div');
  d.className = 'flag';
  d.innerHTML = `${p.id}<i></i>`;
  d.title = p.name;
  flagsEl.appendChild(d);
  d.addEventListener('click', () => { const q = game.points.find((x) => x.id === p.id); cam.x = q.x; cam.y = q.y; clampCam(); });
  return d;
});
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.1;
  const g = game, t0 = g.teams[0], t1 = g.teams[1];
  $('tk0').style.width = (100 * t0.tickets / 500) + '%';
  $('tk1').style.width = (100 * t1.tickets / 500) + '%';
  $('tk0n').textContent = Math.max(0, Math.ceil(t0.tickets));
  $('tk1n').textContent = Math.max(0, Math.ceil(t1.tickets));
  g.points.forEach((p, i) => {
    const el = flagEls[i];
    el.className = 'flag' + (p.owner === 0 ? ' o0' : p.owner === 1 ? ' o1' : '') + (p.contested ? ' contested' : '');
    const bar = el.firstElementChild;
    bar.style.width = Math.abs(p.progress) + '%';
    bar.style.background = p.progress > 0 ? 'var(--blue)' : 'var(--red)';
  });
  $('supply').textContent = Math.floor(t0.supply);
  $('income').textContent = `+${(SUPPLY_BASE + SUPPLY_PER_POINT * g.ownedPoints(0)).toFixed(1)}/s`;
  const pop = g.pop(0);
  $('pop').textContent = pop;
  const m = Math.floor(g.time / 60), s = Math.floor(g.time % 60);
  $('clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  for (const sq of SQUADS) {
    const b = deployBtns[sq.key];
    const can = game.canDeploy(0, sq);
    b.classList.toggle('off', can !== true);
    const queued = t0.queue.filter((q) => q.def.key === sq.key).length;
    const qEl = b.querySelector('.q');
    qEl.classList.toggle('hidden', !queued);
    qEl.textContent = queued;
    const head = t0.queue[0];
    b.querySelector('.prog').style.width = head && head.def.key === sq.key ? `${100 * (1 - head.t / head.def.time)}%` : '0';
  }
  barrageBtn.classList.toggle('off', t0.barrageCd > 0 || t0.supply < BARRAGE.cost);
  const cd = barrageBtn.querySelector('.cd');
  cd.classList.toggle('hidden', t0.barrageCd <= 0);
  cd.textContent = Math.ceil(t0.barrageCd);

  const sel = [...g.selection].filter((u) => u.alive);
  if (!sel.length) $('selInfo').innerHTML = '선택된 부대 없음 · 아군을 탭하세요';
  else {
    const counts = {};
    for (const u of sel) counts[u.type] = (counts[u.type] || 0) + 1;
    $('selInfo').innerHTML = Object.entries(counts).map(([k, n]) => `${TYPES[k].name} <b>×${n}</b>`).join(' · ');
  }
}

// ---------------------------------------------------------------- end screen
function showEnd() {
  const g = game, win = g.winner === 0;
  $('endTitle').textContent = win ? '승리' : '패배';
  $('endTitle').className = win ? 'win' : 'lose';
  $('endKicker').textContent = win ? '적 전선 붕괴' : '아군 전선 붕괴';
  const m = Math.floor(g.time / 60), s = Math.floor(g.time % 60);
  $('endStats').innerHTML = [
    ['작전 시간', `${m}분 ${s}초`],
    ['보유 거점', `${g.ownedPoints(0)} / 5`],
    ['적 격파', g.teams[0].kills],
    ['아군 손실', g.teams[0].losses],
  ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  show('endMenu');
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
layoutMinimap();
clampCam();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'menu') {
    menuT += dt;
    game.update(dt);
    cam.zoom = Math.max(zoomLimits().min, 0.85);
    cam.x = W / 2 + Math.sin(menuT * 0.05) * 600;
    cam.y = H / 2 + Math.cos(menuT * 0.037) * 300;
    clampCam();
    game.camRef = cam;
    renderer.draw(game, cam);
  } else {
    if (!paused) {
      game.update(dt);
      keyPan(dt);
    }
    game.camRef = cam;
    audio.setListener(cam.x, cam.y, cam.zoom);
    if (hold && single && !single.moved) {
      hold.k = (now - hold.t0) / 350;
    }
    renderer.draw(game, cam, { box, hold: hold && hold.k > 0.15 ? hold : null });
    renderer.drawMinimap(game, mctx, cam, mm.width, mm.height);
    while (game.events.length) {
      const ev = game.events.shift();
      toast(ev.text, ev.tone);
    }
    updateHUD(dt);
    if (game.over && !endShownAt) endShownAt = now;
    if (endShownAt && now - endShownAt > 2500 && $('endMenu').classList.contains('hidden')) showEnd();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
