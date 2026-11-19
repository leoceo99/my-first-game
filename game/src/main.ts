import * as THREE from 'three';
import { buildDummy, buildWorld, DUMMY } from './engine/world';
import { buildRig, BLADE_BASE, BLADE_TIP } from './engine/rig';
import { CameraRig } from './engine/camera';
import { Input, isTyping } from './engine/input';
import { TalkUI } from './engine/talk';
import { SCENES } from './sim/dialogue/data';
import { Sfx } from './engine/audio';
import { BladeTrail } from './engine/trail';
import { FpsMeter } from './sim/fps';
import { PerfRecorder } from './sim/perf';
import { AutoQuality, nextQuality, pickQuality, QUALITY, QUALITY_LEVELS, type QualityLevel } from './sim/quality';
import { BenchRun } from './sim/bench';
import { applyQuality } from './engine/quality';
import { clampPitch, makePlayer, speedOf, stepPlayer, WALK_SPEED, type PlayerState } from './sim/player';
import { advanceGait, gaitPhase, newGait, runBlend } from './sim/gait';
import { locomotionPose, type Vec3 } from './sim/pose';
import { surfaceAt, type Surface } from './sim/surface';
import { advanceAttack, bladeSweepHits, guardPose, inHitWindow, sampleClip, startOrQueue, type AttackState, type SwordSet } from './sim/sword';
import { deserialize, serialize } from './sim/save';
import { t, type StringTable } from './sim/strings';
import ko from '../data/strings/ko.json';
import swordData from '../data/combat/longsword_basic.json';

const S = ko as StringTable;
const SWORD = swordData as unknown as SwordSet;
const $ = (id: string) => document.getElementById(id)!;
const app = $('app');

// ── 화질 단계 (E-1): 주소의 ?q=low|medium|high → 저장한 선택 → 기본(보통)
const QUALITY_KEY = 'proto.quality';
const params = new URLSearchParams(location.search);
let savedQuality: string | null = null;
try { savedQuality = localStorage.getItem(QUALITY_KEY); } catch { /* 막힘 */ }
const picked = pickQuality(params.get('q'), savedQuality);
let quality: QualityLevel = picked.level;
const startAntialias = QUALITY[quality].antialias;
// 직접 고른 적이 없으면 느릴 때 한 단계씩 자동으로 낮춘다
const auto = new AutoQuality(picked.source === 'default' && !params.has('bench'));

// ── 화면 준비
const renderer = new THREE.WebGLRenderer({ antialias: startAntialias, preserveDrawingBuffer: true });
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(62, app.clientWidth / app.clientHeight, 0.05, 150);
const obstacles = buildWorld(scene);
const dummy = buildDummy(scene);
obstacles.push(dummy.obstacle);
const hero = buildRig();
scene.add(hero.root);
// 대화 시험 장면의 장로 (E-2): 우물 광장 서쪽. 임시로 주인공과 같은 몸을 쓴다
const ELDER = { x: -2.6, z: 6.4, yaw: -2.3 };
const elder = buildRig();
elder.root.position.set(ELDER.x, 0, ELDER.z);
elder.root.rotation.y = ELDER.yaw;
elder.root.scale.setScalar(0.95);
scene.add(elder.root);
obstacles.push({ kind: 'circle', x: ELDER.x, z: ELDER.z, r: 0.35 });
const rig = new CameraRig(cam);
const trail = new BladeTrail(scene);
const sfx = new Sfx();
applyQuality(renderer, scene, QUALITY[quality], app.clientWidth, app.clientHeight);
window.addEventListener('resize', () => {
  cam.aspect = app.clientWidth / app.clientHeight;
  cam.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
});

// ── 상태
let player: PlayerState = makePlayer(0, 2, 0, 0.12);
let gait = newGait();
let swordDrawn = false;
let attack: AttackState | null = null;
let jumpPressed = false;
let hits = 0;
const steps: Record<Surface, number> = { grass: 0, dirt: 0, stone: 0 };
const SAVE_KEY = 'proto.save.slot1';
let memorySave: string | null = null; // 브라우저 저장소가 막힌 경우의 임시 보관

