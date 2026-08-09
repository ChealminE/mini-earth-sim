// ============================================================================
// 1인칭 모드 - 월드(지형·소품) 구축
// ----------------------------------------------------------------------------
// js/common.js의 지형 생성 코드를 "복사해서" 1인칭 스케일에 맞게 다시 만든 파일이다.
// 원본을 import 하지 않고 복사한 이유:
//   - common.js의 buildAcrylicScene()은 카메라·조명·그래프·탭까지 한 덩어리로 묶여 있어서
//     지형만 떼어 쓸 수 없고, 억지로 떼려면 원본을 크게 뜯어고쳐야 한다.
//   - 1인칭은 "눈높이 3cm"에서 보는 그림이라 원본과 필요한 밀도/타일링/세그먼트 수가
//     아예 다르다(아래 FP_ 상수들 참고). 같은 코드로 둘 다 만족시킬 수 없다.
// 그래서 원본(main 브랜치)은 그대로 두고, 이 파일에서 독립적으로 다시 짓는다.
//
// 좌표계는 원본과 완전히 동일하게 유지했다. 원본 씬의 좌표를 그대로 대입해도 맞는다.
// ============================================================================

// ── 원본(common.js)에서 그대로 가져온 지형 기준 상수 ──────────────────────
const BOX_W = 6, BOX_D = 3, BOX_H = 2.3;
const TERRAIN_TOP = BOX_H * 0.2;
const GROUND_BASE = TERRAIN_TOP * 0.94;   // 습지·숲·도시 공통 지표면
const OCEAN_BASE = TERRAIN_TOP * 0.3;     // 해저 모래바닥
const ZONE_W = BOX_W / 3;                 // 구역 하나의 폭 = 2
const TERRAIN_HALF_W = (ZONE_W - 0.015) / 2, TERRAIN_HALF_D = (BOX_D - 0.02) / 2;
const WETLAND_TERRAIN_AMP = 0.012, WETLAND_TERRAIN_SEED = 4.2;
const OCEAN_TERRAIN_AMP = 0.02, OCEAN_TERRAIN_SEED = 1.7;
const GREEN_HALF_W = TERRAIN_HALF_W * 0.9, GREEN_HALF_D = TERRAIN_HALF_D * 0.9;
const MUD_X = -0.2, MUD_Z = 0.1, MUD_AVOID_R = 0.14;
const waveBaseY = TERRAIN_TOP * 0.55;     // 수면 기준선

// 파도 높이 수식도 원본과 동일 (1인칭에서 물에 들어갔을 때 수면 판정에 씀)
const WAVE_SWELL_BASE = 0.03, WAVE_SWELL_FRONT = 0.05, WAVE_SWELL_INTENSITY = 0.015;
const WAVE_CHOP_AMP = 0.007;
function waveHeightAt(lx, ly, t, intensity, halfD) {
  const frontT = Math.max(0, Math.min(1, (-ly / halfD + 1) / 2));
  const swell = Math.sin(lx * 1.5 + t * 0.7) * (WAVE_SWELL_BASE + frontT * WAVE_SWELL_FRONT + intensity * WAVE_SWELL_INTENSITY);
  const chop = Math.sin(lx * 6 + t * 2.1 + ly * 3) * WAVE_CHOP_AMP * frontT;
  return swell + chop;
}

function terrainNoise(lx, lz, amplitude, seed) {
  const u = lx / TERRAIN_HALF_W, v = lz / TERRAIN_HALF_D;
  const falloff = Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v);
  const n = Math.sin(lx * 3.1 + seed) * Math.cos(lz * 2.7 + seed * 1.3) * 0.5 +
            Math.sin(lx * 7.3 - seed * 0.7) * Math.cos(lz * 6.1 + seed) * 0.25 +
            Math.sin(lx * 13.1 + seed * 2.1) * Math.cos(lz * 11.7 - seed) * 0.125;
  return amplitude * n * falloff;
}
function wetlandY(x, z) { return GROUND_BASE + terrainNoise(x, z, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED); }

