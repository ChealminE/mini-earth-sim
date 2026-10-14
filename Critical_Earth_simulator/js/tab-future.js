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
  preset: 'bau',          // 인간활동 지구의 배출 시나리오
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
function computeHuman() {
  FUT.human = EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: EarthSystem.presetEmissions(FUT.preset) });
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
  SINK_PARTS.forEach((p, i) => { futChartSink.data.datasets[i].data = [h.cum[p.key]]; });
  futChartSink.update('none');
  const tot = h.cum.atm + h.cum.ocean + h.cum.land;
  const pct = k => tot > 1 ? ` ${(100 * h.cum[k] / tot).toFixed(0)} %` : '';
  $('sinkNote').textContent = tot > 1
    ? `누적 배출 ${tot.toFixed(0)} GtC = 대기${pct('atm')} · 바다${pct('ocean')} · 토양·식생${pct('land')}`
      + ' (토지이용 변화로 숲에서 나간 탄소도 배출에 포함)'
    : '아직 배출된 탄소가 거의 없습니다.';
}

// ── 3D ────────────────────────────────────────────────────────────────
// 기존 매핑 상수(CO2_MIN/MAX, PH_MIN/MAX)를 그대로 쓴다. CO2_MAX(1000)는 1인칭과 공유하므로
// 바꾸지 않는다 - 1000 ppm을 넘는 구간은 3D 효과만 포화된다(그래프는 그대로 그린다).
// 빙하는 기온 편차 T로 줄인다 (T = 5 °C에서 최대 축소).
const ICE_MELT_T = 5;
function apply3D(S, s) {
  if (S.dormant) return;
  S.state.co2 = s.ppm;
  S.state.ph = s.pH;
  S.state.iceMelt = Math.min(1, Math.max(0, s.T / ICE_MELT_T));
  applyState(S);
}

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
  updateEarthLabels(sampleAt(FUT.nature, FUT.year), h);
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
function updateEarthLabels(n, h) {
  $('earthValL').textContent = `${n.ppm.toFixed(0)} ppm · ${fmtSigned(n.T, 2)} °C`;
  $('earthValR').textContent = `${h.ppm.toFixed(0)} ppm · ${fmtSigned(h.T, 2)} °C`;
}

// 탭을 열 때 main.js가 부른다
function activateFutureTab() {
  [futChartCo2, futChartT, futChartPh, futChartSink].forEach(c => c.resize());
  FUT.dirty = true;
  apply3D(sceneFuture, renderFuture());
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}

computeNature();
recomputeFuture();
