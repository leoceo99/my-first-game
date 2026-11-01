// 파이썬 엔진(Web Worker)을 켜고, 코드를 실행하고, 입력을 전달하고, 멈추게 해요.
//
// 상태: "loading" → "ready" ⇄ "running" ⇄ "waiting"(input 답을 기다림), 또는 "failed"

const PYODIDE_VERSION = "314.0.7";
// 같은 엔진 파일을 두 곳에서 받을 수 있어요. 앞의 곳이 막혀 있으면 다음 곳을 써요.
// 앞의 것은 Pyodide 공식 주소(Claude 미리보기에서도 허용돼요), 뒤의 것은 npm 사본이에요.
const CDN_BASES = [
  `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
  `https://cdn.jsdelivr.net/npm/pyodide@${PYODIDE_VERSION}/`,
];

/** 엔진 파일 위치 목록. 테스트할 때만 ?engine=local 로 이 폴더 안의 사본을 써요. */
export function engineBases() {
  try {
    if (new URLSearchParams(location.search).get("engine") === "local") {
      return [new URL("../vendor/pyodide/", import.meta.url).href];
    }
  } catch { /* 주소를 읽을 수 없는 환경 */ }
  return CDN_BASES;
}

async function postToServiceWorker(message) {
  const sw = navigator.serviceWorker;
  if (sw.controller) {
    sw.controller.postMessage(message);
    return;
  }
  const registration = await sw.ready;
  registration.active?.postMessage(message);
}

export class Engine {
  constructor(handlers) {
    this.handlers = handlers;
    this.state = "loading";
    this.worker = null;
    this.canBlock = false;
    this.python = "";
    this.current = null;
    this.pendingCode = null;
    this.runCounter = 0;
  }

  get busy() {
    return this.state === "running" || this.state === "waiting";
  }

  setState(state) {
    this.state = state;
    this.handlers.onState?.(state);
  }

  start() {
    this.worker?.terminate();
    const worker = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
    this.worker = worker;
    this.current = null;
    this.setState("loading");
    worker.onmessage = (event) => {
      if (worker === this.worker) this.onMessage(event.data);
    };
    worker.onerror = (event) => {
      if (worker !== this.worker) return;
      event.preventDefault?.();
      this.setState("failed");
      this.handlers.onFatal?.(event.message || "엔진을 시작하지 못했어요.");
    };
    worker.postMessage({
      type: "init",
      bases: engineBases(),
      // runner.txt는 .py 파일을 올릴 수 없는 곳(예: 미리보기 페이지)에 올린 같은 파일이에요.
      runnerUrls: ["../py/runner.py", "../py/runner.txt"].map((p) => new URL(p, import.meta.url).href),
    });
  }

  onMessage(msg) {
    switch (msg.type) {
      case "progress":
        this.handlers.onProgress?.(msg.text);
        break;
      case "ready":
        this.canBlock = msg.canBlock;
        this.python = msg.python;
        this.setState("ready");
        if (this.pendingCode !== null) {
          const code = this.pendingCode;
          this.pendingCode = null;
          this.run(code);
        }
        break;
      case "fatal":
        this.setState("failed");
        this.handlers.onFatal?.(msg.message);
        break;
      case "output":
        if (this.current) this.handlers.onOutput?.(msg.stream, msg.text);
        break;
      case "input":
        if (!this.current) return;
        this.current.inputId = msg.id;
        this.current.asked += 1;
        this.setState("waiting");
        this.handlers.onInput?.(msg.prompt);
        break;
      case "done": {
        if (!this.current || msg.runId !== this.current.runId) return;
        if (msg.result.status === "waiting") return; // replay 방식: 답을 기다리는 중
        const run = this.current;
        this.current = null;
        this.setState("ready");
        this.handlers.onDone?.(msg.result, run);
        break;
      }
      default:
        break;
    }
  }

  /** 코드를 실행해요. 엔진이 아직 준비 중이면 준비되자마자 실행하고 "queued"를 돌려줘요. */
  run(code) {
    if (this.state !== "ready") {
      this.pendingCode = code;
      if (this.state === "failed") this.start();
      return "queued";
    }
    this.current = {
      runId: ++this.runCounter,
      code,
      answers: [],
      asked: 0,
      inputId: null,
      seed: Math.floor(Math.random() * 2 ** 31),
    };
    this.send();
    return "started";
  }

  send() {
    const run = this.current;
    this.setState("running");
    this.worker.postMessage({
      type: "run", runId: run.runId, code: run.code, answers: run.answers, seed: run.seed,
    });
  }

  /** input()에 대한 답을 보내요. */
  answer(value) {
    if (this.state !== "waiting" || !this.current) return;
    if (this.canBlock) {
      this.setState("running");
      postToServiceWorker({ type: "pybridge-input", id: this.current.inputId, value });
    } else {
      this.current.answers.push(value);
      this.send();
    }
  }

  /** 실행을 멈춰요. 계산 중이었다면 엔진을 새로 켜야 해서 잠시 "loading"이 돼요. */
  stop() {
    this.pendingCode = null;
    if (!this.busy) return false;
    if (this.state === "waiting" && !this.canBlock) {
      this.current = null; // replay 방식은 이미 실행이 끝나 있어서 그냥 버리면 돼요.
      this.setState("ready");
    } else {
      this.start();
    }
    return true;
  }
}
