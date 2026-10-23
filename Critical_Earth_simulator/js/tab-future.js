// ================= 미래 예측 탭 - 1750~2200 타임라인 =================
// 예전엔 CO2를 슬라이더로 넣고 pH·기온을 그 자리의 평형값으로 냈다. 이제 CO2는 배출을 쌓아
// 계산한 '결과'다(js/earth-system.js). 바꿀 수 있는 것은 배출(SSP 시나리오 또는 직접 설계)뿐이고,
// pH·기온·해수온·Ω는 엔진이 계산한 종속 변수라 직접 바꾸는 조작은 두지 않는다.
// 모든 값은 연평균이다(2차 개편: 계절 선택기·농도 고정 모드·연도 점프 버튼 제거).
//
// 궤적은 미리 계산한다: 시나리오가 바뀔 때만 EarthSystem.run을 돌려 연도별 배열을 만들고,
// 재생은 그 배열을 인덱싱만 한다(연도 사이는 선형 보간). 렌더 루프 안에서 엔진을 돌리지 않는다.
const sceneFuture = sceneFor('future'); // 이 화면을 열었을 때만 실제로 만듦 (common.js sceneFor)
// 자연만 있는 지구: 같은 엔진을 배출 0으로 돌린 지구. 예전처럼 화면을 반으로 나누지 않고(피드백: "변하는 게 없는
// 죽은 공간") 토글로 바꿔 본다. 씬은 토글을 처음 켤 때 만든다(ensureSceneBuilt) - 대부분은 켜 보지 않는다.
const sceneNature = { dormant: true, state: { nature: true } };   // 도시 구역의 인공물을 숨김 (common.js applyState)

const TL_START = 1750, TL_END = 2200;
const FUT = {
  preset: 'ssp245',       // 인간활동 지구의 배출 시나리오 (ssp245 | ssp126 | ssp119 | custom)
  levers: { ...EarthSystem.LEVER_NOW },   // 직접 설계의 2050년 목표값
  year: 2023,             // 재생 위치 (소수 가능 - 연도 사이 보간)
  playing: false,
  speed: 10,              // 년/초
  human: null,            // EarthSystem.run 결과 배열
  nature: null,
  showNature: false,      // 3D에 자연 지구를 보고 있는가
  dirty: true,            // 다음 0.2초 틱에서 화면·3D를 다시 그릴지
};

function computeNature() {
  FUT.nature = EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: EarthSystem.natureEmissions });
}
function humanEmissionsFn() {
  return FUT.preset === 'custom' ? EarthSystem.leverEmissions(FUT.levers) : EarthSystem.presetEmissions(FUT.preset);
}
function computeHuman() {
  FUT.human = EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: humanEmissionsFn() });
}

// 연도 사이 선형 보간. 엔진 배열의 year=y 원소는 "y년 한 해를 적분한 뒤"의 상태다.
const SAMPLE_KEYS = ['ppm', 'T', 'sst', 'pH', 'omega', 'co2aq', 'hco3', 'co3', 'dic', 'bufferRel'];
function sampleAt(arr, year) {
  const f = Math.max(0, Math.min(arr.length - 1, year - arr[0].year));
  const i = Math.floor(f), j = Math.min(arr.length - 1, i + 1), w = f - i;
  const a = arr[i], b = arr[j];
  const o = { year };
  for (const k of SAMPLE_KEYS) o[k] = a[k] + (b[k] - a[k]) * w;
  o.cum = {};
  for (const k of ['atm', 'ocean', 'land', 'emitted']) o.cum[k] = a.cum[k] + (b.cum[k] - a.cum[k]) * w;
  o.fossil = a.fossil; o.luc = a.luc;
  return o;
}

// ── 그래프 ────────────────────────────────────────────────────────────
// 색은 css/theme.css 토큰(js/theme.js). 관측 = 먹색, 인간활동 지구 = 데이터 색, 자연 지구 = 회색 점선.
// y축은 하드코딩하지 않는다. 예전에 max: 600을 박아 곡선이 그래프 밖으로 나간 적이 있고,
// 시나리오마다 2200년 값이 크게 다르다. 범위는 매번 데이터에서 계산한다.
function niceRange(vals, padFrac = 0.06, minSpan = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) return { min: 0, max: 1 };
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * padFrac;
  lo -= pad; hi += pad;
  // 눈금이 1318.9 같은 값으로 끝나지 않게, 1·2·5 계열의 깔끔한 간격에 맞춰 넓힌다
  const raw = (hi - lo) / 6, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
}