// ── 1인칭 전용 파라미터 ────────────────────────────────────────────────────
// 눈높이 0.032유닛을 사람 눈높이(약 1.6m)로 보면 1유닛 ≈ 50m가 된다.
// 이 환산이 이 파일 전체의 "얼마나 촘촘해야 하는가"를 결정한다.
const FP = {
  UNITS_PER_METER: 1 / 50,      // 1m = 0.02유닛
  // 원본은 멀리서 내려다보는 그림이라 이 값들이 전부 성겼다. 눈높이에서 보면
  // 텍스처는 흐릿하게 늘어나 보이고 지형은 각져 보이므로 전부 크게 올린다.
  TERRAIN_SEG_X: 96, TERRAIN_SEG_Z: 64,   // 원본 24x16 -> 한 폴리곤이 4m에서 1m로
  GROUND_REPEAT_X: 40, GROUND_REPEAT_Z: 60, // 텍스처 한 타일 ≈ 2.5m
  GRASS_COUNT: 5200,            // 원본 240개는 눈높이에서 보면 사실상 맨땅
};

// 월드 전체를 담고 바깥에 넘겨줄 객체
const FPWorld = {
  scene: null,
  walkables: [],      // 레이캐스터가 바닥 높이를 잴 대상 (지형 표면)
  cylinders: [],      // 원기둥 충돌체 {x, z, r, top}
  boxes: [],          // 사각 충돌체 {minX, maxX, minZ, maxZ, top}
  sun: null,
  skyMat: null,
  waterMesh: null,
  waveGeo: null, wavePosAttr: null, waveBase: null,
  co2: 418,
  BOX_W, BOX_D, BOX_H, ZONE_W, GROUND_BASE, OCEAN_BASE, waveBaseY, TERRAIN_TOP,
  waveHeightAt, wetlandY,
};

const CLEAR_SKY = new THREE.Color(0xbcdcf5);
const HAZY_SKY = new THREE.Color(0xc99a5e);

