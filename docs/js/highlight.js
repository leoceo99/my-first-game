// 파이썬 코드를 색칠하기 위한 토큰 분석기.
// 작성 중이라 문법이 깨진 코드에서도 멈추지 않도록 한 글자씩 직접 읽어요.

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield",
]);

const BUILTINS = new Set([
  "abs", "all", "any", "ascii", "bin", "bool", "breakpoint", "bytearray", "bytes", "callable",
  "chr", "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod", "enumerate",
  "eval", "exec", "filter", "float", "format", "frozenset", "getattr", "globals", "hasattr",
  "hash", "help", "hex", "id", "input", "int", "isinstance", "issubclass", "iter", "len",
  "list", "locals", "map", "max", "memoryview", "min", "next", "object", "oct", "open", "ord",
  "pow", "print", "property", "range", "repr", "reversed", "round", "set", "setattr", "slice",
  "sorted", "staticmethod", "str", "sum", "super", "tuple", "type", "vars", "zip",
  "self", "Exception", "ValueError", "TypeError", "KeyError", "IndexError", "NameError",
  "ZeroDivisionError", "RuntimeError", "StopIteration", "AttributeError",
]);

const STRING_PREFIX = /^(?:[rRbBuUfFtT]|[rR][bBfFtT]|[bBfFtT][rR])$/;
const NUMBER = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?/y;
const IDENT_START = /[\p{L}_]/u;
const IDENT_CHAR = /[\p{L}\p{N}\p{Mn}\p{Mc}_]/u;

function scanString(src, quoteAt) {
  const q = src[quoteAt];
  const n = src.length;
  if (src.startsWith(q + q + q, quoteAt)) {
    let j = quoteAt + 3;
    while (j < n) {
      if (src[j] === "\\") j += 2;
      else if (src.startsWith(q + q + q, j)) return j + 3;
      else j++;
    }
    return n;
  }
  let j = quoteAt + 1;
  while (j < n) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === q) return j + 1;
    else if (c === "\n") return j;
    else j++;
  }
  return Math.min(j, n);
}

/** 코드에서 [{type, start, end}] 목록을 만들어요. */
export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let lineStart = true;
  let expectDefName = false;
  let prevSignificant = "";

  while (i < n) {
    const c = src[i];
    if (c === "\n") { i++; lineStart = true; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    if (c === "#") {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      tokens.push({ type: "comment", start: i, end });
      i = end;
      continue;
    }

    if (c === "@" && lineStart) {
      let j = i + 1;
      while (j < n && (IDENT_CHAR.test(src[j]) || src[j] === ".")) j++;
      tokens.push({ type: "decorator", start: i, end: j });
      i = j; lineStart = false; prevSignificant = "@";
      continue;
    }

    if (c === '"' || c === "'") {
      const end = scanString(src, i);
      tokens.push({ type: "string", start: i, end });
      i = end; lineStart = false; expectDefName = false; prevSignificant = c;
      continue;
    }

    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && STRING_PREFIX.test(word)) {
        const end = scanString(src, j);
        tokens.push({ type: "string", start: i, end });
        i = end; lineStart = false; prevSignificant = '"';
        continue;
      }
      if (expectDefName) {
        tokens.push({ type: "definition", start: i, end: j });
        expectDefName = false;
      } else if (KEYWORDS.has(word)) {
        tokens.push({ type: "keyword", start: i, end: j });
        expectDefName = word === "def" || word === "class";
      } else if (BUILTINS.has(word) && prevSignificant !== ".") {
        tokens.push({ type: "builtin", start: i, end: j });
      }
      i = j; lineStart = false; prevSignificant = "a";
      continue;
    }

    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      const end = m ? i + m[0].length : i + 1;
      tokens.push({ type: "number", start: i, end });
      i = end; lineStart = false; prevSignificant = "0";
      continue;
    }

    expectDefName = false;
    prevSignificant = c;
    lineStart = false;
    i++;
  }
  return tokens;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
export function escapeHtml(text) {
  return text.replace(/[&<>]/g, (ch) => ESCAPES[ch]);
}

