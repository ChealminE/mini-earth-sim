// ================= 3D 씬 기본 =================
const glContainer = document.getElementById('gl-container');
const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// 3D 바탕색: 탭마다 다르다. 현재 실태·미래 예측은 종이색(css/theme.css --paper), 직접 실험 탭은 예전 그대로
// 검정(렌더러 기본값)을 넘긴다 - 직접 실험 탭은 동료가 테마를 옮길 때까지 바꾸지 않는다.
const LIVE_BACKDROP = 0x000000;
function setSceneBackdrop(hex) { renderer.setClearColor(hex, 1); }

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
// 화각은 세로 기준 38°다. 3D 칸이 세로로 길면 같은 세로 화각에서 모형 양옆이 잘린다.
// setCameraFit(a)를 부른 화면(현재 실태·미래 예측)에서만, 칸의 종횡비가 a보다 좁을 때 세로 화각을 넓혀
// 가로로 보이는 폭을 종횡비 a일 때와 같게 둔다. 부르지 않은 화면(직접 실험 탭·시작 화면)은 예전과 똑같다.
// 거꾸로 칸이 넓고 낮으면(3차 B1의 좌측 위 3D 칸, 약 3.5:1) 세로 38°로는 받침대 아래가 잘린다. 그래서 세로 화각의
// 최솟값(minFov)도 함께 받는다. 장면 크기·배치·카메라 거리는 그대로 두고 화각만 넓힌다.
const CAM_FOV = 38;
let camFitAspect = null, camMinFov = CAM_FOV;
function fovForAspect(a) {
  let fov = CAM_FOV;
  if (camFitAspect && a < camFitAspect) {
    const halfW = Math.tan(THREE.MathUtils.degToRad(CAM_FOV / 2)) * camFitAspect;
    fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfW / a));
  }
  return Math.max(fov, camMinFov);
}
function setCameraFit(a, minFov = CAM_FOV) { camFitAspect = a; camMinFov = minFov; }
function fitRenderer() {
  const w = glContainer.clientWidth, h = glContainer.clientHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.fov = fovForAspect(camera.aspect);
  camera.updateProjectionMatrix();
}

let camAngleY = -0.5, camAngleX = 0.5, camDist = 8.2;
// 바라보는 점. 평소에는 모형 가운데(0, 0.3, 0) 그대로이고, 탐구 모드의 focus3D만 옮긴다(js/inquiry.js).
// 카메라 높이 기준(0.55)도 바라보는 점과 함께 움직여, 기본값에서는 예전과 똑같은 위치가 나온다.
const camTarget = new THREE.Vector3(0, 0.3, 0);
let isDragging = false, prevX = 0, prevY = 0;
function updateCamera() {
  camera.position.x = camTarget.x + camDist * Math.sin(camAngleY) * Math.cos(camAngleX);
  camera.position.z = camTarget.z + camDist * Math.cos(camAngleY) * Math.cos(camAngleX);
  camera.position.y = camTarget.y + 0.25 + camDist * Math.sin(camAngleX);
  camera.lookAt(camTarget);
}
// 카메라 시점 읽기·옮기기 (탐구 모드). animate면 0.9초 동안 부드럽게, 움직임 줄이기 설정이면 바로.
// 렌더 루프와 따로 도는 rAF 하나로 보간만 한다 - 끄는 중에 사용자가 끌면 끌기가 이긴다.
function getCameraView() {
  return { angleY: camAngleY, angleX: camAngleX, dist: camDist, target: camTarget.toArray() };
}
let camTween = 0;
function setCameraView(v, animate = true) {
  cancelAnimationFrame(camTween);
  const from = getCameraView();
  const apply = k => {
    camAngleY = from.angleY + (v.angleY - from.angleY) * k;
    camAngleX = from.angleX + (v.angleX - from.angleX) * k;
    camDist = from.dist + (v.dist - from.dist) * k;
    camTarget.fromArray(from.target.map((x, i) => x + (v.target[i] - x) * k));
    updateCamera();
  };
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(1); return; }
  const t0 = performance.now(), MS = 900;
  const step = now => {
    if (isDragging) return;
    const k = Math.min(1, (now - t0) / MS);
    apply(1 - (1 - k) ** 3);
    if (k < 1) camTween = requestAnimationFrame(step);
  };
  camTween = requestAnimationFrame(step);
}
glCanvas.addEventListener('pointerdown', e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
window.addEventListener('pointerup', () => isDragging = false);
window.addEventListener('pointermove', e => {
  if (!isDragging) return;
  camAngleY -= (e.clientX - prevX) * 0.006;
  camAngleX = Math.max(0.12, Math.min(1.15, camAngleX + (e.clientY - prevY) * 0.005));
  prevX = e.clientX; prevY = e.clientY;
  updateCamera();
});
glCanvas.addEventListener('wheel', e => {
  camDist = Math.max(5, Math.min(16, camDist + e.deltaY * 0.01));
  updateCamera();
});
updateCamera();

// ================= 환경맵 (물/빙하 등 물리 재질의 반사·투과 품질 개선) =================
// 외부 HDRI 파일 없이, RoomEnvironment 예제와 비슷한 절차적 "방" 장면을 만들어
// PMREMGenerator로 구워낸 환경맵을 공유 사용한다. (r160 코어에 PMREMGenerator 포함,
// 별도 ES 모듈 임포트 불필요 - 지금 프로젝트가 전역 <script> 구조를 유지하는 이유와 동일)
function buildEnvironmentTexture() {
  const envScene = new THREE.Scene();
  const boxGeo = new THREE.BoxGeometry();
  boxGeo.deleteAttribute('uv');

  const room = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ side: THREE.BackSide }));
  room.scale.set(12, 12, 12);
  envScene.add(room);

  // 위쪽 하늘빛 패널 (은은한 하늘색)
  const sky = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0xbfe0ff, emissiveIntensity: 2.2 }));
  sky.position.set(0, 6, 0);
  sky.scale.set(6, 0.1, 6);
  envScene.add(sky);

  // 따뜻한 보조광 패널 (스포트라이트 색과 맞춰 반사에 온기 부여)
  const warm = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xfff2d6, emissive: 0xfff2d6, emissiveIntensity: 1.6 }));
  warm.position.set(4, 1.5, 3);
  warm.scale.set(0.1, 3, 3);
  envScene.add(warm);

  // 차가운 반대편 보조광 패널 (해양 쪽 반사에 쓰일 푸른 기)
  const cool = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x8fb8d9, emissive: 0x8fb8d9, emissiveIntensity: 1.2 }));
  cool.position.set(-4, 1.5, -3);
  cool.scale.set(0.1, 3, 3);
  envScene.add(cool);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const renderTarget = pmremGenerator.fromScene(envScene, 0.035);
  pmremGenerator.dispose();
  return renderTarget.texture;
}
const sharedEnvMap = buildEnvironmentTexture();

// ================= AI 생성 텍스처 (texture_image/) - 3개 씬이 공유해서 한 번만 로드 =================
const textureLoader = new THREE.TextureLoader();
function loadColorTexture(path, repeatX, repeatY) {
  const tex = textureLoader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace; // 색상(알베도) 맵만 sRGB, 노멀맵은 linear라 적용 안 함
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}
const sharedTex = {
  oceanFloor: loadColorTexture('texture_image/ocean_floor.jpg', 3, 2),
  wetlandSoil: loadColorTexture('texture_image/wetland_soil.jpg', 2, 2),
  forestGrass: loadColorTexture('texture_image/forest_grass.jpg', 3, 2),
  cityPavement: loadColorTexture('texture_image/city_pavement.jpg', 3, 2),
  iceCrack: loadColorTexture('texture_image/ice_crack.jpg', 1, 1),
  treeBark: loadColorTexture('texture_image/tree_bark.jpg', 1, 2),
  buildingFacade: loadColorTexture('texture_image/building_facade.jpg', 2, 3),
  cityRoad: loadColorTexture('texture_image/city_road.jpg', 1, 1), // 실제 repeat는 도로 길이별로 clone해서 따로 지정
};
const waterNormalTex = textureLoader.load('texture_image/water_normal.png');
waterNormalTex.wrapS = waterNormalTex.wrapT = THREE.RepeatWrapping;
waterNormalTex.repeat.set(4, 3);

// ================= 파도 높이 계산 (3개 씬이 공유하는 순수 함수) =================
// ly는 waveMesh 로컬 좌표(-90도 회전 전 y) 기준, 월드로는 z=-ly. frontT=1이 되는 지점을
// 카메라가 보는 앞면(월드 z 양수) 쪽에 오도록 -ly 기준으로 잡아야 정면에서도 파도가 보임
// (이전엔 부호가 반대라 반대편 뒷벽에서만 크게 부서졌음).
const WAVE_SWELL_BASE = 0.03, WAVE_SWELL_FRONT = 0.05, WAVE_SWELL_INTENSITY = 0.015;
const WAVE_CHOP_AMP = 0.007;
// 합계 최댓값(frontT=1, intensity=1일 때) - 이 값을 넘지 않는다는 걸 보장해서
// 녹지/도시 지표면(GROUND_BASE)보다 파도 정점이 항상 낮게 남도록 waveBaseY와 맞춰둠
const WAVE_MAX_AMPLITUDE = WAVE_SWELL_BASE + WAVE_SWELL_FRONT + WAVE_SWELL_INTENSITY + WAVE_CHOP_AMP;
// animate()가 매 프레임 waterBody 높이를 이 값만큼 여유를 두고 동기화한다 (3개 씬 공유값이라 모듈 스코프)
const WATER_SYNC_BUFFER = 0.04;
function waveHeightAt(lx, ly, t, intensity, halfD) {
  const frontT = Math.max(0, Math.min(1, (-ly / halfD + 1) / 2));
  const swell = Math.sin(lx * 1.5 + t * 0.7) * (WAVE_SWELL_BASE + frontT * WAVE_SWELL_FRONT + intensity * WAVE_SWELL_INTENSITY);
  const chop = Math.sin(lx * 6 + t * 2.1 + ly * 3) * WAVE_CHOP_AMP * frontT;
  return swell + chop;
}

// 둥근 점 스프라이트 (CO₂ 보기 점 구름이 공유) - 처음 쓸 때 한 번만 만든다
let _dotSprite = null;
function dotSprite() {
  if (_dotSprite) return _dotSprite;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  _dotSprite = new THREE.CanvasTexture(c);
  return _dotSprite;
}

