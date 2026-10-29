// ================= 부트스트랩: 세 탭을 엮고 초기 렌더를 시작 =================
const bundles = { current: sceneCurrent, future: sceneFuture, live: sceneLive };
let activeTab = 'current';
// 보기 도구 버튼 눌림 표시(파일 끝 3차 E2 절이 채운다). updateLegend3D 가 그보다 먼저 불리므로 선언은 여기 맨 위에 둔다
// (let 을 아래에 두면 초기화 전 이름을 typeof 로 읽어도 오류 — 3차 B1의 탐구 복원 버그와 같은 종류)
let syncTools = null;

// ── 우측 상단(아크릴 모형 바로 아래) 탭별 제목/설명 ──────────────────
const TAB_HEADERS = {
  current: { title: '현재 실태', desc: '관측으로 본 지구의 지금: 대기 CO₂·기온·바다 pH·화석연료 배출 (연평균)' },
  future: { title: '미래 예측', desc: '1750년부터 2200년까지, 사람이 내보낸 탄소가 지구를 어떻게 바꾸는지 재생해 보세요.' },
  live: { title: '직접 실험', desc: '아두이노·ESP32 보드의 센서 값을 실시간으로 받아 기록하고, 실험이 끝나면 정리·분석해 엑셀로 내보냅니다.' },
};

// 라이트(종이) 테마를 쓰는 탭. 직접 실험 탭은 동료가 옮기기 전까지 예전 다크 화면 (docs/테마_이관_가이드.md)
const PAPER_TABS = ['current', 'future'];
// 모형 전체가 가로로 들어오는 종횡비(실측: 1.07에서는 바다 왼쪽 끝이 잘렸다)
const PAPER_CAM_FIT = 1.4;
// 3차 B1: 3D 칸이 넓고 낮아져(1280×720에서 768×220) 세로 38°로는 받침대 아래가 잘린다. 실측: 46°에서 받침대가 겨우 다 들어와 여유를 둔다
const PAPER_MIN_FOV = 48;