// ── 글자
const text = (el: string, id: string) => { $(el).textContent = t(S, id); };
text('title', 'ui.proto.title');
text('help', 'ui.proto.help');
text('help-touch', 'ui.proto.help_touch');
text('btn-camera', 'ui.proto.btn_camera');
text('btn-save', 'ui.proto.btn_save');
text('btn-load', 'ui.proto.btn_load');
text('btn-jump', 'ui.proto.btn_jump');
text('btn-sword', 'ui.proto.btn_sword');
text('btn-cut1', 'combat.cut.oberhau');
text('btn-cut2', 'combat.cut.mittelhau');
text('btn-cut3', 'combat.cut.unterhau');
text('btn-bench', 'ui.perf.btn_bench');
const showQuality = () => text('btn-quality', `ui.perf.quality_${quality}`);
showQuality();
const showCam = () => text('camera', rig.mode === 'first' ? 'ui.proto.camera_first' : 'ui.proto.camera_third');
const showSound = () => text('btn-sound', sfx.muted ? 'ui.proto.sound_off' : 'ui.proto.sound_on');
showCam();
showSound();
let toastTimer = 0;
function toast(id: string, vars: Record<string, string | number> = {}) {
  const el = $('toast');
  el.textContent = t(S, id, vars);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
}

// ── 화질 바꾸기 · 성능 측정
function setQuality(l: QualityLevel, remember: boolean) {
  quality = l;
  applyQuality(renderer, scene, QUALITY[l], app.clientWidth, app.clientHeight);
  showQuality();
  perf.reset();
  if (remember) {
    auto.enabled = false; // 직접 골랐으면 자동 낮춤을 끈다
    try { localStorage.setItem(QUALITY_KEY, l); } catch { /* 막힘: 이번에만 적용 */ }
    // 계단 현상 줄이기는 새로 고침해야 바뀐다
    toast(QUALITY[l].antialias !== startAntialias ? 'ui.perf.quality_reload' : 'ui.perf.quality_changed');
  }
}
let bench: BenchRun | null = null;
let benchReturn: { level: QualityLevel; player: PlayerState } | null = null;
function startBench() {
  if (bench && !bench.done) return;
  $('bench').hidden = true;
  benchReturn = { level: quality, player };
  bench = new BenchRun(QUALITY_LEVELS, Number(params.get('warm') ?? 1.5), Number(params.get('secs') ?? 6));
  attack = null;
  player = makePlayer(0, 6, 0, 0.12); // 마을 한가운데, 집과 우물이 다 보이는 자리
  setQuality(bench.current()!.level, false);
}
function finishBench(b: BenchRun) {
  const rows = b.results.map((r) => t(S, 'ui.perf.bench_row', {
    level: t(S, `ui.perf.level_${r.level}`), avg: r.avgFps, low: r.low1Fps, ms: r.p95Ms, draw: r.drawCalls,
    tri: Math.round(r.triangles / 100) / 10,
  }));
  $('bench-title').textContent = t(S, 'ui.perf.bench_done');
  $('bench-rows').textContent = rows.join('\n');
  $('bench-note').textContent = t(S, 'ui.perf.bench_note');
  $('bench').hidden = false;
  (window as unknown as { __bench: object }).__bench = { results: b.results, dpr: window.devicePixelRatio, gpu: gpuName() };
  if (benchReturn) { player = benchReturn.player; setQuality(benchReturn.level, false); benchReturn = null; }
}
function gpuName(): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

// ── 저장 / 불러오기
function save() {
  const data = serialize({ savedAt: new Date().toISOString(), player: { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch }, camera: rig.mode });
  try { localStorage.setItem(SAVE_KEY, data); memorySave = data; toast('ui.proto.saved'); }
  catch { memorySave = data; toast('ui.proto.saved_memory'); }
}
function load() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* 막힘 */ }
  const data = deserialize(raw ?? memorySave);
  if (!data) return toast('ui.proto.no_save');
  const p = data.player;
  player = makePlayer(p.x, p.z, p.yaw, p.pitch);
  attack = null;
  if (rig.mode !== data.camera) { rig.toggle(); showCam(); }
  toast('ui.proto.loaded');
}

// ── 행동
function toggleSword() {
  if (attack) return;
  swordDrawn = !swordDrawn;
  sfx.draw();
}
function doAttack(id: string) {
  if (!swordDrawn) { swordDrawn = true; sfx.draw(); }
  attack = startOrQueue(attack, SWORD, id);
}

