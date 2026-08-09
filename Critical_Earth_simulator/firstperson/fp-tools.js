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

// ── 측정값 계산 ─────────────────────────────────────────────────────────────
// 도시가 가장 뜨겁고(아스팔트·건물 열섬) 바다가 가장 차갑다. CO2가 오르면 전체가 함께 오른다.
const TEMP_TABLE = {
  city:  { base: 32, rise: 10 },
  green: { base: 24, rise: 8 },
  ocean: { base: 18, rise: 6 },
};
function measureTemperature(zone, x, z, k) {
  const T = TEMP_TABLE[zone];
  // 같은 구역 안에서도 지점마다 조금씩 다르게 (측정하는 맛)
  const jitter = Math.sin(x * 37.1 + z * 21.7) * 0.5 + Math.sin(x * 11.3 - z * 53.9) * 0.35;
  return T.base + k * T.rise + jitter;
}
// 해양 pH: 산호 백화·생물 감소와 반드시 같은 값을 써야 하므로
// fp-world.js의 oceanPH() 하나만 쓴다 (측정값과 세계 상태가 어긋나지 않게)
function measurePH(ppm) {
  return oceanPH(ppm);
}
// 대기 CO2: 기본 농도 + 굴뚝·내연기관차 배기구 근처의 국소 상승분
function measureCO2(ppm, x, z) {
  let extra = 0;
  const sx = FPWorld.ZONE_W + 0.6, sz = 0.55;             // 공장 굴뚝 월드 좌표
  extra += Math.max(0, 1 - Math.hypot(x - sx, z - sz) / 0.55) * 260 * FPWorld.co2k;
  for (const c of FPWorld.cars) {
    if (!c.isGas) continue;
    extra += Math.max(0, 1 - Math.hypot(x - c.tail.x, z - c.tail.z) / 0.10) * 110;
  }
  return ppm + extra;
}

// 크로스헤어가 가리키는 지점이 어느 구역/무엇인지 판정
function pickTarget() {
  const cam = FPTools.camera;
  // 측정은 렌더 사이(마우스 이벤트)에서 호출되므로 카메라 행렬이 직전 프레임 것일 수 있다.
  // setFromCamera는 matrixWorld를 그대로 쓰기 때문에 여기서 한 번 갱신해줘야 조준이 정확해진다.
  cam.updateMatrixWorld();
  FPTools._rc.setFromCamera({ x: 0, y: 0 }, cam);
  FPTools._rc.far = 1.4;   // 실척 약 70m까지 닿음
  const targets = FPWorld.walkables.concat([FPWorld.waterMesh]);
  const hits = FPTools._rc.intersectObjects(targets, false);
  if (!hits.length) return null;
  const h = hits[0];
  const p = h.point;
  const isWater = h.object === FPWorld.waterMesh;
  const half = FPWorld.ZONE_W / 2;
  let zone;
  if (isWater) zone = 'ocean';
  else if (p.x < -half) zone = 'ocean';       // 해저 모래바닥·해변 경사로
  else if (p.x > half) zone = 'city';
  else zone = 'green';
  return { point: p, zone, isWater, dist: h.distance };
}

// ── 도구 정의 ───────────────────────────────────────────────────────────────
function makeDisplayCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 96;
  return cv;
}
function drawDisplay(tool, big, small, color) {
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

// ── 측정 실행 (좌클릭) ──────────────────────────────────────────────────────
FPTools.use = function () {
  const tool = this.slots[this.selected];
  if (!tool) return;
  const k = FPWorld.co2k, ppm = FPWorld.co2;

  if (tool.kind === 'co2') {
    // 대기 중에서만 - 물속에서는 공기를 못 빨아들임
    if (FPPlayer.underwater) {
      drawDisplay(tool, 'ERR', '수중 · 측정 불가', '#e2705f');
      return;
    }
    const hit = pickTarget();
    const px = hit ? hit.point.x : FPPlayer.pos.x;
    const pz = hit ? hit.point.z : FPPlayer.pos.z;
    drawDisplay(tool, Math.round(measureCO2(ppm, px, pz)).toString(), 'ppm CO₂', '#f0b45c');
    return;
  }

  const hit = pickTarget();
  if (!hit) {
    drawDisplay(tool, '--', '측정 대상 없음', '#8a949c');
    return;
  }

  if (tool.kind === 'temp') {
    const v = measureTemperature(hit.zone, hit.point.x, hit.point.z, k);
    const label = hit.zone === 'city' ? '도시 지면' : (hit.zone === 'green' ? '녹지 지면' : '해수');
    drawDisplay(tool, v.toFixed(1), `°C · ${label}`, '#ff8f6b');
  } else if (tool.kind === 'ph') {
    // pH는 바다에서만. 해양 구역이면서 수면 아래인 지점만 유효.
    const waterY = FPPlayer.waterHeightAt(hit.point.x, hit.point.z, performance.now() / 1000);
    const inSea = hit.zone === 'ocean' && (hit.isWater || hit.point.y <= waterY + 0.002);
    if (!inSea) {
      drawDisplay(tool, '--', '바다에서만 측정', '#8a949c');
      return;
    }
    drawDisplay(tool, measurePH(ppm).toFixed(2), 'pH · 해수', '#7fd8ff');
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
