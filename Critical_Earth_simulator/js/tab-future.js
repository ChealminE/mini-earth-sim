// ================= 미래 예측 탭 =================
// 예측식은 js/earth-model.js 한 곳에만 있다. 1인칭 탐험 모드도 같은 파일을 읽으므로
// 두 모드가 같은 CO2에 대해 반드시 같은 pH·기온을 내놓는다.
const sceneFuture = buildAcrylicScene();

// 모형 곡선은 직선이 아니라 휘므로 점을 촘촘히 찍어야 곡선으로 보인다
const modelX = [];
for (let c = CO2_MIN; c <= CO2_MAX; c += 10) modelX.push(c);
const tempLine = modelX.map(x => ({ x, y: climateAnomaly(x) }));
const phLine = modelX.map(x => ({ x, y: seawaterPH(x) }));

const chart1 = new Chart(document.getElementById('chart1'), {
  type: 'scatter',
  data: { datasets: [
    { data: histCo2.map((c,i)=>({x:c,y:histTemp[i]})), backgroundColor: '#85B7EB', pointRadius: 3 },
    { data: tempLine, type: 'line', borderColor: '#4a4f57', borderWidth: 1.5, pointRadius: 0, borderDash: [4,4] },
    { data: [{x:CO2_NOW, y:climateAnomaly(CO2_NOW)}], backgroundColor: '#E24B4A', pointRadius: 6, pointStyle: 'star' }
  ]},
  options: scatterOpts('°C') });

const chart2 = new Chart(document.getElementById('chart2'), {
  type: 'scatter',
  data: { datasets: [
    { data: histCo2.map((c,i)=>histPh[i]!==null?{x:c,y:histPh[i]}:null).filter(Boolean), backgroundColor: '#5DCAA5', pointRadius: 3 },
    { data: phLine, type: 'line', borderColor: '#4a4f57', borderWidth: 1.5, pointRadius: 0, borderDash: [4,4] },
    { data: [{x:CO2_NOW, y:seawaterPH(CO2_NOW)}], backgroundColor: '#E24B4A', pointRadius: 6, pointStyle: 'star' }
  ]},
  options: scatterOpts('pH') });

const co2slider = document.getElementById('co2slider');
const co2out = document.getElementById('co2out');
const tempval = document.getElementById('tempval');
const phval = document.getElementById('phval');
const omegaval = document.getElementById('omegaval');
co2slider.addEventListener('input', () => {
  const co2 = Number(co2slider.value);
  co2out.textContent = co2;
  const t = climateAnomaly(co2), p = seawaterPH(co2), om = aragoniteOmega(co2);
  tempval.textContent = (t >= 0 ? '+' : '') + t.toFixed(2) + '°C';
  phval.textContent = p.toFixed(3);
  // Ω가 1 밑으로 내려가면 이미 만들어진 탄산칼슘 골격이 녹기 시작한다 - 색으로 경고
  omegaval.textContent = om.toFixed(2);
  omegaval.style.color = om < 1 ? '#E24B4A' : (om < 2 ? '#d08a2c' : '');
  chart1.data.datasets[2].data = [{x: co2, y: t}];
  chart1.update('none');
  chart2.data.datasets[2].data = [{x: co2, y: p}];
  chart2.update('none');
  sceneFuture.state.co2 = co2; // 3D 대기 효과와 파도 진폭이 참조하는 값
  applyState(sceneFuture);
});
