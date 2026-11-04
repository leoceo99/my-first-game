// C 코드를 토큰(낱말)으로 나눠요. #include 와 #define 도 여기서 처리해요.

import { compileError, T, utf8 } from "./types.js";

export const HEADERS = new Set([
  "stdio.h", "stdlib.h", "string.h", "math.h", "ctype.h", "stdbool.h", "time.h", "limits.h", "stddef.h", "stdarg.h",
  "stdint.h", "inttypes.h", "assert.h", "float.h", "errno.h", "setjmp.h", "iso646.h",
]);

// C++에서 쓰는 C 헤더 이름 (<cstdio> = <stdio.h>)
export const CPP_C_HEADERS = {
  cstdio: "stdio.h", cstdlib: "stdlib.h", cstring: "string.h", cmath: "math.h", cctype: "ctype.h", ctime: "time.h",
  climits: "limits.h", cstddef: "stddef.h", cstdarg: "stdarg.h", cstdint: "stdint.h", cinttypes: "inttypes.h",
  cassert: "assert.h", cfloat: "float.h", cerrno: "errno.h", csetjmp: "setjmp.h", cstdbool: "stdbool.h",
};

// C++ 표준 라이브러리 헤더: C++ 도입 단계에서 하나씩 만들 예정이에요 (design/cpp-plan.md)
export const CPP_LIBRARY_HEADERS = new Set([
  "iostream", "string", "vector", "algorithm", "map", "set", "unordered_map", "unordered_set", "queue", "stack",
  "deque", "list", "utility", "sstream", "fstream", "iomanip", "memory", "functional", "numeric", "array", "tuple",
  "bits/stdc++.h",
]);

// 아직 준비 중인 C++ 낱말들과 그 단계
export const CPP_PENDING = {
  class: 3, public: 3, private: 3, protected: 3, this: 3, virtual: 6, friend: 3, operator: 4, explicit: 3, mutable: 3,
  new: 2, delete: 2, namespace: 2, using: 2, template: 5, typename: 5, try: 6, catch: 6, throw: 6,
  constexpr: 2, auto: 2, decltype: 5, static_cast: 2, const_cast: 2, reinterpret_cast: 2, dynamic_cast: 6,
};

const PUNCTUATORS = [
  "...", "<<=", ">>=", "->", "::", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
  "+=", "-=", "*=", "/=", "%=", "&=", "^=", "|=", "##",
  ";", ",", "{", "}", "(", ")", "[", "]", ".", "&", "*", "+", "-", "~", "!", "/", "%",
  "<", ">", "^", "|", "?", ":", "=", "#",
];

const LIMITS = {
  INT_MAX: "2147483647", INT_MIN: "(-2147483647-1)", UINT_MAX: "4294967295u",
  LONG_MAX: "9223372036854775807L", LONG_MIN: "(-9223372036854775807L-1)",
  LLONG_MAX: "9223372036854775807LL", LLONG_MIN: "(-9223372036854775807LL-1)",
  CHAR_MAX: "127", CHAR_MIN: "(-128)", SHRT_MAX: "32767", SHRT_MIN: "(-32768)", UCHAR_MAX: "255",
};

