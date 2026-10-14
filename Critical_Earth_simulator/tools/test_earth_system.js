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
  const histCo2 = [350.06,352.12,353.48,354.85,355.76,356.46,357.61,359.28,361.20,362.49,364.33,367.01,368.42,369.80,371.61,373.99,376.21,377.97,380.23,382.05,384.10,385.83,387.62,389.82,391.67,394.14,396.49,398.55,401.48,404.31,406.50,408.89,411.39,413.65,416.02,418.24];
  const rmse = Math.sqrt(histCo2.reduce((s, v, i) => s + (H[1988 + i].ppm - v) ** 2, 0) / histCo2.length);
  check('RMSE vs 지구 평균 1988~2023 = 2.82', r1(rmse, 2) === 2.82, rmse.toFixed(3) + ' ppm');
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
// ── 4a) 프리셋 3개: 파이썬(scen.py 정의) 대조 + 기대값 표 ─────────────────────
{
  const exp = {
    bau:    { 2050: [495, 1.73], 2100: [702, 2.89, { pH: 7.857 }], 2200: [1269, 5.16, { omega: 1.41 }] },
    paris:  { 2050: [451, 1.52], 2100: [415, 1.44], 2200: [399, 1.42] },
    nz2050: { 2050: [422, 1.38], 2100: [383, 1.17], 2200: [375, 1.19] },
  };
  for (const k of Object.keys(exp)) {
    const js = ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.presetEmissions(k) });
    compare(`프리셋 ${ES.PRESETS[k].ko}`, js, REF.runs[k]);
    const R = byYear(js);
    for (const [y, [ppm, T, extra]] of Object.entries(exp[k])) {
      const o = R[y];
      let ok = Math.round(o.ppm) === ppm && r1(o.T, 2) === T;
      let msg = `${o.ppm.toFixed(1)} ppm, T +${o.T.toFixed(3)}`;
      if (extra && extra.pH != null) { ok = ok && r1(o.pH, 3) === extra.pH; msg += `, pH ${o.pH.toFixed(4)}`; }
      if (extra && extra.omega != null) { ok = ok && r1(o.omega, 2) === extra.omega; msg += `, Ω ${o.omega.toFixed(3)}`; }
      check(`  ${ES.PRESETS[k].ko} ${y} = ${ppm} ppm, +${T} °C`, ok, msg);
    }
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
