# 2차 A — 근거 정비

> 마스터: `TASK_2차_마스터.md`. 이 단계의 목표는 **화면의 모든 수치가 출처를 댈 수 있게** 하는 것이다.
> 원본은 `Critical_Earth_simulator/data/raw/` 에 사람이 받아 둔 그대로 있다. **원본 파일은 절대 수정하지 않는다.**

## 현재 상태 (사전 조사 결과)

| 값 | 쓰는 곳 | 상태 |
|---|---|---|
| 대기 CO₂ 관측 `histCo2` (1988~2023) | `js/tab-current.js` | **출처 불명.** NOAA 지구 평균 현행판보다 평균 0.9 ppm 낮고 차이가 들쭉날쭉(표준편차 0.27) |
| 기온 관측 `histTemp` (1988~2023) | `js/tab-current.js` | **출처 불명.** NOAAGlobalTemp·GISTEMP를 평행이동해도 맞지 않음(차이 표준편차 0.13 °C). 전 지구 평균이 아닐 가능성 |
| 해수 pH 관측 `histPh` (1989~2023) | `js/tab-current.js` | 문서상 HOT(ALOHA) 35점. 코드에 출처 미표기 |
| 화석연료 배출 `histFossil` | `js/tab-current.js` | OWID(GCP) 값과 일치 |
| 엔진 배출 | `data/historical_emissions_gtc.csv` | OWID(GCP). 출처 문서 있음 |
| 엔진 검증 CO₂ | `data/mlo_annual.csv` | GitHub 미러 경유 NOAA MLO → 원본으로 교체 |
| 시나리오 3종 | `js/earth-system.js` `PRESETS` | **임의로 만든 경로** → SSP로 교체 |
| 레버 상수 | `js/earth-system.js` | Ember 확인, 4개 미확인 |

## §1. 원본 → 정리 데이터 변환 (A1)

`tools/gen_earth_data.py` 를 확장한다. **raw를 읽어 정리 CSV를 만들고, 정리 CSV에서 `js/earth-data.js` 를 만든다.**
정리 CSV는 `data/` 바로 아래에 두고, 각 파일 첫 줄 주석에 원본 파일명·원본 버전 표기를 적는다.

| 정리 파일 | 원본 | 내용 |
|---|---|---|
| `data/co2_noaa_gl_annual.csv` | `raw/noaa/co2_annmean_gl.csv` | 연도, ppm, 불확도. **완전한 해만**(진행 중인 해 제외) |
| `data/co2_noaa_mlo_annual.csv` | `raw/noaa/co2_annmean_mlo.csv` | 같은 형식. 기존 `data/mlo_annual.csv` 를 대체 |
| `data/co2_cmip6_hist.csv` | `raw/rcmip/rcmip-concentrations-…csv` | 시나리오 `historical`, 지역 `World`, 변수 CO₂ 농도의 1750~2014 |
| `data/temp_hadcrut5_annual.csv` | `raw/hadcrut/HadCRUT.5.*…annual.csv` | 연도, 편차, 하한, 상한. **1850~1900 평균을 빼서 산업화 이전 기준으로 변환** |
| `data/ph_hot_annual.csv` | `raw/hot/HOT_surface_CO2.txt` | 연도, pH 연평균, 측정 횟수 (§2-3) |
| `data/ta_hot.csv` | 같은 파일 | 총알칼리도·염분 연평균 (엔진 상수 근거용) |
| `data/ssp_emissions.csv` | `raw/rcmip/rcmip-emissions-…csv` | SSP1-1.9, SSP1-2.6, SSP2-4.5의 화석·산업, 토지이용 CO₂ [GtC/yr] |
| `data/ssp_concentrations.csv` | `raw/rcmip/rcmip-concentrations-…csv` | 같은 세 시나리오의 CO₂ 농도 (**검증 전용, 앱에는 넣지 않음**) |

주의:
- RCMIP 파일은 행 하나가 시계열 하나인 넓은 표다. **변수 이름·단위·시나리오 이름은 파일 머리를 직접 읽어 확인하라.**
  기대하는 이름은 `Emissions|CO2|MAGICC Fossil and Industrial`, `Emissions|CO2|MAGICC AFOLU`, `Atmospheric Concentrations|CO2`,
  시나리오 `historical`, `ssp119`, `ssp126`, `ssp245`, 지역 `World` 이지만 **다르면 실제 이름을 쓰고 PR에 적는다.**
