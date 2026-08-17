// ================= 실시간 실험 탭 (아두이노 WebSocket 연동) =================
const sceneLive = buildAcrylicScene();

const liveLatest = {};
const liveKnownKeys = new Set();
let liveScatterPoints = [];
let sessionStartTime = null; // 첫 데이터 수신 시각(ms) - "경과 시간" X축의 0초 기준점
const LIVE_MAX_POINTS = 200;
const liveColorRamp = ['#5DCAA5', '#EF9F27', '#E24B4A', '#85B7EB', '#c07fe0', '#8fd83c'];
function liveColorFor(key) {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return liveColorRamp[hash % liveColorRamp.length];
}

// ── 연결/데이터 상태 배너 (센서 카드 영역 맨 위) ──────────────────
// 웹소켓이 열려도 보드 쪽 코드/배선이 잘못됐으면 데이터가 안 올 수 있고,
// 한동안 잘 오다가 케이블이 빠지는 등으로 끊길 수도 있어서 세 가지 상태를 구분해서 보여준다.
const LIVE_STALE_MS = 5000; // 이 시간 넘게 새 데이터가 안 오면 "전송 끊김"으로 간주
let lastDataAt = 0;

function connectionStatusHtml() {
  if (!experimentRunning) {
    return '<div class="empty-hint">\'실험 시작\' 버튼을 누르면 연결이 시작됩니다.<br>server.py가 실행 중이어야 연결됩니다.</div>';
  }
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
    return '<div class="conn-status-hint error">🔴 연결 안 됨 — server.py가 실행 중인지, 보드 연결 상태를 확인하세요.</div>';
  }
  if (liveKnownKeys.size === 0) {
    return '<div class="conn-status-hint warn">🟡 데이터 수신 안 됨 — 연결은 됐지만 아직 센서 값이 안 옵니다. 보드 코드·배선을 확인하세요.</div>';
  }
  if (lastDataAt && Date.now() - lastDataAt > LIVE_STALE_MS) {
    const sec = Math.floor((Date.now() - lastDataAt) / 1000);
    return `<div class="conn-status-hint warn">🟠 데이터 전송 끊김 — 마지막 수신 ${sec}초 전. 케이블·전원을 확인하세요.</div>`;
  }
  return '';
}