// 같은 시드면 같은 배치 - 도시 배치가 새로 고칠 때마다 바뀌면 연도·시나리오 비교 스크린샷을 맞출 수 없다
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 여러 지오메트리를 하나로 합친다(위치·법선만). 자동차처럼 부품이 여러 개인 모형을 InstancedMesh 하나로 그리려고
// 쓴다 - three.js 코어(r160)에는 BufferGeometryUtils.mergeGeometries가 없다(예제 모듈이라 전역 스크립트 구조에서 못 씀).
// 모든 부품에 uv가 있으면 uv도 합친다(조개 껍데기의 구멍 무늬 alphaMap에 필요).
function mergeGeos(parts) {
  const pos = [], nor = [], uv = [];
  const withUv = parts.every(([g]) => g.attributes.uv);
  for (const [g, m] of parts) {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (m) ng.applyMatrix4(m);
    if (!ng.attributes.normal) ng.computeVertexNormals();
    pos.push(...ng.attributes.position.array);
    nor.push(...ng.attributes.normal.array);
    if (withUv) uv.push(...ng.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (withUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

// 도시 구역(로컬 x −1~1, z −1.5~1.5)에 마을집·건물·굴뚝·연기·자동차를 인스턴싱으로 짓는다.
// 크기·개수는 applyState가 S.state.city(EarthVisual: 누적 배출 → 건물, 그해 배출 → 굴뚝)로 정한다.
// 드로우콜: 집 2 + 건물 1 + 공장 1 + 굴뚝 1 + 연기 1 + 자동차 3 = 9 (그림자 패스 별도), 개수와 상관없이 일정.
const CITY_ROAD = { mainZ: -0.01, crossX: 0.09, half: 0.1 };   // 도로 자리 (위 MAIN_ROAD_Z·CROSS_ROAD_X와 같은 값)
function buildCityGrowth(group, base, stackTex) {
  const rnd = seededRandom(1750);
  const onRoad = (x, z, pad = 0) => Math.abs(z - CITY_ROAD.mainZ) < CITY_ROAD.half + pad || Math.abs(x - CITY_ROAD.crossX) < CITY_ROAD.half + pad;
  // 다른 소품 자리 (공장 지대·포집 타워·냉각탑·태양광 패널 칸)는 비운다
  const RESERVED = [[0.62, 0.5, 0.26], [-0.65, 0.15, 0.13], [0.76, 1.1, 0.3]];
  const reserved = (x, z, r) => RESERVED.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + r) || (z > 0.76 && x < 0.47);
  const d = new THREE.Object3D();

  // 1) 마을집 6채 - 1750년에도 있는 옛 마을. 교차로 가까이, 지붕은 사각뿔
  const HOUSES = [[-0.12, -0.2], [0.3, -0.18], [-0.1, 0.2], [0.3, 0.22], [-0.3, -0.24], [0.48, 0.17]];
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3b22, roughness: 0.8 });
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.05, 0.06), wallMat, HOUSES.length);
  const roofGeo = new THREE.ConeGeometry(0.06, 0.04, 4); roofGeo.rotateY(Math.PI / 4);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, HOUSES.length);
  HOUSES.forEach(([x, z], i) => {
    d.position.set(x, base + 0.025, z); d.rotation.set(0, (i % 2) * 0.3, 0); d.scale.set(1, 1, 1); d.updateMatrix();
    walls.setMatrixAt(i, d.matrix);
    d.position.y = base + 0.07; d.updateMatrix();
    roofs.setMatrixAt(i, d.matrix);
  });
  walls.castShadow = roofs.castShadow = true;
  group.add(walls, roofs);

  // 2) 건물 자리: 도로·소품·마을집을 피해 격자로 뽑고, 교차로(옛 마을)에서 가까운 순서로 나타나게 정렬한다.
  //    → 도시가 마을에서 바깥으로 퍼져 나간다. 가운데일수록 최대 높이가 높다(도심).
  const slots = [];
  for (let gx = -0.86; gx <= 0.87; gx += 0.145) {
    for (let gz = -1.36; gz <= 0.72; gz += 0.15) {
      const x = gx + (rnd() - 0.5) * 0.03, z = gz + (rnd() - 0.5) * 0.03;
      if (onRoad(x, z, 0.03) || reserved(x, z, 0.07)) continue;
      if (HOUSES.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 0.11)) continue;
      const dist = Math.hypot(x - CITY_ROAD.crossX, (z - CITY_ROAD.mainZ) * 0.8);
      slots.push({ x, z, dist: dist + rnd() * 0.15, w: 0.08 + rnd() * 0.05 });
    }
  }
  slots.sort((a, b) => a.dist - b.dist);
  slots.forEach((sl, i) => { sl.hMax = (0.52 - 0.32 * i / slots.length) * (0.75 + rnd() * 0.5); });
  const facade = sharedTex.buildingFacade.clone(); facade.needsUpdate = true; facade.repeat.set(1, 4);
  const bldMat = new THREE.MeshStandardMaterial({ map: facade, color: 0xffffff, roughness: 0.5, metalness: 0.15 });
  const bldGeo = new THREE.BoxGeometry(1, 1, 1); bldGeo.translate(0, 0.5, 0);   // 바닥 기준으로 늘리게
  const buildings = new THREE.InstancedMesh(bldGeo, bldMat, slots.length);
  const BLD_COLORS = [0x9aa0a8, 0x848a92, 0xb0b5bb, 0x7a8088, 0xa39a8e];
  const col = new THREE.Color();
  slots.forEach((sl, i) => buildings.setColorAt(i, col.setHex(BLD_COLORS[i % BLD_COLORS.length])));
  buildings.count = 0;
  buildings.castShadow = buildings.receiveShadow = true;
  group.add(buildings);

  // 3) 공장 지대: 굴뚝 6자리(공장 건물 + 원기둥 굴뚝). 그해 배출에 따라 앞에서부터 켠다
  const STACKS = [[0.55, 0.42], [0.7, 0.4], [0.62, 0.56], [0.78, 0.55], [0.5, 0.6], [0.72, 0.7]];
  const hallMat = new THREE.MeshStandardMaterial({ color: 0x7d6f60, roughness: 0.85 });
  const halls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), hallMat, STACKS.length);
  const stackGeo = new THREE.CylinderGeometry(0.018, 0.025, 0.28, 10); stackGeo.translate(0, 0.14, 0);
  const stacks = new THREE.InstancedMesh(stackGeo, new THREE.MeshStandardMaterial({ map: stackTex, color: 0x5c5852, roughness: 0.85 }), STACKS.length);
  STACKS.forEach(([x, z], i) => {
    d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1);
    d.position.set(x - 0.03, base + 0.03, z); d.updateMatrix(); halls.setMatrixAt(i, d.matrix);
    d.position.set(x + 0.025, base, z); d.updateMatrix(); stacks.setMatrixAt(i, d.matrix);
  });
  halls.count = stacks.count = 0;
  halls.castShadow = stacks.castShadow = true;
  group.add(halls, stacks);
  // 연기: 굴뚝마다 SMOKE_PER개. 입자 j는 굴뚝 floor(j / SMOKE_PER)의 것 → 켜진 굴뚝 수 × SMOKE_PER 만 그린다
  const SMOKE_PER = 28;
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STACKS.length * SMOKE_PER * 3), 3));
  smokeGeo.setDrawRange(0, 0);
  const smokeLife = Float32Array.from({ length: STACKS.length * SMOKE_PER }, () => rnd());
  const smokeMat = new THREE.PointsMaterial({ color: 0x8c8a85, size: 0.06, map: dotSprite(), transparent: true, opacity: 0.5, depthWrite: false });
  const smokePts = new THREE.Points(smokeGeo, smokeMat);
  smokePts.frustumCulled = false;
  group.add(smokePts);

  // 4) 자동차: 차체(몸통·캐빈·펜더)·바퀴·유리를 각각 하나로 합쳐 InstancedMesh 3개. 색은 인스턴스 색(휘발유 회색 / 전기차 청록)
  const bodyGeo = mergeGeos([
    [new THREE.BoxGeometry(0.09, 0.028, 0.045), mat4(0, 0.036, 0)],
    [new THREE.BoxGeometry(0.05, 0.022, 0.038), mat4(-0.006, 0.061, 0)],
    ...[[-0.03, 0.024], [0.03, 0.024], [-0.03, -0.024], [0.03, -0.024]].map(([x, z]) => [new THREE.BoxGeometry(0.024, 0.01, 0.006), mat4(x, 0.022, z)]),
  ]);
  const wheelGeo = mergeGeos([[-0.03, 0.024], [0.03, 0.024], [-0.03, -0.024], [0.03, -0.024]]
    .map(([x, z]) => [new THREE.CylinderGeometry(0.011, 0.011, 0.008, 10), mat4(x, 0.011, z, Math.PI / 2)]));
  const glassGeo = mergeGeos([[new THREE.PlaneGeometry(0.03, 0.034), mat4(0.021, 0.061, 0, 0, Math.PI / 2, 0)]]);
  // 자리: 큰길 두 차로 + 세로길 두 차로, 교차로(가운데 0.16)는 비움
  const CAR_SLOTS = [];
  for (let x = -0.85; x <= 0.9; x += 0.12) if (Math.abs(x - CITY_ROAD.crossX) > 0.16) {
    CAR_SLOTS.push([x, CITY_ROAD.mainZ + 0.03, 0], [x + 0.06, CITY_ROAD.mainZ - 0.03, Math.PI]);
  }
  for (let z = -1.35; z <= 0.75; z += 0.14) if (Math.abs(z - CITY_ROAD.mainZ) > 0.16) {
    CAR_SLOTS.push([CITY_ROAD.crossX - 0.03, z, Math.PI / 2], [CITY_ROAD.crossX + 0.03, z + 0.07, -Math.PI / 2]);
  }
  for (let i = CAR_SLOTS.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [CAR_SLOTS[i], CAR_SLOTS[j]] = [CAR_SLOTS[j], CAR_SLOTS[i]]; }
  const NC = Math.min(28, CAR_SLOTS.length);
  const carBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 }), NC);
  const carWheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.8 }), NC);
  const carGlass = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0x9fd0e8, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide }), NC);
  for (let i = 0; i < NC; i++) {
    const [x, z, ry] = CAR_SLOTS[i];
    d.position.set(x, base + 0.003, z); d.rotation.set(0, ry, 0); d.scale.set(1, 1, 1); d.updateMatrix();
    carBody.setMatrixAt(i, d.matrix); carWheels.setMatrixAt(i, d.matrix); carGlass.setMatrixAt(i, d.matrix);
    carBody.setColorAt(i, col.setHex(0x5a5650));
  }
  carBody.count = carWheels.count = carGlass.count = 0;
  carBody.castShadow = true;
  group.add(carBody, carWheels, carGlass);

  return { slots, buildings, STACKS, halls, stacks, smokeGeo, smokeLife, smokeMat, smokePts, SMOKE_PER, carBody, carWheels, carGlass, NC,
           last: { level: -1, stacks: -1, cars: -1, ev: -1 } };
}

// 종이 탭의 구름 (2차 F5): 예전 얼음 덩어리 구름은 빙하와 재질이 거의 같아 구름으로 읽히지 않았다.
// 둥근 구 여러 개를 겹친 뭉게구름 몇 덩이를 InstancedMesh 하나(드로우콜 1)로 그리고, x로 천천히 흐르게 한다.
// 변수와 묶이지 않은 장식이라 3D 범례에 넣지 않는다. 그림자는 끈다(움직이는 어두운 얼룩이 연기·오염으로 보일 수 있다).
const CLOUD_PUFFS = [   // 덩이 하나의 구: [dx, dy, dz, r]. 가운데 큰 구 + 양옆·위 작은 구, 아래는 y를 눌러 납작하게
  [0, 0, 0, 0.15], [0.15, -0.025, 0.02, 0.105], [-0.15, -0.025, -0.01, 0.11],
  [0.06, 0.07, -0.02, 0.1], [-0.07, 0.055, 0.03, 0.09], [0.24, -0.04, -0.01, 0.07], [-0.25, -0.04, 0.02, 0.065],
];
function buildClouds(box, boxW, boxH) {
  const rnd = seededRandom(2410);
  const clumps = [[-2.0, -0.55], [-0.45, 0.35], [1.0, -0.75], [2.2, 0.1]].map(([x, z], i) => ({
    x0: x, z, y: boxH - 0.26 - rnd() * 0.06,
    speed: 0.03 + rnd() * 0.03,             // 0.03~0.06 /초 (t 단위), 덩이마다 조금씩 다르게
    size: 1.1 + rnd() * 0.4,
    puffs: CLOUD_PUFFS.slice(0, 5 + (i % 3)),   // 덩이마다 구 5~7개
  }));
  const n = clumps.reduce((a, c) => a + c.puffs.length, 0);
  // 흰색이 ACES 톤매핑에서 회색으로 눌리므로 emissive 를 조금 준다(마스터 §6-3: 틴트로는 밝아지지 않는다).
  // 빙하(0xe6f2f8, 푸른 기)보다 더 희고 부드럽게: 채도 0, 거칠기 1, 텍스처·투과 없음.
  // 불투명으로 둔다: 뚜껑(lidMat)은 transmission 재질이라 불투명 물체만 담은 화면을 비춰 보이고 깊이도 쓴다.
  // transparent 로 두면 위에서 내려다볼 때 뚜껑 뒤에서 깊이 검사에 걸려 구름이 통째로 사라졌다(실측).
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.32,
    envMapIntensity: 0.4 });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), mat, n);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;   // 인스턴스가 흘러다녀 기본 경계구가 맞지 않는다
  box.add(mesh);
  // 감아 돌기: 벽 안쪽 ±xMax 사이를 흐르고, 벽에서 fade 거리 안이면 크기를 줄여 사라졌다 반대쪽에서 커지며 나타난다
  return { mesh, clumps, xMax: boxW / 2 - 0.12, fade: 0.55, d: new THREE.Object3D() };
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function stepClouds(C) {
  const span = 2 * C.xMax, still = reducedMotion.matches;
  let k = 0;
  for (const c of C.clumps) {
    const x = still ? c.x0 : ((c.x0 + c.speed * t + C.xMax) % span + span) % span - C.xMax;
    const edge = Math.min(1, Math.max(0, (C.xMax - Math.abs(x)) / C.fade));
    const s = c.size * edge * edge * (3 - 2 * edge);   // smoothstep: 벽 쪽에서 부드럽게 줄어든다
    for (const [dx, dy, dz, r] of c.puffs) {
      C.d.position.set(x + dx * s, c.y + dy * s, c.z + dz * s);
      C.d.scale.set(r * s, r * s * 0.72, r * s);
      C.d.updateMatrix();
      C.mesh.setMatrixAt(k++, C.d.matrix);
    }
  }
  C.mesh.instanceMatrix.needsUpdate = true;
}

// 받침대 연산 효과 (2차 F6, 미래 예측 씬만): "미래는 관측이 아니라 지금 계산 중"이라는 느낌을 지구와 무관한 회전판에서 보인다.
// 회전판 윗면 바로 위에 원판 하나(드로우콜 1)를 깔고, 셰이더가 극좌표를 칸으로 나눠 각도 칸마다 한 줄기씩
// 숫자가 바깥에서 상자 쪽으로 흘러들게 그린다(머리 글자 진하게, 꼬리 옅게, 글자는 일정 간격으로 바뀜).
// 상자 바닥이 가운데를 덮으므로 실제로 보이는 건 상자 둘레의 띠다. 글자 모양은 처음 한 번 캔버스로 만든 아틀라스 텍스처.
const PFX_GLYPHS = '0123456789.+\u2212';   // 숫자 0~9, 소수점, +, −
let pfxAtlas = null;
function predictFxAtlas() {
  if (pfxAtlas) return pfxAtlas;
  const cw = 32, ch = 48, c = document.createElement('canvas');
  c.width = cw * 16; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 38px ui-monospace, Menlo, Consolas, monospace';
  [...PFX_GLYPHS].forEach((ch_, i) => g.fillText(ch_, cw * i + cw / 2, ch / 2 + 2));
  pfxAtlas = new THREE.CanvasTexture(c);
  pfxAtlas.generateMipmaps = false;
  pfxAtlas.minFilter = THREE.LinearFilter;
  return pfxAtlas;
}
function buildPredictFx(scene) {
  const col = new THREE.Color(Theme.color('--ctl-time') || '#1c4fbf');   // 시간 영역색(파랑). 매트릭스 녹색은 쓰지 않는다
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uStill: { value: 0 }, uColor: { value: col }, uAtlas: { value: predictFxAtlas() },
      uR: { value: 3.6 }, uGlyphs: { value: PFX_GLYPHS.length } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime, uFade, uStill, uR, uGlyphs;
      uniform vec3 uColor;
      uniform sampler2D uAtlas;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * uR;              // 원판 위 좌표 (회전판 반지름 단위)
        float r = length(p);
        float cols = 112.0, cellH = 0.17;             // 각도 칸 112줄기, 반지름 방향 글자 높이
        float a = atan(p.y, p.x) / 6.2831853 + 0.5;
        float col = floor(a * cols), rowF = (uR - r) / cellH, row = floor(rowF);
        float h1 = hash(vec2(col, 1.7)), h2 = hash(vec2(col, 9.3));
        float len = 22.0, tail = 7.0 + 6.0 * h2;       // 한 바퀴 길이(칸), 꼬리 길이
        float head = mod(uTime * (2.2 + 3.0 * h1) + h1 * len, len);   // 머리가 바깥(row 0)에서 안쪽으로 내려간다
        float d = head - row;
        if (d < 0.0) d += len;
        float k = (d < tail) ? 1.0 - d / tail : 0.0;
        if (uStill > 0.5) k = step(0.62, hash(vec2(col, row))) * 0.45;   // 움직임 줄이기: 옅은 정지 무늬
        float gi = floor(mod(hash(vec2(col, row)) * uGlyphs + floor(uTime * (1.5 + h2 * 2.0) * (1.0 - uStill)), uGlyphs));
        vec2 l = vec2(fract(a * cols), fract(rowF));
        l = (l - 0.5) * vec2(1.25, 1.1) + 0.5;        // 칸 안에 여백
        float g = 0.0;
        if (l.x > 0.0 && l.x < 1.0 && l.y > 0.0 && l.y < 1.0) g = texture2D(uAtlas, vec2((gi + l.x) / 16.0, l.y)).a;
        float edge = smoothstep(uR, uR - 0.18, r);      // 판 가장자리에서 잘리지 않게
        float alpha = g * (0.18 + 0.62 * k * k) * step(0.001, k) * edge * uFade;
        vec3 c = mix(uColor, vec3(1.0), 0.35 * step(d, 0.9));   // 머리 글자는 조금 밝게
        gl_FragColor = vec4(c, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(3.6, 96), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.003;      // 회전판 윗면(y ≈ −0.005) 바로 위
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, mat, fade: 0 };
}
// 켜고 끄기: tab-future.js updatePredState 가 부른다. 아직 만들지 않은 씬(dormant)도 값을 들고 있다가 만들 때 이어받는다.
function setPredictFx(S, on) { if (S) S.predictOn = !!on; }
function stepPredictFx(P, on) {
  P.fade = Math.min(1, Math.max(0, P.fade + (on ? 1 : -1) * 0.016 / 0.4));   // 0.4초에 걸쳐 0 ↔ 1 (t와 같은 한 프레임 0.016)
  P.mesh.visible = P.fade > 0;            // 꺼져 있으면 드로우콜 0
  if (!P.mesh.visible) return;
  P.mat.uniforms.uFade.value = P.fade;
  P.mat.uniforms.uTime.value = t;
  P.mat.uniforms.uStill.value = reducedMotion.matches ? 1 : 0;
}

