// ================= 현재 실태 탭 =================
const sceneCurrent = buildAcrylicScene();

// ── CO2 시뮬레이터 실측 데이터 (1988~2023) ──────────────────────
const years = [1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023];
const histCo2 = [350.06,352.12,353.48,354.85,355.76,356.46,357.61,359.28,361.20,362.49,364.33,367.01,368.42,369.80,371.61,373.99,376.21,377.97,380.23,382.05,384.10,385.83,387.62,389.82,391.67,394.14,396.49,398.55,401.48,404.31,406.50,408.89,411.39,413.65,416.02,418.24];
const histTemp = [-0.369,-0.433,-0.161,-0.490,-0.591,-0.576,-0.279,-0.271,-0.575,-0.329,0.078,-0.176,-0.212,-0.136,0.040,-0.028,-0.091,-0.009,0.029,0.130,-0.032,0.085,0.215,-0.033,0.016,0.101,0.261,0.416,0.517,0.379,0.407,0.580,0.574,0.401,0.436,0.837];
const histPh = [null,8.109,8.112,8.113,8.109,8.108,8.109,8.103,8.102,8.097,8.098,8.094,8.087,8.086,8.087,8.089,8.093,8.071,8.087,8.083,8.077,8.082,8.077,8.078,8.076,8.068,8.069,8.067,8.068,8.064,8.067,8.059,8.051,8.054,8.046,8.040];
const histFossil = [21918.756,22200.213,22732.145,23205.592,22520.424,22749.873,22974.598,23516.639,24233.477,24380.322,24295.713,24837.771,25511.482,25692.994,26265.332,27652.691,28610.023,29598.951,30594.152,31499.256,32049.66,31513.014,33317.672,34479.988,34954.734,35275.82,35465.695,35403.527,35392.832,35974.609,36734.004,37086.566,35158.23,36866.863,37527.773,38094.039];

const chartCo2 = new Chart(document.getElementById('chartCo2'), {
  type: 'line', data: { labels: years, datasets: [{ data: histCo2, borderColor: '#85B7EB', pointRadius: 0, tension: 0.15 }] },
  options: lineOpts('ppm') });
const chartTempHist = new Chart(document.getElementById('chartTempHist'), {
  type: 'line', data: { labels: years, datasets: [{ data: histTemp, borderColor: '#E24B4A', pointRadius: 0, tension: 0.15 }] },
  options: lineOpts('°C') });
const chartPhHist = new Chart(document.getElementById('chartPhHist'), {
  type: 'line', data: { labels: years, datasets: [{ data: histPh, borderColor: '#5DCAA5', pointRadius: 0, tension: 0.15, spanGaps: true }] },
  options: lineOpts('pH') });
const chartFossil = new Chart(document.getElementById('chartFossil'), {
  type: 'line', data: { labels: years, datasets: [{ data: histFossil, borderColor: '#EF9F27', pointRadius: 0, tension: 0.15 }] },
  options: lineOpts('백만톤') });
