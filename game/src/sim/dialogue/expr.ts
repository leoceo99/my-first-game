// 대화 장면의 조건·효과 식 (docs/12 3-5). 작은 규칙 언어: 함수 정의·반복 없음 → 검사기가 미리 모두 해석할 수 있다.
// 조건 예: trust(C-900) > 0 && knows('우물가의두사람') || life == 2
// 효과 예: set PIECE_T = '甲만' · trust(C-900) += 1 · add SURE '범인=방앗간' · set knows.우물가의두사람 = true

export type Value = number | string | boolean | string[];

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'name'; name: string }
  | { k: 'trust'; who: string }
  | { k: 'knows'; what: string }
  | { k: 'not'; e: Expr }
  | { k: 'bin'; op: '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>='; a: Expr; b: Expr };

export type Effect =
  | { k: 'set'; name: string; value: Expr }
  | { k: 'trust'; who: string; delta: number }
  | { k: 'add'; name: string; value: string };

export class ExprError extends Error {}

type Tok = { t: 'num' | 'str' | 'id' | 'op'; v: string };

const ID_RE = /^[A-Za-z_가-힣][A-Za-z0-9_.가-힣]*(?:-[A-Za-z0-9_]+)*/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ws = rest.match(/^\s+/);
    if (ws) { i += ws[0].length; continue; }
    const num = rest.match(/^-?\d+(?:\.\d+)?/);
    if (num && !(out.length && (out[out.length - 1].t === 'num' || out[out.length - 1].t === 'id' || out[out.length - 1].v === ')'))) {
      out.push({ t: 'num', v: num[0] }); i += num[0].length; continue;
    }
    if (rest[0] === "'") {
      const end = rest.indexOf("'", 1);
      if (end < 0) throw new ExprError(`따옴표가 닫히지 않음: ${src}`);
      out.push({ t: 'str', v: rest.slice(1, end) }); i += end + 1; continue;
    }
    const op = rest.match(/^(&&|\|\||==|!=|<=|>=|\+=|-=|[<>!()=≥≤])/);
    if (op) { out.push({ t: 'op', v: op[0] === '≥' ? '>=' : op[0] === '≤' ? '<=' : op[0] }); i += op[0].length; continue; }
    const id = rest.match(ID_RE);
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new ExprError(`알 수 없는 글자 '${rest[0]}': ${src}`);
  }
  return out;
}

class Parser {
  i = 0;
  constructor(private toks: Tok[], private src: string) {}
  peek(): Tok | undefined { return this.toks[this.i]; }
  eat(v?: string): Tok {
    const t = this.toks[this.i];
    if (!t || (v !== undefined && t.v !== v)) throw new ExprError(`'${v ?? '값'}'이(가) 와야 함: ${this.src}`);
    this.i++;
    return t;
  }
  done() { if (this.i < this.toks.length) throw new ExprError(`남는 글자 '${this.toks[this.i].v}': ${this.src}`); }

  or(): Expr { let a = this.and(); while (this.peek()?.v === '||') { this.i++; a = { k: 'bin', op: '||', a, b: this.and() }; } return a; }
  and(): Expr { let a = this.not(); while (this.peek()?.v === '&&') { this.i++; a = { k: 'bin', op: '&&', a, b: this.not() }; } return a; }
  not(): Expr { if (this.peek()?.v === '!') { this.i++; return { k: 'not', e: this.not() }; } return this.cmp(); }
  cmp(): Expr {
    const a = this.primary();
    const op = this.peek()?.v;
    if (op && ['==', '!=', '<', '<=', '>', '>='].includes(op)) { this.i++; return { k: 'bin', op: op as '==', a, b: this.primary() }; }
    return a;
  }
  primary(): Expr {
    const t = this.eat();
    if (t.t === 'num') return { k: 'num', v: Number(t.v) };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.v === '(') { const e = this.or(); this.eat(')'); return e; }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
      if (this.peek()?.v === '(') return this.call(t.v);
      return { k: 'name', name: t.v };
    }
    throw new ExprError(`여기에 '${t.v}'이(가) 올 수 없음: ${this.src}`);
  }
  call(fn: string): Expr {
    this.eat('(');
    const arg = this.eat();
    this.eat(')');
    if (fn === 'trust') {
      if (arg.t !== 'id') throw new ExprError(`trust()에는 인물 ID(C-000)가 와야 함: ${this.src}`);
      return { k: 'trust', who: arg.v };
    }
    if (fn === 'knows') {
      if (arg.t !== 'str') throw new ExprError(`knows()에는 '따옴표 이름'이 와야 함: ${this.src}`);
      return { k: 'knows', what: arg.v };
    }
    throw new ExprError(`쓸 수 없는 함수 '${fn}' (trust·knows만 가능): ${this.src}`);
  }
}