// 재생 위치 세로선 - 데이터를 다시 계산하지 않고 그리기만 다시 하면 되도록 플러그인으로 둔다
const playheadPlugin = {
  id: 'playhead',
  afterDatasetsDraw(chart) {
    const x = chart.scales.x;
    if (!x || x.type !== 'linear') return;
    const px = x.getPixelForValue(FUT.year);
    if (px < chart.chartArea.left || px > chart.chartArea.right) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = Theme.color('--ctl-time');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(px, chart.chartArea.top); ctx.lineTo(px, chart.chartArea.bottom); ctx.stroke();
    ctx.restore();
  },
};

const C = Theme.color;
const NATURE = { width: 1.6, widthOn: 3.2 };   // 자연 지구를 3D로 보고 있을 때 그래프의 자연 지구 선을 굵게
const tlAxis = () => Theme.axis({ type: 'linear', min: TL_START, max: TL_END,
  ticks: { color: C('--ink-3'), font: Theme.font(), stepSize: 50, callback: v => String(v), maxTicksLimit: 10 } });
const lineDs = (label, color, extra = {}) => ({ label, data: [], borderColor: color, backgroundColor: color,
  borderWidth: 2.2, pointRadius: 0, tension: 0, ...extra });
const natureDs = (label, extra = {}) => lineDs(label, C('--data-nature'), { borderDash: [5, 4], borderWidth: NATURE.width, ...extra });

function tlChart(id, datasets, scales) {
  return new Chart(document.getElementById(id), {
    type: 'line', data: { datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: { x: tlAxis(), ...scales }, plugins: { legend: Theme.legend() } },
    plugins: [playheadPlugin],
  });
}
// 관측 CO2는 두 자료를 잇는다: 1750~1978은 얼음 코어 기반 재구성(CMIP6 역사 농도), 1979~는 NOAA 지구 평균.
// 이음매(1978→1979)의 차이는 1.84 ppm으로 그해 증가량과 같은 크기다(겹치는 1979~2014 두 자료 차이 평균 −0.03 ppm).
const toPoints = (d, key) => d[key].map((v, i) => ({ x: d.startYear + i, y: v }));
const cmip6Points = toPoints(EARTH_DATA.co2Cmip6, 'ppm');
const obsCo2Points = toPoints(EARTH_DATA.co2Noaa, 'ppm');
const futChartCo2 = tlChart('futChartCo2', [
  lineDs('인간활동 지구', C('--data-co2')),
  natureDs('자연만 있는 지구'),
  { label: '얼음 코어 기반 재구성 (CMIP6)', data: cmip6Points, borderWidth: 1.5, pointRadius: 0, borderColor: C('--data-obs'), backgroundColor: C('--data-obs') },
  { label: '관측 (NOAA 지구 평균)', data: obsCo2Points, showLine: false, pointRadius: 1.8, borderColor: C('--data-obs'), backgroundColor: C('--data-obs') },
], { y: Theme.axis({ title: 'ppm' }) });
const futChartT = tlChart('futChartT', [
  lineDs('인간활동 지구', C('--data-temp')),
  natureDs('자연만 있는 지구'),
], { y: Theme.axis({ title: '°C' }) });
const futChartPh = tlChart('futChartPh', [
  lineDs('pH', C('--data-ph'), { yAxisID: 'y' }),
  natureDs('pH (자연)', { yAxisID: 'y' }),
  lineDs('Ω', C('--data-omega'), { yAxisID: 'y1' }),
  lineDs('Ω = 1 (골격 용해 시작)', Theme.alpha('--data-temp', 0.8), { yAxisID: 'y1', borderDash: [2, 3], borderWidth: 1.2 }),
], { y: Theme.axis({ title: 'pH' }), y1: Theme.axis({ title: 'Ω', position: 'right', grid: { drawOnChartArea: false } }) });
const NATURE_DS = [[futChartCo2, 1], [futChartT, 1], [futChartPh, 1]];

// 누적 막대: 재생 연도까지 내보낸 탄소가 대기 / 바다 / 토양·식생에 얼마씩 있는가 (팝오버 "탄소는 어디로?")
const SINK_PARTS = [
  { key: 'atm', label: '대기에 남음', color: C('--data-co2') },
  { key: 'ocean', label: '바다가 흡수', color: C('--data-ph') },
  { key: 'land', label: '토양·식생이 흡수', color: C('--data-land') },
];
const futChartSink = new Chart(document.getElementById('futChartSink'), {
  type: 'bar',
  data: { labels: ['인간활동 지구'], datasets: SINK_PARTS.map(p => ({ label: p.label, data: [0], backgroundColor: p.color, barThickness: 34 })) },
  options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
    scales: { x: Theme.axis({ stacked: true, title: 'GtC (탄소 10억 톤)' }),
              y: Theme.axis({ stacked: true, grid: { display: false } }) },
    plugins: { legend: Theme.legend() } },
});

