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

  return { CHART_IDS, PRESETS, ACTION_SPEC, stepOrder, validate };
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
  };

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
      enterBaseline();
      if (INQ.pathId && pathById(INQ.pathId)) showStep(); else showPicker();
    } else {
      resetStepView();
      futRestore(INQ.snap);
      INQ.snap = null;
    }
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
    const ctx = { path, step, widgets: el('inqWidgets') };
    for (const a of step.actions || []) {
      const fn = ACTIONS[a.do];
      if (fn) fn(a, ctx);
      else console.warn('탐구: 모르는 동작', a.do);
    }
    renderFuture();
  }

  function go(delta) {
    const n = curOrder().length;
    if (INQ.idx + delta >= n) { showPicker(); return; }   // 마지막 단계에서 [마치기] → 경로 고르기
    INQ.idx = Math.max(0, INQ.idx + delta);
    showStep();
  }

  // ── 동작 ── (TASK_2차_E §2. 이름과 필수 필드는 InquiryCore.ACTION_SPEC)
  const ACTIONS = {};

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

  // 그래프 층 (tab-future.js inquiryLayerPlugin 이 부른다)
  function drawUnder(chart) { }
  function drawOver(chart) { }
  function chartEvent(chart, e) { }

  return { setMode, startPath, go, state: INQ, drawUnder, drawOver, chartEvent, ACTIONS };
})();
