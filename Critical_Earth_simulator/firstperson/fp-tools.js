// ============================================================================
// 1인칭 모드 - 단축바(핫바) / 손에 든 도구 / 실측 도구
// ----------------------------------------------------------------------------
// 마인크래프트식 9칸 단축바(숫자키 1~9)로 도구를 고르면 화면 우하단에 오른손이 나타나고
// 그 손이 도구를 들고 있다. 좌클릭하면 화면 중앙(크로스헤어)이 가리키는 지점을 측정해서
// 도구의 표시창(캔버스 텍스처)에 수치를 띄운다.
//
// 도구가 카메라를 따라다니게 하려고 camera에 직접 붙인다(camera.add). 단, three.js는
// 씬 그래프를 따라 렌더링하므로 카메라 자체를 씬에 넣어줘야 카메라의 자식이 그려진다.
// ============================================================================

const FPTools = {
  slots: new Array(9).fill(null),
  selected: -1,     // -1 = 맨손
  handGroup: null,
  camera: null,
  _rc: new THREE.Raycaster(),
};

// ── 측정 지점 종류 ──────────────────────────────────────────────────────────
// 온도계는 어디를 겨눠도 값이 나와야 하므로, 크로스헤어가 닿은 것이 무엇인지
// 8가지로 나눈다. 하늘/허공을 겨누면 그 지점의 '대기'를 잰다.
// base = 산업화 이전(280ppm)의 온도 [°C]
// amp  = 전 지구 승온에 대한 그 표면의 증폭계수.
//        실제 온도 = base + amp × warmingSince280(ppm)
//        warmingSince280()은 js/earth-model.js에 있는 공유 기후 모델이다. 즉 여기 온도는
//        조감 모드 '미래 예측' 탭의 기온편차와 같은 곡선을 타고 움직인다.
//        예전엔 (1000ppm에서 +N도) 식으로 직접 박아 놔서 두 모드가 따로 놀았다.
// day = 일교차 진폭 [°C]. 하루 중 최저(새벽 5시)와 최고(오후 2시)의 차이가 이 값의 2배다.
//       base는 '정오' 기준으로 맞춰 두었으므로 정오에는 이 항이 0이 된다.
const SPOT = {
  sea:      { base: SEA_BASE_T, amp: SEA_WARM_AMP, day: 0.6, label: '해수' },
  ice:      { base: -6, amp: SEA_WARM_AMP, day: 1.2, label: '빙하', cap: 0 },
  beach:    { base: 28, amp: 1.15, day: 7.0, label: '해변 모래' },
  green:    { base: 24, amp: 1.00, day: 6.5, label: '녹지 지면' },
  city:     { base: 32, amp: 1.30, day: 4.5, label: '도시 지면' },
  airOcean: { base: 17, amp: SEA_WARM_AMP, day: 0.6, label: '해양 대기' },
  airGreen: { base: 22, amp: 0.95, day: 5.0, label: '녹지 대기' },
  airCity:  { base: 29, amp: 1.20, day: 3.5, label: '도심 대기' },
};
// 일교차 진폭의 근거 - 그리고 이 값들이 '도시 열섬'의 핵심이다.
//   도시(4.5)가 녹지(6.5)보다 일교차가 작다. 콘크리트·아스팔트가 낮에 받은 열을 품고
//   있다가 밤에 천천히 내놓고, 증발산으로 식지도 않기 때문이다.
//   그래서 도시-녹지 기온차(열섬 강도)는 낮보다 밤에 훨씬 커진다:
//     정오  도시 32.0 - 녹지 24.0 = 8.0°C
//     새벽  도시 23.6 - 녹지 11.9 = 11.7°C   <- 열섬은 밤에 심하다
//   정오에 고정된 세계에서는 이 사실을 보여줄 방법이 아예 없었다.
//   바다(0.6)가 거의 안 변하는 건 물의 열용량이 크기 때문이다.
//   모래(7.0)가 가장 크게 흔들린다 - 사막의 밤이 추운 이유와 같다.
// 증폭계수의 근거:
//  - 바다·빙하 0.75 : 물의 열용량이 커서 육지보다 천천히 데워진다. 실제로도 해양 표층은
//    전 지구 평균보다 덜 오른다. 해수 온도는 fp-world.js와 상수를 공유해서, 온도계로 잰
//    값과 산호가 반응하는 값이 반드시 같다.
//  - 녹지 1.00 : 기준.
//  - 도시 1.30 : 열섬. 포장면이 낮에 열을 더 받고 증발산으로 식지도 않는다.
//  - 해변 1.15 : 마른 모래는 아스팔트만큼은 아니어도 풀밭보다 훨씬 잘 달궈진다.
//  - 대기는 그 아래 지면보다 조금 낮다. 낮에 데워지는 건 지면이고 공기는 전달받는 쪽이라서.
//    바다 위 대기만 해수와 같은 계수인데, 물이 대기 온도를 붙잡기 때문이다.
//
// 빙하의 cap: 얼음 표면은 녹는점 위로 못 올라간다. 들어온 열을 녹는 데 다 쓰기 때문
// (융해 잠열). CO2가 아무리 높아도 0°C에서 멈추게 상한을 걸었다.
const AIR_MIX_H = 0.06;        // 지면에서 이 높이(실척 3m) 안쪽은 지면 열의 영향을 받는다
const AIR_SAMPLE_DIST = 0.3;   // 허공을 겨눴을 때 대기를 뜨는 거리 (실척 15m)
// 대기 -> 그 아래 지면의 대응 관계 (지면 열 섞임 계산용)
const SPOT_GROUND = { airOcean: 'sea', airGreen: 'green', airCity: 'city' };

