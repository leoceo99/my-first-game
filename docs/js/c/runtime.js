// C 프로그램이 실행될 때 필요한 것들: 입출력, 메모리 검사, 표준 라이브러리 함수.

import {
  T, Ptr, Store, FnRef, ptr, arr, runtimeError, convert, isInt, isFloat, isPtr, isArr, isCharLike, is64, isStruct,
  typeName, utf8, baseOf, cells, zeroOf, zerosOf,
} from "./types.js";

/** 입력이 더 필요해서 실행을 멈출 때 던지는 신호. */
export const NEED_INPUT = { needInput: true };

/** exit()를 부르거나 main이 끝날 때 쓰는 신호. */
export class ExitSignal {
  constructor(code) { this.code = code; }
}

const decoderFor = () => new TextDecoder("utf-8");

/** 표준 입출력 스트림 (FILE *stdin, *stdout, *stderr) */
export const STDIN = { kind: "stdin", name: "stdin" };
export const STDOUT = { kind: "stdout", name: "stdout" };
export const STDERR = { kind: "stderr", name: "stderr" };

/** 입력 답들을 바이트로 이어 붙여요. 답이 null이면 거기서 입력이 끝나요(EOF). */
function joinAnswers(answers) {
  const bytes = [];
  for (const a of answers) {
    if (a === null) return { bytes, eof: bytes.length };
    bytes.push(...utf8(`${a}\n`));
  }
  return { bytes, eof: Infinity };
}

