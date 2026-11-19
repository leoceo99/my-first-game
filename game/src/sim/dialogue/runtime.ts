// 대화 장면 실행기 (docs/12 4절). 화면과 분리된 순수 로직.
// 플레이어 말 → 의도 하나 → (예외 byIntent, 없으면 계열 기본 byFamily) → 효과 적용 → 첫 반응 문장 → 다음 노드.
import { evaluate, parseEffect, parseExpr, specificity, type EvalEnv, type Expr, type Value } from './expr';
import { asLineRef, type Ask, type Family, type FlagLedger, type IntentDef, type LineRef, type Route, type Scene } from './types';

/**
 * 같은 말 반복 금지 (인물 양식 0절 5): "한 삶 안에서 같은 대답을 두 번 하지 않는다".
 * → 모든 문장은 **삶마다 한 번**. 되감기면 NPC가 잊으므로 다시 할 수 있다.
 * 세 삶 반복 대사(repeatAcrossLives)는 "세 삶 모두 똑같이 하라"는 작가 표시이고, 검사기가 인물마다 1줄인지 본다.
 * 'run'으로 바꾸면 보통 문장은 세 삶 전체에서 한 번만 쓴다(2번째 삶에서 NPC가 말을 잃을 수 있음).
 * (해석이 갈릴 수 있어 총괄에 확인 요청 — jarvis/handoff/E-2.md)
 */
export const LINE_ONCE_PER: 'life' | 'run' = 'life';

export class DialogueState implements EvalEnv {
  flags: Record<string, Value> = {};
  trustOf: Record<string, number> = {};
  saidRun = new Set<string>();
  saidLife = new Set<string>();
  log: { scene: string; node: string; intent: string | null; family: Family | null }[] = [];

  constructor(readonly ledger: FlagLedger) {
    for (const [name, def] of Object.entries(ledger)) if (def.default !== undefined && def.per !== 'character') this.flags[name] = clone(def.default);
    if (this.flags.life === undefined) this.flags.life = 1;
  }

  get(name: string): Value | undefined { return this.flags[name]; }
  trust(who: string): number { return this.trustOf[who] ?? 0; }

  /** 되감기: 이번 삶의 기억(life 범위)·신뢰·한 말 기록을 지우고 삶 번호를 올린다. meta·run은 남는다. */
  newLife(): void {
    for (const [name, def] of Object.entries(this.ledger)) {
      if (def.scope !== 'life' || def.per === 'character') continue;
      if (def.default !== undefined) this.flags[name] = clone(def.default); else delete this.flags[name];
    }
    this.trustOf = {};
    this.saidLife.clear();
    this.flags.life = Number(this.flags.life ?? 1) + 1;
  }

  apply(effectSrc: string): void {
    const e = parseEffect(effectSrc);
    if (e.k === 'set') this.flags[e.name] = evaluate(e.value, this);
    else if (e.k === 'trust') {
      const r = this.ledger.trust?.range ?? [-Infinity, Infinity];
      this.trustOf[e.who] = Math.max(r[0], Math.min(r[1], this.trust(e.who) + e.delta));
    } else {
      const cur = this.flags[e.name];
      this.flags[e.name] = [...(Array.isArray(cur) ? cur : []), e.value];
    }
  }
}

const clone = <T>(v: T): T => (Array.isArray(v) ? ([...v] as T) : v);

export interface SpokenLine { id: string | null; speaker: string }
export interface Turn {
  node: string;
  lines: SpokenLine[];
  /** 플레이어 차례면 "말 고르기" 후보(의도 ID), 아니면 null */
  choices: string[] | null;
  ended: boolean;
}

const exprCache = new Map<string, Expr>();
const cond = (src: string | undefined): Expr | null => {
  if (!src) return null;
  let e = exprCache.get(src);
  if (!e) { e = parseExpr(src); exprCache.set(src, e); }
  return e;
};

export class SceneRunner {
  private node = '';
  private unclearCount = 0;
  private intentMap: Map<string, IntentDef>;
  ended = false;

  constructor(readonly scene: Scene, readonly intents: IntentDef[], readonly state: DialogueState) {
    this.intentMap = new Map(intents.map((i) => [i.id, i]));
  }

  get speaker(): string { return this.scene.cast[0] ?? ''; }
  get currentNode(): string { return this.node; }

  begin(): Turn { return this.enter(this.scene.start, []); }