// 자연 지구의 도시 구역 자리: 나무(줄기·잎 덩어리)·풀을 인스턴싱으로. 드로우콜 3번(그림자 별도)
function buildWilderness(group, groundY) {
  const rnd = seededRandom(1492), d = new THREE.Object3D();
  const spots = [];
  for (let i = 0; i < 400 && spots.length < 34; i++) {
    const x = -0.88 + rnd() * 1.76, z = -1.36 + rnd() * 2.72;
    if (!spots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 0.16)) spots.push([x, z]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.012, 0.018, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const crownGeo = mergeGeos([[0, 0, 0, 0.06], [0.035, -0.02, 0.01, 0.045], [-0.03, -0.015, -0.02, 0.045], [0.005, 0.035, -0.01, 0.04]]
    .map(([x, y, z, r]) => [new THREE.IcosahedronGeometry(r, 1), mat4(x, y, z)]));
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ map: sharedTex.treeBark, roughness: 0.9 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), spots.length);
  const greens = [0x3f7433, 0x4d8a3a, 0x356629, 0x5a9440].map(h => new THREE.Color(h));
  spots.forEach(([x, z], i) => {
    const h = 0.12 + rnd() * 0.14, s = 0.9 + rnd() * 0.7, y = groundY(x, z);
    d.position.set(x, y, z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(1, h, 1); d.updateMatrix();
    trunks.setMatrixAt(i, d.matrix);
    d.position.y = y + h; d.scale.set(s, s, s); d.updateMatrix();
    crowns.setMatrixAt(i, d.matrix);
    crowns.setColorAt(i, greens[i % greens.length]);
  });
  trunks.castShadow = crowns.castShadow = true;
  const GRASS_N = 260;
  const grassGeo = new THREE.ConeGeometry(0.006, 0.045, 5); grassGeo.translate(0, 0.0225, 0);
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshStandardMaterial({ color: 0x5a9c4a, roughness: 0.85 }), GRASS_N);
  for (let i = 0; i < GRASS_N; i++) {
    const x = -0.9 + rnd() * 1.8, z = -1.4 + rnd() * 2.8, gs = 0.7 + rnd() * 0.8;
    d.position.set(x, groundY(x, z), z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(gs, gs, gs); d.updateMatrix();
    grass.setMatrixAt(i, d.matrix);
  }
  group.add(trunks, crowns, grass);
}

// 도시 상태 반영 (applyState에서, 0.2초 틱). 바뀐 것만 다시 쓴다 - 행렬 수십 개라 가볍지만 매 틱 쓸 이유도 없다.
//   c = S.state.city = { level 0~1 (누적 배출), stacks 굴뚝 수, stackLevel 0~1 (그해 배출), cars 0~1, ev 0~1 }
const _cityDummy = new THREE.Object3D();
const CAR_GAS = new THREE.Color(0x5a5650), CAR_EV = new THREE.Color(0x2f9e8f);
function applyCity(S, c) {
  const C = S.city;
  if (!C || !c) return;
  const base = S.CITY_BASE, L = c.level, n = C.slots.length;
  if (Math.abs(L - C.last.level) > 1e-4) {
    // 건물 i는 도시 규모가 (i+1)/n을 넘으면 나타나고, 그 뒤 규모가 0.25 더 커질 때까지 자란다.
    // 높이는 도시 전체 규모에도 곱한다 - 일찍 선 건물이 1950년에 벌써 마천루가 되지 않게
    let shown = 0;
    C.slots.forEach((sl, i) => {
      const g = (L - (i + 1) / n) / 0.25;
      if (g <= 0) return;
      const h = sl.hMax * (0.25 + 0.75 * Math.min(1, g)) * (0.4 + 0.6 * L);
      _cityDummy.position.set(sl.x, base, sl.z); _cityDummy.rotation.set(0, 0, 0); _cityDummy.scale.set(sl.w, h, sl.w * 0.9);
      _cityDummy.updateMatrix();
      C.buildings.setMatrixAt(i, _cityDummy.matrix);
      shown = i + 1;
    });
    C.buildings.count = shown;
    C.buildings.instanceMatrix.needsUpdate = true;
    C.last.level = L;
  }
  if (c.stacks !== C.last.stacks) {
    C.halls.count = C.stacks.count = c.stacks;
    C.smokeGeo.setDrawRange(0, c.stacks * C.SMOKE_PER);
    C.last.stacks = c.stacks;
  }
  // 연기는 그해 배출이 클수록 짙고 굵게
  C.smokeMat.opacity = 0.25 + 0.5 * c.stackLevel;
  C.smokeMat.size = 0.04 + 0.05 * c.stackLevel;
  const nCar = Math.round(c.cars * C.NC), nEv = Math.round(nCar * c.ev);
  if (nCar !== C.last.cars || nEv !== C.last.ev) {
    C.carBody.count = C.carWheels.count = C.carGlass.count = nCar;
    for (let i = 0; i < C.NC; i++) C.carBody.setColorAt(i, i < nEv ? CAR_EV : CAR_GAS);
    C.carBody.instanceColor.needsUpdate = true;
    C.last.cars = nCar; C.last.ev = nEv;
  }
}

// 엔진 표본 s(EarthSystem.run 원소, cumFossilMax 붙음) + 그해 사회 모습 soc → 종이 탭 씬의 3D 입력 (2차 개편 D)
// 현재 실태 탭(마지막 역사 연도)과 미래 예측 탭(재생 연도)이 같이 쓴다. soc = { ev, renew, nuclear, removal } (0~1)
function setEarthVisual(S, s, soc) {
  const st = S.state, fossil = s.fossil || 0;
  st.T = s.T;          // 기온 편차 → 빙하(연출)·산호(SR1.5)
  st.omega = s.omega;  // 아라고나이트 포화도 → 조개 껍데기 (D5)
  st.ph = s.pH;        // [지시약으로 보기] (D5)
  if (!soc) return;    // 자연 지구: 도시가 없다
  st.ev = 100 * soc.ev;
  st.renew = soc.renew;
  st.nuclear = soc.nuclear;
  st.carbonRemoval = 100 * soc.removal;
  const level = EarthVisual.cityLevel(s.cumFossilMax || 0);
  st.city = { level, stacks: EarthVisual.stackCount(fossil), stackLevel: EarthVisual.stackLevel(fossil),
              cars: EarthVisual.carFrac(level), ev: soc.ev };
}

// 종이 탭의 바다 (2차 개편 D4·D5). 바다 색은 자연색으로 고정한다 - pH에 따라 물색을 바꾸던 예전 표현은
// "산성화되면 바다 색이 변한다"는 오개념을 만든다. 기온 → 빙하·산호, Ω → 조개 껍데기, pH → [지시약으로 보기]에서만 색.
const SEA_BODY = new THREE.Color(0x1f6d8a), SEA_SURFACE = new THREE.Color(0x2f84a8);
const CORAL_BLEACHED = new THREE.Color(0xf4f1ea);
const SHELL_INTACT = new THREE.Color(0xd9822b), SHELL_PALE = new THREE.Color(0xf3ece0);
// 껍데기 구멍 무늬: 흰 바탕에 어두운 얼룩. alphaTest를 올릴수록 어두운 얼룩부터 투명해져 구멍이 커진다
let _holeTex = null;
function holeTexture() {
  if (_holeTex) return _holeTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), rnd = seededRandom(1983);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 40; i++) {
    const v = Math.floor(40 + rnd() * 150);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(rnd() * 64, rnd() * 64, 2 + rnd() * 6, 0, Math.PI * 2); g.fill();
  }
  _holeTex = new THREE.CanvasTexture(c);
  return _holeTex;
}
function applyOceanPaper(S) {
  const st = S.state;
  S.waterBody.material.color.copy(SEA_BODY);
  S.waterBody.material.opacity = 0.24;         // 바닥의 산호·조개가 비쳐 보이게 예전(0.82~0.98)보다 투명하게
  S.waterBody.material.roughness = 0.15;
  if (VIEW3D.indicator) {
    // [지시약으로 보기]: 수면만 pH 색으로 칠한다 (실제 바다 색이 아님, 범위 7.6~8.2 확대 - 범례 색 막대)
    // 물 몸통(waterBody)이 깊이를 쓰며 파도 면 대부분을 덮고 있어서 수면만 칠하면 앞쪽 띠만 물들었다 → 몸통 윗부분도 같은 색
    const [r, g, b] = EarthVisual.phIndicatorRgb(st.ph);
    S.waveMat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    S.waveMat.opacity = 0.9;
    S.waveMat.transmission = 0;
    S.waterBody.material.color.copy(S.waveMat.color);
    S.waterBody.material.opacity = 0.62;
  } else {
    S.waveMat.color.copy(SEA_SURFACE);
    S.waveMat.opacity = 0.36;
    S.waveMat.transmission = 0.15;
  }
  S.waveMat.roughness = 0.1;
  S.waveMat.clearcoat = 0.9;

  // 빙하 (연출): 모서리 기준으로 길이 ∝ glacierFrac. 떠 있는 얼음 조각도 같은 비율
  const f = EarthVisual.glacierFrac(st.T);
  S.glacier.visible = f > 0.02;
  S.glacier.scale.set(f, Math.sqrt(f), f);      // 높이는 덜 줄여 마지막까지 '빙하'로 읽히게
  S.iceMeshes.forEach(o => { o.mesh.scale.setScalar(Math.max(0.01, f)); o.mesh.visible = f > 0.02; o.shrinkY = -(1 - f) * 0.04; });

  // 조개 껍데기 (Ω): Ω > 1 동안 색만 조금씩 옅게(연출), Ω < 1이면 분필처럼 하얗게 바래며 구멍이 커진다(아라고나이트가 녹는 조건).
  // 반투명(transparent)으로 하면 깊이를 쓰는 바닷물 몸통(waterBody)에 가려 껍데기가 통째로 사라졌다 - 불투명 + alphaTest 구멍으로 한다.
  const sh = EarthVisual.shellState(st.omega), m = S.shells.mat;
  m.color.lerpColors(SHELL_INTACT, SHELL_PALE, Math.min(1, 0.7 * sh.fade + 0.3 * sh.dissolve));
  const dissolving = sh.dissolve > 0;
  if (dissolving !== S.shells.dissolving) { m.needsUpdate = true; S.shells.dissolving = dissolving; }   // alphaTest 0 ↔ 양수는 셰이더를 다시 만든다
  m.alphaTest = dissolving ? 0.25 + 0.6 * sh.dissolve : 0;

  // 산호 (IPCC SR1.5 B.4.2): 건강한 군락 수가 바뀔 때만 색을 다시 칠한다
  const C = S.coral, k = Math.round(EarthVisual.coralHealthy(st.T || 0) * C.colonies.length);
  if (k !== C.healthy) {
    C.colonies.forEach((c, i) => c.mesh.setColorAt(c.idx, i < k ? c.color : CORAL_BLEACHED));
    C.meshes.forEach(m => { m.instanceColor.needsUpdate = true; });
    C.healthy = k;
  }
}

// 3D 보기 토글 (2차 개편 D, 종이 탭 씬에만 적용). 탭·지구(인간활동/자연)를 바꿔도 같은 보기를 유지하도록 전역 하나로 둔다.
//   co2       : [CO₂ 보기] 공기 중 점 구름
//   indicator : [지시약으로 보기] 바다 표면에 pH 색 (D5)
const VIEW3D = { co2: false, indicator: false };

// ================= 아크릴 모형: 탭마다 독립적인 씬을 만드는 팩토리 함수 =================
// opts.paper: 종이(라이트) 테마 탭(현재 실태·미래 예측)의 씬. 2차 개편 D의 3D 시각 언어(밝은 바탕 맞춤,
//   CO₂ 보기, 도시 성장, 산호·조개 등)는 이 씬에서만 켠다 - 직접 실험 탭은 같은 함수를 쓰지만 예전 모습 그대로 둔다.
// opts.nature: 미래 예측 탭의 '자연만 있는 지구' 씬 (도시 구역 대신 자연 식생, D6)
function buildAcrylicScene(opts = {}) {
const PAPER = !!opts.paper;
const scene = new THREE.Scene();
scene.environment = sharedEnvMap;
// r160부터 물리기반(광도 단위) 조명만 지원해서 SpotLight 밝기 스케일이 달라짐(약 4π배 보정 필요)
const sun = new THREE.SpotLight(0xfff6e0, 3.2 * 4 * Math.PI, 20, Math.PI / 5, 0.35, 1.2);
sun.position.set(3.4, 3.6, 2.2);
sun.target.position.set(0.6, 0.3, 0.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0015;
scene.add(sun, sun.target);
// 텍스처(특히 도시 바닥·건물 창문 패턴)의 명암 대비가 너무 밝아 안 보였어서
// 색공간 보정용으로 올렸던 값을 다시 낮춤 - 실내가 살짝 어두워 보이는 것보다
// 텍스처가 실제로 보이는 쪽이 우선
// 종이 바탕(D1): 바탕이 이미 밝아 모형이 바탕에 묻혔다. 환경광을 줄이고 키라이트 그림자로 입체감을 살린다.
scene.add(new THREE.AmbientLight(0xffffff, PAPER ? 0.4 : 0.55));
const rim = new THREE.DirectionalLight(0xdfe8f5, 0.35);
rim.position.set(-5, 3, -4);
scene.add(rim);
// 종이 바탕에서는 땅쪽 반사광을 종이색 계열로 맞춰 아랫면이 푸르게 뜨지 않게 한다
scene.add(PAPER ? new THREE.HemisphereLight(0xfffaf0, 0xb8ad96, 0.45) : new THREE.HemisphereLight(0xffffff, 0xc9c9c4, 0.4));

// 집게형 조명 스탠드: 기둥 끝점 → 갓 위치를 잇는 벡터로 팔을 정렬해서
// 기둥·팔·갓·전구가 서로 끊어져 보이지 않고 실제로 이어지게 배치
const lampGroup = new THREE.Group();
lampGroup.position.set(3.6, 0, 2.0);
scene.add(lampGroup);
const lampArmMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.4 });

// 박스 전체 높이(BOX_H=2.3)보다 확실히 높은 곳에서 비추도록 기둥을 훨씬 높임
const LAMP_POLE_H = 2.55;
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.04, 20), lampArmMat);
lampBase.position.y = 0.02;
lampGroup.add(lampBase);
const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, LAMP_POLE_H, 12), lampArmMat);
lampPole.position.y = LAMP_POLE_H / 2;
lampGroup.add(lampPole);

