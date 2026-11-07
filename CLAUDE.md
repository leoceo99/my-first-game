# CLAUDE.md — my-first-game 운영 가이드

> **새 세션은 이 파일과 `TODO.md`만 읽고 바로 이어가면 된다.**
> 이 파일 = 변하지 않는 규칙과 역할. `TODO.md` = 지금 상태(할 일 / 진행 중 / 완료 / 결정 기록 / 세션 등록부).

---

## 1. 프로젝트 소개

- 저장소: `leoceo99/my-first-game`
- 목표(README): **"Action에서 사용할 게임 만들기"**
- 현재 상태: 게임 코드는 아직 없다. 장르·플랫폼·기술 스택은 **사용자 결정 대기** (`TODO.md`의 "결정 필요" 참고).
  게임 방향 후보는 `docs/game-ideas.md`에 정리되어 있다.
- 기본 브랜치: `main` (사용자만 병합한다)
- 통합 브랜치(총괄 세션용): `claude/vibrant-archimedes-t0utvy`

---

## 2. 이 환경에서 되는 것 / 안 되는 것

2026-11-07에 웹/모바일 Claude Code(클라우드 세션)에서 **직접 시도해서 확인한 결과**다. 상세 근거는 `TODO.md`의 완료 항목 T-001, T-004 ~ T-006에 있다.

| 기능 | 결과 | 쓰는 방법 / 비고 |
|---|---|---|
| 서브에이전트 | 🔄 확인 중 (T-004) | `Agent` 도구. |
| 서브에이전트 파일 격리 | 🔄 확인 중 (T-004) | `Agent`의 `isolation: "worktree"`. |
| 병렬 작업 | 🔄 확인 중 (T-004, T-005) | 서브에이전트 + 작업 세션 동시 실행. **규칙상 동시 3개 이하.** |
| 새 클라우드 세션 만들기 | 🔄 확인 중 (T-005) | `create_session` (MCP `claude-code-remote`). |
| 다른 세션 상태·대화 확인 | ✅ 됨 (목록) | `list_sessions`, `get_session`(status_bucket), `list_events`(대화 기록). |
| 다른 세션에 지시 보내기 | 🔄 확인 중 (T-005) | `send_message(session_id, …)`. |
| 작업 세션 → 총괄 세션 답장 | 🔄 확인 중 (T-005) | |
| `SendMessage` / `ListAgents` (로컬 피어) | ⚠️ 이 환경엔 대상 없음 | 같은 머신의 로컬 세션용이다. 다른 클라우드 세션이 있어도 목록에 안 나온다. 클라우드 세션끼리는 `send_message`를 쓴다. |
| 예약 작업 (서버) | 🔄 확인 중 (T-006) | `send_later`(1회), `create_trigger`(반복 cron). |
| 예약 작업 (세션 내 `CronCreate`) | 🔄 확인 중 (T-006) | |
| PR 만들기·감시 | ✅ 가능 | GitHub MCP 도구, `subscribe_pr_activity`. **사용자가 요청할 때만** PR을 만든다. |
| `gh` CLI / GitHub 직접 API | ❌ 안 됨 | GitHub MCP 도구를 대신 쓴다(검색만 `gh api search/...` 허용). |
| 권한 모드 "Bypass permissions" | ❌ 클라우드에서 없음 | 가장 넓은 모드는 **Auto**다. 사용자가 프롬프트 옆 모드 메뉴에서 고른다. |
| 사용자 PC 폴더 / Remote Control | 미사용 | 이 프로젝트에는 필요 없어서 시도하지 않았다. |

---

## 3. 역할 분담

### 3.1 세 가지 역할

| 역할 | 개수 | 언제 쓰나 | 브랜치 | 커밋/푸시 |
|---|---|---|---|---|
| **총괄 세션** (Orchestrator) | 정확히 1개 | 항상. 계획, 배정, 감독, 통합, 보고 | 통합 브랜치 `claude/vibrant-archimedes-t0utvy` | 함 (통합 브랜치에만) |
| **서브에이전트** (Agent 도구) | 0~3개 | 짧은 작업(수 분~30분), 한 레인 안에서 끝나는 일 | 공유 작업 트리, 또는 worktree 브랜치(`isolation: "worktree"`) | worktree일 때만 로컬 커밋, **푸시 금지** |
| **작업 세션** (`create_session`) | 0~3개 | 긴 작업, 총괄 세션이 끝나도 계속돼야 하는 일 | 세션마다 자기 브랜치 `claude/<레인>-<작업ID>` | 자기 브랜치에만 푸시 |

