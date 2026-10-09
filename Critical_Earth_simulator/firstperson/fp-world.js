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
  waterWall: null,    // 물 옆면(윗변이 파도를 따라감)
  // CO2가 정하는 기준 시야거리. 계절·날씨 계수가 여기에 곱해진다(applyEnvironment).
  fogBase: { far: 7.0, near: 0.25 },
  // 실측 도구가 측정 지점을 구분하는 데 쓰는 목록
  trees: [],          // {x, z, r} - 나무 근처는 광합성으로 CO2가 낮게 나온다
  iceMeshes: [],      // 빙하(유빙) 메시
  beachRamp: null,    // 해변 모래 경사로
  leafMeshes: [],     // 나뭇잎 덩어리 (겨울에 숨겨 낙엽 표현)
  grass: null,        // {mesh, baseHSL, count} - 계절마다 다시 칠하려면 원본 색조가 필요
  animalGroups: [],   // 온도계로 체온을 잴 수 있는 동물 (그룹 단위)
  fishGroups: [],     // 어류 - 변온동물이라 체온이 수온을 따라간다
  seasonSkin: null,   // 계절이 색을 바꾸는 재질들과 그 원래 색
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
  const ambient = new THREE.AmbientLight(0xffffff, 0.62);
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x6b6350, 0.6);
  scene.add(ambient, hemi);
  // 낮/밤 주기가 세기를 조절할 수 있게 기본값과 함께 들고 있는다
  FPWorld.lights = {
    sun, lampSpot, ambient, hemi, bulbMat: lampBulb.material,
    base: { sun: 1.7, spot: 26, ambient: 0.62, hemi: 0.6 },
  };

  // ── 별 ──────────────────────────────────────────────────────────────────
  // 밤에만 보인다. 하늘 돔 안쪽에 점을 뿌려 두고 낮에는 opacity 0으로 감춘다.
  {
    const N = 700, sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // 반구 위쪽에만 뿌린다(지평선 아래 별은 어차피 지형에 가린다)
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = 34, s = Math.sqrt(1 - u * u);
      sp[i * 3] = r * s * Math.cos(th);
      sp[i * 3 + 1] = r * Math.abs(u) * 0.9 + 1;
      sp[i * 3 + 2] = r * s * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.16, transparent: true, opacity: 0, fog: false, depthWrite: false,
    }));
    stars.frustumCulled = false;
    scene.add(stars);
    FPWorld.stars = stars;
  }

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
  const greenBlock = zoneFloor(0, GROUND_BASE, T.forestGrass, 0x2c331c);
  const cityBlock = zoneFloor(ZONE_W, GROUND_BASE, T.cityPavement, 0x3a3832, 0x9a9a9a);

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
  const greenCap = createTerrainCap(0, GROUND_BASE, T.forestGrass, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED);
  // ── 계절 지면 오버레이 ──────────────────────────────────────────────────
  // 지면은 텍스처 맵을 쓴다. 재질 색은 텍스처에 '곱해지는' 값이라 어둡게만 만들 수 있고,
  // 초록 텍스처를 흰색이나 갈색으로 바꿀 수는 없다(흰색은 곱셈의 항등원이라
  // 겨울이 그대로 초록으로 나왔다). 그래서 지형과 같은 모양의 반투명 판을 위에 겹친다.
  // 이 한 장으로 가을 마른 땅과 겨울 눈을 모두 처리한다.
  const overlayMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8fc, roughness: 0.8, transparent: true, opacity: 0, depthWrite: false,
  });
  const groundOverlay = new THREE.Mesh(greenCap.geometry, overlayMat);   // 지오메트리 공유
  groundOverlay.position.copy(greenCap.position);
  // 진흙 웅덩이(지면+0.006)보다 위로 올려야 한다. 안 그러면 눈밭 한가운데 진흙만
  // 초록으로 드러난다.
  groundOverlay.position.y += 0.008;
  groundOverlay.receiveShadow = true;
  world.add(groundOverlay);

  // 도시 포장면은 계절색을 안 탄다. 눈만 따로 얹는다.
  // 도로(GROUND_BASE+0.002)보다 낮게 깔아야 눈이 도로를 덮지 않아
  // '제설한 도로 + 눈 쌓인 주변'처럼 보인다.
  const citySnowMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8fc, roughness: 0.8, transparent: true, opacity: 0, depthWrite: false,
  });
  const citySnowGeo = new THREE.PlaneGeometry(ZONE_W, BOX_D);
  citySnowGeo.rotateX(-Math.PI / 2);
  const citySnow = new THREE.Mesh(citySnowGeo, citySnowMat);
  citySnow.position.set(ZONE_W, GROUND_BASE + 0.0015, 0);
  citySnow.receiveShadow = true;
  world.add(citySnow);

  // 계절이 색을 바꿀 재질들. '원래 색'을 함께 들고 있어야 계절을 되돌릴 수 있다.
  // (재질 색을 직접 곱해 놓으면 봄->여름->봄 왕복에서 색이 계속 어두워진다)
  FPWorld.seasonSkin = {
    // 지면 텍스처에 곱하는 색조 - 미세 조정용. 큰 변화는 오버레이가 맡는다.
    grounds: [greenCap.material, greenBlock.material[2]].map(m => ({ mat: m, base: m.color.clone() })),
    overlayMat, overlay: groundOverlay,
    citySnowMat, citySnow,
  };

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
    FPWorld.beachRamp = ramp;   // 온도계가 '해변 모래'를 따로 집어낼 수 있게
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

  // 파도 표면은 매 프레임 형상이 바뀌는데 boundingSphere는 평평했을 때 한 번만 계산된다.
  // 마루 높이만큼 여유를 주지 않으면 비스듬히 볼 때 수면이 통째로 컬링돼 사라진다.
  waveGeo.computeBoundingSphere();
  waveGeo.boundingSphere.radius += WAVE_MAX_AMPLITUDE;

  // ── 물 몸통: 뚜껑 없는 '통' ────────────────────────────────────────────────
  // 예전에는 Box 하나로 물을 채웠는데, 박스 윗면이 파도 표면보다 0.1(실척 5m) 위에
  // 떠 있어서 밖에서 보면 '일렁이지 않는 파란 평면'이 바다 위에 한 겹 더 얹힌 것처럼
  // 보였다(= 바다가 이중으로 보이는 원인). 박스 높이를 줄여 윗면을 수면에 맞춰도
  // 파도 골에서 평평한 뚜껑이 비친다.
  // 그래서 윗면 자체를 없애고 옆면 4장만 남긴 뒤, 그 윗변을 매 프레임 파도 높이에
  // 맞춰 올렸다 내린다. 옆에서 보면 물이 꽉 찬 것처럼 보이고 윗면은 파도 표면 그 자체다.
  const WALL_SEG = 40;
  const wallCorners = [
    [-waveW / 2, -waveD / 2], [waveW / 2, -waveD / 2],
    [waveW / 2, waveD / 2], [-waveW / 2, waveD / 2],
  ];
  const wallCols = WALL_SEG + 1;
  const wallTopN = 4 * wallCols;                  // 윗변 정점 수 (변마다 wallCols개)
  const wallPos = new Float32Array(wallTopN * 2 * 3);
  const wallSX = new Float32Array(wallTopN);      // 윗변 정점의 파도 샘플 좌표
  const wallSY = new Float32Array(wallTopN);
  const wallIdx = [];
  const WALL_BOTTOM = OCEAN_BASE - 0.03;          // 해저 지형보다 확실히 아래(틈 방지)
  for (let e = 0; e < 4; e++) {
    const [x0, z0] = wallCorners[e], [x1, z1] = wallCorners[(e + 1) % 4];
    for (let i = 0; i < wallCols; i++) {
      const s = i / WALL_SEG;
      const x = x0 + (x1 - x0) * s, z = z0 + (z1 - z0) * s;
      const k = e * wallCols + i, vT = k * 2, vB = vT + 1;
      wallPos[vT * 3] = x; wallPos[vT * 3 + 1] = waveBaseY; wallPos[vT * 3 + 2] = z;
      wallPos[vB * 3] = x; wallPos[vB * 3 + 1] = WALL_BOTTOM; wallPos[vB * 3 + 2] = z;
      // 파도 평면은 rotateX(-90°) 상태라 로컬 (lx, ly) -> 월드 (x, z) = (lx, -ly)
      wallSX[k] = x; wallSY[k] = -z;
      if (i < WALL_SEG) wallIdx.push(vT, vB, vT + 2, vB, vB + 2, vT + 2);
    }
  }
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(wallPos, 3));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeVertexNormals();   // 옆면은 수직이라 윗변이 오르내려도 법선은 그대로다
  wallGeo.computeBoundingSphere();
  wallGeo.boundingSphere.radius += WAVE_MAX_AMPLITUDE;
  const waterBody = new THREE.Mesh(wallGeo, new THREE.MeshPhysicalMaterial({
    color: 0x0e2c45, transparent: true, opacity: 0.55, roughness: 0.2,
    depthWrite: false, side: THREE.DoubleSide,   // 헤엄쳐 들어가면 안쪽에서도 보여야 한다
  }));
  oceanGroup.add(waterBody);
  FPWorld.waterWall = { geo: wallGeo, attr: wallGeo.attributes.position, sx: wallSX, sy: wallSY, topN: wallTopN };

  // 빙하: 1인칭에선 물 위에 뜬 거대한 유빙이라 올라설 수 있게 충돌체로도 등록
  const iceMat = new THREE.MeshPhysicalMaterial({ map: T.iceCrack, color: 0xf3fbff, roughness: 0.15, clearcoat: 0.8, flatShading: true });
  [[-0.5, -0.4], [0.3, 0.3], [0.55, -0.5], [-0.15, 0.5]].forEach(([x, z]) => {
    const s = 0.05 + Math.random() * 0.03;
    const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), iceMat);
    ice.position.set(x, waveBaseY + s * 0.35, z);
    ice.castShadow = true;
    oceanGroup.add(ice);
    FPWorld.iceMeshes.push(ice);   // 온도계가 '빙하'를 따로 집어낼 수 있게
    const col = { x: x - ZONE_W, z, r: s * 0.95, top: ice.position.y + s * 0.5 };
    FPWorld.cylinders.push(col);
    // 계절에 따라 유빙 크기가 변한다. 겉모습만 키우면 보이지 않는 벽이 생기므로
    // 충돌체와 기준 치수를 같이 들고 있다가 applySeason()에서 함께 갱신한다.
    ice.userData.baseSize = s;
    ice.userData.baseY = ice.position.y;
    ice.userData.collider = col;
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
  FPWorld.leafMat = leafMat;   // 계절마다 색이 바뀐다 (겨울엔 잎 자체를 숨김)
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
      FPWorld.leafMeshes.push(leaf);   // 겨울에 통째로 숨겨 낙엽을 표현한다
    }
    tree.position.set(x, wetlandY(x, z), z);
    world.add(tree);
    // 줄기만 막고 잎은 통과 - 나무 밑을 지나갈 수 있어야 자연스럽다
    FPWorld.cylinders.push({ x, z, r: rBot + 0.004, top: wetlandY(x, z) + h });
    // CO2 센서가 "나무 근처"를 판정하는 데 쓴다.
    // 잎 덩어리는 중심에서 0.03 밀린 자리에 반지름 0.035~0.055로 붙고 z로 1.6배
    // 늘어나므로 수관이 덮는 범위가 대략 0.11(실척 5.5m)이다.
    FPWorld.trees.push({ x, z, r: 0.11 });
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
    // 계절마다 잔디를 다시 칠하려면 '이 포기의 원래 색조'를 알아야 한다.
    // setColorAt()은 값을 넣기만 하고 되읽을 방법이 없어서 여기서 따로 보관해 둔다.
    const baseHSL = new Float32Array(FP.GRASS_COUNT * 3);
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
      const gh = 0.26 + Math.random() * 0.06;
      const gs2 = 0.42 + Math.random() * 0.22;
      const gl = 0.32 + Math.random() * 0.18;
      baseHSL[placed * 3] = gh; baseHSL[placed * 3 + 1] = gs2; baseHSL[placed * 3 + 2] = gl;
      col.setHSL(gh, gs2, gl);
      grassMesh.setColorAt(placed, col);
      placed++;
    }
    grassMesh.count = placed;
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
    FPWorld.grass = { mesh: grassMesh, baseHSL, count: placed };
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
  // seg를 낮추면 저해상도 구를 쓴다. 어류처럼 개체가 수백 마리인 쪽은 눈 하나가
  // 삼각형 400개씩 먹으면 눈알만으로 씬 전체 폴리곤을 넘겨버려서 따로 낮춰 쓴다.
  function addEyes(g, x, y, z, spread, r, seg) {
    const [wS, wR] = seg ? [seg, Math.max(3, Math.round(seg * 0.7))] : [12, 10];
    const [pS, pR] = seg ? [Math.max(4, seg - 1), Math.max(3, Math.round(seg * 0.5))] : [10, 8];
    [-spread, spread].forEach(dz => {
      const w = new THREE.Mesh(new THREE.SphereGeometry(r, wS, wR), eyeWhiteMat);
      w.position.set(x, y, z + dz);
      g.add(w);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, pS, pR), eyePupilMat);
      p.position.set(x + r * 0.6, y, z + dz);   // 얼굴 앞쪽(+x)을 바라보게
      g.add(p);
    });
  }

  // ── 조각 모델 굽기(bake) ────────────────────────────────────────────────────
  // 저폴리 조각 여러 개를 이어붙여 만든 모델은 조각 수가 곧 드로우콜 수가 된다.
  // 물고기 한 마리가 메시 8개면 300마리에 2,400 드로우콜 - 내장 그래픽에선 못 버틴다.
  // 움직일 필요가 없는 부위는 하나의 지오메트리로 구워서 개체당 1 드로우콜로 만든다.
  //  - mat를 주면 그 재질 하나로 굽는다(산호처럼 나중에 재질 색을 바꿔야 하는 경우).
  //  - 안 주면 조각별 색을 정점색으로 구워넣고 공용 재질을 쓴다(색이 여러 개인 물고기).
  const bakedLifeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true });
  function bakeGroup(src, mat) {
    src.updateMatrixWorld(true);
    const parts = [];
    let total = 0;
    src.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);          // src는 원점·무회전 상태에서 굽는다
      parts.push({ g, c: o.material.color });
      total += g.attributes.position.count;
    });
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = mat ? null : new Float32Array(total * 3);
    let off = 0;
    for (const { g, c } of parts) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      // Color의 r/g/b는 이미 작업 색공간(선형)이라 정점색에 그대로 넣으면 된다
      if (col) for (let i = 0; i < n; i++) {
        const j = (off + i) * 3;
        col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
      }
      off += n;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, mat || bakedLifeMat);
    mesh.castShadow = false;
    return mesh;
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
      const a = {
        kind, group, legs, hop,
        x, z, heading: Math.random() * Math.PI * 2,
        state: 'walk', timer: Math.random() * 2.5, phase: Math.random() * 10,
      };
      // 온도계가 동물을 집어낼 수 있게 그룹에 자기 자신을 심어 둔다.
      // 동물 한 마리는 메시가 여러 개라, 레이캐스트로 맞은 메시에서 부모를 거슬러
      // 올라가며 이 표시를 찾는 방식이 가장 단순하다.
      group.userData.animal = a;
      FPWorld.animalGroups.push(group);
      FPWorld.animals.push(a);
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
  // 꼬리만 따로 흔들어야 하므로 '몸통 한 덩어리 + 꼬리' 2메시로 굽는다.
  // (굽기 전에는 마리당 3~8메시였다. 개체 수가 세 자리라 이 차이가 그대로 프레임에 나온다.)
  function buildFish(size, bodyMat, finMat, detail) {
    const src = new THREE.Group();
    src.add(bx(size * 1.0, size * 0.5, size * 0.28, bodyMat, 0, 0, 0));            // 몸통
    src.add(bx(size * 0.34, size * 0.34, size * 0.22, bodyMat, size * 0.56, 0, 0)); // 머리
    if (detail) {
      src.add(bx(size * 0.3, size * 0.16, size * 0.04, finMat, 0, size * 0.31, 0)); // 등지느러미
      // 지상 동물과 같은 '흰자+눈동자' 테마를 유지하되 구 분할만 크게 낮춘다
      addEyes(src, size * 0.68, size * 0.07, 0, size * 0.1, size * 0.062, 6);
    }
    const tail = bx(size * 0.28, size * 0.46, size * 0.05, finMat, -size * 0.62, 0, 0);
    tail.castShadow = false;   // 물속이라 그림자는 안 보이는데 비용은 그대로 들어서 끈다
    if (!detail) {
      // 소형 어류는 실척 25cm라 꼬리지느러미 하나가 흔들리는 게 보일 크기가 아니다.
      // 꼬리까지 통째로 구워 1 드로우콜로 만들고, 대신 몸 전체를 좌우로 흔들어
      // 헤엄치는 티를 낸다 (updateOceanLife에서 tail이 없으면 그렇게 처리).
      src.add(tail);
      const only = bakeGroup(src);
      return { group: only, tail: null };
    }
    const g = new THREE.Group();
    g.add(bakeGroup(src));
    // 꼬리는 매 프레임 회전해야 해서 굽지 않고 남긴다 (마리당 1 드로우콜 추가)
    g.add(tail);
    return { group: g, tail };
  }

  // 바다 생물 밀도 배수 (성능이 부족하면 이 값만 낮추면 전체가 같이 줄어든다)
  const SEA_DENSITY = 9;
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
      group.userData.fish = true;
      FPWorld.fishGroups.push(group);
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

  // 산호·수초는 재질 색을 나중에 바꿔야 하거나(백화) 색이 한 가지뿐이라,
  // 정점색 대신 '기존 재질 그대로' 한 덩어리로 굽는다. 백화 로직은 그대로 동작한다.
  function buildBranchCoralGeo() {
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
    return bakeGroup(g, coralBranchMat).geometry;
  }
  function buildBrainCoralGeo() {
    const r = 0.014;
    const geo = new THREE.IcosahedronGeometry(r, 1);
    geo.scale(1, 0.55, 1);
    geo.translate(0, r * 0.35, 0);
    return geo;
  }

  // 수초 2종: 다시마(길게 흔들리는 띠) / 잘피(짧은 잎 다발)
  const kelpMat = new THREE.MeshStandardMaterial({ color: 0x487038, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const grassSeaMat = new THREE.MeshStandardMaterial({ color: 0x6aa84f, roughness: 0.9, side: THREE.DoubleSide });
  // 다시마: 예전엔 마디 Group을 사슬처럼 이어 붙여서 흔들었는데, 그러면 한 포기가
  // 메시 4~6개였다. 대신 세로로 긴 띠(PlaneGeometry) 한 장으로 만들고 매 프레임
  // 행(row)별로 x를 밀어 휘게 한다. 메시는 1개로 줄면서 휨은 오히려 더 매끄럽다.
  function buildKelp() {
    const rows = 8;
    const h = 0.055 + Math.random() * 0.035;
    const geo = new THREE.PlaneGeometry(0.010, h, 1, rows);
    geo.translate(0, h / 2, 0);                       // 밑동을 원점에
    const mesh = new THREE.Mesh(geo, kelpMat);
    mesh.castShadow = false;
    const pos = geo.attributes.position;
    // 정점의 원래 x와, 밑동에서의 높이 비율(휘는 정도)을 미리 뽑아둔다
    const baseX = Float32Array.from({ length: pos.count }, (_, i) => pos.getX(i));
    const rise = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i) / h);
    return { group: mesh, kelp: { pos, baseX, rise, amp: h * 0.35 }, phase: Math.random() * 10 };
  }
  function buildSeagrassGeo() {
    const g = new THREE.Group();
    const n = 5;
    for (let i = 0; i < n; i++) {
      const h = 0.009 + Math.random() * 0.008;
      const blade = bx(0.0035, h, 0.0009, grassSeaMat,
        (Math.random() - 0.5) * 0.012, h / 2, (Math.random() - 0.5) * 0.012);
      blade.rotation.z = (Math.random() - 0.5) * 0.5;
      g.add(blade);
    }
    return bakeGroup(g, grassSeaMat).geometry;
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
      store.push(made.kelp ? { group: g, kelp: made.kelp, phase: made.phase } : { group: g });
    }
  }

  // 산호·잘피는 심어 놓고 나면 제자리에서 아무것도 하지 않는다(백화는 재질 색만 바뀜).
  // 그래서 개체마다 메시를 두지 않고 InstancedMesh로 한 번에 그린다.
  // 이 셋만 인스턴싱해도 수중 드로우콜이 300개 넘게 줄어든다 - 내장 그래픽에서 체감이 크다.
  const _im = new THREE.Matrix4(), _iq = new THREE.Quaternion();
  const _ip = new THREE.Vector3(), _is = new THREE.Vector3(), _iup = new THREE.Vector3(0, 1, 0);
  function scatterInstanced(geo, mat, count, sizeLo, sizeHi) {
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.castShadow = false;
    for (let i = 0; i < count; i++) {
      const lx = (Math.random() - 0.5) * 2 * SEA_HALF_X;
      const lz = (Math.random() - 0.5) * 2 * SEA_HALF_Z;
      _ip.set(lx, seabedY(lx, lz) - 0.001, lz);
      _iq.setFromAxisAngle(_iup, Math.random() * Math.PI * 2);
      // 인스턴스는 지오메트리를 공유하므로 크기·회전으로 개체차를 만든다
      const k = sizeLo + Math.random() * (sizeHi - sizeLo);
      _is.set(k, k * (0.8 + Math.random() * 0.5), k);
      im.setMatrixAt(i, _im.compose(_ip, _iq, _is));
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    oceanGroup.add(im);
    return im;
  }

  // 가지산호는 지오메트리 3종을 돌려써서 인스턴싱해도 다 똑같아 보이지 않게 한다
  FPWorld.corals = [];
  const branchGeos = [buildBranchCoralGeo(), buildBranchCoralGeo(), buildBranchCoralGeo()];
  const branchEach = Math.round(10 * SEA_DENSITY / 3);
  branchGeos.forEach(g => FPWorld.corals.push(scatterInstanced(g, coralBranchMat, branchEach, 0.8, 1.5)));
  FPWorld.corals.push(scatterInstanced(buildBrainCoralGeo(), coralBrainMat, 8 * SEA_DENSITY, 0.7, 1.4));
  FPWorld.coralCount = branchEach * 3 + 8 * SEA_DENSITY;

  // 다시마만 개체별 메시로 남는다(마디마다 휘어야 해서 인스턴싱이 안 됨).
  FPWorld.plants = [];
  scatterOnSeabed(buildKelp, 14 * SEA_DENSITY, FPWorld.plants);
  // 잘피: 인스턴싱 + 개체수 감소는 mesh.count 를 줄이는 것으로 처리한다
  // (three.js는 앞에서부터 count개만 그리므로, 앞쪽이 살아남는 기존 규칙과 맞아떨어진다)
  FPWorld.seagrass = { mesh: scatterInstanced(buildSeagrassGeo(), grassSeaMat, 12 * SEA_DENSITY, 0.8, 1.6), total: 12 * SEA_DENSITY };
  FPWorld.plantTotal = FPWorld.plants.length + FPWorld.seagrass.total;
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
    const wheels = [];
    [[-0.03, 0.024], [0.03, 0.024], [-0.03, -0.024], [0.03, -0.024]].forEach(([wx, wz]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, wheelR, wz);
      wheel.castShadow = true;
      group.add(wheel);
      wheels.push(wheel);
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
      group, bodyParts, bolts, wheels, wheelR,
      // 예전엔 이 메시도 tail 이라는 같은 이름으로 내보내고, 아래에서 같은 키에
      // 배기구 '월드 좌표' Vector3 를 덮어써 버렸다. 그래서 applyWorldCO2()의
      // car.tail.visible = isGas 가 Vector3 에 쓸모없는 속성을 다는 꼴이 되어
      // 전기차인데도 배기구가 계속 달려 있었다. 이름을 갈라 놓는다.
      tailMesh: tail,
      tailLocal: new THREE.Vector3(-0.054, bodyBottomY + 0.004, -0.012),
    };
  }
  // ── 주행 ────────────────────────────────────────────────────────────────
  // 예전엔 도로와 상관없는 자리에 12대가 멈춰 서 있었다. 이제 도로를 따라 달리고
  // 끝에 닿으면 반대편 끝에서 다시 태어난다(총 10대 유지).
  //
  // 좌표는 전부 cityGroup 로컬이다(cityGroup 자체가 x=+ZONE_W 만큼 밀려 있다).
  //   간선도로 : z = MAIN_ROAD_Z,  x 방향으로 달림
  //   교차도로 : x = CROSS_ROAD_X, z 방향으로 달림
  // 차선은 중앙선에서 ±LANE_OFF. 우측통행이라 진행방향 기준 오른쪽에 붙는다.
  // 모델이 +x를 바라보고 rotation.y=θ 일 때 진행방향은 (cos θ, 0, -sin θ) 이므로
  //   +x → 0 / -x → π / +z → -π/2 / -z → +π/2
  const LANE_OFF = 0.03;
  const MAIN_HALF = (ZONE_W - 0.015) / 2;      // 간선도로 반길이
  const CROSS_HALF = (BOX_D - 0.02) / 2;       // 교차도로 반길이
  const CAR_HALF_LEN = 0.048;                  // 차체 절반 길이 (충돌체와 앞차 간격에 씀)
  const ROADS = {
    main:  { from: -MAIN_HALF, to: MAIN_HALF, n: 6 },
    cross: { from: -CROSS_HALF, to: CROSS_HALF, n: 4 },
  };

  // 차 한 대의 위치·방향을 도로 좌표(s)에서 계산해 씬에 반영한다
  function placeCar(c) {
    const g = c.group;
    if (c.lane === 'main') {
      g.position.set(c.s, GROUND_BASE, MAIN_ROAD_Z + c.dir * LANE_OFF);
      g.rotation.y = c.dir > 0 ? 0 : Math.PI;
    } else {
      g.position.set(CROSS_ROAD_X - c.dir * LANE_OFF, GROUND_BASE, c.s);
      g.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    // 배기구 월드 좌표: 차가 움직이므로 매번 다시 구해야 한다.
    // (예전엔 생성 시 한 번 계산한 값을 그대로 써서, 차가 움직이면 배기가스가
    //  제자리에 남고 CO2 센서도 엉뚱한 곳에서 높게 나왔을 것이다)
    g.updateMatrixWorld();
    c.tailPos.copy(c.tailLocal).applyMatrix4(g.matrixWorld);
    // 충돌체도 같이 따라간다. 차를 뚫고 지나갈 수 없어야 한다.
    const wx = g.position.x + ZONE_W, wz = g.position.z;
    const alongX = c.lane === 'main';
    const hx = alongX ? CAR_HALF_LEN : 0.026;
    const hz = alongX ? 0.026 : CAR_HALF_LEN;
    c.box.minX = wx - hx; c.box.maxX = wx + hx;
    c.box.minZ = wz - hz; c.box.maxZ = wz + hz;
  }

  // 도로 끝을 넘어가면 반대편 끝에서 다시 태어난다.
  // 그 자리에 이미 다른 차가 서 있으면(정체 등) 그만큼 더 뒤에서 태어나게 밀어 준다.
  // 안 그러면 새 차가 기존 차 위에 겹쳐서 나타난다.
  function respawnCar(c, cars) {
    const R = ROADS[c.lane];
    let s = c.dir > 0 ? R.from - CAR_HALF_LEN : R.to + CAR_HALF_LEN;
    if (cars) {
      for (const o of cars) {
        if (o === c || o.lane !== c.lane || o.dir !== c.dir) continue;
        // 진행방향 기준으로 o가 스폰 지점 앞쪽 가까이에 있으면 그 뒤로 물러난다
        const d = (o.s - s) * c.dir;
        if (d > -0.12 && d < 0.12) s = o.s - c.dir * 0.12;
      }
    }
    c.s = s;
    c.baseSpeed = CAR_SPEED_MIN + Math.random() * (CAR_SPEED_MAX - CAR_SPEED_MIN);
    c.speed = c.baseSpeed;
  }

  FPWorld.cars = [];
  let carIndex = 0;
  for (const lane of ['main', 'cross']) {
    const R = ROADS[lane];
    for (let i = 0; i < R.n; i++) {
      const built = buildCarModel();
      cityGroup.add(built.group);
      const dir = i % 2 === 0 ? 1 : -1;
      const box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: GROUND_BASE + 0.062 };
      FPWorld.boxes.push(box);
      const c = {
        group: built.group, bodyParts: built.bodyParts, bolts: built.bolts,
        tailMesh: built.tailMesh, tailLocal: built.tailLocal, wheels: built.wheels,
        wheelR: built.wheelR, isGas: true, box,
        tailPos: new THREE.Vector3(),
        lane, dir,
        // 같은 차선의 차들을 고르게 흩어 놓는다 (한 덩어리로 몰려 출발하지 않게)
        s: R.from + (R.to - R.from) * ((i + 0.5) / R.n),
        baseSpeed: 0, speed: 0,
      };
      c.baseSpeed = CAR_SPEED_MIN + Math.random() * (CAR_SPEED_MAX - CAR_SPEED_MIN);
      c.speed = c.baseSpeed;
      placeCar(c);
      FPWorld.cars.push(c);
      carIndex++;
    }
  }
  FPWorld.placeCar = placeCar;
  FPWorld.respawnCar = respawnCar;
  FPWorld.ROADS = ROADS;
  // 도로 상수는 buildFirstPersonWorld() 스코프 안에 있어서 모듈 레벨 updateCars()가
  // 직접 못 본다. 주행 계산과 미니맵이 함께 쓰므로 내보낸다.
  FPWorld.road = {
    mainZ: MAIN_ROAD_Z, crossX: CROSS_ROAD_X, width: ROAD_W,
    mainHalf: MAIN_HALF, crossHalf: CROSS_HALF, laneOff: LANE_OFF, carHalfLen: CAR_HALF_LEN,
  };
  FPWorld.evCarMat = evCarMat;
  FPWorld.gasCarMat = gasCarMat;

  // 배기가스 파티클: 내연기관차 대수에 맞춰 파티클을 나눠 배정한다.
  // (전부 전기차가 되면 opacity 0으로 통째로 사라짐)
  const EXHAUST_PER_CAR = 14;
  const exCount = FPWorld.cars.length * EXHAUST_PER_CAR;
  const exGeo = new THREE.BufferGeometry();
  exGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(exCount * 3), 3));
  const exLife = new Float32Array(exCount);
  for (let i = 0; i < exCount; i++) exLife[i] = Math.random();
  const exhaust = new THREE.Points(exGeo, new THREE.PointsMaterial({
    color: 0x6b6660, size: 0.012, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  // 프러스텀 컬링 끄기. three.js는 boundingSphere를 지오메트리 생성 시점에 한 번만
  // 계산하고, 정점을 매 프레임 갱신해도 다시 계산하지 않는다. 배기 입자는 "살아 있는
  // 내연기관차"에만 붙는데 그 대수가 CO2 슬라이더에 따라 2대 -> 12대로 변하므로,
  // 첫 프레임에 잡힌 좁은 구가 그대로 남아 입자 대부분이 구 밖으로 나간다.
  // 그러면 그 좁은 구가 화면 밖일 때 배기가스 전체가 통째로 사라진다 - 도시를 걸어
  // 다니면 "어떤 칸에선 안 보이고 옆 칸에선 보이는" 증상이 이것이다. 드로우콜 1개짜리
  // 오브젝트라 컬링을 꺼도 비용이 없다.
  exhaust.frustumCulled = false;
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
  smoke.frustumCulled = false;   // 배기가스와 같은 이유(굴뚝 연기도 매 프레임 위치가 바뀜)
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
// CO2_MIN / CO2_MAX / CO2_NOW 는 js/earth-model.js 에서 온다 (조감 모드와 공유)

// ── 낮과 밤 ─────────────────────────────────────────────────────────────────
// 왜 넣었나: 도시 열섬의 정의 자체가 "밤에도 안 식는 것"이다. 정오에 고정된 세계에서는
// 열섬을 낮 기온 차이로밖에 못 보여주는데, 실제로 열섬 강도는 밤에 가장 커진다.
// 숲도 마찬가지다. 낮에는 광합성이 CO2를 빨아들이지만 밤에는 호흡만 남아 CO2가 오른다.
// 이 두 가지는 시간이 흐르지 않으면 아예 보여줄 수 없는 현상이라 시간을 넣었다.
//
// 기본은 정오에 '멈춰' 있다. 조사를 하는 중에 시간이 흘러가면 같은 지점을 다시 재도
// 값이 달라져 자료가 못 쓰게 된다. T키나 설정창 슬라이더로 켜고 옮긴다.
FPWorld.hour = 12;
FPWorld.timeFlowing = false;
const DAY_SECONDS = 300;    // 시간을 켰을 때 하루가 흐르는 데 걸리는 실제 시간(5분)

// 일주 변화 곡선: -1(새벽 5시 최저) ~ +1(오후 2시 최고).
// 해가 뜬 뒤 지면이 데워지는 데 시간이 걸리기 때문에 최고기온은 정오가 아니라 오후 2시다.
// 상승 9시간 / 하강 15시간으로 비대칭이라, 반코사인 두 조각을 이어 붙인다.
const T_MIN_H = 5, T_MAX_H = 14;
function diurnal(hour) {
  let h = ((hour % 24) + 24) % 24;
  if (h >= T_MIN_H && h <= T_MAX_H) {
    // 새벽 최저 -> 오후 최고 (9시간 동안 상승)
    return -Math.cos((h - T_MIN_H) / (T_MAX_H - T_MIN_H) * Math.PI);
  }
  // 오후 최고 -> 다음날 새벽 최저 (15시간 동안 하강)
  const t = (h > T_MAX_H ? h - T_MAX_H : h + 24 - T_MAX_H) / (24 - (T_MAX_H - T_MIN_H));
  return Math.cos(t * Math.PI);
}
const DIURNAL_AT_NOON = diurnal(12);   // 정오를 기준점으로 삼아 기존 보정값을 유지한다

// 햇빛의 세기(0=한밤, 1=한낮). 광합성량과 조명이 이 값을 따른다.
// 일출·일몰 시각은 계절이 정한다(여름은 길고 겨울은 짧다). 앞뒤 1.5시간을
// 여명/황혼으로 부드럽게 잇는다.
function daylight(hour) {
  const h = ((hour % 24) + 24) % 24;
  const S = SEASONS[FPWorld.season] || SEASONS.summer;
  const ramp = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  return Math.min(ramp(h, S.rise - 1.5, S.rise + 1.5),
                  1 - ramp(h, S.set - 1.5, S.set + 1.5));
}
function isNight(hour) { return daylight(hour) < 0.5; }
function hourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const d = daylight(h);
  const part = d > 0.85 ? '낮' : (d < 0.15 ? '밤' : (hh < 12 ? '새벽' : '해질녘'));
  return `${part} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const NIGHT_SKY = new THREE.Color(0x0b1526);
const DUSK_SKY = new THREE.Color(0xd98a52);

// ── 환경 합성 ───────────────────────────────────────────────────────────────
// 하늘색·안개·조명은 CO2 / 시간 / 계절 / 날씨 네 가지가 동시에 건드린다.
// 예전엔 applyWorldCO2()가 하늘색과 안개를 직접 써 놓고 applyTimeOfDay()가 그 위에
// 덮어쓰는 구조였다. 여기에 계절과 날씨를 더하면 "비가 개면 계절 색이 사라지는" 식으로
// 마지막에 부른 쪽만 남는 버그가 반드시 난다.
// 그래서 각 요인은 '자기 몫'만 상태에 적어 두고, 화면 반영은 이 함수 하나가 전담한다.
//   하늘색 = CO2 기준색 → 계절 색조 → 시간(밤/황혼) → 날씨(흐림)
//   안개   = CO2 기준거리 × 계절계수 × 날씨계수      (곱셈으로 합성, 덮어쓰기 금지)
//   조명   = 기본세기 × 시간계수 × 날씨계수
//
// 계절/날씨 테이블의 실제 값은 Stage B/C에서 채운다. 지금은 전부 중립값(1.0, 가중치 0)이라
// 이 리팩터만으로는 화면이 조금도 바뀌지 않아야 한다.
FPWorld.season = 'summer';
FPWorld.weather = 'clear';

// ── 계절 ────────────────────────────────────────────────────────────────────
// temp   : 기온 오프셋 [°C]. 중위도 연교차(최난월-최한월)는 20°C 안팎이라 여름 +8 / 겨울 -10.
// seaT   : 해수 기온 오프셋. 훨씬 작은 건 물의 열용량 때문이다(SEA_WARM_AMP과 같은 이유).
// rise/set: 일출·일몰 시각. 여름은 길고 겨울은 짧다.
// co2    : CO2 계절 진동 [ppm]. 이 기능의 과학적 핵심이다.
//          실제 킬링 곡선은 북반구 식생 때문에 연 6ppm 안팎으로 오르내린다
//          (5월 최고 / 9월 최저). 이미 구현한 '낮=광합성 흡수 / 밤=호흡 배출'의
//          연 단위 판이라, 학생이 CO2 센서로 직접 재서 확인할 수 있다.
//          슬라이더 값은 '연평균'이고 실측값은 계절을 탄다고 설명하면 된다.
// grass  : 잔디 색조 가산 (H, S, L). leaf: 나뭇잎 색. snow: 지면 눈 덮임 비율.
// ice    : 유빙 크기 배수.
const SEASONS = {
  spring: { ko: '봄',   temp: 0.0,  seaT: 0.0,  rise: 6.0, set: 18.0, co2: +3,
            sky: 0xd8f0c0, skyW: 0.10, fogK: 1.00,
            grass: [+0.02, +0.10, +0.06], leaf: 0x6cae4a, snow: 0.00, ice: 1.00,
            ground: 0xd9f0b8, groundW: 0.20, ov: 0x9ed46a, ovW: 0.12 },
  summer: { ko: '여름', temp: +8.0, seaT: +2.5, rise: 5.0, set: 19.5, co2: -1,
            sky: 0xffffff, skyW: 0.00, fogK: 1.00,
            grass: [0, 0, 0],             leaf: 0x3f7433, snow: 0.00, ice: 0.75,
            ground: 0xffffff, groundW: 0.00, ov: 0xffffff, ovW: 0.00 },
  autumn: { ko: '가을', temp: +0.5, seaT: +1.0, rise: 6.0, set: 18.0, co2: -3,
            sky: 0xf0d68c, skyW: 0.12, fogK: 0.95,
            grass: [-0.16, -0.05, +0.02], leaf: 0xc9772a, snow: 0.00, ice: 1.00,
            ground: 0xc9a45c, groundW: 0.35, ov: 0xb07d33, ovW: 0.55 },
  winter: { ko: '겨울', temp: -10.0, seaT: -3.0, rise: 7.5, set: 17.0, co2: +2,
            sky: 0xdfe8f2, skyW: 0.18, fogK: 0.85,
            grass: [-0.10, -0.35, +0.10], leaf: null,     snow: 0.82, ice: 1.35,
            ground: 0xa8b0a4, groundW: 0.20, ov: 0xf4f8fc, ovW: 0.88 },
};
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
function seasonDef() { return SEASONS[FPWorld.season] || SEASONS.summer; }
// applyEnvironment()가 쓰는 이름을 그대로 유지 (하늘색·안개 몫만 꺼내 준다)
const SEASON_ENV = SEASONS;
// 날씨가 환경에 주는 몫 (입자·소리·기온 보정은 Stage C에서 fp-weather.js가 맡는다)
const WEATHER_ENV = {
  clear:  { sky: 0xffffff, skyW: 0.00, fogK: 1.00, lightK: 1.00 },
  rain:   { sky: 0x6b7a85, skyW: 0.55, fogK: 0.55, lightK: 0.62 },
  storm:  { sky: 0x3c4650, skyW: 0.75, fogK: 0.35, lightK: 0.45 },
  snow:   { sky: 0x9aa8b4, skyW: 0.60, fogK: 0.45, lightK: 0.75 },
  squall: { sky: 0x55626d, skyW: 0.70, fogK: 0.30, lightK: 0.55 },
  fog:    { sky: 0xb8c0c6, skyW: 0.80, fogK: 0.12, lightK: 0.80 },
};
function seasonEnv() { return SEASON_ENV[FPWorld.season] || SEASON_ENV.summer; }
function weatherEnv() { return WEATHER_ENV[FPWorld.weather] || WEATHER_ENV.clear; }

const _envColor = new THREE.Color();
const _envTint = new THREE.Color();

function applyEnvironment() {
  const h = FPWorld.hour, d = daylight(h);
  FPWorld.daylight = d;
  const L = FPWorld.lights;
  if (!L) return;
  const S = seasonEnv(), W = weatherEnv();

  // 1) CO2가 정한 '맑은 낮의 하늘색'에서 출발
  _envColor.copy(FPWorld.daySky || CLEAR_SKY);
  // 2) 계절 색조 (봄 연둣빛 / 가을 노란빛 / 겨울 창백)
  if (S.skyW > 0) _envColor.lerp(_envTint.setHex(S.sky), S.skyW);
  // 3) 시간: 밤으로 갈수록 어두워지고, 여명·황혼에는 붉은 하늘을 잠깐 거쳐 간다
  const dusk = 1 - Math.abs(d - 0.5) * 2;
  _envColor.lerpColors(NIGHT_SKY, _envTint.copy(_envColor), d);
  _envColor.lerp(DUSK_SKY, dusk * 0.55);
  // 4) 날씨: 흐릴수록 회색으로 끌어당긴다. 밤에는 흐림도 어둡게 보여야 하므로
  //    날씨 색조 자체를 그 시각의 밝기만큼 낮춰서 섞는다.
  if (W.skyW > 0) {
    _envTint.setHex(W.sky).multiplyScalar(0.25 + 0.75 * d);
    _envColor.lerp(_envTint, W.skyW);
  }
  FPWorld.skyMat.color.copy(_envColor);
  FPWorld.scene.fog.color.copy(_envColor);

  // 안개 거리: CO2가 정한 기준거리에 계절·날씨 계수를 곱한다
  const fb = FPWorld.fogBase;
  const k = S.fogK * W.fogK;
  FPWorld.scene.fog.far = fb.far * k;
  FPWorld.scene.fog.near = fb.near * k;

  // 조명: 밤에도 완전히 캄캄하면 아무것도 못 하므로 달빛 정도(15%)는 남긴다
  const lit = (0.15 + 0.85 * d) * W.lightK;
  L.sun.intensity = L.base.sun * lit;
  L.lampSpot.intensity = L.base.spot * lit;
  L.ambient.intensity = L.base.ambient * (0.30 + 0.70 * d) * W.lightK;
  L.hemi.intensity = L.base.hemi * (0.25 + 0.75 * d) * W.lightK;
  // 거대 전등의 전구도 같이 꺼진다 - 이 세계의 광원이 저것이라는 걸 보여주는 부분
  L.bulbMat.color.setRGB(1, 0.972, 0.886).multiplyScalar(0.25 + 0.75 * d);
  // 별은 밤이면서 하늘이 뚫려 있을 때만 보인다 (구름이 덮으면 안 보여야 한다)
  if (FPWorld.stars) {
    FPWorld.stars.material.opacity = Math.max(0, 1 - d * 1.6) * (1 - W.skyW);
  }
}

// 계절이 '겉모습'을 바꾸는 부분. 색·크기라 매 프레임 돌 필요가 없고 바뀔 때만 부른다.
// (기온·일장·CO2 진동은 fp-tools.js와 daylight()가 SEASONS 테이블을 직접 읽는다)
const _sc = new THREE.Color();
const SNOW_COLOR = new THREE.Color(0xf2f6fa);
function applySeason(name) {
  if (SEASONS[name]) FPWorld.season = name;
  const S = seasonDef();

  // 잔디: 저장해 둔 원본 HSL에 계절 가산값을 더해 다시 칠한다.
  // 원본을 안 들고 있으면 계절을 왕복할 때마다 색이 계속 어긋난다.
  const G = FPWorld.grass;
  if (G) {
    const [dh, ds, dl] = S.grass;
    for (let i = 0; i < G.count; i++) {
      _sc.setHSL(
        (G.baseHSL[i * 3] + dh + 1) % 1,
        Math.min(1, Math.max(0, G.baseHSL[i * 3 + 1] + ds)),
        Math.min(1, Math.max(0, G.baseHSL[i * 3 + 2] + dl))
      );
      // 겨울엔 눈에 파묻힌 만큼 흰색으로 끌어당긴다
      if (S.snow > 0) _sc.lerp(SNOW_COLOR, S.snow * 0.8);
      G.mesh.setColorAt(i, _sc);
    }
    if (G.mesh.instanceColor) G.mesh.instanceColor.needsUpdate = true;
  }

  // 나뭇잎: 겨울은 통째로 숨겨 낙엽을 표현한다
  if (FPWorld.leafMat && S.leaf != null) FPWorld.leafMat.color.setHex(S.leaf);
  FPWorld.leafMeshes.forEach(m => { m.visible = S.leaf != null; });

  // 지면: 텍스처에 계절 색조를 살짝 곱하고, 큰 변화는 반투명 오버레이가 만든다
  const SK = FPWorld.seasonSkin;
  if (SK) {
    SK.grounds.forEach(({ mat, base }) => mat.color.copy(base).lerp(_sc.setHex(S.ground), S.groundW));
    SK.overlayMat.color.setHex(S.ov);
    SK.overlayMat.opacity = S.ovW;
    SK.overlay.visible = S.ovW > 0.01;
    SK.citySnowMat.opacity = S.snow;
    SK.citySnow.visible = S.snow > 0.01;
  }

  // 유빙: 겨울에 커지고 여름에 녹아 작아진다. 충돌체도 같이 따라가야 한다.
  FPWorld.iceMeshes.forEach(ice => {
    const u = ice.userData;
    if (!u.baseSize) return;
    ice.scale.setScalar(S.ice);
    ice.position.y = waveBaseY + u.baseSize * S.ice * 0.35;
    if (u.collider) {
      u.collider.r = u.baseSize * S.ice * 0.95;
      u.collider.top = ice.position.y + u.baseSize * S.ice * 0.5;
    }
  });

  FPWorld.refresh();
}

// 상태를 바꾼 쪽(CO2·시간·계절·날씨 UI)은 전부 이것만 부르면 된다.
// 갱신 경로를 하나로 모아 두면 "어떤 순서로 눌러도 넷 다 반영"이 보장된다.
FPWorld.refresh = function () { applyWorldCO2(FPWorld.co2); };

function updateTime(dt) {
  if (!FPWorld.timeFlowing) return;
  FPWorld.hour = (FPWorld.hour + dt * 24 / DAY_SECONDS) % 24;
  FPWorld.refresh();   // 광합성량도 시간을 타므로 대기 상태까지 통째로 다시 계산
}

// ── 해양 pH ─────────────────────────────────────────────────────────────────
// 예전엔 여기서 자체 곡선을 썼다. 1000ppm에서 pH 6.15까지 떨어뜨려 백화를 극적으로
// 보이게 하려던 연출이었는데, 그 결과 같은 프로그램의 '미래 예측' 탭은 7.50을 내놓고
// 1인칭은 6.15를 내놓는 상태가 됐다. 학생이 잰 값과 예측값이 다르면 도구를 못 믿는다.
// (게다가 pH 6.15는 탄산음료 영역이라 산호가 하얘지는 게 아니라 골격이 녹는다.)
//
// 이제 두 모드가 js/earth-model.js 의 seawaterPH() 하나만 쓴다. 탄산 평형을 직접 푼
// 값이라 관측 35점을 RMSE 0.007로 재현한다.
//   280ppm -> 8.19 / 418ppm -> 8.04 / 600ppm -> 7.91 / 1000ppm -> 7.71
// 변화폭이 0.48로 줄어든 만큼, '눈에 보이는 변화'는 pH 자체가 아니라
// 아라고나이트 포화도 Ω(4.44 -> 1.78)와 수온으로 만든다. 아래 백화/석회화 참고.
function oceanPH(ppm) {
  return seawaterPH(ppm);
}

// ── 산호에 일어나는 두 가지 서로 다른 일 ────────────────────────────────────
// 예전엔 pH 하나로 백화와 개체수 감소를 전부 굴렸는데, 기작이 틀렸다.
//   백화(bleaching)  = 수온 스트레스로 공생조류(주산텔라)를 뱉어내는 현상. 열 문제다.
//   석회화 저해/용해 = 아라고나이트 포화도 Ω가 낮아져 골격을 못 만들거나 녹는 현상.
//                      이쪽이 산성화(pH) 문제다.
// 둘을 분리하면 새로 만든 수온 모델도 살아나고, 학생이 "산성화 = 백화"라는 흔한
// 오개념을 갖지 않게 된다.

// 열 스트레스: 표층 수온이 백화 임계를 넘긴 정도 (0=정상, 1=완전 백화)
// 산호는 '평년 최고수온 + 1°C'가 몇 주 이어지면 백화한다(NOAA의 Degree Heating Week
// 개념). 여기서는 그 임계를 산업화 이전 해수온 + 1.0°C로 잡고, +3.5°C에서 전면 백화로 본다.
// 이 두 값은 fp-tools.js의 온도표(SPOT.sea)가 그대로 가져다 쓴다.
// 수온을 두 군데서 따로 정의하면 "잰 값"과 "산호가 반응하는 값"이 어긋난다.
const SEA_BASE_T = 18.0;        // 280ppm에서의 표층 수온 [°C]
const SEA_WARM_AMP = 0.75;      // 바다는 열용량이 커서 전 지구 승온보다 덜 오른다
// 백화 임계. 실제로는 '그 지역 월최고수온 + 1°C가 몇 주'가 기준인데 이 모형엔 계절이
// 없으므로, 산업화 이전 수온 대비 +1.5°C에서 시작해 +4.0°C에서 전면 백화로 잡았다.
//   418ppm -> 14% (요즘 실제로 관측되는 정도) / 600ppm -> 80% / 667ppm 이상 -> 전면
const BLEACH_ON = 1.5, BLEACH_FULL = 4.0;
function seaTemperature(ppm) {
  // 계절도 탄다. 여름 바다가 따뜻해지면 백화가 더 잘 일어나야 한다.
  // (fp-tools.js의 SPOT.sea와 같은 기준: 여름을 0점으로 삼는다)
  const S = SEASONS[FPWorld.season] || SEASONS.summer;
  return SEA_BASE_T + SEA_WARM_AMP * warmingSince280(ppm) + (S.seaT - SEASONS.summer.seaT);
}

// ── 빙하 냉수대 ─────────────────────────────────────────────────────────────
// seaTemperature()는 바다 전체가 한 값이라, 탄산 평형이 수온의 함수가 된 뒤에도
// 바다 어디서 재든 pH·Ω가 같았다. 1유닛 ≈ 50m인 작은 세계에 열대-극지 기온차를
// 그대로 넣을 수는 없으므로, 유빙 주변에 녹은 물이 만드는 냉수대로 공간 변이를 만든다.
// (빙하 녹은 물이 차고 Ω를 낮추는 건 실제 피오르·극지 연안에서 관측되는 현상이다.)
//
// 온도계(해수)·해수 분석기·산호가 전부 이 함수 하나를 읽는다. 셋이 같은 값을 써야
// "내가 잰 수온"과 "산호가 반응하는 수온"이 어긋나지 않는다.
const COLD_POOL_DT = 12;      // 유빙 바로 옆에서 개방 해역보다 낮아지는 폭 [°C]
const COLD_POOL_R = 0.35;     // 유빙 가장자리에서 냉수대가 사라지는 거리 [유닛] (≈ 17m)
const SEA_FREEZE_T = -1.9;    // 염분 35 해수의 어는점 [°C] - 이보다 차가워질 수는 없다
// 0 = 냉수대 밖, 1 = 유빙 바로 옆. 가장 가까운 유빙 하나가 정한다.
// 거리는 유빙 '중심'이 아니라 '가장자리'에서 잰다 - 계절마다 유빙 크기가 바뀌므로
// (겨울 1.35배, 여름 0.75배) 충돌체 반지름을 그대로 쓴다. 충돌체 좌표는 이미 월드 좌표다.
function iceProximity(x, z) {
  let p = 0;
  for (const ice of FPWorld.iceMeshes) {
    const c = ice.userData.collider;
    if (!c) continue;
    const d = Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r) / COLD_POOL_R;
    if (d >= 1) continue;
    const s = 1 - d * d * (3 - 2 * d);   // smoothstep 감쇠: 경계에서 꺾이지 않고 0이 된다
    if (s > p) p = s;
  }
  return p;
}
function seaTempAt(x, z, ppm) {
  const base = seaTemperature(ppm);     // CO2·계절 반영 (개방 해역 수온)
  return Math.max(SEA_FREEZE_T, base - COLD_POOL_DT * iceProximity(x, z));
}

// ── 지점의 해수 상태 ────────────────────────────────────────────────────────
// 해수가 녹이고 있는 CO2(pCO2)와 그 지점의 수온으로 탄산 평형을 한 번 푼다.
// pH미터·해수 분석기·산호가 전부 이 함수 하나만 읽는다 - 측정값과 세계 상태가
// 어긋나지 않게 하려는 것이다. 돌려주는 값은 seawaterState()의 결과(mol/kg)에
// 수온(temp)과 pCO2를 덧붙인 것이다.
function seaPCO2(ppm) {
  return ppm;
}
function seaStateAt(x, z, ppm) {
  const temp = seaTempAt(x, z, ppm);
  const pco2 = seaPCO2(ppm);
  const s = seawaterState(pco2, temp);
  s.temp = temp;
  s.pco2 = pco2;
  return s;
}
function coralBleaching(ppm) {
  const excess = seaTemperature(ppm) - (SEA_BASE_T + BLEACH_ON);
  return Math.min(1, Math.max(0, excess / (BLEACH_FULL - BLEACH_ON)));
}
// 석회화 가능성: Ω가 3 아래로 내려가면 성장이 느려지고, 1 밑이면 골격이 녹는다.
// 어류·수초가 기댈 서식지가 남아 있는지를 이 값이 정한다.
function calcificationHealth(ppm) {
  const om = aragoniteOmega(ppm);
  return Math.min(1, Math.max(0, (om - 1.0) / (3.4 - 1.0)));
}
// 생태 종합 건강도(0~1). 서식지(Ω)가 주된 요인이고, 백화는 거기에 얹히는 스트레스다.
// 백화만으로 물고기가 전멸하지는 않으므로 계수를 0.5로 눌러 놨다.
//   280 -> 1.00 / 418 -> 0.93 / 600 -> 0.41 / 1000 -> 0.16
function oceanHealth(ppm) {
  return calcificationHealth(ppm) * (1 - 0.5 * coralBleaching(ppm));
}
function applyWorldCO2(ppm) {
  FPWorld.co2 = ppm;
  const k = Math.min(1, Math.max(0, (ppm - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  FPWorld.co2k = k;

  // CO2는 '맑은 낮의 하늘색'과 '기준 시야거리'까지만 정한다.
  // 실제 화면 값은 여기에 계절·시간·날씨를 합성한 결과라 applyEnvironment()가 마무리한다.
  FPWorld.daySky = new THREE.Color().lerpColors(CLEAR_SKY, HAZY_SKY, k);
  // 맑을 때 7유닛(≈350m)까지 보이다가, 1000ppm에선 1.1유닛(≈55m) 앞도 안 보이게
  FPWorld.fogBase = { far: 7.0 - k * 5.9, near: 0.25 - k * 0.22 };
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
      car.tailMesh.visible = isGas;                         // 전기차엔 배기구 자체가 없음
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
  applyOceanHealth(ppm);
  if (FPWorld.smoke) {
    // CO2가 낮으면 굴뚝 연기가 거의 안 보이고, 높으면 시커멓게 뿜어져 나옴
    FPWorld.smoke.mat.opacity = 0.05 + k * 0.55;
    FPWorld.smoke.mat.size = 0.03 + k * 0.075;
    FPWorld.smoke.mat.color.setHSL(0.09, 0.05, 0.62 - k * 0.35);
    FPWorld.smoke.rate = 0.10 + k * 0.55;
  }
  applyEnvironment();   // 하늘색·안개·조명은 CO2·시간·계절·날씨가 함께 정한다
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

// ── 생물 거리 컬링 ──────────────────────────────────────────────────────────
// 도심에서 서쪽을 보면 맵 반대편(200m 밖) 동물 41마리와 어류 333마리가 전부 그려진다.
// 실측해 보니 그 한 시점에서만 동물 441 + 어류 446 = 887 드로우콜이었다.
// 토끼는 40cm, 물고기는 25cm짜리라 그 거리에서는 몇 픽셀도 안 된다.
// 살아 있는지(alive)와 그려지는지(visible)를 나눠서, 가까운 것만 그린다.
// 성능이 부족하면 이 두 값만 낮추면 된다.
const ANIMAL_CULL = 2.2;   // 실척 110m - 녹지 구역(100m) 어디에 서 있어도 다 보인다
const FISH_CULL = 1.5;     // 실척 75m - 물속은 어차피 시야가 짧다
function cullByDistance(group, x, z, limit) {
  const dx = x - FPPlayer.pos.x, dz = z - FPPlayer.pos.z;
  return dx * dx + dz * dz < limit * limit;
}

// ── 해양 생태 반응 ──────────────────────────────────────────────────────────
// 두 가지 원인을 따로 굴린다:
//   산호 색   <- 수온 (백화는 열 스트레스 현상이다)
//   개체수    <- 아라고나이트 포화도 Ω (서식지 골격을 만들 수 있는가)
// 살아남는 개체를 앞에서부터 세는 방식이라 CO2를 되돌리면 그대로 복원된다.
function applyOceanHealth(ppm) {
  if (!FPWorld.fish || !FPWorld.seagrass) return;
  const bleach = coralBleaching(ppm);        // 0=정상, 1=완전 백화 (수온이 정한다)
  const habitat = calcificationHealth(ppm);  // 1=골격 잘 자람, 0=녹기 시작 (Ω가 정한다)
  const h = oceanHealth(ppm);
  FPWorld.oceanHealth = h;
  FPWorld.coralBleaching = bleach;
  FPWorld.aragonite = aragoniteOmega(ppm);
  FPWorld.seaTemp = seaTemperature(ppm);

  // 산호 백화: 수온이 임계를 넘긴 만큼 고유색 -> 표백된 흰색
  const C = FPWorld.CORAL_COLORS;
  FPWorld.coralMats.branch.color.lerpColors(C.branch, C.bleached, bleach);
  FPWorld.coralMats.brain.color.lerpColors(C.brain, C.bleached, bleach);

  // 수초: 최악이어도 10%는 남겨서 바다가 완전히 텅 비어 보이지 않게
  const survive = 0.10 + 0.90 * h;
  const kelpCount = Math.round(FPWorld.plants.length * survive);
  FPWorld.plants.forEach((p, i) => { p.alive = i < kelpCount; p.group.visible = p.alive; });
  // 잘피는 인스턴스라 '앞에서부터 count개만 그리기'로 같은 규칙을 구현한다
  const sg = FPWorld.seagrass;
  sg.mesh.count = Math.round(sg.total * survive);
  const plantCount = kelpCount + sg.mesh.count;

  // 어류: 최악이면 15%만 남음
  const fishCount = Math.round(FPWorld.fish.length * (0.15 + 0.85 * h));
  FPWorld.fish.forEach((f, i) => { f.alive = i < fishCount; });
  FPWorld.aliveFish = fishCount;
  FPWorld.alivePlants = plantCount;
}

// ── 어류 유영 + 수초 흔들림 ─────────────────────────────────────────────────
function updateOceanLife(dt, t) {
  const HX = FPWorld.SEA_HALF_X, HZ = FPWorld.SEA_HALF_Z, CEIL = FPWorld.SEA_CEIL;
  for (const f of FPWorld.fish) {
    if (!f.alive) { f.group.visible = false; continue; }
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
    const wag = Math.sin(f.phase);
    // 로컬 x는 oceanGroup 기준이라 월드 x는 -ZONE_W 만큼 밀려 있다
    f.group.visible = cullByDistance(f.group, f.lx - FPWorld.ZONE_W, f.lz, FISH_CULL);
    if (!f.group.visible) continue;
    f.group.position.set(f.lx, f.ly, f.lz);
    // 꼬리가 따로 있으면 꼬리만 흔들고, 통째로 구운 소형 어류는 몸을 좌우로 흔든다
    f.group.rotation.set(0, -f.heading + (f.tail ? 0 : wag * 0.13), f.pitch * 0.8);
    if (f.tail) f.tail.rotation.y = wag * 0.65;
  }
  // 다시마: 띠의 각 행을 위로 갈수록 크게, 그리고 위상을 조금씩 늦춰 밀어서
  // 해류에 물결치듯 휘게 한다 (밑동은 rise=0이라 바닥에 붙은 채로 안 움직인다)
  for (const p of FPWorld.plants) {
    if (!p.kelp || !p.alive) continue;
    p.group.visible = cullByDistance(p.group, p.group.position.x - FPWorld.ZONE_W, p.group.position.z, FISH_CULL);
    if (!p.group.visible) continue;
    const K = p.kelp, arr = K.pos.array;
    for (let i = 0; i < K.pos.count; i++) {
      const r = K.rise[i];
      arr[i * 3] = K.baseX[i] + Math.sin(t * 0.9 + p.phase - r * 2.2) * K.amp * r * r;
    }
    K.pos.needsUpdate = true;
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
    // 멀리 있는 개체는 계속 돌아다니되 그리지만 않는다.
    // (갱신까지 멈추면 다가갈 때 한 덩어리로 뭉쳐 있는 게 보인다)
    a.group.visible = cullByDistance(a.group, a.x, a.z, ANIMAL_CULL);
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

// ── 물 옆면: 윗변을 수면(파도) 높이에 맞춘다 ────────────────────────────────
// 윗변 정점만 훑으므로 파도 본체(7천 정점)에 비하면 비용은 무시할 수준이다.
function updateWaterWalls(t, intensity, halfD) {
  const W = FPWorld.waterWall;
  if (!W) return;
  const arr = W.attr.array;
  for (let k = 0; k < W.topN; k++) {
    arr[k * 6 + 1] = FPWorld.waveBaseY + FPWorld.waveHeightAt(W.sx[k], W.sy[k], t, intensity, halfD);
  }
  W.attr.needsUpdate = true;
}

// ── 자동차 주행 ─────────────────────────────────────────────────────────────
// 속도는 실척으로 따지면 어색해진다. 이 세계는 걷는 속도부터가 이미 0.09유닛/초
// (실척 4.5m/s)로 부풀려 있어서, 실제 도심 속도를 그대로 넣으면 순간이동처럼 보인다.
// 걷는 속도의 2~3배쯤이 '차가 지나간다'로 읽힌다.
const CAR_SPEED_MIN = 0.17, CAR_SPEED_MAX = 0.27;
const CAR_LEN = 0.09;          // 차체 길이
const CAR_MIN_GAP = 0.115;     // 앞차 중심과 이보다 가까워지면 안 된다 (차 길이 + 여유)
const CAR_GAP = 0.20;          // 이 거리 안으로 들어오면 감속 시작
const XING_GUARD = 0.11;       // 교차로 충돌 판정 반경

// 같은 차선·같은 방향에서 내 앞에 있는 가장 가까운 차
function leaderOf(c, cars) {
  let best = null, gap = Infinity;
  for (const o of cars) {
    if (o === c || o.lane !== c.lane || o.dir !== c.dir) continue;
    const d = (o.s - c.s) * c.dir;         // 진행방향 기준 앞쪽이면 양수
    if (d > 0 && d < gap) { gap = d; best = o; }
  }
  return { leader: best, gap };
}

function updateCars(dt) {
  const cars = FPWorld.cars;
  if (!cars || !cars.length) return;

  // 교차로에 간선도로 차가 들어와 있으면 교차도로 차가 양보한다.
  // (없으면 두 도로의 차가 같은 지점을 동시에 지나가며 서로를 통과해 버린다)
  const RD = FPWorld.road;
  let mainInXing = false;
  for (const c of cars) {
    if (c.lane === 'main' && Math.abs(c.s - RD.crossX) < XING_GUARD) mainInXing = true;
  }

  for (const c of cars) {
    const { leader, gap } = leaderOf(c, cars);
    let target = c.baseSpeed;
    // CAR_GAP 에서 감속을 시작해 CAR_MIN_GAP 에서 완전히 선다.
    // 정지 거리를 차 길이와 거의 같게 잡으면 평형점이 '겹치기 직전'이 되어
    // 감속이 한 프레임만 늦어도 앞차를 파고든다(실제로 그랬다). 여유를 둔다.
    if (gap < CAR_GAP) {
      target *= Math.min(1, Math.max(0, (gap - CAR_MIN_GAP) / (CAR_GAP - CAR_MIN_GAP)));
    }

    // 교차로 양보: 교차도로 차가 교차점 직전에서 멈춘다
    if (c.lane === 'cross' && mainInXing) {
      const toXing = (RD.mainZ - c.s) * c.dir;         // 교차점까지 남은 거리
      if (toXing > 0 && toXing < 0.16) target = 0;
    }
    // 급출발·급정거로 보이지 않게 부드럽게 따라간다
    c.speed += (target - c.speed) * Math.min(1, dt * 4);

    c.s += c.dir * c.speed * dt;

    // 부드러운 감속만으로는 겹침을 100% 막지 못한다(프레임이 길거나 앞차가 급정거하면
    // 파고든다). 최소 간격을 넘으면 위치 자체를 되돌려 물리적으로 막는다.
    if (leader) {
      const d = (leader.s - c.s) * c.dir;
      if (d < CAR_MIN_GAP) {
        c.s = leader.s - c.dir * CAR_MIN_GAP;
        c.speed = Math.min(c.speed, leader.speed);
      }
    }

    const R = FPWorld.ROADS[c.lane];
    // 도로 끝을 지나면 반대편에서 새로 태어난다
    if ((c.dir > 0 && c.s > R.to + RD.carHalfLen) || (c.dir < 0 && c.s < R.from - RD.carHalfLen)) {
      FPWorld.respawnCar(c, cars);
    }
    FPWorld.placeCar(c);
    // 바퀴는 실제 이동 거리에 맞춰 굴린다 (미끄러지는 것처럼 보이지 않게)
    if (c.wheels) {
      const spin = c.speed * dt / c.wheelR;
      for (const w of c.wheels) w.rotation.y += spin;
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
      car.tailPos.x - L * 0.05 + Math.sin(i * 3.7 + L * 6) * 0.006 * L,
      car.tailPos.y + L * L * 0.05,
      car.tailPos.z + Math.cos(i * 2.3 + L * 5) * 0.008 * L);
  }
  pos.needsUpdate = true;
}
