// ================= 미래 예측 탭 - 1750~2200 타임라인 =================
// 예전엔 CO2를 슬라이더로 넣고 pH·기온을 그 자리의 평형값으로 냈다. 이제 CO2는 배출을 쌓아
// 계산한 '결과'다(js/earth-system.js). 바꿀 수 있는 것은 배출(시나리오)과 관측 계절뿐이고,
// pH·기온·해수온·Ω는 엔진이 계산한 종속 변수라 직접 바꾸는 조작은 두지 않는다.
//
// 궤적은 미리 계산한다: 시나리오가 바뀔 때만 EarthSystem.run을 돌려 연도별 배열을 만들고,
// 재생은 그 배열을 인덱싱만 한다(연도 사이는 선형 보간). 렌더 루프 안에서 엔진을 돌리지 않는다.
const sceneFuture = sceneFor('future'); // 이 화면을 열었을 때만 실제로 만듦 (common.js sceneFor)
// 두 개의 지구: 같은 엔진을 "자연만(배출 0)"과 "인간활동"으로 각각 돌려 1750년부터 갈라지게 한다.
// 왼쪽 = 자연, 오른쪽 = 인간활동 (common.js animate가 화면을 반으로 나눠 그린다)
const sceneNature = sceneFor('future');
sceneNature.state.nature = true;        // 도시 구역의 건물·자동차·공장·도로·포집 타워를 숨김
splitView = { tab: 'future', left: sceneNature, right: sceneFuture };

const TL_START = 1750, TL_END = 2200;
const FUT = {
  preset: 'bau',          // 인간활동 지구의 배출 시나리오 (bau | paris | nz2050 | custom)
  levers: { ...EarthSystem.LEVER_NOW },   // 직접 설계의 2050년 목표값
  mode: 'scenario',       // scenario = 배출 시나리오 | fixed = 2024년부터 대기 CO2 고정
  fixedPpm: 560,
  season: 'spring',       // 관측 계절 - 재생 중 자동으로 바뀌지 않는다 (10년/초에서 깜빡이면 의미가 없음)
  year: 2023,             // 재생 위치 (소수 가능 - 연도 사이 보간)
  playing: false,
  speed: 10,              // 년/초
  human: null,            // EarthSystem.run 결과 배열
  nature: null,
  dirty: true,            // 다음 0.2초 틱에서 화면·3D를 다시 그릴지
};

function computeNature() {
  FUT.nature = EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: EarthSystem.natureEmissions });
}
function humanEmissionsFn() {
  return FUT.preset === 'custom' ? EarthSystem.leverEmissions(FUT.levers) : EarthSystem.presetEmissions(FUT.preset);
}
function computeHuman() {
  FUT.human = FUT.mode === 'fixed'
    ? EarthSystem.run({ fromYear: TL_START, toYear: TL_END, fixedPpm: FUT.fixedPpm })
    : EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: humanEmissionsFn() });
}

// 연도 사이 선형 보간. 엔진 배열의 year=y 원소는 "y년 한 해를 적분한 뒤"의 상태다.
const SAMPLE_KEYS = ['ppm', 'T', 'sst', 'pH', 'omega', 'co2aq', 'hco3', 'co3', 'dic', 'bufferRel'];
function sampleAt(arr, year) {
  const f = Math.max(0, Math.min(arr.length - 1, year - arr[0].year));
  const i = Math.floor(f), j = Math.min(arr.length - 1, i + 1), w = f - i;
  const a = arr[i], b = arr[j];
  const o = { year, fixed: a.fixed };
  for (const k of SAMPLE_KEYS) o[k] = a[k] + (b[k] - a[k]) * w;
  o.cum = {};
  for (const k of ['atm', 'ocean', 'land', 'emitted']) o.cum[k] = a.cum[k] + (b.cum[k] - a.cum[k]) * w;
  o.fossil = a.fossil; o.luc = a.luc;
  return o;
}

