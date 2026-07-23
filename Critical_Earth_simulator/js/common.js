// ================= 3D 씬 기본 =================
const glContainer = document.getElementById('gl-container');
const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
function fitRenderer() {
  const w = glContainer.clientWidth, h = glContainer.clientHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let camAngleY = -0.5, camAngleX = 0.5, camDist = 8.2;
let isDragging = false, prevX = 0, prevY = 0;
function updateCamera() {
  camera.position.x = camDist * Math.sin(camAngleY) * Math.cos(camAngleX);
  camera.position.z = camDist * Math.cos(camAngleY) * Math.cos(camAngleX);
  camera.position.y = 0.55 + camDist * Math.sin(camAngleX);
  camera.lookAt(0, 0.3, 0);
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

// ================= 아크릴 모형: 탭마다 독립적인 씬을 만드는 팩토리 함수 =================
function buildAcrylicScene() {
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
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const rim = new THREE.DirectionalLight(0xdfe8f5, 0.35);
rim.position.set(-5, 3, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c9c4, 0.4));

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

const table = new THREE.Mesh(
  new THREE.CylinderGeometry(3.6, 3.8, 0.15, 64),
  new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.9 })
);
table.position.y = -0.08;
table.receiveShadow = true;
scene.add(table);

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
const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
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

// 4) 박스 위쪽 가장자리에 얹힌 얼음(구름 역할) 덩어리 클러스터
const cloudIceMat = new THREE.MeshPhysicalMaterial({ map: sharedTex.iceCrack, color: 0xffffff, roughness: 0.1, transmission: 0.5, clearcoat: 1, flatShading: true });
const cloudIcePositions = [[-1.6, -0.5], [-1.3, -0.15], [-1.0, -0.6], [-1.75, -0.1], [-1.15, -0.35]];
cloudIcePositions.forEach(([x, z]) => {
  const s = 0.08 + Math.random() * 0.05;
  const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), cloudIceMat);
  chunk.position.set(x, BOX_H - 0.06 - s * 0.3, z);
  chunk.castShadow = true;
  box.add(chunk);
});

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
zoneFloor(ZONE_W, CITY_BASE, sharedTex.cityPavement, 0x3a3832, 0x9a9a9a);
// 해저·습지 바닥에만 절차적 지형 기복 적용. 도시는 실제로도 평평하게 포장된 땅이라
// (건물·차 등 고정 좌표 소품도 많아 굴곡을 주면 오히려 붕 뜬 것처럼 보임) 그대로 둔다.
createTerrainCap(-ZONE_W, OCEAN_BASE, sharedTex.oceanFloor, OCEAN_TERRAIN_AMP, OCEAN_TERRAIN_SEED);
createTerrainCap(0, WETLAND_BASE, sharedTex.forestGrass, WETLAND_TERRAIN_AMP, WETLAND_TERRAIN_SEED);
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

return {
  scene, lidMat, atmoMat, atmoGeo, atmoCount, atmoSeed, atmoBase,
  hazeMat, dropMat, dropGeo, dropCount, dropSeed, iceMeshes,
  wavePosAttr, waveBase, waveD, waveBaseY, waveGeo,
  foamGeo, foamCount, foamSeed, foamBaseArr,
  waterBody, waterNominalH, WATER_CLEAR, WATER_MURKY, waveMat, WAVE_CLEAR, WAVE_MURKY,
  carMeshes, evCarMat, gasCarMat,
  smokeMat, smokeGeo, smokeCount, smokeLife, factory,
  buildingMeshes, captureTower, towerFan, wetlandPatch, treeMeshes, grassMesh,
  CLEAR_SKY, HAZY_SKY, TERRAIN_TOP, BOX_H, CITY_BASE, OCEAN_BASE,
  condensationSpeed: 1,
  state: { fossil: 50, cityRatio: 50, ev: 30, carbonRemoval: 20, wetlandRatio: 30, co2: 418.24, ph: 8.04, tmp: 24, hum: 55 }
};
} // buildAcrylicScene 끝

// 3D 씬(자동차·건물·연기·습지 등)은 그대로 유지하되, 정책 슬라이더가 없어졌으므로
// 아래 고정값으로 대체. CO2 값만 미래예측 탭 슬라이더/실시간 실험 탭 값으로 실시간 갱신됨.
const CO2_MIN = 280, CO2_MAX = 600;
// 실시간 실험 탭에서만 쓰이는 실측 매핑 범위 (센서 실측값 → 3D 시각효과)
const PH_MIN = 7.6, PH_MAX = 8.2;   // 해양 산성화 정상역
const TMP_MIN = 15, TMP_MAX = 35;   // 기온(°C)
const HUM_MIN = 30, HUM_MAX = 90;   // 습도(%)

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
    x: { min: 280, max: 600, ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } },
    y: { title: { display: true, text: yLabel, color: textColor, font: { size: 9 } },
         ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
  },
  plugins: { legend: { display: false } } });

