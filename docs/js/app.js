// 파이브릿지 화면을 움직이는 메인 코드.

import { CodeEditor } from "./editor.js";
import { Engine } from "./engine.js";
import { Store } from "./store.js";
import { EXAMPLES } from "./examples.js";
import { explainError } from "./errors.js";

const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const store = new Store(EXAMPLES[0]);

const LANGS = {
  python: { name: "Python", ext: "py", mime: "text/x-python", engine: "파이썬", newCode: "" },
  c: {
    name: "C", ext: "c", mime: "text/x-csrc", engine: "C",
    newCode: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  },
};
const langOf = () => store.current().lang;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- 알림과 대화상자 ----------
let toastTimer = null;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
}

/** 화면 안에 그리는 대화상자. 입력칸이 있으면 글자를, 없으면 true를, 취소하면 null을 돌려줘요. */
function dialog({ title, message = "", value = null, okText = "확인", danger = false }) {
  const modal = $("#modal");
  const input = $("#modal-input");
  const ok = $("#modal-ok");
  $("#modal-title").textContent = title;
  $("#modal-message").textContent = message;
  $("#modal-message").hidden = !message;
  input.hidden = value === null;
  input.value = value ?? "";
  ok.textContent = okText;
  ok.classList.toggle("modal-ok-danger", danger);
  modal.hidden = false;
  (value === null ? ok : input).focus();
  if (value !== null) input.select();

  return new Promise((resolve) => {
    const finish = (result) => {
      modal.hidden = true;
      $("#modal-form").onsubmit = null;
      $("#modal-cancel").onclick = null;
      modal.onkeydown = null;
      resolve(result);
    };
    $("#modal-form").onsubmit = (e) => {
      e.preventDefault();
      finish(value === null ? true : input.value);
    };
    $("#modal-cancel").onclick = () => finish(null);
    modal.onkeydown = (e) => { if (e.key === "Escape") finish(null); };
  });
}

// ---------- 편집기 ----------
function showSaveState() {
  const node = $("#save-state");
  if (store.persistent) {
    node.textContent = "이 기기에 저장돼요";
    delete node.dataset.warn;
  } else {
    node.textContent = "저장할 수 없는 환경이에요";
    node.dataset.warn = "";
  }
}

const editor = new CodeEditor($("#editor"), {
  onChange: (code) => {
    store.updateCode(code);
    showSaveState();
  },
  onRunShortcut: () => runCode(),
});

function applyFontSize(size) {
  const clamped = Math.min(28, Math.max(12, size));
  document.documentElement.style.setProperty("--code-size", `${clamped}px`);
  store.setSetting("fontSize", clamped);
  editor.render();
  if (editor.errorLine) editor.markError(editor.errorLine);
}

let shownLang = null;
function openFile(file) {
  for (const e of Object.values(engines)) if (e.busy) { e.stop(); }
  editor.setLanguage(file.lang);
  editor.value = file.code;
  $("#file-name-text").textContent = file.name;
  $("#lang-badge").textContent = LANGS[file.lang].name;
  $("#lang-badge").dataset.lang = file.lang;
  document.title = `${file.name} · 파이브릿지`;
  resetOutput(true);
  $("#answer-form").hidden = true;
  if (shownLang !== file.lang) {
    shownLang = file.lang;
    renderKeybar();
  }
  const e = cur();
  if (e.state === "off") e.start();
  else updateChip(e);
  renderFileList();
}

// ---------- 기호 키 바 ----------
const TOOL_KEYS = [
  { label: "←", title: "왼쪽으로", kind: "tool", run: () => editor.moveCaret(-1) },
  { label: "→", title: "오른쪽으로", kind: "tool", run: () => editor.moveCaret(1) },
  { label: "↶", title: "되돌리기", kind: "tool", run: () => editor.undo() },
  { label: "↷", title: "다시 하기", kind: "tool", run: () => editor.redo() },
];
const INDENT_KEYS = [
  { label: "⇥", title: "들여쓰기", kind: "tool", run: () => editor.indent() },
  { label: "⇤", title: "내어쓰기", kind: "tool", run: () => editor.outdent() },
];
const text = (label, insert = label) => ({ label, run: () => editor.insertText(insert) });

