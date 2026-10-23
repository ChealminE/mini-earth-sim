// ============================================================================
// js/earth-system.js 대조 테스트 (node)
// ----------------------------------------------------------------------------
// 왜 node인가: 헤드리스 브라우저의 rAF는 약 4 FPS라 화면 재생으로 엔진을 검증하면
// 거짓 결과가 나온다. 엔진은 순수 함수이므로 여기서 직접 불러 숫자로 확인한다.
//
// 실행: node tools/test_earth_system.js            (파이썬으로 engine.py 덤프를 새로 만든다)
//       node tools/test_earth_system.js ref.json   (이미 만든 덤프를 쓴다)
// 파이썬 덤프: python tools/earth_system_ref/engine.py --dump ref.json
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── 브라우저와 같은 방식으로 전역 스크립트를 한 컨텍스트에 순서대로 불러온다 ──
const ctx = vm.createContext({ console, Math });
for (const f of ['js/earth-model.js', 'js/earth-data.js', 'js/earth-system.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const ES = vm.runInContext('EarthSystem', ctx);
const M = vm.runInContext('({ seawaterState, pco2FromDic })', ctx);

// ── 파이썬 참조 결과 ─────────────────────────────────────────────────────────
function loadRef() {
  if (process.argv[2]) return JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const out = path.join(os.tmpdir(), 'earth_system_ref_dump.json');
  const script = path.join(ROOT, 'tools', 'earth_system_ref', 'engine.py');
  const venv = path.join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const cands = [venv, 'python3', 'python'];
  for (const py of cands) {
    try {
      execFileSync(py, [script, '--dump', out], { stdio: 'pipe' });
      return JSON.parse(fs.readFileSync(out, 'utf8'));
    } catch (e) { /* 다음 후보 */ }
  }
  console.error('파이썬(numpy 포함)을 찾지 못했습니다. 덤프 파일 경로를 인자로 주세요.');
  process.exit(2);
}
const REF = loadRef();

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
}
const byYear = arr => Object.fromEntries(arr.map(o => [o.year, o]));
const r1 = (v, d) => Number(v.toFixed(d));

// ── 0) 파라미터가 파이썬과 같은지 (테스트 설정 실수부터 의심한다) ─────────────
{
  const bad = Object.keys(REF.params).filter(k => ES.PARAMS[k] !== REF.params[k]);
  check('파라미터·dt 일치', bad.length === 0 && REF.dt === ES.DT,
    bad.length ? '다른 값: ' + bad.join(', ') : `dt=${ES.DT}`);
}

// ── 1) JS ↔ 파이썬 연도별 대조 ──────────────────────────────────────────────
const TOL = { ppm: 0.05, T: 0.005, pH: 0.0005, omega: 0.005 };
function compare(name, js, ref) {
  const n = ref.y.length;
  const mx = { ppm: 0, T: 0, pH: 0, omega: 0 };
  let yearsOk = js.length === n;
  for (let i = 0; i < n && yearsOk; i++) {
    const o = js[i];
    if (o.year !== ref.y[i]) { yearsOk = false; break; }
    mx.ppm = Math.max(mx.ppm, Math.abs(o.ppm - ref.ppm[i]));
    mx.T = Math.max(mx.T, Math.abs(o.T - ref.T[i]));
    mx.pH = Math.max(mx.pH, Math.abs(o.pH - ref.ph[i]));
    mx.omega = Math.max(mx.omega, Math.abs(o.omega - ref.om[i]));
  }
  const ok = yearsOk && Object.keys(TOL).every(k => mx[k] < TOL[k]);
  check(`대조 ${name} ${ref.y[0]}~${ref.y[n - 1]}`, ok,
    `max|Δ| ppm ${mx.ppm.toExponential(2)}  T ${mx.T.toExponential(2)}  pH ${mx.pH.toExponential(2)}  Ω ${mx.omega.toExponential(2)}`);
  return mx;
}
const histRun = ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.historicalEmissions });
const natRun = ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.natureEmissions });
compare('역사 배출', histRun, REF.runs.hist);
compare('자연(배출 0)', natRun, REF.runs.nature);

