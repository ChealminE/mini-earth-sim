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
    return `<div class="sensor-card" style="border-left-color:${liveColorFor(k)}">
      <div class="key">${k}</div>
      <div class="val">${typeof d.value === 'number' ? d.value.toFixed(2) : d.value}</div>
      <div class="updated">${timeStr}</div>
    </div>`;
  }).join('');
}

// ── 다중 그래프 카드 (최대 4개, 각자 독립적인 X/Y 변인 선택) ──────────────
const liveGraphs = []; // [{ id, chart, card }]
let liveGraphSeq = 0;
const MAX_LIVE_GRAPHS = 4;

function refreshLiveSelectOptions() {
  const keys = [...liveKnownKeys].sort();
  liveGraphs.forEach(g => {
    const xSel = document.getElementById(`xSelect-${g.id}`);
    const ySel = document.getElementById(`ySelect-${g.id}`);
    const prevX = xSel.value, prevY = ySel.value;
    [xSel, ySel].forEach((sel, i) => {
      const placeholder = i === 0 ? 'X축 변인' : 'Y축 변인';
      sel.innerHTML = `<option value="">${placeholder}</option>` + keys.map(k => `<option value="${k}">${k}</option>`).join('');
    });
    if (keys.includes(prevX)) xSel.value = prevX;
    if (keys.includes(prevY)) ySel.value = prevY;
    if (!xSel.value && keys[0]) xSel.value = keys[0];
    if (!ySel.value && keys[1]) ySel.value = keys[1];
  });
}

function updateLiveChart(g) {
  const xKey = document.getElementById(`xSelect-${g.id}`).value;
  const yKey = document.getElementById(`ySelect-${g.id}`).value;
  g.chart.options.scales.x.title.text = xKey || '';
  g.chart.options.scales.y.title.text = yKey || '';
  if (!xKey || !yKey) { g.chart.data.datasets[0].data = []; g.chart.update(); return; }
  g.chart.data.datasets[0].data = liveScatterPoints
    .filter(p => xKey in p && yKey in p)
    .map(p => ({ x: p[xKey], y: p[yKey] }));
  g.chart.update();
}

function updateAllLiveCharts() {
  liveGraphs.forEach(updateLiveChart);
}

function addLiveGraph() {
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) return;
  const id = ++liveGraphSeq;
  const card = document.createElement('div');
  card.className = 'graph-card';
  card.innerHTML = `
    <div class="var-row">
      <select id="xSelect-${id}"><option value="">X축 변인</option></select>
      <select id="ySelect-${id}"><option value="">Y축 변인</option></select>
      <button class="remove-btn" onclick="removeLiveGraph(${id})">✕</button>
    </div>
    <div class="chart-wrap" style="height:140px"><canvas id="liveChart-${id}"></canvas></div>`;
  document.getElementById('liveGraphs').appendChild(card);

  const chart = new Chart(document.getElementById(`liveChart-${id}`), {
    type: 'scatter',
    data: { datasets: [{ data: [], backgroundColor: liveColorFor(String(id)), pointRadius: 3, showLine: true,
      borderColor: 'rgba(93,202,165,0.35)', borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
        y: { title: { display: true, text: '', color: textColor, font: { size: 9 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
      } } });

  const g = { id, chart, card };
  liveGraphs.push(g);
  refreshLiveSelectOptions();
  document.getElementById(`xSelect-${id}`).addEventListener('change', () => updateLiveChart(g));
  document.getElementById(`ySelect-${id}`).addEventListener('change', () => updateLiveChart(g));
  updateLiveChart(g);

  document.getElementById('addGraphBtn').disabled = liveGraphs.length >= MAX_LIVE_GRAPHS;
}

function removeLiveGraph(id) {
  const idx = liveGraphs.findIndex(g => g.id === id);
  if (idx === -1) return;
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
// 키 이름에 아래 문자열이 "포함"되어 있으면 매칭됨 (대소문자 무관).
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
  // methane: (value) => { sceneLive.state.methane = value; },// 예시: common.js에 아직 대응 로직 없음
};

function applyLiveSensorEffects() {
  let matched = false;
  for (const [effectKey, applyEffect] of Object.entries(sensorEffectMap)) {
    const matchedKey = [...liveKnownKeys].find(k => k.toLowerCase().includes(effectKey));
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
