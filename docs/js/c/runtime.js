// C 프로그램이 실행될 때 필요한 것들: 입출력, 메모리 검사, 표준 라이브러리 함수.

import {
  T, Ptr, Store, ptr, runtimeError, convert, isInt, isFloat, isPtr, isArr, isCharLike, is64,
  typeName, utf8, baseOf, cells, zeroOf,
} from "./types.js";

/** 입력이 더 필요해서 실행을 멈출 때 던지는 신호. */
export const NEED_INPUT = { needInput: true };

/** exit()를 부르거나 main이 끝날 때 쓰는 신호. */
export class ExitSignal {
  constructor(code) { this.code = code; }
}

const decoderFor = () => new TextDecoder("utf-8");

export class Runtime {
  constructor({ answers = [], startTime = Math.floor(Date.now() / 1000), onOutput = () => {} } = {}) {
    const all = answers.map((a) => `${a}\n`).join("");
    const before = answers.slice(0, -1).map((a) => `${a}\n`).join("");
    this.input = utf8(all);
    this.muteUntil = utf8(before).length;
    // 이미 답한 입력이 있으면, 그 답을 다 읽을 때까지의 출력은 앞에서 이미 보여줬어요.
    this.muted = answers.length > 0;
    this.pos = 0;
    this.pending = [];
    this.decoder = decoderFor();
    this.lastFlush = Date.now();
    this.onOutput = onOutput;
    this.startTime = startTime;
    this.started = Date.now();
    this.line = 0;
    this.depth = 0;
    this.stack = [];
    this.randState = 1;
    this.scanFail = { pos: -1, count: 0 };
    this.ret = undefined;
  }

  // ---------- 출력 ----------
  write(bytes) {
    if (this.muted) return;
    for (let i = 0; i < bytes.length; i++) this.pending.push(bytes[i]);
    if (this.pending.length > 4096 || Date.now() - this.lastFlush > 50) this.flushLines();
  }

  flushLines(all = false) {
    this.lastFlush = Date.now();
    let end = all ? this.pending.length : this.pending.lastIndexOf(10) + 1;
    if (end === 0 && this.pending.length > 2000) end = this.pending.length;
    if (end === 0) return;
    const text = this.decoder.decode(Uint8Array.from(this.pending.slice(0, end)), { stream: true });
    this.pending = this.pending.slice(end);
    if (text) this.onOutput(text);
  }

  /** 입력을 기다리기 직전: 완성된 줄은 출력으로, 마지막 미완성 줄은 질문으로 돌려줘요. */
  takePrompt() {
    this.flushLines();
    const text = this.decoder.decode(Uint8Array.from(this.pending));
    this.pending = [];
    this.decoder = decoderFor();
    return text;
  }

  finish() {
    this.flushLines(true);
    const rest = this.decoder.decode();
    if (rest) this.onOutput(rest);
  }

  // ---------- 입력 ----------
  peekByte() {
    if (this.pos >= this.muteUntil && this.muted) this.muted = false;
    if (this.pos >= this.input.length) throw NEED_INPUT;
    return this.input[this.pos];
  }

  readByte() {
    const b = this.peekByte();
    this.pos++;
    return b;
  }

  // ---------- 메모리 ----------
  describe(p) {
    const st = p.store;
    if (!isArr(st.type)) return st.name;
    const dims = [];
    let t = st.type;
    while (isArr(t)) { dims.push(t.len); t = t.of; }
    let rest = p.off;
    const idx = [];
    for (let i = 0; i < dims.length; i++) {
      const stride = dims.slice(i + 1).reduce((a, b) => a * b, 1);
      idx.push(Math.floor(rest / stride));
      rest %= stride;
    }
    return `${st.name}${idx.map((n) => `[${n}]`).join("")}`;
  }

