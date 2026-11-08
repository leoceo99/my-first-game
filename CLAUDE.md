# CLAUDE.md — my-first-game 운영 가이드

> **새 세션은 이 파일과 `TODO.md`만 읽고 바로 이어가면 된다.**
> 이 파일 = 변하지 않는 규칙과 역할. `TODO.md` = 지금 상태(할 일 / 진행 중 / 완료 / 결정 기록 / 세션 등록부).

---

## 1. 프로젝트 소개

- 저장소: `leoceo99/my-first-game`
- 목표(README): **"Action에서 사용할 게임 만들기"**
- 게임 방향(**잠정**, 11-08 총괄 결정, `TODO.md` T-010): **브라우저 2D 액션 게임**. 캐릭터가 움직이고 점프하며 적을 피해 코인을 모은다.
  GitHub Actions가 GitHub Pages로 자동 배포한다. 다른 후보는 `docs/game-ideas.md`에 있다. 사용자가 바꾸면 따른다.
- 기술 스택: **TypeScript + Vite + Canvas 2D**(게임 엔진 없음), 테스트는 **Vitest**, 패키지 관리는 **npm**.
  - 게임 규칙(`src/core`)은 순수 TypeScript로 쓰고 DOM·브라우저 API를 쓰지 않는다. 그래야 Vitest로 바로 테스트할 수 있다.
  - 화면·입력(`src/ui`)만 Canvas, 키보드, 터치를 다룬다.
- 명령(T-012에서 확정): `npm ci`(설치) → `npm run dev`(개발 서버) / `npm test`(테스트) / `npm run build`(배포용 빌드, `dist/`) / `npm run preview`
- 기본 브랜치: `main` (사용자만 병합한다)
- 통합 브랜치(총괄 세션용): `claude/vibrant-archimedes-t0utvy`

---

## 2. 이 환경에서 되는 것 / 안 되는 것

웹/모바일 Claude Code(클라우드 세션)에서 **직접 시도해서 확인한 결과**다(2026-11-07~08). 상세 기록은 `TODO.md` "실험 기록".

| 기능 | 결과 | 핵심 사용법 |
|---|---|---|
| 서브에이전트 | ✅ | `Agent` 도구, 백그라운드 실행. 끝나면 보고가 자동으로 온다. 비용을 줄이려면 `model: "sonnet"` |
| 서브에이전트 worktree 격리 | ✅ 주의 | `isolation: "worktree"`. **`main`에서 갈라지고**, 안에서 복합 명령(`&&`, heredoc)이 거부됨 → 5.2 |
| 병렬 작업 | ✅ | 서브에이전트 + 작업 세션 동시 실행. 동시 3개 이하(사용량 경고 시 2개) |
| 작업 세션 생성·확인·지시·답장 | ✅ | `create_session` / `get_session`, `list_events(kinds=["result"], limit=5)` / `send_message` / 답장은 총괄 알림함(`ReadNotifications`) |
| 작업 세션 브랜치 → 총괄 병합 | ✅ (T-012) | 작업 세션이 자기 브랜치에 푸시 → 총괄이 `git fetch` → 5.4 체크리스트 → `git merge --no-ff` |
| 서버 예약 작업 | ✅ | `send_later`(1회), `create_trigger`(반복, 보통 최소 1시간). 쉬고 있는 총괄 세션을 깨운다 |
| 세션 안 예약(`CronCreate`) | ⚠️ 비추천 | 메모리에만 있어서 컨테이너가 회수되면 사라진다 |
| `SendMessage` / `ListAgents` | ⚠️ 대상 없음 | 로컬 피어용. 클라우드 세션끼리는 `send_message` |
| GitHub | ✅ | MCP 도구(브랜치·PR·Actions 조회). 워크플로 파일 푸시 됨(T-014). PR은 사용자 요청 때만. `gh` CLI 안 됨 |
| 브라우저 확인 | ✅ (T-012) | 내장 Playwright(`require('playwright')`)로 화면·입력을 직접 확인 |
| 권한 | Auto가 최대 | Bypass 없음. `.claude/settings.json` 쓰기는 Auto 안전장치가 막음 → 사용자 결정(U-02) |
| Agent Teams, `.claude/agents/*.md` | 미확인 | Agent Teams는 실험 기능이라 쓰지 않는다. 에이전트 정의 파일은 T-015 때 시험한다 |

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
| **L0 총괄** | 총괄 세션만 | `CLAUDE.md`, `TODO.md`, `README.md`, `.claude/**`, `.github/**`, `.gitignore`, `docs/permissions.md`, 루트 설정 파일(`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`) |
| **L1 게임 로직** | 작업 세션 / 서브에이전트 | `src/core/**`, `tests/core/**` (DOM·브라우저 API 금지) |
| **L2 화면·입력·에셋** | 작업 세션 / 서브에이전트 | `index.html`, `src/ui/**`, `public/**`, `tests/ui/**` |
| **L3 문서·조사** | 작업 세션 / 서브에이전트 | `docs/**` (`docs/permissions.md` 제외) |
| **보고서** | 각 작업자 | `reports/<작업ID>.md` (자기 작업 ID 파일만) |

