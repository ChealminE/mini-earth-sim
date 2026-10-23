// ============================================================================
// 3D 시각 언어(2차 개편 D) 대응 함수 검사 - js/earth-visual.js
// ----------------------------------------------------------------------------
// 화면(헤드리스 rAF 4 FPS)으로는 "1750년에 굴뚝이 없는가" 같은 것을 믿고 확인할 수 없어서
// 엔진 궤적을 node에서 직접 돌려 대응 함수의 결과를 검사한다.
// 실행: node tools/test_earth_visual.js      (실패하면 종료 코드 1)
// ============================================================================
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');
const vm = require('vm');
const { EarthVisual: V } = require(path.join(ROOT, 'js', 'earth-visual.js'));

// 엔진은 test_earth_system.js 와 같은 방식으로 읽는다(브라우저용 전역 스크립트)
const ctx = vm.createContext({ console, Math });
for (const f of ['js/earth-model.js', 'js/earth-data.js', 'js/earth-system.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const ES = vm.runInContext('EarthSystem', ctx);
const RUNS = {};
for (const p of ['ssp245', 'ssp126', 'ssp119']) {
  RUNS[p] = V.annotateCumFossil(ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.presetEmissions(p) }));
}
RUNS.nature = V.annotateCumFossil(ES.run({ fromYear: 1750, toYear: 2200, emissionsFn: ES.natureEmissions }));
const at = (run, y) => run[y - run[0].year];

let fails = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
}

// ── D2 CO₂ 보기 ──
check('CO₂ 점: 280 ppm → N280개', V.co2DotCount(280) === V.CO2_DOTS.N280, `${V.co2DotCount(280)}`);
check('CO₂ 점: 정비례 (560 ppm → 2배)', V.co2DotCount(560) === 2 * V.CO2_DOTS.N280, `${V.co2DotCount(560)}`);
check('CO₂ 점: 1269 ppm 이 상한 안', V.co2DotCount(1269) < V.CO2_DOTS.MAX, `${V.co2DotCount(1269)} < ${V.CO2_DOTS.MAX}`);
check('CO₂ 점: 상한에서 멈춤', V.co2DotCount(5000) === V.CO2_DOTS.MAX);

// ── D3 도시 ──
{
  const r = RUNS.ssp245, row = y => `${y}: 굴뚝 ${V.stackCount(at(r, y).fossil)} 도시 ${V.cityLevel(at(r, y).cumFossilMax).toFixed(2)} 차 ${V.carFrac(V.cityLevel(at(r, y).cumFossilMax)).toFixed(2)}`;
  console.log('      ' + [1750, 1850, 1900, 1950, 2023, 2100, 2200].map(row).join(' | '));
  check('1750년: 굴뚝 0개, 자동차 없음', V.stackCount(at(r, 1750).fossil) === 0 && V.carFrac(V.cityLevel(at(r, 1750).cumFossilMax)) === 0);
  check('1850년: 굴뚝이 생김 (산업혁명)', V.stackCount(at(r, 1850).fossil) >= 1);
  check('1900년: 아직 자동차 없음', V.carFrac(V.cityLevel(at(r, 1900).cumFossilMax)) === 0);
  check('2023년: 굴뚝 최대', V.stackCount(at(r, 2023).fossil) === V.CITY.STACKS);
  let mono = true;
  for (const run of Object.values(RUNS)) for (let i = 1; i < run.length; i++) if (V.cityLevel(run[i].cumFossilMax) < V.cityLevel(run[i - 1].cumFossilMax)) mono = false;
  check('건물은 줄지 않는다 (누적 최댓값, 4개 궤적 전 구간)', mono);
  const u = RUNS.ssp119;
  check('1.5 °C 2100: 화석 배출 음수 → 굴뚝 0, 포집 타워', V.stackCount(at(u, 2100).fossil) === 0 &&
    V.presetSociety(at(u, 2100).fossil, 2100, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR).removal > 0,
    `F ${at(u, 2100).fossil.toFixed(2)}`);
  check('1.5 °C 2100: 건물은 2023년 규모 유지', V.cityLevel(at(u, 2100).cumFossilMax) >= V.cityLevel(at(u, 2023).cumFossilMax));
  const s23 = V.presetSociety(at(r, 2023).fossil, 2023, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR);
  check('2023년까지는 현재 사회값 그대로 (전기차 = LEVER_NOW.ev)', s23.ev === ES.LEVER_NOW.ev && s23.removal === 0);
  const s1750 = V.presetSociety(at(r, 1750).fossil, 1750, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR);
  check('1750년: 전기차·원자력·태양광 없음', s1750.ev === 0 && s1750.nuclear === 0 && s1750.renew === 0);
  check('1950년 전기차 0', V.presetSociety(at(r, 1950).fossil, 1950, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR).ev === 0);
  check('자연 지구: 누적 0 → 도시 규모 0', RUNS.nature.every(o => V.cityLevel(o.cumFossilMax) === 0));
}

