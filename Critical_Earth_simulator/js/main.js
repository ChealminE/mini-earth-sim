// ================= 부트스트랩: 세 탭을 엮고 초기 렌더를 시작 =================
const bundles = { current: sceneCurrent, future: sceneFuture, live: sceneLive };
let activeTab = 'current';

// ── 우측 상단(아크릴 모형 바로 아래) 탭별 제목/설명 ──────────────────
const TAB_HEADERS = {
  current: { title: '현재 실태', desc: '1988~2023 전지구 연간 데이터 (Our World in Data: NOAA / Copernicus-ERA5 / 하와이 HOT-ALOHA / Global Carbon Project)' },
  future: { title: '미래 예측', desc: '1750년부터 2200년까지, 사람이 내보낸 탄소가 대기·바다·토양으로 나뉘며 CO₂·기온·해수 pH가 어떻게 변하는지 재생해 보세요.' },
  live: { title: '직접 실험', desc: '아두이노·ESP32 보드의 센서 값을 실시간으로 받아 기록하고, 실험이 끝나면 정리·분석해 엑셀로 내보냅니다.' },
};

// ── 탭 전환 ──────────────────────────────────────
function switchTab(name) {
  ensureSceneBuilt(bundles[name]); // 처음 여는 화면이면 이제 아크릴을 만든다 (common.js sceneFor)
  document.getElementById('tab-current').classList.toggle('active', name === 'current');
  document.getElementById('tab-future').classList.toggle('active', name === 'future');
  document.getElementById('tab-live').classList.toggle('active', name === 'live');
  document.getElementById('tabHeaderTitle').textContent = TAB_HEADERS[name].title;
  document.getElementById('tabHeaderDesc').textContent = TAB_HEADERS[name].desc;
  // 직접 실험 탭은 아크릴을 화면 가득 두고 그 위에 띄운다: 처음엔 '실험 준비'(body.live-setup),
  // 실험을 시작하면 '실험 화면'(body.live-run) - js/live-setup.js가 전환
  if (name !== 'live') document.body.classList.remove('live-setup', 'live-run');
  // 미래 예측 탭은 두 지구를 좌우로 그리려고 3D 칸을 화면 위쪽 전체 폭으로 바꾼다 (style.css body.tab-future)
  document.body.classList.toggle('tab-future', name === 'future');
  if (name === 'future') ensureSceneBuilt(sceneNature);
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
    chartCo2.resize(); chartTempHist.resize(); chartPhHist.resize(); chartFossil.resize();
    sceneCurrent.state.co2 = histCo2[histCo2.length - 1]; // 2023 실측값
    applyState(sceneCurrent);
  }
}

applyState(sceneCurrent);
applyState(sceneFuture);
applyState(sceneLive);
fitRenderer();

// 시작 화면(select.html)의 카드에서 "/?tab=live"처럼 쿼리로 들어오면 그 탭이 바로 열리게 함.
// animate()가 첫 프레임부터 지금 탭의 아크릴을 그리므로, 아직 안 만든 기본 탭(현재 실태)을 그리지 않게 탭을 먼저 정한다.
const initialTab = new URLSearchParams(location.search).get('tab');
if (initialTab && initialTab in TAB_HEADERS) switchTab(initialTab);
else ensureSceneBuilt(bundles[activeTab]);
animate();
document.documentElement.classList.remove('booting'); // 화면이 정해졌으니 보이기 (index.html 머리의 booting 참고)

window.addEventListener('resize', fitRenderer);

// ── 밝기 슬라이더 ──────────────────────────────────
// 같은 씬이라도 화면 밝기·명암비에 따라 톤매핑 결과가 다르게 보여서(어두운 패널일수록
// 새까맣게 보임), 화면마다 사용자가 직접 노출값을 보정할 수 있게 슬라이더로 노출
const brightnessSlider = document.getElementById('brightnessSlider');
const savedExposure = Number(localStorage.getItem('brightnessExposure'));
if (savedExposure) {
  renderer.toneMappingExposure = savedExposure;
  brightnessSlider.value = savedExposure;
}
brightnessSlider.addEventListener('input', () => {
  const exposure = Number(brightnessSlider.value);
  renderer.toneMappingExposure = exposure;
  localStorage.setItem('brightnessExposure', exposure);
});