  check(p, line, writing) {
    if (p === null) {
      throw runtimeError(line, writing ? "NULL 포인터가 가리키는 곳에 값을 넣으려고 했어요" : "NULL 포인터가 가리키는 곳을 읽으려고 했어요",
        "포인터가 아직 아무것도 가리키지 않아요. 주소를 먼저 넣어 주세요.");
    }
    const st = p.store;
    if (st.freed) throw runtimeError(line, "free()로 돌려준 메모리를 사용했어요", "free한 뒤에는 그 포인터를 쓰면 안 돼요.");
    if (st.untyped) throw runtimeError(line, "malloc으로 받은 메모리를 타입 없이 사용했어요", "예: int *p = (int *)malloc(n * sizeof(int));");
    if (p.off < 0 || p.off >= st.cells.length) {
      if (isArr(st.type) || st.heap) {
        const size = st.heap ? st.cells.length : st.type.len;
        const unit = st.heap ? 1 : cells(st.type.of);
        const index = Math.floor(p.off / unit);
        throw runtimeError(line, `배열 '${st.name}'의 범위를 벗어났어요`,
          `${st.name}에는 [0]부터 [${size - 1}]까지 ${size}칸이 있는데 [${index}]에 접근했어요.`);
      }
      throw runtimeError(line, `'${st.name}'의 범위 밖을 가리키는 포인터를 사용했어요`, "포인터 계산이 맞는지 확인해 보세요.");
    }
    if (writing && st.readonly) {
      throw runtimeError(line, "문자열 상수는 바꿀 수 없어요", "바꿀 수 있는 글자를 만들려면 char s[] = \"...\"; 처럼 배열로 선언해요.");
    }
  }

  load(p, line) {
    this.check(p, line, false);
    const v = p.store.cells[p.off];
    if (v === undefined) {
      throw runtimeError(line, `값을 넣지 않은 '${this.describe(p)}'를 사용했어요`,
        "C에서는 변수를 만들기만 하면 쓰레기 값이 들어 있어요. 먼저 값을 넣어 주세요. 예: int x = 0;");
    }
    return v;
  }

  storeAt(p, v, line) {
    this.check(p, line, true);
    p.store.cells[p.off] = v;
  }

  readCString(p, line) {
    this.check(p, line, false);
    const bytes = [];
    const q = new Ptr(p.store, p.off);
    for (;;) {
      if (q.off >= q.store.cells.length) {
        throw runtimeError(line, `'${q.store.name}'의 문자열 끝(\\0)을 찾지 못했어요`,
          "문자열은 마지막에 '\\0'이 있어야 해요. 배열 크기가 충분한지 확인해 보세요.");
      }
      const b = this.load(q, line);
      if (b === 0) return bytes;
      bytes.push(b & 255);
      q.off++;
    }
  }

  writeCString(p, bytes, line) {
    this.check(p, line, true);
    const room = p.store.cells.length - p.off;
    if (bytes.length + 1 > room) {
      throw runtimeError(line, `'${p.store.name}'에 넣을 글자가 너무 길어요`,
        `남은 칸은 ${room}칸인데 끝의 \\0까지 ${bytes.length + 1}칸이 필요해요. 배열을 더 크게 만들어 주세요.`);
    }
    for (let i = 0; i < bytes.length; i++) p.store.cells[p.off + i] = convert(bytes[i], T.int, T.char);
    p.store.cells[p.off + bytes.length] = 0;
  }

  /** 화면의 변수 탭에 보여줄 값 */
  formatValue(type, store, off = 0) {
    if (isArr(type)) {
      if (isCharLike(type.of)) {
        const bytes = [];
        for (let i = 0; i < type.len; i++) {
          const v = store.cells[off + i];
          if (v === undefined || v === 0) break;
          bytes.push(v & 255);
        }
        if (bytes.length === 0 && store.cells[off] === undefined) return "(값 없음)";
        return JSON.stringify(new TextDecoder().decode(Uint8Array.from(bytes)));
      }
      const parts = [];
      const step = cells(type.of);
      const shown = Math.min(type.len, 20);
      for (let i = 0; i < shown; i++) parts.push(this.formatValue(type.of, store, off + i * step));
      return `{${parts.join(", ")}${type.len > shown ? ", …" : ""}}`;
    }
    const v = store.cells[off];
    if (v === undefined) return "?";
    if (isPtr(type)) return v === null ? "NULL" : `→ ${v.store.readonly ? "문자열 상수" : this.describe(v)}`;
    if (isFloat(type)) return Number.isInteger(v) ? `${v}.0` : String(v);
    if (isCharLike(type) && v >= 32 && v < 127) return `${v} ('${String.fromCharCode(v)}')`;
    return String(v);
  }

  rand() {
    this.randState = (Math.imul(this.randState, 1103515245) + 12345) & 0x7fffffff;
    return this.randState;
  }
}

// ---------- printf 형식 ----------
const CONVERSIONS = "diuoxXcsfFeEgGp%n";

