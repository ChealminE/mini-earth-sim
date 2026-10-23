// ============================================================================
// 3D 시각 언어(2차 개편 D) 대응 함수 검사 - js/earth-visual.js
// ----------------------------------------------------------------------------
// 화면(헤드리스 rAF 4 FPS)으로는 "1750년에 굴뚝이 없는가" 같은 것을 믿고 확인할 수 없어서
// 엔진 궤적을 node에서 직접 돌려 대응 함수의 결과를 검사한다.
// 실행: node tools/test_earth_visual.js      (실패하면 종료 코드 1)
// ============================================================================
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { EarthVisual: V } = require(path.join(ROOT, 'js', 'earth-visual.js'));

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

console.log(fails ? `\n${fails}개 실패` : '\n전부 통과');
process.exit(fails ? 1 : 0);
