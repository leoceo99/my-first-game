import { describe, expect, it } from 'vitest';
import data from '../../data/combat/longsword_basic.json';
import { advanceAttack, bladeSweepHits, inHitWindow, sampleClip, startOrQueue, validateSwordSet, type SwordSet } from '../../src/sim/sword';
import { length, solveTwoBone, sub, locomotionPose, type Vec3 } from '../../src/sim/pose';
import ko from '../../data/strings/ko.json';

const set = data as unknown as SwordSet;

describe('롱소드 동작 데이터', () => {
  it('데이터 검사 통과: 3종, 처음·끝 지붕 자세, 타격 구간 정상', () => {
    expect(validateSwordSet(set)).toEqual([]);
    expect(set.clips.map((c) => c.id)).toEqual(['oberhau', 'mittelhau', 'unterhau']);
  });
  it('기술 이름 문장이 문장 표에 있다', () => {
    for (const c of set.clips) expect((ko as any)[c.nameId]?.text).toBeTruthy();
  });
  it('키 시각에서는 키 자세를 그대로 지난다', () => {
    const c = set.clips[0];
    const k = c.keys[2] as any;
    const p = sampleClip(set, c, k.t);
    p.grip.forEach((v, i) => expect(v).toBeCloseTo(k.grip[i], 5));
  });
  it('내려베기: 칼끝이 위에서 아래로 내려간다', () => {
    const c = set.clips.find((x) => x.id === 'oberhau')!;
    expect(sampleClip(set, c, c.hit[0]).dir[1]).toBeGreaterThan(sampleClip(set, c, c.hit[1]).dir[1]);
  });
  it('올려베기: 칼끝이 아래에서 위로 올라간다', () => {
    const c = set.clips.find((x) => x.id === 'unterhau')!;
    expect(sampleClip(set, c, c.hit[0]).dir[1]).toBeLessThan(sampleClip(set, c, c.hit[1]).dir[1]);
  });
  it('가로베기: 칼끝이 오른쪽에서 왼쪽으로 간다', () => {
    const c = set.clips.find((x) => x.id === 'mittelhau')!;
    expect(sampleClip(set, c, c.hit[0]).dir[0]).toBeGreaterThan(sampleClip(set, c, c.hit[1]).dir[0]);
  });
  it('공격 진행: 끝나면 사라지고, 예약한 다음 베기로 이어진다', () => {
    let a = startOrQueue(null, set, 'oberhau');
    expect(a?.clipId).toBe('oberhau');
    a = startOrQueue(a, set, 'mittelhau');
    let seen = false;
    for (let i = 0; i < 120; i++) { a = advanceAttack(a, set, 1 / 60); if (a?.clipId === 'mittelhau') seen = true; if (inHitWindow(a, set)) expect(a).not.toBeNull(); }
    expect(seen).toBe(true);
    expect(a).toBeNull();
  });
});

describe('팔 IK와 타격 판정', () => {
  it('팔 길이가 늘거나 줄지 않는다', () => {
    const sh: Vec3 = [0.2, 0.52, 0];
    for (const target of [[0.1, 0.3, -0.4], [0.9, 0.9, -0.9], [0.22, 0.5, -0.02]] as Vec3[]) {
      const r = solveTwoBone(sh, target, [0.7, -1, 0.5], 0.3, 0.3);
      expect(length(sub(r.elbow, sh))).toBeCloseTo(0.3, 4);
      expect(length(sub(r.hand, r.elbow))).toBeCloseTo(0.3, 4);
    }
  });
  it('칼날이 허수아비를 가로질러 지나가면 맞음, 비껴가면 안 맞음', () => {
    const cyl = { x: 0, z: -1, r: 0.3, yMin: 0, yMax: 2 };
    // 오른쪽에서 왼쪽으로 쓸고 지나감
    expect(bladeSweepHits([0.2, 1, -0.2], [1.2, 1, -1.0], [-0.2, 1, -0.2], [-1.2, 1, -1.0], cyl)).toBe(true);
    expect(bladeSweepHits([0.2, 1, 1], [1.2, 1, 1], [-0.2, 1, 1], [-1.2, 1, 1], cyl)).toBe(false);
  });
  it('걷기 자세: 반 걸음 차이에서 다리가 좌우 대칭', () => {
    const a = locomotionPose(Math.PI / 2, 1, 0, false, 0), b = locomotionPose(Math.PI * 1.5, 1, 0, false, 0);
    expect(a.hipL).toBeCloseTo(b.hipR, 6);
    expect(a.hipL).toBeGreaterThan(0);
  });
});