const PY_SYMBOL_KEYS = [
  { label: "⇥", title: "들여쓰기", kind: "tool", run: () => editor.indent() },
  { label: "⇤", title: "내어쓰기", kind: "tool", run: () => editor.outdent() },
  { label: ":" },
  { label: "( )", run: () => editor.insertPair("(", ")") },
  { label: ")", },
  { label: "[ ]", run: () => editor.insertPair("[", "]") },
  { label: "{ }", run: () => editor.insertPair("{", "}") },
  { label: '" "', run: () => editor.insertPair('"', '"') },
  { label: "' '", run: () => editor.insertPair("'", "'") },
  { label: "=" }, { label: "==" }, { label: "+" }, { label: "-" }, { label: "*" }, { label: "/" },
  { label: "%" }, { label: "<" }, { label: ">" }, { label: "," }, { label: "." }, { label: "_" },
  { label: "#" },
  { gap: true },
  ...TOOL_KEYS,
];

const fn = (name) => ({ label: `${name}()`, kind: "fn", run: () => editor.insertPair(`${name}(`, ")") });
const word = (text, insert = `${text} `) => ({ label: text, kind: "word", run: () => editor.insertText(insert) });
const PY_WORD_KEYS = [
  fn("print"), fn("input"), fn("int"), fn("range"), fn("len"), fn("str"),
  { gap: true },
  word("if"), word("elif"), word("else", "else:"), word("for"), word("in"), word("while"),
  word("def"), word("return"), word("break", "break"), word("import"),
  word("True", "True"), word("False", "False"), word("and"), word("or"), word("not"),
  { gap: true },
  ...INDENT_KEYS,
  { label: "↶", title: "되돌리기", kind: "tool", run: () => editor.undo() },
];

const C_SYMBOL_KEYS = [
  ...INDENT_KEYS,
  { label: ";" },
  { label: "{ }", run: () => editor.insertPair("{", "}") },
  { label: "( )", run: () => editor.insertPair("(", ")") },
  { label: ")" },
  { label: "[ ]", run: () => editor.insertPair("[", "]") },
  { label: '" "', run: () => editor.insertPair('"', '"') },
  { label: "' '", run: () => editor.insertPair("'", "'") },
  text("%d"), text("\\n"), { label: "&" }, text("->"), { label: "." },
  { label: "=" }, { label: "==" }, { label: "+" }, { label: "-" }, { label: "*" }, { label: "/" },
  { label: "%" }, { label: "<" }, { label: ">" }, { label: "!" }, { label: "|" }, { label: "," },
  { label: "#" },
  { gap: true },
  ...TOOL_KEYS,
];

const C_WORD_KEYS = [
  fn("printf"), fn("scanf"),
  { gap: true },
  word("int"), word("double"), word("char"), word("if"), word("else"), word("for"), word("while"),
  word("return"), word("break", "break;"), word("void"), word("struct"), word("typedef"),
  { label: "#include", kind: "word", run: () => editor.insertText("#include <stdio.h>\n") },
  { label: "main", kind: "fn", run: () => editor.insertText("int main(void) {\n    \n    return 0;\n}\n") },
  { gap: true },
  ...INDENT_KEYS,
  { label: "↶", title: "되돌리기", kind: "tool", run: () => editor.undo() },
];

const KEYSETS = {
  python: { symbols: PY_SYMBOL_KEYS, words: PY_WORD_KEYS },
  c: { symbols: C_SYMBOL_KEYS, words: C_WORD_KEYS },
};