// ── 2) 1단계 기대값 표 재현 ─────────────────────────────────────────────────
{
  const H = byYear(ES.run({ fromYear: 1750, toYear: 2023 }));
  // 옛 'RMSE vs 지구 평균 1988~2023 = 2.82'는 출처 불명 배열 기준이라 지웠다. 새 관측 대조는 아래 5) 게이트.
  let so = 0, sl = 0;
  for (let y = 2014; y <= 2023; y++) { so += H[y].oceanFlux; sl += H[y].landFlux; }
  so /= 10; sl /= 10;
  check('2014~23 해양/육상 흡수 = 2.79/3.41', r1(so, 2) === 2.79 && r1(sl, 2) === 3.41,
    `${so.toFixed(3)} / ${sl.toFixed(3)} GtC/yr`);
  const exp = { 1850: 283.3, 1900: 289.0, 1950: 304.7, 2000: 365.0, 2023: 417.7 };
  for (const [y, v] of Object.entries(exp)) {
    check(`${y} = ${v} ppm`, r1(H[y].ppm, 1) === v, H[y].ppm.toFixed(2));
  }
  const o = H[2023];
  check('2023 T +1.19, pH 8.054, Ω 2.94', r1(o.T, 2) === 1.19 && r1(o.pH, 3) === 8.054 && r1(o.omega, 2) === 2.94,
    `T ${o.T.toFixed(3)}  pH ${o.pH.toFixed(4)}  Ω ${o.omega.toFixed(3)}`);
  // 질량 보존: 누적 배출 = 대기 증가 + 해양 흡수 + 토양 흡수
  const c = o.cum;
  check('누적 배출 = 대기 + 해양 + 토양', Math.abs(c.emitted - c.atm - c.ocean - c.land) < 1e-6,
    `배출 ${c.emitted.toFixed(1)} = 대기 ${c.atm.toFixed(1)} + 해양 ${c.ocean.toFixed(1)} + 토양 ${c.land.toFixed(1)} GtC`);
}

// ── 3) 자연 지구: 278.0 ± 0.1 ppm, T = 0 ± 0.01 ──────────────────────────────
{
  let lo = Infinity, hi = -Infinity, tmax = 0;
  for (const o of natRun) { lo = Math.min(lo, o.ppm); hi = Math.max(hi, o.ppm); tmax = Math.max(tmax, Math.abs(o.T)); }
  check('자연 지구 1750~2200 278.0±0.1 ppm, |T|≤0.01', lo >= 277.9 && hi <= 278.1 && tmax <= 0.01,
    `ppm ${lo.toFixed(4)}~${hi.toFixed(4)}  max|T| ${tmax.toExponential(2)}`);
}

// ═══════════════════════════ 게이트 B ═══════════════════════════════════════
// ── 4a) SSP 프리셋 3개: 파이썬(scen.py 정의) 대조 ────────────────────────────
{
  for (const k of Object.keys(ES.PRESETS)) {
    const js = ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.presetEmissions(k) });
    compare(`프리셋 ${ES.PRESETS[k].ko} (${ES.PRESETS[k].ssp})`, js, REF.runs[k]);
  }
}