- **동시 실행 한도: 서브에이전트 + 작업 세션 합계 3개 이하.**
- 총괄 세션이 끝나면, 새 세션이 이 파일과 `TODO.md`를 읽고 **총괄 역할을 이어받는다**
  (`TODO.md` "세션 등록부"의 세션 ID로 `get_session`을 호출해 작업 세션 상태를 확인한다).

### 3.2 파일 범위 (레인) — 충돌 방지의 핵심

모든 작업은 **레인 하나**에 속하고, **자기 레인의 파일만** 수정한다.

| 레인 | 담당 | 수정할 수 있는 파일 |
|---|---|---|
| **L0 총괄** | 총괄 세션만 | `CLAUDE.md`, `TODO.md`, `README.md`, `.claude/**`, `.github/**`, `.gitignore`, `docs/permissions.md`, 루트 설정 파일(`package.json` 등) |
| **L1 게임 로직** | 작업 세션 / 서브에이전트 | `src/core/**`, `tests/core/**` |
| **L2 화면·입력·에셋** | 작업 세션 / 서브에이전트 | `src/ui/**`, `assets/**`, `tests/ui/**` |
| **L3 문서·조사** | 작업 세션 / 서브에이전트 | `docs/**` |
| **보고서** | 각 작업자 | `reports/<작업ID>.md` (자기 작업 ID 파일만) |

- 레인 경로는 기술 스택이 정해지면 총괄이 이 표를 고친다(T-011).
- 레인 밖 파일 수정이 필요하면 직접 고치지 말고, 보고서의 "총괄에게 요청"에 적는다.
- **`TODO.md`는 총괄만 고친다.** 작업자는 `reports/<작업ID>.md`에만 결과를 쓴다(작업 ID마다 파일이 달라서 충돌이 없다).
- 같은 레인에 작업자 두 명을 동시에 배정하지 않는다. 꼭 필요하면 서브에이전트를 `isolation: "worktree"`로 돌린다.

---

## 4. 작업 규칙 (모든 세션·에이전트 공통)

### 4.1 절대 금지
1. **파일 삭제 금지**: `rm`, `git rm`, `git clean` 등. 이름 변경·이동도 총괄의 사전 승인이 필요하다.
2. **강제 푸시·히스토리 재작성 금지**: `git push --force`/`-f`, `--force-with-lease`, `git reset --hard` 후 푸시, `rebase` 후 푸시.
3. **저장소 밖 작업 금지**: 다른 저장소, 사용자와 무관한 다른 세션에 지시하기, 외부 서비스에 게시하기.
4. **`main` 직접 푸시·병합 금지**: `main` 병합은 사용자가 확인한 뒤 직접 한다.
5. PR은 사용자가 요청할 때만 만든다.

(이 명령들을 도구 수준에서도 막는 `.claude/settings.json` 안이 `docs/permissions.md`에 있다. 적용은 사용자가 결정한다. 적용 여부와 상관없이 이 규칙이 먼저다.)

### 4.2 작업 흐름
1. **시작**: `CLAUDE.md` → `TODO.md` 읽기 → 자기 작업 ID, 레인, 파일 범위 확인.
2. **작업**: 자기 레인 파일만 수정. 작게 나눠서 자주 커밋(`[작업ID] 무엇을 했나` 형식).
3. **검증**: 테스트·실행 확인이 가능하면 하고, 결과를 보고서에 그대로 적는다(실패도 그대로).
4. **보고**: `reports/<작업ID>.md`를 아래 형식으로 쓴다.
   ```
   # <작업ID> <제목>
   - 담당: <서브에이전트 / 세션 ID>
   - 한 일:
   - 바뀐 파일:
   - 검증: (명령과 결과)
   - 남은 일 / 위험:
   - 총괄에게 요청:
   ```
5. **종료**: 작업 세션은 자기 브랜치에 푸시하고 끝낸다. 서브에이전트는 최종 답변에 보고서 요약을 넣는다.

