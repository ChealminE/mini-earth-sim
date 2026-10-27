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
const sceneNature = { dormant: true, opts: { paper: true, nature: true, predictFx: true }, state: { nature: true } };   // 도시 구역의 인공물을 숨김 (common.js applyState)

const TL_START = 1750, TL_END = 2200;
const FUT = {
  preset: 'ssp245',       // 인간활동 지구의 배출 시나리오 (ssp245 | ssp126 | ssp119 | custom)
  levers: { ...EarthSystem.LEVER_NOW },   // 직접 설계의 2050년 목표값
  year: 2023,             // 재생 위치 (소수 가능 - 연도 사이 보간)
  frontier: 2023,         // 예측 전선: 인간활동 지구 예측선을 이 해까지만 그린다 (재생·끌기로 앞으로만 간다)
  playing: false,
  speed: 10,              // 년/초
  human: null,            // EarthSystem.run 결과 배열
  nature: null,
  showNature: false,      // 3D에 자연 지구를 보고 있는가
  dirty: true,            // 다음 0.2초 틱에서 화면·3D를 다시 그릴지
};

// annotateCumFossil: 연도마다 누적 화석 배출의 지금까지 최댓값(cumFossilMax)을 붙인다 - 3D 도시 규모 (js/earth-visual.js)
function computeNature() {
  FUT.nature = EarthVisual.annotateCumFossil(EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: EarthSystem.natureEmissions }));
}
function humanEmissionsFn() {
  return FUT.preset === 'custom' ? EarthSystem.leverEmissions(FUT.levers) : EarthSystem.presetEmissions(FUT.preset);
}
function computeHuman() {
  FUT.human = EarthVisual.annotateCumFossil(EarthSystem.run({ fromYear: TL_START, toYear: TL_END, emissionsFn: humanEmissionsFn() }));
}

// 연도 사이 선형 보간. 엔진 배열의 year=y 원소는 "y년 한 해를 적분한 뒤"의 상태다.
const SAMPLE_KEYS = ['ppm', 'T', 'sst', 'pH', 'omega', 'co2aq', 'hco3', 'co3', 'dic', 'bufferRel', 'cumFossilMax'];
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

// ── 그래프 4개 (2차 개편 C4) ───────────────────────────────────────────
// 대기 CO₂ / 기온 편차 / 해수 pH / 해수온, x축 1750~2200 공유. 색은 css/theme.css 토큰(js/theme.js).
//   관측            : 먹색(--data-obs). CO₂ 1750~1978 CMIP6 재구성 + 1979~ NOAA, 기온 1850~ HadCRUT5(+95 % 띠), pH 1989~ HOT
//   인간활동 지구 예측: 2023 ~ 예측 전선(frontier), 데이터 색 점선
//   인간활동 지구 과거: 1750~2023, 기본 숨김 — [모형 검증 보기]를 켜면 옅은 실선
//   자연만 있는 지구  : 1750~2200 전체, 회색 가는 점선 (사람이 없으면 미래도 이미 알 수 있다는 대비)
//   이전 선택         : 직전 시나리오의 예측, 아주 옅은 선
// 예측 전선(frontier): 예측선은 x ≤ frontier 까지만 보인다. 재생하거나 슬라이더를 미래로 끌면 전선이 앞으로 가며
// 선이 그려진다(피드백 10). 선 데이터는 2200년까지 다 넣어 두고 그릴 때 잘라 낸다(frontierClip) — 재생 중에는
// 데이터를 바꾸지 않고 chart.draw()만 하므로 0.2초 틱 안에서 가볍다.
// y축은 하드코딩하지 않는다. 예전에 max: 600을 박아 곡선이 그래프 밖으로 나간 적이 있고,
// 시나리오마다 2200년 값이 크게 다르다. 범위는 매번 데이터에서 계산한다.
const $ = id => document.getElementById(id);   // 이 탭 안에서만 쓰는 짧은 이름 (다른 스크립트에 $ 없음)
const LAST_OBS_YEAR = EarthSystem.LAST_HIST_YEAR;   // 2023: 관측 끝 · 예측 시작
function niceRange(vals, padFrac = 0.06, minSpan = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) return { min: 0, max: 1 };
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * padFrac;
  lo -= pad; hi += pad;
  // 눈금이 1318.9 같은 값으로 끝나지 않게, 1·2·5 계열의 깔끔한 간격에 맞춰 넓힌다
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(k => k * mag).find(s => s >= raw);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
}

const C = Theme.color;
const NATURE = { width: 1.4, widthOn: 3 };   // 자연 지구를 3D로 보고 있을 때 그래프의 자연 지구 선을 굵게
const VIEW = { validate: false, omega: false, hoverYear: null, drawFrontier: LAST_OBS_YEAR };

