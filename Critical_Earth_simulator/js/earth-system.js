// ============================================================================
// 지구 시스템 엔진 - "인간활동 → 배출 → 탄소순환 → 대기 CO2 → 나머지 변수"를
// 시간에 따라 굴린다. (DOM·three.js·Chart.js 없음, 순수 계산)
// ----------------------------------------------------------------------------
// 왜 만들었나:
//   예전 미래 예측 탭은 CO2를 슬라이더로 넣고 pH·기온을 그 자리에서 평형값으로 냈다.
//   그러면 "같은 418 ppm이라도 막 도달했을 때와 수백 년 머문 뒤가 다르다"는 것,
//   그리고 배출한 탄소의 상당 부분을 바다와 숲이 받아 준다는 것이 보이지 않는다.
//   그래서 CO2를 '입력'이 아니라 배출을 적분한 '결과'로 바꾼다.
//
// 구조 (4박스 탄소순환 + 2층 에너지 균형):
//   대기 ⇄ 표층 해수(혼합층 100 m) ⇄ 심층 해수(2000 m)
//   대기 ⇄ 토양·식생 (광합성은 CO2 시비 효과 β, 호흡은 기온 Q10)
//   기온 T(표층·대기) ⇄ Td(심층) - 복사강제력 5.35·ln(CO2/c0)으로 데워진다
// 피드백:
//   기온 → 해수 CO2 용해도(K0) 감소 → 바다가 덜 흡수 → CO2 증가
//   기온 → 토양 호흡(Q10) 증가 → 토양이 덜 흡수 → CO2 증가
//
// 참조 구현: tools/earth_system_ref/engine.py 의 run()을 한 줄씩 그대로 옮겼다.
//   갱신 순서까지 같아야 tools/test_earth_system.js 대조가 맞는다. 식을 고치려면
//   engine.py를 먼저 고치고 양쪽을 대조하라.
// 해수 화학은 js/earth-model.js 함수를 그대로 부른다(식을 다시 쓰지 않는다).
// 로드 순서: earth-model.js → earth-data.js → earth-system.js
// ============================================================================

