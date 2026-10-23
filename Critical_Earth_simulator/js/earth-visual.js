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
  // 점 개수는 농도에 정비례: 280 ppm일 때 N280개. 상한 MAX는 지시서가 성능 확인 기준으로 정한 1269 ppm(680개)보다
  // 여유 있게 잡았다(약 1490 ppm에서 포화). 점은 Points 하나에 setDrawRange로 그려 개수와 상관없이 드로우콜 1번이다.
  const CO2_DOTS = { N280: 150, MAX: 800 };
  function co2DotCount(ppm) {
    return Math.min(CO2_DOTS.MAX, Math.max(0, Math.round(CO2_DOTS.N280 * ppm / 280)));
  }

  // ── 도시가 역사를 따라 자란다 (D3) ─ 등록부 city_scale (연출) ─────────────────
  // 근거 있는 인과가 아니다. "그해 화석연료 배출이 클수록 도시가 크고 굴뚝이 많다"를 보이려고 정한 대응이다.
  //   건물  : 누적 화석 배출의 '지금까지 최댓값'(GtC)에 묶는다 → 배출이 줄거나 음수(포집)가 돼도 건물은 남는다
  //   굴뚝·연기: 그해 화석 배출(GtC/년)에 묶는다 → 배출이 줄면 굴뚝이 꺼지고 연기가 옅어진다, 0 이하면 없다
  //   자동차: 도시 규모를 따라 늘고(석유 시대 전에는 없음), 그중 전기차 비율은 시나리오·레버가 정한다
  // 모양은 로그(포화형) - 1750~1850년의 작은 배출 차이도 보이고, 2023년 이후의 큰 값에서는 더 커지지 않는다.
  const CITY = {
    // C0 = 5로 했더니 1950년(누적 63 GtC)에 이미 도시 규모 0.46이라 '자라는' 모습이 안 보였다 → 20으로 늦춤
    C0: 20, CREF: 1500,    // 건물: log(1 + C/C0) / log(1 + CREF/C0). CREF ≈ 현재 정책 2200년 누적(약 1490 GtC)
    F0: 0.05, FREF: 12,    // 굴뚝: log(1 + F/F0) / log(1 + FREF/F0). F0 ≈ 1850년 배출, FREF ≈ 2023년(10.4)보다 조금 위
    STACKS: 6,             // 굴뚝 최대 개수
    CAR_START: 0.25,       // 도시 규모가 이만큼(누적 약 28 GtC, 1930년 무렵) 넘어야 자동차가 나온다
    CAR_FULL: 0.8,
  };
  const logSat = (x, x0, xref) => (x <= 0 ? 0 : clamp01(Math.log1p(x / x0) / Math.log1p(xref / x0)));
  const cityLevel = cumMax => logSat(cumMax, CITY.C0, CITY.CREF);         // 0(마을) ~ 1(대도시)
  const stackLevel = fossil => logSat(fossil, CITY.F0, CITY.FREF);        // 0(굴뚝 없음) ~ 1
  const stackCount = fossil => Math.round(CITY.STACKS * stackLevel(fossil));
  const carFrac = level => clamp01((level - CITY.CAR_START) / (CITY.CAR_FULL - CITY.CAR_START));

  // 엔진 궤적(EarthSystem.run 결과)에 누적 화석 배출의 '지금까지 최댓값'을 붙인다(o.cumFossilMax, GtC).
  // 1750년 이전 배출은 0으로 본다(엔진도 1750년에서 시작한다).
  function annotateCumFossil(run) {
    let cum = 0, max = 0;
    for (const o of run) { cum += o.fossil || 0; max = Math.max(max, cum); o.cumFossilMax = max; }
    return run;
  }

  // 시나리오(직접 설계가 아닌 SSP)의 미래 사회 모습. SSP 배출 자료에는 전력 구성·전기차 비율이 없으므로
  // "2023년보다 화석 배출이 줄어든 만큼(red) 전기차·재생에너지가 늘었다"고 연출한다. 화석 배출이 음수인 해는
  // 대기에서 탄소를 거둬들인다는 뜻이라 포집 타워를 세운다(−3 GtC/년에서 최대 = 직접 설계 레버 최대).
  // now = EarthSystem.LEVER_NOW, e2023 = EarthSystem.E2023. 2023년까지(역사)는 now 그대로 두되, 그 기술이 없던
  // 시대에는 0으로 둔다(예전에는 1750년에도 냉각탑·태양광 패널이 서 있었다): 원자력 1960년 전, 태양광 패널 2000년 전,
  // 전기차 2010년 전. 이 연도는 '대략 그 무렵부터 보이게' 정한 연출이다(등록부 city_scale).
  function presetSociety(fossil, year, now, e2023, lastHist) {
    if (year <= lastHist) {
      return { ev: year < 2010 ? 0 : now.ev, renew: year < 2000 ? 0 : now.renewShare, nuclear: year < 1960 ? 0 : now.nuclearShare, removal: 0 };
    }
    const red = clamp01(1 - fossil / e2023);
    return {
      ev: Math.max(now.ev, red),
      renew: now.renewShare + (1 - now.renewShare - now.nuclearShare) * red,
      nuclear: now.nuclearShare,
      removal: clamp01(-fossil / 3),
    };
  }

  // ── 빙하 (D4) ─ 등록부 glacier_scale (연출) ───────────────────────────────
  // 빙하의 길이(크기)를 기온 편차에 묶는다: 0 °C에서 1(기준), T_GONE °C에서 0. 실제 빙하 질량과 기온의 관계식이 아니다.
  const GLACIER = { T_GONE: 5 };
  const glacierFrac = T => clamp01(1 - (T || 0) / GLACIER.T_GONE);

  // ── 산호 백화 (D4) ─ 등록부 coral_sr15 (IPCC SR1.5 SPM B.4.2, PDF 8쪽) ──────────────
  // 원문: "Coral reefs, for example, are projected to decline by a further 70–90% at 1.5°C (high confidence)
  //        with larger losses (>99%) at 2°C (very high confidence)."
  // 'a further' = 보고서 당시 산호초에서 더 줄어든다는 뜻이다. 그래서 0 °C가 아니라 '보고서 무렵의 온난화'를 100 %로 둔다:
  //   T_NOW = 1.09 °C (AR6 WG1 SPM A.1.2, PDF 5쪽: 2011–2020년이 1850–1900년보다 1.09 °C 높음)
  //   1.5 °C → 남는 비율 10~30 %의 가운데 20 %,  2 °C → 1 % (99 % 넘게 손실), 2 °C 위는 2 °C 값 유지.
  //   사이는 선형 보간. T_NOW를 0으로 바꾸면 지시서 원안(0 °C → 1.5 °C → 2 °C 보간)이 된다.
  const CORAL = { T_NOW: 1.09, T15: 1.5, H15: 0.2, T20: 2.0, H20: 0.01 };
  function coralHealthy(T) {
    if (T <= CORAL.T_NOW) return 1;
    if (T <= CORAL.T15) return 1 + (CORAL.H15 - 1) * (T - CORAL.T_NOW) / (CORAL.T15 - CORAL.T_NOW);
    if (T <= CORAL.T20) return CORAL.H15 + (CORAL.H20 - CORAL.H15) * (T - CORAL.T15) / (CORAL.T20 - CORAL.T15);
    return CORAL.H20;
  }

  return { CO2_DOTS, co2DotCount, GLACIER, glacierFrac, CORAL, coralHealthy, CITY, cityLevel, stackLevel, stackCount, carFrac, annotateCumFossil, presetSociety, clamp01 };
})();

if (typeof module !== 'undefined') module.exports = { EarthVisual };
