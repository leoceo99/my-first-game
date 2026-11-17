// 문장 표: 모든 문장은 ID와 맥락 메모를 가진다 (docs/06_현지화_원칙.md).
export interface StringEntry {
  text: string;
  context: string;
}
export type StringTable = Record<string, StringEntry>;

/** 표에서 문장을 찾고 {이름} 자리를 채운다. 없는 ID는 눈에 띄게 [ID]로 보여 준다. */
export function t(table: StringTable, id: string, vars: Record<string, string | number> = {}): string {
  const entry = table[id];
  if (!entry) return `[${id}]`;
  return entry.text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}

/** 표의 모든 항목이 문장과 맥락 메모를 갖췄는지 검사한다. 문제 목록을 돌려준다. */
export function validateTable(table: StringTable): string[] {
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(table)) {
    if (!/^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(id)) problems.push(`${id}: ID 형식이 아님 (예: ui.menu.start)`);
    if (!entry || typeof entry.text !== 'string' || entry.text.trim() === '') problems.push(`${id}: 문장 없음`);
    if (!entry || typeof entry.context !== 'string' || entry.context.trim() === '') problems.push(`${id}: 맥락 메모 없음`);
  }
  return problems;
}