// 바다·빙하 계열은 계절 진폭이 훨씬 작다 (물의 열용량)
const SEA_SPOTS = { sea: 1, ice: 1, airOcean: 1 };
// SPOT.base 값들은 계절이 없던 시절 '여름 정오' 기준으로 맞춰 둔 값이다.
// 그래서 여름을 0점으로 삼아 그 차이만 더한다 (여름에는 이 항이 0).
function seasonTempOffset(spot) {
  const S = seasonDef(), SUM = SEASONS.summer;
  return SEA_SPOTS[spot] ? (S.seaT - SUM.seaT) : (S.temp - SUM.temp);
}
function spotBaseTemp(spot, ppm, hour) {
  const S = SPOT[spot];
  const h = hour == null ? FPWorld.hour : hour;
  // (diurnal(h) - 정오값)이라 정오에는 일교차 항이 0이 된다
  return S.base + S.amp * warmingSince280(ppm)
       + S.day * (diurnal(h) - DIURNAL_AT_NOON)
       + seasonTempOffset(spot);
}
function measureTemperature(spot, x, z, ppm, aboveGround) {
  const S = SPOT[spot];
  // 같은 구역 안에서도 지점마다 조금씩 다르게 (측정하는 맛)
  const jitter = Math.sin(x * 37.1 + z * 21.7) * 0.5 + Math.sin(x * 11.3 - z * 53.9) * 0.35;
  let v = spotBaseTemp(spot, ppm) + jitter;
  // 대기를 잴 때 지면 바로 위면 지면 온도 쪽으로 끌어당긴다.
  // 뜨거운 아스팔트 바로 위 공기가 뜨거운 건 실제로 그렇고, 위로 갈수록 옅어진다.
  if (aboveGround != null && SPOT_GROUND[spot]) {
    const w = 1 - Math.min(1, Math.max(0, aboveGround) / AIR_MIX_H);
    v += (spotBaseTemp(SPOT_GROUND[spot], ppm) - spotBaseTemp(spot, ppm)) * w * 0.6;
  }
  if (S.cap != null) v = Math.min(S.cap, v);
  return v;
}

// 해양 pH: 산호 백화·생물 감소와 반드시 같은 값을 써야 하므로
// fp-world.js의 oceanPH() 하나만 쓴다 (측정값과 세계 상태가 어긋나지 않게)
function measurePH(ppm) {
  return oceanPH(ppm);
}