// ── 그래프 ────────────────────────────────────────────────────────────
// y축은 하드코딩하지 않는다. 예전에 max: 600을 박아 곡선이 그래프 밖으로 나간 적이 있고,
// 현재 추세는 2200년 1269 ppm까지 간다. 범위는 매번 데이터에서 계산한다.
function niceRange(vals, padFrac = 0.06, minSpan = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) return { min: 0, max: 1 };
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * padFrac;
  lo -= pad; hi += pad;
  // 눈금이 1318.9 같은 값으로 끝나지 않게, 1·2·5 계열의 깔끔한 간격에 맞춰 넓힌다
  const raw = (hi - lo) / 8, mag = 10 ** Math.floor(Math.log10(raw));
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
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, chart.chartArea.top); ctx.lineTo(px, chart.chartArea.bottom); ctx.stroke();
    ctx.restore();
  },
};

const tlAxis = () => ({ type: 'linear', min: TL_START, max: TL_END,
  ticks: { color: textColor, font: { size: 9 }, stepSize: 50, callback: v => String(v) }, grid: { color: gridColor } });
const yAxis = (label, extra = {}) => ({ title: { display: true, text: label, color: textColor, font: { size: 9 } },
  ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, ...extra });
const tlLegend = { display: true, labels: { color: '#9198a3', font: { size: 9.5 }, boxWidth: 14, boxHeight: 2 } };
const lineDs = (label, color, extra = {}) => ({ label, data: [], borderColor: color, backgroundColor: color,
  borderWidth: 1.8, pointRadius: 0, tension: 0, ...extra });
const NATURE_STYLE = { borderDash: [5, 4], borderWidth: 1.4 };
const NATURE_COLOR = '#7d838d';

function tlChart(id, datasets, scales) {
  return new Chart(document.getElementById(id), {
    type: 'line', data: { datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: { x: tlAxis(), ...scales }, plugins: { legend: tlLegend } },
    plugins: [playheadPlugin],
  });
}
const mloPoints = EARTH_DATA.mlo.ppm.map((v, i) => ({ x: EARTH_DATA.mlo.startYear + i, y: v }));
const futChartCo2 = tlChart('futChartCo2', [
  lineDs('인간활동 지구', '#85B7EB'),
  lineDs('자연만 있는 지구', NATURE_COLOR, NATURE_STYLE),
  { label: '마우나로아 관측', data: mloPoints, showLine: false, pointRadius: 1.6, borderColor: '#e7e9ec', backgroundColor: '#e7e9ec' },
], { y: yAxis('ppm') });
const futChartT = tlChart('futChartT', [
  lineDs('인간활동 지구', '#E24B4A'),
  lineDs('자연만 있는 지구', NATURE_COLOR, NATURE_STYLE),
], { y: yAxis('°C') });
const futChartPh = tlChart('futChartPh', [
  lineDs('pH (인간활동)', '#5DCAA5', { yAxisID: 'y' }),
  lineDs('pH (자연)', NATURE_COLOR, { ...NATURE_STYLE, yAxisID: 'y' }),
  lineDs('Ω (인간활동)', '#d08a2c', { yAxisID: 'y1' }),
  lineDs('Ω = 1 (골격 용해 시작)', 'rgba(226,75,74,0.8)', { yAxisID: 'y1', borderDash: [2, 3], borderWidth: 1 }),
], { y: yAxis('pH'), y1: yAxis('Ω', { position: 'right', grid: { drawOnChartArea: false } }) });

// 누적 막대: 재생 연도까지 내보낸 탄소가 대기 / 바다 / 토양·식생에 얼마씩 있는가
const SINK_PARTS = [
  { key: 'atm', label: '대기에 남음', color: '#d9a86c' },
  { key: 'ocean', label: '바다가 흡수', color: '#85B7EB' },
  { key: 'land', label: '토양·식생이 흡수', color: '#5a9c4a' },
];
const futChartSink = new Chart(document.getElementById('futChartSink'), {
  type: 'bar',
  data: { labels: ['인간활동 지구'], datasets: SINK_PARTS.map(p => ({ label: p.label, data: [0], backgroundColor: p.color, barThickness: 34 })) },
  options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
    scales: { x: { stacked: true, title: { display: true, text: 'GtC (탄소 10억 톤)', color: textColor, font: { size: 9 } },
                   ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
              y: { stacked: true, ticks: { color: textColor, font: { size: 9.5 } }, grid: { display: false } } },
    plugins: { legend: tlLegend } },
});