const EarthSystem = (() => {
  const PPM2GTC = 2.124;              // 대기 CO2 1 ppm = 2.124 GtC
  const MOL2GTC = 12e-15;             // 탄소 1 mol = 12 g = 12e-15 GtC
  const A_OCEAN = 3.61e14;            // 바다 면적 [m²]
  const RHO = 1025;                   // 해수 밀도 [kg/m³]

  // 전진 오일러 적분이라 결과가 dt에 따라 조금씩 달라진다. 보정값과 파이썬 대조가
  // 전부 0.25년을 전제로 하므로 바꾸지 않는다.
  const DT = 0.25;

  // engine.py의 P와 같은 값. 지구 평균 CO2(1988~2023)에 맞춰 격자 탐색으로 고른 값이다.
  const PARAMS = Object.freeze({
    h_mix: 100.0, h_deep: 2000.0, k_gas: 0.25, tau_mix: 6.0,   // 해양
    npp0: 60.0, tau_land: 50.0, beta: 0.38, q10: 2.0,          // 토양·식생
    lam: 1.2, Cs: 8.0, Cd: 100.0, gamma: 0.7,                  // 2층 기온 (W, yr, m², K)
    sst0: 18.0, c0: 278.0,
  });

  // ── 배출량 ────────────────────────────────────────────────────────────────
  // 역사 배출 [GtC/yr]. 자료가 없는 해는 0 (engine.py의 hist와 같음).
  function historicalEmissions(y) {
    const e = EARTH_DATA.emissions, i = y - e.startYear;
    if (i < 0 || i >= e.fossil.length) return { fossil: 0, luc: 0 };
    return { fossil: e.fossil[i], luc: e.luc[i] };
  }
  const natureEmissions = () => ({ fossil: 0, luc: 0 });

  // ── 적분 ──────────────────────────────────────────────────────────────────
  // opts.fixedPpm 이 있으면 fixFrom(기본 2024)년부터 대기 CO2를 그 값에 고정한다
  // (농도 고정 모드). 대기는 적분하지 않고 해양·토양·기온만 그 농도에서 계속 적분한다.
  // 이때 emissions에는 "농도를 유지하려면 필요한 배출"(해양+토양 흡수 + 대기 변화)을 넣는다.
  function run({ fromYear = 1750, toYear = 2200, emissionsFn = historicalEmissions,
                 params = PARAMS, fixedPpm = null, fixFrom = 2024 } = {}) {
    const p = params, dt = DT;
    const Ms = A_OCEAN * p.h_mix * RHO, Md = A_OCEAN * p.h_deep * RHO;
    const ca0 = p.c0 * PPM2GTC;
    let ca = ca0;
    let dicS = seawaterState(p.c0, p.sst0).dic;
    let dicD = dicS;
    const cl0 = p.npp0 * p.tau_land;
    let cl = cl0;
    let T = 0, Td = 0;
    const cum = { atm: 0, ocean: 0, land: 0, emitted: 0 };
    const steps = Math.round(1 / dt);
    const out = [];

    for (let y = fromYear; y <= toYear; y++) {
      const fixed = fixedPpm != null && y >= fixFrom;
      let Ef, El;
      if (fixed) {
        Ef = 0; El = 0;
        if (y === fixFrom) {
          // 고정 첫해: 대기를 한 번에 목표 농도로 옮긴다. 그 차이도 "필요한 배출"로 센다.
          cum.emitted += fixedPpm * PPM2GTC - ca;
          ca = fixedPpm * PPM2GTC;
        }
      } else {
        const e = emissionsFn(y);
        Ef = e.fossil; El = e.luc;
      }
      let fo = 0, fl = 0;
      for (let k = 0; k < steps; k++) {
        // 1) 시작 시점의 ppm으로 모든 플럭스를 계산
        const ppm = ca / PPM2GTC;
        const pco2s = pco2FromDic(dicS, p.sst0 + T).pco2;
        const Fao = p.k_gas * (ppm - pco2s);                         // GtC/yr 대기→표층
        const Fsd = (dicS - dicD) * Ms / p.tau_mix * MOL2GTC;        // 표층→심층
        const npp = p.npp0 * (1 + p.beta * Math.log(ppm / p.c0));
        const resp = cl / p.tau_land * p.q10 ** (T / 10);
        const Fland = npp - resp;                                    // 대기→토양
        // 2) 대기 → 토양 → 표층 → 심층 순으로 갱신
        if (fixed) cum.emitted += (Fao + Fland) * dt;                // 고정 농도를 유지하는 데 필요한 배출
        else { ca += (Ef + El - Fao - Fland) * dt; cum.emitted += (Ef + El) * dt; }
        cl += (Fland - El) * dt;
        dicS += (Fao - Fsd) / MOL2GTC / Ms * dt;
        dicD += Fsd / MOL2GTC / Md * dt;
        // 3) 기온 T, Td 갱신 (Td는 갱신된 T를 쓴다 - engine.py와 같은 순서)
        const F = radiativeForcing(ppm, p.c0);
        T += (F - p.lam * T - p.gamma * (T - Td)) / p.Cs * dt;
        Td += p.gamma * (T - Td) / p.Cd * dt;
        fo += Fao * dt; fl += Fland * dt;
      }
      cum.ocean += fo; cum.land += fl;
      cum.atm = ca - ca0;
      const ppm = ca / PPM2GTC;
      const sst = p.sst0 + T;
      const sw = pco2FromDic(dicS, sst);
      out.push({
        year: y, ppm, T, Td, sst,
        pH: sw.pH, omega: sw.omega, co2aq: sw.co2aq, hco3: sw.hco3, co3: sw.co3, dic: dicS,
        bufferRel: bufferCapacityRel(ppm, sst, p.c0, p.sst0),
        oceanFlux: fo, landFlux: fl,
        emissions: fixed ? null : Ef + El,
        fossil: fixed ? null : Ef, luc: fixed ? null : El,
        landC: cl, dicDeep: dicD,
        cum: { ...cum },
      });
    }
    return out;
  }

  return {
    DT, PARAMS, PPM2GTC,
    historicalEmissions, natureEmissions,
    run,
  };
})();
