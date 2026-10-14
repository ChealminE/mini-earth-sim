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
