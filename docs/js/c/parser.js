// 토큰을 읽어서 C 프로그램의 구조(구문 트리, AST)를 만들어요.

import { compileError, T, ptr, func } from "./types.js";

const BASE_WORDS = new Set(["void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "_Bool", "bool", "size_t"]);
const QUALIFIERS = new Set(["const", "volatile", "register", "auto", "inline", "restrict"]);
const STORAGE = new Set(["static", "extern"]);
const UNSUPPORTED_TYPES = { struct: "구조체(struct)", union: "공용체(union)", enum: "열거형(enum)", typedef: "typedef" };
export const KEYWORDS = new Set([
  ...BASE_WORDS, ...QUALIFIERS, ...STORAGE, ...Object.keys(UNSUPPORTED_TYPES),
  "if", "else", "while", "do", "for", "switch", "case", "default", "break", "continue", "return", "goto", "sizeof",
]);

const BINARY = {
  "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
  "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
};
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

function show(tok) {
  if (tok.k === "eof") return "코드 끝";
  if (tok.k === "str") return "문자열";
  if (tok.k === "num") return tok.text;
  return tok.v;
}

class Parser {
  constructor(tokens, includes) {
    this.t = tokens;
    this.i = 0;
    this.includes = includes;
  }

  get cur() { return this.t[this.i]; }
  peek(n = 1) { return this.t[Math.min(this.i + n, this.t.length - 1)]; }
  is(v, tok = this.cur) { return (tok.k === "op" || tok.k === "id") && tok.v === v; }
  next() { return this.t[this.i++]; }
  prev() { return this.t[this.i - 1]; }
  accept(v) { return this.is(v) ? this.next() : null; }

  expect(v, hint = "") {
    if (this.is(v)) return this.next();
    if (v === ";") {
      const line = this.prev() ? this.prev().line : this.cur.line;
      throw compileError(line, `${line}번째 줄 끝에 세미콜론(;)이 빠졌어요`, "C에서는 문장이 끝날 때마다 ; 를 붙여야 해요.");
    }
    throw compileError(this.cur.line, `'${v}'가 와야 하는데 '${show(this.cur)}'가 나왔어요`, hint);
  }

  isTypeStart(tok = this.cur) {
    if (tok.k !== "id") return false;
    return BASE_WORDS.has(tok.v) || QUALIFIERS.has(tok.v) || STORAGE.has(tok.v) || tok.v in UNSUPPORTED_TYPES;
  }

  // ---------- 타입 ----------
  declSpecs() {
    const line = this.cur.line;
    const words = [];
    let storage = null;
    while (this.cur.k === "id") {
      const v = this.cur.v;
      if (v in UNSUPPORTED_TYPES) {
        throw compileError(this.cur.line, `${UNSUPPORTED_TYPES[v]}는 아직 지원하지 않아요`, "지금은 int, double, char 같은 기본 타입과 배열, 포인터를 쓸 수 있어요.");
      }
      if (STORAGE.has(v)) storage = v;
      else if (BASE_WORDS.has(v)) words.push(v);
      else if (!QUALIFIERS.has(v)) break;
      this.next();
    }
    if (words.length === 0) {
      if (storage) throw compileError(line, `${storage} 뒤에 타입(int 등)이 필요해요`);
      return null;
    }
    return { type: this.combine(words, line), storage };
  }

  combine(words, line) {
    const count = (w) => words.filter((x) => x === w).length;
    const longs = count("long");
    const unsigned = count("unsigned") > 0;
    const signed = count("signed") > 0;
    const bad = () => compileError(line, `'${words.join(" ")}'는 올바른 타입이 아니에요`);
    if (unsigned && signed) throw bad();
    if (words.includes("bool")) {
      if (!this.includes.has("stdbool.h")) {
        throw compileError(line, "bool을 쓰려면 #include <stdbool.h>가 필요해요", "맨 위에 #include <stdbool.h> 를 넣어 주세요.");
      }
      if (words.length > 1) throw bad();
      return T.bool;
    }
    const only = (...allowed) => words.every((w) => allowed.includes(w));
    if (words.includes("void")) { if (words.length > 1) throw bad(); return T.void; }
    if (words.includes("_Bool")) { if (words.length > 1) throw bad(); return T.bool; }
    if (words.includes("size_t")) { if (words.length > 1) throw bad(); return T.ulong; }
    if (words.includes("float")) { if (words.length > 1) throw bad(); return T.float; }
    if (words.includes("double")) { if (!only("double", "long") || longs > 1) throw bad(); return T.double; }
    if (words.includes("char")) {
      if (!only("char", "signed", "unsigned") || count("char") > 1) throw bad();
      return unsigned ? T.uchar : signed ? T.schar : T.char;
    }
    if (count("int") > 1 || longs > 2) throw bad();
    if (words.includes("short")) { if (longs || count("short") > 1) throw bad(); return unsigned ? T.ushort : T.short; }
    if (longs === 2) return unsigned ? T.ullong : T.llong;
    if (longs === 1) return unsigned ? T.ulong : T.long;
    return unsigned ? T.uint : T.int;
  }

  /** 선언자: 별(*), 이름, [배열 크기], (매개변수). 이름 없는 형태(캐스트용)도 읽어요. */
  declarator(base, abstract = false) {
    let type = base;
    while (this.accept("*")) {
      type = ptr(type);
      while (this.cur.k === "id" && QUALIFIERS.has(this.cur.v)) this.next();
    }
    if (this.is("(") && !abstract) {
      throw compileError(this.cur.line, "괄호가 들어간 복잡한 선언은 아직 지원하지 않아요", "함수 포인터나 배열 포인터는 아직 쓸 수 없어요.");
    }
    const line = this.cur.line;
    let name = null;
    if (this.cur.k === "id" && !KEYWORDS.has(this.cur.v)) {
      name = this.next().v;
    } else if (!abstract) {
      if (this.cur.k === "id") {
        throw compileError(line, `'${this.cur.v}'는 C가 쓰는 낱말이라 이름으로 쓸 수 없어요`, "다른 이름을 써 주세요.");
      }
      throw compileError(line, `이름이 와야 하는데 '${show(this.cur)}'가 나왔어요`);
    }
    const dims = [];
    for (;;) {
      if (this.accept("[")) {
        if (this.accept("]")) dims.push(null);
        else {
          dims.push(this.conditional());
          this.expect("]");
        }
      } else if (this.is("(") && dims.length === 0 && name !== null && type.k !== "func") {
        type = this.params(type);
      } else break;
    }
    for (let k = dims.length - 1; k >= 0; k--) type = { k: "array", of: type, lenExpr: dims[k], line };
    return { name, type, line };
  }

  params(ret) {
    this.expect("(");
    const params = [];
    let variadic = false;
    if (this.accept(")")) return { ...func(ret, params), noProto: true };
    if (this.is("void") && this.is(")", this.peek())) {
      this.next();
      this.next();
      return func(ret, params);
    }
    do {
      if (this.accept("...")) { variadic = true; break; }
      const specs = this.declSpecs();
      if (!specs) throw compileError(this.cur.line, `매개변수 '${show(this.cur)}' 앞에 타입이 필요해요`, "예: int add(int a, int b)");
      const d = this.declarator(specs.type, true);
      params.push(d);
    } while (this.accept(","));
    this.expect(")", "매개변수 목록은 ) 로 닫아요.");
    return func(ret, params, variadic);
  }

  typeName() {
    const specs = this.declSpecs();
    const d = this.declarator(specs.type, true);
    if (d.name) throw compileError(d.line, "타입 이름 안에 변수 이름이 들어 있어요");
    return d.type;
  }

  // ---------- 프로그램 ----------
  program() {
    const items = [];
    while (this.cur.k !== "eof") {
      const line = this.cur.line;
      const specs = this.declSpecs();
      if (!specs) {
        if (this.cur.k === "id" && this.is("(", this.peek())) {
          throw compileError(line, `함수 ${this.cur.v} 앞에 돌려줄 값의 타입이 필요해요`, `예: int ${this.cur.v}(void) { ... }`);
        }
        throw compileError(line, `'${show(this.cur)}'는 여기에 올 수 없어요`, "함수나 변수 선언은 int, double 같은 타입으로 시작해요.");
      }
      if (this.accept(";")) continue;
      const d = this.declarator(specs.type);
      if (d.type.k === "func" && this.is("{")) {
        items.push({ k: "func", name: d.name, type: d.type, body: this.block(), line: d.line, storage: specs.storage });
      } else {
        items.push(this.declRest(specs, d));
      }
    }
    return { items };
  }

  declRest(specs, first) {
    const items = [];
    let d = first;
    for (;;) {
      let init = null;
      if (this.accept("=")) init = this.initializer();
      items.push({ ...d, init, storage: specs.storage });
      if (!this.accept(",")) break;
      d = this.declarator(specs.type);
    }
    this.expect(";");
    return { k: "decl", items, line: first.line };
  }

  initializer() {
    if (this.is("{")) {
      const line = this.next().line;
      const items = [];
      while (!this.is("}")) {
        if (this.is("[") || this.is(".")) throw compileError(this.cur.line, "지정 초기화([0] = …)는 아직 지원하지 않아요");
        items.push(this.initializer());
        if (!this.accept(",")) break;
      }
      this.expect("}", "중괄호 초기화 목록은 } 로 닫아요.");
      return { k: "initlist", items, line };
    }
    return this.assignment();
  }

  // ---------- 문장 ----------
  block() {
    const open = this.expect("{");
    const body = [];
    while (!this.is("}")) {
      if (this.cur.k === "eof") {
        throw compileError(open.line, `${open.line}번째 줄의 { 가 닫히지 않았어요`, "여는 중괄호 { 와 닫는 중괄호 } 의 짝을 맞춰 주세요.");
      }
      body.push(this.statement());
    }
    this.next();
    return { k: "block", body, line: open.line };
  }

  statement() {
    const tok = this.cur;
    const line = tok.line;
    if (this.is("{")) return this.block();
    if (tok.k === "id") {
      switch (tok.v) {
        case "if": {
          this.next();
          this.expect("(", "if 뒤의 조건은 괄호로 감싸요. 예: if (x > 0)");
          const cond = this.expression();
          this.expect(")");
          const then = this.statement();
          const otherwise = this.accept("else") ? this.statement() : null;
          return { k: "if", cond, then, otherwise, line };
        }
        case "else":
          throw compileError(line, "else 앞에 짝이 되는 if가 없어요", "if 문장 바로 뒤에 else가 와야 해요. 중간에 ; 가 들어갔는지 확인해 보세요.");
        case "while": {
          this.next();
          this.expect("(", "while 뒤의 조건은 괄호로 감싸요.");
          const cond = this.expression();
          this.expect(")");
          return { k: "while", cond, body: this.statement(), line };
        }
        case "do": {
          this.next();
          const body = this.statement();
          if (!this.accept("while")) throw compileError(this.cur.line, "do { … } 뒤에 while (조건); 이 필요해요");
          this.expect("(");
          const cond = this.expression();
          this.expect(")");
          this.expect(";");
          return { k: "dowhile", cond, body, line };
        }
        case "for": {
          this.next();
          this.expect("(", "for 뒤에는 ( 초기값; 조건; 증가 ) 가 와요.");
          let init = null;
          if (this.isTypeStart()) {
            const specs = this.declSpecs();
            init = this.declRest(specs, this.declarator(specs.type));
          } else {
            if (!this.is(";")) init = { k: "expr", e: this.expression(), line };
            this.expect(";");
          }
          const cond = this.is(";") ? null : this.expression();
          this.expect(";");
          const step = this.is(")") ? null : this.expression();
          this.expect(")", "for 의 괄호 안에는 ; 가 두 개 있어야 해요.");
          return { k: "for", init, cond, step, body: this.statement(), line };
        }
        case "switch": {
          this.next();
          this.expect("(");
          const e = this.expression();
          this.expect(")");
          if (!this.is("{")) throw compileError(this.cur.line, "switch 다음에는 { 로 시작하는 묶음이 와야 해요");
          return { k: "switch", e, body: this.block(), line };
        }
        case "case": {
          this.next();
          const e = this.conditional();
          this.expect(":", "case 값 뒤에는 : 를 붙여요. 예: case 1:");
          return { k: "case", e, line };
        }
        case "default":
          this.next();
          this.expect(":", "default 뒤에는 : 를 붙여요.");
          return { k: "default", line };
        case "break":
          this.next();
          this.expect(";");
          return { k: "break", line };
        case "continue":
          this.next();
          this.expect(";");
          return { k: "continue", line };
        case "return": {
          this.next();
          const e = this.is(";") ? null : this.expression();
          this.expect(";");
          return { k: "return", e, line };
        }
        case "goto":
          throw compileError(line, "goto는 지원하지 않아요", "반복문과 break, continue를 써 보세요.");
        default:
          break;
      }
      if (this.isTypeStart()) {
        const specs = this.declSpecs();
        return this.declRest(specs, this.declarator(specs.type));
      }
      if (this.is(":", this.peek()) && !KEYWORDS.has(tok.v)) {
        throw compileError(line, "이름표(label:)는 지원하지 않아요");
      }
    }
    if (this.accept(";")) return { k: "empty", line };
    const e = this.expression();
    this.expect(";");
    return { k: "expr", e, line };
  }

  // ---------- 식 ----------
  expression() {
    let e = this.assignment();
    while (this.is(",")) {
      const line = this.next().line;
      e = { k: "comma", l: e, r: this.assignment(), line };
    }
    return e;
  }

  assignment() {
    const l = this.conditional();
    if (this.cur.k === "op" && ASSIGN.has(this.cur.v)) {
      const op = this.next();
      return { k: "assign", op: op.v, l, r: this.assignment(), line: op.line };
    }
    return l;
  }

  conditional() {
    const c = this.binary(1);
    if (this.is("?")) {
      const line = this.next().line;
      const a = this.expression();
      this.expect(":", "조건 ? 값1 : 값2 형태로 써요.");
      return { k: "cond", c, a, b: this.conditional(), line };
    }
    return c;
  }

  binary(min) {
    let l = this.unary();
    for (;;) {
      const tok = this.cur;
      const prec = tok.k === "op" ? BINARY[tok.v] : undefined;
      if (prec === undefined || prec < min) return l;
      this.next();
      l = { k: "bin", op: tok.v, l, r: this.binary(prec + 1), line: tok.line };
    }
  }

  unary() {
    const tok = this.cur;
    const line = tok.line;
    if (tok.k === "op") {
      if (tok.v === "++" || tok.v === "--") {
        this.next();
        return { k: "pre", op: tok.v, e: this.unary(), line };
      }
      if (["+", "-", "!", "~", "*", "&"].includes(tok.v)) {
        this.next();
        return { k: "unary", op: tok.v, e: this.unary(), line };
      }
      if (tok.v === "(" && this.isTypeStart(this.peek())) {
        this.next();
        const type = this.typeName();
        this.expect(")");
        if (this.is("{")) throw compileError(line, "복합 리터럴 ((타입){…})은 아직 지원하지 않아요");
        return { k: "cast", type, e: this.unary(), line };
      }
    }
    if (this.is("sizeof")) {
      this.next();
      if (this.is("(") && this.isTypeStart(this.peek())) {
        this.next();
        const type = this.typeName();
        this.expect(")");
        return { k: "sizeof", type, line };
      }
      return { k: "sizeof", e: this.unary(), line };
    }
    return this.postfix();
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      const tok = this.cur;
      if (this.accept("[")) {
        const i = this.expression();
        this.expect("]");
        e = { k: "index", e, i, line: tok.line };
      } else if (this.accept("(")) {
        const args = [];
        if (!this.is(")")) {
          do args.push(this.assignment()); while (this.accept(","));
        }
        this.expect(")", "함수 호출의 괄호를 닫아 주세요.");
        e = { k: "call", callee: e, args, line: tok.line };
      } else if (this.is("++") || this.is("--")) {
        this.next();
        e = { k: "post", op: tok.v, e, line: tok.line };
      } else if (this.is(".") || this.is("->")) {
        throw compileError(tok.line, "구조체(struct)의 . 와 -> 는 아직 지원하지 않아요");
      } else {
        return e;
      }
    }
  }

  primary() {
    const tok = this.cur;
    if (tok.k === "num") {
      this.next();
      return { k: "num", value: tok.value, type: tok.type, isChar: tok.isChar, text: tok.text, line: tok.line };
    }
    if (tok.k === "str") {
      const bytes = [];
      while (this.cur.k === "str") bytes.push(...this.next().bytes);
      return { k: "str", bytes, line: tok.line };
    }
    if (tok.k === "id" && !KEYWORDS.has(tok.v)) {
      this.next();
      return { k: "id", name: tok.v, line: tok.line };
    }
    if (this.accept("(")) {
      const e = this.expression();
      this.expect(")", "괄호의 짝이 맞는지 확인해 보세요.");
      e.paren = true;
      return e;
    }
    if (tok.k === "id") {
      throw compileError(tok.line, `'${tok.v}'는 여기에 올 수 없어요`, "식(값)이 와야 하는 자리예요.");
    }
    throw compileError(tok.line, `여기에 값(식)이 와야 하는데 '${show(tok)}'가 나왔어요`);
  }
}

export function parse(tokens, includes) {
  return new Parser(tokens, includes).program();
}
