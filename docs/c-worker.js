/* 파이브릿지 C 엔진 (모듈 Web Worker).
 *
 * 우리가 만든 C 실행기(js/c/)로 코드를 실행해요. 파이썬 엔진과 같은 메시지를 주고받아요.
 * scanf 같은 입력은 파이썬과 같은 "다시 실행" 방식이에요.
 */
import { runC } from "./js/c/index.js";

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    postMessage({ type: "ready", label: "C" });
    return;
  }
  if (msg.type !== "run") return;
  let result;
  try {
    result = runC(msg.code, {
      answers: msg.answers,
      startTime: msg.time,
      onOutput: (text) => postMessage({ type: "output", stream: "stdout", text }),
      onInput: (prompt) => postMessage({ type: "input", prompt }),
    });
  } catch (err) {
    result = {
      status: "error",
      error: { type: "C 실행기 오류", title: "실행기 내부 오류가 났어요", detail: String(err && err.message ? err.message : err), message: "", line: null },
      variables: [],
    };
  }
  postMessage({ type: "done", runId: msg.runId, result });
};
