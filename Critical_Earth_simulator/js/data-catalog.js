// ============================================================================
// 자료 목록 (3차 C1) — 그래프 작업대(js/graph-workspace.js)에 놓는 자료 카드
// ----------------------------------------------------------------------------
// 데이터만 둔다(실행기는 graph-workspace.js — 2차 E의 inquiry-steps.js / inquiry.js 와 같은 나눔).
// 교사는 이 파일만 고쳐 카드를 넣고 뺄 수 있다. 고친 뒤 node tools/test_catalog.js 로 형식을 검사한다.
//
// 항목 필드
//   id · label(카드 이름) · short(축 칩·범례용 짧은 이름) · unit
//   axis    같은 값이면 한 축을 같이 쓴다: 'ppm' · 'dT'(°C 편차) · 'pH' · 'GtCyr' · 'GtC' · 'omega'
//   src     js/sources.js 키(문자열 또는 배열). 카드·축·증거에 출처가 따라간다
//   scope   'global'(전 지구) · 'station'(한 지점) · 'model'(모형 계산) — 카드와 범례에 꼬리표로 보인다
//   color   css/theme.css 색 토큰
//   minSpan 축 범위의 최소 폭. 작은 출렁임이 큰 변화처럼 보이지 않게 (작업대 규칙 R3)
//   order   카드 순서 · deck: 'core'(기본 4장) · 'carbon'(탄소순환) · 'model'(모형 비교)
//   get()   [{ x: 연도, y: 값, lo?, hi?, seg? }]. seg = 자료가 이어 붙은 경계(그 해부터 다른 원본) { text, src }
//
// 항목 추가 방법 (태양 복사량·CH₄ 등 원본이 저장소에 없는 자료는 이번엔 넣지 않았다)
//   원본 파일을 data/ 에 → tools/gen_earth_data.py 에서 읽어 js/earth-data.js(EARTH_DATA)에 배열로 → 등록부 js/sources.js 에 출처 키
//   → 아래 DATA_CATALOG 에 한 줄(get 은 DataSeries.points(EARTH_DATA.새자료, '열이름')) → node tools/test_catalog.js
// 로드 순서: earth-system.js 뒤(모형 항목이 EarthSystem.run 을 쓴다), tab-future.js·graph-workspace.js 앞
// ============================================================================

// 자료 → 점 배열. 미래 예측 탭(js/tab-future.js OBS_PTS)과 작업대가 같은 함수를 쓴다(같은 자료가 두 화면에서 다르게 이어지지 않게)
const DataSeries = (() => {
  const points = (d, key) => d[key].map((v, i) => ({ x: d.startYear + i, y: v })).filter(p => p.y != null && Number.isFinite(p.y));
  // 대기 CO₂ 관측선: 1750~1978 CMIP6 역사 농도(얼음 코어 등 재구성) + 1979~ NOAA 전 지구 평균. 두 원본은 겹치지 않는다(gen_earth_data.py)
  const co2Obs = () => [...points(EARTH_DATA.co2Cmip6, 'ppm'), ...points(EARTH_DATA.co2Noaa, 'ppm')];
  // 모형 실행은 페이지당 한 번만 계산해 둔다(카드를 여러 번 끌어도 다시 돌리지 않게)
  const cache = {};
  const run = (name, emissionsFn) => cache[name] || (cache[name] =
    EarthSystem.run({ fromYear: 1750, toYear: EarthSystem.LAST_HIST_YEAR, ...(emissionsFn ? { emissionsFn } : {}) }));
  const history = () => run('history');                              // 1750~2023 실제 배출
  const nature = () => run('nature', EarthSystem.natureEmissions);   // 같은 기간, 사람의 배출 0
  const fromRun = (rows, f) => rows.map(o => ({ x: o.year, y: f(o) }));
  return { points, co2Obs, history, nature, fromRun };
})();

// 축 이름의 단위 (같은 axis 끼리 한 축을 같이 쓴다)
const DATA_AXES = {
  ppm: { unit: 'ppm' },
  dT: { unit: '°C, 1850~1900 대비' },
  pH: { unit: '' },
  GtCyr: { unit: 'GtC/년' },
  GtC: { unit: 'GtC, 1750년부터 누적' },
  omega: { unit: '' },
};

const DATA_DECKS = { core: '기본 자료', carbon: '탄소순환', model: '모형 비교' };

