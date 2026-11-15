# 4차 A — 협동판 고정 · 새 저장소 · 직접 실험 제거 · 시작 화면 3모드

> 마스터 규칙을 따른다. 이 단계의 목적:
> ① 직접 실험이 들어 있는 지금 상태를 **협동판으로 고정**하고(논문·포스터 대상판), ② 시뮬레이션 단독판 저장소를 만들고,
> ③ 단독판에서 직접 실험을 **남김없이** 지우고, ④ 시작 화면을 3모드로 바꾼다.
> A1·A2는 **사람 단계**다. Claude는 명령을 안내만 하고 A3부터 작업한다.

## 1. A1 — 협동판 고정 (🧑 사람, 협동판 저장소)

```bat
cd mini-earth-sim
git switch main
git pull
git tag -a v2.0-collab-final -m "2인 협동 완성판 (직접 실험 포함) - 논문·포스터 기준"
git push origin v2.0-collab-final
```

- 이 태그로 GitHub **Release** 를 만들고 `MiniEarth.html`(`build_html.bat`)과 `MiniEarthModel.exe`(`build_exe.bat`)를 올린다.
  지금 Releases의 exe는 2026-07-23 빌드라 1인칭·시작 화면이 없다(README 경고) — **이 태그에서 다시 빌드한 exe를 올린다.**
- 릴리스 설명 첫 줄: "논문 「디지털 기반 탐구를 활용한 기후변화 교육 프로그램 개발」 대상판(직접 실험 포함). 이후 개발은 새 저장소."
- 동료(yen)에게 알린다: 협동판 저장소의 `main` 은 그대로 둔다.

## 2. A2 — 새 저장소로 옮기기 (🧑 사람)

1. GitHub에서 **빈 저장소**를 만든다(README·.gitignore·라이선스 체크 해제). 공개 여부는 마스터 D3 기본값 **공개** — 학생이 Releases에서 바로 받을 수 있고, §8(실시간 카드)의 Pages도 쓸 수 있다.
2. **공개 전 점검**: 커밋 기록에 비밀번호·API 키·학생 개인정보가 없는지 본다.
   2026-11-05에 main(8c7a8b4) 기록 전체를 검사했을 때 보드 코드의 와이파이 값은 자리표시(`your_wifi_name`, `와이파이이름`)뿐이었고 API 키 형태 문자열은 없었다. 그 뒤 커밋이 있으면 다시 본다.
   사람 이름이 들어간 빈 파일(`hello 태민.txt` 등)·예시 학생 자료(`screenshots/*/탐구기록_예시.csv`)는 A6에서 정리한다.
3. 옮기기 (히스토리 유지):

```bat
git clone https://github.com/ChealminE/mini-earth-sim.git mini-earth-sim-solo
cd mini-earth-sim-solo
git remote rename origin collab
git remote add origin https://github.com/ChealminE/<새 저장소 이름>.git
git push -u origin main
git push origin v2.0-collab-final
git switch -c feature/4cha
```

- 협동판 저장소의 다른 원격 브랜치(`feature/*`, `claude/*`)는 옮기지 않는다.
- 이 다음부터 Claude Code는 `mini-earth-sim-solo` 폴더에서 연다.

## 3. A3 — 직접 실험 제거 (Claude)

### 지울 파일·폴더

| 경로 | 비고 |
|---|---|
| `js/tab-live.js`, `js/live-setup.js`, `js/live-analysis.js`, `js/live-file.js`, `js/live-fit.js` | 약 3,550줄 |
| `basic_experiments/` | 보드 코드·info.json |
| `mqtt_broker.py`, `server.spec`, `build_exe.bat` | exe 빌드는 더 안 함 |
| `tools/fake_device.py`, `test_fake_sensor.py`, `tools/list_live_colors.py` | |
| `docs/테마_이관_가이드.md`, `docs/작업대_이관_가이드.md` | yen용 안내 |
| `yen진행상황.md` | 협동판 태그에 남음 |
| `screenshots/merge-live-tab-v2/` | 직접 실험 화면 기록 |

