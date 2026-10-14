// ================= 직접 실험 탭 (보드 ↔ server.py ↔ 화면, WebSocket 연동) =================
// 실험 화면(#liveRun): 아크릴 3D를 화면 가득 두고 위쪽 상태 줄 / 오른쪽 보드·센서 패널(값, 켜기·끄기) /
// 아크릴 위에 떠 있는 그래프 카드. 카드를 누르면 큰 창(그래프 / 데이터 표 / 편집·분석 = live-analysis.js)
// "기록 중인지 / 언제 자동 종료할지 / 지금까지 쌓인 값"은 서버(server.py)가 들고 있다.
// 6시간짜리 실험 도중 탭을 새로고침해도 /api/session으로 전부 되찾아 오게 하려는 것.
const sceneLive = sceneFor('live'); // 이 화면을 열었을 때만 실제로 만듦 (common.js sceneFor)

const liveLatest = {};          // { [표시 키]: { value, timestamp, dev } }
const liveKnownKeys = new Set(); // 지금까지 값이 들어온 표시 키 전부
let liveRecords = [];           // 이번 실험에서 '기록'된 값 전부 (개수 제한 없음). { _t, _dev, timestamp, [표시 키]: 값 }
let liveSession = { state: 'idle' }; // 서버의 실험 세션 상태 그대로
let liveDevices = [];           // 서버가 알려준 보드 목록
let liveServerInfo = null;      // /api/info (MQTT 브로커 주소 등)
let liveFile = null;            // 지난 데이터 파일을 열어 보는 중이면 { name } (live-file.js)

