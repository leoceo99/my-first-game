// 대화 장면 검사기 (E-2, docs/12 5절의 최소판 · T-008 일부).
// 작가가 장면 파일을 고친 뒤 `npm run check:dialogue`(또는 npm test)로 실수를 잡는다.
import { ExprError, parseEffect, parseExpr, refsOf, type Effect, type Expr } from './expr';
import { asLineRef, FAMILIES, type Ask, type CharacterDef, type FlagLedger, type IntentDef, type LineRef, type LocaleTable, type Scene } from './types';

export interface Problem { level: 'error' | 'warn'; where: string; msg: string }

export interface CheckContext {
  ledger: FlagLedger;
  characters: Record<string, CharacterDef>;
  intents: IntentDef[];
  /** 언어 → 문장 표 (장면 문장 + 공통 문장) */
  locales: Record<string, LocaleTable>;
  /** 화면에 한 번에 보이는 대사 최대 글자 수 */
  maxLineLength?: number;
}

export function checkScene(scene: Scene, ctx: CheckContext): Problem[] {
  const P: Problem[] = [];
  const err = (where: string, msg: string) => P.push({ level: 'error', where: `${scene.id}${where ? '/' + where : ''}`, msg });
  const warn = (where: string, msg: string) => P.push({ level: 'warn', where: `${scene.id}${where ? '/' + where : ''}`, msg });
  const nodes = scene.nodes ?? {};
  const intentIds = new Set(ctx.intents.map((i) => i.id));
  const maxLen = ctx.maxLineLength ?? 90;
  const cyclic = cyclicNodes(scene);

  // ── 식 검사: 문법, 장부에 없는 이름, 없는 인물, 범위·값
  const checkNames = (where: string, e: Expr) => {
    const r = refsOf(e);
    for (const n of r.names) if (!ctx.ledger[n]) err(where, `플래그 장부에 없는 이름 '${n}' (오타? data/flags.json에 먼저 적기)`);
    for (const c of r.chars) if (!ctx.characters[c]) err(where, `없는 인물 '${c}'`);
    if (r.chars.length && !ctx.ledger.trust) err(where, `플래그 장부에 'trust'가 없음`);
  };
  const cond = (where: string, src: string | undefined) => {
    if (src === undefined) return;
    try { checkNames(where, parseExpr(src)); } catch (e) { err(where, `조건 식 오류: ${(e as Error).message}`); }
  };
  const effect = (where: string, src: string) => {
    let e: Effect;
    try { e = parseEffect(src); } catch (x) { return err(where, `효과 식 오류: ${(x as ExprError).message}`); }
    if (e.k === 'trust') {
      if (!ctx.characters[e.who]) err(where, `없는 인물 '${e.who}'`);
      return;
    }
    const def = ctx.ledger[e.name];
    if (!def) return err(where, `플래그 장부에 없는 이름 '${e.name}'`);
    if (e.k === 'add') { if (def.type !== 'list') err(where, `'${e.name}'은(는) 목록(list)이 아니라 add를 쓸 수 없음`); return; }
    checkNames(where, e.value);
    const v = e.value;
    if (def.type === 'enum' && v.k === 'str' && !def.values?.includes(v.v)) err(where, `'${e.name}'에 없는 값 '${v.v}' (가능: ${def.values?.join(', ')})`);
    if (def.type === 'int' && v.k === 'num' && def.range && (v.v < def.range[0] || v.v > def.range[1])) err(where, `'${e.name}' 범위 밖 값 ${v.v} (${def.range.join('~')})`);
    if (def.type === 'bool' && v.k !== 'bool' && v.k !== 'name' && v.k !== 'knows') err(where, `'${e.name}'은(는) 참/거짓(true/false)이어야 함`);
    if (def.type === 'int' && (v.k === 'str' || v.k === 'bool')) err(where, `'${e.name}'은(는) 숫자여야 함`);
  };

  // ── 문장 ID: 모든 언어에 있고 맥락 메모가 있나, 길이
  const lines: { where: string; ref: LineRef }[] = [];
  const line = (where: string, l: string | LineRef) => {
    const ref = asLineRef(l);
    lines.push({ where, ref });
    cond(where, ref.when);
    for (const [lang, table] of Object.entries(ctx.locales)) {
      const entry = table[ref.line];
      if (!entry) { err(where, `[${lang}] 문장 표에 없는 ID '${ref.line}'`); continue; }
      if (!entry.context?.trim()) err(where, `[${lang}] '${ref.line}' 맥락 메모 없음`);
      if (!entry.text?.trim()) err(where, `[${lang}] '${ref.line}' 문장 없음`);
      else if (entry.text.length > maxLen) warn(where, `[${lang}] '${ref.line}' ${entry.text.length}자 — 화면 한 번(${maxLen}자)을 넘음`);
    }
  };

  // ── 장면 머리
  if (!/^scene\.[a-z0-9_]+\.[a-z0-9_]+$/.test(scene.id)) err('', `장면 ID 형식이 아님 (scene.<출신>.<장면>)`);
  cond('when', scene.when);
  for (const c of scene.cast ?? []) if (!ctx.characters[c]) err('cast', `없는 인물 '${c}'`);
  if (!nodes[scene.start]) err('start', `시작 노드 '${scene.start}'가 없음`);

  // ── 노드마다
  const edges = new Map<string, string[]>();
  const target = (from: string, where: string, to: string | undefined) => {
    if (!to) return;
    const id = to.replace(/^default:/, '');
    if (!nodes[id]) err(where, `없는 노드 '${id}'로 감`);
    edges.set(from, [...(edges.get(from) ?? []), id]);
  };
  for (const [id, n] of Object.entries(nodes)) {
    const exits = [n.go, n.ask, n.end].filter((x) => x !== undefined && x !== false).length;
    if (exits === 0) err(id, `다음이 없음 (go·ask·end 중 하나 필요)`);
    if (exits > 1) err(id, `go·ask·end 중 하나만 써야 함`);
    for (const d of n.do ?? []) effect(id, d);
    (n.say ?? []).forEach((l) => line(id, l));
    target(id, id, n.go);
    if (n.ask) checkAsk(id, n.ask);
  }

  function checkAsk(id: string, ask: Ask) {
    const where = `${id}.ask`;
    if (!/^common(50|60)(\s*\+\s*\[.*\])?$/.test(ask.intents.trim())) err(where, `intents 형식이 아님 ("common50" 또는 "common60 + ['장면전용']")`);
    const allowed = new Set<string>();
    const all = ask.intents.trim().startsWith('common60');
    for (const i of ctx.intents) if (all || i.tier === 'common') allowed.add(i.id);
    const sceneIds = new Set((ask.sceneIntents ?? []).map((s) => s.id));
    for (const m of ask.intents.matchAll(/'([^']+)'/g)) {
      if (!intentIds.has(m[1]) && !sceneIds.has(m[1])) err(where, `의도 사전에도 장면 전용 의도에도 없는 '${m[1]}'`);
      allowed.add(m[1]);
    }
    for (const s of ask.sceneIntents ?? []) {
      if (intentIds.has(s.id)) err(where, `장면 전용 의도 '${s.id}'가 공통 사전 이름과 겹침`);
      if (!FAMILIES.includes(s.family)) err(where, `장면 전용 의도 '${s.id}'의 계열 '${s.family}'이(가) 4계열이 아님`);
      allowed.add(s.id);
      for (const [lang, table] of Object.entries(ctx.locales)) {
        const e = table[`${scene.id}.intent_${s.id}`];
        if (!e) err(where, `[${lang}] 장면 전용 의도 '${s.id}'의 대표 문장 '${scene.id}.intent_${s.id}'이(가) 없음`);
        else if ((e.examples?.length ?? 0) < 3) warn(where, `[${lang}] 장면 전용 의도 '${s.id}' 예문이 ${e.examples?.length ?? 0}개 — 알아듣기 어렵다 (3개 이상)`);
      }
    }
    for (const f of FAMILIES) if (!ask.byFamily?.[f]) err(where, `계열 '${f}'의 갈 곳(byFamily)이 없음 — 그 계열 의도가 갈 곳을 잃는다`);
    for (const [f, r] of Object.entries(ask.byFamily ?? {})) {
      if (!FAMILIES.includes(f as never)) err(where, `byFamily에 4계열이 아닌 '${f}'`);
      target(id, `${where}.byFamily.${f}`, r.go);
      for (const d of r.do ?? []) effect(`${where}.byFamily.${f}`, d);
      cond(`${where}.byFamily.${f}`, r.when);
    }
    for (const [i, r] of Object.entries(ask.byIntent ?? {})) {
      if (!allowed.has(i)) err(where, `byIntent의 '${i}'은(는) 이 노드가 받지 않는 의도 (intents에 더하기)`);
      target(id, `${where}.byIntent.${i}`, r.go);
      for (const d of r.do ?? []) effect(`${where}.byIntent.${i}`, d);
      cond(`${where}.byIntent.${i}`, r.when);
    }
    for (const [i, ls] of Object.entries(ask.replies ?? {})) {
      if (!allowed.has(i)) err(where, `replies의 '${i}'은(는) 이 노드가 받지 않는 의도`);
      ls.forEach((l) => line(`${where}.replies.${i}`, l));
    }
    for (const f of FAMILIES) {
      const ls = ask.familyReplies?.[f];
      if (!ls?.length) warn(where, `계열 '${f}' 기본 반응(familyReplies)이 없음 — 의도별 반응이 없는 말에 NPC가 침묵한다`);
      ls?.forEach((l) => line(`${where}.familyReplies.${f}`, l));
    }
    if (!ask.unclear?.say?.length) err(where, `되묻는 말(unclear.say)이 없음`);
    ask.unclear?.say?.forEach((l) => line(`${where}.unclear`, l));
    target(id, `${where}.unclear`, ask.unclear?.then);
    for (const c of ask.choices ?? []) if (!allowed.has(c)) err(where, `말 고르기 후보 '${c}'은(는) 받지 않는 의도`);
    if (ask.choices && (ask.choices.length < 7 || ask.choices.length > 10)) warn(where, `말 고르기 후보는 7~10개 (지금 ${ask.choices.length}개)`);
    // 계열 기본 반응이 한 줄뿐이면 같은 계열 말을 두 번 하면 두 번째에 침묵 → 반복 금지 위험 알림
    for (const f of FAMILIES) if ((ask.familyReplies?.[f]?.length ?? 0) === 1 && cyclic.has(id)) warn(where, `계열 '${f}' 기본 반응이 1줄뿐인데 이 노드는 다시 올 수 있음`);
  }

  // ── 도달할 수 없는 노드 (조건은 무시하고 길만 본다)
  const seen = new Set<string>();
  const stack = [scene.start];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n) || !nodes[n]) continue;
    seen.add(n);
    stack.push(...(edges.get(n) ?? []));
  }
  for (const id of Object.keys(nodes)) if (!seen.has(id)) err(id, `시작에서 갈 수 없는 노드`);
  if (![...seen].some((n) => nodes[n]?.end)) err('', `끝(end) 노드에 닿을 수 없음`);

  // ── 반복 대사: 같은 문장 ID를 두 곳 이상에서 씀, 인물마다 세 삶 반복 대사 최대 1줄
  const count = new Map<string, number>();
  for (const { ref } of lines) count.set(ref.line, (count.get(ref.line) ?? 0) + 1);
  for (const [l, n] of count) if (n > 1) warn('', `문장 '${l}'을(를) ${n}곳에서 씀 — 한 곳에서 이미 말했으면 다른 곳에서 침묵한다`);
  const echoes = new Set(lines.filter((x) => x.ref.repeatAcrossLives).map((x) => x.ref.line));
  if (echoes.size > 1) err('', `세 삶 반복 대사가 ${echoes.size}줄 — 인물마다 최대 1줄 (인물 양식 0절 6)`);

  return P;
}

