# game/ — 게임 본체 (T-005 골격 + T-004 기술 검증)

| 명령 (game 폴더에서) | 하는 일 |
|---|---|
| `npm install` | 처음 한 번: 필요한 도구 설치 |
| `npm run dev` | 개발용 서버 (브라우저에서 바로 확인) |
| `npm test` | 로직 자동 테스트 (Vitest) |
| `npm run e2e` | 빌드 후 실제 브라우저로 화면 확인 (Playwright) |
| `npm run check` | 위 두 테스트를 한 번에 |
| `npm run artifact` | 디렉터용 단일 HTML 파일(`dist-artifact/index.html`) 생성·검사 → 자비스가 Artifact로 게시 |

- 폴더 구조는 `docs/03_기술설계.md` 4장을 따른다: `src/engine`(화면), `src/sim`(화면과 분리된 로직), `data/`(문장 등 콘텐츠).
- 문장은 `data/strings/<언어>.json`에 `{ "ID": { "text", "context" } }` 형식으로 둔다. 맥락 메모가 빠지면 `npm test`가 실패한다.
- Playwright는 1.63.0으로 고정: 이 작업 환경에 미리 깔린 브라우저와 같은 판이어야 한다.

- 지금 화면: T-004 마을 걷기 시험. 이동 규칙은 `src/sim/player.ts`, 저장 형식은 `src/sim/save.ts`.