/** 코드를 색칠된 HTML로 바꿔요. */
export function highlight(src) {
  let html = "";
  let pos = 0;
  for (const t of tokenize(src)) {
    if (t.start > pos) html += escapeHtml(src.slice(pos, t.start));
    html += `<span class="tok-${t.type}">${escapeHtml(src.slice(t.start, t.end))}</span>`;
    pos = t.end;
  }
  return html + escapeHtml(src.slice(pos));
}

// ---------- C ----------
const C_KEYWORDS = new Set([
  "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum",
  "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return",
  "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while", "_Bool", "bool", "size_t",
]);
const C_TYPES = new Set(["char", "double", "float", "int", "long", "short", "void", "unsigned", "signed", "bool", "_Bool", "size_t"]);
const C_BUILTINS = new Set([
  "printf", "scanf", "puts", "putchar", "getchar", "fgets", "sprintf", "fflush", "malloc", "calloc", "free",
  "rand", "srand", "time", "exit", "abs", "atoi", "atof", "strlen", "strcpy", "strncpy", "strcat", "strcmp",
  "strncmp", "strchr", "strstr", "memset", "sqrt", "pow", "fabs", "floor", "ceil", "round", "sin", "cos",
  "tan", "log", "log10", "exp", "fmod", "toupper", "tolower", "isdigit", "isalpha", "isspace", "isupper",
  "islower", "isalnum", "NULL", "true", "false", "stdin", "stdout", "stderr", "EOF", "main",
  "FILE", "fopen", "fclose", "fprintf", "fscanf", "fputs", "fgetc", "feof", "qsort", "bsearch", "strtok",
  "memcpy", "strrchr", "snprintf", "time_t",
]);

export function tokenizeC(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let lineStart = true;
  let prevWord = "";
  while (i < n) {
    const c = src[i];
    if (c === "\n") { i++; lineStart = true; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      tokens.push({ type: "comment", start: i, end });
      i = end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end < 0 ? n : end + 2;
      tokens.push({ type: "comment", start: i, end });
      i = end;
      continue;
    }
    if (c === "#" && lineStart) {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      const text = src.slice(i, end);
      const m = text.match(/^#\s*include\s*/);
      if (m) {
        tokens.push({ type: "decorator", start: i, end: i + m[0].length });
        tokens.push({ type: "string", start: i + m[0].length, end });
      } else {
        tokens.push({ type: "decorator", start: i, end });
      }
      i = end;
      continue;
    }
    lineStart = false;
    if (c === '"' || c === "'") {
      const end = scanString(src, i);
      tokens.push({ type: "string", start: i, end });
      i = end;
      prevWord = "";
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j++;
      const w = src.slice(i, j);
      let k = j;
      while (k < n && (src[k] === " " || src[k] === "\t")) k++;
      if (C_KEYWORDS.has(w)) tokens.push({ type: "keyword", start: i, end: j });
      else if (C_BUILTINS.has(w)) tokens.push({ type: "builtin", start: i, end: j });
      else if (src[k] === "(" && (C_TYPES.has(prevWord) || prevWord === "*")) tokens.push({ type: "definition", start: i, end: j });
      prevWord = w;
      i = j;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = src.slice(i).match(/^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[uUlLfF]*/);
      const end = i + (m ? m[0].length : 1);
      tokens.push({ type: "number", start: i, end });
      i = end;
      prevWord = "";
      continue;
    }
    if (c !== "*") prevWord = "";
    else if (C_TYPES.has(prevWord) || prevWord === "*") prevWord = "*";
    i++;
  }
  return tokens;
}

/** 언어에 맞게 코드를 색칠된 HTML로 바꿔요. */
export function highlightFor(lang, src) {
  if (lang !== "c") return highlight(src);
  let html = "";
  let pos = 0;
  for (const t of tokenizeC(src)) {
    if (t.start > pos) html += escapeHtml(src.slice(pos, t.start));
    html += `<span class="tok-${t.type}">${escapeHtml(src.slice(t.start, t.end))}</span>`;
    pos = t.end;
  }
  return html + escapeHtml(src.slice(pos));
}
