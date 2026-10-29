// ============================================================================
// 페트로바 스코프 — 가시광 ↔ 적외선(장파 복사) 보기 (3차 F)
// ----------------------------------------------------------------------------
// 현재 실태·미래 예측의 종이 테마 씬에서 3D를 '열화상 카메라'처럼 바꿔 본다. 기준 그림 docs/refs/petrovascope.webp.
// 과학 기준 (지시서 tools/TASK_3차_F_페트로바스코프.md §0 — 바꾸지 말 것)
//   · 가시광 보기는 그대로: CO₂는 눈에 보이지 않는다(스모그·노란 안개 금지, 2차 D2)
//   · 적외선 보기 = 지구가 스스로 내보내는 장파 복사를 본다(반사가 아님). 햇빛은 주로 단파라 이 보기에서는 밝지 않다
//   · CO₂는 고르게 섞인 기체 → 입자는 상자 공기 전체에 고르게(common.js scatterInAir, [CO₂ 보기]와 같은 배치 함수)
//   · 파장 문구는 "CO₂ 흡수대 약 15 μm" ("8~15 μm" 금지 — 8~13 μm는 CO₂가 거의 흡수하지 않는 '대기의 창')
//   · 변수 하나에 표현 하나(earth-visual.js 원칙 1): 입자 = CO₂ 양(ppm) · 화살표 = 에너지 흐름(W/m²) · 밝기 = 온도
//   · 크기·밝기는 엔진 값에서 계산하고, 과장한 것은 배율을 화면에 적는다(변화량 ×CHANGE_SCALE)
// 기술 기준
//   · 후처리(EffectComposer) 없음 — vendor three.min.js 는 r160 UMD. 블룸 느낌은 보케 텍스처 + AdditiveBlending(겹치면 밝아짐)
//   · 뚜껑·옆벽은 transmission 재질이라 그 뒤의 반투명 입자가 사라진다(2차 F5 구름 사건) → 켜는 동안 뚜껑은 숨기고
//     옆벽은 transmission 0 + 옅은 테두리선. 끌 때 저장해 둔 값으로 정확히 되돌린다(덤: '뚜껑이 열을 가둔다' 오개념도 피함)
//   · 부품은 처음 켤 때 그 씬에 만든다(꺼 둔 동안 드로우콜 0). 장면 톤은 #gl 캔버스의 CSS filter(--ir-filter) 하나로
// 로드 순서: common.js 뒤, tab-current.js 앞 (index.html, tools/build_single_html.py AERIAL_JS)
// ============================================================================