/** 형식 문자열(바이트)을 조각으로 나눠요. */
export function parseFormat(bytes) {
  const parts = [];
  let lit = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 37) { lit.push(bytes[i]); continue; }
    if (lit.length) { parts.push({ lit }); lit = []; }
    let j = i + 1;
    const spec = { flags: "", width: null, prec: null, len: "", conv: "" };
    while (j < bytes.length && "-+ #0".includes(String.fromCharCode(bytes[j]))) spec.flags += String.fromCharCode(bytes[j++]);
    if (bytes[j] === 42) { spec.width = "*"; j++; } else {
      let w = "";
      while (bytes[j] >= 48 && bytes[j] <= 57) w += String.fromCharCode(bytes[j++]);
      if (w) spec.width = Number(w);
    }
    if (bytes[j] === 46) {
      j++;
      if (bytes[j] === 42) { spec.prec = "*"; j++; } else {
        let p = "";
        while (bytes[j] >= 48 && bytes[j] <= 57) p += String.fromCharCode(bytes[j++]);
        spec.prec = Number(p || 0);
      }
    }
    for (const l of ["hh", "ll", "h", "l", "L", "z", "j", "t"]) {
      if (String.fromCharCode(...bytes.slice(j, j + l.length)) === l) { spec.len = l; j += l.length; break; }
    }
    spec.conv = j < bytes.length ? String.fromCharCode(bytes[j]) : "";
    spec.ok = spec.conv !== "" && CONVERSIONS.includes(spec.conv);
    parts.push({ spec });
    i = j;
  }
  if (lit.length) parts.push({ lit });
  return parts;
}

function pad(body, spec, numeric) {
  const width = typeof spec.width === "number" ? spec.width : 0;
  if (body.length >= width) return body;
  if (spec.flags.includes("-")) return body + " ".repeat(width - body.length);
  if (numeric && spec.flags.includes("0")) {
    const m = body.match(/^([+\- ]?(?:0[xX])?)(.*)$/);
    return m[1] + "0".repeat(width - body.length) + m[2];
  }
  return " ".repeat(width - body.length) + body;
}

function signed(text, negative, spec) {
  if (negative) return `-${text}`;
  if (spec.flags.includes("+")) return `+${text}`;
  if (spec.flags.includes(" ")) return ` ${text}`;
  return text;
}

function fixExponent(s) {
  return s.replace(/e([+-])(\d)$/, "e$10$2");
}

export function formatFloat(x, conv, prec, alt = false) {
  const upper = conv === conv.toUpperCase();
  const negative = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let text;
  if (!Number.isFinite(x)) text = Number.isNaN(x) ? "nan" : "inf";
  else if (conv === "f" || conv === "F") {
    text = ax < 1e21 ? ax.toFixed(prec) : BigInt(ax).toString() + (prec > 0 ? `.${"0".repeat(prec)}` : "");
    if (alt && prec === 0) text += ".";
  } else if (conv === "e" || conv === "E") {
    text = fixExponent(ax.toExponential(Math.min(prec, 100)));
  } else {
    const P = prec === 0 ? 1 : prec;
    const exp = ax === 0 ? 0 : Number(ax.toExponential(P - 1).split("e")[1]);
    if (P > exp && exp >= -4) text = ax.toFixed(P - 1 - exp);
    else text = fixExponent(ax.toExponential(P - 1));
    if (!alt) {
      const [mant, e] = text.split("e");
      const trimmed = mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant;
      text = e === undefined ? trimmed : `${trimmed}e${e}`;
    }
  }
  if (upper) text = text.toUpperCase();
  return { text, negative: negative && !Number.isNaN(x) };
}

function intText(v, spec, conv) {
  const wide = spec.len === "l" || spec.len === "ll" || spec.len === "z" || spec.len === "j" || spec.len === "t";
  let big = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
  if (conv === "d" || conv === "i") {
    if (!wide) big = BigInt.asIntN(spec.len === "hh" ? 8 : spec.len === "h" ? 16 : 32, big);
    else big = BigInt.asIntN(64, big);
    const negative = big < 0n;
    let digits = (negative ? -big : big).toString();
    if (typeof spec.prec === "number") digits = digits.padStart(spec.prec, "0");
    if (spec.prec === 0 && big === 0n) digits = "";
    return pad(signed(digits, negative, spec), spec, spec.prec === null);
  }
  const bits = wide ? 64 : spec.len === "hh" ? 8 : spec.len === "h" ? 16 : 32;
  big = BigInt.asUintN(bits, big);
  const base = conv === "o" ? 8 : conv === "u" ? 10 : 16;
  let digits = big.toString(base);
  if (conv === "X") digits = digits.toUpperCase();
  if (typeof spec.prec === "number") digits = digits.padStart(spec.prec, "0");
  if (spec.flags.includes("#") && big !== 0n) {
    if (conv === "o" && !digits.startsWith("0")) digits = `0${digits}`;
    if (conv === "x") digits = `0x${digits}`;
    if (conv === "X") digits = `0X${digits}`;
  }
  return pad(digits, spec, spec.prec === null);
}