const toXY = (arr, key) => arr.map(o => ({ x: o.year, y: o[key] }));
// 궤적이 바뀌었을 때만 부른다 (선 데이터와 축 범위). 재생 중에는 세로선만 다시 그린다.
function refreshCharts() {
  const H = FUT.human, N = FUT.nature;
  futChartCo2.data.datasets[0].data = toXY(H, 'ppm');
  futChartCo2.data.datasets[1].data = toXY(N, 'ppm');
  Object.assign(futChartCo2.options.scales.y, niceRange([...H.map(o => o.ppm), 278, ...EARTH_DATA.co2Cmip6.ppm, ...EARTH_DATA.co2Noaa.ppm], 0.05, 40));
  futChartT.data.datasets[0].data = toXY(H, 'T');
  futChartT.data.datasets[1].data = toXY(N, 'T');
  Object.assign(futChartT.options.scales.y, niceRange([...H.map(o => o.T), 0], 0.06, 0.5));
  futChartPh.data.datasets[0].data = toXY(H, 'pH');
  futChartPh.data.datasets[1].data = toXY(N, 'pH');
  futChartPh.data.datasets[2].data = toXY(H, 'omega');
  futChartPh.data.datasets[3].data = [{ x: TL_START, y: 1 }, { x: TL_END, y: 1 }];
  Object.assign(futChartPh.options.scales.y, niceRange([...H.map(o => o.pH), ...N.map(o => o.pH)], 0.06, 0.1));
  Object.assign(futChartPh.options.scales.y1, niceRange([...H.map(o => o.omega), ...N.map(o => o.omega), 1], 0.06, 0.5));
  futChartCo2.update('none'); futChartT.update('none'); futChartPh.update('none');
  // 막대 축은 궤적 전체의 최대 누적에 고정해, 재생하면서 막대가 자라는 게 보이게 한다
  let lo = 0, hi = 0;
  for (const o of H) for (const p of SINK_PARTS) { lo = Math.min(lo, o.cum[p.key]); }
  for (const o of H) hi = Math.max(hi, o.cum.atm + o.cum.ocean + o.cum.land);
  const r = niceRange([lo, hi], 0.04, 10);
  futChartSink.options.scales.x.min = lo < 0 ? r.min : 0;   // 흡수가 음수(방출)인 경우만 0 왼쪽을 연다
  futChartSink.options.scales.x.max = r.max;
}

// ── 탄산 화학종 분포 (팝오버 "바다 속 탄소") ──────────────────────────────
// pH 숫자 하나로는 "평형이 어느 쪽으로 이동했는지"가 안 보이므로 화학종 비율을 그대로 그린다.
// CO2가 늘면 CO3^2-가 HCO3-로 바뀌는(CO2 + CO3^2- + H2O → 2HCO3-) 이동이 막대 경계로 드러난다.
// 값은 재생 연도의 엔진 값(표층 바다의 DIC에서 푼 co2aq/hco3/co3)이고, 기준은 1750년이다.
const SPECIES = [
  { key: 'co2aq', name: 'CO₂(aq)', color: C('--data-co2'), digits: 1 },
  { key: 'hco3', name: 'HCO₃⁻', color: C('--data-ph'), digits: 0 },
  { key: 'co3', name: 'CO₃²⁻', color: C('--data-omega'), digits: 0, note: ' · Ω와 직결' },
];

function buildSpecBar(el) {
  el.innerHTML = '';
  return SPECIES.map(sp => {
    const seg = document.createElement('div');
    seg.className = 'spec-seg ' + sp.key;
    seg.style.background = sp.color;
    seg.title = sp.name;
    el.appendChild(seg);
    return seg;
  });
}
// 막대 안 글자는 칸이 충분히 넓을 때만 넣는다 (CO2(aq)는 1 % 안팎이라 표에서 읽는다)
function fillSpecBar(segs, s) {
  SPECIES.forEach((sp, i) => {
    const pct = 100 * s[sp.key] / s.dic;
    segs[i].style.width = pct + '%';
    segs[i].textContent = pct >= 9 ? `${sp.name} ${pct.toFixed(1)}%` : '';
  });
}
const specSegsRef = buildSpecBar(document.getElementById('specBarRef'));
const specSegsNow = buildSpecBar(document.getElementById('specBarNow'));

