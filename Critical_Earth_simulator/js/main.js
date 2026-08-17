// ================= 부트스트랩: 세 탭을 엮고 초기 렌더를 시작 =================
const bundles = { current: sceneCurrent, future: sceneFuture, live: sceneLive };
let activeTab = 'current';

// ── 우측 상단(아크릴 모형 바로 아래) 탭별 제목/설명 ──────────────────
const TAB_HEADERS = {
  current: { title: '현재 실태', desc: '1988~2023 전지구 연간 데이터 (Our World in Data: NOAA / Copernicus-ERA5 / 하와이 HOT-ALOHA / Global Carbon Project)' },
  future: { title: '미래 예측', desc: 'CO₂ 농도를 슬라이더로 바꿔가며 기온편차·해양 pH·아라고나이트 포화도가 어떻게 달라지는지 살펴보세요. 왼쪽 아크릴 모형과 1인칭 탐험 모드에도 같은 값이 반영됩니다.' },
  live: { title: '실시간 실험', desc: '아두이노 등 보드에서 넘어오는 센서 데이터를 실시간 그래프·카드로 표시합니다. "실험 시작"을 누르면 server.py와 연결됩니다.' },
};

// ── 탭 전환 ──────────────────────────────────────
function switchTab(name) {
  document.getElementById('tab-current').classList.toggle('active', name === 'current');
  document.getElementById('tab-future').classList.toggle('active', name === 'future');
  document.getElementById('tab-live').classList.toggle('active', name === 'live');
  document.getElementById('tabHeaderTitle').textContent = TAB_HEADERS[name].title;
  document.getElementById('tabHeaderDesc').textContent = TAB_HEADERS[name].desc;
  activeTab = name;
  if (name === 'future') {
    chart1.resize(); chart2.resize();
    sceneFuture.state.co2 = Number(document.getElementById('co2slider').value);
    applyState(sceneFuture);
  } else if (name === 'live') {
    liveGraphs.forEach(g => g.chart.resize());
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
animate();

// 시작 화면(select.html)의 카드에서 "/?tab=live"처럼 쿼리로 들어오면 그 탭이 바로 열리게 함
const initialTab = new URLSearchParams(location.search).get('tab');
if (initialTab && initialTab in TAB_HEADERS) switchTab(initialTab);

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
