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

  // ── 나의 증거 (3차 C4) ──
  // 그래프 작업대·미래 예측 그래프의 [학습지로 보내기]가 '구성'을 여기에 쌓는다. 저장소 localStorage['worksheet.v1'] = { evidence: [...] }
  // (3차 E1에서 같은 키를 학습지 공용 저장소로 넓힌다). 그림(dataURL)은 저장하지 않는다 — 용량(약 5 MB)이 금방 차서,
  // 구성만 저장하고 카드가 보일 때 다시 그린다(마스터 §6-8). 증거 카드의 Chart.js 는 [나의 증거] 탭이 보일 때만 만들고 떠나면 destroy.
  // 종류마다 그리기는 그 화면 파일이 맡는다: registerEvidenceKind('workspace', …)는 js/tab-current.js, ('future', …)는 js/tab-future.js.
  //   { title(cfg), tags(cfg) → [글], sources(cfg) → [등록부 키], draw(canvas, cfg) → { chart, note? }, open(cfg), csv(cfg) → { series, mode, flips, range } }
  const EV_KEY = 'worksheet.v1', EV_MAX = 12;
  const kinds = {};
  let evidence = [], evCharts = [], evMsg = '';
  try { evidence = (JSON.parse(localStorage.getItem(EV_KEY) || 'null') || {}).evidence || []; } catch (e) { evidence = []; }
  const saveEv = () => { try { localStorage.setItem(EV_KEY, JSON.stringify({ evidence })); } catch (e) { /* 저장소를 못 쓰면 이번 화면에서만 */ } };
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
  // 탐구 기록 CSV에 함께 내보낼 증거 줄 (js/inquiry.js). 열: kind, series, mode, flips, range, memo, time
  const EV_COLS = ['kind', 'series', 'mode', 'flips', 'range', 'memo', 'time'];
  function evidenceRows() {
    return evidence.map(ev => ({ kind: ev.kind, ...(kinds[ev.kind] ? kinds[ev.kind].csv(ev.cfg) : {}), memo: ev.memo, time: ev.time }));
  }
  function evidenceCsv(localTime = t => t) {
    const q = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [EV_COLS.join(','), ...evidenceRows().map(r => EV_COLS.map(c => q(c === 'time' ? localTime(r.time) : (r[c] == null ? '' : r[c]))).join(','))].join('\r\n');
  }

  // 접힘 기억 되살리기는 맨 끝에서: setCollapsed → syncEvidence 가 위의 증거 변수(let·const)를 쓰므로 그 선언 뒤여야 한다
  // (앞에 두면 초기화 전 변수를 건드려 멈춘다 — 3차 B1의 탐구 복원 버그와 같은 종류)
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* 기본값: 펼침 */ }
  if (saved === 'true') setCollapsed(true);

  return { show, setTitle, setCollapsed, isCollapsed, registerEvidenceKind, addEvidence, evidenceRows, evidenceCsv, EV_MAX };
})();
