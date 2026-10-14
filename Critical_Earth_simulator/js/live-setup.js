// ================= 직접 실험 - 실험 준비 (아크릴 배경 위에서 단계별로) =================
// 처음 화면에서 무엇을 할지 고른다:
//   [📄 기본 코드·회로도 받기] 보드·통신·센서 → 설정 고치기 → 회로도 → 받기(수정본/원본) → (이 코드로 실험 시작)
//   [▶ 실험 시작]              연결 확인 + 센서 배치 (+ 자동 시작·종료) → 실험 시작. 어떤 코드든 값만 오면 됨
//   [📂 지난 데이터 열기]      내보낸 CSV·엑셀을 열어 편집·분석만 (live-file.js)
// 실험 시작을 누르면 실험 화면(tab-live.js, 아크릴 위에 떠 있는 그래프)으로 넘어간다.
// 학생이 코드를 IDE에 올리러 갔다 와도 이어서 할 수 있게, 준비 내용은 이 브라우저에 저장해 둔다.

const SETUP_KEY = 'liveSetupV1';
const DEFAULT_SIM = { triggerOn: false, trigKey: 'co2', trigOp: '>=', trigValue: 8000, stopOn: false, stopH: 6, stopM: 0 };

function freshSetup() {
  return { name: '', mode: null, step: 0, boards: [], sim: { ...DEFAULT_SIM }, placements: {}, measures: {} };
}
let setup = freshSetup();
try { setup = Object.assign(freshSetup(), JSON.parse(localStorage.getItem(SETUP_KEY) || '{}')); } catch (e) { /* 저장소를 못 쓰면 새로 */ }
function saveSetup() {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch (e) { /* 기억 못 해도 이번엔 동작 */ }
}

// 파일 이름에 쓸 수 없는 글자를 빼서 실험 이름을 파일 이름 앞부분으로 쓴다
function safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function experimentFilePrefix() {
  return safeFileName(setup.name) || '실험';
}

// ── 단계 정의 ─────────────────────────────────────
const STEPS = {
  code: [
    { id: 'boards', label: '보드 고르기' },
    { id: 'design', label: '코드 설정', next: '회로도 보기 →' },
    { id: 'wiring', label: '회로도', next: '다음: 받기 →' },
    { id: 'download', label: '코드·회로도 받기', next: '이 코드로 실험 시작 →' },
  ],
  run: [
    { id: 'place', label: '연결 확인 · 센서 배치' },
  ],
};
// 예전 저장 형식(기본/자유 실험)을 새 형식으로
if (setup.mode === 'basic') { setup.mode = setup.step >= 4 ? 'run' : 'code'; if (setup.mode === 'run') setup.step = 0; }
if (setup.mode === 'free') { setup.mode = 'run'; setup.step = 0; }
function currentSteps() { return STEPS[setup.mode] || []; }
function currentStepId() { return (currentSteps()[setup.step] || {}).id; }

// ── 화면 전환: 준비 ↔ 실험 (둘 다 아크릴 전체 화면, 그 위에 띄우는 것만 다름) ─────────────
let liveView = 'setup';
function showLiveSetup() {
  liveView = 'setup';
  document.body.classList.add('live-setup');
  document.body.classList.remove('live-run');
  if (typeof closeGraphWin === 'function') closeGraphWin();
  closeSensorPop();
  applyLampLight();
  fitRenderer();
  updateSensorMarkers();
  renderSetup();
}

// 센서 배치 단계와 실험 화면에서는 오른쪽 창이 아크릴을 가리므로, 3D 화면의 중심을 그 왼쪽 빈 공간의 가운데로 옮긴다
// (나머지 단계는 가운데 창이라 그대로. 카메라는 그대로 두고 그려지는 영역만 밀어서 드래그 회전·확대는 그대로 동작)
function applySetupViewOffset() {
  const panel = document.getElementById('lsPanel');
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  const side = document.querySelector('#liveRun .lr-side');
  let cover = 0;
  if (liveView === 'setup' && document.body.classList.contains('ls-placing') && panel && panel.style.display !== 'none') cover = panel.getBoundingClientRect().width;
  else if (liveView === 'experiment' && side) cover = side.getBoundingClientRect().width;
  if (cover > 0 && w > 0) {
    const shift = Math.round((cover + 12) / 2);
    camera.setViewOffset(w, h, shift, 0, w, h);
  } else {
    camera.clearViewOffset();
  }
}
window.addEventListener('resize', () => setTimeout(applySetupViewOffset, 0));
function showLiveExperiment() {
  liveView = 'experiment';
  document.body.classList.remove('live-setup', 'ls-placing', 'ls-dragging');
  document.body.classList.add('live-run');
  fitRenderer();
  applyLampLight();
  applySetupViewOffset();
  renderDevicePanel(true); // 배치한 구역을 보드 패널에도 반영
  liveGraphs.forEach(g => g.chart.resize());
  if (typeof resizeAnalysisChart === 'function') resizeAnalysisChart();
  renderLiveStatus();
}

// ── 기본 실험 목록 (서버가 basic_experiments/ 폴더를 훑어 만든 목록) ──────
// 보드 이름표("우노 R3 + HM-10 (BLE)")를 '보드 종류'와 '통신 방식'으로 나눠서 단계별로 고르게 한다.
// info.json에 boardType / link를 따로 적어 두면 그 값을 쓴다.
let expIndex = null;
const expCache = {}; // { id: { info, code } }

function splitBoardLabel(label) {
  const m = String(label || '').match(/^(.+?)(?:\s*\+\s*([^()]+?))?\s*\((.+)\)\s*$/);
  if (!m) return { boardType: label || '기타', link: '기본' };
  return { boardType: m[1].trim(), link: m[2] ? `${m[2].trim()} (${m[3].trim()})` : m[3].trim() };
}

async function loadExpIndex() {
  if (expIndex) return expIndex;
  const list = await (await fetch('/basic_experiments/index.json')).json();
  expIndex = list.map(e => ({ ...e, ...splitBoardLabel(e.board), ...(e.boardType ? { boardType: e.boardType } : {}), ...(e.link ? { link: e.link } : {}) }));
  return expIndex;
}

async function loadExp(id) {
  if (expCache[id]) return expCache[id];
  const [info, code] = await Promise.all([
    fetch(`/basic_experiments/${id}/info.json`).then(r => r.json()),
    fetch(`/basic_experiments/${id}/code.ino`).then(r => r.text()),
  ]);
  const norm = code.replace(/\r\n/g, '\n'); // 윈도우 줄바꿈(CRLF)이면 줄 끝 \r 때문에 설정 줄을 못 알아봄
  expCache[id] = { info, code: norm, items: parseSketchSettings(norm) };
  return expCache[id];
}

