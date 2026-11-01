/* 파이브릿지 파이썬 엔진 (모듈 Web Worker).
 *
 * 화면과 따로 돌아가기 때문에, 사용자 코드가 무한 반복에 빠져도 화면은 멈추지 않고
 * [멈춤]을 누르면 이 워커를 통째로 끝낼 수 있어요.
 *
 * 화면 → 워커: {type: "init", bases, runnerUrls} / {type: "run", runId, code, answers, seed}
 * 워커 → 화면: {type: "progress"|"ready"|"fatal"|"output"|"input"|"done", ...}
 */
const INPUT_URL = new URL("__pybridge_input__", self.location).href;
let pyodide = null;
let runFn = null;
let canBlock = false;
let inputSeq = 0;

// 서비스 워커가 이 워커의 요청을 받아 줄 수 있으면, input()이 진짜로 답을 기다릴 수 있어요.
function probeBlockingInput() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${INPUT_URL}?probe=1`, false);
    xhr.send();
    return xhr.status === 200 && xhr.responseText === "pong";
  } catch {
    return false;
  }
}

const bridge = {
  post_output(stream, text) {
    postMessage({ type: "output", stream, text });
  },
  post_input_request(prompt) {
    postMessage({ type: "input", prompt, id: null });
  },
  wait_for_input(prompt) {
    const id = `${Date.now().toString(36)}-${++inputSeq}`;
    postMessage({ type: "input", prompt, id });
    for (;;) {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${INPUT_URL}?id=${encodeURIComponent(id)}`, false);
      xhr.send();
      if (xhr.status === 200) return xhr.responseText;
      if (xhr.status !== 204) throw new Error(`입력을 받지 못했어요 (${xhr.status})`);
      // 204: 아직 답이 없어요. 다시 기다립니다.
    }
  },
};

function progress(text) {
  postMessage({ type: "progress", text });
}

async function loadEngine(bases) {
  const problems = [];
  for (const [i, base] of bases.entries()) {
    const where = bases.length > 1 ? ` (${i + 1}/${bases.length})` : "";
    try {
      // 엔진은 데이터 파일을 받지 못하면 오류 없이 영원히 기다려요.
      // 그래서 먼저 작은 파일로 이 주소에서 받을 수 있는지 확인해요.
      progress(`엔진 주소 확인 중${where}`);
      const check = await fetch(`${base}pyodide-lock.json`);
      if (!check.ok) throw new Error(`HTTP ${check.status}`);
      progress(`엔진 받는 중${where}`);
      const { loadPyodide } = await import(`${base}pyodide.mjs`);
      return await loadPyodide({ indexURL: base });
    } catch (err) {
      problems.push(`${base}: ${err && err.message ? err.message : err}`);
    }
  }
  throw new Error(problems.join(" / "));
}

async function fetchRunner(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
    } catch { /* 다음 주소를 시도해요 */ }
  }
  throw new Error("실행 도구(runner.py)를 불러오지 못했어요");
}

async function init({ bases, runnerUrls }) {
  try {
    pyodide = await loadEngine(bases);
    progress("파이썬 시작 중");
    const source = await fetchRunner(runnerUrls);
    pyodide.runPython(source);
    runFn = pyodide.globals.get("run");
    canBlock = probeBlockingInput();
    const python = pyodide.runPython("import sys; sys.version.split()[0]");
    postMessage({ type: "ready", python, canBlock });
  } catch (err) {
    postMessage({ type: "fatal", message: String(err && err.message ? err.message : err) });
  }
}

function run({ runId, code, answers, seed }) {
  let result;
  try {
    const json = runFn(code, JSON.stringify(answers || []), seed, canBlock ? "block" : "replay", bridge);
    result = JSON.parse(json);
  } catch (err) {
    result = {
      status: "error",
      error: { type: "EngineError", message: String(err), line: null, suggestion: null, traceback: String(err) },
      variables: [],
    };
  }
  postMessage({ type: "done", runId, result });
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") init(msg);
  else if (msg.type === "run") run(msg);
};