const armStart = new THREE.Vector3(0, LAMP_POLE_H, 0); // 기둥 꼭대기
// 박스 위(월드 y>2.3 유지) + 박스 중앙 쪽으로 뻗도록 (lampGroup 로컬 = 월드 - (3.6,0,2.0))
const armEnd = new THREE.Vector3(-1.6, LAMP_POLE_H - 0.05, -1.7);
const armDir = new THREE.Vector3().subVectors(armEnd, armStart);
const armLen = armDir.length();
const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, armLen, 10), lampArmMat);
lampArm.position.copy(armStart).addScaledVector(armDir, 0.5);
lampArm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.clone().normalize());
lampGroup.add(lampArm);

const LAMP_SHADE_H = 0.22;
const lampHead = new THREE.Mesh(
  new THREE.ConeGeometry(0.16, LAMP_SHADE_H, 20, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
);
// 원뿔은 로컬 +y가 꼭짓점이라, 꼭짓점이 정확히 팔 끝점(armEnd)에 닿도록 중심을 절반만큼 내림
lampHead.position.copy(armEnd);
lampHead.position.y -= LAMP_SHADE_H / 2;
lampGroup.add(lampHead);
const lampBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff4d0 })
);
lampBulb.position.set(armEnd.x, armEnd.y - LAMP_SHADE_H * 0.8, armEnd.z); // 갓 안쪽, 입구 근처
lampGroup.add(lampBulb);

// 회전판: 어두운 바탕에서는 흰 판이 또렷했지만 종이 바탕(#f8f5ee)에서는 차가운 회색 타원으로 번져 보였다(D1).
// 종이보다 한 단계 짙은 따뜻한 회갈색으로 두고, 가장자리에 먹색 가는 선을 둘러 판의 윤곽을 잡는다.
const table = new THREE.Mesh(
  new THREE.CylinderGeometry(3.6, 3.8, 0.15, 64),
  // envMapIntensity: 공유 환경맵의 하늘색 패널이 판에 비쳐 푸르게 보였다 - 종이 탭에서는 반사를 줄인다
  new THREE.MeshStandardMaterial({ color: PAPER ? 0xd6cbb4 : 0xf2f2ef, roughness: PAPER ? 1 : 0.9, envMapIntensity: PAPER ? 0.35 : 1 })
);
table.position.y = -0.08;
table.receiveShadow = true;
scene.add(table);
if (PAPER) {
  const rimPts = [];
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; rimPts.push(new THREE.Vector3(Math.cos(a) * 3.6, 0.002, Math.sin(a) * 3.6)); }   // 판 윗면(y −0.005) 바로 위
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), new THREE.LineBasicMaterial({ color: 0x575d65, transparent: true, opacity: 0.6 })));
}

const BOX_W = 6, BOX_D = 3, BOX_H = 2.3;
const TERRAIN_TOP = BOX_H * 0.2; // 지형은 박스 높이의 1/5까지만
// 녹지·도시가 서로 다른 높이(0.78/0.96)를 써서 경계에 단차가 보였음 - GROUND_BASE 하나로 통일
const GROUND_BASE = TERRAIN_TOP * 0.94;  // 습지·숲·도시 공통 지표면 높이
const OCEAN_BASE = TERRAIN_TOP * 0.3;    // 바다: 모래바닥 (육지보다 낮게 파여있고, 그 위를 물이 채움)
const WETLAND_BASE = GROUND_BASE;
const CITY_BASE = GROUND_BASE;
const ZONE_W = BOX_W / 3;

// ================= 절차적 지형 (블록 상판에 노이즈 기반 높낮이) =================
// 여러 사인파를 겹친 값 노이즈 + 가장자리로 갈수록 0에 수렴하는 falloff로
// 구역 경계(박스 옆면)와는 이음매 없이, 중앙만 자연스럽게 도드라지게 만든다.
const TERRAIN_HALF_W = (ZONE_W - 0.015) / 2, TERRAIN_HALF_D = (BOX_D - 0.02) / 2;
function terrainNoise(lx, lz, amplitude, seed) {
  const u = lx / TERRAIN_HALF_W, v = lz / TERRAIN_HALF_D;
  const falloff = Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v);
  const n = Math.sin(lx * 3.1 + seed) * Math.cos(lz * 2.7 + seed * 1.3) * 0.5 +
            Math.sin(lx * 7.3 - seed * 0.7) * Math.cos(lz * 6.1 + seed) * 0.25 +
            Math.sin(lx * 13.1 + seed * 2.1) * Math.cos(lz * 11.7 - seed) * 0.125;
  return amplitude * n * falloff;
}
// 습지 구역은 바닥 위에 나무·바위·풀이 고정 좌표로 놓이므로, 지형 높이를
// 반영한 실제 배치 y값을 구할 때 이 함수로 통일해서 뜨거나 파묻히지 않게 한다.
const WETLAND_TERRAIN_AMP = 0.012, WETLAND_TERRAIN_SEED = 4.2;
function wetlandY(x, z) { return WETLAND_BASE + terrainNoise(x, z, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED); }
const OCEAN_TERRAIN_AMP = 0.02, OCEAN_TERRAIN_SEED = 1.7;

function createTerrainCap(xOffset, groundTopY, texture, amplitude, seed, segX = 24, segZ = 16) {
  const geo = new THREE.PlaneGeometry(ZONE_W - 0.015, BOX_D - 0.02, segX, segZ);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getY(i);
    pos.setZ(i, terrainNoise(lx, lz, amplitude, seed));
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, flatShading: true }));
  mesh.position.set(xOffset, groundTopY + 0.001, 0); // 박스 상판 바로 위에 겹쳐서 이음매 없이 대체
  mesh.receiveShadow = true;
  box.add(mesh);
  return mesh;
}

const box = new THREE.Group();
scene.add(box);

const acrylicMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 0.06,
  roughness: 0.02, transmission: 0.97, thickness: 0.05,
  side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05,
  // 이 유리 벽이 depth buffer에 값을 계속 써서, 벽 바로 안쪽에 겹쳐 있는 다른 반투명
  // 오브젝트(헤이즈 볼륨 등)가 depth test에서 걸러져 안 보이는 문제가 있었음 - 투명한
  // 유리는 뒤에 있는 걸 가리면 안 되므로 depthWrite를 꺼서 순수 오버레이로만 동작하게 함
  depthWrite: false
});
// 아크릴 모서리: 어두운 바탕용 흰 선(불투명도 0.3)은 종이 바탕에서 사라졌다. 종이 탭은 먹색(--ink-2 계열) 가는 선으로.
const edgeMat = PAPER
  ? new THREE.LineBasicMaterial({ color: 0x3d434b, transparent: true, opacity: 0.75 })
  : new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
function addPanel(w, h, pos, rot) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), acrylicMat);
  p.position.copy(pos);
  if (rot) p.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
  box.add(p);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry), edgeMat);
  edges.position.copy(pos);
  if (rot) edges.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
  box.add(edges);
}
addPanel(BOX_W, BOX_H, new THREE.Vector3(0, BOX_H / 2, -BOX_D / 2));
addPanel(BOX_D, BOX_H, new THREE.Vector3(-BOX_W / 2, BOX_H / 2, 0), { y: Math.PI / 2 });
addPanel(BOX_D, BOX_H, new THREE.Vector3(BOX_W / 2, BOX_H / 2, 0), { y: Math.PI / 2 });
addPanel(BOX_W, BOX_H, new THREE.Vector3(0, BOX_H / 2, BOX_D / 2));

// ================= 대기층 디자인 =================
// 1) 온실효과 랩(뚜껑): CO2 농도에 따라 맑은 하늘색 → 뿌연 갈황색으로 색이 변함
const CLEAR_SKY = new THREE.Color(0xcfe8ff);
const HAZY_SKY = new THREE.Color(0xd9a86c);
const lidMat = new THREE.MeshPhysicalMaterial({ color: CLEAR_SKY.clone(), transparent: true, opacity: 0.15, roughness: 0.1, transmission: 0.9, side: THREE.DoubleSide });
const lid = new THREE.Mesh(new THREE.PlaneGeometry(BOX_W, BOX_D, 16, 8), lidMat);
lid.rotation.x = -Math.PI / 2;
lid.position.y = BOX_H - 0.03;
const lidPos = lid.geometry.attributes.position;
for (let i = 0; i < lidPos.count; i++) {
  const x = lidPos.getX(i), y = lidPos.getY(i);
  lidPos.setZ(i, -0.05 * Math.exp(-(x * x + y * y) / 2.5));
}
lidPos.needsUpdate = true;
lid.geometry.computeVertexNormals();
box.add(lid);

// 2) 대기 중 떠다니는 CO2 분자 입자 - 지형(1/5) 위 넓은 대기 공간(4/5)에 퍼져서 떠다님
const atmoCount = 380;
const atmoGeo = new THREE.BufferGeometry();
const atmoPos = new Float32Array(atmoCount * 3);
const atmoSeed = new Float32Array(atmoCount * 3);
for (let i = 0; i < atmoCount; i++) {
  const x = (Math.random() - 0.5) * (BOX_W - 0.3);
  const y = TERRAIN_TOP + 0.05 + Math.random() * (BOX_H - TERRAIN_TOP - 0.15);
  const z = (Math.random() - 0.5) * (BOX_D - 0.3);
  atmoPos[i * 3] = x; atmoPos[i * 3 + 1] = y; atmoPos[i * 3 + 2] = z;
  atmoSeed[i * 3] = Math.random() * Math.PI * 2;
  atmoSeed[i * 3 + 1] = 0.4 + Math.random() * 0.8;
  atmoSeed[i * 3 + 2] = Math.random();
}
atmoGeo.setAttribute('position', new THREE.BufferAttribute(atmoPos, 3));
const atmoBase = Float32Array.from(atmoPos);
const atmoMat = new THREE.PointsMaterial({ color: 0xffcf8a, size: 0.022, transparent: true, opacity: 0 });
const atmosphere = new THREE.Points(atmoGeo, atmoMat);
box.add(atmosphere);

// 3) 은은한 헤이즈 볼륨 - 지형 위 대기 공간 전체를 감싸는 반투명 색 레이어 (스모그 느낌)
// 옆면(4개 수직면)이 바깥 아크릴 벽(addPanel)과 거의 같은 위치에 겹쳐 있어서, 그쪽이
// 먼저 그려지며 depth buffer를 채워두면 이 헤이즈 벽은 depth test에서 걸러져 옵션값(opacity)을
// 아무리 올려도 아예 안 그려졌었음(위·아래 면은 겹치는 게 없어서 정상 표시) - depthWrite를 꺼서
// 다른 투명 오브젝트의 depth buffer에 영향받지 않고 항상 그려지게 함
const hazeMat = new THREE.MeshBasicMaterial({ color: HAZY_SKY.clone(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const haze = new THREE.Mesh(new THREE.BoxGeometry(BOX_W - 0.02, BOX_H - TERRAIN_TOP - 0.05, BOX_D - 0.02), hazeMat);
haze.position.y = TERRAIN_TOP + (BOX_H - TERRAIN_TOP) / 2;
box.add(haze);
// 종이 탭(2차 개편 D2): CO₂는 무색이다. 뚜껑 색·안개·노란 입자를 CO₂에 묶으면 스모그로 오해하게 되므로
// 셋 다 쓰지 않고, [CO₂ 보기]를 켰을 때만 아래 점 구름으로 농도를 보인다.
if (PAPER) { atmosphere.visible = false; haze.visible = false; }

// [CO₂ 보기] 점 구름: 점 개수 ∝ 농도 (EarthVisual.co2DotCount). 최대 개수만큼 미리 자리를 만들고
// setDrawRange로 앞에서부터 보일 개수만 그린다 - 점이 몇 개든 드로우콜 1번.
let co2Dots = null;
if (PAPER) {
  const N = EarthVisual.CO2_DOTS.MAX;
  const pos = new Float32Array(N * 3), base = new Float32Array(N * 3), seed = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    base[i * 3] = (Math.random() - 0.5) * (BOX_W - 0.2);
    base[i * 3 + 1] = TERRAIN_TOP + 0.08 + Math.random() * (BOX_H - TERRAIN_TOP - 0.18);
    base[i * 3 + 2] = (Math.random() - 0.5) * (BOX_D - 0.2);
    seed[i * 2] = Math.random() * Math.PI * 2;
    seed[i * 2 + 1] = 0.3 + Math.random() * 0.6;
  }
  pos.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setDrawRange(0, 0);
  // 둥근 점: 기본 Points는 네모라 작은 원 텍스처를 입힌다. 색은 먹색 - 무색 기체를 '표시'한 것이지 색이 있는 것처럼 보이면 안 된다
  const mat = new THREE.PointsMaterial({ color: 0x3d434b, size: 0.045, map: dotSprite(), transparent: true, opacity: 0.85, alphaTest: 0.3, depthWrite: false });
  co2Dots = new THREE.Points(geo, mat);
  co2Dots.visible = false;
  co2Dots.userData = { base, seed };
  box.add(co2Dots);
}

// 받침대 연산 효과 (2차 F6): 미래 예측 탭 씬(인간활동·자연 지구)에만
const predictFx = PAPER && opts.predictFx ? buildPredictFx(scene) : null;

// 4) 구름. 종이 탭은 흐르는 뭉게구름(buildClouds, 2차 F5), 직접 실험 탭은 예전 얼음 덩어리 클러스터 그대로
const clouds = PAPER ? buildClouds(box, BOX_W, BOX_H) : null;
if (!PAPER) {
  const cloudIceMat = new THREE.MeshPhysicalMaterial({ map: sharedTex.iceCrack, color: 0xffffff, roughness: 0.1, transmission: 0.5, clearcoat: 1, flatShading: true });
  const cloudIcePositions = [[-1.6, -0.5], [-1.3, -0.15], [-1.0, -0.6], [-1.75, -0.1], [-1.15, -0.35]];
  cloudIcePositions.forEach(([x, z]) => {
    const s = 0.08 + Math.random() * 0.05;
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), cloudIceMat);
    chunk.position.set(x, BOX_H - 0.06 - s * 0.3, z);
    chunk.castShadow = true;
    box.add(chunk);
  });
}

// 5) 응결 물방울: 벽 안쪽에서 맺혔다가 아래로 흘러내리는 파티클
const dropCount = 26;
const dropGeo = new THREE.BufferGeometry();
const dropPos = new Float32Array(dropCount * 3);
const dropSeed = new Float32Array(dropCount * 2); // [speed, xz-slot]
for (let i = 0; i < dropCount; i++) {
  dropPos[i * 3] = (Math.random() - 0.5) * (BOX_W - 0.4);
  dropPos[i * 3 + 1] = TERRAIN_TOP + Math.random() * (BOX_H - TERRAIN_TOP);
  dropPos[i * 3 + 2] = (Math.random() < 0.5 ? -1 : 1) * (BOX_D / 2 - 0.02);
  dropSeed[i * 2] = 0.15 + Math.random() * 0.25;
  dropSeed[i * 2 + 1] = dropPos[i * 3 + 2];
}
dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
const dropMat = new THREE.PointsMaterial({ color: 0xdff0ff, size: 0.018, transparent: true, opacity: 0.7 });
const drops = new THREE.Points(dropGeo, dropMat);
box.add(drops);

