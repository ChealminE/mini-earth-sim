// ================= 현재 실태 탭 =================
const sceneCurrent = sceneFor('current'); // 이 화면을 열었을 때만 실제로 만듦 (common.js sceneFor)

// ── 관측 자료 ──────────────────────────────────────────────────────────
// 전부 js/earth-data.js(원본 data/raw → tools/gen_earth_data.py)에서 읽는다. 출처는 js/sources.js.
// 예전에는 이 파일에 출처 불명의 배열(histCo2·histTemp·histPh)을 직접 적어 두었는데, CO2는 NOAA 지구 평균보다
// 평균 0.9 ppm 낮고 들쭉날쭉했고, 기온은 HadCRUT5와 평행이동해도 잔차가 0.13 °C라 전 지구 평균이 아니었다.
const series = (d, key) => d[key].map((v, i) => ({ x: d.startYear + i, y: v }));
const lastOf = arr => arr[arr.length - 1];
const obsCo2 = series(EARTH_DATA.co2Noaa, 'ppm');            // NOAA GML 지구 평균, 1979~
const obsTemp = series(EARTH_DATA.tempHadcrut, 'anom');      // HadCRUT5, 1850~1900 기준
const obsTempLo = series(EARTH_DATA.tempHadcrut, 'lo');
const obsTempHi = series(EARTH_DATA.tempHadcrut, 'hi');
const obsPh = series(EARTH_DATA.phHot, 'ph');                // HOT Station ALOHA, 1989~
// 화석연료 배출: 엔진 입력과 같은 자료(GCP via OWID, GtC)를 화면 단위(백만 톤 CO2)로 되돌린다
const MTCO2_PER_GTC = 3664;
const obsFossil = series(EARTH_DATA.emissions, 'fossil')
  .filter(p => p.x >= 1850)
  .map(p => ({ x: p.x, y: p.y * MTCO2_PER_GTC }));

// 지구 시스템 엔진(js/earth-system.js)이 1750년부터 실제 배출만 넣고 계산한 값을 점선으로 겹친다.
// 관측을 맞춘 회귀선이 아니라 배출 → 탄소순환 → 복사강제력으로 계산한 값이라, 두 선이 겹치는 정도가
// 미래 예측 탭 엔진을 믿을 근거가 된다. 배출 자료가 있는 마지막 해까지만 계산한다(그 뒤는 배출 0이 된다).
// 기온: 기준선이 확인된 HadCRUT5(1850~1900 기준)라 이제 모형선을 겹친다. 모형은 CO2 강제력만 넣었으므로
// 화산·에어로졸이 큰 시기(1960~1990 등)에는 어긋나는 것이 정상이다.
const LAST_EMIS_YEAR = EARTH_DATA.emissions.startYear + EARTH_DATA.emissions.fossil.length - 1;
const modelHist = EarthSystem.run({ fromYear: 1750, toYear: LAST_EMIS_YEAR });
const modelCo2 = modelHist.filter(o => o.year >= obsCo2[0].x).map(o => ({ x: o.year, y: o.ppm }));
const modelTemp = modelHist.filter(o => o.year >= obsTemp[0].x).map(o => ({ x: o.year, y: o.T }));

// ── 요약 숫자: 마지막 완전한 해와 첫 해의 차이 ────────────────────────────
{
  const set = (id, txt) => { document.getElementById(id).textContent = txt; };
  const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  const c0 = obsCo2[0], c1 = lastOf(obsCo2);
  set('statCo2Label', `CO₂ 농도 (${c1.x})`);
  set('statCo2', `${c1.y.toFixed(1)} ppm`);
  set('statCo2Delta', `${c0.x}년 대비 ${sgn(c1.y - c0.y, 1)} ppm`);
  const t1 = lastOf(obsTemp);
  set('statTempLabel', `기온 편차 (${t1.x})`);
  set('statTemp', `${sgn(t1.y, 2)} °C`);
  set('statTempDelta', '1850~1900년 평균 대비');
  const p0 = obsPh[0], p1 = lastOf(obsPh);
  set('statPhLabel', `해양 pH (${p1.x})`);
  set('statPh', p1.y.toFixed(3));
  set('statPhDelta', `${p0.x}년 대비 ${sgn(p1.y - p0.y, 3)}`);
  const f1 = lastOf(obsFossil), f0 = obsFossil.find(p => p.x === 1988) || obsFossil[0];
  set('statFossilLabel', `화석연료 배출 (${f1.x})`);
  set('statFossil', `${Math.round(f1.y).toLocaleString('ko-KR')} 백만 톤`);
  set('statFossilDelta', `${f0.x}년 대비 ${sgn(f1.y - f0.y, 0).replace(/\d{4,}/, m => Number(m).toLocaleString('ko-KR'))} 백만 톤`);
}

