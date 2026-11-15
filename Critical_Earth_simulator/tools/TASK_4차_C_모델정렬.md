# 4차 C — 같은 해 같은 값 · 측정값 문헌값 · 시각 언어 통일

> 마스터 규칙을 따른다. 이 단계의 목적:
> ① 1인칭이 조감 엔진과 **같은 해·같은 경로면 같은 전 지구 값**을 내고, ② 지점·구역 차이는 **문헌 범위 안에서**, ③ 화면 연출은 조감의 **EarthVisual 규칙**(변수 하나에 표현 하나, CO₂는 보이지 않음, 근거 없는 대응은 연출로 밝힘)을 따른다.
> 숫자·출처는 `docs/refs/4차_문헌값.md` **2부**. 거기 없는 값은 지어내지 말고 unverified.
> 이 단계가 끝나면 1인칭의 모든 측정값은 **'그해 연평균(하루 평균)'** 이다(마스터 D2). 화면이 낮이어도 값은 연평균 — 학습지·도움말에 밝힌다.

## 지금 상태 (2026-11-05 확인) — 왜 고치나

| 어긋난 곳 | 지금 코드 | 조감 |
|---|---|---|
| 기온 | `warmingSince280(ppm)` — 관측 36년 로그 회귀(배증당 4.26 °C), `fp-tools.js` `spotBaseTemp`, `fp-world.js` `seaTemperature` | 2층 에너지 균형 `o.T` |
| 해수온 | `SEA_BASE_T 18 + 0.75 × 회귀` | `o.sst = 18 + T` |
| 바다 화학 | 해수 pCO₂가 해양 대기를 2게임일로 따라감(`stepSeaCO2`) | 엔진 표층 DIC |
| 구역 CO₂ | 도심 낮 +55~+120, 해양 −15~−30 ppm(근거 없음) | (해당 없음) |
| 연출 | CO₂가 하늘을 누렇게·시야 55 m(1000 ppm)·파도 거칠게·**전기차 비율을 ppm으로**(280 ppm = 전부 전기차) | 2차 D2·D3: CO₂ 무색, 도시·차·굴뚝은 배출 역사로 |
| 산호 | 수온 임계 `SEA_BASE_T + 1.5 / + 4.0`(18 °C 기준) | `coralHealthy(T)`(SR1.5) |

## 1. C1 — 순수 계산 모듈

1. 새 파일 **`firstperson/fp-model.js`** — DOM·three.js 없음. 지금 `fp-world.js`·`fp-tools.js` 에 흩어진 **값 계산**을 여기로 옮기고, 원래 자리에서는 이 모듈을 부른다. 렌더 코드에는 계산을 두지 않는다(EarthVisual과 같은 이유 — node에서 검증하려고).

```js
const FPModel = (() => {
  const NOW_YEAR = 2026;              // 마스터 D6. E·F가 이 값 하나만 쓴다 (F1에서 ActionsCore.START 로 옮기고 여기서는 그것을 읽는다)
  // 연도·경로 → 엔진 표본 (EarthSystem.run 결과의 그해 항목 + 누적 화석 최댓값)
  function runFor(emissionsFn, key) { /* 경로별 캐시, EarthVisual.annotateCumFossil 붙임 */ }
  function sample(year, run)        { /* run[year − 1750] */ }
  // 측정 지점 값 (전부 연평균)
  function airTemp(zone, s)         { /* 'ocean' | 'green' | 'city' — C2 */ }
  function seaTemp(prox, s)         { /* prox 0 = 개방 해역 … 1 = 유빙 바로 옆 — C2 */ }
  function iceSurfaceTemp(s)        { /* C2 */ }
  function zoneCO2(zone, s, opt)    { /* 'ocean' | 'green' | 'city', opt.treeShade, opt.localCut — C3 */ }
  function seaState(prox, s)        { /* seawaterState(pco2_sw, 수온) + temp·pco2 — C4 */ }
  return { NOW_YEAR, runFor, sample, airTemp, seaTemp, iceSurfaceTemp, zoneCO2, seaState, K };
})();
```

   - 상수(`K`)는 모듈 맨 위 한 곳: 증폭 계수·도시 증가분·열섬 등 — 각 줄에 등록부 키를 주석으로.
   - 로드 순서: `earth-model` → `earth-data` → `earth-system` → **`earth-visual`**(1인칭은 지금 안 부름 — 추가) → **`fp-model`** → `fp-world` …. 1인칭 `index.html` 과 빌더 `FP_JS` 를 같이.