- 단위 변환은 MtCO₂ ÷ 3664 = GtC. 변환 상수를 스크립트에 이름 붙여 둔다.
- HadCRUT5의 1850~1900 기준 변환값(빼 준 평균)을 정리 CSV 주석과 PR에 적는다.
- `js/earth-data.js` 에는 **앱이 실제로 쓰는 것만** 넣는다. `ssp_concentrations` 는 테스트만 읽는다.

## §2. 관측 자료 교체 (A2)

### 2-1. 대기 CO₂

- 현재 실태 탭 `histCo2` 를 NOAA 지구 평균(1979~최신 완전한 해)으로 교체한다.
- 미래 예측 탭의 관측점은 **1750~1978은 CMIP6 역사 농도, 1979~는 NOAA 지구 평균**으로 잇는다.
  범례는 "얼음 코어 기반 재구성 (CMIP6)"과 "관측 (NOAA 지구 평균)"으로 나눈다. 1978→1979 이음매 차이를 PR에 적는다.
- 기존 `histCo2` 와 새 값의 연도별 차이표(최소·최대·평균)를 PR에 남긴다.

### 2-2. 기온

- 현재 실태 탭 `histTemp` 를 HadCRUT5(1850~1900 기준)로 교체하고, 그래프 기간도 1850~로 넓힌다. 불확도 범위를 옅은 띠로 그린다.
- **기준선이 확인됐으므로 이제 모형 기온선을 겹친다**(1차 대격변 11단계에서 막아 뒀던 것).
- 기존 `histTemp` 를 HadCRUT5와 대조한 결과(평행이동 후 잔차 표준편차)를 PR에 적는다. "기존 자료는 전 지구 평균이 아니었다"는 결론이 나오면 그대로 적는다.
- `tab-current.js` 의 "histTemp 기준 기간 미확인" 주석은 삭제한다.

### 2-3. 해수 pH

- `HOT_surface_CO2_readme.pdf` 를 읽고 열 이름을 확인한다. 기존 `histPh` 와 같은 종류의 값(계산 pH, 현장 수온, total scale 등)이 어느 열인지 찾는다.
- 항해별 값을 연평균으로 묶어 `histPh` 35점과 대조한다.
  - 모든 해에서 차이가 0.003 이내면 **"기존 자료 = HOT 연평균"으로 출처 확정**하고, 새 연평균으로 교체한다.
  - 차이가 크면 어느 열·어느 방식이 기존 값과 가장 가까운지 보고하고, readme가 권하는 대표값으로 교체한다.
- readme 첫머리에 지정된 **인용 문구를 그대로** 등록부에 옮긴다.

### 2-4. 엔진 상수 근거

- `data/ta_hot.csv` 의 총알칼리도·염분 장기 평균을 엔진의 `OCEAN_TA = 2.3e-3`, `S = 35` 와 비교해 PR에 적는다.
  **상수는 바꾸지 않는다.** 근거(또는 차이)만 기록한다.

## §3. SSP 시나리오 교체 (A3)

`EarthSystem.PRESETS` 의 세 경로(`bau`, `paris`, `nz2050`)를 SSP로 바꾼다.

| 새 키 | 화면 이름 | SSP | 근거 문구 (등록부) |
|---|---|---|---|
| `ssp245` | 현재 정책 | SSP2-4.5 | 현재 정책이 유지될 때의 경로에 가장 가까운 SSP |
| `ssp126` | 파리협약 2 °C | SSP1-2.6 | 2 °C 아래로 억제하는 경로 |
| `ssp119` | 1.5 °C 탄소중립 | SSP1-1.9 | 1.5 °C 억제, 세기 중반 탄소중립 경로 |

**조화(harmonization).** 2023년까지는 지금처럼 GCP 역사 배출을 쓰고, 2024년부터 SSP를 잇는다.
SSP 원자료의 2023년 값과 GCP 2023년 값이 다르므로 **차이를 2050년까지 선형으로 줄여 0으로 만든다**(화석·토지이용 각각).

```
E(y) = SSP(y) + [E_GCP(2023) − SSP(2023)] × max(0, 1 − (y − 2023)/(2050 − 2023))     (2024 ≤ y)
```

- SSP 원자료가 연 단위가 아니면 선형 보간한다.
- **2100년 이후**: 원자료에 2100년 이후 값(연장 경로)이 있으면 그대로 쓴다. 없으면 **2100년 배출을 2200년까지 유지**하고,
  등록부와 화면 설명에 "2100년 이후는 2100년 배출 유지 가정"이라고 밝힌다. 어느 쪽이었는지 PR에 적는다.
