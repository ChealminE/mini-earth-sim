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

  // 2023년 배출 - 프리셋·레버가 모두 이 값에서 출발한다
  const E2023 = historicalEmissions(2023).fossil;   // 화석·산업 [GtC/yr]
  const L2023 = historicalEmissions(2023).luc;      // 토지이용 변화 [GtC/yr]
  const LAST_HIST_YEAR = 2023;                      // 이 해까지는 항상 역사 배출

  // ── 프리셋 시나리오 ───────────────────────────────────────────────────────
  // tools/earth_system_ref/scen.py 의 mk()와 같은 정의다 (대조 테스트로 확인).
  const PRESETS = {
    bau: {
      ko: '현재 추세',
      // 화석: 해마다 2023년 값의 1%씩 늘다가 2100년 이후 1.77배로 고정
      // 토지이용: 2023년 값에서 80년에 걸쳐 0으로
      fn: y => ({
        fossil: y < 2100 ? E2023 * (1 + 0.01 * (y - 2023)) : E2023 * 1.77,
        luc: L2023 * Math.max(0, 1 - (y - 2023) / 80),
      }),
    },
    paris: { ko: '파리협약', end: 2075 },       // 2075년 순배출 0까지 선형 감소
    nz2050: { ko: '2050 탄소중립', end: 2050 }, // 2050년 순배출 0까지 선형 감소
  };
  for (const k of ['paris', 'nz2050']) {
    const end = PRESETS[k].end;
    PRESETS[k].fn = y => {
      const f = Math.max(0, 1 - (y - 2023) / (end - 2023));
      return { fossil: E2023 * f, luc: L2023 * f };
    };
  }
  // 2023년까지는 역사 배출, 2024년부터 프리셋 경로
  function presetEmissions(name) {
    const pr = PRESETS[name];
    if (!pr) throw new Error('알 수 없는 프리셋: ' + name);
    return y => (y <= LAST_HIST_YEAR ? historicalEmissions(y) : pr.fn(y));
  }

  // ── 직접 설계 (레버) ─────────────────────────────────────────────────────
  // 레버 값은 '2050년 목표'다. 2024년의 현재값에서 2050년 목표까지 선형으로 바뀌고
  // 2050년 이후에는 목표를 유지한다. 학생이 "2050년까지 이렇게 바꾸면?"을 묻는 구조.
  //
  // 화석 배출(t) = E2023 × [ s_power·P(t) + s_road·R(t) + s_other·(1 − 기타감축(t)) ] − 탄소포집(t)
  //   P(t) = 화석발전비중(t) / f0                                   (발전 부문)
  //   R(t) = [ (1−ev) + ev·k_ev·(화석발전비중/f0) ] / [ (1−ev0) + ev0·k_ev ]   (도로 수송)
  //   전기차는 배출이 0이 아니라 '전력망만큼' 배출한다. 그래서 화석 발전을 줄여야
  //   전기차 효과도 커진다. 원자력과 재생은 이 식에서 배출이 같다(둘 다 0) - 의도된 것.
  // 토지이용 배출(t) = 산림 레버 (+L2023 = 벌채 지속, 0 = 벌채 중단, −1 = 대규모 조림)
  //
  // 상수 출처 (2026-10 웹 검색으로 확인, IEA·Ember 원문 페이지는 직접 열지 못함):
  //   f0 = 0.61, 원자력 0.09, 재생 0.30 : Ember, Global Electricity Review 2024 (2023년 자료)
  //       - 화석 61%, 원자력 9.1%, 재생 30% (Ember 2025 개정치로는 화석 60.6%)
  //   s_power = 0.40 : 미확인 - IEA 자료에서 2023년 발전·열 부문 비중을 직접 확인하지 못함
  //       (IEA는 "연료 연소 CO2의 40% 이상"이라고만 서술, 연도 불명)
  //   s_road = 0.16 : 미확인 - 간접 추정만 일치. IEA(2024) 승용·승합차 3.8 Gt가 도로 수송의
  //       60% 이상 → 도로 약 6 Gt ÷ 에너지 CO2 37.4 Gt(IEA CO2 Emissions in 2023) ≈ 0.16
  //   s_other = 0.44 : 위 두 값의 나머지 (1 − 0.40 − 0.16)
  //   ev0 = 0.03 : 미확인 - IEA Global EV Outlook 2024에 2023년말 전기차 4천만 대만 나오고
  //       보유 비율은 직접 나오지 않음 (GEVO 2025: 2024년말 약 4%)
  //   k_ev = 0.45 : 미확인 - 2023년 세계 전력망 기준 km당 배출비를 공개 자료에서 찾지 못함
  const LEVER_K = Object.freeze({
    s_power: 0.40, s_road: 0.16, s_other: 0.44,
    f0: 0.61, ev0: 0.03, k_ev: 0.45,
  });
  // 레버의 현재값(2023년). 전력 구성 세 비중의 합은 항상 1.
  const LEVER_NOW = Object.freeze({
    fossilShare: 0.61, nuclearShare: 0.09, renewShare: 0.30,
    ev: 0.03, ccs: 0, otherCut: 0, forest: L2023,
  });
  const LEVER_RANGE = Object.freeze({
    ccs: [0, 3],               // 탄소포집 [GtC/yr]
    otherCut: [0, 1],          // 기타 부문 감축 비율
    forest: [-1.0, L2023],     // 토지이용 배출 [GtC/yr]
    ev: [0, 1],
  });
  const LEVER_START = 2024, LEVER_TARGET = 2050;

  // 재생 연도의 실제 레버 값 (선형 전환 중의 값). 3D 표시도 이 값을 쓴다.
  function leversAt(target, y) {
    if (y < LEVER_START) return { ...LEVER_NOW };
    const f = Math.min(1, (y - LEVER_START) / (LEVER_TARGET - LEVER_START));
    const out = {};
    for (const k of Object.keys(LEVER_NOW)) {
      const t = target[k] != null ? target[k] : LEVER_NOW[k];
      out[k] = LEVER_NOW[k] + (t - LEVER_NOW[k]) * f;
    }
    return out;
  }
  function leverFossil(l) {
    const K = LEVER_K;
    const P = l.fossilShare / K.f0;
    const R = ((1 - l.ev) + l.ev * K.k_ev * (l.fossilShare / K.f0)) / ((1 - K.ev0) + K.ev0 * K.k_ev);
    return E2023 * (K.s_power * P + K.s_road * R + K.s_other * (1 - l.otherCut)) - l.ccs;
  }
  function leverEmissions(target) {
    return y => {
      if (y <= LAST_HIST_YEAR) return historicalEmissions(y);
      const l = leversAt(target, y);
      return { fossil: leverFossil(l), luc: l.forest };
    };
  }

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
        fixed,
        emissions: fixed ? null : Ef + El,          // 고정 모드에서는 배출이 정의되지 않는다
        fossil: fixed ? null : Ef, luc: fixed ? null : El,
        landC: cl, dicDeep: dicD,
        cum: { ...cum },
      });
    }
    return out;
  }

  const FIXED_PPMS = [280, 418, 560, 800, 1000];

  return {
    DT, PARAMS, PPM2GTC, E2023, L2023, LAST_HIST_YEAR,
    historicalEmissions, natureEmissions,
    PRESETS, presetEmissions,
    LEVER_K, LEVER_NOW, LEVER_RANGE, LEVER_START, LEVER_TARGET, leversAt, leverEmissions,
    FIXED_PPMS,
    run,
  };
})();