**지우지 말 것**: `js/xlsx-lite.js`(마스터 §6-2 — `downloadBlob` 을 조감 세 파일이 씀).

### 고칠 곳 (직접 실험 이름을 참조하는 곳 — 2026-11-05 grep 결과)

| 파일 | 고칠 것 |
|---|---|
| `js/main.js` | `bundles.live`, `TAB_HEADERS.live`, `#tab-live` 토글, `activateLiveTab`·`liveGraphs`·`resizeAnalysisChart`·`sceneLive`, `live-setup`/`live-run` 클래스 정리, `PAPER_TABS` 주석. `?tab=live` 로 들어오면 현재 실태(지금도 `TAB_HEADERS` 에 없으면 기본 탭 — 확인만) |
| `index.html` | `#tab-live` 패널 블록 전체(안의 인라인 핸들러 `setGraphTitle`·`setAxisConfig`·`setAxisAuto`·`setGraphTimeUnit`·`downloadGraphData`·`downloadGraphImage`·`clearGraphMarks`·`gsCurrentGraphId` 등 포함), 머리줄의 직접 실험 탭 링크, 직접 실험 `<script>` 5줄 |
| `js/common.js` | `LIVE_BACKDROP`, `sceneFor` 의 `'live'` 분기(`paper: tab !== 'live'` 등) — 남은 두 탭이 이전과 같게 |
| `js/ir-scope.js` | `onTab` 의 직접 실험 처리 |
| `style.css` | `#tab-live`·`.live-*`·`.lr-*`·`body.live-setup`·`body.live-run` 선택자 규칙**만**. 다른 규칙은 건드리지 않는다 |
| `tools/build_single_html.py` | `AERIAL_JS` 에서 live 5개 삭제(`xlsx-lite.js` 남김), `CARDS` 의 `live` 카드 삭제 |
| `.gitignore` | `data_log.csv`·`logs/`·`build/`(PyInstaller) 줄 정리. `dist/` 무시 줄은 **남긴다**(단일 HTML 빌드 결과도 여기에 생김) |

### 검사

- `grep -rn "tab-live\|live-setup\|live-run\|sceneLive\|activateLiveTab\|liveGraphs\|resizeAnalysisChart\|LIVE_BACKDROP\|basic_experiments\|mqtt" --include=*.js --include=*.html --include=*.py --include=*.css .` 결과가 주석 외 0건.
- 검사 6종 통과, 단일 HTML 빌드 성공(조감 스크립트 수가 5개 줄었는지).
- 🧑 현재 실태·미래 예측이 3차와 같은가(스니펫: 4해상도 넘침 0·최소 13 px), 콘솔 0.

## 4. A4 — 작은 개발 서버