function zoneFloor(xOffset, groundTopY, texture, sideColor, topColor = 0xffffff) {
  const h = Math.max(groundTopY, 0.01);
  const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.95 });
  const topMat = new THREE.MeshStandardMaterial({ map: texture, color: topColor, roughness: 0.9 });
  // BoxGeometry 面 순서: [+x, -x, +y(윗면), -y(밑면), +z, -z]
  const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
  const block = new THREE.Mesh(new THREE.BoxGeometry(ZONE_W - 0.015, h, BOX_D - 0.02), mats);
  block.position.set(xOffset, h / 2, 0);
  block.castShadow = true;
  block.receiveShadow = true;
  box.add(block);
  return block;
}
zoneFloor(-ZONE_W, OCEAN_BASE, sharedTex.oceanFloor, 0xa89f83);
zoneFloor(0, WETLAND_BASE, sharedTex.forestGrass, 0x2c331c);
// 도시 바닥 텍스처가 씬 조명 아래 너무 밝아 안 보여서 씬 전체 조명을 건드리는 대신
// 이 재질에만 어두운 틴트를 곱해 노출을 낮춘 효과를 줌
// 자연 지구(2차 개편 D6)는 도시 구역 자리도 포장도로가 아닌 풀밭이다
const WILD = PAPER && !!opts.nature;
if (WILD) zoneFloor(ZONE_W, CITY_BASE, sharedTex.forestGrass, 0x2c331c);
else zoneFloor(ZONE_W, CITY_BASE, sharedTex.cityPavement, 0x3a3832, 0x9a9a9a);
// 해저·습지 바닥에만 절차적 지형 기복 적용. 도시는 실제로도 평평하게 포장된 땅이라
// (건물·차 등 고정 좌표 소품도 많아 굴곡을 주면 오히려 붕 뜬 것처럼 보임) 그대로 둔다.
createTerrainCap(-ZONE_W, OCEAN_BASE, sharedTex.oceanFloor, OCEAN_TERRAIN_AMP, OCEAN_TERRAIN_SEED);
createTerrainCap(0, WETLAND_BASE, sharedTex.forestGrass, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED);
if (WILD) createTerrainCap(ZONE_W, CITY_BASE, sharedTex.forestGrass, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED + 2.3);
// 세 블록이 높이가 달라서 경계면(옆면)이 자연스럽게 계단 절벽처럼 드러남 - 별도 리저 불필요


// --- 해양·빙하: 계속 움직이는 돔 파도 ---
const oceanGroup = new THREE.Group();
oceanGroup.position.x = -ZONE_W;
box.add(oceanGroup);

const waveW = ZONE_W - 0.08, waveD = BOX_D - 0.08;
const waveGeo = new THREE.PlaneGeometry(waveW, waveD, 36, 24);
// 기존엔 이 기준선 자체가 이미 녹지 지표면보다 높았고, 최대 진폭까지 더하면 지형 상한마저
// 넘어서 "파도가 녹지보다 높게 넘실거리는" 문제가 있었음 - WAVE_MAX_AMPLITUDE를 더해도
// GROUND_BASE보다 확실히 낮게 남도록 기준선을 낮춤
const waveBaseY = TERRAIN_TOP * 0.55;
// pH가 낮아질수록(산성화) WAVE_CLEAR → WAVE_MURKY로 수면 색도 함께 탁해짐
const WAVE_CLEAR = new THREE.Color(0x123a55);
const WAVE_MURKY = new THREE.Color(0x7a6a42);
const waveMat = new THREE.MeshPhysicalMaterial({
  color: WAVE_CLEAR.clone(), transparent: true, opacity: 0.92, roughness: 0.1,
  transmission: 0.25, clearcoat: 0.9, side: THREE.DoubleSide,
  normalMap: waterNormalTex, normalScale: new THREE.Vector2(0.35, 0.35),
  depthWrite: false // 몸통(waterBody, depthWrite:true)과 거의 겹쳐 있어서 서로 깊이 순서를 다투는 걸 방지
});
const waveMesh = new THREE.Mesh(waveGeo, waveMat);
waveMesh.rotation.x = -Math.PI / 2;
waveMesh.position.y = waveBaseY;
waveMesh.castShadow = true;
oceanGroup.add(waveMesh);
const wavePosAttr = waveGeo.attributes.position;
const waveBase = Float32Array.from(wavePosAttr.array);

// 아래쪽 몸통(수조 안쪽 물 표현) - 모래바닥(OCEAN_BASE)부터 수면까지 실제 두께로 채움
// pH가 낮아질수록(산성화) WATER_CLEAR → WATER_MURKY로 탁하게 변함
const WATER_CLEAR = new THREE.Color(0x0e2c45);
const WATER_MURKY = new THREE.Color(0x6b5a35);
// 몸통 윗면의 "정지 상태 기준" 높이 - 실제 매 프레임 높이는 animate()에서 정면 파도 높이에
// 맞춰 scale.y로 다시 조절되므로(WATER_SYNC_BUFFER 참고), 여기선 최댓값 기준으로 지어만 둠.
// 예전엔 고정 여유값(0.2)이 실제 파도 진폭(약 0.1)보다 훨씬 커서, 출렁이는 표면과 정지된
// 몸통 윗면 사이에 큰 빈틈이 생겨 "표면만 있고 몸통은 안 보이는" 것처럼 읽혔음
const waterTopY = waveBaseY + WAVE_MAX_AMPLITUDE + WATER_SYNC_BUFFER;
const waterNominalH = Math.max(0.03, waterTopY - OCEAN_BASE);
// transmission(굴절 투과)을 표면(waveMat)과 몸통 둘 다에 쓰면 겹친 투과 재질끼리
// 서로를 잘못 가려서 각도에 따라 옆면이 사라지는 문제가 생김 - 몸통은 transmission 없이
// 색상+불투명도만으로 표현하고, depthWrite를 명시해 자기 자신의 면끼리 항상 올바르게 겹치게 함
const waterBody = new THREE.Mesh(
  new THREE.BoxGeometry(waveW, waterNominalH, waveD),
  new THREE.MeshPhysicalMaterial({ color: WATER_CLEAR.clone(), transparent: true, opacity: 0.82, roughness: 0.15, transmission: 0, depthWrite: true })
);
waterBody.position.y = OCEAN_BASE + waterNominalH / 2;
oceanGroup.add(waterBody);

// 파도 크레스트 흰 포말 파티클 (전면부에 집중되어 부서지는 느낌)
const foamCount = 70;
const foamGeo = new THREE.BufferGeometry();
const foamPos = new Float32Array(foamCount * 3);
const foamSeed = new Float32Array(foamCount * 2);
for (let i = 0; i < foamCount; i++) {
  foamPos[i * 3] = (Math.random() - 0.5) * waveW;
  foamPos[i * 3 + 1] = waveBaseY + 0.05;
  foamPos[i * 3 + 2] = waveD * (0.15 + Math.random() * 0.3); // 전면 쪽에 몰림
  foamSeed[i * 2] = Math.random() * Math.PI * 2;
  foamSeed[i * 2 + 1] = 0.5 + Math.random();
}
foamGeo.setAttribute('position', new THREE.BufferAttribute(foamPos, 3));
const foamBaseArr = Float32Array.from(foamPos);
const foamMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.85 });
const foam = new THREE.Points(foamGeo, foamMat);
oceanGroup.add(foam);

// 메탄 기포: 바닥에서 올라와 수면 근처에서 리셋되는 파티클 (실측 메탄 농도가 높을수록 진하고 빠르게)
// 기본 불투명도는 0 - 실시간 실험 탭에서 메탄 값이 들어와야만 보이고, 다른 탭에선 조용히 숨어있음
const bubbleCount = 45;
const bubbleGeo = new THREE.BufferGeometry();
const bubblePos = new Float32Array(bubbleCount * 3);
const bubbleSeed = new Float32Array(bubbleCount * 2); // [상승 속도, x 흔들림 위상]
for (let i = 0; i < bubbleCount; i++) {
  bubblePos[i * 3] = (Math.random() - 0.5) * waveW * 0.85;
  bubblePos[i * 3 + 1] = OCEAN_BASE + Math.random() * (waveBaseY - OCEAN_BASE); // 처음부터 높이를 흩어놔 끊김 없이 이어지는 스트림처럼 보이게
  bubblePos[i * 3 + 2] = (Math.random() - 0.5) * waveD * 0.85;
  bubbleSeed[i * 2] = 0.4 + Math.random() * 0.6;
  bubbleSeed[i * 2 + 1] = Math.random() * Math.PI * 2;
}
bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
const bubbleBaseArr = Float32Array.from(bubblePos);
const bubbleMat = new THREE.PointsMaterial({ color: 0xdff6ff, size: 0.014, transparent: true, opacity: 0 });
const bubbles = new THREE.Points(bubbleGeo, bubbleMat);
oceanGroup.add(bubbles);

const iceMat = new THREE.MeshPhysicalMaterial({ map: sharedTex.iceCrack, color: 0xf3fbff, roughness: 0.1, transmission: 0.25, clearcoat: 0.85, flatShading: true });
const iceMeshes = [];
[[-0.5, -0.4], [0.3, 0.3], [0.55, -0.5], [-0.15, 0.5]].forEach(([x, z]) => {
  const s = 0.045 + Math.random() * 0.03;
  const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), iceMat);
  ice.position.set(x, waveBaseY + s * 0.5, z);
  ice.castShadow = true;
  oceanGroup.add(ice);
  iceMeshes.push({ mesh: ice, baseY: ice.position.y, shrinkY: 0 });
});

// ── 종이 탭(2차 개편 D4): 빙하 · 산호 ──
// 빙하: 예전 얼음 조각 4개(지름 0.1 남짓)는 줄어드는 게 거의 안 보였다. 바다 구역 뒤쪽 왼편 모서리에 빙하 덩어리를 두고
// 그 모서리를 기준으로 줄인다(EarthVisual.glacierFrac, 연출). 덩어리 여러 개를 한 지오메트리로 합쳐 드로우콜 1번.
let glacier = null, coral = null, shells = null;
if (PAPER) {
  const rnd = seededRandom(1850);
  const parts = [];
  for (let i = 0; i < 11; i++) {
    const u = rnd(), v = rnd();
    const x = u * 0.75, z = v * 0.65;
    const near = 1 - Math.min(1, Math.hypot(u, v) / 1.2);          // 모서리에 가까울수록 두껍다
    const r = 0.1 + 0.1 * near + rnd() * 0.04;
    const g = rnd() < 0.5 ? new THREE.DodecahedronGeometry(r, 0) : new THREE.IcosahedronGeometry(r, 0);
    parts.push([g, new THREE.Matrix4().compose(new THREE.Vector3(x, 0.06 + 0.22 * near, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 3, rnd())), new THREE.Vector3(1.3, 0.8 + near * 0.6, 1.1))]);
  }
  glacier = new THREE.Mesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ color: 0xe6f2f8, roughness: 0.35, flatShading: true }));
  glacier.position.set(-waveW / 2 + 0.03, OCEAN_BASE, -waveD / 2 + 0.03);   // 뒤쪽 왼편 모서리 = 줄어드는 기준점
  glacier.castShadow = true;
  oceanGroup.add(glacier);

  // 산호: 바다 바닥 앞쪽에 가지 산호·둥근(뇌) 산호 군락. 인스턴스 색으로 건강(분홍·주황·보라·노랑) / 백화(흰색)를 나눈다.
  // 건강한 군락 수 = 전체 × EarthVisual.coralHealthy(T) (IPCC SR1.5 B.4.2). 순서를 섞어 두어 백화가 한쪽에 몰리지 않는다.
  const floorY = (x, z) => OCEAN_BASE + 0.001 + terrainNoise(x, -z, OCEAN_TERRAIN_AMP, OCEAN_TERRAIN_SEED);
  const branch = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, tilt = 0.25 + rnd() * 0.35, len = 0.085 + rnd() * 0.04;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 0.012, len / 2 * Math.cos(tilt), Math.sin(a) * 0.012),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)), new THREE.Vector3(1, 1, 1));
    branch.push([new THREE.CylinderGeometry(0.008, 0.013, len, 5), m]);
  }
  const branchGeo = mergeGeos(branch);
  const brainGeo = new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const spots = [];
  for (let i = 0; i < 40 && spots.length < 30; i++) {
    const x = -0.8 + rnd() * 1.65, z = 0.1 + rnd() * 1.2;
    if (spots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 0.12)) continue;
    spots.push([x, z]);
  }
  const nBranch = Math.ceil(spots.length * 0.6);
  const coralMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const branches = new THREE.InstancedMesh(branchGeo, coralMat, nBranch);
  const brains = new THREE.InstancedMesh(brainGeo, coralMat, spots.length - nBranch);
  const d = new THREE.Object3D();
  spots.forEach(([x, z], i) => {
    const s = 0.8 + rnd() * 0.6;
    d.position.set(x, floorY(x, z), z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(s, s * (i < nBranch ? 1 : 0.7), s); d.updateMatrix();
    if (i < nBranch) branches.setMatrixAt(i, d.matrix); else brains.setMatrixAt(i - nBranch, d.matrix);
  });
  const HEALTHY = [0xe0705a, 0xef9a3c, 0xa65aa8, 0xe2bd45, 0xd9566e].map(h => new THREE.Color(h));
  // 군락 하나 = (메시, 번호, 건강할 때 색). 순서를 섞어 '앞에서부터 k개 건강'이 공간적으로 고르게 퍼지게
  const colonies = spots.map((_, i) => ({ mesh: i < nBranch ? branches : brains, idx: i < nBranch ? i : i - nBranch, color: HEALTHY[i % HEALTHY.length] }));
  for (let i = colonies.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [colonies[i], colonies[j]] = [colonies[j], colonies[i]]; }
  oceanGroup.add(branches, brains);
  coral = { colonies, meshes: [branches, brains], healthy: -1 };

  // 조개(바닥)·익족류(물속에 떠 있는 작은 껍데기 생물): 껍데기 상태를 Ω에 묶는다 (EarthVisual.shellState, D5).
  // 모든 개체가 같은 Ω(전 지구 평균)를 받으므로 재질 하나를 바꾼다. 구멍은 alphaMap(얼룩 무늬) + alphaTest로 낸다.
  const shellMat = new THREE.MeshStandardMaterial({ color: SHELL_INTACT.clone(), roughness: 0.55, alphaMap: holeTexture(), side: THREE.DoubleSide });
  // 조개: 경첩(x축)에서 V자로 벌어진 껍데기 두 장 - 둥근 뇌 산호와 모양으로 구별되게
  const clamGeo = mergeGeos([0.45, -0.45].map(a => [new THREE.CircleGeometry(0.05, 12, 0, Math.PI), mat4(0, 0, 0, Math.PI / 2 - a, 0, 0)]));
  const pteroGeo = new THREE.ConeGeometry(0.018, 0.05, 8, 1, true);
  const clamSpots = [], pteroSpots = [];
  while (clamSpots.length < 16) {
    const x = -0.35 + rnd() * 1.2, z = -0.85 + rnd() * 0.9;
    if (!clamSpots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 0.1)) clamSpots.push([x, z]);
  }
  for (let i = 0; i < 14; i++) pteroSpots.push([-0.7 + rnd() * 1.5, -0.6 + rnd() * 1.6]);
  const clams = new THREE.InstancedMesh(clamGeo, shellMat, clamSpots.length);
  const pteros = new THREE.InstancedMesh(pteroGeo, shellMat, pteroSpots.length);
  clamSpots.forEach(([x, z], i) => {
    d.position.set(x, floorY(x, z) + 0.004, z); d.rotation.set(0, rnd() * 6.28, 0); d.scale.set(1, 1, 1); d.updateMatrix();
    clams.setMatrixAt(i, d.matrix);
  });
  pteroSpots.forEach(([x, z], i) => {
    d.position.set(x, OCEAN_BASE + 0.03 + rnd() * 0.06, z); d.rotation.set(rnd() * 2, rnd() * 6.28, rnd() * 2); d.scale.set(1, 1, 1); d.updateMatrix();
    pteros.setMatrixAt(i, d.matrix);
  });
  oceanGroup.add(clams, pteros);
  shells = { mat: shellMat, dissolving: false };
}