function renderSensorGrid() {
  const grid = document.getElementById('sensorGrid');
  const keys = [...liveKnownKeys].sort();
  const cardsHtml = keys.map(k => {
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
  grid.innerHTML = connectionStatusHtml() + cardsHtml;
}

// 새 데이터가 안 와도(=onmessage가 안 불려도) 끊김을 감지할 수 있도록 주기적으로 상태만 다시 그림
setInterval(() => { if (experimentRunning) renderSensorGrid(); }, 1000);

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

// X축은 "경과 시간"도 고를 수 있게 함 (센서값 vs 센서값 상관관계 그래프뿐 아니라,
// CO2 농도처럼 하나의 값이 시간에 따라 어떻게 변하는지 보는 그래프도 필요해서).
// 실제 센서 키가 아니라서 liveScatterPoints의 timestamp로부터 계산해 만들어내는 가상의 축.
const TIME_AXIS_KEY = '__time__';
const TIME_AXIS_LABEL = '경과 시간';

function buildKeyOptionsHtml(selectedKey, keys) {
  return keys.map(k => `<option value="${k}"${k === selectedKey ? ' selected' : ''}>${k}</option>`).join('');
}

function buildXKeyOptionsHtml(selectedKey, keys) {
  const timeOption = `<option value="${TIME_AXIS_KEY}"${selectedKey === TIME_AXIS_KEY ? ' selected' : ''}>${TIME_AXIS_LABEL} (초)</option>`;
  return timeOption + buildKeyOptionsHtml(selectedKey, keys);
}

// 새 센서 키가 들어오면 주 계열(series[0])에 기본값으로 자동 배정 (병합으로 늘어난 계열은 사용자가 직접 골라야 함).
// 센서가 1개뿐이면 "센서 vs 센서"로 짝지을 두 번째 값이 없으므로, 그 하나뿐인 값을
// "경과 시간에 따른 변화"로 자동으로 그려준다(실험실에서 가장 흔히 필요한 형태).
function refreshLiveSelectOptions() {
  const keys = [...liveKnownKeys].sort();
  liveGraphs.forEach(g => {
    const primary = g.series[0];
    if (!primary.xKey && keys.length === 1) { primary.xKey = TIME_AXIS_KEY; primary.yKey = keys[0]; }
    else if (!primary.xKey && keys[0]) primary.xKey = keys[0];
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
    const isTimeX = s.xKey === TIME_AXIS_KEY;
    const data = (s.xKey && s.yKey)
      ? liveScatterPoints.filter(p => (isTimeX || s.xKey in p) && s.yKey in p).map(p => ({
          x: isTimeX ? (new Date(p.timestamp).getTime() - sessionStartTime) / 1000 : p[s.xKey],
          y: p[s.yKey],
        }))
      : [];
    const xLabelPart = isTimeX ? TIME_AXIS_LABEL : s.xKey;
    return { label: s.xKey && s.yKey ? `${xLabelPart} / ${s.yKey}` : '(선택 안 됨)', data,
      backgroundColor: s.color, borderColor: s.color, pointRadius: 3, showLine: true, borderWidth: 1,
      hidden: s.visible === false };
  });

  if (g.showTrend) {
    g.series.forEach((s, idx) => {
      let pts = g.chart.data.datasets[idx].data;
      // 추세선 구간을 지정했으면(빈 값이면 전체 데이터) 그 X 범위 안의 점만 회귀에 사용
      if (g.trendXMin !== '' && g.trendXMin != null) pts = pts.filter(p => p.x >= Number(g.trendXMin));
      if (g.trendXMax !== '' && g.trendXMax != null) pts = pts.filter(p => p.x <= Number(g.trendXMax));
      const reg = linearRegression(pts);
      if (!reg) return;
      const xs = pts.map(p => p.x);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      g.chart.data.datasets.push({
        label: `추세선 (기울기 ${reg.slope.toFixed(3)}, R²=${reg.r2.toFixed(3)})`,
        data: [{ x: xMin, y: reg.slope * xMin + reg.intercept }, { x: xMax, y: reg.slope * xMax + reg.intercept }],
        borderColor: s.color, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, showLine: true, fill: false,
      });
    });
  }

  const xLabel = xKeys.map(k => k === TIME_AXIS_KEY ? TIME_AXIS_LABEL : k).join(' / ') || 'X축 변인';
  const yLabel = yKeys.join(' / ') || 'Y축 변인';
  g.chart.options.scales.x.title.text = g.xUnit ? `${xLabel} (${g.xUnit})` : xLabel;
  g.chart.options.scales.y.title.text = g.yUnit ? `${yLabel} (${g.yUnit})` : yLabel;
  // 자동 스케일이면 min/max를 아예 안 넘겨서 Chart.js가 매 update마다 데이터 범위로 다시 계산하게 둔다
  g.chart.options.scales.x.min = (!g.xAuto && g.xMin !== '') ? Number(g.xMin) : undefined;
  g.chart.options.scales.x.max = (!g.xAuto && g.xMax !== '') ? Number(g.xMax) : undefined;
  g.chart.options.scales.y.min = (!g.yAuto && g.yMin !== '') ? Number(g.yMin) : undefined;
  g.chart.options.scales.y.max = (!g.yAuto && g.yMax !== '') ? Number(g.yMax) : undefined;
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
        <button class="icon-btn" onclick="openGraphZoom(${g.id})" title="크게 보기">⛶</button>
        <button class="icon-btn" onclick="openGraphSettings(${g.id})" title="그래프 설정">⚙</button>
        <button class="icon-btn remove-btn" onclick="removeLiveGraph(${g.id})" title="그래프 삭제">✕</button>
      </div>
    </div>
    <div class="chart-wrap" style="height:230px"><canvas id="liveChart-${g.id}"></canvas></div>
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
  document.getElementById('gsXAuto').checked = g.xAuto !== false;
  document.getElementById('gsYAuto').checked = g.yAuto !== false;
  document.getElementById('gsXMin').disabled = document.getElementById('gsXMax').disabled = g.xAuto !== false;
  document.getElementById('gsYMin').disabled = document.getElementById('gsYMax').disabled = g.yAuto !== false;
  document.getElementById('gsTrendToggle').checked = !!g.showTrend;
  document.getElementById('gsTrendXMin').value = g.trendXMin;
  document.getElementById('gsTrendXMax').value = g.trendXMax;
  renderSettingsSeriesList(g);
  document.getElementById('graphSettingsModal').classList.add('visible');
}

function setAxisAuto(graphId, axis, checked) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g[axis + 'Auto'] = checked;
  document.getElementById(axis === 'x' ? 'gsXMin' : 'gsYMin').disabled = checked;
  document.getElementById(axis === 'x' ? 'gsXMax' : 'gsYMax').disabled = checked;
  updateLiveChart(g);
}

// ── 그래프 크게 보기 (⛶ 클릭 시) ──────────────────────────
// 별도 Chart 인스턴스를 새로 만들지 않고, 카드에 있던 canvas(=차트 인스턴스)를 그대로
// 모달 안으로 옮겼다가 닫을 때 원래 자리로 되돌린다 - 데이터/설정을 복제·동기화할 필요가 없어서 간단하고 항상 최신 상태.
let zoomOriginalParent = null;
let zoomGraphId = null;

function openGraphZoom(id) {
  const g = liveGraphs.find(x => x.id === id);
  if (!g) return;
  const canvas = document.getElementById(`liveChart-${id}`);
  const zoomWrap = document.getElementById('zoomChartWrap');
  document.getElementById('zoomTitle').textContent = g.title || `그래프 ${g.id}`;
  // 모달을 먼저 보이게 한 다음에 canvas를 옮기고 resize해야 한다. 순서가 바뀌면(모달이
  // display:none인 상태에서 resize) 옮길 컨테이너 크기가 0으로 측정돼서 차트가 새까맣게
  // 깨져서 보이는 문제가 있었다.
  document.getElementById('graphZoomModal').classList.add('visible');
  // 이미 이 canvas가 확대 모달 안에 있으면(예: 확대 상태에서 ⚙설정 → 구간 드래그 선택으로
  // openGraphZoom이 다시 불리는 경우) 원래 자리를 다시 기록하면 안 된다 - 그러면 원래 자리가
  // 모달 자신으로 덮어써져서 나중에 closeGraphZoom이 canvas를 카드로 못 돌려보낸다.
  if (canvas.parentElement !== zoomWrap) {
    zoomOriginalParent = canvas.parentElement;
    zoomGraphId = id;
    zoomWrap.appendChild(canvas);
    g.chart.resize();
  }
}

function closeGraphZoom() {
  document.getElementById('graphZoomModal').classList.remove('visible');
  const g = liveGraphs.find(x => x.id === zoomGraphId);
  if (g && zoomOriginalParent) {
    zoomOriginalParent.appendChild(document.getElementById(`liveChart-${zoomGraphId}`));
    g.chart.resize();
  }
  zoomOriginalParent = null;
  zoomGraphId = null;
}

document.getElementById('zoomCloseBtn').addEventListener('click', () => {
  if (trendRangeSelectGraphId != null) finishTrendRangeSelect(false);
  else closeGraphZoom();
});
document.getElementById('zoomClearMarksBtn').addEventListener('click', () => {
  if (zoomGraphId != null) clearGraphMarks(zoomGraphId);
});

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
    if (s.xKey && s.xKey !== TIME_AXIS_KEY && !keys.includes(s.xKey)) keys.push(s.xKey);
    if (s.yKey && !keys.includes(s.yKey)) keys.push(s.yKey);
  });
  if (keys.length === 0) { alert('내보낼 변인이 선택되지 않았습니다. 계열에서 X/Y축을 먼저 골라주세요.'); return; }
  // "경과 시간" X축은 실제 필드가 아니라 timestamp에서 계산해서 그리는 값이라 여기 keys엔 안 넣음
  // (CSV엔 이미 timestamp 절대시각 컬럼이 있어서, 필요하면 거기서 경과 시간을 계산할 수 있음).

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
      <select class="modal-input" onchange="setSeriesKey(${g.id}, ${s.sid}, 'xKey', this.value)"><option value="">X축 변인</option>${buildXKeyOptionsHtml(s.xKey, keys)}</select>
      <select class="modal-input" onchange="setSeriesKey(${g.id}, ${s.sid}, 'yKey', this.value)"><option value="">Y축 변인</option>${buildKeyOptionsHtml(s.yKey, keys)}</select>
      <button class="gs-remove-series-btn" onclick="toggleSeriesVisible(${g.id}, ${s.sid})" title="${s.visible === false ? '표시하기' : '숨기기'}">${s.visible === false ? '🚫' : '👁'}</button>
      ${idx > 0 ? `<button class="gs-remove-series-btn" onclick="splitSeriesToNewGraph(${g.id}, ${s.sid})" title="별도 그래프로 분리">⇱</button>` : ''}
      ${idx > 0 ? `<button class="gs-remove-series-btn" onclick="removeSeriesFromGraph(${g.id}, ${s.sid})" title="계열 삭제">✕</button>` : ''}
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

