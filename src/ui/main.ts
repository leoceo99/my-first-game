import { createGame, update, type Input } from '../core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let state = createGame();
canvas.width = state.width;
canvas.height = state.height;

const input: Input = { left: false, right: false, jump: false };
const keyMap: Record<string, keyof Input> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
};

function onKey(e: KeyboardEvent, down: boolean): void {
  const dir = keyMap[e.code];
  if (!dir) return;
  input[dir] = down;
  e.preventDefault();
}
window.addEventListener('keydown', (e) => onKey(e, true));
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', () => {
  input.left = input.right = input.jump = false;
});

function draw(): void {
  ctx.fillStyle = '#1e2a3a';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = '#6b8e5a';
  for (const r of state.platforms) ctx.fillRect(r.x, r.y, r.width, r.height);
  const p = state.player;
  ctx.fillStyle = '#ffd34d';
  ctx.fillRect(p.x, p.y, p.width, p.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('←→ 이동, ↑/스페이스 점프', state.width / 2, 40);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  state = update(state, input, dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
