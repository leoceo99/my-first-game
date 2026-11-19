import { describe, expect, it } from 'vitest';
import { evaluate, parseEffect, parseExpr, specificity } from '../../src/sim/dialogue/expr';
import { DialogueState, SceneRunner } from '../../src/sim/dialogue/runtime';
import { matchIntent } from '../../src/sim/dialogue/match';
import { checkAll, checkScene, type CheckContext } from '../../src/sim/dialogue/check';
import { CHARACTERS, examplesFor, FLAGS, INTENTS, KO, SCENE_TABLES, SCENES } from '../../src/sim/dialogue/data';
import type { Scene } from '../../src/sim/dialogue/types';

const ctx: CheckContext = { ledger: FLAGS, characters: CHARACTERS, intents: INTENTS, locales: { ko: KO } };
const scene = SCENES[0];
const clone = (): Scene => JSON.parse(JSON.stringify(scene));

describe('조건·효과 식', () => {
  const st = new DialogueState(FLAGS);
  it('비교·그리고·또는·아님·trust·knows', () => {
    st.trustOf['C-900'] = 2;
    expect(evaluate(parseExpr("trust(C-900) > 1 && !knows('장로의아들')"), st)).toBe(true);
    expect(evaluate(parseExpr('life >= 2 || trust(C-900) <= -1'), st)).toBe(false);
    expect(evaluate(parseExpr('GODS≥7'), { get: () => 7, trust: () => 0 })).toBe(true);
  });
  it('문법 오류를 잡는다', () => {
    expect(() => parseExpr('trust(C-900) >')).toThrow();
    expect(() => parseExpr("knows(장로)")).toThrow(/따옴표/);
    expect(() => parseExpr('foo(1)')).toThrow(/쓸 수 없는 함수/);
    expect(() => parseEffect('trust(C-900) *= 2')).toThrow();
  });
  it('효과: set·trust 범위 제한·add', () => {
    const s = new DialogueState(FLAGS);
    s.apply('trust(C-900) += 5');
    expect(s.trust('C-900')).toBe(3); // 장부 범위 -3~3
    s.apply("set knows.장로의아들 = true");
    s.apply("add SURE '범인=방앗간'");
    expect(s.get('knows.장로의아들')).toBe(true);
    expect(s.get('SURE')).toEqual(['범인=방앗간']);
  });
  it('구체성 = 조건 덩어리 수', () => {
    expect(specificity(parseExpr("a && b || c"))).toBe(3);
    expect(specificity(null)).toBe(0);
  });
});

describe('장면 실행 (시험 장면: 밤의 우물)', () => {
  it('믿는다 → 신뢰 오르고 둘째 질문 → 믿는다 → 따뜻한 끝, 주인공 기억(meta)이 생긴다', () => {
    const st = new DialogueState(FLAGS);
    const r = new SceneRunner(scene, INTENTS, st);
    const t0 = r.begin();
    expect(t0.lines.map((l) => l.id)).toEqual(['scene.test.elder_night.c900_echo', 'scene.test.elder_night.c900_01']);
    expect(t0.choices!.length).toBeGreaterThanOrEqual(7);
    const t1 = r.answer('truth');
    expect(t1.lines[0].id).toBe('scene.test.elder_night.c900_r_truth'); // 의도별 반응
    expect(t1.lines[1].id).toBe('scene.test.elder_night.c900_10'); // 신뢰 > 0 이라 다른 질문
    expect(st.trust('C-900')).toBe(1);
    const t2 = r.answer('comfort'); // 믿는다 계열, 의도별 반응 없음 → 계열 기본 반응
    expect(t2.lines.map((l) => l.id)).toEqual(['scene.test.elder_night.c900_f2_trust', 'scene.test.elder_night.c900_end_warm']);
    expect(t2.ended).toBe(true);
    expect(st.get('knows.장로의아들')).toBe(true);
  });
  it('못 알아들으면 한 번 되묻고, 두 번째에는 기본 갈 곳으로', () => {
    const r = new SceneRunner(scene, INTENTS, new DialogueState(FLAGS));
    r.begin();
    const a = r.answer(null);
    expect(a.lines[0].id).toBe('scene.test.elder_night.c900_q1_again');
    expect(a.node).toBe('q1');
    expect(r.answer(null).node).toBe('q2');
  });
  it('받지 않는 의도(중요 장면 전용 ★)는 못 알아들은 것으로 본다', () => {
    const r = new SceneRunner(scene, INTENTS, new DialogueState(FLAGS));
    r.begin();
    expect(r.answer('confess').lines[0].id).toBe('scene.test.elder_night.c900_q1_again');
  });
  it('예외(byIntent)가 계열 기본보다 먼저: 단정·고발은 SURE에 남고 차가운 끝', () => {
    const st = new DialogueState(FLAGS);
    const r = new SceneRunner(scene, INTENTS, st);
    r.begin();
    const t = r.answer('accuse');
    expect(t.node).toBe('end_cold');
    expect(st.get('SURE')).toEqual(['우물가=장로']);
    expect(st.trust('C-900')).toBe(-2);
  });
  it('되감기: NPC 신뢰·기억은 지워지고 주인공 기억은 남아 대사가 바뀐다, 반복 대사는 다시 나온다', () => {
    const st = new DialogueState(FLAGS);
    let r = new SceneRunner(scene, INTENTS, st);
    r.begin(); r.answer('truth'); r.answer('truth');
    expect(st.get('knows.장로의아들')).toBe(true);
    st.newLife();
    expect(st.get('life')).toBe(2);
    expect(st.trust('C-900')).toBe(0);
    r = new SceneRunner(scene, INTENTS, st);
    const t = r.begin();
    expect(t.lines.map((l) => l.id)).toEqual(['scene.test.elder_night.c900_echo', 'scene.test.elder_night.c900_03']);
    // 이전 삶의 기억이 있으면 장면 전용 의도(아들 지목)가 열린다
    r.answer('deflect'); // 숨긴다 → 둘째 질문
    const end = r.answer('name_son');
    expect(end.lines.map((l) => l.id)).toEqual(['scene.test.elder_night.c900_r2_son', 'scene.test.elder_night.c900_end_son']);
  });
  it('한 삶 안에서 같은 말을 두 번 하지 않는다 (같은 계열 두 번 → 두 번째 기본 반응)', () => {
    const st = new DialogueState(FLAGS);
    const r1 = new SceneRunner(scene, INTENTS, st);
    r1.begin(); const a = r1.answer('praise');
    const r2 = new SceneRunner(scene, INTENTS, st); // 같은 삶에서 다시 말 걸기
    const b0 = r2.begin();
    expect(b0.lines.map((l) => l.id)).not.toContain('scene.test.elder_night.c900_echo'); // 반복 대사도 삶마다 한 번
    const b = r2.answer('praise');
    expect(a.lines[0].id).toBe('scene.test.elder_night.c900_f_trust_01');
    expect(b.lines[0].id).toBe('scene.test.elder_night.c900_f_trust_02');
  });
});