function buildFirstPersonWorld(renderer) {
  const scene = new THREE.Scene();
  FPWorld.scene = scene;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const loader = new THREE.TextureLoader();
  // 지면 텍스처는 눈앞에서 보게 되므로 반복 횟수를 크게 올리고 이방성 필터링을 최대로 준다.
  // (이방성 필터가 없으면 시선이 지면과 나란해지는 먼 바닥이 심하게 뭉개진다 - 1인칭에서 가장 티나는 부분)
  function tex(path, rx, ry, srgb = true) {
    const t = loader.load(path);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = maxAniso;
    return t;
  }
  const T = {
    oceanFloor: tex('/texture_image/ocean_floor.jpg', FP.GROUND_REPEAT_X, FP.GROUND_REPEAT_Z),
    wetlandSoil: tex('/texture_image/wetland_soil.jpg', 6, 6),
    forestGrass: tex('/texture_image/forest_grass.jpg', FP.GROUND_REPEAT_X, FP.GROUND_REPEAT_Z),
    cityPavement: tex('/texture_image/city_pavement.jpg', FP.GROUND_REPEAT_X, FP.GROUND_REPEAT_Z),
    cityRoad: tex('/texture_image/city_road.jpg', 1, 1),
    iceCrack: tex('/texture_image/ice_crack.jpg', 2, 2),
    treeBark: tex('/texture_image/tree_bark.jpg', 2, 3),
    buildingFacade: tex('/texture_image/building_facade.jpg', 1, 1),
  };
  const waterNormal = loader.load('/texture_image/water_normal.png');
  waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  waterNormal.repeat.set(12, 10);
  FPWorld.waterNormal = waterNormal;

  // ── 하늘 + 안개 ──────────────────────────────────────────────────────────
  // 원본은 아크릴 상자를 밖에서 보는 구조라 벽이 투명해도 됐지만, 1인칭은 상자 "안"이라
  // 투명 벽 너머로 검은 배경이 그대로 보인다. 그래서 벽/뚜껑 대신 하늘 돔을 씌웠다.
  // 이 프로젝트 주제상 이 하늘이 곧 온실 뚜껑이므로, CO2가 오르면 하늘이 누렇게 흐려진다.
  // 단색이면 하늘이 판때기처럼 보여서, 천정은 어둡고 지평선은 밝은 세로 그라데이션을
  // 캔버스로 구워 입힌다. CO2 틴트는 material.color로 곱해지므로 그라데이션과 공존한다.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 128;
  const sctx = skyCanvas.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.00, '#6f93b8');   // 천정
  grad.addColorStop(0.45, '#a8c6de');
  grad.addColorStop(0.62, '#e3eef6');   // 지평선 부근이 가장 밝음
  grad.addColorStop(1.00, '#cfd8dd');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 4, 128);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, color: CLEAR_SKY.clone(), side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat);
  scene.add(sky);
  FPWorld.skyMat = skyMat;
  scene.fog = new THREE.Fog(CLEAR_SKY.clone(), 0.25, 6.5);

  // ── 조명 ────────────────────────────────────────────────────────────────
  // 원본의 책상 스탠드(SpotLight)는 1인칭에선 하늘에 뜬 정체불명 원뿔로 보여서 태양광으로 교체.
  // 그림자 카메라는 매 프레임 플레이어를 따라다니게 해서(updateSunShadow) 좁은 범위에
  // 그림자맵을 몰아준다 - 안 그러면 6x3 전체를 2048로 덮어서 눈앞 그림자가 뭉개진다.
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(2.2, 3.0, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.05;
  sun.shadow.camera.far = 8;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  FPWorld.sun = sun;
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x6b6350, 0.7));

  const world = new THREE.Group();
  scene.add(world);
  FPWorld.root = world;

  // ── 구역 바닥 블록 ───────────────────────────────────────────────────────
  // 원본은 구역 블록 사이에 0.015유닛 틈을 둬서 "세 덩어리"로 보이게 했지만, 1인칭에서는
  // 그 틈(실척 75cm)이 바닥 없는 구멍이 되어 걸어서 건너다 추락한다. 여기서는 블록을
  // 정확히 맞닿게(ZONE_W, BOX_D 그대로) 넓혀서 지면이 끊기지 않게 한다.
  function zoneFloor(xOffset, groundTopY, texture, sideColor, topColor = 0xffffff) {
    const h = Math.max(groundTopY, 0.01);
    const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.95 });
    const topMat = new THREE.MeshStandardMaterial({ map: texture, color: topColor, roughness: 0.9 });
    const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
    const block = new THREE.Mesh(new THREE.BoxGeometry(ZONE_W, h, BOX_D), mats);
    block.position.set(xOffset, h / 2, 0);
    block.receiveShadow = true;
    block.castShadow = true;
    world.add(block);
    FPWorld.walkables.push(block);
    return block;
  }
  zoneFloor(-ZONE_W, OCEAN_BASE, T.oceanFloor, 0xa89f83);
  zoneFloor(0, GROUND_BASE, T.forestGrass, 0x2c331c);
  zoneFloor(ZONE_W, GROUND_BASE, T.cityPavement, 0x3a3832, 0x9a9a9a);

  // ── 절차적 지형 캡 (원본과 같은 노이즈, 세그먼트만 크게 올림) ─────────────
  // 캡도 블록과 같은 크기로. terrainNoise의 falloff가 |u|>1에서 0으로 잘리므로
  // 넓혀도 가장자리는 여전히 평평하게 이어진다.
  function createTerrainCap(xOffset, groundTopY, texture, amplitude, seed) {
    const geo = new THREE.PlaneGeometry(ZONE_W, BOX_D, FP.TERRAIN_SEG_X, FP.TERRAIN_SEG_Z);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, terrainNoise(pos.getX(i), pos.getY(i), amplitude, seed));
    }
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    // 원본은 flatShading으로 저폴리 각진 맛을 냈지만, 1인칭에선 발밑이 각져 보여서 부드럽게 간다
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
    mesh.position.set(xOffset, groundTopY + 0.001, 0);
    mesh.receiveShadow = true;
    world.add(mesh);
    FPWorld.walkables.push(mesh);
    return mesh;
  }
  createTerrainCap(-ZONE_W, OCEAN_BASE, T.oceanFloor, OCEAN_TERRAIN_AMP, OCEAN_TERRAIN_SEED);
  createTerrainCap(0, GROUND_BASE, T.forestGrass, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED);

  // ── 해변 경사로 ─────────────────────────────────────────────────────────
  // 육지(0.432)와 해저(0.138)의 낙차는 실척 약 15m라, 1인칭에선 바다에 한번 빠지면
  // 영영 못 올라온다(점프로 넘을 수 있는 높이가 아님). 걸어서 바다에 들어갔다 나올 수
  // 있도록 육지-바다 경계에 완만한 모래 경사로를 하나 놓는다.
  // 기울기 ≈35도라 한 프레임당 상승량이 STEP_H보다 훨씬 작아 자연스럽게 걸어 오르내린다.
  {
    // 경사로 위쪽 끝은 육지 경계(x=-1)를 넘어 -0.94까지 올라가고, 높이도 지형 캡
    // (GROUND_BASE+0.001)보다 확실히 위에서 끝난다. 딱 맞춰 끝내면 마지막 한 걸음의
    // 단차가 STEP_H를 아슬아슬하게 넘겨서 못 올라오는 일이 생긴다(실제로 겪음).
    // 핵심: 경사면은 육지 경계(x=-1) '이전'인 -1.02에서 이미 지면 높이에 도달하고,
    // 거기서 -0.94까지는 평평하게 육지 위로 걸쳐진다. 경사가 경계에서 끝나면 그 지점의
    // 지면(캡)이 더 높아 레이캐스트가 캡을 집어버려서 마지막에 막힌다.
    const RAMP_TOP_Y = GROUND_BASE + 0.004;   // 지형 캡(+0.001)보다 확실히 위
    const shape = new THREE.Shape();
    shape.moveTo(-1.55, OCEAN_BASE);      // 바다 쪽 끝(해저와 같은 높이로 맞물림)
    shape.lineTo(-1.02, RAMP_TOP_Y);      // 경계 직전에 지면 높이 도달
    shape.lineTo(-0.94, RAMP_TOP_Y);      // 육지 위로 평평하게 걸침
    shape.lineTo(-0.94, OCEAN_BASE - 0.06);
    shape.lineTo(-1.55, OCEAN_BASE - 0.06);
    shape.lineTo(-1.55, OCEAN_BASE);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.95, bevelEnabled: false });
    geo.translate(0, 0, -0.475);          // z축 중앙 정렬
    const ramp = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.oceanFloor, roughness: 0.95 }));
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    world.add(ramp);
    FPWorld.walkables.push(ramp);
  }

  // ── 해양: 수면 + 물 몸통 ────────────────────────────────────────────────
  const oceanGroup = new THREE.Group();
  oceanGroup.position.x = -ZONE_W;
  world.add(oceanGroup);
  const waveW = ZONE_W - 0.08, waveD = BOX_D - 0.08;
  const waveGeo = new THREE.PlaneGeometry(waveW, waveD, 72, 48);
  const waveMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b4a66, transparent: true, opacity: 0.86, roughness: 0.08,
    transmission: 0.35, clearcoat: 1, side: THREE.DoubleSide,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.5, 0.5), depthWrite: false,
  });
  const waveMesh = new THREE.Mesh(waveGeo, waveMat);
  waveMesh.rotation.x = -Math.PI / 2;
  waveMesh.position.y = waveBaseY;
  oceanGroup.add(waveMesh);
  FPWorld.waterMesh = waveMesh;
  FPWorld.waveGeo = waveGeo;
  FPWorld.wavePosAttr = waveGeo.attributes.position;
  FPWorld.waveBase = Float32Array.from(waveGeo.attributes.position.array);
  FPWorld.waveD = waveD;

  const waterH = Math.max(0.03, waveBaseY + 0.1 - OCEAN_BASE);
  const waterBody = new THREE.Mesh(
    new THREE.BoxGeometry(waveW, waterH, waveD),
    new THREE.MeshPhysicalMaterial({ color: 0x0e2c45, transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false })
  );
  waterBody.position.y = OCEAN_BASE + waterH / 2;
  oceanGroup.add(waterBody);

  // 빙하: 1인칭에선 물 위에 뜬 거대한 유빙이라 올라설 수 있게 충돌체로도 등록
  const iceMat = new THREE.MeshPhysicalMaterial({ map: T.iceCrack, color: 0xf3fbff, roughness: 0.15, clearcoat: 0.8, flatShading: true });
  [[-0.5, -0.4], [0.3, 0.3], [0.55, -0.5], [-0.15, 0.5]].forEach(([x, z]) => {
    const s = 0.05 + Math.random() * 0.03;
    const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), iceMat);
    ice.position.set(x, waveBaseY + s * 0.35, z);
    ice.castShadow = true;
    oceanGroup.add(ice);
    FPWorld.cylinders.push({ x: x - ZONE_W, z, r: s * 0.95, top: ice.position.y + s * 0.5 });
  });

  // ── 습지·숲 ─────────────────────────────────────────────────────────────
  function scatterInGreenZone() {
    let x, z, tries = 0;
    do {
      x = (Math.random() - 0.5) * 2 * GREEN_HALF_W;
      z = (Math.random() - 0.5) * 2 * GREEN_HALF_D;
      tries++;
    } while (Math.hypot(x - MUD_X, z - MUD_Z) < MUD_AVOID_R && tries < 20);
    return [x, z];
  }

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x74705f, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const [x, z] = scatterInGreenZone();
    const s = 0.05 + Math.random() * 0.035;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    rock.position.set(x, wetlandY(x, z) + s * 0.5, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
    // 바위 윗면이 STEP_H보다 낮으면 걸어서 넘어가고, 높으면 막힌다 (fp-player.js가 top으로 판단).
    // 반경은 s보다 작게 잡으면 안 된다 - DodecahedronGeometry의 s는 '외접' 반경이라
    // 충돌 경계에 서도 꼭짓점 방향에서는 아직 메시 안쪽이라 화면이 바위로 꽉 차버린다.
    FPWorld.cylinders.push({ x, z, r: s * 0.98, top: rock.position.y + s * 0.6 });
  }

  const trunkMat = new THREE.MeshStandardMaterial({ map: T.treeBark, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7433, roughness: 0.8, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const [x, z] = scatterInGreenZone();
    const tree = new THREE.Group();
    const h = 0.14 + Math.random() * 0.09;
    const rTop = 0.012, rBot = 0.018;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 8), trunkMat);
    stem.position.y = h / 2;
    stem.castShadow = true;
    tree.add(stem);
    const leafCount = 3 + Math.floor(Math.random() * 3);
    for (let li = 0; li < leafCount; li++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.02, 7, 6), leafMat);
      leaf.scale.set(1, 0.55, 1.6);
      const ang = (li / leafCount) * Math.PI * 2;
      leaf.position.set(Math.cos(ang) * 0.03, h * (0.7 + Math.random() * 0.25), Math.sin(ang) * 0.03);
      leaf.castShadow = true;
      tree.add(leaf);
    }
    tree.position.set(x, wetlandY(x, z), z);
    world.add(tree);
    // 줄기만 막고 잎은 통과 - 나무 밑을 지나갈 수 있어야 자연스럽다
    FPWorld.cylinders.push({ x, z, r: rBot + 0.004, top: wetlandY(x, z) + h });
  }

  // 진흙 패치 + 물웅덩이 (걸어서 지나갈 수 있게 충돌체 없음)
  const mudY = wetlandY(MUD_X, MUD_Z);
  const mud = new THREE.Mesh(
    new THREE.CircleGeometry(0.1, 40),
    new THREE.MeshPhysicalMaterial({ map: T.wetlandSoil, roughness: 0.25, clearcoat: 0.7 })
  );
  mud.rotation.x = -Math.PI / 2;
  mud.position.set(MUD_X, mudY + 0.006, MUD_Z);
  mud.receiveShadow = true;
  world.add(mud);
  const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x3a6a7a, transparent: true, opacity: 0.8, roughness: 0.05, clearcoat: 1 });
  [[-0.03, -0.02, 0.035], [0.025, 0.03, 0.028], [-0.02, 0.04, 0.02]].forEach(([px, pz, pr]) => {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(pr, 20), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(MUD_X + px, wetlandY(MUD_X + px, MUD_Z + pz) + 0.009, MUD_Z + pz);
    world.add(puddle);
  });

  // 풀: 눈높이에서 밀도가 생명이라 개수를 20배 이상 올림 (인스턴싱이라 draw call은 1회).
  // 처음엔 원본 높이(0.045)를 그대로 썼더니 사람 키를 넘어서 화면이 초록 뿔로 뒤덮였다.
  // 허리~가슴 높이로 낮추고, 포기마다 색/기울기를 조금씩 흩어서 균일한 느낌을 없앰.
  const grassGeo = new THREE.ConeGeometry(0.0035, 0.026, 4);
  grassGeo.translate(0, 0.013, 0);
  const grassMesh = new THREE.InstancedMesh(
    grassGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }),
    FP.GRASS_COUNT
  );
  grassMesh.castShadow = true;
  {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0, attempts = 0;
    while (placed < FP.GRASS_COUNT && attempts < FP.GRASS_COUNT * 6) {
      attempts++;
      const gx = (Math.random() - 0.5) * 2 * GREEN_HALF_W;
      const gz = (Math.random() - 0.5) * 2 * GREEN_HALF_D;
      if (Math.hypot(gx - MUD_X, gz - MUD_Z) < 0.13) continue;
      dummy.position.set(gx, wetlandY(gx, gz), gz);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.35,        // 살짝 눕혀서 바람 맞은 느낌
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.35
      );
      const gs = 0.55 + Math.random() * 0.75;
      dummy.scale.set(gs, gs * (0.7 + Math.random() * 0.8), gs);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(placed, dummy.matrix);
      // 채도·명도를 조금씩 흩어 놓으면 같은 모델 수천 개라도 덜 인위적으로 보인다
      col.setHSL(0.26 + Math.random() * 0.06, 0.42 + Math.random() * 0.22, 0.32 + Math.random() * 0.18);
      grassMesh.setColorAt(placed, col);
      placed++;
    }
    grassMesh.count = placed;
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  }
  world.add(grassMesh);

  // ── 도시 ────────────────────────────────────────────────────────────────
  const cityGroup = new THREE.Group();
  cityGroup.position.x = ZONE_W;
  world.add(cityGroup);

  const bldColors = [0x9aa0a8, 0x848a92, 0xb0b5bb, 0x7a8088];
  const bldDefs = [
    [-0.55, -0.5, 0.16, 0.35], [-0.15, -0.55, 0.13, 0.24], [0.3, -0.4, 0.18, 0.48],
    [0.55, -0.15, 0.12, 0.28], [-0.5, 0.2, 0.15, 0.32], [-0.1, 0.5, 0.16, 0.42],
    [0.35, 0.45, 0.13, 0.22], [0.55, 0.15, 0.14, 0.36]
  ];
  bldDefs.forEach(([x, z, w, h], i) => {
    const facade = T.buildingFacade.clone();
    facade.needsUpdate = true;
    facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    facade.anisotropy = maxAniso;
    // 텍스처 한 장 안에 이미 창문이 여러 줄 들어있어서, 반복을 많이 주면 층이 수십 층으로
    // 불어나 줄무늬처럼 보인다(처음에 그렇게 만들었다가 45층짜리로 보여서 낮춤).
    // h=0.48유닛 ≈ 24m ≈ 8층이 되도록 세로 반복은 2회 정도만.
    facade.repeat.set(Math.max(1, Math.round(w * 10)), Math.max(1, Math.round(h * 4)));
    const bld = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshStandardMaterial({ map: facade, color: bldColors[i % bldColors.length], roughness: 0.5, metalness: 0.15 })
    );
    bld.position.set(x, GROUND_BASE + h / 2, z);
    bld.castShadow = true;
    bld.receiveShadow = true;
    cityGroup.add(bld);
    // 충돌체는 월드 좌표로 등록 (cityGroup이 +ZONE_W만큼 밀려 있음)
    FPWorld.boxes.push({
      minX: x + ZONE_W - w / 2, maxX: x + ZONE_W + w / 2,
      minZ: z - w / 2, maxZ: z + w / 2,
      top: GROUND_BASE + h,
    });
  });

  // 도로 (main 브랜치에서 추가한 십자 교차로 그대로)
  const ROAD_W = 0.12, MAIN_ROAD_Z = -0.01, CROSS_ROAD_X = 0.09;
  function buildRoadStrip(length, alongZ) {
    const geo = new THREE.PlaneGeometry(length, ROAD_W);
    geo.rotateX(-Math.PI / 2);
    if (alongZ) geo.rotateY(Math.PI / 2);
    const t = T.cityRoad.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.repeat.set(Math.max(1, Math.round(length / 0.14)), 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    mesh.receiveShadow = true;
    return mesh;
  }
  const mainRoad = buildRoadStrip(ZONE_W - 0.015, false);
  mainRoad.position.set(0, GROUND_BASE + 0.002, MAIN_ROAD_Z);
  cityGroup.add(mainRoad);
  const crossRoad = buildRoadStrip(BOX_D - 0.02, true);
  crossRoad.position.set(CROSS_ROAD_X, GROUND_BASE + 0.0025, 0);
  cityGroup.add(crossRoad);

  // 자동차 (원본 모델 그대로, 충돌체 등록)
  const gasCarMat = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.4, metalness: 0.3 });
  const evCarMat = new THREE.MeshStandardMaterial({ color: 0x3fb0a0, roughness: 0.3, metalness: 0.4, emissive: 0x0d3a35, emissiveIntensity: 0.3 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide });
  function buildCarModel(bodyMat) {
    const group = new THREE.Group();
    const wheelR = 0.011, bodyH = 0.028, cabinH = 0.024, cabinWidth = 0.038;
    const bodyBottomY = wheelR * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, bodyH, 0.045), bodyMat);
    body.position.y = bodyBottomY + bodyH / 2;
    body.castShadow = true;
    group.add(body);
    const cabinBaseY = body.position.y + bodyH / 2;
    const profile = new THREE.Shape();
    profile.moveTo(-0.022, 0); profile.lineTo(-0.022, cabinH);
    profile.lineTo(0.004, cabinH); profile.lineTo(0.022, 0); profile.lineTo(-0.022, 0);
    const cabinGeo = new THREE.ExtrudeGeometry(profile, { depth: cabinWidth, bevelEnabled: false });
    cabinGeo.translate(-0.004, 0, -cabinWidth / 2);
    const cabin = new THREE.Mesh(cabinGeo, bodyMat);
    cabin.position.y = cabinBaseY;
    cabin.castShadow = true;
    group.add(cabin);
    const halfGW = cabinWidth / 2 - 0.003;
    const gx1 = 0.0012, gy1 = cabinBaseY + cabinH + 0.0008, gx2 = 0.0192, gy2 = cabinBaseY + 0.0008;
    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      gx1, gy1, -halfGW, gx1, gy1, halfGW, gx2, gy2, halfGW,
      gx1, gy1, -halfGW, gx2, gy2, halfGW, gx2, gy2, -halfGW,
    ]), 3));
    glassGeo.computeVertexNormals();
    group.add(new THREE.Mesh(glassGeo, glassMat));
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.008, 12);
    const fenderGeo = new THREE.BoxGeometry(0.024, 0.01, 0.006);
    [[-0.03, 0.024], [0.03, 0.024], [-0.03, -0.024], [0.03, -0.024]].forEach(([wx, wz]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, wheelR, wz);
      wheel.castShadow = true;
      group.add(wheel);
      const fender = new THREE.Mesh(fenderGeo, bodyMat);
      fender.position.set(wx, bodyBottomY, wz);
      group.add(fender);
    });
    return group;
  }
  const carSpots = [[-0.65, -0.15], [-0.3, 0.02], [0.05, -0.1], [0.4, 0.05], [0.65, -0.05],
                    [-0.5, 0.35], [-0.1, 0.32], [0.25, 0.3], [0.55, 0.35],
                    [-0.6, -0.55], [-0.05, -0.55], [0.5, -0.55]];
  carSpots.forEach((pos, i) => {
    const car = buildCarModel(i < 4 ? evCarMat : gasCarMat);
    car.position.set(pos[0], GROUND_BASE, pos[1]);
    car.rotation.y = (i % 3) * 0.04;
    cityGroup.add(car);
    FPWorld.boxes.push({
      minX: pos[0] + ZONE_W - 0.048, maxX: pos[0] + ZONE_W + 0.048,
      minZ: pos[1] - 0.026, maxZ: pos[1] + 0.026,
      top: GROUND_BASE + 0.062,
    });
  });

  // 공장 굴뚝 + 연기
  const stackTex = T.cityPavement.clone();
  stackTex.needsUpdate = true;
  stackTex.wrapS = stackTex.wrapT = THREE.RepeatWrapping;
  stackTex.repeat.set(8, 14);
  stackTex.anisotropy = maxAniso;
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.35, 16),
    new THREE.MeshStandardMaterial({ map: stackTex, color: 0x5c5852, roughness: 0.85 })
  );
  stack.position.set(0.6, GROUND_BASE + 0.175, 0.55);
  stack.castShadow = true;
  cityGroup.add(stack);
  FPWorld.cylinders.push({ x: 0.6 + ZONE_W, z: 0.55, r: 0.045, top: GROUND_BASE + 0.35 });

  const smokeCount = 90;
  const smokeGeo = new THREE.BufferGeometry();
  const smokePos = new Float32Array(smokeCount * 3);
  const smokeLife = new Float32Array(smokeCount);
  for (let i = 0; i < smokeCount; i++) { smokeLife[i] = Math.random(); }
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ color: 0x9a9a96, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false }));
  cityGroup.add(smoke);
  FPWorld.smoke = { geo: smokeGeo, life: smokeLife, count: smokeCount, x: 0.6, z: 0.55 };

  // 탄소포집 타워
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.3, 20),
    new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.3 })
  );
  tower.position.set(-0.65, GROUND_BASE + 0.15, 0.15);
  tower.castShadow = true;
  cityGroup.add(tower);
  const towerFan = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.008, 10, 20),
    new THREE.MeshStandardMaterial({ color: 0x2f8f7a, roughness: 0.3, metalness: 0.5, emissive: 0x0d3a30, emissiveIntensity: 0.4 })
  );
  towerFan.position.set(-0.65, GROUND_BASE + 0.3, 0.15);
  towerFan.rotation.x = Math.PI / 2;
  cityGroup.add(towerFan);
  FPWorld.towerFan = towerFan;
  FPWorld.cylinders.push({ x: -0.65 + ZONE_W, z: 0.15, r: 0.065, top: GROUND_BASE + 0.3 });

  return FPWorld;
}

