import * as THREE from 'three';
import { buildDummy, buildWorld, DUMMY } from './engine/world';
import { buildRig, BLADE_BASE, BLADE_TIP } from './engine/rig';
import { CameraRig } from './engine/camera';
import { Input } from './engine/input';
import { Sfx } from './engine/audio';
import { BladeTrail } from './engine/trail';
import { FpsMeter } from './sim/fps';
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

// ── 화면 준비
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 내장 그래픽 대비 상한
renderer.setSize(app.clientWidth, app.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(62, app.clientWidth / app.clientHeight, 0.05, 150);
const obstacles = buildWorld(scene);
const dummy = buildDummy(scene);
obstacles.push(dummy.obstacle);
const hero = buildRig();
scene.add(hero.root);
const rig = new CameraRig(cam);
const trail = new BladeTrail(scene);
const sfx = new Sfx();
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
const showCam = () => text('camera', rig.mode === 'first' ? 'ui.proto.camera_first' : 'ui.proto.camera_third');
const showSound = () => text('btn-sound', sfx.muted ? 'ui.proto.sound_off' : 'ui.proto.sound_on');
showCam();
showSound();
let toastTimer = 0;
function toast(id: string) {
  const el = $('toast');
  el.textContent = t(S, id);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
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

// ── 개발용: 자동 테스트가 주인공을 옮길 때 쓴다
(window as any).__dev = {
  setPlayer(x: number, z: number, yaw: number) { player = makePlayer(x, z, yaw, 0.12); gait = newGait(); },
};

// ── 반복
const meter = new FpsMeter();
let last = performance.now();
let frames = 0;
let elapsed = 0;
const bladeBase = new THREE.Vector3(), bladeTip = new THREE.Vector3();
let prevBase: Vec3 | null = null, prevTip: Vec3 | null = null;
const toV = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;

  // 시점
  const [lx, ly] = input.consumeLook();
  player.yaw -= lx * 0.004;
  player.pitch = clampPitch(player.pitch + ly * 0.004);

  // 이동 (공격 중에는 느리게, 공격 중 점프 불가)
  const mv = input.move();
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
  if (frames % 15 === 0) $('fps').textContent = t(S, 'ui.proto.fps', { fps: meter.fps });
  // 자동 테스트가 읽는 상태값
  (window as unknown as { __game: object }).__game = {
    frames, fps: meter.fps, camera: rig.mode,
    player: { x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, onGround: player.onGround, speed },
    surface, steps: { ...steps }, swordDrawn, attack: attack?.clipId ?? null, hits,
  };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
