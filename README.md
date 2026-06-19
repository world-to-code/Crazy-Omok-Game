# 오목 대환장 파티 🎉

같은 네트워크(WiFi)의 친구들과 **최대 6명**이 실시간으로 즐기는 멀티플레이어 오목.
방을 만들어 코드를 공유하면 끝 — 별도 회원가입·DB 없음. **서버를 끄면 모든 기록이 사라집니다.**

- 프론트엔드: **React + Vite + TypeScript**
- 백엔드: **Rust (axum + tokio)** — 단일 바이너리가 정적 프론트 + WebSocket을 함께 서빙
- 통신: **WebSocket 중앙 서버** (모든 상태는 서버 인메모리)

## 주요 기능

- **방 만들기 / 참여하기(코드) / 찾기(목록·이름 검색)**
- **두 가지 모드** (방 생성 시 선택):
  - 🎯 **클래식**: 개인전 **2~20명**, 한 명씩 차례대로 착수
  - 🤝 **팀전**: 2팀 집단지성, **팀당 인원 무제한**
- 방 생성 시 설정: 방 이름, 참가 인원(2~20, 클래식), 오목판 크기(15~100), 비밀번호(선택), 차례당 제한시간, **승리 길이 3~10목**
- 돌 색: 클래식은 **방장 흰색 고정**, 나머지는 **랜덤 색**(최대 20색 구분)
- **초대 링크**: 로비에서 내 LAN IP 기반 링크(`http://<내IP>:8080/?join=코드`)를 복사해 공유.
  링크로 접속하면 **코드·비밀번호 입력 없이 닉네임만 정하면 바로 참가** (딥링크)
- 코드로 들어오면 비밀번호 불필요, 검색으로 들어오면 비밀번호 필요
- 세션 동안 유지되는 **닉네임**, 실시간 **채팅**
- **카운트다운**: 10초 이하부터 글자가 커지고 흔들리며 빨갛게 강조
- 자유룰(금수 없음), **첫 N목 완성자 즉시 승리·종료**
- 게임 중 이탈/접속끊김 → 자리 유지·해당 차례 자동 스킵, 방장 이탈 → 다음 사람에게 자동 위임
- 로비에서 방장이 **설정 수정** 가능 (게임 진행 중 제외)

### 클래식 모드
- 차례 순서: 방장이 **직접 지정** 또는 **랜덤**
- 한 사람 차례에는 그 사람만 착수 가능, 나머지는 채팅·나가기만 가능
- **빈 칸 클릭 즉시 착수 → 차례 종료**, 제한시간 만료 시 자동으로 다음 차례

### 팀전 모드 (집단지성)
- 로비에서 팀 배정: **개인이 팀 클릭으로 자가 참여**하거나, **방장이 드래그앤드롭**으로 이동
- 방장이 **선공 팀**(1팀/2팀/랜덤)을 정하고 시작
- 팀 차례에 **팀원 각자 원하는 자리를 클릭(투표)** → 위치별 **선택률**이 실시간 표시(선택률 높을수록 진하게)
- 투표 현황은 **상대 팀에게는 숨김**
- **팀원 전원이 선택을 마치면** 가장 표가 많은 자리에 자동 착수(동률은 랜덤), 다음 팀으로 전환
- 제한시간이 만료되면 그때까지의 투표로 확정(표 없으면 스킵)
- 돌은 **팀 색상**(1팀 흑 · 2팀 적)으로 표시, 먼저 N목 만든 **팀 승리**

## 실행 방법

### 1) 프론트 빌드
```bash
cd web
npm install
npm run build      # web/dist 생성
```

### 2) 서버 실행
```bash
cd server
cargo run --release   # http://localhost:8080 (web/dist를 함께 서빙)
```

브라우저에서 `http://localhost:8080` 접속. 같은 WiFi의 다른 기기는
`http://<호스트의 LAN IP>:8080` 으로 접속합니다. (호스트 IP 확인: `ip addr` / `ifconfig`)

> 친구 초대 = **호스트 IP:8080 주소 + 방 코드**를 공유하면 됩니다.

### 개발 모드 (선택)
프론트 핫리로드가 필요하면 두 프로세스를 따로 띄웁니다.
```bash
cd server && cargo run          # 터미널 1: WebSocket 서버(8080)
cd web && npm run dev           # 터미널 2: Vite(5173, /ws → 8080 프록시)
```
개발 시에는 `http://localhost:5173` 로 접속.

## 구조