export class Runtime {
  constructor({ answers = [], startTime = Math.floor(Date.now() / 1000), onOutput = () => {}, files = {} } = {}) {
    const all = joinAnswers(answers);
    this.input = all.bytes;
    this.eofAt = all.eof;
    this.muteUntil = joinAnswers(answers.slice(0, -1)).bytes.length;
    this.files = new Map(Object.entries(files).map(([name, text]) => [name, utf8(text)]));
    this.strtok = null;
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
  /** 다음 입력 바이트. 입력이 끝났으면(EOF) -1, 아직 답이 없으면 실행을 멈추고 답을 기다려요. */
  peekByte() {
    if (this.pos >= this.muteUntil && this.muted) this.muted = false;
    if (this.pos >= this.eofAt) return -1;
    if (this.pos >= this.input.length) throw NEED_INPUT;
    return this.input[this.pos];
  }

  readByte() {
    const b = this.peekByte();
    if (b >= 0) this.pos++;
    return b;
  }

  /** scanf, fgets, fgetc가 읽을 곳: 키보드(stdin) 또는 파일 */
  reader(stream, line) {
    if (stream === STDIN) return { peek: () => this.peekByte(), read: () => this.readByte(), isStdin: true };
    const h = this.openHandle(stream, line, "r");
    return {
      peek: () => { if (h.pos < h.data.length) return h.data[h.pos]; h.eof = true; return -1; },
      read: () => { if (h.pos >= h.data.length) { h.eof = true; return -1; } return h.data[h.pos++]; },
    };
  }

  /** printf, fputs가 쓸 곳: 화면(stdout, stderr) 또는 파일 */
  writeTo(stream, bytes, line) {
    if (stream === STDOUT || stream === STDERR) { this.write(bytes); return; }
    const h = this.openHandle(stream, line, "w");
    for (const b of bytes) {
      if (h.pos < h.data.length) h.data[h.pos] = b;
      else h.data.push(b);
      h.pos++;
    }
  }

  openHandle(stream, line, use) {
    if (stream === null || stream === undefined) {
      throw runtimeError(line, "NULL 파일 포인터를 사용했어요", "fopen이 NULL을 돌려줬는지(파일이 없는지) 먼저 확인해 보세요. 예: if (fp == NULL) { ... }");
    }
    if (stream === STDIN && use === "w") throw runtimeError(line, "stdin에는 쓸 수 없어요");
    if ((stream === STDOUT || stream === STDERR) && use === "r") throw runtimeError(line, `${stream.name}에서는 읽을 수 없어요`);
    if (stream.closed) throw runtimeError(line, `닫은 파일 '${stream.name}'을 사용했어요`, "fclose 뒤에는 그 파일을 쓸 수 없어요.");
    if (use === "r" && !stream.canRead) throw runtimeError(line, `'${stream.name}'은 쓰기용으로 열어서 읽을 수 없어요`, "읽으려면 fopen(이름, \"r\")로 열어요.");
    if (use === "w" && !stream.canWrite) throw runtimeError(line, `'${stream.name}'은 읽기용(\"r\")으로 열어서 쓸 수 없어요`, "쓰려면 fopen(이름, \"w\") 또는 \"a\"로 열어요.");
    return stream;
  }

  /** 프로그램이 끝났을 때의 가상 파일들 (이름 → 글자) */
  fileTexts() {
    const out = {};
    for (const [name, bytes] of this.files) out[name] = new TextDecoder().decode(Uint8Array.from(bytes));
    return out;
  }

  callFn(ref, args, line, used = true) {
    if (!(ref instanceof FnRef)) {
      throw runtimeError(line, "함수 포인터가 아무 함수도 가리키지 않아요", "함수 포인터에 함수 이름을 먼저 넣어 주세요.");
    }
    return this.invoke(ref.fi, args, line, used);
  }

  // ---------- 메모리 ----------
  /** 메모리 위치를 사람이 읽을 이름으로: scores[2], p.name, list[1].x */
  describe(p, target = null) {
    const st = p.store;
    let t = st.type;
    let out = st.name;
    let rest = p.off;
    while (t) {
      if (rest === 0 && target && (t === target || (t.k === target.k && t.k !== "array" && t.k !== "struct"))) break;
      if (isArr(t)) {
        const unit = cells(t.of) || 1;
        const idx = Math.floor(rest / unit);
        out += `[${idx}]`;
        rest -= idx * unit;
        t = t.of;
      } else if (isStruct(t)) {
        const f = t.fields.find((x) => rest >= x.off && rest < x.off + cells(x.type));
        if (!f) break;
        out += `.${f.name}`;
        rest -= f.off;
        t = f.type;
      } else break;
    }
    return out;
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
      if (isArr(st.type)) {
        const size = st.type.len;
        const unit = cells(st.type.of) || 1;
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

  /** 구조체 값 전체를 복사해서 읽어요 (칸 목록). */
  loadStruct(p, n, line) {
    this.check(p, line, false);
    if (p.off + n > p.store.cells.length) this.check(new Ptr(p.store, p.off + n - 1), line, false);
    return p.store.cells.slice(p.off, p.off + n);
  }

  storeStruct(p, values, line) {
    this.check(p, line, true);
    if (p.off + values.length > p.store.cells.length) this.check(new Ptr(p.store, p.off + values.length - 1), line, true);
    for (let i = 0; i < values.length; i++) p.store.cells[p.off + i] = values[i];
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
    if (isStruct(type)) {
      return `{${type.fields.map((f) => `${f.name}: ${this.formatValue(f.type, store, off + f.off)}`).join(", ")}}`;
    }
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
    if (v instanceof FnRef) return `→ 함수 ${v.fi.name}`;
    if (isPtr(type) && type.to.k === "file") return v === null ? "NULL" : `파일 ${v.name}`;
    if (isPtr(type)) {
      if (v === null) return "NULL";
      if (v.store.readonly) return `→ 문자열 상수 ${JSON.stringify(new TextDecoder().decode(Uint8Array.from(v.store.cells.slice(v.off, -1).map((b) => b & 255))))}`;
      return `→ ${this.describe(v, type.to)}`;
    }
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

// ---------- 실수를 C(glibc)와 똑같이 반올림해서 글자로 ----------
// double 값은 2진수로 정확히 저장돼 있어서, 그 정확한 값으로 계산하고
// 딱 절반인 경우에는 짝수 쪽으로 반올림해요 (예: printf("%.1f", 2.25) → 2.2).
function decompose(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp;
  if (expBits === 0) exp = -1074;
  else {
    mant |= 1n << 52n;
    exp = expBits - 1075;
  }
  return { mant, exp };
}

/** x × 10^k 를 정수로 반올림 (x ≥ 0, 딱 절반이면 짝수로) */
function scaledRound(x, k) {
  const { mant, exp } = decompose(x);
  let num = mant;
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den <<= BigInt(-exp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const q = num / den;
  const twice = 2n * (num % den);
  return twice > den || (twice === den && (q & 1n) === 1n) ? q + 1n : q;
}

function fixedText(x, prec) {
  const digits = scaledRound(x, prec).toString().padStart(prec + 1, "0");
  return prec > 0 ? `${digits.slice(0, -prec)}.${digits.slice(-prec)}` : digits;
}

function expParts(x, prec) {
  if (x === 0) return { digits: "0".repeat(prec + 1), e: 0 };
  let e = Math.floor(Math.log10(x));
  let q = scaledRound(x, prec - e);
  if (q >= 10n ** BigInt(prec + 1)) { e++; q = scaledRound(x, prec - e); }
  if (q < 10n ** BigInt(prec)) { e--; q = scaledRound(x, prec - e); }
  return { digits: q.toString(), e };
}

function expText(x, prec) {
  const { digits, e } = expParts(x, prec);
  const mant = prec > 0 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

export function formatFloat(x, conv, prec, alt = false) {
  const upper = conv === conv.toUpperCase();
  const negative = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let text;
  if (!Number.isFinite(x)) text = Number.isNaN(x) ? "nan" : "inf";
  else if (conv === "f" || conv === "F") {
    text = fixedText(ax, prec);
    if (alt && prec === 0) text += ".";
  } else if (conv === "e" || conv === "E") {
    text = expText(ax, prec);
  } else {
    const P = prec === 0 ? 1 : prec;
    const { e } = expParts(ax, P - 1);
    text = P > e && e >= -4 ? fixedText(ax, P - 1 - e) : expText(ax, P - 1);
    if (!alt) {
      const [mant, ex] = text.split("e");
      const trimmed = mant.includes(".") ? mant.replace(/\.?0+$/, "") : mant;
      text = ex === undefined ? trimmed : `${trimmed}e${ex}`;
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

function scanToken(src, conv, width) {
  const max = width ?? Infinity;
  const bytes = [];
  const take = () => { bytes.push(src.read()); };
  const peekIs = (re) => { if (bytes.length >= max) return false; const b = src.peek(); return b >= 0 && re.test(String.fromCharCode(b)); };
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
export function doScanf(rt, src, fmtBytes, targets, types, line) {
  let count = 0;
  let k = 0;
  let consumed = 0;
  let eof = false;
  const peek = () => src.peek();
  const read = () => { consumed++; return src.read(); };
  let failed = false;
  outer: for (let i = 0; i < fmtBytes.length; i++) {
    const f = fmtBytes[i];
    if (isSpace(f)) {
      while (isSpace(peek())) read();
      continue;
    }
    if (f !== 37 || fmtBytes[i + 1] === 37) {
      if (f === 37) i++;
      while (f === 37 && isSpace(peek())) read();
      if (peek() < 0) { eof = true; break; }
      if (peek() !== f) { failed = true; break; }
      read();
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
      while (isSpace(peek())) read();
    }
    const target = suppress ? null : targets[k];
    const ttype = suppress ? null : types[k];
    if (!suppress) k++;
    if (conv === "c") {
      if (peek() < 0) { eof = true; break; }
      const n = width ?? 1;
      const bytes = [];
      for (let m = 0; m < n && peek() >= 0; m++) bytes.push(read());
      if (target) bytes.forEach((b, m) => rt.storeAt(new Ptr(target.store, target.off + m), convert(b, T.int, T.char), line));
    } else if (conv === "s" || conv === "[") {
      const bytes = [];
      const max = width ?? Infinity;
      const ok = (b) => b >= 0 && (set ? set.members.has(b) !== set.negate : !isSpace(b));
      while (bytes.length < max && ok(peek())) bytes.push(read());
      if (bytes.length === 0) {
        if (peek() < 0) eof = true;
        else failed = true;
        break outer;
      }
      if (target) rt.writeCString(target, bytes, line);
    } else if (conv === "n") {
      if (target) rt.storeAt(target, convert(consumed, T.int, ttype), line);
      continue;
    } else {
      if (peek() < 0) { eof = true; break; }
      const text = scanToken({ peek, read }, conv, width);
      if (text === null) { failed = true; break; }
      if (target) {
        const value = "fFeEgGaA".includes(conv) ? parseFloat(text) : parseIntToken(text, conv);
        const from = typeof value === "bigint" ? T.llong : T.double;
        rt.storeAt(target, convert(value, from, ttype), line);
      }
    }
    if (!suppress) count++;
  }
  if (eof && count === 0) return -1; // EOF
  // 숫자를 읽지 못하면 입력이 그대로 남아서 같은 scanf가 끝없이 실패할 수 있어요.
  if (failed && count === 0 && src.isStdin) {
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
/** qsort, bsearch의 비교 함수: int 를 돌려주는 어떤 함수 포인터든 받아요. */
const CMP_FN = { k: "ptr", to: { k: "func", any: true, ret: T.int, params: [] }, size: 8 };
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
    const type = arr(to, count);
    st.cells = st.zero ? zerosOf(type).slice() : new Array(count * cells(to));
    st.elemSize = size;
    st.type = type;
    st.untyped = false;
  } else if (st.elemSize !== size && size !== 1) {
    throw runtimeError(line, "malloc 메모리를 다른 타입으로 다시 쓰는 건 지원하지 않아요");
  }
  return p;
}

function textOf(rt, p, line) {
  return new TextDecoder().decode(Uint8Array.from(cstr(rt, p, line)));
}

function fopen(rt, nameP, modeP, line) {
  const name = textOf(rt, nameP, line).trim();
  const mode = textOf(rt, modeP, line).replace("b", "");
  if (!/^[rwa]\+?$/.test(mode)) {
    throw runtimeError(line, `fopen의 모드 "${mode}"를 알 수 없어요`, "읽기는 \"r\", 새로 쓰기는 \"w\", 이어 쓰기는 \"a\"를 써요.");
  }
  if (!name) throw runtimeError(line, "fopen에 파일 이름이 비어 있어요");
  if (mode[0] === "r" && !rt.files.has(name)) return null;
  if (mode[0] === "w" || !rt.files.has(name)) rt.files.set(name, []);
  const data = rt.files.get(name);
  return {
    kind: "file", name, data, pos: mode[0] === "a" ? data.length : 0, eof: false, closed: false,
    canRead: mode[0] === "r" || mode.includes("+"), canWrite: mode[0] !== "r" || mode.includes("+"),
  };
}

/** 배열 원소의 타입과 칸 수 (qsort, bsearch, memcpy 용) */
function elementOf(p, size, line, what) {
  const st = p.store;
  const elem = isArr(st.type) ? st.type.of : st.type;
  if (Number(size) !== elem.size) {
    throw runtimeError(line, `${what}에 넣은 크기(${size})가 원소 하나의 크기(${elem.size}바이트)와 달라요`, "sizeof(배열[0])을 넣어 주세요.");
  }
  return { elem, unit: cells(elem) };
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
      return doScanf(rt, rt.reader(STDIN, line), cstr(rt, fmt, line), targets, types.slice(1).map((t) => t.to), line);
    } },
  puts: { header: "stdio.h", ret: T.int, params: [charPtr], impl(rt, [s], line) { rt.write([...cstr(rt, s, line), 10]); return 1; } },
  putchar: { header: "stdio.h", ret: T.int, params: [T.int], impl(rt, [c]) { rt.write([c & 255]); return c; } },
  getchar: { header: "stdio.h", ret: T.int, params: [], input: true, impl(rt) { return rt.readByte(); } },
  fgets: { header: "stdio.h", ret: charPtr, params: [charPtr, T.int, FILE_T], input: true,
    impl(rt, [buf, n, file], line) {
      const src = rt.reader(file, line);
      const bytes = [];
      while (bytes.length < n - 1) {
        const b = src.read();
        if (b < 0) break;
        bytes.push(b);
        if (b === 10) break;
      }
      if (bytes.length === 0) return null;
      rt.writeCString(buf, bytes, line);
      return buf;
    } },
  fflush: { header: "stdio.h", ret: T.int, params: [FILE_T], impl(rt) { rt.flushLines(); return 0; } },
  fopen: { header: "stdio.h", ret: FILE_T, params: [charPtr, charPtr], impl: (rt, [n, m], line) => fopen(rt, n, m, line) },
  fclose: { header: "stdio.h", ret: T.int, params: [FILE_T],
    impl(rt, [f], line) { rt.openHandle(f, line, "any"); if (f.kind === "file") f.closed = true; return 0; } },
  fprintf: { header: "stdio.h", ret: T.int, params: [FILE_T, charPtr], variadic: true, format: "printf", formatIndex: 1,
    impl(rt, [f, fmt, ...rest], line) {
      const bytes = formatPrintf(rt, cstr(rt, fmt, line), rest, line);
      rt.writeTo(f, bytes, line);
      return bytes.length;
    } },
  fscanf: { header: "stdio.h", ret: T.int, params: [FILE_T, charPtr], variadic: true, format: "scanf", formatIndex: 1, input: true,
    impl(rt, [f, fmt, ...targets], line, types) {
      rt.flushLines();
      return doScanf(rt, rt.reader(f, line), cstr(rt, fmt, line), targets, types.slice(2).map((t) => t.to), line);
    } },
  fputs: { header: "stdio.h", ret: T.int, params: [charPtr, FILE_T], impl(rt, [s, f], line) { rt.writeTo(f, cstr(rt, s, line), line); return 1; } },
  fputc: { header: "stdio.h", ret: T.int, params: [T.int, FILE_T], impl(rt, [c, f], line) { rt.writeTo(f, [c & 255], line); return c & 255; } },
  putc: { header: "stdio.h", ret: T.int, params: [T.int, FILE_T], impl(rt, [c, f], line) { rt.writeTo(f, [c & 255], line); return c & 255; } },
  fgetc: { header: "stdio.h", ret: T.int, params: [FILE_T], input: true, impl: (rt, [f], line) => rt.reader(f, line).read() },
  getc: { header: "stdio.h", ret: T.int, params: [FILE_T], input: true, impl: (rt, [f], line) => rt.reader(f, line).read() },
  feof: { header: "stdio.h", ret: T.int, params: [FILE_T],
    impl(rt, [f], line) {
      if (f === STDIN) return rt.pos >= rt.eofAt ? 1 : 0;
      return rt.openHandle(f, line, "any").eof ? 1 : 0;
    } },
  rewind: { header: "stdio.h", ret: T.void, params: [FILE_T], impl(rt, [f], line) { const h = rt.openHandle(f, line, "any"); h.pos = 0; h.eof = false; } },
  remove: { header: "stdio.h", ret: T.int, params: [charPtr], impl(rt, [n], line) { return rt.files.delete(textOf(rt, n, line)) ? 0 : -1; } },
  snprintf: { header: "stdio.h", ret: T.int, params: [charPtr, T.ulong, charPtr], variadic: true, format: "printf", formatIndex: 2,
    impl(rt, [buf, n, fmt, ...rest], line) {
      const bytes = formatPrintf(rt, cstr(rt, fmt, line), rest, line);
      const max = Number(n);
      if (max > 0) rt.writeCString(buf, bytes.slice(0, max - 1), line);
      return bytes.length;
    } },

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

  strrchr: { header: "string.h", ret: charPtr, params: [charPtr, T.int],
    impl(rt, [s, c], line) { const i = cstr(rt, s, line).lastIndexOf(c & 255); return i < 0 ? null : new Ptr(s.store, s.off + i); } },
  strncat: { header: "string.h", ret: charPtr, params: [charPtr, charPtr, T.ulong],
    impl(rt, [d, s, n], line) { rt.writeCString(d, [...cstr(rt, d, line), ...cstr(rt, s, line).slice(0, Number(n))], line); return d; } },
  strtok: { header: "string.h", ret: charPtr, params: [charPtr, charPtr],
    impl(rt, [s, delim], line) {
      const del = new Set(cstr(rt, delim, line));
      let p = s !== null ? new Ptr(s.store, s.off) : rt.strtok;
      if (p === null || p === undefined) return null;
      const at = (q) => rt.load(q, line) & 255;
      while (at(p) !== 0 && del.has(at(p))) p = new Ptr(p.store, p.off + 1);
      if (at(p) === 0) { rt.strtok = null; return null; }
      const start = p;
      while (at(p) !== 0 && !del.has(at(p))) p = new Ptr(p.store, p.off + 1);
      if (at(p) === 0) rt.strtok = null;
      else {
        rt.storeAt(p, 0, line);
        rt.strtok = new Ptr(p.store, p.off + 1);
      }
      return start;
    } },
  memcpy: { header: "string.h", ret: voidPtr, params: [voidPtr, voidPtr, T.ulong],
    impl(rt, [d, s, n], line) {
      rt.check(d, line, true);
      rt.check(s, line, false);
      const elem = isArr(d.store.type) ? d.store.type.of : d.store.type;
      const size = elem.size;
      const unit = cells(elem);
      if (Number(n) % size !== 0) throw runtimeError(line, "memcpy의 크기가 원소 크기의 배수가 아니에요");
      const count = (Number(n) / size) * unit;
      const vals = s.store.cells.slice(s.off, s.off + count);
      if (vals.length < count) rt.check(new Ptr(s.store, s.off + count - 1), line, false);
      rt.storeStruct(d, vals, line);
      return d;
    } },
  qsort: { header: "stdlib.h", ret: T.void, params: [voidPtr, T.ulong, T.ulong, CMP_FN],
    impl(rt, [base, n, size, cmp], line) {
      const count = Number(n);
      if (count <= 1) return;
      rt.check(base, line, false);
      const { elem, unit } = elementOf(base, size, line, "qsort");
      const st = base.store;
      if (base.off + count * unit > st.cells.length) rt.check(new Ptr(st, base.off + count * unit - 1), line, false);
      const items = [];
      for (let i = 0; i < count; i++) items.push(st.cells.slice(base.off + i * unit, base.off + (i + 1) * unit));
      const a = new Store(unit, "비교할 값 a", elem);
      const b = new Store(unit, "비교할 값 b", elem);
      items.sort((x, y) => {
        a.cells = x;
        b.cells = y;
        return Number(rt.callFn(cmp, [new Ptr(a, 0), new Ptr(b, 0)], line));
      });
      items.forEach((vals, i) => { for (let k = 0; k < unit; k++) st.cells[base.off + i * unit + k] = vals[k]; });
    } },
  bsearch: { header: "stdlib.h", ret: voidPtr, params: [voidPtr, voidPtr, T.ulong, T.ulong, CMP_FN],
    impl(rt, [key, base, n, size, cmp], line) {
      rt.check(base, line, false);
      const { unit } = elementOf(base, size, line, "bsearch");
      let lo = 0;
      let hi = Number(n) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const at = new Ptr(base.store, base.off + mid * unit);
        const r = Number(rt.callFn(cmp, [key, at], line));
        if (r === 0) return at;
        if (r < 0) hi = mid - 1;
        else lo = mid + 1;
      }
      return null;
    } },
  isxdigit: ctypeFn((c) => (/[0-9a-fA-F]/.test(ch(c)) ? 1 : 0)),
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
export { typeName, isInt, isFloat, is64, STDIN as stdinStream };
