// ================= 실시간 실험 탭 (아두이노 WebSocket 연동) =================
const sceneLive = buildAcrylicScene();

const liveLatest = {};
const liveKnownKeys = new Set();
let liveScatterPoints = [];
const LIVE_MAX_POINTS = 200;
const liveColorRamp = ['#5DCAA5', '#EF9F27', '#E24B4A', '#85B7EB', '#c07fe0', '#8fd83c'];
function liveColorFor(key) {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return liveColorRamp[hash % liveColorRamp.length];
}

function renderSensorGrid() {
  const grid = document.getElementById('sensorGrid');
  const keys = [...liveKnownKeys].sort();
  if (keys.length === 0) return;
  grid.innerHTML = keys.map(k => {
    const d = liveLatest[k];
    const t = new Date(d.timestamp);
    const timeStr = t.toLocaleTimeString('ko-KR', {hour12:false});
    const roleOptionsHtml = sensorRoleOptions.map(opt =>
      `<option value="${opt.id}"${(sensorRoles[k] || '') === opt.id ? ' selected' : ''}>${opt.label}</option>`
    ).join('');
    return `<div class="sensor-card" style="border-left-color:${liveColorFor(k)}">
      <div class="key">${k}</div>
      <div class="val">${typeof d.value === 'number' ? d.value.toFixed(2) : d.value}</div>
      <div class="updated">${timeStr}</div>
      <select class="sensor-role-select" data-key="${k}" title="이 센서가 실제로 측정하는 값 지정 (3D 효과 연결용)">${roleOptionsHtml}</select>
    </div>`;
  }).join('');
}

document.getElementById('sensorGrid').addEventListener('change', (e) => {
  if (!e.target.classList.contains('sensor-role-select')) return;
  const key = e.target.dataset.key;
  if (e.target.value) sensorRoles[key] = e.target.value;
  else delete sensorRoles[key];
  applyLiveSensorEffects();
});

// ── 다중 그래프 카드 (최대 4개, 드래그로 합치기) ──────────────────────
// 카드에는 제목 표시 + ⚙ + ✕ + 차트만 있음 (X/Y 변인 선택, 축 최소/최대/단위,
// 계열별 색상 등 실제 설정은 전부 ⚙로 여는 팝업에서 처리 — 카드 자체는 그걸 누르기 전엔 안 건드림).
// 상태는 DOM이 아니라 g 객체 자체에 저장(g.series[i].xKey 등) — 팝업이 닫혀 있어도 값이 유지되게.
const liveGraphs = []; // [{ id, chart, card, title, xMin, xMax, xUnit, yMin, yMax, yUnit, series:[{sid,color,xKey,yKey}] }]
let liveGraphSeq = 0;
let liveSeriesSeq = 0;
const MAX_LIVE_GRAPHS = 4;
let gsCurrentGraphId = null; // 지금 설정 팝업이 편집 중인 그래프
let pendingMerge = null;     // { sourceId, targetId } - 합치기 확인 팝업 대기중

function buildKeyOptionsHtml(selectedKey, keys) {
  return keys.map(k => `<option value="${k}"${k === selectedKey ? ' selected' : ''}>${k}</option>`).join('');
}

// 새 센서 키가 들어오면 주 계열(series[0])에 기본값으로 자동 배정 (병합으로 늘어난 계열은 사용자가 직접 골라야 함)
function refreshLiveSelectOptions() {
  const keys = [...liveKnownKeys].sort();
  liveGraphs.forEach(g => {
    const primary = g.series[0];
    if (!primary.xKey && keys[0]) primary.xKey = keys[0];
    if (!primary.yKey && keys[1]) primary.yKey = keys[1];
    updateLiveChart(g);
  });
  if (gsCurrentGraphId != null) {
    const g = liveGraphs.find(x => x.id === gsCurrentGraphId);
    if (g) renderSettingsSeriesList(g);
  }
}

