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

// ── 파도 ────────────────────────────────────────────────────────────────────
// 원본은 "앞쪽에서만 크게 부서지는" 한 방향 파도였다. 1인칭에서는 수면 위에 서서 사방을
// 둘러보게 되므로, 방향성 없이 사방으로 잘게 겹치는 3옥타브(큰 너울 + 중간 물결 + 잔물결)로
// 바꿨다. 잔물결이 촘촘할수록 표면 법선이 여러 방향을 향해서, 광원을 등지고 있어도
// 어딘가는 하늘/전등을 반사하게 된다(= 항상 반짝이는 수면).
const WAVE_OCT = {
  swellA: 0.020, swellB: 0.014,   // 큰 너울 (느리고 김)
  midA: 0.008, midB: 0.006,       // 중간 물결
  ripA: 0.0028, ripB: 0.0022,     // 잔물결 (반사 반짝임을 만드는 층)
};
// 최대 진폭 = 전 옥타브 합 * 폭풍계수. 육지(GROUND_BASE)보다 확실히 낮게 유지된다.
const WAVE_MAX_AMPLITUDE =
  (WAVE_OCT.swellA + WAVE_OCT.swellB + WAVE_OCT.midA + WAVE_OCT.midB + WAVE_OCT.ripA + WAVE_OCT.ripB) * 1.5;
function waveHeightAt(lx, ly, t, intensity, halfD) {
  const swell = Math.sin(lx * 1.5 + t * 0.70) * WAVE_OCT.swellA
              + Math.sin(ly * 1.9 - t * 0.55) * WAVE_OCT.swellB;
  const mid = Math.sin(lx * 5.5 + ly * 4.2 + t * 1.60) * WAVE_OCT.midA
            + Math.sin(ly * 6.3 - lx * 4.1 + t * 1.90) * WAVE_OCT.midB;
  const ripple = Math.sin(lx * 14.0 + ly * 11.0 + t * 3.40) * WAVE_OCT.ripA
               + Math.sin(ly * 15.0 - lx * 17.0 + t * 4.10) * WAVE_OCT.ripB;
  return (swell + mid + ripple) * (1 + intensity * 0.5);   // CO2가 높을수록 거칠어짐
}