// --- 습지·숲 ---
const forestGroup = new THREE.Group();
box.add(forestGroup);
const MUD_X = -0.2, MUD_Z = 0.1, MUD_AVOID_R = 0.14;
// 실제 녹지 전체 크기(TERRAIN_HALF_W/D)의 90%까지 써야 하는데, 이전엔 절반 정도(가로
// 58%·세로 35%)밖에 안 되는 좁은 범위를 써서 중앙에만 몰려 보였음 - 범위를 바로잡음
const GREEN_HALF_W = TERRAIN_HALF_W * 0.9, GREEN_HALF_D = TERRAIN_HALF_D * 0.9;
// 녹지 전체 영역(풀 스캐터와 동일 범위)에서 진흙탕 근처를 피해 랜덤 좌표 하나를 뽑는다
function scatterInGreenZone() {
  let x, z, tries = 0;
  do {
    x = (Math.random() - 0.5) * 2 * GREEN_HALF_W;
    z = (Math.random() - 0.5) * 2 * GREEN_HALF_D;
    tries++;
  } while (Math.hypot(x - MUD_X, z - MUD_Z) < MUD_AVOID_R && tries < 20);
  return [x, z];
}

const rockMat = new THREE.MeshStandardMaterial({ color: 0x74705f, roughness: 0.95 });
const ROCK_COUNT = 12;
for (let i = 0; i < ROCK_COUNT; i++) {
  const [x, z] = scatterInGreenZone();
  const s = 0.05 + Math.random() * 0.035;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
  rock.position.set(x, wetlandY(x, z) + s * 0.5, z);
  rock.castShadow = true;
  forestGroup.add(rock);
}

const trunkMat = new THREE.MeshStandardMaterial({ map: sharedTex.treeBark, color: 0xffffff, roughness: 0.9 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7433, roughness: 0.8 });
const TREE_COUNT = 22;
const treeMeshes = [];
for (let i = 0; i < TREE_COUNT; i++) {
  const [x, z] = scatterInGreenZone();
  const tree = new THREE.Group();
  // 작은 모종/새싹 느낌: 두꺼운 줄기 + 타원형 잎 여러 장
  const h = 0.14 + Math.random() * 0.09;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 6), trunkMat);
  stem.position.y = h / 2;
  stem.castShadow = true;
  tree.add(stem);
  const leafCount = 3 + Math.floor(Math.random() * 3);
  for (let li = 0; li < leafCount; li++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.02, 6, 5), leafMat);
    leaf.scale.set(1, 0.55, 1.6);
    const ang = (li / leafCount) * Math.PI * 2;
    leaf.position.set(Math.cos(ang) * 0.03, h * (0.7 + Math.random() * 0.25), Math.sin(ang) * 0.03);
    leaf.castShadow = true;
    tree.add(leaf);
  }
  tree.position.set(x, wetlandY(x, z), z);
  forestGroup.add(tree);
  treeMeshes.push({ group: tree, baseX: x, baseZ: z });
}

// 습지 진흙 패치: 일반 흙과 달리 어둡고 젖은 광택 + 얕은 물웅덩이
const wetlandPatch = new THREE.Mesh(
  new THREE.CircleGeometry(0.1, 32),
  new THREE.MeshPhysicalMaterial({ map: sharedTex.wetlandSoil, color: 0xffffff, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 })
);
wetlandPatch.rotation.x = -Math.PI / 2;
wetlandPatch.position.set(MUD_X, wetlandY(MUD_X, MUD_Z) + 0.006, MUD_Z);
forestGroup.add(wetlandPatch);
const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x3a6a7a, transparent: true, opacity: 0.75, roughness: 0.05, transmission: 0.3, clearcoat: 1 });
const puddles = [];
[[-0.03, -0.02, 0.035], [0.025, 0.03, 0.028], [-0.02, 0.04, 0.02]].forEach(([px, pz, pr]) => {
  const pux = MUD_X + px, puz = MUD_Z + pz;
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(pr, 16), puddleMat);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(pux, wetlandY(pux, puz) + 0.009, puz);
  forestGroup.add(puddle);
  puddles.push(puddle);
});

// 풀 인스턴싱: 수백 개를 한 번의 draw call로 그려서 습지·숲 밀도감을 살림.
// 실제로 몇 개나 "보이게"할지는 applyState()에서 습지 비율/습도에 맞춰 count를 조절.
const GRASS_MAX = 240;
const grassGeo = new THREE.ConeGeometry(0.006, 0.045, 5);
grassGeo.translate(0, 0.0225, 0);
const grassMat = new THREE.MeshStandardMaterial({ color: 0x5a9c4a, roughness: 0.85 });
const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_MAX);
grassMesh.castShadow = true;
{
  const dummy = new THREE.Object3D();
  let placed = 0, attempts = 0;
  while (placed < GRASS_MAX && attempts < GRASS_MAX * 8) {
    attempts++;
    const gx = (Math.random() - 0.5) * 2 * GREEN_HALF_W;
    const gz = (Math.random() - 0.5) * 2 * GREEN_HALF_D;
    const dxMud = gx - wetlandPatch.position.x, dzMud = gz - wetlandPatch.position.z;
    if (Math.sqrt(dxMud * dxMud + dzMud * dzMud) < 0.14) continue; // 진흙 패치 근처는 비워둠
    dummy.position.set(gx, wetlandY(gx, gz), gz);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    const gs = 0.7 + Math.random() * 0.7;
    dummy.scale.set(gs, gs * (0.8 + Math.random() * 0.5), gs);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  grassMesh.instanceMatrix.needsUpdate = true;
}
forestGroup.add(grassMesh);

// --- 도시 ---
const cityGroup = new THREE.Group();
cityGroup.position.x = ZONE_W;
box.add(cityGroup);
const bldColors = [0x9aa0a8, 0x848a92, 0xb0b5bb, 0x7a8088];
const bldDefs = [
  [-0.55, -0.5, 0.16, 0.35], [-0.15, -0.55, 0.13, 0.24], [0.3, -0.4, 0.18, 0.48],
  [0.55, -0.15, 0.12, 0.28], [-0.5, 0.2, 0.15, 0.32], [-0.1, 0.5, 0.16, 0.42],
  [0.35, 0.45, 0.13, 0.22], [0.55, 0.15, 0.14, 0.36]
];
const buildingMeshes = [];
bldDefs.forEach(([x, z, w, h], i) => {
  const bldGroup = new THREE.Group();
  // 건물마다 크기가 달라서 텍스처를 복제해 반복 횟수를 따로 줘야 창문 크기가 일정해 보임
  const facadeTex = sharedTex.buildingFacade.clone();
  facadeTex.needsUpdate = true;
  facadeTex.repeat.set(Math.max(1, Math.round(w * 10)), Math.max(1, Math.round(h * 8)));
  const bld = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, w),
    new THREE.MeshStandardMaterial({ map: facadeTex, color: bldColors[i % bldColors.length], roughness: 0.5, metalness: 0.15 })
  );
  bld.position.y = h / 2;
  bld.castShadow = true;
  bld.receiveShadow = true;
  bldGroup.add(bld);
  bldGroup.position.set(x, CITY_BASE, z);
  cityGroup.add(bldGroup);
  buildingMeshes.push(bldGroup);
});

// 도시 도로: 블록을 가로지르는 큰길(가로) 하나 + 그것과 직각으로 교차하는 도로(세로) 하나로
// 십자 교차로를 만듦. 두 좌표 모두 건물 발밑(bldDefs 좌표) 사이 빈틈을 골라서 겹치지 않게 배치
const ROAD_W = 0.12;
const MAIN_ROAD_Z = -0.01;          // 가로(X) 도로 - 블록 양끝까지 관통
const CROSS_ROAD_X = 0.09;          // 세로(Z) 도로 - 위 도로와 직각으로 교차
const cityRoadLenX = ZONE_W - 0.015; // zoneFloor와 동일한 블록 폭
const cityRoadLenZ = BOX_D - 0.02;   // zoneFloor와 동일한 블록 깊이
// 텍스처의 점선 차선은 U축(가로) 방향으로 그려져 있어서, 세로 도로는 완성된 평면을
// 통째로 90도 더 돌려 차선이 세계 Z축을 향하게 함 (텍스처를 따로 만들 필요 없음)
function buildRoadStrip(length, alongZ) {
  const geo = new THREE.PlaneGeometry(length, ROAD_W);
  geo.rotateX(-Math.PI / 2);
  if (alongZ) geo.rotateY(Math.PI / 2);
  const tex = sharedTex.cityRoad.clone();
  tex.needsUpdate = true;
  const tileSize = 0.22; // 이 간격마다 차선 무늬가 한 번씩 반복
  tex.repeat.set(Math.max(1, Math.round(length / tileSize)), 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  mesh.receiveShadow = true;
  return mesh;
}
const mainRoad = buildRoadStrip(cityRoadLenX, false);
mainRoad.position.set(0, CITY_BASE + 0.002, MAIN_ROAD_Z);
cityGroup.add(mainRoad);
// 교차점에서 두 도로가 같은 높이면 z-fighting이 생겨서 살짝 더 띄움
const crossRoad = buildRoadStrip(cityRoadLenZ, true);
crossRoad.position.set(CROSS_ROAD_X, CITY_BASE + 0.0025, 0);
cityGroup.add(crossRoad);

const gasCarMat = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.4, metalness: 0.3 });
const evCarMat = new THREE.MeshStandardMaterial({ color: 0x3fb0a0, roughness: 0.3, metalness: 0.4, emissive: 0x0d3a35, emissiveIntensity: 0.3 });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.8 });
const carSpots = [[-0.65, -0.15], [-0.3, 0.02], [0.05, -0.1], [0.4, 0.05], [0.65, -0.05],
                   [-0.5, 0.35], [-0.1, 0.32], [0.25, 0.3], [0.55, 0.35],
                   [-0.6, -0.55], [-0.05, -0.55], [0.5, -0.55]];
// 저폴리 자동차: 차체 + 쐐기형 캐빈(뒤 수직→지붕→앞유리 경사) + 유리 + 바퀴 4개 + 펜더.
// EV/가솔린 색 구분은 차체·캐빈·펜더에만 적용(바퀴·유리는 항상 고정 재질)
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0e8, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide });
function buildCarModel() {
  const group = new THREE.Group();
  const wheelR = 0.011, bodyH = 0.028, cabinH = 0.024, cabinWidth = 0.038;
  const bodyBottomY = wheelR * 2;

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, bodyH, 0.045), gasCarMat);
  body.position.y = bodyBottomY + bodyH / 2;
  body.castShadow = true;
  group.add(body);

  // 캐빈 옆면 프로파일(뒤 수직 -> 지붕 평평 -> 앞유리 경사)을 z축으로 압출해서 쐐기 모양으로
  const cabinBaseY = body.position.y + bodyH / 2;
  const profile = new THREE.Shape();
  profile.moveTo(-0.022, 0);
  profile.lineTo(-0.022, cabinH);
  profile.lineTo(0.004, cabinH);
  profile.lineTo(0.022, 0);
  profile.lineTo(-0.022, 0);
  const cabinGeo = new THREE.ExtrudeGeometry(profile, { depth: cabinWidth, bevelEnabled: false });
  cabinGeo.translate(-0.004, 0, -cabinWidth / 2); // 살짝 뒤로 당기고 z축 중앙 정렬
  const cabin = new THREE.Mesh(cabinGeo, gasCarMat);
  cabin.position.y = cabinBaseY;
  cabin.castShadow = true;
  group.add(cabin);

  // 앞유리: 캐빈의 경사면(로컬 (0,cabinH) -> (0.018,0))에 맞춘 반투명 유리 패널, 표면에서 살짝 띄워 겹침 방지
  const halfGW = cabinWidth / 2 - 0.003;
  const gx1 = 0.0012, gy1 = cabinBaseY + cabinH + 0.0008;
  const gx2 = 0.0192, gy2 = cabinBaseY + 0.0008;
  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    gx1, gy1, -halfGW, gx1, gy1, halfGW, gx2, gy2, halfGW,
    gx1, gy1, -halfGW, gx2, gy2, halfGW, gx2, gy2, -halfGW,
  ]), 3));
  glassGeo.computeVertexNormals();
  group.add(new THREE.Mesh(glassGeo, glassMat));

  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.008, 10);
  const fenderGeo = new THREE.BoxGeometry(0.024, 0.01, 0.006);
  const fenders = [];
  [[-0.03, 0.024], [0.03, 0.024], [-0.03, -0.024], [0.03, -0.024]].forEach(([wx, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2; // 실린더 축을 z방향(차 옆면)으로 돌려서 옆에서 바퀴처럼 보이게
    wheel.position.set(wx, wheelR, wz);
    wheel.castShadow = true;
    group.add(wheel);

    const fender = new THREE.Mesh(fenderGeo, gasCarMat); // 바퀴 위 펜더(휠아치) 돌출부
    fender.position.set(wx, bodyBottomY, wz);
    fender.castShadow = true;
    group.add(fender);
    fenders.push(fender);
  });
  return { group, bodyParts: [body, cabin, ...fenders] };
}
const carMeshes = [];
carSpots.forEach((pos, i) => {
  const { group, bodyParts } = buildCarModel();
  group.position.set(pos[0], CITY_BASE, pos[1]);
  group.visible = false;
  group.userData.bodyParts = bodyParts;
  cityGroup.add(group);
  carMeshes.push(group);
});