export function parseExpr(src: string): Expr {
  const p = new Parser(tokenize(src), src);
  const e = p.or();
  p.done();
  return e;
}

export function parseEffect(src: string): Effect {
  const s = src.trim();
  let m = s.match(/^set\s+(\S+)\s*=\s*(.+)$/);
  if (m) {
    if (!ID_RE.test(m[1])) throw new ExprError(`이름 형식이 아님: ${src}`);
    return { k: 'set', name: m[1], value: parseExpr(m[2]) };
  }
  m = s.match(/^trust\(\s*([^)\s]+)\s*\)\s*([+-])=\s*(\d+)$/);
  if (m) return { k: 'trust', who: m[1], delta: (m[2] === '-' ? -1 : 1) * Number(m[3]) };
  m = s.match(/^add\s+(\S+)\s+'([^']*)'$/);
  if (m) return { k: 'add', name: m[1], value: m[2] };
  throw new ExprError(`효과 형식이 아님 (set · trust() += · add 만 가능): ${src}`);
}

/** 식이 읽는 이름들 (검사기용) */
export function refsOf(e: Expr, out: { names: string[]; chars: string[] } = { names: [], chars: [] }) {
  switch (e.k) {
    case 'name': out.names.push(e.name); break;
    case 'knows': out.names.push(`knows.${e.what}`); break;
    case 'trust': out.chars.push(e.who); break;
    case 'not': refsOf(e.e, out); break;
    case 'bin': refsOf(e.a, out); refsOf(e.b, out); break;
  }
  return out;
}

export interface EvalEnv {
  get(name: string): Value | undefined;
  trust(who: string): number;
}

export function evaluate(e: Expr, env: EvalEnv): Value {
  switch (e.k) {
    case 'num': case 'str': case 'bool': return e.v;
    case 'name': return env.get(e.name) ?? false;
    case 'knows': return env.get(`knows.${e.what}`) === true;
    case 'trust': return env.trust(e.who);
    case 'not': return !truthy(evaluate(e.e, env));
    case 'bin': {
      if (e.op === '&&') return truthy(evaluate(e.a, env)) && truthy(evaluate(e.b, env));
      if (e.op === '||') return truthy(evaluate(e.a, env)) || truthy(evaluate(e.b, env));
      const a = evaluate(e.a, env), b = evaluate(e.b, env);
      switch (e.op) {
        case '==': return a === b;
        case '!=': return a !== b;
        case '<': return Number(a) < Number(b);
        case '<=': return Number(a) <= Number(b);
        case '>': return Number(a) > Number(b);
        case '>=': return Number(a) >= Number(b);
      }
    }
  }
}

export const truthy = (v: Value): boolean => (Array.isArray(v) ? v.length > 0 : !!v);

/** 조건의 "구체성" = 조건 덩어리 수. 대답 고르기에서 더 구체적인 줄을 먼저 쓴다 (docs/12 3-4). */
export function specificity(e: Expr | null): number {
  if (!e) return 0;
  if (e.k === 'bin' && (e.op === '&&' || e.op === '||')) return specificity(e.a) + specificity(e.b);
  return 1;
}