function applyState(S) {
  // CO2 출력값을 0~1 강도로 정규화 (미래예측 슬라이더 범위 280~600ppm 기준)
  const intensity = Math.min(1, Math.max(0, (S.state.co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  S.lidMat.opacity = 0.12 + intensity * 0.35;
  S.lidMat.color.lerpColors(S.CLEAR_SKY, S.HAZY_SKY, intensity);
  S.atmoMat.opacity = 0.35 + intensity * 0.45;
  S.atmoMat.color.setHSL(0.55 - intensity * 0.46, 0.55, 0.75 - intensity * 0.15);
  S.hazeMat.opacity = 0.04 + intensity * 0.18;

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
  const iceIntensity = Math.max(intensity, tempIntensity);
  S.iceMeshes.forEach(o => {
    const shrink = 1 - iceIntensity * 0.5;
    o.mesh.scale.setScalar(shrink);
    // 실제 y좌표는 매 프레임 animate()에서 shrinkY + 파도 높이를 합쳐 계산하므로 여기선 오프셋만 저장
    o.shrinkY = -(1 - shrink) * 0.1;
  });

  // 실측 습도 → 응결 물방울 농도·낙하 속도 (역시 co2 강도와 더 강한 쪽 반영)
  const humIntensity = Math.min(1, Math.max(0, (S.state.hum - HUM_MIN) / (HUM_MAX - HUM_MIN)));
  const dropIntensity = Math.max(intensity, humIntensity);
  S.dropMat.opacity = 0.45 + dropIntensity * 0.4;
  S.condensationSpeed = 1 + dropIntensity * 1.5;

  // 자동차: 도시화 지수만큼 전체 대수, 그중 전기차 비율만큼 친환경 색으로
  const carCount = Math.round((S.state.cityRatio / 100) * S.carMeshes.length);
  const evCount = Math.round(carCount * (S.state.ev / 100));
  S.carMeshes.forEach((c, i) => {
    c.visible = i < carCount;
    const mat = i < evCount ? S.evCarMat : S.gasCarMat;
    c.userData.bodyParts.forEach(p => { p.material = mat; });
  });

  // 화석연료 사용 비율 → 공장 연기 밀도
  S.smokeMat.opacity = 0.15 + (S.state.fossil / 100) * 0.6;
  S.smokeMat.size = 0.03 + (S.state.fossil / 100) * 0.06;

  // 도시화 지수 → 표시되는 건물 수
  const bCount = Math.max(1, Math.round((S.state.cityRatio / 100) * S.buildingMeshes.length));
  S.buildingMeshes.forEach((bld, i) => { bld.visible = i < bCount; });

  // 탄소제거기술 도입률 → 포집 타워 등장/크기
  const crScale = S.state.carbonRemoval / 100;
  S.captureTower.visible = crScale > 0.02;
  S.captureTower.scale.setScalar(0.3 + crScale * 0.7);

  // 습지 비율 → 습지 패치 크기, 겹치는 나무는 숨김
  const wetRadius = 0.15 + (S.state.wetlandRatio / 100) * 0.85;
  S.wetlandPatch.scale.setScalar(wetRadius / 0.1);
  S.treeMeshes.forEach(t => {
    const dx = t.baseX - S.wetlandPatch.position.x;
    const dz = t.baseZ - S.wetlandPatch.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    t.group.visible = dist > wetRadius * 0.9;
  });

  // 습지 비율/실측 습도 중 더 강한 쪽 → 풀 인스턴싱 밀도
  const grassIntensity = Math.max(S.state.wetlandRatio / 100, humIntensity);
  S.grassMesh.count = Math.max(20, Math.round(grassIntensity * S.grassMesh.instanceMatrix.count));
}

// ================= 애니메이션 =================
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  t += 0.016;
  const S = bundles[activeTab];

  // 수면 노멀맵을 서서히 흘려서 잔물결이 흐르는 느낌을 줌 (3개 씬이 텍스처를 공유해서 한 번만 갱신하면 됨)
  waterNormalTex.offset.x = (t * 0.015) % 1;
  waterNormalTex.offset.y = (t * 0.008) % 1;

  S.towerFan.rotation.z = t * (0.5 + S.state.carbonRemoval / 100 * 1.5);

  // 대기 입자 드리프트
  const ap = S.atmoGeo.attributes.position;
  for (let i = 0; i < S.atmoCount; i++) {
    const phase = S.atmoSeed[i * 3], speed = S.atmoSeed[i * 3 + 1], radius = 0.06 + S.atmoSeed[i * 3 + 2] * 0.05;
    ap.setX(i, S.atmoBase[i * 3] + Math.sin(t * speed + phase) * radius);
    ap.setY(i, S.atmoBase[i * 3 + 1] + Math.sin(t * speed * 0.6 + phase * 1.7) * radius * 0.6);
    ap.setZ(i, S.atmoBase[i * 3 + 2] + Math.cos(t * speed + phase) * radius);
  }
  ap.needsUpdate = true;

  // 비대칭 브레이킹 웨이브: 정면(카메라 쪽)으로 갈수록 크게 말려 부서지는 느낌
  const intensity = Math.min(1, Math.max(0, (S.state.co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)));
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

  // 연기 파티클
  const sp = S.smokeGeo.attributes.position;
  for (let i = 0; i < S.smokeCount; i++) {
    S.smokeLife[i] += 0.01 + (S.state.fossil / 100) * 0.015;
    if (S.smokeLife[i] > 1) S.smokeLife[i] = 0;
    const life = S.smokeLife[i];
    sp.setX(i, S.factory.position.x + Math.sin(i * 12.9) * 0.05 * life);
    sp.setY(i, S.CITY_BASE + 0.35 + life * 0.9);
    sp.setZ(i, S.factory.position.z + Math.cos(i * 7.3) * 0.05 * life);
  }
  sp.needsUpdate = true;

  renderer.render(S.scene, camera);
}