// ── 그래프 ────────────────────────────────────────────────────────────
// x축은 연도(linear)다. 자료마다 시작 해가 달라(CO2 1979, 기온 1850, pH 1989) 범주형 축을 공유할 수 없다.
// 축 범위는 자료의 첫 해~마지막 해로 맞춘다(Chart.js가 2030·2050처럼 넉넉히 잡아 빈 칸이 생기지 않게).
const yearAxis = pts => ({ type: 'linear', min: pts[0].x, max: lastOf(pts).x, ticks: { color: textColor, font: { size: 9 }, callback: v => String(v) },
  grid: { color: gridColor } });
function histOpts(yLabel, legend, pts) {
  const o = lineOpts(yLabel);
  o.parsing = false;
  o.scales.x = yearAxis(pts);
  o.plugins.legend = legend
    ? { display: true, labels: { color: '#9198a3', font: { size: 9.5 }, boxWidth: 14, boxHeight: 2,
        filter: it => !it.text.startsWith('_') } }   // '_'로 시작하는 계열(불확도 띠 아래 경계)은 범례에서 뺀다
    : { display: false };
  return o;
}
const chartCo2 = new Chart(document.getElementById('chartCo2'), {
  type: 'line', data: { datasets: [
    { label: '관측 (NOAA 지구 평균)', data: obsCo2, borderColor: '#85B7EB', backgroundColor: '#85B7EB', pointRadius: 0, tension: 0.15 },
    { label: '모형', data: modelCo2, borderColor: '#e7e9ec', backgroundColor: '#e7e9ec', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.15 },
  ] },
  options: histOpts('ppm', true, obsCo2) });
const chartTempHist = new Chart(document.getElementById('chartTempHist'), {
  type: 'line', data: { datasets: [
    // 95 % 불확도 띠: 아래 경계 → 위 경계를 '-1'(바로 앞 계열)까지 채운다
    { label: '_불확도 하한', data: obsTempLo, borderWidth: 0, pointRadius: 0, fill: false },
    { label: '불확도 95 %', data: obsTempHi, borderWidth: 0, pointRadius: 0, fill: '-1',
      backgroundColor: 'rgba(226,75,74,0.18)', borderColor: 'rgba(226,75,74,0.18)' },
    { label: '관측 (HadCRUT5)', data: obsTemp, borderColor: '#E24B4A', backgroundColor: '#E24B4A', pointRadius: 0, tension: 0.15 },
    { label: '모형 (CO₂만)', data: modelTemp, borderColor: '#e7e9ec', backgroundColor: '#e7e9ec', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.15 },
  ] },
  options: histOpts('°C (1850~1900 대비)', true, obsTemp) });
const chartPhHist = new Chart(document.getElementById('chartPhHist'), {
  type: 'line', data: { datasets: [{ data: obsPh, borderColor: '#5DCAA5', pointRadius: 0, tension: 0.15, spanGaps: true }] },
  options: histOpts('pH', false, obsPh) });
const chartFossil = new Chart(document.getElementById('chartFossil'), {
  type: 'line', data: { datasets: [{ data: obsFossil, borderColor: '#EF9F27', pointRadius: 0, tension: 0.15 }] },
  options: histOpts('백만 톤 CO₂', false, obsFossil) });