let keyMode = "symbols";
function renderKeybar() {
  const bar = $("#keybar");
  bar.textContent = "";
  const seg = el("div", "seg");
  for (const [mode, label] of [["symbols", "기호"], ["words", "단어"]]) {
    const b = el("button", "", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(keyMode === mode));
    b.addEventListener("click", () => { keyMode = mode; renderKeybar(); });
    seg.append(b);
  }
  bar.append(seg);
  for (const key of KEYSETS[langOf()][keyMode]) {
    if (key.gap) {
      bar.append(el("span", "gap"));
      continue;
    }
    const b = el("button", `key ${key.kind || ""}`, key.label);
    b.type = "button";
    b.tabIndex = -1;
    if (key.title) b.setAttribute("aria-label", key.title);
    // 버튼을 눌러도 키보드가 내려가지 않도록 편집기 초점을 지켜요.
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      editor.focus();
      if (key.run) key.run();
      else editor.typeSymbol(key.label);
    });
    bar.append(b);
  }
}

// ---------- 실행 결과 창 ----------
const consoleEl = $("#console");
const welcomeTemplate = consoleEl.querySelector(".welcome").cloneNode(true);
let lastOut = null;

function nearBottom() {
  return consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 80;
}
function append(node) {
  const stick = nearBottom();
  consoleEl.append(node);
  lastOut = null;
  if (stick) consoleEl.scrollTop = consoleEl.scrollHeight;
  return node;
}

