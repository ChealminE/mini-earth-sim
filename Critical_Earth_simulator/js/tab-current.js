// ================= 현재 실태 탭 =================
// 3차 C3: 그래프 4개(CO₂·기온·pH·화석연료) 자리를 그래프 작업대(js/graph-workspace.js)로 대체했다.
// 예전 그래프 코드는 되돌리기 쉽게 남겨 두고, USE_WORKSPACE 가 true 면 만들지 않는다(마크업 .charts-2col 도 숨긴다).
const USE_WORKSPACE = true;
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
const obsSst = series(EARTH_DATA.sstHadsst, 'anom');       // HadSST4 편차, 1850~1900 기준
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

// 3D (2차 개편 D): 지금 지구 = 엔진이 실제 배출로 계산한 마지막 해. 도시 규모·굴뚝은 그해까지의 배출 역사를 따른다
// (js/earth-visual.js). 대기 CO₂만은 관측값(main.js switchTab)을 넣는다.
EarthVisual.annotateCumFossil(modelHist);
const modelNow = lastOf(modelHist);
setEarthVisual(sceneCurrent, modelNow,
  EarthVisual.presetSociety(modelNow.fossil, modelNow.year, EarthSystem.LEVER_NOW, EarthSystem.E2023, EarthSystem.LAST_HIST_YEAR));

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
  const s1 = lastOf(obsSst);
  set('statSstLabel', `해수온 편차 (${s1.x})`);
  set('statSst', `${sgn(s1.y, 2)} °C`);
  set('statSstDelta', '1850~1900년 평균 대비');
  // pH만 전 지구 평균이 아니라 한 정점 관측이다(전 지구 재구성 자료로 바꾸는 일은 보류). 학생이 다른 세 숫자와
  // 같은 무게로 읽지 않게 상자 안에 밝힌다. 칸이 좁아 말줄임이 되면 title로 전체를 볼 수 있게 한다.
  const p0 = obsPh[0], p1 = lastOf(obsPh);
  set('statPhLabel', `해양 pH (${p1.x})`);
  set('statPh', p1.y.toFixed(3));
  set('statPhDelta', `한 지점 관측(하와이 Station ALOHA) · ${p0.x}년 대비 ${sgn(p1.y - p0.y, 3)}`);
  document.getElementById('statPhDelta').title = document.getElementById('statPhDelta').textContent;
  const f1 = lastOf(obsFossil), f0 = obsFossil.find(p => p.x === 1988) || obsFossil[0];
  set('statFossilLabel', `화석연료 배출 (${f1.x})`);
  set('statFossil', `${Math.round(f1.y).toLocaleString('ko-KR')} 백만 톤`);
  set('statFossilDelta', `${f0.x}년 대비 ${sgn(f1.y - f0.y, 0).replace(/\d{4,}/, m => Number(m).toLocaleString('ko-KR'))} 백만 톤`);
  // 조작 띠 안내 (3차 B1): 연도 범위를 문구에 박아 두면 자료를 갱신할 때 어긋나므로 자료에서 계산한다
  const all = [obsCo2, obsTemp, obsSst, obsPh, obsFossil];
  set('csObsRange', `관측 자료 ${Math.min(...all.map(a => a[0].x))}~${Math.max(...all.map(a => lastOf(a).x))} · 자료마다 시작 연도가 다릅니다`);
}

// ── 그래프 ────────────────────────────────────────────────────────────
// 색은 css/theme.css 토큰에서 읽는다(js/theme.js). 관측 = 먹색 실선, 모형 = 데이터 색 점선 (미래 예측 탭과 같은 약속).
// x축은 연도(linear)다. 자료마다 시작 해가 달라(CO2 1979, 기온 1850, pH 1989) 범주형 축을 공유할 수 없다.
// 축 범위는 자료의 첫 해~마지막 해로 맞춘다(Chart.js가 2030·2050처럼 넉넉히 잡아 빈 칸이 생기지 않게).
function histOpts(yLabel, legend, pts) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    scales: {
      x: Theme.axis({ type: 'linear', min: pts[0].x, max: lastOf(pts).x, ticks: { color: Theme.color('--ink-3'), font: Theme.font(), callback: v => String(v), maxTicksLimit: 7 } }),
      y: Theme.axis({ title: yLabel }),
    },
    plugins: { legend: legend ? Theme.legend() : { display: false } },
  };
}
const OBS = Theme.color('--data-obs');
const obsLine = (label, data) => ({ label, data, borderColor: OBS, backgroundColor: OBS, borderWidth: 2, pointRadius: 0, tension: 0.15 });
const modelLine = (label, data, token) => ({ label, data, borderColor: Theme.color(token), backgroundColor: Theme.color(token),
  borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: 0.15 });
const chartCo2 = USE_WORKSPACE ? null : new Chart(document.getElementById('chartCo2'), {
  type: 'line', data: { datasets: [
    obsLine('관측 (NOAA 지구 평균)', obsCo2),
    modelLine('모형', modelCo2, '--data-co2'),
  ] },
  options: histOpts('ppm', true, obsCo2) });
const chartTempHist = USE_WORKSPACE ? null : new Chart(document.getElementById('chartTempHist'), {
  type: 'line', data: { datasets: [
    obsLine('관측 (HadCRUT5)', obsTemp),
    modelLine('모형 (CO₂만)', modelTemp, '--data-temp'),
    // 95 % 불확도 띠: 위 경계를 아래 경계(3번 계열)까지 채운다. 아래 경계는 범례에서 뺀다('_' 이름).
    { label: '불확도 95 %', data: obsTempHi, borderWidth: 0, pointRadius: 0, fill: 3,
      backgroundColor: Theme.color('--data-band'), borderColor: Theme.color('--data-band') },
    { label: '_불확도 하한', data: obsTempLo, borderWidth: 0, pointRadius: 0, fill: false },
  ] },
  options: histOpts('°C (1850~1900 대비)', true, obsTemp) });
const chartPhHist = USE_WORKSPACE ? null : new Chart(document.getElementById('chartPhHist'), {
  type: 'line', data: { datasets: [{ ...obsLine('관측 (HOT)', obsPh), spanGaps: true }] },
  options: histOpts('pH', false, obsPh) });
const chartFossil = USE_WORKSPACE ? null : new Chart(document.getElementById('chartFossil'), {
  type: 'line', data: { datasets: [obsLine('GCP', obsFossil)] },
  options: histOpts('백만 톤 CO₂', false, obsFossil) });

// ── 그래프 작업대 (3차 C3) ────────────────────────────────────────────
// 처음 상태: Y1 = 대기 CO₂, 시간 보기, 전체 기간. 3D는 지금처럼 최신 관측 상태 그대로(분석창 연도와 묶지 않음).
const currentWorkspace = USE_WORKSPACE
  ? GraphWorkspace.create(document.getElementById('currentWorkspace'), { catalog: DATA_CATALOG }) : null;
if (currentWorkspace) {
  document.querySelector('#tab-current .charts-2col').hidden = true;
  currentWorkspace.add('co2');
} else document.getElementById('currentWorkspace').hidden = true;
// 칸 크기가 바뀌거나 탭을 열 때 main.js 가 부른다
function resizeCurrentGraphs() {
  if (currentWorkspace) currentWorkspace.resize();
  else [chartCo2, chartTempHist, chartPhHist, chartFossil].forEach(c => c.resize());
}