// ═══════════════════════════ 2차 A4 게이트 ═════════════════════════════════
// 파라미터는 그대로 두고 새 관측(원본 data/raw → 정리 CSV)과 대조한다. 통과 기준은 지시서 A §4.
// '보고' 줄은 기준이 없는 표(실패가 아님)다. PR에 그대로 옮긴다.
function readClean(name) {
  const lines = fs.readFileSync(path.join(ROOT, 'data', name), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  const head = lines[0].split(',');
  return lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], Number(v)])));
}
const report = (name, detail) => console.log(`보고  ${name}${detail ? '  ' + detail : ''}`);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const slope = (xs, ys) => {           // 최소제곱 기울기
  const mx = mean(xs), my = mean(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
};
const ED = vm.runInContext('EARTH_DATA', ctx);
const LAST_EMIS = ED.emissions.startYear + ED.emissions.fossil.length - 1;
{
  // 역사 배출이 있는 마지막 해까지만 돌린다(그 뒤는 배출 0이 되어 비교가 무의미하다)
  const H = byYear(ES.run({ fromYear: 1750, toYear: LAST_EMIS }));
  // (a-1) CO2 vs NOAA 지구 평균
  const gl = readClean('co2_noaa_gl_annual.csv').filter(r => r.year <= LAST_EMIS);
  const rmse = Math.sqrt(mean(gl.map(r => (H[r.year].ppm - r.ppm) ** 2)));
  const bias = mean(gl.map(r => H[r.year].ppm - r.ppm));
  check(`A4 CO₂ vs NOAA 지구 평균 ${gl[0].year}~${gl[gl.length - 1].year} RMSE ≤ 4 ppm`, rmse <= 4,
    `RMSE ${rmse.toFixed(2)} ppm, 평균 편차(모형−관측) ${bias.toFixed(2)} ppm`);
  // (a-2) CO2 vs CMIP6 역사 농도 1850~1978
  const cm = readClean('co2_cmip6_hist.csv').filter(r => r.year >= 1850 && r.year <= 1978);
  let mx = 0, at = 0;
  for (const r of cm) { const d = H[r.year].ppm - r.ppm; if (Math.abs(d) > Math.abs(mx)) { mx = d; at = r.year; } }
  // 2026-10 첫 실행에서 실패: 최대 −10.57 ppm(1941년), 1937~1943년이 10 ppm을 넘는다. 기준 옆 설명의 '6~8 ppm'은
  // 1900(−6.67)·1950(−8.12)년 값과 같고, CMIP6(Law Dome)의 1930~40년대 빠른 상승을 이 모형이 따라가지 못해 생긴 차이다.
  // 지시서대로 파라미터·기준을 바꾸지 않고 실패로 둔다(사람이 기준을 정할 때까지 C3·C4는 진행하지 않음).
  const over = cm.filter(r => Math.abs(H[r.year].ppm - r.ppm) > 10).map(r => r.year);
  check('A4 CO₂ vs CMIP6 역사 농도 1850~1978 최대 오차 ≤ 10 ppm', Math.abs(mx) <= 10,
    `최대 ${mx.toFixed(2)} ppm (${at}년)` + (over.length ? `, 10 ppm 초과 ${over[0]}~${over[over.length - 1]} (${over.length}개 해)` : ''));
  report('  CO₂ 모형−CMIP6 (ppm)', [1850, 1900, 1950, 1978].map(y => `${y} ${(H[y].ppm - cm.find(r => r.year === y).ppm).toFixed(2)}`).join(' / '));
  // (a-3) 기온 vs HadCRUT5 2014~2023 평균
  const hc = Object.fromEntries(readClean('temp_hadcrut5_annual.csv').map(r => [r.year, r.anom]));
  const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const dT = mean(span(2014, 2023).map(y => H[y].T)) - mean(span(2014, 2023).map(y => hc[y]));
  check('A4 기온 vs HadCRUT5 2014~2023 평균 차이 ≤ 0.2 °C', Math.abs(dT) <= 0.2,
    `모형 ${mean(span(2014, 2023).map(y => H[y].T)).toFixed(3)} − 관측 ${mean(span(2014, 2023).map(y => hc[y])).toFixed(3)} = ${dT >= 0 ? '+' : ''}${dT.toFixed(3)} °C`);
  // (a-4) 10년 평균 표 (기준 없음)
  const dec = [];
  for (let d = 1900; d <= 2010; d += 10) {
    const ys = span(d, d + 9), m = mean(ys.map(y => H[y].T)), o = mean(ys.map(y => hc[y]));
    dec.push(`${d}s 모형 ${m.toFixed(2)} 관측 ${o.toFixed(2)} 차 ${(m - o >= 0 ? '+' : '')}${(m - o).toFixed(2)}`);
  }
  report('A4 기온 10년 평균 (°C, 1850~1900 기준)', '\n      ' + dec.join('\n      '));
  // (a-5) pH 추세 vs HOT
  const ph = readClean('ph_hot_annual.csv').filter(r => r.year <= LAST_EMIS);
  const xs = ph.map(r => r.year);
  const sObs = slope(xs, ph.map(r => r.ph)), sMod = slope(xs, xs.map(y => H[y].pH));
  report(`A4 pH 선형 추세 ${xs[0]}~${xs[xs.length - 1]} (pH/년)`,
    `모형 ${sMod.toExponential(3)}  HOT ${sObs.toExponential(3)}  비 ${(sMod / sObs).toFixed(2)}  |  절댓값(참고) 모형 ${H[xs[0]].pH.toFixed(3)}→${H[xs[xs.length - 1]].pH.toFixed(3)}, HOT ${ph[0].ph.toFixed(3)}→${ph[ph.length - 1].ph.toFixed(3)}`);
}

// ── (b) SSP: 조화 규칙 + 결과표 + RCMIP·AR6 비교 ─────────────────────────────
{
  // 조화: 조화식을 2023년에 대면 GCP 값과 정확히 같고(이음매에 계단 없음), 2050년부터는 SSP 원값과 같다.
  // 2023→2024 변화량은 SSP 경로 자체의 감소분이 섞이므로(SSP1-1.9는 2024년부터 빠르게 준다) 기준 없이 보고만 한다.
  let okEnd = true, okSeam = true, maxJump = 0;
  for (const k of Object.keys(ES.PRESETS)) {
    const fn = ES.presetEmissions(k), d = ED.ssp;
    for (let y = ES.HARMONIZE_END; y <= 2200; y++) {
      const e = fn(y), i = y - d.startYear;
      okEnd = okEnd && Math.abs(e.fossil - d[k].fossil[i]) < 1e-12 && Math.abs(e.luc - d[k].luc[i]) < 1e-12;
    }
    const seam = ES.PRESETS[k].fn(2023), h23 = ES.historicalEmissions(2023);
    okSeam = okSeam && Math.abs(seam.fossil - h23.fossil) < 1e-12 && Math.abs(seam.luc - h23.luc) < 1e-12;
    const e23 = fn(2023), e24 = fn(2024);
    maxJump = Math.max(maxJump, Math.abs(e24.fossil + e24.luc - e23.fossil - e23.luc));
    report(`  조화 ${k}`, `2023 SSP 원값 화석 ${(ES.E2023 - ES.PRESETS[k].offset2023.fossil).toFixed(3)} · 토지 ${(ES.L2023 - ES.PRESETS[k].offset2023.luc).toFixed(3)} / GCP ${ES.E2023.toFixed(3)} · ${ES.L2023.toFixed(3)} → 차이 ${ES.PRESETS[k].offset2023.fossil.toFixed(3)} · ${ES.PRESETS[k].offset2023.luc.toFixed(3)} GtC/yr, 2024 배출 ${(e24.fossil + e24.luc).toFixed(3)}`);
  }
  check('조화: 조화식(2023) = GCP 2023, 2050년 이후 = SSP 원값', okSeam && okEnd, `2023→2024 배출 변화 최대 ${maxJump.toFixed(3)} GtC/yr`);

  const conc = Object.fromEntries(readClean('ssp_concentrations.csv').map(r => [r.year, r]));
  // IPCC AR6 WG1 SPM Table SPM.1 (PDF 14쪽, docs/refs/발췌/IPCC_AR6_WG1_SPM_p14.jpg에서 확인), 2081~2100, 1850~1900 대비
  const AR6 = { ssp119: [1.4, 1.0, 1.8], ssp126: [1.8, 1.3, 2.4], ssp245: [2.7, 2.1, 3.5] };
  // SSP 기대값 (A4에서 처음 정한 값. 엔진·자료·조화 규칙이 바뀌면 이 표가 먼저 깨진다)
  const exp = {
    ssp245: { 2050: [486, 1.69], 2100: [548, 2.26], 2200: [576, 2.68] },
    ssp126: { 2050: [450, 1.52], 2100: [407, 1.39], 2200: [378, 1.24] },
    ssp119: { 2050: [419, 1.36], 2100: [357, 1.00], 2200: [323, 0.67] },
  };
  for (const k of Object.keys(ES.PRESETS)) {
    const R = byYear(ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.presetEmissions(k) }));
    const name = `${ES.PRESETS[k].ko} (${ES.PRESETS[k].ssp})`;
    for (const [y, [ppm, T]] of Object.entries(exp[k])) {
      const o = R[y];
      check(`  ${name} ${y} = ${ppm} ppm, +${T.toFixed(2)} °C`, Math.round(o.ppm) === ppm && r1(o.T, 2) === T,
        `${o.ppm.toFixed(1)} ppm, T ${o.T >= 0 ? '+' : ''}${o.T.toFixed(3)}, pH ${o.pH.toFixed(3)}, Ω ${o.omega.toFixed(2)}`);
    }
    const pct = y => 100 * (R[y].ppm - conc[y][k]) / conc[y][k];
    report(`  ${name} vs RCMIP SSP 농도`, [2050, 2100].map(y => `${y} 모형 ${R[y].ppm.toFixed(1)} / RCMIP ${conc[y][k].toFixed(1)} ppm (${pct(y) >= 0 ? '+' : ''}${pct(y).toFixed(1)} %)`).join('  |  ')
      + (Math.abs(pct(2100)) > 10 ? '  ← 10 % 초과' : ''));
    let t = 0;
    for (let y = 2081; y <= 2100; y++) t += R[y].T;
    t /= 20;
    const [best, lo, hi] = AR6[k];
    report(`  ${name} 2081~2100 평균 기온 vs AR6`, `모형 +${t.toFixed(2)} °C / AR6 ${best} (${lo}~${hi}) °C → ${t >= lo && t <= hi ? '범위 안' : '범위 밖'}`);
  }
}