### 4.3 사용량 규칙
- 큰 작업이나 병렬 작업을 시작하기 전에 `get_session`의 `rate_limit_info.status`를 확인한다.
  - `allowed`: 정상 진행.
  - `allowed_warning`: **새 병렬 작업을 늘리지 않는다.** 꼭 필요한 작업은 싼 모델(Sonnet/Haiku)에 맡긴다. 단계마다 `TODO.md`를 커밋·푸시한다.
  - 한도 도달 직전이거나 `rejected`: **즉시 멈추고** `TODO.md` "진행 중"에 현재 상태와 다음 단계를 적고 커밋·푸시한다.
- 같은 조사·실험을 반복하지 않는다. 결과는 `TODO.md` 완료 항목에서 먼저 찾는다.
- 반복 예약 작업은 꼭 필요할 때만 만들고, 만든 사실을 "세션 등록부"에 적는다.

### 4.4 의사결정
- 사용자에게 묻지 않고 합리적으로 정하되, **무엇을 왜 골랐는지** `TODO.md` "결정 기록"에 남긴다.
- 사용자만 정할 수 있는 것(게임 방향, `main` 병합, 권한 모드)은 "결정 필요"에 올린다.

---

## 5. 총괄 세션 플레이북

### 5.1 서브에이전트에게 맡기기
- `Agent` 도구. 여러 파일을 바꾸는 작업이면 `isolation: "worktree"`, 싼 작업이면 `model: "sonnet"`.
- 프롬프트 템플릿:
  ```
  너는 my-first-game의 서브에이전트야. 먼저 CLAUDE.md와 TODO.md를 읽어.
  작업: <작업ID> <제목> / 레인: <L?> / 수정 가능 파일: <경로>
  할 일: <구체적 내용, 완료 기준>
  규칙: 레인 밖 파일 수정 금지, 파일 삭제 금지, 푸시 금지, TODO.md 수정 금지.
  끝나면 reports/<작업ID>.md를 쓰고(worktree면 그 안에서 커밋), 최종 답변에 한 일·바뀐 파일·검증 결과를 요약해.
  ```
- 결과가 오면: 변경을 검토 → (worktree면 `git merge <worktree 브랜치>`) → 통합 브랜치에 커밋·푸시 → `TODO.md` 갱신.

### 5.2 작업 세션 만들기
- `create_session`: `source_url=https://github.com/leoceo99/my-first-game`, `source_revision=<통합 브랜치>`,
  `outcome_branch=claude/<레인>-<작업ID>`, `title="[작업ID] 제목"`, `tags=["my-first-game:worker"]`.
- 프롬프트는 5.1 템플릿에서 "푸시 금지"를 "**자기 브랜치(`claude/<레인>-<작업ID>`)에만 푸시**"로 바꿔 쓴다.
- 만든 즉시 `TODO.md` "세션 등록부"와 "진행 중"에 세션 ID와 브랜치를 적는다.

### 5.3 감독·지시
- 상태: `get_session(session_id)` → `status_bucket`(working / blocked / review_ready / completed / failed).
- 대화 확인: `list_events(session_id, kinds=["assistant","result"], limit=100)`.
- 추가 지시: `send_message(session_id, message)`. 진로가 틀어졌으면 `interrupt_session` 후 지시한다.
- 결과 받기: `git fetch origin claude/<레인>-<작업ID>` → 검토 → `git merge --no-ff` → 통합 브랜치 푸시.

### 5.4 정기 점검
- 1회 점검: `send_later(delay_minutes=N, message=...)` → 지정한 시간에 총괄 세션에 메시지가 도착한다.
- 반복 점검: `create_trigger`(최소 1시간 간격). 필요 없어지면 `update_trigger(enabled=false)`로 끈다.

---

## 6. 사용자가 직접 하는 일
1. **`main` 병합**: 통합 브랜치를 확인하고 PR을 만들어(또는 총괄에게 "PR 만들어줘"라고 요청) 병합한다.
2. **권한 모드**: 프롬프트 옆 모드 메뉴에서 **Auto**를 고른다(클라우드에서 가장 넓은 모드. Bypass는 없다).
   확인 질문을 더 줄이고 금지 명령을 막고 싶으면 `docs/permissions.md`의 `.claude/settings.json` 안을 직접 적용한다.
3. **게임 방향 결정**: `docs/game-ideas.md`를 보고 `TODO.md`의 T-010에 답한다.
4. **사용량 한도**: 한도가 초기화될 때까지 기다리거나 요금제를 확인한다.
