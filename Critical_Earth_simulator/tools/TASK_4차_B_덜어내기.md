# 4차 B — 1인칭 덜어내기

> 마스터 규칙을 따른다. 이 단계의 목적: 1인칭 3요건(측정 · 시간 이동 · 현재의 행동)에 쓰이지 않는 기능을 뺀다.
> **값을 새로 정하는 일은 C에서 한다.** B는 "빼고, 빈자리를 지금 기본값으로 고정"까지만 한다 — 그래야 B 전후로 측정값이 같은지 확인할 수 있다.
> 1인칭 파일 지도(2026-11-05): `fp-world.js` 2,236 · `fp-tools.js` 784 · `fp-field.js` 619 · `fp-player.js` 457 · `fp-main.js` 295 · `fp-weather.js` 256 · `fp-minimap.js` 237 · `fp-audio.js` 190 · `index.html` 255 · `style.css` 245줄.

## 1. B1 — 기준 측정

1. 새 파일 **`tools/check_fp_snippet.js`**: 1인칭 페이지 개발자 도구 콘솔에 붙여 넣는 스니펫.
   - 드로우콜(`renderer.info.render.calls`, 한 프레임), 5초 평균 FPS(rAF 간격), 보이는 글자 `font-size` 최솟값과 그 요소, 문서 넘침 여부.
   - 1인칭 코드는 `renderer` 를 전역 `const` 로 둔다(`fp-main.js` 맨 위) — 콘솔에서 그대로 읽힌다. 바뀌면 스니펫도 고친다.
2. 🧑 기준 측정(실제 GPU, 1440×900): ① 출발점 ② 도심 교차로에서 서쪽(바다 쪽)을 본 시점 ③ 수중. 결과를 세이브포인트 '사람 확인 기록'에.
3. 위 파일 지도의 줄 수를 세이브포인트에 적는다(B 끝에서 다시 잼).

## 2. B2 — 날씨 · 소리 · 밝기

| 지울 것 | 위치 |
|---|---|
| `fp-weather.js` 파일 | `index.html` `<script>`, 빌더 `FP_JS` |
| 날씨 UI(`#weatherBtns`, `#weatherRandomChk`, 안내문), `syncWeatherUI` | `index.html` 설정창, `fp-main.js` |
| `WEATHER_ENV`, `weatherEnv()`, `applyEnvironment()` 의 날씨 합성 | `fp-world.js` |
| `weatherDiurnalK`·`weatherTempOffset` 호출(지금은 `typeof` 가드라 파일만 지워도 돌아가지만 죽은 코드로 남김 금지) | `fp-tools.js` `spotBaseTemp` |
| `fp-audio.js` 파일, `#soundChk`, 캔버스 클릭 시 `FPAudio.init` | `index.html`, `fp-main.js`, `FP_JS` (마스터 D4) |
| 밝기 슬라이더 `#brightnessSlider`, `localStorage['fpExposure']` | `index.html`, `fp-main.js` |

- 노출(`toneMappingExposure`)은 지금 기본값 **1.15 고정**. 조감은 2차 F2에서 1.1로 고정했다 — 다르게 두는 이유를 주석에 한 줄(1인칭은 하늘이 화면 대부분이라 조금 밝게).
- 도움말(H) 안의 날씨·소리 문단도 지운다(새 도움말은 D4).

## 3. B3 — 계절 · 낮밤 (마스터 D2: 낮 고정, 측정값은 연평균)

### 계절

- 설정창 계절 버튼(`#seasonBtns`)과 안내문, `fp-main.js` 의 `applySeason`·`syncSeasonUI` 호출 삭제.
- `fp-world.js`: `FPWorld.season` 과 계절이 바꾸던 것(잎 숨김·풀 색·하늘 틴트·유빙 크기 배수·일출일몰) 삭제. `SEASONS`·`seasonDef()`·`SEASON_ENV` 는 **C2가 연평균 기준값으로 바꿀 때까지 'summer' 하나만 돌려주게** 줄여 둔다(지금 `SPOT.base` 가 '여름 정오' 값이라 C2 전에 지우면 값이 흔들린다).
  ⚠ 세이브포인트에 "C2 전까지 1인칭 온도는 여름 정오 기준" 이라고 적는다.
- `js/earth-model.js` 의 `SEASON_CLIMATE`: 쓰는 곳이 없다(2차 C2에서 조감 계절 선택기를 지움, grep 확인) → 삭제. 함수 값이 아니라 상수라 마스터 §4에 걸리지 않는다. 체크리스트 12절 "계절 값이 두 곳에" 항목이 이것으로 해소된다.
- 단일 HTML·조감에 영향 없는지 `test_earth_visual`·`test_inquiry` 로 확인.