const IDENT_START = /[\p{L}_]/u;
const IDENT_CHAR = /[\p{L}\p{N}_]/u;
const NUMBER = /^(?:0[xX](?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+)[pP][+-]?\d+|0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/;

const SIMPLE_ESCAPES = { n: 10, t: 9, r: 13, 0: 0, "\\": 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, "?": 63 };

/** 이스케이프(\n 같은 것)를 읽어서 [바이트 값, 다음 위치]를 돌려줘요. */
function readEscape(src, i, line) {
  const c = src[i];
  if (c === "x") {
    let j = i + 1;
    while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
    if (j === i + 1) throw compileError(line, "\\x 뒤에 16진수 숫자가 필요해요");
    return [parseInt(src.slice(i + 1, j), 16) & 255, j];
  }
  if (/[0-7]/.test(c)) {
    let j = i;
    while (j < src.length && j < i + 3 && /[0-7]/.test(src[j])) j++;
    return [parseInt(src.slice(i, j), 8) & 255, j];
  }
  if (c in SIMPLE_ESCAPES) return [SIMPLE_ESCAPES[c], i + 1];
  throw compileError(line, `'\\${c}'는 모르는 이스케이프 문자예요`, "줄바꿈은 \\n, 탭은 \\t, 역슬래시는 \\\\ 로 써요.");
}

function numberToken(text, line, col) {
  const m = text.match(/[uUlLfF]*$/);
  const suffix = m[0].toLowerCase();
  const body = text.slice(0, text.length - m[0].length);
  const isHex = /^0[xX]/.test(body);
  if (isHex && /[pP]/.test(body)) {
    // 16진 실수: 0x1.8p3 = 1.5 × 2³
    const [, mant, exp] = body.match(/^0[xX]([0-9a-fA-F.]+)[pP]([+-]?\d+)$/);
    const [whole, frac = ""] = mant.split(".");
    let value = parseInt(whole || "0", 16);
    for (let k = 0; k < frac.length; k++) value += parseInt(frac[k], 16) / 16 ** (k + 1);
    value *= 2 ** Number(exp);
    const type = suffix.includes("f") ? T.float : T.double;
    return { k: "num", type, value: type === T.float ? Math.fround(value) : value, text, line, col };
  }
  const isFloat = !isHex && (/[.eE]/.test(body) || suffix.includes("f"));
  if (isFloat) {
    if (/[ul]/.test(suffix.replace("l", "")) && suffix !== "l") throw compileError(line, `'${text}'는 올바른 숫자가 아니에요`);
    const type = suffix.includes("f") ? T.float : T.double;
    return { k: "num", type, value: type === T.float ? Math.fround(parseFloat(body)) : parseFloat(body), text, line, col };
  }
  if (suffix.includes("f")) throw compileError(line, `'${text}'는 올바른 숫자가 아니에요`);
  let big;
  if (isHex) big = BigInt(body);
  else if (/^0[bB]/.test(body)) big = BigInt(body);
  else if (body.length > 1 && body[0] === "0") {
    if (/[89]/.test(body)) throw compileError(line, `'${text}'는 0으로 시작해서 8진수인데 8, 9가 들어 있어요`, "숫자 앞의 0을 지워 주세요.");
    big = BigInt("0o" + body.slice(1));
  } else big = BigInt(body);
  const unsigned = suffix.includes("u");
  const longs = (suffix.match(/l/g) || []).length;
  const decimal = !isHex && !/^0[bB0-7]/.test(body) || body === "0";
  let candidates;
  if (longs === 0) candidates = unsigned ? [T.uint, T.ulong] : decimal ? [T.int, T.long] : [T.int, T.uint, T.long, T.ulong];
  else candidates = unsigned ? [T.ulong] : decimal ? [T.long] : [T.long, T.ulong];
  if (longs === 2) candidates = candidates.map((t) => (t === T.long ? T.llong : t === T.ulong ? T.ullong : t));
  const type = candidates.find((t) => (t.unsigned ? big < 2n ** BigInt(t.bits) : big < 2n ** BigInt(t.bits - 1)));
  if (!type) throw compileError(line, `숫자 ${text}가 너무 커요`, "C의 정수는 최대 9223372036854775807까지 쓸 수 있어요.");
  return { k: "num", type, value: type.bits === 64 ? big : Number(big), text, line, col };
}

/** 소스 코드를 토큰 목록으로 바꿔요 (전처리 전). */
function rawTokens(src, inMacro = false) {
  const tokens = [];
  const directives = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;
  let space = true;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; lineStart = i; atLineStart = true; space = true; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { i++; space = true; continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw compileError(line, "/* 로 시작한 주석이 닫히지 않았어요", "주석 끝에 */ 를 붙여 주세요.");
      for (let j = i; j < end; j++) if (src[j] === "\n") { line++; lineStart = j + 1; }
      i = end + 2;
      continue;
    }
    if (c === "#" && atLineStart && !inMacro) {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      directives.push({ text: src.slice(i + 1, end).replace(/\/\/.*$/, "").trim(), line, at: tokens.length });
      i = end;
      continue;
    }
    atLineStart = false;
    const col = i - lineStart + 1;
    const ws = space; // 앞에 빈칸이 있었는지 (매크로 #으로 글자를 만들 때 필요해요)
    space = false;

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && ["u8", "L", "u", "U"].includes(word)) {
        if (src[j] === '"' && word !== "u8") {
          throw compileError(line, `넓은 문자열(${word}"...")은 아직 지원하지 않아요`, "보통 문자열 \"...\" 이나 u8\"...\" 를 써 주세요.");
        }
        i = j; // u8"..." 와 L'a' 는 보통 문자열·글자와 같아요
        space = ws;
        continue;
      }
      tokens.push({ k: "id", v: word, line, col, raw: word, ws });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const m = src.slice(i, i + 100).match(NUMBER);
      let j = i + m[0].length;
      if (j < n && IDENT_CHAR.test(src[j])) {
        while (j < n && IDENT_CHAR.test(src[j])) j++;
        throw compileError(line, `'${src.slice(i, j)}'는 올바른 숫자나 이름이 아니에요`, "변수 이름은 숫자로 시작할 수 없어요.");
      }
      tokens.push({ ...numberToken(m[0], line, col), raw: m[0], ws });
      i = j;
      continue;
    }
    if (c === '"') {
      const bytes = [];
      let j = i + 1;
      for (;;) {
        if (j >= n || src[j] === "\n") throw compileError(line, "큰따옴표(\")로 시작한 문자열이 닫히지 않았어요", "문자열 끝에 \" 를 붙여 주세요.");
        const ch = src[j];
        if (ch === '"') break;
        if (ch === "\\") {
          const [b, next] = readEscape(src, j + 1, line);
          bytes.push(b);
          j = next;
        } else {
          const cp = src.codePointAt(j);
          const s = String.fromCodePoint(cp);
          bytes.push(...utf8(s));
          j += s.length;
        }
      }
      tokens.push({ k: "str", bytes, line, col, raw: src.slice(i, j + 1), ws });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let value;
      if (src[j] === "\\") {
        [value, j] = readEscape(src, j + 1, line);
      } else if (src[j] === "'" ) {
        throw compileError(line, "작은따옴표 '' 안에 글자가 없어요", "한 글자를 넣어 주세요. 예: 'a'");
      } else {
        const cp = src.codePointAt(j);
        if (cp === undefined || src[j] === "\n") throw compileError(line, "작은따옴표(')로 시작한 글자가 닫히지 않았어요");
        if (cp > 127) {
          throw compileError(line, `'${String.fromCodePoint(cp)}'는 char 하나에 넣을 수 없어요`,
            "한글 같은 글자는 여러 바이트라서 char 한 칸에 안 들어가요. 큰따옴표 문자열(\"가\")로 써 주세요.");
        }
        value = cp;
        j += 1;
      }
      if (src[j] !== "'") {
        const lineEnd = src.indexOf("\n", j) < 0 ? n : src.indexOf("\n", j);
        if (src.slice(j, lineEnd).includes("'")) {
          throw compileError(line, "작은따옴표 안에는 글자 하나만 넣을 수 있어요", "여러 글자는 큰따옴표 문자열로 써요. 예: \"hello\"");
        }
        throw compileError(line, "작은따옴표(')로 시작한 글자가 닫히지 않았어요");
      }
      tokens.push({ k: "num", type: T.int, value: value > 127 ? value - 256 : value, text: src.slice(i, j + 1), line, col, isChar: true, raw: src.slice(i, j + 1), ws });
      i = j + 1;
      continue;
    }
    const p = PUNCTUATORS.find((op) => src.startsWith(op, i));
    if (p) {
      tokens.push({ k: "op", v: p, line, col, raw: p, ws });
      i += p.length;
      continue;
    }
    throw compileError(line, `'${c}'는 C에서 쓸 수 없는 글자예요`, c === "“" || c === "”" ? "둥근 따옴표 대신 \" 를 써요." : "");
  }
  return { tokens, directives, lastLine: line };
}