const liveColorRamp = ['#5DCAA5', '#EF9F27', '#E24B4A', '#85B7EB', '#c07fe0', '#8fd83c'];
function liveColorFor(key) {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return liveColorRamp[hash % liveColorRamp.length];
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 센서 키 이름 (보드 두 대가 같은 이름을 보낼 때) ─────────────────
// 우노와 ESP32가 둘 다 "co2"를 보내면 한 카드·한 그래프로 섞여 버린다.
// 먼저 보낸 보드는 그대로 "co2", 나중 보드는 "co2@보드이름"으로 구분해서 보여 준다.
const keyOwner = {};   // { 원래 키: 처음 보낸 장치 id }
const keyInfo = {};    // { 표시 키: { raw, dev } }
function displayKeyFor(raw, devId) {
  if (!keyOwner[raw]) keyOwner[raw] = devId;
  if (keyOwner[raw] === devId) return raw;
  const dev = liveDevices.find(d => d.id === devId);
  return `${raw}@${dev ? dev.name : devId}`;
}

// ── 시간 축 ─────────────────────────────────────────
// 그래프 X축에 "경과 시간"도 고를 수 있게 한다 (센서값 vs 센서값 상관관계 그래프뿐 아니라,
// CO2 농도처럼 하나의 값이 시간에 따라 어떻게 변하는지 보는 그래프도 필요해서).
// 실제 센서 키가 아니라 기록 시각(_t)에서 계산해 만들어 내는 가상의 축이다.
// 6시간 실험이면 초 단위 숫자가 2만을 넘어 읽기 어려워서 분·시간 단위도 고를 수 있게 했다.
const TIME_AXIS_KEY = '__time__';
const TIME_AXIS_LABEL = '경과 시간';
const TIME_UNITS = { s: { label: '초', div: 1 }, min: { label: '분', div: 60 }, h: { label: '시간', div: 3600 } };

function recordingSpanSec() {
  if (!liveRecords.length || !liveSession.startedAt) return 0;
  return (liveRecords[liveRecords.length - 1]._t - liveSession.startedAt) / 1000;
}
function resolveTimeUnit(u) {
  if (u && u !== 'auto') return u;
  const span = recordingSpanSec();
  return span < 600 ? 's' : span < 3 * 3600 ? 'min' : 'h';
}
function axisLabel(key, timeUnit) {
  return key === TIME_AXIS_KEY ? `${TIME_AXIS_LABEL} (${TIME_UNITS[resolveTimeUnit(timeUnit)].label})` : key;
}

// 기록에서 (x, y) 점 목록 뽑기 - 그래프 카드와 분석 칸이 같이 씀
function seriesPoints(xKey, yKey, timeUnit) {
  if (!xKey || !yKey) return [];
  const isTime = xKey === TIME_AXIS_KEY;
  const div = TIME_UNITS[resolveTimeUnit(timeUnit)].div;
  const t0 = liveSession.startedAt || (liveRecords[0] && liveRecords[0]._t) || 0;
  const out = [];
  for (const r of liveRecords) {
    const y = r[yKey];
    if (typeof y !== 'number') continue;
    const x = isTime ? (r._t - t0) / 1000 / div : r[xKey];
    if (typeof x !== 'number') continue;
    out.push({ x, y });
  }
  return out;
}

// ── 서버 연결 (페이지를 열면 바로 연결 - 실험을 시작하기 전에도 보드 상태·현재 값을 봐야 하므로) ──
let liveSocket = null;
let liveConnected = false;

function liveSend(obj) {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return false;
  liveSocket.send(JSON.stringify(obj));
  return true;
}

function connectLiveSocket() {
  // 단일 HTML 파일 버전(file://)에는 server.py가 없다
  if (location.protocol === 'file:' || !location.host) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  liveSocket = ws;
  ws.onopen = async () => {
    liveConnected = true;
    renderLiveStatus();
    try {
      liveServerInfo = await (await fetch('/api/info')).json();
      const s = await (await fetch('/api/session')).json();
      restoreSessionRecords(s);
    } catch (e) { /* 서버가 예전 버전이면 /api가 없다 - 실시간 값만 받는다 */ }
    renderDevicePanel(true);
  };
  ws.onclose = () => {
    liveConnected = false;
    renderLiveStatus();
    renderDevicePanel(true);
    setTimeout(connectLiveSocket, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    if (msg._type === 'devices') { liveDevices = msg.devices || []; renderDevicePanel(); return; }
    if (msg._type === 'session') { applySessionState(msg); return; }
    if (msg._type === 'cmd_result') { if (!msg.ok) showLiveToast(msg.msg || '명령 실패', true); return; }
    if (msg._type === 'raw') { addMonitorLine(msg); return; }
    if (msg._type) return;
    handleDataPayload(msg);
  };
}

function handleDataPayload(payload) {
  if (liveFile) return; // 지난 데이터(파일)를 보는 중에는 실시간 값을 섞지 않음
  const devId = payload._dev || 'unknown';
  const ts = payload.timestamp || new Date().toISOString();
  let newKey = false;
  const rec = payload._rec ? { _t: payload._t || Date.now(), _dev: devId, timestamp: ts } : null;
  // 키 이름에 눈에 안 보이는 공백이 섞여 들어오면(배선 잡음 등으로 시리얼 줄이 깨졌을 때
  // 흔함) 같은 센서인데 다른 문자열로 취급돼서 카드가 계속 새로 생기므로 trim해서 합친다.
  for (const [rawKey, v] of Object.entries(payload)) {
    const raw = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
    if (!raw || raw === 'timestamp' || raw.startsWith('_')) continue;
    if (typeof v !== 'number' && typeof v !== 'string') continue;
    const k = displayKeyFor(raw, devId);
    keyInfo[k] = { raw, dev: devId };
    liveLatest[k] = { value: v, timestamp: ts, dev: devId };
    if (!liveKnownKeys.has(k)) { liveKnownKeys.add(k); newKey = true; }
    if (rec && typeof v === 'number') rec[k] = v;
  }
  if (rec) { if (payload._light != null) rec._light = payload._light; liveRecords.push(rec); }
  if (newKey) { renderDevicePanel(true); refreshLiveSelectOptions(); }
  else updateDeviceValues();
  if (rec) scheduleLiveChartsUpdate();
  applyLiveSensorEffects();
}

// 새로고침했을 때 서버가 들고 있던 이번 실험 기록을 되찾는다
let sessionRestoredOnce = false;
function restoreSessionRecords(s) {
  if (liveFile) return;
  if (!s || !s.armedAt) return;
  liveSession = s;
  // 서버에서 기록을 받아오는 사이에 실시간으로 먼저 도착한 값은 버리지 않고 뒤에 붙인다
  const lastT = (s.records || []).reduce((a, r) => Math.max(a, r._t), 0);
  const arrivedMeanwhile = liveRecords.filter(r => r._t > lastT);
  liveRecords = [];
  for (const r of s.records || []) {
    const rec = { _t: r._t, _dev: r._dev, timestamp: r.timestamp };
    if (r._light != null) rec._light = r._light;
    for (const [raw, v] of Object.entries(r)) {
      if (raw === 'timestamp' || raw.startsWith('_') || typeof v !== 'number') continue;
      const k = displayKeyFor(raw, r._dev);
      keyInfo[k] = { raw, dev: r._dev };
      rec[k] = v;
      if (!liveKnownKeys.has(k)) liveKnownKeys.add(k);
    }
    liveRecords.push(rec);
  }
  liveRecords.push(...arrivedMeanwhile);
  // 페이지를 새로 열었을 때 진행 중이거나 막 끝난 실험이 있으면 바로 실험 화면으로 (기록·그래프를 다시 보게)
  if (!sessionRestoredOnce && (s.state !== 'ended' || liveRecords.length) && typeof liveView !== 'undefined' && liveView === 'setup') showLiveExperiment();
  sessionRestoredOnce = true;
  refreshLiveSelectOptions();
  updateAllLiveCharts();
  renderLiveStatus();
  if (typeof onLiveRecordsChanged === 'function') onLiveRecordsChanged(true);
}

function applySessionState(s) {
  if (liveFile) return;
  const isNew = s.armedAt && s.armedAt !== liveSession.armedAt;
  liveSession = s;
  if (isNew) {
    // 새 실험: 지난 기록·마크를 비우고 그래프를 처음부터 그린다
    liveRecords = [];
    liveGraphs.forEach(g => { g.marks = []; });
    updateAllLiveCharts();
  }
  if (s.state === 'ended' && s.endReason === 'time') showLiveToast('설정한 시간이 지나 실험이 자동으로 끝났어요');
  if ((s.state === 'armed' || s.state === 'recording') && typeof liveView !== 'undefined' && liveView === 'setup') showLiveExperiment();
  renderLiveStatus();
  if (typeof onLiveRecordsChanged === 'function') onLiveRecordsChanged(true);
}

// ── 상단 상태 줄 (실험 상태 · 경과/남은 시간 · 버튼) ─────────────────
function hhmmss(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

function renderLiveStatus() {
  const dot = document.getElementById('liveDot');
  const text = document.getElementById('liveStatusText');
  const st = liveSession.state;
  dot.className = 'live-dot' + (st === 'recording' ? ' on rec' : st === 'armed' ? ' armed' : liveConnected ? ' on' : '');
  let msg;
  if (liveFile) {
    text.textContent = `📂 지난 데이터 보기 — ${liveFile.name} · ${liveRecords.length}개 기록 (보드와 연결 안 함 · 편집·분석·내보내기만)`;
    dot.className = 'live-dot';
    const ssb = document.getElementById('startStopBtn');
    ssb.textContent = '✕ 파일 닫기'; ssb.classList.add('stop'); ssb.disabled = false;
    document.getElementById('liveExpName').textContent = liveFile.title;
    document.getElementById('expSettingsSummary').textContent = '';
    return;
  }
  if (!liveConnected) msg = '서버 연결 안 됨 — server.py(run_server.bat)가 켜져 있는지 확인하세요';
  else if (st === 'armed') {
    const t = (liveSession.config || {}).trigger || {};
    const k = Object.keys(keyInfo).find(dk => keyInfo[dk].raw === t.key && (!t.dev || keyInfo[dk].dev === t.dev)) || t.key;
    const cur = liveLatest[k] ? ` · 지금 ${fmtNum(Number(liveLatest[k].value))}` : '';
    msg = `조건 대기 중 — ${k} ${t.op === '<=' ? '≤' : '≥'} ${t.value}이 되면 기록을 시작합니다${cur}`;
  } else if (st === 'recording') {
    const now = Date.now();
    msg = `기록 중 ${fmtDuration((now - liveSession.startedAt) / 1000)}`;
    if (liveSession.endsAt) msg += ` · 자동 종료까지 ${fmtDuration((liveSession.endsAt - now) / 1000)}`;
    msg += ` · ${liveRecords.length}개`;
  } else if (st === 'ended') {
    const why = liveSession.endReason === 'time' ? '설정 시간 도달' : '직접 종료';
    msg = `실험 종료 (${why}) · ${liveRecords.length}개 기록 — 그래프를 눌러 '편집·분석'에서 정리할 수 있어요`;
  } else msg = '실험 대기 중 — 보드를 연결하고 "실험 시작"을 누르세요';
  text.textContent = msg;

  const running = st === 'armed' || st === 'recording';
  const ssb = document.getElementById('startStopBtn');
  ssb.textContent = st === 'armed' ? '■ 대기 취소' : running ? '■ 실험 끝내기' : st === 'ended' ? '▶ 다시 시작' : '▶ 실험 시작';
  ssb.classList.toggle('stop', running);
  ssb.disabled = !running && !liveConnected;
  document.getElementById('backToSetupBtn').disabled = running;
  const lb = document.getElementById('lightBtn');
  lb.textContent = liveSession.light ? '💡 조명 켬' : '💡 조명 끔';
  lb.classList.toggle('on', !!liveSession.light);
  applyLampLight();
  document.getElementById('liveExpName').textContent = setup.name || '';
  document.getElementById('expSettingsSummary').textContent = simSummary();
}
setInterval(() => { renderLiveStatus(); updateDeviceValues(); }, 1000);

// ── 보드·센서 패널 (실험 화면 오른쪽) ────────────────────────────
const LINK_LABEL = { usb: 'USB', ble: 'BLE', mqtt: 'WiFi·MQTT', http: 'WiFi·HTTP' };
const LIVE_STALE_MS = 15000; // 이 시간 넘게 새 값이 없으면 "전송 끊김"으로 표시
let devicePanelSignature = '';

function keysOfDevice(devId) {
  return [...liveKnownKeys].filter(k => keyInfo[k] && keyInfo[k].dev === devId).sort();
}

function valueChipHtml(k) {
  return `<div class="value-chip" data-key="${escHtml(k)}" title="누르면 그래프" style="border-left-color:${liveColorFor(k)}">
      <div class="key" title="${escHtml(k)}">${escHtml(k)}</div>
      <div class="val" data-val="${escHtml(k)}">–</div>
      <div class="updated" data-time="${escHtml(k)}"></div>
    </div>`;
}

function devicePanelSig() {
  return JSON.stringify([!!liveFile, liveConnected, liveDevices.map(d => [d.id, d.name, d.online, d.info, d.canCmd]),
    [...liveKnownKeys].sort(), setup.placements]);
}

function renderDevicePanel(force) {
  const sig = devicePanelSig();
  if (!force && sig === devicePanelSignature) { updateDeviceValues(); return; }
  devicePanelSignature = sig;
  const wrap = document.getElementById('liveDeviceList');
  if (liveFile) {
    const keys = [...liveKnownKeys];
    wrap.innerHTML = `<div class="dev-card"><div class="dev-head"><span class="dev-name">📂 ${escHtml(liveFile.name)}</span></div>
      <div class="hint" style="margin:6px 0 8px">값 카드를 누르면 그래프가 생겨요 (카드의 값 = 마지막 기록)</div>
      <div class="value-chips">${keys.map(valueChipHtml).join('') || '<span class="hint" style="margin:0">숫자 값이 없어요</span>'}</div></div>`;
    updateDeviceValues();
    return;
  }
  if (!liveConnected) {
    wrap.innerHTML = '<div class="conn-status-hint error">🔴 서버에 연결되지 않았어요 — server.py(run_server.bat)가 켜져 있는지 확인하세요. 켜지면 자동으로 다시 연결합니다.</div>';
    return;
  }
  if (liveDevices.length === 0) {
    wrap.innerHTML = `<div class="empty-hint">아직 연결된 보드가 없어요.<br>
      · USB: 케이블을 꽂으면 자동으로 찾습니다 (최대 30초). 안 잡히면 ⟳ 포트 다시 찾기<br>
      · WiFi(MQTT): ESP32 코드의 서버 주소를 ⓘ 연결 정보에 나온 주소로 맞추세요<br>
      · BLE: 서버를 <code>--ble</code> 옵션으로 켜야 합니다</div>`;
    return;
  }
  wrap.innerHTML = liveDevices.map(d => {
    const info = d.info;
    const keys = keysOfDevice(d.id);
    const covered = new Set();
    let body = '';
    if (info && Array.isArray(info.sensors)) {
      const intervalSec = info.interval ? info.interval / 1000 : '';
      body += `<div class="dev-controls">
        <label>측정 간격 <input type="number" min="0.2" step="0.1" class="dev-interval" data-dev="${escHtml(d.id)}" value="${intervalSec}"> 초</label>
        <button class="mini-btn" data-act="interval" data-dev="${escHtml(d.id)}">적용</button>
        <button class="mini-btn" data-act="run" data-dev="${escHtml(d.id)}" data-on="${info.run ? 0 : 1}">${info.run ? '⏸ 측정 멈춤' : '▶ 측정 재개'}</button>
        <button class="mini-btn" data-act="reboot" data-dev="${escHtml(d.id)}" title="보드 프로그램을 처음부터 다시 시작">↻ 재부팅</button>
        ${d.canHwReset ? `<button class="mini-btn" data-act="hwreset" data-dev="${escHtml(d.id)}" title="보드가 응답하지 않을 때 USB 케이블 신호로 강제로 리셋">⚡ 강제 리셋</button>` : ''}
      </div>`;
      body += info.sensors.map(s => {
        const sKeys = keys.filter(k => (s.keys || [s.id]).includes(keyInfo[k].raw));
        sKeys.forEach(k => covered.add(k));
        const pwrTag = s.pwr ? '<span class="tag ok" title="전원선에 스위치(MOSFET·릴레이)가 달려 있어 끄면 센서 전원이 실제로 끊깁니다">전원 차단</span>'
                             : '<span class="tag" title="전원선 스위치가 없어 끄면 측정만 멈춥니다 (전원은 계속 들어감)">측정만 멈춤</span>';
        const warm = s.warm ? '<span class="tag warn">예열 중</span>' : '';
        return `<div class="dev-sensor${s.on ? '' : ' off'}">
          <div class="dev-sensor-head">
            <span class="dev-sensor-name">${escHtml(s.name || s.id)}</span>${pwrTag}${warm}
            <button class="toggle-btn${s.on ? ' on' : ''}" data-act="sensor" data-dev="${escHtml(d.id)}" data-sensor="${escHtml(s.id)}" data-on="${s.on ? 0 : 1}">${s.on ? '켜짐' : '꺼짐'}</button>
          </div>
          <div class="value-chips">${sKeys.map(valueChipHtml).join('') || '<span class="hint" style="margin:0">값 없음</span>'}</div>
        </div>`;
      }).join('');
      const rest = keys.filter(k => !covered.has(k));
      if (rest.length) body += `<div class="dev-sensor"><div class="dev-sensor-head"><span class="dev-sensor-name">기타 값</span></div><div class="value-chips">${rest.map(valueChipHtml).join('')}</div></div>`;
    } else {
      body += `<div class="value-chips">${keys.map(valueChipHtml).join('') || '<span class="hint" style="margin:0">아직 값이 안 왔어요</span>'}</div>`;
      if (d.canCmd) body += '<div class="hint" style="margin:6px 0 0">이 보드 코드는 원격 제어를 지원하지 않아요. 처음 화면 <b>기본 코드·회로도 받기</b>의 코드로 올리면 켜기·끄기·재부팅 버튼이 생겨요.</div>';
    }
    return `<div class="dev-card${d.online ? '' : ' offline'}" data-devcard="${escHtml(d.id)}">
      <div class="dev-head">
        <span class="dev-dot" data-devdot="${escHtml(d.id)}"></span>
        <span class="dev-name">${escHtml(d.name)}</span>
        <span class="tag">${LINK_LABEL[d.link] || d.link}</span>
        <span class="dev-addr">${escHtml(d.link === 'mqtt' ? '' : d.addr)}</span>
        <span class="dev-seen" data-devseen="${escHtml(d.id)}"></span>
      </div>
      ${body}
    </div>`;
  }).join('');
  updateDeviceValues();
  if (typeof refreshSensorPop === 'function') refreshSensorPop(); // 아크릴 위 센서 창이 열려 있으면 켜짐/꺼짐 등을 새로
}

// 구조는 그대로 두고 숫자·시각만 바꾼다 (매초 통째로 다시 그리면 열려 있던 드롭다운이 닫히고 입력 중이던 칸이 지워짐)
function updateDeviceValues() {
  for (const el of document.querySelectorAll('#liveDeviceList [data-val]')) {
    const d = liveLatest[el.dataset.val];
    if (!d) continue;
    el.textContent = typeof d.value === 'number' ? fmtNum(d.value) : d.value;
    const t = document.querySelector(`#liveDeviceList [data-time="${CSS.escape(el.dataset.val)}"]`);
    if (t) t.textContent = hhmmss(new Date(d.timestamp));
  }
  const now = Date.now();
  for (const d of liveDevices) {
    const dot = document.querySelector(`#liveDeviceList [data-devdot="${CSS.escape(d.id)}"]`);
    const seen = document.querySelector(`#liveDeviceList [data-devseen="${CSS.escape(d.id)}"]`);
    if (!dot || !seen) continue;
    const age = d.lastSeen ? now - d.lastSeen : Infinity;
    // lastSeen은 장치 목록이 갱신될 때만 오므로, 값이 들어올 때마다 화면 쪽에서도 갱신
    const latest = Math.max(d.lastSeen || 0, ...keysOfDevice(d.id).filter(k => liveLatest[k]).map(k => new Date(liveLatest[k].timestamp).getTime()));
    const realAge = latest ? now - latest : age;
    const stale = !d.online || realAge > LIVE_STALE_MS;
    dot.className = 'dev-dot' + (!d.online ? ' off' : stale ? ' warn' : ' on');
    seen.textContent = !d.online ? '연결 끊김' : latest ? `${Math.floor(realAge / 1000)}초 전 수신` : '값 기다리는 중';
  }
}


document.getElementById('liveDeviceList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) { runDevAct(btn); return; }
  // 값 카드를 누르면 그 센서 그래프
  const chip = e.target.closest('.value-chip');
  if (chip) addGraphForKey(chip.dataset.key);
});

// 보드·센서 명령 버튼 (data-act = sensor | run | interval | reboot | hwreset)
async function runDevAct(btn) {
  const dev = btn.dataset.dev;
  const devName = (liveDevices.find(d => d.id === dev) || {}).name || dev;
  const act = btn.dataset.act;
  let cmd = null;
  if (act === 'sensor') cmd = { cmd: 'sensor', id: btn.dataset.sensor, on: Number(btn.dataset.on) };
  else if (act === 'run') cmd = { cmd: 'run', on: Number(btn.dataset.on) };
  else if (act === 'interval') {
    const input = document.querySelector(`#liveDeviceList .dev-interval[data-dev="${CSS.escape(dev)}"]`);
    const sec = Number(input && input.value);
    if (!(sec >= 0.2)) { showLiveToast('측정 간격은 0.2초 이상으로 넣어 주세요', true); return; }
    cmd = { cmd: 'interval', ms: Math.round(sec * 1000) };
  } else if (act === 'reboot') {
    if (!await liveConfirm(`'${devName}' 보드를 재부팅할까요? 몇 초 동안 값이 끊깁니다.`)) return;
    cmd = { cmd: 'reboot' };
  } else if (act === 'hwreset') {
    if (!await liveConfirm(`'${devName}' 보드를 USB 신호로 강제 리셋할까요? 보드가 응답하지 않을 때만 쓰세요.`)) return;
    cmd = { cmd: '_hwreset' };
  }
  if (cmd && !liveSend({ _type: 'cmd', dev, cmd })) showLiveToast('서버에 연결되지 않아 보낼 수 없어요', true);
  else if (cmd) showLiveToast('명령을 보냈어요 — 보드가 반영하면 화면이 바뀝니다');
}

document.getElementById('rescanPortsBtn').addEventListener('click', () => {
  if (liveSend({ _type: 'rescan' })) showLiveToast('USB 포트를 다시 찾는 중이에요 (최대 30초)');
});

document.getElementById('connInfoBtn').addEventListener('click', () => {
  const info = liveServerInfo || {};
  const mq = info.mqtt;
  const rows = [
    ['화면 주소 (같은 와이파이의 다른 기기에서)', info.ip ? `http://${info.ip}:${info.httpPort}` : '서버 연결 후 표시'],
    ['WiFi·MQTT 브로커', mq ? `${mq.host} : ${mq.port}` + (mq.mode === 'external' ? ' (따로 켜진 브로커 - Mosquitto 등)' : ' (서버에 내장)') : '꺼져 있음'],
    ['ESP32 코드에 넣을 값', mq ? `MQTT_SERVER = "${mq.host}", MQTT_PORT = ${mq.port}` : '-'],
    ['WiFi·HTTP 전송 주소 (예전 방식)', info.ip ? `http://${info.ip}:${info.httpPort}/data` : '-'],
  ];
  document.getElementById('connInfoContent').innerHTML =
    `<table class="pinmap-table"><tbody>${rows.map(([l, v]) => `<tr><th>${l}</th><td>${escHtml(v)}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('connInfoModal').classList.add('visible');
});
document.getElementById('connInfoCloseBtn').addEventListener('click', () => {
  document.getElementById('connInfoModal').classList.remove('visible');
});

// 짧은 알림 (명령 보냄/실패 등)
let liveToastTimer = null;
function showLiveToast(text, isError) {
  const el = document.getElementById('liveToast');
  el.textContent = text;
  el.className = 'live-toast visible' + (isError ? ' error' : '');
  clearTimeout(liveToastTimer);
  liveToastTimer = setTimeout(() => { el.className = 'live-toast'; }, 3500);
}

// 앱과 같은 디자인의 확인 창 (브라우저 기본 confirm 대신)
// labels = { yes: '이어서 하기', no: '새로 준비' } 처럼 버튼 글자를 바꿀 수 있다 (기본 확인/취소)
function liveConfirm(text, labels = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('liveConfirmModal');
    document.getElementById('liveConfirmText').textContent = text;
    modal.classList.add('visible');
    const done = (v) => { modal.classList.remove('visible'); yes.onclick = no.onclick = null; resolve(v); };
    const yes = document.getElementById('liveConfirmYesBtn');
    const no = document.getElementById('liveConfirmNoBtn');
    yes.textContent = labels.yes || '확인';
    no.textContent = labels.no || '취소';
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
  });
}