function updateLiveChart(g) {
  const xKeys = [], yKeys = [];
  g.chart.data.datasets = g.series.map(s => {
    if (s.xKey && !xKeys.includes(s.xKey)) xKeys.push(s.xKey);
    if (s.yKey && !yKeys.includes(s.yKey)) yKeys.push(s.yKey);
    const data = (s.xKey && s.yKey)
      ? liveScatterPoints.filter(p => s.xKey in p && s.yKey in p).map(p => ({ x: p[s.xKey], y: p[s.yKey] }))
      : [];
    return { label: s.xKey && s.yKey ? `${s.xKey} / ${s.yKey}` : '(선택 안 됨)', data,
      backgroundColor: s.color, borderColor: s.color, pointRadius: 3, showLine: true, borderWidth: 1 };
  });

  if (g.showTrend) {
    g.series.forEach((s, idx) => {
      const reg = linearRegression(g.chart.data.datasets[idx].data);
      if (!reg) return;
      const xs = g.chart.data.datasets[idx].data.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      g.chart.data.datasets.push({
        label: `추세선 (기울기 ${reg.slope.toFixed(3)}, R²=${reg.r2.toFixed(3)})`,
        data: [{ x: xMin, y: reg.slope * xMin + reg.intercept }, { x: xMax, y: reg.slope * xMax + reg.intercept }],
        borderColor: s.color, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, showLine: true, fill: false,
      });
    });
  }

  const xLabel = xKeys.join(' / ') || 'X축 변인';
  const yLabel = yKeys.join(' / ') || 'Y축 변인';
  g.chart.options.scales.x.title.text = g.xUnit ? `${xLabel} (${g.xUnit})` : xLabel;
  g.chart.options.scales.y.title.text = g.yUnit ? `${yLabel} (${g.yUnit})` : yLabel;
  g.chart.options.scales.x.min = g.xMin !== '' ? Number(g.xMin) : undefined;
  g.chart.options.scales.x.max = g.xMax !== '' ? Number(g.xMax) : undefined;
  g.chart.options.scales.y.min = g.yMin !== '' ? Number(g.yMin) : undefined;
  g.chart.options.scales.y.max = g.yMax !== '' ? Number(g.yMax) : undefined;
  g.chart.options.plugins.legend.display = g.series.length > 1 || g.showTrend;
  g.chart.update();
}

// 최소제곱법으로 기울기·절편·결정계수(R²) 계산. 점이 2개 미만이면 추세선을 그릴 수 없음.
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x; }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // 모든 점의 x가 같으면 기울기를 정의할 수 없음
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    const yPred = slope * p.x + intercept;
    ssRes += (p.y - yPred) ** 2;
    ssTot += (p.y - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function updateAllLiveCharts() {
  liveGraphs.forEach(updateLiveChart);
}

function updateCardTitleDisplay(g) {
  const el = document.getElementById(`titleDisplay-${g.id}`);
  if (el) el.textContent = g.title || '';
}

// ── 카드 자체는 생성될 때 한 번만 그림 (합치기/계열 변경 때도 안 건드려서 차트 인스턴스가 안 깨짐) ──
function renderGraphCard(g) {
  g.card.innerHTML = `
    <div class="graph-card-top">
      <div class="graph-title-display" id="titleDisplay-${g.id}">${g.title || ''}</div>
      <div class="graph-card-icons">
        <button class="icon-btn" onclick="openGraphSettings(${g.id})" title="그래프 설정">⚙</button>
        <button class="icon-btn remove-btn" onclick="removeLiveGraph(${g.id})" title="그래프 삭제">✕</button>
      </div>
    </div>
    <div class="chart-wrap" style="height:160px"><canvas id="liveChart-${g.id}"></canvas></div>
    <div class="merge-drop-hint">다른 그래프를 여기로 드래그하면 합칠 수 있어요</div>`;
}

// ── 설정 팝업 (⚙ 클릭 시 열림) ──────────────────────────
function openGraphSettings(id) {
  const g = liveGraphs.find(x => x.id === id);
  if (!g) return;
  gsCurrentGraphId = id;
  document.getElementById('gsTitleInput').value = g.title || '';
  document.getElementById('gsXMin').value = g.xMin;
  document.getElementById('gsXMax').value = g.xMax;
  document.getElementById('gsXUnit').value = g.xUnit;
  document.getElementById('gsYMin').value = g.yMin;
  document.getElementById('gsYMax').value = g.yMax;
  document.getElementById('gsYUnit').value = g.yUnit;
  document.getElementById('gsTrendToggle').checked = !!g.showTrend;
  renderSettingsSeriesList(g);
  document.getElementById('graphSettingsModal').classList.add('visible');
}

function setTrendVisible(graphId, checked) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g.showTrend = checked;
  updateLiveChart(g);
}