// ── 대화
const talk = new TalkUI(SCENES[0], S, toast);
const nearElder = () => Math.hypot(player.x - ELDER.x, player.z - ELDER.z) < 2.4;
function startTalk() { if (nearElder() && !talk.isOpen && !(bench && !bench.done)) { attack = null; talk.open(); } }
$('talk-prompt').textContent = t(S, 'ui.talk.prompt');
$('talk-prompt').addEventListener('click', startTalk);
window.addEventListener('keydown', (e) => {
  if (isTyping(e)) { if (e.code === 'Escape') talk.close(); return; }
  if (e.code === 'KeyE' && !e.repeat) startTalk();
  if (e.code === 'Escape') talk.close();
});

// ── 입력
const input = new Input(renderer.domElement);
input.onFirstInput = () => sfx.unlock();
input.onToggleCamera = () => { rig.toggle(); showCam(); };
input.onSave = save;
input.onLoad = load;
input.onJump = () => { jumpPressed = true; };
input.onAttack = doAttack;
input.onToggleSword = toggleSword;
const tap = (id: string, fn: () => void) => $(id).addEventListener('click', (e) => { e.preventDefault(); sfx.unlock(); fn(); });
tap('btn-camera', input.onToggleCamera);
tap('btn-save', save);
tap('btn-load', load);
tap('btn-jump', () => { jumpPressed = true; });
tap('btn-sword', toggleSword);
tap('btn-cut1', () => doAttack('oberhau'));
tap('btn-cut2', () => doAttack('mittelhau'));
tap('btn-cut3', () => doAttack('unterhau'));
tap('btn-sound', () => { sfx.setMuted(!sfx.muted); showSound(); });
tap('btn-quality', () => setQuality(nextQuality(quality), true));
tap('btn-bench', startBench);
tap('bench-close', () => { $('bench').hidden = true; });
window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  if (e.code === 'KeyQ' && !e.repeat) setQuality(nextQuality(quality), true);
  if (e.code === 'KeyB' && !e.repeat) startBench();
});

// ── 개발용: 자동 테스트가 주인공을 옮길 때 쓴다
(window as any).__dev = {
  setPlayer(x: number, z: number, yaw: number) { player = makePlayer(x, z, yaw, 0.12); gait = newGait(); },
  setQuality(l: QualityLevel) { setQuality(l, false); },
  startBench,
  talk: () => talk.debug(),
};