2. 새 검사 **`tools/test_fp_model.js`**: `test_earth_system.js` 처럼 `vm` 으로 위 파일들을 불러 §6의 항목을 검사.

## 2. C2 — 기온 · 해수온

| 지점 | 식 (연평균) | 근거 · 등록부 키 |
|---|---|---|
| 녹지 대기 | `AIR_T0 + k_land × T` | `AIR_T0` 14 °C(`model_air_temp`, unverified — 지금 `tab-future.js` 에만 있다. **`js/earth-model.js` 로 옮기고** 조감·1인칭이 같은 상수를 쓰게, 값 불변), `k_land` = 1.59 / 1.09 ≈ **1.46**(`fp_land_amp`, AR6 SPM A.1.2 발췌본) |
| 도심 대기 | 녹지 대기 + **2 °C** × `cityLevel(cumFossilMax) ÷ cityLevel(2020년 값)` | `fp_uhi`, calibrated + unverified (문헌값 2-6). 2020년에 2 °C(범위 1~4), 도시가 작던 1750년 ≈ 0 — 열섬은 도시 크기를 따른다(연출 비율은 `city_scale`) |
| 해양 대기 | `AIR_T0 + k_ocean × T` | `k_ocean` = 0.88 / 1.09 ≈ **0.81**(`fp_ocean_amp`) |
| 해수(개방 해역) | **`o.sst`** | 조감 기록 표 `water_temp` 와 같은 값 |
| 해수(냉수대) | `max(−1.9, o.sst − COLD_POOL_DT × prox)` | `fp_cold_pool`(assumption) — `COLD_POOL_DT` 12·반경 0.35유닛 그대로 |
| 빙하 표면 | `min(0, −6 + k_ocean × T)` | `fp_ice_surface`(assumption, 융해 잠열로 0 °C 상한) |
| 어류 | (B4에서 체온 측정 삭제) | — |

- **지면 3종(해변 모래·녹지 지면·도시 지면) 삭제**(마스터 D9). 땅을 겨눠도 그 구역 **대기**를 잰다. 도움말·횡단 조사 문구를 맞춘다.
- `SPOT` 표의 `base`·`amp`·`day`(일교차) 삭제 — 연평균이라 일교차 항이 없다. 지점 흔들림(`jitter`)은 연출로 남기되 ±0.3 °C 안으로 줄이고 assumption 으로 밝힌다(구역 차이 2 °C보다 충분히 작게).
- `warmingSince280`·`climateAnomaly`: 1인칭에서 부르는 곳을 없앤다. 함수 자체는 다른 곳(테스트 포함)에서 쓰는지 grep 하고, 아무도 안 쓰면 삭제(주석 '3단계에서 교체 예정'이 이것으로 끝난다). 값이 바뀌는 게 아니라 쓰임이 없어지는 것이라 마스터 §4에 걸리지 않는다.
- B3에서 남긴 `SEASONS` 'summer' 한 개 정의와 '여름 정오' 기준값을 여기서 **삭제**한다.

## 3. C3 — 구역 대기 CO₂