// ── D4 빙하·산호 ──
check('빙하: 0 °C 기준 1, 기온이 오르면 줄어듦', V.glacierFrac(0) === 1 && V.glacierFrac(1) < 1 && V.glacierFrac(2.5) < V.glacierFrac(1) && V.glacierFrac(9) === 0);
check('산호: 보고서 무렵(1.09 °C)까지 100 %', V.coralHealthy(0) === 1 && V.coralHealthy(1.09) === 1);
check('산호: 1.5 °C 20 % (SR1.5 추가 70~90 % 감소의 가운데)', Math.abs(V.coralHealthy(1.5) - 0.2) < 1e-12);
check('산호: 2 °C 1 % (99 % 넘게 손실), 그 위는 유지', Math.abs(V.coralHealthy(2) - 0.01) < 1e-12 && V.coralHealthy(4) === 0.01);
{
  let mono = true;
  for (let T = 0; T <= 3; T += 0.01) if (V.coralHealthy(T + 0.01) > V.coralHealthy(T) + 1e-12) mono = false;
  check('산호: 기온에 단조감소', mono);
  const row = p => [2023, 2100, 2200].map(y => `${y} ${(100 * V.coralHealthy(at(RUNS[p], y).T)).toFixed(0)}%`).join(' ');
  console.log(`      산호 건강 비율  현재 정책: ${row('ssp245')} | 2 °C: ${row('ssp126')} | 1.5 °C: ${row('ssp119')} | 자연: ${row('nature')}`);
}

// ── D5 조개 껍데기 ──
{
  const omegaMin = Math.min(...['ssp245', 'ssp126', 'ssp119'].flatMap(p => RUNS[p].map(o => o.omega)));
  check('조개: 자연 지구 1750년 Ω = OMEGA_REF → 옅어짐 0', Math.abs(at(RUNS.nature, 1750).omega - V.SHELL.OMEGA_REF) < 0.01 && V.shellState(at(RUNS.nature, 1750).omega).fade < 0.01,
    `Ω ${at(RUNS.nature, 1750).omega.toFixed(3)}`);
  check('조개: Ω ≥ 1이면 녹지 않음 (경계는 Ω = 1)', V.shellState(1).dissolve === 0 && V.shellState(0.99).dissolve > 0 && V.shellState(0.5).dissolve === 1);
  check('조개: SSP 3개 전 구간 Ω > 1 → 억지로 녹이지 않음', omegaMin > 1 && V.shellState(omegaMin).dissolve === 0, `최소 Ω ${omegaMin.toFixed(2)}`);
  console.log(`      현재 정책 껍데기 옅어짐 2023 ${V.shellState(at(RUNS.ssp245, 2023).omega).fade.toFixed(2)} · 2100 ${V.shellState(at(RUNS.ssp245, 2100).omega).fade.toFixed(2)} · 2200 ${V.shellState(at(RUNS.ssp245, 2200).omega).fade.toFixed(2)}`);
}

// ── D5 지시약 ──
check('지시약: 7.6·8.2 끝 색, 범위 밖은 끝 색', String(V.phIndicatorRgb(7.6)) === String(V.phIndicatorRgb(7.0)) && String(V.phIndicatorRgb(8.2)) === String(V.phIndicatorRgb(8.5)));
{
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let mono = true;
  for (let p = 7.6; p < 8.19; p += 0.01) if (lum(V.phIndicatorRgb(p + 0.01)) > lum(V.phIndicatorRgb(p)) + 1) mono = false;   // 1 = 8비트 반올림 여유
  check('지시약: pH가 낮을수록 밝아짐(색 순서가 밝기로도 읽힘)', mono);
}

console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exit(fails ? 1 : 0);
