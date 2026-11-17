import { describe, expect, it } from 'vitest';
import { deserialize, serialize, SAVE_VERSION } from '../../src/sim/save';

describe('저장 데이터', () => {
  const player = { x: 3.5, z: -2, yaw: 1.2, pitch: 0.3 };
  it('저장 → 불러오기 하면 그대로 돌아온다', () => {
    const d = deserialize(serialize({ savedAt: '2026-11-17T00:00:00Z', player, camera: 'first' }));
    expect(d).toEqual({ version: SAVE_VERSION, savedAt: '2026-11-17T00:00:00Z', player, camera: 'first' });
  });
  it('옛 v1 저장을 변환해서 불러온다', () => {
    const d = deserialize(JSON.stringify({ version: 1, pos: [4, 5], facing: 0.5 }));
    expect(d?.player).toEqual({ x: 4, z: 5, yaw: 0.5, pitch: 0 });
    expect(d?.camera).toBe('third');
  });
  it('깨진 저장·빈 저장·미래 버전은 거절한다', () => {
    expect(deserialize('{망가짐')).toBeNull();
    expect(deserialize(null)).toBeNull();
    expect(deserialize(JSON.stringify({ version: 99, player }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 2, player: { x: 'a' } }))).toBeNull();
  });
});
