// C 프로그램이 실행될 때 필요한 것들: 입출력, 메모리 검사, 표준 라이브러리 함수.

import {
  T, Ptr, Store, FnRef, ptr, arr, runtimeError, reinterpret, sameType, convert, isInt, isFloat, isPtr, isArr, isCharLike, is64, isStruct,
  typeName, utf8, baseOf, cells, zeroOf, zerosOf, STRING_T, isObj, hasObj,
} from "./types.js";

/** 입력이 더 필요해서 실행을 멈출 때 던지는 신호. */
export const NEED_INPUT = { needInput: true };

/** exit()를 부르거나 main이 끝날 때 쓰는 신호. */
export class ExitSignal {
  constructor(code) { this.code = code; }
}

const decoderFor = () => new TextDecoder("utf-8");

/** longjmp가 setjmp 자리로 돌아갈 때 던지는 신호. */
export class JumpSignal {
  constructor(ctx, value) { this.ctx = ctx; this.value = value; }
}

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
  constructor({ answers = [], startTime = Math.floor(Date.now() / 1000), onOutput = () => {}, files = {}, tzOffset = 0 } = {}) {
    const all = joinAnswers(answers);
    this.input = all.bytes;
    this.eofAt = all.eof;
    this.muteUntil = joinAnswers(answers.slice(0, -1)).bytes.length;
    this.files = new Map(Object.entries(files).map(([name, text]) => [name, utf8(text)]));
    this.strtok = null;
    this.atexitFns = [];
    this.errnoValue = 0;
    this.errnoStore = null;
    this.tzOffset = tzOffset;
    this.builtinTypes = {};
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

  getErrno() {
    return this.errnoStore ? this.errnoStore.cells[0] : this.errnoValue;
  }

  setErrno(v) {
    if (this.errnoStore) this.errnoStore.cells[0] = v;
    else this.errnoValue = v;
  }

  /** exit()나 main이 끝날 때 atexit로 등록한 함수를 거꾸로 불러요 */
  runAtExit() {
    while (this.atexitFns.length) this.callFn(this.atexitFns.pop(), [], 0, false);
  }

  callFn(ref, args, line, used = true, types = []) {
    if (!(ref instanceof FnRef)) {
      throw runtimeError(line, "함수 포인터가 아무 함수도 가리키지 않아요", "함수 포인터에 함수 이름을 먼저 넣어 주세요.");
    }
    return this.invoke(ref.fi, args, line, used, types);
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
    let v = p.store.cells[p.off];
    if (p.as && v !== undefined) v = this.unionRead(p, v, line);
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

  /** 공용체: 마지막으로 쓴 멤버와 다른 멤버로 읽으면 비트를 그대로 다시 해석해요. */
  unionRead(p, v, line) {
    const tags = p.store.unionTags;
    const last = tags && tags.get(p.off);
    if (!last || sameType(last, p.as) || (last.bits === p.as.bits && last.k === p.as.k && last.k === "int")) {
      if (last && last.k === "int" && p.as.k === "int") return convert(v, last, p.as);
      if (!last) {
        // 처음 값으로 채운 공용체: 종류만 맞춰 줘요
        if (p.as.k === "int" && p.as.bits === 64 && typeof v === "number") return BigInt(Math.trunc(v));
        if (typeof v === "bigint" && !(p.as.k === "int" && p.as.bits === 64)) return Number(v);
      }
      return v;
    }
    const out = reinterpret(v, last, p.as);
    if (out === null) {
      throw runtimeError(line, "공용체에 넣은 주소(포인터)를 다른 타입으로 읽을 수 없어요", "마지막으로 넣은 멤버로 읽어 주세요.");
    }
    return out;
  }

  storeAt(p, v, line) {
    this.check(p, line, true);
    if (p.as) (p.store.unionTags || (p.store.unionTags = new Map())).set(p.off, p.as);
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
      if (type.isUnion) {
        const last = store.unionTags && store.unionTags.get(off);
        const f = type.fields.find((x) => last && sameType(x.type, last)) || type.fields[0];
        return `{${f.name}: ${this.formatValue(f.type, store, off + f.off)}} (공용체)`;
      }
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
    if (type.k === "string") return JSON.stringify(new TextDecoder().decode(Uint8Array.from(strBytes(v))));
    if (type.k === "vector") {
      const n = vecLen(v);
      const parts = [];
      for (let i = 0; i < Math.min(n, 20); i++) parts.push(this.formatValue(type.of, v, i * v.unit));
      return `{${parts.join(", ")}${n > 20 ? ", …" : ""}} (${n}개)`;
    }
    if (type.k === "ref") return v instanceof Ptr ? `→ ${this.formatValue(type.to, v.store, v.off)} (참조)` : "?";
    if (type.k === "jmpbuf") return v && v.jmp ? "(돌아올 자리 저장됨)" : "?";
    if (type.k === "valist") return v ? `(가변 인자 ${v.args.length}개 중 ${v.i}개 꺼냄)` : "(비어 있음)";
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
  if (mode[0] === "r" && !rt.files.has(name)) {
    rt.setErrno(2);
    return null;
  }
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
  sprintf: { writes: [0], header: "stdio.h", ret: T.int, params: [charPtr, charPtr], variadic: true, format: "printf", formatIndex: 1,
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
  fgets: { writes: [0], header: "stdio.h", ret: charPtr, params: [charPtr, T.int, FILE_T], input: true,
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
  snprintf: { writes: [0], header: "stdio.h", ret: T.int, params: [charPtr, T.ulong, charPtr], variadic: true, format: "printf", formatIndex: 2,
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
      if (p.store.newKind) throw runtimeError(line, "new로 만든 메모리를 free하려고 했어요", "new로 만든 것은 delete로, new[]로 만든 것은 delete[]로 돌려줘요.");
      if (!p.store.heap || p.off !== 0) throw runtimeError(line, "malloc으로 받지 않은 메모리를 free하려고 했어요");
      if (p.store.freed) throw runtimeError(line, "같은 메모리를 두 번 free했어요");
      p.store.freed = true;
    } },

  strlen: { header: "string.h", ret: T.ulong, params: [charPtr], impl: (rt, [s], line) => BigInt(cstr(rt, s, line).length) },
  strcpy: { writes: [0], header: "string.h", ret: charPtr, params: [charPtr, charPtr], impl(rt, [d, s], line) { rt.writeCString(d, cstr(rt, s, line), line); return d; } },
  strncpy: { writes: [0], header: "string.h", ret: charPtr, params: [charPtr, charPtr, T.ulong],
    impl(rt, [d, s, n], line) {
      const bytes = cstr(rt, s, line).slice(0, Number(n));
      for (let i = 0; i < Number(n); i++) rt.storeAt(new Ptr(d.store, d.off + i), i < bytes.length ? convert(bytes[i], T.int, T.char) : 0, line);
      return d;
    } },
  strcat: { writes: [0], header: "string.h", ret: charPtr, params: [charPtr, charPtr],
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
  memset: { writes: [0], header: "string.h", ret: voidPtr, params: [voidPtr, T.int, T.ulong], rawPtr: true,
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
  strncat: { writes: [0], header: "string.h", ret: charPtr, params: [charPtr, charPtr, T.ulong],
    impl(rt, [d, s, n], line) { rt.writeCString(d, [...cstr(rt, d, line), ...cstr(rt, s, line).slice(0, Number(n))], line); return d; } },
  strtok: { writes: [0], header: "string.h", ret: charPtr, params: [charPtr, charPtr],
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
  memcpy: { writes: [0], header: "string.h", ret: voidPtr, params: [voidPtr, voidPtr, T.ulong],
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

// =====================================================================
// 표준 라이브러리 더하기: sscanf, strtol, realloc, 바이너리 파일, time.h …
// =====================================================================

/** 값을 C의 실제 바이트 모양(리틀 엔디언, 구조체 빈칸 포함)으로 바꾸고 되돌려요 (fread/fwrite, memcmp 용). */
function encodeScalar(t, v, view, at) {
  if (t.k === "float") {
    if (t.bits === 32) view.setFloat32(at, v ?? 0, true);
    else view.setFloat64(at, v ?? 0, true);
    return;
  }
  if (t.k !== "int") return; // 포인터 등은 0으로 둬요
  const big = BigInt.asUintN(t.size * 8, BigInt(v ?? 0));
  for (let i = 0; i < t.size; i++) view.setUint8(at + i, Number((big >> BigInt(8 * i)) & 0xffn));
}

function decodeScalar(t, view, at) {
  if (t.k === "float") return t.bits === 32 ? view.getFloat32(at, true) : view.getFloat64(at, true);
  if (t.k !== "int") return null;
  let big = 0n;
  for (let i = t.size - 1; i >= 0; i--) big = (big << 8n) | BigInt(view.getUint8(at + i));
  return convert(big, T.ullong, t);
}

function serialize(t, cellsArr, off, view, at) {
  if (isStruct(t)) {
    const fields = t.isUnion ? t.fields.slice(0, 1) : t.fields;
    for (const f of fields) if (!f.type.bitfield) serialize(f.type, cellsArr, off + f.off, view, at + f.byteOff);
  } else if (isArr(t)) {
    for (let i = 0; i < t.len; i++) serialize(t.of, cellsArr, off + i * cells(t.of), view, at + i * t.of.size);
  } else encodeScalar(t, cellsArr[off], view, at);
}

function deserialize(t, cellsArr, off, view, at) {
  if (isStruct(t)) {
    const fields = t.isUnion ? t.fields.slice(0, 1) : t.fields;
    for (const f of fields) if (!f.type.bitfield) deserialize(f.type, cellsArr, off + f.off, view, at + f.byteOff);
  } else if (isArr(t)) {
    for (let i = 0; i < t.len; i++) deserialize(t.of, cellsArr, off + i * cells(t.of), view, at + i * t.of.size);
  } else {
    const v = decodeScalar(t, view, at);
    if (v !== null) cellsArr[off] = v;
  }
}

/** 포인터가 가리키는 곳의 원소 타입과 칸 수 */
function unitAt(rt, p, line) {
  rt.check(p, line, false);
  const st = p.store;
  const elem = isArr(st.type) ? st.type.of : st.type;
  const unit = cells(elem);
  if (p.off % unit !== 0) {
    throw runtimeError(line, "원소의 중간을 가리키는 주소로는 바이트 단위 작업을 할 수 없어요");
  }
  return { st, elem, unit };
}

/** p부터 n바이트를 읽어요 */
function bytesOf(rt, p, n, line) {
  const { st, elem, unit } = unitAt(rt, p, line);
  const count = Math.ceil(n / elem.size);
  if (p.off + count * unit > st.cells.length) rt.check(new Ptr(st, p.off + count * unit - 1), line, false);
  const view = new DataView(new ArrayBuffer(count * elem.size));
  for (let i = 0; i < count; i++) serialize(elem, st.cells, p.off + i * unit, view, i * elem.size);
  return Array.from(new Uint8Array(view.buffer)).slice(0, n);
}

/** p부터 바이트들을 써요 (원소 크기의 배수만) */
function writeBytes(rt, p, bytes, line) {
  const { st, elem, unit } = unitAt(rt, p, line);
  if (bytes.length % elem.size !== 0) {
    throw runtimeError(line, `${elem.size}바이트짜리 원소에 ${bytes.length}바이트를 나눠 넣을 수 없어요`);
  }
  const count = bytes.length / elem.size;
  if (p.off + count * unit > st.cells.length) rt.check(new Ptr(st, p.off + count * unit - 1), line, true);
  rt.check(p, line, true);
  const view = new DataView(Uint8Array.from(bytes).buffer);
  for (let i = 0; i < count; i++) deserialize(elem, st.cells, p.off + i * unit, view, i * elem.size);
}

function stringReader(bytes) {
  let i = 0;
  return {
    peek: () => (i < bytes.length ? bytes[i] : -1),
    read: () => (i < bytes.length ? bytes[i++] : -1),
    get pos() { return i; },
  };
}

const ERRNO_TEXT = {
  0: "Success", 2: "No such file or directory", 22: "Invalid argument",
  33: "Numerical argument out of domain", 34: "Numerical result out of range",
};

function constString(rt, text) {
  if (!rt.constStrings) rt.constStrings = new Map();
  let st = rt.constStrings.get(text);
  if (!st) {
    const bytes = utf8(text);
    st = new Store(bytes.length + 1, "문자열 상수", arr(T.char, bytes.length + 1));
    bytes.forEach((b, i) => { st.cells[i] = convert(b, T.int, T.char); });
    st.cells[bytes.length] = 0;
    st.readonly = true;
    rt.constStrings.set(text, st);
  }
  return new Ptr(st, 0);
}

function heapString(bytes) {
  const st = new Store(bytes.length + 1, "malloc 메모리", arr(T.char, bytes.length + 1));
  bytes.forEach((b, i) => { st.cells[i] = convert(b, T.int, T.char); });
  st.cells[bytes.length] = 0;
  st.heap = true;
  st.elemSize = 1;
  return new Ptr(st, 0);
}

/** strtol 계열: [값(BigInt), 읽은 글자 수] */
function parseInteger(bytes, base) {
  let i = 0;
  while (i < bytes.length && isSpace(bytes[i])) i++;
  let neg = false;
  if (bytes[i] === 43 || bytes[i] === 45) { neg = bytes[i] === 45; i++; }
  const hexPrefix = bytes[i] === 48 && (bytes[i + 1] === 120 || bytes[i + 1] === 88);
  if ((base === 0 || base === 16) && hexPrefix && /[0-9a-fA-F]/.test(String.fromCharCode(bytes[i + 2] ?? 0))) { i += 2; base = 16; }
  else if (base === 0) base = bytes[i] === 48 ? 8 : 10;
  const start = i;
  let v = 0n;
  for (; i < bytes.length; i++) {
    const d = parseInt(String.fromCharCode(bytes[i]), 36);
    if (Number.isNaN(d) || d >= base) break;
    v = v * BigInt(base) + BigInt(d);
  }
  if (i === start) return [0n, 0];
  return [neg ? -v : v, i];
}

function parseDouble(bytes) {
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  const m = text.match(/^\s*[+-]?(?:inf(?:inity)?|nan|0[xX][0-9a-fA-F]*\.?[0-9a-fA-F]*(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i);
  if (!m) return [0, 0];
  const s = m[0].trim().toLowerCase();
  let v;
  if (/inf/.test(s)) v = s.startsWith("-") ? -Infinity : Infinity;
  else if (/nan/.test(s)) v = NaN;
  else v = parseFloat(s);
  return [v, utf8(m[0]).length];
}

function setEnd(rt, endp, base, used, line) {
  if (endp !== null && endp !== undefined) rt.storeAt(endp, new Ptr(base.store, base.off + used), line);
}

const LONG_T = T.long;
const tmFields = ["tm_sec", "tm_min", "tm_hour", "tm_mday", "tm_mon", "tm_year", "tm_wday", "tm_yday", "tm_isdst"];

function tmFromDate(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return [d.getUTCSeconds(), d.getUTCMinutes(), d.getUTCHours(), d.getUTCDate(), d.getUTCMonth(),
    d.getUTCFullYear() - 1900, d.getUTCDay(), Math.floor((d.getTime() - start) / 86400000), 0];
}

function tmStore(rt, name) {
  if (!rt.tmStores) rt.tmStores = {};
  if (!rt.tmStores[name]) {
    const type = rt.builtinTypes.tm;
    rt.tmStores[name] = new Store(cells(type), name, type);
  }
  return rt.tmStores[name];
}

function readTm(rt, p, line) {
  return tmFields.map((_, i) => Number(rt.load(new Ptr(p.store, p.off + i), line)));
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const two = (n) => String(n).padStart(2, "0");

function strftimeText(fmt, tm) {
  const [sec, min, hour, mday, mon, year, wday, yday] = tm;
  return fmt.replace(/%(.)/g, (m, c) => ({
    Y: String(year + 1900), y: two((year + 1900) % 100), m: two(mon + 1), d: two(mday), e: String(mday).padStart(2, " "),
    H: two(hour), I: two(hour % 12 || 12), M: two(min), S: two(sec), p: hour < 12 ? "AM" : "PM",
    a: DAYS[wday], A: FULL_DAYS[wday], b: MONTHS[mon], B: FULL_MONTHS[mon], j: String(yday + 1).padStart(3, "0"),
    F: `${year + 1900}-${two(mon + 1)}-${two(mday)}`, T: `${two(hour)}:${two(min)}:${two(sec)}`, "%": "%",
    c: `${DAYS[wday]} ${MONTHS[mon]} ${String(mday).padStart(2, " ")} ${two(hour)}:${two(min)}:${two(sec)} ${year + 1900}`,
  }[c] ?? m));
}

const mathF = (fn) => ({ header: "math.h", ret: T.float, params: [T.float], impl: (rt, [x]) => Math.fround(fn(x)) });
const roundHalfEven = (x) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

Object.assign(BUILTINS, {
  // ---------- stdio ----------
  sscanf: { header: "stdio.h", ret: T.int, params: [charPtr, charPtr], variadic: true, format: "scanf", formatIndex: 1,
    impl(rt, [s, fmt, ...targets], line, types) {
      return doScanf(rt, stringReader(cstr(rt, s, line)), cstr(rt, fmt, line), targets, types.slice(2).map((t) => t.to), line);
    } },
  perror: { header: "stdio.h", ret: T.void, params: [charPtr],
    impl(rt, [s], line) {
      const prefix = s === null ? "" : textOf(rt, s, line);
      rt.writeTo(STDERR, utf8(`${prefix ? `${prefix}: ` : ""}${ERRNO_TEXT[rt.getErrno()] ?? `Unknown error ${rt.getErrno()}`}\n`), line);
    } },
  fseek: { header: "stdio.h", ret: T.int, params: [FILE_T, T.long, T.int],
    impl(rt, [f, off, whence], line) {
      const h = rt.openHandle(f, line, "any");
      const base = whence === 0 ? 0 : whence === 1 ? h.pos : h.data.length;
      const pos = base + Number(off);
      if (pos < 0) return -1;
      h.pos = pos;
      h.eof = false;
      return 0;
    } },
  ftell: { header: "stdio.h", ret: T.long, params: [FILE_T], impl: (rt, [f], line) => BigInt(rt.openHandle(f, line, "any").pos) },
  fwrite: { header: "stdio.h", ret: T.ulong, params: [voidPtr, T.ulong, T.ulong, FILE_T],
    impl(rt, [p, size, n, f], line) {
      const total = Number(size) * Number(n);
      if (total === 0) return 0n;
      rt.writeTo(f, bytesOf(rt, p, total, line), line);
      return BigInt(n);
    } },
  fread: { header: "stdio.h", ret: T.ulong, params: [voidPtr, T.ulong, T.ulong, FILE_T],
    impl(rt, [p, size, n, f], line) {
      const src = rt.reader(f, line);
      const sz = Number(size);
      const bytes = [];
      for (let i = 0; i < sz * Number(n); i++) {
        const b = src.read();
        if (b < 0) break;
        bytes.push(b);
      }
      const whole = sz > 0 ? Math.floor(bytes.length / sz) : 0;
      if (whole > 0) writeBytes(rt, p, bytes.slice(0, whole * sz), line);
      return BigInt(whole);
    } },
  ungetc: { header: "stdio.h", ret: T.int, params: [T.int, FILE_T],
    impl(rt, [c, f], line) {
      if (c < 0) return -1;
      if (f === STDIN) {
        if (rt.pos > 0) rt.pos--;
        return c;
      }
      const h = rt.openHandle(f, line, "any");
      if (h.pos > 0) { h.pos--; h.data[h.pos] = c & 255; }
      h.eof = false;
      return c;
    } },
  getline: undefined,

  // ---------- stdlib ----------
  strtol: { header: "stdlib.h", ret: T.long, params: [charPtr, ptr(charPtr), T.int],
    impl(rt, [s, e, base], line) { const [v, used] = parseInteger(cstr(rt, s, line), base); setEnd(rt, e, s, used, line); return convert(v, T.llong, T.long); } },
  strtoll: { header: "stdlib.h", ret: T.llong, params: [charPtr, ptr(charPtr), T.int],
    impl(rt, [s, e, base], line) { const [v, used] = parseInteger(cstr(rt, s, line), base); setEnd(rt, e, s, used, line); return convert(v, T.llong, T.llong); } },
  strtoul: { header: "stdlib.h", ret: T.ulong, params: [charPtr, ptr(charPtr), T.int],
    impl(rt, [s, e, base], line) { const [v, used] = parseInteger(cstr(rt, s, line), base); setEnd(rt, e, s, used, line); return BigInt.asUintN(64, v); } },
  strtoull: { header: "stdlib.h", ret: T.ullong, params: [charPtr, ptr(charPtr), T.int],
    impl(rt, [s, e, base], line) { const [v, used] = parseInteger(cstr(rt, s, line), base); setEnd(rt, e, s, used, line); return BigInt.asUintN(64, v); } },
  strtod: { header: "stdlib.h", ret: D, params: [charPtr, ptr(charPtr)],
    impl(rt, [s, e], line) { const [v, used] = parseDouble(cstr(rt, s, line)); setEnd(rt, e, s, used, line); return v; } },
  strtof: { header: "stdlib.h", ret: T.float, params: [charPtr, ptr(charPtr)],
    impl(rt, [s, e], line) { const [v, used] = parseDouble(cstr(rt, s, line)); setEnd(rt, e, s, used, line); return Math.fround(v); } },
  atol: { header: "stdlib.h", ret: T.long, params: [charPtr], impl: (rt, [s], line) => convert(parseInteger(cstr(rt, s, line), 10)[0], T.llong, T.long) },
  atoll: { header: "stdlib.h", ret: T.llong, params: [charPtr], impl: (rt, [s], line) => convert(parseInteger(cstr(rt, s, line), 10)[0], T.llong, T.llong) },
  realloc: { header: "stdlib.h", ret: voidPtr, params: [voidPtr, T.ulong],
    impl(rt, [p, size], line) {
      const n = Number(size);
      if (p === null) return malloc(rt, size, false, line);
      if (!p.store.heap || p.off !== 0) throw runtimeError(line, "malloc으로 받지 않은 메모리를 realloc하려고 했어요");
      if (p.store.freed) throw runtimeError(line, "free한 메모리를 realloc하려고 했어요");
      if (n === 0) { p.store.freed = true; return null; }
      const old = p.store;
      const fresh = malloc(rt, size, false, line);
      if (!old.untyped) {
        retypeHeap(fresh, old.type.of, line);
        const keep = Math.min(old.cells.length, fresh.store.cells.length);
        for (let i = 0; i < keep; i++) fresh.store.cells[i] = old.cells[i];
      }
      old.freed = true;
      return fresh;
    } },
  div: { header: "stdlib.h", ret: "div_t", params: [T.int, T.int],
    impl(rt, [a, b], line) { if (b === 0) throw runtimeError(line, "0으로 나눴어요"); return [Math.trunc(a / b) | 0, (a % b) | 0]; } },
  ldiv: { header: "stdlib.h", ret: "ldiv_t", params: [T.long, T.long],
    impl(rt, [a, b], line) { if (b === 0n) throw runtimeError(line, "0으로 나눴어요"); return [a / b, a % b]; } },
  lldiv: { header: "stdlib.h", ret: "lldiv_t", params: [T.llong, T.llong],
    impl(rt, [a, b], line) { if (b === 0n) throw runtimeError(line, "0으로 나눴어요"); return [a / b, a % b]; } },
  abort: { header: "stdlib.h", ret: T.void, params: [],
    impl(rt, args, line) { throw runtimeError(line, "abort()로 프로그램을 멈췄어요", "abort는 프로그램을 바로 비정상 종료시켜요."); } },
  atexit: { header: "stdlib.h", ret: T.int, params: [{ k: "ptr", to: { k: "func", ret: T.void, params: [] }, size: 8 }],
    impl(rt, [fn]) { rt.atexitFns.push(fn); return 0; } },
  getenv: { header: "stdlib.h", ret: charPtr, params: [charPtr], impl: () => null },
  system: { header: "stdlib.h", ret: T.int, params: [charPtr],
    impl(rt, args, line) { throw runtimeError(line, "system()은 이 앱에서 쓸 수 없어요", "아이패드 브라우저 안에서는 다른 프로그램을 실행할 수 없어요."); } },

  // ---------- string ----------
  memmove: { writes: [0], header: "string.h", ret: voidPtr, params: [voidPtr, voidPtr, T.ulong],
    impl(rt, [d, s, n], line) { if (Number(n) > 0) writeBytes(rt, d, bytesOf(rt, s, Number(n), line), line); return d; } },
  memcmp: { header: "string.h", ret: T.int, params: [voidPtr, voidPtr, T.ulong],
    impl(rt, [a, b, n], line) {
      const x = bytesOf(rt, a, Number(n), line);
      const y = bytesOf(rt, b, Number(n), line);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return 0;
    } },
  memchr: { header: "string.h", ret: voidPtr, params: [voidPtr, T.int, T.ulong],
    impl(rt, [p, c, n], line) {
      const bytes = bytesOf(rt, p, Number(n), line);
      const i = bytes.indexOf(c & 255);
      return i < 0 ? null : new Ptr(p.store, p.off + i);
    } },
  strspn: { header: "string.h", ret: T.ulong, params: [charPtr, charPtr],
    impl(rt, [s, a], line) { const set = new Set(cstr(rt, a, line)); const b = cstr(rt, s, line); let i = 0; while (i < b.length && set.has(b[i])) i++; return BigInt(i); } },
  strcspn: { header: "string.h", ret: T.ulong, params: [charPtr, charPtr],
    impl(rt, [s, r], line) { const set = new Set(cstr(rt, r, line)); const b = cstr(rt, s, line); let i = 0; while (i < b.length && !set.has(b[i])) i++; return BigInt(i); } },
  strpbrk: { header: "string.h", ret: charPtr, params: [charPtr, charPtr],
    impl(rt, [s, a], line) { const set = new Set(cstr(rt, a, line)); const i = cstr(rt, s, line).findIndex((b) => set.has(b)); return i < 0 ? null : new Ptr(s.store, s.off + i); } },
  strdup: { header: "string.h", ret: charPtr, params: [charPtr], impl: (rt, [s], line) => heapString(cstr(rt, s, line)) },
  strndup: { header: "string.h", ret: charPtr, params: [charPtr, T.ulong], impl: (rt, [s, n], line) => heapString(cstr(rt, s, line).slice(0, Number(n))) },
  strerror: { header: "string.h", ret: charPtr, params: [T.int], impl: (rt, [e]) => constString(rt, ERRNO_TEXT[e] ?? `Unknown error ${e}`) },
  strcoll: { header: "string.h", ret: T.int, params: [charPtr, charPtr], impl: (rt, args, line) => BUILTINS.strcmp.impl(rt, args, line) },

  // ---------- math ----------
  isnan: { header: "math.h", ret: T.int, params: [D], impl: (rt, [x]) => (Number.isNaN(x) ? 1 : 0) },
  isinf: { header: "math.h", ret: T.int, params: [D], impl: (rt, [x]) => (x === Infinity ? 1 : x === -Infinity ? -1 : 0) },
  isfinite: { header: "math.h", ret: T.int, params: [D], impl: (rt, [x]) => (Number.isFinite(x) ? 1 : 0) },
  signbit: { header: "math.h", ret: T.int, params: [D], impl: (rt, [x]) => (x < 0 || Object.is(x, -0) ? 1 : 0) },
  modf: { header: "math.h", ret: D, params: [D, ptr(D)],
    impl(rt, [x, ip], line) { const i = Math.trunc(x); rt.storeAt(ip, i, line); return x - i; } },
  frexp: { header: "math.h", ret: D, params: [D, ptr(T.int)],
    impl(rt, [x, ep], line) {
      if (x === 0 || !Number.isFinite(x)) { rt.storeAt(ep, 0, line); return x; }
      const e = Math.floor(Math.log2(Math.abs(x))) + 1;
      rt.storeAt(ep, e, line);
      return x / 2 ** e;
    } },
  ldexp: { header: "math.h", ret: D, params: [D, T.int], impl: (rt, [x, e]) => x * 2 ** e },
  exp2: mathFn((x) => 2 ** x), log1p: mathFn(Math.log1p), expm1: mathFn(Math.expm1),
  sinh: mathFn(Math.sinh), cosh: mathFn(Math.cosh), tanh: mathFn(Math.tanh),
  asinh: mathFn(Math.asinh), acosh: mathFn(Math.acosh), atanh: mathFn(Math.atanh),
  rint: mathFn(roundHalfEven), nearbyint: mathFn(roundHalfEven),
  lround: { header: "math.h", ret: T.long, params: [D], impl: (rt, [x]) => BigInt(x < 0 ? -Math.round(-x) : Math.round(x)) },
  llround: { header: "math.h", ret: T.llong, params: [D], impl: (rt, [x]) => BigInt(x < 0 ? -Math.round(-x) : Math.round(x)) },
  lrint: { header: "math.h", ret: T.long, params: [D], impl: (rt, [x]) => BigInt(roundHalfEven(x)) },
  copysign: math2((x, y) => (y < 0 || Object.is(y, -0) ? -Math.abs(x) : Math.abs(x))),
  fdim: math2((x, y) => (x > y ? x - y : 0)),
  fma: { header: "math.h", ret: D, params: [D, D, D], impl: (rt, [x, y, z]) => x * y + z },
  sqrtf: mathF(Math.sqrt), fabsf: mathF(Math.abs), floorf: mathF(Math.floor), ceilf: mathF(Math.ceil),
  roundf: mathF((x) => (x < 0 ? -Math.round(-x) : Math.round(x))), sinf: mathF(Math.sin), cosf: mathF(Math.cos),
  tanf: mathF(Math.tan), expf: mathF(Math.exp), logf: mathF(Math.log),
  powf: { header: "math.h", ret: T.float, params: [T.float, T.float], impl: (rt, [x, y]) => Math.fround(x ** y) },

  // ---------- ctype ----------
  isprint: ctypeFn((c) => (c >= 32 && c < 127 ? 1 : 0)),
  iscntrl: ctypeFn((c) => ((c >= 0 && c < 32) || c === 127 ? 1 : 0)),
  isgraph: ctypeFn((c) => (c > 32 && c < 127 ? 1 : 0)),
  isblank: ctypeFn((c) => (c === 32 || c === 9 ? 1 : 0)),

  // ---------- time ----------
  gmtime: { header: "time.h", ret: "tm*", params: [ptr(T.long)],
    impl(rt, [tp], line) {
      const st = tmStore(rt, "gmtime 결과");
      tmFromDate(new Date(Number(rt.load(tp, line)) * 1000)).forEach((v, i) => { st.cells[i] = v; });
      return new Ptr(st, 0);
    } },
  localtime: { header: "time.h", ret: "tm*", params: [ptr(T.long)],
    impl(rt, [tp], line) {
      const st = tmStore(rt, "localtime 결과");
      tmFromDate(new Date((Number(rt.load(tp, line)) - rt.tzOffset * 60) * 1000)).forEach((v, i) => { st.cells[i] = v; });
      return new Ptr(st, 0);
    } },
  mktime: { header: "time.h", ret: T.long, params: ["tm*"],
    impl(rt, [p], line) {
      const [sec, min, hour, mday, mon, year] = readTm(rt, p, line);
      const ms = Date.UTC(year + 1900, mon, mday, hour, min, sec);
      const fixed = tmFromDate(new Date(ms));
      fixed.forEach((v, i) => rt.storeAt(new Ptr(p.store, p.off + i), v, line));
      return BigInt(Math.floor(ms / 1000) + rt.tzOffset * 60);
    } },
  difftime: { header: "time.h", ret: D, params: [T.long, T.long], impl: (rt, [a, b]) => Number(a - b) },
  strftime: { writes: [0], header: "time.h", ret: T.ulong, params: [charPtr, T.ulong, charPtr, "tm*"],
    impl(rt, [buf, max, fmt, p], line) {
      const bytes = utf8(strftimeText(textOf(rt, fmt, line), readTm(rt, p, line)));
      if (bytes.length + 1 > Number(max)) return 0n;
      rt.writeCString(buf, bytes, line);
      return BigInt(bytes.length);
    } },
  asctime: { header: "time.h", ret: charPtr, params: ["tm*"],
    impl: (rt, [p], line) => constString(rt, `${strftimeText("%c", readTm(rt, p, line))}\n`) },
  ctime: { header: "time.h", ret: charPtr, params: [ptr(T.long)],
    impl(rt, [tp], line) {
      const tm = tmFromDate(new Date((Number(rt.load(tp, line)) - rt.tzOffset * 60) * 1000));
      return constString(rt, `${strftimeText("%c", tm)}\n`);
    } },

  // ---------- setjmp ----------
  setjmp: { header: "setjmp.h", ret: T.int, params: ["jmpbuf*"],
    impl(rt, [b], line) {
      if (!rt.jmpCtx) {
        throw runtimeError(line, "setjmp는 문장 맨 바깥에서 써 주세요", "예: if (setjmp(buf) == 0) { ... }  또는  int r = setjmp(buf);");
      }
      rt.storeAt(b, { jmp: rt.jmpCtx }, line);
      const v = rt.jumpValue;
      rt.jumpValue = undefined;
      return v ?? 0;
    } },
  longjmp: { header: "setjmp.h", ret: T.void, params: ["jmpbuf*", T.int],
    impl(rt, [b, v], line) {
      rt.check(b, line, false);
      const cell = b.store.cells[b.off];
      if (!cell || !cell.jmp) throw runtimeError(line, "setjmp를 부르지 않은 jmp_buf로 longjmp를 했어요", "먼저 setjmp(buf)로 돌아올 자리를 정해 주세요.");
      if (cell.jmp.token.dead) {
        throw runtimeError(line, "이미 끝난 블록(함수)의 setjmp 자리로는 돌아갈 수 없어요", "setjmp를 부른 함수가 아직 실행 중일 때만 longjmp로 돌아갈 수 있어요.");
      }
      throw new JumpSignal(cell.jmp, v === 0 ? 1 : v);
    } },

  // ---------- assert ----------
  __assert_check: { header: "assert.h", ret: T.void, params: [T.int, charPtr, T.int],
    impl(rt, [ok, text, at]) {
      if (!ok) {
        throw runtimeError(at, `assert가 실패했어요: ${textOf(rt, text, at)}`,
          "assert(조건)의 조건이 거짓이라 프로그램을 멈췄어요. 조건이 왜 거짓이 되었는지 확인해 보세요.");
      }
    } },
});
delete BUILTINS.getline;

// =====================================================================
// C++ <iostream>: cout << 값, cin >> 변수
// =====================================================================

export const OSTREAM = { k: "stream", name: "std::ostream", dir: "out", size: 8 };
export const ISTREAM = { k: "stream", name: "std::istream", dir: "in", size: 8 };
/** endl, fixed, setw(3) 같은 조작자의 타입 */
export const MANIP = { k: "manip", name: "조작자", size: 8 };

/** cout, cin 같은 이름이 가리키는 스트림과 방향 */
export const STD_STREAMS = {
  cout: { stream: STDOUT, type: OSTREAM },
  cerr: { stream: STDERR, type: OSTREAM },
  clog: { stream: STDERR, type: OSTREAM },
  cin: { stream: STDIN, type: ISTREAM },
};

const STREAM_DEFAULTS = {
  precision: 6, float: null, width: 0, fill: 32, left: false, boolalpha: false, showpoint: false, showpos: false,
  uppercase: false, base: 10, fail: false, eof: false,
};

Runtime.prototype.streamState = function streamState(s) {
  if (!this.streams) this.streams = new Map();
  let st = this.streams.get(s);
  if (!st) {
    st = { ...STREAM_DEFAULTS };
    this.streams.set(s, st);
  }
  return st;
};

/** 괄호 없이 쓰는 조작자 (<iostream>) */
export const MANIPULATORS = {
  endl: (rt, s, st, line) => rt.writeTo(s, [10], line),
  ends: (rt, s, st, line) => rt.writeTo(s, [0], line),
  flush: () => {},
  fixed: (rt, s, st) => { st.float = "fixed"; },
  scientific: (rt, s, st) => { st.float = "sci"; },
  defaultfloat: (rt, s, st) => { st.float = null; },
  left: (rt, s, st) => { st.left = true; },
  right: (rt, s, st) => { st.left = false; },
  boolalpha: (rt, s, st) => { st.boolalpha = true; },
  noboolalpha: (rt, s, st) => { st.boolalpha = false; },
  showpoint: (rt, s, st) => { st.showpoint = true; },
  noshowpoint: (rt, s, st) => { st.showpoint = false; },
  showpos: (rt, s, st) => { st.showpos = true; },
  noshowpos: (rt, s, st) => { st.showpos = false; },
  uppercase: (rt, s, st) => { st.uppercase = true; },
  nouppercase: (rt, s, st) => { st.uppercase = false; },
  hex: (rt, s, st) => { st.base = 16; },
  oct: (rt, s, st) => { st.base = 8; },
  dec: (rt, s, st) => { st.base = 10; },
};

/** 괄호와 값을 받는 조작자 (<iomanip>) */
export const MANIP_MAKERS = {
  setprecision: (n) => (rt, s, st) => { st.precision = Math.max(0, n); },
  setw: (n) => (rt, s, st) => { st.width = Math.max(0, n); },
  setfill: (c) => (rt, s, st) => { st.fill = c & 255; },
};

/** cout << 값: C++의 규칙대로 글자로 바꿔서 내보내요 */
export function streamPut(rt, s, type, v, line) {
  const st = rt.streamState(s);
  if (type.k === "manip") {
    v(rt, s, st, line);
    return;
  }
  let bytes = null;
  let text = null;
  if (type.k === "string") {
    bytes = strBytes(v);
  } else if (isInt(type) && type.isBool) {
    text = st.boolalpha ? (v ? "true" : "false") : v ? "1" : "0";
  } else if (isInt(type) && type.bits === 8) {
    bytes = [v & 255]; // char는 숫자가 아니라 글자로 나와요
  } else if (isInt(type)) {
    let n = BigInt(v);
    if (st.base !== 10) n = BigInt.asUintN(type.bits, n);
    text = n.toString(st.base);
    if (st.uppercase) text = text.toUpperCase();
    if (st.showpos && st.base === 10 && n >= 0n) text = `+${text}`;
  } else if (isFloat(type)) {
    const conv = st.float === "fixed" ? "f" : st.float === "sci" ? "e" : "g";
    const { text: body, negative } = formatFloat(v, st.uppercase ? conv.toUpperCase() : conv, st.precision, st.showpoint);
    text = `${negative ? "-" : st.showpos ? "+" : ""}${body}`;
  } else if (isPtr(type)) {
    if (isCharLike(type.to) && !(v instanceof FnRef)) {
      if (v === null) {
        throw runtimeError(line, "NULL인 문자열(char *)을 cout으로 출력하려고 했어요", "진짜 C++에서는 프로그램이 멈추는 실수예요. 문자열이 들어 있는지 확인해 주세요.");
      }
      bytes = rt.readCString(v, line);
    } else if (v instanceof FnRef) text = "1";
    else text = v === null ? "0" : fakeAddress(v);
  }
  if (!bytes) bytes = utf8(text);
  if (st.width > bytes.length) {
    const fill = new Array(st.width - bytes.length).fill(st.fill);
    bytes = st.left ? [...bytes, ...fill] : [...fill, ...bytes];
  }
  st.width = 0; // setw는 바로 다음 값 하나에만 쓰여요
  rt.writeTo(s, bytes, line);
}

/** cin >> 변수: 공백을 건너뛰고 변수의 타입에 맞는 값 하나를 읽어요. 읽지 못하면 cin이 '실패' 상태가 돼요. */
export function streamGet(rt, target, type, line) {
  const st = rt.streamState(STDIN);
  if (st.fail) return; // 한 번 실패한 cin은 cin.clear() 전까지 아무것도 읽지 않아요
  const src = rt.reader(STDIN, line);
  while (isSpace(src.peek())) src.read();
  if (src.peek() < 0) {
    st.fail = true;
    st.eof = true;
    return;
  }
  if (isArr(type)) {
    const bytes = [];
    while (src.peek() >= 0 && !isSpace(src.peek())) bytes.push(src.read());
    rt.writeCString(target, bytes, line);
    return;
  }
  if (isInt(type) && type.bits === 8) {
    rt.storeAt(target, convert(src.read(), T.int, type), line);
    return;
  }
  const conv = isFloat(type) ? "f" : type.unsigned && !type.isBool ? "u" : "d";
  const text = scanToken(src, conv, null);
  if (text === null) {
    st.fail = true; // 숫자 자리에 글자가 오면 0을 넣고 실패해요 (C++11)
    rt.storeAt(target, convert(0, T.int, type), line);
    return;
  }
  if (isFloat(type)) {
    rt.storeAt(target, convert(parseFloat(text), T.double, type), line);
    return;
  }
  let v = parseIntToken(text, conv);
  if (type.isBool && v !== 0n && v !== 1n) {
    st.fail = true;
    v = 0n;
  }
  rt.storeAt(target, convert(v, T.llong, type), line);
}

/** cin.get(): 글자 하나 (공백 포함). 끝이면 EOF(-1) */
export function streamGetChar(rt, line) {
  const st = rt.streamState(STDIN);
  if (st.fail) return -1;
  const b = rt.reader(STDIN, line).read();
  if (b < 0) {
    st.fail = true;
    st.eof = true;
    return -1;
  }
  return b;
}

/** cin.ignore(n, 끝글자): 끝글자까지(또는 n글자) 버려요 */
export function streamIgnore(rt, n, delim, line) {
  const st = rt.streamState(STDIN);
  if (st.fail) return;
  const src = rt.reader(STDIN, line);
  for (let i = 0; i < n; i++) {
    const b = src.read();
    if (b < 0) { st.eof = true; return; }
    if (b === delim) return;
  }
}


// =====================================================================
// C++ std::string, std::vector
// 값 하나가 Store 하나예요. string은 char 칸들 + 끝의 0, vector는 원소 칸들.
// 변수에서 값을 꺼내 쓸 때(복사) 새 Store를 만들어서, 두 변수가 서로 영향을 주지 않아요.
// 비어 있는 값은 null로 두었다가 처음 바꿀 때 만들어요.
// =====================================================================

export const NPOS = 18446744073709551615n;

export function newString(bytes) {
  const st = new Store(bytes.length + 1, "string", arr(T.char, bytes.length + 1));
  for (let i = 0; i < bytes.length; i++) st.cells[i] = convert(bytes[i], T.int, T.char);
  st.cells[bytes.length] = 0;
  st.isString = true;
  return st;
}

/** string의 바이트들 (0~255) */
export function strBytes(st) {
  if (!st) return [];
  const out = new Array(st.cells.length - 1);
  for (let i = 0; i < out.length; i++) out[i] = st.cells[i] & 255;
  return out;
}

export const strLen = (st) => (st ? st.cells.length - 1 : 0);

/** string의 내용을 통째로 바꿔요 (같은 Store를 그대로 써서 가리키던 주소가 살아 있어요) */
export function setStr(st, bytes) {
  st.cells.length = 0;
  for (const b of bytes) st.cells.push(convert(b, T.int, T.char));
  st.cells.push(0);
  st.type = arr(T.char, st.cells.length);
}

export function newVector(of, cellsArr = []) {
  const unit = cells(of);
  const st = new Store(0, "vector", arr(of, cellsArr.length / unit));
  st.cells = cellsArr;
  st.isVector = true;
  st.unit = unit;
  st.of = of;
  return st;
}

export const vecLen = (st) => (st ? st.cells.length / st.unit : 0);

export function vecResized(st) {
  st.type = arr(st.of, st.cells.length / st.unit);
}

/** 값 하나를 깊게 복사해요 (string, vector, 그 둘을 품은 구조체) */
export function cloneValue(type, v) {
  if (v === null || v === undefined) return v;
  if (type.k === "string") {
    const st = new Store(0, "string", v.type);
    st.cells = v.cells.slice();
    st.isString = true;
    return st;
  }
  if (type.k === "vector") {
    return newVector(type.of, cloneCells(arr(type.of, v.cells.length / v.unit), v.cells));
  }
  return v;
}

/** 칸 목록을 복사해요. 안에 string/vector가 있으면 그것도 새로 만들어요. */
export function cloneCells(type, cellsArr) {
  const out = cellsArr.slice();
  if (!hasObj(type)) return out;
  const walk = (t, off) => {
    if (isObj(t)) out[off] = cloneValue(t, out[off]);
    else if (isStruct(t)) { for (const f of t.fields) walk(f.type, off + f.off); }
    else if (isArr(t)) { const u = cells(t.of); for (let i = 0; i < t.len; i++) walk(t.of, off + i * u); }
  };
  walk(type, 0);
  return out;
}

/** 두 string 비교: 음수, 0, 양수 */
export function strCompare(a, b) {
  const x = strBytes(a);
  const y = strBytes(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** cin >> s: 공백 전까지 한 단어 */
export function streamGetWord(rt, line) {
  const st = rt.streamState(STDIN);
  if (st.fail) return null;
  const src = rt.reader(STDIN, line);
  while (isSpace(src.peek())) src.read();
  if (src.peek() < 0) {
    st.fail = true;
    st.eof = true;
    return null;
  }
  const bytes = [];
  while (src.peek() >= 0 && !isSpace(src.peek())) bytes.push(src.read());
  return bytes;
}

/** getline(cin, s): 줄 끝(\n)까지 읽고 \n은 버려요 */
export function streamGetLine(rt, delim, line) {
  const st = rt.streamState(STDIN);
  if (st.fail) return null;
  const src = rt.reader(STDIN, line);
  if (src.peek() < 0) {
    st.fail = true;
    st.eof = true;
    return null;
  }
  const bytes = [];
  for (;;) {
    const b = src.read();
    if (b < 0) { st.eof = true; break; }
    if (b === delim) break;
    bytes.push(b);
  }
  return bytes;
}

/** to_string(값) */
export function toStringBytes(type, v) {
  if (isFloat(type)) {
    const { text, negative } = formatFloat(v, "f", 6);
    return utf8(`${negative ? "-" : ""}${text}`);
  }
  return utf8(String(v));
}

/** stoi("42") 같은 글자 → 숫자 */
export function parseNumber(bytes, kind, name, line) {
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  const m = kind === "float" ? text.match(/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/) : text.match(/^\s*[+-]?\d+/);
  if (!m) {
    throw runtimeError(line, `${name}("${text}"): 숫자로 바꿀 수 없어요`, "진짜 C++에서는 invalid_argument 예외가 나요. 글자가 숫자로 시작하는지 확인해 보세요.");
  }
  return kind === "float" ? parseFloat(m[0]) : BigInt(m[0].trim());
}