  /** 이 노드에서 받아들이는 의도와 그 계열 */
  allowed(ask: Ask): Map<string, Family> {
    const out = new Map<string, Family>();
    const spec = ask.intents.trim();
    const all = spec.startsWith('common60');
    for (const i of this.intents) if (all || i.tier === 'common') out.set(i.id, i.family);
    for (const m of spec.matchAll(/'([^']+)'/g)) {
      const def = this.intentMap.get(m[1]) ?? ask.sceneIntents?.find((s) => s.id === m[1]);
      if (def) out.set(m[1], def.family);
    }
    for (const s of ask.sceneIntents ?? []) out.set(s.id, s.family);
    return out;
  }

  /** "말 고르기" 후보 7~10개: 장면이 정했으면 그대로, 아니면 예외 의도 → 반응이 있는 의도 → 계열마다 고르게 */
  choicesFor(ask: Ask): string[] {
    const allowed = this.allowed(ask);
    if (ask.choices) return ask.choices.filter((c) => allowed.has(c));
    const out: string[] = [];
    const push = (id: string) => { if (allowed.has(id) && !out.includes(id) && out.length < 10) out.push(id); };
    for (const [id, r] of Object.entries(ask.byIntent ?? {})) if (!r.when || this.ok(r.when)) push(id);
    for (const id of Object.keys(ask.replies ?? {})) push(id);
    const byFam = new Map<Family, string[]>();
    for (const [id, f] of allowed) byFam.set(f, [...(byFam.get(f) ?? []), id]);
    for (let round = 0; out.length < 8 && round < 20; round++)
      for (const ids of byFam.values()) if (ids[round] && out.length < 8) push(ids[round]);
    return out;
  }

  /** 플레이어의 말(의도 ID, 못 알아들었으면 null) */
  answer(intent: string | null): Turn {
    const ask = this.scene.nodes[this.node]?.ask;
    if (this.ended || !ask) throw new Error('지금은 플레이어 차례가 아님');
    const allowed = this.allowed(ask);
    const family = intent ? allowed.get(intent) ?? null : null;
    if (!intent || !family) {
      this.unclearCount++;
      this.state.log.push({ scene: this.scene.id, node: this.node, intent: null, family: null });
      if (this.unclearCount === 1) return { node: this.node, lines: [this.say(ask.unclear.say)], choices: this.choicesFor(ask), ended: false };
      return this.enter(ask.unclear.then.replace(/^default:/, ''), []);
    }
    this.state.log.push({ scene: this.scene.id, node: this.node, intent, family });
    const special = ask.byIntent?.[intent];
    const route: Route | undefined = special && (!special.when || this.ok(special.when)) ? special : ask.byFamily[family];
    if (!route) throw new Error(`${this.scene.id}/${this.node}: 계열 '${family}'의 갈 곳이 없음`);
    for (const d of route.do ?? []) this.state.apply(d);
    const own = ask.replies?.[intent] ?? [];
    const reply = this.pick(own) ?? this.pick(ask.familyReplies?.[family] ?? []);
    return this.enter(route.go, reply ? [{ id: reply, speaker: this.speaker }] : []);
  }

  private enter(nodeId: string, lines: SpokenLine[]): Turn {
    for (let hops = 0; hops < 32; hops++) {
      const node = this.scene.nodes[nodeId];
      if (!node) throw new Error(`${this.scene.id}: 없는 노드 '${nodeId}'`);
      this.node = nodeId;
      this.unclearCount = 0;
      for (const d of node.do ?? []) this.state.apply(d);
      if (node.say) lines.push(this.say(node.say));
      if (node.end) { this.ended = true; return { node: nodeId, lines, choices: null, ended: true }; }
      if (node.ask) return { node: nodeId, lines, choices: this.choicesFor(node.ask), ended: false };
      if (!node.go) throw new Error(`${this.scene.id}/${nodeId}: 다음이 없음(go·ask·end 중 하나 필요)`);
      nodeId = node.go;
    }
    throw new Error(`${this.scene.id}: 노드가 끝없이 이어짐`);
  }

  private say(cands: (string | LineRef)[]): SpokenLine {
    return { id: this.pick(cands), speaker: this.speaker };
  }

  private ok(src: string): boolean {
    const e = cond(src);
    return !e || !!evaluate(e, this.state);
  }

  /** 대답 고르기 (docs/12 3-4): 조건 맞는 것 → 이미 한 말 빼기 → 가장 구체적인 조건. 없으면 null(말 없음) */
  private pick(cands: (string | LineRef)[]): string | null {
    let best: LineRef | null = null;
    let bestScore = -1;
    for (const c of cands.map(asLineRef)) {
      if (c.when && !this.ok(c.when)) continue;
      const used = c.repeatAcrossLives || LINE_ONCE_PER === 'life' ? this.state.saidLife.has(c.line) : this.state.saidRun.has(c.line);
      if (used) continue;
      const s = specificity(cond(c.when));
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (!best) return null;
    this.state.saidRun.add(best.line);
    this.state.saidLife.add(best.line);
    return best.line;
  }
}