const MAX_OUTPUT_CHARS = 300000;
let outputChars = 0;
function writeOutput(stream, text) {
  const stick = nearBottom();
  if (!lastOut || lastOut.dataset.stream !== stream) {
    lastOut = el("pre", `out out-${stream}`);
    lastOut.dataset.stream = stream;
    lastOut.append(document.createTextNode(""));
    consoleEl.append(lastOut);
  }
  lastOut.firstChild.appendData(text);
  outputChars += text.length;
  // 출력이 너무 많으면 오래된 것부터 지워서 앱이 느려지지 않게 해요.
  while (outputChars > MAX_OUTPUT_CHARS) {
    const first = consoleEl.querySelector(".out");
    if (!first) break;
    const data = first.firstChild;
    const cut = Math.min(data.length, outputChars - MAX_OUTPUT_CHARS);
    data.deleteData(0, cut);
    outputChars -= cut;
    if (data.length === 0 && first !== lastOut) first.remove();
  }
  if (stick) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function resetOutput(showWelcome = false) {
  consoleEl.textContent = "";
  if (showWelcome) consoleEl.append(welcomeTemplate.cloneNode(true));
  lastOut = null;
  outputChars = 0;
  renderVariables(null);
}

function showError(error) {
  // C 실행기는 처음부터 한국어 설명을 주고, 파이썬 오류는 여기서 설명으로 바꿔요.
  const { title, detail } = error.title ? error : explainError(error);
  const card = el("div", "error-card");
  card.append(el("h3", "", title));
  card.append(el("p", "", detail));
  const row = el("div", "row");
  if (error.line) {
    const go = el("button", "btn btn-ghost", `${error.line}번째 줄 보기`);
    go.type = "button";
    go.addEventListener("click", () => editor.markError(error.line));
    row.append(go);
  }
  row.append(el("span", "error-type", error.message ? `${error.type}: ${error.message}` : error.type));
  card.append(row);
  if (error.traceback) {
    const more = el("details");
    more.append(el("summary", "", "파이썬 원래 오류 메시지 보기"));
    more.append(el("pre", "", error.traceback));
    card.append(more);
  }
  append(card);
}

function showFatal(engine, message) {
  const card = el("div", "error-card");
  card.append(el("h3", "", `${LANGS[engine.lang].engine} 엔진을 불러오지 못했어요`));
  card.append(el("p", "", "처음 한 번은 인터넷이 필요해요. 연결을 확인하고 다시 시도해 주세요."));
  const row = el("div", "row");
  const retry = el("button", "btn btn-primary", "다시 시도");
  retry.type = "button";
  retry.addEventListener("click", () => { card.remove(); engine.start(); });
  row.append(retry, el("span", "error-type", message));
  card.append(row);
  append(card);
}

function renderFiles(box) {
  const files = Object.entries(store.vfs);
  if (files.length === 0) return;
  box.append(el("h4", "vars-heading", `파일 ${files.length}개 (C 프로그램이 fopen으로 만든 것)`));
  const list = el("ul", "var-list");
  for (const [name, text] of files) {
    const item = el("li", "var-item");
    const type = el("span", "var-type", `${new TextEncoder().encode(text).length}바이트`);
    type.dataset.kind = "file";
    const del = el("button", "btn btn-ghost btn-file-del", "지우기");
    del.type = "button";
    del.addEventListener("click", () => {
      store.deleteFile(name);
      renderVariables(lastVariables);
      toast(`'${name}' 파일을 지웠어요`);
    });
    const preview = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    item.append(el("span", "var-name", name), type, del, el("span", "var-value file-text", preview || "(빈 파일)"));
    list.append(item);
  }
  box.append(list);
}

let lastVariables = null;
function renderVariables(variables) {
  lastVariables = variables;
  const box = $("#vars");
  box.textContent = "";
  $("#vars-count").textContent = variables ? variables.length : 0;
  if (!variables || variables.length === 0) {
    box.append(el("p", "vars-empty", variables ? "만들어진 변수가 없어요." : "코드를 실행하면 만들어진 변수가 여기에 나와요."));
    renderFiles(box);
    return;
  }
  const list = el("ul", "var-list");
  for (const v of variables) {
    const item = el("li", "var-item");
    const type = el("span", "var-type", v.type);
    type.dataset.kind = v.kind || v.type;
    item.append(el("span", "var-name", v.name), type, el("span", "var-value", v.value));
    list.append(item);
  }
  box.append(list);
  renderFiles(box);
}

function switchTab(name) {
  const isConsole = name === "console";
  $("#tab-console").setAttribute("aria-selected", String(isConsole));
  $("#tab-vars").setAttribute("aria-selected", String(!isConsole));
  consoleEl.hidden = !isConsole;
  $("#vars").hidden = isConsole;
}

// ---------- 실행 ----------
const STATE_TEXT = {
  off: "준비 전",
  loading: "준비 중",
  ready: "준비됨",
  running: "실행 중",
  waiting: "답을 기다려요",
  failed: "엔진 오류",
};

function updateChip(engine) {
  const chip = $("#engine-chip");
  chip.dataset.state = engine.state;
  const name = engine.label || LANGS[engine.lang].engine;
  $("#engine-text").textContent = engine.state === "running" || engine.state === "waiting"
    ? STATE_TEXT[engine.state]
    : `${name} ${STATE_TEXT[engine.state]}`;
  $("#btn-stop").disabled = !engine.busy;
}

function makeEngine(lang) {
  const engine = new Engine({
    onState() {
      if (langOf() === lang) updateChip(engine);
    },
    onProgress(text) {
      if (langOf() !== lang) return;
      if (engine.state === "loading") $("#engine-text").textContent = text;
      const note = consoleEl.querySelector(".note[data-loading]");
      if (note) note.textContent = `${LANGS[lang].engine} 엔진을 불러오는 중이에요: ${text}. 처음에는 조금 걸릴 수 있어요.`;
    },
    onOutput: writeOutput,
    onInput(prompt) {
      append(el("div", "ask", prompt || "입력을 기다려요"));
      const form = $("#answer-form");
      form.hidden = false;
      $("#answer-label").textContent = prompt.trim() ? `답하기: ${prompt.trim()}` : "프로그램이 답을 기다려요";
      switchTab("console");
      $("#answer-input").focus({ preventScroll: true });
    },
    onDone(result, run) {
      $("#answer-form").hidden = true;
      if (result.files) store.setFiles(result.files);
      if (result.status === "error") {
        showError(result.error);
        if (result.error.line) editor.markError(result.error.line);
        append(el("div", "run-end error", "오류로 멈췄어요"));
      } else if (result.status === "exit") {
        append(el("div", "run-end", `${lang === "c" ? "exit" : "sys.exit"}(${result.exitCode})로 끝났어요`));
      } else {
        const time = run.asked === 0 && typeof result.seconds === "number" ? ` · ${result.seconds.toFixed(2)}초` : "";
        const code = result.exitCode ? ` (종료 코드 ${result.exitCode})` : "";
        append(el("div", `run-end ${result.exitCode ? "" : "ok"}`, `끝났어요${code}${time}`));
      }
      renderVariables(result.variables);
    },
    onFatal: (message) => showFatal(engine, message),
  }, lang);
  return engine;
}

const engines = { python: makeEngine("python"), c: makeEngine("c") };
const cur = () => engines[langOf()];

function runCode() {
  const engine = cur();
  if (engine.busy) engine.stop();
  const file = store.current();
  store.saveNow();
  editor.clearError();
  resetOutput();
  $("#answer-form").hidden = true;
  switchTab("console");
  append(el("div", "run-head", `${file.name} 실행`));
  if (engine.run(editor.value, { files: store.vfs }) === "queued") {
    const note = el("p", "note", `${LANGS[engine.lang].engine} 엔진을 불러오는 중이에요. 처음에는 조금 걸릴 수 있어요.`);
    note.dataset.loading = "";
    append(note);
  }
}

function stopCode() {
  if (!cur().stop()) return;
  $("#answer-form").hidden = true;
  append(el("div", "run-end stopped", "멈췄어요"));
}

$("#btn-run").addEventListener("click", runCode);
$("#btn-stop").addEventListener("click", stopCode);
$("#tab-console").addEventListener("click", () => switchTab("console"));
$("#tab-vars").addEventListener("click", () => switchTab("vars"));

$("#answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const engine = cur();
  if (engine.state !== "waiting") return;
  const input = $("#answer-input");
  const value = input.value;
  input.value = "";
  append(el("div", "reply", value || " "));
  $("#answer-form").hidden = true;
  engine.answer(value);
});