const specCells = {};
const specBody = document.getElementById('specTableBody');
for (const sp of [...SPECIES, { key: 'dic', name: 'DIC (합계)', digits: 0 }]) {
  const tr = document.createElement('tr');
  if (sp.key === 'dic') tr.className = 'total';
  const sw = sp.color ? `<span class="swatch" style="background:${sp.color}"></span>` : '';
  tr.innerHTML = `<td>${sw}${sp.name}${sp.note ? `<span class="spec-note">${sp.note}</span>` : ''}</td><td></td><td></td><td></td>`;
  specBody.appendChild(tr);
  specCells[sp.key] = { pct: tr.cells[1], conc: tr.cells[2], delta: tr.cells[3], digits: sp.digits };
}

const UMOL = 1e6;   // mol/kg -> µmol/kg
const $ = id => document.getElementById(id);   // 이 탭 안에서만 쓰는 짧은 이름 (다른 스크립트에 $ 없음)
function updateSpeciation(s, ref) {
  $('specBarYear').textContent = Math.round(s.year);
  $('specBarCo2').textContent = s.ppm.toFixed(0);
  $('specRefPpm').textContent = ref.ppm.toFixed(0);
  fillSpecBar(specSegsRef, ref);
  fillSpecBar(specSegsNow, s);
  for (const key in specCells) {
    const c = specCells[key];
    const v = s[key] * UMOL, v0 = ref[key] * UMOL, d = v - v0;
    c.pct.textContent = (100 * s[key] / s.dic).toFixed(2) + ' %';
    c.conc.textContent = v.toFixed(c.digits);
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    c.delta.textContent = `${sign}${Math.abs(d).toFixed(c.digits)} (${sign}${Math.abs(100 * d / v0).toFixed(0)} %)`;
  }
  // 바다의 완충 능력(1750 = 100 %) - 예전 결과 카드에서 옮김
  $('bufferVal').textContent = (100 * s.bufferRel).toFixed(0) + ' %';
}

function updateSink(h) {
  $('sinkYear').textContent = Math.round(h.year);
  SINK_PARTS.forEach((p, i) => { futChartSink.data.datasets[i].data = [h.cum[p.key]]; });
  futChartSink.update('none');
  const tot = h.cum.atm + h.cum.ocean + h.cum.land;
  const pct = k => tot > 1 ? ` ${(100 * h.cum[k] / tot).toFixed(0)} %` : '';
  $('sinkNote').textContent = tot > 1
    ? `누적 배출 ${tot.toFixed(0)} GtC = 대기${pct('atm')} · 바다${pct('ocean')} · 토양·식생${pct('land')}`
      + ' (토지이용 변화로 숲에서 나간 탄소도 배출에 포함)'
    : '아직 배출된 탄소가 거의 없습니다.';
}