/** 다시 올 수 있는 노드(순환 안에 있는 노드)를 찾는다 */
export function cyclicNodes(scene: Scene): Set<string> {
  const g = new Map<string, string[]>();
  for (const [id, n] of Object.entries(scene.nodes ?? {})) {
    const to = [n.go, ...Object.values(n.ask?.byFamily ?? {}).map((r) => r?.go), ...Object.values(n.ask?.byIntent ?? {}).map((r) => r.go), n.ask?.unclear?.then?.replace(/^default:/, '')];
    g.set(id, to.filter((x): x is string => !!x));
  }
  const out = new Set<string>();
  for (const start of g.keys()) {
    const seen = new Set<string>();
    const st = [...(g.get(start) ?? [])];
    while (st.length) {
      const n = st.pop()!;
      if (n === start) { out.add(start); break; }
      if (seen.has(n)) continue;
      seen.add(n);
      st.push(...(g.get(n) ?? []));
    }
  }
  return out;
}

/** 여러 장면을 한꺼번에 검사. 문장 표에서 어느 장면도 쓰지 않는 장면 문장도 알린다. */
export function checkAll(scenes: Scene[], ctx: CheckContext, sceneTables: Record<string, LocaleTable> = {}): Problem[] {
  const out: Problem[] = [];
  for (const s of scenes) out.push(...checkScene(s, ctx));
  const used = new Set<string>();
  for (const s of scenes) JSON.stringify(s).replace(/"(scene\.[^"]+)"/g, (_, id: string) => { used.add(id); return ''; });
  for (const s of scenes) for (const n of Object.values(s.nodes ?? {})) for (const si of n.ask?.sceneIntents ?? []) used.add(`${s.id}.intent_${si.id}`);
  for (const [file, table] of Object.entries(sceneTables))
    for (const id of Object.keys(table)) if (!used.has(id)) out.push({ level: 'warn', where: file, msg: `어느 장면도 쓰지 않는 문장 '${id}'` });
  return out;
}
