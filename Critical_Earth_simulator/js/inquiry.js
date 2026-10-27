// ============================================================================
// 탐구 모드 — 단계 실행기 (2차 개편 E)
// ----------------------------------------------------------------------------
// 학습지 [탐구] 탭 맨 위의 [탐구 | 자유 조작] 전환(3차 E1부터 현재 실태·미래 예측 공통). 탐구를 켜면 경로 선택 → 단계 안내로 바뀌고,
// 끄면 자유 조작으로 돌아오며 화면 상태(시나리오·레버·재생 위치·토글·작업대)를 켜기 전으로 되돌린다.
// 경로마다 tab(current | future)이 있다: 학습지는 지금 탭의 경로만 보이고, 진행 중에 다른 탭으로 가면 '○○ 탭에서 이어집니다'.
// 경로·단계 내용은 js/inquiry-steps.js(데이터)에만 있다. 여기는 그 데이터를 화면에 적용하는 일만 한다.
//
// 미래 예측 탭의 함수(setPreset·setYear·setPlaying·setNatureView·setPopover·addRecord …)와 값(FUT·VIEW·charts)은
// 클래식 스크립트 전역이라 그대로 부른다. 그래서 이 파일은 tab-future.js 뒤에 읽혀야 한다
// (index.html 순서 = tools/build_single_html.py AERIAL_JS 순서).
//
// 앞부분(InquiryCore)은 DOM 없이 도는 순수 함수다 - node 검사(tools/test_inquiry.js)가 같은 코드를 쓴다.
// ============================================================================