// 합쳤던 계열을 다시 독립된 그래프 카드로 되돌린다 (병합의 반대 동작).
function splitSeriesToNewGraph(graphId, sid) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g || g.series.length <= 1) return;
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) {
    alert(`그래프는 최대 ${MAX_LIVE_GRAPHS}개까지만 만들 수 있어요. 다른 그래프를 먼저 지우거나 합쳐주세요.`);
    return;
  }
  const idx = g.series.findIndex(s => s.sid === sid);
  if (idx === -1) return;
  const [moved] = g.series.splice(idx, 1);
  moved.visible = true;

  const newG = createGraphObject([moved]);
  updateLiveChart(newG);
  updateLiveChart(g);
  if (gsCurrentGraphId === g.id) renderSettingsSeriesList(g);
}

// ── 계열 표시/숨기기 (범례 클릭 또는 설정 팝업의 눈 아이콘) ──────────────
// Chart.js 기본 범례 클릭도 비슷하게 동작하긴 하지만, 매 데이터 수신마다 datasets
// 배열을 통째로 새로 만들어서 넘기기 때문에(updateLiveChart) 내부 캐시에 기대지 않고
// s.visible 값을 직접 관리해야 새로고침 때마다 숨김 상태가 안 풀린다.
function toggleSeriesVisible(graphId, sid) {
  const g = liveGraphs.find(x => x.id === graphId);
  const s = g?.series.find(x => x.sid === sid);
  if (!s) return;
  s.visible = s.visible === false ? true : false;
  updateLiveChart(g);
  if (gsCurrentGraphId === graphId) renderSettingsSeriesList(g);
}

