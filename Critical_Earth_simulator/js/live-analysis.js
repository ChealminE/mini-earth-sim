// ================= 직접 실험 - 데이터 분석·편집 칸 (오른쪽 아래) =================
// 실험 중:  고른 변인의 통계(최소·최대·평균·중앙값·표준편차)와 추세식을 실시간으로 보여 준다.
// 실험 후:  편집 단계(구간 자르기 → 이상값 빼기 → N개씩 묶어 평균 → 이동 평균)를 켜고 끄며
//           원본과 편집본을 한 그래프에 겹쳐 비교하고, 엑셀·이미지로 내보낸다.
// 원본 기록(liveRecords)은 절대 바꾸지 않는다 - 편집은 늘 원본에서 새로 계산한 사본이다.
// 편집 단계는 기록 중에 바꾸면 결과가 계속 흔들려서 헷갈리므로, 실험이 끝난 뒤에만 켤 수 있다.
const an = {
  xKey: TIME_AXIS_KEY, yKey: '', timeUnit: 'auto', fitModel: 'linear',
  steps: { trim: { on: false, xMin: '', xMax: '' }, outlier: { on: false, k: 3 },
           block: { on: false, n: 5 }, moving: { on: false, n: 5 } },
  chart: null, last: null,
};

function analysisLocked() {
  return liveSession.state === 'armed' || liveSession.state === 'recording';
}

