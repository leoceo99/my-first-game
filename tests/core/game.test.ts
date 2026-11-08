import { describe, expect, it } from 'vitest';
import {
  createGame,
  update,
  MOVE_SPEED,
  JUMP_SPEED,
  MAX_FALL_SPEED,
  ENEMY_SPEED,
  type GameState,
  type Input,
} from '../../src/core/game';

const none: Input = { left: false, right: false, jump: false };
const DT = 1 / 60;

function run(g: GameState, input: Input, seconds: number): GameState {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) g = update(g, input, DT);
  return g;
}

const ground = (g: GameState): number => g.platforms[0].y;
const withPlayer = (g: GameState, p: Partial<GameState['player']>): GameState => ({
  ...g,
  player: { ...g.player, ...p },
});

describe('game', () => {
  it('플레이어가 바닥 위에서 시작한다', () => {
    const g = createGame();
    expect(g.player.y + g.player.height).toBe(ground(g));
    expect(g.player.onGround).toBe(true);
    expect(g.player.vy).toBe(0);
    expect(g.platforms.length).toBe(4);
  });

  it('좌우로 이동한다', () => {
    const g = createGame();
    const next = run(g, { ...none, right: true }, 0.5);
    expect(next.player.x - g.player.x).toBeCloseTo(MOVE_SPEED * 0.5);
    expect(next.player.y).toBe(g.player.y);
  });

  it('공중에서 떨어지면 바닥에 멈춘다', () => {
    let g = withPlayer(createGame(), { x: 20, y: 100, onGround: false });
    g = run(g, none, 2);
    expect(g.player.y + g.player.height).toBe(ground(g));
    expect(g.player.onGround).toBe(true);
    expect(g.player.vy).toBe(0);
  });

  it('낙하 속도는 최대값을 넘지 않는다', () => {
    let g = withPlayer(createGame(), { y: -10000, onGround: false });
    g = update(g, none, 1 / 60);
    for (let i = 0; i < 120; i++) {
      g = update(g, none, 1 / 60);
      expect(g.player.vy).toBeLessThanOrEqual(MAX_FALL_SPEED);
    }
  });

  it('땅에서 점프하면 올라가고, 공중에서는 다시 점프할 수 없다', () => {
    const g0 = createGame();
    let g = run(g0, { ...none, jump: true }, 0.1);
    expect(g.player.y).toBeLessThan(g0.player.y);
    expect(g.player.onGround).toBe(false);
    // 계속 jump를 눌러도 공중에서는 추가 상승이 없다
    let minY = g.player.y;
    for (let i = 0; i < 20; i++) {
      g = update(g, { ...none, jump: true }, DT);
      minY = Math.min(minY, g.player.y);
    }
    const apex = JUMP_SPEED ** 2 / (2 * 1800);
    expect(g0.player.y - minY).toBeLessThanOrEqual(apex + 1);
  });

  it('점프 후 다시 바닥에 착지한다', () => {
    const g0 = createGame();
    let g = run(g0, { ...none, jump: true }, 1 / 30);
    g = run(g, none, 2);
    expect(g.player.y).toBe(g0.player.y);
    expect(g.player.onGround).toBe(true);
  });

  it('떠 있는 발판에 착지한다', () => {
    const g0 = createGame();
    const plat = g0.platforms[1];
    // 발판 바로 위 공중에서 떨어뜨린다
    let g = withPlayer(g0, { x: plat.x + 50, y: plat.y - 100, onGround: false });
    g = run(g, none, 1);
    expect(g.player.y + g.player.height).toBe(plat.y);
    expect(g.player.onGround).toBe(true);
  });

  it('점프로 발판 위에 올라갈 수 있다', () => {
    const g0 = createGame();
    const plat = g0.platforms[1];
    // 발판 바로 옆 바닥에서 점프하며 발판 쪽으로 이동
    let g = withPlayer(g0, { x: plat.x - 60 });
    g = run(g, { left: false, right: true, jump: true }, 0.7);
    g = run(g, none, 1);
    expect(g.player.y + g.player.height).toBeLessThanOrEqual(plat.y + 1e-6);
    expect(g.player.onGround).toBe(true);
  });

  it('발판 옆면에 막힌다', () => {
    const g0 = createGame();
    const plat = g0.platforms[1];
    // 발판과 같은 높이에서 오른쪽으로 이동
    let g = withPlayer(g0, { x: plat.x - 100, y: plat.y - 5, onGround: false, vy: 0 });
    g = update(g, { ...none, right: true }, DT);
    for (let i = 0; i < 5; i++) g = update(g, { ...none, right: true }, DT);
    expect(g.player.x + g.player.width).toBeLessThanOrEqual(plat.x + 1e-6);
    // 오래 밀어도 발판 안으로 들어가지 않는다 (발판 높이에 걸쳐 있는 동안)
    g = withPlayer(g0, { x: plat.x - 100, y: plat.y + 2, onGround: false, vy: 0 });
    for (let i = 0; i < 30; i++) {
      g = update(g, { ...none, right: true }, DT);
      if (g.player.y < plat.y + plat.height - 1e-6) {
        expect(g.player.x + g.player.width).toBeLessThanOrEqual(plat.x + 1e-6);
      }
    }
  });

  it('발판 아래에서 머리를 부딪히면 위로 속도가 사라진다', () => {
    const g0 = createGame();
    const plat = g0.platforms[1];
    let g = withPlayer(g0, { x: plat.x + 50 });
    let bumped = false;
    for (let i = 0; i < 60; i++) {
      g = update(g, { ...none, jump: true }, DT);
      expect(g.player.y).toBeGreaterThanOrEqual(plat.y + plat.height - 1e-6);
      if (g.player.y === plat.y + plat.height) bumped = true;
    }
    expect(bumped).toBe(true);
  });

  it('월드 좌우 경계에서 멈춘다', () => {
    let g = run({ ...createGame(), enemies: [] }, { ...none, right: true }, 5);
    expect(g.player.x).toBe(g.width - g.player.width);
    g = run(g, { ...none, left: true }, 5);
    expect(g.player.x).toBe(0);
  });

  it('큰 dt에서도 바닥을 뚫지 않는다', () => {
    let g = withPlayer(createGame(), { x: 20, y: 0, onGround: false });
    g = update(g, none, 0.5);
    g = update(g, none, 2);
    expect(g.player.y + g.player.height).toBe(ground(g));
    expect(g.player.onGround).toBe(true);
  });

  it('원본 상태는 바뀌지 않는다', () => {
    const g = createGame();
    const snapshot = JSON.parse(JSON.stringify(g));
    update(g, { left: true, right: false, jump: true }, 0.3);
    expect(g).toEqual(snapshot);
  });

  it('점프는 누른 순간에만 한 번 한다 (계속 눌러도 착지 후 다시 뛰지 않는다)', () => {
    const jump = { ...none, jump: true };
    let g = run({ ...createGame(), enemies: [] }, jump, 2);
    expect(g.player.onGround).toBe(true);
    expect(g.player.y).toBe(createGame().player.y);
    // 떼었다가 다시 누르면 다시 점프한다
    g = run(g, none, DT);
    g = update(g, jump, DT);
    expect(g.player.y).toBeLessThan(createGame().player.y);
  });

  it('코인에 닿으면 사라지고 점수가 1 오른다', () => {
    const g0 = createGame();
    const c = g0.coins[0];
    const g = update(withPlayer(g0, { x: c.x, y: c.y, onGround: false }), none, DT);
    expect(g.score).toBe(1);
    expect(g.coins.length).toBe(g0.coins.length - 1);
    expect(g.coins).not.toContainEqual(c);
    expect(g.status).toBe('playing');
  });

  it('적은 순찰 구간 끝에서 방향을 바꾼다', () => {
    const g0 = { ...createGame(), player: { ...createGame().player, x: 0 } };
    const e0 = g0.enemies[0];
    let g = update(g0, none, DT);
    expect(g.enemies[0].x - e0.x).toBeCloseTo(ENEMY_SPEED * DT);
    let sawLeft = false;
    for (let i = 0; i < 180; i++) {
      g = update({ ...g, status: 'playing' }, none, DT);
      const e = g.enemies[0];
      expect(e.x).toBeGreaterThanOrEqual(e.minX);
      expect(e.x).toBeLessThanOrEqual(e.maxX);
      if (e.vx < 0) sawLeft = true;
    }
    expect(sawLeft).toBe(true);
  });

  it('적과 닿으면 gameover', () => {
    const g0 = createGame();
    const e = g0.enemies[1];
    const g = update(withPlayer(g0, { x: e.x, y: e.y - 5, onGround: false }), none, DT);
    expect(g.status).toBe('gameover');
  });

  it('gameover 중에는 움직이지 않는다', () => {
    const g0 = { ...createGame(), status: 'gameover' as const };
    const g = update(g0, { ...none, right: true }, 0.5);
    expect(g.player).toEqual(g0.player);
    expect(g.enemies).toEqual(g0.enemies);
    expect(g.status).toBe('gameover');
  });

  it('gameover에서 점프를 새로 누르거나 restart면 처음부터 다시 시작한다', () => {
    const dead = { ...createGame(), score: 3, status: 'gameover' as const };
    const a = update(dead, { ...none, restart: true }, DT);
    expect(a.status).toBe('playing');
    expect(a.score).toBe(0);
    expect(a.coins.length).toBe(a.totalCoins);
    const b = update(dead, { ...none, jump: true }, DT);
    expect(b.status).toBe('playing');
    expect(b.score).toBe(0);
    // 점프를 계속 누르고 있었다면 재시작되지 않는다
    const held = update({ ...dead, jumpHeld: true }, { ...none, jump: true }, DT);
    expect(held.status).toBe('gameover');
  });

  it('모든 코인을 먹으면 clear', () => {
    const g0 = createGame();
    const last = g0.coins[0];
    const g1 = { ...g0, coins: [last], enemies: [], totalCoins: g0.coins.length };
    const g = update(withPlayer(g1, { x: last.x, y: last.y, onGround: false }), none, DT);
    expect(g.coins.length).toBe(0);
    expect(g.status).toBe('clear');
    const again = update(g, { ...none, restart: true }, DT);
    expect(again.status).toBe('playing');
  });
});