// ── 보조 정보 팝오버 ───────────────────────────────────────────────────
// 그래프 열 위에 뜨고 배치를 밀지 않는다(스크롤이 생기면 안 된다). 한 번에 하나만.
function setPopover(id) {
  document.querySelectorAll('#futCharts .fut-pop').forEach(p => { p.hidden = p.id !== id; });
  document.querySelectorAll('#futCharts .fut-pop-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pop === id)));
  if (id) { futChartSink.resize(); renderFuture(); }
}
$('futCharts').addEventListener('click', e => {
  const open = e.target.closest('.fut-pop-btn'), close = e.target.closest('.fut-pop-close');
  if (open) setPopover(open.getAttribute('aria-pressed') === 'true' ? null : open.dataset.pop);
  else if (close) setPopover(null);
});

// ── 기록 서랍 ─────────────────────────────────────────────────────────
// 프로그램 전체의 공통 측정 요소 4개. 열 이름(co2_ppm, air_temp, water_temp, ph)은
// 직접 실험 탭과 1인칭 야장도 나중에 이 이름으로 맞출 예정이라 그대로 쓴다. 값은 모두 연평균.
// 기온은 엔진이 편차(T)만 내므로 산업화 이전 전 지구 평균 지표 기온 AIR_T0에 더한다.
// AIR_T0 = 14 °C는 대략치다 (NOAA가 밝힌 20세기 전 지구 평균 13.9 °C를 반올림한 값 - 원문 미확인, 등록부 model_air_temp).
const AIR_T0 = 14.0;
const MEAS = [
  { key: 'co2_ppm', digits: 1 }, { key: 'air_temp', digits: 2 }, { key: 'water_temp', digits: 2 }, { key: 'ph', digits: 3 },
];
const observe = s => ({ co2_ppm: s.ppm, air_temp: AIR_T0 + s.T, water_temp: s.sst, ph: s.pH });
const measRecords = [];
function setRecCount() {
  $('recCount').textContent = measRecords.length;
  $('recCount2').textContent = measRecords.length;
}
// 지금 연도 · 시나리오(또는 직접 설계) · 보고 있는 지구 · 측정 요소 4개를 한 줄로 저장
function addRecord() {
  const nature = FUT.showNature;
  const o = observe(sampleAt(nature ? FUT.nature : FUT.human, FUT.year));
  const rec = { year: Math.round(FUT.year), scenario: nature ? '배출 0' : humanLabel(), earth: nature ? '자연' : '인간활동' };
  for (const m of MEAS) rec[m.key] = Number(o[m.key].toFixed(m.digits));
  measRecords.push(rec);
  const tr = document.createElement('tr');
  tr.innerHTML = [rec.year, rec.scenario, rec.earth, ...MEAS.map(m => rec[m.key].toFixed(m.digits))]
    .map(v => `<td>${v}</td>`).join('');
  $('recLog').appendChild(tr);
  setRecCount();
}
function setDrawer(open) {
  $('recDrawer').hidden = !open;
  $('recOpen').setAttribute('aria-expanded', String(open));
  if (open) $('recClose').focus();
}
$('recAdd').addEventListener('click', addRecord);
$('recOpen').addEventListener('click', () => setDrawer($('recDrawer').hidden));
$('recClose').addEventListener('click', () => { setDrawer(false); $('recOpen').focus(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('recDrawer').hidden && activeTab === 'future') { setDrawer(false); $('recOpen').focus(); }
});
$('recClear').addEventListener('click', () => {
  measRecords.length = 0;
  $('recLog').innerHTML = '';
  setRecCount();
});
$('recCsv').addEventListener('click', () => {
  if (!measRecords.length) return;
  const cols = ['year', 'scenario', 'earth', ...MEAS.map(m => m.key)];
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...measRecords.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  // BOM: 엑셀에서 한글이 깨지지 않게 (직접 실험 탭 CSV와 같은 방식, downloadBlob은 js/xlsx-lite.js)
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), '미래예측_측정기록.csv');
});

// ── 3D ────────────────────────────────────────────────────────────────
// 기존 매핑 상수(CO2_MIN/MAX, PH_MIN/MAX)를 그대로 쓴다. CO2_MAX(1000)는 1인칭과 공유하므로
// 바꾸지 않는다 - 1000 ppm을 넘는 구간은 3D 효과만 포화된다(그래프는 그대로 그린다).
// 빙하는 기온 편차 T로 줄인다 (T = 5 °C에서 최대 축소).
// noTint: 뚜껑·안개가 노랗게 물드는 효과를 끈다(피드백 2번 - CO2는 무색이다). 대체 표현은 2차 개편 D 단계.
const ICE_MELT_T = 5;
function apply3D(S, s) {
  if (S.dormant) return;
  S.state.co2 = s.ppm;
  S.state.noTint = true;
  S.state.ph = s.pH;
  S.state.iceMelt = Math.min(1, Math.max(0, s.T / ICE_MELT_T));
  if (S === sceneFuture) applyLevers3D(S, s);
  else S.state.treeFrac = 1;            // 자연 지구: 벌채가 없으니 나무가 다 있다
  applyState(S);
}

// 레버 → 3D. 레버 목표값이 아니라 재생 연도의 실제 레버 값(선형 전환 중의 값)을 보여 준다.
// 직접 설계가 아닌 시나리오는 전력 구성 같은 세부가 정해져 있지 않으므로, 연기는 그해 화석 배출의
// 2023년 대비 비율로, 나무는 그해 토지이용 배출로 정하고 나머지는 2023년 값으로 둔다.
// 2023년까지(역사 구간)도 같은 규칙이다.
const ES = EarthSystem;
// 산림: 토지이용 배출 +L2023(벌채 지속) → 나무 60 %, 0(벌채 중단) → 약 83 %, −1(대규모 조림) → 100 %
const treeFracFromLuc = luc => Math.min(1, Math.max(0.3, 0.6 + 0.4 * (ES.L2023 - luc) / (ES.L2023 + 1)));
function applyLevers3D(S, s) {
  const custom = FUT.preset === 'custom' && s.year >= ES.LEVER_START;
  const l = custom ? ES.leversAt(FUT.levers, s.year) : ES.LEVER_NOW;
  const fossilNow = s.fossil != null ? s.fossil : 0;
  S.state.fossil = custom ? 100 * l.fossilShare
    : Math.min(100, 100 * ES.LEVER_NOW.fossilShare * Math.max(0, fossilNow / ES.E2023));
  S.state.ev = 100 * l.ev;
  S.state.carbonRemoval = 100 * l.ccs / ES.LEVER_RANGE.ccs[1];
  S.state.nuclear = l.nuclearShare;
  S.state.renew = l.renewShare;
  S.state.treeFrac = treeFracFromLuc(custom ? l.forest : (s.luc != null ? s.luc : ES.L2023));
}

