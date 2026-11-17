// 저장 데이터 형식. 버전이 바뀌어도 옛 저장을 불러올 수 있게 변환기를 둔다 (docs/03 3장 5).
import { clampPitch, type PlayerState } from './player';

export const SAVE_VERSION = 2;

export interface SaveData {
  version: number;
  savedAt: string; // ISO 시각
  player: PlayerState;
  camera: 'first' | 'third';
}

/** 저장 데이터를 문자열로. */
export function serialize(data: Omit<SaveData, 'version'>): string {
  return JSON.stringify({ version: SAVE_VERSION, ...data });
}

/** 문자열 → 저장 데이터. 깨졌거나 모르는 형식이면 null. 옛 버전은 변환한다. */
export function deserialize(text: string | null | undefined): SaveData | null {
  if (!text) return null;
  let raw: any;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object' || typeof raw.version !== 'number') return null;
  if (raw.version > SAVE_VERSION) return null; // 더 새 게임에서 만든 저장
  if (raw.version === 1) raw = migrateV1(raw);
  const p = raw.player;
  if (!p || ![p.x, p.z, p.yaw, p.pitch].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    version: SAVE_VERSION,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    player: { x: p.x, z: p.z, yaw: p.yaw, pitch: clampPitch(p.pitch) },
    camera: raw.camera === 'first' ? 'first' : 'third',
  };
}

/** v1 형식: { version:1, pos:[x,z], facing } — 카메라 설정이 없었다. (변환기 시험용 옛 형식) */
function migrateV1(v1: any): any {
  const pos = Array.isArray(v1.pos) ? v1.pos : [NaN, NaN];
  return {
    version: 2,
    savedAt: v1.savedAt,
    player: { x: pos[0], z: pos[1], yaw: v1.facing ?? 0, pitch: 0 },
    camera: 'third',
  };
}