// ── 대기 CO2 ────────────────────────────────────────────────────────────────
// 슬라이더 값은 '전 지구 평균'이고, 실제로 재는 값은 서 있는 자리에 따라 달라진다.
//  - 도심: 배기·난방·건물이 몰려 있고 바람이 막혀 늘 평균보다 높다(도시 CO2 돔).
//  - 녹지: 광합성이 낮 동안 공기 중 CO2를 빨아들여 평균보다 낮다. CO2가 높을수록
//    흡수량 자체도 커져서(CO2 비료 효과) 낮아지는 폭이 함께 커진다.
//  - 해양: 바닷물이 CO2를 녹여 흡수하므로 역시 평균보다 낮다.
//    이 흡수가 바로 해수 pH를 떨어뜨리는 원인이라, pH 측정값과 같은 이야기를 한다.
// 낮에는 이 값, 밤에는 night 쪽 값으로 옮겨 간다.
//  - 녹지: 낮에는 광합성이 CO2를 빨아들여 평균보다 낮지만, 밤에는 광합성이 멎고
//    호흡만 남아 오히려 평균보다 높아진다. 부호가 뒤집히는 이 지점이
//    "식물은 CO2를 먹기만 한다"는 흔한 오개념을 깨는 자리다.
//  - 도심: 밤에는 지표 부근 대기가 얇게 갇혀(야간 안정층) 배출된 CO2가 흩어지지 못한다.
//    교통량이 줄어드는데도 도심 CO2는 밤에 더 높게 잡히는 이유다.
//  - 해양: 밤낮 차이가 거의 없다. 흡수가 물리·화학 과정이라 빛과 무관하기 때문이다.
const CO2_ZONE = {
  city:  { off: 55,  rise: 120,  nightOff: 110, nightRise: 150 },
  green: { off: -30, rise: -40,  nightOff: 35,  nightRise: 45 },
  ocean: { off: -15, rise: -30,  nightOff: -10, nightRise: -25 },
};
// 어떤 지점이 나무 수관에 얼마나 가까운지 (0=밖, 1=줄기 바로 옆)
function treeShadeAt(x, z) {
  let s = 0;
  for (const t of FPWorld.trees) s = Math.max(s, 1 - Math.hypot(x - t.x, z - t.z) / t.r);
  return Math.max(0, s);
}
function measureCO2(ppm, x, z, zone, px, pz) {
  const Z = CO2_ZONE[zone] || CO2_ZONE.green;
  const k = FPWorld.co2k;
  const lit = FPWorld.daylight != null ? FPWorld.daylight : 1;   // 1=한낮, 0=한밤
  // 낮 값과 밤 값 사이를 햇빛 세기로 섞는다 (여명·황혼에는 그 중간)
  const off = Z.nightOff + (Z.off - Z.nightOff) * lit;
  const rise = Z.nightRise + (Z.rise - Z.nightRise) * lit;
  // 계절 진동(킬링 곡선): 북반구 식생이 봄에 CO2를 뱉고 여름내 빨아들여 가을에 최저가 된다.
  // 슬라이더 값은 연평균이고, 실제로 재는 값은 이만큼 계절을 탄다.
  let v = ppm + seasonDef().co2 + off + rise * k;

  // 나무 그늘 아래는 낮에 특히 낮다. 잎이 바로 위에서 CO2를 빨아들이는 자리라
  // 같은 녹지 안에서도 확연히 차이가 난다.
  // 밤에는 반대로 잎과 뿌리의 호흡 때문에 나무 밑이 오히려 더 높다.
  // 겨눈 지점과 '서 있는 자리' 중 나무에 가까운 쪽을 쓴다. 손에 든 센서가 실제로
  // 빨아들이는 건 내 주변 공기라, 나무 밑에 서 있으면 어디를 겨누든 낮게 나와야 한다.
  // (이걸 겨눈 지점만으로 계산했더니 나무 밑에서 비스듬히 내려다보는 순간 표본이
  //  수관 밖으로 빠져나가 효과가 사라졌다.)
  if (zone === 'green') {
    const shade = Math.max(treeShadeAt(x, z), px == null ? 0 : treeShadeAt(px, pz));
    const draw = (55 + 60 * k) * lit;          // 낮: 광합성 흡수
    const resp = (40 + 35 * k) * (1 - lit);    // 밤: 호흡 배출
    v += shade * (resp - draw);
  }

  // 국소 배출원: 공장 굴뚝과 내연기관차 배기구 바로 옆은 확 치솟는다
  const sx = FPWorld.ZONE_W + 0.6, sz = 0.55;             // 공장 굴뚝 월드 좌표
  v += Math.max(0, 1 - Math.hypot(x - sx, z - sz) / 0.55) * 260 * k;
  for (const c of FPWorld.cars) {
    if (!c.isGas) continue;
    v += Math.max(0, 1 - Math.hypot(x - c.tail.x, z - c.tail.z) / 0.10) * 110;
  }
  return Math.max(150, v);   // 산업화 이전보다 낮게는 안 내려가도록
}