// ── 4b) 레버 현재값 그대로 = 2024년 이후 배출이 2023년 값으로 일정 (0.1% 이내) ──
{
  const fn = ES.leverEmissions({ ...ES.LEVER_NOW });
  const e23 = ES.E2023 + ES.L2023;
  let mx = 0;
  for (let y = 2024; y <= 2200; y++) { const e = fn(y); mx = Math.max(mx, Math.abs((e.fossil + e.luc) / e23 - 1)); }
  check('레버 현재값 → 배출 일정 (2024~2200, 0.1% 이내)', mx < 1e-3, `최대 상대오차 ${mx.toExponential(2)}`);
  // 선형 전환: 2037년(중간)은 현재값과 목표의 정확히 가운데, 2050년 이후는 목표 유지
  const tgt = { fossilShare: 0.2, nuclearShare: 0.2, renewShare: 0.6, ev: 0.6, ccs: 1, otherCut: 0.5, forest: -1 };
  const mid = ES.leversAt(tgt, 2037), end = ES.leversAt(tgt, 2050), late = ES.leversAt(tgt, 2150);
  const midOk = Math.abs(mid.ev - (0.03 + 0.6) / 2) < 1e-12 && Math.abs(mid.forest - (ES.L2023 - 1) / 2) < 1e-12;
  const endOk = Object.keys(tgt).every(k => Math.abs(end[k] - tgt[k]) < 1e-12 && Math.abs(late[k] - tgt[k]) < 1e-12);
  const sumOk = Math.abs(mid.fossilShare + mid.nuclearShare + mid.renewShare - 1) < 1e-12;
  check('레버 선형 전환 (2037 중간값, 2050 이후 목표 유지, 전력 비중 합 1)', midOk && endOk && sumOk);
  const pre = ES.leverEmissions(tgt)(2023), hist = ES.historicalEmissions(2023);
  check('레버는 2023년까지 역사 배출을 바꾸지 않음', pre.fossil === hist.fossil && pre.luc === hist.luc);
}

