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

// ── 탄산 화학종 분포 ──────────────────────────────────────────────────
// seawaterState()는 pH·Ω만이 아니라 [CO2(aq)]·[HCO3-]·[CO3^2-]·DIC를 전부 푼다.
// pH 숫자 하나로는 "평형이 어느 쪽으로 이동했는지"가 안 보이므로 화학종 비율을 그대로 그린다.
// CO2를 올리면 CO3^2-가 HCO3-로 바뀌는(CO2 + CO3^2- + H2O → 2HCO3-) 이동이 막대 경계로 드러난다.
const SPECIES = [
  { key: 'co2aq', name: 'CO₂(aq)', color: '#d08a2c', digits: 1 },
  { key: 'hco3', name: 'HCO₃⁻', color: '#85B7EB', digits: 0 },
  { key: 'co3', name: 'CO₃²⁻', color: '#5DCAA5', digits: 0, note: ' · Ω와 직결' },
];
const SPEC_REF_PPM = CO2_MIN;               // 비교 기준 = 산업화 이전
const specRef = seawaterState(SPEC_REF_PPM);

function buildSpecBar(el) {
  el.innerHTML = '';
  return SPECIES.map(sp => {
    const seg = document.createElement('div');
    seg.className = 'spec-seg ' + sp.key;
    seg.title = sp.name;
    el.appendChild(seg);
    return seg;
  });
}
// 막대 안 글자는 칸이 충분히 넓을 때만 넣는다 (CO2(aq)는 1 % 안팎이라 표에서 읽는다)
function fillSpecBar(segs, s) {
  SPECIES.forEach((sp, i) => {
    const pct = 100 * s[sp.key] / s.dic;
    segs[i].style.width = pct + '%';
    segs[i].textContent = pct >= 9 ? `${sp.name} ${pct.toFixed(1)}%` : '';
  });
}
const specSegsRef = buildSpecBar(document.getElementById('specBarRef'));
const specSegsNow = buildSpecBar(document.getElementById('specBarNow'));
fillSpecBar(specSegsRef, specRef);

const specCells = {};
const specBody = document.getElementById('specTableBody');
for (const sp of [...SPECIES, { key: 'dic', name: 'DIC (합계)', digits: 0 }]) {
  const tr = document.createElement('tr');
  if (sp.key === 'dic') tr.className = 'total';
  const sw = sp.color ? `<span class="swatch" style="background:${sp.color}"></span>` : '';
  tr.innerHTML = `<td>${sw}${sp.name}${sp.note ? `<span style="color:#7d838d">${sp.note}</span>` : ''}</td><td></td><td></td><td></td>`;
  specBody.appendChild(tr);
  specCells[sp.key] = { pct: tr.cells[1], conc: tr.cells[2], delta: tr.cells[3], digits: sp.digits };
}

const UMOL = 1e6;   // mol/kg -> µmol/kg
function updateSpeciation(co2) {
  const s = seawaterState(co2);
  document.getElementById('specBarCo2').textContent = co2;
  fillSpecBar(specSegsNow, s);
  for (const key in specCells) {
    const c = specCells[key];
    const v = s[key] * UMOL, v0 = specRef[key] * UMOL, d = v - v0;
    c.pct.textContent = (100 * s[key] / s.dic).toFixed(2) + ' %';
    c.conc.textContent = v.toFixed(c.digits);
    const sign = d > 0 ? '+' : (d < 0 ? '−' : '±');
    c.delta.textContent = `${sign}${Math.abs(d).toFixed(c.digits)} (${sign}${Math.abs(100 * d / v0).toFixed(0)} %)`;
    c.delta.className = d < -1e-9 ? 'down' : (d > 1e-9 ? 'up' : '');
  }
}

const co2slider = document.getElementById('co2slider');
const co2out = document.getElementById('co2out');
const tempval = document.getElementById('tempval');
const phval = document.getElementById('phval');
const omegaval = document.getElementById('omegaval');
function updateFuture() {
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
  updateSpeciation(co2);
  sceneFuture.state.co2 = co2; // 3D 대기 효과와 파도 진폭이 참조하는 값
  sceneFuture.state.ph = p;    // 해양 산성화가 물 색·탁도·투명도에 반영되도록
  applyState(sceneFuture);
}
co2slider.addEventListener('input', updateFuture);
// 첫 화면도 모형값으로 채운다 (예전엔 슬라이더를 건드리기 전까지 HTML에 박아 둔 옛 값이 보였다)
updateFuture();