function buildAnalysisChart() {
  an.chart = new Chart(document.getElementById('anChart'), {
    type: 'scatter',
    data: { datasets: [] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: textColor, boxWidth: 10, font: { size: 9.5 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: (${fmtNum(ctx.parsed.x)}, ${fmtNum(ctx.parsed.y)})` } },
      },
      scales: {
        x: { title: { display: true, text: '', color: textColor, font: { size: 9.5 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
        y: { title: { display: true, text: '', color: textColor, font: { size: 9.5 } }, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
      } } });
}

function resizeAnalysisChart() {
  if (an.chart) an.chart.resize();
}

// 편집 단계를 순서대로 적용. 각 단계가 무엇을 했는지 기록도 같이 남긴다 (엑셀 '통계' 시트에 적힘).
function applyAnalysisSteps(points) {
  const log = [];
  let pts = points;
  if (analysisLocked()) return { pts, log, removed: [] };
  const st = an.steps;
  let removed = [];
  if (st.trim.on && (st.trim.xMin !== '' || st.trim.xMax !== '')) {
    const before = pts.length;
    pts = trimRange(pts, st.trim.xMin, st.trim.xMax);
    log.push(`구간 자르기: X ${st.trim.xMin === '' ? '처음' : st.trim.xMin} ~ ${st.trim.xMax === '' ? '끝' : st.trim.xMax} (${before}개 → ${pts.length}개)`);
  }
  if (st.outlier.on) {
    const r = removeOutliers(pts, Number(st.outlier.k) || 3);
    removed = r.removed;
    pts = r.kept;
    log.push(`이상값 빼기: 평균에서 표준편차 ${st.outlier.k}배보다 먼 값 ${r.removed.length}개 뺌`);
  }
  if (st.block.on) {
    const before = pts.length;
    pts = blockAverage(pts, Number(st.block.n) || 1);
    log.push(`${st.block.n}개씩 묶어 평균 (${before}개 → ${pts.length}개)`);
  }
  if (st.moving.on) {
    const before = pts.length;
    pts = movingAverage(pts, Number(st.moving.n) || 1);
    log.push(`이동 평균 (창 ${st.moving.n}개, ${before}개 → ${pts.length}개)`);
  }
  return { pts, log, removed };
}

function updateAnalysis() {
  if (!an.chart) return;
  const locked = analysisLocked();
  document.getElementById('anLockNote').style.display = locked ? '' : 'none';
  document.querySelectorAll('#anSteps input').forEach(el => { el.disabled = locked; });

  const raw = an.yKey ? seriesPoints(an.xKey, an.yKey, an.timeUnit) : [];
  const { pts, log, removed } = applyAnalysisSteps(raw);
  const edited = log.length > 0;
  const fit = an.fitModel !== 'none' ? fitModel(pts, an.fitModel) : null;
  an.last = { raw, pts, log, fit, edited };

  const datasets = [{
    label: edited ? '원본' : an.yKey || '(변인을 고르세요)', data: downsampleMinMax(raw, 2000),
    borderColor: edited ? 'rgba(145,152,163,0.55)' : '#5DCAA5', backgroundColor: edited ? 'rgba(145,152,163,0.55)' : '#5DCAA5',
    pointRadius: raw.length > 300 ? 0 : 2, showLine: true, borderWidth: 1,
  }];
  if (removed.length) {
    datasets.push({ label: `뺀 이상값 ${removed.length}개`, data: removed, borderColor: '#E24B4A', backgroundColor: '#E24B4A',
      pointRadius: 4, pointStyle: 'crossRot', showLine: false });
  }
  if (edited) {
    datasets.push({ label: '편집 후', data: downsampleMinMax(pts, 2000), borderColor: '#EF9F27', backgroundColor: '#EF9F27',
      pointRadius: pts.length > 300 ? 0 : 2.5, showLine: true, borderWidth: 1.8 });
  }
  if (fit && !fit.error) {
    const xs = pts.map(p => p.x);
    datasets.push({ label: `추세식 ${fit.equation}`, data: fitCurvePoints(fit, Math.min(...xs), Math.max(...xs)),
      borderColor: '#85B7EB', borderDash: [6, 4], borderWidth: 1.6, pointRadius: 0, showLine: true });
  }
  an.chart.data.datasets = datasets;
  an.chart.options.scales.x.title.text = axisLabel(an.xKey, an.timeUnit);
  an.chart.options.scales.y.title.text = an.yKey;
  an.chart.update('none');

  renderAnalysisStats(raw, pts, edited);
  renderAnalysisFit(fit, pts);
}

function statCell(v) {
  return v === undefined ? '–' : fmtNum(v);
}

function renderAnalysisStats(raw, pts, edited) {
  const a = describeValues(raw.map(p => p.y));
  const b = edited ? describeValues(pts.map(p => p.y)) : null;
  const rows = [['개수', 'n'], ['최솟값', 'min'], ['최댓값', 'max'], ['평균', 'mean'], ['중앙값', 'median'], ['표준편차', 'std'], ['범위 (최대−최소)', 'range']];
  document.getElementById('anStats').innerHTML = `<table class="an-table">
    <thead><tr><th>${escHtml(an.yKey || 'Y')}</th><th>원본</th>${b ? '<th>편집 후</th>' : ''}</tr></thead>
    <tbody>${rows.map(([label, k]) => `<tr><th>${label}</th><td>${statCell(a[k])}</td>${b ? `<td>${statCell(b[k])}</td>` : ''}</tr>`).join('')}</tbody>
  </table>`;
}

function renderAnalysisFit(fit, pts) {
  const el = document.getElementById('anFitResult');
  if (!fit) { el.innerHTML = ''; return; }
  if (fit.error) { el.innerHTML = `<div class="an-fit-error">${escHtml(fit.error)}</div>`; return; }
  const r2Desc = fit.r2 >= 0.9 ? '아주 잘 맞음' : fit.r2 >= 0.7 ? '잘 맞는 편' : fit.r2 >= 0.4 ? '조금 맞음' : '거의 안 맞음';
  el.innerHTML = `<div class="an-equation">${escHtml(fit.equation)}</div>
    <div class="an-r2">R² = ${fit.r2.toFixed(4)} <span>(${r2Desc} · 1에 가까울수록 식이 점들을 잘 설명해요 · 점 ${fit.n}개)</span></div>`;
}

// 식 종류별로 R²를 한꺼번에 계산해서 비교 - "어떤 식이 내 데이터를 제일 잘 설명하나"를 직접 따져 보게
function renderFitComparison() {
  const pts = an.last ? an.last.pts : [];
  const rows = FIT_MODELS.map(m => ({ m, fit: fitModel(pts, m.id) }));
  const best = rows.filter(r => !r.fit.error).sort((a, b) => b.fit.r2 - a.fit.r2)[0];
  document.getElementById('anCompare').innerHTML = `<table class="an-table compare">
    <thead><tr><th>식 종류</th><th>식</th><th>R²</th></tr></thead>
    <tbody>${rows.map(({ m, fit }) => `<tr class="${best && best.m.id === m.id ? 'best' : ''}" data-model="${m.id}" title="눌러서 이 식으로 바꾸기">
      <th>${m.short}</th><td>${fit.error ? `<span class="muted">${escHtml(fit.error)}</span>` : escHtml(fit.equation)}</td>
      <td>${fit.error ? '–' : fit.r2.toFixed(4)}</td></tr>`).join('')}</tbody>
  </table>
  <div class="hint" style="margin:6px 0 0">R²가 가장 높다고 항상 정답은 아니에요. 삼차식처럼 항이 많은 식은 R²가 늘 높게 나오기 쉬우니,
  <b>현상을 설명할 수 있는 식</b>인지 함께 생각해 보세요.</div>`;
}

document.getElementById('anCompare').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-model]');
  if (!tr) return;
  an.fitModel = tr.dataset.model;
  document.getElementById('anFitModel').value = an.fitModel;
  updateAnalysis();
});

// ── 변인 선택 ─────────────────────────────────────
function onLiveKeysChanged() {
  const keys = [...liveKnownKeys].sort();
  if (!an.yKey) {
    an.yKey = keys.find(k => typeof (liveLatest[k] || {}).value === 'number') || '';
  }
  document.getElementById('anXKey').innerHTML = buildXKeyOptionsHtml(an.xKey, keys);
  document.getElementById('anYKey').innerHTML = keys.length ? buildKeyOptionsHtml(an.yKey, keys) : '<option value="">(값 없음)</option>';
  updateAnalysis();
}

let anUpdateTimer = null;
function onLiveRecordsChanged(immediate) {
  if (immediate) { updateAnalysis(); return; }
  // 기록 중에는 그래프보다 덜 자주 (1초에 한 번) - 통계를 매번 정렬해서 계산하므로
  if (anUpdateTimer) return;
  anUpdateTimer = setTimeout(() => { anUpdateTimer = null; updateAnalysis(); }, 1000);
}

function openAnalysisFor(xKey, yKey, timeUnit) {
  if (!yKey) return;
  an.xKey = xKey || TIME_AXIS_KEY;
  an.yKey = yKey;
  an.timeUnit = timeUnit || 'auto';
  document.getElementById('anTimeUnit').value = an.timeUnit;
  onLiveKeysChanged();
  // 분석 칸이 거의 접혀 있으면 펼친다
  const panel = document.getElementById('tab-live');
  if (parseFloat(panel.style.getPropertyValue('--an-pct')) < 20) {
    panel.style.setProperty('--an-pct', '50%');
    liveGraphs.forEach(g => g.chart.resize());
    resizeAnalysisChart();
  }
  document.getElementById('liveAnalysis').scrollIntoView({ block: 'nearest' });
}

// ── 입력 연결 ─────────────────────────────────────
document.getElementById('anXKey').addEventListener('change', (e) => { an.xKey = e.target.value; updateAnalysis(); });
document.getElementById('anYKey').addEventListener('change', (e) => { an.yKey = e.target.value; updateAnalysis(); });
document.getElementById('anTimeUnit').addEventListener('change', (e) => { an.timeUnit = e.target.value; updateAnalysis(); });
document.getElementById('anFitModel').addEventListener('change', (e) => { an.fitModel = e.target.value; updateAnalysis(); });
document.getElementById('anCompareBtn').addEventListener('click', () => {
  const box = document.getElementById('anCompare');
  if (box.innerHTML) { box.innerHTML = ''; return; }
  renderFitComparison();
});
document.getElementById('anSteps').addEventListener('input', (e) => {
  const el = e.target;
  const [step, field] = (el.dataset.step || '').split('.');
  if (!step) return;
  an.steps[step][field] = el.type === 'checkbox' ? el.checked : el.value;
  updateAnalysis();
  if (document.getElementById('anCompare').innerHTML) renderFitComparison();
});
document.getElementById('anResetBtn').addEventListener('click', () => {
  an.steps = { trim: { on: false, xMin: '', xMax: '' }, outlier: { on: false, k: 3 }, block: { on: false, n: 5 }, moving: { on: false, n: 5 } };
  document.querySelectorAll('#anSteps [data-step]').forEach(el => {
    const [step, field] = el.dataset.step.split('.');
    if (el.type === 'checkbox') el.checked = an.steps[step][field];
    else el.value = an.steps[step][field];
  });
  updateAnalysis();
});

// ── 내보내기 ─────────────────────────────────────
function exportFileStem() {
  if (liveSession.file) return liveSession.file;
  const d = new Date(liveSession.startedAt || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `실험_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function exportAnalysisXlsx() {
  if (!liveRecords.length) { showLiveToast('아직 기록된 데이터가 없어요', true); return; }
  const keys = [...liveKnownKeys].sort().filter(k => liveRecords.some(r => typeof r[k] === 'number'));
  const t0 = liveSession.startedAt || liveRecords[0]._t;
  const rawRows = [['측정 시각', '경과 시간(초)', '보드', ...keys]];
  for (const r of liveRecords) {
    const dev = liveDevices.find(d => d.id === r._dev);
    rawRows.push([new Date(r._t).toLocaleString('ko-KR', { hour12: false }), Number(((r._t - t0) / 1000).toFixed(3)),
      dev ? dev.name : r._dev, ...keys.map(k => (typeof r[k] === 'number' ? r[k] : ''))]);
  }

  const last = an.last || { raw: [], pts: [], log: [], fit: null, edited: false };
  const xLabel = axisLabel(an.xKey, an.timeUnit);
  const editRows = [[xLabel, `${an.yKey}${last.edited ? ' (편집 후)' : ''}`], ...last.pts.map(p => [p.x, p.y])];

  const a = describeValues(last.raw.map(p => p.y));
  const b = describeValues(last.pts.map(p => p.y));
  const statRows = [['항목', '원본', '편집 후'],
    ['변인', `${an.yKey} (X: ${xLabel})`, ''],
    ...[['개수', 'n'], ['최솟값', 'min'], ['최댓값', 'max'], ['평균', 'mean'], ['중앙값', 'median'], ['표준편차(n−1)', 'std'], ['범위', 'range']]
      .map(([l, k]) => [l, a[k] ?? '', last.edited ? (b[k] ?? '') : '']),
    [],
    ['편집 단계', last.log.length ? last.log.join(' → ') : '편집 안 함 (원본 그대로)', ''],
    [],
    ['추세식', last.fit && !last.fit.error ? last.fit.equation : (last.fit ? last.fit.error : '안 그림'), ''],
    ['R²', last.fit && !last.fit.error ? last.fit.r2 : '', ''],
    [],
    ['식 종류별 비교', '식', 'R²'],
    ...FIT_MODELS.map(m => { const f = fitModel(last.pts, m.id); return [m.label, f.error || f.equation, f.error ? '' : f.r2]; }),
    [],
    ['실험 시작', liveSession.startedAt ? new Date(liveSession.startedAt).toLocaleString('ko-KR', { hour12: false }) : '', ''],
    ['실험 종료', liveSession.endedAt ? new Date(liveSession.endedAt).toLocaleString('ko-KR', { hour12: false }) : '(진행 중)', ''],
    ['자동 시작 조건', (liveSession.config || {}).trigger ? `${liveSession.config.trigger.key} ${liveSession.config.trigger.op} ${liveSession.config.trigger.value}` : '없음', ''],
  ];

  const blob = buildXlsx([
    { name: '원본 데이터', rows: rawRows, colWidths: [20, 13, 14, ...keys.map(() => 12)] },
    { name: '편집 데이터', rows: editRows, colWidths: [16, 16] },
    { name: '통계·추세식', rows: statRows, colWidths: [22, 46, 14] },
  ]);
  downloadBlob(blob, `${exportFileStem()}.xlsx`);
}

document.getElementById('anExportXlsxBtn').addEventListener('click', exportAnalysisXlsx);
document.getElementById('anExportPngBtn').addEventListener('click', () => {
  if (!an.chart) return;
  const a = document.createElement('a');
  a.href = chartToPngUrl(an.chart);
  a.download = `${exportFileStem()}_${an.yKey || '그래프'}.png`;
  a.click();
});

buildAnalysisChart();
onLiveKeysChanged();
