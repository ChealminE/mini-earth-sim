// ================= 현재 실태 탭 =================
const sceneCurrent = sceneFor('current'); // 이 화면을 열었을 때만 실제로 만듦 (common.js sceneFor)

// ── CO2 시뮬레이터 실측 데이터 (1988~2023) ──────────────────────
const years = [1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023];
const histCo2 = [350.06,352.12,353.48,354.85,355.76,356.46,357.61,359.28,361.20,362.49,364.33,367.01,368.42,369.80,371.61,373.99,376.21,377.97,380.23,382.05,384.10,385.83,387.62,389.82,391.67,394.14,396.49,398.55,401.48,404.31,406.50,408.89,411.39,413.65,416.02,418.24];
// histTemp 기준 기간 미확인: 1991~2020 평년 기준이라고 적혀 왔지만, Copernicus ERA5의 2023년 전 지구 값은
// 1991~2020 대비 +0.60 °C라 여기 2023년 0.837과 맞지 않는다(1988→2023 폭 1.21 °C도 전 지구 평균치고 크다).
// 육지만의 값이거나 다른 자료일 수 있다. 출처를 확인하기 전까지 모형 기온선은 이 그래프에 겹치지 않는다.
const histTemp = [-0.369,-0.433,-0.161,-0.490,-0.591,-0.576,-0.279,-0.271,-0.575,-0.329,0.078,-0.176,-0.212,-0.136,0.040,-0.028,-0.091,-0.009,0.029,0.130,-0.032,0.085,0.215,-0.033,0.016,0.101,0.261,0.416,0.517,0.379,0.407,0.580,0.574,0.401,0.436,0.837];
const histPh = [null,8.109,8.112,8.113,8.109,8.108,8.109,8.103,8.102,8.097,8.098,8.094,8.087,8.086,8.087,8.089,8.093,8.071,8.087,8.083,8.077,8.082,8.077,8.078,8.076,8.068,8.069,8.067,8.068,8.064,8.067,8.059,8.051,8.054,8.046,8.040];
const histFossil = [21918.756,22200.213,22732.145,23205.592,22520.424,22749.873,22974.598,23516.639,24233.477,24380.322,24295.713,24837.771,25511.482,25692.994,26265.332,27652.691,28610.023,29598.951,30594.152,31499.256,32049.66,31513.014,33317.672,34479.988,34954.734,35275.82,35465.695,35403.527,35392.832,35974.609,36734.004,37086.566,35158.23,36866.863,37527.773,38094.039];

// 지구 시스템 엔진(js/earth-system.js)이 1750년부터 실제 배출만 넣고 계산한 CO2를 점선으로 겹친다.
// 관측을 맞춘 회귀선이 아니라 배출 → 탄소순환으로 계산한 값이라, 두 선이 겹치는 정도가
// 미래 예측 탭 엔진을 믿을 근거가 된다 (1988~2023 RMSE 2.8 ppm).
// 기온 그래프에는 아직 겹치지 않는다: histTemp의 기준 기간이 확인되지 않았다(아래 주석 참고).
const modelCo2 = (() => {
  const run = EarthSystem.run({ fromYear: 1750, toYear: years[years.length - 1] });
  const byYear = Object.fromEntries(run.map(o => [o.year, o.ppm]));
  return years.map(y => byYear[y]);
})();
const co2Opts = lineOpts('ppm');
co2Opts.plugins.legend = { display: true, labels: { color: '#9198a3', font: { size: 9.5 }, boxWidth: 14, boxHeight: 2 } };
const chartCo2 = new Chart(document.getElementById('chartCo2'), {
  type: 'line', data: { labels: years, datasets: [
    { label: '관측(지구 평균)', data: histCo2, borderColor: '#85B7EB', backgroundColor: '#85B7EB', pointRadius: 0, tension: 0.15 },
    { label: '모형', data: modelCo2, borderColor: '#e7e9ec', backgroundColor: '#e7e9ec', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.15 },
  ] },
  options: co2Opts });
const chartTempHist = new Chart(document.getElementById('chartTempHist'), {
  type: 'line', data: { labels: years, datasets: [{ data: histTemp, borderColor: '#E24B4A', pointRadius: 0, tension: 0.15 }] },
  options: lineOpts('°C') });
const chartPhHist = new Chart(document.getElementById('chartPhHist'), {
  type: 'line', data: { labels: years, datasets: [{ data: histPh, borderColor: '#5DCAA5', pointRadius: 0, tension: 0.15, spanGaps: true }] },
  options: lineOpts('pH') });
const chartFossil = new Chart(document.getElementById('chartFossil'), {
  type: 'line', data: { labels: years, datasets: [{ data: histFossil, borderColor: '#EF9F27', pointRadius: 0, tension: 0.15 }] },
  options: lineOpts('백만톤') });
