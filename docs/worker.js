/* 파이브릿지 파이썬 엔진 (모듈 Web Worker).
 *
 * 화면과 따로 돌아가기 때문에, 사용자 코드가 무한 반복에 빠져도 화면은 멈추지 않고
 * [멈춤]을 누르면 이 워커를 통째로 끝낼 수 있어요.
 *
 * 화면 → 워커: {type: "init", bases, runnerUrls} / {type: "run", runId, code, answers, seed}
 * 워커 → 화면: {type: "progress"|"ready"|"fatal"|"output"|"input"|"done", ...}
 */
let pyodide = null;
let runFn = null;

// input()은 "다시 실행" 방식으로 처리해요: 답이 필요하면 실행을 멈추고 질문을 보내고,
// 답을 받으면 지금까지의 답을 모두 넣어 처음부터 다시 실행해요 (이미 본 출력은 숨겨요).
// 서비스 워커로 실제로 기다리는 방식은 아이패드(WebKit)에서 기다리는 도중 끊겨서 쓰지 않아요.
const bridge = {
  post_output(stream, text) {
    postMessage({ type: "output", stream, text });
  },
  post_input_request(prompt) {
    postMessage({ type: "input", prompt });
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
    const python = pyodide.runPython("import sys; sys.version.split()[0]");
    postMessage({ type: "ready", python });
  } catch (err) {
    postMessage({ type: "fatal", message: String(err && err.message ? err.message : err) });
  }
}

function run({ runId, code, answers, seed }) {
  let result;
  try {
    const json = runFn(code, JSON.stringify(answers || []), seed, "replay", bridge);
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