- **위임**: 총괄은 작업 하나에 한해 다른 레인이나 L0 파일의 수정 권한을 줄 수 있다. 위임한 파일은 `TODO.md`의 그 작업 행 "파일 범위"에 적는다. 적혀 있지 않으면 권한이 없다.
- 새 디렉터리가 필요하면 총괄이 이 표에 먼저 추가한다.
- 레인 밖 파일 수정이 필요하면 직접 고치지 말고, 보고서의 "총괄에게 요청"에 적는다.
- **`TODO.md`는 총괄만 고친다.** 작업자는 `reports/<작업ID>.md`에만 결과를 쓴다(작업 ID마다 파일이 달라서 충돌이 없다).
- 같은 레인에 작업자 두 명을 동시에 배정하지 않는다. 꼭 필요하면 서브에이전트를 `isolation: "worktree"`로 돌린다.

---

## 4. 작업 규칙 (모든 세션·에이전트 공통)

### 4.1 절대 금지
1. **파일 삭제 금지**: `rm`, `git rm`, `git clean` 등. 이름 변경·이동도 총괄의 사전 승인이 필요하다.
2. **강제 푸시·히스토리 재작성 금지**: `git push --force`/`-f`, `--force-with-lease`, `git reset --hard` 후 푸시, `rebase` 후 푸시.
3. **저장소 밖 작업 금지**: 다른 저장소, 사용자와 무관한 다른 세션에 지시하기, 외부 서비스에 게시하기.
   같은 저장소라도 이 체계가 만들지 않은 브랜치·세션(`TODO.md` 세션 등록부의 "관리 밖")은 **읽기만** 한다.
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

근거 자료: `docs/orchestration-research.md` (T-016: Anthropic 공식 문서·엔지니어링 글, 커뮤니티 글, 영상 목록)

### 5.1 직접 할까, 맡길까
- **총괄이 직접**: 한 파일·한 레인 안에서 10분 안에 끝나는 일, L0 파일, 병합·검증.
- **서브에이전트**: 서로 독립적이고 출력이 큰 일(조사, 한 레인 안의 30분 이내 구현, 리뷰).
- **작업 세션**: 30분 넘는 일, 총괄이 끝나도 계속돼야 하는 일, 결과를 자기 브랜치에 남겨야 하는 일.
- 여러 에이전트를 쓰면 토큰을 훨씬 많이 쓴다(Anthropic 글 기준 일반 채팅의 약 15배). **쪼갤 이유가 없으면 쪼개지 않는다.**
- 맡기기 전에 `TODO.md` "진행 중"에 **계획을 먼저 적는다**: 목표 / 파일 범위 / 완료 기준(실행 명령) / 상한 / 위험.

### 5.2 서브에이전트에게 맡기기
- `Agent` 도구. 다른 작업자와 파일이 겹칠 수 있으면 `isolation: "worktree"`, 싼 작업이면 `model: "sonnet"`.
- 서브에이전트는 총괄의 대화 내용을 모른다. **중요한 규칙은 프롬프트에 다시 적는다.** 프롬프트 템플릿:
  ```
  너는 my-first-game의 서브에이전트야. 먼저 CLAUDE.md와 TODO.md를 읽어.
  작업: <작업ID> <제목> / 레인: <L?> / 수정 가능 파일: <경로>
  할 일: <구체적 내용>
  완료 기준(명령): <예: npm test 통과, npm run build 성공>
  상한: 도구 호출 약 <N>회, 검색 <N>번. 넘으면 멈추고 그때까지 결과를 보고해.
  규칙: 수정 가능 파일 밖은 읽기만, 파일 삭제 금지, 푸시 금지, TODO.md 수정 금지.
  30분 넘게 걸리면 중간 커밋(worktree일 때)과 보고서 초안을 먼저 남겨.
  끝나면 reports/<작업ID>.md를 쓰고, 최종 답변에 한 일·바뀐 파일·완료 기준 명령 결과를 요약해.
  ```
