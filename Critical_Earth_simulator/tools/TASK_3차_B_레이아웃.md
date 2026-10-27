# 3차 B — 60:40 화면 배치

> 마스터 규칙을 따른다. 기준 그림: `docs/refs/3cha_layout.png`.
> 대상: **현재 실태·미래 예측 탭만**(`body.paper.tab-current`, `body.paper.tab-future`). 직접 실험 탭(`tab-live`)의 격자·선택자는 건드리지 않는다.

## 0. 지금 구조 (코드 읽기로 확인됨)

- `#app` 격자에 `#topbar`, `#gl-container`(3D), `#tab-header-panel`(미래 예측 조작부 `#futureControls`), `#graph-panel`(탭 패널들)이 놓인다.
- `css/paper.css` 가 탭별 격자를 정한다: 현재 실태 `40fr / 60fr`(3D | 그래프), 미래 예측 `290px | 3D | 36%`(조작 | 3D | 그래프).
  미래 예측은 `#graph-panel`·`#tab-future` 를 `display: contents` 로 풀어 그래프 열과 시간 막대를 `#app` 격자에 바로 놓는다.
- 미래 예측 조작부 안에 탐구/자유 조작 전환(`#inqModeOn`/`#inqModeFree`), 탐구 패널(`#inqPanel`), 시나리오(`#fcPresets`), 직접 설계(`#fcLevers`)가 있다.
- 기록 서랍 `#recDrawer` 는 시간 막대의 [기록 보기]로 열리는 서랍이다.

## 1. B1 — 화면 셸

### 격자 (두 탭 공통)

```
┌──────────────────────── topbar ────────────────────────┐
│ 좌 60 %                              │ 우 40 %          │
│ ┌ 3D (#gl-container) ──────────────┐ │                  │
│ │  행 높이 minmax(170px, 38fr)     │ │   #worksheet     │
│ └──────────────────────────────────┘ │   (학습지)       │
│ ┌ 조작 띠 (#ctlStrip) ── auto ─────┐ │                  │
│ └──────────────────────────────────┘ │   패널 안에서만   │
│ ┌ 그래프 (#graph-panel) ───────────┐ │   세로 스크롤     │
│ │  행 높이 minmax(0, 62fr)         │ │                  │
│ └──────────────────────────────────┘ │                  │
└──────────────────────────────────────┴──────────────────┘
```

- `body.paper.tab-current #app, body.paper.tab-future #app` 에 `grid-template-columns: minmax(0, 60fr) minmax(0, 40fr)`,
  `grid-template-areas: "top top" "gl ws" "ctl ws" "graph ws"`. 기존 탭별 격자 규칙은 **지우지 말고 덮는다**(되돌리기 쉽게, 이전 규칙 위에 주석으로 "3차 B1에서 대체").
- **조작 띠 `#ctlStrip`** 을 새로 만든다(마크업 위치: `#gl-container` 바로 뒤).
  - 미래 예측: 시나리오 버튼 그룹(`#fcPresets` + 직접 설계 버튼)과 시간 막대(`#tlBar`)를 **DOM 이동**으로 이 띠에 넣는다. id는 바꾸지 않는다 → JS 수정이 거의 없어야 한다.
    한 줄에 안 들어가면 두 줄(위: 시나리오, 아래: 시간 막대)까지 허용.
  - 현재 실태: 관측 기간 안내("관측 자료 1750~2023 · 자료마다 시작 연도가 다릅니다")와 C에서 만들 작업대 모드 선택이 들어갈 자리. 지금은 안내 문구만.
- **직접 설계 패널 `#fcLevers`** 는 3D 칸 위에 겹치는 패널(`position: absolute`, 3D 칸 안)로 연다. [시나리오로]를 누르면 닫히고 3D가 다시 보인다.
  레버를 조작하는 동안 3D를 가리는 것은 허용(레버 → 그래프 변화를 보는 게 목적).
- `#tab-header-panel` 에 남는 것(탐구/자유 조작 전환, `#inqPanel`)은 B2에서 학습지로 옮긴다. B1에서는 숨기지 말고 임시로 학습지 칸에 둔다.
- 3D 칸이 넓고 낮아진다(1280×720에서 약 768×250). `js/common.js` 의 `setCameraFit`/`fovForAspect` 가 이 비율에서 상자를 잘 담는지 🧑 확인.
  잘리면 카메라 거리·시야각 보정만 한다(장면 크기·배치는 그대로).
- 칸 크기가 바뀌면 three.js 렌더러와 Chart.js가 다시 맞춰야 한다. `ResizeObserver` 를 `#gl-container` 와 `#graph-panel` 에 걸어 `fitRenderer()` 와 각 차트 `resize()` 를 부른다
  (창 크기 이벤트만으로는 B2의 학습지 접기를 못 잡는다).