const DATA_CATALOG = [
  // ── 기본 4장: CO₂ → 기온 → 해수온 → pH (3차 결정) ──
  { id: 'co2', label: '대기 CO₂ 농도', short: '대기 CO₂', unit: 'ppm', axis: 'ppm', src: ['co2_cmip6_hist', 'co2_noaa_gl'],
    scope: 'global', color: '--data-co2', minSpan: 40, order: 1, deck: 'core',
    get: () => DataSeries.co2Obs().map(p => p.x === EARTH_DATA.co2Noaa.startYear
      ? { ...p, seg: { text: `${p.x}년부터 NOAA 직접 관측(전 지구 평균), 앞은 CMIP6 재구성 농도(얼음 코어 등)`, src: 'co2_noaa_gl' } } : p) },
  { id: 'temp', label: '기온 편차', short: '기온', unit: '°C', axis: 'dT', src: 'temp_hadcrut5',
    scope: 'global', color: '--data-temp', minSpan: 0.5, order: 2, deck: 'core',
    get: () => { const d = EARTH_DATA.tempHadcrut;
      return DataSeries.points(d, 'anom').map(p => { const i = p.x - d.startYear; return { ...p, lo: d.lo[i], hi: d.hi[i] }; }); } },
  // 해수온은 편차(°C)로 넣어 기온과 같은 축(dT)에 놓는다. 절대 수온(sst0 + 편차)은 미래 예측 탭에서만 쓴다
  { id: 'sst', label: '해수온 편차', short: '해수온', unit: '°C', axis: 'dT', src: 'obs_sst_hadsst4',
    scope: 'global', color: '--data-sst', minSpan: 0.5, order: 3, deck: 'core',
    get: () => DataSeries.points(EARTH_DATA.sstHadsst, 'anom') },
  // pH는 전 지구 평균이 아니라 한 지점 관측이다(전 지구 재구성 자료로 바꾸는 일은 보류 — 3차 마스터 결정 7)
  { id: 'ph', label: '해수 pH (하와이 한 지점)', short: 'pH (한 지점)', unit: '', axis: 'pH', src: 'ph_hot',
    scope: 'station', color: '--data-ph', minSpan: 0.1, order: 4, deck: 'core',
    get: () => DataSeries.points(EARTH_DATA.phHot, 'ph') },

  // ── 탄소순환: 사람이 내보낸 탄소 ──
  { id: 'fossil', label: '화석연료 배출', short: '화석연료 배출', unit: 'GtC/년', axis: 'GtCyr', src: 'emis_gcp',
    scope: 'global', color: '--data-fossil', minSpan: 2, order: 5, deck: 'carbon',
    get: () => DataSeries.points(EARTH_DATA.emissions, 'fossil') },
  // 1750~1849년 토지이용 배출은 원자료에 없어 선형으로 추정한 값이다(lucEstimated = 1) — 경계에 seg 로 밝힌다
  { id: 'luc', label: '토지이용 배출 (숲 벌채 등)', short: '토지이용 배출', unit: 'GtC/년', axis: 'GtCyr', src: 'emis_gcp',
    scope: 'global', color: '--data-luc', minSpan: 2, order: 6, deck: 'carbon',
    get: () => { const d = EARTH_DATA.emissions, first = d.startYear + d.lucEstimated.indexOf(0);
      return DataSeries.points(d, 'luc').map(p => p.x === first
        ? { ...p, seg: { text: `${first}년부터 GCP 자료, 앞(${d.startYear}~${first - 1})은 원자료가 없어 선형으로 추정한 값`, src: 'emis_gcp' } } : p); } },

  // ── 모형 비교: 이 프로그램의 엔진(js/earth-system.js)이 1750~2023 실제 배출로 계산한 값 ──
  { id: 'co2_nature', label: '사람이 없었다면 CO₂ (모형)', short: 'CO₂ (사람 없음, 모형)', unit: 'ppm', axis: 'ppm', src: 'model_co2',
    scope: 'model', color: '--data-nature', minSpan: 40, order: 7, deck: 'model',
    get: () => DataSeries.fromRun(DataSeries.nature(), o => o.ppm) },
  { id: 'sink_ocean', label: '바다가 흡수한 탄소 누적 (모형)', short: '바다 흡수 누적', unit: 'GtC', axis: 'GtC', src: 'carbon_params',
    scope: 'model', color: '--data-ocean', minSpan: 50, order: 8, deck: 'model',
    get: () => DataSeries.fromRun(DataSeries.history(), o => o.cum.ocean) },
  { id: 'sink_land', label: '토양·식생이 흡수한 탄소 누적 (모형)', short: '육지 흡수 누적', unit: 'GtC', axis: 'GtC', src: 'carbon_params',
    scope: 'model', color: '--data-land', minSpan: 50, order: 9, deck: 'model',
    get: () => DataSeries.fromRun(DataSeries.history(), o => o.cum.land) },
  // 탐구 경로 B1(3차 E3)의 '모형이 계산한 1750년부터의 전 지구 평균 표층 pH'를 작업대에서도 보이려고 넣었다. 관측 pH와 같은 축(pH)
  { id: 'ph_model', label: '해수 pH (모형, 전 지구 평균)', short: 'pH (모형)', unit: '', axis: 'pH', src: 'model_ph',
    scope: 'model', color: '--data-ph', minSpan: 0.1, order: 11, deck: 'model',
    get: () => DataSeries.fromRun(DataSeries.history(), o => o.pH) },
  { id: 'omega', label: '아라고나이트 포화도 Ω (모형)', short: 'Ω (모형)', unit: '', axis: 'omega', src: 'model_omega',
    scope: 'model', color: '--data-omega', minSpan: 0.5, order: 10, deck: 'model',
    get: () => DataSeries.fromRun(DataSeries.history(), o => o.omega) },
];

// 안내 줄 문구 (3차 C3). 두 자료를 함께 놓았을 때 띄운다. 결론을 말하지 않고 질문으로 둔다
const DATA_HINTS = {
  empty: '오른쪽 카드를 그래프로 끌어 놓으세요.',
  one: '오른쪽 카드를 끌어 놓아 비교해 보세요.',
  pairs: [
    { pair: ['co2', 'fossil'], text: '두 선이 함께 오르나요? 배출이 빨라진 때와 CO₂가 빨리 오른 때가 같은가요?' },
    { pair: ['co2', 'ph'], text: 'CO₂가 오르는 동안 pH는 어느 쪽으로 움직이나요? 두 자료는 각각 언제부터 있나요?' },
  ],
};
