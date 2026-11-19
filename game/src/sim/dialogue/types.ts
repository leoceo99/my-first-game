// 대화 데이터의 모양 (docs/12 2~3절). 작가가 쓰는 JSON 파일이 이 모양을 따른다.

export type Family = '믿는다' | '따진다' | '떠본다' | '숨긴다';
export const FAMILIES: readonly Family[] = ['믿는다', '따진다', '떠본다', '숨긴다'];

/** 공통 의도 사전의 한 줄 (data/dialogue/intents.json, docs/13에서 변환) */
export interface IntentDef {
  id: string;
  family: Family;
  /** common = 일반 장면 50개, important = 중요 장면에서 더하는 ★ 10개 */
  tier: 'common' | 'important';
  name: string;
  desc: string;
  confusable: string[];
}

/** 플래그 장부 (data/flags.json). 장부에 없는 이름이 장면에 나오면 검사 실패. */
export interface FlagDef {
  type: 'int' | 'bool' | 'enum' | 'list' | 'str';
  /** life = 한 번의 삶(되감기면 지워짐), run = 한 출신의 세 삶, meta = 주인공의 기억(되감겨도 남음) */
  scope: 'life' | 'run' | 'meta';
  range?: [number, number];
  values?: string[];
  per?: 'character';
  default?: number | string | boolean | string[];
  desc: string;
}
export type FlagLedger = Record<string, FlagDef>;

/** 인물 카드의 기계용 부분 (data/characters/C-000.json) */
export interface CharacterDef {
  id: string;
  name: string;
  binding: string;
  doc?: string;
}

export interface LineRef {
  line: string;
  when?: string;
  /** 세 삶 반복 대사: 삶마다 한 번 다시 할 수 있다 (인물 카드마다 최대 1줄) */
  repeatAcrossLives?: boolean;
}

export interface Route {
  go: string;
  do?: string[];
  when?: string;
}

export interface Ask {
  /** "common50", "common60" 또는 "common50 + ['name_son']" */
  intents: string;
  byFamily: Partial<Record<Family, Route>>;
  byIntent?: Record<string, Route>;
  /** 의도별 NPC 첫 반응 후보 */
  replies?: Record<string, (string | LineRef)[]>;
  /** 의도별 반응이 없을 때 쓰는 계열 기본 반응 */
  familyReplies?: Partial<Record<Family, (string | LineRef)[]>>;
  /** 못 알아들었을 때: 첫 번째는 say로 되묻고, 두 번째는 then 노드로 */
  unclear: { say: (string | LineRef)[]; then: string };
  /** "말 고르기" 버튼에 보일 의도(7~10개). 없으면 자동으로 고른다 */
  choices?: string[];
  /** 장면 전용 의도 (이름 대기·암호 등) */
  sceneIntents?: { id: string; family: Family; name: string }[];
}

export interface SceneNode {
  say?: (string | LineRef)[];
  ask?: Ask;
  go?: string;
  do?: string[];
  end?: boolean;
}

export interface Scene {
  id: string;
  tier: 'normal' | 'important';
  when?: string;
  cast: string[];
  start: string;
  nodes: Record<string, SceneNode>;
}

export interface LocaleEntry { text: string; context: string; examples?: string[] }
export type LocaleTable = Record<string, LocaleEntry>;

export const asLineRef = (l: string | LineRef): LineRef => (typeof l === 'string' ? { line: l } : l);