- **worktree 주의 (T-004)**: worktree는 `main`에서 시작한다. 프롬프트에 다음을 넣는다.
  - "규칙 파일은 `/home/user/my-first-game/CLAUDE.md`, `/home/user/my-first-game/TODO.md`에서 읽어."
  - "먼저 worktree 안에서 `git merge --ff-only claude/vibrant-archimedes-t0utvy`를 실행하고, 그다음 `npm ci`를 실행해." (`--ff-only`는 미검증, T-015. 실패하면 보고만)
  - "git 명령은 하나씩 따로 실행하고(`&&`, heredoc 금지), 파일은 Write 도구로 써."
- 끝난 worktree 폴더는 지우지 않는다(삭제 금지). `.gitignore`에 있고, 컨테이너가 회수되면 함께 사라진다.

### 5.3 작업 세션 만들기
- `create_session`: `source_url=https://github.com/leoceo99/my-first-game`, `source_revision=<통합 브랜치>`,
  `outcome_branch=claude/<레인>-<작업ID>`, `title="[작업ID] 제목"`, `tags=["my-first-game:worker"]`, `model="claude-sonnet-5-5"`(싼 작업).
- 프롬프트는 5.2 템플릿에서 "푸시 금지"를 "**자기 브랜치(`claude/<레인>-<작업ID>`)에만 푸시**"로 바꾸고, 마지막에 다음을 붙인다:
  "끝나면 `mcp__claude-code-remote__send_message`로 session_id `<총괄 세션 ID>`에 한 줄 보고: `<작업ID> 완료: 커밋 <해시>, 테스트 <N>개 통과, 빌드 <성공/실패>`. 막히면 이유를 한 줄로 보내고 멈춰."
- 만든 즉시 `TODO.md` "세션 등록부"와 "진행 중"에 세션 ID와 브랜치를 적는다.
- 보고가 안 올 경우를 대비해 `send_later(delay_minutes=40, ...)`로 점검 예약을 건다.

### 5.4 감독과 병합 전 체크리스트
- 상태: `get_session(session_id)` → `status_bucket`(working / blocked / review_ready / completed / failed).
- 대화: `list_events(session_id, kinds=["result"], limit=5)` (`assistant`까지 넣으면 출력이 매우 길다).
- 답장: `ReadNotifications`. 추가 지시: `send_message(session_id, message, priority="later")`. 진로가 틀어졌으면 `interrupt_session` 후 지시.
- **병합 전 체크리스트** (보고서만 믿고 병합하지 않는다. T-012에서 실제로 쓴 절차):
  1. `git fetch origin <작업 브랜치>` → `git diff --stat <통합 브랜치>...origin/<작업 브랜치>`로 **허용 범위 밖 파일이 없는지** 확인
  2. 코드를 읽고 검토한다. diff가 크면 검토 전용 서브에이전트(Sonnet, 읽기 전용)에게 리뷰를 맡길 수 있다.
  3. `git merge --no-ff` 후 총괄이 **직접** `npm ci`, `npm test`, `npm run build` 실행
  4. 화면이 바뀌었으면 `npx vite preview` + Playwright로 실제 동작 확인(예: 키 입력 → 이동 거리, 콘솔 오류 없음)
  5. 보고서의 "남은 일 / 위험"을 Backlog에 옮긴다
  6. 푸시 후 GitHub Actions 결과 확인(MCP `actions_list`)
- 같은 작업이 2번 실패하면 더 작게 쪼개서 다시 맡긴다.
- 끝난 작업 세션은 그대로 두면 쉬는 상태로 남고 사용량을 쓰지 않는다. 보관(archive)은 사용자가 정리할 때 한다.

### 5.5 정기 점검
- 1회 점검: `send_later(delay_minutes=N, message=...)` → 지정한 시간에 총괄 세션에 메시지가 도착한다.
- 반복 점검: `create_trigger`(최소 1시간 간격). 작업 세션이 오래 돌 때만 쓰고, 필요 없어지면 `update_trigger(enabled=false)`로 끈다.

---

## 6. 사용자가 직접 하는 일
1. **`main` 병합**: 통합 브랜치를 확인하고 PR을 만들어(또는 총괄에게 "PR 만들어줘"라고 요청) 병합한다.
2. **권한 모드**: 프롬프트 옆 모드 메뉴에서 **Auto**를 고른다(클라우드에서 가장 넓은 모드. Bypass는 없다).
   확인 질문을 더 줄이고 금지 명령을 막고 싶으면 `docs/permissions.md`의 `.claude/settings.json` 안을 직접 적용한다.
3. **게임 방향 결정**: `docs/game-ideas.md`를 보고 `TODO.md`의 T-010에 답한다.
4. **사용량 한도**: 한도가 초기화될 때까지 기다리거나 요금제를 확인한다.