### 검사
- 🧑 네 해상도 × 두 탭 스니펫 표. 학습지 폭 비율이 39~41 %인지, 문서 스크롤 0인지.
- 🧑 미래 예측: 시나리오 바꾸기·재생·직접 설계 열고 닫기가 예전처럼 되는가.
- 🧑 직접 실험 탭과 1인칭이 예전 그대로인가.

## 2. B2 — 학습지 패널 껍데기

- `<aside id="worksheet" class="ws" aria-label="학습지">` 를 `#app` 격자의 `ws` 칸에 둔다(두 탭이 **같은 요소를 공유**하고, 내용만 탭에 맞게 바뀐다).
- 머리: 제목(지금 탭 이름 + "학습지"), [접기] 버튼.
  - 접으면 학습지가 44 px 세로 띠로 줄고 좌측이 100 %가 된다. 접힘 상태는 `localStorage['worksheet.collapsed']`(try/catch). 교사가 화면 시연할 때 쓰는 기능.
- 탭 세 개(`role="tablist"`): **[탐구] [나의 증거] [기록]**
  - **탐구**: 탐구/자유 조작 전환과 `#inqPanel` 을 여기로 DOM 이동. 탐구 실행기 수정은 E1.
  - **나의 증거**: 비어 있는 목록 + 안내("그래프 작업대에서 [학습지로 보내기]를 누르면 여기에 쌓입니다"). 내용은 C4.
  - **기록**: `#recDrawer` 안의 내용(측정 기록 표·CSV·지우기, 탐구 기록)을 **DOM 이동**. 시간 막대의 [기록 보기]는 서랍을 여는 대신 학습지 [기록] 탭으로 전환한다.
    기록 효과(`#recFx`, 2차 F4)는 그대로.
- 패널은 `overflow: hidden auto`. 패널 안 글자도 13 px 이상.
- 이 단계에서 탭 전환·접기·기록 이동만 동작하면 된다.

### 검사
- `node tools/test_inquiry.js --browser` 가 있으면 돌린다(실행기가 `#inqPanel` 을 id로 찾으면 DOM 이동 후에도 통과해야 함). 없거나 브라우저가 없으면 🧑 탐구 경로 A 첫 두 단계를 사람이 눌러 본다.
- 🧑 기록 버튼 → 기록 탭에 줄이 쌓이는가, CSV가 받아지는가, 접기 후 3D·그래프가 넓어지며 다시 그려지는가.

## 3. B3 — 화면 버튼 내리기 (기능 유지)

**아래 여섯 개는 기본 화면에서만 보이지 않게 한다. 요소·id·이벤트 연결·함수는 지우지 않는다.**

| 기능 | 화면 요소 | 함수(그대로 둠) | 이관처 (E2) |
|---|---|---|---|
| 3D 범례 | `#legend3d` | `main.js` 범례 갱신 | 학습지 카드 `legend3d` |
| 자연만 있는 지구 보기 | `#natureToggle` | `setNatureView` (tab-future.js) | 탐구 동작 `toggleNature` + 학습지 카드 버튼 |
| CO₂ 보기 | `#view3dCo2` | `bindView3D('view3dCo2','co2')` (main.js) | 탐구 동작 `view3d` (F의 적외선 보기가 화면 기본 토글이 됨) |
| 지시약으로 보기 | `#view3dIndicator` | `bindView3D('view3dIndicator','indicator')` | 탐구 동작 `view3d` + 범례 카드 |
| Ω 함께 보기 | `#futOmegaBtn` | `setOmegaView` | 탐구 동작 `omega` + 학습지 카드 `omega` |
| 바다 속 탄소 | `[data-pop="popSpec"]` 버튼 | `setPopover('popSpec')`, `updateSpeciation` | 학습지 카드 `spec` |

- 방법: 요소에 `data-ws-moved` 속성을 붙이고 `body.paper [data-ws-moved] { display: none; }`. **`hidden` 속성은 쓰지 않는다**(일부 코드가 `hidden` 을 상태로 읽는다 — 예: `if (!$('popSpec').hidden)`).
- 요소를 숨긴 뒤에도 그 함수를 코드에서 부르면 예전처럼 동작해야 한다(3D 상태·그래프 겹침 등). 버튼의 `aria-pressed` 갱신 코드가 숨은 요소를 만져도 오류가 없어야 한다.
- 탐구 실행기(`inquiry.js`)의 `toggleNature`, `openPopover`, `omega` 동작은 **지금 그대로 동작**해야 한다(E2 전까지 탐구 경로가 깨지지 않게).
- "탄소는 어디로?"(`popSink`)는 목록에 없으므로 그래프 옆에 **그대로** 둔다.

### 검사
- `node tools/test_inquiry.js` 통과.
- 🧑 탐구 경로 A의 "사람이 없었다면?" 단계, 경로 B의 "바닷물 속에서 무슨 일이?"·"조개와 산호의 껍데기" 단계를 눌러
  자연 지구·바다 속 탄소·Ω가 버튼 없이도 켜지는가.