### 낮밤

- 시각 슬라이더(`#timeSlider`), 시간 흐름(`#timeFlowChk`, T 키), `updateTime`, `DAY_SECONDS`, 별(`FPWorld.stars`), 밤·노을 하늘색(`NIGHT_SKY`·`DUSK_SKY`) 삭제. **`FPWorld.hour = 12` 고정**(정오에는 `diurnal(h) − DIURNAL_AT_NOON = 0` 이라 측정값이 그대로다).
- `fp-tools.js` `FPAir`: 해륙풍 이류(`seaBreeze`, 이류항, `windK`, `windLabel`, HUD 바람 표기)와 `CO2_ZONE` 의 밤 값(`nightOff`·`nightRise`) 삭제. 구역 대기는 **정오 정상 상태값**(`zoneCO2Target(12)`)만.
  해수 pCO₂ 동적 평형(`stepSeaCO2`)이 `FPAir.onTick` 에 붙어 있다 — **C4에서 통째로 바꾸므로 B3에서는 0.2초 틱을 남긴다.**
- 나무 밑 CO₂의 밤 호흡 항(`resp`)은 `lit = 1` 이면 0 — 식은 C3에서 정리, B3는 `lit = 1` 고정만.
- 야장 CSV의 `시각(h)`·`wind`·`game_time` 열은 G에서 정리(B에서는 값만 고정).

## 4. B4 — 이동 · 도구 · 입력

- `fp-player.js`: 비행(G), 1·3인칭 전환(V·F5), 앉기(Ctrl·C) 삭제. 걷기·달리기(Shift)·점프·수영(Space)·출발점(R)·미니맵(M) 유지. H·E·F의 새 역할은 D4.
- 동물 체온(마스터 D8): `BODY_TEMPS`·`ANIMAL_SPOT`·곰 동면 체온·`pickTarget` 의 동물·어류 맞춤 분기 삭제. 동물·어류 메시와 움직임은 풍경으로 남긴다. 도움말의 체온 문단 삭제.
- 교사용 CO₂ 직접 입력(마스터 D5): 설정창 `details.teacher`·`#co2Slider`·`FPScenario.teacher`·HUD '교사 입력' 삭제.
- 단축바 9칸 → **4칸**(온도계·pH미터·CO₂센서·해수분석기). F에서 행동용 칸이 필요하면 그때 늘린다.
- 측정 지점: 지면 3종(해변 모래·녹지 지면·도시 지면)은 C2에서 지운다(마스터 D9) — B4에서는 그대로.

## 5. B5 — 과제 정리

| 과제 | 처리 | 까닭 |
|---|---|---|
| ① 차가운 바다 vs 따뜻한 바다 | 유지 | 냉수대는 C에서도 남는다 |
| ② 밤바람이 바다를 바꾼다 | **삭제** | 낮밤·해륙풍이 없어짐 |
| ③ 백화인가, 석회화 저해인가 | 유지 | |
| ④ 상자 속 바다와 모형 | **삭제** | 직접 실험 탭이 없음 |
| ⑤~⑦ 현장 과제 | 유지, 연도 `[2023, 2100]` → `[NOW_YEAR, 2100]` 은 **E3** 에서 | `NOW_YEAR` 는 E가 정의 |

- 과제 판정 함수의 `isEveningToDawn`·`exportCount` 등 쓰이지 않게 된 것 삭제.
- 탭 이름의 '0/4' 같은 개수는 남은 과제 수로.

## 6. 검사 (B 전체)

1. 마스터 §5의 1~5, 9. `FP_JS` 와 1인칭 HTML 스크립트 순서 일치.
2. **측정값 전후 비교**(B 전 커밋과 같은 지점·같은 연도 2023, 정오): 해수 수온·pH·Ω, 도심·녹지·해양 대기 온도는 **같아야** 한다(차이 0). 구역 대기 CO₂는 해륙풍이 빠져 정상 상태값으로 바뀐다 — 차이를 표로 세이브포인트에.
   측정 노이즈 때문에 화면으로 비교하지 말고, 콘솔에서 `measureTemperature`·`measurePH`·`FPAir.zoneCO2` 를 같은 인자로 불러 비교한다.
3. 🧑 1인칭 열림·콘솔 0, B1 세 시점 드로우콜·FPS(줄었는지), 설정창에 날씨·계절·밝기·소리·시각이 없는지.
4. 세이브포인트에 줄 수 전후(파일별)와 단일 HTML 크기 전후.