function legendClickHandler(evt, item, legend) {
  const chart = legend.chart;
  const g = liveGraphs.find(x => x.chart === chart);
  const s = g?.series[item.datasetIndex];
  if (g && s) { toggleSeriesVisible(g.id, s.sid); return; }
  // 추세선 등 series에 안 걸리는 계열은 Chart.js 기본 토글 동작 그대로 사용
  const meta = chart.getDatasetMeta(item.datasetIndex);
  meta.hidden = meta.hidden === null ? !chart.data.datasets[item.datasetIndex].hidden : null;
  chart.update();
}

// ── 클릭한 지점에 (x, y) 값을 표시하는 마크 찍기 ──────────────
// 별도 데이터셋이 아니라 캔버스에 직접 그리는 커스텀 플러그인으로 구현 - 그래야
// 실시간으로 datasets가 계속 새로 그려져도(updateLiveChart) 마크가 안 사라진다.
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2);
}

const markPointPlugin = {
  id: 'markPoints',
  afterDatasetsDraw(chart) {
    const g = liveGraphs.find(x => x.chart === chart);
    if (!g || !g.marks || g.marks.length === 0) return;
    const { ctx, scales } = chart;
    if (!scales.x || !scales.y) return;
    ctx.save();
    g.marks.forEach(m => {
      const px = scales.x.getPixelForValue(m.x);
      const py = scales.y.getPixelForValue(m.y);
      ctx.strokeStyle = '#E24B4A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 5, py - 5); ctx.lineTo(px + 5, py + 5);
      ctx.moveTo(px - 5, py + 5); ctx.lineTo(px + 5, py - 5);
      ctx.stroke();
      const label = `(${fmtNum(m.x)}, ${fmtNum(m.y)})`;
      ctx.font = '11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(20,23,28,0.88)';
      ctx.fillRect(px + 7, py - 17, tw + 8, 15);
      ctx.fillStyle = '#eee';
      ctx.fillText(label, px + 11, py - 6);
    });
    ctx.restore();
  }
};
Chart.register(markPointPlugin);

function chartClickHandler(evt, elements, chart) {
  const g = liveGraphs.find(x => x.chart === chart);
  if (!g) return;
  if (trendRangeSelectGraphId === g.id) return; // 구간 드래그 선택 중엔 마크 찍기 비활성화
  g.marks = g.marks || [];

  // 이미 찍힌 마크를 다시 클릭하면(X자 표시 근처) 새로 찍는 대신 그 마크만 지운다
  const hitIdx = g.marks.findIndex(m => {
    const px = chart.scales.x.getPixelForValue(m.x);
    const py = chart.scales.y.getPixelForValue(m.y);
    return Math.hypot(evt.x - px, evt.y - py) <= 10;
  });
  if (hitIdx !== -1) {
    g.marks.splice(hitIdx, 1);
    chart.update('none');
    return;
  }

  const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
  if (points.length === 0) return;
  const p = points[0];
  const data = chart.data.datasets[p.datasetIndex]?.data[p.index];
  if (!data) return;
  g.marks.push({ x: data.x, y: data.y });
  chart.update('none');
}

