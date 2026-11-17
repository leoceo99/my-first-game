// 바닥 재질. 발소리와 (나중에) 미끄러짐·먼지 효과가 이 값을 쓴다. 화면의 마을 배치(engine/world.ts)와 맞춘다.
export type Surface = 'grass' | 'dirt' | 'stone';

export const ROAD_HALF_WIDTH = 2; // 흙길: x가 -2~2
export const PLAZA = { x: 0, z: 9, r: 4.5 }; // 우물 광장: 돌바닥

export function surfaceAt(x: number, z: number): Surface {
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) <= PLAZA.r) return 'stone';
  if (Math.abs(x) <= ROAD_HALF_WIDTH) return 'dirt';
  return 'grass';
}