```
omok/
  server/   # Rust: main.rs, protocol.rs, state.rs, game.rs, ws.rs
  web/      # React: views/, components/, state/store.tsx, net 타입(types.ts)
```

- `game.rs` 의 승리 판정 단위 테스트: `cd server && cargo test`
- 보드는 최대 100×100이라 서버는 **희소 맵**으로 저장하고, 프론트는 **canvas**로 렌더(확대/축소·스크롤 지원).

## 봇과 대결 (싱글플레이 · 서버 불필요)

홈에서 오목/체스/체커를 고른 뒤 **🤖 봇과 대결** → 난이도(쉬움·중간·어려움·**헬**) + 선공 선택 → 즉시 시작. 방·서버 없이 **브라우저 안에서만** 진행됩니다. 좌표 표시·상세 기보 로그·효과음(음소거 토글) 지원.

- AI 엔진은 **Rust → WebAssembly** (`web/wasm-ai/`).
  - **오목**: 윈도우 패턴 평가 + 반복심화 알파베타(즉승/즉방 전술) + **VCF 완전탐색**(연속 4로 강제승 수순) + **렌주 금수**(흑 삼삼·사사·장목).
  - **체스**: 규칙 권위 판정 + 반복심화 알파베타(Zobrist **치환표**, **NMP**, **PVS**, 히스토리, 정지탐색, 체크 연장, LMR) + 평가(재료·PST·캐슬링권·킹 안전·폰 구조·패스폰·룩 열린파일) + **오프닝북**.
  - **체커(드래프트)**: 영국식 규칙(강제 점프·멀티 점프·킹 승급) + 반복심화 알파베타. 완전 해결된 게임이라 헬은 사실상 무패(최선은 무승부).
- 무거운 탐색은 **Web Worker**(`web/src/bot/aiWorker.ts`)에서 돌려 화면이 멈추지 않습니다. 차례 제한시간 45초는 표시용(강제 없음).
- 빌드 산출물(`web/src/wasm-ai/*.wasm` 등)은 커밋되어 있어 CI 는 Rust 없이 `npm run build` 만 합니다. 엔진을 수정했다면 재빌드:
  ```bash
  cd web/wasm-ai
  wasm-pack build --target web --release --out-dir ../src/wasm-ai --out-name ai_wasm
  rm -f ../src/wasm-ai/.gitignore   # 산출물을 커밋하기 위해
  ```

## 환경 변수

`.env.example` 를 `.env` 로 복사해서 설정합니다 (`.env` 는 git 에 올리지 마세요. 서버가 시작 시 자동 로드).

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `OMOK_BIND` | `0.0.0.0` | 서버 바인딩 주소 |
| `OMOK_PORT` | `8080` | 서버 리슨 포트 (배포 시 `80`) |
| `OMOK_PUBLIC_HOST` | 자동 감지 LAN IP | **초대 링크에 쓸 공개 IP/도메인** |
| `OMOK_PUBLIC_PORT` | `OMOK_PORT` 값 | 초대 링크 포트 (80/443 이면 링크에서 생략) |
| `OMOK_WEB_DIR` | `../web/dist` | 빌드된 프론트 경로 |

## 배포 (CI/CD 자동화)

`main` 브랜치에 **push 하면 GitHub Actions 가 자동으로** 빌드(프론트 + Rust 정적 바이너리) →
EC2 전송 → systemd 서비스(`omok`) 재시작까지 처리합니다.

- 워크플로: `.github/workflows/deploy.yml`
- systemd 유닛: `deploy/omok.service`
- **최초 1회 서버 설정 + 필요한 GitHub Secrets 는 [`deploy/SETUP.md`](deploy/SETUP.md) 참고**

배포 후 접속: `http://minigame.ascode.click/` (포트 80). 로비 초대 링크는
`http://minigame.ascode.click/?join=<코드>` 로 생성됩니다 (코드·비밀번호 없이 바로 참가).

> 빌드는 **musl 정적 링크**라 glibc 버전과 무관하게 어떤 리눅스에서도 실행됩니다.
> 80 포트는 systemd `AmbientCapabilities=CAP_NET_BIND_SERVICE` 로 일반 사용자가 바인딩합니다.

### 수동 배포가 필요할 때
```bash
cd web && npm install && npm run build
cd ../server && cargo build --release
cp ../.env.example .env   # OMOK_PORT=80, OMOK_PUBLIC_HOST=..., OMOK_PUBLIC_PORT=80
./target/release/omok-server
```