// 크로스헤어가 가리키는 지점이 무엇인지 판정.
// 아무것도 안 맞으면(하늘) 광선을 far까지 늘린 지점의 '대기'를 대상으로 삼는다.
// 그래야 해안에 서서 바다 쪽 하늘을 겨누면 '해양 대기'가 나온다.
function pickTarget() {
  const cam = FPTools.camera;
  // 측정은 렌더 사이(마우스 이벤트)에서 호출되므로 카메라 행렬이 직전 프레임 것일 수 있다.
  // setFromCamera는 matrixWorld를 그대로 쓰기 때문에 여기서 한 번 갱신해줘야 조준이 정확해진다.
  cam.updateMatrixWorld();
  const rc = FPTools._rc;
  rc.setFromCamera({ x: 0, y: 0 }, cam);
  rc.far = 1.4;   // 실척 약 70m까지 닿음
  const targets = FPWorld.walkables.concat([FPWorld.waterMesh], FPWorld.iceMeshes);
  const hits = rc.intersectObjects(targets, false);
  const half = FPWorld.ZONE_W / 2;

  if (!hits.length) {
    // 허공 - 겨눈 방향의 '가까운' 대기를 잰다.
    // far(70m)까지 끌고 가면 안 된다. 나무나 건물은 이 광선의 대상이 아니어서 그냥
    // 통과해버리는데, 그러면 눈앞 15m의 나무를 겨눴는데 70m 뒤 엉뚱한 구역의 공기를
    // 재는 일이 생긴다(실제로 그랬다). 손에 든 센서가 빨아들이는 건 어차피 코앞 공기다.
    const p = rc.ray.at(AIR_SAMPLE_DIST, new THREE.Vector3());
    // 맵 밖으로는 안 나가게 (밖은 정의된 구역이 없다)
    const hw = FPWorld.BOX_W / 2 - 0.02, hd = FPWorld.BOX_D / 2 - 0.02;
    p.x = Math.max(-hw, Math.min(hw, p.x));
    p.z = Math.max(-hd, Math.min(hd, p.z));
    const zone = p.x < -half ? 'ocean' : (p.x > half ? 'city' : 'green');
    // 대기가 열을 주고받는 상대는 바로 아래 '표면'이다. 바다 위에서는 해저가 아니라
    // 수면이 그 상대이므로 구역에 따라 기준면을 다르게 잡는다.
    const surf = zone === 'ocean'
      ? FPPlayer.waterHeightAt(p.x, p.z, performance.now() / 1000)
      : FPPlayer.terrainHeightAt(p.x, p.z);   // 맵 밖이면 -1 = 자유 대기
    return {
      point: p, zone, isWater: false, isAir: true, dist: AIR_SAMPLE_DIST,
      spot: zone === 'ocean' ? 'airOcean' : (zone === 'city' ? 'airCity' : 'airGreen'),
      aboveGround: surf < 0 ? 1 : p.y - surf,
    };
  }

  const h = hits[0], p = h.point;
  const isWater = h.object === FPWorld.waterMesh;
  const zone = p.x < -half ? 'ocean' : (p.x > half ? 'city' : 'green');
  let spot;
  if (FPWorld.iceMeshes.includes(h.object)) spot = 'ice';
  else if (isWater) spot = 'sea';
  else if (zone === 'city') spot = 'city';
  else if (zone === 'green') spot = 'green';
  else {
    // 해양 구역의 단단한 바닥(해변 경사로·해저 모래). 수면 위로 나와 있으면 해변 모래,
    // 수면 아래면 그 위를 덮고 있는 해수를 잰 것으로 본다.
    const waterY = FPPlayer.waterHeightAt(p.x, p.z, performance.now() / 1000);
    spot = p.y > waterY ? 'beach' : 'sea';
  }
  return { point: p, zone, isWater, isAir: false, spot, dist: h.distance, aboveGround: 0 };
}