// CO2 농도(280~600) -> 하늘색·안개 농도. 스모그가 심해지면 시야 자체가 좁아진다.
function applyWorldCO2(ppm) {
  FPWorld.co2 = ppm;
  const k = Math.min(1, Math.max(0, (ppm - 280) / (600 - 280)));
  const c = new THREE.Color().lerpColors(CLEAR_SKY, HAZY_SKY, k);
  FPWorld.skyMat.color.copy(c);
  FPWorld.scene.fog.color.copy(c);
  // 맑을 때 6.5유닛(≈325m)까지 보이다가, 최악일 때 1.9유닛(≈95m)까지 좁아짐
  FPWorld.scene.fog.far = 6.5 - k * 4.6;
  FPWorld.scene.fog.near = 0.25 - k * 0.2;
}

// 그림자 카메라를 플레이어 주변 좁은 범위로 계속 옮겨서 눈앞 그림자 해상도를 확보
function updateSunShadow(px, pz) {
  const sun = FPWorld.sun;
  sun.position.set(px + 0.9, 1.4, pz + 0.7);
  sun.target.position.set(px, FPWorld.GROUND_BASE, pz);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  const R = 0.55;
  cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
  cam.near = 0.05; cam.far = 3.2;
  cam.updateProjectionMatrix();
}