// ── 이미지/데이터 다운로드 ──────────────────────────────
function downloadGraphImage(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  const a = document.createElement('a');
  a.href = g.chart.toBase64Image('image/png', 1);
  a.download = `${g.title || '그래프_' + g.id}.png`;
  a.click();
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadGraphData(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  const keys = [];
  g.series.forEach(s => {
    if (s.xKey && !keys.includes(s.xKey)) keys.push(s.xKey);
    if (s.yKey && !keys.includes(s.yKey)) keys.push(s.yKey);
  });
  if (keys.length === 0) { alert('내보낼 변인이 선택되지 않았습니다. 계열에서 X/Y축을 먼저 골라주세요.'); return; }

  const header = ['timestamp', ...keys];
  const rows = liveScatterPoints
    .filter(p => keys.some(k => k in p))
    .map(p => [p.timestamp || '', ...keys.map(k => (k in p ? p[k] : ''))]);
  if (rows.length === 0) { alert('아직 내보낼 데이터가 없습니다. 실험을 시작해서 값을 받아온 뒤 다시 시도하세요.'); return; }

  const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM: 엑셀에서 한글 안 깨지게
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${g.title || '그래프_' + g.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function closeGraphSettings() {
  document.getElementById('graphSettingsModal').classList.remove('visible');
  gsCurrentGraphId = null;
}

// 모든 계열이 색상+X/Y 선택을 가짐. idx 0(주 계열)은 항상 남아있어야 해서 병합 해제 버튼이 없음.
function renderSettingsSeriesList(g) {
  const keys = [...liveKnownKeys].sort();
  document.getElementById('gsSeriesList').innerHTML = g.series.map((s, idx) => `
    <div class="gs-series-row">
      <input type="color" class="series-color" value="${s.color}" onchange="setSeriesColor(${g.id}, ${s.sid}, this.value)" title="계열 색상">
      <select class="modal-input" onchange="setSeriesKey(${g.id}, ${s.sid}, 'xKey', this.value)"><option value="">X축 변인</option>${buildKeyOptionsHtml(s.xKey, keys)}</select>
      <select class="modal-input" onchange="setSeriesKey(${g.id}, ${s.sid}, 'yKey', this.value)"><option value="">Y축 변인</option>${buildKeyOptionsHtml(s.yKey, keys)}</select>
      ${idx > 0 ? `<button class="gs-remove-series-btn" onclick="removeSeriesFromGraph(${g.id}, ${s.sid})" title="병합 해제">✕</button>` : ''}
    </div>`).join('');
}

function setGraphTitle(graphId, title) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g.title = title;
  updateCardTitleDisplay(g);
}

function setAxisConfig(graphId, field, value) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g[field] = value;
  updateLiveChart(g);
}

function setSeriesColor(graphId, sid, color) {
  const g = liveGraphs.find(x => x.id === graphId);
  const s = g?.series.find(x => x.sid === sid);
  if (!s) return;
  s.color = color;
  updateLiveChart(g);
}

function setSeriesKey(graphId, sid, field, value) {
  const g = liveGraphs.find(x => x.id === graphId);
  const s = g?.series.find(x => x.sid === sid);
  if (!s) return;
  s[field] = value;
  updateLiveChart(g);
}

document.getElementById('graphSettingsCloseBtn').addEventListener('click', closeGraphSettings);

// ── 드래그로 합치기 (앱 다른 곳과 통일된 모달로 확인) ──────────
function attachGraphDragHandlers(g) {
  g.card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(g.id));
    e.dataTransfer.effectAllowed = 'move';
  });
  g.card.addEventListener('dragover', (e) => { e.preventDefault(); g.card.classList.add('drag-over'); });
  g.card.addEventListener('dragleave', () => g.card.classList.remove('drag-over'));
  g.card.addEventListener('drop', (e) => {
    e.preventDefault();
    g.card.classList.remove('drag-over');
    const sourceId = Number(e.dataTransfer.getData('text/plain'));
    const source = liveGraphs.find(x => x.id === sourceId);
    if (!source || sourceId === g.id) return;
    pendingMerge = { sourceId, targetId: g.id };
    document.getElementById('mergeConfirmText').textContent =
      `"${source.title || '그래프 ' + sourceId}"을(를) "${g.title || '그래프 ' + g.id}"에 합치겠습니까? 한 차트에 겹쳐서 표시됩니다.`;
    document.getElementById('graphMergeConfirmModal').classList.add('visible');
  });
}

