# TODO.md — 자비스 작업 현황판

> 규칙과 역할은 `CLAUDE.md`. 이 파일은 **총괄 세션만** 고친다. 작업자는 `reports/<작업ID>.md`에 결과를 쓴다.
> 작업 ID: 자비스 작업은 `J-001`부터, 사용자 결정은 `U-01`부터. 예전 게임 시험 단계는 `T-xxx`(아래 "이전 기록").

마지막 갱신: 2026-11-10 12:25 UTC (총괄 세션 `session_01BfrX53CHWvJYbgaip4CsNq`)

## 지금 상태 한 줄 요약 (다음 세션은 여기부터)
목표가 **자비스(모든 Claude 세션을 관리하는 비서)**로 확정됐다(11-10). 게임 코드는 `claude/game-prototype`로 분리했다. **상황판**(https://claude.ai/artifact/5ZCwN5t4XzQWUwJk48PEjz)과 **정기 브리핑**(브리핑 전용 세션 `session_01BfrX51PuxE77gz1N787Ykw`를 8시간마다 깨우는 `trig_01SDsYw2dPkaCo3ZBcYGCcra`)이 생겼다. 첫 브리핑이 성공했다(J-002). 지금은 명령 사전(J-003)을 진행 중이다.
사용량: 11-10 12:09 UTC 확인 때 `five_hour / rejected`로 표시됐지만 초기화 시각이 지난 기록이었다. 단계마다 커밋·푸시하고, 작업자는 Sonnet을 쓴다.

---

## 결정 필요 (사용자)

| ID | 질문 | 참고 | 답 |
|---|---|---|---|
| U-01 | 통합 브랜치를 `main`에 병합할까? | U-04도 같이 볼 것 | (대기) |
| U-02 | `.claude/settings.json` 권한 규칙을 적용할까? | `docs/permissions.md` | (대기) |
| U-04 | 같은 저장소의 다른 작업 `claude/popular-game-dev-languages-mye732`(C/C++ 학습 도구)를 어떻게 할까? `main`에 둘 다 합치면 `README.md`, `.gitignore`, `docs/`가 겹친다. 이 저장소의 Pages도 지금 그 브랜치를 배포 중 | 자비스는 읽기만 한다 | (대기) |
| U-05 | 정기 브리핑을 얼마나 자주, 어떤 모델로 받을까? 지금은 **8시간마다**(`16 */8 * * *` UTC, 시간대를 몰라 간격으로 정함), 모델은 기본값. 예약 작업 모델은 사용자가 요청할 때만 바꿀 수 있다("브리핑은 Sonnet으로") | J-002 | (대기 — 지금은 기본값으로 동작) |
| U-06 | J-001 작업 세션이 시험하다 만든 **빈 Artifact**(https://claude.ai/artifact/GVDMutXxuRNsL2usBhKRUM)를 삭제할까? | 쓰지 않음. 삭제는 사용자 요청이 있을 때만 | (대기) |

## 허락 목록 (다른 프로젝트의 기존 세션에 자비스가 지시해도 되는 것)

| 대상 세션 / 저장소 | 허락한 일 | 날짜 |
|---|---|---|
| (없음 — 지금은 모든 세션을 읽고 요약만 한다) | | |

---

## 할 일 (Backlog)

| ID | 작업 | 레인 | 담당(예정) | 선행 | 비고 |
|---|---|---|---|---|---|
| J-004 | **세션 정리 승인 흐름**: 브리핑이 낸 정리 제안을 사용자가 승인하면(채팅 또는 상황판) 총괄이 보관·예약 끄기 실행 | L0+L2 | 총괄 | J-002 | 실행은 승인된 것만 |
| J-005 | **자기 개선 루프**: 주 1회 예약 작업이 자비스 기록(상황판, `TODO.md`, 보고서)과 Claude Code 새 기능을 살펴 `jarvis/improvements.md`·상황판에 개선안 제출 → 사용자 승인 → 반영 | L1 | 총괄 | J-002 | 예약 세션에는 저장소가 없어서 `add_repo`로 붙이거나 상황판 DB만 씀 |
| J-006 | **총괄 교대**: 이 세션은 대화가 길어 호출이 비싸다(누적 약 $12). 새 "자비스" 세션이 `CLAUDE.md`+`TODO.md`로 이어받게 한다 | L0 | 총괄 | J-002 | 사용자가 새 세션을 열거나 총괄이 `create_session`으로 만든다 |
| J-009 | 브리핑 전용 세션 교대: 대화가 쌓이면(예: 20회 실행마다) 새 브리핑 세션을 만들고 예약의 `persistent_session_id`를 바꾼다 | L0 | 총괄 | J-002 | 비용 관리 |
| J-007 | (아이디어) 상황판에서 버튼으로 승인·명령 → 다음 브리핑/총괄이 실행 | L2 | - | J-004 | |
| J-008 | (아이디어) 세션별 비용·사용량 추이 그래프 | L2 | - | J-002 | |
| J-010 | 브리핑 개선: `summary.updatedAt`을 모델이 짐작하지 말고 `date -u`로 찍기(시험 실행에서 실제보다 2분 늦은 시각이 기록됨) | L1 | 총괄 | - | 작은 수정 |

---

## 진행 중

| ID | 작업 (계획) | 담당 | 브랜치 | 시작 | 상태 / 다음 단계 |
|---|---|---|---|---|---|
| J-003 | 명령 사전 `jarvis/commands.md`. **파일**: `jarvis/commands.md`, `reports/J-003.md`. **완료 기준**: 명령 표·스스로 하는 일·하지 않는 일·시작하기, 150줄 이내. **상한**: 도구 호출 약 15회 | 서브에이전트 (Sonnet, 공유 작업 트리, 커밋은 총괄) | - | 11-10 12:19 | 실행 중 |

---

## 완료

| ID | 작업 | 담당 | 결과 | 날짜 |
|---|---|---|---|---|
| J-002 | 정기 브리핑: 브리핑 전용 세션 `session_01BfrX51PuxE77gz1N787Ykw`(Sonnet) + 예약 `trig_01SDsYw2dPkaCo3ZBcYGCcra`(8시간마다). 1차 방식(실행마다 새 세션)은 세션 조회 도구가 없어 실패 → 꺼 둠 | 총괄 | ✅ 첫 브리핑 12:18 UTC 성공(약 38초, $0.32): "이상 없음 — 세션 6개, 결정 대기 5건, 정리 제안 6건". 상황판 DB가 version 2로 갱신된 것을 총괄이 확인. 푸시 알림은 "중요"가 없어 아직 미확인 | 11-10 |
| J-001 | 상황판 Artifact(일반 페이지 + DB, 한국어, 모바일·다크 모드) + 브리핑 지시문 `jarvis/briefing.md` + 시험 브리핑 1회 | 작업 세션 `session_01BfrX52x2XYeTVLFYMoKjXF` (Sonnet) | ✅ 약 2분. 범위 밖 파일 없음. 병합. **총괄 확인**: 상황판 DB `board/summary`에 세션 6개 데이터 저장됨. Dashboard 타입은 세션이 직접 모은 데이터를 넣기에 맞지 않아 일반 페이지 + DB로 바꿈(빈 Artifact 하나 남음 → U-06) | 11-10 |
| J-000 | 방향 전환: 게임 → 자비스. 게임 코드를 `claude/game-prototype`(커밋 `21beff1`)로 분리, 통합 브랜치에서 코드·설정 제거(사용자 승인), `CLAUDE.md`·`TODO.md`를 자비스 기준으로 재작성 | 총괄 | ✅ 커밋 `8ed3405` 외 | 11-10 |

### 이전 기록 (11-07~08, 운영 체계 구축과 게임 시험 단계 — 자세한 내용은 git 기록과 `reports/`)
- T-001~006: 환경 기능 조사, 운영 체계 설계, 서브에이전트·작업 세션·세션 간 메시지·예약 작업 실험 → 모두 동작 확인 (`CLAUDE.md` 2장)
- T-010~017: 총괄이 README를 오해해 게임을 만듦(사용자 의도와 다름, 11-10 정정). 그 과정에서 작업 세션 푸시→병합, worktree `--ff-only`(T-015), 병합 전 체크리스트, GitHub Actions CI(T-014)가 검증됨
- T-016: 여러 세션 관리 방법 조사 → `docs/orchestration-research.md`

---

## 실험 기록 (이 환경에서 확인한 것)

| 기능 | 결과 |
|---|---|
| `list_sessions(mine=true)`, `get_session`, `list_events(kinds=["result"])` | ✅ 이 계정의 모든 클라우드 세션 상태·요약·최종 답을 읽을 수 있다 |
| `create_session` + `send_message` + 답장(`ReadNotifications`) | ✅ 만들고, 지시하고, 답을 받는다(T-005, T-012) |
| 서브에이전트 (`Agent`, 백그라운드, Sonnet, worktree) | ✅ worktree는 `main` 기준 → `--ff-only`로 맞춘다 |
| 서버 예약 `send_later` / `update_trigger(enabled=false)` | ✅ 쉬고 있는 총괄 세션을 깨운다 |
| `create_trigger`(실행마다 새 세션) | ⚠️ 생성·실행은 되지만 **새 세션에 `claude-code-remote` 도구가 없다** → 세션 조회 불가(J-002 시험, Sonnet으로 실행됨, $0.19). 브리핑은 안전하게 실패하고 기존 데이터를 덮어쓰지 않았다. 해결: 전용 세션을 `persistent_session_id`로 깨운다. 이 방식은 예약의 푸시 알림 옵션을 못 쓰므로 세션이 `PushNotification`을 직접 호출 |
| 브리핑 전용 세션(직접 만든 작업 세션)에서 세션 조회 + 상황판 DB 쓰기 | ✅ (J-002) |
| 브리핑 세션의 `PushNotification` | 미확인 ("중요"일 때만 호출) |
| `CronCreate` | ⚠️ 메모리에만 있어 비추천 |
| `ListAgents`/`SendMessage` | ⚠️ 클라우드 세션은 안 보임 → `send_message` 사용 |
| GitHub MCP (브랜치, Actions), 워크플로 파일 푸시 | ✅ `gh` CLI는 안 됨 |
| `.claude/settings.json` 쓰기 | ❌ Auto 안전장치가 막음 → U-02 |
| 다른 브랜치로 푸시 (`claude/game-prototype`) | ✅ 사용자 승인 후 됨 |

---

## 결정 기록

| 날짜 | 결정 | 이유 |
|---|---|---|
| 11-07 | 이 세션 브랜치 `claude/vibrant-archimedes-t0utvy`를 통합 브랜치로 | 이 세션이 푸시할 수 있는 지정 브랜치 |
| 11-07 | 작업자는 `TODO.md` 대신 `reports/<작업ID>.md`에 보고 | 병합 충돌 방지 |
| 11-08 | 게임 방향을 총괄이 잠정 결정하고 개발 → **잘못된 판단** | README를 목표로 오해. 사용자는 자비스를 원했다. 앞으로 목표·방향은 반드시 사용자 확인(`CLAUDE.md` 4.4) |
| 11-10 | 목표를 **자비스**로 전환. 관리 범위는 **모든 Claude 세션**(읽기·요약), 지시는 허락받은 것만 | 사용자 답변(관리 범위: 내 모든 Claude 세션) |
| 11-10 | 첫 기능: 상황판, 정기 브리핑·알림, 말로 일 맡기기, 세션 정리, 자기 개선 | 사용자 답변 |
| 11-10 | 게임 코드를 `claude/game-prototype`로 옮기고 통합 브랜치에서 제거 | 사용자 답변("별도 브랜치로 분리"). 삭제 금지 규칙의 명시적 예외 |
| 11-10 | 작업 기록(`reports/`, `docs/game-ideas.md`)은 남김 | 체계가 실제로 돌아간 기록이라서 |
| 11-10 | 브리핑은 **실행마다 새 세션**으로 | 이 총괄 세션처럼 컨텍스트가 커지면 호출마다 비싸다. 새 세션은 짧은 지시문만 읽고 끝남 |
| 11-10 | 브리핑 간격 기본값 8시간 | 사용자 시간대를 몰라 시각 대신 간격. U-05로 확인 |
| 11-10 | J-001은 작업 세션(Sonnet)에 맡김 | 이 총괄 세션은 컨텍스트가 커서(약 33만 토큰) 직접 만들면 비쌈. 30분 넘는 일이고 결과를 브랜치에 남겨야 함(`CLAUDE.md` 5.1) |
| 11-10 | 상황판은 Dashboard 타입 대신 **일반 Artifact 페이지 + DB** | Dashboard 타입은 커넥터 쿼리·업로드 파일만 데이터로 받아, 브리핑 세션이 모은 데이터를 넣을 수 없었다(J-001 작업 세션 판단, 총괄 동의) |
| 11-10 | 브리핑 예약은 모델을 지정하지 않음(기본값) | 예약 작업 모델은 사용자가 직접 요청할 때만 바꿀 수 있다(U-05) |
| 11-08 | 다른 세션의 브랜치 `claude/popular-game-dev-languages-mye732`는 읽기만 | 이 체계가 만든 것이 아님 (U-04) |

---

## 세션 등록부

| 종류 | ID | 작업 | 브랜치 | 상태 | 비고 |
|---|---|---|---|---|---|
| 총괄 세션 | `session_01BfrX53CHWvJYbgaip4CsNq` | 총괄 | `claude/vibrant-archimedes-t0utvy` | 실행 중 | 컨텍스트 큼 → J-006 교대 예정 |
| 작업 세션 | `session_01BfrX52x2XYeTVLFYMoKjXF` | J-001 | `claude/L2-J-001` | 완료, 쉬는 중 | 병합 완료. 정리 후보 |
| **브리핑 전용 세션** | `session_01BfrX51PuxE77gz1N787Ykw` "[자비스] 정기 브리핑 (눈)" | J-002 | `claude/jarvis-briefing`(푸시 안 함) | 운영 중 (Sonnet) | 대화가 쌓이면 비싸지므로 주기적으로 새 세션으로 교대(J-009) |
| **서버 예약(반복)** | `trig_01SDsYw2dPkaCo3ZBcYGCcra` "자비스 정기 브리핑 (전용 세션)" | J-002 | - | **켜짐**, 8시간마다(`18 */8 * * *` UTC) | 위 세션을 깨움. 지시문은 저장소의 `jarvis/briefing.md`를 `git pull`로 받아 씀 |
| 서버 예약(반복) | `trig_01NPVoWpNSjo35ZgcWdjDQXK` "자비스 정기 브리핑" | J-002 1차 | - | 꺼짐 | 새 세션에 세션 조회 도구가 없어 실패. 정리 후보 |
| 서버 예약(1회) | `trig_01G3CAzCtN73PVFRwqX5JViL` | J-001 대비 점검 | - | 12:59 UTC 실행 예정 | J-001이 끝나서 필요 없음 → 끔 |
| 상황판 | https://claude.ai/artifact/5ZCwN5t4XzQWUwJk48PEjz | J-001 | - | 운영 중 | 소유자만 볼 수 있음 |
| 작업 세션 | `session_01BfrX54BgLQ8Mg9jKF8Y3Mi` | T-005 | `claude/test-T-005` | 완료, 쉬는 중 | 정리 후보 |
| 작업 세션 | `session_01BfrX51r3adh4mipYSByyxB` | T-012 | `claude/L1-T-012` | 완료, 쉬는 중 | 정리 후보 |
| 서버 예약 | `trig_01DoxRvLPaXRPz3bE1KAGcUN`, `trig_01ECTy4PJR2wkrRCiX6GCTZE` | T-006, T-012 점검 | - | 꺼짐 | 정리 후보 |
| 보관 브랜치 | - | 게임 | `claude/game-prototype` | 보관 | 더 진행 안 함 |
| **관리 밖** | `session_01BfrX4yn6tbBmZtzoZWHW8Q` ("인기 게임 개발 언어") | - | `claude/popular-game-dev-languages-mye732` | 다른 작업 | 읽기만 |
| **관리 밖** | `session_01BfrX51fJAbkwBE5DsxaUnm` ("2D 설계도 3D 변환 앱") | - | (다른 저장소) | 다른 작업 | 읽기만 |