// ── 코드 설정 줄 읽기·바꾸기 ─────────────────────────────
// 스케치 맨 위의 설정 줄(측정 간격·핀 번호·WiFi 이름 등)을 입력칸으로 보여 주고, 바꾼 값으로 코드를 다시 만든다.
//   표준 코드: 줄 끝에 "// @설정 이름 | 단위 | 설명" 표시가 붙은 줄만 보여 준다 (골라 둔 것만).
//   예전 코드: 표시가 없으면 setup() 앞에 있는 숫자·문자열 상수를 전부 보여 준다.
function parseSketchSettings(code) {
  const lines = code.split('\n');
  const setupIdx = lines.findIndex(l => /^\s*void\s+setup\s*\(/.test(l));
  const items = [];
  lines.forEach((line, i) => {
    if (setupIdx !== -1 && i >= setupIdx) return;
    let m = line.match(/^(\s*(?:static\s+)?const\s+[\w\s*]*?[\s*])(\w+)(\s*=\s*)("(?:[^"\\]|\\.)*"|[-+]?\d+(?:\.\d+)?[uUlLfF]*|A\d+)(\s*;)(.*)$/);
    let kind = 'const';
    if (!m) {
      m = line.match(/^(\s*#define\s+)(\w+)(\s+)("(?:[^"\\]|\\.)*"|[-+]?\d+(?:\.\d+)?[uUlLfF]*|A\d+)()(\s*(?:\/\/.*)?)$/);
      kind = 'define';
    }
    if (!m) return;
    const [, pre, name, mid, rawValue, semi, tail] = m;
    const comment = (tail.match(/\/\/\s*(.*)$/) || [])[1] || '';
    const marker = comment.match(/^@설정\s*(.*)$/);
    const isString = rawValue.startsWith('"');
    const suffix = isString ? '' : (rawValue.match(/[uUlLfF]+$/) || [''])[0];
    const value = isString ? rawValue.slice(1, -1).replace(/\\(.)/g, '$1') : rawValue.slice(0, rawValue.length - suffix.length);
    let label = name, unit = '', help = comment;
    if (marker) [label = name, unit = '', help = ''] = marker[1].split('|').map(s => s.trim());
    items.push({ line: i, name, pre, mid, semi, tail, suffix, isString, original: value, label, unit, help, marked: !!marker, kind });
  });
  return items.some(it => it.marked) ? items.filter(it => it.marked) : items;
}

function boardValue(b, it) {
  return b.values && b.values[it.name] !== undefined ? b.values[it.name] : it.original;
}

function buildBoardCode(b) {
  const ex = expCache[b.expId];
  if (!ex) return '';
  const lines = ex.code.split('\n');
  for (const it of ex.items) {
    const v = boardValue(b, it);
    const out = it.isString ? `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : `${v}${it.suffix}`;
    lines[it.line] = `${it.pre}${it.name}${it.mid}${out}${it.semi}${it.tail}`;
  }
  return lines.join('\n');
}

function msHint(it, v) {
  if (!/_MS$/.test(it.name) && it.unit !== 'ms') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n >= 60000 ? `= ${fmtNum(n / 60000)}분` : `= ${fmtNum(n / 1000)}초`;
}

// 보드 이름(DEVICE_NAME)이 겹치면 MQTT에서 서로 연결을 끊어 버리므로 자동으로 -2, -3을 붙인다
function uniqueDevName(base, exceptUid) {
  const taken = new Set(setup.boards.filter(b => b.uid !== exceptUid).map(b => b.devName));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ── 준비 화면 그리기 ─────────────────────────────────
function renderSetup() {
  const home = document.getElementById('lsHome');
  const panel = document.getElementById('lsPanel');
  const startBtn = document.getElementById('lsStartBtn');
  document.getElementById('lsNameShow').textContent = setup.name ? `실험 이름: ${setup.name}` : '';
  document.getElementById('lsPanelName').textContent = setup.name || '(이름 없음)';
  const hasRecords = liveSession && liveSession.armedAt && (liveSession.state !== 'idle');
  document.getElementById('lsGoExperiment').style.display = hasRecords ? '' : 'none';

  if (!setup.mode) {
    home.style.display = '';
    panel.style.display = 'none';
    startBtn.style.display = 'none';
    document.body.classList.remove('ls-placing');
    closeCodeViewer();
    applySetupViewOffset();
    return;
  }
  home.style.display = 'none';
  panel.style.display = '';
  const steps = currentSteps();
  setup.step = Math.min(setup.step, steps.length - 1);
  document.getElementById('lsSteps').innerHTML = steps.map((s, i) =>
    `<span class="ls-step${i === setup.step ? ' active' : i < setup.step ? ' done' : ''}">${i + 1}. ${s.label}</span>`).join('<span class="ls-step-sep">›</span>');
  const id = currentStepId();
  document.body.classList.toggle('ls-placing', id === 'place');
  if (id !== 'design' && id !== 'download') closeCodeViewer();
  startBtn.style.display = id === 'place' ? '' : 'none';
  const prev = document.getElementById('lsPrev');
  const next = document.getElementById('lsNext');
  prev.textContent = setup.step === 0 ? '← 처음으로' : '← 이전';
  next.style.display = id === 'place' ? 'none' : '';
  next.textContent = steps[setup.step].next || '다음 →';
  next.disabled = id === 'boards' && setup.boards.length === 0;

  const body = document.getElementById('lsBody');
  if (id === 'boards') renderBoardsStep(body);
  else if (id === 'design') renderDesignStep(body);
  else if (id === 'wiring') renderWiringStep(body);
  else if (id === 'download') renderDownloadStep(body);
  else if (id === 'place') renderPlaceStep(body);
  saveSetup();
  applySetupViewOffset();
}

function goStep(delta) {
  const steps = currentSteps();
  if (setup.step + delta < 0) { setup.mode = null; setup.step = 0; renderSetup(); return; }
  // 코드 받기의 마지막 단계에서 '이 코드로 실험 시작' → 실험 시작 쪽으로 (고른 보드의 센서가 배치 칸에 미리 나옴)
  if (setup.mode === 'code' && setup.step + delta >= steps.length) {
    setup.mode = 'run'; setup.step = 0;
    closeCodeViewer();
    renderSetup();
    return;
  }
  setup.step = Math.min(steps.length - 1, setup.step + delta);
  document.getElementById('lsBody').scrollTop = 0;
  closeCodeViewer(); // 단계마다 코드 창의 성격(고치기/읽기)이 달라서 넘어가면 닫고, 필요하면 그 단계에서 다시 연다
  renderSetup();
}
document.getElementById('lsPrev').addEventListener('click', () => goStep(-1));
document.getElementById('lsNext').addEventListener('click', () => goStep(1));

// 실험 종류 카드를 누르면 먼저 실험 이름을 묻고(이미 있으면 확인·수정), 확인하면 그 종류로 들어간다
let pendingMode = null;
function enterMode(mode) {
  if (setup.mode !== mode) setup.step = 0;
  setup.mode = mode;
  renderSetup();
}
function resetSetup() {
  setup = freshSetup();
  clearAllPlacements();
  saveSetup();
}
document.getElementById('lsHome').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-mode]');
  if (!card) return;
  // 지난번 준비 내용(보드·배치)이 남아 있으면 이어서 할지 새로 할지 먼저 묻는다
  const nb = setup.boards.length, np = Object.keys(setup.placements).length;
  if (nb || np) {
    const parts = [nb ? `보드 ${nb}대` : '', np ? `센서 배치 ${np}개` : ''].filter(Boolean).join(' · ');
    const cont = await liveConfirm(`지난번에 준비하던 내용이 남아 있어요${setup.name ? ` ("${setup.name}")` : ''} — ${parts}.\n이어서 할까요, 지우고 새로 준비할까요?`,
      { yes: '이어서 하기', no: '지우고 새로 준비' });
    if (!cont) resetSetup();
  }
  pendingMode = card.dataset.mode;
  openNameModal();
});
document.getElementById('lsGoExperiment').addEventListener('click', showLiveExperiment);

// ── 실험 이름 ─────────────────────────────────────
// 이름을 안 정하면 '이름없음1', '이름없음2' … (이 브라우저에서 센 번호)
function autoExperimentName() {
  let n = 0;
  try { n = Number(localStorage.getItem('liveUnnamedSeq')) || 0; localStorage.setItem('liveUnnamedSeq', String(n + 1)); } catch (e) { /* 저장 못 하면 1부터 */ }
  return `이름없음${n + 1}`;
}
function openNameModal() {
  const input = document.getElementById('lsNameInput');
  input.value = setup.name || '';
  document.getElementById('lsNameModal').classList.add('visible');
  setTimeout(() => input.focus(), 50);
}
function saveName() {
  const v = document.getElementById('lsNameInput').value.trim();
  setup.name = v || autoExperimentName();
  document.getElementById('lsNameModal').classList.remove('visible');
  saveSetup();
  if (pendingMode) { const m = pendingMode; pendingMode = null; enterMode(m); }
  else renderSetup();
}
document.getElementById('lsNameSaveBtn').addEventListener('click', saveName);
document.getElementById('lsNameCancelBtn').addEventListener('click', () => {
  pendingMode = null;
  document.getElementById('lsNameModal').classList.remove('visible');
});
document.getElementById('lsNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
document.querySelectorAll('[data-action="rename"]').forEach(el => el.addEventListener('click', openNameModal));
document.getElementById('lsNewBtn').addEventListener('click', async () => {
  if (!await liveConfirm('지금까지 준비한 내용(보드·설정·배치)을 지우고 새 실험을 준비할까요? 이미 기록한 실험 데이터는 지워지지 않아요.')) return;
  resetSetup();
  renderSetup();
});
// 단계 창 위의 '준비 취소' — 준비한 내용을 지우고 처음 화면으로
document.getElementById('lsCancelBtn').addEventListener('click', async () => {
  if (!await liveConfirm('실험 준비를 취소할까요? 고른 보드·설정·센서 배치가 지워지고 처음 화면으로 돌아가요. 이미 기록한 실험 데이터는 지워지지 않아요.',
    { yes: '준비 취소', no: '계속 준비' })) return;
  closeCodeViewer();
  resetSetup();
  renderSetup();
});

// ── ① 보드 고르기 (보드 종류 → 통신 방식 → 센서, 여러 대 가능) ─────────
const boardPick = { type: '', link: '', sensors: [] };

async function renderBoardsStep(body) {
  const idx = await loadExpIndex().catch(() => null);
  if (!idx) { body.innerHTML = '<div class="empty-hint">기본 실험 목록을 불러오지 못했어요. server.py가 켜져 있는지 확인하세요.</div>'; return; }
  const types = [...new Set(idx.map(e => e.boardType))];
  const links = boardPick.type ? [...new Set(idx.filter(e => e.boardType === boardPick.type).map(e => e.link))] : [];
  if (boardPick.link && !links.includes(boardPick.link)) boardPick.link = '';
  const pool = idx.filter(e => e.boardType === boardPick.type && e.link === boardPick.link);
  const tags = [...new Set(pool.flatMap(e => e.sensors))].sort();
  boardPick.sensors = boardPick.sensors.filter(s => tags.includes(s));
  const matches = pool.filter(e => e.sensors.length === boardPick.sensors.length && e.sensors.every(s => boardPick.sensors.includes(s)));

  const chip = (group, v, on) => `<button class="ls-chip${on ? ' on' : ''}" data-pick="${group}" data-v="${escHtml(v)}">${escHtml(v)}</button>`;
  body.innerHTML = `
    <div class="ls-section">
      <div class="ls-section-title">내 실험에 쓰는 보드 <span class="hint" style="margin:0">(여러 대를 동시에 쓸 수 있어요)</span></div>
      ${setup.boards.length ? setup.boards.map((b, i) => `
        <div class="ls-board">
          <span class="ls-board-num">${i + 1}</span>
          <div class="ls-board-main"><div class="ls-board-title">${escHtml(b.devName || b.title)}</div>
            <div class="ls-board-sub">${escHtml(b.boardType)} · ${escHtml(b.link)} · ${escHtml((b.sensors || []).join(', ') || '센서 없음')}</div></div>
          <button class="icon-btn remove-btn" data-remove-board="${b.uid}" title="빼기">✕</button>
        </div>`).join('') : '<div class="empty-hint">아직 고른 보드가 없어요. 아래에서 골라 추가하세요.</div>'}
    </div>
    <div class="ls-section ls-add">
      <div class="ls-section-title">보드 추가</div>
      <div class="ls-pick-label">1) 보드 종류</div>
      <div class="ls-chips">${types.map(t => chip('type', t, t === boardPick.type)).join('')}</div>
      ${boardPick.type ? `<div class="ls-pick-label">2) 통신 방식</div><div class="ls-chips">${links.map(l => chip('link', l, l === boardPick.link)).join('')}</div>` : ''}
      ${boardPick.link ? `<div class="ls-pick-label">3) 연결한 센서 <span class="hint" style="margin:0">(실제로 연결한 것을 전부)</span></div>
        <div class="ls-chips">${tags.length ? tags.map(s => chip('sensor', s, boardPick.sensors.includes(s))).join('') : '<span class="hint" style="margin:0">이 조합에는 센서별 코드가 없어요 (통신 연결 예시만 있음)</span>'}</div>
        <div class="ls-matches">${matches.length ? matches.map(e => `
          <div class="ls-match"><div>${escHtml(e.title)}</div><button class="mini-btn primary" data-add-exp="${escHtml(e.id)}">이 보드 추가</button></div>`).join('')
          : `<div class="empty-hint">${boardPick.sensors.length ? '이 센서 조합의 코드는 아직 없어요. 다른 조합을 고르거나, 코드를 직접 준비해서 처음 화면의 <b>실험 시작</b>으로 진행하세요.' : '연결한 센서를 골라 주세요.'}</div>`}</div>` : ''}
    </div>`;
}

document.getElementById('lsBody').addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const v = pick.dataset.v;
    if (pick.dataset.pick === 'type') { boardPick.type = v; boardPick.link = ''; boardPick.sensors = []; }
    else if (pick.dataset.pick === 'link') { boardPick.link = v; boardPick.sensors = []; }
    else {
      const i = boardPick.sensors.indexOf(v);
      if (i === -1) boardPick.sensors.push(v); else boardPick.sensors.splice(i, 1);
    }
    renderSetup();
    return;
  }
  const add = e.target.closest('[data-add-exp]');
  if (add) {
    const id = add.dataset.addExp;
    const meta = expIndex.find(x => x.id === id);
    const ex = await loadExp(id);
    const uid = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const b = { uid, expId: id, title: meta.title, boardType: meta.boardType, link: meta.link, sensors: meta.sensors, values: {}, devName: '' };
    const nameItem = ex.items.find(it => it.name === 'DEVICE_NAME');
    if (nameItem) {
      b.devName = uniqueDevName(nameItem.original, uid);
      if (b.devName !== nameItem.original) b.values.DEVICE_NAME = b.devName;
    }
    setup.boards.push(b);
    boardPick.sensors = [];
    showLiveToast(`보드 ${setup.boards.length}번을 추가했어요${b.devName ? ` (이름 ${b.devName})` : ''}`);
    renderSetup();
    return;
  }
  const rm = e.target.closest('[data-remove-board]');
  if (rm) {
    setup.boards = setup.boards.filter(b => b.uid !== rm.dataset.removeBoard);
    renderSetup();
    return;
  }
  const tab = e.target.closest('[data-board-tab]');
  if (tab) { designBoardUid = tab.dataset.boardTab; renderSetup(); return; }
  const reset = e.target.closest('[data-reset-board]');
  if (reset) {
    const b = setup.boards.find(x => x.uid === reset.dataset.resetBoard);
    const keepName = b.values.DEVICE_NAME;
    b.values = keepName ? { DEVICE_NAME: keepName } : {};
    renderSetup();
    return;
  }
});

// ── ② 실험 설계 (보드 코드 설정 / 시뮬레이션 설정) ──────────────
let designBoardUid = null;

function boardTabsHtml() {
  if (setup.boards.length < 2) return '';
  return `<div class="ls-board-tabs">${setup.boards.map((b, i) =>
    `<button class="ls-chip${b.uid === designBoardUid ? ' on' : ''}" data-board-tab="${b.uid}">${i + 1}. ${escHtml(b.devName || b.boardType)}</button>`).join('')}</div>`;
}

function simSettingsHtml() {
  const s = setup.sim;
  const keys = [...new Set([...liveKnownKeys, 'co2', 'temp', 'temp2', 'ph', 'hum', 'methane'])];
  return `
    <div class="ls-section ls-sim">
      <div class="ls-section-title">시뮬레이션 설정 <span class="ls-badge ok">실험 시작 전까지 언제든 바꿀 수 있어요</span></div>
      <p class="hint" style="margin:0 0 8px">둘 다 선택 기능이에요. 체크하지 않으면 '실험 시작'을 누르는 즉시 기록하고, '실험 종료'를 누를 때까지 계속 기록해요.</p>
      <label class="ls-check"><input type="checkbox" data-sim="triggerOn" ${s.triggerOn ? 'checked' : ''}> 조건이 맞으면 기록 자동 시작</label>
      <div class="ls-row">
        <input class="modal-input" list="lsKeyList" data-sim="trigKey" value="${escHtml(s.trigKey)}" placeholder="센서 이름 (예: co2)" ${s.triggerOn ? '' : 'disabled'}>
        <select class="modal-input" data-sim="trigOp" style="flex:0 0 90px" ${s.triggerOn ? '' : 'disabled'}>
          <option value=">="${s.trigOp === '>=' ? ' selected' : ''}>이상 (≥)</option><option value="<="${s.trigOp === '<=' ? ' selected' : ''}>이하 (≤)</option></select>
        <input class="modal-input" type="number" step="any" data-sim="trigValue" value="${escHtml(s.trigValue)}" style="flex:0 0 100px" ${s.triggerOn ? '' : 'disabled'}>
      </div>
      <datalist id="lsKeyList">${keys.map(k => `<option value="${escHtml(k)}">`).join('')}</datalist>
      <label class="ls-check"><input type="checkbox" data-sim="stopOn" ${s.stopOn ? 'checked' : ''}> 정해진 시간이 지나면 자동 종료</label>
      <div class="ls-row" style="align-items:center">
        <input class="modal-input" type="number" min="0" step="1" data-sim="stopH" value="${s.stopH}" style="flex:0 0 74px" ${s.stopOn ? '' : 'disabled'}><span class="hint" style="margin:0">시간</span>
        <input class="modal-input" type="number" min="0" max="59" step="1" data-sim="stopM" value="${s.stopM}" style="flex:0 0 74px" ${s.stopOn ? '' : 'disabled'}><span class="hint" style="margin:0">분 (기록이 시작된 순간부터)</span>
      </div>
    </div>`;
}

// 보드 코드의 설정 칸들 (big = 코드 받기 단계의 큰 칸, locked = 원본 코드를 보고 있어서 못 고침)
function codeSettingsFormHtml(b, ex, big, locked) {
  const changed = ex.items.filter(it => String(boardValue(b, it)) !== String(it.original)).length;
  return `<div class="cs-form${big ? ' big' : ''}">${ex.items.map((it, idx) => {
        const v = boardValue(b, it);
        const numeric = !it.isString && /^[-+]?\d/.test(it.original);
        const isChanged = String(v) !== String(it.original);
        return `<div class="cs-row${isChanged ? ' changed' : ''}" data-row="${idx}">
          <div class="cs-label">${escHtml(it.label)}${it.label !== it.name ? ` <code>${escHtml(it.name)}</code>` : ''}</div>
          <div class="cs-input-row">
            <input class="modal-input" ${numeric ? 'type="number" step="any"' : 'type="text"'} value="${escHtml(locked ? it.original : v)}" data-setting="${idx}"${locked ? ' disabled' : ''}>
            <span class="cs-unit">${escHtml(it.unit)}</span><span class="cs-hint">${msHint(it, locked ? it.original : v)}</span>
          </div>
          <div class="cs-help">${it.help ? escHtml(it.help) + ' · ' : ''}처음 값: <b>${escHtml(it.original)}</b></div>
        </div>`;
      }).join('')}</div>
      <div class="cs-footer"><span class="cs-changed">${changed ? `바꾼 설정 ${changed}개` : ''}</span>
        ${changed && !locked ? `<button class="mini-btn" data-reset-board="${b.uid}">처음 값으로</button>` : ''}</div>`;
}

function renderDesignStep(body) {
  if (!setup.boards.some(b => b.uid === designBoardUid)) designBoardUid = setup.boards[0] && setup.boards[0].uid;
  const b = setup.boards.find(x => x.uid === designBoardUid);
  const ex = b && expCache[b.expId];
  if (b && !ex) { loadExp(b.expId).then(renderSetup); body.innerHTML = '<div class="empty-hint">코드를 불러오는 중…</div>'; return; }
  const ci = (ex && ex.info.codeInfo) || {};
  body.innerHTML = `
    ${boardTabsHtml()}
    ${b ? `<div class="ls-section">
      <div class="ls-section-title">코드 설명 — ${escHtml(b.title)}</div>
      <table class="pinmap-table ls-info"><tbody>${[
        ['하는 일', ci.description], ['필요 라이브러리', ci.libraries], ['전송 간격', ci.sendInterval],
        ['측정 간격', ci.measureInterval], ['실패하면', ci.onFailure], ['원격 제어', ci.control],
      ].filter(([, v]) => v).map(([l, v]) => `<tr><th>${l}</th><td>${v}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="ls-section">
      <div class="ls-section-title">보드 코드에 들어가는 설정 <span class="ls-badge warn">바꾸면 다시 업로드해야 해요</span></div>
      <p class="hint" style="margin:0 0 8px">원하는 실험에 맞게 고치세요. 고친 값이 다운로드하는 코드에 그대로 들어가요. '처음 값'은 코드에 원래 적혀 있던 값이에요.</p>
      ${codeSettingsFormHtml(b, ex)}
      <button class="mini-btn" data-open-code="${b.uid}">📄 코드 전문 보기 (왼쪽 창)</button>
      <span class="hint" style="margin:0 0 0 6px">설정 칸에 커서를 두면 코드의 그 줄이 표시돼요</span>
    </div>` : ''}`;
  if (document.body.classList.contains('ls-code-open') && b) renderCodeViewer(b);
}

// 설정 값 바꾸기 - 오른쪽 설정 칸과 왼쪽 코드 창의 칸 어느 쪽에서 고쳐도 같은 값으로 맞춘다
function setSettingValue(idx, raw, sourceEl) {
  const b = setup.boards.find(x => x.uid === designBoardUid);
  if (!b) return;
  const items = expCache[b.expId].items;
  const it = items[idx];
  // 숫자 칸을 비우면 코드가 컴파일되지 않으므로 처음 값으로 둔다
  const v = !it.isString && raw === '' ? it.original : raw;
  b.values[it.name] = v;
  if (it.name === 'DEVICE_NAME') b.devName = v;
  document.querySelectorAll(`[data-setting="${idx}"], [data-code-setting="${idx}"]`).forEach(el => {
    if (el !== sourceEl && el.value !== String(v)) el.value = v;
  });
  const row = document.querySelector(`#lsBody .cs-row[data-row="${idx}"]`);
  if (row) {
    row.classList.toggle('changed', String(v) !== String(it.original));
    row.querySelector('.cs-hint').textContent = msHint(it, v);
  }
  const codeLine = document.querySelector(`#lsCodeBody .lc-line[data-line="${it.line}"]`);
  if (codeLine) codeLine.classList.toggle('changed', String(v) !== String(it.original));
  const n = items.filter(x => String(boardValue(b, x)) !== String(x.original)).length;
  const note = document.querySelector('#lsBody .cs-changed');
  if (note) note.textContent = n ? `바꾼 설정 ${n}개` : '';
  saveSetup();
}

document.getElementById('lsBody').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.setting != null) { setSettingValue(Number(el.dataset.setting), el.value, el); return; }
  if (el.dataset.sim) {
    const k = el.dataset.sim;
    setup.sim[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
    saveSetup();
    if (k === 'triggerOn' || k === 'stopOn') renderSetup(); // 입력칸 켜고 끄기
  }
});

// 다른 보드와 이름이 겹치게 고쳤으면 칸을 벗어날 때 알려 준다
document.getElementById('lsBody').addEventListener('change', (e) => {
  if (e.target.dataset.setting == null) return;
  const b = setup.boards.find(x => x.uid === designBoardUid);
  if (b && b.devName && setup.boards.some(x => x.uid !== b.uid && x.devName === b.devName)) {
    showLiveToast(`'${b.devName}'은(는) 다른 보드와 이름이 같아요. 서로 다르게 정해 주세요 (WiFi에서 서로 연결을 끊어요)`, true);
  }
});

// ── 코드 전문 보기 (왼쪽 창) ────────────────────────────
// 오른쪽 설정 칸에 커서를 두면 그 값이 들어가는 코드 줄이 색으로 표시되고, 코드 창 안의 값 칸에서 바로 고쳐도 된다.
// 라이브러리·핀 정의·함수 같은 줄에 마우스를 올리면 설명이 뜨고, 누르면 설명 줄이 펼쳐졌다 다시 누르면 접힌다.
const LIB_HELP = {
  'Wire.h': 'I2C 통신 라이브러리 — SDA·SCL 두 선으로 센서(SCD30 등)와 데이터를 주고받아요',
  'Adafruit_SCD30.h': 'SCD30(CO₂·온도·습도 센서)을 읽는 Adafruit 라이브러리',
  'OneWire.h': '1-Wire 통신 — 데이터 선 하나에 DS18B20 여러 개를 연결할 수 있게 해 줘요',
  'DallasTemperature.h': 'DS18B20 온도 센서 값을 °C로 읽어 주는 라이브러리 (OneWire 위에서 동작)',
  'SoftwareSerial.h': '일반 디지털 핀 두 개로 시리얼 통신을 흉내 내요 (MH-Z19B·블루투스 모듈 연결용)',
  'WiFi.h': 'ESP32를 와이파이에 연결해요',
  'PubSubClient.h': 'MQTT로 값을 발행(보내기)하고 명령을 구독(받기)해요',
  'BluetoothSerial.h': 'ESP32의 클래식 블루투스 시리얼 — 휴대폰 블루투스 앱과 글자를 주고받아요',
  'BLEDevice.h': 'ESP32의 BLE(저전력 블루투스) 기능', 'BLEServer.h': 'BLE 서버(서비스·특성) 만들기',
  'BLEUtils.h': 'BLE 보조 기능', 'BLE2902.h': 'BLE 알림(notify)을 받을 수 있게 하는 설정',
  'avr/wdt.h': '감시 타이머(watchdog) — 재부팅 명령을 받으면 이걸로 우노를 리셋해요',
  'ArduinoJson.h': 'JSON 글자를 만들고 읽는 라이브러리', 'Arduino.h': '아두이노 기본 기능 (보통 자동으로 포함됨)',
};
const FN_HELP = {
  setup: '전원이 켜지거나 리셋될 때 딱 한 번 실행 — 통신 시작, 센서 준비',
  loop: '계속 반복 실행 — 명령이 왔는지 보고, 정해진 간격마다 측정·전송',
  sendData: '센서를 읽어 JSON 한 줄로 보내요 (읽기 실패한 값은 빼고)',
  sendInfo: '보드 정보(센서 목록·켜짐 상태·측정 간격)를 시뮬레이션 화면에 알려요',
  handleCommand: '화면에서 온 명령(센서 켜기·끄기, 간격, 멈춤, 재부팅)을 처리해요',
  readCO2: 'MH-Z19B에 "값 줘" 명령을 보내고 9바이트 응답에서 CO₂ 값을 꺼내요 (체크섬으로 깨진 응답 거르기)',
  pollCommands: '통로로 들어온 글자를 모아 한 줄이 되면 명령으로 처리해요',
  keepConnected: '와이파이·MQTT 연결이 끊기면 몇 초마다 다시 연결해요',
  addNum: '이번에 보낼 값을 하나 모아 둬요 (읽기 실패한 값은 빼요)',
  emitLine: '모은 JSON 한 줄을 통로(USB·블루투스·MQTT)로 내보내요',
  findKey: '명령 글자에서 "이름": 다음의 값 위치를 찾아요', jsonNum: '명령 글자에서 숫자 값을 꺼내요', jsonIs: '명령 글자의 값이 특정 글자와 같은지 확인해요',
};

let codeViewerUid = null;
const codeTips = []; // 줄 번호 → 설명

function explainLine(line, i, lines, settingAt) {
  const s = settingAt[i];
  if (s) return `보드 코드 설정 · ${s.label}${s.unit ? ` (${s.unit})` : ''}${s.help ? ` — ${s.help}` : ''} · 처음 값 ${s.original}`;
  let m = line.match(/^\s*#include\s*[<"]([^>"]+)[>"]/);
  if (m) return `라이브러리 ${m[1]} — ${LIB_HELP[m[1]] || '이 코드에 필요한 기능을 불러와요'}`;
  m = line.match(/^\s*(?:static\s+)?[\w:<>]+[\s*&]+(\w+)\s*\([^;]*\)\s*\{?\s*$/);
  if (m && !/^\s*(if|for|while|switch|return|else)\b/.test(line)) {
    if (FN_HELP[m[1]]) return `함수 ${m[1]}() — ${FN_HELP[m[1]]}`;
    const above = [];
    for (let k = i - 1; k >= 0 && /^\s*\/\//.test(lines[k]); k--) above.unshift(lines[k].replace(/^\s*\/\/\s?/, '').replace(/[─=]{3,}/g, '').trim());
    if (above.join('').trim()) return `함수 ${m[1]}() — ${above.filter(Boolean).join(' ')}`;
  }
  m = line.match(/\/\/\s*(.+)$/);
  if (m && !/^\s*\/\//.test(line) && !/@설정/.test(line)) return m[1].trim();
  if (/^\s*#define\s+\w+/.test(line)) return '이름 붙인 값(상수) — 코드 여러 곳에서 이 이름으로 씀';
  return '';
}

// 실험 설계 단계: 값을 고칠 수 있는 코드 / 코드 받기 단계: 고른 버전(수정본·원본)을 읽기 전용으로
function renderCodeViewer(b) {
  const ex = expCache[b.expId];
  if (!ex) return;
  codeViewerUid = b.uid;
  const inDownload = currentStepId() === 'download';
  const original = inDownload && codeChoice[b.uid] === 'original';
  const readOnly = original;
  const valueOf = (s) => original ? s.original : boardValue(b, s);
  const lines = ex.code.split('\n');
  const settingAt = {};
  ex.items.forEach((it, idx) => { settingAt[it.line] = { ...it, idx }; });
  codeTips.length = 0;
  const highlightComment = (txt) => {
    const e = escHtml(txt);
    const at = e.indexOf('//');
    return at === -1 ? e : `${e.slice(0, at)}<span class="lc-c">${e.slice(at)}</span>`;
  };
  document.getElementById('lsCodeTitle').textContent = `${b.devName || b.title}${inDownload ? '' : ' — 코드 전문'}`;
  document.getElementById('lsCodeHint').textContent = original
    ? '설정을 바꾸기 전 처음 코드예요 · 줄에 마우스를 올리면 설명'
    : '색칠된 값은 여기서 바로 고쳐도 돼요 · 줄에 마우스를 올리면 설명, 누르면 설명 펼치기';
  const ver = document.getElementById('lsCodeVer');
  ver.style.display = inDownload ? '' : 'none';
  ver.querySelectorAll('[data-ver]').forEach(x => x.classList.toggle('on', x.dataset.ver === (original ? 'original' : 'modified')));
  document.getElementById('lsCodeBody').innerHTML = lines.map((line, i) => {
    const tip = explainLine(line, i, lines, settingAt);
    codeTips[i] = tip;
    const s = settingAt[i];
    let html;
    if (s) {
      const v = valueOf(s);
      const w = Math.max(3, String(v).length + 1);
      const input = readOnly
        ? `<span class="lc-val">${escHtml(v)}</span>`
        : `<input class="lc-input" data-code-setting="${s.idx}" value="${escHtml(v)}" style="width:${w}ch" spellcheck="false">`;
      html = `${escHtml(s.pre + s.name + s.mid)}${s.isString ? `"${input}"` : `${input}${escHtml(s.suffix)}`}${highlightComment(s.semi + s.tail)}`;
    } else html = highlightComment(line) || '&nbsp;';
    const changed = s && !original && String(boardValue(b, s)) !== String(s.original);
    return `<div class="lc-line${s ? ' setting' : ''}${changed ? ' changed' : ''}${tip ? ' has-tip' : ''}" data-line="${i}">` +
      `<span class="lc-no">${i + 1}</span><span class="lc-src">${html}</span></div>`;
  }).join('');
}

function openCodeViewer(uid) {
  const b = setup.boards.find(x => x.uid === uid);
  if (!b) return;
  document.body.classList.add('ls-code-open');
  renderCodeViewer(b);
  // 코드 받기 단계에서 수정본을 열면 바꾼 첫 줄로 바로 (원본·설계 단계는 설정 줄 시작 부분으로)
  const target = document.querySelector('#lsCodeBody .lc-line.changed') || document.querySelector('#lsCodeBody .lc-line.setting');
  if (target) target.scrollIntoView({ block: 'center' });
}
function closeCodeViewer() {
  document.body.classList.remove('ls-code-open');
  hideCodeTip();
}
document.getElementById('lsCodeClose').addEventListener('click', closeCodeViewer);
document.getElementById('lsBody').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open-code]');
  if (open) openCodeViewer(open.dataset.openCode);
});

// 설정 칸 ↔ 코드 줄 표시
function markSetting(idx, scrollCode, scrollRow) {
  document.querySelectorAll('.lc-line.active, .cs-row.active').forEach(el => el.classList.remove('active'));
  const b = setup.boards.find(x => x.uid === designBoardUid);
  if (!b || idx == null) return;
  const it = expCache[b.expId].items[idx];
  const line = document.querySelector(`#lsCodeBody .lc-line[data-line="${it.line}"]`);
  const row = document.querySelector(`#lsBody .cs-row[data-row="${idx}"]`);
  if (line) { line.classList.add('active'); if (scrollCode) line.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  if (row) { row.classList.add('active'); if (scrollRow) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
document.getElementById('lsBody').addEventListener('focusin', (e) => {
  if (e.target.dataset.setting != null) markSetting(Number(e.target.dataset.setting), true, false);
});
document.getElementById('lsCodeBody').addEventListener('focusin', (e) => {
  if (e.target.dataset.codeSetting != null) markSetting(Number(e.target.dataset.codeSetting), false, true);
});
document.getElementById('lsCodeBody').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.codeSetting == null) return;
  el.style.width = `${Math.max(3, el.value.length + 1)}ch`;
  setSettingValue(Number(el.dataset.codeSetting), el.value, el);
});

// 마우스를 올리면 설명 말풍선, 누르면 설명 줄 펼치기/접기
function hideCodeTip() { document.getElementById('lsTip').classList.remove('visible'); }
document.getElementById('lsCodeBody').addEventListener('mousemove', (e) => {
  const line = e.target.closest('.lc-line.has-tip');
  const tip = document.getElementById('lsTip');
  if (!line || e.target.closest('.lc-explain')) { hideCodeTip(); return; }
  tip.textContent = codeTips[Number(line.dataset.line)];
  tip.style.left = `${Math.min(window.innerWidth - 340, e.clientX + 14)}px`;
  tip.style.top = `${Math.min(window.innerHeight - 80, e.clientY + 16)}px`;
  tip.classList.add('visible');
});
document.getElementById('lsCodeBody').addEventListener('mouseleave', hideCodeTip);
document.getElementById('lsCodeBody').addEventListener('click', (e) => {
  if (e.target.closest('input')) return;
  const line = e.target.closest('.lc-line.has-tip');
  if (!line) return;
  const next = line.nextElementSibling;
  if (next && next.classList.contains('lc-explain')) { next.remove(); return; }
  line.insertAdjacentHTML('afterend', `<div class="lc-explain">${escHtml(codeTips[Number(line.dataset.line)])}</div>`);
});

// ── ③ 회로도 (핀맵) ───────────────────────────────────
function renderWiringStep(body) {
  const missing = setup.boards.filter(b => !expCache[b.expId]);
  if (missing.length) { Promise.all(missing.map(b => loadExp(b.expId))).then(renderSetup); body.innerHTML = '<div class="empty-hint">불러오는 중…</div>'; return; }
  body.innerHTML = setup.boards.map((b, i) => {
    const ex = expCache[b.expId];
    const info = ex.info;
    const pinChanges = ex.items.filter(it => /PIN/.test(it.name) && String(boardValue(b, it)) !== String(it.original));
    return `<div class="ls-section">
      <div class="ls-section-title">${i + 1}. ${escHtml(b.devName || b.title)} <span class="hint" style="margin:0">${escHtml(b.boardType)} · ${escHtml(b.link)}</span></div>
      ${pinChanges.length ? `<div class="ls-callout">설계에서 바꾼 핀이 있어요. 아래 표의 핀 대신 <b>바꾼 핀</b>에 꽂으세요:<br>
        ${pinChanges.map(it => `${escHtml(it.label)}: ${escHtml(it.original)} → <b>${escHtml(boardValue(b, it))}</b>`).join('<br>')}</div>` : ''}
      ${(info.pinmap || []).map(g => `
        <div class="pinmap-device-title">${g.device}</div>
        <table class="pinmap-table"><thead><tr><th>보드</th><th>${g.device}</th></tr></thead>
        <tbody>${g.pins.map(p => `<tr><td>${p.board}</td><td>${p.device}</td></tr>`).join('')}</tbody></table>`).join('') || '<div class="empty-hint">이 실험에는 핀맵이 없어요.</div>'}
      ${info.notes && info.notes.length ? `<details class="ls-details" open><summary>연결 유의사항</summary><ul class="modal-notes">${info.notes.map(n => `<li>${n}</li>`).join('')}</ul></details>` : ''}
      ${info.specs && info.specs.length ? `<details class="ls-details"><summary>센서 사양</summary>${info.specs.map(g => `
        <div class="pinmap-device-title">${g.device}</div>
        <table class="pinmap-table"><tbody>${g.items.map(it => `<tr><th>${it.label}</th><td>${it.value}</td></tr>`).join('')}</tbody></table>`).join('')}</details>` : ''}
    </div>`;
  }).join('');
}

// ── ④ 코드 받기 ───────────────────────────────────────
// 보드마다 '수정한 코드'와 '원본 코드' 중 무엇을 받을지 고른다 (기본: 수정한 코드)
const codeChoice = {}; // { uid: 'modified' | 'original' }
function chosenCode(b) {
  return codeChoice[b.uid] === 'original' ? expCache[b.expId].code : buildBoardCode(b);
}

function boardCodeFileName(b, i) {
  const tail = codeChoice[b.uid] === 'original' ? '_원본' : '';
  return `${experimentFilePrefix()}_${safeFileName(b.devName) || `보드${i + 1}`}${tail}.ino`;
}

function downloadBoardCode(uid) {
  const i = setup.boards.findIndex(x => x.uid === uid);
  const b = setup.boards[i];
  if (!b) return;
  downloadBlob(new Blob([chosenCode(b)], { type: 'text/plain;charset=utf-8' }), boardCodeFileName(b, i));
}

// ── 회로도 이미지(PNG): 보드 핀 ↔ 센서 핀 표. 수정본이면 바꾼 핀(…_PIN 설정)을 표에 반영하고 따로 적는다 ──
function wiringPinChanges(b, original) {
  if (original) return [];
  return expCache[b.expId].items.filter(it => /PIN/.test(it.name) && String(boardValue(b, it)) !== String(it.original))
    .map(it => ({ label: it.label, from: String(it.original), to: String(boardValue(b, it)) }));
}
function downloadWiringPng(uid) {
  const i = setup.boards.findIndex(x => x.uid === uid);
  const b = setup.boards[i];
  if (!b) return;
  const info = expCache[b.expId].info;
  const original = codeChoice[b.uid] === 'original';
  const changes = wiringPinChanges(b, original);
  // 표의 보드 쪽 칸에서 'GPIO21'·'D4' 같은 핀 이름의 숫자를 바꾼 값으로
  const swap = (txt) => {
    let s = String(txt);
    for (const c of changes) {
      const re = new RegExp(`(GPIO|D|A|핀\s*)${c.from}(?!\d)`, 'g');
      if (re.test(s)) s = s.replace(re, (m, pre) => `${pre}${c.to} ★`);
    }
    return s;
  };
  const strip = (h) => String(h).replace(/<[^>]+>/g, '');
  const groups = info.pinmap || [];
  const W = 760, rowH = 30, pad = 24;
  const lines = groups.reduce((n, g) => n + 2 + g.pins.length, 0);
  const H = pad * 2 + 70 + lines * rowH + (changes.length ? 40 + changes.length * 24 : 0) + 30;
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'); x.scale(2, 2);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#111'; x.font = 'bold 20px system-ui, sans-serif';
  x.fillText(`회로도 — ${b.devName || b.title}`, pad, pad + 20);
  x.font = '13px system-ui, sans-serif'; x.fillStyle = '#555';
  x.fillText(`${b.boardType} · ${b.link} · ${original ? '원본 코드 기준' : '수정한 코드 기준'} · ${setup.name || ''}`, pad, pad + 44);
  let y = pad + 70;
  for (const g of groups) {
    x.fillStyle = '#111'; x.font = 'bold 15px system-ui, sans-serif';
    x.fillText(strip(g.device), pad, y + 20); y += rowH;
    x.fillStyle = '#eef2f5'; x.fillRect(pad, y, W - pad * 2, rowH);
    x.fillStyle = '#333'; x.font = 'bold 13px system-ui, sans-serif';
    x.fillText('보드', pad + 10, y + 20); x.fillText(strip(g.device), pad + (W - pad * 2) / 2 + 10, y + 20); y += rowH;
    x.font = '13px system-ui, sans-serif';
    for (const pin of g.pins) {
      const bd = swap(strip(pin.board));
      x.strokeStyle = '#d5dade'; x.strokeRect(pad, y, W - pad * 2, rowH);
      x.fillStyle = bd.includes('★') ? '#b45309' : '#111';
      x.fillText(bd, pad + 10, y + 20);
      x.fillStyle = '#111'; x.fillText(strip(pin.device), pad + (W - pad * 2) / 2 + 10, y + 20);
      y += rowH;
    }
  }
  if (changes.length) {
    y += 16; x.fillStyle = '#b45309'; x.font = 'bold 14px system-ui, sans-serif';
    x.fillText('★ 코드 설정에서 바꾼 핀', pad, y + 14); y += 24; x.font = '13px system-ui, sans-serif';
    for (const ch of changes) { x.fillText(`${ch.label}: ${ch.from} → ${ch.to}`, pad + 10, y + 14); y += 24; }
  }
  c.toBlob(blob => downloadBlob(blob, `${experimentFilePrefix()}_${safeFileName(b.devName) || `보드${i + 1}`}_회로도${original ? '_원본' : ''}.png`));
}
document.getElementById('lsBody').addEventListener('click', (e) => {
  const w = e.target.closest('[data-wiring-png]');
  if (w) downloadWiringPng(w.dataset.wiringPng);
});

// 코드 창 위쪽: 수정본/원본 고르기 · 복사 · 파일로 받기
document.getElementById('lsCodeVer').addEventListener('click', (e) => {
  const v = e.target.closest('[data-ver]');
  if (!v || !codeViewerUid) return;
  codeChoice[codeViewerUid] = v.dataset.ver;
  renderSetup();
});
document.getElementById('lsCodeCopy').addEventListener('click', async () => {
  const b = setup.boards.find(x => x.uid === codeViewerUid);
  if (!b) return;
  try { await navigator.clipboard.writeText(chosenCode(b)); showLiveToast(`${codeChoice[b.uid] === 'original' ? '원본' : '수정한'} 코드를 복사했어요 — Arduino IDE의 새 스케치에 붙여넣으세요`); }
  catch (err) { showLiveToast('복사하지 못했어요. 옆의 받기 아이콘으로 파일을 받으세요', true); }
});
document.getElementById('lsCodeSave').addEventListener('click', () => { if (codeViewerUid) downloadBoardCode(codeViewerUid); });

function renderDownloadStep(body) {
  const missing = setup.boards.filter(b => !expCache[b.expId]);
  if (missing.length) { Promise.all(missing.map(b => loadExp(b.expId))).then(renderSetup); body.innerHTML = '<div class="empty-hint">불러오는 중…</div>'; return; }
  if (!setup.boards.some(b => b.uid === designBoardUid)) designBoardUid = setup.boards[0] && setup.boards[0].uid;
  const i = setup.boards.findIndex(x => x.uid === designBoardUid);
  const b = setup.boards[i];
  if (!b) { body.innerHTML = '<div class="empty-hint">고른 보드가 없어요. 1단계에서 보드를 추가하세요.</div>'; return; }
  const ex = expCache[b.expId];
  const isEsp = /esp32/i.test(b.boardType);
  const libs = (ex.info.codeInfo || {}).libraries;
  const original = codeChoice[b.uid] === 'original';
  body.innerHTML = `${boardTabsHtml()}
    <div class="ls-section">
      <div class="ls-section-title">${setup.boards.length > 1 ? `${i + 1}. ` : ''}${escHtml(b.devName || b.title)} — 코드 설정 <span class="ls-badge warn">바꾸면 다시 업로드해야 해요</span></div>
      <p class="hint" style="margin:0 0 10px">${original
        ? '지금 <b>원본 코드</b>를 보고 있어요. 설정을 고치려면 왼쪽 코드 창 위에서 <b>수정본</b>을 고르세요.'
        : '여기서 고치면 왼쪽 코드에 바로 들어가요. 다 고쳤으면 코드 창 오른쪽 위 <b>복사</b> 또는 <b>받기</b> 아이콘을 누르세요.'}</p>
      ${codeSettingsFormHtml(b, ex, true, original)}
      <div class="dl-file">받을 파일 이름 · <b>${escHtml(boardCodeFileName(b, i))}</b></div>
      <div class="dl-row"><button class="mini-btn" data-wiring-png="${b.uid}">🔌 회로도 받기 (PNG)</button>
        <span class="hint" style="margin:0">${original ? '원본 핀 그대로' : '바꾼 핀이 있으면 표에 반영돼요'}</span></div>
    </div>
    <details class="ls-section ls-guide-box">
      <summary>업로드 방법</summary>
      <p class="hint" style="margin:6px 0 0"><b>받기</b>는 .ino 파일로 저장해서 Arduino IDE로 여는 방법, <b>복사</b>는 IDE의 새 스케치에 붙여넣는 방법이에요. 내용은 같아요.</p>
      <ol class="ls-guide">
        <li>받은 파일을 Arduino IDE로 열어요. "같은 이름의 폴더를 만들까요?"가 뜨면 <b>확인</b>.</li>
        ${libs ? `<li>라이브러리 설치: ${libs}</li>` : ''}
        <li>도구 → 보드: <b>${isEsp ? 'ESP32 Dev Module' : 'Arduino Uno'}</b>${/블루투스/.test(b.link) && isEsp ? ', 도구 → Partition Scheme: <b>Huge APP</b>' : ''}</li>
        <li>도구 → 포트: 보드가 꽂힌 COM 포트</li>
        <li><b>업로드하는 동안은 이 시뮬레이션 서버(검은 창)·시리얼 모니터를 꺼 두세요.</b> 같은 포트를 두 프로그램이 동시에 못 써요.</li>
        <li>업로드${isEsp ? ' (아래에 "Connecting..."이 나오면 보드의 <b>BOOT 버튼</b>을 누르고 있기)' : ''} → 끝나면 서버를 다시 켜요.</li>
      </ol>
    </details>`;
  // 이 단계에서는 코드 창을 늘 띄워 둔다
  if (!document.body.classList.contains('ls-code-open') || codeViewerUid !== b.uid) openCodeViewer(b.uid);
  else renderCodeViewer(b);
}

// ── 직접 만든 코드 안내 (실험 시작 단계에 접어 둠) ─────────────────────────────────────
function ownCodeGuideHtml(open) {
  return `
    <details class="ls-section ls-guide-box"${open ? ' open' : ''}>
      <summary>직접 만든 코드로 하려면</summary>
      <p class="hint" style="margin:6px 0 8px">센서 개수·조합에 제한이 없어요. 보드가 아래 형식으로 값을 보내기만 하면 화면이 자동으로 알아봐요. 처음이면 처음 화면의 <b>기본 코드·회로도 받기</b>가 쉬워요.</p>
      <div class="modal-example"><div class="modal-label">보드가 보낼 값 (JSON 한 줄씩, 센서 이름은 자유)</div>
        <pre>{"temp": 24.8, "ph": 7.21, "co2": 735}</pre></div>
      <ul class="modal-notes">
        <li>USB·HC-06: <code>Serial.println()</code>으로 한 줄씩 보내면 서버가 자동으로 포트를 찾아요 (통신 속도 9600).</li>
        <li>WiFi(MQTT): <code>miniearth/보드이름/data</code> 토픽으로 발행. 서버 주소는 화면의 ⓘ 연결 정보에 있어요.</li>
        <li>BLE(HM-10·ESP32): 서버를 <code>--ble</code>로 켜고, 값 끝에 줄바꿈(<code>\\n</code>)을 꼭 붙여요.</li>
        <li>값이 안 들어오면 실험 화면의 <b>🖥 시리얼 모니터</b>에서 보드가 무엇을 보내는지 볼 수 있어요.</li>
      </ul>
    </details>`;
}

// ── ⑤ 센서 배치 (연결 확인 + 아크릴 위에 끌어다 놓기) ─────────────────
// 배치는 '부품' 단위 (SCD30 하나 = co2·temp·hum 세 값). 부품을 끌어 놓으면 그 값들이 모두 같은 자리에 놓이고,
// 놓은 구역 + 값마다의 종류(온도·습도·CO₂·pH …)로 아크릴의 어떤 효과로 이어질지 정해진다.
// 저장은 값(키)마다 setup.placements[key] = { zone, type, pos } — 효과 연결(sensorRoles)이 키 단위라서.
const SENSOR_ZONES = [
  { id: 'wetland', label: '습지' },
  { id: 'soil', label: '토양' },
  { id: 'ocean', label: '해양' },
  { id: 'air', label: '대기' },
  { id: 'city', label: '도시' },
];
const ZONE_LABEL = Object.fromEntries(SENSOR_ZONES.map(z => [z.id, z.label]));
const SENSOR_TYPES = [
  { id: 'co2', label: 'CO₂' }, { id: 'temp', label: '온도' }, { id: 'hum', label: '습도' },
  { id: 'ph', label: 'pH' }, { id: 'methane', label: '메탄' }, { id: 'other', label: '기타' },
];
const TYPE_LABEL = Object.fromEntries(SENSOR_TYPES.map(t => [t.id, t.label]));

// 예전 구역 이름(해양 물속 / 해양 공기)으로 저장된 배치를 새 이름으로
for (const p of Object.values(setup.placements)) {
  if (p.zone === 'ocean_water') p.zone = 'ocean';
  if (p.zone === 'ocean_air') p.zone = 'air';
}

function guessSensorType(key) {
  const k = String(key).split('@')[0].toLowerCase();
  if (/co2/.test(k)) return 'co2';
  if (/^ph|_ph|ph\d*$/.test(k)) return 'ph';
  if (/temp|tmp|온도/.test(k)) return 'temp';
  if (/hum|습도/.test(k)) return 'hum';
  if (/ch4|methane|메탄|gas/.test(k)) return 'methane';
  return 'other';
}

// type 'off' = 이 값은 효과에 연결하지 않음 (측정 요소에서 뺀 값)
function roleForPlacement(p) {
  if (!p || !p.zone) return '';
  if (p.type === 'temp') return p.zone === 'ocean' ? 'water_temp' : p.zone === 'soil' ? 'soil_temp' : 'air_temp';
  return { co2: 'co2', ph: 'ph', hum: 'hum', methane: 'methane' }[p.type] || '';
}
function setRoleFor(key) {
  const role = roleForPlacement(setup.placements[key]);
  if (role) sensorRoles[key] = role; else delete sensorRoles[key];
}

function placementChanged() {
  saveSetup();
  updateSensorMarkers();
  applyLiveSensorEffects();
  if (liveView === 'setup' && currentStepId() === 'place') renderSetup();
  renderDevicePanel(true);
}

function clearAllPlacements() {
  Object.keys(sensorRoles).forEach(k => delete sensorRoles[k]);
  setup.placements = {};
  updateSensorMarkers();
}

// 아크릴 상자: 가로 6(x −3~3)을 해양 / 습지 / 도시 세 칸으로 나눔. 토양은 땅속, 대기는 위쪽 공기
const ZONE_CENTER_X = { ocean: -2, wetland: 0, city: 2, soil: 0, air: 0 };
const ZONE_MARK_Y = { ocean: 0.12, soil: 0.3, wetland: 1.0, city: 1.25, air: 1.7 };
function defaultZonePos(zone) {
  const n = new Set(Object.values(setup.placements).filter(p => p.zone === zone).map(p => p.group)).size;
  return { x: ZONE_CENTER_X[zone] + ((n % 3) - 1) * 0.45, z: -0.6 + (n % 4) * 0.4 };
}
// 끌어 놓은 자리(가로 위치)가 어느 칸인지
function surfaceAt(x) { return x < -1 ? 'ocean' : x < 1 ? 'wetland' : 'city'; }

// 고른 표준 코드에서 이 보드가 보낼 센서(부품)와 값 이름을 미리 읽는다 → 보드를 연결하기 전에도 배치할 수 있게
// (표준 코드의 sendInfo()에 적힌 "name":"SCD30","keys":["co2","temp","hum"] 부분)
function codeSensors(code) {
  const out = [];
  for (const m of code.matchAll(/name\\+":\\+"([^"\\]+)\\+",\\+"keys\\+":\[(.*?)\]/g)) {
    out.push({ name: m[1], keys: [...m[2].matchAll(/\\+"(\w+)\\+"/g)].map(x => x[1]) });
  }
  return out;
}

// 배치할 부품 목록: ① 고른 표준 코드 ② 연결된 보드가 알려 준 센서 목록(info) ③ 그 밖에 값만 들어온 키 (하나씩)
// 보드 여러 대가 같은 이름을 보내면 화면은 먼저 온 보드 값을 '이름', 나머지를 '이름@보드'로 구분한다 (tab-live.js)
function sensorGroups() {
  const groups = [], used = new Set(), seenRaw = new Set();
  setup.boards.forEach(b => {
    const ex = expCache[b.expId];
    if (!ex) return;
    const dev = b.devName || b.title;
    for (const s of codeSensors(ex.code)) {
      const keys = s.keys.map(raw => {
        const key = seenRaw.has(raw) && b.devName ? `${raw}@${b.devName}` : raw;
        seenRaw.add(raw);
        return key;
      });
      groups.push({ gid: `${dev}/${s.name}`, name: s.name, dev, keys });
      keys.forEach(k => used.add(k));
    }
  });
  for (const d of liveDevices) {
    for (const s of ((d.info || {}).sensors || [])) {
      const keys = (s.keys || []).map(raw => Object.keys(keyInfo).find(k => keyInfo[k].raw === raw && keyInfo[k].dev === d.id) || raw)
        .filter(k => !used.has(k));
      if (!keys.length) continue;
      groups.push({ gid: `${d.name}/${s.name || s.id}`, name: s.name || s.id, dev: d.name, keys });
      keys.forEach(k => used.add(k));
    }
  }
  const rest = [...liveKnownKeys].sort().concat(Object.keys(setup.placements));
  for (const k of rest) {
    if (used.has(k)) continue;
    used.add(k);
    groups.push({ gid: k, name: k, dev: sensorDeviceName(k), keys: [k] });
  }
  return groups;
}
function groupById(gid) { return sensorGroups().find(g => g.gid === gid); }
function groupZone(g) { const p = g.keys.map(k => setup.placements[k]).find(Boolean); return p ? p.zone : ''; }

function placeGroup(g, zone, pos) {
  const cur = g.keys.map(k => setup.placements[k]).find(Boolean);
  // 구역만 바꿨는데 원래 자리가 그 구역과 안 맞으면(예: 습지 자리 → 해양) 그 구역의 기본 자리로
  if (!pos) pos = cur && (zone === 'soil' || zone === 'air' || surfaceAt(cur.pos.x) === zone) ? cur.pos : defaultZonePos(zone);
  for (const k of g.keys) setup.placements[k] = { zone, type: 'off', pos, group: g.gid };
  applyMeasures(g);
  placementChanged();
}

// 센서마다 '무엇을 재는지'(측정 요소: CO₂·온도·습도·pH·메탄·기타) — 처음엔 값 이름으로 짐작해서 채운다
function groupMeasures(g) {
  setup.measures = setup.measures || {};
  if (!setup.measures[g.gid]) {
    setup.measures[g.gid] = { types: [...new Set(g.keys.map(guessSensorType).filter(t => t !== 'other'))], custom: '' };
  }
  return setup.measures[g.gid];
}
// 고른 측정 요소를 값(키)에 나눠 준다: 이름으로 종류를 알 수 있는 값은 그 종류가 골라져 있으면 켜고,
// 이름으로 모르는 값(자유 실험의 x1 등)은 아직 안 쓰인 측정 요소를 차례로 받는다
function applyMeasures(g) {
  const m = groupMeasures(g);
  const typeOf = {};
  for (const k of g.keys) { const t = guessSensorType(k); if (t !== 'other' && m.types.includes(t)) typeOf[k] = t; }
  const unused = m.types.filter(t => !Object.values(typeOf).includes(t));
  for (const k of g.keys) {
    if (!(k in typeOf)) typeOf[k] = guessSensorType(k) === 'other' ? (unused.shift() || 'off') : 'off';
    if (setup.placements[k]) { setup.placements[k].type = typeOf[k]; setRoleFor(k); }
  }
}
function toggleMeasure(g, type) {
  const m = groupMeasures(g);
  m.types = m.types.includes(type) ? m.types.filter(x => x !== type) : SENSOR_TYPES.map(s => s.id).filter(id => id === type || m.types.includes(id));
  applyMeasures(g);
  placementChanged();
}
function measureLabel(m, type) { return type === 'other' ? (m.custom || '기타') : TYPE_LABEL[type]; }
function unplaceGroup(g) {
  for (const k of g.keys) { delete setup.placements[k]; delete sensorRoles[k]; }
  if (setup.measures) delete setup.measures[g.gid];
  if (placeEditGid === g.gid) placeEditGid = null;
  placementChanged();
}

function sensorDeviceName(k) {
  const ki = keyInfo[k];
  if (ki) { const d = liveDevices.find(x => x.id === ki.dev); return d ? d.name : ki.dev; }
  return '';
}

function unitFor(k, type) {
  return { co2: 'ppm', temp: '°C', hum: '%', methane: 'ppm', ph: '' }[type || guessSensorType(k)] || '';
}

function liveValueText(k) {
  const d = liveLatest[k];
  if (!d || typeof d.value !== 'number') return '연결 전';
  const p = setup.placements[k];
  return `${fmtNum(d.value)}${unitFor(k, p && p.type) ? ' ' + unitFor(k, p && p.type) : ''}`;
}

function boardConnStatus() {
  const now = Date.now();
  return setup.boards.map(b => {
    const d = b.devName ? liveDevices.find(x => x.name === b.devName) : null;
    const keys = d ? keysOfDevice(d.id) : [];
    const recent = keys.some(k => liveLatest[k] && now - new Date(liveLatest[k].timestamp).getTime() < 30000);
    return { b, recent, keys };
  });
}

// 값 하나의 이름표: 종류(온도 등)로 부르고, 종류를 모르는 값은 키 이름 그대로
// 한 부품에 같은 종류가 여럿이면(DS18B20 탐침 2개 = 온도 둘) '온도1 · 온도2'처럼 번호를 붙인다
function keyLabel(k, groupKeys) {
  const typeOf = (x) => { const p = setup.placements[x]; return p ? p.type : guessSensorType(x); };
  const t = typeOf(k);
  if (!t || t === 'other' || t === 'off') return k;
  const same = (groupKeys || []).filter(x => typeOf(x) === t);
  return same.length > 1 ? `${TYPE_LABEL[t]}${same.indexOf(k) + 1}` : TYPE_LABEL[t];
}

let placeEditGid = null; // 이름을 눌러 펼친(수정 중인) 부품

function placedRowHtml(g) {
  const zone = groupZone(g);
  const m = groupMeasures(g);
  const editing = placeEditGid === g.gid;
  return `<div class="pl-row${editing ? ' editing' : ''}">
    <div class="pl-line">
      <button class="pl-name" data-edit-group="${escHtml(g.gid)}" title="눌러서 측정 요소 고르기">${escHtml(g.name)}</button>
      <span class="pl-arrow">→</span><span class="pl-zone">${ZONE_LABEL[zone] || zone}</span>
      ${editing ? `<button class="mini-btn primary pl-done" data-edit-group="${escHtml(g.gid)}">완료</button>`
        : `<span class="pl-vals">${m.types.length ? m.types.map(tp => `<span class="pl-val">${escHtml(measureLabel(m, tp))}<button class="pl-x" data-off-type="${tp}" data-gid="${escHtml(g.gid)}" title="빼기">×</button></span>`).join('')
          : '<span class="pl-none">측정 요소를 고르세요 — 이름을 누르면 돼요</span>'}</span>
        <button class="icon-btn remove-btn pl-remove" data-unplace-group="${escHtml(g.gid)}" title="배치 빼기">✕</button>`}
    </div>
    ${editing ? `<div class="pl-pills">${SENSOR_TYPES.map(st => `<button class="pl-pill${m.types.includes(st.id) ? ' on' : ''}" data-toggle-type="${st.id}" data-gid="${escHtml(g.gid)}">${st.label}</button>`).join('')}</div>
      ${m.types.includes('other') ? `<input class="modal-input pl-custom" data-custom-for="${escHtml(g.gid)}" value="${escHtml(m.custom || '')}" placeholder="기타 — 직접 입력 (예: 조도)" maxlength="20">` : ''}` : ''}
  </div>`;
}

// 보드 한 대의 센서가 모두 한 구역에 있을 때: 보드를 끌어 놓으면 그 보드 센서가 전부 그 구역에 놓인다
function boardsOf(groups) {
  const out = {};
  groups.forEach(g => { if (g.dev && g.dev !== g.name) (out[g.dev] = out[g.dev] || []).push(g); });
  return out;
}
function boardChipsHtml(groups) {
  const boards = Object.entries(boardsOf(groups)).filter(([, gs]) => gs.length > 1 && gs.some(g => !groupZone(g)));
  if (!boards.length) return '';
  return `<div class="ls-board-place"><span class="hint" style="margin:0">보드째로 놓기 — 그 보드 센서가 전부 한 구역에</span>
    <div class="ls-sensor-chips">${boards.map(([dev, gs]) => `<div class="ls-sensor ls-board" draggable="true" data-board="${escHtml(dev)}">📟 <b>${escHtml(dev)}</b> <span class="ls-sensor-keys">${gs.map(g => escHtml(g.name)).join('·')}</span></div>`).join('')}</div>
    <span class="hint" style="margin:0">센서 하나만 다른 곳에 있으면 그 센서만 따로 끌어 놓으세요</span></div>`;
}

function renderPlaceStep(body) {
  const missing = setup.boards.filter(b => !expCache[b.expId]);
  if (missing.length) { Promise.all(missing.map(b => loadExp(b.expId))).then(renderSetup); body.innerHTML = '<div class="empty-hint">불러오는 중…</div>'; return; }
  const groups = sensorGroups();
  const status = boardConnStatus();
  const devRows = status.map(({ b, recent, keys: dk }, i) => `<div class="ls-conn ${recent ? 'ok' : 'wait'}">${recent ? '✅' : '⏳'} ${i + 1}. ${escHtml(b.devName || b.title)}
      <span>${recent ? `값이 들어오는 중 (${escHtml(dk.join(', '))})` : '값을 기다리는 중 — 업로드했는지, 서버가 켜져 있는지 확인하세요. 연결 전에도 센서를 미리 배치할 수 있어요'}</span></div>`).join('');
  const others = liveDevices.filter(d => !setup.boards.some(b => b.devName && b.devName === d.name));
  const otherRows = others.map(d => `<div class="ls-conn ${d.online ? 'ok' : 'wait'}">${d.online ? '✅' : '⏳'} ${escHtml(d.name)}
    <span>${escHtml(keysOfDevice(d.id).join(', ') || '값 없음')}</span></div>`).join('');
  const unplaced = groups.filter(g => !groupZone(g));
  const placed = groups.filter(g => groupZone(g));
  body.innerHTML = `
    <div class="ls-section">
      <div class="ls-section-title">연결 확인</div>
      ${devRows || otherRows ? devRows + otherRows : '<div class="empty-hint">아직 연결된 보드가 없어요. 보드를 꽂거나(USB) WiFi·블루투스 연결을 확인하세요.</div>'}
      ${liveConnected ? '' : '<div class="conn-status-hint error">🔴 서버에 연결되지 않았어요 — server.py(run_server.bat)를 켜 주세요</div>'}
    </div>
    <div class="ls-section">
      <div class="ls-section-title">센서 배치 <span class="hint" style="margin:0">— 센서를 끌어서 아크릴 모형의 <b>실제로 놓은 자리</b>에 놓으세요</span></div>
      ${boardChipsHtml(groups)}
      <div class="ls-sensor-chips">${unplaced.length ? unplaced.map(g => `
        <div class="ls-sensor${g.keys.some(k => liveLatest[k]) ? '' : ' planned'}" draggable="true" data-group="${escHtml(g.gid)}" title="${escHtml(g.dev || '')}">
          <b>${escHtml(g.name)}</b>${g.keys.length > 1 || g.keys[0] !== g.name ? ` <span class="ls-sensor-keys">${g.keys.map(k => escHtml(keyLabel(k, g.keys))).join('·')}</span>` : ` <span data-live-val="${escHtml(g.keys[0])}">${escHtml(liveValueText(g.keys[0]))}</span>`}</div>`).join('')
        : `<div class="empty-hint">${groups.length ? '모든 센서를 배치했어요.' : '보드 값이 들어오면 여기에 센서가 나타나요.'}</div>`}</div>
      ${placed.length ? `<div class="pl-list">${placed.map(placedRowHtml).join('')}</div>
        <p class="hint" style="margin:6px 0 0">센서 이름을 누르면 무엇을 재는지 고를 수 있어요. 자리를 바꾸려면 ✕로 빼고 다시 끌어 놓으세요.</p>` : ''}
      <p class="hint" style="margin:6px 0 0">배치하지 않은 센서도 기록·그래프에는 그대로 나와요. 아크릴 효과에만 연결되지 않아요.</p>
    </div>
    ${simSettingsHtml()}
    ${ownCodeGuideHtml(!groups.length && !setup.boards.length)}`;
  placeSig = placeSignature();
}

// 배치 화면은 '무엇이 있는지'가 바뀔 때만 다시 그린다. 매번 통째로 다시 그리면 센서를 누르는 순간
// 칩이 새것으로 바뀌어 끌기가 시작되지 않는다 (이전 버전의 문제). 값은 그 자리의 글자만 바꾼다.
let placeSig = '';
function placeSignature() {
  return JSON.stringify([liveConnected, liveDevices.map(d => [d.id, d.name, d.online, (d.info || {}).sensors]), [...liveKnownKeys].sort(),
    Object.keys(setup.placements).sort(), boardConnStatus().map(s => s.recent)]);
}

function effectLabel(p) {
  return { co2: '하늘·안개', water_temp: '수온 (빙하)', air_temp: '기온 (빙하)', soil_temp: '토양 온도', ph: '바닷물 색', hum: '물방울', methane: '기포' }[roleForPlacement(p)] || '';
}

document.getElementById('lsBody').addEventListener('click', (e) => {
  const t = e.target.closest('[data-edit-group], [data-toggle-type], [data-off-type], [data-unplace-group]');
  if (!t) return;
  if (t.dataset.editGroup != null) { placeEditGid = placeEditGid === t.dataset.editGroup ? null : t.dataset.editGroup; renderSetup(); return; }
  const g = groupById(t.dataset.gid || t.dataset.unplaceGroup);
  if (!g) return;
  if (t.dataset.toggleType != null) toggleMeasure(g, t.dataset.toggleType);
  else if (t.dataset.offType != null) toggleMeasure(g, t.dataset.offType);
  else unplaceGroup(g);
});
// 기타 — 직접 입력 (다시 그리지 않고 저장만, 이름표는 바로 반영)
document.getElementById('lsBody').addEventListener('input', (e) => {
  const gid = e.target.dataset.customFor;
  if (gid == null) return;
  const g = groupById(gid);
  if (!g) return;
  groupMeasures(g).custom = e.target.value.trim();
  saveSetup();
  updateSensorMarkers();
});

// 부품 칩을 끌어서 3D 캔버스 위에 놓으면, 화면 좌표 → 상자 바닥 높이의 평면과 만나는 점으로 자리를 정한다
let draggingGroupId = null, draggingBoard = null;
document.getElementById('lsBody').addEventListener('dragstart', (e) => {
  const chip = e.target.closest('[data-group], [data-board]');
  if (!chip) return;
  draggingGroupId = chip.dataset.group || null;
  draggingBoard = chip.dataset.board || null;
  e.dataTransfer.setData('text/plain', draggingGroupId || draggingBoard);
  e.dataTransfer.effectAllowed = 'move';
  document.body.classList.add('ls-dragging');
});
document.getElementById('lsBody').addEventListener('dragend', () => document.body.classList.remove('ls-dragging'));

const dropRaycaster = new THREE.Raycaster();
const dropPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.46); // y = 지형 높이(TERRAIN_TOP)
function screenToBox(clientX, clientY) {
  const r = glCanvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  dropRaycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (!dropRaycaster.ray.intersectPlane(dropPlane, p)) return null;
  if (Math.abs(p.x) > 3.1 || Math.abs(p.z) > 1.6) return null; // 상자 밖
  return { x: Math.max(-2.85, Math.min(2.85, p.x)), z: Math.max(-1.35, Math.min(1.35, p.z)) };
}

glCanvas.addEventListener('dragover', (e) => { if (draggingGroupId || draggingBoard) e.preventDefault(); });
glCanvas.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('ls-dragging');
  const board = draggingBoard;
  const gid = draggingGroupId || (!board && e.dataTransfer.getData('text/plain'));
  draggingGroupId = draggingBoard = null;
  const pos = screenToBox(e.clientX, e.clientY);
  if (board) {
    const gs = boardsOf(sensorGroups())[board] || [];
    if (!gs.length) return;
    if (!pos) { showLiveToast('아크릴 상자 안에 놓아 주세요', true); return; }
    // 이름표가 겹치지 않게 센서마다 조금씩 비켜 놓는다
    askZone(board, pos, e.clientX, e.clientY, (zone) => gs.forEach((g, i) =>
      placeGroup(g, zone, { x: Math.max(-2.85, Math.min(2.85, pos.x + [0, -0.9, 0.9][i % 3])), z: Math.max(-1.35, Math.min(1.35, pos.z + (i % 2 ? -0.5 : 0.5) * (i ? 1 : 0) + Math.floor(i / 3) * 0.6)) })));
    return;
  }
  const g = gid && groupById(gid);
  if (!g) return;
  if (!pos) { showLiveToast('아크릴 상자 안에 놓아 주세요', true); return; }
  askZone(g.name, pos, e.clientX, e.clientY, (zone) => placeGroup(g, zone, pos));
});

// 위에서 내려다본 자리만으로는 땅속(토양)·공기 중(대기)인지 알 수 없어서 한 번 묻는다
function askZone(title, pos, cx, cy, onPick) {
  const surface = surfaceAt(pos.x);
  const options = surface === 'ocean'
    ? [['ocean', '해양 (물속)'], ['air', '대기 (수면 위 공기)']]
    : [[surface, ZONE_LABEL[surface]], ['soil', '토양 (땅속)'], ['air', '대기 (공기 중)']];
  const pop = document.getElementById('lsZonePop');
  pop.innerHTML = `<div class="ls-pop-title">${escHtml(title)}을(를) 어디에 놓았나요?</div>
    ${options.map(([id, label], i) => `<button class="mini-btn${i === 0 ? ' primary' : ''}" data-zone="${id}">${label}</button>`).join('')}
    <button class="mini-btn" data-zone="">취소</button>`;
  pop.style.left = `${Math.min(window.innerWidth - 300, cx + 8)}px`;
  pop.style.top = `${Math.min(window.innerHeight - 110, cy + 8)}px`;
  pop.classList.add('visible');
  pop.onclick = (ev) => {
    const btn = ev.target.closest('[data-zone]');
    if (!btn) return;
    pop.classList.remove('visible');
    if (btn.dataset.zone) onPick(btn.dataset.zone);
  };
}

// ── 아크릴 위 센서 표시 (부품마다 이름표 하나: 이름·현재 값들 / 구역·보드) ─────────────────
const sensorMarkers = {}; // { gid: THREE.Sprite }
function markerLines(g) {
  const keys = g.keys.filter(k => setup.placements[k] && setup.placements[k].type !== 'off');
  const m = groupMeasures(g);
  const vals = keys.map(k => setup.placements[k].type === 'other' && m.custom && liveValueText(k) !== '연결 전' ? `${m.custom} ${liveValueText(k)}` : liveValueText(k)).filter(v => v !== '연결 전');
  const zone = groupZone(g);
  return [`${g.name}   ${vals.length ? vals.join(' · ') : '연결 전'}`, `${ZONE_LABEL[zone] || zone}${g.dev && g.dev !== g.name ? ' · ' + g.dev : ''}`];
}

function makeMarkerSprite(lines, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const f1 = 'bold 34px system-ui, sans-serif', f2 = '26px system-ui, sans-serif';
  ctx.font = f1; const w1 = ctx.measureText(lines[0]).width;
  ctx.font = f2; const w2 = ctx.measureText(lines[1]).width;
  const w = Math.ceil(Math.max(w1, w2)) + 64, h = 92;
  c.width = w; c.height = h;
  ctx.fillStyle = 'rgba(20,23,28,0.85)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(28, 30, 12, 0, Math.PI * 2); ctx.fill();
  ctx.font = f1; ctx.fillStyle = '#f2f4f6'; ctx.fillText(lines[0], 50, 42);
  ctx.font = f2; ctx.fillStyle = '#9fd9c4'; ctx.fillText(lines[1], 50, 78);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.176 * w / 56, 0.176 * h / 56, 1);
  s.renderOrder = 999; // 아크릴 판에 가려지지 않게
  s.userData.text = lines.join('\n');
  return s;
}

function updateSensorMarkers() {
  if (sceneLive.dormant) return; // 직접 실험 화면을 아직 안 열었으면 아크릴이 없음 (열 때 다시 부름)
  const placed = Object.keys(setup.placements).length ? sensorGroups().filter(g => groupZone(g)) : [];
  const want = Object.fromEntries(placed.map(g => [g.gid, g]));
  for (const [gid, s] of Object.entries(sensorMarkers)) {
    const g = want[gid];
    if (!g || s.userData.text !== markerLines(g).join('\n')) { sceneLive.scene.remove(s); s.material.map.dispose(); s.material.dispose(); delete sensorMarkers[gid]; }
  }
  for (const g of placed) {
    let s = sensorMarkers[g.gid];
    if (!s) {
      s = makeMarkerSprite(markerLines(g), liveColorFor(g.keys[0]));
      sensorMarkers[g.gid] = s;
      sceneLive.scene.add(s);
    }
    const p = g.keys.map(k => setup.placements[k]).find(Boolean);
    s.position.set(p.pos.x, ZONE_MARK_Y[p.zone] ?? 1, p.pos.z);
  }
}

// ── 실험 화면: 아크릴 위 이름표를 누르면 그 센서·보드를 제어하는 작은 창 ─────────────
// (끌어서 아크릴을 돌린 건 무시 — 누른 자리에서 거의 안 움직였을 때만)
const markerRaycaster = new THREE.Raycaster();
function markerAt(clientX, clientY) {
  const sprites = Object.values(sensorMarkers);
  if (!sprites.length) return null;
  const r = glCanvas.getBoundingClientRect();
  markerRaycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = markerRaycaster.intersectObjects(sprites, false)[0];
  return hit ? Object.keys(sensorMarkers).find(gid => sensorMarkers[gid] === hit.object) : null;
}
let popDown = null, sensorPopGid = null;
glCanvas.addEventListener('pointerdown', (e) => { popDown = { x: e.clientX, y: e.clientY }; });
glCanvas.addEventListener('pointerup', (e) => {
  if (liveView !== 'experiment' || !popDown || Math.hypot(e.clientX - popDown.x, e.clientY - popDown.y) > 5) return;
  const gid = markerAt(e.clientX, e.clientY);
  if (gid) openSensorPop(gid, e.clientX, e.clientY); else closeSensorPop();
});
glCanvas.addEventListener('pointermove', (e) => {
  if (liveView !== 'experiment' || e.buttons) return;
  glCanvas.style.cursor = markerAt(e.clientX, e.clientY) ? 'pointer' : '';
});

function sensorPopHtml(g) {
  const ki = keyInfo[g.keys.find(k => keyInfo[k])];
  const d = (ki && liveDevices.find(x => x.id === ki.dev)) || liveDevices.find(x => x.name === g.dev);
  const info = d && d.info;
  const raws = g.keys.map(k => (keyInfo[k] || {}).raw || k.split('@')[0]);
  const s = info && (info.sensors || []).find(x => (x.keys || [x.id]).some(r => raws.includes(r)));
  const zone = groupZone(g);
  const vals = g.keys.map(k => `<div class="lp-val"><span>${escHtml(keyLabel(k, g.keys))}</span><b data-live-val="${escHtml(k)}">${escHtml(liveValueText(k))}</b></div>`).join('');
  let sensorRow, boardRow;
  if (!d) {
    sensorRow = '<div class="hint" style="margin:0">보드가 아직 연결되지 않았어요</div>';
    boardRow = '';
  } else if (!info) {
    sensorRow = '<div class="hint" style="margin:0">이 보드 코드는 원격 제어를 지원하지 않아요 (표준 코드로 올리면 돼요)</div>';
    boardRow = `<div class="lp-row"><span class="lp-label">📟 ${escHtml(d.name)}</span><span class="tag ${d.online ? 'ok' : ''}">${d.online ? '연결됨' : '끊김'}</span></div>`;
  } else {
    sensorRow = s ? `<div class="lp-row"><span class="lp-label">센서</span>
        <button class="toggle-btn${s.on ? ' on' : ''}" data-act="sensor" data-dev="${escHtml(d.id)}" data-sensor="${escHtml(s.id)}" data-on="${s.on ? 0 : 1}">${s.on ? '켜짐' : '꺼짐'}</button>
        <span class="tag${s.pwr ? ' ok' : ''}">${s.pwr ? '전원 차단' : '측정만 멈춤'}</span></div>` : '';
    boardRow = `<div class="lp-row"><span class="lp-label">📟 ${escHtml(d.name)}</span>
        <button class="mini-btn" data-act="run" data-dev="${escHtml(d.id)}" data-on="${info.run ? 0 : 1}">${info.run ? '⏸ 측정 멈춤' : '▶ 측정 재개'}</button>
        <button class="mini-btn" data-act="reboot" data-dev="${escHtml(d.id)}">↻ 재부팅</button></div>`;
  }
  return `<div class="lp-head"><b>${escHtml(g.name)}</b><span class="lp-zone">${ZONE_LABEL[zone] || zone}</span><button class="icon-btn" data-pop-close title="닫기">✕</button></div>
    <div class="lp-vals">${vals}</div>${sensorRow}${boardRow}
    <button class="mini-btn lp-graph" data-pop-graph>📈 그래프 보기</button>`;
}
function openSensorPop(gid, cx, cy) {
  const g = groupById(gid);
  if (!g) return;
  sensorPopGid = gid;
  const pop = document.getElementById('lrPop');
  pop.innerHTML = sensorPopHtml(g);
  pop.classList.add('visible');
  pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 12, cx + 12)}px`;
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 12, cy + 12)}px`;
}
function closeSensorPop() { sensorPopGid = null; document.getElementById('lrPop').classList.remove('visible'); }
function refreshSensorPop() {
  if (!sensorPopGid) return;
  const g = groupById(sensorPopGid);
  if (!g || liveView !== 'experiment') { closeSensorPop(); return; }
  document.getElementById('lrPop').innerHTML = sensorPopHtml(g);
}
document.getElementById('lrPop').addEventListener('click', (e) => {
  if (e.target.closest('[data-pop-close]')) { closeSensorPop(); return; }
  if (e.target.closest('[data-pop-graph]')) {
    const g = groupById(sensorPopGid);
    if (g) g.keys.filter(k => liveKnownKeys.has(k) && (setup.placements[k] || {}).type !== 'off').forEach(addGraphForKey);
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (btn) runDevAct(btn);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSensorPop(); });
setInterval(() => {
  if (!sensorPopGid) return;
  document.querySelectorAll('#lrPop [data-live-val]').forEach(el => { const v = liveValueText(el.dataset.liveVal); if (el.textContent !== v) el.textContent = v; });
}, 1000);

// 저장해 둔 배치를 다시 적용 (새로고침해도 유지)
for (const k of Object.keys(setup.placements)) setRoleFor(k);
updateSensorMarkers();

// 1초마다: 이름표의 값을 새로 쓰고, 배치 화면은 바뀐 게 있을 때만 다시 그림 (끌고 있거나 입력 중이면 건드리지 않음)
setInterval(() => {
  if (Object.keys(setup.placements).length) updateSensorMarkers();
  if (liveView !== 'setup' || currentStepId() !== 'place') return;
  document.querySelectorAll('#lsBody [data-live-val]').forEach(el => {
    const t = liveValueText(el.dataset.liveVal);
    if (el.textContent !== t) el.textContent = t;
  });
  if (document.body.classList.contains('ls-dragging')) return;
  const focused = document.activeElement && document.getElementById('lsBody').contains(document.activeElement);
  if (!focused && placeSignature() !== placeSig) renderPlaceStep(document.getElementById('lsBody'));
}, 1000);

// ── 실험 시작 ─────────────────────────────────────────
function simConfigFromSetup() {
  const s = setup.sim;
  const config = { name: setup.name || '' };
  if (s.triggerOn && s.trigKey) {
    const ki = keyInfo[s.trigKey] || { raw: s.trigKey, dev: null };
    config.trigger = { key: ki.raw, dev: ki.dev, op: s.trigOp, value: Number(s.trigValue) };
  }
  if (s.stopOn) config.durationSec = (Math.max(0, s.stopH) * 60 + Math.max(0, Math.min(59, s.stopM))) * 60;
  return config;
}

function simSummary() {
  const s = setup.sim;
  const parts = [];
  if (s.triggerOn && s.trigKey) parts.push(`자동 시작: ${s.trigKey} ${s.trigOp === '<=' ? '≤' : '≥'} ${s.trigValue}`);
  if (s.stopOn) parts.push(`자동 종료: ${s.stopH}시간 ${s.stopM}분 뒤`);
  return parts.join(' · ');
}

async function startFromSetup() {
  if (!liveConnected) { showLiveToast('서버에 연결되지 않아 실험을 시작할 수 없어요', true); return; }
  const s = setup.sim;
  if (s.triggerOn && (!s.trigKey || !Number.isFinite(Number(s.trigValue)))) { showLiveToast('자동 시작 조건의 센서와 값을 정해 주세요', true); return; }
  if (s.stopOn && s.stopH * 60 + s.stopM <= 0) { showLiveToast('자동 종료 시간은 1분 이상으로 넣어 주세요', true); return; }
  const unplaced = [...liveKnownKeys].filter(k => !setup.placements[k]);
  if (unplaced.length && !await liveConfirm(`배치하지 않은 센서가 ${unplaced.length}개 있어요 (${unplaced.join(', ')}). 기록·그래프에는 나오지만 아크릴 효과에는 연결되지 않아요. 이대로 시작할까요?`)) return;
  if (s.triggerOn && !liveKnownKeys.has(s.trigKey) && !await liveConfirm(`자동 시작 조건의 센서 '${s.trigKey}'의 값이 아직 한 번도 안 들어왔어요. 이름이 맞는지 확인하세요. 이대로 시작할까요?`)) return;
  if (!setup.name) { setup.name = autoExperimentName(); saveSetup(); }
  liveSend({ _type: 'session', action: 'start', config: simConfigFromSetup() });
  showLiveExperiment();
}
document.getElementById('lsStartBtn').addEventListener('click', startFromSetup);

// 실험 화면 위쪽의 '실험 준비' 버튼
document.getElementById('backToSetupBtn').addEventListener('click', () => {
  if (liveSession.state === 'armed' || liveSession.state === 'recording') { showLiveToast('실험 중에는 준비 화면으로 갈 수 없어요. 먼저 실험을 끝내세요', true); return; }
  showLiveSetup();
});