// 관측 자료: 연도 → 값 (데이터 레이블이 과거 연도에서 관측값을 찾을 때)
const toPoints = (d, key) => d[key].map((v, i) => ({ x: d.startYear + i, y: v })).filter(p => p.y != null);
const OBS_PTS = {
  co2: [...toPoints(EARTH_DATA.co2Cmip6, 'ppm'), ...toPoints(EARTH_DATA.co2Noaa, 'ppm')],
  T: toPoints(EARTH_DATA.tempHadcrut, 'anom'),
  pH: toPoints(EARTH_DATA.phHot, 'ph'),
  // 해수온 관측은 편차(1850~1900 기준)로 들어 있다. 모형 해수온이 sst0 + T 이므로 같은 기준점에 얹어 절대값으로 그린다.
  sst: toPoints(EARTH_DATA.sstHadsst, 'anom').map(p => ({ x: p.x, y: EarthSystem.PARAMS.sst0 + p.y })),
};
const OBS_BY_YEAR = Object.fromEntries(Object.entries(OBS_PTS).map(([k, pts]) => [k, new Map(pts.map(p => [p.x, p.y]))]));

// 그래프 4개의 정의. key = 엔진 출력 이름, obs = 관측 계열 이름(OBS_PTS 키)
// 순서는 프로그램 어디서나 CO₂ → 기온 → 해수온 → pH(3차 결정). 다른 코드는 이름(id·key)으로 부르므로 순서만 바꿔도 된다.
const fmtSigned = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const SERIES = [
  { id: 'futChartCo2', key: 'ppm', obs: 'co2', color: '--data-co2', fmt: v => `${v.toFixed(0)} ppm`, minSpan: 40 },
  { id: 'futChartT', key: 'T', obs: 'T', color: '--data-temp', fmt: v => `${fmtSigned(v, 2)} °C`, minSpan: 0.5 },
  { id: 'futChartSst', key: 'sst', obs: 'sst', color: '--data-sst', fmt: v => `${v.toFixed(1)} °C`, minSpan: 1 },
  { id: 'futChartPh', key: 'pH', obs: 'pH', color: '--data-ph', fmt: v => v.toFixed(3), minSpan: 0.1 },
];
// 계열 순서(데이터셋 번호). Chart.js는 앞 번호를 위에 그린다 → 예측선을 맨 위에.
const DS = { pred: 0, prev: 1, past: 2, nature: 3, obs: 4 };

