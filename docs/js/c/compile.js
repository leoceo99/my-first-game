// 구문 트리를 검사하고(타입, 선언), 바로 실행할 수 있는 JS 함수(클로저)로 바꿔요.

import {
  T, Ptr, Store, FnRef, CError, ptr, arr, func, compileError, runtimeError, convert, zeroOf, zerosOf, truthy, cells, baseOf,
  alignOf, utf8, isInt, isFloat, isArith, isPtr, isArr, isScalar, is64, isVoid, isCharLike, isStruct, isFunc, isFuncPtr,
  sameType, common, promote, typeName, friendlyType, STRING_T, vectorOf, isObj, hasObj,
} from "./types.js";
import {
  BUILTINS, FILE_T, STDIN, STDOUT, STDERR, JumpSignal, parseFormat, retypeHeap,
  MANIP, STD_STREAMS, MANIPULATORS, MANIP_MAKERS, streamPut, streamGet, streamGetChar, streamIgnore,
  NPOS, newString, strBytes, strLen, setStr, newVector, vecLen, vecResized, cloneValue, cloneCells, strCompare,
  streamGetWord, streamGetLine, toStringBytes, parseNumber,
} from "./runtime.js";
import { CPP_C_HEADERS, STD_LATER } from "./lexer.js";

const NORMAL = 0;
const BREAK = 1;
const CONTINUE = 2;
const RETURN = 3;
const GOTO = 4;
const MAX_DEPTH = 2500;
const NULL_HEADERS = ["stdio.h", "stdlib.h", "string.h", "stddef.h", "time.h"];
/** string과 함께 쓰는 std 함수들 */
const STR_FUNCS = new Set(["getline", "to_string", "stoi", "stol", "stoll", "stod", "stof"]);

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

const ptrEq = (a, b) => {
  if (a === b) return true;
  if (a === null || b === null || a instanceof FnRef || b instanceof FnRef) return false;
  return a.store === b.store && a.off === b.off;
};

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

// ---------- 크기가 실행 중에 정해지는 배열 (VLA) ----------
// VLA의 길이는 함수 칸(frame)의 한 자리(vla.slot)에 실행할 때 넣어 두고, 칸 수·크기는 그 값으로 계산해요.
function isDyn(t) {
  return isArr(t) && (Boolean(t.vla) || isDyn(t.of));
}

/** 칸 수: 정해져 있으면 숫자, VLA면 (frame) => 숫자 */
function cellsDyn(t) {
  if (!isDyn(t)) return cells(t);
  const inner = cellsDyn(t.of);
  const slot = t.vla ? t.vla.slot : -1;
  const fixed = t.len;
  const len = slot >= 0 ? (f) => f[slot] : () => fixed;
  return typeof inner === "number" ? (f) => len(f) * inner : (f) => len(f) * inner(f);
}

/** 바이트 크기: 정해져 있으면 숫자, VLA면 (frame) => 숫자 */
function sizeDyn(t) {
  if (!isDyn(t)) return t.size;
  const inner = sizeDyn(t.of);
  const slot = t.vla ? t.vla.slot : -1;
  const fixed = t.len;
  const len = slot >= 0 ? (f) => f[slot] : () => fixed;
  return typeof inner === "number" ? (f) => len(f) * inner : (f) => len(f) * inner(f);
}

/** 실행 중의 길이를 넣은 진짜 배열 타입 (화면 표시와 범위 검사용) */
function concrete(t, f) {
  if (!isDyn(t)) return t;
  return arr(concrete(t.of, f), t.vla ? f[t.vla.slot] : t.len);
}

/** 타입 안의 VLA 길이들 (바깥부터) */
function vlaDims(t, out = []) {
  if (isArr(t)) {
    if (t.vla) out.push(t.vla);
    vlaDims(t.of, out);
  } else if (isPtr(t)) vlaDims(t.to, out);
  return out;
}

function hasAnyLen(t) {
  if (isArr(t)) return Boolean(t.anyLen) || hasAnyLen(t.of);
  if (isPtr(t)) return hasAnyLen(t.to);
  return false;
}

/** VLA 길이를 계산해서 칸에 넣어요 */
function fillDims(dims, f, rt) {
  for (const d of dims) {
    const n = Number(d.ev(f));
    if (!(n > 0)) throw runtimeError(d.line, `배열 크기가 ${n}이에요`, "배열 크기는 1 이상이어야 해요.");
    if (n > 10_000_000) throw runtimeError(d.line, "배열이 너무 커요", "1000만 칸 이하로 만들어 주세요.");
    f[d.slot] = n;
  }
}

/** 이 식이 값을 쓰는 방식 (C의 rvalue): 배열은 첫 원소 주소가 돼요. */
function rv(E) {
  if (isArr(E.t)) {
    const t = ptr(E.t.of);
    if (E.isConst) t.toConst = true;
    return { t, ev: E.lv, from: E };
  }
  return E;
}

export class Compiler {
  constructor(rt, includes, { dialect = "c" } = {}) {
    this.rt = rt;
    this.includes = includes;
    this.cpp = dialect === "cpp";
    this.boolT = this.cpp ? T.bool : T.int; // 비교 결과: C는 int, C++는 bool
    this.usingStd = false; // using namespace std;
    this.usingNames = new Set(); // using std::cout;
    this.usingNs = new Set(); // using namespace geo;
    this.ns = ""; // 지금 컴파일하는 코드가 들어 있는 이름공간
    this.funcs = new Map();
    this.globalScope = { vars: new Map(), parent: null };
    this.scope = this.globalScope;
    this.fn = null;
    this.loops = 0;
    this.switches = 0;
    this.globalInits = [];
    this.labelScopes = [];
    this.fnLabels = new Set();
    this.globals = [];
    this.strings = new Map();
    this.builtinTypes = {};
    this.errnoInfo = null;
  }