document.getElementById('mergeConfirmYesBtn').addEventListener('click', () => {
  document.getElementById('graphMergeConfirmModal').classList.remove('visible');
  if (pendingMerge) mergeLiveGraphs(pendingMerge.sourceId, pendingMerge.targetId);
  pendingMerge = null;
});
document.getElementById('mergeConfirmNoBtn').addEventListener('click', () => {
  document.getElementById('graphMergeConfirmModal').classList.remove('visible');
  pendingMerge = null;
});

function mergeLiveGraphs(sourceId, targetId) {
  const srcIdx = liveGraphs.findIndex(x => x.id === sourceId);
  const target = liveGraphs.find(x => x.id === targetId);
  if (srcIdx === -1 || !target) return;
  const source = liveGraphs[srcIdx];

  target.series.push(...source.series);
  source.chart.destroy();
  source.card.remove();
  liveGraphs.splice(srcIdx, 1);

  updateLiveChart(target);
  if (gsCurrentGraphId === target.id) renderSettingsSeriesList(target);
  document.getElementById('addGraphBtn').disabled = liveGraphs.length >= MAX_LIVE_GRAPHS;
}

function removeSeriesFromGraph(graphId, sid) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g || g.series.length <= 1) return;
  g.series = g.series.filter(s => s.sid !== sid);
  updateLiveChart(g);
  if (gsCurrentGraphId === graphId) renderSettingsSeriesList(g);
}

function addLiveGraph() {
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) return;
  const id = ++liveGraphSeq;
  const sid = ++liveSeriesSeq;
  const card = document.createElement('div');
  card.className = 'graph-card';
  card.draggable = true;
  document.getElementById('liveGraphs').appendChild(card);

  const g = { id, card, title: '', xMin: '', xMax: '', xUnit: '', yMin: '', yMax: '', yUnit: '', showTrend: false,
    series: [{ sid, color: liveColorFor(String(sid)), xKey: '', yKey: '' }] };
  renderGraphCard(g);

  g.chart = new Chart(document.getElementById(`liveChart-${id}`), {
    type: 'scatter',
    data: { datasets: [] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false, labels: { color: textColor, boxWidth: 10, font: { size: 9 } } } },
      scales: {
        x: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
        y: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
      } } });

  liveGraphs.push(g);
  refreshLiveSelectOptions();
  updateLiveChart(g);
  attachGraphDragHandlers(g);

  document.getElementById('addGraphBtn').disabled = liveGraphs.length >= MAX_LIVE_GRAPHS;
}

function removeLiveGraph(id) {
  const idx = liveGraphs.findIndex(g => g.id === id);
  if (idx === -1) return;
  if (gsCurrentGraphId === id) closeGraphSettings();
  liveGraphs[idx].chart.destroy();
  liveGraphs[idx].card.remove();
  liveGraphs.splice(idx, 1);
  document.getElementById('addGraphBtn').disabled = liveGraphs.length >= MAX_LIVE_GRAPHS;
}

// 기본 그래프 카드 2개로 시작
addLiveGraph();
addLiveGraph();

let liveSocket = null;
let manualStop = false;   // '실험 종료'로 인한 정상 종료면 true (자동 재접속 안 함)

function connectLiveSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  liveSocket = ws;
  ws.onopen = () => {
    document.getElementById('liveDot').classList.add('on');
    document.getElementById('liveStatusText').textContent = '실험 진행중 (연결됨)';
  };
  ws.onclose = () => {
    document.getElementById('liveDot').classList.remove('on');
    if (manualStop) return;   // 사용자가 '실험 종료'를 눌러서 끊은 거면 재접속 시도 안 함
    document.getElementById('liveStatusText').textContent = '재연결 시도중…';
    setTimeout(connectLiveSocket, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    const payload = JSON.parse(evt.data);
    let newKey = false;
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'timestamp' || k === '_source') continue;
      if (typeof v !== 'number' && typeof v !== 'string') continue;
      liveLatest[k] = { value: v, timestamp: payload.timestamp || new Date().toISOString() };
      if (!liveKnownKeys.has(k)) { liveKnownKeys.add(k); newKey = true; }
    }
    liveScatterPoints.push(payload);
    if (liveScatterPoints.length > LIVE_MAX_POINTS) liveScatterPoints.shift();
    renderSensorGrid();
    if (newKey) refreshLiveSelectOptions();
    updateAllLiveCharts();

    applyLiveSensorEffects();
  };
}

// ── 센서 키 → 3D 아크릴 효과 매핑 ────────────────────────────
// 키 이름이 아래 이름과 "정확히 일치"해야 매칭됨 (대소문자 무관, 부분 포함은 매칭 안 됨).
// 예: "water_temp"는 값은 온도여도 이름이 다르므로 3D 효과에는 연결되지 않음(카드/그래프에는 정상 표시).
// 여기 등록 안 된 센서는 카드/그래프에는 정상적으로 뜨지만 3D 효과는 없음(에러 없이 그냥 무시됨).
// 새 효과를 추가하려면: 1) 여기 매핑 추가  2) common.js의 applyState()에서 S.state.xxx를 실제로 사용하는 로직 추가
const sensorEffectMap = {
  co2: (value) => {
    sceneLive.state.co2 = Math.max(CO2_MIN, Math.min(CO2_MAX, value));
  },
  // common.js의 applyState()가 이미 ph(해양 산성화/물색)·temp(빙하 축소)·hum(응결 물방울)을
  // 전부 처리하고 있어서 바로 활성화 - 예시 주석이 아니라 실제 동작하는 매핑임
  ph: (value) => {
    sceneLive.state.ph = Math.max(PH_MIN, Math.min(PH_MAX, value));
  },
  temp: (value) => {
    sceneLive.state.tmp = Math.max(TMP_MIN, Math.min(TMP_MAX, value));
  },
  hum: (value) => {
    sceneLive.state.hum = Math.max(HUM_MIN, Math.min(HUM_MAX, value));
  },
  // 학생들이 "methane"과 "ch4" 둘 다 자주 쓰므로 두 이름 다 인식
  methane: (value) => {
    sceneLive.state.methane = Math.max(CH4_MIN, Math.min(CH4_MAX, value));
  },
  ch4: (value) => {
    sceneLive.state.methane = Math.max(CH4_MIN, Math.min(CH4_MAX, value));
  },
};

// ── 센서 카드에서 실험자가 직접 지정한 "역할" (키 이름과 무관하게 3D 효과 연결) ──
// 예: 온도 센서가 2개(temp1=기온, temp2=수온)면 이름만으론 구분이 안 되니
// 실험자가 카드의 드롭다운으로 "이 값은 기온/수온이다"를 직접 지정한다.
// 수온은 아직 전용 3D 효과가 없어서 기온과 동일하게 처리(TODO: 수온 전용 효과 추가 시 분리).
const sensorRoles = {}; // { [센서 키]: roleId }
const sensorRoleOptions = [
  { id: '', label: '자동' },
  { id: 'air_temp', label: '기온' },
  { id: 'water_temp', label: '수온' },
  { id: 'co2', label: 'CO2' },
  { id: 'ph', label: 'pH' },
  { id: 'hum', label: '습도' },
  { id: 'methane', label: '메탄' },
];
const roleToEffectKey = { air_temp: 'temp', water_temp: 'temp', co2: 'co2', ph: 'ph', hum: 'hum', methane: 'methane' };