function parseDefine(text, line) {
  const m = text.match(/^define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/);
  if (!m) throw compileError(line, "#define 문장이 올바르지 않아요", "예: #define MAX 100");
  const [, name, , paramText, body] = m;
  const { tokens } = rawTokens(body, true);
  for (const t of tokens) t.line = line;
  let params = paramText === undefined ? null : paramText.split(",").map((s) => s.trim()).filter(Boolean);
  let variadic = false;
  if (params && params[params.length - 1] === "...") {
    variadic = true;
    params = params.slice(0, -1);
  }
  const isParam = (t) => t && t.k === "id" && params && (params.includes(t.v) || (variadic && t.v === "__VA_ARGS__"));
  tokens.forEach((t, i) => {
    if (t.v === "#" && t.k === "op" && params && !isParam(tokens[i + 1])) {
      throw compileError(line, "매크로의 # 뒤에는 매개변수 이름이 와야 해요", "예: #define SHOW(x) printf(#x \" = %d\\n\", x)");
    }
    if (t.v === "##" && (i === 0 || i === tokens.length - 1)) throw compileError(line, "## 는 매크로 내용의 처음이나 끝에 올 수 없어요");
  });
  return { name, params, variadic, body: tokens };
}

/** 매크로 #x: 값으로 받은 토큰들을 그대로 문자열로 만들어요 */
function stringify(tokens, line) {
  const text = tokens.map((t, i) => {
    // 글자 그대로 담아요 (문자열 안의 따옴표도 그대로 보여요)
    const raw = t.raw ?? t.v ?? t.text ?? "";
    return (i > 0 && t.ws ? " " : "") + raw;
  }).join("");
  return { k: "str", bytes: utf8(text), line, raw: JSON.stringify(text), ws: true };
}