// 입력 끝(EOF): C의 getchar() == EOF, scanf() == EOF, 파이썬의 EOFError
$("#btn-eof").addEventListener("click", () => {
  const engine = cur();
  if (engine.state !== "waiting") return;
  append(el("div", "reply reply-eof", "입력 끝 (EOF)"));
  $("#answer-form").hidden = true;
  engine.answer(null);
});

// ---------- 내 코드 서랍 ----------
function timeAgo(ms) {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function renderFileList() {
  const list = $("#file-list");
  list.textContent = "";
  const current = store.current();
  for (const file of store.files()) {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    b.setAttribute("aria-current", String(file.id === current.id));
    const lines = file.code ? file.code.split("\n").length : 0;
    b.append(el("span", "item-name", file.name), el("span", "item-meta", `${LANGS[file.lang].name} · ${timeAgo(file.updated)} · ${lines}줄`));
    b.addEventListener("click", () => {
      openFile(store.select(file.id));
      closeDrawer();
    });
    li.append(b);
    list.append(li);
  }
}

function renderExamples() {
  const list = $("#example-list");
  list.textContent = "";
  for (const lang of Object.keys(LANGS)) {
    list.append(el("li", "example-group", `${LANGS[lang].name} 예제`));
    for (const example of EXAMPLES.filter((x) => x.lang === lang)) {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.append(el("span", "item-name", example.name), el("span", "item-meta", example.about));
      b.addEventListener("click", () => {
        openFile(store.create(example.name, example.code, example.lang));
        closeDrawer();
        toast(`'${example.name}' 예제를 새 코드로 열었어요`);
      });
      li.append(b);
      list.append(li);
    }
  }
}

function openDrawer() {
  renderFileList();
  const drawer = $("#drawer");
  drawer.inert = false;
  drawer.classList.add("open");
  $("#scrim").hidden = false;
  $("#btn-drawer").setAttribute("aria-expanded", "true");
  $("#btn-drawer-close").focus();
}

function closeDrawer() {
  const drawer = $("#drawer");
  drawer.classList.remove("open");
  drawer.inert = true;
  $("#scrim").hidden = true;
  $("#btn-drawer").setAttribute("aria-expanded", "false");
}

$("#btn-drawer").addEventListener("click", openDrawer);
$("#btn-drawer-close").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", closeDrawer);

for (const lang of Object.keys(LANGS)) {
  $(`#btn-new-${lang}`).addEventListener("click", () => {
    openFile(store.create(`새 ${LANGS[lang].name} 코드`, LANGS[lang].newCode, lang));
    closeDrawer();
    editor.focus();
  });
}

$("#file-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const code = (await file.text()).replace(/\r\n/g, "\n");
  const lang = /\.(c|h)$/i.test(file.name) ? "c" : "python";
  openFile(store.create(file.name.replace(/\.(py|txt|c|h)$/i, "") || "가져온 코드", code, lang));
  closeDrawer();
  toast(`'${file.name}'을 가져왔어요`);
});

