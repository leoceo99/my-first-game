import { createGame, update, type Input } from '../core/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let state = createGame();
canvas.width = state.width;
canvas.height = state.height;

const input: Input = { left: false, right: false, jump: false, restart: false };
const keyMap: Record<string, keyof Input> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  KeyR: 'restart',
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
  input.left = input.right = input.jump = input.restart = false;
});

function draw(): void {
  ctx.fillStyle = '#1e2a3a';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = '#6b8e5a';
  for (const r of state.platforms) ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.fillStyle = '#4de1ff'; // 코인 (플레이어 노랑과 구분되는 하늘색)
  for (const c of state.coins) {
    ctx.beginPath();
    ctx.arc(c.x + c.width / 2, c.y + c.height / 2, c.width / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e63946';
  for (const e of state.enemies) ctx.fillRect(e.x, e.y, e.width, e.height);
  const p = state.player;
  ctx.fillStyle = '#ffd34d';
  ctx.fillRect(p.x, p.y, p.width, p.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('←→ 이동, ↑/스페이스 점프, R 다시', state.width / 2, 40);
  ctx.textAlign = 'left';
  ctx.fillText(`점수 ${state.score} / ${state.totalCoins}`, 16, 30);
  if (state.status !== 'playing') {
    ctx.textAlign = 'center';
    ctx.font = '36px sans-serif';
    ctx.fillStyle = '#ffffff';
    const msg = state.status === 'gameover' ? '게임 오버 — 스페이스로 다시' : '클리어! — 스페이스로 다시';
    ctx.fillText(msg, state.width / 2, state.height / 2);
  }
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