/** 매크로 a ## b: 두 토큰을 이어 붙여 새 토큰 하나를 만들어요 */
function paste(a, b, line) {
  const text = (a ? a.raw ?? "" : "") + (b ? b.raw ?? "" : "");
  if (!text) return [];
  const { tokens } = rawTokens(text, true);
  if (tokens.length !== 1) throw compileError(line, `## 로 '${text}'를 만들었는데 올바른 낱말 하나가 아니에요`);
  return [{ ...tokens[0], line, ws: a ? a.ws : false }];
}

/** #if 의 조건(정수 식)을 계산해요. defined(이름), 매크로, 숫자, 계산 기호를 쓸 수 있어요. */
function evalCondition(text, line, macros) {
  const replaced = text.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (m, a, b) => (macros.has(a || b) ? "1" : "0"));
  let toks = rawTokens(replaced).tokens;
  // 매크로를 펼치고, 모르는 이름은 0으로 봐요 (C 규칙)
  for (let round = 0; round < 20 && toks.some((t) => t.k === "id"); round++) {
    toks = toks.flatMap((t) => {
      if (t.k !== "id") return [t];
      const m = macros.get(t.v);
      return m && !m.params ? m.body : [{ k: "num", value: 0 }];
    });
  }
  let i = 0;
  const peek = () => toks[i] || { k: "eof" };
  const isOp = (v) => peek().k === "op" && peek().v === v;
  const fail = () => compileError(line, "#if 의 조건을 이해할 수 없어요", "예: #if MAX > 10 또는 #if defined(DEBUG)");
  const PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  const unary = () => {
    const t = peek();
    if (t.k === "num") { i++; return Number(t.value); }
    if (isOp("(")) { i++; const v = ternary(); if (!isOp(")")) throw fail(); i++; return v; }
    if (isOp("!")) { i++; return unary() ? 0 : 1; }
    if (isOp("-")) { i++; return -unary(); }
    if (isOp("+")) { i++; return unary(); }
    if (isOp("~")) { i++; return ~unary(); }
    throw fail();
  };
  const binary = (min) => {
    let l = unary();
    for (;;) {
      const t = peek();
      const p = t.k === "op" ? PREC[t.v] : undefined;
      if (p === undefined || p < min) return l;
      i++;
      const r = binary(p + 1);
      switch (t.v) {
        case "||": l = l || r ? 1 : 0; break;
        case "&&": l = l && r ? 1 : 0; break;
        case "|": l |= r; break;
        case "^": l ^= r; break;
        case "&": l &= r; break;
        case "==": l = l === r ? 1 : 0; break;
        case "!=": l = l !== r ? 1 : 0; break;
        case "<": l = l < r ? 1 : 0; break;
        case ">": l = l > r ? 1 : 0; break;
        case "<=": l = l <= r ? 1 : 0; break;
        case ">=": l = l >= r ? 1 : 0; break;
        case "<<": l <<= r; break;
        case ">>": l >>= r; break;
        case "+": l += r; break;
        case "-": l -= r; break;
        case "*": l *= r; break;
        case "/": if (r === 0) throw compileError(line, "#if 조건에서 0으로 나눴어요"); l = Math.trunc(l / r); break;
        default: if (r === 0) throw compileError(line, "#if 조건에서 0으로 나눴어요"); l %= r;
      }
    }
  };
  const ternary = () => {
    const c = binary(1);
    if (!isOp("?")) return c;
    i++;
    const a = ternary();
    if (!isOp(":")) throw fail();
    i++;
    const b = ternary();
    return c ? a : b;
  };
  const v = ternary();
  if (i < toks.length) throw fail();
  return v;
}