// ── 반복
const meter = new FpsMeter();
const perf = new PerfRecorder(600); // 최근 약 10초(60fps 기준)
let last = performance.now();
let frames = 0;
let elapsed = 0;
const bladeBase = new THREE.Vector3(), bladeTip = new THREE.Vector3();
let prevBase: Vec3 | null = null, prevTip: Vec3 | null = null;
const toV = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function loop(now: number) {
  const frameMs = now - last;
  const dt = Math.min(0.05, frameMs / 1000);
  last = now;
  if (frames > 0) perf.add(frameMs);
  elapsed += dt;

  // 시점
  const [lx, ly] = input.consumeLook();
  player.yaw -= lx * 0.004;
  player.pitch = clampPitch(player.pitch + ly * 0.004);

  // 이동 (공격 중에는 느리게, 공격 중 점프 불가)
  let mv = input.move();
  if (talk.isOpen) mv = { forward: 0, strafe: 0, run: false }; // 대화 중에는 멈춘다
  // 성능 측정 중: 입력 대신 정해진 동작(천천히 걸으며 한 바퀴)
  const step = bench?.current() ?? null;
  if (step) { player.yaw = step.yaw; player.pitch = 0.12; mv = { ...mv, forward: step.phase === 'measure' ? 0.35 : 0, strafe: 0, run: false }; }
  const before = player;
  player = stepPlayer(player, { ...mv, jump: jumpPressed && !attack, speedScale: attack ? 0.25 : swordDrawn ? 0.8 : 1 }, dt, obstacles);
  jumpPressed = false;
  const dist = Math.hypot(player.x - before.x, player.z - before.z);
  const speed = speedOf(player);

  // 걸음 박자 → 발소리
  const g = advanceGait(gait, dist, speed, player.onGround, -before.vy);
  gait = g.gait;
  const surface = surfaceAt(player.x, player.z);
  for (const ev of g.events) {
    if (ev.kind === 'step') { steps[surface]++; sfx.footstep(surface, ev.intensity); }
    if (ev.kind === 'land') sfx.land(surface, ev.intensity);
    if (ev.kind === 'jump') sfx.jump();
  }

  // 공격 진행
  const prevAttack = attack;
  attack = advanceAttack(attack, SWORD, dt);
  if (attack && (!prevAttack || attack.clipId !== prevAttack.clipId || attack.time < prevAttack.time)) {
    setTimeout(() => sfx.swoosh(), 130);
  }

  // 자세
  const amount = Math.min(1, speed / WALK_SPEED);
  const body = locomotionPose(gaitPhase(gait), amount, runBlend(speed), !player.onGround, elapsed);
  let swordPose = null;
  if (swordDrawn) {
    const clip = attack ? SWORD.clips.find((c) => c.id === attack!.clipId)! : null;
    swordPose = clip ? sampleClip(SWORD, clip, attack!.time) : guardPose(SWORD);
    if (attack) { body.spineYaw *= 0.3; body.hipsYaw *= 0.3; }
  }
  elder.apply(locomotionPose(0, 0, 0, false, elapsed * 0.7), null);
  $('talk-prompt').hidden = talk.isOpen || !nearElder();
  $('helpbox').hidden = talk.isOpen;
  hero.root.position.set(player.x, player.y, player.z);
  hero.root.rotation.y = player.yaw;
  hero.apply(body, swordPose);

  // 칼날 위치 → 궤적 띠 · 허수아비 타격
  hero.root.updateMatrixWorld(true);
  hero.sword.localToWorld(bladeBase.set(0, BLADE_BASE, 0));
  hero.sword.localToWorld(bladeTip.set(0, BLADE_TIP, 0));
  const hitting = inHitWindow(attack, SWORD);
  trail.push(bladeBase, bladeTip, !!attack && swordDrawn);
  if (hitting && attack && !attack.hitDone && prevBase && prevTip) {
    if (bladeSweepHits(prevBase, prevTip, toV(bladeBase), toV(bladeTip), DUMMY)) {
      attack.hitDone = true;
      hits++;
      const dx = DUMMY.x - player.x, dz = DUMMY.z - player.z, d = Math.hypot(dx, dz) || 1;
      dummy.hit(dx / d, dz / d);
      sfx.hit();
    }
  }
  prevBase = toV(bladeBase); prevTip = toV(bladeTip);
  dummy.update(dt);

  // 카메라 (1인칭 걸음 흔들림)
  const ph = gaitPhase(gait);
  const bobY = player.onGround ? body.bob * 0.8 : 0;
  const roll = player.onGround ? Math.sin(ph) * 0.012 * amount : 0;
  rig.update(player, dt, bobY, roll);
  hero.setFirstPerson(!rig.showBody);
  renderer.render(scene, cam);

  meter.tick(now);
  frames++;
  const info = renderer.info.render;
  if (bench && !bench.done && frames > 1) {
    if (bench.advance(frameMs, info.calls, info.triangles)) setQuality(bench.current()!.level, false);
    $('bench-progress').hidden = bench.done;
    $('bench-progress').textContent = t(S, 'ui.perf.bench_running', { pct: Math.round(bench.progress * 100), level: t(S, `ui.perf.level_${quality}`) });
    if (bench.done) finishBench(bench);
  }
  const lowered = auto.update(dt, meter.fps, quality);
  if (lowered) { setQuality(lowered, false); toast('ui.perf.auto_lowered'); }
  if (frames % 15 === 0) {
    $('fps').textContent = t(S, 'ui.proto.fps', { fps: meter.fps });
    const ps = perf.summary();
    $('perf').textContent = t(S, 'ui.perf.hud', { level: t(S, `ui.perf.level_${quality}`), low: ps.low1Fps, ms: ps.avgMs, draw: info.calls, tri: Math.round(info.triangles / 100) / 10 });
  }
  // 자동 테스트가 읽는 상태값
  (window as unknown as { __game: object }).__game = {
    frames, fps: meter.fps, camera: rig.mode, quality, perf: perf.summary(), drawCalls: info.calls, triangles: info.triangles,
    shadows: renderer.shadowMap.enabled, pixelRatio: renderer.getPixelRatio(), benching: !!bench && !bench.done,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, onGround: player.onGround, speed },
    surface, steps: { ...steps }, swordDrawn, attack: attack?.clipId ?? null, hits,
  };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
