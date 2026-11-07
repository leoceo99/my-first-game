# TODO.md — 작업 현황판

> 규칙과 역할은 `CLAUDE.md`. 이 파일은 **총괄 세션만** 고친다. 작업자는 `reports/<작업ID>.md`에 결과를 쓴다.
> 작업 ID 형식: `T-001`부터 차례로(사용자 결정은 `U-01`…). 상태가 바뀌면 행을 해당 표로 옮긴다.

마지막 갱신: 2026-11-07 17:00 UTC 무렵 (총괄 세션 `session_01BfrX53CHWvJYbgaip4CsNq`)

## 지금 상태 한 줄 요약 (다음 세션은 여기부터)
운영 체계 구축과 시범 운영 완료. **사용자의 게임 방향 결정(T-010)을 기다리는 중**이다. 결정이 나면 T-011부터 진행한다.
사용량: 7일 한도 `allowed_warning` 상태(11-10 02:00 UTC 초기화) → 초기화 전까지는 병렬 작업을 늘리지 말 것.

---

## 결정 필요 (사용자)

| ID | 질문 | 참고 | 답 |
|---|---|---|---|
| T-010 | ① "Action"은 무슨 뜻인가? (a) GitHub Actions로 돌아가는 게임 (b) 액션 장르 게임 (c) 둘 다/기타 ② 어디서 하나? (a) 웹 브라우저 (b) GitHub 저장소 안(이슈/README) (c) 상관없음 ③ 처음 목표는? (a) 빨리 동작하는 작은 것 (b) 오래 키울 큰 게임 (c) 추천대로 | `docs/game-ideas.md` (추천: 후보 B, 브라우저 2D 액션 + Pages 자동 배포) | (대기) |
| U-01 | 통합 브랜치 `claude/vibrant-archimedes-t0utvy`를 `main`에 병합할까? | 이 브랜치의 변경 전체 | (대기) |
| U-02 | `.claude/settings.json` 권한 규칙을 적용할까? | `docs/permissions.md` | (대기) |

---

## 할 일 (Backlog)

| ID | 작업 | 레인 | 담당(예정) | 선행 | 비고 |
|---|---|---|---|---|---|
| T-011 | 기술 스택 확정 후 `CLAUDE.md` 레인 경로 갱신 | L0 | 총괄 | T-010 | 후보 B면 TypeScript + Vite, `src/core`/`src/ui` 그대로 사용 가능 |
| T-012 | 프로젝트 골격 만들기 (빌드·실행 명령, 빈 화면) | L1 | 작업 세션 | T-011 | |
| T-013 | 테스트 실행 환경 + 첫 테스트 | L1 | 서브에이전트 | T-012 | |
| T-014 | GitHub Actions CI (테스트 자동 실행, 필요하면 Pages 배포) | L0 | 총괄 | T-013 | |
| T-015 | worktree 서브에이전트의 `git merge --ff-only <통합 브랜치>` 권장 절차 검증 | L0 | 총괄 | - | 다음 worktree 작업 때 함께 확인 (CLAUDE.md 5.1) |

---

## 진행 중

| ID | 작업 | 담당 | 브랜치 | 시작 | 상태 / 다음 단계 |
|---|---|---|---|---|---|
| T-006 | 예약 작업 실험 | 총괄 | - | 11-07 | `CronCreate` 확인 끝. `send_later`(`trig_01DoxRvLPaXRPz3bE1KAGcUN`)가 17:04 UTC에 실행되면 여기에 기록하고 완료로 옮긴다 |

---

## 완료

| ID | 작업 | 담당 | 결과 | 날짜 |
|---|---|---|---|---|
| T-001 | 환경 기능 조사 | 총괄 | 아래 "실험 기록" | 11-07 |
| T-002 | 운영 체계 설계 (역할 3종, 레인 4개, 동시 3개 한도) | 총괄 | `CLAUDE.md` 3장 | 11-07 |
| T-003 | `CLAUDE.md`, `TODO.md`, `.gitignore`, `docs/permissions.md` 작성 | 총괄 | 커밋 `854c9c8`. `.claude/settings.json`은 Auto 안전장치가 막아서 제안 문서로 대체 | 11-07 |
| T-004 | **시범 운영**: 서브에이전트(worktree, Sonnet)가 게임 방향 후보 정리 | 서브에이전트 | ✅ 성공. `docs/game-ideas.md`, `reports/T-004.md` 작성. 레인(L3) 밖 수정 없음. worktree 커밋 `3135306` → 통합 브랜치에 병합 `0901913`. 약 1분, 86k 토큰. 발견한 문제는 아래 실험 기록 | 11-07 |
| T-005 | 세션 간 기능 실험 (읽기 전용 작업 세션, Sonnet) | 작업 세션 `session_01BfrX54BgLQ8Mg9jKF8Y3Mi` | ✅ 성공. 새 세션이 `CLAUDE.md`+`TODO.md`만 보고 규칙과 "Backlog는 T-010에 막혀 있음"을 정확히 파악했다. 추가 지시를 따랐고 답장도 왔다. 비용 약 $0.21 | 11-07 |

---

## 실험 기록 (T-001, T-004 ~ T-006)

