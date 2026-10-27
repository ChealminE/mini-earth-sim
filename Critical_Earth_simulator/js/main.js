// ================= 부트스트랩: 세 탭을 엮고 초기 렌더를 시작 =================
const bundles = { current: sceneCurrent, future: sceneFuture, live: sceneLive };
let activeTab = 'current';

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
  Worksheet.setTitle(TAB_HEADERS[name].title);   // 학습지 칸은 두 탭이 함께 쓴다 (js/worksheet.js)
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