// ── 탭 전환 ──────────────────────────────────────
function switchTab(name) {
  ensureSceneBuilt(bundles[name]); // 처음 여는 화면이면 이제 아크릴을 만든다 (common.js sceneFor)
  document.getElementById('tab-current').classList.toggle('active', name === 'current');
  document.getElementById('tab-future').classList.toggle('active', name === 'future');
  document.getElementById('tab-live').classList.toggle('active', name === 'live');
  document.getElementById('tabHeaderTitle').textContent = TAB_HEADERS[name].title;
  document.getElementById('tabHeaderDesc').textContent = TAB_HEADERS[name].desc;
  document.getElementById('topbarDesc').textContent = TAB_HEADERS[name].desc;
  Worksheet.setTitle(TAB_HEADERS[name].title, PAPER_TABS.includes(name));   // 학습지 칸은 두 탭이 함께 쓴다 (js/worksheet.js)
  if (PAPER_TABS.includes(name)) Worksheet.cardsForTab(name);   // 그 탭에서 못 쓰는 학습지 카드는 닫고, 바다 속 탄소는 그 탭 값으로
  // 머리줄 탭 버튼: 지금 탭은 눌림 상태로 (css/theme.css .btn.is-on)
  document.querySelectorAll('#topbar [data-tab-go]').forEach(a => {
    const on = a.dataset.tabGo === name;
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // 종이(라이트) 테마는 현재 실태·미래 예측만. 직접 실험 탭은 동료가 옮기기 전까지 예전 다크 화면 그대로 둔다
  // (docs/테마_이관_가이드.md). tab-<이름> 클래스로 탭별 배치를 고른다(css/paper.css).
  const paper = PAPER_TABS.includes(name);
  for (const t of Object.keys(TAB_HEADERS)) document.body.classList.toggle('tab-' + t, t === name);
  document.body.classList.toggle('paper', paper);
  setSceneBackdrop(paper ? Theme.hex('--paper') : LIVE_BACKDROP);
  // 종이 테마 화면은 3D 칸이 세로로 길 수 있다 - 모형 전체(물·숲·도시)가 가로로 들어오게 (common.js)
  setCameraFit(paper ? PAPER_CAM_FIT : null, paper ? PAPER_MIN_FOV : undefined);
  // 직접 실험 탭은 아크릴을 화면 가득 두고 그 위에 띄운다: 처음엔 '실험 준비'(body.live-setup),
  // 실험을 시작하면 '실험 화면'(body.live-run) - js/live-setup.js가 전환
  if (name !== 'live') document.body.classList.remove('live-setup', 'live-run');
  activeTab = name;
  if (typeof Inquiry !== 'undefined' && Inquiry) Inquiry.onTab(name);   // 탐구 경로는 탭마다 다르다 (3차 E1, js/inquiry.js)
  if (IRScope) IRScope.onTab(name);   // 적외선 보기(3차 F): 위에서 종이색으로 칠한 3D 바탕을 켬 상태에 맞춘다 (js/ir-scope.js)
  fitRenderer();   // 탭에 따라 3D 칸 크기가 달라진다
  if (name === 'future') {
    activateFutureTab();   // 그래프 크기 맞추기 + 재생 연도의 엔진 값을 3D에 반영 (js/tab-future.js)
  } else if (name === 'live') {
    activateLiveTab();
    liveGraphs.forEach(g => g.chart.resize());
    resizeAnalysisChart();
    applyState(sceneLive);
  } else {
    resizeCurrentGraphs();   // 그래프 작업대(3차 C3) 또는 예전 그래프 4개 (js/tab-current.js)
    sceneCurrent.state.co2 = lastOf(obsCo2).y; // 마지막 완전한 해의 NOAA 지구 평균
    applyState(sceneCurrent);
  }
}

Icons.fill();   // 마크업의 <span data-icon="…"> 자리에 아이콘 채우기 (js/icons.js)
applyState(sceneCurrent);
applyState(sceneFuture);
applyState(sceneLive);
fitRenderer();

// 시작 화면(select.html)의 카드에서 "/?tab=live"처럼 쿼리로 들어오면 그 탭이 바로 열리게 함.
// animate()가 첫 프레임부터 지금 탭의 아크릴을 그리므로, 아직 안 만든 기본 탭(현재 실태)을 그리지 않게 탭을 먼저 정한다.
const initialTab = new URLSearchParams(location.search).get('tab');
// 처음 화면도 switchTab을 거쳐야 body 클래스(종이 테마·탭 배치)와 머리줄 표시가 정해진다
switchTab(initialTab && initialTab in TAB_HEADERS ? initialTab : activeTab);
animate();
document.documentElement.classList.remove('booting'); // 화면이 정해졌으니 보이기 (index.html 머리의 booting 참고)

window.addEventListener('resize', fitRenderer);
// 3차 B1: 3D 칸·그래프 칸 크기는 창 크기만이 아니라 학습지 접기(B2)로도 바뀐다. 창 resize 이벤트로는 그걸 못 잡으므로
// 칸 자체를 지켜본다. 직접 실험 탭 그래프는 예전처럼 Chart.js 자체 반응형에 맡긴다(범위 밖).
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => fitRenderer()).observe(glContainer);
  new ResizeObserver(() => {
    if (activeTab === 'current') resizeCurrentGraphs();
    else if (activeTab === 'future') [...charts, futChartSink].forEach(c => c.resize());
  }).observe(document.getElementById('graph-panel'));
}

// ── 3D 보기 토글 (2차 개편 D, 종이 탭) ─────────────────────────────
// 값은 common.js VIEW3D 하나에 둔다. 지금 그리는 씬에 바로 반영하고, 다른 씬은 다음 applyState(탭 전환·0.2초 틱)에서 따라온다.
function bindView3D(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    VIEW3D[key] = !VIEW3D[key];
    btn.setAttribute('aria-pressed', String(VIEW3D[key]));
    applyState(bundles[activeTab]);
    updateLegend3D();
    // 지시약 색은 범례 없이 읽을 수 없다 → 켜면 학습지 3D 범례 카드를 함께 연다 (3차 E2)
    if (key === 'indicator' && VIEW3D.indicator) Worksheet.openCard('legend3d');
  });
}
bindView3D('view3dCo2', 'co2');
bindView3D('view3dIndicator', 'indicator');