function clearGraphMarks(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g.marks = [];
  g.chart.update('none');
}

// ── 추세선 구간을 숫자로 직접 입력하는 대신, 확대 그래프에서 골라 찍는 기능 ──
// 그래프 설정 팝업을 잠깐 닫고 확대 모달을 띄운 뒤, 첫 클릭으로 구간 시작을, 두 번째
// 클릭으로 구간 끝을 찍으면(누르고 있는 드래그가 아니라 클릭-클릭 방식) 다시 설정
// 팝업으로 돌아가서 구간 시작/끝 입력칸에 값이 채워져 있게 한다.
// (처음엔 마우스를 누른 채로 끄는 드래그로 만들었는데, 두 번째 클릭이 매번 mousedown을
// 새로 발생시켜서 시작점이 계속 새 위치로 리셋되는 바람에 끝점이 찍히지 않는 버그가 있었다.)
let trendRangeSelectGraphId = null;
let rangeSelectDrag = null; // { startPx, currentPx, locked } - 캔버스 기준 픽셀 좌표. locked=true면 끝점까지 확정된 상태

const rangeSelectPlugin = {
  id: 'rangeSelect',
  afterDraw(chart) {
    const g = liveGraphs.find(x => x.chart === chart);
    if (!g || g.id !== trendRangeSelectGraphId || !rangeSelectDrag) return;
    const { ctx, chartArea } = chart;
    const x1 = Math.max(chartArea.left, Math.min(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    const x2 = Math.min(chartArea.right, Math.max(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    ctx.save();
    ctx.fillStyle = 'rgba(93,202,165,0.18)';
    ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
    ctx.strokeStyle = '#5DCAA5';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
};
Chart.register(rangeSelectPlugin);

function rangeSelectPxToX(g, px) {
  return g.chart.scales.x.getValueForPixel(px);
}

function trendRangeCanvasClick(e) {
  const g = liveGraphs.find(x => x.id === trendRangeSelectGraphId);
  if (!g) return;
  const rect = g.chart.canvas.getBoundingClientRect();
  const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  if (!rangeSelectDrag || rangeSelectDrag.locked) {
    // 첫 클릭(또는 이미 구간을 찍은 뒤 다시 클릭해서 새로 고르기 시작)
    rangeSelectDrag = { startPx: px, currentPx: px, locked: false };
    document.getElementById('rangeSelectText').textContent = '이제 구간의 끝 지점을 클릭하세요';
  } else {
    // 두 번째 클릭 - 끝점 확정
    rangeSelectDrag.currentPx = px;
    rangeSelectDrag.locked = true;
    const xMinVal = rangeSelectPxToX(g, Math.min(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    const xMaxVal = rangeSelectPxToX(g, Math.max(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    document.getElementById('rangeSelectText').textContent =
      `구간: ${fmtNum(xMinVal)} ~ ${fmtNum(xMaxVal)} · 확인을 누르면 적용됩니다 (다시 클릭하면 새로 선택)`;
  }
  g.chart.update('none');
}

function trendRangeMouseMove(e) {
  if (!rangeSelectDrag || rangeSelectDrag.locked) return; // 시작점만 찍힌 상태에서만 끝점 미리보기가 마우스를 따라다님
  const g = liveGraphs.find(x => x.id === trendRangeSelectGraphId);
  if (!g) return;
  const rect = g.chart.canvas.getBoundingClientRect();
  rangeSelectDrag.currentPx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  g.chart.update('none');
  const xMinVal = rangeSelectPxToX(g, Math.min(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
  const xMaxVal = rangeSelectPxToX(g, Math.max(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
  document.getElementById('rangeSelectText').textContent = `${fmtNum(xMinVal)} ~ ${fmtNum(xMaxVal)} (끝 지점을 클릭하세요)`;
}

function startTrendRangeSelect(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  document.getElementById('graphSettingsModal').classList.remove('visible');
  trendRangeSelectGraphId = graphId;
  rangeSelectDrag = null;
  openGraphZoom(graphId);
  document.getElementById('rangeSelectBar').style.display = 'flex';
  document.getElementById('rangeSelectText').textContent = '그래프 위를 클릭해서 구간 시작 지점을 찍으세요';
  g.chart.canvas.addEventListener('click', trendRangeCanvasClick);
  window.addEventListener('mousemove', trendRangeMouseMove);
}

function finishTrendRangeSelect(apply) {
  const g = liveGraphs.find(x => x.id === trendRangeSelectGraphId);
  if (g && apply && rangeSelectDrag && rangeSelectDrag.locked) {
    const xMinVal = rangeSelectPxToX(g, Math.min(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    const xMaxVal = rangeSelectPxToX(g, Math.max(rangeSelectDrag.startPx, rangeSelectDrag.currentPx));
    g.trendXMin = Number(xMinVal.toFixed(3));
    g.trendXMax = Number(xMaxVal.toFixed(3));
    updateLiveChart(g);
  }
  if (g) g.chart.canvas.removeEventListener('click', trendRangeCanvasClick);
  window.removeEventListener('mousemove', trendRangeMouseMove);
  document.getElementById('rangeSelectBar').style.display = 'none';
  rangeSelectDrag = null;
  const graphId = trendRangeSelectGraphId;
  trendRangeSelectGraphId = null;
  closeGraphZoom();
  if (graphId != null) openGraphSettings(graphId);
}

document.getElementById('rangeSelectConfirmBtn').addEventListener('click', () => finishTrendRangeSelect(true));
document.getElementById('rangeSelectCancelBtn').addEventListener('click', () => finishTrendRangeSelect(false));

// ── 그래프 카드 하나(=Chart.js 인스턴스 하나) 생성 - addLiveGraph와 splitSeriesToNewGraph가 공유 ──
function buildLiveChart(canvasEl) {
  return new Chart(canvasEl, {
    type: 'scatter',
    data: { datasets: [] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false }, // 선에 딱 안 맞아도 가까이만 가면 툴팁이 뜨게
      onClick: chartClickHandler,
      plugins: {
        legend: { display: false, labels: { color: textColor, boxWidth: 10, font: { size: 9 } }, onClick: legendClickHandler },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ''}: (${fmtNum(ctx.parsed.x)}, ${fmtNum(ctx.parsed.y)})` } },
      },
      scales: {
        x: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
        y: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
      } } });
}

function createGraphObject(seriesArr) {
  const id = ++liveGraphSeq;
  const card = document.createElement('div');
  card.className = 'graph-card';
  card.draggable = true;
  document.getElementById('liveGraphs').appendChild(card);

  const g = { id, card, title: '', xMin: '', xMax: '', xUnit: '', yMin: '', yMax: '', yUnit: '', showTrend: false,
    xAuto: true, yAuto: true, trendXMin: '', trendXMax: '', marks: [],
    series: seriesArr };
  renderGraphCard(g);
  g.chart = buildLiveChart(document.getElementById(`liveChart-${id}`));
  liveGraphs.push(g);
  attachGraphDragHandlers(g);
  document.getElementById('addGraphBtn').disabled = liveGraphs.length >= MAX_LIVE_GRAPHS;
  return g;
}

function addLiveGraph() {
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) return;
  const sid = ++liveSeriesSeq;
  const g = createGraphObject([{ sid, color: liveColorFor(String(sid)), xKey: '', yKey: '', visible: true }]);
  refreshLiveSelectOptions();
  updateLiveChart(g);
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
    renderSensorGrid();
  };
  ws.onclose = () => {
    document.getElementById('liveDot').classList.remove('on');
    renderSensorGrid();
    if (manualStop) return;   // 사용자가 '실험 종료'를 눌러서 끊은 거면 재접속 시도 안 함
    document.getElementById('liveStatusText').textContent = '재연결 시도중…';
    setTimeout(connectLiveSocket, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    const payload = JSON.parse(evt.data);
    lastDataAt = Date.now();
    if (sessionStartTime === null) sessionStartTime = new Date(payload.timestamp || Date.now()).getTime();
    let newKey = false;
    // 키 이름에 눈에 안 보이는 공백이 섞여 들어오면(배선 잡음 등으로 시리얼 줄이 깨졌을 때
    // 흔함) 같은 센서인데 다른 문자열로 취급돼서 카드가 계속 새로 생기므로 trim해서 합친다.
    for (const [rawKey, v] of Object.entries(payload)) {
      const k = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
      if (!k || k === 'timestamp' || k === '_source') continue;
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
  lastDataAt = 0;
  sessionStartTime = null;
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