- 직접 설계(레버)는 그대로 둔다. 레버의 "현재값 = 2023년 배출 일정" 검증은 계속 통과해야 한다.
- 옛 키(`bau`, `paris`, `nz2050`)를 쓰는 코드를 전부 찾아 바꾼다. `tools/earth_system_ref/scen.py` 에도 SSP 경로를 같은 규칙으로 넣어
  파이썬·JS 대조가 계속 되게 한다(`engine.py` 의 `PARAMS` 는 그대로).

## §4. 엔진 재검증 【게이트】 (A4)

`tools/test_earth_system.js` 를 갱신한다. 1차 대격변의 옛 프리셋 기대값은 SSP 기대값으로 **바꾸되**, 역사 구간 검증은 유지한다.

**(a) 역사 재현** — 새 관측과 대조. 파라미터는 그대로 둔다.

| 항목 | 통과 기준 |
|---|---|
| CO₂ vs NOAA 지구 평균, 1979~최신 | RMSE ≤ 4 ppm |
| CO₂ vs CMIP6 역사 농도, 1850~1978 | 최대 오차 ≤ 10 ppm (1950년 이전은 원래 6~8 ppm 낮게 나온다) |
| 기온 vs HadCRUT5, 2014~2023 평균 | 차이 ≤ 0.2 °C |
| 기온 vs HadCRUT5, 10년 평균 1900s~2010s | 각 10년 차이를 표로 남김 (기준 없음 — CO₂ 강제력만 넣은 모형이라 화산·에어로졸 시기에 어긋나는 것이 정상) |
| pH vs HOT 연평균 | 엔진 pH는 전 지구 평균 수온 기준이고 HOT는 아열대(약 25 °C) 한 지점이라 절댓값 비교는 참고용이다. **1989~최신 선형 추세(pH/년)** 를 서로 비교해 표로 남김 |

**(b) SSP 결과** — JS와 파이썬이 일치(|Δppm| < 0.05, |ΔT| < 0.005)하고, 아래를 표로 남긴다.

- 2050 / 2100 / 2200년의 CO₂, 기온, pH, Ω (세 시나리오)
- **RCMIP SSP 농도와 비교**: 2050·2100년 CO₂ 차이(%)
- **IPCC AR6 범위와 비교**: 2081~2100 평균 기온을 `docs/refs/발췌/IPCC_AR6_WG1_SPM.md` 의 시나리오별 범위(Table SPM.1, PDF 14쪽)와 대조. 값은 `체크리스트.md` 의 IPCC_AR6_WG1_SPM 항목에 있고, 표는 `IPCC_AR6_WG1_SPM_p14.jpg` 로 확인한다.
  참고로 원문 값은 SSP1-1.9 1.4 (1.0~1.8), SSP1-2.6 1.8 (1.3~2.4), SSP2-4.5 2.7 (2.1~3.5) °C 로 알려져 있으나 **반드시 발췌본(이미지 포함)에서 직접 확인하고**, 확인한 쪽 숫자와 PDF 쪽 번호를 쓴다.

**게이트 기준**: (a)의 통과 기준 셋 + (b)의 JS·파이썬 일치. 2100년 CO₂가 RCMIP와 10% 넘게 다르거나 기온이 AR6 범위 밖이면
**게이트 실패가 아니라 "보고 항목"** 이다. 다만 그 사실과 원인 추정(예: CO₂ 외 강제력 미포함)을 PR 맨 위 요약에 적고,
화면의 ⓘ 설명에도 "이 모형은 CO₂만 계산하므로 IPCC 범위와 다를 수 있음"을 넣는다.

## §5. 출처 등록부 (A5)

`js/sources.js` 를 새로 만든다. **출처는 여기 한 곳에만 쓴다.** 화면·문서는 전부 여기서 읽는다.

```js
const SOURCES = {
  co2_noaa_gl: {
    label: '대기 CO₂ 지구 평균 (관측)',
    kind: 'obs',            // obs 관측 | model 모형 계산 | param 상수·파라미터 | assumption 가정 | calibrated 보정값
    org: 'NOAA Global Monitoring Laboratory',
    dataset: 'Globally averaged marine surface annual mean CO₂',
    version: '<원본 머리말의 버전·날짜를 그대로>',
    cite: 'Lan, X., Tans, P., Thoning, K.W. … https://doi.org/10.15138/9N0H-ZH07',
    url: 'https://gml.noaa.gov/ccgg/trends/gl_data.html',
    file: 'data/raw/noaa/co2_annmean_gl.csv',
    license: '…',
    status: 'verified',     // verified | unverified
    note: '…',
  },
  // …
};
```

