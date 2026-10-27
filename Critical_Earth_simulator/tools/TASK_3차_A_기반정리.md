# 3차 A — 기반 정리

> 마스터 규칙(`TASK_3차_마스터.md` §3 작업 방식, §4 범위 밖, §5 수용 조건, §6 함정)을 그대로 따른다.
> 작은 단계 셋이다. 한 세션에 A 전체를 끝내고, 시간이 남으면 B1까지 가도 된다.

## 1. A1 — 사전 확인 · 기준 측정

1. 마스터 §1 사전 확인. 하나라도 안 되면 멈추고 보고.
2. `tools/check_layout_snippet.js` 가 저장소에 있는지 확인(사람이 지시서와 함께 올림). 없으면 사람에게 요청.
3. `tools/세이브포인트_3차.md` 가 없으면 아래 형식으로 만든다(2차 세이브포인트와 같은 모양).
   ```
   # 세이브포인트 — 3차 대격변
   > 지시서: TASK_3차_마스터.md + 단계별 파일. 작업 브랜치: feature/3cha (main 대상 PR, 병합 금지)
   > 단계가 하나 끝날 때마다: 코드 + 이 파일 갱신을 한 커밋에 → push.
   ## 단계 표
   | 단계 | 내용 | 상태 | 커밋 | 메모 |
   ## 🧑 사람 확인 기록
   | 단계 | 창 | 결과 |
   ## 발췌 추가 필요 / unverified 목록
   ## 다음에 할 일
   ```
4. 🧑 **기준 측정 요청**: 1440×900에서 현재 실태·미래 예측(2023 / 현재 정책 2100 재생 후)을 열고 스니펫 결과(드로우콜 포함)를 받아 세이브포인트에 적는다.
   이 값이 마스터 §5-10의 기준이다.

## 2. A2 — 그래프 순서 통일 (CO₂ → 기온 → 해수온 → pH)

### 미래 예측 탭
- `js/tab-future.js` `SERIES` 배열에서 pH와 해수온의 순서를 바꾼다(`futChartSst` 가 셋째, `futChartPh` 가 넷째).
- `index.html` 의 미래 예측 그래프 블록 순서도 같게. 블록에 딸린 버튼(`fut-pop-btn` 등)은 **블록과 함께** 옮긴다(B3에서 화면에서 내릴 예정이지만 지금은 그대로).
- 순서를 인덱스로 가정한 코드가 있는지 찾는다: `grep -n "SERIES\[" js/*.js`, `grep -n "charts\[" js/inquiry.js`.
  탐구 단계는 그래프를 이름(`co2 · T · pH · sst`)으로 부르므로 영향이 없어야 한다. 인덱스를 쓰는 곳이 있으면 이름 기반으로 고친다.
- 기록 서랍 표·CSV 열 순서(`tab-future.js` 의 `co2_ppm, air_temp, water_temp, ph`)는 이미 이 순서다. 확인만.

### 현재 실태 탭
- 현재 실태의 그래프 영역은 C3에서 작업대로 통째로 바뀐다. **지금은 요약 숫자 상자(`stat-grid`)만** 순서를 CO₂ → 기온 → 해수온 → pH로 맞춘다.
  해수온 상자가 없으면 새로 만든다(값 = `EARTH_DATA.sstHadsst` 마지막 해 편차, ⓘ `obs_sst_hadsst4`).
  화석연료 배출 상자는 **지우지 않고** 다섯째로 둔다. 상자 다섯 개가 1280×720에 안 들어가면 화석연료 상자를 그래프 작업대 확장 카드로 넘기는 것은 C3에서 처리 — 지금은 넘치는지만 기록.
- pH 상자·그래프 제목에 **"한 지점 관측(하와이 Station ALOHA)"** 이 보이게 한다(마스터 결정 7). 문구는 `js/sources.js` `ph_hot` 의 `name` 과 맞춘다.

### 검사
- `node tools/test_inquiry.js` 통과(그래프 이름 검사).
- 🧑 미래 예측 1440×900: 그래프 네 개가 CO₂ / 기온 / 해수온 / pH 순서로 보이는가, 재생하면 네 개 모두 그려지는가.

## 3. A3 — three.js vendor 통일

### 왜
1인칭 `firstperson/index.html` 216행이 `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js` 를 불러온다.
조감은 `vendor/three.min.js`(같은 r160)를 쓴다. 학교 인터넷이 막히면 1인칭만 뜨지 않고, F에서 만들 IR 보기 코드를 두 화면이 나눠 쓰려면 같은 파일이어야 한다.
server.py는 이미 `/vendor` 를 마운트하고 있다(인터넷 없는 교실 대비 주석 있음).

### 할 일
1. `vendor/three.min.js` 의 버전이 r160인지 확인(파일 안 `REVISION`). 160이 아니면 멈추고 보고.
2. `firstperson/index.html` 의 CDN `<script>` 를 `<script src="/vendor/three.min.js"></script>` 로 바꾼다.
   1인칭은 `/firstperson/` 경로로 서빙되므로 **절대 경로 `/vendor/`** 를 쓴다(상대 경로 `../vendor/` 는 server.py 마운트와 file:// 빌드에서 다르게 해석될 수 있음 — 둘 중 무엇이 되는지 확인하고 되는 쪽을 쓴다).
3. `tools/build_single_html.py`: 빌더는 three를 vendor에서 직접 넣고, 목록 대조에서 `cdn.jsdelivr.net` **또는** `vendor/` 주소를 뺀다(129~131행 근처).
   새 주소 `/vendor/three.min.js` 가 `lstrip("/").startswith("vendor/")` 조건에 걸리는지 확인. 걸리면 빌더 수정 불필요.
4. `server.spec`(exe 빌드)에 `vendor` 폴더가 이미 들어 있는지 확인만.
5. `grep -rn "cdn\.\|unpkg\|jsdelivr" Critical_Earth_simulator --include=*.html --include=*.js` 로 남은 외부 로드가 없는지 확인(`tools/` 안의 안내 문구 제외).

### 검사
- `python tools/build_single_html.py` 성공.
- 🧑 서버 켠 상태에서 `/firstperson/` 이 열리고, 개발자 도구 네트워크 탭에 `cdn.jsdelivr.net` 요청이 **없고** `/vendor/three.min.js` 가 200인지.
  가능하면 **와이파이를 끄고** 1인칭이 뜨는지도 본다.
- 🧑 단일 HTML(빌드 결과)을 file:// 로 열어 1인칭 진입이 되는지.