// ── 시나리오 ───────────────────────────────────────────────────────────
const PRESET_DESC = {
  ssp245: '현재 정책이 유지될 때의 경로에 가장 가까운 SSP. 배출이 2050년 무렵까지 지금 수준에 머물다 천천히 줄어듭니다.',
  ssp126: '기온 상승을 2 °C 아래로 억제하는 경로. 화석 배출이 빠르게 줄고 2070년대부터 순배출이 음수가 됩니다.',
  ssp119: '1.5 °C 억제, 세기 중반 탄소중립 경로. 2050년 무렵 순배출 0, 그 뒤로는 대기에서 탄소를 거둬들입니다.',
  custom: '직접 설계: 레버로 정한 2050년의 사회를 따릅니다.',
};
const PRESET_KO = { ...Object.fromEntries(Object.entries(ES.PRESETS).map(([k, v]) => [k, v.ko])), custom: '직접 설계' };
const humanLabel = () => PRESET_KO[FUT.preset];

// ── 자연 지구 토글 ────────────────────────────────────────────────────
// 3D는 씬 하나만 그린다(common.js animate가 bundles[activeTab]을 그림). 토글하면 0.3초 안팎으로 종이색 막이
// 덮였다 걷히며 씬을 바꾼다. 움직임 줄이기 설정이면 바로 바꾼다.
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FADE_MS = 150;
function updateBadge() {
  $('earthBadge').textContent = FUT.showNature ? '자연만 있는 지구' : `인간활동 지구 · ${humanLabel()}`;
}
function setNatureView(on) {
  FUT.showNature = on;
  $('natureToggle').setAttribute('aria-pressed', String(on));
  // 같은 정보를 3D와 그래프가 같은 색으로 가리키게: 자연 지구를 보는 동안 그래프의 자연 지구 선을 굵게
  for (const [chart, i] of NATURE_DS) chart.data.datasets[i].borderWidth = on ? NATURE.widthOn : NATURE.width;
  [futChartCo2, futChartT, futChartPh].forEach(c => c.update('none'));
  const swap = () => {
    if (on) { ensureSceneBuilt(sceneNature); apply3D(sceneNature, sampleAt(FUT.nature, FUT.year)); }
    bundles.future = on ? sceneNature : sceneFuture;
    updateBadge();
  };
  if (reduceMotion()) { swap(); return; }
  const fade = $('glFade');
  fade.classList.add('on');
  setTimeout(() => { swap(); fade.classList.remove('on'); }, FADE_MS);
}
$('natureToggle').addEventListener('click', () => setNatureView(!FUT.showNature));

// 왼쪽 패널: 시나리오 목록 ↔ 직접 설계(레버) 패널. 레버 패널에서 '시나리오로'를 누르면 목록으로 돌아가되
// 궤적은 직접 설계 그대로 둔다(다른 시나리오를 고를 때 바뀐다).
function showLeverPanel(on) {
  $('fcScenarioView').hidden = on;
  $('fcLevers').hidden = !on;
}
function setPreset(name) {
  FUT.preset = name;
  document.querySelectorAll('#futureControls [data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
  $('fcPresetDesc').textContent = PRESET_DESC[name];
  if (name === 'custom') showLeverPanel(true);
  updateBadge();
  recomputeFuture();
}
$('futureControls').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (b) setPreset(b.dataset.preset);
});
$('fcBack').addEventListener('click', () => { showLeverPanel(false); $('fcCustomBtn').focus(); });