개발할 때는 서버가 필요하다(file:// 로 `index.html` 을 열면 텍스처가 막힌다 — README 문제 해결 표). 배포는 단일 HTML뿐이다.

- `server.py` 를 정적 파일 + 라우트만 남긴 짧은 파일로 다시 쓴다. **남길 것**: `cache_policy` 미들웨어, `file_version`, `versioned_html`(마스터 §6-8), 라우트 `/`·`/favicon.ico`·`/dashboard`·`/firstperson/`·`/firstperson/index.html`·`/style.css`, 마운트 `/js`·`/css`·`/vendor`·`/texture_image`·`/firstperson`. 실행하면 브라우저를 여는 동작이 있었으면 유지.
- **지울 것**: 시리얼·BLE·MQTT·WebSocket(`/ws`)·`/data`·`/api/*`·`/basic_experiments`·실험 세션·로그.
- `requirements.txt` → `fastapi`, `uvicorn` 두 줄(버전은 지금 값 유지). `setup.bat`·`run_server.bat` 은 그대로 동작해야 한다.
- 주석은 "왜 남겼나"(버전 표시·캐시 정책) 위주로.

## 5. A5 — 시작 화면 3모드 + 모드별 배경

### select.html (서버판)

- 카드 3장: **현재 실태 · 미래 예측 · 1인칭 탐험**. `grid-template-columns: repeat(3, minmax(220px, 300px))`, 좁으면 1열. 직접 실험 카드·"별도 모드" 배지·"server.py가 실행 중이어야" 문구 삭제.
- 배경 = 지금처럼 진짜 3D 아크릴(`buildAcrylicScene`). 카드에 **마우스를 올리거나 키보드 포커스**가 가면 그 모드 상태로 0.6초 전환하고, 떠나면 현재 실태 상태로 돌아온다.
  - 현재 실태: 엔진 역사 실행의 마지막 해(`tab-current.js` 와 같은 계산) + 관측 CO₂
  - 미래 예측: 현재 정책 2100년 상태(도시·굴뚝·산호·빙하는 `setEarthVisual` 로)
  - 1인칭 탐험: 카메라를 받침대 가까이·낮게(눈높이 느낌) 옮기는 전환
  - `prefers-reduced-motion` 이면 전환 없이 바로.
- 3D 계산은 이미 `common.js`·`earth-system.js` 에 있는 함수만 쓴다. 시작 화면에 새 계산 코드를 쓰지 않는다.

### 단일 HTML 껍데기 (`tools/build_single_html.py`)

- `CARDS` 3장, 문구는 select.html 과 같게.
- 껍데기에는 3D가 없다. **기본: 카드마다 그 모드의 정지 그림을 배경으로** — 사람이 1440×900에서 찍은 `texture_image/start_current.jpg`·`start_future.jpg`·`start_fp.jpg`(각 200 KB 이하)를 빌더가 data URI로 넣는다. 그림이 없으면 지금처럼 단색으로 두고 빌드는 멈추지 않는다(경고만).
- 🧑 그림 3장을 찍어 넣어 달라고 요청한다(창 크기·화면 상태를 구체적으로).

## 6. A6 — 문서·빌드·옛 파일 정리

- 루트 `README.md`, `Critical_Earth_simulator/README.md`: 단독판 기준으로 다시 쓴다. 직접 실험·exe·센서 내용 삭제, 협동판은 태그·릴리스 링크 한 줄.
- `AGENTS.md`: **1인 작업**으로 다시 쓴다 — "두 사람이 작업한다", "공유 브랜치에 바로 푸시하지 말고" 같은 규칙과 직접 실험 구조 줄 삭제, 작업 기록은 `철민진행상황.md` 하나, 구조 절은 남은 파일만. `CLAUDE.md` 는 `@AGENTS.md` 그대로.
- 루트 옛 파일 — **🧑 확인 후 삭제**(기본: 삭제, 히스토리·태그에 남음): `app/`, `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, 루트 `Critical_Earth_simulator.html`, `hello 태민.txt`, `hello_yen01.txt`, `mini_earth_plan.md`(아두이노 연동 계획), `extract_nc.py`(지금 앱이 안 씀), `10.09변경사항정리.md`(1인칭 설계안 — 남길지 🧑).
- `sync.bat` 은 남긴다(사람이 씀).
- `철민진행상황.md` 머리말의 yen 안내 문단을 "협동판은 태그 v2.0-collab-final" 한 줄로.

## 7. 검사 (A 전체)

1. 마스터 §5의 1~5, 9.
2. 서버를 새로 켜고(`run_server.bat`) `/`·`/dashboard?tab=current`·`/dashboard?tab=future`·`/dashboard?tab=live`(→ 현재 실태)·`/firstperson/` 콘솔 0. 🧑
3. 시작 화면: 카드 3장, 마우스·Tab 키로 옮길 때마다 배경 전환, 움직임 줄이기 설정에서 즉시 전환. 🧑
4. 단일 HTML(file://): 시작 화면 3카드, 세 모드 진입·돌아오기. 🧑
5. 세이브포인트에 지운 줄 수(파일별)와 빌드 크기 전후.