function applyLiveSensorEffects() {
  let matched = false;
  const usedEffectKeys = new Set();

  // 1) 실험자가 역할을 직접 지정한 키가 우선 (이름이 뭐든 상관없이 적용)
  for (const [key, role] of Object.entries(sensorRoles)) {
    const effectKey = roleToEffectKey[role];
    const d = liveLatest[key];
    if (!effectKey || usedEffectKeys.has(effectKey) || !d || typeof d.value !== 'number') continue;
    sensorEffectMap[effectKey](d.value);
    usedEffectKeys.add(effectKey);
    matched = true;
  }

  // 2) 역할이 지정 안 된 키는 기존처럼 키 이름 정확 일치로 자동 인식
  for (const [effectKey, applyEffect] of Object.entries(sensorEffectMap)) {
    if (usedEffectKeys.has(effectKey)) continue;
    const matchedKey = [...liveKnownKeys].find(k => !sensorRoles[k] && k.toLowerCase() === effectKey);
    if (matchedKey && typeof liveLatest[matchedKey].value === 'number') {
      applyEffect(liveLatest[matchedKey].value);
      matched = true;
    }
  }

  if (matched) applyState(sceneLive);
}

// ── 실험 시작/종료 + 안내 모달 ──────────────────────────
// '다시 보지 않기'는 이번 실험(시작~종료) 동안에만 유효한 메모리 플래그.
// '실험 종료'를 누르면 초기화되므로, 다음에 '실험 시작'을 누르면 안내 모달이 다시 뜬다.
let experimentRunning = false;
let modalDismissedThisRun = false;

function resetLiveData() {
  Object.keys(liveLatest).forEach(k => delete liveLatest[k]);
  liveKnownKeys.clear();
  liveScatterPoints = [];
  Object.keys(sensorRoles).forEach(k => delete sensorRoles[k]);
  document.getElementById('sensorGrid').innerHTML =
    '<div class="empty-hint">\'실험 시작\' 버튼을 누르면 연결이 시작됩니다.<br>server.py가 실행 중이어야 연결됩니다.</div>';
  refreshLiveSelectOptions();
  updateAllLiveCharts();
}

function showLiveFormatModal() {
  document.getElementById('liveFormatModal').classList.add('visible');
}

function beginExperimentSession() {
  resetLiveData();
  manualStop = false;
  connectLiveSocket();
  experimentRunning = true;
  document.getElementById('startExperimentBtn').disabled = true;
  document.getElementById('endExperimentBtn').disabled = false;
  document.getElementById('liveStatusText').textContent = '연결 시도중…';
}

function startExperiment() {
  if (experimentRunning) return;
  if (modalDismissedThisRun) {
    beginExperimentSession();
  } else {
    showLiveFormatModal();
  }
}

function endExperiment() {
  if (!experimentRunning) return;
  manualStop = true;
  if (liveSocket) liveSocket.close();
  experimentRunning = false;
  modalDismissedThisRun = false;   // 다음 실험 시작 때 안내 모달이 다시 뜨도록 초기화
  document.getElementById('liveDot').classList.remove('on');
  document.getElementById('liveStatusText').textContent = '실험 종료됨';
  document.getElementById('startExperimentBtn').disabled = false;
  document.getElementById('endExperimentBtn').disabled = true;
}

document.getElementById('modalCloseBtn').addEventListener('click', () => {
  const dontShow = document.getElementById('dontShowAgain').checked;
  if (dontShow) modalDismissedThisRun = true;
  document.getElementById('liveFormatModal').classList.remove('visible');
  beginExperimentSession();
});

document.getElementById('startExperimentBtn').addEventListener('click', startExperiment);
document.getElementById('endExperimentBtn').addEventListener('click', endExperiment);

// ── 기본 실험: 1)보드 선택 → 2)센서 다중선택(체크박스) → 3)회로도·코드 상세 ──────
// basic_experiments/index.json(서버가 폴더 스캔해서 자동 생성, {id,title,board,sensors:[]}[])
// → basic_experiments/<id>/info.json + code.ino → 상세 (핀맵/사양은 info.json에 텍스트로 기재)
// 폴더 하나 = 보드 하나 + 센서 조합 하나(복수 가능, 예: ["TMP36","SCD30"]).
// 체크한 센서 집합과 폴더의 sensors 배열이 "정확히 일치"하는 폴더만 결과로 보여줌
// (부분 포함 매칭 X — 학생이 실제로 가진 센서 구성과 다른 코드를 잘못 받는 걸 방지).
let basicExpIndexCache = null;
let basicExpSelectedBoard = null;
let basicExpBoardExps = [];