| 기능 | 시도한 것 | 결과 |
|---|---|---|
| 세션 정보 | `get_session` (자기 자신) | ✅ 모델, 권한 모드(auto), 사용량 상태 확인 가능. 시작부터 `rate_limit_info`가 `seven_day / allowed_warning` |
| 세션 목록 | `list_sessions(mine=true)` | ✅ 이 계정의 다른 클라우드 세션 2개가 보임 (다른 프로젝트라 지시하지 않음) |
| 로컬 피어 | `ListAgents` | ⚠️ "같은 머신에 다른 세션 없음". 다른 클라우드 세션도 목록에 안 나옴 → 클라우드끼리는 `send_message` 사용 |
| 세션 만들기 | `create_session`(시작 브랜치=통합 브랜치, 결과 브랜치 `claude/test-T-005`, Sonnet, 태그) | ✅ 바로 실행됨. `CLAUDE.md`는 새 세션의 컨텍스트에 자동으로 들어감 |
| 세션 확인 | `get_session`, `list_events(kinds=["result"])` | ✅ 상태와 각 턴의 최종 답을 읽을 수 있음. `assistant`까지 넣으면 출력이 매우 길다 |
| 지시 보내기 | `send_message(priority="later")` | ✅ 상대 턴이 끝난 뒤 전달됨. 지시대로 `git` 결과만 답하고 멈춤 |
| 답장 받기 | 작업 세션 → `send_message(총괄 ID)` | ✅ 총괄 알림함(`ReadNotifications`)에 도착 |
| 서브에이전트 | `Agent`(백그라운드, `model: sonnet`, `isolation: worktree`) | ✅ 작업, 커밋, 보고 정상. ⚠️ worktree가 `main`(Initial commit) 기준이라 규칙 파일이 없었음(메인 체크아웃에서 읽음). ⚠️ worktree 안에서 `cd`+복합 명령이 거부돼 명령을 하나씩 실행함 → CLAUDE.md 5.1에 대응 방법 기록 |
| 병렬 | 서브에이전트 1 + 작업 세션 1 동시 실행 | ✅ 충돌 없음 (파일 범위가 달라서) |
| 세션 내 예약 | `CronCreate` → `CronList` → `CronDelete` | ⚠️ 등록·조회·취소 됨. 메모리에만 있어서 비추천. 쓸데없는 실행을 막으려고 바로 취소함 |
| 서버 예약 | `send_later(12분)` | 🔄 등록됨 (`trig_01DoxRvLPaXRPz3bE1KAGcUN`, 17:04 UTC 실행 예정) |
| GitHub | `list_branches` (MCP) | ✅ 브랜치 조회 가능. `gh` CLI는 이 환경에서 안 됨 |
| 권한 설정 파일 | `.claude/settings.json` 쓰기 | ❌ Auto 안전장치가 "자기 권한 수정"으로 거부 → `docs/permissions.md`에 안만 남김 |
| 권한 모드 | 문서 확인 | 클라우드에는 Bypass가 없음. Auto가 가장 넓음. 이 세션은 이미 Auto |

---

## 결정 기록

| 날짜 | 결정 | 이유 |
|---|---|---|
| 11-07 | 이 세션의 브랜치 `claude/vibrant-archimedes-t0utvy`를 **통합 브랜치**로 사용 | 이 세션이 푸시할 수 있는 지정 브랜치. `main`은 사용자만 병합 |
| 11-07 | 작업자는 `TODO.md`를 고치지 않고 `reports/<작업ID>.md`에 보고 | 여러 브랜치가 같은 파일을 고치면 병합 충돌. 작업 ID별 파일은 충돌하지 않음 |
| 11-07 | 레인을 디렉터리 기준으로 나눔 (L0 총괄 / L1 로직 / L2 화면 / L3 문서) | 게임 종류와 상관없이 쓸 수 있는 구분. 스택이 정해지면 T-011에서 경로 조정 |
| 11-07 | 사용량 경고(`allowed_warning`) 상태지만 작업은 계속하고, 대신 가볍게 진행 | 시작할 때부터 경고였다(이 작업 때문이 아님). 병렬은 2개만, 실험용 세션·서브에이전트는 Sonnet, 단계마다 푸시 |
| 11-07 | `.claude/settings.json`(allow + 금지 명령 deny) 작성 시도 → Auto 안전장치가 거부. 우회하지 않고 `docs/permissions.md`에 제안으로만 남김 | 권한 변경은 사용자가 결정할 일 (U-02) |
| 11-07 | PR은 만들지 않음 | 사용자가 직접 확인하고 병합하겠다고 함. 요청하면 만든다 |
| 11-07 | 시범 작업을 "게임 방향 후보 정리"로 정함 | 체계를 시험하면서 동시에 사용자의 다음 결정(T-010)에 실제로 필요한 자료를 만들 수 있음. 코드가 없어서 다른 작은 작업이 마땅치 않음 |
| 11-07 | T-005 작업 세션은 보관(archive)하지 않고 쉬는 상태로 둠 | 보관은 사람이 확인한 뒤에 하는 것이 원칙. 쉬는 세션은 사용량을 쓰지 않음 |
| 11-07 | 끝난 worktree 폴더는 지우지 않음 | 파일 삭제 금지 규칙. `.gitignore`에 있어 커밋되지 않고 컨테이너와 함께 사라짐 |

---

## 세션 등록부

현재 살아 있는 작업 세션과 예약 작업. 총괄이 바뀌면 여기 있는 ID로 상태를 확인한다.

| 종류 | ID | 작업 | 브랜치 | 상태 | 비고 |
|---|---|---|---|---|---|
| 총괄 세션 | `session_01BfrX53CHWvJYbgaip4CsNq` | 총괄 | `claude/vibrant-archimedes-t0utvy` | 실행 중 | |
| 작업 세션 | `session_01BfrX54BgLQ8Mg9jKF8Y3Mi` | T-005 | `claude/test-T-005` (푸시 없음) | 완료, 쉬는 중 | 사용자가 정리할 때 보관하면 됨 |
| 서버 예약(1회) | `trig_01DoxRvLPaXRPz3bE1KAGcUN` | T-006 | - | 17:04 UTC 실행 예정 | 실행 후 자동으로 꺼짐 |