// ── 그래프 (아크릴 위에 떠 있는 카드 · 누르면 큰 창) ──────────────
// 실험 화면은 아크릴을 화면 가득 두고, 그래프는 학생이 필요할 때 꺼내 쓰는 작은 카드로 띄운다.
//   카드: 제목 줄을 끌어 아무 데나 옮기기 · 다른 카드 위에 놓으면 합치기 · 모서리로 크기 조절 · 접기
//   카드를 누르면 큰 창: [그래프](값 마크) / [데이터 표] / [편집·분석](live-analysis.js)
// 카드 구성·위치는 이 브라우저에 저장해 두어 새로고침해도 그대로 (LIVE_GRAPHS_KEY).
// 상태는 DOM이 아니라 g 객체 자체에 저장(g.series[i].xKey 등) — 팝업이 닫혀 있어도 값이 유지되게.
const liveGraphs = []; // [{ id, chart, card, title, xMin, xMax, xUnit, yMin, yMax, yUnit, timeUnit, marks, x, y, w, h, collapsed, series:[{sid,color,xKey,yKey,visible}] }]
let liveGraphSeq = 0;
let liveSeriesSeq = 0;
const MAX_LIVE_GRAPHS = 8;
const LIVE_GRAPHS_KEY = 'liveGraphsV1';
const CARD_W = 340, CARD_H = 210;
// 6시간 동안 1초마다 받으면 2만 개가 넘는다. 원본은 전부 들고 있되, 차트에는 계열당 이만큼만 솎아서 그린다.
const LIVE_MAX_DRAW_POINTS = 1500;
let gsCurrentGraphId = null; // 지금 설정 팝업이 편집 중인 그래프
let pendingMerge = null;     // { sourceId, targetId } - 합치기 확인 팝업 대기중

