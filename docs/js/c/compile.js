// 구문 트리를 검사하고(타입, 선언), 바로 실행할 수 있는 JS 함수(클로저)로 바꿔요.

import {
  T, Ptr, Store, ptr, arr, compileError, runtimeError, convert, zeroOf, truthy, cells, baseOf, decay,
  isInt, isFloat, isArith, isPtr, isArr, isScalar, is64, isVoid, isCharLike, sameType, common, promote,
  typeName, friendlyType,
} from "./types.js";
import { BUILTINS, FILE_T, parseFormat, retypeHeap } from "./runtime.js";

const NORMAL = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const MAX_DEPTH = 2500;
const NULL_HEADERS = ["stdio.h", "stdlib.h", "string.h", "stddef.h", "time.h"];

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function suggest(name, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = editDistance(name.toLowerCase(), c.toLowerCase());
    if (score < bestScore && score <= Math.max(1, Math.floor(name.length / 3))) {
      best = c;
      bestScore = score;
    }
  }
  return best ? ` 혹시 '${best}'를 쓰려던 건가요?` : "";
}

// ---------- 계산 함수 ----------
function divZero(line) {
  return runtimeError(line, "0으로 나눴어요", "정수를 0으로 나누면 프로그램이 멈춰요. 나누기 전에 나누는 수가 0인지 확인해 보세요.");
}

function arithFn(op, t, line) {
  if (isFloat(t)) {
    const f32 = t.bits === 32;
    const r = f32 ? Math.fround : (x) => x;
    switch (op) {
      case "+": return (a, b) => r(a + b);
      case "-": return (a, b) => r(a - b);
      case "*": return (a, b) => r(a * b);
      case "/": return (a, b) => r(a / b);
      default: break;
    }
  } else if (is64(t)) {
    const w = t.unsigned ? (x) => BigInt.asUintN(64, x) : (x) => BigInt.asIntN(64, x);
    switch (op) {
      case "+": return (a, b) => w(a + b);
      case "-": return (a, b) => w(a - b);
      case "*": return (a, b) => w(a * b);
      case "/": return (a, b) => { if (b === 0n) throw divZero(line); return w(a / b); };
      case "%": return (a, b) => { if (b === 0n) throw divZero(line); return w(a % b); };
      case "&": return (a, b) => w(a & b);
      case "|": return (a, b) => w(a | b);
      case "^": return (a, b) => w(a ^ b);
      case "<<": return (a, b) => w(a << (BigInt(b) & 63n));
      case ">>": return (a, b) => w(a >> (BigInt(b) & 63n));
      default: break;
    }
  } else if (t.unsigned) {
    switch (op) {
      case "+": return (a, b) => (a + b) >>> 0;
      case "-": return (a, b) => (a - b) >>> 0;
      case "*": return (a, b) => Math.imul(a, b) >>> 0;
      case "/": return (a, b) => { if (b === 0) throw divZero(line); return Math.trunc(a / b) >>> 0; };
      case "%": return (a, b) => { if (b === 0) throw divZero(line); return (a % b) >>> 0; };
      case "&": return (a, b) => (a & b) >>> 0;
      case "|": return (a, b) => (a | b) >>> 0;
      case "^": return (a, b) => (a ^ b) >>> 0;
      case "<<": return (a, b) => (a << (Number(b) & 31)) >>> 0;
      case ">>": return (a, b) => a >>> (Number(b) & 31);
      default: break;
    }
  } else {
    switch (op) {
      case "+": return (a, b) => (a + b) | 0;
      case "-": return (a, b) => (a - b) | 0;
      case "*": return (a, b) => Math.imul(a, b);
      case "/": return (a, b) => { if (b === 0) throw divZero(line); return Math.trunc(a / b) | 0; };
      case "%": return (a, b) => { if (b === 0) throw divZero(line); return (a % b) | 0; };
      case "&": return (a, b) => a & b;
      case "|": return (a, b) => a | b;
      case "^": return (a, b) => a ^ b;
      case "<<": return (a, b) => a << (Number(b) & 31);
      case ">>": return (a, b) => a >> (Number(b) & 31);
      default: break;
    }
  }
  throw compileError(line, `'${op}' 계산을 이 타입(${typeName(t)})에는 쓸 수 없어요`);
}

const COMPARE = {
  "<": (a, b) => (a < b ? 1 : 0),
  ">": (a, b) => (a > b ? 1 : 0),
  "<=": (a, b) => (a <= b ? 1 : 0),
  ">=": (a, b) => (a >= b ? 1 : 0),
  "==": (a, b) => (a === b ? 1 : 0),
  "!=": (a, b) => (a !== b ? 1 : 0),
};

const ptrEq = (a, b) => (a === null || b === null ? a === b : a.store === b.store && a.off === b.off);

function ptrCompare(op, line) {
  if (op === "==") return (a, b) => (ptrEq(a, b) ? 1 : 0);
  if (op === "!=") return (a, b) => (ptrEq(a, b) ? 0 : 1);
  const cmp = COMPARE[op];
  return (a, b) => {
    if (a === null || b === null || a.store !== b.store) {
      throw runtimeError(line, "서로 다른 배열의 주소는 크기를 비교할 수 없어요");
    }
    return cmp(a.off, b.off);
  };
}

/** 이 식이 값을 쓰는 방식 (C의 rvalue): 배열은 첫 원소 주소가 돼요. */
function rv(E) {
  if (isArr(E.t)) return { t: ptr(E.t.of), ev: E.lv, from: E };
  return E;
}

export class Compiler {
  constructor(rt, includes) {
    this.rt = rt;
    this.includes = includes;
    this.funcs = new Map();
    this.globalScope = { vars: new Map(), parent: null };
    this.scope = this.globalScope;
    this.fn = null;
    this.loops = 0;
    this.switches = 0;
    this.globalInits = [];
    this.globals = [];
    this.strings = new Map();
  }

  // ---------- 범위 ----------
  push() { this.scope = { vars: new Map(), parent: this.scope }; }
  pop() { this.scope = this.scope.parent; }

