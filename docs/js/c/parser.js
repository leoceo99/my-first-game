// 토큰을 읽어서 C 프로그램의 구조(구문 트리, AST)를 만들어요.

import { compileError, T, ptr, func } from "./types.js";

const BASE_WORDS = new Set(["void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "_Bool", "bool", "size_t"]);
const QUALIFIERS = new Set(["const", "volatile", "register", "auto", "inline", "restrict"]);
const STORAGE = new Set(["static", "extern", "typedef"]);
const TAG_WORDS = new Set(["struct", "union", "enum"]);
export const KEYWORDS = new Set([
  ...BASE_WORDS, ...QUALIFIERS, ...STORAGE, ...TAG_WORDS,
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
    this.typedefs = [new Map()]; // typedef 이름들 (블록마다 한 층)
    // 헤더가 미리 만들어 둔 타입 이름들
    if (includes.has("stdio.h")) this.typedefs[0].set("FILE", { k: "file", name: "FILE", size: 1 });
    if (includes.has("time.h")) {
      this.typedefs[0].set("time_t", T.long);
      this.typedefs[0].set("clock_t", T.long);
    }
    this.tags = new Map(); // struct 이름들
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

  isTypedefName(name) {
    for (let i = this.typedefs.length - 1; i >= 0; i--) if (this.typedefs[i].has(name)) return true;
    return false;
  }

  typedefType(name) {
    for (let i = this.typedefs.length - 1; i >= 0; i--) if (this.typedefs[i].has(name)) return this.typedefs[i].get(name);
    return null;
  }

  isTypeStart(tok = this.cur) {
    if (tok.k !== "id") return false;
    return BASE_WORDS.has(tok.v) || QUALIFIERS.has(tok.v) || STORAGE.has(tok.v) || TAG_WORDS.has(tok.v) || this.isTypedefName(tok.v);
  }

  // ---------- 타입 ----------
  declSpecs() {
    const line = this.cur.line;
    const words = [];
    let storage = null;
    let named = null; // struct, enum, typedef 이름으로 정한 타입
    const enums = [];
    while (this.cur.k === "id") {
      const v = this.cur.v;
      if (STORAGE.has(v)) {
        if (storage) throw compileError(this.cur.line, `${storage}와 ${v}를 함께 쓸 수 없어요`);
        storage = v;
      } else if (QUALIFIERS.has(v)) {
        // const 같은 말은 의미만 있고 실행에는 영향이 없어요
      } else if (BASE_WORDS.has(v) && !named) {
        words.push(v);
      } else if (v === "struct" || v === "union") {
        if (named || words.length) throw compileError(this.cur.line, "타입이 두 번 적혀 있어요");
        named = this.structSpec();
        continue;
      } else if (v === "enum") {
        if (named || words.length) throw compileError(this.cur.line, "타입이 두 번 적혀 있어요");
        const def = this.enumSpec();
        if (def) enums.push(def);
        named = T.int;
        continue;
      } else if (!named && words.length === 0 && this.isTypedefName(v)) {
        named = this.typedefType(v);
      } else break;
      this.next();
    }
    if (!named && words.length === 0) {
      if (storage) throw compileError(line, `${storage} 뒤에 타입(int 등)이 필요해요`);
      return null;
    }
    return { type: named || this.combine(words, line), storage, enums, line };
  }

  structSpec() {
    const kw = this.next();
    if (kw.v === "union") {
      throw compileError(kw.line, "공용체(union)는 아직 지원하지 않아요", "여러 값을 묶으려면 struct를 써 보세요.");
    }
    let tag = null;
    if (this.cur.k === "id" && !KEYWORDS.has(this.cur.v)) tag = this.next().v;
    let t = tag ? this.tags.get(`struct ${tag}`) : null;
    if (!this.is("{")) {
      if (!tag) throw compileError(kw.line, "struct 뒤에 이름이나 { 가 필요해요");
      if (!t) {
        t = { k: "struct", tag, fields: [], complete: false, line: kw.line };
        this.tags.set(`struct ${tag}`, t);
      }
      return t;
    }
    if (t && t.complete) throw compileError(kw.line, `struct ${tag}를 두 번 정의했어요`, `${t.line}번째 줄에 이미 있어요.`);
    if (!t) {
      t = { k: "struct", tag, fields: [], complete: false, line: kw.line };
      if (tag) this.tags.set(`struct ${tag}`, t);
    }
    this.next();
    const fields = [];
    while (!this.is("}")) {
      if (this.cur.k === "eof") throw compileError(kw.line, `${kw.line}번째 줄의 struct { 가 닫히지 않았어요`);
      const specs = this.declSpecs();
      if (!specs || specs.storage) throw compileError(this.cur.line, "구조체 안에는 타입과 이름으로 된 멤버만 쓸 수 있어요", "예: struct Point { int x; int y; };");
      do {
        const d = this.declarator(specs.type);
        if (this.is(":")) throw compileError(this.cur.line, "비트 필드(:)는 아직 지원하지 않아요");
        if (fields.some((f) => f.name === d.name)) throw compileError(d.line, `구조체에 '${d.name}' 멤버가 두 개 있어요`);
        fields.push(d);
      } while (this.accept(","));
      this.expect(";");
    }
    this.next();
    if (fields.length === 0) throw compileError(kw.line, "빈 구조체는 만들 수 없어요");
    t.fields = fields;
    t.complete = true;
    return t;
  }

  enumSpec() {
    const kw = this.next();
    let tag = null;
    if (this.cur.k === "id" && !KEYWORDS.has(this.cur.v)) tag = this.next().v;
    if (!this.accept("{")) {
      if (!tag) throw compileError(kw.line, "enum 뒤에 이름이나 { 가 필요해요");
      return null;
    }
    const items = [];
    while (!this.is("}")) {
      const tok = this.cur;
      if (tok.k !== "id" || KEYWORDS.has(tok.v)) throw compileError(tok.line, `enum 안에는 이름이 와야 하는데 '${show(tok)}'가 나왔어요`);
      this.next();
      const expr = this.accept("=") ? this.conditional() : null;
      items.push({ name: tok.v, expr, line: tok.line });
      if (!this.accept(",")) break;
    }
    this.expect("}", "enum 목록은 } 로 닫아요.");
    return { k: "enumdef", tag, items, line: kw.line };
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

  /**
   * 선언자: 별(*), 이름, [배열 크기], (매개변수), 그리고 (*f)(int) 같은 괄호 묶음.
   * C의 선언은 "안쪽에서 바깥쪽으로" 읽어요. 이름 없는 형태(캐스트, 매개변수)도 읽어요.
   */
  declarator(base, abstract = false) {
    const d = this.declaratorParts(abstract);
    return { name: d.name, type: d.apply(base), line: d.line };
  }

  declaratorParts(abstract) {
    let ptrs = 0;
    while (this.accept("*")) {
      ptrs++;
      while (this.cur.k === "id" && QUALIFIERS.has(this.cur.v)) this.next();
    }
    const line = this.cur.line;
    let inner = null;
    let name = null;
    const next = this.peek();
    const grouping = this.is("(") && (this.is("*", next) || this.is("(", next) || (!abstract && next.k === "id" && !this.isTypeStart(next)));
    if (grouping) {
      this.next();
      inner = this.declaratorParts(abstract);
      this.expect(")");
    } else if (this.cur.k === "id" && !KEYWORDS.has(this.cur.v) && !(abstract && this.isTypedefName(this.cur.v))) {
      name = this.next().v;
    } else if (!abstract) {
      if (this.cur.k === "id") {
        throw compileError(line, `'${this.cur.v}'는 C가 쓰는 낱말이라 이름으로 쓸 수 없어요`, "다른 이름을 써 주세요.");
      }
      throw compileError(line, `이름이 와야 하는데 '${show(this.cur)}'가 나왔어요`);
    }
    const suffixes = [];
    for (;;) {
      if (this.accept("[")) {
        if (this.accept("]")) suffixes.push({ array: true, lenExpr: null });
        else {
          suffixes.push({ array: true, lenExpr: this.conditional() });
          this.expect("]");
        }
      } else if (this.is("(") && (name !== null || inner !== null || abstract)) {
        suffixes.push({ func: this.params() });
      } else break;
    }
    const apply = (t) => {
      for (let k = 0; k < ptrs; k++) t = ptr(t);
      for (let k = suffixes.length - 1; k >= 0; k--) {
        const sfx = suffixes[k];
        if (sfx.array) t = { k: "array", of: t, lenExpr: sfx.lenExpr, line };
        else t = { ...func(t, sfx.func.params, sfx.func.variadic), noProto: sfx.func.noProto };
      }
      return inner ? inner.apply(t) : t;
    };
    return { name: name ?? (inner ? inner.name : null), line, apply };
  }

  params() {
    this.expect("(");
    const params = [];
    let variadic = false;
    if (this.accept(")")) return { params, noProto: true };
    if (this.is("void") && this.is(")", this.peek())) {
      this.next();
      this.next();
      return { params };
    }
    do {
      if (this.accept("...")) { variadic = true; break; }
      const specs = this.declSpecs();
      if (!specs) throw compileError(this.cur.line, `매개변수 '${show(this.cur)}' 앞에 타입이 필요해요`, "예: int add(int a, int b)");
      params.push(this.declarator(specs.type, true));
    } while (this.accept(","));
    this.expect(")", "매개변수 목록은 ) 로 닫아요.");
    return { params, variadic };
  }

  typeName() {
    const specs = this.declSpecs();
    if (!specs) throw compileError(this.cur.line, "타입 이름이 필요해요");
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
      if (this.accept(";")) {
        if (specs.enums.length) items.push({ k: "decl", items: [], enums: specs.enums, line });
        continue;
      }
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
      if (specs.storage === "typedef") {
        if (this.is("=")) throw compileError(this.cur.line, "typedef에는 = 로 값을 넣을 수 없어요");
        this.typedefs[this.typedefs.length - 1].set(d.name, d.type);
        if (d.type.k === "struct" && !d.type.alias) d.type.alias = d.name;
      } else {
        let init = null;
        if (this.accept("=")) init = this.initializer();
        items.push({ ...d, init, storage: specs.storage });
      }
      if (!this.accept(",")) break;
      d = this.declarator(specs.type);
    }
    this.expect(";");
    return { k: "decl", items, enums: specs.enums, line: first.line };
  }

  /** 문장 자리의 선언 (int x; / struct P p; / enum {...}; 처럼 이름 없는 것도) */
  localDeclaration() {
    const specs = this.declSpecs();
    if (this.accept(";")) return { k: "decl", items: [], enums: specs.enums, line: specs.line };
    return this.declRest(specs, this.declarator(specs.type));
  }

  initializer() {
    if (this.is("{")) {
      const line = this.next().line;
      const items = [];
      while (!this.is("}")) {
        if (this.is(".") && this.peek().k === "id") {
          const line2 = this.next().line;
          const field = this.next().v;
          this.expect("=", "예: .x = 1");
          items.push({ k: "desig", field, init: this.initializer(), line: line2 });
        } else if (this.is("[")) {
          const line2 = this.next().line;
          const index = this.conditional();
          this.expect("]");
          this.expect("=", "예: [2] = 5");
          items.push({ k: "desig", index, init: this.initializer(), line: line2 });
        } else {
          items.push(this.initializer());
        }
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
    this.typedefs.push(new Map());
    const body = [];
    while (!this.is("}")) {
      if (this.cur.k === "eof") {
        throw compileError(open.line, `${open.line}번째 줄의 { 가 닫히지 않았어요`, "여는 중괄호 { 와 닫는 중괄호 } 의 짝을 맞춰 주세요.");
      }
      body.push(this.statement());
    }
    this.next();
    this.typedefs.pop();
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
      if (this.isTypeStart()) return this.localDeclaration();
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
        this.next();
        if (this.cur.k !== "id" || KEYWORDS.has(this.cur.v)) {
          throw compileError(tok.line, `${tok.v} 뒤에는 멤버 이름이 와야 해요`, "예: p.x 또는 ptr->x");
        }
        e = { k: "member", e, name: this.next().v, arrow: tok.v === "->", line: tok.line };
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