const InquiryCore = (() => {
  // 단계 데이터의 그래프 이름 → 미래 예측 탭 캔버스 id
  const CHART_IDS = { co2: 'futChartCo2', T: 'futChartT', pH: 'futChartPh', sst: 'futChartSst' };
  const PRESETS = ['ssp245', 'ssp126', 'ssp119'];
  const TABS = ['current', 'future'];   // 경로가 진행되는 화면 (3차 E1)

  // 동작 이름 → 꼭 있어야 하는 필드. 새 동작을 만들면 여기와 inquiry-steps.js 머리말에 함께 적는다.
  const ACTION_SPEC = {
    showCharts: ['charts'],
    timeRange: ['from', 'to'],
    overlay: ['chart', 'series'],
    pickPoint: ['chart', 'saveAs'],
    revealMarkers: ['markers'],
    setScenario: [],
    play: ['from', 'to'],
    toggleNature: [],
    focus3D: ['target'],
    openPopover: ['id'],
    omega: [],
    modelPast: [],
    askText: ['saveAs'],
    askChoice: ['saveAs', 'options'],
    impactCards: [],
    record: [],
    // 3차 E2: 화면에서 학습지로 옮긴 기능
    view3d: ['mode'],          // 3D 보기: co2 · indicator · visible(둘 다 끔)
    card: ['id'],              // 학습지 카드: legend3d · spec · omega · sink · impacts
    ws: ['load'],              // 그래프 작업대(현재 실태) 구성
    askEvidence: ['saveAs'],   // 나의 증거 하나를 붙이고 주장 한 줄
  };
  const VIEW3D_MODES = ['co2', 'indicator', 'visible'];
  // 미래 예측 그래프·시간 막대·시나리오에 묶인 동작 — 현재 실태 경로에서는 쓸 수 없다 (3차 E3)
  const FUTURE_ONLY = ['showCharts', 'timeRange', 'overlay', 'setScenario', 'play', 'toggleNature', 'omega', 'modelPast', 'record', 'impactCards'];
  const CARDS = ['legend3d', 'spec', 'omega', 'sink', 'impacts'];

  // next를 따라 단계 순서를 만든다. next가 없으면 배열의 바로 아래 단계.
  // 고리(같은 단계를 두 번 지남)나 없는 id는 거기서 멈춘다 - validate가 따로 알린다.
  function stepOrder(path) {
    const byId = new Map(path.steps.map(s => [s.id, s]));
    const out = [], seen = new Set();
    let cur = path.steps[0];
    while (cur && !seen.has(cur.id)) {
      out.push(cur);
      seen.add(cur.id);
      cur = cur.next ? byId.get(cur.next) : path.steps[path.steps.indexOf(cur) + 1];
    }
    return out;
  }

  // 단계 데이터 검사. ctx = { markers, impacts, sources, catalog(DATA_CATALOG id 목록) } (없으면 그 검사는 건너뜀)
  function validate(paths, ctx = {}) {
    const errs = [], saveAs = new Map();
    const pathIds = new Set();
    for (const p of paths) {
      const where = `경로 ${p.id}`;
      if (!p.id || !p.title) errs.push(`${where}: id·title 필요`);
      if (!TABS.includes(p.tab)) errs.push(`${where}: tab 은 ${TABS.join('|')} 중 하나 (3차 E1)`);
      if (pathIds.has(p.id)) errs.push(`${where}: 경로 id 중복`);
      pathIds.add(p.id);
      if (!Array.isArray(p.steps) || !p.steps.length) { errs.push(`${where}: 단계가 없음`); continue; }
      const ids = new Set();
      for (const s of p.steps) {
        const w = `${where} 단계 ${s.id}`;
        if (!s.id || !s.title || !s.question) errs.push(`${w}: id·title·question 필요`);
        if (ids.has(s.id)) errs.push(`${w}: 단계 id 중복`);
        ids.add(s.id);
        for (const a of s.actions || []) {
          const need = ACTION_SPEC[a.do];
          if (!need) { errs.push(`${w}: 모르는 동작 "${a.do}"`); continue; }
          for (const f of need) if (a[f] == null) errs.push(`${w}: ${a.do}에 ${f} 없음`);
          for (const c of [].concat(a.charts || [], a.chart || [])) if (!CHART_IDS[c] && c !== 'ws') errs.push(`${w}: 모르는 그래프 "${c}"`);
          // 탭에 맞지 않는 동작 (3차 E3): 현재 실태 경로는 미래 예측 그래프·재생·시나리오를 못 쓰고, 미래 예측 경로는 작업대를 못 쓴다
          if (p.tab === 'current' && FUTURE_ONLY.includes(a.do)) errs.push(`${w}: ${a.do} 는 미래 예측 경로에서만 (이 경로는 current)`);
          if (p.tab === 'current' && a.do === 'card' && ['sink', 'impacts'].includes(a.id)) errs.push(`${w}: card ${a.id} 는 미래 예측 전용`);
          if (p.tab === 'current' && a.do === 'pickPoint' && a.chart !== 'ws') errs.push(`${w}: 현재 실태 경로의 pickPoint 는 chart: 'ws'`);
          if (p.tab === 'future' && (a.do === 'ws' || (a.do === 'pickPoint' && a.chart === 'ws'))) errs.push(`${w}: 작업대(ws)는 현재 실태 경로에서만 (이 경로는 future)`);
          if (a.do === 'ws' && ctx.catalog) for (const id of a.load) if (!ctx.catalog.includes(id)) errs.push(`${w}: ws.load "${id}" 가 DATA_CATALOG 에 없음`);
          if (a.do === 'askEvidence' && a.need && ctx.catalog) for (const id of a.need) if (!ctx.catalog.includes(id)) errs.push(`${w}: askEvidence.need "${id}" 가 DATA_CATALOG 에 없음`);
          if (a.saveAs) {
            if (saveAs.has(a.saveAs)) errs.push(`${w}: saveAs "${a.saveAs}" 가 ${saveAs.get(a.saveAs)} 와 겹침`);
            saveAs.set(a.saveAs, w);
          }
          if (a.do === 'setScenario' && !a.wait && !PRESETS.includes(a.preset)) errs.push(`${w}: setScenario preset은 ${PRESETS.join('|')} 또는 wait: true`);
          if (a.do === 'revealMarkers' && ctx.markers) for (const m of a.markers) if (!ctx.markers[m]) errs.push(`${w}: 사건 표지 "${m}" 없음`);
          if (a.do === 'view3d' && !VIEW3D_MODES.includes(a.mode)) errs.push(`${w}: view3d mode는 ${VIEW3D_MODES.join('|')}`);
          if (a.do === 'card' && !CARDS.includes(a.id)) errs.push(`${w}: card id는 ${CARDS.join('|')}`);
        }
      }
      for (const s of p.steps) if (s.next && !ids.has(s.next)) errs.push(`${where} 단계 ${s.id}: next "${s.next}" 가 없음`);
      if (stepOrder(p).length !== p.steps.length) errs.push(`${where}: next를 따라가면 닿지 않는 단계가 있음(또는 고리)`);
    }
    if (ctx.markers && ctx.sources) {
      for (const [k, m] of Object.entries(ctx.markers)) if (m.src && !ctx.sources[m.src]) errs.push(`사건 표지 ${k}: 출처 키 "${m.src}" 가 등록부에 없음`);
    }
    return errs;
  }

  // ── 탐구 기록 (E5) ──
  // 저장한 응답(saveAs별 하나, 고쳐 쓰면 바뀜)과 record 줄을 시간 순서로 한 표에. 빈 글 응답은 뺀다.
  const LOG_COLS = ['path', 'step', 'question', 'answer', 'year', 'value', 'time'];
  function logRows(answers, records) {
    return [...Object.values(answers).filter(r => String(r.answer).trim() !== ''), ...records]
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  }
  // 시각은 ISO(UTC)로 저장하고, 내보낼 때는 수업한 곳의 시각으로 읽기 쉽게(2026-10-23 14:05:09)
  function localTime(iso) {
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function toCsv(rows) {
    const esc = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [LOG_COLS.join(','), ...rows.map(r => LOG_COLS.map(c => esc(c === 'time' ? localTime(r.time) : (r[c] == null ? '' : r[c]))).join(','))].join('\r\n');
  }

  return { CHART_IDS, PRESETS, TABS, VIEW3D_MODES, CARDS, FUTURE_ONLY, ACTION_SPEC, stepOrder, validate, LOG_COLS, logRows, toCsv, localTime };
})();

if (typeof module !== 'undefined') module.exports = InquiryCore;

// ── 화면 (브라우저에서만) ─────────────────────────────────────────────────
const Inquiry = typeof document === 'undefined' ? null : (() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const INQ = {
    on: false,
    pathId: null,     // 진행 중인 경로 (null = 경로 고르는 화면)
    idx: 0,           // 단계 순서(stepOrder) 안의 위치
    snap: null,       // 탐구를 켜기 직전의 자유 조작 상태 { fut: tab-future.js futSnapshot, ws: 현재 실태 작업대 구성 }
    away: false,      // 진행 중인 경로의 탭이 아닌 화면을 보고 있다 (3차 E1)
    answers: {},      // saveAs → { path, step, question, answer, year, value, chart, time } — 단계를 오가도 남는다
    records: [],      // record 동작으로 남긴 줄 { path, step, question, answer, year, value, time, preset, T }
    cam: null,        // 탐구를 켜기 직전의 카메라 시점
  };
  // 지금 단계가 그래프에 덧입힌 것. 단계에 들어갈 때마다 resetStepView가 비운다(선언형).
  const QV = {
    charts: null,       // 펼쳐 둘 그래프 이름 목록 (null = 모두)
    overlays: {},       // 그래프 이름 → 겹친 자료 이름
    markers: [],        // 공개한 사건 표지 키
    pick: null,         // { chart, saveAs, question } — 그래프를 눌러 연도 고르기
    play: null,         // { from, to, recordAtEnd, value } — 이 단계의 재생 구간
    focused: false,     // 이 단계가 3D 카메라를 옮겼는가
    view3d: false,      // 이 단계가 3D 보기(CO₂·지시약)를 바꿨는가 (3차 E2)
    cards: new Set(),   // 이 단계가 연 학습지 카드
    ws: false,          // 이 단계가 작업대를 잠갔는가
  };
  // 그래프 이름 → 차트. 'ws' = 현재 실태 그래프 작업대의 분석창(3차 E3)
  const chartByKey = k => (k === 'ws' ? (wsNow() && wsNow().chart) : charts.find(c => c.canvas.id === InquiryCore.CHART_IDS[k]));
  const keyOfChart = ch => (wsNow() && ch === wsNow().chart ? 'ws' : Object.keys(InquiryCore.CHART_IDS).find(k => InquiryCore.CHART_IDS[k] === ch.canvas.id));
  const redrawAll = () => { drawCharts(); if (wsNow()) wsNow().chart.draw(); };

  const pathById = id => INQUIRY_PATHS.find(p => p.id === id);
  const curPath = () => pathById(INQ.pathId);
  const curOrder = () => InquiryCore.stepOrder(curPath());

  // ── 전환 [탐구 | 자유 조작] ──
  // 두 탭의 자유 조작 상태를 함께 저장·복원한다 — 경로를 고르는 중에 탭을 바꿀 수 있어서 어느 탭 경로가 시작될지 미리 모른다
  const wsNow = () => (typeof currentWorkspace !== 'undefined' && currentWorkspace ? currentWorkspace : null);
  function setMode(on) {
    if (on === INQ.on) return;
    INQ.on = on;
    el('inqModeOn').setAttribute('aria-pressed', String(on));
    el('inqModeFree').setAttribute('aria-pressed', String(!on));
    el('fcFree').hidden = on;
    el('inqPanel').hidden = !on;
    if (on) {
      INQ.snap = { fut: futSnapshot(), ws: wsNow() ? wsNow().getConfig() : null };
      INQ.cam = getCameraView();
      enterBaseline();
      if (INQ.pathId && pathById(INQ.pathId)) showStep(); else showPicker();
    } else {
      INQ.away = false;
      resetStepView();
      parkCards();
      futRestore(INQ.snap.fut);
      if (wsNow() && INQ.snap.ws) wsNow().loadConfig(INQ.snap.ws);
      setCameraView(INQ.cam);
      INQ.snap = INQ.cam = null;
    }
    bodyClass();
    save();
  }
  // body.inq-on: 탐구가 지금 화면에서 진행 중일 때만(다른 탭 경로를 쉬고 있는 동안에는 그 화면의 조작을 막지 않는다)
  function bodyClass() { document.body.classList.toggle('inq-on', INQ.on && !INQ.away); }
  const TAB_KO = { current: '현재 실태', future: '미래 예측' };
  const TAB_KO_RO = { current: '현재 실태로', future: '미래 예측으로' };   // 받침에 따라 '로/으로'
  const pageTab = () => (typeof activeTab !== 'undefined' ? activeTab : 'future');
  // 탭을 바꿀 때 main.js switchTab 이 부른다. 경로를 고르는 중이면 그 탭의 경로 목록, 진행 중인 경로의 탭이 아니면 '이어집니다' 안내
  function onTab(name) {
    if (!INQ.on) return;
    const path = curPath();
    if (!path) { showPicker(); return; }
    const away = path.tab !== name;
    if (away) {
      if (!INQ.away) resetStepView();
      parkCards();
      INQ.away = true;
      bodyClass();
      el('inqPanel').innerHTML = `<div class="inq-away"><p class="inq-q">이 탐구는 <b>${esc(TAB_KO[path.tab])}</b> 화면에서 이어집니다.</p>
        <p class="inq-text">${esc(path.id)}. ${esc(path.title)} — ${INQ.idx + 1}단계. 응답과 진행 단계는 그대로 남아 있어요.</p>
        <button class="btn btn--nav" type="button" data-inq="back" data-tab="${path.tab}"><span data-icon="back"></span>${esc(TAB_KO_RO[path.tab])} 돌아가기</button></div>`;
      Icons.fill(el('inqPanel'));
    } else if (INQ.away) { INQ.away = false; bodyClass(); showStep(); }
  }

  // 탐구를 시작할 때의 화면: 재생 멈춤, 예측 지움(2023), 보기 토글·팝오버 끔
  function enterBaseline() {
    setPlaying(false);
    if (FUT.showNature) setNatureView(false);
    if (VIEW.validate) setValidateView(false);
    cancelAnimationFrame(redrawAnim);
    FUT.frontier = LAST_OBS_YEAR;
    VIEW.drawFrontier = LAST_OBS_YEAR;
    setYear(LAST_OBS_YEAR);
    renderFuture();
  }

  // ── 경로 고르기 ──
  function showPicker() {
    INQ.pathId = null;
    INQ.away = false;
    bodyClass();
    save();
    resetStepView();
    parkCards();
    const box = el('inqPanel');
    const list = INQUIRY_PATHS.filter(p => p.tab === pageTab());   // 지금 탭의 경로만
    box.innerHTML = `<h3 class="fc-h">탐구 <span>질문을 따라가며 알아보기</span></h3>
      ${list.length ? '' : `<p class="inq-text">${esc(TAB_KO[pageTab()])} 화면의 탐구 경로가 아직 없습니다.</p>`}
      <div class="inq-paths" role="list">${list.map(p => `
        <button class="btn btn--nav btn--stack inq-path-btn" type="button" role="listitem" data-path="${esc(p.id)}">
          <span class="inq-path-name">${esc(p.id)}. ${esc(p.title)}</span>
          <span class="btn-sub">${esc(p.summary || '')} · ${InquiryCore.stepOrder(p).length}단계</span></button>`).join('')}
      </div>`;
  }

  function startPath(id) {
    INQ.pathId = id;
    INQ.idx = 0;
    INQ.away = pathById(id).tab !== pageTab();
    if (INQ.away) { onTab(pageTab()); save(); return; }
    showStep();
  }

  // 학습지 카드 영역(#wsCards, js/worksheet.js): 단계 중에는 단계 본문 안(질문과 함께 스크롤), 그 밖에는 [탐구] 탭 끝.
  // 단계 화면은 innerHTML 로 통째로 다시 그리므로 그 전에 반드시 밖으로 빼 둔다(안에 둔 채 지우면 카드가 사라진다)
  const parkCards = () => el('wsPanelInquiry').appendChild(el('wsCards'));
  // 3D 보기(CO₂·지시약)를 원하는 상태로. B3에서 숨긴 버튼의 클릭 처리(main.js bindView3D)를 그대로 쓴다
  const setView3D = (key, on) => { if (VIEW3D[key] !== on) el(key === 'co2' ? 'view3dCo2' : 'view3dIndicator').click(); };

  // ── 단계 ──
  // 단계 화면 상태(탐구가 그래프·3D에 덧입힌 것)를 모두 걷는다. 단계에 들어갈 때마다, 그리고 탐구를 끌 때 부른다.
  function resetStepView() {
    setPlaying(false);
    QV.charts = null;
    QV.markers = [];
    QV.pick = null;
    for (const k of Object.keys(QV.overlays)) removeOverlay(k);
    applyChartLayout();
    setTimeLimit();
    for (const ch of charts) ch.canvas.style.cursor = '';
    if (wsNow()) { wsNow().chart.canvas.style.cursor = ''; wsNow().chart.draw(); }
    QV.play = null;
    setPopover(null);
    if (VIEW.omega) setOmegaView(false);
    if (VIEW.validate) setValidateView(false);
    if (FUT.showNature) setNatureView(false);
    if (QV.focused) { setCameraView(CAM_TARGETS.overview); QV.focused = false; }
    el('inqCards').hidden = true;
    // 3차 E2 동작이 바꾼 것 되돌리기
    if (QV.view3d) { setView3D('co2', false); setView3D('indicator', false); QV.view3d = false; }
    for (const id of QV.cards) Worksheet.closeCard(id);
    QV.cards.clear();
    if (QV.ws && wsNow()) wsNow().lock(null);
    QV.ws = false;
  }

  function showStep() {
    if (curPath().tab !== pageTab()) { onTab(pageTab()); return; }   // 다른 탭의 경로(새로 고친 뒤 되살릴 때 등)
    INQ.away = false;
    bodyClass();
    const order = curOrder();
    INQ.idx = Math.max(0, Math.min(order.length - 1, INQ.idx));
    const step = order[INQ.idx], path = curPath(), n = order.length;
    resetStepView();
    parkCards();
    const box = el('inqPanel');
    box.innerHTML = `
      <div class="inq-top">
        <button class="btn btn--nav btn--sm" type="button" data-inq="paths"><span data-icon="back"></span>경로</button>
        <span class="inq-path-title">${esc(path.id)}. ${esc(path.title)}</span>
      </div>
      <div class="inq-progress readout" role="progressbar" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${INQ.idx + 1}"
        aria-label="단계 ${INQ.idx + 1} / ${n}">
        <span class="inq-dots">${order.map((s, i) => `<i class="${i < INQ.idx ? 'done' : i === INQ.idx ? 'now' : ''}"></i>`).join('')}</span>
        <b>${INQ.idx + 1}</b>&nbsp;/&nbsp;${n}
      </div>
      <div class="inq-body">
        <h3 class="inq-title">${esc(step.title)}</h3>
        <p class="inq-q">${esc(step.question)}</p>
        ${step.text ? `<p class="inq-text">${esc(step.text)}</p>` : ''}
        ${step.equation ? `<div class="inq-eq readout">${esc(step.equation)}</div>` : ''}
        <div class="inq-widgets" id="inqWidgets"></div>
        ${step.hint ? `<details class="inq-hint"><summary>힌트 보기</summary><p>${esc(step.hint)}</p></details>` : ''}
      </div>
      <div class="inq-nav">
        <button class="btn btn--nav" type="button" data-inq="prev" ${INQ.idx === 0 ? 'disabled' : ''}><span data-icon="back"></span>이전</button>
        <button class="btn btn--nav" type="button" data-inq="next">${INQ.idx === n - 1 ? '마치기' : '다음'}</button>
      </div>`;
    Icons.fill(box);
    box.querySelector('.inq-body').appendChild(el('wsCards'));   // 이 단계가 연 카드는 질문 아래에
    const ctx = { path, step, widgets: el('inqWidgets'), after: [] };
    for (const a of step.actions || []) {
      const fn = ACTIONS[a.do];
      if (fn) fn(a, ctx);
      else console.warn('탐구: 모르는 동작', a.do);
    }
    ctx.after.forEach(f => f());   // 다른 동작이 다 적용된 뒤에 보여야 하는 것 (예: 재생 결과 목록)
    renderFuture();
    save();
  }

  function go(delta) {
    const n = curOrder().length;
    if (INQ.idx + delta >= n) { showPicker(); return; }   // 마지막 단계에서 [마치기] → 경로 고르기
    INQ.idx = Math.max(0, INQ.idx + delta);
    showStep();
  }

  // ── 학생 응답 ──
  function setAnswer(saveAs, rec) {
    const step = curOrder()[INQ.idx];
    INQ.answers[saveAs] = { path: INQ.pathId, step: step.id, question: rec.question || step.question,
      answer: '', year: '', value: '', ...rec, time: new Date().toISOString() };
    logChanged();
  }

  // ── 탐구 기록: 기록 서랍 묶음 · CSV · 브라우저 저장 (E5) ──
  // 저장소는 localStorage. file:// 로 연 단일 HTML 등에서 막히는 브라우저가 있어 실패해도 조용히 넘어간다
  // (그 경우 새로 고치면 응답이 사라질 뿐 탐구는 그대로 된다).
  // 3차 E1부터 학습지 공용 저장소(js/worksheet.js Worksheet.store, localStorage 'worksheet.v1')에 둔다.
  // 응답은 경로별 묶음 answers[경로][saveAs], 진행 상태·기록 줄은 inquiry. 2차의 'inquiry.v1'은 저장소가 처음 한 번 옮겨 담았다.
  function save() {
    const d = Worksheet.store.data, byPath = {};
    for (const [k, r] of Object.entries(INQ.answers)) (byPath[r.path] = byPath[r.path] || {})[k] = r;
    d.answers = byPath;
    d.inquiry = { on: INQ.on, pathId: INQ.pathId, idx: INQ.idx, records: INQ.records };
    Worksheet.store.save();
  }
  function load() {
    const d = Worksheet.store.data;
    INQ.answers = {};
    for (const g of Object.values(d.answers || {})) Object.assign(INQ.answers, g);
    const q = d.inquiry || {};
    INQ.records = q.records || [];
    if (q.pathId && pathById(q.pathId)) { INQ.pathId = q.pathId; INQ.idx = q.idx || 0; }
    return q;
  }
  let logTimer = 0;
  function logChanged() {   // 글자를 칠 때마다 표를 다시 그리지 않게 0.3초 모아서
    clearTimeout(logTimer);
    logTimer = setTimeout(() => { renderLog(); save(); }, 300);
  }
  function renderLog() {
    const rows = InquiryCore.logRows(INQ.answers, INQ.records);
    // 학습지 증거(3차 C4)도 이 CSV로 함께 내보내므로, 증거만 있어도 이 묶음을 보인다
    el('recInq').hidden = rows.length === 0 && Worksheet.evidenceRows().length === 0;
    el('inqLogCount').textContent = rows.length;
    el('inqLog').innerHTML = rows.map(r => `<tr><td>${esc(r.path)}</td><td>${esc(r.step)}</td><td>${esc(r.question)}</td>`
      + `<td>${esc(r.answer)}</td><td>${esc(r.year)}</td><td>${esc(r.value)}</td></tr>`).join('');
  }
  el('inqCsv').addEventListener('click', () => {
    const rows = InquiryCore.logRows(INQ.answers, INQ.records), ev = Worksheet.evidenceRows();
    if (!rows.length && !ev.length) return;
    // 학습지 증거 줄(3차 C4)은 빈 줄 하나 뒤에 제 머리줄(kind, series, mode, flips, range, memo, time)과 함께 붙인다
    const csv = InquiryCore.toCsv(rows) + (ev.length ? '\r\n\r\n' + Worksheet.evidenceCsv(InquiryCore.localTime) : '');
    // BOM: 엑셀에서 한글이 깨지지 않게 (측정 기록 CSV와 같은 방식)
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), `미래예측_탐구기록_${fileStamp()}.csv`);
  });
  document.addEventListener('worksheet:evidence', renderLog);
  el('inqClear').addEventListener('click', () => {
    if (!confirm('탐구 기록(고른 점·쓴 글·고른 보기·기록 줄)을 모두 지울까요?')) return;
    INQ.answers = {};
    INQ.records = [];
    renderLog();
    save();
    if (INQ.on && INQ.pathId) showStep();
  });

  // 단계 패널에 넣는 작은 안내 줄 (출처 ⓘ 포함 가능)
  function widget(ctx, html, cls = '') {
    const d = document.createElement('div');
    d.className = 'inq-w ' + cls;
    d.innerHTML = html;
    Icons.fill(d);
    ctx.widgets.appendChild(d);
    return d;
  }

  // ── 그래프: 펼치기·접기 ──
  // 접은 그래프는 제목 줄만 옅게 남긴다(그래프 열 높이는 그대로라 스크롤이 생기지 않는다).
  // 그래프는 평소 2×2(3차 B1)인데, 탐구 단계가 일부를 접으면 한 열로 쌓아 펼친 그래프가 폭 전체를 쓰게 한다
  // (2×2 그대로 두면 펼친 그래프가 반쪽 폭만 쓰고 옆 칸이 비었다). 다 펼치면 CSS의 2×2로 돌아간다.
  function applyChartLayout() {
    const keys = Object.keys(InquiryCore.CHART_IDS);
    const shown = keys.map(k => !QV.charts || QV.charts.includes(k));
    keys.forEach((k, i) => el(InquiryCore.CHART_IDS[k]).closest('.chart-block').classList.toggle('inq-fold', !shown[i]));
    const folding = shown.some(v => !v);
    // 행 높이는 화면(DOM) 순서로 정한다. CHART_IDS 키 순서(CO₂·기온·pH·해수온)는 3차 A2에서 바꾼 그래프 순서
    // (CO₂→기온→해수온→pH)와 달라, 키 순서로 만들면 pH 대신 해수온 줄이 늘어났다
    const blocks = [...el('futCharts').querySelectorAll(':scope > .chart-block')];
    el('futCharts').style.gridTemplateColumns = folding ? 'minmax(0, 1fr)' : '';
    el('futCharts').style.gridTemplateRows = folding
      ? ['auto', ...blocks.map(b => b.classList.contains('inq-fold') ? 'auto' : 'minmax(0, 1fr)')].join(' ') : '';
    // ResizeObserver를 기다리지 않고 바로 맞춘다(헤드리스·느린 기기에서 한동안 예전 크기로 겹쳐 그려졌다)
    charts.forEach(c => c.resize());
  }

  // ── 그래프: 겹치기 (오른쪽 축) ──
  // 자료마다: 이름(축 제목), 색 토큰, 출처 키, 점 만들기. 예측이 있는 자료는 예측 전선까지만 그린다($clip).
  const OVERLAY = {
    fossil: { label: '화석연료 배출 (GtC/년)', color: '--data-fossil', src: 'emis_gcp', clip: false, zero: true,
      points: () => toPoints(EARTH_DATA.emissions, 'fossil').filter(p => p.x <= LAST_OBS_YEAR) },
    co2: { label: '대기 CO₂ (ppm)', color: '--data-co2', src: 'model_co2', clip: true,
      points: () => [...OBS_PTS.co2.filter(p => p.x <= LAST_OBS_YEAR), ...toXY(FUT.human, 'ppm', LAST_OBS_YEAR + 1)] },
  };
  function overlayDataset(ch) { return ch.data.datasets.find(d => d.$inq); }
  function addOverlay(key, series) {
    const ch = chartByKey(key), o = OVERLAY[series];
    removeOverlay(key);
    ch.data.datasets.push(lineDs(o.label, C(o.color), { yAxisID: 'yq', borderWidth: 2, $inq: series, $clip: o.clip }));
    ch.options.scales.yq = Theme.axis({ position: 'right', grid: { drawOnChartArea: false },
      ticks: { color: C(o.color), font: Theme.font(), maxTicksLimit: 5 } });
    ch.options.layout.padding.right = 4;   // Ω 축 자리를 겹친 자료 축이 쓴다
    QV.overlays[key] = series;
    fillOverlay(ch);
  }
  function fillOverlay(ch) {
    const d = overlayDataset(ch);
    if (!d) return;
    d.data = OVERLAY[d.$inq].points();
    const r = niceRange(d.data.map(p => p.y), 0.06);
    if (OVERLAY[d.$inq].zero) r.min = 0;   // 배출량은 0에서 시작해야 '늘어난 정도'가 바로 읽힌다
    Object.assign(ch.options.scales.yq, r);
    ch.update('none');
  }
  function removeOverlay(key) {
    const ch = chartByKey(key);
    ch.data.datasets = ch.data.datasets.filter(d => !d.$inq);
    delete ch.options.scales.yq;
    ch.options.layout.padding.right = key === 'pH' && VIEW.omega ? 4 : Y1_AXIS_W + 4;
    delete QV.overlays[key];
    ch.update('none');
  }
  // 궤적이 바뀌면(시나리오 선택) 겹친 예측 자료도 다시 (tab-future.js refreshCharts가 부른다)
  function refresh() {
    for (const k of Object.keys(QV.overlays)) fillOverlay(chartByKey(k));
  }

  // ── 그래프 층 그리기 (tab-future.js inquiryLayerPlugin 이 부른다) ──
  const MARKER_TINT = ['--data-fossil', '--data-temp', '--data-ph'];
  function drawUnder(chart) {
    if (!INQ.on || !QV.markers.length) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    if (!x || !a) return;
    ctx.save();
    QV.markers.forEach((key, i) => {
      const m = INQUIRY_MARKERS[key];
      const x0 = Math.max(a.left, x.getPixelForValue(m.from)), x1 = Math.min(a.right, x.getPixelForValue(m.to));
      if (x1 <= x0) return;
      const tint = MARKER_TINT[i % MARKER_TINT.length];
      ctx.fillStyle = Theme.alpha(tint, 0.12);
      ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.strokeStyle = Theme.alpha(tint, 0.6); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.moveTo(x1, a.top); ctx.lineTo(x1, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `700 ${Theme.px('--fs-1')}px ${C('--font-body')}`;
      ctx.fillStyle = C(tint); ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      // 맨 윗줄은 '관측 끝 · 예측 시작' 머리표 자리라 한 줄 아래부터, 오른쪽 끝을 넘으면 안쪽으로 당긴다
      const lw = ctx.measureText(m.label).width;
      const lx = Math.max(a.left + 2, Math.min(x0 + 4, a.right - lw - 4));
      ctx.fillText(m.label, lx, a.top + 3 + (i + 1) * (Theme.px('--fs-1') + 4));
    });
    ctx.restore();
  }
  // 학생이 고른 점: 경로 안에서 저장한 pickPoint 답을 그 그래프에 늘 보인다(나중 단계에서 표지와 비교하도록)
  function drawOver(chart) {
    if (!INQ.on) return;
    const key = keyOfChart(chart);
    const { ctx, chartArea: a, scales } = chart;
    if (!scales.x || !scales.y) return;
    if (key === 'ws' && wsNow().getConfig().mode !== 'time') return;   // 작업대는 시간 보기에서만 (y = 왼쪽 축 Y1)
    for (const r of Object.values(INQ.answers)) {
      if (r.chart !== key || r.path !== INQ.pathId || r.year === '') continue;
      const px = scales.x.getPixelForValue(r.year), py = scales.y.getPixelForValue(r.value);
      if (px < a.left || px > a.right) continue;
      ctx.save();
      ctx.strokeStyle = C('--ink'); ctx.lineWidth = 2.5; ctx.fillStyle = C('--paper');
      ctx.beginPath(); ctx.arc(px, py, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 2 * Math.PI); ctx.fillStyle = C('--ink'); ctx.fill();
      const txt = `내가 고른 해 ${r.year}`;
      ctx.font = `700 ${Theme.px('--fs-1')}px ${C('--font-body')}`;
      const w = ctx.measureText(txt).width + 10, h = Theme.px('--fs-1') + 8;
      let lx = px - w / 2; lx = Math.max(a.left, Math.min(a.right - w, lx));
      const ly = Math.max(a.top, py - 14 - h);
      ctx.fillStyle = C('--paper'); ctx.strokeStyle = C('--ink'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(lx, ly, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C('--ink'); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(txt, lx + 5, ly + h / 2 + 0.5);
      ctx.restore();
    }
  }
  // 그래프 클릭 → 연도 고르기. 값은 데이터 레이블과 같은 규칙(과거는 관측, 없으면 모형 / 미래는 예측)으로 읽는다.
  function chartEvent(chart, e) {
    if (!INQ.on || !QV.pick || e.type !== 'click' || keyOfChart(chart) !== QV.pick.chart) return;
    const a = chart.chartArea;
    if (e.x < a.left || e.x > a.right || e.y < a.top || e.y > a.bottom) return;
    if (QV.pick.chart === 'ws') { pickOnWorkspace(chart, e); return; }
    const year = Math.round(Math.max(LIMIT.from, Math.min(LIMIT.to, chart.scales.x.getValueForPixel(e.x))));
    const r = valueAt(chart.$spec, year);
    if (!r) return;   // 아직 예측하지 않은 해
    const spec = chart.$spec;
    setAnswer(QV.pick.saveAs, { question: QV.pick.question, chart: QV.pick.chart, year, value: Number(r.v.toFixed(4)),
      answer: `${year}년 (${spec.fmt(r.v)}, ${r.tag})` });
    showPick();
    drawCharts();
  }
  // 작업대 분석창 클릭 → Y1 계열에서 가장 가까운 해의 관측값 (3차 E3)
  function pickOnWorkspace(chart, e) {
    const cfg = wsNow().getConfig(), id = cfg.series[0];
    if (!id || cfg.mode !== 'time') return;
    const it = DATA_CATALOG.find(x => x.id === id), pts = GraphWorkspace.makeEnv(DATA_CATALOG).pts(id);
    const want = chart.scales.x.getValueForPixel(e.x);
    const p = pts.reduce((b, q) => (Math.abs(q.x - want) < Math.abs(b.x - want) ? q : b), pts[0]);
    const val = `${p.y.toFixed(it.minSpan >= 2 ? 1 : 3)}${it.unit ? ' ' + it.unit : ''}`;
    setAnswer(QV.pick.saveAs, { question: QV.pick.question, chart: 'ws', year: p.x, value: Number(p.y.toFixed(4)),
      answer: `${p.x}년 (${it.short} ${val}, ${it.scope === 'model' ? '모형' : '관측'})` });
    showPick();
    chart.draw();
  }
  function showPick() {
    const w = el('inqPick');
    if (!w || !QV.pick) return;
    const r = INQ.answers[QV.pick.saveAs];
    w.innerHTML = r && r.year !== '' ? `고른 해: <b>${r.year}년</b> <span class="inq-sub">${esc(r.answer.replace(/^\d+년 /, ''))}</span>`
      : '<span class="inq-sub">아직 고르지 않았어요. 그래프를 눌러 보세요.</span>';
  }

  // ── 3D 카메라 대상 (focus3D) ──
  // 모형 좌표: 바다 구역 x ≈ −2, 숲 0, 도시 +2 (common.js ZONE_W = 2). 산호는 바다 앞쪽 바닥, 조개는 바다 가운데 뒤쪽 바닥,
  // 빙하는 바다 뒤 왼쪽 모서리. angleY·angleX·dist 는 common.js updateCamera 와 같은 뜻(회전각·올려본 각·거리).
  const CAM_TARGETS = {
    overview: { angleY: -0.5, angleX: 0.5, dist: 8.2, target: [0, 0.3, 0] },
    city: { angleY: 0.35, angleX: 0.5, dist: 3.4, target: [2, 0.55, 0] },
    coral: { angleY: -0.25, angleX: 0.62, dist: 2.3, target: [-1.9, 0.2, 0.65] },
    shell: { angleY: -0.15, angleX: 0.95, dist: 2.6, target: [-1.65, 0.15, -0.35] },
    glacier: { angleY: -0.65, angleX: 0.5, dist: 3.0, target: [-2.6, 0.5, -1.1] },
  };

  // ── 기록 (record) ──
  // 측정 기록(기존 서랍 표·CSV)에 한 줄 + 탐구 기록에 한 줄. value 는 단계가 고른 변수(기본 기온 편차).
  const REC_VALUE = {
    T: { key: 'T', name: '기온 편차', fmt: v => `${fmtSigned(v, 2)} °C` },
    ppm: { key: 'ppm', name: 'CO₂', fmt: v => `${v.toFixed(0)} ppm` },
    pH: { key: 'pH', name: 'pH', fmt: v => v.toFixed(3) },
  };
  function doRecord(step, valueKey = 'T', extra = {}) {
    addRecord({ fx: extra.auto ? 'soft' : 'full' });   // 재생 끝 자동 기록은 약한 효과(테두리만)
    const nature = FUT.showNature;
    const h = sampleAt(nature ? FUT.nature : FUT.human, FUT.year), y = Math.round(FUT.year);
    const scen = nature ? '자연만 있는 지구' : humanLabel();
    const vk = REC_VALUE[valueKey] || REC_VALUE.T;
    INQ.records.push({ path: INQ.pathId, step: step.id, question: step.question,
      answer: `기록: ${scen} ${y}년 · CO₂ ${h.ppm.toFixed(0)} ppm · 기온 ${fmtSigned(h.T, 2)} °C · pH ${h.pH.toFixed(3)}`,
      year: y, value: Number(h[vk.key].toFixed(4)), valueKey: vk.key, valueName: vk.name, preset: nature ? 'nature' : FUT.preset, T: h.T,
      time: new Date().toISOString(), ...extra });
    showRecordNote();
    logChanged();
  }
  function showRecordNote() {
    const w = el('inqRecNote');
    if (!w) return;
    const n = INQ.records.filter(r => r.path === INQ.pathId).length;
    w.textContent = n ? `이 경로에서 기록한 줄: ${n}` : '';
  }

  // ── 재생 (play) ──
  function startPlay() {
    const p = QV.play;
    if (!p) return;
    setTimeLimit(LIMIT.from, p.to);
    cancelAnimationFrame(redrawAnim);
    if (p.from >= LAST_OBS_YEAR) {   // 예측 구간을 처음부터 다시 그린다(시나리오를 바꿔 다시 해 볼 때)
      FUT.frontier = Math.min(FUT.frontier, p.from);
      VIEW.drawFrontier = FUT.frontier;
    }
    setYear(p.from);
    renderFuture();
    setPlaying(true);
  }
  function playEnded() {
    const p = QV.play;
    if (!INQ.on || !p || Math.round(FUT.year) < p.to) return;
    if (p.recordAtEnd) doRecord(curOrder()[INQ.idx], p.value, { auto: true });
    showSeen();
  }
  // 이 경로에서 재생해 본 시나리오: 재생 끝에 자동으로 남긴 기록(auto). 같은 시나리오를 다시 하면 마지막 것.
  // 다음 단계(영향 카드)에서도 읽으므로 지금 단계의 재생 구간과 상관없이 기록에서 찾는다.
  function seenScenarios() {
    const out = new Map();
    for (const r of INQ.records) if (r.path === INQ.pathId && r.auto && r.preset !== 'nature') out.set(r.preset, r);
    return out;
  }
  function showSeen() {
    const w = el('inqSeen');
    if (!w) return;
    const seen = seenScenarios();
    w.innerHTML = InquiryCore.PRESETS.map(p => {
      const r = seen.get(p);
      return `<li class="${r ? 'done' : ''}">${esc(PRESET_KO[p])}: ${r ? `<b>${esc(REC_VALUE[r.valueKey].fmt(r.value))}</b> (${r.year}년)` : '<span class="inq-sub">아직</span>'}</li>`;
    }).join('');
    document.querySelectorAll('#inqPanel [data-scen]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scen === FUT.preset)));
  }

  // ── 영향 카드 (impactCards, §5) ──
  // 3차 E2부터 학습지 '기온 수준별 영향' 카드(#inqCards 를 옮김)로 뜬다 — 3D를 가리지 않게. 카드 내용은 INQUIRY_IMPACTS.
  // levels: 'seen' = 이 경로에서 재생해 본 시나리오의 끝 연도 기온에 가장 가까운 카드를 강조하고 그 시나리오를 카드에 적는다.
  //         배열 = 그 수준의 카드만 보인다. 생략 = 모든 카드.
  function showCards(levels) {
    const D = INQUIRY_IMPACTS, box = el('inqCards');
    const seen = [...seenScenarios().values()];
    const all = D.levels.map(c => c.level);
    const near = T => [...all, ...(D.missingLevels || [])].reduce((b, l) => (Math.abs(l - T) < Math.abs(b - T) ? l : b), all[0]);
    const tags = new Map();   // 카드 수준 → 그 수준에 가까운 학생 결과들
    const missing = [];
    for (const r of seen) {
      const l = near(r.T), t = `${PRESET_KO[r.preset]} ${r.year}년 ${fmtSigned(r.T, 1)} °C`;
      if (all.includes(l)) tags.set(l, [...(tags.get(l) || []), t]); else missing.push(`${t} → ${l} °C 카드는 근거 자료(발췌)가 없어 만들지 않았습니다. 앞뒤 카드를 함께 보세요.`);
    }
    const shown = Array.isArray(levels) ? D.levels.filter(c => levels.includes(c.level)) : D.levels;
    const focus = levels === 'seen' && tags.size > 0;
    box.innerHTML = `
      <div class="ic-head"><h3>기온이 오르면 — 기온 수준별 영향 <span class="readout">IPCC</span></h3>
        <button class="btn btn--view btn--sm" type="button" data-ic="close"><span data-icon="close"></span>닫기</button></div>
      <p class="ic-basis">${esc(D.basis)}</p>
      ${D.seaLevel ? `<div class="ic-sea"><b>${esc(D.seaLevel.title)}</b>${srcButton(D.seaLevel.src)}
        <ul>${InquiryCore.PRESETS.filter(p => D.seaLevel.rows[p]).map(p => `<li class="${seen.some(r => r.preset === p) ? 'hit' : ''}">
          ${esc(PRESET_KO[p])}: <b>${esc(D.seaLevel.rows[p])}</b></li>`).join('')}</ul>
        <span class="inq-sub">${esc(D.seaLevel.note)}</span></div>` : ''}
      <div class="ic-grid">${shown.map(c => `
        <section class="ic-card${focus && !tags.has(c.level) ? ' dim' : ''}${tags.has(c.level) ? ' hit' : ''}">
          <h4>${esc(c.title)}</h4>
          ${(tags.get(c.level) || []).map(t => `<p class="ic-tag">${esc(t)}</p>`).join('')}
          <ul>${c.items.map(it => `<li><span class="ic-what">${esc(it.what)}${srcButton(it.src)}</span>
            <b class="ic-val">${esc(it.value)}</b><span class="ic-detail">${esc(it.detail)}</span></li>`).join('')}</ul>
        </section>`).join('')}</div>
      ${missing.map(t => `<p class="ic-missing">${esc(t)}</p>`).join('')}
`;
    Icons.fill(box);
    box.hidden = false;
  }
  el('inqCards').addEventListener('click', e => { if (e.target.closest('[data-ic="close"]')) el('inqCards').hidden = true; });

  // ── 동작 ── (TASK_2차_E §2. 이름과 필수 필드는 InquiryCore.ACTION_SPEC)
  const ACTIONS = {
    showCharts(a) {
      QV.charts = a.charts.slice();
      applyChartLayout();
    },
    timeRange(a) {
      const to = a.lockFuture ? Math.min(a.to, LAST_OBS_YEAR) : a.to;
      setTimeLimit(a.from, to);
    },
    overlay(a, ctx) {
      addOverlay(a.chart, a.series);
      const o = OVERLAY[a.series];
      widget(ctx, `<span class="inq-swatch" style="border-color:${C(o.color)}"></span>겹친 자료: <b>${esc(o.label)}</b> — 오른쪽 축${srcButton(o.src)}`, 'inq-key');
    },
    pickPoint(a, ctx) {
      QV.pick = { chart: a.chart, saveAs: a.saveAs, question: a.prompt || ctx.step.question };
      const ch = chartByKey(a.chart);
      if (ch) ch.canvas.style.cursor = 'crosshair';
      widget(ctx, '', 'inq-pick').id = 'inqPick';
      showPick();
    },
    revealMarkers(a, ctx) {
      QV.markers = a.markers.slice();
      QV.markers.forEach((k, i) => {
        const m = INQUIRY_MARKERS[k];
        widget(ctx, `<span class="inq-swatch fill" style="background:${Theme.alpha(MARKER_TINT[i % MARKER_TINT.length], 0.35)}"></span>`
          + `<b>${esc(m.label)}</b> ${esc(m.range || `${m.from}~${m.to}`)}${srcButton(m.src)}`, 'inq-key');
      });
      redrawAll();
    },
    setScenario(a, ctx) {
      if (!a.wait) { if (FUT.preset !== a.preset) setPreset(a.preset); return; }
      // 학생이 고른다: 시나리오 버튼(시나리오 영역 색). 이 단계에 play가 있으면 고르는 즉시 그 구간을 재생한다.
      const w = widget(ctx, `<div class="inq-scen" role="group" aria-label="시나리오 고르기">${InquiryCore.PRESETS.map(p =>
        `<button class="btn btn--scen btn--sm" type="button" data-scen="${p}" aria-pressed="false">${esc(PRESET_KO[p])}</button>`).join('')}</div>
        <ul class="inq-seen" id="inqSeen"></ul>`);
      w.addEventListener('click', e => {
        const b = e.target.closest('[data-scen]');
        if (!b) return;
        if (FUT.preset !== b.dataset.scen) setPreset(b.dataset.scen);
        showSeen();
        if (QV.play) startPlay();
      });
      ctx.after.push(showSeen);
    },
    play(a, ctx) {
      QV.play = { from: a.from, to: a.to, recordAtEnd: !!a.recordAtEnd, value: a.value || 'T' };
      setTimeLimit(LIMIT.from, a.to);
      const w = widget(ctx, `<button class="btn btn--time btn--sm" type="button"><span data-icon="play"></span>${a.from}→${a.to}년 재생</button>`
        + (a.recordAtEnd ? ` <span class="inq-sub">${a.to}년에 도착하면 기록 서랍에 자동으로 저장</span>` : ''), 'inq-play');
      w.querySelector('button').addEventListener('click', startPlay);
    },
    toggleNature(a) { setNatureView(a.on !== false); },
    focus3D(a) {
      const v = CAM_TARGETS[a.target];
      if (!v) { console.warn('탐구: 모르는 3D 대상', a.target); return; }
      setCameraView(v);
      QV.focused = true;
    },
    // 그래프 팝오버는 3차 E2부터 학습지 카드다(같은 요소). 열고 닫는 표시는 카드가 #popSpec·#popSink 의 hidden 을 따른다
    openPopover(a) { if (Worksheet.openCard(a.id)) QV.cards.add(a.id); },
    omega(a) { setOmegaView(a.on !== false); },
    modelPast(a) { setValidateView(a.on !== false); },   // [모형 검증 보기]: 모형이 계산한 과거(옅은 선)를 관측과 함께
    askText(a, ctx) {
      const prev = INQ.answers[a.saveAs];
      const w = widget(ctx, `<label class="inq-ask"><span>${esc(a.prompt || ctx.step.question)}</span>
        <textarea rows="${a.rows || 2}" placeholder="${esc(a.placeholder || '한두 문장으로 써 보세요')}"></textarea></label>`);
      const ta = w.querySelector('textarea');
      ta.value = prev ? prev.answer : '';
      ta.addEventListener('input', () => setAnswer(a.saveAs, { question: a.prompt || ctx.step.question, answer: ta.value.trim() }));
    },
    askChoice(a, ctx) {
      const prev = INQ.answers[a.saveAs];
      const name = 'inqc-' + a.saveAs;
      const w = widget(ctx, `<fieldset class="inq-choice"><legend>${esc(a.prompt || ctx.step.question)}</legend>${a.options.map((o, i) =>
        `<label><input type="radio" name="${name}" value="${i}" ${prev && prev.choice === i ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}
        <p class="inq-fb" role="status"></p></fieldset>`);
      const fb = w.querySelector('.inq-fb');
      // 정답 판정은 '다시 생각해 보세요' 수준까지만 (지시서 §2). 고른 답은 맞든 틀리든 그대로 기록한다.
      const judge = i => {
        if (a.answer == null || i == null) { fb.textContent = ''; return; }
        fb.textContent = i === a.answer ? (a.feedback || '좋아요. 왜 그런지 한 문장으로 설명할 수 있나요?') : '다시 생각해 보세요.';
        fb.classList.toggle('ok', i === a.answer);
      };
      judge(prev ? prev.choice : null);
      w.addEventListener('change', e => {
        const i = Number(e.target.value);
        setAnswer(a.saveAs, { question: a.prompt || ctx.step.question, answer: a.options[i], choice: i });
        judge(i);
      });
    },
    record(a, ctx) {
      const w = widget(ctx, `<button class="btn btn--rec btn--sm" type="button"><span data-icon="record"></span>${esc(a.label || '지금 상태 기록하기')}</button>
        <span class="inq-sub" id="inqRecNote"></span>`, 'inq-rec');
      w.querySelector('button').addEventListener('click', () => doRecord(ctx.step, a.value));
      showRecordNote();
    },
    impactCards(a, ctx) {
      const b = widget(ctx, `<button class="btn btn--view btn--sm" type="button"><span data-icon="list"></span>영향 카드 보기</button>`);
      b.querySelector('button').addEventListener('click', () => showCards(a.levels));
      showCards(a.levels);
    },
    // ── 3차 E2 ──
    view3d(a) {
      QV.view3d = true;
      if (a.mode === 'visible') { setView3D('co2', false); setView3D('indicator', false); } else setView3D(a.mode, true);
      // 지시약을 켜면 범례 카드가 따라 열린다(main.js) — 이 단계가 연 카드로 쳐서 단계를 나갈 때 함께 닫는다
      if (a.mode === 'indicator' && Worksheet.cardOpen('legend3d')) QV.cards.add('legend3d');
    },
    card(a) {
      if (a.id === 'impacts') { showCards(a.levels); QV.cards.add('impacts'); return; }
      if (Worksheet.openCard(a.id)) QV.cards.add(a.id);
    },
    // 작업대(현재 실태) 구성을 정한다. lock 이면 덱에 그 카드만 남긴다(다른 카드는 흐리게, 끌 수 없음)
    ws(a) {
      const w = wsNow();
      if (!w) return;
      w.loadConfig({ series: a.load, mode: a.mode || 'time', range: a.range || 'all', commonOnly: false, flips: a.flips || [] });
      w.lock(a.lock ? { deck: a.load, modes: a.modes } : null);
      QV.ws = !!a.lock;
    },
    // 나의 증거 하나를 고르거나(지금 작업대를 바로 붙일 수도) 주장 한 줄을 쓴다. need = 있으면 좋은 자료(맞지 않으면 부드럽게 알림)
    askEvidence(a, ctx) {
      const prev = INQ.answers[a.saveAs] || {};
      const w = widget(ctx, `<div class="inq-ev">
        <label class="inq-ask"><span>${esc(a.prompt || '이 주장을 뒷받침하는 증거를 고르세요')}</span>
          <select class="inq-ev-sel"></select></label>
        ${a.need ? `<p class="inq-sub">필요한 자료: ${esc(a.need.map(id => (DATA_CATALOG.find(it => it.id === id) || { short: id }).short).join(' · '))}</p>` : ''}
        <div class="inq-ev-acts">${wsNow() ? '<button class="btn btn--rec btn--sm" type="button" data-ev-now><span data-icon="download"></span>지금 작업대를 증거로 붙이기</button>' : ''}</div>
        <p class="inq-fb" role="status"></p>
        <label class="inq-ask"><span>주장 한 줄</span><textarea rows="2" placeholder="이 증거가 보여 주는 것: …"></textarea></label></div>`);
      const sel = w.querySelector('select'), ta = w.querySelector('textarea'), fb = w.querySelector('.inq-fb');
      ta.value = prev.claim || '';
      const fill = () => {
        const list = Worksheet.evidenceList();
        sel.innerHTML = `<option value="">${list.length ? '증거 고르기…' : '아직 보낸 증거가 없어요 — 작업대에서 [학습지로 보내기]'}</option>`
          + list.map(e => `<option value="${e.id}">${e.n}. ${esc(e.title)}</option>`).join('');
        sel.value = list.some(e => e.id === prev.evidence) ? prev.evidence : '';
        judge();
      };
      // need 는 정답 판정이 아니라 안내: 고른 증거(작업대 구성)에 그 자료가 없으면 알려 준다
      const judge = () => {
        const e = Worksheet.evidenceList().find(x => x.id === sel.value);
        const missing = a.need && e && e.cfg.series ? a.need.filter(id => !e.cfg.series.includes(id)) : [];
        fb.classList.remove('ok');
        fb.textContent = !e ? '' : missing.length
          ? `이 증거에는 ${missing.map(id => (DATA_CATALOG.find(it => it.id === id) || { short: id }).short).join(' · ')}이(가) 없어요. 다른 증거를 골라 보세요.` : '';
      };
      const saveIt = () => {
        const e = Worksheet.evidenceList().find(x => x.id === sel.value);
        prev.evidence = sel.value; prev.claim = ta.value.trim();
        setAnswer(a.saveAs, { question: a.prompt || ctx.step.question, evidence: sel.value, claim: prev.claim,
          answer: `${e ? `증거 ${e.n} (${e.title})` : '증거 없음'}${prev.claim ? ' — ' + prev.claim : ''}` });
      };
      sel.addEventListener('change', () => { judge(); saveIt(); });
      ta.addEventListener('input', saveIt);
      const now = w.querySelector('[data-ev-now]');
      if (now) now.addEventListener('click', () => {
        Worksheet.addEvidence('workspace', wsNow().getConfig(), 'current');
        Worksheet.show('inquiry');   // 보내기가 [나의 증거] 탭으로 바꾸므로 단계 화면으로 돌아온다
        const list = Worksheet.evidenceList();
        prev.evidence = list.length ? list[list.length - 1].id : '';
        fill(); saveIt();
      });
      const onEv = () => { if (document.body.contains(sel)) fill(); else document.removeEventListener('worksheet:evidence', onEv); };
      document.addEventListener('worksheet:evidence', onEv);
      fill();
    },
  };

  // ── 이벤트 ──
  el('inqModeOn').addEventListener('click', () => setMode(true));
  el('inqModeFree').addEventListener('click', () => setMode(false));
  el('inqPanel').addEventListener('click', e => {
    const p = e.target.closest('[data-path]');
    if (p) { startPath(p.dataset.path); return; }
    const b = e.target.closest('[data-inq]');
    if (!b) return;
    if (b.dataset.inq === 'paths') showPicker();
    else if (b.dataset.inq === 'back') switchTab(b.dataset.tab);   // '○○로 돌아가기' → main.js switchTab → onTab
    else if (b.dataset.inq === 'prev') go(-1);
    else if (b.dataset.inq === 'next') go(1);
  });

  // 새로 고친 뒤: 저장된 응답을 되살리고, 탐구 중이었으면 그 단계로 다시 들어간다
  // 탐구 다시 켜기는 페이지의 스크립트가 모두 읽힌 뒤(DOMContentLoaded)로 미룬다. 여기서 바로 부르면
  // ① setMode → refreshCharts·그래프 플러그인이 아직 초기화 전인 const Inquiry 를 건드려(typeof 도 TDZ에서는 오류) 스크립트가 멈추고
  //   화면이 booting 상태로 가려진 채 열리지 않았고(탐구를 켠 채 새로 고치면 미래 예측 탭이 안 열리던 버그),
  // ② 자연 지구 단계(A4 등)는 뒤에 읽히는 main.js 의 updateLegend3D 를 불러 같은 식으로 멈췄다.
  const saved = load();
  renderLog();
  if (saved && saved.on) {
    const restore = () => setMode(true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore, { once: true });
    else queueMicrotask(restore);
  }

  return { setMode, startPath, go, onTab, state: INQ, view: QV, drawUnder, drawOver, chartEvent, refresh, playEnded, ACTIONS };
})();