| 구역 | 식 | 근거 · 등록부 키 |
|---|---|---|
| 배경 | `o.ppm` | 엔진 |
| 해양 대기 | **배경 그대로** | NOAA 지구 평균 자체가 바다 위 관측소 평균(문헌값 2-4, 등록부 `co2_noaa_gl` 요약). 지금 −15~−30 ppm 삭제 |
| 도심 대기 | 배경 + `E_city × (1 − localCut)` | `E_city = 23 ppm × fossil(year) ÷ fossil(2020)`, 0 이상(`fp_urban_co2`, calibrated — 서울 도시 증가분 20~27 ppm, 문헌값 2-3). `localCut` 은 F4가 채움(상한 0.42, 1-6) |
| 녹지 대기 | 배경 + 지금 모형의 **정오 정상 상태값** | `fp_green_co2`, assumption + **unverified**(문헌값 2-5 — 정량 문헌 미확보) |
| 나무 밑 | 녹지 + 지금 모형의 낮 흡수 항 | `fp_tree_co2`, assumption |
| 굴뚝·배기구 바로 옆 | 지금 모형 그대로, 단 굴뚝은 `stackLevel(fossil)`, 배기구는 **내연기관차만**(C5) | `fp_local_source`, assumption |

- 구역 값은 위 식으로 바로 계산한다(호출부는 `FPModel.zoneCO2`). `FPAir` 의 상태 적분(0.2초 틱)에는 아직 해수 pCO₂(`stepSeaCO2`)가 붙어 있으므로 **C4를 마친 뒤** `FPAir` 를 통째로 삭제한다.
- 계측 오차(`TOOL_SPEC.co2.sigma` 8 ppm)는 그대로 — F4에서 '여러 번 재야 차이가 보인다'에 쓴다.

## 4. C4 — 바다 = 엔진의 그해 표층 상태

- **삭제**: `stepSeaCO2`·`equilibrateSeaCO2`·`SEA_TAU_SW`·`FPWorld.pco2Sea`·설정창 '즉시 평형' 버튼·HUD '평형 중' 문구·`oceanAirCO2`.
  시간 여행에서는 엔진이 이미 그해 표층 해양(DIC)을 계산한다. 2게임일 수렴은 연도를 뛰어넘는 구조와 맞지 않는다.
- `pco2_sw(year)` = `pco2FromDic(o.dic, o.sst).pco2` (엔진이 쓰는 함수 그대로, `earth-model.js`). 지점 상태 = `seawaterState(pco2_sw, 그 지점 수온)`.
  **개방 해역에서 pH·Ω가 엔진 `o.pH`·`o.omega` 와 같아야 한다**(§6-2) — 다르면 엔진이 pH를 어떻게 내는지(`pco2FromDic` 결과의 pH)를 다시 보고, 같은 함수 결과를 쓴다.
- 산호(`applyOceanHealth`):
  - **개방 해역 산호** = `EarthVisual.coralHealthy(T)`(등록부 `coral_sr15`) — 조감과 같은 식. 지금 `bleachFromTemp` 의 18 °C 기준 임계는 엔진 해수온(2023 약 19.2 °C)과 맞지 않으므로 삭제.
  - **냉수대 산호** = `habitatFromOmega(Ω_냉수대)` 그대로(석회화 — 원인이 다르다는 것을 공간으로 보이는 장치, 과제 ③).
  - 어류·수초 개체 수는 두 값으로 — 지금 식의 구조 유지.
- 유빙 크기 = `EarthVisual.glacierFrac(T)`(등록부 `glacier_scale`, 계절 배수 대신). 충돌 반지름도 같이.
- 냉수대 Ω<1 경고는 남긴다. 현재 정책 2100년에서 Ω가 1 위면 **경고가 안 뜨는 것이 정직한 결과**다 — 값을 세이브포인트에. 억지로 켜지 마라.

## 5. C5 — 시각 언어 = EarthVisual 규칙