// ── 계측기 사양 ─────────────────────────────────────────────────────────────
// 예전엔 좌클릭하는 순간 참값이 소수점까지 정확하게 떴다. 같은 지점을 백 번 눌러도
// 백 번 같은 값이 나오니, 반복측정·평균·표준편차라는 개념을 가르칠 수가 없었다.
// 실제 센서가 가진 세 가지 한계를 넣는다:
//   res    분해능. 표시할 수 있는 최소 눈금. 이보다 잘게는 못 읽는다.
//   sigma  재현성. 같은 조건에서 다시 재도 이만큼 흔들린다(1 표준편차).
//   settle 응답시간. 값이 안정될 때까지 걸리는 시간.
// 실제 기기는 훨씬 느리다(MH-Z19B는 T90이 60초 수준). 게임에서 60초를 기다릴 수는
// 없으니 눌러 놓고 기다리는 감각이 남을 만큼만 압축했다.
const TOOL_SPEC = {
  temp: { res: 0.1,  sigma: 0.15, settle: 1.2, cold: 20,  unit: '°C' },
  ph:   { res: 0.01, sigma: 0.02, settle: 2.5, cold: 7.00, unit: 'pH' },
  co2:  { res: 1,    sigma: 8,    settle: 3.0, cold: 400, unit: 'ppm' },
};
// 표준정규난수 (Box-Muller). 균등난수를 쓰면 오차 분포가 실제와 달라서
// 평균을 내도 참값으로 수렴하는 맛이 안 난다.
function gaussNoise() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function quantize(v, res) { return Math.round(v / res) * res; }
function fmtValue(v, res) {
  return v.toFixed(res >= 1 ? 0 : (res >= 0.1 ? 1 : 2));
}

// ── 도구 정의 ───────────────────────────────────────────────────────────────
function makeDisplayCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 96;
  return cv;
}
function drawDisplay(tool, big, small, color, progress) {
  const cv = tool.canvas, c = cv.getContext('2d');
  c.fillStyle = '#0a1512';
  c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = '#1d3a32'; c.lineWidth = 4;
  c.strokeRect(2, 2, cv.width - 4, cv.height - 4);
  c.textAlign = 'center';
  c.fillStyle = color;
  c.font = 'bold 44px "Courier New", monospace';
  c.fillText(big, cv.width / 2, 56);
  c.fillStyle = '#7fa89a';
  c.font = '18px sans-serif';
  c.fillText(small, cv.width / 2, 82);
  // 값이 안정되는 동안 아래쪽에 진행 막대. 다 차기 전 숫자는 아직 못 믿는다는 표시.
  if (progress != null && progress < 1) {
    c.fillStyle = '#16302a';
    c.fillRect(8, cv.height - 12, cv.width - 16, 5);
    c.fillStyle = '#5dcaa5';
    c.fillRect(8, cv.height - 12, (cv.width - 16) * progress, 5);
  }
  tool.tex.needsUpdate = true;
  tool.lastResult = { big, small };   // 캔버스 픽셀을 읽지 않고도 결과를 확인할 수 있게 보관
}