const factory = new THREE.Group();
factory.position.set(0.6, CITY_BASE, 0.55);
cityGroup.add(factory);
// 굴뚝 전용 텍스처는 없어서 콘크리트 톤인 도시 바닥 텍스처를 작게 타일링해 재사용
// 이전엔 repeat(1,4)라 좁은 원기둥 둘레에 이미지 전체가 눌려 들어가서 그라우트 선이
// 서브픽셀로 뭉개져 안 보였음 - 반복 횟수를 확 늘리고 톤도 더 어둡게 낮춰 대비를 높임
const stackTex = sharedTex.cityPavement.clone();
stackTex.needsUpdate = true;
stackTex.repeat.set(6, 10);
const stack = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.04, 0.35, 10),
  new THREE.MeshStandardMaterial({ map: stackTex, color: 0x5c5852, roughness: 0.85 })
);
stack.position.y = 0.175;
stack.castShadow = true;
factory.add(stack);
const smokeCount = 60;
const smokeGeo = new THREE.BufferGeometry();
const smokePos = new Float32Array(smokeCount * 3);
const smokeLife = new Float32Array(smokeCount);
for (let i = 0; i < smokeCount; i++) {
  smokePos[i * 3] = 0.6; smokePos[i * 3 + 1] = -1; smokePos[i * 3 + 2] = 0.55;
  smokeLife[i] = Math.random();
}
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
const smokeMat = new THREE.PointsMaterial({ color: 0x9a9a96, size: 0.06, transparent: true, opacity: 0.5 });
const smoke = new THREE.Points(smokeGeo, smokeMat);
cityGroup.add(smoke);

// 탄소제거기술(DAC) 포집 타워 - carbonRemoval 슬라이더에 따라 등장/크기 변화
const captureTower = new THREE.Group();
captureTower.position.set(-0.65, CITY_BASE, 0.15);
cityGroup.add(captureTower);
const towerBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.06, 0.3, 12),
  new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.3 })
);
towerBody.position.y = 0.15;
towerBody.castShadow = true;
captureTower.add(towerBody);
const towerFan = new THREE.Mesh(
  new THREE.TorusGeometry(0.045, 0.008, 8, 16),
  new THREE.MeshStandardMaterial({ color: 0x2f8f7a, roughness: 0.3, metalness: 0.5, emissive: 0x0d3a30, emissiveIntensity: 0.4 })
);
towerFan.position.y = 0.3;
towerFan.rotation.x = Math.PI / 2;
captureTower.add(towerFan);

// 원자력 발전소 냉각탑 (미래 예측 탭 레버 전용, state.nuclear가 있을 때만 보임)
// 쌍곡면 모양이라야 냉각탑으로 읽힌다 - 반지름 r(y) = a·√(1 + ((y−허리)/b)²) 를 돌려 만든다.
const coolingTowers = [];
{
  const H = 0.26, waist = H * 0.68, a = 0.045, b = 0.11;
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const y = H * i / 12;
    prof.push(new THREE.Vector2(a * Math.sqrt(1 + ((y - waist) / b) ** 2), y));
  }
  const towerGeo = new THREE.LatheGeometry(prof, 24);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.85, side: THREE.DoubleSide });
  const steamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
  [[0.66, 0.95], [0.86, 1.24]].forEach(([x, z]) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(towerGeo, towerMat);
    body.castShadow = true;
    g.add(body);
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), steamMat);
    steam.scale.set(1, 0.7, 1);
    steam.position.y = H + 0.03;
    g.add(steam);
    g.position.set(x, CITY_BASE, z);
    g.visible = false;
    cityGroup.add(g);
    coolingTowers.push(g);
  });
}

// 태양광 패널 (미래 예측 탭 레버 전용, state.renew 비중만큼 개수가 늘어남)
// 패널은 수십 장이라 InstancedMesh 하나로 그려 드로우콜을 1번으로 묶는다.
// 자리는 건물·도로·냉각탑이 없는 도시 구역 앞쪽 빈 땅 (z 0.8~1.35, 세로 도로 x≈0.09는 비움)
const SOLAR_SPOTS = [];
for (const z of [0.82, 0.95, 1.08, 1.21, 1.34]) {
  for (let x = -0.85; x <= 0.40; x += 0.11) if (Math.abs(x - CROSS_ROAD_X) > 0.09) SOLAR_SPOTS.push([x, z]);
}
const solarPanels = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.08, 0.004, 0.055),
  new THREE.MeshStandardMaterial({ color: 0x1d3b6e, roughness: 0.3, metalness: 0.6, emissive: 0x0a1a33, emissiveIntensity: 0.3 }),
  SOLAR_SPOTS.length);
{
  const d = new THREE.Object3D();
  SOLAR_SPOTS.forEach(([x, z], i) => {
    d.position.set(x, CITY_BASE + 0.022, z);
    d.rotation.set(-0.5, 0, 0);       // 해(앞쪽 위)를 향해 기울임
    d.updateMatrix();
    solarPanels.setMatrixAt(i, d.matrix);
  });
  solarPanels.instanceMatrix.needsUpdate = true;
}
solarPanels.count = 0;
solarPanels.visible = false;
cityGroup.add(solarPanels);

// ── 도시가 역사를 따라 자란다 (2차 개편 D3, 종이 탭 인간활동 지구만) ──
// 예전 도시(건물 8채·공장 1개·자동차 12대, 자동차 한 대가 메시 10개)는 고정 모양이라 1750년에도 빌딩이 서 있었다.
// 종이 탭은 아래 인스턴싱 도시로 바꾸고 예전 것은 숨긴다(직접 실험 탭은 예전 그대로).
const city = PAPER && !opts.nature ? buildCityGrowth(cityGroup, CITY_BASE, stackTex) : null;
// 자연 지구: 도시 구역 자리에 나무·풀 (인스턴싱). 1750~2200 내내 그대로다 - 그것이 보여 줄 내용이다(D6)
if (WILD) buildWilderness(cityGroup, (x, z) => CITY_BASE + terrainNoise(x, -z, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED + 2.3));
if (city) {
  buildingMeshes.forEach(b => { b.visible = false; });
  carMeshes.forEach(c => { c.visible = false; });
  factory.visible = false;
  smoke.visible = false;
}

return {
  paper: PAPER, city, clouds, predictFx, glacier, coral, shells, co2Dots, atmosphere, haze, scene, lidMat, atmoMat, atmoGeo, atmoCount, atmoSeed, atmoBase,
  hazeMat, dropMat, dropGeo, dropCount, dropSeed, iceMeshes,
  wavePosAttr, waveBase, waveD, waveBaseY, waveGeo,
  foamGeo, foamCount, foamSeed, foamBaseArr,
  bubbleGeo, bubbleCount, bubbleSeed, bubbleBaseArr, bubbleMat,
  waterBody, waterNominalH, WATER_CLEAR, WATER_MURKY, waveMat, WAVE_CLEAR, WAVE_MURKY,
  carMeshes, evCarMat, gasCarMat,
  smokeMat, smokeGeo, smokeCount, smokeLife, factory, smoke, roads: [mainRoad, crossRoad],
  buildingMeshes, captureTower, towerFan, wetlandPatch, treeMeshes, grassMesh, leafMat,
  coolingTowers, solarPanels,
  CLEAR_SKY, HAZY_SKY, TERRAIN_TOP, BOX_H, CITY_BASE, OCEAN_BASE,
  condensationSpeed: 1,
  bubbleSpeed: 1,
  state: { fossil: 50, cityRatio: 50, ev: 30, carbonRemoval: 20, wetlandRatio: 30, co2: 418.24, ph: 8.04, tmp: 24, hum: 55, methane: 200 }
};
} // buildAcrylicScene 끝

// 3D 씬(자동차·건물·연기·습지 등)은 그대로 유지하되, 정책 슬라이더가 없어졌으므로
// 아래 고정값으로 대체. CO2 값만 미래예측 탭 슬라이더/실시간 실험 탭 값으로 실시간 갱신됨.
// CO2_MIN / CO2_MAX 는 js/earth-model.js 에서 온다 (1인칭 모드와 공유, 280~1000).
// 예전엔 여기서 280~600으로 따로 잡고 있었다. 그래서 (1) 1인칭 모드와 축이 달랐고,
// (2) 실시간 실험 탭이 센서값을 600으로 잘라내고 있었다 - 교실 실내 CO2는 800~1500이
// 예사라서 실측을 하면 계속 상한에 붙어 있었다.
// 실시간 실험 탭에서만 쓰이는 실측 매핑 범위 (센서 실측값 → 3D 시각효과)
const PH_MIN = 7.6, PH_MAX = 8.2;   // 해양 산성화 정상역
const TMP_MIN = 15, TMP_MAX = 35;   // 기온(°C)
const HUM_MIN = 30, HUM_MAX = 90;   // 습도(%)
const CH4_MIN = 200, CH4_MAX = 4000; // 메탄(ppm, MQ-4류 센서 기준) - MIN 이하는 기포 효과 없음