// ── 계산 (DOM·three.js 없음, node 검사: tools/test_earth_visual.js) ──
const IRScopeCore = (() => {
  // 지구 에너지 수지 기준값 [W/m², 전 지구 평균] — IPCC AR6 WG1 7장 그림 7.2. 원문 쪽과 대조하지 못해 등록부 'energy_budget_ar6' 는 unverified
  const BASE = { sunIn: 340, sunOut: 100, surfLw: 398, backLw: 342, olr: 239 };
  const SIGMA = 5.670374e-8, T0 = 288;          // 슈테판-볼츠만 상수 [W/m²/K⁴], 기준 지표 온도 [K]
  const DLW_PER_K = 4 * SIGMA * T0 ** 3;         // σ(T0+T)⁴ 의 선형화 기울기 ≈ 5.4 W/m² per °C
  // 변화량은 기준값에 비해 작아(2023년 강제력 약 2 W/m² vs 기준 342) 실제 비율로는 안 보인다 → 고정 배율로 키우고 화면에 적는다
  const CHANGE_SCALE = 20;
  // 화살표 다섯 종. sw = 단파(햇빛)라 적외선 보기에서는 외곽선만
  const ARROWS = [
    { key: 'sunIn', no: '①', name: '햇빛 들어옴', band: '단파', sw: true },
    { key: 'sunOut', no: '②', name: '햇빛 반사', band: '단파', sw: true },
    { key: 'surfLw', no: '③', name: '지표가 내보내는 열', band: '장파' },
    { key: 'backLw', no: '④', name: '대기가 되돌려 보내는 열', band: '장파' },
    { key: 'olr', no: '⑤', name: '우주로 나가는 열', band: '장파' },
  ];
  // ppm·T(그해 엔진 값) → 화살표별 { base, delta }. p = EarthSystem.PARAMS (c0, lam)
  //   ③ 지표 장파: + 4σT0³·T          ④ 되돌려 보내는 장파: + F (단순화: 강제력만큼 늘어난 것으로 표시)
  //   ⑤ 우주로 나가는 장파: − N, N = F − λT (대기 꼭대기 불균형). 기온이 따라 오르면 N이 줄어 ⑤가 저절로 회복된다
  //     — '열이 영원히 갇힌다' 오개념을 막는 핵심이라 단순화하지 않는다
  function fluxes(ppm, T, p) {
    const F = radiativeForcing(ppm, p.c0), N = F - p.lam * T;
    const d = { sunIn: 0, sunOut: 0, surfLw: DLW_PER_K * T, backLw: F, olr: -N };
    const out = { F, N };
    for (const a of ARROWS) out[a.key] = { base: BASE[a.key], delta: d[a.key] };
    return out;
  }
  // 화살표 굵기: 기준 부분은 실제 비율(기준값 / 340), 변화 띠는 같은 단위에 CHANGE_SCALE 배
  const widthOf = (wm2, w340) => w340 * wm2 / 340;
  // 밝기 = 온도: 지표가 내보내는 에너지 σ(T0+T)⁴ 의 1750년 대비 비율. 화면 밝기 변화에는 화살표와 같은 배율을 곱한다
  const emitRatio = T => ((T0 + T) / T0) ** 4 - 1;
  const glow = T => 1 + CHANGE_SCALE * Math.max(0, emitRatio(T));
  // 구역 밝기 차이(도시 > 바다 > 숲)는 설명용 고정 오프셋 — 등록부 'ir_zone_offset'(모형 값이 아님을 ⓘ에 적음)
  const ZONE_OFFSET = { ocean: 0, forest: -0.15, city: 0.25 };
  // 입자 세 겹(작음·중간·큼). 개수 합 = EarthVisual.co2DotCount(ppm) — [CO₂ 보기]와 같은 양이 같은 개수
  const LAYERS = [{ share: 0.62, size: 0.12, opacity: 1 }, { share: 0.28, size: 0.3, opacity: 0.55 }, { share: 0.1, size: 0.7, opacity: 0.3 }];
  function layerCounts(total) {
    const n = LAYERS.map(l => Math.floor(total * l.share));
    n[0] += total - n.reduce((a, b) => a + b, 0);   // 반올림 나머지는 작은 겹에 (합이 정확히 total)
    return n;
  }
  return { BASE, T0, DLW_PER_K, CHANGE_SCALE, ARROWS, fluxes, widthOf, emitRatio, glow, ZONE_OFFSET, LAYERS, layerCounts };
})();