function buildKeyOptionsHtml(selectedKey, keys) {
  return keys.map(k => `<option value="${escHtml(k)}"${k === selectedKey ? ' selected' : ''}>${escHtml(k)}</option>`).join('');
}

function buildXKeyOptionsHtml(selectedKey, keys) {
  const timeOption = `<option value="${TIME_AXIS_KEY}"${selectedKey === TIME_AXIS_KEY ? ' selected' : ''}>${TIME_AXIS_LABEL}</option>`;
  return timeOption + buildKeyOptionsHtml(selectedKey, keys);
}

// 새 센서 키가 들어오면 '빈 그래프'(+ 그래프로 만든 것)에만 아직 안 쓰인 센서를 하나씩 채워 준다.
function refreshLiveSelectOptions() {
  const keys = [...liveKnownKeys].sort();
  const used = new Set(liveGraphs.map(g => g.series[0].yKey).filter(Boolean));
  liveGraphs.forEach(g => {
    const primary = g.series[0];
    if (!primary.xKey) primary.xKey = TIME_AXIS_KEY;
    if (!primary.yKey) {
      const next = keys.find(k => !used.has(k) && typeof (liveLatest[k] || {}).value === 'number');
      if (next) { primary.yKey = next; used.add(next); updateCardTitleDisplay(g); }
    }
    updateLiveChart(g);
  });
  if (gsCurrentGraphId != null) {
    const g = liveGraphs.find(x => x.id === gsCurrentGraphId);
    if (g) renderSettingsSeriesList(g);
  }
  if (typeof onLiveKeysChanged === 'function') onLiveKeysChanged();
}

function updateLiveChart(g) {
  const xKeys = [], yKeys = [];
  g.chart.data.datasets = g.series.map(s => {
    if (s.xKey && !xKeys.includes(s.xKey)) xKeys.push(s.xKey);
    if (s.yKey && !yKeys.includes(s.yKey)) yKeys.push(s.yKey);
    const pts = seriesPoints(s.xKey, s.yKey, g.timeUnit);
    const xLabelPart = s.xKey === TIME_AXIS_KEY ? TIME_AXIS_LABEL : s.xKey;
    return { label: !(s.xKey && s.yKey) ? '(선택 안 됨)' : s.xKey === TIME_AXIS_KEY ? s.yKey : `${xLabelPart} / ${s.yKey}`, data: downsampleMinMax(pts, LIVE_MAX_DRAW_POINTS),
      backgroundColor: s.color, borderColor: s.color, pointRadius: pts.length > 300 ? 0 : 2.5, pointHitRadius: 6,
      showLine: true, borderWidth: 1.2, hidden: s.visible === false };
  });

  const xLabel = xKeys.map(k => axisLabel(k, g.timeUnit)).join(' / ') || 'X축 변인';
  const yLabel = yKeys.join(' / ') || 'Y축 변인';
  g.chart.options.scales.x.title.text = g.xUnit ? `${xLabel} (${g.xUnit})` : xLabel;
  g.chart.options.scales.y.title.text = g.yUnit ? `${yLabel} (${g.yUnit})` : yLabel;
  // 자동 스케일이면 min/max를 아예 안 넘겨서 Chart.js가 매 update마다 데이터 범위로 다시 계산하게 둔다
  g.chart.options.scales.x.min = (!g.xAuto && g.xMin !== '') ? Number(g.xMin) : undefined;
  g.chart.options.scales.x.max = (!g.xAuto && g.xMax !== '') ? Number(g.xMax) : undefined;
  g.chart.options.scales.y.min = (!g.yAuto && g.yMin !== '') ? Number(g.yMin) : undefined;
  g.chart.options.scales.y.max = (!g.yAuto && g.yMax !== '') ? Number(g.yMax) : undefined;
  g.chart.options.plugins.legend.display = g.series.length > 1;
  g.chart.update('none');
  const empty = g.card.querySelector('.fg-nodata');
  if (empty) empty.style.display = g.chart.data.datasets.some(d => d.data.length) ? 'none' : '';
}

function updateAllLiveCharts() {
  liveGraphs.forEach(updateLiveChart);
  if ((graphWinId != null || graphWinAll) && graphWinTab === 'table') renderGraphTable();
}

// 값이 1초에 여러 번 들어와도 그래프는 0.3초에 한 번만 다시 그린다 (긴 실험에서 화면이 버벅이지 않게)
let liveChartsTimer = null;
function scheduleLiveChartsUpdate() {
  if (liveChartsTimer) return;
  liveChartsTimer = setTimeout(() => {
    liveChartsTimer = null;
    updateAllLiveCharts();
    if (typeof onLiveRecordsChanged === 'function') onLiveRecordsChanged(false);
  }, 300);
}

// 카드 제목: 직접 붙인 제목이 없으면 그리는 변인 이름으로
function graphLabel(g) {
  if (g.title) return g.title;
  const ys = g.series.map(s => s.yKey).filter(Boolean);
  return ys.length ? ys.join(' + ') : '빈 그래프';
}

function updateCardTitleDisplay(g) {
  const el = g.card.querySelector('.fg-title');
  if (el) el.textContent = graphLabel(g);
  if (graphWinId === g.id) document.getElementById('gwTitle').textContent = graphLabel(g);
  saveGraphLayout();
}

// ── 카드 그리기 (생성될 때 한 번만 — 합치기/계열 변경 때도 안 건드려서 차트 인스턴스가 안 깨짐) ──
function renderGraphCard(g) {
  g.card.innerHTML = `
    <div class="fg-head" title="끌어서 옮기기 · 다른 그래프 위에 놓으면 합치기">
      <span class="fg-title">${escHtml(graphLabel(g))}</span>
      <button class="icon-btn" data-fg="collapse" title="접기/펴기">▾</button>
      <button class="icon-btn" data-fg="open" title="크게 보기 · 데이터 표 · 편집">⛶</button>
      <button class="icon-btn remove-btn" data-fg="remove" title="그래프 삭제">✕</button>
    </div>
    <div class="fg-chart chart-wrap"><canvas id="liveChart-${g.id}"></canvas><div class="fg-nodata">값이 들어오면 그려져요</div></div>`;
}

function applyCardGeometry(g) {
  g.card.style.left = `${g.x}px`;
  g.card.style.top = `${g.y}px`;
  g.card.style.width = `${g.w}px`;
  g.card.style.height = g.collapsed ? '' : `${g.h}px`;
  g.card.classList.toggle('collapsed', !!g.collapsed);
}

function nextCardPosition() {
  const layer = document.getElementById('liveGraphs');
  const W = layer.clientWidth || 900, H = layer.clientHeight || 600;
  const n = liveGraphs.length;
  const cols = Math.max(1, Math.floor((W - 8) / (CARD_W + 10)));
  const col = n % cols, row = Math.floor(n / cols);
  return { x: 8 + col * (CARD_W + 10), y: Math.min(H - 60, 8 + row * (CARD_H + 10)) };
}