  lookup(name) {
    for (let s = this.scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    return null;
  }

  visibleNames() {
    const names = new Set();
    for (let s = this.scope; s; s = s.parent) for (const n of s.vars.keys()) names.add(n);
    return names;
  }

  declare(info) {
    if (this.scope.vars.has(info.name)) {
      throw compileError(info.line, `'${info.name}'를 이미 선언했어요`, "같은 범위 안에서 같은 이름의 변수를 두 번 만들 수 없어요. 이름을 바꾸거나 앞의 선언을 지워 주세요.");
    }
    if (this.scope === this.globalScope && this.funcs.has(info.name)) {
      throw compileError(info.line, `'${info.name}'는 이미 함수 이름이에요`);
    }
    this.scope.vars.set(info.name, info);
  }

  hasHeader(h) { return this.includes.has(h); }

  needHeader(h, what, line) {
    if (!this.hasHeader(h)) {
      throw compileError(line, `${what}를 쓰려면 #include <${h}>가 필요해요`, `맨 위에 #include <${h}> 를 넣어 주세요.`);
    }
  }

  // ---------- 타입 ----------
  resolveType(t, opts = {}) {
    if (t.k === "array" && "lenExpr" in t) {
      const of = this.resolveType(t.of);
      if (isVoid(of)) throw compileError(t.line, "void 배열은 만들 수 없어요");
      let len;
      if (t.lenExpr === null) {
        if (opts.initLen == null) {
          if (opts.param) return arr(of, null);
          throw compileError(t.line, "배열 크기가 필요해요", "예: int a[10]; 또는 int a[] = {1, 2, 3};");
        }
        len = opts.initLen;
      } else {
        const E = this.value(this.expr(t.lenExpr));
        if (!isInt(E.t)) throw compileError(t.line, "배열 크기는 정수여야 해요");
        if (E.cv === undefined) {
          if (opts.allowVla) return { k: "array", of, len: null, vla: E, size: 0 };
          throw compileError(t.line, "배열 크기는 상수여야 해요", "이 자리에서는 숫자나 #define 상수만 쓸 수 있어요.");
        }
        len = Number(E.cv);
        if (len <= 0) throw compileError(t.line, "배열 크기는 1 이상이어야 해요");
        if (len > 10_000_000) throw compileError(t.line, "배열이 너무 커요", "1000만 칸 이하로 만들어 주세요.");
      }
      return arr(of, len);
    }
    if (t.k === "ptr") return ptr(this.resolveType(t.to));
    if (t.k === "func") {
      return {
        ...t,
        ret: this.resolveType(t.ret),
        params: t.params.map((p) => {
          const pt = this.resolveType(p.type, { param: true });
          return { ...p, type: isArr(pt) ? ptr(pt.of) : pt };
        }),
      };
    }
    return t;
  }

  // ---------- 값 변환 ----------
  value(E, line) {
    if (E.fnName) {
      throw compileError(line ?? E.line, `함수 '${E.fnName}' 뒤에 괄호가 필요해요`, `함수를 부르려면 ${E.fnName}(...) 처럼 써요.`);
    }
    if (isVoid(E.t)) throw compileError(line ?? E.line, "void 함수의 결과는 값으로 쓸 수 없어요", "돌려주는 값이 없는 함수예요.");
    return rv(E);
  }

  conv(E, to, line, what = "값") {
    const from = E.t;
    if (sameType(from, to)) return E;
    if (isVoid(to)) return { t: to, ev: E.ev };
    if (isArith(to) && isArith(from)) {
      const out = { t: to, ev: (f) => convert(E.ev(f), from, to) };
      if (E.cv !== undefined) {
        const v = convert(E.cv, from, to);
        out.cv = v;
        out.ev = () => v;
      }
      return out;
    }
    if (isPtr(to)) {
      if (E.isNull) return { t: to, ev: () => null, isNull: true, cv: null };
      if (isPtr(from)) {
        const a = from.to;
        const b = to.to;
        const ok = sameType(a, b) || isVoid(a) || isVoid(b) || (isCharLike(a) && isCharLike(b)) ||
          (isArr(a) && sameType(a.of, b)) || b.k === "file";
        if (!ok) {
          throw compileError(line, `${what}의 주소 타입이 맞지 않아요`, `${typeName(to)}가 필요한데 ${typeName(from)}를 넣었어요.`);
        }
        if (isVoid(a) && !isVoid(b)) return { t: to, ev: (f) => retypeHeap(E.ev(f), b, line) };
        return { t: to, ev: E.ev };
      }
      if (E.strChar) {
        throw compileError(line, "문자열에는 큰따옴표를 써요", `글자 하나는 '작은따옴표', 여러 글자는 "큰따옴표"로 써요.`);
      }
      throw compileError(line, `${what}에 정수를 넣었는데 주소(포인터)가 필요해요`,
        isInt(from) ? "scanf라면 변수 앞에 &를 붙였는지 확인해 보세요." : `${typeName(to)}가 필요해요.`);
    }
    if (isInt(to) && to.bits === 1 && isPtr(from)) return { t: to, ev: (f) => (E.ev(f) === null ? 0 : 1) };
    if (isArith(to) && isPtr(from)) {
      if (E.from && E.from.strlit && isCharLike(to)) {
        throw compileError(line, `char에는 글자 하나만 넣을 수 있어요`, `글자 하나는 'a'처럼 작은따옴표로 써요. 여러 글자를 담으려면 char 이름[크기] 배열을 써요.`);
      }
      throw compileError(line, `${what}에 주소(포인터)를 넣을 수 없어요`, `${friendlyType(to)}가 필요한데 ${friendlyType(from)}를 넣었어요.`);
    }
    throw compileError(line, `${typeName(from)}를 ${typeName(to)}로 바꿀 수 없어요`);
  }

  // ---------- 식 ----------
  expr(node) {
    const E = this.exprInner(node);
    E.line = node.line;
    return E;
  }

  exprInner(node) {
    const rt = this.rt;
    const line = node.line;
    switch (node.k) {
      case "num": {
        const v = node.value;
        return { t: node.type, ev: () => v, cv: v, isNull: !node.isChar && (v === 0 || v === 0n) };
      }
      case "str": {
        let st = this.strings.get(node);
        if (!st) {
          const type = arr(T.char, node.bytes.length + 1);
          st = new Store(node.bytes.length + 1, "문자열 상수", type);
          node.bytes.forEach((b, i) => { st.cells[i] = convert(b, T.int, T.char); });
          st.cells[node.bytes.length] = 0;
          st.readonly = true;
          this.strings.set(node, st);
        }
        const p = new Ptr(st, 0);
        return { t: st.type, lv: () => p, strlit: true };
      }
      case "id": return this.identifier(node);
      case "bin": return this.binary(node);
      case "assign": return this.assign(node);
      case "unary": return this.unary(node);
      case "pre": case "post": return this.incdec(node, node.k === "pre");
      case "call": return this.call(node);
      case "index": return this.index(node);
      case "cast": return this.cast(node);
      case "sizeof": {
        let t = node.type ? this.resolveType(node.type) : this.expr(node.e).t;
        if (t.vla) throw compileError(line, "크기가 실행 중에 정해지는 배열에는 sizeof를 쓸 수 없어요");
        if (t.k === "func" || node.e && this.expr(node.e).fnName) throw compileError(line, "함수에는 sizeof를 쓸 수 없어요");
        if (isVoid(t)) t = { size: 1 };
        const size = BigInt(t.size);
        return { t: T.ulong, ev: () => size, cv: size };
      }
      case "cond": {
        const c = this.condition(node.c);
        const A = this.value(this.expr(node.a), line);
        const B = this.value(this.expr(node.b), line);
        let t;
        let a = A;
        let b = B;
        if (isArith(A.t) && isArith(B.t)) {
          t = common(A.t, B.t);
          a = this.conv(A, t, line);
          b = this.conv(B, t, line);
        } else if (isPtr(A.t) && (isPtr(B.t) || B.isNull)) {
          t = A.t;
          b = this.conv(B, t, line);
        } else if (A.isNull && isPtr(B.t)) {
          t = B.t;
          a = this.conv(A, t, line);
        } else {
          throw compileError(line, "? : 의 두 값의 종류가 달라요", `${friendlyType(A.t)}와 ${friendlyType(B.t)}는 함께 쓸 수 없어요.`);
        }
        const out = { t, ev: (f) => (truthy(c(f)) ? a.ev(f) : b.ev(f)) };
        return out;
      }
      case "comma": {
        const L = this.expr(node.l);
        const R = this.expr(node.r);
        const Rv = isVoid(R.t) ? R : rv(R);
        return { t: Rv.t, ev: (f) => { L.ev ? L.ev(f) : L.lv(f); return Rv.ev(f); } };
      }
      default:
        throw compileError(line, "알 수 없는 식이에요");
    }
  }

  identifier(node) {
    const { name, line } = node;
    const info = this.lookup(name);
    if (info) return this.variable(info, line);
    if (this.funcs.has(name) || BUILTINS[name]) return { t: T.void, fnName: name };
    if (name === "true" || name === "false") {
      this.needHeader("stdbool.h", name, line);
      const v = name === "true" ? 1 : 0;
      return { t: T.int, ev: () => v, cv: v };
    }
    if (name === "NULL") {
      if (!NULL_HEADERS.some((h) => this.hasHeader(h))) this.needHeader("stdio.h", "NULL", line);
      return { t: ptr(T.void), ev: () => null, isNull: true, cv: null };
    }
    if (name === "stdin" || name === "stdout" || name === "stderr") {
      this.needHeader("stdio.h", name, line);
      return { t: FILE_T, ev: () => name };
    }
    const names = [...this.visibleNames(), ...this.funcs.keys()];
    throw compileError(line, `'${name}'라는 변수를 찾을 수 없어요`,
      `쓰기 전에 int ${name}; 처럼 먼저 선언해야 해요. 이름의 대소문자와 오타도 확인해 보세요.${suggest(name, names)}`);
  }

  variable(info, line) {
    const rt = this.rt;
    const { type, name } = info;
    const uninit = () => runtimeError(line, `값을 넣지 않은 변수 '${name}'를 사용했어요`,
      `C에서는 변수를 만들기만 하면 쓰레기 값이 들어 있어요. 먼저 값을 넣어 주세요. 예: ${typeName(type)} ${name} = 0;`);
    if (info.store) {
      const st = info.store;
      const p = new Ptr(st, 0);
      const E = { t: type, lv: () => p, varName: name };
      if (!isArr(type)) {
        E.ev = () => { const v = st.cells[0]; if (v === undefined) throw uninit(); return v; };
        E.set = (f, v) => { st.cells[0] = v; };
      }
      return E;
    }
    const slot = info.slot;
    const E = { t: type, lv: (f) => new Ptr(f[slot], 0), varName: name };
    if (!isArr(type)) {
      E.ev = (f) => { const v = f[slot].cells[0]; if (v === undefined) throw uninit(); return v; };
      E.set = (f, v) => { f[slot].cells[0] = v; };
    }
    return E;
  }

  ptrArith(P, I, sign, line) {
    const elem = P.t.to;
    if (isVoid(elem)) throw compileError(line, "void* 로는 주소 계산을 할 수 없어요", "먼저 (int *) 처럼 알맞은 타입으로 바꿔 주세요.");
    const stride = cells(elem);
    const rt = this.rt;
    return {
      t: P.t,
      ev: (f) => {
        const p = P.ev(f);
        if (p === null) rt.check(null, line, false);
        return new Ptr(p.store, p.off + sign * Number(I.ev(f)) * stride);
      },
    };
  }

  binary(node) {
    const { op, line } = node;
    if (op === "&&" || op === "||") {
      const L = this.condition(node.l, true);
      const R = this.condition(node.r, true);
      return op === "&&"
        ? { t: T.int, ev: (f) => (truthy(L(f)) && truthy(R(f)) ? 1 : 0) }
        : { t: T.int, ev: (f) => (truthy(L(f)) || truthy(R(f)) ? 1 : 0) };
    }
    const L = this.value(this.expr(node.l), line);
    const R = this.value(this.expr(node.r), line);
    return this.binaryValues(op, L, R, line);
  }

  binaryValues(op, L, R, line) {
    if (op in COMPARE) {
      if (isArith(L.t) && isArith(R.t)) {
        const ct = common(L.t, R.t);
        const a = this.conv(L, ct, line);
        const b = this.conv(R, ct, line);
        const cmp = COMPARE[op];
        return { t: T.int, ev: (f) => cmp(a.ev(f), b.ev(f)) };
      }
      if ((isPtr(L.t) || L.isNull) && (isPtr(R.t) || R.isNull)) {
        const strlit = (L.from && L.from.strlit) || (R.from && R.from.strlit);
        if (strlit) {
          throw compileError(line, `문자열은 ${op} 로 비교할 수 없어요`,
            "글자가 같은지 보려면 strcmp(a, b) == 0 을 써요. (#include <string.h> 필요)");
        }
        const cmp = ptrCompare(op, line);
        return { t: T.int, ev: (f) => cmp(L.ev(f), R.ev(f)) };
      }
      throw compileError(line, `${friendlyType(L.t)}와 ${friendlyType(R.t)}는 비교할 수 없어요`);
    }
    if (op === "+" || op === "-") {
      if (isPtr(L.t) && isInt(R.t)) return this.ptrArith(L, R, op === "+" ? 1 : -1, line);
      if (op === "+" && isInt(L.t) && isPtr(R.t)) return this.ptrArith(R, L, 1, line);
      if (op === "-" && isPtr(L.t) && isPtr(R.t)) {
        const stride = cells(L.t.to);
        return {
          t: T.long,
          ev: (f) => {
            const a = L.ev(f); const b = R.ev(f);
            if (a === null || b === null || a.store !== b.store) throw runtimeError(line, "서로 다른 배열의 주소는 뺄 수 없어요");
            return BigInt((a.off - b.off) / stride);
          },
        };
      }
    }
    if (!isArith(L.t) || !isArith(R.t)) {
      throw compileError(line, `'${op}' 계산은 숫자끼리만 할 수 있어요`, `${friendlyType(L.t)}와 ${friendlyType(R.t)}를 계산하려고 했어요.`);
    }
    if (["%", "&", "|", "^", "<<", ">>"].includes(op) && (!isInt(L.t) || !isInt(R.t))) {
      throw compileError(line, `실수에는 '${op}'를 쓸 수 없어요`,
        op === "%" ? "실수의 나머지는 fmod(a, b)를 써요. (#include <math.h> 필요)" : `'${op}'는 정수에만 쓸 수 있어요.`);
    }
    if (op === "<<" || op === ">>") {
      const t = promote(L.t);
      const a = this.conv(L, t, line);
      const b = this.conv(R, promote(R.t), line);
      const fn = arithFn(op, t, line);
      return this.folded(t, a, b, fn);
    }
    const ct = common(L.t, R.t);
    const a = this.conv(L, ct, line);
    const b = this.conv(R, ct, line);
    return this.folded(ct, a, b, arithFn(op, ct, line));
  }

  folded(t, a, b, fn) {
    if (a.cv !== undefined && b.cv !== undefined) {
      try {
        const v = fn(a.cv, b.cv);
        return { t, ev: () => v, cv: v };
      } catch { /* 0으로 나누기 같은 오류는 실행할 때 알려줘요 */ }
    }
    return { t, ev: (f) => fn(a.ev(f), b.ev(f)) };
  }

  lvalue(node, what) {
    const E = this.expr(node);
    if (!E.lv) {
      throw compileError(node.line, `${what} 왼쪽에는 변수가 와야 해요`,
        node.k === "num" ? "숫자에는 값을 넣을 수 없어요." : "값을 넣을 수 있는 변수나 배열 칸을 써 주세요.");
    }
    if (E.from && E.from.strlit || E.strlit) throw compileError(node.line, "문자열 상수에는 값을 넣을 수 없어요");
    return E;
  }

  assign(node) {
    const { line } = node;
    const L = this.lvalue(node.l, `'${node.op}'`);
    const rt = this.rt;
    if (isArr(L.t)) {
      const R = this.expr(node.r);
      throw compileError(line, "배열에는 = 로 한꺼번에 값을 넣을 수 없어요",
        R.strlit || isCharLike(L.t.of)
          ? `글자를 넣으려면 strcpy(${L.varName || "배열"}, "글자"); 를 써요. (#include <string.h> 필요)`
          : "반복문으로 한 칸씩 넣어 주세요.");
    }
    if (L.t.k === "file") throw compileError(line, "FILE에는 값을 넣을 수 없어요");
    const what = L.varName ? `'${L.varName}'에 넣는 값` : "넣는 값";
    if (node.op === "=") {
      const R = this.conv(this.value(this.expr(node.r), line), L.t, line, what);
      if (L.set) {
        const set = L.set;
        return { t: L.t, ev: (f) => { const v = R.ev(f); set(f, v); return v; } };
      }
      return { t: L.t, ev: (f) => { const p = L.lv(f); const v = R.ev(f); rt.storeAt(p, v, line); return v; } };
    }
    const op = node.op.slice(0, -1);
    const R = this.value(this.expr(node.r), line);
    // L op= R 을 L = L op R 처럼 계산해요 (L은 한 번만 찾아요).
    let p;
    const cur = { t: L.t, ev: () => rt.load(p, line) };
    const result = this.conv(this.binaryValues(op, cur, R, line), L.t, line, what);
    return {
      t: L.t,
      ev: (f) => {
        p = L.lv(f);
        const v = result.ev(f);
        rt.storeAt(p, v, line);
        return v;
      },
    };
  }

  unary(node) {
    const { op, line } = node;
    const rt = this.rt;
    if (op === "&") {
      const E = this.expr(node.e);
      if (E.fnName) throw compileError(line, "함수의 주소(함수 포인터)는 아직 지원하지 않아요");
      if (!E.lv) throw compileError(line, "숫자나 계산 결과에는 &를 붙일 수 없어요", "&는 변수나 배열 칸 앞에 붙여서 그 주소를 구해요.");
      return { t: ptr(E.t), ev: E.lv };
    }
    if (op === "*") {
      const P = this.value(this.expr(node.e), line);
      if (!isPtr(P.t)) {
        throw compileError(line, "'*'는 주소(포인터) 앞에만 쓸 수 있어요", `${friendlyType(P.t)} 앞에 *를 붙였어요. 곱하기라면 양쪽에 값이 있는지 확인해 보세요.`);
      }
      if (isVoid(P.t.to)) throw compileError(line, "void* 가 가리키는 값은 바로 읽을 수 없어요", "먼저 (int *) 처럼 알맞은 타입으로 바꿔 주세요.");
      if (P.t.to.k === "file") throw compileError(line, "FILE 안의 값은 읽을 수 없어요");
      const lv = (f) => P.ev(f);
      const E = { t: P.t.to, lv };
      if (!isArr(E.t)) E.ev = (f) => rt.load(lv(f), line);
      return E;
    }
    const E = this.value(this.expr(node.e), line);
    if (op === "!") {
      if (!isScalar(E.t)) throw compileError(line, "'!'는 참/거짓으로 볼 수 있는 값에만 쓸 수 있어요");
      return { t: T.int, ev: (f) => (truthy(E.ev(f)) ? 0 : 1), cv: E.cv !== undefined ? (truthy(E.cv) ? 0 : 1) : undefined };
    }
    if (!isArith(E.t)) throw compileError(line, `'${op}'는 숫자에만 쓸 수 있어요`);
    if (op === "~" && !isInt(E.t)) throw compileError(line, "'~'는 정수에만 쓸 수 있어요");
    const t = promote(E.t);
    const a = this.conv(E, t, line);
    let fn;
    if (op === "+") fn = (x) => x;
    else if (op === "-") {
      if (isFloat(t)) fn = (x) => -x;
      else if (is64(t)) fn = (x) => (t.unsigned ? BigInt.asUintN(64, -x) : BigInt.asIntN(64, -x));
      else fn = t.unsigned ? (x) => (-x) >>> 0 : (x) => (-x) | 0;
    } else if (is64(t)) fn = (x) => (t.unsigned ? BigInt.asUintN(64, ~x) : BigInt.asIntN(64, ~x));
    else fn = t.unsigned ? (x) => (~x) >>> 0 : (x) => ~x;
    if (a.cv !== undefined) {
      const v = fn(a.cv);
      return { t, ev: () => v, cv: v };
    }
    return { t, ev: (f) => fn(a.ev(f)) };
  }

  incdec(node, pre) {
    const { line } = node;
    const rt = this.rt;
    const L = this.lvalue(node.e, `'${node.op}'`);
    const t = L.t;
    if (!isScalar(t)) throw compileError(line, `'${node.op}'는 숫자나 주소 변수에만 쓸 수 있어요`);
    const d = node.op === "++" ? 1 : -1;
    let step;
    if (isPtr(t)) {
      if (isVoid(t.to)) throw compileError(line, "void* 로는 주소 계산을 할 수 없어요");
      const stride = cells(t.to);
      step = (v) => { if (v === null) rt.check(null, line, false); return new Ptr(v.store, v.off + d * stride); };
    } else if (is64(t)) step = (v) => convert(v + BigInt(d), t, t);
    else if (isFloat(t)) step = (v) => convert(v + d, t, t);
    else step = (v) => convert(v + d, T.int, t);
    if (L.set) {
      const { ev: get, set } = L;
      return pre
        ? { t, ev: (f) => { const v = step(get(f)); set(f, v); return v; } }
        : { t, ev: (f) => { const old = get(f); set(f, step(old)); return old; } };
    }
    return {
      t,
      ev: (f) => {
        const p = L.lv(f);
        const old = rt.load(p, line);
        const v = step(old);
        rt.storeAt(p, v, line);
        return pre ? v : old;
      },
    };
  }

  index(node) {
    const { line } = node;
    const rt = this.rt;
    let B = this.expr(node.e);
    let I = this.expr(node.i);
    if (B.fnName) throw compileError(line, `함수 '${B.fnName}'에는 [ ]를 쓸 수 없어요`);
    B = this.value(B, line);
    I = this.value(I, line);
    if (isInt(B.t) && isPtr(I.t)) [B, I] = [I, B];
    if (!isPtr(B.t)) {
      const name = node.e.k === "id" ? `'${node.e.name}'는` : "이 값은";
      throw compileError(line, `${name} 배열이 아니라서 [ ]를 쓸 수 없어요`, `${friendlyType(B.t)}예요. 배열은 int a[10]; 처럼 만들어요.`);
    }
    if (!isInt(I.t)) {
      throw compileError(line, "배열 번호는 정수여야 해요", isFloat(I.t) ? "실수를 번호로 쓰려면 (int)를 붙여 정수로 바꿔 주세요." : "");
    }
    const elem = B.t.to;
    if (isVoid(elem)) throw compileError(line, "void* 에는 [ ]를 쓸 수 없어요", "먼저 알맞은 타입의 포인터로 바꿔 주세요.");
    const stride = cells(elem);
    const lv = (f) => {
      const p = B.ev(f);
      if (p === null) rt.check(null, line, false);
      return new Ptr(p.store, p.off + Number(I.ev(f)) * stride);
    };
    const E = { t: elem, lv };
    if (!isArr(elem)) E.ev = (f) => rt.load(lv(f), line);
    return E;
  }

  cast(node) {
    const { line } = node;
    const to = this.resolveType(node.type);
    const E0 = this.expr(node.e);
    if (isVoid(to)) return { t: T.void, ev: E0.ev || E0.lv || (() => undefined) };
    const E = this.value(E0, line);
    if (isArith(to) && isArith(E.t)) return this.conv(E, to, line);
    if (isPtr(to)) {
      if (E.isNull) return { t: to, ev: () => null, isNull: true, cv: null };
      if (isPtr(E.t)) {
        if (isVoid(E.t.to) && !isVoid(to.to)) return { t: to, ev: (f) => retypeHeap(E.ev(f), to.to, line) };
        return { t: to, ev: E.ev };
      }
      throw compileError(line, "정수를 주소(포인터)로 바꾸는 건 지원하지 않아요");
    }
    if (isPtr(E.t) && isInt(to) && to.bits === 1) return this.conv(E, to, line);
    if (isPtr(E.t)) throw compileError(line, "주소(포인터)를 숫자로 바꾸는 건 지원하지 않아요");
    throw compileError(line, `${typeName(E.t)}를 ${typeName(to)}로 바꿀 수 없어요`);
  }

  // ---------- 함수 호출 ----------
  call(node) {
    const { line } = node;
    if (node.callee.k !== "id") throw compileError(line, "함수는 이름으로만 부를 수 있어요");
    const name = node.callee.name;
    const info = this.lookup(name);
    if (info) throw compileError(line, `'${name}'는 함수가 아니라 변수예요`, "변수 뒤에는 ( )를 붙일 수 없어요.");
    const user = this.funcs.get(name);
    if (user) return this.callUser(user, node);
    const b = BUILTINS[name];
    if (b) return this.callBuiltin(name, b, node);
    const all = [...this.funcs.keys(), ...Object.keys(BUILTINS).filter((n) => this.hasHeader(BUILTINS[n].header))];
    throw compileError(line, `'${name}' 함수를 찾을 수 없어요`,
      `함수를 만들었는지, 이름이 맞는지 확인해 보세요.${suggest(name, all)}`);
  }

  argCountError(name, need, got, line) {
    return compileError(line, `함수 '${name}'에는 값 ${need}개가 필요한데 ${got}개를 넣었어요`);
  }

  callUser(fi, node) {
    const { line } = node;
    const params = fi.type.params;
    if (!(fi.type.noProto && !fi.def) && node.args.length !== params.length) {
      throw this.argCountError(fi.name, params.length, node.args.length, line);
    }
    const args = node.args.map((a, i) => {
      const E = this.value(this.expr(a), line);
      return params[i] ? this.conv(E, params[i].type, line, `'${fi.name}'의 ${i + 1}번째 값`) : E;
    }).map((E) => E.ev);
    const used = !node.unused;
    const n = args.length;
    const self = this;
    return {
      t: fi.type.ret,
      ev: (f) => {
        const vals = new Array(n);
        for (let i = 0; i < n; i++) vals[i] = args[i](f);
        return self.invoke(fi, vals, line, used);
      },
    };
  }

  invoke(fi, vals, line, used) {
    const rt = this.rt;
    if (!fi.body) throw runtimeError(line, `함수 '${fi.name}'의 내용({ … })이 없어요`, "선언만 하고 만들지 않은 함수예요.");
    if (++rt.depth > MAX_DEPTH) {
      rt.depth = 0;
      throw runtimeError(line, "함수가 자기 자신을 너무 깊이 불렀어요", `${MAX_DEPTH}번 넘게 들어갔어요. 재귀 함수에 멈추는 조건(if ...: return)이 있는지 확인해 보세요.`);
    }
    const frame = new Array(fi.slotCount);
    for (let i = 0; i < fi.params.length; i++) {
      const p = fi.params[i];
      const st = new Store(1, p.name, p.type);
      st.cells[0] = vals[i];
      frame[p.slot] = st;
    }
    rt.stack.push({ fi, frame });
    const code = fi.body(frame);
    rt.stack.pop();
    rt.depth--;
    if (fi.name === "main") rt.mainFrame = frame;
    if (code === RETURN) {
      const v = rt.ret;
      rt.ret = undefined;
      return v;
    }
    if (fi.name === "main") return 0;
    if (!isVoid(fi.type.ret) && used) {
      throw runtimeError(fi.endLine, `함수 '${fi.name}'가 값을 돌려주지 않고 끝났어요`, "모든 경우에 return 값; 이 있는지 확인해 보세요.");
    }
    return undefined;
  }

  checkFormat(name, kind, fmtNode, args, line) {
    if (!fmtNode || fmtNode.k !== "str") return;
    const parts = parseFormat(fmtNode.bytes).filter((p) => p.spec && p.spec.conv !== "%");
    const wanted = [];
    for (const { spec } of parts) {
      if (kind === "scanf" && spec.conv === "[") spec.ok = true;
      if (!spec.ok) {
        throw compileError(line, `${name}의 형식 '%${spec.conv || ""}'를 알 수 없어요`,
          "자주 쓰는 형식: %d 정수, %f 실수, %c 글자, %s 문자열, %% 는 % 기호.");
      }
      if (kind === "printf" && spec.width === "*") wanted.push({ spec, star: true });
      if (kind === "printf" && spec.prec === "*") wanted.push({ spec, star: true });
      if (kind === "scanf" && spec.width === "*") continue; // %*d 는 읽기만 하고 값을 넣지 않아요
      wanted.push({ spec });
    }
    if (wanted.length !== args.length) {
      const fewer = args.length < wanted.length;
      throw compileError(line, `${name}의 형식(%)은 ${wanted.length}개인데 값은 ${args.length}개예요`,
        fewer ? "% 개수만큼 값을 넣어 주세요." : "값이 너무 많아요. 형식 문자열에 %가 빠졌는지 확인해 보세요.");
    }
    wanted.forEach(({ spec, star }, i) => {
      const E = args[i];
      const t = E.t;
      const c = spec.conv;
      const pos = `${i + 1}번째 값`;
      if (kind === "printf") {
        if (star) {
          if (!isInt(t)) throw compileError(line, `${name}의 * 자리에는 정수가 와야 해요`);
          return;
        }
        if ("diouxXc".includes(c)) {
          if (isFloat(t)) {
            throw compileError(line, `%${c}에는 정수를 넣어야 하는데 실수(${t.name})를 넣었어요`,
              `실수는 %f로 출력해요. 정수로 출력하려면 (int)를 붙여요. (${pos})`);
          }
          if (isPtr(t)) {
            throw compileError(line, `%${c}에는 정수를 넣어야 하는데 ${friendlyType(t)}를 넣었어요`,
              isCharLike(t.to) ? `문자열은 %s로 출력해요. (${pos})` : `주소는 %p로 출력해요. (${pos})`);
          }
        } else if ("fFeEgG".includes(c)) {
          if (!isFloat(t)) {
            throw compileError(line, `%${c}에는 실수를 넣어야 하는데 ${friendlyType(t)}를 넣었어요`,
              `정수는 %d로 출력하거나, (double)을 붙여 실수로 바꿔 주세요. (${pos})`);
          }
        } else if (c === "s") {
          if (!isPtr(t) || !isCharLike(t.to)) {
            throw compileError(line, `%s에는 문자열을 넣어야 하는데 ${friendlyType(t)}를 넣었어요`,
              isInt(t) && t.bits === 8 || E.charLit ? `글자 하나는 %c로 출력해요. (${pos})` : `(${pos})`);
          }
        } else if (c === "p") {
          if (!isPtr(t)) throw compileError(line, `%p에는 주소(포인터)를 넣어야 해요 (${pos})`);
        }
        return;
      }
      // scanf
      if (!isPtr(t)) {
        const varName = E.from ? null : node2name(E);
        throw compileError(line, "scanf로 읽을 변수 앞에는 &를 붙여야 해요",
          `scanf는 값을 넣을 곳의 주소가 필요해요. 예: scanf("%${c}", &${varName || "변수"});`);
      }
      let target = t.to;
      if (isArr(target)) target = target.of;
      const want = (ok, msg) => { if (!ok) throw compileError(line, msg[0], `${msg[1]} (${pos})`); };
      if ("diouxX".includes(c)) {
        want(isInt(target) && target.bits > 8 || isInt(target) && spec.len === "hh",
          [`%${c}는 정수 변수에 읽어요`, isFloat(target) ? `${target.name} 변수에는 %${target.bits === 64 ? "lf" : "f"}를 써요.` : `${friendlyType(target)}에는 쓸 수 없어요.`]);
        if (is64(target) && !["l", "ll", "j", "z", "t"].includes(spec.len)) {
          throw compileError(line, `${target.name} 변수에는 %l${c}를 써요 (${pos})`);
        }
      } else if ("fFeEgG".includes(c)) {
        want(isFloat(target), [`%${c}는 실수 변수에 읽어요`, isInt(target) ? "정수 변수에는 %d를 써요." : ""]);
        if (target.bits === 64 && spec.len !== "l" && spec.len !== "L") {
          throw compileError(line, "double 변수에는 %f 대신 %lf를 써야 해요", `scanf에서 %f는 float용이에요. (${pos})`);
        }
        if (target.bits === 32 && spec.len === "l") {
          throw compileError(line, "float 변수에는 %lf 대신 %f를 써요", `(${pos})`);
        }
      } else if (c === "c") {
        want(isCharLike(target), ["%c는 char 변수에 읽어요", `${friendlyType(target)}에는 %d를 써요.`]);
      } else if (c === "s" || c === "[") {
        want(isCharLike(target), [`%${c}는 char 배열에 읽어요`, "예: char name[20]; scanf(\"%s\", name);"]);
      }
    });

    function node2name(E) {
      return E.varName || null;
    }
  }

  callBuiltin(name, b, node) {
    const { line } = node;
    const rt = this.rt;
    this.needHeader(b.header, name, line);
    const nfixed = b.params.length;
    if (node.args.length < nfixed || (!b.variadic && node.args.length > nfixed)) {
      throw this.argCountError(name, nfixed, node.args.length, line);
    }
    const raw = node.args.map((a) => {
      const E = this.expr(a);
      if (a.k === "num" && a.isChar) E.charLit = true;
      return E;
    });
    const vals = raw.map((E) => {
      const V = this.value(E, line);
      V.charLit = E.charLit;
      V.varName = E.varName;
      return V;
    });
    if (b.format) {
      const fi = b.formatIndex || 0;
      this.checkFormat(name, b.format, node.args[fi], vals.slice(fi + 1), line);
    }
    const args = vals.map((E, i) => {
      if (i < nfixed) {
        const pt = b.params[i];
        if (pt === FILE_T) {
          if (E.t !== FILE_T) throw compileError(line, `${name}의 ${i + 1}번째 값에는 stdin을 써요`);
          return E;
        }
        return this.conv(E, pt, line, `'${name}'의 ${i + 1}번째 값`);
      }
      // 가변 인자는 기본 승격을 해요 (float → double, char/short → int).
      if (isFloat(E.t)) return this.conv(E, T.double, line);
      if (isInt(E.t)) return this.conv(E, promote(E.t), line);
      return E;
    });
    const types = args.map((E) => E.t);
    const evs = args.map((E) => E.ev);
    const n = evs.length;
    const impl = b.impl;
    return {
      t: b.ret,
      ev: (f) => {
        const vs = new Array(n);
        for (let i = 0; i < n; i++) vs[i] = evs[i](f);
        return impl(rt, vs, line, types);
      },
    };
  }

  // ---------- 초기화 ----------
  initLength(type, init) {
    if (!isArr(type) || type.lenExpr !== null || !init) return null;
    if (init.k === "str") return init.bytes.length + 1;
    if (init.k !== "initlist") return null;
    const items = init.items;
    if (type.of.k === "array" && items.length && items.every((x) => x.k !== "initlist" && x.k !== "str")) {
      const inner = this.resolveType(type.of);
      return Math.ceil(items.length / cells(inner));
    }
    return items.length;
  }

  /** 처음 값 넣기: (frame, store) => void 를 돌려줘요. */
  initializer(type, init, line, name) {
    if (!init) return null;
    if (isArr(type)) {
      const total = cells(type);
      const zero = zeroOf(baseOf(type));
      const entries = [];
      this.flatten(type, init, 0, entries, line, name);
      return (f, st) => {
        st.cells.fill(zero, 0, total);
        for (let i = 0; i < entries.length; i++) st.cells[entries[i].off] = entries[i].ev(f);
      };
    }
    let node = init;
    if (init.k === "initlist") {
      if (init.items.length !== 1) throw compileError(line, `'${name}'는 값이 하나라서 { } 안에 하나만 넣을 수 있어요`);
      node = init.items[0];
    }
    const E = this.conv(this.value(this.charHint(this.expr(node), node), line), type, line, `'${name}'의 처음 값`);
    return (f, st) => { st.cells[0] = E.ev(f); };
  }

  charHint(E, node) {
    if (node.k === "str") E.strChar = true;
    return E;
  }

  flatten(type, init, base, entries, line, name) {
    if (init.k === "str") {
      if (!isCharLike(type.of)) throw compileError(line, `'${name}'는 글자 배열이 아니라서 문자열로 처음 값을 넣을 수 없어요`);
      if (init.bytes.length > type.len) {
        throw compileError(line, `문자열이 배열 '${name}'보다 길어요`,
          `배열은 ${type.len}칸인데 글자는 끝의 \\0까지 ${init.bytes.length + 1}칸이 필요해요.`);
      }
      init.bytes.forEach((b, i) => {
        const v = convert(b, T.int, T.char);
        entries.push({ off: base + i, ev: () => v });
      });
      return;
    }
    if (init.k !== "initlist") {
      throw compileError(line, `배열 '${name}'의 처음 값은 { }로 감싸야 해요`, `예: int ${name}[3] = {1, 2, 3};`);
    }
    const items = init.items;
    const elem = type.of;
    const elemCells = cells(elem);
    if (isArr(elem) && items.every((x) => x.k !== "initlist" && x.k !== "str")) {
      // 중괄호를 생략한 2차원 배열: 차례대로 채워요
      if (items.length > cells(type)) throw compileError(line, `배열 '${name}'에 처음 값이 너무 많아요`);
      const scalar = baseOf(type);
      items.forEach((x, i) => {
        const E = this.conv(this.value(this.expr(x), line), scalar, line, `'${name}'의 처음 값`);
        entries.push({ off: base + i, ev: E.ev });
      });
      return;
    }
    if (items.length > type.len) {
      throw compileError(line, `배열 '${name}'에 처음 값이 너무 많아요`, `배열은 ${type.len}칸인데 값은 ${items.length}개예요.`);
    }
    items.forEach((x, i) => {
      const off = base + i * elemCells;
      if (isArr(elem)) {
        this.flatten(elem, x, off, entries, line, name);
      } else {
        if (x.k === "initlist") throw compileError(line, `'${name}'의 처음 값에 { }가 너무 많아요`);
        const E = this.conv(this.value(this.charHint(this.expr(x), x), line), elem, line, `'${name}'의 처음 값`);
        entries.push({ off, ev: E.ev });
      }
    });
  }

  // ---------- 선언 ----------
  declaration(node, global) {
    const closures = [];
    for (const item of node.items) {
      if (item.type.k === "func") {
        if (!global) throw compileError(item.line, "함수 안에서 다른 함수를 선언할 수 없어요", "함수 선언은 main 위쪽에 써 주세요.");
        this.declareFunction(item, null);
        continue;
      }
      const type = this.resolveType(item.type, { allowVla: !global, initLen: this.initLength(item.type, item.init) });
      if (isVoid(type)) throw compileError(item.line, `void 타입으로는 변수 '${item.name}'를 만들 수 없어요`);
      if (type.vla && item.init) throw compileError(item.line, "크기가 변하는 배열에는 처음 값을 넣을 수 없어요");
      const size = cells(type);
      if (global || item.storage === "static") {
        const st = new Store(size, item.name, type, zeroOf(baseOf(type)));
        const info = { name: item.name, type, store: st, line: item.line, global };
        this.declare(info);
        if (global) this.globals.push(info);
        else this.fn.locals.push(info);
        const init = this.initializer(type, item.init, item.line, item.name);
        if (init) this.globalInits.push(() => init(null, st));
        continue;
      }
      const slot = this.fn.slotCount++;
      const info = { name: item.name, type, slot, line: item.line, vla: Boolean(type.vla) };
      this.declare(info);
      this.fn.locals.push(info);
      const init = this.initializer(type, item.init, item.line, item.name);
      const { name, line } = item;
      const rt = this.rt;
      if (type.vla) {
        const lenEv = type.vla.ev;
        const of = type.of;
        const unit = cells(of);
        closures.push((f) => {
          rt.line = line;
          const n = Number(lenEv(f));
          if (!(n > 0)) throw runtimeError(line, `배열 '${name}'의 크기가 ${n}이에요`, "배열 크기는 1 이상이어야 해요.");
          if (n > 10_000_000) throw runtimeError(line, `배열 '${name}'이 너무 커요`);
          f[slot] = new Store(n * unit, name, arr(of, n));
          return NORMAL;
        });
        continue;
      }
      closures.push(init
        ? (f) => { rt.line = line; const st = new Store(size, name, type); f[slot] = st; init(f, st); return NORMAL; }
        : (f) => { f[slot] = new Store(size, name, type); return NORMAL; });
    }
    return closures;
  }

  declareFunction(item, def) {
    const type = this.resolveType(item.type);
    const { name, line } = item;
    if (BUILTINS[name] && this.hasHeader(BUILTINS[name].header)) {
      throw compileError(line, `'${name}'는 이미 표준 라이브러리에 있는 함수 이름이에요`, "다른 이름을 써 주세요.");
    }
    if (this.globalScope.vars.has(name)) throw compileError(line, `'${name}'는 이미 변수 이름이에요`);
    const old = this.funcs.get(name);
    if (old) {
      const same = sameType(old.type.ret, type.ret) &&
        (old.type.noProto || type.noProto || (old.type.params.length === type.params.length &&
          old.type.params.every((p, i) => sameType(p.type, type.params[i].type))));
      if (!same) throw compileError(line, `함수 '${name}'의 선언과 정의가 서로 달라요`, `${old.line}번째 줄의 선언과 매개변수, 돌려주는 타입을 맞춰 주세요.`);
      if (def && old.def) throw compileError(line, `함수 '${name}'를 두 번 만들었어요`, `${old.def.line}번째 줄에 이미 있어요.`);
      if (def) { old.def = def; old.type = type; old.line = line; }
      return old;
    }
    const fi = { name, type, def, line, body: null, slotCount: 0, locals: [], params: [] };
    this.funcs.set(name, fi);
    return fi;
  }

  compileFunction(fi) {
    const def = fi.def;
    this.fn = fi;
    fi.slotCount = 0;
    fi.locals = [];
    fi.params = [];
    this.push();
    def.type.params.forEach((p, i) => {
      if (!p.name) throw compileError(def.line, `함수 '${fi.name}'의 ${i + 1}번째 매개변수에 이름이 필요해요`);
      const type = fi.type.params[i].type;
      const info = { name: p.name, type, slot: fi.slotCount++, line: p.line };
      this.declare(info);
      fi.locals.push(info);
      fi.params.push(info);
    });
    fi.body = this.block(def.body, false);
    const last = def.body.body[def.body.body.length - 1];
    fi.endLine = last ? last.line : def.body.line;
    this.pop();
    this.fn = null;
  }

  // ---------- 문장 ----------
  condition(node, inner = false) {
    if (!inner && node.k === "assign" && node.op === "=" && !node.paren) {
      throw compileError(node.line, "조건에 = 를 썼어요",
        "같은지 비교하려면 == 를 써요. 예: if (x == 5). 정말 값을 넣으려면 괄호를 한 번 더 씌워 주세요.");
    }
    const E = this.value(this.expr(node), node.line);
    if (!isScalar(E.t)) throw compileError(node.line, "조건에는 참/거짓으로 볼 수 있는 값이 와야 해요");
    return E.ev;
  }

  seq(list) {
    const n = list.length;
    if (n === 0) return () => NORMAL;
    if (n === 1) return list[0];
    return (f) => {
      for (let i = 0; i < n; i++) {
        const c = list[i](f);
        if (c) return c;
      }
      return NORMAL;
    };
  }

  block(node, newScope = true) {
    if (newScope) this.push();
    const list = [];
    for (const s of node.body) list.push(...this.statements(s));
    if (newScope) this.pop();
    return this.seq(list);
  }

  /** 문장 하나를 클로저 목록으로 (선언은 여러 개가 될 수 있어요). */
  statements(node) {
    if (node.k === "decl") return this.declaration(node, false);
    return [this.statement(node)];
  }

  statement(node) {
    const rt = this.rt;
    const line = node.line;
    switch (node.k) {
      case "block": return this.block(node);
      case "decl": return this.seq(this.declaration(node, false));
      case "empty": return () => NORMAL;
      case "expr": {
        if (node.e.k === "call") node.e.unused = true;
        const E = this.expr(node.e);
        if (E.fnName) throw compileError(line, `함수 '${E.fnName}' 뒤에 괄호가 필요해요`, `${E.fnName}(...); 처럼 써요.`);
        const ev = E.ev || E.lv;
        return (f) => { rt.line = line; ev(f); return NORMAL; };
      }
      case "if": {
        const c = this.condition(node.cond);
        const th = this.statement(node.then);
        const el = node.otherwise ? this.statement(node.otherwise) : null;
        return el
          ? (f) => { rt.line = line; return truthy(c(f)) ? th(f) : el(f); }
          : (f) => { rt.line = line; return truthy(c(f)) ? th(f) : NORMAL; };
      }
      case "while": {
        const c = this.condition(node.cond);
        this.loops++;
        const body = this.statement(node.body);
        this.loops--;
        return (f) => {
          for (;;) {
            rt.line = line;
            if (!truthy(c(f))) return NORMAL;
            const r = body(f);
            if (r === BREAK) return NORMAL;
            if (r === RETURN) return RETURN;
          }
        };
      }
      case "dowhile": {
        this.loops++;
        const body = this.statement(node.body);
        this.loops--;
        const c = this.condition(node.cond);
        return (f) => {
          do {
            const r = body(f);
            if (r === BREAK) return NORMAL;
            if (r === RETURN) return RETURN;
            rt.line = line;
          } while (truthy(c(f)));
          return NORMAL;
        };
      }
      case "for": {
        this.push();
        let init = null;
        if (node.init) {
          init = node.init.k === "decl" ? this.seq(this.declaration(node.init, false)) : this.statement(node.init);
        }
        const c = node.cond ? this.condition(node.cond) : null;
        const stepE = node.step ? this.expr(node.step) : null;
        const step = stepE ? stepE.ev || stepE.lv : null;
        this.loops++;
        const body = this.statement(node.body);
        this.loops--;
        this.pop();
        return (f) => {
          if (init) init(f);
          for (;;) {
            rt.line = line;
            if (c && !truthy(c(f))) return NORMAL;
            const r = body(f);
            if (r === BREAK) return NORMAL;
            if (r === RETURN) return RETURN;
            if (step) step(f);
          }
        };
      }
      case "switch": return this.switchStatement(node);
      case "case": case "default":
        throw compileError(line, `${node.k}는 switch 바로 안에서만 쓸 수 있어요`);
      case "break":
        if (this.loops === 0 && this.switches === 0) throw compileError(line, "break는 반복문이나 switch 안에서만 쓸 수 있어요");
        return () => BREAK;
      case "continue":
        if (this.loops === 0) throw compileError(line, "continue는 반복문 안에서만 쓸 수 있어요");
        return () => CONTINUE;
      case "return": {
        const ret = this.fn.type.ret;
        if (!node.e) {
          if (!isVoid(ret)) throw compileError(line, `함수 '${this.fn.name}'는 값을 돌려줘야 해요`, `return 뒤에 돌려줄 값을 써 주세요. 예: return 0;`);
          return () => { rt.ret = undefined; return RETURN; };
        }
        if (isVoid(ret)) {
          throw compileError(line, `void 함수 '${this.fn.name}'는 값을 돌려줄 수 없어요`, "값을 돌려주려면 함수 앞의 void를 int 같은 타입으로 바꿔요.");
        }
        const E = this.conv(this.value(this.expr(node.e), line), ret, line, "돌려주는 값");
        const ev = E.ev;
        return (f) => { rt.line = line; rt.ret = ev(f); return RETURN; };
      }
      case "func":
        throw compileError(line, "함수 안에서 다른 함수를 만들 수 없어요", "함수는 main 바깥에 따로 만들어요.");
      default:
        throw compileError(line, "알 수 없는 문장이에요");
    }
  }

  switchStatement(node) {
    const rt = this.rt;
    const { line } = node;
    const E = this.value(this.expr(node.e), line);
    if (!isInt(E.t)) throw compileError(line, "switch에는 정수(또는 글자) 값만 쓸 수 있어요");
    const t = promote(E.t);
    const val = this.conv(E, t, line).ev;
    this.push();
    this.switches++;
    const list = [];
    const cases = new Map();
    let defaultIndex = -1;
    for (const s of node.body.body) {
      if (s.k === "case") {
        const C = this.value(this.expr(s.e), s.line);
        if (C.cv === undefined || !isInt(C.t)) throw compileError(s.line, "case에는 정수나 'a' 같은 상수만 쓸 수 있어요");
        const key = String(convert(C.cv, C.t, t));
        if (cases.has(key)) throw compileError(s.line, `case ${key}가 두 번 나왔어요`);
        cases.set(key, list.length);
      } else if (s.k === "default") {
        if (defaultIndex >= 0) throw compileError(s.line, "default가 두 번 나왔어요");
        defaultIndex = list.length;
      } else {
        list.push(...this.statements(s));
      }
    }
    this.switches--;
    this.pop();
    return (f) => {
      rt.line = line;
      const key = String(val(f));
      const start = cases.has(key) ? cases.get(key) : defaultIndex;
      if (start < 0) return NORMAL;
      for (let i = start; i < list.length; i++) {
        const c = list[i](f);
        if (c === BREAK) return NORMAL;
        if (c) return c;
      }
      return NORMAL;
    };
  }

  // ---------- 프로그램 ----------
  compile(ast) {
    // 함수 이름을 먼저 모두 등록해서, 뒤에 만든 함수도 부를 수 있게 해요.
    for (const item of ast.items) {
      if (item.k === "func") this.declareFunction(item, item);
    }
    for (const item of ast.items) {
      if (item.k === "func") {
        const fi = this.funcs.get(item.name);
        if (fi.def === item) this.compileFunction(fi);
      } else {
        this.declaration(item, true);
      }
    }
    const main = this.funcs.get("main");
    if (!main || !main.def) {
      throw compileError(1, "main 함수가 없어요", "C 프로그램은 int main(void) { … } 에서 시작해요.");
    }
    const mp = main.type.params;
    if (mp.length !== 0 && !(mp.length === 2 && isInt(mp[0].type) && isPtr(mp[1].type))) {
      throw compileError(main.line, "main 함수의 매개변수가 올바르지 않아요", "int main(void) 또는 int main(int argc, char *argv[]) 로 써요.");
    }
    return {
      run: () => {
        for (const init of this.globalInits) init();
        let args = [];
        if (mp.length === 2) {
          const name = new Store(5, "프로그램 이름", arr(T.char, 5));
          [109, 97, 105, 110, 0].forEach((b, i) => { name.cells[i] = b; });
          const argv = new Store(2, "argv", arr(ptr(T.char), 2));
          argv.cells[0] = new Ptr(name, 0);
          argv.cells[1] = null;
          args = [1, new Ptr(argv, 0)];
        }
        const code = this.invoke(main, args, main.line, true);
        return code === undefined ? 0 : Number(code);
      },
      main,
      globals: this.globals,
    };
  }
}
