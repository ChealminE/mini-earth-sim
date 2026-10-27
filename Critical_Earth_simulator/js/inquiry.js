// ============================================================================
// 탐구 모드 — 단계 실행기 (2차 개편 E)
// ----------------------------------------------------------------------------
// 미래 예측 탭 왼쪽 패널 맨 위의 [탐구 | 자유 조작] 전환. 탐구를 켜면 왼쪽 패널이 경로 선택 → 단계 안내로 바뀌고,
// 끄면 자유 조작 패널로 돌아오며 화면 상태(시나리오·레버·재생 위치·토글)를 켜기 전으로 되돌린다.
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
  };

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

  // 단계 데이터 검사. ctx = { markers, impacts, sources } (출처 키 확인용, 없으면 건너뜀)
  function validate(paths, ctx = {}) {
    const errs = [], saveAs = new Map();
    const pathIds = new Set();
    for (const p of paths) {
      const where = `경로 ${p.id}`;
      if (!p.id || !p.title) errs.push(`${where}: id·title 필요`);
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
          for (const c of [].concat(a.charts || [], a.chart || [])) if (!CHART_IDS[c]) errs.push(`${w}: 모르는 그래프 "${c}"`);
          if (a.saveAs) {
            if (saveAs.has(a.saveAs)) errs.push(`${w}: saveAs "${a.saveAs}" 가 ${saveAs.get(a.saveAs)} 와 겹침`);
            saveAs.set(a.saveAs, w);
          }
          if (a.do === 'setScenario' && !a.wait && !PRESETS.includes(a.preset)) errs.push(`${w}: setScenario preset은 ${PRESETS.join('|')} 또는 wait: true`);
          if (a.do === 'revealMarkers' && ctx.markers) for (const m of a.markers) if (!ctx.markers[m]) errs.push(`${w}: 사건 표지 "${m}" 없음`);
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

  return { CHART_IDS, PRESETS, ACTION_SPEC, stepOrder, validate, LOG_COLS, logRows, toCsv, localTime };
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
    snap: null,       // 탐구를 켜기 직전의 자유 조작 상태 (tab-future.js futSnapshot)
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
  };
  const chartByKey = k => charts.find(c => c.canvas.id === InquiryCore.CHART_IDS[k]);
  const keyOfChart = ch => Object.keys(InquiryCore.CHART_IDS).find(k => InquiryCore.CHART_IDS[k] === ch.canvas.id);

  const pathById = id => INQUIRY_PATHS.find(p => p.id === id);
  const curPath = () => pathById(INQ.pathId);
  const curOrder = () => InquiryCore.stepOrder(curPath());

  // ── 전환 [탐구 | 자유 조작] ──
  function setMode(on) {
    if (on === INQ.on) return;
    INQ.on = on;
    el('inqModeOn').setAttribute('aria-pressed', String(on));
    el('inqModeFree').setAttribute('aria-pressed', String(!on));
    el('fcFree').hidden = on;
    el('inqPanel').hidden = !on;
    document.body.classList.toggle('inq-on', on);
    if (on) {
      INQ.snap = futSnapshot();
      INQ.cam = getCameraView();
      enterBaseline();
      if (INQ.pathId && pathById(INQ.pathId)) showStep(); else showPicker();
    } else {
      resetStepView();
      futRestore(INQ.snap);
      setCameraView(INQ.cam);
      INQ.snap = INQ.cam = null;
    }
    save();
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
    save();
    resetStepView();
    const box = el('inqPanel');
    box.innerHTML = `<h3 class="fc-h">탐구 <span>질문을 따라가며 알아보기</span></h3>
      <div class="inq-paths" role="list">${INQUIRY_PATHS.map(p => `
        <button class="btn btn--nav btn--stack inq-path-btn" type="button" role="listitem" data-path="${esc(p.id)}">
          <span class="inq-path-name">${esc(p.id)}. ${esc(p.title)}</span>
          <span class="btn-sub">${esc(p.summary || '')} · ${InquiryCore.stepOrder(p).length}단계</span></button>`).join('')}
      </div>`;
  }

  function startPath(id) {
    INQ.pathId = id;
    INQ.idx = 0;
    showStep();
  }

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
    QV.play = null;
    setPopover(null);
    if (VIEW.omega) setOmegaView(false);
    if (VIEW.validate) setValidateView(false);
    if (FUT.showNature) setNatureView(false);
    if (QV.focused) { setCameraView(CAM_TARGETS.overview); QV.focused = false; }
    el('inqCards').hidden = true;
  }

  function showStep() {
    const order = curOrder();
    INQ.idx = Math.max(0, Math.min(order.length - 1, INQ.idx));
    const step = order[INQ.idx], path = curPath(), n = order.length;
    resetStepView();
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
  const STORE_KEY = 'inquiry.v1';
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ on: INQ.on, pathId: INQ.pathId, idx: INQ.idx, answers: INQ.answers, records: INQ.records }));
    } catch (e) { /* 저장소를 못 쓰는 환경 */ }
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!d) return null;
      INQ.answers = d.answers || {};
      INQ.records = d.records || [];
      if (d.pathId && pathById(d.pathId)) { INQ.pathId = d.pathId; INQ.idx = d.idx || 0; }
      return d;
    } catch (e) { return null; }
  }
  let logTimer = 0;
  function logChanged() {   // 글자를 칠 때마다 표를 다시 그리지 않게 0.3초 모아서
    clearTimeout(logTimer);
    logTimer = setTimeout(() => { renderLog(); save(); }, 300);
  }
  function renderLog() {
    const rows = InquiryCore.logRows(INQ.answers, INQ.records);
    el('recInq').hidden = rows.length === 0;
    el('inqLogCount').textContent = rows.length;
    el('inqLog').innerHTML = rows.map(r => `<tr><td>${esc(r.path)}</td><td>${esc(r.step)}</td><td>${esc(r.question)}</td>`
      + `<td>${esc(r.answer)}</td><td>${esc(r.year)}</td><td>${esc(r.value)}</td></tr>`).join('');
  }
  el('inqCsv').addEventListener('click', () => {
    const rows = InquiryCore.logRows(INQ.answers, INQ.records);
    if (!rows.length) return;
    // BOM: 엑셀에서 한글이 깨지지 않게 (측정 기록 CSV와 같은 방식)
    downloadBlob(new Blob(['\ufeff' + InquiryCore.toCsv(rows)], { type: 'text/csv;charset=utf-8;' }), `미래예측_탐구기록_${fileStamp()}.csv`);
  });
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
  function applyChartLayout() {
    const rows = ['auto'];
    for (const k of Object.keys(InquiryCore.CHART_IDS)) {
      const show = !QV.charts || QV.charts.includes(k);
      el(InquiryCore.CHART_IDS[k]).closest('.chart-block').classList.toggle('inq-fold', !show);
      rows.push(show ? 'minmax(0, 1fr)' : 'auto');
    }
    el('futCharts').style.gridTemplateRows = QV.charts ? rows.join(' ') : '';
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
    const year = Math.round(Math.max(LIMIT.from, Math.min(LIMIT.to, chart.scales.x.getValueForPixel(e.x))));
    const r = valueAt(chart.$spec, year);
    if (!r) return;   // 아직 예측하지 않은 해
    const spec = chart.$spec;
    setAnswer(QV.pick.saveAs, { question: QV.pick.question, chart: QV.pick.chart, year, value: Number(r.v.toFixed(4)),
      answer: `${year}년 (${spec.fmt(r.v)}, ${r.tag})` });
    showPick();
    drawCharts();
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
  // 3D 위에 뜬다(그래프·왼쪽 패널을 가리지 않고 스크롤도 만들지 않는다). 카드 내용은 INQUIRY_IMPACTS.
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
      chartByKey(a.chart).canvas.style.cursor = 'crosshair';
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
      drawCharts();
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
    openPopover(a) { setPopover({ sink: 'popSink', spec: 'popSpec' }[a.id] || a.id); },
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
    else if (b.dataset.inq === 'prev') go(-1);
    else if (b.dataset.inq === 'next') go(1);
  });

  // 새로 고친 뒤: 저장된 응답을 되살리고, 탐구 중이었으면 그 단계로 다시 들어간다.
  // 이 함수 안(Inquiry 를 만드는 도중)에서 부르면 안 된다 — 아래 resume 참고.
  function resume() {
    const saved = load();
    renderLog();
    if (saved && saved.on) setMode(true);
  }

  return { setMode, startPath, go, state: INQ, view: QV, drawUnder, drawOver, chartEvent, refresh, playEnded, resume, ACTIONS };
})();
// 되살리기는 Inquiry 가 다 만들어진 뒤에 한다. 단계에 들어가면 tab-future.js 가 그래프를 다시 그리며 Inquiry 를 찾는데,
// const 가 초기화되기 전에는 typeof Inquiry 조차 ReferenceError 를 던진다(TDZ). 예전에는 그 오류로 Inquiry 가 끝내
// 만들어지지 않아, 탐구를 켠 채 닫았다가 다시 열면 그래프·시나리오가 비고 단일 HTML은 '불러오는 중…'에서 멈췄다.
if (Inquiry) Inquiry.resume();