const toXY = (arr, key) => arr.map(o => ({ x: o.year, y: o[key] }));
// 궤적이 바뀌었을 때만 부른다 (선 데이터와 축 범위). 재생 중에는 세로선만 다시 그린다.
function refreshCharts() {
  const H = FUT.human, N = FUT.nature;
  futChartCo2.data.datasets[0].data = toXY(H, 'ppm');
  futChartCo2.data.datasets[1].data = toXY(N, 'ppm');
  Object.assign(futChartCo2.options.scales.y, niceRange([...H.map(o => o.ppm), 278, ...EARTH_DATA.mlo.ppm], 0.05, 40));
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

// ── 탄산 화학종 분포 ──────────────────────────────────────────────────
// pH 숫자 하나로는 "평형이 어느 쪽으로 이동했는지"가 안 보이므로 화학종 비율을 그대로 그린다.
// CO2가 늘면 CO3^2-가 HCO3-로 바뀌는(CO2 + CO3^2- + H2O → 2HCO3-) 이동이 막대 경계로 드러난다.
// 값은 재생 연도의 엔진 값(표층 바다의 DIC에서 푼 co2aq/hco3/co3)이고, 기준은 1750년이다.
const SPECIES = [
  { key: 'co2aq', name: 'CO₂(aq)', color: '#d08a2c', digits: 1 },
  { key: 'hco3', name: 'HCO₃⁻', color: '#85B7EB', digits: 0 },
  { key: 'co3', name: 'CO₃²⁻', color: '#5DCAA5', digits: 0, note: ' · Ω와 직결' },
];

function buildSpecBar(el) {
  el.innerHTML = '';
  return SPECIES.map(sp => {
    const seg = document.createElement('div');
    seg.className = 'spec-seg ' + sp.key;
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
  tr.innerHTML = `<td>${sw}${sp.name}${sp.note ? `<span style="color:#7d838d">${sp.note}</span>` : ''}</td><td></td><td></td><td></td>`;
  specBody.appendChild(tr);
  specCells[sp.key] = { pct: tr.cells[1], conc: tr.cells[2], delta: tr.cells[3], digits: sp.digits };
}

const UMOL = 1e6;   // mol/kg -> µmol/kg
function updateSpeciation(s, ref) {
  document.getElementById('specBarYear').textContent = Math.round(s.year);
  document.getElementById('specBarCo2').textContent = s.ppm.toFixed(0);
  document.getElementById('specRefPpm').textContent = ref.ppm.toFixed(0);
  fillSpecBar(specSegsRef, ref);
  fillSpecBar(specSegsNow, s);
  for (const key in specCells) {
    const c = specCells[key];
    const v = s[key] * UMOL, v0 = ref[key] * UMOL, d = v - v0;
    c.pct.textContent = (100 * s[key] / s.dic).toFixed(2) + ' %';
    c.conc.textContent = v.toFixed(c.digits);
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    c.delta.textContent = `${sign}${Math.abs(d).toFixed(c.digits)} (${sign}${Math.abs(100 * d / v0).toFixed(0)} %)`;
    c.delta.className = d < -1e-9 ? 'down' : (d > 1e-9 ? 'up' : '');
  }
}

// ── 결과 카드 ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);   // 이 탭 안에서만 쓰는 짧은 이름 (다른 스크립트에 $ 없음)
const fmtSigned = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
function updateCards(h) {
  $('cardsYear').textContent = Math.round(h.year);
  $('cardCo2').textContent = h.ppm.toFixed(0) + ' ppm';
  $('cardT').textContent = fmtSigned(h.T, 2) + ' °C';
  $('cardSst').textContent = h.sst.toFixed(1) + ' °C';
  $('cardPh').textContent = h.pH.toFixed(3);
  $('cardOmega').textContent = h.omega.toFixed(2);
  // Ω가 1 밑으로 내려가면 이미 만들어진 탄산칼슘 골격이 녹기 시작한다 - 색으로 경고
  $('cardOmega').style.color = h.omega < 1 ? '#E24B4A' : (h.omega < 2 ? '#d08a2c' : '');
  $('cardBuffer').textContent = (100 * h.bufferRel).toFixed(0) + ' %';
}

function updateSink(h) {
  $('sinkYear').textContent = Math.round(h.year);
  $('sinkLead').textContent = FUT.mode === 'fixed' && h.year >= 2024
    ? '농도를 유지하는 데 필요했던 배출은 어디로 갔나' : '배출된 탄소는 어디로 갔나';
  SINK_PARTS.forEach((p, i) => { futChartSink.data.datasets[i].data = [h.cum[p.key]]; });
  futChartSink.update('none');
  const tot = h.cum.atm + h.cum.ocean + h.cum.land;
  const pct = k => tot > 1 ? ` ${(100 * h.cum[k] / tot).toFixed(0)} %` : '';
  $('sinkNote').textContent = tot > 1
    ? `누적 배출 ${tot.toFixed(0)} GtC = 대기${pct('atm')} · 바다${pct('ocean')} · 토양·식생${pct('land')}`
      + ' (토지이용 변화로 숲에서 나간 탄소도 배출에 포함)'
    : '아직 배출된 탄소가 거의 없습니다.';
}

// ── 관측 계절 ───────────────────────────────────────────────────────────
// 엔진 값(연평균)에 SEASON_CLIMATE(js/earth-model.js)의 오프셋을 더해 "그 계절에 잰 값"을 만든다.
// 기온은 엔진이 편차(T)만 내므로 산업화 이전 전 지구 평균 지표 기온 AIR_T0에 더한다.
// AIR_T0 = 14 °C는 대략치다 (NOAA가 밝힌 20세기 전 지구 평균 13.9 °C를 반올림한 값).
// pH는 계절로 바꾸지 않는다 (엔진 연평균 그대로).
const AIR_T0 = 14.0;
// 나뭇잎 색: firstperson/fp-world.js SEASONS의 leaf와 같은 값 (겨울 null = 잎이 진 나무). 3단계에서 합칠 것.
const SEASON_LEAF = { spring: 0x6cae4a, summer: 0x3f7433, autumn: 0xc9772a, winter: null };
function observe(s) {
  const C = SEASON_CLIMATE[FUT.season];
  return { co2_ppm: s.ppm + C.co2, air_temp: AIR_T0 + s.T + C.temp, water_temp: s.sst + C.seaT, ph: s.pH };
}
function setSeason(name) {
  FUT.season = name;
  document.querySelectorAll('#seasonBtns [data-season]').forEach(b => b.classList.toggle('on', b.dataset.season === name));
  FUT.dirty = true;
  renderFuture();
}
$('seasonBtns').addEventListener('click', e => {
  const b = e.target.closest('[data-season]');
  if (b) setSeason(b.dataset.season);
});

// ── 측정 패널 ─────────────────────────────────────────────────────────
// 프로그램 전체의 공통 측정 요소 4개. 열 이름(co2_ppm, air_temp, water_temp, ph)은
// 직접 실험 탭과 1인칭 야장도 나중에 이 이름으로 맞출 예정이라 그대로 쓴다.
// 게이지 범위는 눈금이 아니라 막대 길이용이다 (값은 숫자로 따로 보여 준다).
const MEAS = [
  { key: 'co2_ppm', name: '대기 CO₂', unit: 'ppm', digits: 0, csvDigits: 1, min: 250, max: 1300 },
  { key: 'air_temp', name: '기온', unit: '°C', digits: 1, csvDigits: 2, min: -5, max: 35 },
  { key: 'water_temp', name: '해수온', unit: '°C', digits: 1, csvDigits: 2, min: 10, max: 30 },
  { key: 'ph', name: '해수 pH', unit: '', digits: 3, csvDigits: 3, min: 7.5, max: 8.3 },
];
const measCells = {};
{
  const grid = $('measGrid');
  for (const m of MEAS) {
    const lab = document.createElement('div');
    lab.className = 'meas-name';
    lab.innerHTML = `${m.name} <span>${m.key}</span>`;
    grid.appendChild(lab);
    measCells[m.key] = ['nature', 'human'].map(earth => {
      const cell = document.createElement('div');
      cell.className = 'meas-cell ' + earth;
      cell.innerHTML = '<div class="meas-gauge"><div class="meas-fill"></div></div><div class="meas-val"></div>';
      grid.appendChild(cell);
      return { fill: cell.querySelector('.meas-fill'), val: cell.querySelector('.meas-val') };
    });
  }
}
let lastObs = null;
function updateMeasure(n, h) {
  const obs = { nature: observe(n), human: observe(h) };
  lastObs = { year: Math.round(h.year), ...obs };
  $('measWhen').textContent = `${Math.round(h.year)}년 ${SEASON_CLIMATE[FUT.season].ko}`;
  for (const m of MEAS) {
    ['nature', 'human'].forEach((earth, i) => {
      const v = obs[earth][m.key], c = measCells[m.key][i];
      c.fill.style.width = (100 * Math.min(1, Math.max(0, (v - m.min) / (m.max - m.min)))) + '%';
      c.val.textContent = v.toFixed(m.digits) + (m.unit ? ' ' + m.unit : '');
    });
  }
}
const measRecords = [];
const EARTH_KO = { nature: '자연', human: '인간활동' };
function addRecord(earth) {
  if (!lastObs) return;
  const o = lastObs[earth];
  const rec = { year: lastObs.year, season: SEASON_CLIMATE[FUT.season].ko,
    scenario: earth === 'nature' ? '배출 0' : humanLabel(), earth: EARTH_KO[earth] };
  for (const m of MEAS) rec[m.key] = Number(o[m.key].toFixed(m.csvDigits));
  measRecords.push(rec);
  const tr = document.createElement('tr');
  tr.innerHTML = [rec.year, rec.season, rec.scenario, rec.earth, ...MEAS.map(m => rec[m.key].toFixed(m.csvDigits))]
    .map(v => `<td>${v}</td>`).join('');
  $('measLog').appendChild(tr);
  $('measCount').textContent = measRecords.length;
  tr.scrollIntoView({ block: 'nearest' });
}
document.querySelector('.meas-actions').addEventListener('click', e => {
  const b = e.target.closest('[data-rec]');
  if (b) addRecord(b.dataset.rec);
});
$('measClear').addEventListener('click', () => {
  measRecords.length = 0;
  $('measLog').innerHTML = '';
  $('measCount').textContent = 0;
});
$('measCsv').addEventListener('click', () => {
  if (!measRecords.length) return;
  const cols = ['year', 'season', 'scenario', 'earth', ...MEAS.map(m => m.key)];
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...measRecords.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  // BOM: 엑셀에서 한글이 깨지지 않게 (직접 실험 탭 CSV와 같은 방식, downloadBlob은 js/xlsx-lite.js)
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), '미래예측_측정기록.csv');
});

// ── 3D ────────────────────────────────────────────────────────────────
// 기존 매핑 상수(CO2_MIN/MAX, PH_MIN/MAX)를 그대로 쓴다. CO2_MAX(1000)는 1인칭과 공유하므로
// 바꾸지 않는다 - 1000 ppm을 넘는 구간은 3D 효과만 포화된다(그래프는 그대로 그린다).
// 빙하는 기온 편차 T로 줄인다 (T = 5 °C에서 최대 축소).
const ICE_MELT_T = 5;
function apply3D(S, s) {
  if (S.dormant) return;
  const C = SEASON_CLIMATE[FUT.season];
  S.state.co2 = s.ppm + C.co2;          // 3D 대기 효과는 '관측 계절'의 CO2로
  S.state.iceScale = C.ice;
  S.state.leafColor = SEASON_LEAF[FUT.season];
  S.state.ph = s.pH;
  S.state.iceMelt = Math.min(1, Math.max(0, s.T / ICE_MELT_T));
  if (S === sceneFuture) applyLevers3D(S, s);
  else S.state.treeFrac = 1;            // 자연 지구: 벌채가 없으니 나무가 다 있다
  applyState(S);
}

// 레버 → 3D. 레버 목표값이 아니라 재생 연도의 실제 레버 값(선형 전환 중의 값)을 보여 준다.
// 직접 설계가 아닌 프리셋은 전력 구성 같은 세부가 정해져 있지 않으므로, 연기는 그해 화석 배출의
// 2023년 대비 비율로, 나무는 그해 토지이용 배출로 정하고 나머지는 2023년 값으로 둔다.
// 2023년까지(역사 구간)도 같은 규칙이다.
const ES = EarthSystem;
// 산림: 토지이용 배출 +L2023(벌채 지속) → 나무 60 %, 0(벌채 중단) → 약 83 %, −1(대규모 조림) → 100 %
const treeFracFromLuc = luc => Math.min(1, Math.max(0.3, 0.6 + 0.4 * (ES.L2023 - luc) / (ES.L2023 + 1)));
function applyLevers3D(S, s) {
  const custom = FUT.mode === 'scenario' && FUT.preset === 'custom' && s.year >= ES.LEVER_START;
  const l = custom ? ES.leversAt(FUT.levers, s.year) : ES.LEVER_NOW;
  // 농도 고정 구간은 배출이 정의되지 않으므로 도시는 2023년 모습으로 둔다
  const fossilNow = s.fixed ? ES.E2023 : (s.fossil != null ? s.fossil : 0);
  S.state.fossil = custom ? 100 * l.fossilShare
    : Math.min(100, 100 * ES.LEVER_NOW.fossilShare * Math.max(0, fossilNow / ES.E2023));
  S.state.ev = 100 * l.ev;
  S.state.carbonRemoval = 100 * l.ccs / ES.LEVER_RANGE.ccs[1];
  S.state.nuclear = l.nuclearShare;
  S.state.renew = l.renewShare;
  S.state.treeFrac = treeFracFromLuc(custom ? l.forest : (s.luc != null && !s.fixed ? s.luc : ES.L2023));
}

// ── 시나리오 (오른쪽 지구) ─────────────────────────────────────────────
const PRESET_DESC = {
  bau: '현재 추세: 화석 배출이 해마다 2023년 값의 1 %씩 늘어 2100년에 1.77배가 되고 그 뒤로 그대로. 숲 벌채(토지이용 배출)는 80년에 걸쳐 멈춥니다.',
  paris: '파리협약: 화석·토지이용 배출을 2023년 값에서 매년 같은 양씩 줄여 2075년에 0으로.',
  nz2050: '2050 탄소중립: 화석·토지이용 배출을 2023년 값에서 매년 같은 양씩 줄여 2050년에 0으로.',
  custom: '직접 설계: 아래 레버로 2050년의 사회를 정해 보세요.',
};
const PRESET_KO = { ...Object.fromEntries(Object.entries(ES.PRESETS).map(([k, v]) => [k, v.ko])), custom: '직접 설계' };
function humanLabel() {
  return FUT.mode === 'fixed' ? `농도 고정 ${FUT.fixedPpm} ppm` : PRESET_KO[FUT.preset];
}
function setPreset(name) {
  FUT.preset = name;
  document.querySelectorAll('#fcPresets [data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === name));
  $('fcPresetDesc').textContent = PRESET_DESC[name];
  $('fcLevers').hidden = name !== 'custom';
  $('earthSubR').textContent = humanLabel();
  recomputeFuture();
}

// ── 농도 고정 모드 ──────────────────────────────────────────────────────
// 2023년까지는 역사 배출로 진행하고, 2024년부터 대기 CO2를 고른 값에 묶는다.
// 대기는 적분하지 않고 바다·토양·기온만 그 농도에서 계속 적분하므로 "농도가 그대로면
// 무엇이 계속 변하는가"를 따로 떼어 볼 수 있다 (js/earth-system.js run의 fixedPpm).
const FIXED_DESC = {
  280: '280 ppm: "지금 당장 산업화 이전 농도로 되돌린다면?"이라는 <b>사고실험</b>입니다. 현실에서 가능한 경로가 아니라, 대기를 되돌려도 바다와 기온이 얼마나 늦게 돌아오는지 보려는 것입니다.',
  418: '418 ppm: 2023년 농도에서 멈춘다면. 배출을 멈춰도 농도를 이 값에 묶어 두면 기온은 수백 년 동안 더 오릅니다(평형 +1.8 °C).',
  560: '560 ppm: 산업화 이전의 두 배(이 모형의 현재 추세로는 2069년 도달). 기온이 따라가는 데 수백 년이 걸립니다(평형 +3.1 °C).',
  800: '800 ppm: 이 모형의 현재 추세로는 2119년에 도달하는 수준입니다(평형 +4.7 °C).',
  1000: '1000 ppm: 현재 추세로는 2156년 도달. pH는 고정하자마자 7.7대로 떨어집니다(평형 기온 +5.7 °C).',
};
function setMode(mode) {
  FUT.mode = mode;
  document.querySelectorAll('#fcMode [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('fcFixed').hidden = mode !== 'fixed';
  $('fcScenario').hidden = mode !== 'scenario';
  setFixedButtons();
  $('earthSubR').textContent = humanLabel();
  recomputeFuture();
}
function setFixedButtons() {
  document.querySelectorAll('#fcFixedBtns [data-ppm]').forEach(b => b.classList.toggle('on', Number(b.dataset.ppm) === FUT.fixedPpm));
  $('fcFixedDesc').innerHTML = FIXED_DESC[FUT.fixedPpm] || '';
}
$('fcMode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b && b.dataset.mode !== FUT.mode) setMode(b.dataset.mode);
});
$('fcFixedBtns').addEventListener('click', e => {
  const b = e.target.closest('[data-ppm]');
  if (!b) return;
  FUT.fixedPpm = Number(b.dataset.ppm);
  setFixedButtons();
  $('earthSubR').textContent = humanLabel();
  recomputeFuture();
  // 고르면 2023년부터 재생해서 고정 뒤 바다·기온이 수렴하는 과정을 보여 준다
  setYear(2023);
  setPlaying(true);
});
$('fcPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (b) setPreset(b.dataset.preset);
});

// 레버 6개. 전력 구성은 "화석 비중" + "나머지 중 원자력 몫" 두 손잡이로 한 덩어리로 다뤄서
// 화석/원자력/재생의 합이 언제나 100 %가 되게 한다.
const lvFossil = $('lvFossil'), lvNucShare = $('lvNucShare'), lvEv = $('lvEv'), lvCcs = $('lvCcs'),
      lvOther = $('lvOther'), lvForest = $('lvForest');
lvForest.min = ES.LEVER_RANGE.forest[0];
lvForest.max = ES.LEVER_RANGE.forest[1].toFixed(2);
const pct = v => (100 * v).toFixed(0) + ' %';
function leversToInputs(L) {
  lvFossil.value = Math.round(100 * L.fossilShare);
  const clean = 1 - L.fossilShare;
  lvNucShare.value = clean > 1e-9 ? Math.round(100 * L.nuclearShare / clean) : 23;
  lvEv.value = Math.round(100 * L.ev);
  lvCcs.value = L.ccs;
  lvOther.value = Math.round(100 * L.otherCut);
  lvForest.value = L.forest;
}
function inputsToLevers() {
  const f = Number(lvFossil.value) / 100, k = Number(lvNucShare.value) / 100;
  FUT.levers = {
    fossilShare: f, nuclearShare: (1 - f) * k, renewShare: (1 - f) * (1 - k),
    ev: Number(lvEv.value) / 100, ccs: Number(lvCcs.value),
    otherCut: Number(lvOther.value) / 100, forest: Number(lvForest.value),
  };
}
function forestLabel(v) {
  if (v > ES.L2023 - 0.03) return `${v.toFixed(2)} GtC/년 (지금처럼 벌채)`;
  if (Math.abs(v) < 0.03) return '0 (벌채 중단)';
  return v > 0 ? `${v.toFixed(2)} GtC/년 (벌채 줄임)` : `${v.toFixed(2)} GtC/년 (조림으로 흡수)`;
}
function showLeverValues() {
  const L = FUT.levers, N = ES.LEVER_NOW;
  const segs = [['mixFossil', L.fossilShare, '화석'], ['mixNuclear', L.nuclearShare, '원자력'], ['mixRenew', L.renewShare, '재생']];
  for (const [id, v, name] of segs) {
    $(id).style.width = (100 * v) + '%';
    $(id).textContent = v >= 0.12 ? `${name} ${pct(v)}` : '';
  }
  $('lvMixVal').textContent = `화석 ${pct(L.fossilShare)} · 원자력 ${pct(L.nuclearShare)} · 재생 ${pct(L.renewShare)}`;
  $('lvEvVal').textContent = `${pct(L.ev)} (지금 ${pct(N.ev)})`;
  $('lvCcsVal').textContent = `${L.ccs.toFixed(1)} GtC/년`;
  $('lvOtherVal').textContent = pct(L.otherCut);
  $('lvForestVal').textContent = forestLabel(L.forest);
  // 레버 식의 결과를 숫자로: 2050년(목표가 다 이뤄진 해)의 배출이 2023년의 몇 %인가
  const e = ES.leverEmissions(L)(ES.LEVER_TARGET), e23 = ES.E2023 + ES.L2023, tot = e.fossil + e.luc;
  $('lvResult').innerHTML = `2050년 배출 <b>${tot.toFixed(2)} GtC/년</b> = 2023년의 <b>${(100 * tot / e23).toFixed(0)} %</b>`
    + `<br><span style="color:#9198a3">화석 ${e.fossil.toFixed(2)} · 토지이용 ${e.luc.toFixed(2)} (2023년 ${e23.toFixed(2)})</span>`;
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
[lvFossil, lvNucShare, lvEv, lvCcs, lvOther, lvForest].forEach(el => el.addEventListener('input', onLeverInput));
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
  tlPlay.textContent = on ? '⏸' : '▶';
  tlPlay.classList.toggle('on', on);
  lastTick = performance.now();
}
tlPlay.addEventListener('click', () => setPlaying(!FUT.playing));
tlScrub.addEventListener('input', () => { setPlaying(false); setYear(Number(tlScrub.value)); renderFuture(); });
$('tlSpeed').addEventListener('change', e => { FUT.speed = Number(e.target.value); });
$('tlJumps').addEventListener('click', e => {
  const b = e.target.closest('[data-year]');
  if (!b) return;
  setPlaying(false);
  setYear(Number(b.dataset.year));
  renderFuture();
});

// 화면(카드·막대·세로선)을 재생 연도에 맞춘다. 3D는 0.2초 틱에서만 바꾼다.
function renderFuture() {
  const h = sampleAt(FUT.human, FUT.year);
  tlYearEl.textContent = Math.round(FUT.year);
  if (Number(tlScrub.value) !== Math.round(FUT.year)) tlScrub.value = Math.round(FUT.year);
  updateCards(h);
  updateSink(h);
  updateSpeciation(h, FUT.human[0]);
  const n = sampleAt(FUT.nature, FUT.year);
  updateEarthLabels(n, h);
  updateMeasure(n, h);
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
  if (activeTab !== 'future') return;
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

// 각 지구 위 이름표: 현재 CO2·기온을 작게
// 계절을 반영한 측정값으로 보여 준다 (아래 측정 패널과 같은 값)
function updateEarthLabels(n, h) {
  const f = s => { const o = observe(s); return `CO₂ ${o.co2_ppm.toFixed(0)} ppm · 기온 ${o.air_temp.toFixed(1)} °C`; };
  $('earthValL').textContent = f(n);
  $('earthValR').textContent = f(h);
}

// 탭을 열 때 main.js가 부른다
function activateFutureTab() {
  [futChartCo2, futChartT, futChartPh, futChartSink].forEach(c => c.resize());
  FUT.dirty = true;
  apply3D(sceneFuture, renderFuture());
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}

computeNature();
setPreset(FUT.preset);   // 궤적 계산 + 버튼 표시
setSeason(FUT.season);
