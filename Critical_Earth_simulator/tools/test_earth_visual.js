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
  check('1950년 전기차 0', V.presetSociety(at(r, 1950).fossil, 1950, ES.LEVER_NOW, ES.E2023, ES.LAST_HIST_YEAR).ev === 0);
  check('자연 지구: 누적 0 → 도시 규모 0', RUNS.nature.every(o => V.cityLevel(o.cumFossilMax) === 0));
}

console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exit(fails ? 1 : 0);