async function openBasicExpBoards() {
  document.getElementById('basicExpBoardModal').classList.add('visible');
  if (basicExpIndexCache) { renderBasicExpBoards(); return; }
  try {
    const res = await fetch('/basic_experiments/index.json');
    basicExpIndexCache = await res.json();
    renderBasicExpBoards();
  } catch (e) {
    document.getElementById('basicExpBoardList').innerHTML =
      '<div class="empty-hint">목록을 불러오지 못했습니다. server.py가 실행 중인지 확인하세요.</div>';
  }
}

function renderBasicExpBoards() {
  const boards = [...new Set(basicExpIndexCache.map(exp => exp.board))];
  const wrap = document.getElementById('basicExpBoardList');
  wrap.innerHTML = boards.map(board => `
    <button class="basic-exp-card" data-board="${board}">
      <div class="title">${board}</div>
    </button>`).join('');
  wrap.querySelectorAll('.basic-exp-card').forEach(card => {
    card.addEventListener('click', () => openBasicExpSensors(card.dataset.board));
  });
}

function openBasicExpSensors(board) {
  basicExpSelectedBoard = board;
  basicExpBoardExps = basicExpIndexCache.filter(exp => exp.board === board);
  document.getElementById('basicExpSensorBoardLabel').textContent = `선택한 보드: ${board}`;

  const allTags = [...new Set(basicExpBoardExps.flatMap(exp => exp.sensors))].sort();
  document.getElementById('basicExpSensorChecks').innerHTML = allTags.length > 0
    ? allTags.map(tag => `
      <label class="basic-exp-sensor-check">
        <input type="checkbox" value="${tag}" onchange="renderBasicExpSensorMatches()"> ${tag}
      </label>`).join('')
    : '<div class="empty-hint">이 보드에는 아직 특정 센서로 등록된 코드가 없습니다. 아래는 일반 연결 예시입니다.</div>';

  renderBasicExpSensorMatches();
  document.getElementById('basicExpBoardModal').classList.remove('visible');
  document.getElementById('basicExpSensorModal').classList.add('visible');
}

function sameSensorSet(a, b) {
  return a.length === b.length && a.every(x => b.includes(x));
}

function renderBasicExpSensorMatches() {
  const checked = [...document.querySelectorAll('#basicExpSensorChecks input:checked')].map(el => el.value);
  const matches = basicExpBoardExps.filter(exp => sameSensorSet(exp.sensors, checked));
  const wrap = document.getElementById('basicExpSensorList');

  if (matches.length === 0) {
    wrap.innerHTML = `<div class="empty-hint">${checked.length === 0
      ? '체크한 것 없이도 이 조합의 일반 연결 예시가 없습니다.'
      : '이 센서 조합의 코드가 아직 준비되지 않았습니다.'}</div>`;
    return;
  }
  wrap.innerHTML = matches.map(exp => `
    <button class="basic-exp-card" data-id="${exp.id}">
      <div class="title">${exp.title}</div>
    </button>`).join('');
  wrap.querySelectorAll('.basic-exp-card').forEach(card => {
    card.addEventListener('click', () => openBasicExpDetail(card.dataset.id));
  });
}

