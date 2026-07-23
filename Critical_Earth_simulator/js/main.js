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
    showLiveFormatModal();
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
