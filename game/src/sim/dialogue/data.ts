// 대화 데이터 모음 (E-2). 게임과 검사기가 같은 파일을 읽는다. 장면이 늘면 여기에 한 줄씩 더한다.
import intentsJson from '../../../data/dialogue/intents.json';
import flagsJson from '../../../data/flags.json';
import c900 from '../../../data/characters/C-900.json';
import elderNight from '../../../data/dialogue/scenes/test/elder_night.json';
import koIntents from '../../../locales/ko/intents.json';
import koElderNight from '../../../locales/ko/scenes/test/elder_night.json';
import type { CharacterDef, FlagLedger, IntentDef, LocaleTable, Scene } from './types';

export const INTENTS = intentsJson as IntentDef[];
export const FLAGS = flagsJson as FlagLedger;
export const CHARACTERS: Record<string, CharacterDef> = { [c900.id]: c900 as CharacterDef };
export const SCENES: Scene[] = [elderNight as unknown as Scene];
/** 장면 문장 표: 파일 경로 → 표 (검사기의 "안 쓰는 문장" 알림용) */
export const SCENE_TABLES: Record<string, LocaleTable> = {
  'locales/ko/scenes/test/elder_night.json': koElderNight as LocaleTable,
};
export const KO: LocaleTable = { ...(koIntents as LocaleTable), ...Object.assign({}, ...Object.values(SCENE_TABLES)) };

/** 의도 매칭용 예문: 공통 의도 + 장면 전용 의도 */
export function examplesFor(scene: Scene, table: LocaleTable = KO): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of INTENTS) out[i.id] = table[`intent.${i.id}`]?.examples ?? [];
  for (const n of Object.values(scene.nodes)) for (const s of n.ask?.sceneIntents ?? []) out[s.id] = table[`${scene.id}.intent_${s.id}`]?.examples ?? [];
  return out;
}

/** "말 고르기" 버튼 글 */
export function choiceText(scene: Scene, intent: string, table: LocaleTable = KO): string {
  return table[`intent.${intent}`]?.text ?? table[`${scene.id}.intent_${intent}`]?.text ?? intent;
}