function buildTool(kind) {
  const g = new THREE.Group();
  const canvas = makeDisplayCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const caseMat = new THREE.MeshStandardMaterial({
    color: kind === 'temp' ? 0xe8e8ea : (kind === 'ph' ? 0xf0a33c : 0x3c7fd0),
    roughness: 0.5, metalness: 0.1,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.6 });

  // 공통: 손에 쥐는 본체 + 정면 표시창
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.016, 0.005), caseMat);
  g.add(bodyMesh);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0085, 0.0052),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  screen.position.set(0, 0.0042, 0.00256);
  g.add(screen);

  // 측정부는 전부 본체 '아래'로, 본체 중심축을 그대로 따라 내려온다.
  // 예전엔 손과 겹치지 않게 z로 밀었는데, 손 그룹이 기울어져 있어서 화면상으로는
  // 탐침이 손 '옆'으로 삐져나온 것처럼 보였다. 실제 휴대용 계측기처럼 주먹을 관통해
  // 아래로 빠지게 두는 편이 훨씬 자연스럽다(가는 막대라 어색하지 않음).
  const PROBE_Z = 0;
  if (kind === 'temp') {
    // 디지털 온도계: 본체 아래로 뻗은 가느다란 금속 탐침
    const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0008, 0.014, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.3, metalness: 0.85 }));
    probe.position.set(0, -0.015, PROBE_Z);
    g.add(probe);
  } else if (kind === 'ph') {
    // pH 미터: 아래로 내려온 프로브 끝에 유리 전극(둥근 구)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.016, 10), darkMat);
    rod.position.set(0, -0.0155, PROBE_Z);
    g.add(rod);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 12, 10),
      new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.1, transmission: 0.6, thickness: 0.001 }));
    bulb.position.set(0, -0.0238, PROBE_Z);
    g.add(bulb);
  } else {
    // CO2 센서: 아래로 내려온 흡입관 + 그 끝의 격자 흡입구
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 10), darkMat);
    inlet.position.set(0, -0.014, PROBE_Z);
    g.add(inlet);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.0062, 0.0055, 0.0012),
      new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.7 }));
    grille.position.set(0, -0.0185, PROBE_Z + 0.0018);
    g.add(grille);
    for (let i = -1; i <= 1; i++) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.0009, 0.0042, 0.0008),
        new THREE.MeshStandardMaterial({ color: 0x000000 }));
      slit.position.set(i * 0.0018, -0.0185, PROBE_Z + 0.0024);
      g.add(slit);
    }
  }

  const tool = { kind, group: g, canvas, tex };
  drawDisplay(tool, '--', kind === 'temp' ? '°C' : (kind === 'ph' ? 'pH' : 'ppm'), '#5dcaa5');
  return tool;
}

// ── 손 ──────────────────────────────────────────────────────────────────────
function buildHand() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b58c, roughness: 0.75 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3f6fa8, roughness: 0.85 });
  // 팔은 화면 바깥(카메라 뒤쪽, +z)으로 뻗게 둔다. 처음엔 팔 앞끝이 카메라 근평면
  // 코앞(0.006)까지 와서 화면 절반을 팔로 가려버렸다 - 반드시 카메라에서 떨어뜨려야 한다.
  // 화면 아래에서 위로 팔 -> 손 -> 도구 순서로 쌓는다.
  // 팔은 카메라 쪽(+z)·아래(-y)로 뻗어 화면 밖으로 빠지고, 그 끝에 손이 붙고,
  // 손 바로 위(손끝)에 도구 본체가 얹힌다.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.007, 0.024), sleeve);
  arm.position.set(0, -0.006, 0.011);
  g.add(arm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.0078, 0.0078, 0.0085), skin);
  hand.position.set(0, -0.001, 0);
  g.add(hand);
  return g;
}

// 창 크기가 바뀌면 뷰모델 카메라의 종횡비도 맞춰줘야 도구가 늘어나지 않는다
FPTools.resize = function (aspect) {
  if (!this.viewCamera) return;
  this.viewCamera.aspect = aspect;
  this.viewCamera.updateProjectionMatrix();
};

// 메인 씬을 그린 뒤 깊이만 비우고 그 위에 덧그린다
FPTools.render = function (renderer) {
  if (!this.handGroup.visible) return;
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(this.viewScene, this.viewCamera);
  renderer.autoClear = prevAutoClear;
};