export function fakeAddress(p) {
  if (p === null) return "(nil)";
  return `0x${(0x7ffd0000 + p.store.id * 0x400 + p.off * 4).toString(16)}`;
}

/** printf: 값들을 형식에 맞춰 바이트로 만들어요. */
export function formatPrintf(rt, fmtBytes, values, line) {
  const out = [];
  let k = 0;
  const nextArg = () => {
    if (k >= values.length) {
      throw runtimeError(line, "printf에 넣은 값이 형식(%)보다 적어요", "% 개수만큼 값을 넣어 주세요.");
    }
    return values[k++];
  };
  for (const part of parseFormat(fmtBytes)) {
    if (part.lit) { out.push(...part.lit); continue; }
    const spec = { ...part.spec };
    if (!spec.ok) throw runtimeError(line, `printf 형식 '%${spec.conv}'를 알 수 없어요`);
    if (spec.width === "*") {
      const w = Number(nextArg());
      spec.width = Math.abs(w);
      if (w < 0) spec.flags += "-";
    }
    if (spec.prec === "*") {
      const p = Number(nextArg());
      spec.prec = p < 0 ? null : p;
    }
    const c = spec.conv;
    if (c === "%") { out.push(37); continue; }
    const v = nextArg();
    let text;
    switch (c) {
      case "d": case "i": case "u": case "o": case "x": case "X":
        text = intText(v, spec, c);
        break;
      case "c": {
        const byte = Number(BigInt.asUintN(8, BigInt(v)));
        const fill = Array(Math.max(0, (typeof spec.width === "number" ? spec.width : 0) - 1)).fill(32);
        if (spec.flags.includes("-")) out.push(byte, ...fill);
        else out.push(...fill, byte);
        continue;
      }
      case "s": {
        let bytes = v === null ? utf8("(null)") : rt.readCString(v, line);
        if (typeof spec.prec === "number") bytes = bytes.slice(0, spec.prec);
        const width = typeof spec.width === "number" ? spec.width : 0;
        const fill = Array(Math.max(0, width - bytes.length)).fill(32);
        if (spec.flags.includes("-")) out.push(...bytes, ...fill);
        else out.push(...fill, ...bytes);
        continue;
      }
      case "p":
        text = pad(fakeAddress(v), spec, false);
        break;
      case "n":
        throw runtimeError(line, "printf의 %n은 지원하지 않아요");
      default: {
        const x = typeof v === "bigint" ? Number(v) : v;
        const { text: t, negative } = formatFloat(x, c, spec.prec === null ? 6 : spec.prec, spec.flags.includes("#"));
        text = pad(signed(t, negative, spec), spec, Number.isFinite(x));
      }
    }
    out.push(...utf8(text));
  }
  return out;
}

// ---------- scanf ----------
const isSpace = (b) => b === 32 || (b >= 9 && b <= 13);

function scanToken(rt, conv, width) {
  const max = width ?? Infinity;
  const bytes = [];
  const take = () => { bytes.push(rt.readByte()); };
  const peekIs = (re) => bytes.length < max && re.test(String.fromCharCode(rt.peekByte()));
  if (peekIs(/[+-]/)) take();
  if ("dui".includes(conv) && conv !== "i") {
    while (peekIs(/[0-9]/)) take();
  } else if (conv === "i" || "xXo".includes(conv)) {
    let digits = /[0-9]/;
    if (conv === "o") digits = /[0-7]/;
    if (conv === "x" || conv === "X" || conv === "i") {
      if (peekIs(/0/)) {
        take();
        if (peekIs(/[xX]/)) { take(); digits = /[0-9a-fA-F]/; } else if (conv === "i") digits = /[0-7]/;
        else digits = /[0-9a-fA-F]/;
      } else if (conv !== "i") digits = /[0-9a-fA-F]/;
    }
    while (peekIs(digits)) take();
  } else {
    while (peekIs(/[0-9]/)) take();
    if (peekIs(/\./)) { take(); while (peekIs(/[0-9]/)) take(); }
    if (bytes.some((b) => b >= 48 && b <= 57) && peekIs(/[eE]/)) {
      take();
      if (peekIs(/[+-]/)) take();
      while (peekIs(/[0-9]/)) take();
    }
  }
  const text = String.fromCharCode(...bytes);
  if (!/[0-9]/.test(text)) return null;
  return text;
}