$("#btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(editor.value);
    toast("코드를 복사했어요");
  } catch {
    toast("이 환경에서는 복사할 수 없어요");
  }
});

$("#btn-export").addEventListener("click", () => {
  const file = store.current();
  const info = LANGS[file.lang];
  const url = URL.createObjectURL(new Blob([editor.value], { type: `${info.mime};charset=utf-8` }));
  const a = el("a");
  a.href = url;
  a.download = `${file.name}.${info.ext}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

$("#btn-delete").addEventListener("click", async () => {
  const file = store.current();
  const ok = await dialog({
    title: `'${file.name}'을 삭제할까요?`,
    message: "삭제한 코드는 되돌릴 수 없어요.",
    okText: "삭제",
    danger: true,
  });
  if (!ok) return;
  openFile(store.remove(file.id));
  toast("삭제했어요");
});

$("#btn-rename").addEventListener("click", async () => {
  const file = store.current();
  const name = await dialog({ title: "코드 이름 바꾸기", value: file.name, okText: "바꾸기" });
  if (name === null) return;
  store.rename(file.id, name);
  openFileName();
});

function openFileName() {
  const file = store.current();
  $("#file-name-text").textContent = file.name;
  document.title = `${file.name} · 파이브릿지`;
  renderFileList();
}

$("#btn-font-down").addEventListener("click", () => applyFontSize(store.settings.fontSize - 1));
$("#btn-font-up").addEventListener("click", () => applyFontSize(store.settings.fontSize + 1));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#drawer").classList.contains("open")) closeDrawer();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target !== editor.ta) {
    e.preventDefault();
    runCode();
  }
});

// ---------- 아이패드 화면 키보드 대응 ----------
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  root.setProperty("--app-h", `${vv.height}px`);
  root.setProperty("--app-top", `${vv.offsetTop}px`);
  app.classList.toggle("kb-open", vv.height < window.innerHeight * 0.78);
}
window.visualViewport?.addEventListener("resize", fitViewport);
window.visualViewport?.addEventListener("scroll", fitViewport);
document.addEventListener("focusin", (e) => {
  app.classList.toggle("focus-editor", e.target === editor.ta);
  app.classList.toggle("focus-answer", e.target.id === "answer-input");
});
document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!app.contains(document.activeElement) || document.activeElement === document.body) {
      app.classList.remove("focus-editor", "focus-answer");
    }
  }, 0);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") store.saveNow();
});

// ---------- 시작 ----------
function registerServiceWorker() {
  try {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  } catch { /* 서비스 워커를 쓸 수 없는 환경 (예: 미리보기 창) */ }
}

document.documentElement.style.setProperty("--code-size", `${store.settings.fontSize}px`);
renderExamples();
showSaveState();
openFile(store.current());
fitViewport();
registerServiceWorker();

// 테스트에서 상태를 살펴볼 수 있게 열어 둬요.
window.pybridge = { engines, editor, store, get engine() { return cur(); } };