// '정리' — 왼쪽 위부터 가지런히 다시 놓는다
function arrangeGraphs() {
  const layer = document.getElementById('liveGraphs');
  const cols = Math.max(1, Math.floor((layer.clientWidth - 8) / (CARD_W + 10)));
  liveGraphs.forEach((g, n) => {
    g.w = CARD_W; g.h = CARD_H; g.collapsed = false;
    g.x = 8 + (n % cols) * (CARD_W + 10);
    g.y = 8 + Math.floor(n / cols) * (CARD_H + 10);
    applyCardGeometry(g);
    g.chart.resize();
  });
  saveGraphLayout();
}

// ── 카드 끌기 (제목 줄) · 다른 카드 위에 놓으면 합치기 ─────────────
let cardDrag = null; // { g, dx, dy, target }
function attachGraphDragHandlers(g) {
  const head = g.card.querySelector('.fg-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = g.card.getBoundingClientRect();
    cardDrag = { g, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null };
    g.card.classList.add('dragging');
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!cardDrag || cardDrag.g !== g) return;
    const layer = document.getElementById('liveGraphs').getBoundingClientRect();
    g.x = Math.max(0, Math.min(layer.width - 60, e.clientX - layer.left - cardDrag.dx));
    g.y = Math.max(0, Math.min(layer.height - 30, e.clientY - layer.top - cardDrag.dy));
    applyCardGeometry(g);
    // 끌고 있는 카드 밑에 다른 카드가 있으면 합치기 대상으로 표시
    g.card.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    g.card.style.pointerEvents = '';
    const tc = under && under.closest('.fg-card');
    const target = tc && tc !== g.card ? liveGraphs.find(x => x.card === tc) : null;
    if (cardDrag.target && cardDrag.target !== target) cardDrag.target.card.classList.remove('drag-over');
    if (target) target.card.classList.add('drag-over');
    cardDrag.target = target;
  });
  const end = () => {
    if (!cardDrag || cardDrag.g !== g) return;
    g.card.classList.remove('dragging');
    const target = cardDrag.target;
    cardDrag = null;
    if (target) { target.card.classList.remove('drag-over'); askMerge(g.id, target.id); }
    saveGraphLayout();
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  g.card.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fg]');
    if (!btn) return;
    if (btn.dataset.fg === 'remove') removeLiveGraph(g.id);
    else if (btn.dataset.fg === 'open') openGraphWin(g.id, 'graph');
    else if (btn.dataset.fg === 'collapse') { g.collapsed = !g.collapsed; applyCardGeometry(g); if (!g.collapsed) g.chart.resize(); saveGraphLayout(); }
  });
  // 모서리로 크기를 바꾸면 차트도 맞추고 크기를 기억
  new ResizeObserver(() => {
    if (g.collapsed || g.card.classList.contains('dragging')) return;
    const w = g.card.offsetWidth, h = g.card.offsetHeight;
    if (w && h && (w !== g.w || h !== g.h)) { g.w = w; g.h = h; saveGraphLayout(); }
  }).observe(g.card);
}

function askMerge(sourceId, targetId) {
  const source = liveGraphs.find(x => x.id === sourceId);
  const target = liveGraphs.find(x => x.id === targetId);
  if (!source || !target || sourceId === targetId) return;
  pendingMerge = { sourceId, targetId };
  document.getElementById('mergeConfirmText').textContent =
    `"${graphLabel(source)}"을(를) "${graphLabel(target)}"에 합치겠습니까? 한 그래프에 겹쳐서 표시됩니다. (⚙ 설정에서 다시 나눌 수 있어요)`;
  document.getElementById('graphMergeConfirmModal').classList.add('visible');
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
  updateCardTitleDisplay(target);
  if (gsCurrentGraphId === target.id) renderSettingsSeriesList(target);
  updateEmptyHint();
}

function removeSeriesFromGraph(graphId, sid) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g || g.series.length <= 1) return;
  g.series = g.series.filter(s => s.sid !== sid);
  updateLiveChart(g);
  updateCardTitleDisplay(g);
  if (gsCurrentGraphId === graphId) renderSettingsSeriesList(g);
}

// 합쳤던 계열을 다시 독립된 그래프로 되돌린다 (병합의 반대 동작). 새 카드는 원래 카드 옆에 생긴다.
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
  const newG = createGraphObject([moved], { x: g.x + 24, y: g.y + 24, timeUnit: g.timeUnit });
  updateLiveChart(newG);
  updateLiveChart(g);
  updateCardTitleDisplay(g);
  if (gsCurrentGraphId === g.id) renderSettingsSeriesList(g);
}

// ── 설정 팝업 (⚙) ──────────────────────────────────────
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
  document.getElementById('gsTimeUnit').value = g.timeUnit || 'auto';
  document.getElementById('gsXAuto').checked = g.xAuto !== false;
  document.getElementById('gsYAuto').checked = g.yAuto !== false;
  document.getElementById('gsXMin').disabled = document.getElementById('gsXMax').disabled = g.xAuto !== false;
  document.getElementById('gsYMin').disabled = document.getElementById('gsYMax').disabled = g.yAuto !== false;
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
  saveGraphLayout();
}

function setGraphTimeUnit(graphId, unit) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  g.timeUnit = unit;
  g.marks = []; // 단위가 바뀌면 찍어 둔 마크의 x값 의미가 달라지므로 지운다
  updateLiveChart(g);
  if (graphWinId === g.id && graphWinTab === 'table') renderGraphTable();
  saveGraphLayout();
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
  saveGraphLayout();
}

function setSeriesColor(graphId, sid, color) {
  const g = liveGraphs.find(x => x.id === graphId);
  const s = g?.series.find(x => x.sid === sid);
  if (!s) return;
  s.color = color;
  updateLiveChart(g);
  saveGraphLayout();
}

function setSeriesKey(graphId, sid, field, value) {
  const g = liveGraphs.find(x => x.id === graphId);
  const s = g?.series.find(x => x.sid === sid);
  if (!s) return;
  s[field] = value;
  updateLiveChart(g);
  updateCardTitleDisplay(g);
  if (graphWinId === g.id) refreshGraphWin();
}

document.getElementById('graphSettingsCloseBtn').addEventListener('click', closeGraphSettings);

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
  saveGraphLayout();
}

function legendClickHandler(evt, item, legend) {
  const g = liveGraphs.find(x => x.chart === legend.chart);
  const s = g?.series[item.datasetIndex];
  if (g && s) toggleSeriesVisible(g.id, s.sid);
}

// ── 이미지/데이터 다운로드 ──────────────────────────────
// 차트 캔버스는 배경이 투명해서 그대로 저장하면 문서·한글 파일에 붙였을 때 글자(밝은 색)가 안 보인다.
// 화면과 같은 어두운 배경을 깔아서 저장한다.
function chartToPngUrl(chart) {
  const src = chart.canvas;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c.toDataURL('image/png');
}

function downloadGraphImage(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  const a = document.createElement('a');
  a.href = chartToPngUrl(g.chart);
  a.download = `${experimentFilePrefix()}_${safeFileName(graphLabel(g))}.png`;
  a.click();
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function graphKeys(g) {
  const keys = [];
  g.series.forEach(s => {
    if (s.xKey && s.xKey !== TIME_AXIS_KEY && !keys.includes(s.xKey)) keys.push(s.xKey);
    if (s.yKey && !keys.includes(s.yKey)) keys.push(s.yKey);
  });
  return keys;
}

function downloadGraphData(graphId) {
  const g = liveGraphs.find(x => x.id === graphId);
  if (!g) return;
  const keys = graphKeys(g);
  if (keys.length === 0) { alert('내보낼 변인이 선택되지 않았습니다. ⚙에서 X/Y축을 먼저 골라주세요.'); return; }
  downloadKeysCsv(keys, graphLabel(g));
}
function downloadKeysCsv(keys, label) {
  if (!keys.length) { showLiveToast('아직 내보낼 데이터가 없어요', true); return; }
  const t0 = liveSession.startedAt || 0;
  const hasLight = liveRecords.some(p => p._light != null);
  const header = ['timestamp', '경과 시간(초)', ...(hasLight ? ['조명(1=켬)'] : []), ...keys];
  const rows = liveRecords
    .filter(p => keys.some(k => k in p))
    .map(p => [p.timestamp || '', ((p._t - t0) / 1000).toFixed(3), ...(hasLight ? [p._light ?? ''] : []), ...keys.map(k => (k in p ? p[k] : ''))]);
  if (rows.length === 0) { alert('아직 내보낼 데이터가 없습니다. 실험을 시작해서 값을 받아온 뒤 다시 시도하세요.'); return; }
  const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `${liveFile ? safeFileName(liveFile.title) : experimentFilePrefix()}_${safeFileName(label)}.csv`); // BOM: 엑셀에서 한글 안 깨지게
}