// 파도 표면의 법선을 '미분으로 직접' 구한다.
// three.js의 computeVertexNormals()는 면마다 외적을 구해 정점에 누적·정규화하는 방식이라
// 정점 12,500개를 매 프레임 처리하면 3ms 넘게 먹는다(측정치). 파도 수식을 이미 알고 있으니
// 편미분 한 번이면 끝나고, 결과도 면 평균이 아니라 정확한 접평면 법선이라 반사가 더 매끈하다.
// 반환은 waveMesh 로컬 좌표계 기준 - 이 평면은 -90도 회전해서 쓰므로 로컬 +z가 '위'다.
function waveNormalAt(lx, ly, t, intensity, out) {
  const S = 1 + intensity * 0.5, O = WAVE_OCT;
  const c1 = Math.cos(lx * 1.5 + t * 0.70);
  const c2 = Math.cos(ly * 1.9 - t * 0.55);
  const c3 = Math.cos(lx * 5.5 + ly * 4.2 + t * 1.60);
  const c4 = Math.cos(ly * 6.3 - lx * 4.1 + t * 1.90);
  const c5 = Math.cos(lx * 14.0 + ly * 11.0 + t * 3.40);
  const c6 = Math.cos(ly * 15.0 - lx * 17.0 + t * 4.10);
  const dx = (O.swellA * 1.5 * c1 + O.midA * 5.5 * c3 - O.midB * 4.1 * c4
            + O.ripA * 14.0 * c5 - O.ripB * 17.0 * c6) * S;
  const dy = (O.swellB * 1.9 * c2 + O.midA * 4.2 * c3 + O.midB * 6.3 * c4
            + O.ripA * 11.0 * c5 + O.ripB * 15.0 * c6) * S;
  const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
  out[0] = -dx * inv; out[1] = -dy * inv; out[2] = inv;
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
  waveHeightAt, waveNormalAt, wetlandY,
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
  // 지오메트리 잔물결보다 더 잘게 - 미세 법선이 흩어져야 반사가 잘게 반짝인다
  waterNormal.repeat.set(28, 24);
  waterNormal.anisotropy = maxAniso;
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

  // ── 환경맵 ──────────────────────────────────────────────────────────────
  // 이게 없으면 물은 "광원이 정면에 있을 때 생기는 하이라이트"만 보인다(= 태양을 등지면
  // 수면이 그냥 단색). PMREM으로 하늘+전등+지면을 구운 환경맵을 scene.environment로 깔면,
  // 수면의 각 지점이 자기 법선 방향의 하늘을 반사하므로 어느 방향을 보든 반사가 살아있다.
  {
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(
      new THREE.SphereGeometry(10, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
    );
    envScene.add(envSky);
    // 전등 자리에 아주 밝은 판 - 수면에 길게 끌리는 반사 띠를 만든다
    const lampPanel = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff6dc })
    );
    lampPanel.position.set(2.0, 4.2, 0.3).normalize().multiplyScalar(7);
    envScene.add(lampPanel);
    // 아래쪽 지면(반사에 초록/회색 기운을 줌)
    const envGround = new THREE.Mesh(
      new THREE.SphereGeometry(9.6, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x4a5340, side: THREE.BackSide })
    );
    envGround.scale.y = 0.35;
    envGround.position.y = -3.2;
    envScene.add(envGround);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    scene.environment = rt.texture;
    FPWorld.envMap = rt.texture;
  }

  // ── 거대 전등 (원본 책상 스탠드를 그대로, 1인칭 스케일에서 보면 초대형 구조물) ──
  // "미니 지구 안에 들어와 있다"는 설정을 성립시키는 핵심 소품. 원본과 똑같은 좌표·치수를
  // 쓰는데, 눈높이 1.6m 기준으로는 기둥이 127m짜리 탑이 된다. 이 전등의 전구가 곧 태양이다.
  const lampGroup = new THREE.Group();
  lampGroup.position.set(3.6, 0, 2.0);
  scene.add(lampGroup);
  const lampMetal = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.45, metalness: 0.55 });
  const LAMP_POLE_H = 2.55;
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.04, 24), lampMetal);
  lampBase.position.y = 0.02;
  lampGroup.add(lampBase);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, LAMP_POLE_H, 16), lampMetal);
  lampPole.position.y = LAMP_POLE_H / 2;
  lampGroup.add(lampPole);

  const armStart = new THREE.Vector3(0, LAMP_POLE_H, 0);
  const armEnd = new THREE.Vector3(-1.6, LAMP_POLE_H - 0.05, -1.7);
  const armDir = new THREE.Vector3().subVectors(armEnd, armStart);
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, armDir.length(), 12), lampMetal);
  lampArm.position.copy(armStart).addScaledVector(armDir, 0.5);
  lampArm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.clone().normalize());
  lampGroup.add(lampArm);

  const LAMP_SHADE_H = 0.22;
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, LAMP_SHADE_H, 28, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
  );
  lampShade.position.copy(armEnd);
  lampShade.position.y -= LAMP_SHADE_H / 2;
  lampGroup.add(lampShade);
  const lampBulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff8e2, fog: false })
  );
  lampBulb.position.set(armEnd.x, armEnd.y - LAMP_SHADE_H * 0.8, armEnd.z);
  lampGroup.add(lampBulb);
  // 전구의 월드 좌표 = 이 씬의 "태양 위치". 그림자 방향을 여기서 뽑는다.
  const BULB_WORLD = new THREE.Vector3().copy(lampGroup.position).add(lampBulb.position);
  FPWorld.bulbWorld = BULB_WORLD;

  // 전구에서 나오는 실제 빛 (그림자는 아래 sun이 담당 - 스포트라이트로 6x3 전체를 그림자
  // 처리하면 눈앞 그림자가 뭉개져서, 밝기는 스포트가 그림자는 평행광이 나눠 맡는다)
  const lampSpot = new THREE.SpotLight(0xfff2d4, 26, 12, Math.PI / 4.2, 0.5, 1.1);
  lampSpot.position.copy(BULB_WORLD);
  lampSpot.target.position.set(0, GROUND_BASE, 0);
  scene.add(lampSpot, lampSpot.target);

  // 그림자 전용 평행광 - 매 프레임 플레이어 주변으로 옮겨서(updateSunShadow) 좁은 범위에
  // 그림자맵을 몰아주되, 방향은 항상 전구 -> 플레이어 방향이라 전등과 그림자가 일치한다.
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  FPWorld.sun = sun;
  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x6b6350, 0.6));

  // ── 구름 ────────────────────────────────────────────────────────────────
  // 흰 구(球)를 여러 개 뭉쳐 만든 만화풍 뭉게구름. 바람을 타고 +x로 흐르다가 맵 끝을
  // 넘어가면 반대쪽 끝에서 모양·높이·크기를 새로 뽑아 다시 태어난다(무한 순환).
  const CLOUD_X_LIMIT = BOX_W / 2 + 2.2;
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, flatShading: true,
    emissive: 0xdfe8f2, emissiveIntensity: 0.35,
  });
  function makeCloudPuffs(group) {
    while (group.children.length) group.remove(group.children[0]);
    const lobes = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < lobes; i++) {
      const r = 0.10 + Math.random() * 0.13;
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), cloudMat);
      puff.position.set(
        (i - lobes / 2) * 0.15 + (Math.random() - 0.5) * 0.1,
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.18
      );
      puff.scale.y = 0.62 + Math.random() * 0.25;   // 납작하게 눌러야 구름처럼 보임
      group.add(puff);
    }
  }
  function resetCloud(c, fromLeftEdge) {
    makeCloudPuffs(c.group);
    c.group.position.set(
      fromLeftEdge ? -CLOUD_X_LIMIT : (Math.random() - 0.5) * 2 * CLOUD_X_LIMIT,
      1.35 + Math.random() * 0.75,
      (Math.random() - 0.5) * (BOX_D + 2.2)
    );
    const s = (0.8 + Math.random() * 1.1) * 0.8;   // 크기 20% 축소
    c.group.scale.setScalar(s);
    c.speed = (0.018 + Math.random() * 0.032) * 2; // 흐르는 속도 2배
  }
  FPWorld.clouds = [];
  FPWorld.CLOUD_X_LIMIT = CLOUD_X_LIMIT;
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    scene.add(g);
    const c = { group: g, speed: 0 };
    resetCloud(c, false);
    FPWorld.clouds.push(c);
  }
  FPWorld.resetCloud = resetCloud;

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
  // 세그먼트 수는 "가장 잘게 치는 잔물결의 파장"만 담아내면 충분하다.
  // 최고주파 항의 파장이 2π/17 ≈ 0.37유닛(≈18m)이라 96x72(한 칸 1~2m)면 넉넉히 표현되고,
  // 128x96까지 올리면 눈에 띄는 차이 없이 정점당 삼각함수 비용만 두 배가 된다(측정함).
  const waveGeo = new THREE.PlaneGeometry(waveW, waveD, 96, 72);
  // transmission(굴절 투과)은 반사를 씻어내고 무겁기까지 해서 뺐다. 대신 낮은 roughness +
  // 환경맵 반사 + 클리어코트로 "어느 각도에서 봐도 하늘이 비치는" 수면을 만든다.
  const waveMat = new THREE.MeshPhysicalMaterial({
    color: 0x14384f, transparent: true, opacity: 0.88, roughness: 0.06, metalness: 0.0,
    envMapIntensity: 1.6, reflectivity: 1, clearcoat: 1, clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.45, 0.45), depthWrite: false,
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
  // 높이 재조정: 처음엔 허리 높이(≈1.5m)로 뒀는데, 그러면 토끼(40cm)가 통째로 파묻혀서
  // 동물이 하나도 안 보였다. 무릎 아래(≈40~80cm)로 낮춰 동물이 풀 위로 드러나게 함.
  const grassGeo = new THREE.ConeGeometry(0.003, 0.015, 4);
  grassGeo.translate(0, 0.0075, 0);
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
      const gs = 0.5 + Math.random() * 0.65;
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

  // ── 동물 ────────────────────────────────────────────────────────────────
  // 저폴리 박스 모델 + 단순 배회 AI. 전부 녹지(습지·숲) 구역 안에서만 돌아다닌다.
  // 크기는 1유닛=50m 환산 기준: 토끼 40cm, 늑대 90cm, 사슴 1.5m, 곰 1.6m(어깨높이).
  const animalMats = {
    rabbitBody: new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.9, flatShading: true }),
    rabbitEar: new THREE.MeshStandardMaterial({ color: 0xc4b8a8, roughness: 0.9 }),
    deerBody: new THREE.MeshStandardMaterial({ color: 0xa9743f, roughness: 0.9, flatShading: true }),
    deerDark: new THREE.MeshStandardMaterial({ color: 0x6b4a28, roughness: 0.9 }),
    wolfBody: new THREE.MeshStandardMaterial({ color: 0x7b8189, roughness: 0.9, flatShading: true }),
    wolfDark: new THREE.MeshStandardMaterial({ color: 0x4d5259, roughness: 0.9 }),
    bearBody: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95, flatShading: true }),
    bearDark: new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 0.95 }),
  };
  function bx(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  // 다리: 기하를 아래로 밀어 원점을 '고관절'(다리 윗끝)에 둔다.
  // 박스 중심을 기준으로 돌리면 다리가 통째로 앞뒤로 미끄러지듯 움직여서 어색한데,
  // 윗끝을 축으로 돌리면 실제로 관절에서 흔들리는 모양이 나온다.
  function legBox(w, h, d, mat, x, hipY, z) {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, hipY, z);
    m.castShadow = true;
    return m;
  }
  // 눈: 흰자 구 + 그 앞에 살짝 튀어나온 눈동자 구. 머리 좌우 두 쪽에 붙인다.
  // 각진 박스 몸통에 동그란 눈만 얹으면 저폴리인데도 인상이 확 순해진다.
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 0.25 });
  function addEyes(g, x, y, z, spread, r) {
    [-spread, spread].forEach(dz => {
      const w = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), eyeWhiteMat);
      w.position.set(x, y, z + dz);
      g.add(w);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 10, 8), eyePupilMat);
      p.position.set(x + r * 0.6, y, z + dz);   // 얼굴 앞쪽(+x)을 바라보게
      g.add(p);
    });
  }
  // 모델은 전부 +x를 바라보게 만든다 (heading에 맞춰 group.rotation.y = -heading)
  function buildRabbit() {
    const g = new THREE.Group(), M = animalMats, legs = [];
    g.add(bx(0.010, 0.005, 0.005, M.rabbitBody, 0, 0.0055, 0));          // 몸통
    g.add(bx(0.005, 0.0045, 0.0045, M.rabbitBody, 0.0068, 0.0072, 0));   // 머리
    g.add(bx(0.0012, 0.004, 0.0022, M.rabbitEar, 0.0072, 0.0108, -0.0013));
    g.add(bx(0.0012, 0.004, 0.0022, M.rabbitEar, 0.0072, 0.0108, 0.0013));
    addEyes(g, 0.0090, 0.0080, 0, 0.0016, 0.0011);
    g.add(bx(0.0025, 0.0025, 0.0025, M.rabbitBody, -0.0062, 0.006, 0));  // 꼬리
    [[-0.003, -0.0022], [-0.003, 0.0022], [0.003, -0.0022], [0.003, 0.0022]].forEach(([lx, lz]) => {
      const l = legBox(0.0022, 0.0035, 0.0022, M.rabbitEar, lx, 0.00355, lz);
      g.add(l); legs.push(l);
    });
    // 실척 40cm 그대로면 풀 사이에서 거의 안 보여서, 큰 산토끼 정도로 살짝 키움
    g.scale.setScalar(1.35);
    return { group: g, legs, hop: true };
  }
  function buildDeer() {
    const g = new THREE.Group(), M = animalMats, legs = [];
    g.add(bx(0.026, 0.011, 0.010, M.deerBody, 0, 0.021, 0));             // 몸통
    g.add(bx(0.006, 0.012, 0.006, M.deerBody, 0.013, 0.026, 0));         // 목
    g.add(bx(0.009, 0.006, 0.006, M.deerBody, 0.017, 0.032, 0));         // 머리
    [-0.0025, 0.0025].forEach(dz => {                                    // 뿔
      g.add(bx(0.0016, 0.008, 0.0016, M.deerDark, 0.015, 0.038, dz));
      g.add(bx(0.006, 0.0016, 0.0016, M.deerDark, 0.018, 0.041, dz));
    });
    addEyes(g, 0.0205, 0.0335, 0, 0.0022, 0.0013);
    g.add(bx(0.004, 0.004, 0.003, M.deerBody, -0.014, 0.023, 0));        // 꼬리
    [[-0.009, -0.004], [-0.009, 0.004], [0.009, -0.004], [0.009, 0.004]].forEach(([lx, lz]) => {
      const l = legBox(0.003, 0.016, 0.003, M.deerDark, lx, 0.016, lz);
      g.add(l); legs.push(l);
    });
    return { group: g, legs, hop: false };
  }
  function buildWolf() {
    const g = new THREE.Group(), M = animalMats, legs = [];
    g.add(bx(0.019, 0.008, 0.008, M.wolfBody, 0, 0.012, 0));             // 몸통
    g.add(bx(0.008, 0.007, 0.007, M.wolfBody, 0.012, 0.0135, 0));        // 머리
    g.add(bx(0.004, 0.003, 0.004, M.wolfDark, 0.017, 0.012, 0));         // 주둥이
    [-0.002, 0.002].forEach(dz => g.add(bx(0.0015, 0.003, 0.0025, M.wolfDark, 0.010, 0.018, dz))); // 귀
    addEyes(g, 0.0152, 0.0150, 0, 0.0024, 0.0014);
    g.add(bx(0.008, 0.003, 0.003, M.wolfDark, -0.012, 0.014, 0));        // 꼬리
    [[-0.006, -0.0032], [-0.006, 0.0032], [0.006, -0.0032], [0.006, 0.0032]].forEach(([lx, lz]) => {
      const l = legBox(0.0028, 0.008, 0.0028, M.wolfDark, lx, 0.008, lz);
      g.add(l); legs.push(l);
    });
    return { group: g, legs, hop: false };
  }
  function buildBear() {
    const g = new THREE.Group(), M = animalMats, legs = [];
    g.add(bx(0.034, 0.016, 0.016, M.bearBody, 0, 0.022, 0));             // 몸통
    g.add(bx(0.013, 0.012, 0.012, M.bearBody, 0.022, 0.026, 0));         // 머리
    g.add(bx(0.005, 0.005, 0.006, M.bearDark, 0.030, 0.024, 0));         // 주둥이
    [-0.004, 0.004].forEach(dz => g.add(bx(0.003, 0.004, 0.003, M.bearDark, 0.020, 0.033, dz))); // 귀
    addEyes(g, 0.0270, 0.0282, 0, 0.0040, 0.0022);
    [[-0.011, -0.006], [-0.011, 0.006], [0.011, -0.006], [0.011, 0.006]].forEach(([lx, lz]) => {
      const l = legBox(0.006, 0.014, 0.006, M.bearDark, lx, 0.014, lz);
      g.add(l); legs.push(l);
    });
    return { group: g, legs, hop: false };
  }

  const ANIMAL_KINDS = [
    { name: '토끼', count: 20, build: buildRabbit, walk: 0.030, run: 0.16, turn: 3.0, restChance: 0.35 },
    { name: '사슴', count: 10, build: buildDeer,   walk: 0.034, run: 0.15, turn: 1.6, restChance: 0.30 },
    { name: '늑대', count: 10, build: buildWolf,   walk: 0.040, run: 0.18, turn: 2.0, restChance: 0.20 },
    { name: '곰',   count: 1,  build: buildBear,   walk: 0.028, run: 0.10, turn: 1.2, restChance: 0.30 },
  ];
  // 동물이 돌아다닐 수 있는 범위 - 녹지 스캐터 범위보다 살짝 안쪽으로 잡아 경계 밖으로 안 나감
  const ANIM_HALF_W = GREEN_HALF_W * 0.96, ANIM_HALF_D = GREEN_HALF_D * 0.96;
  FPWorld.ANIM_HALF_W = ANIM_HALF_W;
  FPWorld.ANIM_HALF_D = ANIM_HALF_D;
  // 나무·바위를 피해 다니게 하려고 녹지 안 장애물만 따로 추려둔다
  FPWorld.greenObstacles = FPWorld.cylinders.filter(c => Math.abs(c.x) < ZONE_W / 2);
  FPWorld.animals = [];
  ANIMAL_KINDS.forEach(kind => {
    for (let i = 0; i < kind.count; i++) {
      const { group, legs, hop } = kind.build();
      const x = (Math.random() - 0.5) * 2 * ANIM_HALF_W;
      const z = (Math.random() - 0.5) * 2 * ANIM_HALF_D;
      group.position.set(x, wetlandY(x, z), z);
      world.add(group);
      FPWorld.animals.push({
        kind, group, legs, hop,
        x, z, heading: Math.random() * Math.PI * 2,
        state: 'walk', timer: Math.random() * 2.5, phase: Math.random() * 10,
      });
    }
  });

  // ── 바다 생태계 (어류 / 산호 / 수초) ─────────────────────────────────────
  // 지상 동물과 같은 테마: 저폴리 박스 + 동그란 눈. 전부 oceanGroup에 넣어서
  // 로컬 x가 곧 해양 구역 좌표가 되게 한다(월드 x = 로컬 x - ZONE_W).
  // 해저 높이는 해저 지형 캡과 같은 노이즈를 쓴다.
  function seabedY(lx, lz) {
    return OCEAN_BASE + terrainNoise(lx, lz, OCEAN_TERRAIN_AMP, OCEAN_TERRAIN_SEED);
  }
  const SEA_HALF_X = 0.86, SEA_HALF_Z = 1.34;      // 생물이 돌아다니는 범위(로컬)
  const SEA_CEIL = waveBaseY - 0.058;              // 파도 골보다 아래 = 수면 밖으로 안 튀어나감
  FPWorld.seabedY = seabedY;

  const fishMats = {
    small: new THREE.MeshStandardMaterial({ color: 0x8fc9e6, roughness: 0.55, flatShading: true }),
    smallFin: new THREE.MeshStandardMaterial({ color: 0x5f9fc4, roughness: 0.6 }),
    mid: new THREE.MeshStandardMaterial({ color: 0xe8944f, roughness: 0.55, flatShading: true }),
    midFin: new THREE.MeshStandardMaterial({ color: 0xc26a2c, roughness: 0.6 }),
    big: new THREE.MeshStandardMaterial({ color: 0x53728f, roughness: 0.55, flatShading: true }),
    bigFin: new THREE.MeshStandardMaterial({ color: 0x35506a, roughness: 0.6 }),
  };
  // 물고기는 +x를 바라보게 만든다 (지상 동물과 동일 규칙).
  // 개체 수를 3배로 늘리면서 마리당 메시 수가 곧바로 드로우콜로 이어지므로,
  // 눈에 잘 안 띄는 부위(소형 어류의 등지느러미·눈)는 생략해 비용을 줄였다.
  function buildFish(size, bodyMat, finMat, detail) {
    const g = new THREE.Group();
    g.add(bx(size * 1.0, size * 0.5, size * 0.28, bodyMat, 0, 0, 0));            // 몸통
    g.add(bx(size * 0.34, size * 0.34, size * 0.22, bodyMat, size * 0.56, 0, 0)); // 머리
    const tail = bx(size * 0.28, size * 0.46, size * 0.05, finMat, -size * 0.62, 0, 0);
    g.add(tail);
    if (detail) {
      g.add(bx(size * 0.3, size * 0.16, size * 0.04, finMat, 0, size * 0.31, 0)); // 등지느러미
      addEyes(g, size * 0.68, size * 0.07, 0, size * 0.1, size * 0.062);
    }
    // 물속이라 그림자는 거의 안 보이는데 비용은 그대로 들어서 끈다
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return { group: g, tail };
  }

  // 바다 생물 밀도 배수 (성능이 부족하면 이 값만 낮추면 전체가 같이 줄어든다)
  const SEA_DENSITY = 3;
  const FISH_KINDS = [
    { n: 20 * SEA_DENSITY, size: 0.005, body: fishMats.small, fin: fishMats.smallFin, detail: false, speed: 0.045 },
    { n: 12 * SEA_DENSITY, size: 0.010, body: fishMats.mid,   fin: fishMats.midFin,   detail: true,  speed: 0.034 },
    { n: 5 * SEA_DENSITY,  size: 0.017, body: fishMats.big,   fin: fishMats.bigFin,   detail: true,  speed: 0.026 },
  ];
  FPWorld.fish = [];
  FISH_KINDS.forEach(k => {
    for (let i = 0; i < k.n; i++) {
      const { group, tail } = buildFish(k.size, k.body, k.fin, k.detail);
      const lx = (Math.random() - 0.5) * 2 * SEA_HALF_X;
      const lz = (Math.random() - 0.5) * 2 * SEA_HALF_Z;
      const floor = seabedY(lx, lz);
      const ly = floor + 0.012 + Math.random() * Math.max(0.004, SEA_CEIL - floor - 0.02);
      group.position.set(lx, ly, lz);
      oceanGroup.add(group);
      FPWorld.fish.push({
        group, tail, lx, ly, lz,
        heading: Math.random() * Math.PI * 2, pitch: 0,
        speed: k.speed, baseSpeed: k.speed,
        timer: Math.random() * 3, phase: Math.random() * 10,
      });
    }
  });

  // 산호 2종: 가지산호(여러 갈래로 뻗음) / 뇌산호(납작한 돔).
  // pH가 내려가면 두 재질 색을 흰색으로 보간해 백화현상을 표현한다.
  const CORAL_BRANCH_HEALTHY = new THREE.Color(0xe8724f);
  const CORAL_BRAIN_HEALTHY = new THREE.Color(0xa06fc4);
  const CORAL_BLEACHED = new THREE.Color(0xf4f2ec);
  const coralBranchMat = new THREE.MeshStandardMaterial({ color: CORAL_BRANCH_HEALTHY.clone(), roughness: 0.85, flatShading: true });
  const coralBrainMat = new THREE.MeshStandardMaterial({ color: CORAL_BRAIN_HEALTHY.clone(), roughness: 0.8, flatShading: true });

  function buildBranchCoral() {
    const g = new THREE.Group();
    const h = 0.016 + Math.random() * 0.014;
    g.add(bx(0.008, h * 0.45, 0.008, coralBranchMat, 0, h * 0.22, 0));   // 밑동
    const arms = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < arms; i++) {
      const ang = (i / arms) * Math.PI * 2 + Math.random() * 0.6;
      const len = h * (0.5 + Math.random() * 0.5);
      const arm = bx(0.0045, len, 0.0045, coralBranchMat,
        Math.cos(ang) * 0.006, h * 0.45 + len * 0.4, Math.sin(ang) * 0.006);
      arm.rotation.z = -Math.cos(ang) * 0.5;
      arm.rotation.x = Math.sin(ang) * 0.5;
      g.add(arm);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return g;
  }
  function buildBrainCoral() {
    const g = new THREE.Group();
    const r = 0.010 + Math.random() * 0.008;
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), coralBrainMat);
    dome.scale.y = 0.55;
    dome.position.y = r * 0.35;
    g.add(dome);
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return g;
  }

  // 수초 2종: 다시마(길게 흔들리는 띠) / 잘피(짧은 잎 다발)
  const kelpMat = new THREE.MeshStandardMaterial({ color: 0x487038, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const grassSeaMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: 0.9, side: THREE.DoubleSide });
  function buildKelp() {
    const g = new THREE.Group();
    const segs = 4 + Math.floor(Math.random() * 3);
    const segH = 0.013 + Math.random() * 0.006;
    const blades = [];
    let parent = g;
    for (let i = 0; i < segs; i++) {
      // 마디를 사슬처럼 이어 붙여서 위로 갈수록 크게 휘도록(해류에 흔들리는 느낌)
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : segH;
      const blade = bx(0.010, segH, 0.0012, kelpMat, 0, segH / 2, 0);
      seg.add(blade);
      parent.add(seg);
      parent = seg;
      blades.push(seg);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return { group: g, segs: blades };
  }
  function buildSeagrass() {
    const g = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const h = 0.009 + Math.random() * 0.008;
      const blade = bx(0.0035, h, 0.0009, grassSeaMat,
        (Math.random() - 0.5) * 0.012, h / 2, (Math.random() - 0.5) * 0.012);
      blade.rotation.z = (Math.random() - 0.5) * 0.5;
      g.add(blade);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return g;
  }

  function scatterOnSeabed(makeFn, count, store) {
    for (let i = 0; i < count; i++) {
      const lx = (Math.random() - 0.5) * 2 * SEA_HALF_X;
      const lz = (Math.random() - 0.5) * 2 * SEA_HALF_Z;
      const made = makeFn();
      const g = made.group || made;
      g.position.set(lx, seabedY(lx, lz) - 0.001, lz);
      g.rotation.y = Math.random() * Math.PI * 2;
      oceanGroup.add(g);
      store.push(made.segs ? { group: g, segs: made.segs, phase: Math.random() * 10 } : { group: g });
    }
  }
  FPWorld.corals = [];
  FPWorld.plants = [];
  scatterOnSeabed(buildBranchCoral, 10 * SEA_DENSITY, FPWorld.corals);
  scatterOnSeabed(buildBrainCoral, 8 * SEA_DENSITY, FPWorld.corals);
  scatterOnSeabed(buildKelp, 14 * SEA_DENSITY, FPWorld.plants);
  scatterOnSeabed(buildSeagrass, 12 * SEA_DENSITY, FPWorld.plants);
  FPWorld.coralMats = { branch: coralBranchMat, brain: coralBrainMat };
  FPWorld.CORAL_COLORS = { branch: CORAL_BRANCH_HEALTHY, brain: CORAL_BRAIN_HEALTHY, bleached: CORAL_BLEACHED };
  FPWorld.SEA_HALF_X = SEA_HALF_X;
  FPWorld.SEA_HALF_Z = SEA_HALF_Z;
  FPWorld.SEA_CEIL = SEA_CEIL;

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
  function buildCarModel() {
    const group = new THREE.Group();
    const bodyMat = gasCarMat;   // 실제 재질은 applyWorldCO2()에서 EV/내연으로 교체됨
    const bodyParts = [];        // 색을 갈아끼울 대상 (바퀴·유리·배기구는 제외)
    const wheelR = 0.011, bodyH = 0.028, cabinH = 0.024, cabinWidth = 0.038;
    const bodyBottomY = wheelR * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, bodyH, 0.045), bodyMat);
    body.position.y = bodyBottomY + bodyH / 2;
    body.castShadow = true;
    group.add(body);
    bodyParts.push(body);
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
    bodyParts.push(cabin);
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
      bodyParts.push(fender);
    });
    // 배기구: 차체 뒤쪽(-x) 아래. 내연기관차에만 달리고 전기차에서는 통째로 숨긴다.
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 8),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.7 })
    );
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.048, bodyBottomY + 0.004, -0.012);
    group.add(tail);

    // 전기차 표식: 후드 위 + 양 옆면에 붙는 번개 마크. 전기차일 때만 보인다.
    function boltGeometry(size) {
      const sh = new THREE.Shape();
      sh.moveTo(0.55, 1.00);
      sh.lineTo(0.13, 0.46);
      sh.lineTo(0.44, 0.46);
      sh.lineTo(0.32, 0.00);
      sh.lineTo(0.86, 0.58);
      sh.lineTo(0.55, 0.58);
      sh.lineTo(0.55, 1.00);
      const g = new THREE.ShapeGeometry(sh);
      g.translate(-0.5, -0.5, 0);              // 도형 중심을 원점으로
      g.scale(size, size, 1);
      return g;
    }
    const boltMat = new THREE.MeshStandardMaterial({
      color: 0xeafff8, emissive: 0x7ffcd8, emissiveIntensity: 0.9,
      roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide,
    });
    const bolts = [];

    // (1) 후드 위 - 눕혀서 붙임
    const hoodGeo = boltGeometry(0.024);
    hoodGeo.rotateX(-Math.PI / 2);             // 바닥에 눕힘
    hoodGeo.rotateY(-Math.PI / 2);             // 번개 끝이 차 앞쪽을 향하게
    const hoodBolt = new THREE.Mesh(hoodGeo, boltMat);
    hoodBolt.position.set(0.030, bodyBottomY + bodyH + 0.0006, 0);
    group.add(hoodBolt);
    bolts.push(hoodBolt);

    // (2)(3) 양 옆면 - 차체 측면(z = ±0.0225)에 세워서 붙임.
    // ShapeGeometry는 기본 법선이 +z라 +z쪽은 그대로, -z쪽은 180도 돌려 바깥을 보게 한다.
    const SIDE_Z = 0.0225 + 0.0004;
    [1, -1].forEach(sign => {
      const g = boltGeometry(0.018);
      if (sign < 0) g.rotateY(Math.PI);
      const m = new THREE.Mesh(g, boltMat);
      m.position.set(0.004, bodyBottomY + bodyH / 2, SIDE_Z * sign);
      group.add(m);
      bolts.push(m);
    });

    return {
      group, bodyParts, tail, bolts,
      tailLocal: new THREE.Vector3(-0.054, bodyBottomY + 0.004, -0.012),
    };
  }
  const carSpots = [[-0.65, -0.15], [-0.3, 0.02], [0.05, -0.1], [0.4, 0.05], [0.65, -0.05],
                    [-0.5, 0.35], [-0.1, 0.32], [0.25, 0.3], [0.55, 0.35],
                    [-0.6, -0.55], [-0.05, -0.55], [0.5, -0.55]];
  FPWorld.cars = [];
  carSpots.forEach((pos, i) => {
    const { group: car, bodyParts, tail, bolts, tailLocal } = buildCarModel();
    car.position.set(pos[0], GROUND_BASE, pos[1]);
    car.rotation.y = (i % 3) * 0.04;
    cityGroup.add(car);
    FPWorld.cars.push({
      group: car, bodyParts, tail, bolts, isGas: true,
      // 배기구 월드 좌표 (cityGroup이 +ZONE_W 밀려 있으므로 더해줌)
      tail: new THREE.Vector3(pos[0] + tailLocal.x + ZONE_W, GROUND_BASE + tailLocal.y, pos[1] + tailLocal.z),
    });
    FPWorld.boxes.push({
      minX: pos[0] + ZONE_W - 0.048, maxX: pos[0] + ZONE_W + 0.048,
      minZ: pos[1] - 0.026, maxZ: pos[1] + 0.026,
      top: GROUND_BASE + 0.062,
    });
  });
  FPWorld.evCarMat = evCarMat;
  FPWorld.gasCarMat = gasCarMat;

  // 배기가스 파티클: 내연기관차 대수에 맞춰 파티클을 나눠 배정한다.
  // (전부 전기차가 되면 opacity 0으로 통째로 사라짐)
  const EXHAUST_PER_CAR = 14;
  const exCount = carSpots.length * EXHAUST_PER_CAR;
  const exGeo = new THREE.BufferGeometry();
  exGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(exCount * 3), 3));
  const exLife = new Float32Array(exCount);
  for (let i = 0; i < exCount; i++) exLife[i] = Math.random();
  const exhaust = new THREE.Points(exGeo, new THREE.PointsMaterial({
    color: 0x6b6660, size: 0.012, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  world.add(exhaust);
  FPWorld.exhaust = { points: exhaust, geo: exGeo, count: exCount, life: exLife, perCar: EXHAUST_PER_CAR };

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
  const smokeMat = new THREE.PointsMaterial({ color: 0x9a9a96, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  cityGroup.add(smoke);
  // rate/opacity/size는 applyWorldCO2()가 CO2 농도에 맞춰 계속 바꿔준다
  FPWorld.smoke = { geo: smokeGeo, mat: smokeMat, life: smokeLife, count: smokeCount, x: 0.6, z: 0.55, rate: 0.3 };

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

// ── CO2 -> 세계 상태 ────────────────────────────────────────────────────────
// 슬라이더 하나가 하늘색·시야거리·자동차 구성·배기가스·굴뚝 연기를 한꺼번에 움직인다.
// "CO2를 줄이면 전부 전기차가 되고 매연이 멎는다"를 눈으로 보게 하는 게 목적.
const CO2_MIN = 280, CO2_MAX = 1000;

// ── 해양 pH ─────────────────────────────────────────────────────────────────
// 본편의 실측 회귀식(-0.000942·ppm + 8.441)은 1000ppm에서도 7.5까지밖에 안 내려가서
// 1인칭에서 산호 백화·생물 감소를 눈으로 보기엔 변화폭이 너무 작다. 그래서 여기서는
// "현재(418ppm)에서는 실측값 8.05에 맞추되, 고농도에서 훨씬 가파르게 떨어지는" 곡선으로
// 과장했다. 지수 1.6은 418ppm에서 실측과 일치하도록 역산한 값.
//   280ppm -> 8.20 / 418ppm -> 8.05 / 640ppm -> 7.52 / 1000ppm -> 6.15
// 실측 재현이 아니라 교육용 연출이라는 점에 유의.
const PH_CLEAN = 8.20, PH_DROP = 2.05, PH_CURVE = 1.6;
function oceanPH(ppm) {
  const k = Math.min(1, Math.max(0, (ppm - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  return PH_CLEAN - PH_DROP * Math.pow(k, PH_CURVE);
}
// pH를 0(최악)~1(건강) 생태 건강도로 환산 - 산호 백화율·개체수 감소에 함께 쓰인다
function oceanHealth(ph) {
  return Math.min(1, Math.max(0, (ph - (PH_CLEAN - PH_DROP)) / PH_DROP));
}
function applyWorldCO2(ppm) {
  FPWorld.co2 = ppm;
  const k = Math.min(1, Math.max(0, (ppm - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  FPWorld.co2k = k;

  const c = new THREE.Color().lerpColors(CLEAR_SKY, HAZY_SKY, k);
  FPWorld.skyMat.color.copy(c);
  FPWorld.scene.fog.color.copy(c);
  // 맑을 때 7유닛(≈350m)까지 보이다가, 1000ppm에선 1.1유닛(≈55m) 앞도 안 보이게
  FPWorld.scene.fog.far = 7.0 - k * 5.9;
  FPWorld.scene.fog.near = 0.25 - k * 0.22;
  // 탁해진 대기에서는 수면 반사도 함께 죽는다
  if (FPWorld.waterMesh) FPWorld.waterMesh.material.envMapIntensity = 1.6 - k * 0.9;

  // 자동차: CO2가 낮을수록 전기차 비율이 높아짐 (280ppm=전부 EV, 1000ppm=전부 내연)
  if (FPWorld.cars) {
    const gasCount = Math.round(FPWorld.cars.length * k);
    FPWorld.cars.forEach((car, i) => {
      const isGas = i < gasCount;
      car.isGas = isGas;
      const mat = isGas ? FPWorld.gasCarMat : FPWorld.evCarMat;
      car.bodyParts.forEach(p => { p.material = mat; });
      car.tail.visible = isGas;                             // 전기차엔 배기구 자체가 없음
      car.bolts.forEach(b => { b.visible = !isGas; });       // 후드 + 양 옆면 번개 마크
    });
    FPWorld.gasCarCount = gasCount;
  }
  // 배기가스·굴뚝 연기의 양(불투명도/크기)도 같이 움직인다
  if (FPWorld.exhaust) {
    FPWorld.exhaust.points.material.opacity = 0.55 * k;
    FPWorld.exhaust.points.material.size = 0.010 + k * 0.010;
  }
  // 해양 산성화 -> 산호 백화 + 수초·어류 개체수 감소
  applyOceanHealth(oceanPH(ppm));
  if (FPWorld.smoke) {
    // CO2가 낮으면 굴뚝 연기가 거의 안 보이고, 높으면 시커멓게 뿜어져 나옴
    FPWorld.smoke.mat.opacity = 0.05 + k * 0.55;
    FPWorld.smoke.mat.size = 0.03 + k * 0.075;
    FPWorld.smoke.mat.color.setHSL(0.09, 0.05, 0.62 - k * 0.35);
    FPWorld.smoke.rate = 0.10 + k * 0.55;
  }
}

// 그림자 카메라를 플레이어 주변 좁은 범위로 계속 옮겨서 눈앞 그림자 해상도를 확보.
// 방향은 항상 "전구 -> 플레이어"라서 눈에 보이는 거대 전등과 그림자 방향이 일치한다.
const _sunDir = new THREE.Vector3();
function updateSunShadow(px, pz) {
  const sun = FPWorld.sun;
  _sunDir.set(px, FPWorld.GROUND_BASE, pz).sub(FPWorld.bulbWorld).normalize();
  sun.position.set(px, FPWorld.GROUND_BASE, pz).addScaledVector(_sunDir, -1.3);
  sun.target.position.set(px, FPWorld.GROUND_BASE, pz);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  const R = 0.55;
  cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
  cam.near = 0.05; cam.far = 3.2;
  cam.updateProjectionMatrix();
}

// ── 해양 생태 반응 ──────────────────────────────────────────────────────────
// pH가 내려갈수록: 산호는 색을 잃어 하얗게(백화), 수초와 어류는 개체수가 줄어든다.
// 살아남는 개체를 앞에서부터 세는 방식이라 CO2를 되돌리면 그대로 복원된다.
function applyOceanHealth(ph) {
  if (!FPWorld.fish) return;
  const h = oceanHealth(ph);
  FPWorld.oceanHealth = h;

  // 산호 백화: 건강할 때 고유색 -> 최악일 때 표백된 흰색
  const C = FPWorld.CORAL_COLORS;
  FPWorld.coralMats.branch.color.lerpColors(C.bleached, C.branch, h);
  FPWorld.coralMats.brain.color.lerpColors(C.bleached, C.brain, h);

  // 수초: 최악이어도 10%는 남겨서 바다가 완전히 텅 비어 보이지 않게
  const plantCount = Math.round(FPWorld.plants.length * (0.10 + 0.90 * h));
  FPWorld.plants.forEach((p, i) => { p.group.visible = i < plantCount; });

  // 어류: 최악이면 15%만 남음
  const fishCount = Math.round(FPWorld.fish.length * (0.15 + 0.85 * h));
  FPWorld.fish.forEach((f, i) => { f.group.visible = i < fishCount; });
  FPWorld.aliveFish = fishCount;
  FPWorld.alivePlants = plantCount;
}

// ── 어류 유영 + 수초 흔들림 ─────────────────────────────────────────────────
function updateOceanLife(dt, t) {
  const HX = FPWorld.SEA_HALF_X, HZ = FPWorld.SEA_HALF_Z, CEIL = FPWorld.SEA_CEIL;
  for (const f of FPWorld.fish) {
    if (!f.group.visible) continue;
    f.timer -= dt;
    if (f.timer <= 0) {
      f.heading += (Math.random() - 0.5) * 2.2;
      f.pitch = (Math.random() - 0.5) * 0.5;
      f.speed = f.baseSpeed * (0.5 + Math.random() * 1.1);
      f.timer = 1.0 + Math.random() * 2.4;
    }
    // 벽·바닥·수면에 가까워지면 중앙으로 부드럽게 선회
    if (Math.abs(f.lx) > HX - 0.1 || Math.abs(f.lz) > HZ - 0.1) {
      const toCenter = Math.atan2(-f.lz, -f.lx);
      let d = toCenter - f.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      f.heading += d * Math.min(1, dt * 3);
    }
    const floor = FPWorld.seabedY(f.lx, f.lz) + 0.010;
    if (f.ly < floor + 0.006) f.pitch += dt * 1.6;        // 바닥에 닿기 전에 위로
    if (f.ly > CEIL - 0.006) f.pitch -= dt * 1.6;         // 수면 밖으로 안 나가게
    f.pitch = Math.max(-0.6, Math.min(0.6, f.pitch));

    f.lx += Math.cos(f.heading) * f.speed * dt;
    f.lz += Math.sin(f.heading) * f.speed * dt;
    f.ly += Math.sin(f.pitch) * f.speed * dt;
    f.lx = Math.max(-HX, Math.min(HX, f.lx));
    f.lz = Math.max(-HZ, Math.min(HZ, f.lz));
    f.ly = Math.max(floor, Math.min(CEIL, f.ly));

    f.phase += dt * (6 + f.speed * 90);
    f.group.position.set(f.lx, f.ly, f.lz);
    f.group.rotation.set(0, -f.heading, f.pitch * 0.8);
    f.tail.rotation.y = Math.sin(f.phase) * 0.65;          // 꼬리 흔들기
  }
  // 다시마: 마디마다 위상을 조금씩 늦춰 해류에 물결치듯 휘게
  for (const p of FPWorld.plants) {
    if (!p.segs || !p.group.visible) continue;
    for (let i = 0; i < p.segs.length; i++) {
      p.segs[i].rotation.z = Math.sin(t * 0.9 + p.phase + i * 0.55) * 0.16;
    }
  }
}

// ── 구름: 바람 타고 흐르다 맵 끝을 넘으면 반대편에서 새로 태어남 ──────────────
function updateClouds(dt) {
  const L = FPWorld.CLOUD_X_LIMIT;
  for (const c of FPWorld.clouds) {
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > L) FPWorld.resetCloud(c, true);
  }
}

// ── 동물 배회 ───────────────────────────────────────────────────────────────
// 일정 시간마다 "쉬기 / 걷기 / 달리기"와 방향을 새로 뽑고, 녹지 경계에 다가가면
// 중앙 쪽으로 방향을 틀어 밖으로 나가지 않는다. 나무·바위에 부딪히면 방향을 바꾼다.
function updateAnimals(dt, t) {
  const HW = FPWorld.ANIM_HALF_W, HD = FPWorld.ANIM_HALF_D;
  for (const a of FPWorld.animals) {
    a.timer -= dt;
    if (a.timer <= 0) {
      const r = Math.random();
      a.state = r < a.kind.restChance ? 'idle' : (r < a.kind.restChance + 0.62 ? 'walk' : 'run');
      a.heading += (Math.random() - 0.5) * a.kind.turn;
      a.timer = a.state === 'run' ? 0.8 + Math.random() * 1.4 : 1.2 + Math.random() * 3.0;
    }
    const speed = a.state === 'idle' ? 0 : (a.state === 'run' ? a.kind.run : a.kind.walk);

    if (speed > 0) {
      // 경계가 가까우면 중앙 쪽으로 서서히 방향을 튼다 (벽에 붙어 떠는 것 방지)
      const edge = 0.12;
      if (a.x > HW - edge || a.x < -HW + edge || a.z > HD - edge || a.z < -HD + edge) {
        const toCenter = Math.atan2(-a.z, -a.x);
        let diff = toCenter - a.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        a.heading += diff * Math.min(1, dt * 3.5);
      }
      const nx = a.x + Math.cos(a.heading) * speed * dt;
      const nz = a.z + Math.sin(a.heading) * speed * dt;
      let blocked = false;
      for (const o of FPWorld.greenObstacles) {
        if (Math.hypot(nx - o.x, nz - o.z) < o.r + 0.006) { blocked = true; break; }
      }
      if (blocked) {
        a.heading += 1.4 + Math.random();     // 장애물에 막히면 크게 꺾음
        a.timer = Math.min(a.timer, 0.4);
      } else {
        a.x = Math.max(-HW, Math.min(HW, nx));
        a.z = Math.max(-HD, Math.min(HD, nz));
      }
      a.phase += dt * (a.state === 'run' ? 14 : 7);
    }

    const baseY = FPWorld.wetlandY(a.x, a.z);
    a.group.position.set(a.x, baseY, a.z);
    a.group.rotation.y = -a.heading;

    if (speed > 0) {
      if (a.hop) {
        // 토끼는 다리 대신 몸 전체가 콩콩 튀어오름
        a.group.position.y = baseY + Math.abs(Math.sin(a.phase)) * (a.state === 'run' ? 0.006 : 0.003);
        a.group.rotation.z = Math.sin(a.phase) * 0.12;
      } else {
        // 나머지는 앞다리/뒷다리를 엇갈려 흔든다
        for (let i = 0; i < a.legs.length; i++) {
          // 모델이 +x를 바라보므로, 다리를 '앞뒤'로 흔들려면 z축 회전이어야 한다.
          // x축으로 돌리면 다리가 좌우로 벌어졌다 오므라들어서 걷는 것처럼 안 보인다.
          a.legs[i].rotation.z = Math.sin(a.phase + (i % 2) * Math.PI) * (a.state === 'run' ? 0.7 : 0.4);
        }
        a.group.position.y = baseY + Math.abs(Math.sin(a.phase * 2)) * 0.0012;
      }
    } else {
      for (const l of a.legs) l.rotation.z *= 0.85;
      a.group.rotation.z = 0;
      // 가만히 있을 때는 숨쉬듯 아주 살짝 위아래로
      a.group.position.y = baseY + Math.sin(t * 1.6 + a.phase) * 0.0004;
    }
  }
}

// ── 자동차 배기가스: 내연기관차 배기구에서만 뿜어져 나옴 ──────────────────────
function updateExhaust(dt) {
  const ex = FPWorld.exhaust;
  const gasCars = FPWorld.cars.filter(c => c.isGas);
  const pos = ex.geo.attributes.position;
  if (gasCars.length === 0) {
    ex.points.visible = false;
    return;
  }
  ex.points.visible = true;
  for (let i = 0; i < ex.count; i++) {
    const car = gasCars[i % gasCars.length];
    ex.life[i] += dt * (0.9 + (i % 5) * 0.12);
    if (ex.life[i] > 1) ex.life[i] -= 1;
    const L = ex.life[i];
    // 배기구에서 뒤쪽(-x)으로 밀려나며 위로 퍼져 오름
    pos.setXYZ(i,
      car.tail.x - L * 0.05 + Math.sin(i * 3.7 + L * 6) * 0.006 * L,
      car.tail.y + L * L * 0.05,
      car.tail.z + Math.cos(i * 2.3 + L * 5) * 0.008 * L);
  }
  pos.needsUpdate = true;
}