최소한 아래 항목을 만든다. 각 항목의 `cite` 는 원문(데이터 파일 머리말, readme, 누리집의 인용 안내, 문헌 발췌본)에서 **그대로** 옮긴다.

| 키 | 종류 | 내용 |
|---|---|---|
| `co2_noaa_gl`, `co2_noaa_mlo` | obs | NOAA GML |
| `co2_cmip6_hist` | obs | CMIP6 역사 농도 (Meinshausen et al. 2017), RCMIP 경유 (Nicholls et al. 2020) |
| `temp_hadcrut5` | obs | HadCRUT5, Met Office·CRU, OGL v3. 기준선 변환 사실을 `note` 에 |
| `ph_hot`, `ta_hot` | obs | HOT Station ALOHA, readme의 인용 문구 |
| `emis_gcp` | obs | Global Carbon Project via OWID (`data/SOURCES.md` 내용 이관) |
| `ssp_emissions` | assumption | SSP 배출 (RCMIP 경유) + 조화 규칙 + 2100년 이후 처리 |
| `k0_weiss`, `k12_lueker`, `ksp_mucci` | param | Weiss 1974, Lueker et al. 2000, Mucci 1983 |
| `forcing_myhre` | param | ΔF = 5.35 ln(C/C₀), Myhre et al. 1998 |
| `ebm_params` | param 또는 calibrated | λ·열용량·γ. 문헌값과 일치를 확인하면 param, 못 하면 calibrated |
| `carbon_params` | calibrated | 탄소순환 파라미터. `note` 에 A4 검증 결과(RMSE) |
| `model_co2`, `model_temp`, `model_ph`, `model_sst` | model | 모형 계산값. 입력·식·검증을 `note` 에 |
| `lever_*` | param 등 | 아래 "레버 상수 사전 조사" 표대로 |
| `ar6_spm`, `sr15_spm` | param | IPCC 문서 (E 단계 영향 카드용) |

**레버 상수 사전 조사** (`체크리스트.md` 의 IEA·ICCT·Ember 항목 기준, 등록 전에 쪽 이미지로 재확인)

| 상수 | 현재 값 | 근거 | 등록 |
|---|---|---|---|
| `f0` 화석 발전 비중 | 0.61 | Ember GER 2024, PDF 57쪽: 화석 61% | `verified` |
| 원자력 / 재생 비중 | 0.09 / 0.30 | 같은 쪽: 원자력 9.1%, 재생 30% | `verified` (원자력은 0.091로 고칠지 PR에 제안만, **값은 바꾸지 마라**) |
| `k_ev` 전기차 배출비 | 0.45 | ICCT 2021, PDF 3쪽: 전과정 배출이 휘발유차보다 유럽 66~69%, 미국 60~68%, 중국 37~45%, 인도 19~34% 낮음 → 비율 0.31~0.81 | `kind: 'assumption'` — "지역별 범위 안에서 고른 세계 추정값"이라고 `note` 에 |
| `s_power`, `s_road` 부문 비중 | 0.40, 0.16 | IEA CO2 2023 보고서에는 2022→2023 증감만 있고 부문별 총량·비중이 없음(PDF 19쪽) | `unverified` — `note` 에 "부문별 배출 자료(예: EDGAR) 필요" |
| `ev0` 전기차 비율 | 0.03 | 분자(2023년 말 전기 승용차 4,000만 대)는 IEA GEVO 2024 PDF 17쪽에서 확인, 분모(세계 승용차 보유 대수)는 보고서에 없음 | `unverified` — 분자 출처는 `note` 에 |

추가로:
- `tools/check_sources.js` — 모든 HTML·JS에서 `data-src="…"` 를 모아 등록부에 있는지, 모든 항목에 `url`·`cite`·`status` 가 있는지 검사. 빌드 전에 돌린다.
- `tools/gen_sources_doc.js` — 등록부로부터 `docs/데이터출처.md` 를 생성한다(논문 참고문헌 정리용). 손으로 쓰지 않는다.
- 기존 `data/SOURCES.md` 는 "등록부(`js/sources.js`)로 옮겼음" 안내만 남긴다.
- 새 js는 `index.html` 과 `build_single_html.py` 의 `AERIAL_JS` 에 `earth-data.js` 바로 뒤로 넣는다.