describe('임시 의도 매칭', () => {
  const ex = examplesFor(scene);
  it('예문과 비슷한 말은 맞히고, 빈 입력은 침묵, 엉뚱한 말은 못 알아들음', () => {
    expect(matchIntent('도와주시겠소?', ex).intent).toBe('ask_help');
    expect(matchIntent('고맙소 정말', ex).intent).toBe('thank');
    expect(matchIntent('', ex).intent).toBe('silence');
    expect(matchIntent('ㅋ', ex).intent).toBe('silence');
    expect(matchIntent('양자역학 컴퓨터 주식', ex).intent).toBeNull();
  });
  it('허용된 의도만 본다', () => {
    expect(matchIntent('도와주시겠소?', ex, new Set(['thank', 'silence'])).intent).not.toBe('ask_help');
  });
  it('장면 전용 의도도 예문으로 알아듣는다', () => {
    expect(matchIntent('그중 하나는 장로님 아들이었소', ex).intent).toBe('name_son');
  });
});

describe('대화 검사기', () => {
  it('지금 있는 장면 데이터는 오류가 없다 (npm run check:dialogue)', () => {
    const problems = checkAll(SCENES, ctx, SCENE_TABLES);
    for (const p of problems) console.log(`[${p.level === 'error' ? '오류' : '경고'}] ${p.where}: ${p.msg}`);
    expect(problems.filter((p) => p.level === 'error')).toEqual([]);
  });
  const errorsOf = (s: Scene) => checkScene(s, ctx).filter((p) => p.level === 'error').map((p) => p.msg).join('\n');
  it('오타 플래그·없는 인물·없는 노드를 잡는다', () => {
    const s = clone();
    s.nodes.q1.say![0] = { line: 'scene.test.elder_night.c900_01', when: "trust(C-9OO) <= 0 && knows('장로의아둘')" };
    s.nodes.q1.ask!.byFamily['믿는다'] = { go: 'q3' };
    const e = errorsOf(s);
    expect(e).toMatch(/없는 인물 'C-9OO'/);
    expect(e).toMatch(/장부에 없는 이름 'knows.장로의아둘'/);
    expect(e).toMatch(/없는 노드 'q3'/);
  });
  it('계열 하나가 빠지면 잡는다', () => {
    const s = clone();
    delete s.nodes.q2.ask!.byFamily['떠본다'];
    expect(errorsOf(s)).toMatch(/계열 '떠본다'의 갈 곳/);
  });
  it('문장 표에 없는 ID·맥락 메모 없음을 잡는다', () => {
    const s = clone();
    s.nodes.end_warm.say = ['scene.test.elder_night.c900_없음'];
    const e1 = errorsOf(s);
    expect(e1).toMatch(/문장 표에 없는 ID/);
    const ko2 = { ...KO, 'scene.test.elder_night.c900_01': { text: '어젯밤…', context: ' ' } };
    expect(checkScene(scene, { ...ctx, locales: { ko: ko2 } }).map((p) => p.msg).join()).toMatch(/맥락 메모 없음/);
  });
  it('갈 수 없는 노드, 받지 않는 의도, 장부 값 오류, 반복 대사 2줄을 잡는다', () => {
    const s = clone();
    s.nodes.orphan = { say: ['scene.test.elder_night.c900_end_cold'], end: true };
    s.nodes.q1.ask!.byIntent!.confess = { go: 'q2' };
    s.nodes.q2.ask!.byFamily['믿는다'] = { go: 'end_warm', do: ["set knows.장로의아들 = '네'", "add life '3'"] };
    s.nodes.end_cold.say = [{ line: 'scene.test.elder_night.c900_end_cold', repeatAcrossLives: true }];
    const e = errorsOf(s);
    expect(e).toMatch(/시작에서 갈 수 없는 노드/);
    expect(e).toMatch(/'confess'은\(는\) 이 노드가 받지 않는 의도/);
    expect(e).toMatch(/참\/거짓/);
    expect(e).toMatch(/목록\(list\)이 아니라/);
    expect(e).toMatch(/세 삶 반복 대사가 2줄/);
  });
  it('의도 사전은 60개, 계열마다 15개, 중요 10개', () => {
    expect(INTENTS).toHaveLength(60);
    for (const f of ['믿는다', '따진다', '떠본다', '숨긴다']) expect(INTENTS.filter((i) => i.family === f)).toHaveLength(15);
    expect(INTENTS.filter((i) => i.tier === 'important')).toHaveLength(10);
  });
});
