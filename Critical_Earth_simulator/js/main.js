// ================= 부트스트랩: 세 탭을 엮고 초기 렌더를 시작 =================
const bundles = { current: sceneCurrent, future: sceneFuture, live: sceneLive };
let activeTab = 'current';

// ── 탭 전환 ──────────────────────────────────────
function switchTab(name) {
  document.getElementById('tab-current').classList.toggle('active', name === 'current');
  document.getElementById('tab-future').classList.toggle('active', name === 'future');
  document.getElementById('tab-live').classList.toggle('active', name === 'live');
  document.getElementById('tab-btn-current').classList.toggle('active', name === 'current');
  document.getElementById('tab-btn-future').classList.toggle('active', name === 'future');
  document.getElementById('tab-btn-live').classList.toggle('active', name === 'live');
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