async function openBasicExpDetail(id) {
  const [info, code] = await Promise.all([
    fetch(`/basic_experiments/${id}/info.json`).then(r => r.json()),
    fetch(`/basic_experiments/${id}/code.ino`).then(r => r.text()),
  ]);

  document.getElementById('basicExpTitle').textContent = info.title;
  document.getElementById('basicExpMeta').innerHTML = '';
  document.getElementById('basicExpSummary').textContent = info.summary;
  document.getElementById('basicExpCode').textContent = code;

  const notesBtn = document.getElementById('basicExpNotesBtn');
  if (info.notes && info.notes.length > 0) {
    document.getElementById('basicExpNotesModalList').innerHTML = info.notes.map(n => `<li>${n}</li>`).join('');
    notesBtn.style.display = '';
  } else {
    notesBtn.style.display = 'none';
  }

  const codeInfoBtn = document.getElementById('basicExpCodeInfoBtn');
  if (info.codeInfo) {
    const ci = info.codeInfo;
    const rows = [
      ['설명', ci.description],
      ['필요 라이브러리', ci.libraries],
      ['데이터 출력 간격', ci.sendInterval],
      ['데이터 측정 간격', ci.measureInterval],
      ['통신 끊김/실패 시', ci.onFailure],
    ].filter(([, v]) => v);
    document.getElementById('basicExpCodeInfoContent').innerHTML =
      `<table class="pinmap-table"><tbody>${rows.map(([l, v]) => `<tr><th>${l}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
    codeInfoBtn.style.display = '';
  } else {
    codeInfoBtn.style.display = 'none';
  }

  const specBtn = document.getElementById('basicExpSpecBtn');
  if (info.specs && info.specs.length > 0) {
    document.getElementById('basicExpSpecModalContent').innerHTML = info.specs.map(group => `
      <div class="pinmap-device-title">${group.device}</div>
      <table class="pinmap-table">
        <tbody>${group.items.map(it => `<tr><th>${it.label}</th><td>${it.value}</td></tr>`).join('')}</tbody>
      </table>`).join('');
    specBtn.style.display = '';
  } else {
    specBtn.style.display = 'none';
  }

  const pinmapSection = document.getElementById('basicExpPinmapSection');
  if (info.pinmap && info.pinmap.length > 0) {
    document.getElementById('basicExpPinmaps').innerHTML = info.pinmap.map(group => `
      <div class="pinmap-device-title">${group.device}</div>
      <table class="pinmap-table">
        <thead><tr><th>보드</th><th>${group.device}</th></tr></thead>
        <tbody>${group.pins.map(p => `<tr><td>${p.board}</td><td>${p.device}</td></tr>`).join('')}</tbody>
      </table>`).join('');
    pinmapSection.style.display = '';
  } else {
    pinmapSection.style.display = 'none';
  }

  const downloadBtn = document.getElementById('basicExpDownloadBtn');
  downloadBtn.href = `/basic_experiments/${id}/${info.code_file}`;
  downloadBtn.download = `${id}.ino`;

  document.getElementById('basicExpSensorModal').classList.remove('visible');
  document.getElementById('basicExpDetailModal').classList.add('visible');
}

document.getElementById('basicExpCopyBtn').addEventListener('click', async () => {
  const btn = document.getElementById('basicExpCopyBtn');
  try {
    await navigator.clipboard.writeText(document.getElementById('basicExpCode').textContent);
    const original = btn.textContent;
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch (e) {
    btn.textContent = '복사 실패 (직접 선택해서 복사해주세요)';
  }
});

document.getElementById('basicExperimentsBtn').addEventListener('click', openBasicExpBoards);
document.getElementById('basicExpBoardCloseBtn').addEventListener('click', () => {
  document.getElementById('basicExpBoardModal').classList.remove('visible');
});
document.getElementById('basicExpSensorBackBtn').addEventListener('click', () => {
  document.getElementById('basicExpSensorModal').classList.remove('visible');
  document.getElementById('basicExpBoardModal').classList.add('visible');
});
document.getElementById('basicExpDetailBackBtn').addEventListener('click', () => {
  document.getElementById('basicExpDetailModal').classList.remove('visible');
  if (basicExpSelectedBoard) openBasicExpSensors(basicExpSelectedBoard);
  else document.getElementById('basicExpBoardModal').classList.add('visible');
});
document.getElementById('basicExpSpecBtn').addEventListener('click', () => {
  document.getElementById('basicExpSpecModal').classList.add('visible');
});
document.getElementById('basicExpSpecCloseBtn').addEventListener('click', () => {
  document.getElementById('basicExpSpecModal').classList.remove('visible');
});
document.getElementById('basicExpCodeInfoBtn').addEventListener('click', () => {
  document.getElementById('basicExpCodeInfoModal').classList.add('visible');
});
document.getElementById('basicExpCodeInfoCloseBtn').addEventListener('click', () => {
  document.getElementById('basicExpCodeInfoModal').classList.remove('visible');
});
document.getElementById('basicExpNotesBtn').addEventListener('click', () => {
  document.getElementById('basicExpNotesModal').classList.add('visible');
});
document.getElementById('basicExpNotesCloseBtn').addEventListener('click', () => {
  document.getElementById('basicExpNotesModal').classList.remove('visible');
});
