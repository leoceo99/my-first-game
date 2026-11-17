import * as THREE from 'three';
import { buildWorld } from './engine/world';
import { buildCharacter } from './engine/character';
import { CameraRig } from './engine/camera';
import { Input } from './engine/input';
import { FpsMeter } from './sim/fps';
import { clampPitch, stepPlayer, type PlayerState } from './sim/player';
import { deserialize, serialize } from './sim/save';
import { t, type StringTable } from './sim/strings';
import ko from '../data/strings/ko.json';

const S = ko as StringTable;
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
const cam = new THREE.PerspectiveCamera(62, app.clientWidth / app.clientHeight, 0.1, 150);
const obstacles = buildWorld(scene);
const hero = buildCharacter();
scene.add(hero.root);
const rig = new CameraRig(cam);
window.addEventListener('resize', () => {
  cam.aspect = app.clientWidth / app.clientHeight;
  cam.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
});

// ── 상태
let player: PlayerState = { x: 0, z: 2, yaw: 0, pitch: 0.12 };
const SAVE_KEY = 'proto.save.slot1';
let memorySave: string | null = null; // 브라우저 저장소가 막힌 경우의 임시 보관

// ── 글자
$('title').textContent = t(S, 'ui.proto.title');
$('help').textContent = t(S, 'ui.proto.help');
$('help-touch').textContent = t(S, 'ui.proto.help_touch');
$('btn-camera').textContent = t(S, 'ui.proto.btn_camera');
$('btn-save').textContent = t(S, 'ui.proto.btn_save');
$('btn-load').textContent = t(S, 'ui.proto.btn_load');
const showCam = () => { $('camera').textContent = t(S, rig.mode === 'first' ? 'ui.proto.camera_first' : 'ui.proto.camera_third'); };
showCam();
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
  const text = serialize({ savedAt: new Date().toISOString(), player, camera: rig.mode });
  try { localStorage.setItem(SAVE_KEY, text); memorySave = text; toast('ui.proto.saved'); }
  catch { memorySave = text; toast('ui.proto.saved_memory'); }
}
function load() {
  let text: string | null = null;
  try { text = localStorage.getItem(SAVE_KEY); } catch { /* 막힘 */ }
  const data = deserialize(text ?? memorySave);
  if (!data) return toast('ui.proto.no_save');
  player = { ...data.player };
  if (rig.mode !== data.camera) { rig.toggle(); showCam(); }
  toast('ui.proto.loaded');
}

// ── 입력
const input = new Input(renderer.domElement);
input.onToggleCamera = () => { rig.toggle(); showCam(); };
input.onSave = save;
input.onLoad = load;
$('btn-camera').addEventListener('click', input.onToggleCamera);
$('btn-save').addEventListener('click', save);
$('btn-load').addEventListener('click', load);

// ── 반복
const meter = new FpsMeter();
let last = performance.now();
let frames = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const [lx, ly] = input.consumeLook();
  player.yaw -= lx * 0.004;
  player.pitch = clampPitch(player.pitch + ly * 0.004);
  const before = player;
  player = stepPlayer(player, input.move(), dt, obstacles);
  const speed = dt > 0 ? Math.hypot(player.x - before.x, player.z - before.z) / dt : 0;

  hero.root.position.set(player.x, 0, player.z);
  hero.root.rotation.y = player.yaw;
  hero.animate(dt, speed);
  rig.update(player, dt);
  hero.root.visible = rig.showBody;
  renderer.render(scene, cam);

  meter.tick(now);
  frames++;
  if (frames % 15 === 0) $('fps').textContent = t(S, 'ui.proto.fps', { fps: meter.fps });
  // 자동 테스트가 읽는 상태값
  (window as unknown as { __game: object }).__game = {
    frames, fps: meter.fps, camera: rig.mode,
    player: { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch },
  };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