// ── 3D 범례 (2차 개편 D7) ─────────────────────────────────────────
// 보기 토글이 켜졌는지에 따라 줄 문구를 바꾸고(.on), 자연 지구를 보는 동안에는 도시 줄을 숨긴다.
// tab-future.js setNatureView 도 부른다(이 파일이 맨 뒤에 읽히므로 실행 시점에는 있다).
function updateLegend3D() {
  const lg = document.getElementById('legend3d');
  lg.querySelector('[data-row="co2"]').classList.toggle('on', VIEW3D.co2);
  lg.querySelector('[data-row="sea"]').classList.toggle('on', VIEW3D.indicator);
  lg.querySelector('[data-row="city"]').hidden = activeTab === 'future' && typeof FUT !== 'undefined' && FUT.showNature;
  if (syncTools) syncTools();   // 보기 도구 버튼의 눌림 표시 (아래, 3차 E2)
}
{
  // 색 막대: 7.6 = 0 %, 8.2 = 100 %
  const P = EarthVisual.PH_IND, pct = v => (100 * (v - P.MIN) / (P.MAX - P.MIN)).toFixed(1) + '%';
  document.getElementById('legend3dBar').style.background =
    `linear-gradient(to right, ${P.STOPS.map(([v, c]) => `${c} ${pct(v)}`).join(', ')})`;
  // 접기: 3D를 가리지 않게 접어 둘 수 있다. 접은 상태는 이 브라우저에만 기억한다(저장이 막힌 환경이면 그냥 펼친 채로)
  const lg = document.getElementById('legend3d'), btn = document.getElementById('legend3dToggle');
  const setCollapsed = c => {
    lg.dataset.collapsed = String(c);
    btn.setAttribute('aria-expanded', String(!c));
    btn.textContent = c ? '펼치기' : '접기';
  };
  let saved = null;
  try { saved = localStorage.getItem('legend3dCollapsed'); } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
  setCollapsed(saved === 'true');
  btn.addEventListener('click', () => {
    const c = lg.dataset.collapsed !== 'true';
    setCollapsed(c);
    try { localStorage.setItem('legend3dCollapsed', String(c)); } catch (e) { /* 무시 */ }
  });
  updateLegend3D();
}

// 밝기 슬라이더는 없앴다(2차 F2): 종이 테마에서는 노출을 common.js 의 1.1로 고정해 화면마다 같은 색으로 보이게 한다.
// localStorage 'brightnessExposure' 는 1인칭이 같이 쓰는 키라 여기서 읽지도 지우지도 않는다.