// ── 4c) 농도 고정: 파이썬 run_fixed 대조 + 기대값 표 ─────────────────────────
{
  for (const c of ES.FIXED_PPMS) {
    const js = ES.run({ fromYear: 1750, toYear: 2200, fixedPpm: c });
    compare(`농도 고정 ${c} ppm`, js, REF.runs['fixed' + c]);
  }
  const exp = {
    418: { 2030: [1.26, 8.052], 2100: 1.42, 2200: 1.56, eq: 1.82 },
    560: { 2030: [1.94, 7.946], 2100: 2.37, 2200: 2.63, eq: 3.12 },
    1000: { 2030: [3.28, 7.721], 2100: 4.25, 2200: 4.76, eq: 5.71 },
  };
  for (const [c, e] of Object.entries(exp)) {
    const R = byYear(ES.run({ fromYear: 1750, toYear: 2200, fixedPpm: Number(c) }));
    const eq = 5.35 * Math.log(c / ES.PARAMS.c0) / ES.PARAMS.lam;
    const ok = r1(R[2030].T, 2) === e[2030][0] && r1(R[2030].pH, 3) === e[2030][1]
            && r1(R[2100].T, 2) === e[2100] && r1(R[2200].T, 2) === e[2200] && r1(eq, 2) === e.eq;
    let pinned = true;
    for (let y = 2024; y <= 2200; y++) pinned = pinned && Math.abs(R[y].ppm - c) < 1e-9;
    check(`  고정 ${c}: 2030 +${e[2030][0]} pH ${e[2030][1]} / 2100 +${e[2100]} / 2200 +${e[2200]} / 평형 ${e.eq}`, ok && pinned,
      `2030 T ${R[2030].T.toFixed(3)} pH ${R[2030].pH.toFixed(4)} | 2100 ${R[2100].T.toFixed(3)} | 2200 ${R[2200].T.toFixed(3)} | 평형 ${eq.toFixed(3)}`);
  }
}

// ── earth-model.js 역함수 ────────────────────────────────────────────────────
{
  let mx = 0;
  for (const p of [280, 418, 1000]) for (const t of [2, 18, 25]) {
    mx = Math.max(mx, Math.abs(M.pco2FromDic(M.seawaterState(p, t).dic, t).pco2 / p - 1));
  }
  check('pco2FromDic(seawaterState(p,t).dic) = p (상대오차 1e-9)', mx < 1e-9, mx.toExponential(2));
}

console.log(fails ? `\n실패 ${fails}건` : '\n전부 통과');
process.exit(fails ? 1 : 0);