function parseIntToken(text, conv) {
  let s = text;
  let negative = false;
  if (s[0] === "+" || s[0] === "-") { negative = s[0] === "-"; s = s.slice(1); }
  let big;
  if (conv === "x" || conv === "X") big = BigInt(`0x${s.replace(/^0[xX]/, "") || "0"}`);
  else if (conv === "o") big = BigInt(`0o${s || "0"}`);
  else if (conv === "i" && /^0[xX]/.test(s)) big = BigInt(s);
  else if (conv === "i" && /^0[0-7]/.test(s)) big = BigInt(`0o${s.slice(1)}`);
  else big = BigInt(s.replace(/\D.*$/, "") || "0");
  return negative ? -big : big;
}

/** scanf: 입력에서 값을 읽어 포인터들이 가리키는 곳에 넣고, 읽은 개수를 돌려줘요. */
export function doScanf(rt, fmtBytes, targets, types, line) {
  let count = 0;
  let k = 0;
  const startPos = rt.pos;
  let failed = false;
  outer: for (let i = 0; i < fmtBytes.length; i++) {
    const f = fmtBytes[i];
    if (isSpace(f)) {
      while (isSpace(rt.peekByte())) rt.readByte();
      continue;
    }
    if (f !== 37 || fmtBytes[i + 1] === 37) {
      if (f === 37) i++;
      while (f === 37 && isSpace(rt.peekByte())) rt.readByte();
      if (rt.peekByte() !== f) { failed = true; break; }
      rt.readByte();
      continue;
    }
    let j = i + 1;
    const suppress = fmtBytes[j] === 42;
    if (suppress) j++;
    let w = "";
    while (fmtBytes[j] >= 48 && fmtBytes[j] <= 57) w += String.fromCharCode(fmtBytes[j++]);
    const width = w ? Number(w) : null;
    for (const l of ["hh", "ll", "h", "l", "L", "z", "j", "t"]) {
      if (String.fromCharCode(...fmtBytes.slice(j, j + l.length)) === l) { j += l.length; break; }
    }
    const conv = String.fromCharCode(fmtBytes[j]);
    let set = null;
    if (conv === "[") {
      let e = j + 1;
      if (fmtBytes[e] === 94) e++;
      if (fmtBytes[e] === 93) e++;
      while (e < fmtBytes.length && fmtBytes[e] !== 93) e++;
      const body = fmtBytes.slice(j + 1, e);
      const negate = body[0] === 94;
      const members = new Set();
      const list = negate ? body.slice(1) : body;
      for (let m = 0; m < list.length; m++) {
        if (list[m + 1] === 45 && m + 2 < list.length) {
          for (let x = list[m]; x <= list[m + 2]; x++) members.add(x);
          m += 2;
        } else members.add(list[m]);
      }
      set = { negate, members };
      j = e;
    }
    i = j;
    if (conv !== "c" && conv !== "[" && conv !== "n") {
      while (isSpace(rt.peekByte())) rt.readByte();
    }
    const target = suppress ? null : targets[k];
    const ttype = suppress ? null : types[k];
    if (!suppress) k++;
    if (conv === "c") {
      const n = width ?? 1;
      const bytes = [];
      for (let m = 0; m < n; m++) bytes.push(rt.readByte());
      if (target) bytes.forEach((b, m) => rt.storeAt(new Ptr(target.store, target.off + m), convert(b, T.int, T.char), line));
    } else if (conv === "s" || conv === "[") {
      const bytes = [];
      const max = width ?? Infinity;
      const ok = (b) => (set ? set.members.has(b) !== set.negate : !isSpace(b));
      while (bytes.length < max && ok(rt.peekByte())) bytes.push(rt.readByte());
      if (bytes.length === 0) { failed = true; break outer; }
      if (target) rt.writeCString(target, bytes, line);
    } else if (conv === "n") {
      if (target) rt.storeAt(target, convert(rt.pos - startPos, T.int, ttype), line);
      continue;
    } else {
      const text = scanToken(rt, conv, width);
      if (text === null) { failed = true; break; }
      if (target) {
        const value = "fFeEgGaA".includes(conv) ? parseFloat(text) : parseIntToken(text, conv);
        const from = typeof value === "bigint" ? T.llong : T.double;
        rt.storeAt(target, convert(value, from, ttype), line);
      }
    }
    if (!suppress) count++;
  }
  // 숫자를 읽지 못하면 입력이 그대로 남아서 같은 scanf가 끝없이 실패할 수 있어요.
  if (failed && count === 0) {
    if (rt.scanFail.pos === rt.pos) rt.scanFail.count++;
    else rt.scanFail = { pos: rt.pos, count: 1 };
    if (rt.scanFail.count > 200) {
      const rest = [];
      for (let p = rt.pos; p < rt.input.length && rt.input[p] !== 10; p++) rest.push(rt.input[p]);
      const shown = new TextDecoder().decode(Uint8Array.from(rest));
      throw runtimeError(line, `입력한 '${shown}'를 scanf가 읽지 못해서 같은 자리에서 계속 멈춰 있어요`,
        "scanf는 형식에 맞지 않는 입력을 그대로 남겨 둬요. 숫자를 입력해야 하는 곳에 글자를 넣었는지 확인해 보세요.");
    }
  }
  return count;
}

