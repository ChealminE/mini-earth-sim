// ================= 미래 예측 탭 =================
const sceneFuture = buildAcrylicScene();

const tempSlope = 0.0160807738567842, tempIntercept = -6.10149349991621;
const phSlope = -0.000941544551611233, phIntercept = 8.44148773488769;
function predictTemp(co2) { return tempSlope * co2 + tempIntercept; }
function predictPh(co2) { return phSlope * co2 + phIntercept; }

const lineX = [280, 600];
const tempLine = lineX.map(x => ({x, y: predictTemp(x)}));
const phLine = lineX.map(x => ({x, y: predictPh(x)}));

const chart1 = new Chart(document.getElementById('chart1'), {
  type: 'scatter',
  data: { datasets: [
    { data: histCo2.map((c,i)=>({x:c,y:histTemp[i]})), backgroundColor: '#85B7EB', pointRadius: 3 },
    { data: tempLine, type: 'line', borderColor: '#4a4f57', borderWidth: 1.5, pointRadius: 0, borderDash: [4,4] },
    { data: [{x:418, y:predictTemp(418)}], backgroundColor: '#E24B4A', pointRadius: 6, pointStyle: 'star' }
  ]},
  options: scatterOpts('°C') });

const chart2 = new Chart(document.getElementById('chart2'), {
  type: 'scatter',
  data: { datasets: [
    { data: histCo2.map((c,i)=>histPh[i]!==null?{x:c,y:histPh[i]}:null).filter(Boolean), backgroundColor: '#5DCAA5', pointRadius: 3 },
    { data: phLine, type: 'line', borderColor: '#4a4f57', borderWidth: 1.5, pointRadius: 0, borderDash: [4,4] },
    { data: [{x:418, y:predictPh(418)}], backgroundColor: '#E24B4A', pointRadius: 6, pointStyle: 'star' }
  ]},
  options: scatterOpts('pH') });

const co2slider = document.getElementById('co2slider');
const co2out = document.getElementById('co2out');
const tempval = document.getElementById('tempval');
const phval = document.getElementById('phval');
co2slider.addEventListener('input', () => {
  const co2 = Number(co2slider.value);
  co2out.textContent = co2;
  const t = predictTemp(co2), p = predictPh(co2);
  tempval.textContent = (t >= 0 ? '+' : '') + t.toFixed(2) + '°C';
  phval.textContent = p.toFixed(3);
  chart1.data.datasets[2].data = [{x: co2, y: t}];
  chart1.update('none');
  chart2.data.datasets[2].data = [{x: co2, y: p}];
  chart2.update('none');
  sceneFuture.state.co2 = co2; // 3D 대기 효과와 파도 진폭이 참조하는 값
  applyState(sceneFuture);
});