/** C++ 모드: 아직 만들지 않은 C++ 기능은 단계와 함께 알려 줘요. */
function checkCppTokens(tokens) {
  for (const t of tokens) {
    if (t.k === "op" && t.v === "::") {
      throw compileError(t.line, "이름공간(std::)과 :: 는 C++ 2단계에서 지원해요", "지금 C++ 모드에서는 C 방식의 코드를 쓸 수 있어요.");
    }
    if (t.k === "id" && Object.hasOwn(CPP_PENDING, t.v)) {
      throw compileError(t.line, `C++의 '${t.v}'는 아직 준비 중이에요 (C++ ${CPP_PENDING[t.v]}단계)`,
        "지금 C++ 모드에서는 C 방식의 코드에 bool, nullptr, 구조체 이름을 타입으로 쓰기를 더해서 쓸 수 있어요.");
    }
  }
}

/** 소스 코드를 전처리하고 토큰 목록을 만들어요. */
export function tokenize(src, { dialect = "c" } = {}) {
  const cpp = dialect === "cpp";
  const { tokens, directives, lastLine } = rawTokens(src);
  const includes = new Set();
  if (cpp) includes.add("stdbool.h"); // C++에서는 bool, true, false가 기본이에요
  const cppMacro = cpp ? [["__cplusplus", "201703L"]] : [];
  const macros = new Map();
  for (const [name, value] of Object.entries(LIMITS)) {
    const { tokens: body } = rawTokens(value);
    macros.set(name, { name, params: null, body, header: "limits.h" });
  }
  for (const name of ["RAND_MAX", "EXIT_SUCCESS", "EXIT_FAILURE"]) {
    const value = { RAND_MAX: "2147483647", EXIT_SUCCESS: "0", EXIT_FAILURE: "1" }[name];
    macros.set(name, { name, params: null, body: rawTokens(value).tokens, header: "stdlib.h" });
  }
  macros.set("M_PI", { name: "M_PI", params: null, body: rawTokens("3.14159265358979323846").tokens, header: "math.h" });
  macros.set("EOF", { name: "EOF", params: null, body: rawTokens("(-1)").tokens, header: "stdio.h" });
  for (const [name, value] of cppMacro) macros.set(name, { name, params: null, body: rawTokens(value).tokens });
  const predefine = (header, table) => {
    for (const [name, value] of Object.entries(table)) {
      macros.set(name, { name, params: null, body: rawTokens(value, true).tokens, header });
    }
  };
  predefine("stdio.h", { SEEK_SET: "0", SEEK_CUR: "1", SEEK_END: "2", BUFSIZ: "8192" });
  predefine("math.h", { INFINITY: "(1.0/0.0)", NAN: "(0.0/0.0)", HUGE_VAL: "(1.0/0.0)", M_E: "2.71828182845904523536", M_SQRT2: "1.41421356237309504880" });
  predefine("float.h", {
    FLT_MAX: "3.40282347e+38F", FLT_MIN: "1.17549435e-38F", FLT_EPSILON: "1.19209290e-7F", FLT_DIG: "6", FLT_MANT_DIG: "24",
    DBL_MAX: "1.7976931348623157e+308", DBL_MIN: "2.2250738585072014e-308", DBL_EPSILON: "2.2204460492503131e-16",
    DBL_DIG: "15", DBL_MANT_DIG: "53",
  });
  predefine("stdint.h", {
    INT8_MIN: "(-128)", INT8_MAX: "127", UINT8_MAX: "255", INT16_MIN: "(-32768)", INT16_MAX: "32767", UINT16_MAX: "65535",
    INT32_MIN: "(-2147483647-1)", INT32_MAX: "2147483647", UINT32_MAX: "4294967295u",
    INT64_MIN: "(-9223372036854775807LL-1)", INT64_MAX: "9223372036854775807LL", UINT64_MAX: "18446744073709551615ULL",
    SIZE_MAX: "18446744073709551615UL",
  });
  const pri = {};
  for (const [c, l] of [["d", ""], ["i", ""], ["u", ""], ["x", ""], ["X", ""], ["o", ""]]) {
    for (const bits of [8, 16, 32]) pri[`PRI${c}${bits}`] = `"${l}${c}"`;
    pri[`PRI${c}64`] = `"ll${c}"`;
    pri[`SCN${c}32`] = `"${c}"`;
    pri[`SCN${c}64`] = `"ll${c}"`;
  }
  predefine("inttypes.h", pri);
  predefine("errno.h", { EDOM: "33", ERANGE: "34", EINVAL: "22", ENOENT: "2" });
  predefine("iso646.h", { and: "&&", or: "||", not: "!", not_eq: "!=", and_eq: "&=", or_eq: "|=", bitand: "&", bitor: "|", xor: "^", compl: "~" });

  // 지시문이 적용되는 위치(토큰 번호)에 따라 정의가 바뀌므로, 지시문과 토큰을 순서대로 처리해요.
  const out = [];
  let d = 0;
  // #if / #ifdef 의 상태: 지금 읽는 줄을 쓸지(active), 이미 참인 갈래가 있었는지(taken)
  const conds = [];
  const isActive = () => conds.every((c) => c.active);
  const applyDirective = (dir) => {
    const { text, line } = dir;
    const word = text.split(/\s+/)[0];
    const arg = text.slice(word.length).trim();
    if (word === "ifdef" || word === "ifndef" || word === "if") {
      const outer = isActive();
      let truth = false;
      if (outer) {
        if (word === "if") truth = Boolean(evalCondition(arg, line, macros));
        else {
          if (!/^\w+$/.test(arg)) throw compileError(line, `#${word} 뒤에는 이름 하나가 와야 해요`);
          truth = macros.has(arg) === (word === "ifdef");
        }
      }
      conds.push({ active: outer && truth, taken: !outer || truth, line, sawElse: false });
      return;
    }
    if (word === "elif" || word === "else" || word === "endif") {
      const c = conds[conds.length - 1];
      if (!c) throw compileError(line, `#${word} 앞에 짝이 되는 #if가 없어요`);
      if (word === "endif") { conds.pop(); return; }
      if (c.sawElse) throw compileError(line, `#else 뒤에 #${word}가 또 나왔어요`);
      if (word === "else") {
        c.sawElse = true;
        c.active = !c.taken;
        c.taken = true;
      } else {
        const outer = conds.slice(0, -1).every((x) => x.active);
        const truth = !c.taken && outer && Boolean(evalCondition(arg, line, macros));
        c.active = truth;
        c.taken = c.taken || truth;
      }
      return;
    }
    if (!isActive()) return;
    if (word === "error") throw compileError(line, `#error: ${arg}`);
    if (word === "include") {
      const m = text.match(/^include\s*[<"]([^>"]+)[>"]$/);
      if (!m) throw compileError(line, "#include 문장이 올바르지 않아요", "예: #include <stdio.h>");
      if (cpp && CPP_LIBRARY_HEADERS.has(m[1])) {
        throw compileError(line, `C++ 표준 라이브러리 <${m[1]}>는 다음 단계에서 지원해요`,
          "지금 C++ 모드에서는 C 방식(printf, scanf, <cstdio>, <cstring>, <cmath> 등)으로 쓸 수 있어요.");
      }
      if (cpp && CPP_C_HEADERS[m[1]]) m[1] = CPP_C_HEADERS[m[1]];
      if (!HEADERS.has(m[1])) {
        throw compileError(line, `<${m[1]}> 헤더는 아직 지원하지 않아요`,
          `쓸 수 있는 헤더: ${[...HEADERS].map((h) => `<${h}>`).join(", ")}`);
      }
      includes.add(m[1]);
      if (m[1] === "inttypes.h") includes.add("stdint.h");
      if (m[1] === "assert.h") {
        // assert(조건): NDEBUG가 정해져 있으면 아무 일도 하지 않아요
        const body = macros.has("NDEBUG") ? "((void)0)" : "__assert_check((e), #e, __LINE__)";
        macros.set("assert", { name: "assert", params: ["e"], body: rawTokens(body, true).tokens.map((t) => ({ ...t, line })) });
        macros.set("static_assert", { name: "static_assert", params: null, body: rawTokens("_Static_assert", true).tokens });
      }
    } else if (word === "define") {
      const macro = parseDefine(text, line);
      macros.set(macro.name, macro);
    } else if (word === "undef") {
      macros.delete(text.split(/\s+/)[1]);
    } else if (word === "pragma" || word === "") {
      // 무시해요
    } else {
      throw compileError(line, `#${word}는 아직 지원하지 않아요`, "#include, #define, #undef, #if, #ifdef, #ifndef, #else, #endif 를 쓸 수 있어요.");
    }
  };

  const expand = (list, start, outList, hidden) => {
    let i = start;
    const tok = list[i];
    const macro = tok.k === "id" && !hidden.has(tok.v) ? macros.get(tok.v) : null;
    if (!macro) {
      if (tok.k === "id" && tok.v === "__LINE__") outList.push({ k: "num", type: T.int, value: tok.line, text: String(tok.line), raw: String(tok.line), line: tok.line, col: tok.col });
      else if (tok.k === "id" && tok.v === "__FILE__") outList.push({ k: "str", bytes: utf8("main.c"), raw: '"main.c"', line: tok.line, col: tok.col });
      else outList.push(tok);
      return i + 1;
    }
    if (macro.header && !includes.has(macro.header) && !/^[A-Z_][A-Z0-9_]*$/.test(macro.name)) {
      outList.push(tok); // 소문자 이름(and, or 등)은 헤더가 없으면 그냥 이름이에요
      return i + 1;
    }
    if (macro.header && !includes.has(macro.header)) {
      throw compileError(tok.line, `${tok.v}를 쓰려면 #include <${macro.header}>가 필요해요`, `맨 위에 #include <${macro.header}> 를 넣어 주세요.`);
    }
    let body = macro.body;
    if (macro.params) {
      if (!list[i + 1] || list[i + 1].v !== "(") {
        outList.push(tok);
        return i + 1;
      }
      const args = [[]];
      let depth = 0;
      let j = i + 2;
      for (; j < list.length; j++) {
        const t = list[j];
        if (t.v === "(") depth++;
        if (t.v === ")") {
          if (depth === 0) break;
          depth--;
        }
        if (t.v === "," && depth === 0) args.push([]);
        else args[args.length - 1].push(t);
      }
      if (j >= list.length) throw compileError(tok.line, `매크로 ${tok.v}의 괄호가 닫히지 않았어요`);
      let given = args.length === 1 && args[0].length === 0 ? [] : args;
      const named = macro.params.length;
      if (macro.variadic) {
        if (given.length < named) {
          throw compileError(tok.line, `매크로 ${tok.v}에는 값이 적어도 ${named}개 필요한데 ${given.length}개를 넣었어요`);
        }
        const rest = given.slice(named);
        const va = [];
        rest.forEach((a, k) => { if (k) va.push({ k: "op", v: ",", raw: ",", line: tok.line }); va.push(...a); });
        given = [...given.slice(0, named), va];
      } else if (given.length !== named) {
        throw compileError(tok.line, `매크로 ${tok.v}에는 값 ${named}개가 필요한데 ${given.length}개를 넣었어요`);
      }
      const argOf = (t) => {
        if (!t || t.k !== "id") return null;
        if (macro.variadic && t.v === "__VA_ARGS__") return given[named];
        const p = macro.params.indexOf(t.v);
        return p >= 0 ? given[p] : null;
      };
      // 1) #x 는 문자열로, x 는 받은 값으로 바꿔요. ## 옆의 값은 붙일 수 있게 표시해 둬요.
      const parts = [];
      const src = macro.body;
      for (let k = 0; k < src.length; k++) {
        const t = src[k];
        if (t.k === "op" && t.v === "#" && argOf(src[k + 1])) {
          parts.push([stringify(argOf(src[k + 1]), tok.line)]);
          k++;
        } else if (t.k === "op" && t.v === "##") {
          parts.push("##");
        } else {
          const a = argOf(t);
          parts.push(a ? a.map((x, n) => (n === 0 ? { ...x, ws: t.ws } : x)) : [t]);
        }
      }
      // 2) a ## b 를 이어 붙여요. 빈 __VA_ARGS__ 앞의 , ## 는 쉼표를 지워요 (GNU 방식).
      body = [];
      for (let k = 0; k < parts.length; k++) {
        if (parts[k] !== "##") { body.push(...parts[k]); continue; }
        const right = parts[k + 1] || [];
        k++;
        const left = body.pop();
        if (left && left.v === "," && right.length === 0) continue;
        if (left && left.v === "," ) { body.push(left, ...right); continue; }
        body.push(...paste(left, right[0], tok.line), ...right.slice(1));
      }
      i = j + 1;
    } else {
      i += 1;
    }
    const inner = new Set(hidden).add(macro.name);
    const located = body.map((t) => ({ ...t, line: tok.line, col: tok.col }));
    for (let k = 0; k < located.length;) k = expand(located, k, outList, inner);
    return i;
  };

  for (let i = 0; i < tokens.length;) {
    while (d < directives.length && directives[d].at <= i) applyDirective(directives[d++]);
    if (!isActive()) { i++; continue; }
    i = expand(tokens, i, out, new Set());
  }
  while (d < directives.length) applyDirective(directives[d++]);
  if (conds.length) {
    throw compileError(conds[conds.length - 1].line, "#if 가 #endif 로 닫히지 않았어요", "끝에 #endif 를 넣어 주세요.");
  }
  out.push({ k: "eof", v: "<끝>", line: lastLine, col: 1 });
  if (cpp) checkCppTokens(out);
  return { tokens: out, includes };
}