// ── 화면 ──
const IRScope = (typeof THREE === 'undefined') ? null : (() => {
  const C = IRScopeCore;
  const IR = { on: false };
  const KEY = 'irScope.on';   // 탭 링크가 페이지를 다시 여므로 켬 상태를 이 브라우저에 기억한다(실패하면 메모리만)
  try { IR.on = localStorage.getItem(KEY) === 'true'; } catch (e) { /* 저장소를 못 쓰면 꺼진 채로 */ }
  const motionStill = () => typeof reducedMotion !== 'undefined' && reducedMotion.matches;

  // 보케 텍스처: 밝은 중심 → 부드러운 가장자리 → 아주 옅은 테두리 링 (이미지 파일 없이 캔버스로)
  let _bokeh = null;
  function bokehTexture() {
    if (_bokeh) return _bokeh;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.28)');
    gr.addColorStop(0.88, 'rgba(255,255,255,0.4)');   // 렌즈 보케의 옅은 테두리
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    _bokeh = new THREE.CanvasTexture(c);
    return _bokeh;
  }

  // 화살표 재질: 흐르는 줄무늬 셰이더 하나(복제본은 같은 프로그램을 쓰고 유니폼만 다르다).
  // 평면 띠를 화살표 축을 중심으로 카메라 쪽으로 돌려(원통형 빌보드) 어느 각도에서나 굵기가 그대로 보이게 한다.
  // 굵기 단위는 월드 길이: 기준 부분 uBase, 변화 uDelta(+면 덧붙인 띠, −면 기준에서 빠진 부분을 점선 테두리로)
  const ARROW_VS = `
    uniform vec3 uStart; uniform vec3 uEnd; uniform float uSpan;
    varying vec2 vP;
    void main() {
      vec3 d = uEnd - uStart; float L = length(d); vec3 dir = d / L;
      vec3 P = uStart + d * position.y;
      vec3 side = cross(dir, normalize(cameraPosition - P));
      if (length(side) < 1e-3) side = cross(dir, vec3(0.0, 0.0, 1.0));
      side = normalize(side);
      vP = vec2(position.x * uSpan, position.y * L);
      gl_Position = projectionMatrix * viewMatrix * vec4(P + side * position.x * uSpan, 1.0);
    }`;
  const ARROW_FS = `
    uniform float uLen; uniform float uBase; uniform float uDelta; uniform float uTime; uniform float uOutline; uniform float uOpacity;
    uniform vec3 uColor; uniform vec3 uDeltaColor;
    varying vec2 vP;
    // 화살표 모양 안이면 1. 몸통 가로 [a, b], 머리는 몸통 끝에서 끝점까지 좁아지는 삼각형. inset 만큼 안쪽으로 줄인 모양(테두리용)
    float shape(float x, float y, float a, float b, float inset) {
      float head = min(uLen * 0.35, max(b - a, 0.06) * 1.6);
      float yEnd = uLen - head, c = 0.5 * (a + b), hw = 0.5 * (b - a) * 1.7;
      if (y < inset || y > uLen - inset * 2.0) return 0.0;
      if (y < yEnd) return step(a + inset, x) * step(x, b - inset);
      float w = hw * (uLen - y) / head - inset;
      return step(abs(x - c), w);
    }
    void main() {
      float x = vP.x, y = vP.y;
      float dp = max(uDelta, 0.0), dn = max(-uDelta, 0.0);
      float a = -0.5 * (uBase + dp), bAll = a + uBase + dp, bSolid = a + uBase - dn;
      float lw = 0.02;
      float inAll = shape(x, y, a, bAll, 0.0);
      if (uOutline > 0.5) {                      // 단파(①②): 이 보기에서는 밝지 않으므로 외곽선만
        float ring = inAll - shape(x, y, a, bAll, lw);
        if (ring < 0.5) discard;
        gl_FragColor = vec4(uColor, uOpacity); return;
      }
      float yEnd = uLen - min(uLen * 0.35, max(bAll - a, 0.06) * 1.6);
      // 흐르는 줄무늬: 에너지가 흐르는 방향 (움직임 줄이기면 uTime 고정)
      float flow = 0.8 + 0.2 * step(0.5, fract((y - uTime * 0.25) / 0.16));
      if (inAll > 0.5) {
        bool band = dp > 0.0 && x > a + uBase && y < yEnd;
        bool gone = dn > 0.0 && x > bSolid && y < yEnd;
        if (gone) {                              // 줄어든 부분: 비워 두고 점선 테두리만
          float edge = step(x, bSolid + lw) + step(a + uBase - lw, x) + step(y, lw * 1.5) + step(yEnd - lw * 1.5, y);
          if (edge < 0.5 || fract(y / 0.06) > 0.55) discard;
          gl_FragColor = vec4(uDeltaColor, uOpacity); return;
        }
        if (band) {                              // 늘어난 부분: 다른 색 띠 + 빗금
          float hatch = step(0.5, fract((x + y) / 0.035));
          gl_FragColor = vec4(uDeltaColor * (0.85 + 0.15 * hatch) * flow, uOpacity); return;
        }
        gl_FragColor = vec4(uColor * flow, uOpacity); return;
      }
      discard;
    }`;
  let _arrowMat = null;
  function arrowMaterial() {
    if (!_arrowMat) _arrowMat = new THREE.ShaderMaterial({
      vertexShader: ARROW_VS, fragmentShader: ARROW_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uStart: { value: new THREE.Vector3() }, uEnd: { value: new THREE.Vector3() }, uSpan: { value: 1 }, uLen: { value: 1 },
        uBase: { value: 0.1 }, uDelta: { value: 0 }, uTime: { value: 0 }, uOutline: { value: 0 }, uOpacity: { value: 0.9 },
        uColor: { value: new THREE.Color() }, uDeltaColor: { value: new THREE.Color() } },
    });
    const m = _arrowMat.clone();   // uniforms 는 복제되고 프로그램은 같이 쓴다
    return m;
  }
  const _arrowGeo = (() => { const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0); return g; })();

  // 화살표 자리 (상자 좌표, 상자 = 월드 원점). 기준 굵기 W340 = 340 W/m² 일 때의 폭
  // ①은 램프 전구 아래 → 지표, ②는 지표 → 상자 밖 위쪽, ③은 세 구역(바다·숲·도시)에서 위로, ④는 대기층 높이에서 아래로, ⑤는 상자 위로 바깥.
  // 위·아래로 가는 화살표끼리 한 줄로 이어 보이지 않게 가로 자리를 엇갈려 둔다: ③ −2.3 / −0.1 / 2.1 · ④ −1.2 · ⑤ 0.95 · ①② 램프 쪽(오른쪽)
  const W340 = 0.42;
  function arrowSpots(S) {
    const g = S.TERRAIN_TOP * 0.94 + 0.04, top = S.BOX_H;
    const bulb = new THREE.Vector3(); S.lampBulb.getWorldPosition(bulb);
    return {
      sunIn: [[new THREE.Vector3(bulb.x - 0.1, top - 0.1, bulb.z + 0.1), new THREE.Vector3(1.55, g + 0.05, 0.45)]],
      sunOut: [[new THREE.Vector3(1.3, g + 0.05, 0.45), new THREE.Vector3(2.6, top + 0.45, 0.6)]],
      surfLw: [-2.3, -0.1, 2.1].map(x => [new THREE.Vector3(x, g + 0.08, -0.45), new THREE.Vector3(x, g + 0.95, -0.45)]),
      backLw: [[new THREE.Vector3(-1.2, top - 0.2, -0.2), new THREE.Vector3(-1.2, g + 0.75, -0.2)]],
      olr: [[new THREE.Vector3(0.95, top - 0.85, 0.1), new THREE.Vector3(0.95, top + 0.45, 0.1)]],
    };
  }

  // ── 씬 부품 만들기 (처음 켤 때 그 씬에 한 번) ──
  function build(S) {
    const P = { layers: [], arrows: [], saved: null };
    // 입자 세 겹: 최대 개수만큼 자리를 만들고 setDrawRange 로 보일 개수만 (드로우콜 겹당 1)
    const dims = { BOX_W: S.BOX_W, BOX_D: S.BOX_D, BOX_H: S.BOX_H, TERRAIN_TOP: S.TERRAIN_TOP };
    const col = new THREE.Color(Theme.color('--ir-dot') || '#ff5c7a');
    C.LAYERS.forEach((l, i) => {
      const N = Math.ceil(EarthVisual.CO2_DOTS.MAX * l.share) + 1;
      const { base, seed } = scatterInAir(N, dims, seededRandom(3301 + i * 17));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(base), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({ color: col, size: l.size, map: bokehTexture(), transparent: true, opacity: l.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.userData = { base, seed };
      pts.frustumCulled = false;   // 떠다니는 점이라 처음 경계구가 맞지 않는다
      pts.visible = false;
      S.box.add(pts);
      P.layers.push(pts);
    });
    // 화살표: 메시 최대 7개(③ 세 개 포함), 재질 하나의 복제본
    S.scene.updateMatrixWorld(true);   // 아직 한 번도 안 그린 씬이면 램프 전구의 월드 위치가 비어 있다
    const spots = arrowSpots(S);
    const cBase = new THREE.Color(Theme.color('--ir-arrow') || '#ffd6de'), cDelta = new THREE.Color(Theme.color('--ir-delta') || '#ffffff');
    for (const a of C.ARROWS) for (const [s, e] of spots[a.key]) {
      const mat = arrowMaterial();
      const u = mat.uniforms;
      u.uStart.value.copy(s); u.uEnd.value.copy(e); u.uLen.value = s.distanceTo(e);
      u.uColor.value.copy(cBase); u.uDeltaColor.value.copy(cDelta);
      u.uOutline.value = a.sw ? 1 : 0;
      const m = new THREE.Mesh(_arrowGeo, mat);
      m.frustumCulled = false;   // 꼭짓점을 셰이더에서 옮기므로 지오메트리 경계구가 맞지 않는다
      m.visible = false;
      m.renderOrder = 5;          // 입자(가산)보다 뒤에 그려 화살표가 입자에 묻히지 않게
      // 이름표 자리: 화살표 몸통을 가리지 않게 끝 쪽 바깥(위로 가는 화살표는 머리 위, ①·④는 시작점 위)
      m.userData = { key: a.key, label: (a.key === 'sunIn' || a.key === 'backLw' ? s : e).clone().add(new THREE.Vector3(0, 0.12, 0)) };
      S.box.add(m);
      P.arrows.push(m);
    }
    // 밝기를 바꿀 재질을 구역별로 모은다: 상자 안 메시의 가로 위치(바다 x < −1 · 숲 −1~1 · 도시 > 1). 같은 재질이 두 구역에 걸치면 먼저 만난 구역
    P.zoneMats = new Map();
    const skip = new Set([S.lid, ...P.layers, ...P.arrows]);
    if (S.clouds) skip.add(S.clouds.mesh);
    const v = new THREE.Vector3(), bb = new THREE.Box3();
    S.box.traverse(o => {
      if (!o.isMesh || skip.has(o)) return;
      for (const m of [].concat(o.material)) {
        if (!m || !m.emissive || m === S.acrylicMat || P.zoneMats.has(m)) continue;
        bb.setFromObject(o); bb.getCenter(v);
        P.zoneMats.set(m, v.x < -1 ? 'ocean' : v.x > 1 ? 'city' : 'forest');
      }
    });
    S.scene.traverse(o => { if (o.isLight) (P.lightList || (P.lightList = [])).push(o); });
    S.ir = P;
    return P;
  }

  // ── 켜기·끄기: 바꾸기 전 값을 모두 저장했다가 끌 때 그대로 되돌린다 ──
  // 조명: 이 보기는 반사된 햇빛(단파)이 아니라 물체가 내는 열을 보므로 조명을 크게 줄이고, 밝기는 구역의 발광(emissive = 온도)으로 낸다.
  //   모양이 읽히도록 조명을 0으로 하지는 않는다(LIGHT_KEEP)
  const LIGHT_KEEP = 0.08, GLOW_BASE = 0.07;
  function enter(S) {
    const P = S.ir || build(S);
    if (P.saved) return;
    const sv = P.saved = { mats: new Map(), lights: new Map() };
    sv.lid = S.lid.visible; S.lid.visible = false;
    const am = S.acrylicMat;
    sv.acrylic = { transmission: am.transmission, opacity: am.opacity };
    am.transmission = 0; am.opacity = 0.025; am.needsUpdate = true;   // transmission 이 0 ↔ 양수로 바뀌면 셰이더가 달라진다
    const em = S.edgeMat;
    sv.edge = { color: em.color.getHex(), opacity: em.opacity };
    em.color.set(Theme.color('--ir-edge') || '#c98a96'); em.opacity = 0.35;   // 어두운 바탕 위 옅은 테두리선
    const bm = S.lampBulb.material;
    sv.bulb = bm.color.getHex(); bm.color.set(0x141012);                   // 단파 광원은 이 보기에서 밝지 않다 — 어두운 실루엣
    for (const L of P.lightList) { sv.lights.set(L, L.intensity); L.intensity *= LIGHT_KEEP; }
    // 환경맵(방 안 하늘색·전등 패널)도 '반사된 빛'이라 조명을 줄여도 재질을 밝게 비춘다 → 켜는 동안 뺀다(r160 에는 환경 세기 조절이 없다).
    // 재질 셰이더가 한 번 다시 컴파일된다(켜고 끌 때만)
    sv.env = S.scene.environment; S.scene.environment = null;
    for (const m of P.zoneMats.keys()) sv.mats.set(m, { e: m.emissive.getHex(), i: m.emissiveIntensity });
    // 구름 꼭대기는 차갑다 → 어둡게. 지시서는 emissive 만 낮추라 했지만 흰 구름은 남은 조명만으로도 밝게 떠서 색도 함께 낮춘다(불투명 재질 그대로)
    if (S.clouds) { const cm = S.clouds.mesh.material; sv.cloud = { i: cm.emissiveIntensity, c: cm.color.getHex() }; cm.emissiveIntensity = 0; cm.color.setHex(0x3a3a3a); }
    if (S.co2Dots) S.co2Dots.visible = false;   // 같은 CO₂ 양을 적외선 입자가 보인다(겹치지 않게)
    P.layers.forEach(p => { p.visible = true; });
    P.arrows.forEach(m => { m.visible = true; });
  }
  function leave(S) {
    const P = S.ir;
    if (!P || !P.saved) return;
    const sv = P.saved;
    S.lid.visible = sv.lid;
    Object.assign(S.acrylicMat, sv.acrylic); S.acrylicMat.needsUpdate = true;
    S.edgeMat.color.setHex(sv.edge.color); S.edgeMat.opacity = sv.edge.opacity;
    S.lampBulb.material.color.setHex(sv.bulb);
    for (const [L, i] of sv.lights) L.intensity = i;
    S.scene.environment = sv.env;
    for (const [m, o] of sv.mats) { m.emissive.setHex(o.e); m.emissiveIntensity = o.i; }
    if (S.clouds) { S.clouds.mesh.material.emissiveIntensity = sv.cloud.i; S.clouds.mesh.material.color.setHex(sv.cloud.c); }
    if (S.co2Dots) S.co2Dots.visible = VIEW3D.co2;
    P.layers.forEach(p => { p.visible = false; });
    P.arrows.forEach(m => { m.visible = false; });
    P.saved = null;
  }

  // ── 그해 값 반영 (common.js applyState 가 부른다: 탭 전환·재생 틱) ──
  function apply(S) {
    if (!S || S.dormant || !S.paper) return;
    if (!IR.on) { leave(S); return; }
    enter(S);
    const P = S.ir, st = S.state;
    // 입자 = 그 씬에 보이는 CO₂ (가시광 [CO₂ 보기]와 같은 값·같은 개수)
    const n = C.layerCounts(EarthVisual.co2DotCount(st.co2));
    P.layers.forEach((p, i) => p.geometry.setDrawRange(0, n[i]));
    // 화살표·밝기 = 같은 엔진 표본의 CO₂·기온 (현재 실태는 2023, 미래 예측은 재생 연도)
    const T = st.T || 0, ppm = st.ppmModel || st.co2;
    const f = C.fluxes(ppm, T, EarthSystem.PARAMS);
    P.last = { f, T, ppm };
    for (const m of P.arrows) {
      const v = f[m.userData.key], u = m.material.uniforms;
      u.uBase.value = C.widthOf(v.base, W340);
      u.uDelta.value = C.widthOf(v.delta * C.CHANGE_SCALE, W340);
      u.uSpan.value = (u.uBase.value + Math.abs(u.uDelta.value)) * 1.9 + 0.02;   // 머리 삼각형까지 들어가는 띠 폭
    }
    const g = C.glow(T);
    for (const [m, zone] of P.zoneMats) {
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = GLOW_BASE * g * (1 + C.ZONE_OFFSET[zone]);
    }
    P.legendDirty = true;   // 범례 글은 렌더 루프(step)에서 — 여기는 main.js 가 읽히기 전(탭 파일 로드 중)에도 불릴 수 있다
  }

  // 한 프레임 움직임 (common.js stepScene): 입자 떠다니기 · 화살표 줄무늬 흐름. 움직임 줄이기면 멈춘 화면
  function step(S) {
    const P = S.ir;
    if (!P || !P.saved) return;
    const still = motionStill();
    if (!still) P.layers.forEach(p => driftPoints(p, p.geometry.drawRange.count));
    for (const m of P.arrows) m.material.uniforms.uTime.value = still ? 0 : t;
    if (S === bundles[activeTab]) {
      placeLabels(S);
      if (P.legendDirty) { renderLegend(S); P.legendDirty = false; }
    }
  }

  // ── 화면 (HTML): 토글 · 덮개 · 화살표 이름표 · 학습지 범례 적외선 절 ──
  const $ = id => document.getElementById(id);
  const fmt = v => (Math.abs(v) < 0.05 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1));
  // 화살표 이름표: 3D 점을 화면 좌표로 옮긴 HTML 글자(캔버스 필터를 타지 않아 읽히고, 드로우콜도 늘지 않는다)
  const _v = new THREE.Vector3();
  function placeLabels(S) {
    const box = $('irLabels');
    if (!box || !S.ir) return;
    const w = glContainer.clientWidth, h = glContainer.clientHeight;
    // 3D 칸이 좁으면(1280×720 미래 예측은 768×219) 이름까지 쓰면 이름표가 3D를 덮는다 → 번호만, 이름은 학습지 3D 범례 카드에
    // 위에서 내려다보면(camAngleX 가 크면) 위아래 화살표 끝이 한곳에 모여 이름표가 겹친다 → 그때도 번호만
    box.classList.toggle('compact', w < 1000 || h < 300 || camAngleX > 1.0);
    for (const a of C.ARROWS) {
      const el = box.querySelector(`[data-ir="${a.key}"]`), m = S.ir.arrows.find(x => x.userData.key === a.key);
      if (!el || !m) continue;
      _v.copy(m.userData.label).project(camera);
      const off = _v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1;
      el.hidden = off;
      // 이름표는 끝점 위에 붙는다(translate −100 %). 칸 위로 넘치지 않게 맨 위는 이름표 높이만큼 내려 둔다
      if (!off) el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(0)}px, ${Math.max(26, (1 - _v.y) / 2 * h).toFixed(0)}px)`;
    }
  }
  function renderLegend(S) {
    const tb = $('irLegendRows');
    if (!tb || !S.ir || !S.ir.last) return;
    const { f, T } = S.ir.last;
    tb.innerHTML = C.ARROWS.map(a => {
      const v = f[a.key];
      const d = a.sw ? '변화 없음' : `${fmt(v.delta)}`;   // ①②: 엔진에 반사율 변화가 없다(범례 아래 글·ⓘ)
      return `<tr><th scope="row">${a.no} ${a.name} <span class="ir-band">${a.band}</span></th>
        <td class="readout">${v.base}</td><td class="readout">${d}</td></tr>`;
    }).join('');
    $('irLegendN').textContent = `대기 꼭대기 불균형 N = ${f.N.toFixed(2)} W/m² · 기온 편차 ${T.toFixed(2)} °C`;
  }

  function syncUi() {
    document.body.classList.toggle('ir-on', IR.on);
    for (const b of document.querySelectorAll('[data-ir-mode]')) b.setAttribute('aria-pressed', String((b.dataset.irMode === 'ir') === IR.on));
    const lg = $('legend3d');
    if (lg) lg.querySelector('[data-row="ir"]').hidden = !IR.on;
    const paper = typeof PAPER_TABS !== 'undefined' ? PAPER_TABS.includes(activeTab) : true;
    setSceneBackdrop(paper ? Theme.hex(IR.on ? '--ir-bg' : '--paper') : LIVE_BACKDROP);
    if (typeof updateLegend3D === 'function') updateLegend3D();
  }
  // 배율 문구는 계산과 같은 상수에서 (화면에 적은 배율과 실제 배율이 어긋나지 않게)
  { const k = C.CHANGE_SCALE, cap = $('irCapScale'), note = $('irLegendNote');
    if (cap) cap.textContent = `변화 띠·밝기 변화 ×${k} 확대`;
    if (note) note.textContent = `변화 띠와 밝기 변화는 ×${k} 확대했습니다(기준 부분은 실제 비율). ①②는 이 모형에 반사율 변화가 없어 그대로입니다. ④는 강제력만큼 늘어난 것으로 단순화했습니다. 구역끼리의 밝기 차이(도시 > 바다 > 숲)는 설명용입니다.`; }

  // 켜고 끄기: 화면 공용 상태 하나. 만들어진 종이 씬 모두에 반영(안 만든 씬은 만들 때 applyState 에서 따라온다)
  function set(on) {
    on = !!on;
    if (on === IR.on) return;
    IR.on = on;
    try { localStorage.setItem(KEY, String(on)); } catch (e) { /* 무시 */ }
    syncUi();
    const scenes = [typeof sceneCurrent !== 'undefined' && sceneCurrent, typeof sceneFuture !== 'undefined' && sceneFuture,
      typeof sceneNature !== 'undefined' && sceneNature];
    for (const S of scenes) if (S && !S.dormant) applyState(S);
    // 화살표 값은 학습지 3D 범례 카드에서 읽는다 → 켜면 카드를 연다 (지시약 보기와 같은 방식, 3차 E2)
    if (on && typeof Worksheet !== 'undefined') Worksheet.openCard('legend3d');
  }

  // 탭이 정해질 때(main.js switchTab): 바탕색은 switchTab 이 종이색으로 다시 칠하므로 그 뒤에 적외선 바탕으로
  let firstTab = true;
  function onTab() {
    syncUi();
    // 켠 채로 다시 열었으면(탭 링크는 페이지를 다시 연다) 화살표 값을 읽을 범례 카드도 연다 — 켤 때와 같게.
    // 첫 switchTab 은 main.js 가 학습지 카드를 등록하기 전에 불리므로 다음 차례로 미룬다
    if (firstTab && IR.on) setTimeout(() => { if (IR.on && typeof Worksheet !== 'undefined') Worksheet.openCard('legend3d'); }, 0);
    firstTab = false;
  }

  // 토글 버튼: [가시광 | 적외선] 두 칸. 버튼이라 Tab·Enter·Space 로 된다
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ir-mode]');
    if (b) set(b.dataset.irMode === 'ir');
  });
  return { IR, set, apply, step, onTab, isOn: () => IR.on };
})();