// 레버. 전력 구성은 화석 | 원자력 | 재생 세 구간이 한 막대이고, 경계 손잡이 두 개(mixB1 = 화석, mixB2 = 화석 + 원자력,
// 단위 %)를 끌어 바꾼다. 경계 두 개로 나누므로 세 비중의 합은 언제나 100 %다.
const lvEv = $('lvEv'), lvCcs = $('lvCcs'), lvOther = $('lvOther'), lvForest = $('lvForest');
// 산림은 step="any"로 둔다. 눈금 간격이 있으면 지금 값(L2023 = 1.2952)이 1.30으로 끌려가서,
// 다른 레버만 만져도 '벌채 지속' 배출이 슬그머니 바뀐다.
lvForest.min = ES.LEVER_RANGE.forest[0];
lvForest.max = ES.LEVER_RANGE.forest[1];
const pct = v => (100 * v).toFixed(0) + ' %';
const mix = { b1: 61, b2: 70 };
function leversToInputs(L) {
  mix.b1 = Math.round(100 * L.fossilShare);
  mix.b2 = Math.round(100 * (L.fossilShare + L.nuclearShare));
  lvEv.value = Math.round(100 * L.ev);
  lvCcs.value = L.ccs;
  lvOther.value = Math.round(100 * L.otherCut);
  lvForest.value = L.forest;
}
function inputsToLevers() {
  FUT.levers = {
    // 정수 %에서 나눠야 0.70 − 0.61 = 0.08999… 같은 부동소수 찌꺼기가 생기지 않는다
    fossilShare: mix.b1 / 100, nuclearShare: (mix.b2 - mix.b1) / 100, renewShare: (100 - mix.b2) / 100,
    ev: Number(lvEv.value) / 100, ccs: Number(lvCcs.value),
    otherCut: Number(lvOther.value) / 100, forest: Number(lvForest.value),
  };
}
// 경계 손잡이: 끌기(마우스·터치·펜) + 키보드(←→ 1 %, PageUp/PageDown 10 %, Home/End). 두 경계는 서로 넘지 못한다.
function setMixBoundary(which, v) {
  v = Math.round(Math.max(0, Math.min(100, v)));
  if (which === 1) mix.b1 = Math.min(v, mix.b2); else mix.b2 = Math.max(v, mix.b1);
  onLeverInput();
}
for (const [id, which] of [['mixH1', 1], ['mixH2', 2]]) {
  const h = $(id);
  h.addEventListener('pointerdown', e => {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    h.focus();
    const bar = $('mixCtl').querySelector('.mix-bar').getBoundingClientRect();
    const move = ev => setMixBoundary(which, 100 * (ev.clientX - bar.left) / bar.width);
    const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
  h.addEventListener('keydown', e => {
    const cur = which === 1 ? mix.b1 : mix.b2;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (step != null) setMixBoundary(which, cur + step);
    else if (e.key === 'Home') setMixBoundary(which, 0);
    else if (e.key === 'End') setMixBoundary(which, 100);
    else return;
    e.preventDefault();
  });
}
function forestLabel(v) {
  if (v > ES.L2023 - 0.03) return `${v.toFixed(2)} GtC/년 (벌채 지속)`;
  if (Math.abs(v) < 0.03) return '0 (벌채 중단)';
  return v > 0 ? `${v.toFixed(2)} GtC/년 (벌채 줄임)` : `${v.toFixed(2)} GtC/년 (조림으로 흡수)`;
}
function showLeverValues() {
  const L = FUT.levers, N = ES.LEVER_NOW;
  // 막대는 비율만 보여 주고 숫자는 아래 범례(아이콘 · 이름 · 값)에만 쓴다 (같은 값을 두 번 쓰지 않는다)
  for (const [id, v] of [['mixFossil', L.fossilShare], ['mixNuclear', L.nuclearShare], ['mixRenew', L.renewShare]]) {
    $(id).style.width = (100 * v) + '%';
    $(id + 'Val').textContent = pct(v);
  }
  for (const [id, v, txt] of [['mixH1', mix.b1, `화석 ${mix.b1} %`], ['mixH2', mix.b2, `화석+원자력 ${mix.b2} % (재생 ${100 - mix.b2} %)`]]) {
    $(id).style.left = v + '%';
    $(id).setAttribute('aria-valuenow', v);
    $(id).setAttribute('aria-valuetext', txt);
  }
  $('lvEvVal').innerHTML = `<b>${pct(L.ev)}</b> (지금 ${pct(N.ev)})`;
  $('lvCcsVal').innerHTML = `<b>${L.ccs.toFixed(1)}</b> GtC/년`;
  $('lvOtherVal').innerHTML = `<b>${pct(L.otherCut)}</b>`;
  $('lvForestVal').textContent = forestLabel(L.forest);
  // 레버 식의 결과를 숫자로: 2050년(목표가 다 이뤄진 해)의 배출이 2023년의 몇 %인가
  const e = ES.leverEmissions(L)(ES.LEVER_TARGET), e23 = ES.E2023 + ES.L2023, tot = e.fossil + e.luc;
  $('lvResult').innerHTML = `2050년 배출 <b>${tot.toFixed(2)} GtC/년</b> (2023년의 <b>${(100 * tot / e23).toFixed(0)} %</b>)`;
  $('lvResult').title = `화석 ${e.fossil.toFixed(2)} · 토지이용 ${e.luc.toFixed(2)} GtC/년 (2023년 합계 ${e23.toFixed(2)})`;
}
// 레버를 움직이는 동안 궤적을 한 프레임에 한 번만 다시 계산한다 (엔진 1회 ≈ 수 ms)
let leverPending = false;
function onLeverInput() {
  inputsToLevers();
  showLeverValues();
  if (leverPending) return;
  leverPending = true;
  requestAnimationFrame(() => { leverPending = false; recomputeFuture(); });
}
[lvEv, lvCcs, lvOther, lvForest].forEach(el => el.addEventListener('input', onLeverInput));
$('lvReset').addEventListener('click', () => {
  FUT.levers = { ...ES.LEVER_NOW };
  leversToInputs(FUT.levers);
  showLeverValues();
  recomputeFuture();
});
leversToInputs(FUT.levers);
showLeverValues();

// ── 재생 ──────────────────────────────────────────────────────────────
const tlPlay = $('tlPlay'), tlScrub = $('tlScrub'), tlYearEl = $('tlYear');
function setYear(y) {
  FUT.year = Math.max(TL_START, Math.min(TL_END, y));
  FUT.dirty = true;
}
function setPlaying(on) {
  FUT.playing = on;
  if (on && FUT.year >= TL_END) FUT.year = TL_START;   // 끝에서 누르면 처음부터
  tlPlay.setAttribute('aria-pressed', String(on));
  $('tlPlayIcon').innerHTML = Icons.svg(on ? 'pause' : 'play');
  $('tlPlayLabel').textContent = on ? '일시정지' : '재생';
  lastTick = performance.now();
}
tlPlay.addEventListener('click', () => setPlaying(!FUT.playing));
tlScrub.addEventListener('input', () => { setPlaying(false); setYear(Number(tlScrub.value)); renderFuture(); });
$('tlSpeed').addEventListener('change', e => { FUT.speed = Number(e.target.value); });

// 화면(팝오버·세로선)을 재생 연도에 맞춘다. 3D는 0.2초 틱에서만 바꾼다.
function renderFuture() {
  const h = sampleAt(FUT.human, FUT.year);
  tlYearEl.textContent = Math.round(FUT.year);
  if (Number(tlScrub.value) !== Math.round(FUT.year)) tlScrub.value = Math.round(FUT.year);
  if (!$('popSink').hidden) updateSink(h);
  if (!$('popSpec').hidden) updateSpeciation(h, FUT.human[0]);
  futChartCo2.draw(); futChartT.draw(); futChartPh.draw();
  return h;
}

// 궤적을 다시 계산한다 (시나리오가 바뀔 때). 재생 위치는 그대로 둔다.
function recomputeFuture() {
  computeHuman();
  refreshCharts();
  FUT.dirty = true;
  renderFuture();
}

// 0.2초 틱: 재생 위치를 진행하고, 바뀐 게 있을 때만 화면·3D를 갱신한다.
// 렌더 루프(매 프레임)에서 하지 않는 이유: 화면 갱신이 무겁지 않아도 3D 재질·차트 갱신을
// 60번/초 할 필요가 없고, 헤드리스에서는 rAF가 4 FPS라 프레임 의존 진행은 믿을 수 없다.
let lastTick = performance.now();
const FUT_TICK_MS = 200;
setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  // activeTab은 맨 뒤에 읽히는 main.js가 선언한다. 그 사이 스크립트 로딩이 0.2초를 넘으면 이 틱이 먼저 돌아
  // "activeTab is not defined"가 났다(헤드리스에서 재현). 아직 선언 전이면 건너뛴다.
  if (typeof activeTab === 'undefined' || activeTab !== 'future') return;
  if (FUT.playing) {
    setYear(FUT.year + FUT.speed * dt);
    if (FUT.year >= TL_END) setPlaying(false);
  }
  if (!FUT.dirty) return;
  FUT.dirty = false;
  const h = renderFuture();
  apply3D(sceneFuture, h);
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}, FUT_TICK_MS);

// 탭을 열 때 main.js가 부른다
function activateFutureTab() {
  [futChartCo2, futChartT, futChartPh, futChartSink].forEach(c => c.resize());
  FUT.dirty = true;
  apply3D(sceneFuture, renderFuture());
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}

computeNature();
setPreset(FUT.preset);   // 궤적 계산 + 버튼 표시