  /** 표준 함수 목록의 "div_t", "tm*" 같은 이름을 실제 타입으로 바꿔요 */
  btype(x, line) {
    if (typeof x !== "string") return x;
    const star = x.endsWith("*");
    const base = this.builtinTypes[star ? x.slice(0, -1) : x];
    if (!base) throw compileError(line, `표준 타입 ${x}를 찾을 수 없어요`);
    if (isStruct(base)) this.layout(base, line);
    return star ? ptr(base) : base;
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
      // C++에서는 <stdio.h> 대신 <cstdio> 처럼 써요
      const cppName = this.cpp ? Object.keys(CPP_C_HEADERS).find((k) => CPP_C_HEADERS[k] === h) : null;
      const shown = cppName || h;
      throw compileError(line, `${what}를 쓰려면 #include <${shown}>가 필요해요`, `맨 위에 #include <${shown}> 를 넣어 주세요.`);
    }
  }

  // ---------- C++: std 이름 ----------
  /** std::cout → "cout". using namespace std; 뒤라면 cout → "cout". std 이름이 아니면 null */
  stdName(name) {
    if (!this.cpp) return null;
    if (name.startsWith("std::")) return name.slice(5);
    if (this.usingStd || this.usingNames.has(name)) return name;
    return null;
  }

  /** cout, cin, endl, fixed … 같은 std 이름을 식으로 만들어요. 해당하지 않으면 null */
  stdIdentifier(name, line) {
    const base = name.startsWith("std::") ? name.slice(5) : name;
    if (base === "string::npos") return { t: T.ulong, ev: () => NPOS, cv: NPOS };
    const known = STD_STREAMS[base] || MANIPULATORS[base] || MANIP_MAKERS[base];
    if (!known) {
      if (name.startsWith("std::") && !BUILTINS[base]) {
        throw compileError(line, `std::${base}는 아직 없어요`, Object.hasOwn(STD_LATER, base) ? `C++ ${STD_LATER[base]}단계에서 만들 예정이에요.` : "이름에 오타가 있는지 확인해 보세요.");
      }
      return null;
    }
    if (this.stdName(name) === null) {
      throw compileError(line, `'${name}'는 std::${name}이에요`, `맨 위(#include 아래)에 using namespace std; 를 넣거나 std::${name} 처럼 써요.`);
    }
    this.needHeader(MANIP_MAKERS[base] ? "iomanip" : "iostream", `std::${base}`, line);
    if (STD_STREAMS[base]) {
      const { stream, type } = STD_STREAMS[base];
      return { t: type, ev: () => stream, varName: base };
    }
    if (MANIP_MAKERS[base]) throw compileError(line, `${base}는 ${base}(값) 처럼 괄호와 함께 써요`, `예: cout << ${base}(2) << x;`);
    const m = MANIPULATORS[base];
    return { t: MANIP, ev: () => m };
  }

  // ---------- C++ 2단계: 참조, auto, 오버로딩, new/delete, 범위 for, 이름공간 ----------
  /** 참조를 묶어요: 이름 있는 값(lvalue)이면 그 주소, const 참조면 임시 값의 주소도 돼요. 주소를 돌려주는 ev */
  bindRef(ref, E, line, what = "참조") {
    const rt = this.rt;
    const to = this.need(ref.to, line);
    if (E.lv && !E.bitfield && (sameType(E.t, to) || (isCharLike(E.t) && isCharLike(to) && E.t.bits === to.bits))) {
      if (E.isConst && !ref.toConst) {
        throw compileError(line, `const인 값을 ${typeName(ref)}로 받을 수 없어요`, `const ${typeName(to)} & 로 받으면 돼요.`);
      }
      return E.lv;
    }
    if (ref.toConst && !isArr(to)) {
      // const T& 에는 계산 결과도 넣을 수 있어요: 임시 칸을 만들어 가리켜요
      const V = this.conv(this.value(E, line), to, line, what);
      const n = cells(to);
      const multi = isStruct(to);
      return (f) => {
        const st = new Store(n, "임시 값", to);
        const v = V.ev(f);
        if (multi) st.cells = v.slice();
        else st.cells[0] = v;
        return new Ptr(st, 0);
      };
    }
    if (E.lv && !E.bitfield) {
      throw compileError(line, `${what}의 타입이 맞지 않아요`, `${typeName(ref)}에는 ${typeName(to)} 변수가 와야 하는데 ${typeName(E.t)}를 넣었어요.`);
    }
    throw compileError(line, `${what}에는 변수처럼 이름이 있는 값을 넣어야 해요`,
      `계산 결과나 숫자는 ${typeName(ref)}로 받을 수 없어요. const ${typeName(to)} & 로 받거나 값으로 받아 주세요.`);
  }

  /** auto가 들어 있는 타입이면 처음 값의 타입으로 바꿔요 */
  deduceAuto(type, initNode, line, name) {
    const hasAuto = (t) => t && (t.k === "auto" || ((t.k === "ref" || t.k === "ptr") && hasAuto(t.to)));
    if (!hasAuto(type)) return type;
    if (!initNode || initNode.k === "initlist") {
      throw compileError(line, `auto 변수 '${name}'에는 = 처음 값이 필요해요`, `처음 값을 보고 타입을 정해요. 예: auto ${name} = 0;`);
    }
    const E = this.expr(initNode);
    if (E.builtinName || E.fnName) throw compileError(line, "함수 이름으로는 auto 타입을 정할 수 없어요");
    const subst = (t, actual) => {
      if (t.k === "auto") return actual;
      if (t.k === "ref") return { ...t, to: subst(t.to, actual) };
      // auto *p = &x;
      if (!isPtr(actual)) throw compileError(line, `auto *${name} 에는 주소가 와야 해요`);
      return ptr(subst(t.to, actual.to));
    };
    if (type.k === "ref") return { ...type, to: subst(type.to, E.t) };
    const V = this.value(E, line);
    if (isVoid(V.t)) throw compileError(line, "void 값으로는 auto 변수를 만들 수 없어요");
    return subst(type, V.t);
  }

  /** 같은 이름의 함수(오버로딩) 중에서 넣은 값에 가장 잘 맞는 것을 골라요 */
  pickOverload(group, args, node, name) {
    const { line } = node;
    const rank = (E, to) => {
      if (E.initlist) {
        const target = to.k === "ref" ? to.to : to;
        return isStruct(target) || isObj(target) ? 2 : Infinity;
      }
      if (to.k === "ref") {
        if (E.lv && !E.bitfield && sameType(E.t, to.to) && !(E.isConst && !to.toConst)) return 0;
        if (!to.toConst) return Infinity;
        return rank({ ...E, lv: null }, to.to);
      }
      let V;
      try { V = this.value(E, line); } catch { return Infinity; }
      const from = V.t;
      if (sameType(from, to) && Boolean(from.isBool) === Boolean(to.isBool)) return 0;
      if (isArith(from) && isArith(to)) {
        const promo = (isInt(from) && isInt(to) && from.rank < T.int.rank && to === T.int) || (isFloat(from) && from.bits === 32 && to.bits === 64);
        return promo ? 1 : 2;
      }
      if (isPtr(to) && (V.isNull || (isPtr(from) && (sameType(from.to, to.to) || isVoid(to.to))))) return 2;
      return Infinity;
    };
    const viable = [];
    for (const fi of group) {
      const ps = fi.type.params;
      const need = ps.filter((p) => !p.dflt).length;
      if (args.length < need || (args.length > ps.length && !fi.type.variadic)) continue;
      const ranks = args.map((E, i) => (ps[i] ? rank(E, ps[i].type) : 3));
      if (ranks.some((r) => r === Infinity)) continue;
      viable.push({ fi, ranks });
    }
    const better = (a, b) => a.ranks.every((r, i) => r <= b.ranks[i]) && a.ranks.some((r, i) => r < b.ranks[i]);
    const best = viable.filter((c) => !viable.some((d) => d !== c && better(d, c)));
    const sig = (fi) => `${fi.name}(${fi.type.params.map((p) => typeName(p.type)).join(", ")})`;
    if (best.length === 1) return best[0].fi;
    if (best.length === 0) {
      throw compileError(line, `넣은 값에 맞는 '${name}' 함수가 없어요`, `있는 함수: ${group.map(sig).join(", ")}`);
    }
    throw compileError(line, `'${name}' 함수 중 어느 것을 부를지 정할 수 없어요`,
      `${best.map((c) => sig(c.fi)).join("와 ")}가 똑같이 잘 맞아요. 값의 타입을 (double)x 처럼 밝혀 주세요.`);
  }

  /** new int, new int[n], new Point{1, 2} */
  newExpr(node) {
    const { line } = node;
    const rt = this.rt;
    const type = this.need(this.resolveType(node.type, { line }), line);
    if (isVoid(type) || isFunc(type) || type.k === "ref") throw compileError(line, `new ${typeName(type)}는 만들 수 없어요`);
    const unit = cells(type);
    if (node.count) {
      const N = this.value(this.expr(node.count), line);
      if (!isInt(N.t)) throw compileError(line, "new T[개수]의 개수는 정수여야 해요");
      const zero = Boolean(node.args) || Boolean(node.list);
      if (node.args && node.args.length) throw compileError(line, "new T[n]( ) 의 괄호 안에는 아무것도 넣지 않아요");
      const items = node.list ? node.list.items.map((x) => this.conv(this.value(this.expr(x), line), type, line, "new 배열의 처음 값")) : [];
      const zeros = zerosOf(type);
      return {
        t: ptr(type),
        ev: (f) => {
          const n = Number(N.ev(f));
          if (!(n >= 0) || n * unit > 50_000_000) throw runtimeError(line, `new로 ${n}칸을 만들 수 없어요`, "개수가 음수이거나 너무 커요.");
          if (items.length > n) throw runtimeError(line, `new 배열(${n}칸)에 처음 값이 너무 많아요`);
          const st = new Store(n * unit, "new 메모리", arr(type, n));
          if (zero || zeros.some((z) => z === null)) for (let i = 0; i < n * unit; i++) st.cells[i] = zeros[i % unit];
          items.forEach((E, i) => { st.cells[i * unit] = E.ev(f); });
          st.heap = true;
          st.newKind = "array";
          st.elemSize = type.size;
          return new Ptr(st, 0);
        },
      };
    }
    let init = null;
    if (node.list) init = this.initializer(type, node.list, line, "new");
    else if (node.args && node.args.length > 1) throw compileError(line, `new ${typeName(type)}(…)에 값이 너무 많아요`, "생성자는 C++ 3단계(클래스)에서 지원해요.");
    else if (node.args && node.args.length === 1) init = this.initializer(type, node.args[0], line, "new");
    const zeros = node.args ? zerosOf(type) : null;
    return {
      t: ptr(type),
      ev: (f) => {
        const st = new Store(unit, "new 메모리", type);
        if (zeros) st.cells = zeros.slice();
        if (init) init(f, st);
        st.heap = true;
        st.newKind = "single";
        st.elemSize = type.size;
        return new Ptr(st, 0);
      },
    };
  }

  deleteExpr(node) {
    const { line } = node;
    const P = this.value(this.expr(node.e), line);
    if (!isPtr(P.t)) throw compileError(line, "delete 뒤에는 new로 만든 주소(포인터)가 와야 해요");
    const want = node.array ? "array" : "single";
    return {
      t: T.void,
      ev: (f) => {
        const p = P.ev(f);
        if (p === null) return; // delete nullptr 은 아무 일도 하지 않아요
        const st = p.store;
        if (!st.heap) throw runtimeError(line, "new로 만들지 않은 메모리를 delete했어요", "delete는 new로 만든 주소에만 써요.");
        if (!st.newKind) throw runtimeError(line, "malloc으로 받은 메모리를 delete했어요", "malloc은 free로, new는 delete로 돌려줘요.");
        if (st.freed) throw runtimeError(line, "이미 delete한 메모리를 또 delete했어요");
        if (p.off !== 0) throw runtimeError(line, "new로 받은 주소의 중간을 delete했어요", "new가 돌려준 주소 그대로 delete해 주세요.");
        if (st.newKind !== want) {
          throw runtimeError(line, want === "array" ? "new로 만든 하나짜리를 delete[]로 지웠어요" : "new[]로 만든 배열을 delete로 지웠어요",
            want === "array" ? "new T 는 delete p; 로 지워요." : "new T[n] 은 delete[] p; 로 지워요.");
        }
        st.freed = true;
      },
    };
  }

  /** for (int x : 배열) / for (auto &x : 배열) */
  rangeFor(node) {
    const { line } = node;
    const rt = this.rt;
    this.push();
    const R = this.expr(node.range);
    let elem;
    let stride;
    let count;
    let baseOf;
    if (this.cpp && isObj(R.t)) {
      // string은 글자 하나씩, vector는 원소 하나씩
      const S = this.objRef(R, line);
      elem = R.t.k === "string" ? T.char : R.t.of;
      stride = cells(elem);
      let obj = null;
      baseOf = (f) => { obj = S(f); return new Ptr(obj, 0); };
      count = () => (R.t.k === "string" ? strLen(obj) : vecLen(obj));
    } else {
      if (!isArr(R.t) || !R.lv) {
        throw compileError(line, "범위 기반 for의 : 뒤에는 배열, string, vector가 와야 해요", `${friendlyType(R.t)}는 하나씩 꺼낼 수 없어요.`);
      }
      elem = this.need(R.t.of, line);
      stride = cellsDyn(elem);
      if (typeof stride === "function") throw compileError(line, "크기가 실행 중에 정해지는 2차원 배열은 범위 기반 for로 돌 수 없어요");
      const total = cellsDyn(R.t);
      count = typeof total === "function" ? (f) => total(f) / stride : () => R.t.len;
      baseOf = R.lv;
    }
    const d = node.decl;
    let cur = null;
    const fake = this.withLoad({ t: elem, lv: () => cur, varName: `${d.name}의 원소`, isConst: Boolean(R.isConst) }, line);
    let type = d.type;
    if (type.k === "auto") type = isArr(elem) ? ptr(elem.of) : elem;
    else if (type.k === "ref" && type.to.k === "auto") type = { ...type, to: elem };
    type = this.resolveType(type, { line });
    const slot = this.fn.slotCount++;
    const info = { name: d.name, type, slot, line: d.line, isConst: d.isConst };
    this.declare(info);
    this.fn.locals.push(info);
    let bind;
    if (type.k === "ref") {
      bind = this.bindRef(type, fake, line, `'${d.name}'`);
    } else {
      const V = this.conv(this.value(fake, line), type, line, `'${d.name}'`);
      bind = V.ev;
    }
    const isRef = type.k === "ref";
    const n = cells(type);
    const multi = isStruct(type);
    this.loops++;
    const body = this.statement(node.body);
    this.loops--;
    this.pop();
    const name = d.name;
    return (f) => {
      rt.line = line;
      const base = baseOf(f);
      const len = count(f);
      for (let i = 0; i < len; i++) {
        cur = new Ptr(base.store, base.off + i * stride);
        const st = new Store(isRef ? 1 : n, name, type);
        const v = bind(f);
        if (multi && !isRef) st.cells = v.slice();
        else st.cells[0] = v;
        f[slot] = st;
        const r = body(f);
        if (r === BREAK) return NORMAL;
        if (r === RETURN || r === GOTO) return r;
      }
      return NORMAL;
    };
  }

  /** 이름공간 안이나 using namespace 뒤에서 짧은 이름을 긴 이름(geo::area)으로 찾아요 */
  resolveName(name) {
    if (!this.cpp || this.lookup(name) || this.funcs.has(name)) return name;
    const has = (n) => this.globalScope.vars.has(n) || this.funcs.has(n);
    const parts = this.ns ? this.ns.split("::") : [];
    for (let k = parts.length; k > 0; k--) {
      const full = `${parts.slice(0, k).join("::")}::${name}`;
      if (has(full)) return full;
    }
    for (const ns of this.usingNs) if (has(`${ns}::${name}`)) return `${ns}::${name}`;
    return name;
  }

  /** std::swap(a, b) */
  stdSwap(node) {
    const { line } = node;
    const rt = this.rt;
    if (node.args.length !== 2) throw compileError(line, "swap에는 변수 두 개를 넣어요", "예: swap(a, b);");
    const A = this.lvalue(node.args[0], "swap");
    const B = this.lvalue(node.args[1], "swap");
    if (!sameType(A.t, B.t)) throw compileError(line, `swap의 두 변수는 타입이 같아야 해요 (${typeName(A.t)}와 ${typeName(B.t)})`);
    if (isArr(A.t)) throw compileError(line, "배열은 swap으로 바꿀 수 없어요");
    const n = isStruct(A.t) ? cells(A.t) : 1;
    return {
      t: T.void,
      ev: (f) => {
        const p = A.lv(f);
        const q = B.lv(f);
        const a = rt.loadStruct(p, n, line);
        const b = rt.loadStruct(q, n, line);
        rt.storeStruct(p, b, line);
        rt.storeStruct(q, a, line);
      },
    };
  }

  // ---------- C++ 2단계: std::string, std::vector ----------
  /** 비어 있는(null) string/vector를 처음 쓸 때 만들어요 */
  freshObj(type) {
    return type.k === "string" ? newString([]) : newVector(type.of);
  }

  /** 식이 가리키는 string/vector 물건(Store)을 꺼내는 함수. 변수면 복사하지 않고 그 자리의 것을 써요. */
  objRef(E, line) {
    const rt = this.rt;
    const type = E.t;
    if (E.lv) {
      const lv = E.lv;
      return (f) => {
        const p = lv(f);
        rt.check(p, line, false);
        let st = p.store.cells[p.off];
        if (st == null) {
          st = this.freshObj(type);
          p.store.cells[p.off] = st;
        }
        return st;
      };
    }
    const ev = E.ev;
    return (f) => ev(f) || this.freshObj(type);
  }

  /** string에 이어 붙일 수 있는 값(string, 문자열, 글자)의 바이트들을 꺼내는 함수. 안 되면 null */
  bytesOf(V, line, what) {
    const rt = this.rt;
    if (V.t.k === "string") { const ev = V.ev; return (f) => strBytes(ev(f)); }
    if (isPtr(V.t) && isCharLike(V.t.to)) {
      const ev = V.ev;
      return (f) => {
        const p = ev(f);
        if (p === null) throw runtimeError(line, `NULL 문자열을 string에 쓰려고 했어요`);
        return rt.readCString(p, line);
      };
    }
    if (isInt(V.t) && V.t.bits === 8 && !V.t.isBool) { const ev = V.ev; return (f) => [ev(f) & 255]; }
    if (what === null) return null;
    throw compileError(line, `${friendlyType(V.t)}는 string에 ${what}할 수 없어요`,
      isArith(V.t) ? "숫자를 글자로 바꾸려면 to_string(x)를 써요." : "string, \"문자열\", 'c' 글자만 쓸 수 있어요.");
  }

  /** E를 string/vector로 바꿔요 */
  convObj(E, to, line, what) {
    const rt = this.rt;
    if (to.k === "string") {
      if (isPtr(E.t) && isCharLike(E.t.to)) {
        const ev = E.ev;
        return {
          t: to,
          ev: (f) => {
            const p = ev(f);
            if (p === null) throw runtimeError(line, "NULL 문자열로 string을 만들려고 했어요");
            return newString(rt.readCString(p, line));
          },
        };
      }
      throw compileError(line, `${what}에 ${friendlyType(E.t)}를 넣을 수 없어요`, isArith(E.t) ? "숫자를 글자로 바꾸려면 to_string(x)를 써요." : "string이 필요해요.");
    }
    if (E.t.k === "string" && isPtr(to) && isCharLike(to.to)) {
      throw compileError(line, `string을 ${typeName(to)}로 바로 쓸 수 없어요`, "s.c_str() 처럼 c_str()을 붙이면 char * 문자열이 돼요.");
    }
    if (to.k === "vector" && E.t.k === "vector") {
      throw compileError(line, `${typeName(E.t)}를 ${typeName(to)}에 넣을 수 없어요`, "원소의 타입이 같아야 해요.");
    }
    throw compileError(line, `${what}의 타입이 맞지 않아요`, `${typeName(to)}가 필요한데 ${friendlyType(E.t)}를 넣었어요.`);
  }

  /** vector의 원소 하나를 만드는 함수: 원소 칸들의 목록을 돌려줘요 */
  elemValue(of, node, line, what) {
    const unit = cells(of);
    if (node && node.k === "initlist" && isStruct(of)) {
      const init = this.initializer(of, node, line, what);
      const empty = zerosOf(of);
      return (f) => { const st = new Store(unit, what, of); st.cells = empty.slice(); init(f, st); return st.cells; };
    }
    if (isObj(of)) { const ev = this.objectValue(of, node, line, what); return (f) => [ev(f)]; }
    if (node && node.k === "initlist") {
      if (node.items.length !== 1) throw compileError(line, `${what}에는 값 하나를 넣어요`);
      node = node.items[0];
    }
    const V = this.conv(this.value(this.expr(node), line), of, line, what);
    const ev = V.ev;
    return unit === 1 ? (f) => [ev(f)] : (f) => ev(f).slice();
  }

  /** string/vector의 처음 값: = 값, (괄호 값들), {목록} */
  objectValue(type, init, line, name) {
    const what = `'${name}'의 처음 값`;
    if (!init) return () => null;
    const rt = this.rt;
    if (type.k === "string") {
      let args = null;
      if (init.k === "ctor") args = init.args;
      else if (init.k === "initlist") args = init.items;
      if (!args) return this.conv(this.value(this.expr(init), line), type, line, what).ev;
      if (args.length === 0) return () => null;
      if (args.length === 1) return this.conv(this.value(this.expr(args[0]), line), type, line, what).ev;
      if (args.length === 2 && init.k === "ctor") {
        // string(3, 'x') → "xxx"
        const N = this.conv(this.value(this.expr(args[0]), line), T.long, line, what);
        const C = this.conv(this.value(this.expr(args[1]), line), T.char, line, what);
        return (f) => {
          const n = Number(N.ev(f));
          if (n < 0 || n > 10_000_000) throw runtimeError(line, `string(${n}, …)은 만들 수 없어요`);
          return newString(new Array(n).fill(C.ev(f) & 255));
        };
      }
      throw compileError(line, `${what}의 모양이 맞지 않아요`, "예: string s = \"안녕\"; string s(3, 'x');");
    }
    // vector
    const of = type.of;
    const unit = cells(of);
    const fromList = (items) => {
      const evs = items.map((x, i) => this.elemValue(of, x, line, `${name}[${i}]`));
      return (f) => { const out = []; for (const ev of evs) out.push(...ev(f)); return newVector(of, out); };
    };
    if (init.k === "initlist") return fromList(init.items);
    if (init.k !== "ctor") return this.conv(this.value(this.expr(init), line), type, line, what).ev;
    const args = init.args;
    if (args.length === 0) return () => null;
    if (args.length === 1 && args[0].k === "initlist") return fromList(args[0].items);
    const first = args.length <= 2 ? this.value(this.expr(args[0]), line) : null;
    if (args.length === 1 && first.t.k === "vector") return this.conv(first, type, line, what).ev;
    if (first && isInt(first.t)) {
      // vector<int> v(5); vector<int> v(5, 1);
      const N = this.conv(first, T.long, line, what);
      const zeros = zerosOf(of);
      const item = args[1] ? this.elemValue(of, args[1], line, `${name}의 원소`) : null;
      return (f) => {
        const n = Number(N.ev(f));
        if (n < 0 || n * unit > 10_000_000) throw runtimeError(line, `vector를 ${n}칸으로 만들 수 없어요`, "개수가 음수이거나 너무 커요.");
        const out = new Array(n * unit);
        if (item) {
          const v = item(f);
          for (let i = 0; i < n; i++) {
            const copy = cloneCells(arr(of, 1), v);
            for (let k = 0; k < unit; k++) out[i * unit + k] = copy[k];
          }
        } else for (let i = 0; i < n * unit; i++) out[i] = zeros[i % unit];
        return newVector(of, out);
      };
    }
    void rt;
    throw compileError(line, `${what}의 모양이 맞지 않아요`, "예: vector<int> v(5); vector<int> v(5, 0); vector<int> v = {1, 2, 3};");
  }

  /** s[i], v[i]: 범위를 벗어나면 친절하게 알려 줘요 */
  objIndex(B, iNode, line, checked) {
    const rt = this.rt;
    const I = this.value(this.expr(iNode), line);
    if (!isInt(I.t)) throw compileError(line, "[ ] 안의 번호는 정수여야 해요");
    const S = this.objRef(B, line);
    const isStr = B.t.k === "string";
    const elem = isStr ? T.char : B.t.of;
    const unit = cells(elem);
    const who = B.varName || (isStr ? "string" : "vector");
    const iev = I.ev;
    const lv = (f) => {
      const st = S(f);
      const i = Number(iev(f));
      const n = isStr ? strLen(st) : vecLen(st);
      if (!(i >= 0 && i < n)) {
        throw runtimeError(line, `${who}${checked ? ".at" : ""}[${i}]: ${isStr ? "글자" : "원소"}가 ${n}개라서 [0]~[${n - 1}]만 쓸 수 있어요`,
          n === 0 ? `${who}가 비어 있어요. ${isStr ? "글자를 먼저 넣어 주세요." : "push_back으로 먼저 원소를 넣어 주세요."}` : "번호가 0부터 (크기 - 1)까지인지 확인해 보세요.");
      }
      return new Ptr(st, i * unit);
    };
    return this.withLoad({ t: elem, lv, isConst: Boolean(B.isConst), varName: `${who}[…]` }, line);
  }

  /** s.size(), v.push_back(x) 같은 함수 */
  objMethod(B, name, node) {
    const { line } = node;
    const rt = this.rt;
    const type = B.t;
    const isStr = type.k === "string";
    const who = B.varName || (isStr ? "string" : "vector");
    const S = this.objRef(B, line);
    const args = node.args;
    const want = (min, max = min) => {
      if (args.length < min || args.length > max) {
        throw compileError(line, `${who}.${name}()에는 값 ${min === max ? min : `${min}~${max}`}개를 넣어요 (${args.length}개를 넣었어요)`);
      }
    };
    const mutating = () => {
      if (B.isConst) throw compileError(line, `const인 ${who}는 ${name}()으로 바꿀 수 없어요`);
    };
    const num = (i) => this.conv(this.value(this.expr(args[i]), line), T.long, line, `${name}의 ${i + 1}번째 값`).ev;
    const len = (st) => (isStr ? strLen(st) : vecLen(st));
    const empty = (st, what) => {
      if (len(st) === 0) throw runtimeError(line, `비어 있는 ${who}에서 ${what}()을 불렀어요`, `${what}() 전에 ${isStr ? "글자가" : "원소가"} 있는지 empty()로 확인해 보세요.`);
    };
    const elem = isStr ? T.char : type.of;
    const unit = cells(elem);
    const ptrTo = (st, i) => new Ptr(st, i * unit);
    const elemLv = (lv) => this.withLoad({ t: elem, lv, isConst: Boolean(B.isConst) }, line);
    switch (name) {
      case "size": case "length":
        if (name === "length" && !isStr) break;
        want(0);
        return { t: T.ulong, ev: (f) => BigInt(len(S(f))) };
      case "empty": want(0); return { t: T.bool, ev: (f) => (len(S(f)) === 0 ? 1 : 0) };
      case "clear":
        want(0); mutating();
        return { t: T.void, ev: (f) => { const st = S(f); if (isStr) setStr(st, []); else { st.cells.length = 0; vecResized(st); } } };
      case "begin": want(0); return { t: ptr(elem), ev: (f) => ptrTo(S(f), 0) };
      case "end": want(0); return { t: ptr(elem), ev: (f) => { const st = S(f); return ptrTo(st, len(st)); } };
      case "front": want(0); return elemLv((f) => { const st = S(f); empty(st, "front"); return ptrTo(st, 0); });
      case "back": want(0); return elemLv((f) => { const st = S(f); empty(st, "back"); return ptrTo(st, len(st) - 1); });
      case "at": want(1); return this.objIndex(B, args[0], line, true);
      case "pop_back":
        want(0); mutating();
        return { t: T.void, ev: (f) => { const st = S(f); empty(st, "pop_back"); if (isStr) setStr(st, strBytes(st).slice(0, -1)); else { st.cells.length -= unit; vecResized(st); } } };
      case "data": case "c_str":
        if (name === "c_str" && !isStr) break;
        want(0);
        return { t: isStr ? Object.assign(ptr(T.char), { toConst: true }) : ptr(elem), ev: (f) => new Ptr(S(f), 0) };
      case "push_back": case "emplace_back": {
        want(1); mutating();
        if (isStr) {
          const C = this.conv(this.value(this.expr(args[0]), line), T.char, line, "push_back의 값");
          return { t: T.void, ev: (f) => { const st = S(f); const c = C.ev(f); st.cells.splice(st.cells.length - 1, 0, c); st.type = arr(T.char, st.cells.length); } };
        }
        const item = this.elemValue(elem, args[0], line, `${who}.push_back의 값`);
        return {
          t: T.void,
          ev: (f) => {
            const v = item(f);
            const st = S(f);
            if (st.cells.length + v.length > 10_000_000) throw runtimeError(line, `${who}가 너무 커졌어요`, "끝없이 push_back 하고 있지 않은지 확인해 보세요.");
            for (const x of v) st.cells.push(x);
            vecResized(st);
          },
        };
      }
      case "resize": {
        want(1, 2); mutating();
        const N = num(0);
        if (isStr) {
          const C = args[1] ? this.conv(this.value(this.expr(args[1]), line), T.char, line, "resize의 값").ev : () => 0;
          return { t: T.void, ev: (f) => { const st = S(f); const n = Number(N(f)); const b = strBytes(st); while (b.length < n) b.push(C(f) & 255); setStr(st, b.slice(0, n)); } };
        }
        const item = args[1] ? this.elemValue(elem, args[1], line, "resize의 값") : null;
        const zeros = zerosOf(elem);
        return {
          t: T.void,
          ev: (f) => {
            const st = S(f);
            const n = Number(N(f));
            if (n < 0 || n * unit > 10_000_000) throw runtimeError(line, `vector를 ${n}칸으로 바꿀 수 없어요`);
            const v = item ? item(f) : zeros;
            while (st.cells.length < n * unit) for (const x of cloneCells(arr(elem, 1), v)) st.cells.push(x);
            st.cells.length = n * unit;
            vecResized(st);
          },
        };
      }
      default: break;
    }
    if (isStr) return this.strMethod(B, name, node, S, want, mutating);
    return this.vecMethod(B, name, node, S, want, mutating);
  }

  strMethod(B, name, node, S, want, mutating) {
    const { line } = node;
    const args = node.args;
    const who = B.varName || "string";
    const num = (i, dflt) => (args[i] ? this.conv(this.value(this.expr(args[i]), line), T.ulong, line, `${name}의 ${i + 1}번째 값`).ev : () => dflt);
    const text = (i) => this.bytesOf(this.value(this.expr(args[i]), line), line, "쓸");
    const pos = (st, p, what) => {
      const n = strLen(st);
      const i = p >= NPOS ? Infinity : Number(p);
      if (i > n) throw runtimeError(line, `${who}.${what}(): 위치 ${i}는 문자열 길이(${n})보다 커요`, "진짜 C++에서는 out_of_range 예외가 나요.");
      return i;
    };
    const count = (p) => (p >= NPOS ? Infinity : Number(p));
    const find = (hay, needle, from, back) => {
      const n = hay.length;
      const m = needle.length;
      if (back) {
        for (let i = Math.min(from, n - m); i >= 0; i--) if (needle.every((b, k) => hay[i + k] === b)) return i;
        return -1;
      }
      for (let i = from; i + m <= n; i++) if (needle.every((b, k) => hay[i + k] === b)) return i;
      return -1;
    };
    switch (name) {
      case "substr": {
        want(0, 2);
        const P = num(0, 0n);
        const N = num(1, NPOS);
        return { t: STRING_T, ev: (f) => { const st = S(f); const i = pos(st, P(f), "substr"); return newString(strBytes(st).slice(i, i + count(N(f)))); } };
      }
      case "find": case "rfind": {
        want(1, 2);
        const X = text(0);
        const back = name === "rfind";
        const P = num(1, back ? NPOS : 0n);
        return {
          t: T.ulong,
          ev: (f) => {
            const hay = strBytes(S(f));
            const from = count(P(f));
            const i = find(hay, X(f), back ? Math.min(from, hay.length) : from, back);
            return i < 0 ? NPOS : BigInt(i);
          },
        };
      }
      case "append": {
        want(1); mutating();
        const X = text(0);
        return { t: T.void, ev: (f) => { const st = S(f); setStr(st, strBytes(st).concat(X(f))); } };
      }
      case "insert": {
        want(2); mutating();
        const P = num(0, 0n);
        const X = text(1);
        return { t: T.void, ev: (f) => { const st = S(f); const i = pos(st, P(f), "insert"); const b = strBytes(st); b.splice(i, 0, ...X(f)); setStr(st, b); } };
      }
      case "erase": {
        want(0, 2); mutating();
        const P = num(0, 0n);
        const N = num(1, NPOS);
        return { t: T.void, ev: (f) => { const st = S(f); const i = pos(st, P(f), "erase"); const b = strBytes(st); b.splice(i, Math.min(count(N(f)), b.length - i)); setStr(st, b); } };
      }
      case "replace": {
        want(3); mutating();
        const P = num(0, 0n);
        const N = num(1, NPOS);
        const X = text(2);
        return { t: T.void, ev: (f) => { const st = S(f); const i = pos(st, P(f), "replace"); const b = strBytes(st); b.splice(i, Math.min(count(N(f)), b.length - i), ...X(f)); setStr(st, b); } };
      }
      case "compare": {
        want(1);
        const X = text(0);
        return { t: T.int, ev: (f) => { const c = strCompare(S(f), newString(X(f))); return c < 0 ? -1 : c > 0 ? 1 : 0; } };
      }
      default:
        throw compileError(line, `string에는 ${name}() 함수가 없어요`,
          "쓸 수 있는 것: size, length, empty, push_back, pop_back, append, substr, find, rfind, insert, erase, replace, compare, c_str, at, front, back, clear, resize, begin, end");
    }
  }

  vecMethod(B, name, node, S, want, mutating) {
    const { line } = node;
    const rt = this.rt;
    const args = node.args;
    const elem = B.t.of;
    const unit = cells(elem);
    const who = B.varName || "vector";
    const iter = (i) => {
      const P = this.value(this.expr(args[i]), line);
      if (!isPtr(P.t)) throw compileError(line, `${name}의 ${i + 1}번째 값은 위치(반복자)예요`, `예: ${who}.${name}(${who}.begin() + 2, …)`);
      return P.ev;
    };
    const indexOf = (st, p, allowEnd) => {
      if (p === null || p.store !== st) throw runtimeError(line, `${who}.${name}()에 다른 곳의 위치를 넣었어요`, `${who}.begin() + 번호 처럼 같은 vector의 위치를 넣어요.`);
      const i = p.off / unit;
      const n = vecLen(st);
      if (i < 0 || i > n || (!allowEnd && i === n)) throw runtimeError(line, `${who}.${name}(): 위치가 범위를 벗어났어요`);
      return i;
    };
    switch (name) {
      case "insert": {
        want(2); mutating();
        const It = iter(0);
        const item = this.elemValue(elem, args[1], line, `${who}.insert의 값`);
        return { t: ptr(elem), ev: (f) => { const st = S(f); const i = indexOf(st, It(f), true); const v = item(f); st.cells.splice(i * unit, 0, ...v); vecResized(st); return new Ptr(st, i * unit); } };
      }
      case "erase": {
        want(1, 2); mutating();
        const A = iter(0);
        const Z = args[1] ? iter(1) : null;
        return {
          t: ptr(elem),
          ev: (f) => {
            const st = S(f);
            const i = indexOf(st, A(f), false);
            const j = Z ? indexOf(st, Z(f), true) : i + 1;
            if (j < i) throw runtimeError(line, `${who}.erase(처음, 끝)의 순서가 바뀌었어요`);
            st.cells.splice(i * unit, (j - i) * unit);
            vecResized(st);
            return new Ptr(st, i * unit);
          },
        };
      }
      default:
        void rt;
        throw compileError(line, `vector에는 ${name}() 함수가 없어요`,
          "쓸 수 있는 것: size, empty, push_back, pop_back, front, back, at, clear, resize, insert, erase, begin, end, data");
    }
  }

  /** string + string, s == "abc", v1 == v2 */
  objBinary(op, L, R, line) {
    const boolT = T.bool;
    if (L.t.k === "string" || R.t.k === "string") {
      const A = this.bytesOf(L, line, null);
      const B = this.bytesOf(R, line, null);
      if (op === "+") {
        if (!A || !B || (L.t.k !== "string" && R.t.k !== "string")) {
          const other = A ? R : L;
          throw compileError(line, `string에 ${friendlyType(other.t)}를 + 할 수 없어요`, isArith(other.t) ? "숫자를 붙이려면 to_string(x)를 써요." : "string, \"문자열\", 'c' 글자만 붙일 수 있어요.");
        }
        return { t: STRING_T, ev: (f) => newString(A(f).concat(B(f))) };
      }
      if (op in COMPARE) {
        const isText = (V) => V.t.k === "string" || (isPtr(V.t) && isCharLike(V.t.to));
        if (!isText(L) || !isText(R)) throw compileError(line, `string과 ${friendlyType(L.t.k === "string" ? R.t : L.t)}는 ${op}로 비교할 수 없어요`);
        const cmp = COMPARE[op];
        return { t: boolT, ev: (f) => { const x = A(f); const y = B(f); const n = Math.min(x.length, y.length); let c = 0; for (let i = 0; i < n && c === 0; i++) c = x[i] - y[i]; if (c === 0) c = x.length - y.length; return cmp(c, 0); } };
      }
      throw compileError(line, `string에는 '${op}' 계산을 쓸 수 없어요`);
    }
    if (L.t.k === "vector" && R.t.k === "vector" && (op === "==" || op === "!=") && sameType(L.t, R.t) && isScalar(L.t.of)) {
      const eq = (a, b) => vecLen(a) === vecLen(b) && (a ? a.cells : []).every((x, i) => x === b.cells[i]);
      return { t: boolT, ev: (f) => ((eq(L.ev(f), R.ev(f)) ? 1 : 0) ^ (op === "!=" ? 1 : 0)) };
    }
    throw compileError(line, `${friendlyType(L.t)}와 ${friendlyType(R.t)}로는 '${op}' 계산을 할 수 없어요`);
  }

  /** getline(cin, s), to_string(x), stoi(s) … */
  stdStrFunc(name, node) {
    const { line } = node;
    const rt = this.rt;
    const args = node.args;
    if (name === "getline") {
      if (args.length < 2 || args.length > 3) throw compileError(line, "getline에는 (cin, 문자열변수) 를 넣어요", "예: getline(cin, line);");
      const In = this.value(this.expr(args[0]), line);
      if (In.t.k !== "stream" || In.t.dir !== "in") throw compileError(line, "getline의 첫 번째 값은 cin이에요", "예: getline(cin, line);");
      const Sx = this.expr(args[1]);
      if (Sx.t.k !== "string" || !Sx.lv) throw compileError(line, "getline의 두 번째 값은 string 변수예요", "char 배열이라면 cin.getline 대신 string을 써 보세요.");
      if (Sx.isConst) throw compileError(line, "const string에는 getline으로 읽을 수 없어요");
      const D = args[2] ? this.conv(this.value(this.expr(args[2]), line), T.char, line, "getline의 끝 글자").ev : () => 10;
      const S = this.objRef(Sx, line);
      return {
        t: In.t,
        ev: (f) => {
          const s = In.ev(f);
          const bytes = streamGetLine(rt, D(f) & 255, line);
          if (bytes) setStr(S(f), bytes);
          return s;
        },
      };
    }
    if (args.length !== 1) throw compileError(line, `${name}에는 값 하나를 넣어요`);
    const V = this.value(this.expr(args[0]), line);
    if (name === "to_string") {
      if (!isArith(V.t)) throw compileError(line, `to_string에는 숫자를 넣어요 (${friendlyType(V.t)}를 넣었어요)`);
      const t = V.t;
      return { t: STRING_T, ev: (f) => newString(toStringBytes(t, V.ev(f))) };
    }
    const B = this.bytesOf(V, line, null);
    if (!B || V.t.bits === 8) throw compileError(line, `${name}에는 string을 넣어요`, `예: ${name}("42")`);
    const kind = name === "stod" || name === "stof" ? "float" : "int";
    const ret = { stoi: T.int, stol: T.long, stoll: T.llong, stod: T.double, stof: T.float }[name];
    return {
      t: ret,
      ev: (f) => {
        const v = parseNumber(B(f), kind, name, line);
        if (kind === "float") return ret.bits === 32 ? Math.fround(v) : v;
        if (ret === T.int && (v > 2147483647n || v < -2147483648n)) throw runtimeError(line, `${name}: 숫자가 int에 담기에는 너무 커요`, "진짜 C++에서는 out_of_range 예외가 나요. stoll을 써 보세요.");
        return convert(v, T.llong, ret);
      },
    };
  }

  /** cout << 값 / cin >> 변수 */
  streamOp(node, L) {
    const { op, line } = node;
    const rt = this.rt;
    const name = L.varName || (L.t.dir === "out" ? "cout" : "cin");
    if (L.t.dir === "out") {
      if (op !== "<<") throw compileError(line, `${name}에는 << 를 써요`, `예: ${name} << x;  (읽을 때는 cin >> x;)`);
      const R = this.value(this.expr(node.r), line);
      const t = R.t;
      if (isStruct(t)) {
        throw compileError(line, `구조체(${typeName(t)})는 cout으로 바로 출력할 수 없어요`, "멤버를 하나씩 출력해 주세요. 예: cout << p.x << \" \" << p.y;  (operator<<는 C++ 4단계)");
      }
      if (t.k === "stream") throw compileError(line, `${name} << 뒤에 스트림이 또 왔어요`, "예: cout << a << b;");
      if (t.k === "vector") throw compileError(line, "vector는 cout으로 한 번에 출력할 수 없어요", "for (int x : v) cout << x << ' '; 처럼 하나씩 출력해요.");
      if (!isArith(t) && !isPtr(t) && t.k !== "manip" && t.k !== "string") throw compileError(line, `${friendlyType(t)}는 cout으로 출력할 수 없어요`);
      const lev = L.ev;
      const rev = R.ev;
      return { t: L.t, varName: name, ev: (f) => { const s = lev(f); streamPut(rt, s, t, rev(f), line); return s; } };
    }
    if (op !== ">>") throw compileError(line, `${name}에는 >> 를 써요`, `예: ${name} >> x;  (출력할 때는 cout << x;)`);
    const R = this.expr(node.r);
    const t = R.t;
    const what = node.r.k === "id" ? `'${node.r.name}'` : "이 값";
    if (!R.lv) throw compileError(line, `cin >> 뒤에는 값을 넣을 변수가 와야 해요`, `${what}에는 값을 넣을 수 없어요.`);
    if (R.isConst) throw compileError(line, `const로 정한 ${what}에는 cin으로 값을 넣을 수 없어요`);
    if (R.bitfield) throw compileError(line, "비트 필드에는 cin으로 바로 읽을 수 없어요", "일반 변수에 읽은 뒤 옮겨 담아 주세요.");
    if (isArr(t) && !isCharLike(t.of)) throw compileError(line, "배열 전체는 cin으로 한 번에 읽을 수 없어요", "for 문으로 cin >> a[i]; 처럼 한 칸씩 읽어요.");
    if (isPtr(t)) throw compileError(line, "char * 에는 cin으로 글자를 읽을 수 없어요", "char 이름[크기]; 배열을 만들어서 cin >> 이름; 처럼 읽어요.");
    if (isStruct(t)) throw compileError(line, `구조체(${typeName(t)})는 cin으로 바로 읽을 수 없어요`, "멤버를 하나씩 읽어 주세요. 예: cin >> p.x >> p.y;");
    if (t.k === "vector") throw compileError(line, "vector 전체는 cin으로 한 번에 읽을 수 없어요", "for 문으로 cin >> v[i]; 처럼 한 칸씩 읽거나, 읽은 값을 push_back 해요.");
    if (t.k === "string") {
      const lev0 = L.ev;
      const target0 = R.lv;
      return { t: L.t, varName: name, ev: (f) => { const s = lev0(f); const w = streamGetWord(rt, line); if (w) rt.storeAt(target0(f), newString(w), line); return s; } };
    }
    if (!isArith(t) && !isArr(t)) throw compileError(line, `${friendlyType(t)}에는 cin으로 읽을 수 없어요`);
    const lev = L.ev;
    const target = R.lv;
    return { t: L.t, varName: name, ev: (f) => { const s = lev(f); streamGet(rt, target(f), t, line); return s; } };
  }

  /** cin.get(), cin.fail(), cout.flush() 같은 스트림 함수 */
  streamMethod(B, name, node) {
    const { line } = node;
    const rt = this.rt;
    const S = B.ev;
    const who = B.varName || "스트림";
    const args = node.args.map((a) => this.value(this.expr(a), line));
    const intArg = (i, dflt) => (args[i] ? this.conv(args[i], T.int, line).ev : () => dflt);
    const st = (f) => rt.streamState(S(f));
    const want = (n) => {
      if (args.length > n) throw compileError(line, `${who}.${name}()에 값을 너무 많이 넣었어요`);
    };
    if (B.t.dir === "in") {
      switch (name) {
        case "get": want(0); return { t: T.int, ev: () => streamGetChar(rt, line) };
        case "peek": want(0); return { t: T.int, ev: (f) => { const s = st(f); if (s.fail) return -1; const b = rt.reader(STDIN, line).peek(); if (b < 0) s.eof = true; return b; } };
        case "eof": want(0); return { t: T.bool, ev: (f) => (st(f).eof ? 1 : 0) };
        case "fail": want(0); return { t: T.bool, ev: (f) => (st(f).fail ? 1 : 0) };
        case "good": want(0); return { t: T.bool, ev: (f) => (st(f).fail || st(f).eof ? 0 : 1) };
        case "bad": want(0); return { t: T.bool, ev: () => 0 };
        case "clear": want(0); return { t: T.void, ev: (f) => { const s = st(f); s.fail = false; s.eof = false; } };
        case "ignore": {
          want(2);
          const n = intArg(0, 1);
          const d = intArg(1, -1);
          return { t: T.void, ev: (f) => streamIgnore(rt, Number(n(f)), Number(d(f)), line) };
        }
        default: break;
      }
    } else {
      switch (name) {
        case "flush": want(0); return { t: B.t, ev: S };
        case "put": {
          want(1);
          const c = intArg(0, 0);
          return { t: B.t, ev: (f) => { const s = S(f); rt.writeTo(s, [Number(c(f)) & 255], line); return s; } };
        }
        case "precision": {
          want(1);
          const n = args[0] ? intArg(0, 6) : null;
          return { t: T.long, ev: (f) => { const s = st(f); const old = s.precision; if (n) s.precision = Number(n(f)); return BigInt(old); } };
        }
        case "width": {
          want(1);
          const n = args[0] ? intArg(0, 0) : null;
          return { t: T.long, ev: (f) => { const s = st(f); const old = s.width; if (n) s.width = Number(n(f)); return BigInt(old); } };
        }
        default: break;
      }
    }
    throw compileError(line, `${who}.${name}()는 아직 없어요`,
      B.t.dir === "in" ? "쓸 수 있는 것: get, peek, ignore, eof, fail, good, clear" : "쓸 수 있는 것: flush, put, precision, width");
  }

  /** std::min, std::max: 두 값의 타입이 같아야 해요 (진짜 C++처럼) */
  stdMinMax(name, node) {
    const { line } = node;
    if (node.args.length !== 2) throw compileError(line, `${name}에는 값 두 개를 넣어요`, `예: ${name}(a, b)`);
    const A = this.value(this.expr(node.args[0]), line);
    const B = this.value(this.expr(node.args[1]), line);
    if (!isArith(A.t) || !isArith(B.t)) throw compileError(line, `${name}에는 숫자만 넣을 수 있어요`);
    if (!sameType(A.t, B.t)) {
      throw compileError(line, `${name}의 두 값은 타입이 같아야 해요 (${typeName(A.t)}와 ${typeName(B.t)})`,
        "C++의 std::min/max는 같은 타입끼리만 비교해요. (double)x 처럼 한쪽을 바꿔 주세요.");
    }
    const a = A.ev;
    const b = B.ev;
    return name === "max"
      ? { t: A.t, ev: (f) => { const x = a(f); const y = b(f); return x < y ? y : x; } }
      : { t: A.t, ev: (f) => { const x = a(f); const y = b(f); return y < x ? y : x; } };
  }

  // ---------- 타입 ----------
  resolveType(t, opts = {}) {
    if (t.k === "array" && "lenExpr" in t) {
      const of = this.resolveType(t.of, { param: opts.param, allowVla: opts.allowVla, inner: true, line: opts.line });
      if (isVoid(of)) throw compileError(t.line, "void 배열은 만들 수 없어요");
      let len;
      if (t.lenExpr === null) {
        if (opts.initLen == null) {
          if (opts.param) return arr(of, null);
          throw compileError(t.line, "배열 크기가 필요해요", "예: int a[10]; 또는 int a[] = {1, 2, 3};");
        }
        len = opts.initLen;
      } else {
        let E = null;
        try {
          E = this.value(this.expr(t.lenExpr));
        } catch (e) {
          // 함수 선언의 int a[n][m] 처럼 앞 매개변수를 쓰는 크기는 함수를 만들 때 다시 봐요
          if (!(opts.param && e instanceof CError)) throw e;
        }
        if (E && !isInt(E.t)) throw compileError(t.line, "배열 크기는 정수여야 해요");
        if (!E || E.cv === undefined) {
          if (opts.param && !opts.inner) return arr(of, null); // 매개변수의 맨 바깥 크기는 어차피 포인터가 돼요
          if (E && opts.allowVla && this.fn) {
            return { k: "array", of, len: null, vla: { slot: this.fn.slotCount++, ev: E.ev, line: t.line }, size: 0 };
          }
          if (opts.param) return { k: "array", of, len: null, anyLen: true, size: 0 };
          throw compileError(t.line, "배열 크기는 상수여야 해요", "이 자리에서는 숫자나 #define 상수만 쓸 수 있어요.");
        }
        len = Number(E.cv);
        if (len <= 0) throw compileError(t.line, "배열 크기는 1 이상이어야 해요");
        if (len > 10_000_000) throw compileError(t.line, "배열이 너무 커요", "1000만 칸 이하로 만들어 주세요.");
      }
      return arr(of, len);
    }
    if (t.k === "ref") {
      const to = this.resolveType(t.to, { line: opts.line });
      if (to.k === "ref") throw compileError(t.line ?? opts.line, "참조의 참조는 만들 수 없어요");
      return { k: "ref", to, size: 8, toConst: Boolean(t.toConst) };
    }
    if (t.k === "string") {
      if (!this.hasHeader("string") && !this.hasHeader("iostream")) this.needHeader("string", "string", t.line ?? opts.line);
      return STRING_T;
    }
    if (t.k === "vector") {
      this.needHeader("vector", "vector", t.line ?? opts.line);
      const of = this.need(this.resolveType(t.of, { line: t.line ?? opts.line }), t.line ?? opts.line);
      if (of.k === "ref" || isVoid(of) || isFunc(of) || isArr(of)) throw compileError(t.line ?? opts.line, `vector<${typeName(of)}>는 만들 수 없어요`);
      return vectorOf(of);
    }
    if (t.k === "auto") {
      throw compileError(opts.line ?? t.line, "auto는 처음 값이 있는 변수에만 쓸 수 있어요", "예: auto x = 3.5;");
    }
    if (t.k === "ptr") {
      const out = isStruct(t.to) ? ptr(t.to) : ptr(this.resolveType(t.to, { param: opts.param, allowVla: opts.allowVla, inner: true, line: opts.line }));
      if (t.toConst) out.toConst = true;
      return out;
    }
    if (t.k === "struct") return this.layout(t, opts.line ?? t.line);
    if (t.k === "func") {
      const ret = this.resolveType(t.ret);
      if (isArr(ret)) throw compileError(t.line, "함수는 배열을 돌려줄 수 없어요", "배열 대신 포인터나 구조체를 돌려줘 보세요.");
      if (ret.k === "ref" && isVoid(ret.to)) throw compileError(t.line, "void의 참조는 돌려줄 수 없어요");
      return {
        ...t,
        noProto: this.cpp ? false : t.noProto, // C++의 f()는 f(void)와 같아요
        ret,
        params: t.params.map((p) => {
          const pt = this.resolveType(p.type, { param: true });
          return { ...p, type: isArr(pt) ? ptr(pt.of) : isFunc(pt) ? ptr(pt) : pt };
        }),
      };
    }
    return t;
  }

  /** 구조체(공용체)의 멤버 위치(칸 번호)와 크기를 정해요. */
  layout(t, line) {
    if (t.cellCount !== undefined || t.laying) return t;
    const what = t.isUnion ? "공용체" : "구조체";
    if (!t.complete) {
      throw compileError(line, `${typeName(t)}의 내용이 아직 정의되지 않았어요`, `${typeName(t)} { ... }; 로 멤버를 먼저 정해 주세요.`);
    }
    t.laying = true;
    let off = 0;
    let bytes = 0;
    let align = 1;
    let maxCells = 0;
    let maxBytes = 0;
    let unit = null; // 비트 필드를 채우는 중인 저장 단위 { size, used }
    for (const f of t.fields) {
      let ft = this.resolveType(f.type, { line: f.line });
      if (isVoid(ft) || isFunc(ft)) throw compileError(f.line, `${what} 멤버 '${f.name}'의 타입이 올바르지 않아요`);
      if (ft === t || (isArr(ft) && baseOf(ft) === t)) {
        throw compileError(f.line, `${what}가 자기 자신을 멤버로 가질 수 없어요`, `포인터로 써 주세요. 예: ${typeName(t)} *${f.name};`);
      }
      if (f.bits !== undefined) {
        // 비트 필드: int a : 3;
        if (!isInt(ft)) throw compileError(f.line, "비트 필드는 정수 타입에만 쓸 수 있어요");
        const W = this.value(this.expr(f.bits), f.line);
        if (W.cv === undefined || !isInt(W.t)) throw compileError(f.line, "비트 필드의 크기는 정수 상수여야 해요");
        const width = Number(W.cv);
        if (width < 0 || width > ft.bits) throw compileError(f.line, `비트 필드 '${f.name ?? ""}'의 크기는 0부터 ${ft.bits}까지예요`);
        if (width === 0 || f.name === null) {
          unit = width === 0 ? null : unit;
          if (f.name === null && width > 0) {
            if (!unit || unit.size !== ft.size || unit.used + width > ft.size * 8) {
              bytes = Math.ceil(bytes / ft.size) * ft.size;
              unit = { size: ft.size, used: 0 };
              bytes += ft.size;
            }
            unit.used += width;
          }
          f.skip = true;
          continue;
        }
        if (!t.isUnion && (!unit || unit.size !== ft.size || unit.used + width > ft.size * 8)) {
          bytes = Math.ceil(bytes / ft.size) * ft.size;
          f.byteOff = bytes;
          unit = { size: ft.size, used: 0 };
          bytes += ft.size;
        } else if (t.isUnion) f.byteOff = 0;
        if (unit) unit.used += width;
        ft = { ...ft, bits: width, bitfield: true, rank: width < 32 ? 2 : ft.rank, name: ft.name };
        f.type = ft;
        f.off = t.isUnion ? 0 : off;
        off += 1;
        align = Math.max(align, alignOf(ft));
        maxCells = Math.max(maxCells, 1);
        maxBytes = Math.max(maxBytes, ft.size);
        continue;
      }
      unit = null;
      const a = alignOf(ft);
      f.type = ft;
      if (t.isUnion) {
        f.off = 0;
        f.byteOff = 0;
        maxCells = Math.max(maxCells, cells(ft));
        maxBytes = Math.max(maxBytes, ft.size);
      } else {
        bytes = Math.ceil(bytes / a) * a;
        f.off = off;
        f.byteOff = bytes;
        bytes += ft.size;
        off += cells(ft);
      }
      align = Math.max(align, a);
    }
    t.fields = t.fields.filter((f) => !f.skip);
    if (t.isUnion) {
      off = maxCells;
      bytes = maxBytes;
    }
    t.size = Math.ceil(bytes / align) * align;
    t.align = align;
    t.cellCount = off;
    t.laying = false;
    return t;
  }

  /** 구조체 포인터를 쓸 때 구조체 모양이 정해져 있는지 확인해요. */
  need(t, line) {
    if (isStruct(t)) this.layout(t, line);
    else if (isArr(t)) this.need(t.of, line);
    return t;
  }

  // ---------- 값 변환 ----------
  value(E, line) {
    if (E.builtinName) {
      throw compileError(line ?? E.line, `표준 함수 '${E.builtinName}'는 값으로 쓸 수 없어요`, `함수를 부르려면 ${E.builtinName}(...) 처럼 괄호를 붙여요.`);
    }
    if (isFunc(E.t)) return { t: ptr(E.t), ev: E.ev, fnName: E.fnName };
    if (isVoid(E.t)) throw compileError(line ?? E.line, "void 함수의 결과는 값으로 쓸 수 없어요", "돌려주는 값이 없는 함수예요.");
    return rv(E);
  }

  conv(E, to, line, what = "값") {
    const from = E.t;
    if (sameType(from, to)) return E;
    if (isObj(to) || isObj(from)) return this.convObj(E, to, line, what);
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
        if (isFunc(b) || isFunc(a)) {
          const okFn = isFunc(a) && isFunc(b) && (b.any ? isInt(a.ret) : sameType(a, b) || b.noProto || a.noProto);
          if (!okFn) {
            throw compileError(line, `${what}의 함수 모양이 맞지 않아요`,
              b.any ? "비교 함수는 int cmp(const void *a, const void *b) 모양이어야 해요." : `${typeName(to)}가 필요한데 ${typeName(from)}를 넣었어요.`);
          }
          return { t: to, ev: E.ev };
        }
        const ok = sameType(a, b) || isVoid(a) || isVoid(b) || (isCharLike(a) && isCharLike(b)) ||
          (isArr(a) && sameType(a.of, b)) || b.k === "file";
        if (!ok) {
          throw compileError(line, `${what}의 주소 타입이 맞지 않아요`, `${typeName(to)}가 필요한데 ${typeName(from)}를 넣었어요.`);
        }
        if (isVoid(a) && !isVoid(b)) {
          if (this.cpp) {
            throw compileError(line, `C++에서는 void*를 ${typeName(to)}에 그냥 넣을 수 없어요`,
              `(${typeName(to)})malloc(…) 처럼 타입을 밝혀 주세요. (C에서는 괜찮지만 C++에서는 오류예요)`);
          }
          const target = this.need(b, line);
          return { t: to, ev: (f) => retypeHeap(E.ev(f), target, line) };
        }
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
        let st = this.strings.get(node.key || node);
        if (!st) {
          const type = arr(T.char, node.bytes.length + 1);
          st = new Store(node.bytes.length + 1, "문자열 상수", type);
          node.bytes.forEach((b, i) => { st.cells[i] = convert(b, T.int, T.char); });
          st.cells[node.bytes.length] = 0;
          st.readonly = true;
          this.strings.set(node.key || node, st);
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
      case "member": return this.member(node);
      case "vaarg": return this.vaArg(node);
      case "new": return this.newExpr(node);
      case "construct": {
        const type = this.resolveType(node.type, { line });
        return { t: type, ev: this.objectValue(type, node.args ? { k: "ctor", args: node.args, line } : node.list, line, typeName(type)) };
      }
      case "delete": return this.deleteExpr(node);
      case "compound": return this.compound(node);
      case "cast": return this.cast(node);
      case "sizeof": {
        let t = node.type ? this.resolveType(node.type, { allowVla: Boolean(this.fn) }) : this.expr(node.e).t;
        if (t.k === "ref") t = t.to; // sizeof(int&) 는 sizeof(int)
        if (t.k === "func" || node.e && this.expr(node.e).fnName) throw compileError(line, "함수에는 sizeof를 쓸 수 없어요");
        if (isDyn(t)) {
          const dims = node.type ? vlaDims(t) : [];
          const size = sizeDyn(t);
          return { t: T.ulong, ev: (f) => { fillDims(dims, f, rt); return BigInt(size(f)); } };
        }
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
      case "alignof": {
        const t = this.need(this.resolveType(node.type, { line }), line);
        if (isFunc(t)) throw compileError(line, "함수에는 _Alignof를 쓸 수 없어요");
        const v = BigInt(isVoid(t) ? 1 : alignOf(t));
        return { t: T.ulong, ev: () => v, cv: v };
      }
      case "offsetof": {
        let t = this.resolveType(node.type, { line });
        let off = 0;
        for (const name of node.path) {
          if (!isStruct(t)) throw compileError(line, `offsetof: '${name}' 앞이 구조체가 아니에요`);
          this.layout(t, line);
          const field = t.fields.find((x) => x.name === name);
          if (!field) throw compileError(line, `${typeName(t)}에는 '${name}' 멤버가 없어요`);
          if (field.type.bitfield) throw compileError(line, "비트 필드에는 offsetof를 쓸 수 없어요");
          off += field.byteOff;
          t = field.type;
        }
        const v = BigInt(off);
        return { t: T.ulong, ev: () => v, cv: v };
      }
      case "generic": {
        // _Generic: 식의 타입에 맞는 값 하나만 골라서 써요 (나머지는 실행하지 않아요)
        const t = this.value(this.expr(node.e), line).t;
        let chosen = null;
        let fallback = null;
        for (const a of node.assoc) {
          if (a.type === null) {
            if (fallback) throw compileError(a.line, "_Generic에 default가 두 번 나왔어요");
            fallback = a;
            continue;
          }
          const at = this.resolveType(a.type, { line: a.line });
          if (sameType(at, t) && Boolean(at.isBool) === Boolean(t.isBool)) {
            if (chosen) throw compileError(a.line, `_Generic에 ${typeName(at)}가 두 번 나왔어요`);
            chosen = a;
          }
        }
        const pick = chosen || fallback;
        if (!pick) {
          throw compileError(line, `_Generic에 ${typeName(t)} 타입에 맞는 자리가 없어요`, "default: 값 을 넣어 두면 나머지 타입을 모두 받아요.");
        }
        return this.expr(pick.value);
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
    const { line } = node;
    const name = this.resolveName(node.name);
    const info = this.lookup(name);
    if (info) {
      if (info.enumConst !== undefined) {
        const v = info.enumConst;
        return { t: T.int, ev: () => v, cv: v };
      }
      return this.variable(info, line);
    }
    const fi = this.funcs.get(name);
    if (fi) return { t: fi.type, ev: () => fi.ref, fnName: name };
    if (this.cpp) {
      const E = this.stdIdentifier(name, line);
      if (E) return E;
      if (name.startsWith("std::")) return { t: T.void, builtinName: name.slice(5) };
    }
    if (BUILTINS[name]) return { t: T.void, builtinName: name };
    if (name === "true" || name === "false") {
      this.needHeader("stdbool.h", name, line);
      const v = name === "true" ? 1 : 0;
      return { t: T.int, ev: () => v, cv: v };
    }
    if (name === "nullptr" && this.cpp) return { t: ptr(T.void), ev: () => null, isNull: true, cv: null };
    if (name === "NULL") {
      if (!NULL_HEADERS.some((h) => this.hasHeader(h))) this.needHeader("stdio.h", "NULL", line);
      return { t: ptr(T.void), ev: () => null, isNull: true, cv: null };
    }
    if (name === "__func__" && this.fn) {
      // 지금 함수의 이름 (문자열)
      return this.exprInner({ k: "str", bytes: utf8(this.fn.name), line, key: `__func__:${this.fn.name}` });
    }
    if (name === "stdin" || name === "stdout" || name === "stderr") {
      this.needHeader("stdio.h", name, line);
      const stream = { stdin: STDIN, stdout: STDOUT, stderr: STDERR }[name];
      return { t: FILE_T, ev: () => stream };
    }
    if (name === "errno" && this.hasHeader("errno.h")) {
      if (!this.errnoInfo) {
        const st = new Store(1, "errno", T.int);
        st.cells[0] = 0;
        this.rt.errnoStore = st;
        this.errnoInfo = { name: "errno", type: T.int, store: st, line };
      }
      return this.variable(this.errnoInfo, line);
    }
    const names = [...this.visibleNames(), ...this.funcs.keys()];
    throw compileError(line, `'${name}'라는 변수를 찾을 수 없어요`,
      `쓰기 전에 int ${name}; 처럼 먼저 선언해야 해요. 이름의 대소문자와 오타도 확인해 보세요.${suggest(name, names)}`);
  }

  variable(info, line) {
    const rt = this.rt;
    const { type, name } = info;
    if (type.k === "ref") {
      // 참조: 칸에는 가리키는 곳의 주소가 들어 있어요
      const lv = info.store ? () => info.store.cells[0] : (f) => f[info.slot].cells[0];
      return this.withLoad({ t: type.to, lv, varName: name, isConst: Boolean(type.toConst) }, line);
    }
    if (info.constValue !== undefined) {
      // C++: const int N = 10; 의 N은 상수예요 (배열 크기, case에 쓸 수 있어요)
      const v = info.constValue;
      const E = this.variable({ ...info, constValue: undefined }, line);
      return { ...E, cv: v, ev: () => v };
    }
    const uninit = () => runtimeError(line, `값을 넣지 않은 변수 '${name}'를 사용했어요`,
      `C에서는 변수를 만들기만 하면 쓰레기 값이 들어 있어요. 먼저 값을 넣어 주세요. 예: ${typeName(type)} ${name} = 0;`);
    if (info.store) {
      const st = info.store;
      const p = new Ptr(st, 0);
      const E = { t: type, lv: () => p, varName: name, isConst: Boolean(info.isConst) };
      if (isScalar(type)) {
        E.ev = () => { const v = st.cells[0]; if (v === undefined) throw uninit(); return v; };
        E.set = (f, v) => { st.cells[0] = v; };
      }
      return this.withLoad(E, line);
    }
    const slot = info.slot;
    const E = { t: type, lv: (f) => new Ptr(f[slot], 0), varName: name, isConst: Boolean(info.isConst) };
    if (isScalar(type)) {
      E.ev = (f) => { const v = f[slot].cells[0]; if (v === undefined) throw uninit(); return v; };
      E.set = (f, v) => { f[slot].cells[0] = v; };
    }
    return this.withLoad(E, line);
  }

  /** 주소(lv)로 값을 읽는 방법을 붙여요. 구조체는 전체를 복사해서 읽어요. */
  withLoad(E, line) {
    if (E.ev || isArr(E.t) || isFunc(E.t)) return E;
    const rt = this.rt;
    const lv = E.lv;
    if (isStruct(E.t)) {
      const n = cells(this.layout(E.t, line));
      const t = E.t;
      E.ev = hasObj(t) ? (f) => cloneCells(t, rt.loadStruct(lv(f), n, line)) : (f) => rt.loadStruct(lv(f), n, line);
    } else if (isObj(E.t)) {
      // string, vector를 값으로 쓰면 복사본이 생겨요
      const t = E.t;
      E.ev = (f) => cloneValue(t, rt.load(lv(f), line));
    } else {
      E.ev = (f) => rt.load(lv(f), line);
    }
    return E;
  }

  member(node) {
    const { line } = node;
    const rt = this.rt;
    const base = this.expr(node.e);
    const where = node.e.k === "id" ? node.e.name : "이 값";
    let st;
    let lvBase;
    if (node.arrow) {
      const V = this.value(base, line);
      if (!isPtr(V.t) || !isStruct(V.t.to)) {
        if (isStruct(V.t)) throw compileError(line, "구조체 변수에는 -> 대신 . 을 써요", `예: ${where}.${node.name}`);
        throw compileError(line, "-> 는 구조체 포인터에만 쓸 수 있어요", `${where}는 ${friendlyType(V.t)}예요.`);
      }
      st = this.layout(V.t.to, line);
      lvBase = (f) => { const p = V.ev(f); if (p === null) rt.check(null, line, false); return p; };
    } else {
      if (isPtr(base.t) && isStruct(base.t.to)) {
        throw compileError(line, "구조체 포인터에는 . 대신 -> 를 써요", `예: ${where}->${node.name}  (또는 (*${where}).${node.name})`);
      }
      if (!isStruct(base.t)) throw compileError(line, `'.${node.name}'는 구조체에만 쓸 수 있어요`, `${where}는 ${friendlyType(base.t)}예요.`);
      st = this.layout(base.t, line);
      if (base.lv) lvBase = base.lv;
      else {
        // 함수가 돌려준 구조체처럼 이름 없는 값: 잠깐 쓸 칸을 만들어요
        const ev = base.ev;
        lvBase = (f) => {
          const tmp = new Store(cells(st), "임시 값", st);
          tmp.cells = ev(f).slice();
          return new Ptr(tmp, 0);
        };
      }
    }
    const field = st.fields.find((x) => x.name === node.name);
    if (!field) {
      const names = st.fields.map((x) => x.name);
      throw compileError(line, `${typeName(st)}에는 '${node.name}' 멤버가 없어요`,
        `있는 멤버: ${names.join(", ")}.${suggest(node.name, names)}`);
    }
    const off = field.off;
    const as = st.isUnion && isScalar(field.type) ? field.type : undefined;
    const E = {
      t: field.type,
      lv: as
        ? (f) => { const p = lvBase(f); return new Ptr(p.store, p.off + off, as); }
        : (f) => { const p = lvBase(f); return new Ptr(p.store, p.off + off); },
      varName: `${where}${node.arrow ? "->" : "."}${node.name}`,
      bitfield: Boolean(field.type.bitfield),
      isConst: node.arrow ? Boolean(this.value(base, line).t.toConst) : Boolean(base.isConst),
    };
    return this.withLoad(E, line);
  }

  ptrArith(P, I, sign, line) {
    const elem = this.need(P.t.to, line);
    if (isVoid(elem)) throw compileError(line, "void* 로는 주소 계산을 할 수 없어요", "먼저 (int *) 처럼 알맞은 타입으로 바꿔 주세요.");
    if (isFunc(elem)) throw compileError(line, "함수 포인터로는 주소 계산을 할 수 없어요");
    const stride = cellsDyn(elem);
    const rt = this.rt;
    if (typeof stride === "function") {
      return {
        t: P.t,
        ev: (f) => {
          const p = P.ev(f);
          if (p === null) rt.check(null, line, false);
          return new Ptr(p.store, p.off + sign * Number(I.ev(f)) * stride(f));
        },
      };
    }
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
        ? { t: this.boolT, ev: (f) => (truthy(L(f)) && truthy(R(f)) ? 1 : 0) }
        : { t: this.boolT, ev: (f) => (truthy(L(f)) || truthy(R(f)) ? 1 : 0) };
    }
    const L = this.value(this.expr(node.l), line);
    if (L.t.k === "stream") return this.streamOp(node, L);
    const R = this.value(this.expr(node.r), line);
    return this.binaryValues(op, L, R, line);
  }

  binaryValues(op, L, R, line) {
    if (isObj(L.t) || isObj(R.t)) return this.objBinary(op, L, R, line);
    if (op in COMPARE) {
      if (isArith(L.t) && isArith(R.t)) {
        const ct = common(L.t, R.t);
        const a = this.conv(L, ct, line);
        const b = this.conv(R, ct, line);
        const cmp = COMPARE[op];
        if (a.cv !== undefined && b.cv !== undefined) {
          const v = cmp(a.cv, b.cv);
          return { t: this.boolT, ev: () => v, cv: v };
        }
        return { t: this.boolT, ev: (f) => cmp(a.ev(f), b.ev(f)) };
      }
      if ((isPtr(L.t) || L.isNull) && (isPtr(R.t) || R.isNull)) {
        const strlit = (L.from && L.from.strlit) || (R.from && R.from.strlit);
        if (strlit) {
          throw compileError(line, `문자열은 ${op} 로 비교할 수 없어요`,
            "글자가 같은지 보려면 strcmp(a, b) == 0 을 써요. (#include <string.h> 필요)");
        }
        const cmp = ptrCompare(op, line);
        return { t: this.boolT, ev: (f) => cmp(L.ev(f), R.ev(f)) };
      }
      if (isStruct(L.t) || isStruct(R.t)) {
        throw compileError(line, `구조체는 ${op} 로 한 번에 비교할 수 없어요`, "멤버를 하나씩 비교해 주세요. 예: a.x == b.x && a.y == b.y");
      }
      throw compileError(line, `${friendlyType(L.t)}와 ${friendlyType(R.t)}는 비교할 수 없어요`);
    }
    if (op === "+" || op === "-") {
      if (isPtr(L.t) && isInt(R.t)) return this.ptrArith(L, R, op === "+" ? 1 : -1, line);
      if (op === "+" && isInt(L.t) && isPtr(R.t)) return this.ptrArith(R, L, 1, line);
      if (op === "-" && isPtr(L.t) && isPtr(R.t)) {
        const strideOf = cellsDyn(L.t.to);
        return {
          t: T.long,
          ev: (f) => {
            const a = L.ev(f); const b = R.ev(f);
            if (a === null || b === null || a.store !== b.store) throw runtimeError(line, "서로 다른 배열의 주소는 뺄 수 없어요");
            const stride = typeof strideOf === "function" ? strideOf(f) : strideOf;
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
    if (E.isConst) {
      throw compileError(node.line, `const로 정한 ${E.varName ? `'${E.varName}'는` : "값은"} 바꿀 수 없어요`,
        "const는 '이 값은 바꾸지 않아요'라는 약속이에요. 정말 바꿔야 한다면 선언에서 const를 지워요.");
    }
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
    if (isStruct(L.t)) {
      if (node.op !== "=") throw compileError(line, `구조체에는 '${node.op}' 계산을 쓸 수 없어요`, "멤버에 하나씩 계산해 주세요.");
      const R = this.value(this.expr(node.r), line);
      if (!sameType(R.t, L.t)) {
        throw compileError(line, "구조체 타입이 달라서 넣을 수 없어요", `${typeName(L.t)}에 ${typeName(R.t)}를 넣으려고 했어요.`);
      }
      return { t: L.t, ev: (f) => { const p = L.lv(f); const v = R.ev(f); rt.storeStruct(p, v, line); return v; } };
    }
    if (node.op === "=") {
      const R = this.conv(this.value(this.expr(node.r), line), L.t, line, what);
      if (L.set) {
        const set = L.set;
        return { t: L.t, ev: (f) => { const v = R.ev(f); set(f, v); return v; } };
      }
      return { t: L.t, ev: (f) => { const p = L.lv(f); const v = R.ev(f); rt.storeAt(p, v, line); return v; } };
    }
    if (isObj(L.t)) {
      if (L.t.k !== "string" || node.op !== "+=") throw compileError(line, `${friendlyType(L.t)}에는 '${node.op}'를 쓸 수 없어요`);
      const S = this.objRef(L, line);
      const add = this.bytesOf(this.value(this.expr(node.r), line), line, "+=");
      return { t: L.t, ev: (f) => { const st = S(f); setStr(st, strBytes(st).concat(add(f))); return cloneValue(L.t, st); } };
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
      if (E.builtinName) throw compileError(line, `표준 함수 '${E.builtinName}'의 주소는 쓸 수 없어요`);
      if (isFunc(E.t)) return { t: ptr(E.t), ev: E.ev, fnName: E.fnName };
      if (E.bitfield) throw compileError(line, "비트 필드에는 &를 붙일 수 없어요", "비트 필드는 바이트 단위 주소가 없어요. 일반 변수에 옮겨 담아서 쓰세요.");
      if (!E.lv) throw compileError(line, "숫자나 계산 결과에는 &를 붙일 수 없어요", "&는 변수나 배열 칸 앞에 붙여서 그 주소를 구해요.");
      const t = ptr(E.t);
      if (E.isConst) t.toConst = true;
      return { t, ev: E.lv, varName: E.varName };
    }
    if (op === "*") {
      const P = this.value(this.expr(node.e), line);
      if (!isPtr(P.t)) {
        throw compileError(line, "'*'는 주소(포인터) 앞에만 쓸 수 있어요", `${friendlyType(P.t)} 앞에 *를 붙였어요. 곱하기라면 양쪽에 값이 있는지 확인해 보세요.`);
      }
      if (isFunc(P.t.to)) return { t: P.t.to, ev: P.ev };
      if (isVoid(P.t.to)) throw compileError(line, "void* 가 가리키는 값은 바로 읽을 수 없어요", "먼저 (int *) 처럼 알맞은 타입으로 바꿔 주세요.");
      if (P.t.to.k === "file") throw compileError(line, "FILE 안의 값은 읽을 수 없어요");
      const lv = (f) => P.ev(f);
      return this.withLoad({ t: this.need(P.t.to, line), lv, isConst: Boolean(P.t.toConst) }, line);
    }
    const E = this.value(this.expr(node.e), line);
    if (op === "!" && E.t.k === "stream") {
      const S = E.ev;
      return { t: T.bool, ev: (f) => (rt.streamState(S(f)).fail ? 1 : 0) };
    }
    if (op === "!") {
      if (!isScalar(E.t)) throw compileError(line, "'!'는 참/거짓으로 볼 수 있는 값에만 쓸 수 있어요");
      return { t: this.boolT, ev: (f) => (truthy(E.ev(f)) ? 0 : 1), cv: E.cv !== undefined ? (truthy(E.cv) ? 0 : 1) : undefined };
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
      const stride = cellsDyn(this.need(t.to, line));
      if (typeof stride === "function") {
        throw compileError(line, `크기가 실행 중에 정해지는 배열의 포인터에는 '${node.op}'를 쓸 수 없어요`, "p = p + 1 처럼 써 주세요.");
      }
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
    if (this.cpp && isObj(B.t)) return this.objIndex(B, node.i, line, false);
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
    const elem = this.need(B.t.to, line);
    if (isVoid(elem)) throw compileError(line, "void* 에는 [ ]를 쓸 수 없어요", "먼저 알맞은 타입의 포인터로 바꿔 주세요.");
    if (isFunc(elem)) throw compileError(line, "함수 포인터에는 [ ]를 쓸 수 없어요");
    const stride = cellsDyn(elem);
    const lv = typeof stride === "function"
      ? (f) => {
        const p = B.ev(f);
        if (p === null) rt.check(null, line, false);
        return new Ptr(p.store, p.off + Number(I.ev(f)) * stride(f));
      }
      : (f) => {
        const p = B.ev(f);
        if (p === null) rt.check(null, line, false);
        return new Ptr(p.store, p.off + Number(I.ev(f)) * stride);
      };
    const E = { t: elem, lv, isConst: Boolean(B.t.toConst) };
    if (isArr(elem) && B.t.toConst) E.isConst = true;
    return this.withLoad(E, line);
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
        const a = E.t.to;
        const b = to.to;
        if (isArith(a) && isArith(b) && (a.size !== b.size || a.k !== b.k)) {
          throw compileError(line, `${typeName(E.t)}를 ${typeName(to)}로 바꿔서 메모리를 읽는 건 지원하지 않아요`,
            "이 실행기는 값을 바이트로 쪼개 두지 않아서, 다른 크기의 타입으로 읽으면 결과가 틀려요. 같은 메모리를 다른 타입으로 보려면 union을 써 보세요.");
        }
        if (isVoid(E.t.to) && !isVoid(to.to) && !isFunc(to.to)) {
          const target = this.need(to.to, line);
          return { t: to, ev: (f) => retypeHeap(E.ev(f), target, line) };
        }
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
    if (this.cpp && node.callee.k === "member") {
      if (node.callee.arrow) {
        const P = this.value(this.expr(node.callee.e), line);
        if (isPtr(P.t) && isObj(P.t.to)) {
          return this.objMethod(this.withLoad({ t: P.t.to, lv: P.ev, isConst: Boolean(P.t.toConst) }, line), node.callee.name, node);
        }
      } else {
        const B = this.expr(node.callee.e);
        if (B.t.k === "stream") return this.streamMethod(B, node.callee.name, node);
        if (isObj(B.t)) return this.objMethod(B, node.callee.name, node);
      }
    }
    if (node.callee.k === "id") {
      let name = this.resolveName(node.callee.name);
      const info = this.lookup(name);
      if (this.cpp && !info && !this.funcs.has(name)) {
        const base = this.stdName(name);
        if (base !== null && MANIP_MAKERS[base]) {
          this.needHeader("iomanip", `std::${base}`, line);
          if (node.args.length !== 1) throw compileError(line, `${base}에는 값 하나를 넣어요`, `예: ${base}(2)`);
          const A = this.conv(this.value(this.expr(node.args[0]), line), T.int, line, `${base}의 값`);
          const make = MANIP_MAKERS[base];
          return { t: MANIP, ev: (f) => make(Number(A.ev(f))) };
        }
        if (MANIP_MAKERS[name]) this.stdIdentifier(name, line); // using이 없다고 알려 줘요
        if (base === "min" || base === "max") return this.stdMinMax(base, node);
        if (base === "swap") return this.stdSwap(node);
        if (STR_FUNCS.has(base)) return this.stdStrFunc(base, node);
        if (base === null && STR_FUNCS.has(name)) {
          throw compileError(line, `'${name}'는 std::${name}이에요`, `맨 위에 using namespace std; 를 넣거나 std::${name} 처럼 써요.`);
        }
        if (name.startsWith("std::")) {
          if (!BUILTINS[base]) this.stdIdentifier(name, line);
          name = base;
        } else if (!BUILTINS[name] && Object.hasOwn(STD_LATER, name)) {
          throw compileError(line, `C++의 ${name}()은 아직 준비 중이에요 (C++ ${STD_LATER[name]}단계)`, "지금은 C 방식의 함수와 cout, cin을 쓸 수 있어요.");
        }
      }
      if (!info && ["va_start", "va_end", "va_copy"].includes(name) && this.hasHeader("stdarg.h")) {
        return this.stdarg(name, node);
      }
      if (!info) {
        const user = this.funcs.get(name);
        if (user) return this.callUser(user, node);
        const b = BUILTINS[name];
        if (b) return this.callBuiltin(name, b, node);
        const all = [...this.funcs.keys(), ...Object.keys(BUILTINS).filter((n) => this.hasHeader(BUILTINS[n].header))];
        throw compileError(line, `'${name}' 함수를 찾을 수 없어요`,
          `함수를 만들었는지, 이름이 맞는지 확인해 보세요.${suggest(name, all)}`);
      }
    }
    // 함수 포인터로 부르기: fp(1, 2), (*fp)(1, 2), ops[i](1, 2)
    const C = this.value(this.expr(node.callee), line);
    if (!isFuncPtr(C.t)) {
      const name = node.callee.k === "id" ? `'${node.callee.name}'는` : "이 값은";
      throw compileError(line, `${name} 함수가 아니라서 ( )를 붙일 수 없어요`, `${friendlyType(C.t)}예요.`);
    }
    const ftype = C.t.to;
    const getRef = C.ev;
    const rt = this.rt;
    return this.callWith(ftype, node, "함수 포인터", (f, vals, used, types) => {
      const ref = getRef(f);
      return rt.callFn(ref, vals, line, used, types);
    });
  }

  /** <stdarg.h>: va_start(목록, 마지막 매개변수), va_end(목록), va_copy(새 목록, 목록) */
  stdarg(name, node) {
    const { line } = node;
    const rt = this.rt;
    const need = { va_start: 2, va_end: 1, va_copy: 2 }[name];
    if (node.args.length !== need) throw this.argCountError(name, need, node.args.length, line);
    const list = this.lvalue(node.args[0], name);
    if (list.t.k !== "valist") throw compileError(line, `${name}의 첫 번째 값에는 va_list 변수가 와야 해요`);
    if (name === "va_end") return { t: T.void, ev: (f) => { rt.storeAt(list.lv(f), null, line); } };
    if (name === "va_copy") {
      const src = this.value(this.expr(node.args[1]), line);
      if (src.t.k !== "valist") throw compileError(line, "va_copy의 두 번째 값에는 va_list가 와야 해요");
      return { t: T.void, ev: (f) => { const c = src.ev(f); rt.storeAt(list.lv(f), c && { args: c.args, i: c.i }, line); } };
    }
    const fn = this.fn;
    if (!fn.type.variadic) {
      throw compileError(line, "va_start는 ... 이 있는 함수 안에서만 쓸 수 있어요", "예: int sum(int count, ...) { va_list args; va_start(args, count); ... }");
    }
    const last = fn.params[fn.params.length - 1];
    const arg = node.args[1];
    if (!last || arg.k !== "id" || arg.name !== last.name) {
      throw compileError(line, "va_start의 두 번째 값은 ... 바로 앞 매개변수의 이름이에요", last ? `예: va_start(${node.args[0].name || "args"}, ${last.name});` : "");
    }
    return { t: T.void, ev: (f) => { rt.storeAt(list.lv(f), { args: f.varargs, i: 0 }, line); } };
  }

  /** 복합 리터럴: (int[]){1, 2, 3} 처럼 이름 없이 만드는 값 */
  compound(node) {
    const { line } = node;
    const type = this.resolveType(node.type, { initLen: this.initLength(node.type, node.init) });
    if (isVoid(type) || isFunc(type)) throw compileError(line, "복합 리터럴의 타입이 올바르지 않아요");
    const size = cells(type);
    const init = this.initializer(type, node.init, line, "복합 리터럴");
    return this.withLoad({
      t: type,
      lv: (f) => {
        const st = new Store(size, "복합 리터럴", type);
        init(f, st);
        return new Ptr(st, 0);
      },
    }, line);
  }

  vaArg(node) {
    const { line } = node;
    const rt = this.rt;
    const list = this.value(this.expr(node.e), line);
    if (list.t.k !== "valist") throw compileError(line, "va_arg의 첫 번째 값에는 va_list 변수가 와야 해요");
    const want = this.resolveType(node.type);
    if ((isInt(want) && want.rank < T.int.rank) || (isFloat(want) && want.bits === 32)) {
      throw compileError(line, `va_arg로는 ${typeName(want)}를 꺼낼 수 없어요`,
        isFloat(want) ? "float 값은 넘길 때 double이 돼요. va_arg(args, double)로 꺼내요." : "char, short 값은 넘길 때 int가 돼요. va_arg(args, int)로 꺼내요.");
    }
    return {
      t: want,
      ev: (f) => {
        const cur = list.ev(f);
        if (!cur) throw runtimeError(line, "va_start를 먼저 불러야 해요", "va_arg를 쓰기 전에 va_start(목록, 마지막 매개변수); 를 불러요.");
        if (cur.i >= cur.args.length) {
          throw runtimeError(line, "넘겨받은 값보다 더 많이 꺼냈어요",
            `이 함수에는 ... 자리에 값이 ${cur.args.length}개 넘어왔는데 ${cur.i + 1}번째를 꺼내려고 했어요. 개수를 함께 넘겨서 그만큼만 꺼내요.`);
        }
        const { v, t } = cur.args[cur.i++];
        const kind = (x) => (isFloat(x) ? "실수" : isPtr(x) ? "주소" : isStruct(x) ? "구조체" : "정수");
        if (kind(t) !== kind(want)) {
          throw runtimeError(line, `va_arg로 ${typeName(want)}를 꺼냈는데 넘어온 값은 ${typeName(t)}예요`,
            `넘긴 값의 종류(${kind(t)})에 맞는 타입으로 꺼내 주세요.`);
        }
        return isArith(want) ? convert(v, t, want) : v;
      },
    };
  }

  callUser(fi, node) {
    let pre = null;
    if (fi.overloads && fi.overloads.length > 1) {
      pre = node.args.map((a) => (a.k === "initlist" ? { t: { k: "initlist" }, initlist: true } : this.expr(a)));
      fi = this.pickOverload(fi.overloads, pre, node, fi.name);
    }
    const target = fi;
    return this.callWith(fi.type, node, fi.name, (f, vals, used, types) => this.invoke(target, vals, node.line, used, types), fi, pre);
  }

  callWith(ftype, node, name, run, fi = null, pre = null) {
    const { line } = node;
    const params = ftype.params;
    const loose = ftype.noProto && !(fi && fi.def);
    const need = params.filter((p) => !p.dflt).length; // 기본 인자가 있는 매개변수는 빼도 돼요
    const countOk = ftype.variadic ? node.args.length >= params.length : node.args.length >= need && node.args.length <= params.length;
    if (!loose && !countOk) {
      if (ftype.variadic) throw compileError(line, `함수 '${name}'에는 값이 적어도 ${params.length}개 필요한데 ${node.args.length}개를 넣었어요`);
      if (need !== params.length) throw compileError(line, `함수 '${name}'에는 값 ${need}~${params.length}개가 필요한데 ${node.args.length}개를 넣었어요`);
      throw this.argCountError(name, params.length, node.args.length, line);
    }
    const extraTypes = [];
    const argNodes = [...node.args];
    for (let i = node.args.length; i < params.length && !ftype.variadic; i++) argNodes.push(params[i].dflt);
    const args = argNodes.map((a, i) => {
      if (a && a.k === "initlist") {
        const pt = params[i] ? params[i].type : null;
        const target = pt && pt.k === "ref" ? pt.to : pt;
        if (!target || !(isStruct(target) || isObj(target))) throw compileError(line, `'${name}'의 ${i + 1}번째 값에는 { } 를 쓸 수 없어요`);
        const make = this.elemValue(target, a, line, `'${name}'의 ${i + 1}번째 값`);
        if (pt.k === "ref") {
          if (!pt.toConst) throw compileError(line, `{ } 값은 ${typeName(pt)}로 받을 수 없어요`, `const ${typeName(target)} & 로 받아 주세요.`);
          return { ev: (f) => { const st = new Store(cells(target), "임시 값", target); st.cells = make(f); return new Ptr(st, 0); } };
        }
        return { ev: isStruct(target) ? make : (f) => make(f)[0] };
      }
      const raw = pre && pre[i] && !pre[i].initlist ? pre[i] : this.expr(a);
      if (params[i] && params[i].type.k === "ref") return { ev: this.bindRef(params[i].type, raw, line, `'${name}'의 ${i + 1}번째 값`) };
      const E = this.value(raw, line);
      if (params[i]) return this.conv(E, params[i].type, line, `'${name}'의 ${i + 1}번째 값`);
      // ... 자리의 값: char, short는 int로, float은 double로 커져서 넘어가요
      const V = isFloat(E.t) ? this.conv(E, T.double, line) : isInt(E.t) ? this.conv(E, promote(E.t), line) : E;
      extraTypes.push(V.t);
      return V;
    }).map((E) => E.ev);
    const used = !node.unused;
    const n = args.length;
    const ev = (f) => {
      const vals = new Array(n);
      for (let i = 0; i < n; i++) vals[i] = args[i](f);
      return run(f, vals, used, extraTypes);
    };
    // 참조를 돌려주는 함수: 결과가 변수처럼 쓰여요 (f() = 3;)
    if (ftype.ret.k === "ref") return this.withLoad({ t: ftype.ret.to, lv: ev, isConst: Boolean(ftype.ret.toConst) }, line);
    return { t: ftype.ret, ev };
  }

  argCountError(name, need, got, line) {
    return compileError(line, `함수 '${name}'에는 값 ${need}개가 필요한데 ${got}개를 넣었어요`);
  }

  invoke(fi, vals, line, used, extraTypes = []) {
    const rt = this.rt;
    if (!fi.body) throw runtimeError(line, `함수 '${fi.name}'의 내용({ … })이 없어요`, "선언만 하고 만들지 않은 함수예요.");
    if (++rt.depth > MAX_DEPTH) {
      rt.depth = 0;
      throw runtimeError(line, "함수가 자기 자신을 너무 깊이 불렀어요", `${MAX_DEPTH}번 넘게 들어갔어요. 재귀 함수에 멈추는 조건(if ...: return)이 있는지 확인해 보세요.`);
    }
    const frame = new Array(fi.slotCount);
    for (let i = 0; i < fi.params.length; i++) {
      const p = fi.params[i];
      const st = new Store(p.cells, p.name, p.type);
      if (p.cells === 1) st.cells[0] = vals[i];
      else st.cells = vals[i].slice(); // 구조체는 복사해서 넘겨요
      frame[p.slot] = st;
    }
    if (fi.type.variadic) {
      frame.varargs = vals.slice(fi.params.length).map((v, i) => ({ v, t: extraTypes[i] || T.int }));
    }
    rt.stack.push({ fi, frame });
    const jmpCtx = rt.jmpCtx;
    rt.jmpCtx = null;
    const code = fi.body(frame);
    rt.jmpCtx = jmpCtx;
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
      if (isStruct(t)) {
        throw compileError(line, `구조체는 ${name}로 한 번에 ${kind === "printf" ? "출력" : "입력"}할 수 없어요`,
          `멤버를 하나씩 써 주세요. 예: ${E.varName || "p"}.멤버 (${pos})`);
      }
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
      if (isPtr(t) && t.toConst) {
        throw compileError(line, "const로 정한 변수에는 scanf로 값을 넣을 수 없어요", `const를 지우거나 다른 변수에 읽어 주세요. (${pos})`);
      }
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
    const params = b.params.map((p) => this.btype(p, line));
    const nfixed = params.length;
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
    for (const i of b.writes || []) {
      if (vals[i] && isPtr(vals[i].t) && vals[i].t.toConst) {
        throw compileError(line, `const로 정한 곳에는 ${name}로 값을 넣을 수 없어요`, `${vals[i].varName ? `'${vals[i].varName}'는 ` : ""}const라서 바꿀 수 없어요.`);
      }
    }
    if (b.format) {
      const fi = b.formatIndex || 0;
      this.checkFormat(name, b.format, node.args[fi], vals.slice(fi + 1), line);
    }
    const args = vals.map((E, i) => {
      if (i < nfixed) {
        const pt = params[i];
        if (pt === FILE_T) {
          if (!isPtr(E.t) || E.t.to.k !== "file") {
            throw compileError(line, `${name}의 ${i + 1}번째 값에는 파일(FILE *)이 와야 해요`, "fopen으로 연 파일이나 stdin, stdout을 넣어요.");
          }
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
      t: this.btype(b.ret, line),
      ev: (f) => {
        const vs = new Array(n);
        for (let i = 0; i < n; i++) vs[i] = evs[i](f);
        return impl(rt, vs, line, types);
      },
    };
  }

  // ---------- 초기화 ----------
  constIndex(node, line) {
    const E = this.value(this.expr(node), line);
    if (E.cv === undefined || !isInt(E.t)) throw compileError(line, "[번호] = 의 번호는 정수 상수여야 해요");
    return Number(E.cv);
  }

  initLength(type, init) {
    if (!isArr(type) || type.lenExpr !== null || !init) return null;
    if (init.k === "str") return init.bytes.length + 1;
    if (init.k !== "initlist") return null;
    const items = init.items;
    if (type.of.k === "array" && items.length && items.every((x) => x.k !== "initlist" && x.k !== "str" && x.k !== "desig")) {
      const inner = this.resolveType(type.of);
      return Math.ceil(items.length / cells(inner));
    }
    let idx = 0;
    let max = 0;
    for (const x of items) {
      if (x.k === "desig" && x.index) idx = this.constIndex(x.index, x.line);
      idx++;
      max = Math.max(max, idx);
    }
    return max;
  }

  /** 처음 값 넣기: (frame, store) => void 를 돌려줘요. */
  initializer(type, init, line, name) {
    if (!init) return null;
    if (isObj(type)) {
      const ev = this.objectValue(type, init, line, name);
      return (f, st) => { st.cells[0] = ev(f); };
    }
    if (init.k === "ctor") {
      // int x(5); 는 int x = 5; 와 같아요
      if (init.args.length !== 1 || isStruct(type) || isArr(type)) {
        throw compileError(line, `'${name}'의 괄호 안 처음 값이 맞지 않아요`, isStruct(type) ? "생성자는 C++ 3단계(클래스)에서 지원해요. { } 로 처음 값을 넣어 주세요." : "값 하나를 넣어요.");
      }
      init = init.args[0];
    }
    if (isArr(type) || (isStruct(type) && init.k === "initlist")) {
      // 묶음(배열, 구조체): 먼저 모두 0으로 채우고, 적힌 값만 넣어요 (C 규칙)
      const zeros = zerosOf(type);
      const entries = [];
      this.place(type, init, 0, entries, line, name);
      return (f, st) => {
        for (let i = 0; i < zeros.length; i++) st.cells[i] = zeros[i];
        for (const e of entries) {
          if (e.n) {
            const v = e.ev(f);
            for (let k = 0; k < e.n; k++) st.cells[e.off + k] = v[k];
          } else st.cells[e.off] = e.ev(f);
          if (e.tag) (st.unionTags || (st.unionTags = new Map())).set(e.off, e.tag);
        }
      };
    }
    if (isStruct(type)) {
      const E = this.conv(this.value(this.expr(init), line), type, line, `'${name}'의 처음 값`);
      return (f, st) => {
        const v = E.ev(f);
        for (let k = 0; k < v.length; k++) st.cells[k] = v[k];
      };
    }
    const entries = [];
    this.place(type, init, 0, entries, line, name);
    const ev = entries[0].ev;
    return (f, st) => { st.cells[0] = ev(f); };
  }

  charHint(E, node) {
    if (node.k === "str") E.strChar = true;
    return E;
  }

  /** 처음 값 하나를 off 위치에 놓아요. */
  place(type, init, off, entries, line, name) {
    if (isObj(type)) {
      entries.push({ off, ev: this.objectValue(type, init, line, name) });
      return undefined;
    }
    if (isArr(type)) return this.flattenArray(type, init, off, entries, line, name);
    if (isStruct(type)) {
      if (init.k === "initlist") return this.flattenStruct(type, init, off, entries, line, name);
      const E = this.conv(this.value(this.expr(init), line), type, line, `'${name}'의 처음 값`);
      entries.push({ off, ev: E.ev, n: cells(type) });
      return undefined;
    }
    let node = init;
    if (init.k === "initlist") {
      if (init.items.length !== 1) throw compileError(line, `'${name}'는 값이 하나라서 { } 안에 하나만 넣을 수 있어요`);
      node = init.items[0];
    }
    if (node.k === "desig" || node.k === "initlist") throw compileError(line, `'${name}'의 처음 값 모양이 맞지 않아요`);
    const E = this.conv(this.value(this.charHint(this.expr(node), node), line), type, line, `'${name}'의 처음 값`);
    entries.push({ off, ev: E.ev });
    return undefined;
  }

  flattenStruct(st, init, base, entries, line, name) {
    this.layout(st, line);
    let fi = 0;
    for (let x of init.items) {
      if (x.k === "desig") {
        if (x.field == null) throw compileError(line, "구조체에는 [번호] = 를 쓸 수 없어요", "멤버 이름으로 .이름 = 값 처럼 써요.");
        fi = st.fields.findIndex((f) => f.name === x.field);
        if (fi < 0) {
          const names = st.fields.map((f) => f.name);
          throw compileError(line, `${typeName(st)}에는 '${x.field}' 멤버가 없어요`, `있는 멤버: ${names.join(", ")}.${suggest(x.field, names)}`);
        }
        x = x.init;
      }
      if (fi >= st.fields.length) {
        throw compileError(line, `'${name}'의 처음 값이 멤버 수(${st.fields.length}개)보다 많아요`);
      }
      if (st.isUnion && init.items.length > 1) {
        throw compileError(line, `공용체 '${name}'에는 처음 값을 하나만 넣을 수 있어요`, "공용체의 멤버들은 같은 자리를 함께 써요. 예: .f = 1.5");
      }
      const f = st.fields[fi];
      const before = entries.length;
      this.place(f.type, x, base + f.off, entries, line, `${name}.${f.name}`);
      if (st.isUnion && isScalar(f.type)) for (let k = before; k < entries.length; k++) entries[k].tag = f.type;
      fi++;
    }
  }

  flattenArray(type, init, base, entries, line, name) {
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
    if (isArr(elem) && items.every((x) => x.k !== "initlist" && x.k !== "str" && x.k !== "desig")) {
      // 중괄호를 생략한 2차원 배열: 차례대로 채워요
      if (items.length > cells(type)) throw compileError(line, `배열 '${name}'에 처음 값이 너무 많아요`);
      const scalar = baseOf(type);
      items.forEach((x, i) => {
        const E = this.conv(this.value(this.expr(x), line), scalar, line, `'${name}'의 처음 값`);
        entries.push({ off: base + i, ev: E.ev });
      });
      return;
    }
    let idx = 0;
    for (let x of items) {
      if (x.k === "desig") {
        if (x.index == null) throw compileError(line, "배열에는 .이름 = 을 쓸 수 없어요", "번호로 [2] = 값 처럼 써요.");
        idx = this.constIndex(x.index, line);
        x = x.init;
      }
      if (idx < 0 || idx >= type.len) {
        throw compileError(line, `배열 '${name}'에 처음 값이 너무 많아요`, `배열은 ${type.len}칸이에요.`);
      }
      this.place(elem, x, base + idx * elemCells, entries, line, `${name}[${idx}]`);
      idx++;
    }
  }

  // ---------- 선언 ----------
  declareEnums(defs) {
    for (const def of defs || []) {
      let next = 0;
      for (const item of def.items) {
        if (item.expr) {
          const E = this.value(this.expr(item.expr), item.line);
          if (E.cv === undefined || !isInt(E.t)) throw compileError(item.line, `enum '${item.name}'의 값은 정수 상수여야 해요`);
          next = Number(E.cv);
        }
        this.declare({ name: item.name, enumConst: next, type: T.int, line: item.line });
        next++;
      }
    }
  }

  declaration(node, global) {
    const closures = [];
    this.declareEnums(node.enums);
    for (let item of node.items) {
      if (item.type.k === "func") {
        if (!global) throw compileError(item.line, "함수 안에서 다른 함수를 선언할 수 없어요", "함수 선언은 main 위쪽에 써 주세요.");
        this.declareFunction(item, null);
        continue;
      }
      if (item.storage === "extern") {
        this.externDeclaration(item, global);
        continue;
      }
      if (this.cpp) item = { ...item, type: this.deduceAuto(item.type, item.init, item.line, item.name) };
      const type = this.resolveType(item.type, { allowVla: !global, initLen: this.initLength(item.type, item.init) });
      if (type.k === "ref") {
        closures.push(...this.refDeclaration(item, type, global));
        continue;
      }
      if (isVoid(type)) throw compileError(item.line, `void 타입으로는 변수 '${item.name}'를 만들 수 없어요`);
      const dyn = isDyn(type);
      if (dyn && item.init) throw compileError(item.line, "크기가 변하는 배열에는 처음 값을 넣을 수 없어요");
      if (dyn && item.storage === "static") throw compileError(item.line, "static 배열의 크기는 상수여야 해요");
      const size = cells(type);
      const old = global ? this.globalScope.vars.get(item.name) : null;
      if (old && old.externDecl) {
        // extern int g; 뒤에 나온 진짜 정의: 같은 저장 공간을 써요
        const fits = sameType(old.type, type) || (isArr(old.type) && old.type.len == null && isArr(type) && sameType(old.type.of, type.of));
        if (!fits) throw compileError(item.line, `'${item.name}'의 extern 선언과 정의의 타입이 달라요`, `${old.line}번째 줄의 extern 선언과 맞춰 주세요.`);
        if (old.type !== type && isArr(type)) {
          old.type = type;
          old.store.type = type;
          old.store.cells = zerosOf(type).slice();
        }
        old.externDecl = false;
        old.isConst = item.isConst;
        const init = this.initializer(type, item.init, item.line, item.name);
        if (init) this.globalInits.push(() => init(null, old.store));
        continue;
      }
      if (global || item.storage === "static") {
        const st = new Store(size, item.name, type);
        st.cells = zerosOf(type).slice();
        const info = { name: item.name, type, store: st, line: item.line, global, isConst: item.isConst, constValue: this.constValueOf(item, type) };
        this.declare(info);
        if (global) this.globals.push(info);
        else this.fn.locals.push(info);
        const init = this.initializer(type, item.init, item.line, item.name);
        if (init) this.globalInits.push(() => init(null, st));
        continue;
      }
      const slot = this.fn.slotCount++;
      const info = { name: item.name, type, slot, line: item.line, vla: dyn, isConst: item.isConst, constValue: this.constValueOf(item, type) };
      this.declare(info);
      this.fn.locals.push(info);
      const init = this.initializer(type, item.init, item.line, item.name);
      const { name, line } = item;
      const rt = this.rt;
      const dims = vlaDims(type);
      if (dyn) {
        closures.push((f) => {
          rt.line = line;
          fillDims(dims, f, rt);
          const real = concrete(type, f);
          const n = cells(real);
          if (n > 10_000_000) throw runtimeError(line, `배열 '${name}'이 너무 커요`, "1000만 칸 이하로 만들어 주세요.");
          f[slot] = new Store(n, name, real);
          return NORMAL;
        });
        continue;
      }
      if (dims.length) {
        // int (*p)[m] 처럼 VLA를 가리키는 포인터
        closures.push((f) => {
          rt.line = line;
          fillDims(dims, f, rt);
          const st = new Store(size, name, type);
          f[slot] = st;
          if (init) init(f, st);
          return NORMAL;
        });
        continue;
      }
      const empty = hasObj(type) ? zerosOf(type) : null; // string, vector는 빈 값으로 시작해요
      closures.push(init
        ? (f) => { rt.line = line; const st = new Store(size, name, type); if (empty) st.cells = empty.slice(); f[slot] = st; init(f, st); return NORMAL; }
        : empty
          ? (f) => { const st = new Store(size, name, type); st.cells = empty.slice(); f[slot] = st; return NORMAL; }
          : (f) => { f[slot] = new Store(size, name, type); return NORMAL; });
    }
    return closures;
  }

  /** C++: 상수로 처음 값을 넣은 const 정수는 상수 식이에요 */
  constValueOf(item, type) {
    if (!this.cpp || !item.isConst || !isInt(type) || !item.init || item.init.k === "initlist") return undefined;
    let E;
    try { E = this.value(this.expr(item.init), item.line); } catch { return undefined; }
    return E.cv !== undefined && isArith(E.t) ? convert(E.cv, E.t, type) : undefined;
  }

  /** int &r = x; */
  refDeclaration(item, type, global) {
    const { name, line } = item;
    if (!item.init) throw compileError(line, `참조 '${name}'는 처음에 무엇을 가리킬지 정해야 해요`, `예: int &${name} = 변수이름;`);
    const node = item.init.k === "initlist" && item.init.items.length === 1 ? item.init.items[0] : item.init;
    if (node.k === "initlist") throw compileError(line, `참조 '${name}'에는 값 하나를 넣어요`);
    const bind = this.bindRef(type, this.expr(node), line, `참조 '${name}'`);
    if (global || item.storage === "static") {
      const st = new Store(1, name, type);
      const info = { name, type, store: st, line, global, isConst: false };
      this.declare(info);
      if (global) this.globals.push(info);
      else this.fn.locals.push(info);
      let done = false;
      if (global) this.globalInits.push(() => { st.cells[0] = bind(null); });
      return global ? [] : [(f) => { if (!done) { st.cells[0] = bind(f); done = true; } return NORMAL; }];
    }
    const slot = this.fn.slotCount++;
    const info = { name, type, slot, line, isConst: false };
    this.declare(info);
    this.fn.locals.push(info);
    const rt = this.rt;
    return [(f) => { rt.line = line; const st = new Store(1, name, type); st.cells[0] = bind(f); f[slot] = st; return NORMAL; }];
  }

  /** extern int g; : 다른 곳(보통 아래쪽)에서 정의한 전역 변수를 미리 알려요 */
  externDeclaration(item, global) {
    if (item.init) throw compileError(item.line, "extern 선언에는 처음 값을 넣지 않아요", "값은 extern 없이 정의하는 곳에서 넣어요. 예: int g = 7;");
    const type = this.resolveType(item.type, { param: true });
    const { name, line } = item;
    let g = this.globalScope.vars.get(name);
    if (!g) {
      if (this.funcs.has(name)) throw compileError(line, `'${name}'는 이미 함수 이름이에요`);
      const st = new Store(cells(type), name, type);
      st.cells = zerosOf(type).slice();
      g = { name, type, store: st, line, global: true, isConst: item.isConst, externDecl: true };
      this.globalScope.vars.set(name, g);
      this.globals.push(g);
    } else {
      const fits = g.global && (sameType(g.type, type) || (isArr(type) && type.len == null && isArr(g.type) && sameType(g.type.of, type.of)));
      if (!fits) throw compileError(line, `'${name}'의 extern 선언이 원래 타입과 달라요`, `${g.line}번째 줄의 선언과 맞춰 주세요.`);
    }
    if (!global) {
      const here = this.scope.vars.get(name);
      if (here && here !== g) throw compileError(line, `'${name}'를 이미 선언했어요`);
      this.scope.vars.set(name, g);
    }
  }

  declareFunction(item, def) {
    const type = this.resolveType(item.type);
    const { name, line } = item;
    if (BUILTINS[name] && this.hasHeader(BUILTINS[name].header)) {
      throw compileError(line, `'${name}'는 이미 표준 라이브러리에 있는 함수 이름이에요`, "다른 이름을 써 주세요.");
    }
    if (this.globalScope.vars.has(name)) throw compileError(line, `'${name}'는 이미 변수 이름이에요`);
    const group = this.funcs.get(name);
    let old = group;
    if (group && this.cpp) {
      // C++ 오버로딩: 매개변수 타입이 다르면 같은 이름의 다른 함수예요
      const sameParams = (a, b) => a.params.length === b.params.length && a.params.every((p, i) => sameType(p.type, b.params[i].type) && (p.type.k === "ref") === (b.params[i].type.k === "ref"));
      old = group.overloads.find((o) => sameParams(o.type, type)) || null;
      if (!old) {
        if (name === "main") throw compileError(line, "main 함수는 하나만 만들 수 있어요");
        const fi = { name, type, def, line, body: null, slotCount: 0, locals: [], params: [], ns: item.ns };
        fi.ref = new FnRef(fi);
        group.overloads.push(fi);
        return fi;
      }
      // 앞의 선언에만 적은 기본 인자는 그대로 써요
      type.params.forEach((p, i) => {
        const q = old.type.params[i];
        if (!p.dflt && q.dflt) p.dflt = q.dflt;
        else if (p.dflt && !q.dflt) q.dflt = p.dflt;
      });
    }
    if (old) {
      const same = sameType(old.type.ret, type.ret) &&
        (old.type.noProto || type.noProto || (old.type.params.length === type.params.length &&
          old.type.params.every((p, i) => sameType(p.type, type.params[i].type))));
      if (!same) throw compileError(line, `함수 '${name}'의 선언과 정의가 서로 달라요`, `${old.line}번째 줄의 선언과 매개변수, 돌려주는 타입을 맞춰 주세요.`);
      if (def && old.def) throw compileError(line, `함수 '${name}'를 두 번 만들었어요`, `${old.def.line}번째 줄에 이미 있어요.`);
      if (def) { old.def = def; old.type = type; old.line = line; }
      return old;
    }
    const fi = { name, type, def, line, body: null, slotCount: 0, locals: [], params: [], ns: item.ns };
    fi.ref = new FnRef(fi);
    fi.overloads = [fi];
    this.funcs.set(name, fi);
    return fi;
  }

  compileFunction(fi) {
    const def = fi.def;
    this.fn = fi;
    this.ns = def.ns || "";
    fi.slotCount = 0;
    fi.locals = [];
    fi.params = [];
    this.push();
    const dims = [];
    def.type.params.forEach((p, i) => {
      if (!p.name) throw compileError(def.line, `함수 '${fi.name}'의 ${i + 1}번째 매개변수에 이름이 필요해요`);
      let type = fi.type.params[i].type;
      if (hasAnyLen(type)) {
        // int m[n][n] 같은 매개변수: 앞의 매개변수 n으로 크기를 정해요
        type = this.resolveType(p.type, { param: true, allowVla: true, line: p.line });
        if (isArr(type)) type = ptr(type.of);
        dims.push(...vlaDims(type));
      }
      const info = { name: p.name, type, slot: fi.slotCount++, line: p.line, cells: cells(this.need(type, p.line)), isConst: p.isConst };
      this.declare(info);
      fi.locals.push(info);
      fi.params.push(info);
    });
    this.fnLabels = this.allLabels(def.body);
    const body = this.block(def.body, false);
    const rt = this.rt;
    fi.body = dims.length ? (f) => { fillDims(dims, f, rt); return body(f); } : body;
    this.ns = "";
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
    if (E.t.k === "stream") {
      // while (cin >> x): 읽기에 성공하면 참
      const rt = this.rt;
      const S = E.ev;
      return (f) => (rt.streamState(S(f)).fail ? 0 : 1);
    }
    if (!isScalar(E.t)) throw compileError(node.line, "조건에는 참/거짓으로 볼 수 있는 값이 와야 해요");
    return E.ev;
  }

  seq(list, labels = null) {
    if (list.jumpPoints) return this.jumpSeq(list, labels);
    const n = list.length;
    const rt = this.rt;
    if (labels && labels.size) {
      // goto: 이 블록에 있는 이름표로 가는 점프는 여기서 받아서 그 자리부터 다시 실행해요
      return (f) => {
        let i = 0;
        while (i < n) {
          const c = list[i](f);
          if (c === GOTO && labels.has(rt.gotoLabel)) {
            i = labels.get(rt.gotoLabel);
            continue;
          }
          if (c) return c;
          i++;
        }
        return NORMAL;
      };
    }
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

  /** setjmp가 있는 블록: longjmp가 오면 그 setjmp 문장부터 다시 실행해요 (setjmp는 이번엔 longjmp의 값을 돌려줘요) */
  jumpSeq(list, labels) {
    const n = list.length;
    const rt = this.rt;
    const points = new Set(list.jumpPoints);
    return (f) => {
      const token = { dead: false };
      const stackLen = rt.stack.length;
      const depth = rt.depth;
      const saved = rt.jmpCtx;
      let i = 0;
      try {
        while (i < n) {
          let c;
          rt.jmpCtx = points.has(i) ? { token, index: i } : null;
          try {
            c = list[i](f);
          } catch (e) {
            if (e instanceof JumpSignal && e.ctx.token === token) {
              rt.stack.length = stackLen;
              rt.depth = depth;
              rt.jumpValue = e.value;
              i = e.ctx.index;
              continue;
            }
            throw e;
          }
          if (c === GOTO && labels && labels.has(rt.gotoLabel)) {
            i = labels.get(rt.gotoLabel);
            continue;
          }
          if (c) return c;
          i++;
        }
        return NORMAL;
      } finally {
        token.dead = true;
        rt.jmpCtx = saved;
      }
    };
  }

  /** 이 문장 자체(안쪽 문장 말고)의 식에 setjmp(...) 호출이 있나요? */
  hasSetjmp(node) {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some((x) => this.hasSetjmp(x));
    if (node.k === "call" && node.callee && node.callee.k === "id" && node.callee.name === "setjmp") return true;
    for (const [key, v] of Object.entries(node)) {
      if (key === "then" || key === "otherwise" || key === "body" || key === "stmt" || key === "type") continue;
      if (v && typeof v === "object" && this.hasSetjmp(v)) return true;
    }
    return false;
  }

  /** 블록 바로 안에 있는 이름표들 */
  labelsOf(stmts) {
    const names = new Set();
    for (let s of stmts) {
      while (s && s.k === "label") {
        if (names.has(s.name)) throw compileError(s.line, `이름표 '${s.name}'가 두 번 나왔어요`);
        names.add(s.name);
        s = s.stmt;
      }
    }
    return names;
  }

  /** 함수 안 어디에 있든 모든 이름표 (goto 오류 안내용) */
  allLabels(node, out = new Set()) {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) { node.forEach((x) => this.allLabels(x, out)); return out; }
    if (node.k === "label") out.add(node.name);
    for (const key of ["body", "stmt", "then", "otherwise"]) if (node[key]) this.allLabels(node[key], out);
    return out;
  }

  block(node, newScope = true) {
    if (newScope) this.push();
    this.labelScopes.push(this.labelsOf(node.body));
    const list = [];
    const labels = new Map();
    for (const s of node.body) this.collect(s, list, labels);
    this.labelScopes.pop();
    if (newScope) this.pop();
    return this.seq(list, labels);
  }

  /** 문장 하나를 클로저 목록에 넣어요. 이름표 자리도 기억해요. */
  collect(s, list, labels) {
    while (s.k === "label") {
      labels.set(s.name, list.length);
      s = s.stmt;
    }
    if (this.hasHeader("setjmp.h") && this.hasSetjmp(s)) (list.jumpPoints || (list.jumpPoints = [])).push(list.length);
    list.push(...this.statements(s));
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
      case "staticassert": this.staticAssert(node); return () => NORMAL;
      case "using": this.usingDecl(node); return () => NORMAL;
      case "rangefor": return this.rangeFor(node);
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
            if (r === RETURN || r === GOTO) return r;
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
            if (r === RETURN || r === GOTO) return r;
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
            if (r === RETURN || r === GOTO) return r;
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
        if (ret.k === "ref") {
          const ev = this.bindRef(ret, this.expr(node.e), line, "돌려주는 참조");
          return (f) => { rt.line = line; rt.ret = ev(f); return RETURN; };
        }
        const E = this.conv(this.value(this.expr(node.e), line), ret, line, "돌려주는 값");
        const ev = E.ev;
        return (f) => { rt.line = line; rt.ret = ev(f); return RETURN; };
      }
      case "label": {
        // 블록 바로 안이 아닌 곳(예: if 안)의 이름표는 goto로 갈 수 없어요
        return this.statement(node.stmt);
      }
      case "goto": {
        const name = node.name;
        if (!this.labelScopes.some((set) => set.has(name))) {
          if (this.fnLabels.has(name)) {
            throw compileError(line, `goto로 다른 블록 안쪽의 이름표 '${name}'로 들어갈 수 없어요`,
              "goto는 같은 블록이나 바깥 블록에 있는 이름표로만 갈 수 있어요. 이름표를 바깥으로 옮겨 보세요.");
          }
          throw compileError(line, `이름표 '${name}'가 없어요`, `goto ${name}; 로 가려면 함수 안에 ${name}: 이 있어야 해요.${suggest(name, [...this.fnLabels])}`);
        }
        return () => { rt.gotoLabel = name; return GOTO; };
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
    const labels = new Map();
    this.labelScopes.push(this.labelsOf(node.body.body));
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
        this.collect(s, list, labels);
      }
    }
    this.labelScopes.pop();
    this.switches--;
    this.pop();
    return (f) => {
      rt.line = line;
      const key = String(val(f));
      const start = cases.has(key) ? cases.get(key) : defaultIndex;
      if (start < 0) return NORMAL;
      for (let i = start; i < list.length; i++) {
        const c = list[i](f);
        if (c === GOTO && labels.has(rt.gotoLabel)) { i = labels.get(rt.gotoLabel) - 1; continue; }
        if (c === BREAK) return NORMAL;
        if (c) return c;
      }
      return NORMAL;
    };
  }

  /** using namespace std; / using std::cout; */
  usingDecl(node) {
    if (node.ns === "std") this.usingStd = true;
    else if (node.ns) this.usingNs.add(node.ns);
    else {
      if (!STD_STREAMS[node.name] && !MANIPULATORS[node.name] && !MANIP_MAKERS[node.name] && !["min", "max", "swap"].includes(node.name) && !BUILTINS[node.name]) {
        throw compileError(node.line, `std::${node.name}는 아직 없어요`);
      }
      this.usingNames.add(node.name);
    }
  }

  /** _Static_assert(조건, "설명"): 컴파일할 때 조건을 확인해요 */
  staticAssert(node) {
    const E = this.value(this.expr(node.e), node.line);
    if (E.cv === undefined || !isInt(E.t)) {
      throw compileError(node.line, "_Static_assert의 조건은 컴파일할 때 알 수 있는 정수 상수여야 해요", "예: _Static_assert(sizeof(int) == 4, \"int는 4바이트\");");
    }
    if (!truthy(E.cv)) {
      throw compileError(node.line, `_Static_assert가 실패했어요${node.msg ? `: ${node.msg}` : ""}`, "컴파일할 때 확인하는 조건이 거짓이에요.");
    }
  }

  // ---------- 프로그램 ----------
  compile(ast) {
    this.rt.invoke = (fi, vals, line, used, types) => this.invoke(fi, vals, line, used, types);
    this.builtinTypes = ast.builtinTypes || {};
    for (const t of Object.values(this.builtinTypes)) if (isStruct(t)) this.layout(t, 0);
    this.rt.builtinTypes = this.builtinTypes;
    // 함수 이름을 먼저 모두 등록해서, 뒤에 만든 함수도 부를 수 있게 해요.
    for (const item of ast.items) {
      if (item.k === "func") item.fi = this.declareFunction(item, item);
    }
    for (const item of ast.items) {
      this.ns = item.ns || "";
      if (item.k === "func") {
        const fi = item.fi;
        if (fi.def === item) this.compileFunction(fi);
      } else if (item.k === "staticassert") {
        this.staticAssert(item);
      } else if (item.k === "using") {
        this.usingDecl(item);
      } else {
        this.declaration(item, true);
      }
    }
    const undefinedExtern = this.globals.find((g) => g.externDecl);
    if (undefinedExtern) {
      throw compileError(undefinedExtern.line, `extern으로 선언한 '${undefinedExtern.name}'의 정의가 없어요`,
        `이 앱은 파일 하나로 실행돼요. 아래쪽에 ${typeName(undefinedExtern.type)} ${undefinedExtern.name} = 0; 처럼 정의를 넣어 주세요.`);
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
