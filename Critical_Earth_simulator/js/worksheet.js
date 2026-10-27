// ============================================================================
// 학습지 패널 (3차 B2) — 현재 실태·미래 예측의 오른쪽 40 % 칸 (#worksheet)
// ----------------------------------------------------------------------------
// 두 탭이 같은 요소를 함께 쓰고 제목만 탭에 맞게 바꾼다. 이 파일은 껍데기만 맡는다: 탭 셋 전환, 접기, 제목.
// 탭 내용은 다른 파일이 id로 채운다 — [탐구] #futureControls(js/inquiry.js·js/tab-future.js),
// [나의 증거] #wsEvidence(3차 C4), [기록] #recDrawer 측정 기록(js/tab-future.js)·탐구 기록(js/inquiry.js).
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
  }
  $('wsFold').addEventListener('click', () => setCollapsed(!isCollapsed()));
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* 기본값: 펼침 */ }
  if (saved === 'true') setCollapsed(true);

  // 탭을 바꿀 때 js/main.js switchTab 이 부른다
  function setTitle(tabTitle) { $('wsTitle').textContent = `${tabTitle} 학습지`; }

  return { show, setTitle, setCollapsed, isCollapsed };
})();