// ---------- 표준 라이브러리 ----------
const charPtr = ptr(T.char);
const voidPtr = ptr(T.void);
export const FILE_T = { k: "ptr", to: { k: "file", name: "FILE", size: 1 }, size: 8 };
const D = T.double;
const mathFn = (fn) => ({ header: "math.h", ret: D, params: [D], impl: (rt, [x]) => fn(x) });
const math2 = (fn) => ({ header: "math.h", ret: D, params: [D, D], impl: (rt, [x, y]) => fn(x, y) });
const ctypeFn = (fn) => ({ header: "ctype.h", ret: T.int, params: [T.int], impl: (rt, [c]) => fn(c) });
const ch = (c) => String.fromCharCode(c);

function cstr(rt, p, line) {
  return rt.readCString(p, line);
}

function malloc(rt, bytes, zero, line) {
  const n = Number(bytes);
  if (!(n >= 0) || n > 50_000_000) throw runtimeError(line, `malloc으로 ${n}바이트를 받을 수 없어요`, "크기가 음수이거나 너무 커요.");
  const st = new Store(0, "malloc 메모리", null);
  st.heap = true;
  st.untyped = true;
  st.bytes = n;
  st.zero = zero;
  return new Ptr(st, 0);
}

/** void* 를 T* 로 바꿀 때 malloc 메모리에 타입을 정해 줘요. */
export function retypeHeap(p, to, line) {
  if (p === null || !p.store.heap) return p;
  const st = p.store;
  const size = to.size || 1;
  if (st.untyped) {
    const count = Math.floor(st.bytes / size);
    st.cells = new Array(count);
    if (st.zero) st.cells.fill(zeroOf(to));
    st.elemSize = size;
    st.type = { k: "array", of: to, len: count };
    st.untyped = false;
  } else if (st.elemSize !== size && size !== 1) {
    throw runtimeError(line, "malloc 메모리를 다른 타입으로 다시 쓰는 건 지원하지 않아요");
  }
  return p;
}

