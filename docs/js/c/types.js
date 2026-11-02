// C 실행기에서 함께 쓰는 것들: 오류, 타입, 값 변환, 메모리(저장 칸).

/** C 코드의 오류. 처음부터 한국어 제목과 설명을 가지고 있어요. */
export class CError extends Error {
  constructor(kind, line, title, detail = "") {
    super(title);
    this.kind = kind; // "compile" | "runtime"
    this.line = line;
    this.title = title;
    this.detail = detail;
  }
}

export const compileError = (line, title, detail) => new CError("compile", line, title, detail);
export const runtimeError = (line, title, detail) => new CError("runtime", line, title, detail);

// ---------- 타입 ----------
function intType(name, bits, unsigned, rank, size) {
  return { k: "int", name, bits, unsigned, rank, size };
}

export const T = {
  void: { k: "void", name: "void", size: 1 },
  bool: intType("bool", 1, true, 0, 1),
  char: intType("char", 8, false, 1, 1),
  schar: intType("signed char", 8, false, 1, 1),
  uchar: intType("unsigned char", 8, true, 1, 1),
  short: intType("short", 16, false, 2, 2),
  ushort: intType("unsigned short", 16, true, 2, 2),
  int: intType("int", 32, false, 3, 4),
  uint: intType("unsigned int", 32, true, 3, 4),
  long: intType("long", 64, false, 4, 8),
  ulong: intType("unsigned long", 64, true, 4, 8),
  llong: intType("long long", 64, false, 5, 8),
  ullong: intType("unsigned long long", 64, true, 5, 8),
  float: { k: "float", name: "float", bits: 32, size: 4 },
  double: { k: "float", name: "double", bits: 64, size: 8 },
};

export const ptr = (to) => ({ k: "ptr", to, size: 8 });
export const arr = (of, len) => ({ k: "array", of, len, size: (len ?? 0) * of.size });
export const func = (ret, params, variadic = false) => ({ k: "func", ret, params, variadic });

export const isInt = (t) => t.k === "int";
export const isFloat = (t) => t.k === "float";
export const isArith = (t) => t.k === "int" || t.k === "float";
export const isPtr = (t) => t.k === "ptr";
export const isArr = (t) => t.k === "array";
export const isScalar = (t) => isArith(t) || isPtr(t);
export const is64 = (t) => t.k === "int" && t.bits === 64;
export const isVoid = (t) => t.k === "void";
export const isStruct = (t) => t.k === "struct";
export const isFunc = (t) => t.k === "func";
export const isFuncPtr = (t) => t.k === "ptr" && t.to.k === "func";
export const isCharLike = (t) => t.k === "int" && t.bits === 8;

/** 배열을 첫 원소 주소로 바꾼 타입 (배열 → 포인터). */
export const decay = (t) => (isArr(t) ? ptr(t.of) : t);

/** 이 타입이 차지하는 저장 칸 수 (칸 하나에 기본 값 하나). */
export function cells(t) {
  if (isArr(t)) return (t.len ?? 0) * cells(t.of);
  if (isStruct(t)) return t.cellCount;
  return 1;
}

export function alignOf(t) {
  if (isArr(t)) return alignOf(t.of);
  if (isStruct(t)) return t.align;
  return Math.max(1, t.size || 1);
}

/** 이 타입의 모든 칸을 0으로 채운 값 목록 (구조체는 칸마다 0의 종류가 달라요). */
export function zerosOf(t) {
  if (isStruct(t)) {
    if (!t.zeros) t.zeros = t.fields.flatMap((f) => (t.isUnion && f !== t.fields[0] ? [] : zerosOf(f.type)));
    return t.zeros;
  }
  if (isArr(t)) {
    const one = zerosOf(t.of);
    const out = new Array(one.length * (t.len ?? 0));
    for (let i = 0; i < out.length; i++) out[i] = one[i % one.length];
    return out;
  }
  return [zeroOf(t)];
}

/** 배열의 가장 안쪽 원소 타입. */
export function baseOf(t) {
  return isArr(t) ? baseOf(t.of) : t;
}

export function sameType(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  if (a.k === "struct") return false;
  if (a.k === "file") return true;
  if (a.k === "func") {
    return sameType(a.ret, b.ret) && a.params.length === b.params.length &&
      a.params.every((p, i) => sameType(p.type, b.params[i].type));
  }
  if (a.k === "int" || a.k === "float") return a.name === b.name;
  if (a.k === "ptr") return sameType(a.to, b.to);
  if (a.k === "array") return a.len === b.len && sameType(a.of, b.of);
  return a.k === "void";
}