// ── 학습지 카드 · 보기 도구 (3차 E2) ─────────────────────────────────
// B3에서 화면에서 내린 여섯 기능을 학습지에서 켠다. 카드 몸통은 원래 요소를 옮겨 와 갱신 코드가 그대로 돈다(js/worksheet.js registerCard).
// 이 파일이 맨 뒤에 읽혀 세 탭의 함수(setPopover·setOmegaView·setNatureView·updateSpeciation·currentWorkspace …)를 모두 부를 수 있어 여기에 둔다.
{
  const $ = id => document.getElementById(id);
  const ONLY_FUTURE = '미래 예측 화면에서 볼 수 있어요';
  // 3D 범례: 정보 표시만. 학습지 카드 안에서는 늘 펼친 채로
  let legendOpen = false;
  Worksheet.registerCard('legend3d', { title: '3D 범례 — 3D의 무엇이 무엇을 나타내나', node: $('legend3d'),
    open: () => { legendOpen = true; }, close: () => { legendOpen = false; }, isOpen: () => legendOpen });
  // 바다 속 탄소: 미래 예측은 재생 연도의 값(renderFuture 가 갱신), 현재 실태는 엔진 역사 실행의 마지막 관측 연도(2023) 상태
  const specCurrent = () => { const h = DataSeries.history(); updateSpeciation(h[h.length - 1], h[0]); };
  Worksheet.registerCard('spec', { title: '바다 속 탄소', node: $('popSpec'), ownHead: true,
    open: () => { setPopover('popSpec'); if (activeTab === 'current') specCurrent(); },
    close: () => setPopover(null), isOpen: () => !$('popSpec').hidden,
    onTab: tab => { if (!$('popSpec').hidden && tab === 'current') specCurrent(); } });
  // 탄소는 어디로?: 그래프 옆 버튼도 그대로(같은 요소가 학습지 카드 한 곳에만 보인다). 미래 예측 궤적의 누적값이라 미래 예측 전용
  Worksheet.registerCard('sink', { title: '탄소는 어디로?', node: $('popSink'), ownHead: true,
    open: () => setPopover('popSink'), close: () => setPopover(null), isOpen: () => !$('popSink').hidden,
    available: tab => tab === 'future' || ONLY_FUTURE });
  // Ω 함께 보기: 미래 예측 = pH 그래프에 Ω(모형)를 겹친다(setOmegaView), 현재 실태 = 작업대에 Ω(모형) 카드를 넣는 버튼
  const om = document.createElement('div');
  om.className = 'ws-omega';
  om.innerHTML = `<p class="ws-card-text">Ω(아라고나이트 포화도)는 조개·산호가 탄산칼슘 껍데기를 만들기 쉬운 정도입니다.
      <b>1보다 작으면 껍데기가 녹기 시작합니다.</b> 값은 이 프로그램의 모형이 계산한 전 지구 평균 표층 바다입니다. ${srcButton('model_omega')}</p>
    <p class="ws-card-text future-only-text">미래 예측의 <b>해수 pH 그래프</b>에 Ω를 함께 그렸습니다(오른쪽 축).</p>
    <button class="btn btn--view btn--sm current-only-btn" type="button" data-omega-ws><span data-icon="lines"></span>작업대에 Ω(모형) 넣기</button>`;
  let omegaCur = false;
  Worksheet.registerCard('omega', { title: 'Ω 함께 보기 — 조개·산호 껍데기', node: om,
    open: () => { if (activeTab === 'future') setOmegaView(true); else omegaCur = true; },
    close: () => { if (VIEW.omega) setOmegaView(false); omegaCur = false; },
    isOpen: () => (activeTab === 'future' ? VIEW.omega : omegaCur),
    onTab: tab => { om.dataset.tab = tab; } });
  om.addEventListener('click', e => { if (e.target.closest('[data-omega-ws]') && currentWorkspace) currentWorkspace.add('omega'); });
  // 영향 카드(탐구 경로 C): 3D 위에 겹치던 것을 학습지로. 내용은 js/inquiry.js showCards 가 채운다
  Worksheet.registerCard('impacts', { title: '기온 수준별 영향', node: $('inqCards'), ownHead: true,
    open: () => { $('inqCards').hidden = !$('inqCards').innerHTML.trim(); }, close: () => { $('inqCards').hidden = true; },
    isOpen: () => !$('inqCards').hidden, available: tab => tab === 'future' || ONLY_FUTURE });
  // 카드 안의 닫기 버튼(팝오버 머리의 [닫기])
  $('wsCards').addEventListener('click', e => { if (e.target.closest('.fut-pop-close')) setPopover(null); });

  // 보기 도구 여섯 개: 자유 조작에서도 기능에 닿을 수 있게 ([탐구] 탭, 경로 밖)
  const TOOLS = [
    { id: 'legend3d', label: '3D 범례', icon: 'list', on: () => Worksheet.cardOpen('legend3d'), act: () => Worksheet.toggleCard('legend3d') },
    { id: 'nature', label: '자연만 있는 지구', icon: 'leaf', only: 'future', on: () => activeTab === 'future' && FUT.showNature, act: () => setNatureView(!FUT.showNature) },
    { id: 'co2', label: 'CO₂ 보기', icon: 'dots', on: () => VIEW3D.co2, act: () => $('view3dCo2').click() },
    { id: 'indicator', label: '지시약으로 보기', icon: 'drop', on: () => VIEW3D.indicator, act: () => $('view3dIndicator').click() },
    { id: 'omega', label: 'Ω 함께 보기', icon: 'shell', on: () => Worksheet.cardOpen('omega'), act: () => Worksheet.toggleCard('omega') },
    { id: 'spec', label: '바다 속 탄소', icon: 'flask', on: () => Worksheet.cardOpen('spec'), act: () => Worksheet.toggleCard('spec') },
  ];
  $('wsTools').innerHTML = TOOLS.map(t => `<button class="btn btn--view btn--sm" type="button" data-tool="${t.id}" aria-pressed="false">
    <span data-icon="${t.icon}"></span>${t.label}</button>`).join('');
  Icons.fill($('wsTools'));
  $('wsTools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b && !b.disabled) TOOLS.find(t => t.id === b.dataset.tool).act(); });
  syncTools = () => {
    for (const t of TOOLS) {
      const b = $('wsTools').querySelector(`[data-tool="${t.id}"]`);
      const off = t.only && t.only !== activeTab;
      b.disabled = !!off;
      b.title = off ? ONLY_FUTURE : '';
      b.setAttribute('aria-pressed', String(!off && !!t.on()));
    }
  };
  Worksheet.onCards(syncTools);
  Worksheet.cardsForTab(activeTab);
}

// ── [1인칭으로] (3차 E4): 지금 보고 있는 배출 경로·연도로 1인칭을 연다 ──
// 미래 예측 = 고른 시나리오와 재생 연도, 현재 실태 = 엔진이 실제 배출로 계산하는 마지막 해(EarthSystem.LAST_HIST_YEAR).
// 1인칭은 같은 엔진으로 그 해의 전 지구 CO₂를 다시 계산한다(firstperson/fp-main.js FPScenario). 주소는 누르는 순간 만든다.
function firstPersonQuery() {
  const q = new URLSearchParams();
  if (activeTab === 'future') {
    q.set('scenario', FUT.preset);
    if (FUT.preset === 'custom') q.set('levers', JSON.stringify(FUT.levers));
    q.set('year', String(Math.round(FUT.year)));
  } else q.set('year', String(EarthSystem.LAST_HIST_YEAR));
  return '?' + q.toString();
}
{
  const a = document.getElementById('fpGo');
  const fill = () => { a.href = '/firstperson/' + firstPersonQuery(); };
  ['pointerdown', 'focus', 'mouseenter'].forEach(ev => a.addEventListener(ev, fill));
  fill();
}