| 대상 | 지금 | 바꿀 것 | 등록부 |
|---|---|---|---|
| 하늘·안개 | `CLEAR_SKY ↔ HAZY_SKY`, 시야 7 → 1.1유닛 | **CO₂와 무관하게 고정**(맑은 낮) | (CO₂ 무색, 2차 D2) |
| 수면 | 파도 `× (1 + co2k × 0.5)`, 반사 감소 | CO₂ 항 삭제 | |
| 자동차 | 10대 고정, 전기차 수 = ppm 비례 | 대수 = `round(10 × carFrac(cityLevel(cumFossilMax)))`, 전기차 비율 = `presetSociety(...).ev` | `city_scale` |
| 굴뚝 연기 | 양 = ppm | 양·속도 = `stackLevel(fossil)`, 0이면 없음 | `city_scale` |
| 건물 8채 | 고정 | 높이·개수 = `cityLevel(cumFossilMax)` — 낮은 건물부터 나타남, **충돌 상자 `top` 같이 갱신**. 1750년은 1~2채 | `city_scale` |
| 산호·유빙 | C4 | C4 | `coral_sr15` · `glacier_scale` |

- 1인칭 세계 상태를 바꾸는 함수는 **하나**로: `applyWorldState(s)`(지금 `applyWorldCO2(ppm)` 대체). 인자는 엔진 표본 `s`(ppm·T·sst·pH·omega·dic·fossil·cumFossilMax·year). E2가 이 함수를 부른다.
- `CO2_MIN/CO2_MAX`·`co2k` 를 쓰던 연출이 다 빠지면 `co2k` 도 지운다. 상수는 그대로(마스터 §6-7).
- 냉각탑·태양광이 1인칭에 있으면 `presetSociety` 의 `nuclear`·`renew` 로. 없으면 새로 만들지 않는다.

## 6. C6 — 등록부 · 검사

### 등록부 (`js/sources.js`) 새 키

`fp_land_amp`, `fp_ocean_amp`(param, verified — 발췌본), `fp_uhi`, `fp_urban_co2`(calibrated, unverified), `fp_green_co2`, `fp_tree_co2`, `fp_local_source`, `fp_cold_pool`, `fp_ice_surface`, `fp_jitter`(assumption). 각 `note` 에 식과 문헌값 파일 절 번호.
1인칭 화면의 ⓘ는 D1에서 붙인다 — C6에서는 키만 만들고 `check_sources` 통과.

### `tools/test_fp_model.js`

1. **같은 해 같은 값**: 1750·1850·1950·2023·2026·2050·2100 × `ssp245`·`ssp126`·`ssp119` 에서 `FPModel.sample` 의 ppm·T·sst·pH·Ω가 `EarthSystem.run` 결과와 같다(차이 0).
2. 개방 해역: `seaState(0, s).pH`·`omega` 가 `s.pH`·`s.omega` 와 ±0.001·±0.01.
3. 해양 대기 CO₂ = 배경(±0.01 ppm).
4. 도심 − 배경: 2020년 23 ± 0.5 ppm, 1750년 < 1 ppm, 현재 정책 2100년 < 2020년 값.
5. 도심 − 녹지 기온: 2020년 2.0 ± 0.01 °C, 1750년 < 0.1 °C. 녹지 대기 편차 ÷ T = 1.46 ± 0.01, 해양 대기 편차 ÷ T = 0.81 ± 0.01.
6. 냉수대 수온 ≥ −1.9 °C, 빙하 표면 ≤ 0 °C.
7. 표 출력: 1750 · 2023 · 2026 · 2100(세 경로)의 지점별 값 — 세이브포인트에 붙인다.

### 🧑 확인

- 1인칭 `?year=1850` · `?year=2023` · `?scenario=ssp245&year=2100`(E 전이라 주소로): 건물·자동차·연기가 연도에 따라 바뀌고, **하늘·파도는 세 연도가 같다.** 콘솔 0.
- 2023 도심에서 CO₂ 센서 10회 평균 ≈ 배경 + 23(±σ/√10), 바다 위 하늘 10회 평균 ≈ 배경.
- 드로우콜이 B 끝 값 이하.
