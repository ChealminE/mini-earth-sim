// ============================================================================
// 학습지 패널 (3차 B2) — 현재 실태·미래 예측의 오른쪽 40 % 칸 (#worksheet)
// ----------------------------------------------------------------------------
// 두 탭이 같은 요소를 함께 쓰고 제목만 탭에 맞게 바꾼다. 이 파일은 껍데기만 맡는다: 탭 셋 전환, 접기, 제목.
// 탭 내용은 다른 파일이 id로 채운다 — [탐구] #futureControls(js/inquiry.js·js/tab-future.js),
// [나의 증거] #wsEvidence(3차 C4, 아래), [기록] #recDrawer 측정 기록(js/tab-future.js)·탐구 기록(js/inquiry.js).
// 접으면 44 px 세로 띠로 줄고 왼쪽이 화면 전체를 쓴다(교사가 화면 시연할 때). 칸 크기가 바뀌면
// js/main.js 의 ResizeObserver 가 3D·그래프를 다시 맞춘다.
// ============================================================================
const Worksheet = (() => {
  const $ = id => document.getElementById(id);
  const TABS = { inquiry: 'wsTabInquiry', evidence: 'wsTabEvidence', record: 'wsTabRecord' };
  const tabEls = Object.values(TABS).map($);

  // ── 탭 전환 (WAI-ARIA 탭 패턴: 고른 탭만 Tab 키로 들어오고, 탭 사이는 화살표) ──
  function show(name, focus = false) {
    if (!TABS[name]) return;
    if (isCollapsed()) setCollapsed(false);   // 접힌 채로 [기록 보기] 등을 누르면 펴서 보여 준다
    for (const [k, id] of Object.entries(TABS)) {
      const t = $(id), on = k === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    }
    syncEvidence();
  }
  const nameOf = el => Object.keys(TABS).find(k => TABS[k] === el.id);
  tabEls.forEach(t => t.addEventListener('click', () => show(nameOf(t))));
  $('wsBody').querySelector('[role="tablist"]').addEventListener('keydown', e => {
    const i = tabEls.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabEls.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    show(nameOf(tabEls[(to + tabEls.length) % tabEls.length]), true);
  });

  // ── 접기 ── 상태는 이 브라우저에만 기억한다. 저장이 막힌 환경(file:// 단일 HTML 등)이면 그냥 펼친 채로
  const STORE_KEY = 'worksheet.collapsed';
  const isCollapsed = () => document.body.classList.contains('ws-collapsed');
  function setCollapsed(c) {
    document.body.classList.toggle('ws-collapsed', c);
    $('wsBody').hidden = c;
    $('wsFold').setAttribute('aria-expanded', String(!c));
    $('wsFold').textContent = c ? '펼치기' : '접기';
    try { localStorage.setItem(STORE_KEY, String(c)); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    syncEvidence();
  }
  $('wsFold').addEventListener('click', () => setCollapsed(!isCollapsed()));

  // 탭을 바꿀 때 js/main.js switchTab 이 부른다. paper = 학습지가 보이는 탭(현재 실태·미래 예측)인가
  let pageOn = true;
  function setTitle(tabTitle, paper = true) { $('wsTitle').textContent = `${tabTitle} 학습지`; pageOn = paper; syncEvidence(); }

  // ── 학습지 공용 저장소 (3차 E1) ──
  // localStorage['worksheet.v1'] = { answers: { 경로 id: { saveAs: 응답 } }, evidence: [...], fp: {...}, ui: {...},
  //                                  inquiry: { on, pathId, idx, records } }
  //   answers  탐구 응답(js/inquiry.js) · evidence 나의 증거(아래) · fp 1인칭 야장 현장 기록(3차 E4) · ui 화면 상태 · inquiry 탐구 진행 상태·기록 줄
  // 처음 읽을 때 2차의 'inquiry.v1'이 있으면 한 번 옮겨 담는다. 옛 키는 되돌리기 대비로 지우지 않는다.
  // 모든 읽기·쓰기 try/catch — file:// 단일 HTML 등 저장소가 막힌 환경이면 이번 화면 동안만 메모리에 둔다(마스터 §6-8).
  // 그림(dataURL)은 넣지 않는다(용량 약 5 MB).
  const store = (() => {
    const KEY = 'worksheet.v1', OLD = 'inquiry.v1';
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : {};
    for (const [k, v] of Object.entries({ answers: {}, evidence: [], fp: {}, ui: {}, inquiry: {} })) if (!d[k] || typeof d[k] !== typeof v) d[k] = v;
    if (!d.migratedInquiryV1) {
      try {
        const o = JSON.parse(localStorage.getItem(OLD) || 'null');
        if (o) {
          // 2차 응답은 saveAs → 응답 하나의 평평한 묶음이었다 → 경로별로 나눈다
          for (const [saveAs, r] of Object.entries(o.answers || {})) (d.answers[r.path] = d.answers[r.path] || {})[saveAs] = r;
          d.inquiry = { on: !!o.on, pathId: o.pathId || null, idx: o.idx || 0, records: o.records || [] };
        }
      } catch (e) { /* 옛 기록을 못 읽으면 새로 시작 */ }
      d.migratedInquiryV1 = true;
    }
    // fp 는 1인칭(firstperson/fp-field.js)이 쓰는 몫 — 조감은 읽기만 하므로, 쓰기 전에 저장소의 최신 fp 를 가져와 덮어쓰지 않게 한다
    const save = () => {
      try { const cur = JSON.parse(localStorage.getItem(KEY) || 'null'); if (cur && cur.fp) d.fp = cur.fp; } catch (e) { /* 그대로 */ }
      try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 저장소를 못 쓰면 이번 화면에서만 */ }
    };
    save();
    return { data: d, save };
  })();

  // ── 나의 증거 (3차 C4) ──
  // 그래프 작업대·미래 예측 그래프의 [학습지로 보내기]가 '구성'을 여기에 쌓는다. 저장소 localStorage['worksheet.v1'] = { evidence: [...] }
  // (3차 E1에서 같은 키를 학습지 공용 저장소로 넓힌다). 그림(dataURL)은 저장하지 않는다 — 용량(약 5 MB)이 금방 차서,
  // 구성만 저장하고 카드가 보일 때 다시 그린다(마스터 §6-8). 증거 카드의 Chart.js 는 [나의 증거] 탭이 보일 때만 만들고 떠나면 destroy.
  // 종류마다 그리기는 그 화면 파일이 맡는다: registerEvidenceKind('workspace', …)는 js/tab-current.js, ('future', …)는 js/tab-future.js.
  //   { title(cfg), tags(cfg) → [글], sources(cfg) → [등록부 키], draw(canvas, cfg) → { chart, note? }, open(cfg), csv(cfg) → { series, mode, flips, range } }
  const EV_MAX = 12;
  const kinds = {};
  let evCharts = [], evMsg = '';
  const evidence = store.data.evidence;   // 위 공용 저장소의 배열을 그대로 쓴다(고치면 saveEv)
  const saveEv = () => store.save();
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const changedEv = () => document.dispatchEvent(new CustomEvent('worksheet:evidence'));

  function registerEvidenceKind(kind, handler) { kinds[kind] = handler; syncEvidence(); }
  // 보내기. 12개가 넘으면 자동으로 지우지 않고 안내만 한다
  function addEvidence(kind, cfg, tab) {
    show('evidence');
    if (evidence.length >= EV_MAX) {
      evMsg = `증거는 ${EV_MAX}개까지 모을 수 있어요. 오래된 것부터 지우고 다시 보내 주세요.`;
      syncEvidence(true);
      return false;
    }
    evMsg = '';
    evidence.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, cfg: JSON.parse(JSON.stringify(cfg)), tab, time: new Date().toISOString(), memo: '' });
    saveEv(); changedEv();
    syncEvidence(true);
    return true;
  }
  const visible = () => pageOn && !isCollapsed() && !$('wsPanelEvidence').hidden;
  function destroyCharts() { evCharts.forEach(c => c.destroy()); evCharts = []; }
  // 탭이 보이면 카드를 다시 만들고, 안 보이면 그래프를 부순다
  function syncEvidence(force = false) {
    if (!visible()) { destroyCharts(); return; }
    if (!force && evCharts.length) return;
    renderEvidence();
  }
  function renderEvidence() {
    destroyCharts();
    $('wsEvidenceEmpty').hidden = evidence.length > 0;
    $('wsEvidenceMsg').textContent = evMsg;
    $('wsEvidence').innerHTML = evidence.map((ev, i) => {
      const h = kinds[ev.kind];
      if (!h) return `<li class="ev-card" data-ev="${ev.id}"><p class="ws-empty">${i + 1}. 이 화면에서 그릴 수 없는 증거입니다(${esc(ev.kind)}).</p></li>`;
      const keys = [...new Set(h.sources(ev.cfg))];
      return `<li class="ev-card" data-ev="${ev.id}">
        <div class="ev-head"><b class="ev-title">${i + 1}. ${esc(h.title(ev.cfg))}</b>
          <span class="ev-tags">${h.tags(ev.cfg).map(t => `<span class="ev-tag">${esc(t)}</span>`).join('')}</span></div>
        <div class="ev-chart"><canvas aria-label="증거 ${i + 1} 그래프" role="img"></canvas></div>
        <p class="ev-note readout" hidden></p>
        <p class="ev-src readout">출처: ${keys.map(k => SOURCES[k] ? `${esc(SOURCES[k].label)} · ${esc(SOURCES[k].org)}` : esc(k)).join(' / ')} ${keys.map(k => srcButton(k)).join('')}</p>
        <label class="ev-memo"><span>이 그래프가 보여 주는 것</span><textarea rows="2" data-memo placeholder="한두 문장으로 써 보세요">${esc(ev.memo)}</textarea></label>
        <div class="ev-actions">
          <button class="btn btn--nav btn--sm" type="button" data-ev-act="open">크게 보기</button>
          <button class="btn btn--rec btn--sm" type="button" data-ev-act="png"><span data-icon="download"></span>PNG 내려받기</button>
          <button class="btn btn--rec btn--sm" type="button" data-ev-act="del"><span data-icon="trash"></span>삭제</button>
        </div></li>`;
    }).join('');
    if (typeof Icons !== 'undefined') Icons.fill($('wsEvidence'));
    $('wsEvidence').querySelectorAll('.ev-card').forEach(li => {
      const ev = evidence.find(x => x.id === li.dataset.ev), h = ev && kinds[ev.kind];
      if (!h) return;
      const r = h.draw(li.querySelector('canvas'), ev.cfg);
      evCharts.push(r.chart);
      li.$chart = r.chart;
      if (r.note) { const n = li.querySelector('.ev-note'); n.hidden = false; n.textContent = r.note; }
    });
  }
  let memoTimer = 0;
  $('wsEvidence').addEventListener('input', e => {
    const ta = e.target.closest('[data-memo]');
    if (!ta) return;
    const ev = evidence.find(x => x.id === ta.closest('.ev-card').dataset.ev);
    ev.memo = ta.value;
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => { saveEv(); changedEv(); }, 300);
  });
  $('wsEvidence').addEventListener('click', e => {
    const b = e.target.closest('[data-ev-act]');
    if (!b) return;
    const li = b.closest('.ev-card'), i = evidence.findIndex(x => x.id === li.dataset.ev), ev = evidence[i];
    if (b.dataset.evAct === 'open') kinds[ev.kind].open(ev.cfg);
    else if (b.dataset.evAct === 'png') {
      // 그 순간에만 만든다(저장하지 않음). data: 주소로 바로 내려받으면 브라우저가 파일 이름을 무시해 Blob 으로 바꿔 내려받는다
      fetch(GraphWorkspace.chartImage(li.$chart)).then(r => r.blob()).then(blob => downloadBlob(blob, `증거${i + 1}_${h2(ev.time)}.png`));
    } else if (b.dataset.evAct === 'del') {
      if (!confirm(`증거 ${i + 1}을(를) 지울까요?`)) return;
      evidence.splice(i, 1); evMsg = '';
      saveEv(); changedEv();
      renderEvidence();
    }
  });
  const h2 = iso => iso.slice(0, 16).replace(/[-:T]/g, '');
  // 증거 목록 (탐구 askEvidence 가 고르게 한다, 3차 E2)
  const evidenceList = () => evidence.map((ev, i) => ({ id: ev.id, n: i + 1, kind: ev.kind, cfg: ev.cfg,
    title: kinds[ev.kind] ? kinds[ev.kind].title(ev.cfg) : ev.kind }));
  // 탐구 기록 CSV에 함께 내보낼 증거 줄 (js/inquiry.js). 열: kind, series, mode, flips, range, memo, time
  const EV_COLS = ['kind', 'series', 'mode', 'flips', 'range', 'memo', 'time'];
  function evidenceRows() {
    return evidence.map(ev => ({ kind: ev.kind, ...(kinds[ev.kind] ? kinds[ev.kind].csv(ev.cfg) : {}), memo: ev.memo, time: ev.time }));
  }
  function evidenceCsv(localTime = t => t) {
    const q = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [EV_COLS.join(','), ...evidenceRows().map(r => EV_COLS.map(c => q(c === 'time' ? localTime(r.time) : (r[c] == null ? '' : r[c]))).join(','))].join('\r\n');
  }

  // ── 학습지 카드 (3차 E2) ──
  // 화면에서 내린 보기 기능(B3)을 학습지에서 켜는 자리. 카드 몸통은 원래 요소를 그대로 옮겨 온다(DOM 이동) —
  // 갱신 코드가 id로 찾으므로(예: if (!$('popSpec').hidden) updateSpeciation(...)) 새로 만들면 둘이 어긋난다.
  // 카드가 보이는지는 등록할 때 준 isOpen() 이 정한다(예: 바다 속 탄소 = #popSpec 의 hidden 이 풀렸는가). 그래서 어느 코드가
  // 열고 닫든(그래프 옆 버튼·탐구 동작·카드의 닫기) 카드가 따라간다 — hidden 속성 변화는 MutationObserver 로 본다.
  // 카드 영역 #wsCards 는 자유 조작이면 [탐구] 탭 아래, 탐구 단계 중이면 단계 본문 안(js/inquiry.js placeCards)에 놓인다.
  //   registerCard(id, { title, node, ownHead?, open(), close(), isOpen(), available?(tab) → true | '안 되는 까닭' })
  const cards = {};
  const cardBox = $('wsCards');
  let cardListeners = [];
  function registerCard(id, h) {
    const sec = document.createElement('section');
    sec.className = 'ws-card';
    sec.dataset.card = id;
    sec.hidden = true;
    sec.setAttribute('aria-label', h.title);
    sec.innerHTML = h.ownHead ? '<div class="ws-card-body"></div>'
      : `<div class="ws-card-head"><b>${esc(h.title)}</b><button class="btn btn--view btn--sm" type="button" data-card-close="${id}"><span data-icon="close"></span>닫기</button></div><div class="ws-card-body"></div>`;
    if (typeof Icons !== 'undefined') Icons.fill(sec);
    if (h.node) {
      h.node.removeAttribute('data-ws-moved');   // B3에서 화면에서만 숨겼던 표시를 걷는다(이제 학습지 카드 안)
      sec.querySelector('.ws-card-body').appendChild(h.node);
      new MutationObserver(() => syncCards()).observe(h.node, { attributes: true, attributeFilter: ['hidden'] });
    }
    cardBox.appendChild(sec);
    cards[id] = { sec, h };
    syncCards();
  }
  let page = 'current';
  const usable = id => { const a = cards[id].h.available; return a ? a(page) : true; };
  function openCard(id) {
    const c = cards[id];
    if (!c || usable(id) !== true) return false;
    if ($('wsPanelInquiry').hidden || isCollapsed()) show('inquiry');   // 카드는 [탐구] 탭에 있다
    c.h.open();
    syncCards();
    c.sec.scrollIntoView({ block: 'nearest' });
    return true;
  }
  function closeCard(id) { const c = cards[id]; if (c && c.h.isOpen()) c.h.close(); syncCards(); }
  function toggleCard(id) { const c = cards[id]; if (!c) return; if (c.h.isOpen()) closeCard(id); else openCard(id); }
  const cardOpen = id => !!(cards[id] && cards[id].h.isOpen());
  function syncCards() {
    for (const { sec, h } of Object.values(cards)) sec.hidden = !h.isOpen();
    cardListeners.forEach(fn => fn());
  }
  // 탭을 바꾸면 그 탭에서 못 쓰는 카드는 닫는다 (예: '탄소는 어디로?'는 미래 예측 전용)
  function cardsForTab(tab) {
    page = tab;
    for (const id of Object.keys(cards)) if (usable(id) !== true && cards[id].h.isOpen()) cards[id].h.close();
    for (const { h } of Object.values(cards)) if (h.onTab) h.onTab(tab);
    syncCards();
  }
  cardBox.addEventListener('click', e => { const b = e.target.closest('[data-card-close]'); if (b) closeCard(b.dataset.cardClose); });

  // ── 1인칭 현장 기록 (3차 E4) ── [기록] 탭을 열 때마다 저장소에서 다시 읽는다(1인칭이 다른 화면에서 썼으므로)
  const PRESET_KO = { ssp245: '현재 정책', ssp126: '파리협약 2 °C', ssp119: '1.5 °C 탄소중립', custom: '직접 설계' };
  function renderFp() {
    let fp = {};
    try { fp = (JSON.parse(localStorage.getItem('worksheet.v1') || 'null') || {}).fp || {}; } catch (e) { fp = store.data.fp || {}; }
    const rows = Object.values(fp.tasks || {});
    $('recFp').hidden = !rows.length && !singleFile;
    $('recFpCount').textContent = rows.length;
    $('recFpLog').innerHTML = rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.link)}</td><td>${esc(PRESET_KO[r.scenario] || r.scenario || '')}</td>
      <td>${Object.entries(r.obs || {}).filter(([, v]) => String(v).trim()).map(([y, v]) => `<b>${esc(y)}</b> ${esc(v)}`).join('<br>')}</td><td>${esc(r.diff || '')}</td></tr>`).join('');
    // 단일 HTML 파일(file://)에서는 브라우저에 따라 저장소가 화면마다 갈린다 → 1인칭 기록이 안 보이면 야장 CSV를 쓰라고 알린다
    $('recFpNote').hidden = !(singleFile && !rows.length);
    $('recFpNote').textContent = '단일 파일에서 1인칭 기록이 보이지 않으면 1인칭 야장(F)의 CSV로 내보내 주세요.';
  }
  const singleFile = location.protocol === 'about:' || location.protocol === 'file:';
  $('wsTabRecord').addEventListener('click', renderFp);
  renderFp();

  // 접힘 기억 되살리기는 맨 끝에서: setCollapsed → syncEvidence 가 위의 증거 변수(let·const)를 쓰므로 그 선언 뒤여야 한다
  // (앞에 두면 초기화 전 변수를 건드려 멈춘다 — 3차 B1의 탐구 복원 버그와 같은 종류)
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* 기본값: 펼침 */ }
  if (saved === 'true') setCollapsed(true);

  return { store, show, setTitle, setCollapsed, isCollapsed, registerCard, openCard, closeCard, toggleCard, cardOpen, cardsForTab, syncCards,
    onCards: fn => cardListeners.push(fn), cardUsable: id => (cards[id] ? usable(id) : false), registerEvidenceKind, addEvidence, evidenceRows, evidenceCsv, evidenceList, EV_MAX };
})();
