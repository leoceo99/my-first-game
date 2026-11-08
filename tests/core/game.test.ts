import { describe, expect, it } from 'vitest';
import { createGame, update, PLAYER_SPEED, type Input } from '../../src/core/game';

const none: Input = { left: false, right: false, up: false, down: false };

describe('game', () => {
  it('플레이어가 화면 가운데에서 시작한다', () => {
    const g = createGame();
    expect(g.player.x + g.player.width / 2).toBe(400);
    expect(g.player.y + g.player.height / 2).toBe(225);
  });

  it('오른쪽으로 0.5초 가면 120px 이동한다', () => {
    const g = createGame();
    const next = update(g, { ...none, right: true }, 0.5);
    expect(next.player.x - g.player.x).toBeCloseTo(PLAYER_SPEED * 0.5);
    expect(next.player.y).toBe(g.player.y);
  });

  it('월드 경계에서 멈춘다', () => {
    let g = createGame();
    g = update(g, { ...none, right: true, down: true }, 10);
    expect(g.player.x).toBe(g.width - g.player.width);
    expect(g.player.y).toBe(g.height - g.player.height);
    g = update(g, { ...none, left: true, up: true }, 10);
    expect(g.player.x).toBe(0);
    expect(g.player.y).toBe(0);
  });

  it('입력이 없으면 그대로이고 원본 상태는 바뀌지 않는다', () => {
    const g = createGame();
    const before = { ...g.player };
    const next = update(g, none, 0.016);
    expect(next.player).toEqual(before);
    expect(g.player).toEqual(before);
  });
});