// ── Chart.js 다크 테마 공통 옵션 (현재/미래 탭 차트가 공유) ──────────────
const gridColor = 'rgba(255,255,255,0.06)';
const textColor = '#7d838d';
const lineOpts = (yLabel) => ({ responsive: true, maintainAspectRatio: false, animation: false,
  scales: {
    x: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
    y: { title: { display: true, text: yLabel, color: textColor, font: { size: 9 } },
         ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
  },
  plugins: { legend: { display: false } } });
const scatterOpts = (yLabel) => ({ responsive: true, maintainAspectRatio: false, animation: false,
  scales: {
    x: { min: CO2_MIN, max: CO2_MAX, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
    y: { title: { display: true, text: yLabel, color: textColor, font: { size: 9 } },
         ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
  },
  plugins: { legend: { display: false } } });

function applyState(S) {
  if (S.dormant) return; // 아직 안 만든 화면의 아크릴 (sceneFor 참고) - 값만 기억해 두고 만들 때 반영
  // CO2 출력값을 0~1 강도로 정규화 (미래예측 슬라이더 범위 280~600ppm 기준)
  const intensity = Math.min(1, Math.max(0, (S.state.co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  if (S.paper) {
    // 종이 탭(2차 개편 D2): CO₂는 무색 - 뚜껑은 늘 맑게, 안개·노란 입자는 만들 때 숨겼다.
    // 농도는 [CO₂ 보기]를 켰을 때만 점 개수로 보인다 ("공기만 노래지는 효과" 피드백, 노란 안개 = 스모그 오개념)
    S.lidMat.opacity = 0.12;
    S.lidMat.color.copy(S.CLEAR_SKY);
    S.co2Dots.visible = VIEW3D.co2;
    S.co2Dots.geometry.setDrawRange(0, EarthVisual.co2DotCount(S.state.co2));
  } else {
    // 직접 실험 탭: 예전 그대로 (실측 CO₂ → 뚜껑·입자·안개 색)
    S.lidMat.opacity = 0.12 + intensity * 0.35;
    S.lidMat.color.lerpColors(S.CLEAR_SKY, S.HAZY_SKY, intensity);
    S.atmoMat.opacity = 0.35 + intensity * 0.45;
    S.atmoMat.color.setHSL(0.55 - intensity * 0.46, 0.55, 0.75 - intensity * 0.15);
    S.hazeMat.opacity = 0.04 + intensity * 0.18;
  }

  if (S.paper) {
    applyOceanPaper(S);
  } else {
  // 실측 pH → 해양 산성화 시각화: 낮을수록 물이 탁하고 어두운 색으로, 투명도(transmission)도 낮아짐
  const phIntensity = Math.min(1, Math.max(0, (PH_MAX - S.state.ph) / (PH_MAX - PH_MIN)));
  S.waterBody.material.color.lerpColors(S.WATER_CLEAR, S.WATER_MURKY, phIntensity);
  S.waterBody.material.opacity = 0.82 + phIntensity * 0.16;
  S.waterBody.material.roughness = 0.15 + phIntensity * 0.55;    // 탁해질수록 광택↓(진흙 느낌)
  S.waveMat.color.lerpColors(S.WAVE_CLEAR, S.WAVE_MURKY, phIntensity);
  S.waveMat.transmission = 0.25 * (1 - phIntensity);
  S.waveMat.roughness = 0.1 + phIntensity * 0.5;
  S.waveMat.clearcoat = 0.9 * (1 - phIntensity);   // 맑을 때만 반짝이는 수면, 탁해지면 광택 제거

  // 실측 온도 → 빙하 축소 (CO2 강도와 실측 온도 중 더 강한 쪽을 반영, 시나리오 탭은 co2만 있어 기존과 동일하게 동작)
  const tempIntensity = Math.min(1, Math.max(0, (S.state.tmp - TMP_MIN) / (TMP_MAX - TMP_MIN)));
  // 미래 예측 탭은 엔진 기온 편차로 직접 정한 iceMelt(0~1)를 넣는다 (CO2 강도로 대신하지 않음)
  const iceIntensity = S.state.iceMelt != null ? S.state.iceMelt : Math.max(intensity, tempIntensity);
  const iceK = S.state.iceScale != null ? S.state.iceScale : 1;   // 계절 배수 (미래 예측 탭 관측 계절)
  S.iceMeshes.forEach(o => {
    const shrink = (1 - iceIntensity * 0.5) * iceK;
    o.mesh.scale.setScalar(shrink);
    // 실제 y좌표는 매 프레임 animate()에서 shrinkY + 파도 높이를 합쳐 계산하므로 여기선 오프셋만 저장
    o.shrinkY = -(1 - shrink) * 0.1;
  });
  }   // 직접 실험 탭 바다·빙하 끝

  // 실측 습도 → 응결 물방울 농도·낙하 속도 (역시 co2 강도와 더 강한 쪽 반영)
  const humIntensity = Math.min(1, Math.max(0, (S.state.hum - HUM_MIN) / (HUM_MAX - HUM_MIN)));
  // 종이 탭은 습도 센서가 없고, CO₂로 물방울을 늘리던 대응은 근거가 없어 쓰지 않는다(D 원칙 3)
  const dropIntensity = S.paper ? 0.3 : Math.max(intensity, humIntensity);
  S.dropMat.opacity = 0.45 + dropIntensity * 0.4;
  S.condensationSpeed = 1 + dropIntensity * 1.5;

  // 실측 메탄 → 수조 바닥에서 올라오는 기포 농도·속도 (CH4_MIN 이하면 기포 자체를 숨김)
  const ch4Intensity = Math.min(1, Math.max(0, (S.state.methane - CH4_MIN) / (CH4_MAX - CH4_MIN)));
  S.bubbleMat.opacity = ch4Intensity > 0.02 ? 0.35 + ch4Intensity * 0.5 : 0;
  S.bubbleSpeed = 0.6 + ch4Intensity * 1.8;

  // 종이 탭 인간활동 지구(2차 개편 D3): 도시가 배출 역사를 따라 자란다 (예전 건물·공장·자동차는 만들 때 숨겼다)
  if (S.city) applyCity(S, S.state.city);
  // 자동차: 도시화 지수만큼 전체 대수, 그중 전기차 비율만큼 친환경 색으로
  const carCount = Math.round((S.state.cityRatio / 100) * S.carMeshes.length);
  const evCount = Math.round(carCount * (S.state.ev / 100));
  // 미래 예측 탭의 "자연만 있는 지구"(state.nature)는 도시 구역의 인공물을 숨긴다 (지면은 그대로)
  const nat = !!S.state.nature;
  S.carMeshes.forEach((c, i) => {
    c.visible = !nat && !S.city && i < carCount;
    const mat = i < evCount ? S.evCarMat : S.gasCarMat;
    c.userData.bodyParts.forEach(p => { p.material = mat; });
  });

  // 화석연료 사용 비율 → 공장 연기 밀도
  S.smokeMat.opacity = 0.15 + (S.state.fossil / 100) * 0.6;
  S.smokeMat.size = 0.03 + (S.state.fossil / 100) * 0.06;

  // 도시화 지수 → 표시되는 건물 수
  const bCount = Math.max(1, Math.round((S.state.cityRatio / 100) * S.buildingMeshes.length));
  S.buildingMeshes.forEach((bld, i) => { bld.visible = !nat && !S.city && i < bCount; });
  S.factory.visible = !nat && !S.city;
  S.smoke.visible = !nat && !S.city;
  S.roads.forEach(r => { r.visible = !nat; });

  // 탄소제거기술 도입률 → 포집 타워 등장/크기
  const crScale = S.state.carbonRemoval / 100;
  S.captureTower.visible = !nat && crScale > 0.02;
  S.captureTower.scale.setScalar(0.3 + crScale * 0.7);

  // 원자력·재생 비중 → 냉각탑·태양광 패널 (미래 예측 탭만 이 값을 넣는다. 다른 탭은 숨김)
  const nuc = S.state.nuclear, ren = S.state.renew;
  S.coolingTowers.forEach((g, i) => {
    g.visible = !nat && nuc != null && nuc > (i === 0 ? 0.01 : 0.25);
    if (nuc != null) g.scale.setScalar(0.7 + 0.9 * Math.min(1, nuc / 0.5));
  });
  S.solarPanels.visible = !nat && ren != null && ren > 0.005;
  if (ren != null) S.solarPanels.count = Math.round(Math.min(1, ren) * S.solarPanels.instanceMatrix.count);

  // 습지 비율 → 습지 패치 크기, 겹치는 나무는 숨김
  const wetRadius = 0.15 + (S.state.wetlandRatio / 100) * 0.85;
  S.wetlandPatch.scale.setScalar(wetRadius / 0.1);
  // treeFrac(0~1)이 있으면 그 비율만큼만 나무를 보인다 (미래 예측 탭 산림 레버: 벌채면 줄고 조림이면 늘어남)
  const treeShown = S.state.treeFrac != null ? Math.round(S.state.treeFrac * S.treeMeshes.length) : S.treeMeshes.length;
  S.treeMeshes.forEach((t, i) => {
    const dx = t.baseX - S.wetlandPatch.position.x;
    const dz = t.baseZ - S.wetlandPatch.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    t.group.visible = dist > wetRadius * 0.9 && i < treeShown;
  });

  // 계절 → 나뭇잎 색 (leafColor가 null이면 잎이 진 겨울나무). undefined면 다른 탭이라 그대로 둔다.
  if (S.state.leafColor !== undefined) {
    S.leafMat.visible = S.state.leafColor !== null;
    if (S.state.leafColor !== null) S.leafMat.color.setHex(S.state.leafColor);
  }

  // 습지 비율/실측 습도 중 더 강한 쪽 → 풀 인스턴싱 밀도
  const grassIntensity = Math.max(S.state.wetlandRatio / 100, humIntensity);
  S.grassMesh.count = Math.max(20, Math.round(grassIntensity * S.grassMesh.instanceMatrix.count));
}

// ================= 애니메이션 =================
// 미래 예측 탭은 같은 렌더러로 두 지구(자연 | 인간활동)를 좌우에 그린다. tab-future.js가
// splitView = { tab, left, right } 를 정해 두면 그 탭에서만 화면을 반으로 나눠 두 씬을 그리고,
// 카메라 하나를 같이 써서 회전·줌이 두 지구에 똑같이 걸린다. 다른 탭은 지금처럼 하나만 그린다.
let splitView = null;
// 성능 확인용: 한 프레임에 실제로 나간 드로우콜 수 (두 씬을 그리면 두 번의 render 합계)
renderer.info.autoReset = false;
let lastFrameDrawCalls = 0;
let t = 0;
function setCameraAspect(a) {
  if (Math.abs(camera.aspect - a) > 1e-6) { camera.aspect = a; camera.fov = fovForAspect(a); camera.updateProjectionMatrix(); }
}
function animate() {
  requestAnimationFrame(animate);
  t += 0.016;
  renderer.info.reset();

  // 수면 노멀맵을 서서히 흘려서 잔물결이 흐르는 느낌을 줌 (3개 씬이 텍스처를 공유해서 한 번만 갱신하면 됨)
  waterNormalTex.offset.x = (t * 0.015) % 1;
  waterNormalTex.offset.y = (t * 0.008) % 1;

  const w = glContainer.clientWidth, h = glContainer.clientHeight;
  if (splitView && activeTab === splitView.tab && !splitView.left.dormant && !splitView.right.dormant) {
    const half = Math.floor(w / 2);
    stepScene(splitView.left); stepScene(splitView.right);
    setCameraAspect(half / h);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, half, h); renderer.setScissor(0, 0, half, h);
    renderer.render(splitView.left.scene, camera);
    renderer.setViewport(half, 0, w - half, h); renderer.setScissor(half, 0, w - half, h);
    renderer.render(splitView.right.scene, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  } else {
    const S = bundles[activeTab];
    stepScene(S);
    setCameraAspect(w / h);
    renderer.render(S.scene, camera);
  }
  lastFrameDrawCalls = renderer.info.render.calls;
}

// 씬 하나의 한 프레임 움직임 (파도·입자·연기 등). 그리기는 animate()가 한다.
function stepScene(S) {
  S.towerFan.rotation.z = t * (0.5 + S.state.carbonRemoval / 100 * 1.5);
  if (S.clouds) stepClouds(S.clouds);   // 구름 흐름은 연출 움직임이라 렌더 루프에서 (상태 계산 아님)
  if (S.predictFx) stepPredictFx(S.predictFx, !!S.predictOn);

  // [CO₂ 보기] 점 구름: 보일 때만, 보이는 개수만 천천히 떠다니게
  if (S.co2Dots && S.co2Dots.visible) {
    const cp = S.co2Dots.geometry.attributes.position, { base, seed } = S.co2Dots.userData;
    const n = S.co2Dots.geometry.drawRange.count;
    for (let i = 0; i < n; i++) {
      const ph = seed[i * 2], sp = seed[i * 2 + 1];
      cp.array[i * 3] = base[i * 3] + Math.sin(t * sp + ph) * 0.05;
      cp.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * sp * 0.7 + ph * 1.3) * 0.03;
      cp.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * sp + ph) * 0.05;
    }
    cp.needsUpdate = true;
  }

  // 대기 입자 드리프트 (종이 탭은 숨겨 둔 입자라 계산하지 않는다)
  const ap = S.atmoGeo.attributes.position;
  if (!S.paper) for (let i = 0; i < S.atmoCount; i++) {
    const phase = S.atmoSeed[i * 3], speed = S.atmoSeed[i * 3 + 1], radius = 0.06 + S.atmoSeed[i * 3 + 2] * 0.05;
    ap.setX(i, S.atmoBase[i * 3] + Math.sin(t * speed + phase) * radius);
    ap.setY(i, S.atmoBase[i * 3 + 1] + Math.sin(t * speed * 0.6 + phase * 1.7) * radius * 0.6);
    ap.setZ(i, S.atmoBase[i * 3 + 2] + Math.cos(t * speed + phase) * radius);
  }
  ap.needsUpdate = true;

  // 비대칭 브레이킹 웨이브: 정면(카메라 쪽)으로 갈수록 크게 말려 부서지는 느낌
  // 종이 탭은 파도 세기를 CO₂에 묶지 않는다(근거 없는 대응, D 원칙 1·3) - 잔잔한 고정값
  const intensity = S.paper ? 0.2 : Math.min(1, Math.max(0, (S.state.co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  const halfD = S.waveD / 2;
  for (let i = 0; i < S.wavePosAttr.count; i++) {
    const lx = S.waveBase[i * 3];
    const ly = S.waveBase[i * 3 + 1];
    S.wavePosAttr.setZ(i, waveHeightAt(lx, ly, t, intensity, halfD));
  }
  S.wavePosAttr.needsUpdate = true;
  S.waveGeo.computeVertexNormals();

  // 빙하도 표면과 동일한 수식으로 그 자리의 파도 높이를 계산해 매 프레임 함께 오르내리게 함
  S.iceMeshes.forEach(o => {
    const lx = o.mesh.position.x, ly = -o.mesh.position.z;
    o.mesh.position.y = o.baseY + o.shrinkY + waveHeightAt(lx, ly, t, intensity, halfD);
  });

  // 해수 몸통(waterBody)도 정면 파도 높이에 맞춰 매 프레임 위아래로 함께 움직이게 해서
  // 출렁이는 표면과 옆면 있는 몸통이 따로 놀지 않고 하나의 물처럼 보이게 함.
  // 바닥(모래, OCEAN_BASE)은 고정하고 윗면만 scale.y로 늘였다 줄였다 하는 방식
  const frontSeaLevel = waveHeightAt(0, -halfD, t, intensity, halfD);
  const liveTopY = S.waveBaseY + frontSeaLevel + WATER_SYNC_BUFFER;
  const liveWaterH = Math.max(0.03, liveTopY - S.OCEAN_BASE);
  S.waterBody.scale.y = liveWaterH / S.waterNominalH;
  S.waterBody.position.y = S.OCEAN_BASE + liveWaterH / 2;

  // 크레스트 포말 파티클: 살짝 흔들리며 부서지는 느낌
  const fp = S.foamGeo.attributes.position;
  for (let i = 0; i < S.foamCount; i++) {
    const phase = S.foamSeed[i * 2], speed = S.foamSeed[i * 2 + 1];
    fp.setX(i, S.foamBaseArr[i * 3] + Math.sin(t * speed + phase) * 0.02);
    fp.setY(i, S.waveBaseY + 0.06 + Math.abs(Math.sin(t * speed * 1.4 + phase)) * 0.02);
  }
  fp.needsUpdate = true;

  // 응결 물방울: 아래로 서서히 흘러내리다가 지형 근처에서 리셋
  const dp = S.dropGeo.attributes.position;
  for (let i = 0; i < S.dropCount; i++) {
    let y = dp.getY(i) - S.dropSeed[i * 2] * 0.01 * S.condensationSpeed;
    if (y < S.TERRAIN_TOP + 0.05) y = S.BOX_H - 0.1;
    dp.setY(i, y);
  }
  dp.needsUpdate = true;

  // 메탄 기포: 바닥에서 수면 근처까지 올라오다 리셋, 살짝 좌우로 흔들리며 상승
  const bp = S.bubbleGeo.attributes.position;
  for (let i = 0; i < S.bubbleCount; i++) {
    let y = bp.getY(i) + S.bubbleSeed[i * 2] * 0.012 * S.bubbleSpeed;
    if (y > S.waveBaseY - 0.03) y = S.OCEAN_BASE + 0.01;
    bp.setY(i, y);
    bp.setX(i, S.bubbleBaseArr[i * 3] + Math.sin(t * 2.5 + S.bubbleSeed[i * 2 + 1]) * 0.008);
  }
  bp.needsUpdate = true;

  // 종이 탭 도시의 굴뚝 연기: 켜진 굴뚝의 입자만, 그해 배출이 클수록 빨리 오른다
  if (S.city && S.city.smokeGeo.drawRange.count > 0) {
    const C = S.city, arr = C.smokeGeo.attributes.position.array, base = S.CITY_BASE;
    const lvl = S.state.city ? S.state.city.stackLevel : 0;
    for (let j = 0; j < C.smokeGeo.drawRange.count; j++) {
      C.smokeLife[j] += 0.006 + lvl * 0.01;
      if (C.smokeLife[j] > 1) C.smokeLife[j] -= 1;
      const life = C.smokeLife[j], [x, z] = C.STACKS[Math.floor(j / C.SMOKE_PER)];
      arr[j * 3] = x + 0.025 + Math.sin(j * 12.9) * 0.05 * life + life * 0.08;   // 바람에 살짝 기울게
      arr[j * 3 + 1] = base + 0.29 + life * 0.7;
      arr[j * 3 + 2] = z + Math.cos(j * 7.3) * 0.05 * life;
    }
    C.smokeGeo.attributes.position.needsUpdate = true;
  }

  // 연기 파티클 (예전 공장 - 종이 탭 인간활동 지구는 숨겨 둠)
  const sp = S.smokeGeo.attributes.position;
  if (S.smoke.visible) for (let i = 0; i < S.smokeCount; i++) {
    S.smokeLife[i] += 0.01 + (S.state.fossil / 100) * 0.015;
    if (S.smokeLife[i] > 1) S.smokeLife[i] = 0;
    const life = S.smokeLife[i];
    sp.setX(i, S.factory.position.x + Math.sin(i * 12.9) * 0.05 * life);
    sp.setY(i, S.CITY_BASE + 0.35 + life * 0.9);
    sp.setZ(i, S.factory.position.z + Math.cos(i * 7.3) * 0.05 * life);
  }
  sp.needsUpdate = true;

}

// ================= 화면별 아크릴은 필요할 때만 만들기 =================
// 대시보드(index.html)에는 현재 실태·미래 예측·직접 실험 세 화면이 들어 있지만, 시작 화면에서 하나를
// 골라 들어오므로 한 번에 하나만 보인다. 예전처럼 세 화면 아크릴을 다 만들면 둘은 만들기만 하고 안 쓰는
// 셈이라(나무·물·건물 한 세트씩), 지금 연 화면 것만 만든다. 나머지는 state만 가진 빈 껍데기로 두고,
// 그 화면을 실제로 열 때 ensureSceneBuilt()가 같은 객체를 채운다 - 탭 코드가 들고 있는 sceneFuture 같은
// 변수가 그대로 같은 객체를 가리키므로 탭 코드는 고칠 필요가 없다.
const DASHBOARD_TAB = new URLSearchParams(location.search).get('tab') || 'current';
// paper: 종이 테마 탭(현재 실태·미래 예측)의 씬인가 - 2차 개편 D의 새 3D 표현은 이 씬에서만 만든다
// predictFx: 받침대 연산 효과(2차 F6)를 만들 씬인가 - 미래 예측 탭만
function sceneFor(tab) {
  const opts = { paper: tab !== 'live', predictFx: tab === 'future' };
  return tab === DASHBOARD_TAB ? Object.assign(buildAcrylicScene(opts), { opts }) : { dormant: true, opts, state: {} };
}
function ensureSceneBuilt(S) {
  if (!S || !S.dormant) return S;
  const kept = S.state;            // 껍데기일 때 탭 코드가 넣어 둔 값(예: 슬라이더 CO2)은 살린다
  Object.assign(S, buildAcrylicScene(S.opts || {}));
  Object.assign(S.state, kept);
  S.dormant = false;
  return S;
}