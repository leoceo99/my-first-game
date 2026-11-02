// 내 코드 목록과 설정을 이 기기(브라우저)에 저장해요.
// 저장소를 쓸 수 없는 환경에서도 앱은 그대로 동작하고, 저장만 되지 않아요.

const KEY = "pybridge.v1";

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readStorage() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return { data: raw ? JSON.parse(raw) : null, ok: true };
  } catch {
    return { data: null, ok: false };
  }
}

function isValid(data) {
  return data && Array.isArray(data.files) && data.files.length > 0 &&
    data.files.every((f) => typeof f.id === "string" && typeof f.name === "string" && typeof f.code === "string");
}

export class Store {
  constructor(welcome) {
    const { data, ok } = readStorage();
    this.persistent = ok;
    this.timer = null;
    if (isValid(data)) {
      this.data = data;
    } else {
      const file = { id: makeId(), name: welcome.name, code: welcome.code, lang: welcome.lang || "python", updated: Date.now() };
      this.data = { files: [file], currentId: file.id };
    }
    for (const f of this.data.files) if (f.lang !== "c") f.lang = "python"; // 예전 파일은 모두 파이썬이에요
    this.data.settings = { fontSize: 16, ...(this.data.settings || {}) };
    if (!this.data.files.some((f) => f.id === this.data.currentId)) {
      this.data.currentId = this.data.files[0].id;
    }
  }

  get settings() {
    return this.data.settings;
  }

  /** C 프로그램이 fopen으로 만든 가상 파일들 (이름 → 글자) */
  get vfs() {
    return this.data.vfs || {};
  }

  setFiles(files) {
    this.data.vfs = { ...files };
    this.saveSoon();
  }

  deleteFile(name) {
    const next = { ...this.vfs };
    delete next[name];
    this.setFiles(next);
  }

  files() {
    return [...this.data.files].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  current() {
    return this.data.files.find((f) => f.id === this.data.currentId);
  }

  select(id) {
    if (this.data.files.some((f) => f.id === id)) {
      this.data.currentId = id;
      this.saveSoon();
    }
    return this.current();
  }

  uniqueName(base) {
    const names = new Set(this.data.files.map((f) => f.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  create(name, code = "", lang = "python") {
    const file = { id: makeId(), name: this.uniqueName(name), code, lang, updated: Date.now() };
    this.data.files.push(file);
    this.data.currentId = file.id;
    this.saveSoon();
    return file;
  }

  updateCode(code) {
    const file = this.current();
    if (!file || file.code === code) return;
    file.code = code;
    file.updated = Date.now();
    this.saveSoon();
  }

  rename(id, name) {
    const file = this.data.files.find((f) => f.id === id);
    const clean = name.trim();
    if (!file || !clean || clean === file.name) return;
    file.name = this.uniqueName(clean);
    file.updated = Date.now();
    this.saveSoon();
  }

  remove(id) {
    this.data.files = this.data.files.filter((f) => f.id !== id);
    if (this.data.files.length === 0) {
      return this.create("새 코드", "", "python");
    }
    if (this.data.currentId === id) this.data.currentId = this.files()[0].id;
    this.saveSoon();
    return this.current();
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.saveSoon();
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.timer);
    if (!this.persistent) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      this.persistent = false;
      return false;
    }
  }
}