export const BUILTINS = {
  printf: { header: "stdio.h", ret: T.int, params: [charPtr], variadic: true, format: "printf",
    impl(rt, [fmt, ...rest], line) {
      const bytes = formatPrintf(rt, cstr(rt, fmt, line), rest, line);
      rt.write(bytes);
      return bytes.length;
    } },
  sprintf: { header: "stdio.h", ret: T.int, params: [charPtr, charPtr], variadic: true, format: "printf", formatIndex: 1,
    impl(rt, [buf, fmt, ...rest], line) {
      const bytes = formatPrintf(rt, cstr(rt, fmt, line), rest, line);
      rt.writeCString(buf, bytes, line);
      return bytes.length;
    } },
  scanf: { header: "stdio.h", ret: T.int, params: [charPtr], variadic: true, format: "scanf", input: true,
    impl(rt, [fmt, ...targets], line, types) {
      rt.flushLines();
      return doScanf(rt, cstr(rt, fmt, line), targets, types.slice(1).map((t) => t.to), line);
    } },
  puts: { header: "stdio.h", ret: T.int, params: [charPtr], impl(rt, [s], line) { rt.write([...cstr(rt, s, line), 10]); return 1; } },
  putchar: { header: "stdio.h", ret: T.int, params: [T.int], impl(rt, [c]) { rt.write([c & 255]); return c; } },
  getchar: { header: "stdio.h", ret: T.int, params: [], input: true, impl(rt) { return rt.readByte(); } },
  fgets: { header: "stdio.h", ret: charPtr, params: [charPtr, T.int, FILE_T], input: true,
    impl(rt, [buf, n, file], line) {
      if (file !== "stdin") throw runtimeError(line, "fgets는 stdin에서 읽는 것만 지원해요", "예: fgets(buf, sizeof(buf), stdin);");
      const bytes = [];
      while (bytes.length < n - 1) {
        const b = rt.readByte();
        bytes.push(b);
        if (b === 10) break;
      }
      rt.writeCString(buf, bytes, line);
      return buf;
    } },
  fflush: { header: "stdio.h", ret: T.int, params: [FILE_T], impl(rt) { rt.flushLines(); return 0; } },

  abs: { header: "stdlib.h", ret: T.int, params: [T.int], impl: (rt, [x]) => (x < 0 ? -x | 0 : x) },
  labs: { header: "stdlib.h", ret: T.long, params: [T.long], impl: (rt, [x]) => BigInt.asIntN(64, x < 0n ? -x : x) },
  llabs: { header: "stdlib.h", ret: T.llong, params: [T.llong], impl: (rt, [x]) => BigInt.asIntN(64, x < 0n ? -x : x) },
  rand: { header: "stdlib.h", ret: T.int, params: [], impl: (rt) => rt.rand() },
  srand: { header: "stdlib.h", ret: T.void, params: [T.uint], impl(rt, [s]) { rt.randState = s & 0x7fffffff; } },
  exit: { header: "stdlib.h", ret: T.void, params: [T.int], impl(rt, [code]) { throw new ExitSignal(code); } },
  atoi: { header: "stdlib.h", ret: T.int, params: [charPtr],
    impl(rt, [s], line) { const m = new TextDecoder().decode(Uint8Array.from(cstr(rt, s, line))).match(/^\s*([+-]?\d+)/); return m ? convert(BigInt(m[1]), T.llong, T.int) : 0; } },
  atof: { header: "stdlib.h", ret: D, params: [charPtr],
    impl(rt, [s], line) { const v = parseFloat(new TextDecoder().decode(Uint8Array.from(cstr(rt, s, line)))); return Number.isNaN(v) ? 0 : v; } },
  malloc: { header: "stdlib.h", ret: voidPtr, params: [T.ulong], impl: (rt, [n], line) => malloc(rt, n, false, line) },
  calloc: { header: "stdlib.h", ret: voidPtr, params: [T.ulong, T.ulong], impl: (rt, [n, size], line) => malloc(rt, n * size, true, line) },
  free: { header: "stdlib.h", ret: T.void, params: [voidPtr],
    impl(rt, [p], line) {
      if (p === null) return;
      if (!p.store.heap || p.off !== 0) throw runtimeError(line, "malloc으로 받지 않은 메모리를 free하려고 했어요");
      if (p.store.freed) throw runtimeError(line, "같은 메모리를 두 번 free했어요");
      p.store.freed = true;
    } },

  strlen: { header: "string.h", ret: T.ulong, params: [charPtr], impl: (rt, [s], line) => BigInt(cstr(rt, s, line).length) },
  strcpy: { header: "string.h", ret: charPtr, params: [charPtr, charPtr], impl(rt, [d, s], line) { rt.writeCString(d, cstr(rt, s, line), line); return d; } },
  strncpy: { header: "string.h", ret: charPtr, params: [charPtr, charPtr, T.ulong],
    impl(rt, [d, s, n], line) {
      const bytes = cstr(rt, s, line).slice(0, Number(n));
      for (let i = 0; i < Number(n); i++) rt.storeAt(new Ptr(d.store, d.off + i), i < bytes.length ? convert(bytes[i], T.int, T.char) : 0, line);
      return d;
    } },
  strcat: { header: "string.h", ret: charPtr, params: [charPtr, charPtr],
    impl(rt, [d, s], line) { const a = cstr(rt, d, line); rt.writeCString(d, [...a, ...cstr(rt, s, line)], line); return d; } },
  strcmp: { header: "string.h", ret: T.int, params: [charPtr, charPtr],
    impl(rt, [a, b], line) {
      const x = cstr(rt, a, line); const y = cstr(rt, b, line);
      for (let i = 0; ; i++) {
        const p = x[i] ?? 0; const q = y[i] ?? 0;
        if (p !== q) return p < q ? -1 : 1;
        if (p === 0) return 0;
      }
    } },
  strncmp: { header: "string.h", ret: T.int, params: [charPtr, charPtr, T.ulong],
    impl(rt, [a, b, n], line) {
      const x = cstr(rt, a, line); const y = cstr(rt, b, line);
      for (let i = 0; i < Number(n); i++) {
        const p = x[i] ?? 0; const q = y[i] ?? 0;
        if (p !== q) return p < q ? -1 : 1;
        if (p === 0) return 0;
      }
      return 0;
    } },
  strchr: { header: "string.h", ret: charPtr, params: [charPtr, T.int],
    impl(rt, [s, c], line) { const i = cstr(rt, s, line).indexOf(c & 255); return i < 0 ? ((c & 255) === 0 ? new Ptr(s.store, s.off + cstr(rt, s, line).length) : null) : new Ptr(s.store, s.off + i); } },
  strstr: { header: "string.h", ret: charPtr, params: [charPtr, charPtr],
    impl(rt, [s, t], line) {
      const a = cstr(rt, s, line); const b = cstr(rt, t, line);
      for (let i = 0; i + b.length <= a.length; i++) if (b.every((x, j) => a[i + j] === x)) return new Ptr(s.store, s.off + i);
      return null;
    } },
  memset: { header: "string.h", ret: voidPtr, params: [voidPtr, T.int, T.ulong], rawPtr: true,
    impl(rt, [p, c, n], line) {
      const count = Number(n);
      const unit = p.store.heap ? p.store.elemSize || 1 : (baseOf(p.store.type).size || 1);
      if (count % unit !== 0 || ((c & 255) !== 0 && unit !== 1)) {
        throw runtimeError(line, "memset은 0으로 채우거나 char 배열을 채울 때만 지원해요");
      }
      const zero = zeroOf(baseOf(p.store.type || T.char));
      for (let i = 0; i < count / unit; i++) rt.storeAt(new Ptr(p.store, p.off + i), unit === 1 ? convert(c, T.int, T.char) : zero, line);
      return p;
    } },

  sqrt: mathFn(Math.sqrt), sin: mathFn(Math.sin), cos: mathFn(Math.cos), tan: mathFn(Math.tan),
  asin: mathFn(Math.asin), acos: mathFn(Math.acos), atan: mathFn(Math.atan), exp: mathFn(Math.exp),
  log: mathFn(Math.log), log10: mathFn(Math.log10), log2: mathFn(Math.log2), fabs: mathFn(Math.abs),
  floor: mathFn(Math.floor), ceil: mathFn(Math.ceil), trunc: mathFn(Math.trunc), cbrt: mathFn(Math.cbrt),
  round: mathFn((x) => (x < 0 ? -Math.round(-x) : Math.round(x))),
  pow: math2(Math.pow), atan2: math2(Math.atan2), hypot: math2(Math.hypot),
  fmod: math2((x, y) => x % y), fmax: math2(Math.max), fmin: math2(Math.min),

  isdigit: ctypeFn((c) => (/[0-9]/.test(ch(c)) ? 1 : 0)),
  isalpha: ctypeFn((c) => (/[A-Za-z]/.test(ch(c)) ? 1 : 0)),
  isalnum: ctypeFn((c) => (/[A-Za-z0-9]/.test(ch(c)) ? 1 : 0)),
  isspace: ctypeFn((c) => (isSpace(c) ? 1 : 0)),
  isupper: ctypeFn((c) => (/[A-Z]/.test(ch(c)) ? 1 : 0)),
  islower: ctypeFn((c) => (/[a-z]/.test(ch(c)) ? 1 : 0)),
  ispunct: ctypeFn((c) => (c > 32 && c < 127 && !/[A-Za-z0-9]/.test(ch(c)) ? 1 : 0)),
  toupper: ctypeFn((c) => (/[a-z]/.test(ch(c)) ? c - 32 : c)),
  tolower: ctypeFn((c) => (/[A-Z]/.test(ch(c)) ? c + 32 : c)),

  time: { header: "time.h", ret: T.long, params: [ptr(T.long)], impl(rt, [p], line) {
    const t = BigInt(rt.startTime);
    if (p !== null) rt.storeAt(p, t, line);
    return t;
  } },
  clock: { header: "time.h", ret: T.long, params: [], impl: (rt) => BigInt((Date.now() - rt.started) * 1000) },
};

export const isInputBuiltin = (name) => Boolean(BUILTINS[name] && BUILTINS[name].input);
export { typeName, isInt, isFloat, is64 };