// ── 플러그인 ──
// 1) 과거와 예측 구분: 2023 오른쪽에 아주 옅은 바탕 + 빗금, 2023 세로선, 첫 그래프에만 머리표.
//    예측이 비어 있으면(frontier = 2023) 빗금 위에 안내 글씨. 시간 막대 슬라이더는 미래를 예측선과 같은 파란 점선으로 그린다(css/paper.css).
const hatchCache = new WeakMap();
function hatchPattern(ctx) {
  if (hatchCache.has(ctx)) return hatchCache.get(ctx);
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d');
  g.strokeStyle = Theme.alpha('--ink-3', 0.22); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
  const p = ctx.createPattern(c, 'repeat');
  hatchCache.set(ctx, p);
  return p;
}
const predZonePlugin = {
  id: 'predZone',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const px = x.getPixelForValue(LAST_OBS_YEAR);
    ctx.save();
    ctx.fillStyle = Theme.alpha('--ctl-time', 0.035);
    ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top);
    ctx.fillStyle = hatchPattern(ctx);
    ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top);
    ctx.strokeStyle = C('--ink-2'); ctx.lineWidth = 1.2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    ctx.font = `600 ${Theme.px('--fs-1')}px ${C('--font-body')}`;
    ctx.textBaseline = 'top';
    if (chart.$first) {
      ctx.fillStyle = C('--ink-2'); ctx.textAlign = 'right';
      ctx.fillText('관측 끝 · 예측 시작', px - 4, a.top + 2);
    }
    if (FUT.frontier <= LAST_OBS_YEAR && chart.$first && a.right - px > 60) {   // x축이 2023에서 끝나면(탐구 timeRange) 칸이 없다
      ctx.fillStyle = C('--ink-3'); ctx.textAlign = 'center';
      // 아래쪽에 두 줄로 둔다 - 가운데는 재생 위치의 데이터 레이블 자리이고, 1280 폭에서는 빗금 칸이 100 px 남짓이다
      const cx = (px + a.right) / 2, lh = Theme.px('--fs-1') + 2;
      ctx.textBaseline = 'bottom';
      ctx.fillText('▶을 누르면', cx, a.bottom - 6 - lh);
      ctx.fillText('예측이 그려집니다', cx, a.bottom - 6);
    }
    ctx.restore();
  },
};
// 2) 예측 전선: 예측선·이전 선택 선(·Ω 예측)은 x ≤ drawFrontier 까지만 그린다
const frontierClipPlugin = {
  id: 'frontierClip',
  beforeDatasetDraw(chart, args) {
    if (!chart.data.datasets[args.index].$clip) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    const px = Math.min(a.right, x.getPixelForValue(VIEW.drawFrontier));
    ctx.save();
    ctx.beginPath(); ctx.rect(a.left, a.top - 4, Math.max(0, px - a.left), a.bottom - a.top + 8); ctx.clip();
  },
  afterDatasetDraw(chart, args) {
    if (chart.data.datasets[args.index].$clip) chart.ctx.restore();
  },
};
// 3) 데이터 레이블 (피드백 8): 재생 위치의 연도에 점 하나 + 값 하나(굵게, 단위). 과거(≤ 2023)는 관측값(있으면)을
//    "관측", 미래는 인간활동 지구 값을 "예측" 꼬리표로. 마우스를 올린 연도에는 같은 모양의 세로 안내선 + 값.
function valueAt(spec, year, key = spec.key) {
  const y = Math.round(year);
  if (year <= LAST_OBS_YEAR + 1e-9) {
    const m = spec.obs && key === spec.key ? OBS_BY_YEAR[spec.obs].get(y) : undefined;
    if (m != null) return { v: m, tag: '관측', color: C('--data-obs') };
    return { v: sampleAt(FUT.human, year)[key], tag: '모형', color: C('--ink-2') };
  }
  if (year > FUT.frontier + 1e-9) return null;   // 아직 예측하지 않은 해
  return { v: sampleAt(FUT.human, year)[key], tag: '예측', color: C(key === 'omega' ? '--data-omega' : spec.color) };
}
function drawLabel(chart, year, spec, ghost) {
  const { ctx, chartArea: a, scales } = chart;
  const px = scales.x.getPixelForValue(year);
  if (px < a.left - 1 || px > a.right + 1) return;
  ctx.save();
  ctx.strokeStyle = ghost ? C('--ink-3') : C('--ctl-time');
  ctx.lineWidth = ghost ? 1 : 1.5;
  ctx.setLineDash(ghost ? [2, 3] : [4, 3]);
  ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
  ctx.setLineDash([]);
  const items = [[spec, spec.key, 'y']];
  if (spec.key === 'pH' && VIEW.omega) items.push([{ ...spec, fmt: v => `Ω ${v.toFixed(2)}` }, 'omega', 'y1']);
  let lastY = -Infinity;
  for (const [sp, key, axis] of items) {
    const r = valueAt(spec, year, key);
    if (!r) continue;
    const py = scales[axis].getPixelForValue(r.v);
    ctx.fillStyle = r.color; ctx.strokeStyle = C('--paper'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, ghost ? 3.5 : 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    const fs = Theme.px('--fs-1');
    const main = sp.fmt(r.v), tag = ` ${r.tag}`;
    ctx.font = `700 ${fs + 1}px ${C('--font-body')}`;
    const w1 = ctx.measureText(main).width;
    ctx.font = `600 ${fs}px ${C('--font-body')}`;
    const w2 = ctx.measureText(tag).width;
    const w = w1 + w2 + 10, h = fs + 8;
    let lx = px + 8; if (lx + w > a.right) lx = px - 8 - w;
    let ly = Math.max(a.top, Math.min(a.bottom - h, py - h / 2));
    if (Math.abs(ly - lastY) < h) ly = Math.min(a.bottom - h, lastY + h + 2);   // Ω 레이블이 pH 레이블과 겹치지 않게
    lastY = ly;
    ctx.globalAlpha = ghost ? 0.92 : 1;
    ctx.fillStyle = C('--paper'); ctx.strokeStyle = ghost ? C('--rule') : r.color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(lx, ly, w, h); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `700 ${fs + 1}px ${C('--font-body')}`; ctx.fillStyle = C('--ink');
    ctx.fillText(main, lx + 5, ly + h / 2 + 0.5);
    ctx.font = `600 ${fs}px ${C('--font-body')}`; ctx.fillStyle = C('--ink-2');
    ctx.fillText(tag, lx + 5 + w1, ly + h / 2 + 0.5);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
const valueLabelPlugin = {
  id: 'valueLabel',
  afterDatasetsDraw(chart) {
    const spec = chart.$spec;
    if (VIEW.hoverYear != null && Math.abs(VIEW.hoverYear - FUT.year) > 0.5) drawLabel(chart, VIEW.hoverYear, spec, true);
    drawLabel(chart, FUT.year, spec, false);
  },
  // 마우스를 올린 연도: 그래프 4개가 같은 연도를 함께 가리킨다(기본 툴팁 대신)
  afterEvent(chart, args) {
    const e = args.event;
    if (e.type === 'mouseout') { if (VIEW.hoverYear != null) { VIEW.hoverYear = null; drawCharts(); } return; }
    if (e.type !== 'mousemove') return;
    const a = chart.chartArea;
    const inside = e.x >= a.left && e.x <= a.right && e.y >= a.top && e.y <= a.bottom;
    const y = inside ? Math.round(chart.scales.x.getValueForPixel(e.x)) : null;
    if (y !== VIEW.hoverYear) { VIEW.hoverYear = y; drawCharts(); }
  },
};

// 4) 탐구 모드 층 (2차 개편 E): 겹친 자료·사건 표지·학생이 고른 점을 그리고, 그래프 클릭(pickPoint)을 받는다.
//    내용은 js/inquiry.js 가 정한다. 이 파일보다 뒤에 읽히므로 그릴 때 있는지 확인만 한다.
const inquiryLayerPlugin = {
  id: 'inquiryLayer',
  beforeDatasetsDraw(chart) { if (typeof Inquiry !== 'undefined') Inquiry.drawUnder(chart); },
  afterDatasetsDraw(chart) { if (typeof Inquiry !== 'undefined') Inquiry.drawOver(chart); },
  afterEvent(chart, args) { if (typeof Inquiry !== 'undefined') Inquiry.chartEvent(chart, args.event); },
};

const lineDs = (label, color, extra = {}) => ({ label, data: [], borderColor: color, backgroundColor: color,
  borderWidth: 2.2, pointRadius: 0, tension: 0, ...extra });
const Y_AXIS_W = 46, Y1_AXIS_W = 40;
const charts = SERIES.map((spec, i) => {
  const color = C(spec.color);
  const ds = [];
  ds[DS.pred] = lineDs('인간활동 지구 (예측)', color, { borderDash: [6, 4], borderWidth: 2.6, $clip: true });
  ds[DS.prev] = lineDs('이전 선택', Theme.alpha(spec.color, 0.28), { borderWidth: 2, $clip: true, hidden: true });
  ds[DS.past] = lineDs('인간활동 지구 (모형, 과거)', Theme.alpha(spec.color, 0.45), { borderWidth: 1.6, hidden: true });
  ds[DS.nature] = lineDs('자연만 있는 지구', C('--data-nature'), { borderDash: [3, 3], borderWidth: NATURE.width });
  const obsC = C('--data-obs');
  if (spec.obs === 'co2') {
    ds.push(lineDs('관측 (CMIP6 재구성)', obsC, { data: toPoints(EARTH_DATA.co2Cmip6, 'ppm'), borderWidth: 1.6 }));
    ds.push(lineDs('관측 (NOAA)', obsC, { data: toPoints(EARTH_DATA.co2Noaa, 'ppm'), showLine: false, pointRadius: 1.6 }));
  } else if (spec.obs === 'T') {
    ds.push(lineDs('관측 (HadCRUT5)', obsC, { data: OBS_PTS.T, borderWidth: 1.4 }));
    // 95 % 불확도 띠: 위 경계를 바로 다음 계열(아래 경계)까지 채운다
    ds.push(lineDs('_띠 위', C('--data-band'), { data: toPoints(EARTH_DATA.tempHadcrut, 'hi'), borderWidth: 0, fill: '+1', backgroundColor: C('--data-band') }));
    ds.push(lineDs('_띠 아래', C('--data-band'), { data: toPoints(EARTH_DATA.tempHadcrut, 'lo'), borderWidth: 0 }));
  } else if (spec.obs === 'pH') {
    ds.push(lineDs('관측 (HOT)', obsC, { data: OBS_PTS.pH, borderWidth: 1.4, pointRadius: 1.6 }));
  } else if (spec.obs === 'sst') {
    // 띠 없음: 원본의 95 % 열은 편향 불확실성만의 범위라 전체 불확실성으로 오해된다 (tools/gen_earth_data.py hadsst)
    ds.push(lineDs('관측 (HadSST4)', obsC, { data: OBS_PTS.sst, borderWidth: 1.4 }));
  }
  const scales = {
    x: Theme.axis({ type: 'linear', min: TL_START, max: TL_END,
      ticks: { display: i === SERIES.length - 1, color: C('--ink-3'), font: Theme.font(), stepSize: 50, callback: v => String(v) } }),
    // y축 폭을 고정해 그래프 4개의 x축(연도)이 세로로 정확히 맞게 한다
    y: Theme.axis({ ticks: { color: C('--ink-3'), font: Theme.font(), maxTicksLimit: 5 }, afterFit: sc => { sc.width = Y_AXIS_W; } }),
  };
  if (spec.key === 'pH') {
    ds.push(lineDs('Ω (예측)', C('--data-omega'), { yAxisID: 'y1', borderDash: [6, 4], $clip: true, hidden: true }));
    ds.push(lineDs('Ω = 1 (골격 용해 시작)', Theme.alpha('--data-temp', 0.8), { yAxisID: 'y1', borderDash: [2, 3], borderWidth: 1.2, hidden: true }));
    scales.y1 = Theme.axis({ position: 'right', display: false, grid: { drawOnChartArea: false },
      ticks: { color: C('--data-omega'), font: Theme.font(), maxTicksLimit: 5 }, afterFit: sc => { sc.width = sc.options.display ? Y1_AXIS_W : 0; } });
  }
  const chart = new Chart($(spec.id), {
    type: 'line', data: { datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      events: ['mousemove', 'mouseout', 'click'],   // click: 탐구 모드에서 학생이 연도를 고를 때 (inquiryLayerPlugin)
      layout: { padding: { right: Y1_AXIS_W + 4 } },   // Ω 축 자리를 모든 그래프가 비워 둔다(x축 정렬)
      scales, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
    plugins: [predZonePlugin, frontierClipPlugin, inquiryLayerPlugin, valueLabelPlugin],
  });
  chart.$spec = spec;
  chart.$first = i === 0;
  return chart;
});
const [futChartCo2, futChartT, futChartSst, futChartPh] = charts;
const drawCharts = () => charts.forEach(c => c.draw());

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

const toXY = (arr, key, from = TL_START) => arr.filter(o => o.year >= from).map(o => ({ x: o.year, y: o[key] }));
const PREV = { run: null, label: '' };   // 직전 시나리오의 궤적 (이전 선택 선)
// 궤적이 바뀌었을 때만 부른다 (선 데이터와 축 범위). 재생 중에는 draw()만 한다.
function refreshCharts() {
  const H = FUT.human, N = FUT.nature;
  if (typeof Inquiry !== 'undefined' && Inquiry) Inquiry.refresh();   // 탐구 모드가 겹친 자료(예측 CO₂ 등)도 새 궤적으로
  for (const ch of charts) {
    const sp = ch.$spec, d = ch.data.datasets;
    d[DS.pred].data = toXY(H, sp.key, LAST_OBS_YEAR);
    d[DS.past].data = toXY(H.filter(o => o.year <= LAST_OBS_YEAR), sp.key);
    d[DS.nature].data = toXY(N, sp.key);
    d[DS.prev].data = PREV.run ? toXY(PREV.run, sp.key, LAST_OBS_YEAR) : [];
    d[DS.prev].hidden = !PREV.run;
    d[DS.prev].label = PREV.run ? `이전 선택: ${PREV.label}` : '이전 선택';
    // y축 범위는 보이는 연도(LIMIT, 평소 1750~2200)의 값으로만 — 탐구에서 1750~2023만 볼 때 2200년 예측값에 눌리지 않게
    const vis = o => o.year >= LIMIT.from && o.year <= LIMIT.to;
    const vals = [...H.filter(vis).map(o => o[sp.key]), ...N.filter(vis).map(o => o[sp.key])];
    if (PREV.run) vals.push(...PREV.run.filter(vis).map(o => o[sp.key]));
    if (sp.obs) vals.push(...OBS_PTS[sp.obs].filter(p => p.x >= LIMIT.from && p.x <= LIMIT.to).map(p => p.y));
    Object.assign(ch.options.scales.y, niceRange(vals, 0.06, sp.minSpan));
    if (sp.key === 'pH') {
      d[d.length - 2].data = toXY(H, 'omega', LAST_OBS_YEAR);
      d[d.length - 1].data = [{ x: TL_START, y: 1 }, { x: TL_END, y: 1 }];
      Object.assign(ch.options.scales.y1, niceRange([...H.map(o => o.omega), ...N.map(o => o.omega), 1], 0.06, 0.5));
    }
    ch.update('none');
  }
  // 막대 축은 궤적 전체의 최대 누적에 고정해, 재생하면서 막대가 자라는 게 보이게 한다
  let lo = 0, hi = 0;
  for (const o of H) for (const p of SINK_PARTS) { lo = Math.min(lo, o.cum[p.key]); }
  for (const o of H) hi = Math.max(hi, o.cum.atm + o.cum.ocean + o.cum.land);
  const r = niceRange([lo, hi], 0.04, 10);
  futChartSink.options.scales.x.min = lo < 0 ? r.min : 0;   // 흡수가 음수(방출)인 경우만 0 왼쪽을 연다
  futChartSink.options.scales.x.max = r.max;
  updateLegend();
}

// 시나리오·레버를 바꾸면 예측선을 2023부터 지금 전선까지 0.6초 안팎으로 다시 그린다(움직임 줄이기면 바로)
const REDRAW_MS = 600;
let redrawAnim = 0;
function animateRedraw() {
  cancelAnimationFrame(redrawAnim);
  if (reduceMotion() || FUT.frontier <= LAST_OBS_YEAR) { VIEW.drawFrontier = FUT.frontier; drawCharts(); return; }
  const t0 = performance.now(), from = LAST_OBS_YEAR, to = FUT.frontier;
  VIEW.drawFrontier = from;   // 첫 프레임 전에 예전 전선이 잠깐 보이지 않게 바로 2023으로 되돌린다
  drawCharts();
  const step = now => {
    const k = Math.min(1, (now - t0) / REDRAW_MS);
    VIEW.drawFrontier = from + (to - from) * (1 - (1 - k) ** 3);
    drawCharts();
    if (k < 1) redrawAnim = requestAnimationFrame(step);
  };
  redrawAnim = requestAnimationFrame(step);
}
// 전선을 앞으로 (재생·끌기). 뒤로는 가지 않는다 — 과거로 끌어도 이미 그린 예측은 남는다.
function advanceFrontier(year) {
  if (year <= FUT.frontier) return;
  FUT.frontier = Math.min(TL_END, year);
  cancelAnimationFrame(redrawAnim);
  VIEW.drawFrontier = FUT.frontier;
}

// 그래프 열 머리의 공용 범례·보기 토글 (그래프마다 범례를 따로 두면 그래프 높이가 모자라다)
function updateLegend() {
  $('futPrevKey').hidden = !PREV.run;
  $('futPrevName').textContent = PREV.label;
}
function setViewToggle(btn, on) { btn.setAttribute('aria-pressed', String(on)); }
// 보기 토글은 함수로 둔다 - 탐구 모드(js/inquiry.js)가 단계에서 켜고, 끝나면 원래대로 되돌린다
function setValidateView(on) {
  VIEW.validate = on;
  setViewToggle($('futValidateBtn'), on);
  for (const ch of charts) ch.data.datasets[DS.past].hidden = !on;
  charts.forEach(c => c.update('none'));
}
$('futValidateBtn').addEventListener('click', () => setValidateView(!VIEW.validate));
$('futOmegaBtn').addEventListener('click', () => setOmegaView(!VIEW.omega));
function setOmegaView(on) {
  VIEW.omega = on;
  setViewToggle($('futOmegaBtn'), on);
  const d = futChartPh.data.datasets;
  d[d.length - 2].hidden = d[d.length - 1].hidden = !VIEW.omega;
  futChartPh.options.scales.y1.display = VIEW.omega;
  futChartPh.options.layout.padding.right = VIEW.omega ? 4 : Y1_AXIS_W + 4;   // Ω 축이 비워 둔 자리를 쓴다
  futChartPh.update('none');
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
// 기록 효과 (2차 F4): 3D를 "찍었다"는 느낌. full = 셔터 플래시 + 붉은 테두리 + 가운데 녹화 표시, soft = 테두리만
// (재생 끝 자동 기록처럼 학생이 누르지 않은 기록은 눈에 덜 띄게). 3D 렌더러는 건드리지 않고 CSS 애니메이션만 쓴다.
function playRecordFx(fx, year) {
  if (fx === 'none') return;
  const el = $('recFx');
  $('recFxText').textContent = `기록 · ${year}년`;
  el.classList.remove('full', 'soft');
  void el.offsetWidth;              // 효과 도중 다시 누르면 처음부터 (showPredBand 와 같은 방식)
  el.classList.add(fx === 'soft' ? 'soft' : 'full');
}
$('recFx').addEventListener('animationend', e => {
  // 테두리(가장 긴 애니메이션)가 끝나면 정리. ::before 플래시도 같은 요소의 이벤트로 오므로 pseudoElement 로 거른다
  if (e.target === e.currentTarget && !e.pseudoElement) e.currentTarget.classList.remove('full', 'soft');
});
// 지금 연도 · 시나리오(또는 직접 설계) · 보고 있는 지구 · 측정 요소 4개를 한 줄로 저장
// fx: 'full' | 'soft' | 'none' — 기록 효과 세기 (기본 full)
function addRecord({ fx = 'full' } = {}) {
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
  playRecordFx(fx, rec.year);
  $('recStatus').textContent = `${rec.year}년 기록됨`;
}
function setDrawer(open) {
  $('recDrawer').hidden = !open;
  $('recOpen').setAttribute('aria-expanded', String(open));
  if (open) $('recClose').focus();
}
$('recAdd').addEventListener('click', () => addRecord({ fx: 'full' }));
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
// 내보낸 파일 이름에 날짜·시각을 넣는다(수업 시간마다 같은 이름으로 덮어쓰지 않게): 20261023_1405
function fileStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
$('recCsv').addEventListener('click', () => {
  if (!measRecords.length) return;
  const cols = ['year', 'scenario', 'earth', ...MEAS.map(m => m.key)];
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const csv = [cols.join(','), ...measRecords.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
  // BOM: 엑셀에서 한글이 깨지지 않게 (직접 실험 탭 CSV와 같은 방식, downloadBlob은 js/xlsx-lite.js)
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `미래예측_측정기록_${fileStamp()}.csv`);
});

// ── 3D ────────────────────────────────────────────────────────────────
// 기존 매핑 상수(CO2_MIN/MAX, PH_MIN/MAX)를 그대로 쓴다. CO2_MAX(1000)는 1인칭과 공유하므로
// 바꾸지 않는다 - 1000 ppm을 넘는 구간은 3D 효과만 포화된다(그래프는 그대로 그린다).
// 빙하·산호·조개·도시는 common.js setEarthVisual → applyState가 엔진 값으로 정한다(2차 개편 D, js/earth-visual.js).
// CO₂는 무색이라 뚜껑·안개 색에 묶지 않는다(피드백 2번). 종이 탭 씬은 applyState가 [CO₂ 보기] 점 구름으로만 보인다(2차 개편 D2).
function apply3D(S, s) {
  if (S.dormant) return;
  S.state.co2 = s.ppm;
  if (S === sceneFuture) applyLevers3D(S, s);
  else { setEarthVisual(S, s, null); S.state.treeFrac = 1; }   // 자연 지구: 도시 없음, 벌채가 없으니 나무가 다 있다
  applyState(S);
}

// 레버 → 3D. 레버 목표값이 아니라 재생 연도의 실제 레버 값(선형 전환 중의 값)을 보여 준다.
// 직접 설계가 아닌 시나리오는 전력 구성 같은 세부가 정해져 있지 않으므로 EarthVisual.presetSociety가
// 그해 화석 배출로 전기차·재생·포집을 연출하고(2023년까지는 2023년 값, 그 기술이 없던 시대는 0),
// 나무는 그해 토지이용 배출로 정한다. 도시 규모·굴뚝은 직접 설계든 시나리오든 그해 엔진 배출을 따른다(2차 개편 D3).
const ES = EarthSystem;
// 산림: 토지이용 배출 +L2023(벌채 지속) → 나무 60 %, 0(벌채 중단) → 약 83 %, −1(대규모 조림) → 100 %
const treeFracFromLuc = luc => Math.min(1, Math.max(0.3, 0.6 + 0.4 * (ES.L2023 - luc) / (ES.L2023 + 1)));
function applyLevers3D(S, s) {
  const custom = FUT.preset === 'custom' && s.year >= ES.LEVER_START;
  const fossil = s.fossil != null ? s.fossil : 0;
  const l = custom ? ES.leversAt(FUT.levers, s.year) : null;
  const soc = custom
    ? { ev: l.ev, renew: l.renewShare, nuclear: l.nuclearShare, removal: l.ccs / ES.LEVER_RANGE.ccs[1] }
    : EarthVisual.presetSociety(fossil, s.year, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR);
  setEarthVisual(S, s, soc);   // 도시·굴뚝·자동차·전기차·태양광·냉각탑·포집 타워 (common.js)
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
  updateLegend3D();   // 자연 지구에는 도시가 없으니 범례의 도시 줄을 숨긴다 (main.js)
  // 같은 정보를 3D와 그래프가 같은 색으로 가리키게: 자연 지구를 보는 동안 그래프의 자연 지구 선을 굵게
  for (const ch of charts) ch.data.datasets[DS.nature].borderWidth = on ? NATURE.widthOn : NATURE.width;
  charts.forEach(c => c.update('none'));
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
  // 다른 시나리오로 바꾸면 직전 궤적을 '이전 선택' 선으로 남긴다 (같은 것을 다시 누르면 그대로)
  if (FUT.human && name !== FUT.preset) { PREV.run = FUT.human; PREV.label = humanLabel(); }
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
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      animateRedraw();   // 손을 떼면 예측선을 2023부터 다시 그린다
    };
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
  requestAnimationFrame(() => { leverPending = false; recomputeFuture(false); });
}
[lvEv, lvCcs, lvOther, lvForest].forEach(el => {
  el.addEventListener('input', onLeverInput);
  el.addEventListener('change', () => animateRedraw());   // 손을 떼면 예측선을 2023부터 다시 그린다
});
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
// 재생·끌기로 갈 수 있는 범위. 평소에는 1750~2200 전체이고, 탐구 모드의 timeRange 동작이 좁힌다(js/inquiry.js).
const LIMIT = { from: TL_START, to: TL_END };
function setYear(y) {
  FUT.year = Math.max(LIMIT.from, Math.min(LIMIT.to, y));
  FUT.dirty = true;
}
// 범위를 바꾸면 슬라이더 끝과 그래프 x축도 같이 맞춘다(1750~2023만 볼 때 그래프가 그 구간으로 넓어진다)
function setTimeLimit(from = TL_START, to = TL_END) {
  LIMIT.from = from; LIMIT.to = to;
  tlScrub.min = from; tlScrub.max = to;
  for (const ch of charts) { ch.options.scales.x.min = from; ch.options.scales.x.max = to; }
  refreshCharts();   // y축 범위도 보이는 연도에 맞춘다 (update 포함)
  setYear(FUT.year);
}
function setPlaying(on) {
  FUT.playing = on;
  // 끝에서 누르면 처음부터 다시: 범위가 예측까지 가면 예측 시작(2023)부터, 과거만이면 범위 처음부터
  if (on && FUT.year >= LIMIT.to - 1e-9) FUT.year = LIMIT.to > LAST_OBS_YEAR ? Math.max(LIMIT.from, LAST_OBS_YEAR) : LIMIT.from;
  tlPlay.setAttribute('aria-pressed', String(on));
  $('tlPlayIcon').innerHTML = Icons.svg(on ? 'pause' : 'play');
  $('tlPlayLabel').textContent = on ? '일시정지' : '재생';
  lastTick = performance.now();
}
tlPlay.addEventListener('click', () => setPlaying(!FUT.playing));
// 슬라이더를 전선보다 앞(미래)으로 끌면 그 지점까지 전선이 늘어난다(끌어서 예측하기). 과거로 끌면 전선은 그대로.
// 끄는 동안에는 예측 전환 띠를 띄우지 않고, 놓은 뒤(change)에 과거 → 미래로 넘어갔는지 판단한다.
const SCRUB = { active: false, startFuture: false };
tlScrub.addEventListener('input', () => {
  if (!SCRUB.active) { SCRUB.active = true; SCRUB.startFuture = FUT.year > LAST_OBS_YEAR; }
  setPlaying(false);
  setYear(Number(tlScrub.value));
  advanceFrontier(FUT.year);
  renderFuture();
});
tlScrub.addEventListener('change', () => {
  const crossed = !SCRUB.startFuture && FUT.year > LAST_OBS_YEAR;
  SCRUB.active = false;
  if (crossed) showPredBand();
});
// [예측 지우기]: 전선과 재생 위치를 2023으로 (그린 예측을 지우고 처음부터)
$('tlClear').addEventListener('click', () => {
  setPlaying(false);
  cancelAnimationFrame(redrawAnim);
  FUT.frontier = LAST_OBS_YEAR;
  VIEW.drawFrontier = LAST_OBS_YEAR;
  setYear(LAST_OBS_YEAR);
  renderFuture();
});

// ── 예측 전환 효과 (C6) ───────────────────────────────────────────────
// 재생 위치가 과거(≤ 2023)에서 미래로 넘어가는 순간 한 번: 3D 위쪽 띠(0.4초 나타남 → 2초 → 0.6초 사라짐, css/paper.css).
// 미래 구간에 있는 동안: 3D 칸 파란 테두리(도는 빛) + '예측' 배지 + 받침대 위 숫자 흐름("지금 계산 중", 인간활동·자연 지구 둘 다),
// 시간 막대 손잡이 점선 테두리. 과거로 돌아오면 걷힌다.
// 넘나들 때마다 한 번씩만 띄우고, 슬라이더를 끄는 중에는 띄우지 않는다(놓은 뒤에 판단, 위 change).
let inFuture = false;
function showPredBand() {
  const band = $('predBand');
  band.hidden = false;
  band.classList.remove('show');
  void band.offsetWidth;            // 애니메이션을 처음부터 다시 돌리기
  band.classList.add('show');
}
$('predBand').addEventListener('animationend', e => { e.currentTarget.classList.remove('show'); e.currentTarget.hidden = true; });
function updatePredState() {
  const now = FUT.year > LAST_OBS_YEAR + 1e-9;
  if (now === inFuture) return;
  inFuture = now;
  $('blueprint').classList.toggle('on', now);
  setPredictFx(sceneFuture, now);   // 자연 지구 토글 중에도 같아야 하므로 두 씬 모두 (아직 안 만든 씬은 만들 때 이어받음)
  setPredictFx(sceneNature, now);
  $('predBadge').hidden = !now;
  tlScrub.classList.toggle('is-future', now);
  if (now && !SCRUB.active) showPredBand();
}
// 시간 막대 슬라이더 트랙: 1750~2023 회색 채움, 2023~2200 파란 점선(전선까지 진하게, 그 뒤 옅게) (css/paper.css 가 변수를 쓴다)
function updateTrack() {
  const at = y => (100 * Math.max(0, Math.min(1, (y - LIMIT.from) / (LIMIT.to - LIMIT.from)))).toFixed(2) + '%';
  tlScrub.style.setProperty('--p-obs', at(LAST_OBS_YEAR));
  tlScrub.style.setProperty('--p-front', at(FUT.frontier));
}
$('tlSpeed').addEventListener('change', e => { FUT.speed = Number(e.target.value); });

// 화면(팝오버·세로선)을 재생 연도에 맞춘다. 3D는 0.2초 틱에서만 바꾼다.
function renderFuture() {
  const h = sampleAt(FUT.human, FUT.year);
  tlYearEl.textContent = Math.round(FUT.year);
  if (Number(tlScrub.value) !== Math.round(FUT.year)) tlScrub.value = Math.round(FUT.year);
  updateTrack();
  updatePredState();
  if (!$('popSink').hidden) updateSink(h);
  if (!$('popSpec').hidden) updateSpeciation(h, FUT.human[0]);
  drawCharts();
  return h;
}

// 궤적을 다시 계산한다 (시나리오가 바뀔 때). 재생 위치는 그대로 둔다.
// animate = false: 레버를 끄는 동안처럼 연달아 바뀔 때는 바로 그리고, 손을 뗐을 때(change) 다시 그리기 효과를 준다.
function recomputeFuture(animate = true) {
  computeHuman();
  refreshCharts();
  FUT.dirty = true;
  if (animate) animateRedraw(); else { VIEW.drawFrontier = FUT.frontier; }
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
    advanceFrontier(FUT.year);
    if (FUT.year >= LIMIT.to) {
      setPlaying(false);
      if (typeof Inquiry !== 'undefined' && Inquiry) Inquiry.playEnded();   // 탐구 단계의 '재생 후 기록'
    }
  }
  if (!FUT.dirty) return;
  FUT.dirty = false;
  const h = renderFuture();
  apply3D(sceneFuture, h);
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}, FUT_TICK_MS);

// ── 자유 조작 상태 저장·복원 (2차 개편 E) ─────────────────────────────
// 탐구 모드를 켜면 지금 상태를 저장해 두고, 끄면 그대로 되돌린다(시나리오·레버·재생 위치·전선·토글·팝오버).
// setPreset을 거치지 않고 직접 넣는다 - setPreset은 '이전 선택' 선을 바꾸기 때문이다.
function futSnapshot() {
  const open = [...document.querySelectorAll('#futCharts .fut-pop')].find(p => !p.hidden);
  return {
    preset: FUT.preset, levers: { ...FUT.levers }, year: FUT.year, frontier: FUT.frontier, speed: FUT.speed,
    showNature: FUT.showNature, omega: VIEW.omega, validate: VIEW.validate, popover: open ? open.id : null,
    prev: { run: PREV.run, label: PREV.label }, leverPanel: !$('fcLevers').hidden,
  };
}
function futRestore(s) {
  setPlaying(false);
  FUT.preset = s.preset;
  FUT.levers = { ...s.levers };
  leversToInputs(FUT.levers);
  showLeverValues();
  document.querySelectorAll('#futureControls [data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === s.preset)));
  $('fcPresetDesc').textContent = PRESET_DESC[s.preset];
  showLeverPanel(s.leverPanel);
  PREV.run = s.prev.run; PREV.label = s.prev.label;
  computeHuman();
  refreshCharts();
  cancelAnimationFrame(redrawAnim);
  FUT.frontier = s.frontier;
  VIEW.drawFrontier = s.frontier;
  FUT.speed = s.speed;
  $('tlSpeed').value = String(s.speed);
  setYear(s.year);
  if (FUT.showNature !== s.showNature) setNatureView(s.showNature);
  if (VIEW.omega !== s.omega) setOmegaView(s.omega);
  if (VIEW.validate !== s.validate) setValidateView(s.validate);
  setPopover(s.popover);
  updateBadge();
  renderFuture();
}

// 탭을 열 때 main.js가 부른다
function activateFutureTab() {
  [...charts, futChartSink].forEach(c => c.resize());
  FUT.dirty = true;
  apply3D(sceneFuture, renderFuture());
  apply3D(sceneNature, sampleAt(FUT.nature, FUT.year));
}

computeNature();
setPreset(FUT.preset);   // 궤적 계산 + 버튼 표시