export function typeName(t) {
  switch (t.k) {
    case "ptr":
      if (isArr(t.to)) return `${typeName(baseOf(t.to))} (*)[${t.to.len}]`;
      if (isFunc(t.to)) return `${typeName(t.to.ret)} (*)(${t.to.params.map((p) => typeName(p.type)).join(", ")})`;
      return `${typeName(t.to)} *`;
    case "array": {
      let dims = "";
      let x = t;
      while (isArr(x)) { dims += `[${x.len ?? ""}]`; x = x.of; }
      return `${typeName(x)} ${dims}`;
    }
    case "func": return `${typeName(t.ret)} (${t.params.map((p) => typeName(p.type)).join(", ")})`;
    case "struct": return t.alias || `${t.isUnion ? "union" : "struct"} ${t.tag || "(이름 없음)"}`;
    default: return t.name;
  }
}

/** 한국어로 타입을 쉽게 부르는 이름. */
export function friendlyType(t) {
  if (isInt(t)) return t.bits === 8 ? `글자(${t.name})` : `정수(${t.name})`;
  if (isFloat(t)) return `실수(${t.name})`;
  if (isFuncPtr(t)) return `함수 포인터(${typeName(t)})`;
  if (isPtr(t)) return isCharLike(t.to) ? "문자열(char *)" : `주소(${typeName(t)})`;
  if (isStruct(t)) return `구조체(${typeName(t)})`;
  if (isArr(t)) return `배열(${typeName(t)})`;
  return t.name;
}

/** 정수 승격: char, short 같은 작은 정수는 계산할 때 int가 돼요. */
export function promote(t) {
  return isInt(t) && t.rank < T.int.rank ? T.int : t;
}

/** 두 값을 계산할 때 맞추는 공통 타입 (C의 usual arithmetic conversions). */
export function common(a, b) {
  if (isFloat(a) || isFloat(b)) {
    if ((isFloat(a) && a.bits === 64) || (isFloat(b) && b.bits === 64)) return T.double;
    return T.float;
  }
  a = promote(a);
  b = promote(b);
  if (a === b) return a;
  if (a.unsigned === b.unsigned) return a.rank >= b.rank ? a : b;
  const [u, s] = a.unsigned ? [a, b] : [b, a];
  if (u.rank >= s.rank) return u;
  if (s.bits > u.bits) return s;
  return { ...s, unsigned: true, name: `unsigned ${s.name}` };
}

// ---------- 값 ----------
// 32비트 이하 정수와 실수는 JS 숫자, 64비트 정수는 BigInt, 포인터는 Ptr(또는 NULL이면 null)이에요.

/** 값을 다른 타입으로 바꿔요 (C의 형 변환 규칙). */
export function convert(v, from, to) {
  if (to.k === "int") {
    if (to.bits === 1) {
      if (from.k === "ptr") return v === null ? 0 : 1;
      return v == 0 ? 0 : 1; // eslint-disable-line eqeqeq
    }
    if (to.bits === 64) {
      let big;
      if (typeof v === "bigint") big = v;
      else if (from.k === "float") big = Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n;
      else big = BigInt(v);
      return to.unsigned ? BigInt.asUintN(64, big) : BigInt.asIntN(64, big);
    }
    let n;
    if (typeof v === "bigint") n = Number(BigInt.asIntN(32, v));
    else if (from.k === "float") {
      if (!Number.isFinite(v)) n = 0;
      else {
        const t = Math.trunc(v);
        n = Math.abs(t) < 2 ** 31 ? t : Number(BigInt.asIntN(32, BigInt(t)));
      }
    } else n = v;
    switch (to.bits) {
      case 32: return to.unsigned ? n >>> 0 : n | 0;
      case 16: return to.unsigned ? n & 0xffff : (n << 16) >> 16;
      default: return to.unsigned ? n & 0xff : (n << 24) >> 24;
    }
  }
  if (to.k === "float") {
    const n = typeof v === "bigint" ? Number(v) : v;
    return to.bits === 32 ? Math.fround(n) : n;
  }
  return v;
}

export function zeroOf(t) {
  if (is64(t)) return 0n;
  if (isPtr(t)) return null;
  return 0;
}

export function truthy(v) {
  return v !== null && v != 0; // eslint-disable-line eqeqeq
}

// ---------- 메모리 ----------
let storeIds = 0;

/** 변수 하나, 또는 배열 하나가 쓰는 저장 칸들. */
export class Store {
  constructor(size, name, type, fill) {
    this.id = ++storeIds;
    this.cells = new Array(size);
    if (fill !== undefined) this.cells.fill(fill);
    this.name = name; // 화면에 보여줄 이름 (변수 이름, "문자열 상수", "malloc 메모리")
    this.type = type; // 저장한 값 전체의 타입 (예: int [5])
    this.readonly = false;
    this.freed = false;
    this.heap = false;
  }
}

/** 함수를 가리키는 값 (C의 함수 포인터). */
export class FnRef {
  constructor(fi) { this.fi = fi; }
}

/** 메모리 위치를 가리키는 값 (C의 포인터). off는 칸 번호예요. */
export class Ptr {
  constructor(store, off) {
    this.store = store;
    this.off = off;
  }
}

// ---------- UTF-8 ----------
const encoder = new TextEncoder();
export const utf8 = (text) => Array.from(encoder.encode(text));