// ── 초기화 ──────────────────────────────────────────────────────────────────
FPTools.init = function (camera) {
  this.camera = camera;

  // ── 뷰모델(손·도구) 전용 씬 ──────────────────────────────────────────────
  // 손을 메인 카메라에 그냥 붙이면, 바닥을 내려다볼 때 지면이 손보다 카메라에 가까워져서
  // 깊이 테스트에 걸려 도구가 땅에 파묻힌 것처럼 사라진다.
  // FPS 게임들이 쓰는 방식대로 뷰모델을 별도 씬/카메라로 분리해서, 메인 씬을 다 그린 뒤
  // 깊이 버퍼만 비우고 그 위에 덧그린다. 그러면 3D상 어디를 보든 도구는 항상 보인다.
  this.viewScene = new THREE.Scene();
  this.viewCamera = new THREE.PerspectiveCamera(75, 1, 0.001, 0.5);
  // 뷰모델 조명은 메인 씬과 무관하게 고정 - 어두운 곳에서도 도구는 항상 읽혀야 함
  this.viewScene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const vl = new THREE.DirectionalLight(0xffffff, 1.6);
  vl.position.set(0.4, 0.8, 1);
  this.viewScene.add(vl);

  this.handGroup = new THREE.Group();
  // 화면 우하단. 뷰카메라(원점)에서 0.05유닛 떨어뜨려 화면 높이의 1/3쯤 차지하게 배치.
  this.handGroup.position.set(0.024, -0.023, -0.050);
  this.handGroup.rotation.set(-0.14, 0.24, 0.08);   // 표시창이 카메라를 더 정면으로 보게
  this.handGroup.visible = false;
  this.viewScene.add(this.handGroup);

  const hand = buildHand();
  this.handGroup.add(hand);

  this.slots[0] = buildTool('temp');
  this.slots[1] = buildTool('ph');
  this.slots[2] = buildTool('co2');
  this.slots.forEach(t => {
    if (!t) return;
    t.group.visible = false;
    // 표시창이 달린 본체를 손끝(주먹 윗면)에 얹는다. 본체 아랫부분이 손과 살짝 겹쳐야
    // '쥐고 있다'로 읽히고, 탐침은 그대로 주먹을 지나 아래로 빠진다.
    t.group.position.set(0, 0.0105, 0);
    this.handGroup.add(t.group);
  });

  buildHotbarUI();   // select()가 슬롯 DOM에 하이라이트를 넣으므로 UI를 먼저 만든다
  this.select(0);
};

FPTools.select = function (i) {
  this.selected = i;
  this.slots.forEach((t, idx) => { if (t) t.group.visible = idx === i; });
  this.handGroup.visible = i >= 0 && !!this.slots[i];
  document.querySelectorAll('#hotbar .slot').forEach((el, idx) => {
    el.classList.toggle('on', idx === i);
  });
};

// ── 측정 진행 ───────────────────────────────────────────────────────────────
// 좌클릭하면 참값을 바로 띄우는 게 아니라, 그 값을 향해 지수적으로 수렴하는
// '측정 중' 상태로 들어간다. 다 차면 그때 값이 확정되고 야장에 기록된다.
FPTools.beginReading = function (tool, trueValue, label, color) {
  const spec = TOOL_SPEC[tool.kind];
  tool.reading = {
    // 참값 + 이번 측정의 오차. 같은 자리를 다시 재면 다른 난수가 뽑히므로
    // 값이 매번 조금씩 다르다 = 반복측정에 의미가 생긴다.
    target: trueValue + gaussNoise() * spec.sigma,
    from: tool.lastValue != null ? tool.lastValue : spec.cold,
    t: 0, dur: spec.settle, spec, label, color,
  };
  // 클릭한 그 순간 표시창을 '측정 중'으로 바꾼다. 다음 프레임의 update()를 기다리면
  // 직전 측정값이 한 프레임 더 남아 있어서, 새로 누른 건지 아닌지 헷갈린다.
  drawDisplay(tool, fmtValue(quantize(tool.reading.from, spec.res), spec.res), '측정 중…', '#8fb7c9', 0);
};
// 매 프레임 호출. 여러 도구가 동시에 측정 중일 일은 없지만 슬롯 전체를 훑는다.
FPTools.update = function (dt) {
  for (const tool of this.slots) {
    if (!tool || !tool.reading) continue;
    const r = tool.reading;
    r.t = Math.min(r.dur, r.t + dt);
    const p = r.t / r.dur;
    // 1차 지연계 응답 곡선. 실제 센서가 계단 입력에 반응하는 모양 그대로다.
    const shown = r.t >= r.dur ? r.target
                               : r.from + (r.target - r.from) * (1 - Math.exp(-3.5 * p));
    const q = quantize(shown, r.spec.res);
    const done = r.t >= r.dur;
    drawDisplay(tool, fmtValue(q, r.spec.res),
      done ? r.label : '측정 중…', done ? r.color : '#8fb7c9', done ? 1 : p);
    if (done) {
      tool.lastValue = r.target;
      tool.reading = null;
      if (FPTools.onMeasured) FPTools.onMeasured(tool, quantize(r.target, r.spec.res), r);
    }
  }
};

