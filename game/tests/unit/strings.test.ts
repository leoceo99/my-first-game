import { describe, expect, it } from 'vitest';
import { t, validateTable, type StringTable } from '../../src/sim/strings';
import ko from '../../data/strings/ko.json';

describe('문장 표', () => {
  it('실제 한국어 표의 모든 문장이 ID·문장·맥락 메모를 갖춘다', () => {
    expect(validateTable(ko as StringTable)).toEqual([]);
  });
  it('자리 채우기와 없는 ID 표시', () => {
    const table: StringTable = { 'ui.a.b': { text: '값 {n}', context: '시험' } };
    expect(t(table, 'ui.a.b', { n: 3 })).toBe('값 3');
    expect(t(table, 'ui.none')).toBe('[ui.none]');
  });
  it('맥락 메모가 빠진 문장을 잡아낸다', () => {
    const bad = { 'ui.x.y': { text: '안녕', context: '' } } as StringTable;
    expect(validateTable(bad)).toHaveLength(1);
  });
});