// ── 클릭한 지점에 (x, y) 값을 표시하는 마크 찍기 (큰 창에서) ──────────────
// 별도 데이터셋이 아니라 캔버스에 직접 그리는 커스텀 플러그인으로 구현 - 그래야
// 실시간으로 datasets가 계속 새로 그려져도(updateLiveChart) 마크가 안 사라진다.
function fmtNum(n) {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(Math.abs(n) >= 100 ? 1 : 2);
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

// 조명 켠 구간 = lightEvents에서 on이 1인 때부터 다음 바뀐 때(없으면 지금/종료 시각)까지
function lightOnSpans() {
  const ev = liveSession.lightEvents || [];
  const end = liveSession.endedAt || Date.now();
  const spans = [];
  ev.forEach((e, i) => { if (e.on) spans.push([e.t, i + 1 < ev.length ? ev[i + 1].t : end]); });
  return spans;
}
const lightBandPlugin = {
  id: 'lightBands',
  beforeDatasetsDraw(chart) {
    const g = liveGraphs.find(x => x.chart === chart);
    if (!g || !g.series.some(s => s.xKey === TIME_AXIS_KEY) || !liveSession.startedAt) return;
    const spans = lightOnSpans();
    if (!spans.length) return;
    const { ctx, chartArea: a, scales } = chart;
    const div = TIME_UNITS[resolveTimeUnit(g.timeUnit)].div;
    const toX = (t) => scales.x.getPixelForValue((t - liveSession.startedAt) / 1000 / div);
    ctx.save();
    ctx.beginPath(); ctx.rect(a.left, a.top, a.right - a.left, a.bottom - a.top); ctx.clip();
    spans.forEach(([t0, t1]) => {
      const x0 = Math.max(a.left, toX(t0)), x1 = Math.min(a.right, toX(t1));
      if (x1 <= x0) return;
      ctx.fillStyle = 'rgba(255, 214, 90, 0.12)';
      ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      if (x1 - x0 > 26) { ctx.fillStyle = 'rgba(255, 214, 90, 0.75)'; ctx.font = '10px system-ui, sans-serif'; ctx.fillText('💡', x0 + 3, a.top + 12); }
    });
    ctx.restore();
  }
};
Chart.register(lightBandPlugin);

// 작은 카드의 그래프를 누르면 큰 창을 열고, 큰 창 안에서 누르면 그 점에 값 마크를 찍는다
function chartClickHandler(evt, elements, chart) {
  const g = liveGraphs.find(x => x.chart === chart);
  if (!g) return;
  if (graphWinId !== g.id) { openGraphWin(g.id, 'graph'); return; }
  g.marks = g.marks || [];
  // 이미 찍힌 마크를 다시 클릭하면(X자 표시 근처) 새로 찍는 대신 그 마크만 지운다
  const hitIdx = g.marks.findIndex(m => {
    const px = chart.scales.x.getPixelForValue(m.x);
    const py = chart.scales.y.getPixelForValue(m.y);
    return Math.hypot(evt.x - px, evt.y - py) <= 10;
  });
  if (hitIdx !== -1) { g.marks.splice(hitIdx, 1); chart.update('none'); return; }
  const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
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

// ── 그래프 큰 창: 그래프 / 데이터 표 / 편집·분석 ─────────────────
// 별도 차트를 새로 만들지 않고 카드의 canvas(=차트)를 창 안으로 옮겼다가 닫을 때 돌려놓는다
// (데이터·설정을 복제할 필요가 없고 항상 최신). 모달을 먼저 보이게 한 뒤 옮겨야 크기가 0으로 잡히지 않는다.
let graphWinId = null, graphWinTab = 'graph', graphTablePage = null;
let graphWinAll = false; // 위쪽 '📋 데이터'로 연 창 = 특정 그래프가 아니라 기록된 모든 변인

function allDataKeys() {
  return [...liveKnownKeys].sort().filter(k => liveRecords.some(r => typeof r[k] === 'number'));
}
function tableKeys() {
  if (graphWinAll) return allDataKeys();
  const g = liveGraphs.find(x => x.id === graphWinId);
  return g ? graphKeys(g) : [];
}
function openDataWin(tab) {
  if (graphWinId != null) closeGraphWin();
  graphWinAll = true;
  document.getElementById('gwTitle').textContent = '전체 데이터';
  const win = document.getElementById('graphWin');
  win.classList.add('visible', 'all-mode');
  graphTablePage = null;
  showGraphWinTab(tab || 'table');
}
document.getElementById('dataWinBtn').addEventListener('click', () => openDataWin('table'));

function openGraphWin(id, tab) {
  const g = liveGraphs.find(x => x.id === id);
  if (!g) return;
  if (graphWinId != null && graphWinId !== id) closeGraphWin();
  graphWinId = id;
  document.getElementById('gwTitle').textContent = graphLabel(g);
  document.getElementById('graphWin').classList.add('visible');
  const canvas = g.chart.canvas;
  const wrap = document.getElementById('gwChartWrap');
  if (canvas.parentElement !== wrap) wrap.appendChild(canvas);
  graphTablePage = null;
  showGraphWinTab(tab || 'graph');
}

function closeGraphWin() {
  const g = liveGraphs.find(x => x.id === graphWinId);
  document.getElementById('graphWin').classList.remove('visible', 'all-mode');
  graphWinAll = false;
  if (g) {
    g.card.querySelector('.fg-chart').prepend(g.chart.canvas);
    g.chart.resize();
  }
  graphWinId = null;
}

function showGraphWinTab(tab) {
  graphWinTab = tab;
  document.querySelectorAll('#graphWin .gw-tab').forEach(b => b.classList.toggle('on', b.dataset.gwTab === tab));
  document.querySelectorAll('#graphWin .gw-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
  if (graphWinAll) {
    if (tab === 'table') renderGraphTable();
    if (tab === 'analysis') {
      const k = (typeof an !== 'undefined' && an.yKey && allDataKeys().includes(an.yKey)) ? an.yKey : allDataKeys()[0];
      if (k && typeof openAnalysisFor === 'function') openAnalysisFor(an.xKey || TIME_AXIS_KEY, k, an.timeUnit);
      if (typeof resizeAnalysisChart === 'function') resizeAnalysisChart();
    }
    return;
  }
  const g = liveGraphs.find(x => x.id === graphWinId);
  if (!g) return;
  if (tab === 'graph') g.chart.resize();
  if (tab === 'table') renderGraphTable();
  if (tab === 'analysis') {
    const s = g.series.find(x => x.visible !== false && x.yKey) || g.series[0];
    if (typeof openAnalysisFor === 'function' && s.yKey) openAnalysisFor(s.xKey, s.yKey, g.timeUnit);
    if (typeof resizeAnalysisChart === 'function') resizeAnalysisChart();
  }
}

function refreshGraphWin() {
  if (graphWinId == null) return;
  const g = liveGraphs.find(x => x.id === graphWinId);
  if (!g) { closeGraphWin(); return; }
  showGraphWinTab(graphWinTab);
}

// 데이터 표: 이 그래프에 쓰인 변인만, 100줄씩 (기본은 가장 최근 쪽)
const TABLE_PAGE = 100;
function renderGraphTable() {
  const g = liveGraphs.find(x => x.id === graphWinId);
  const box = document.getElementById('gwTable');
  const foot = document.getElementById('gwTableFoot');
  if (!g && !graphWinAll) return;
  const keys = tableKeys();
  const rows = keys.length ? liveRecords.filter(r => keys.some(k => typeof r[k] === 'number')) : [];
  if (!rows.length) {
    box.innerHTML = `<div class="empty-hint" style="padding:30px">${keys.length ? '아직 기록된 값이 없어요. 실험을 시작하면 여기에 쌓여요.' : '⚙ 설정에서 변인을 먼저 골라 주세요.'}</div>`;
    foot.innerHTML = '';
    return;
  }
  const pages = Math.ceil(rows.length / TABLE_PAGE);
  if (graphTablePage == null || graphTablePage >= pages) graphTablePage = pages - 1;
  const from = graphTablePage * TABLE_PAGE, to = Math.min(rows.length, from + TABLE_PAGE);
  const unit = resolveTimeUnit(g ? g.timeUnit : 'auto');
  const div = TIME_UNITS[unit].div;
  const t0 = liveSession.startedAt || rows[0]._t;
  const hasLight = rows.some(r => r._light != null);
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4, keepTop = box.scrollTop;
  box.innerHTML = `<table class="gw-table"><thead><tr><th>#</th><th>측정 시각</th><th>경과 시간 (${TIME_UNITS[unit].label})</th>${hasLight ? '<th>조명</th>' : ''}${keys.map(k => `<th>${escHtml(k)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(from, to).map((r, i) => `<tr><td>${from + i + 1}</td><td>${hhmmss(new Date(r._t))}</td><td>${fmtNum((r._t - t0) / 1000 / div)}</td>${hasLight ? `<td class="${r._light ? 'light-on' : ''}">${r._light ? '켬' : '끔'}</td>` : ''}${keys.map(k => `<td>${typeof r[k] === 'number' ? fmtNum(r[k]) : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  foot.innerHTML = `<span class="hint" style="margin:0">${from + 1}~${to}번째 / 전체 ${rows.length}개</span>
    <button class="mini-btn" data-page="first" ${graphTablePage === 0 ? 'disabled' : ''}>처음</button>
    <button class="mini-btn" data-page="prev" ${graphTablePage === 0 ? 'disabled' : ''}>이전</button>
    <button class="mini-btn" data-page="next" ${graphTablePage >= pages - 1 ? 'disabled' : ''}>다음</button>
    <button class="mini-btn" data-page="last" ${graphTablePage >= pages - 1 ? 'disabled' : ''}>최근</button>
    <button class="mini-btn" data-table-csv>데이터(CSV)</button>`;
  box.scrollTop = atBottom ? box.scrollHeight : keepTop;
}

document.getElementById('gwTableFoot').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tableCsv != null) { if (graphWinAll) downloadKeysCsv(allDataKeys(), '전체 데이터'); else downloadGraphData(graphWinId); return; }
  const keys = tableKeys();
  const pages = Math.ceil(liveRecords.filter(r => keys.some(k => typeof r[k] === 'number')).length / TABLE_PAGE);
  graphTablePage = { first: 0, prev: graphTablePage - 1, next: graphTablePage + 1, last: pages - 1 }[b.dataset.page];
  renderGraphTable();
});
document.querySelectorAll('#graphWin .gw-tab').forEach(b => b.addEventListener('click', () => showGraphWinTab(b.dataset.gwTab)));
document.getElementById('gwCloseBtn').addEventListener('click', closeGraphWin);
document.getElementById('gwSettingsBtn').addEventListener('click', () => openGraphSettings(graphWinId));
document.getElementById('gwClearMarksBtn').addEventListener('click', () => clearGraphMarks(graphWinId));
document.getElementById('gwPngBtn').addEventListener('click', () => downloadGraphImage(graphWinId));
document.getElementById('gwCsvBtn').addEventListener('click', () => downloadGraphData(graphWinId));
document.getElementById('graphWin').addEventListener('click', (e) => { if (e.target.id === 'graphWin') closeGraphWin(); });

// ── 그래프 하나(=Chart.js 인스턴스 하나) 만들기 ─────────────────
function buildLiveChart(canvasEl) {
  return new Chart(canvasEl, {
    type: 'scatter',
    data: { datasets: [] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false }, // 선에 딱 안 맞아도 가까이만 가면 툴팁이 뜨게
      onClick: chartClickHandler,
      plugins: {
        legend: { display: false, labels: { color: textColor, boxWidth: 10, font: { size: 10 } }, onClick: legendClickHandler },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ''}: (${fmtNum(ctx.parsed.x)}, ${fmtNum(ctx.parsed.y)})` } },
      },
      scales: {
        x: { title: { display: true, text: '', color: textColor, font: { size: 10 } }, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { title: { display: true, text: '', color: textColor, font: { size: 10 } }, ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      } } });
}

function updateEmptyHint() {
  document.getElementById('lrEmpty').style.display = liveGraphs.length ? 'none' : '';
}

function createGraphObject(seriesArr, opts = {}) {
  const id = ++liveGraphSeq;
  const card = document.createElement('div');
  card.className = 'fg-card';
  document.getElementById('liveGraphs').appendChild(card);
  const pos = opts.x != null ? { x: opts.x, y: opts.y } : nextCardPosition();
  const g = { id, card, title: opts.title || '', xMin: '', xMax: '', xUnit: '', yMin: '', yMax: '', yUnit: '',
    timeUnit: opts.timeUnit || 'auto', xAuto: true, yAuto: true, marks: [], series: seriesArr,
    x: pos.x, y: pos.y, w: opts.w || CARD_W, h: opts.h || CARD_H, collapsed: !!opts.collapsed };
  renderGraphCard(g);
  applyCardGeometry(g);
  g.chart = buildLiveChart(document.getElementById(`liveChart-${id}`));
  liveGraphs.push(g);
  attachGraphDragHandlers(g);
  updateEmptyHint();
  saveGraphLayout();
  return g;
}

function newSeries(xKey, yKey) {
  const sid = ++liveSeriesSeq;
  return { sid, color: yKey ? liveColorFor(yKey) : liveColorFor(String(sid)), xKey: xKey || '', yKey: yKey || '', visible: true };
}

// 빈 그래프 (⚙에서 변인 고르기) - 위쪽 '＋ 그래프'
function addLiveGraph() {
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) { showLiveToast(`그래프는 최대 ${MAX_LIVE_GRAPHS}개까지예요. 안 쓰는 그래프를 지우거나 합쳐 주세요`, true); return null; }
  const g = createGraphObject([newSeries(TIME_AXIS_KEY, '')]);
  refreshLiveSelectOptions();
  updateLiveChart(g);
  return g;
}

// 센서 값 카드를 누르면: 그 센서의 '시간에 따른 변화' 그래프 (이미 있으면 그 카드를 잠깐 깜빡여 알려 줌)
function addGraphForKey(key) {
  const existing = liveGraphs.find(g => g.series.length === 1 && g.series[0].yKey === key && g.series[0].xKey === TIME_AXIS_KEY);
  if (existing) {
    existing.collapsed = false; applyCardGeometry(existing);
    existing.card.classList.remove('flash'); void existing.card.offsetWidth; existing.card.classList.add('flash');
    return existing;
  }
  if (liveGraphs.length >= MAX_LIVE_GRAPHS) { showLiveToast(`그래프는 최대 ${MAX_LIVE_GRAPHS}개까지예요. 안 쓰는 그래프를 지우거나 합쳐 주세요`, true); return null; }
  const g = createGraphObject([newSeries(TIME_AXIS_KEY, key)]);
  updateLiveChart(g);
  updateCardTitleDisplay(g);
  return g;
}

function removeLiveGraph(id) {
  const idx = liveGraphs.findIndex(g => g.id === id);
  if (idx === -1) return;
  if (gsCurrentGraphId === id) closeGraphSettings();
  if (graphWinId === id) closeGraphWin();
  liveGraphs[idx].chart.destroy();
  liveGraphs[idx].card.remove();
  liveGraphs.splice(idx, 1);
  updateEmptyHint();
  saveGraphLayout();
}

document.getElementById('addGraphBtn').addEventListener('click', () => {
  const g = addLiveGraph();
  if (g) openGraphSettings(g.id); // 빈 그래프는 바로 변인을 고르게
});
document.getElementById('arrangeGraphsBtn').addEventListener('click', arrangeGraphs);

// ── 그래프 구성·위치 저장/복원 ────────────────────────────
let graphLayoutRestoring = false;
function saveGraphLayout() {
  if (graphLayoutRestoring || liveFile) return; // 지난 데이터 파일을 보는 중의 그래프는 저장하지 않음
  const data = liveGraphs.map(g => ({ title: g.title, x: g.x, y: g.y, w: g.w, h: g.h, collapsed: !!g.collapsed, timeUnit: g.timeUnit,
    xAuto: g.xAuto, yAuto: g.yAuto, xMin: g.xMin, xMax: g.xMax, yMin: g.yMin, yMax: g.yMax, xUnit: g.xUnit, yUnit: g.yUnit,
    series: g.series.map(s => ({ color: s.color, xKey: s.xKey, yKey: s.yKey, visible: s.visible !== false })) }));
  try { localStorage.setItem(LIVE_GRAPHS_KEY, JSON.stringify(data)); } catch (e) { /* 기억 못 해도 이번엔 동작 */ }
}

(function restoreGraphLayout() {
  let data = [];
  try { data = JSON.parse(localStorage.getItem(LIVE_GRAPHS_KEY) || '[]'); } catch (e) { data = []; }
  graphLayoutRestoring = true;
  for (const d of data.slice(0, MAX_LIVE_GRAPHS)) {
    const series = (d.series || []).map(s => ({ ...newSeries(s.xKey, s.yKey), color: s.color || liveColorFor(s.yKey || 'x'), visible: s.visible !== false }));
    if (!series.length) continue;
    const g = createGraphObject(series, d);
    Object.assign(g, { xAuto: d.xAuto !== false, yAuto: d.yAuto !== false, xMin: d.xMin || '', xMax: d.xMax || '',
      yMin: d.yMin || '', yMax: d.yMax || '', xUnit: d.xUnit || '', yUnit: d.yUnit || '' });
    updateLiveChart(g);
  }
  graphLayoutRestoring = false;
  updateEmptyHint();
})();

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

// ── 센서별 "역할" (어떤 3D 효과로 이어지는지) ──────────────────
// 실험 준비의 '센서 배치'에서 정한다 (live-setup.js의 placeGroup): 놓은 구역 + 센서 종류 → 역할.
// 예: 물속에 놓은 온도 센서 = 수온, 도시 공기에 놓은 온도 센서 = 기온.
// 수온은 아직 전용 3D 효과가 없어서 기온과 동일하게 처리(TODO: 수온 전용 효과 추가 시 분리).
const sensorRoles = {}; // { [센서 키]: roleId }
const roleToEffectKey = { air_temp: 'temp', water_temp: 'temp', co2: 'co2', ph: 'ph', hum: 'hum', methane: 'methane' };

function applyLiveSensorEffects() {
  let matched = false;
  const usedEffectKeys = new Set();

  // 1) 아크릴 위에 배치한 센서가 우선 (이름이 뭐든 상관없이 적용)
  for (const [key, role] of Object.entries(sensorRoles)) {
    const effectKey = roleToEffectKey[role];
    const d = liveLatest[key];
    if (!effectKey || usedEffectKeys.has(effectKey) || !d || typeof d.value !== 'number') continue;
    sensorEffectMap[effectKey](d.value);
    usedEffectKeys.add(effectKey);
    matched = true;
  }

  // 2) 배치 안 한 키는 기존처럼 키 이름 정확 일치로 자동 인식
  for (const [effectKey, applyEffect] of Object.entries(sensorEffectMap)) {
    if (usedEffectKeys.has(effectKey)) continue;
    const matchedKey = [...liveKnownKeys].find(k => !sensorRoles[k] && k.toLowerCase() === effectKey);
    if (matchedKey && liveLatest[matchedKey] && typeof liveLatest[matchedKey].value === 'number') {
      applyEffect(liveLatest[matchedKey].value);
      matched = true;
    }
  }

  if (matched) applyState(sceneLive);
}

// ── 실험 시작/종료 (실험 화면 위쪽 버튼) ──────────────────
// 처음 시작은 실험 준비 화면의 '실험 시작'으로 한다. 여기 버튼은 같은 준비 내용으로 다시 시작할 때 쓴다.
// 자동 시작 조건·자동 종료 시간은 실험 준비의 '실험 설계 → 시뮬레이션 설정'에 있다 (live-setup.js).
function startExperiment() {
  if (liveSession.state === 'armed' || liveSession.state === 'recording') return;
  if (!liveSend({ _type: 'session', action: 'start', config: simConfigFromSetup() })) {
    showLiveToast('서버에 연결되지 않아 실험을 시작할 수 없어요', true);
  }
}

async function endExperiment() {
  const ask = liveSession.state === 'armed'
    ? '자동 시작 조건 대기를 취소할까요? 아직 기록된 값은 없어요.'
    : '실험을 끝낼까요? 끝난 뒤에도 기록은 남아 있고, 그래프를 눌러 데이터 표·편집·내보내기를 할 수 있어요.';
  if (!await liveConfirm(ask)) return;
  liveSend({ _type: 'session', action: 'stop' });
}

// ── 조명 (실제 실험에서 아크릴에 조명을 비추는지) ──────────────────
// 누르면 서버에 알리고, 서버는 기록마다 _light(1/0)를 붙이고 켜고 끈 시각(lightEvents)을 모은다.
// 화면에서는 그래프의 조명 켠 구간을 노랗게, 데이터 표·CSV에 '조명' 칸, 3D 스탠드 조명도 켜고 끈다.
document.getElementById('lightBtn').addEventListener('click', () => {
  const on = !liveSession.light;
  if (!liveSend({ _type: 'session', action: 'light', on })) { showLiveToast('서버에 연결되지 않아 바꿀 수 없어요', true); return; }
  showLiveToast(on ? '💡 조명을 켰어요 — 지금부터 기록에 "조명 켬"으로 남아요' : '조명을 껐어요 — 지금부터 기록에 "조명 끔"으로 남아요');
});

// 3D 아크릴의 스탠드 조명(SpotLight). 실험 화면에서만 켬/끔을 따르고, 준비 화면에서는 늘 켜 둔다 (잘 보이게)
function applyLampLight() {
  if (sceneLive.dormant) return;
  const lamp = sceneLive.scene.children.find(o => o.isSpotLight);
  if (!lamp) return;
  if (lamp.userData.baseIntensity == null) lamp.userData.baseIntensity = lamp.intensity;
  const dim = typeof liveView !== 'undefined' && liveView === 'experiment' && !liveSession.light;
  lamp.intensity = lamp.userData.baseIntensity * (dim ? 0.3 : 1);
}

// 위쪽 큰 버튼 하나로 시작/종료
document.getElementById('startStopBtn').addEventListener('click', () => {
  if (liveFile) { closeDataFile(); return; }
  if (liveSession.state === 'armed' || liveSession.state === 'recording') endExperiment();
  else startExperiment();
});

// main.js가 직접 실험 탭을 열 때 부른다 (다른 탭에서는 서버에 연결할 필요가 없음)
let liveActivated = false;
function activateLiveTab() {
  if (liveActivated) return;
  liveActivated = true;
  renderLiveStatus();
  renderDevicePanel(true);
  connectLiveSocket();
  showLiveSetup();
}

// ── 시리얼 모니터 (위쪽 '🖥 시리얼 모니터') ─────────────────────
// 서버가 보드에서 받은 줄을 그대로 보내 준다 (값이 아닌 디버그 글·오류도). 최근 500줄만 둔다.
const monitorLines = [];
let monitorPaused = false;
function monitorDevName(id) { const d = liveDevices.find(x => x.id === id); return d ? d.name : id; }
function monitorLineHtml(m) {
  const isJson = /^\s*(\[\w+\]\s*)?\{/.test(m.line);
  return `<div class="lm-line${isJson ? ' json' : ''}"><span class="lm-t">${hhmmss(new Date(m.t))}</span><span class="lm-dev">${escHtml(monitorDevName(m.dev))}</span><span class="lm-text">${escHtml(m.line)}</span></div>`;
}
function monitorFilter(m) {
  const dev = document.getElementById('lmDev').value;
  if (dev && m.dev !== dev) return false;
  if (document.getElementById('lmOnlyText').checked && /^\s*(\[\w+\]\s*)?\{/.test(m.line)) return false;
  return true;
}
function renderMonitor() {
  const body = document.getElementById('lmBody');
  body.innerHTML = monitorLines.filter(monitorFilter).map(monitorLineHtml).join('') || '<div class="hint" style="padding:10px">아직 받은 줄이 없어요. 보드를 연결하면 여기에 보여요.</div>';
  body.scrollTop = body.scrollHeight;
}
function refreshMonitorDevs() {
  const sel = document.getElementById('lmDev');
  const cur = sel.value;
  const ids = [...new Set([...liveDevices.map(d => d.id), ...monitorLines.map(m => m.dev)])];
  sel.innerHTML = '<option value="">모든 보드</option>' + ids.map(id => `<option value="${escHtml(id)}"${id === cur ? ' selected' : ''}>${escHtml(monitorDevName(id))}</option>`).join('');
}
function addMonitorLine(m) {
  monitorLines.push(m);
  if (monitorLines.length > 500) monitorLines.splice(0, monitorLines.length - 500);
  const box = document.getElementById('lrMonitor');
  if (!box.classList.contains('visible') || monitorPaused || !monitorFilter(m)) return;
  const body = document.getElementById('lmBody');
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
  if (body.firstElementChild && body.firstElementChild.classList.contains('hint')) body.innerHTML = '';
  body.insertAdjacentHTML('beforeend', monitorLineHtml(m));
  while (body.childElementCount > 500) body.firstElementChild.remove();
  if (atBottom) body.scrollTop = body.scrollHeight;
}
async function openMonitor() {
  const box = document.getElementById('lrMonitor');
  box.classList.add('visible');
  if (!monitorLines.length && liveConnected) {
    try { (await (await fetch('/api/raw')).json()).forEach(m => monitorLines.push(m)); } catch (e) { /* 예전 서버 */ }
  }
  refreshMonitorDevs();
  renderMonitor();
}
document.getElementById('monitorBtn').addEventListener('click', () => {
  const box = document.getElementById('lrMonitor');
  if (box.classList.contains('visible')) box.classList.remove('visible'); else openMonitor();
});
document.getElementById('lmClose').addEventListener('click', () => document.getElementById('lrMonitor').classList.remove('visible'));
document.getElementById('lmClear').addEventListener('click', () => { monitorLines.length = 0; renderMonitor(); });
document.getElementById('lmPause').addEventListener('click', (e) => {
  monitorPaused = !monitorPaused;
  e.target.textContent = monitorPaused ? '▶ 이어서' : '⏸ 멈춤';
  if (!monitorPaused) renderMonitor();
});
document.getElementById('lmDev').addEventListener('change', renderMonitor);
document.getElementById('lmOnlyText').addEventListener('change', renderMonitor);