// ── 측정 실행 (좌클릭) ──────────────────────────────────────────────────────
FPTools.use = function () {
  const tool = this.slots[this.selected];
  if (!tool || !TOOL_SPEC[tool.kind]) return;
  const ppm = FPWorld.co2;

  const hit = pickTarget();   // 하늘을 겨눠도 null이 아니라 '대기'가 돌아온다

  if (tool.kind === 'co2') {
    // 대기 중에서만 - 물속에서는 공기를 못 빨아들임
    if (FPPlayer.underwater) {
      tool.reading = null;
      drawDisplay(tool, 'ERR', '수중 · 측정 불가', '#e2705f');
      return;
    }
    const v = measureCO2(ppm, hit.point.x, hit.point.z, hit.zone, FPPlayer.pos.x, FPPlayer.pos.z);
    const label = hit.zone === 'city' ? '도심' : (hit.zone === 'green' ? '녹지' : '해양');
    this.beginReading(tool, v, `ppm · ${label}`, '#f0b45c');
  } else if (tool.kind === 'temp') {
    const v = measureTemperature(hit.spot, hit.point.x, hit.point.z, ppm, hit.aboveGround);
    this.beginReading(tool, v, `°C · ${SPOT[hit.spot].label}`, '#ff8f6b');
  } else if (tool.kind === 'ph') {
    // pH는 바다에서만. 해양 구역이면서 수면 아래인 지점만 유효.
    const waterY = FPPlayer.waterHeightAt(hit.point.x, hit.point.z, performance.now() / 1000);
    const inSea = hit.zone === 'ocean' && (hit.isWater || hit.point.y <= waterY + 0.002);
    if (!inSea) {
      tool.reading = null;
      drawDisplay(tool, '--', '바다에서만 측정', '#8a949c');
      return;
    }
    this.beginReading(tool, measurePH(ppm), 'pH · 해수', '#7fd8ff');
  }
  // 야장이 기록할 수 있게 이번 측정의 지점 정보를 붙여 둔다
  if (tool.reading) {
    tool.reading.spot = hit.spot;
    tool.reading.zone = hit.zone;
    tool.reading.at = hit.point.clone();
  }
};

// ── 단축바 UI ───────────────────────────────────────────────────────────────
const HOTBAR_LABELS = ['온도계', 'pH미터', 'CO₂센서', '', '', '', '', '', ''];
const HOTBAR_ICONS = ['🌡️', '🧪', '🌫️', '', '', '', '', '', ''];
function buildHotbarUI() {
  const bar = document.getElementById('hotbar');
  bar.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `<span class="num">${i + 1}</span>` +
      (HOTBAR_ICONS[i] ? `<span class="ico">${HOTBAR_ICONS[i]}</span><span class="nm">${HOTBAR_LABELS[i]}</span>` : '');
    el.addEventListener('click', () => FPTools.select(i));
    bar.appendChild(el);
  }
}
