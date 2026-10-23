// ============================================================================
// 3D 시각 언어 (2차 개편 D) - 엔진 값 → 3D 표현의 크기·개수·색을 정하는 순수 함수
// ----------------------------------------------------------------------------
// 규칙 (TASK_2차_D_3D시각.md)
//   1) 변수 하나에 표현 하나. 무엇이 무엇을 나타내는지는 3D 범례(index.html #legend3d)에 적는다.
//   2) 눈에 안 보이는 것(CO₂)은 [보기] 토글로만 켠다.
//   3) 근거가 있는 것만 수치에 묶는다. 근거 없는 대응(도시 크기·빙하 크기 등)은 '연출'이고
//      등록부(js/sources.js)에 kind: 'assumption' 으로 밝힌다. 각 함수 위에 등록부 키를 적었다.
//
// 왜 따로 떼었나: 렌더 코드(common.js) 안에 섞여 있으면 "1750년에 굴뚝이 0개인가", "Ω가 1 아래로 안 내려가면
// 정말 안 녹는가"를 node에서 확인할 수 없다(헤드리스 rAF는 4 FPS라 화면으로 하는 검증은 믿을 수 없다).
// tools/test_earth_visual.js 가 이 함수들을 직접 검사한다.
// 로드 순서: earth-system.js 뒤, common.js 앞 (index.html, tools/build_single_html.py AERIAL_JS)
// ============================================================================
const EarthVisual = (() => {
  const clamp01 = v => Math.min(1, Math.max(0, v));

  // ── CO₂ 보기 (D2) ─ 등록부 co2_dots ────────────────────────────────────
  // 점 개수는 농도에 정비례: 280 ppm일 때 N280개. 상한 MAX는 1269 ppm(현재 정책 2200년 근처까지
  // 가는 직접 설계 최대)보다 여유 있게 잡았다 - 점 700개 남짓을 매 프레임 움직여도 헤드리스에서 버틴다(PR 표 참고).
  const CO2_DOTS = { N280: 150, MAX: 800 };
  function co2DotCount(ppm) {
    return Math.min(CO2_DOTS.MAX, Math.max(0, Math.round(CO2_DOTS.N280 * ppm / 280)));
  }

  return { CO2_DOTS, co2DotCount, clamp01 };
})();

if (typeof module !== 'undefined') module.exports = { EarthVisual };
