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

// ================= 아크릴 모형: 탭마다 독립적인 씬을 만드는 팩토리 함수 =================
function buildAcrylicScene() {
const scene = new THREE.Scene();
// r160부터 물리기반(광도 단위) 조명만 지원해서 SpotLight 밝기 스케일이 달라짐(약 4π배 보정 필요)
const sun = new THREE.SpotLight(0xfff6e0, 3.2 * 4 * Math.PI, 20, Math.PI / 5, 0.35, 1.2);
sun.position.set(3.4, 3.6, 2.2);
sun.target.position.set(0.6, 0.3, 0.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0015;
scene.add(sun, sun.target);
// 색공간 관리(ColorManagement)가 기본 활성화되면서 실내 벽면이 예전보다 어둡게 보여 소폭 보정
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const rim = new THREE.DirectionalLight(0xdfe8f5, 0.35);
rim.position.set(-5, 3, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c9c4, 0.65));

// 집게형 조명 스탠드 (사진 속 실제 조명 모형)
const lampGroup = new THREE.Group();
lampGroup.position.set(3.6, 0, 2.0);
scene.add(lampGroup);
const lampArmMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.4 });
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 16), lampArmMat);
lampBase.position.y = 2.5;
lampGroup.add(lampBase);
const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8), lampArmMat);
lampArm.position.set(-0.2, 2.05, -0.1);
lampArm.rotation.z = Math.PI / 3.4;
lampGroup.add(lampArm);
const lampHead = new THREE.Mesh(
  new THREE.ConeGeometry(0.16, 0.22, 20, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })
);
lampHead.position.set(-0.72, 1.42, -0.42);
lampHead.rotation.x = Math.PI * 0.62;
lampGroup.add(lampHead);
const lampBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff4d0 })
);
lampBulb.position.set(-0.72, 1.36, -0.42);
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
const OCEAN_BASE = TERRAIN_TOP * 0.38;   // 바다: 모래바닥 (그 위를 물이 채움)
const WETLAND_BASE = TERRAIN_TOP * 0.78; // 습지·숲: 지표면
const CITY_BASE = TERRAIN_TOP * 0.96;    // 도시: 가장 높음, 거의 지형 상한까지
const ZONE_W = BOX_W / 3;
const box = new THREE.Group();
scene.add(box);

const acrylicMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 0.06,
  roughness: 0.02, transmission: 0.97, thickness: 0.05,
  side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.05
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
const hazeMat = new THREE.MeshBasicMaterial({ color: HAZY_SKY.clone(), transparent: true, opacity: 0, side: THREE.BackSide });
const haze = new THREE.Mesh(new THREE.BoxGeometry(BOX_W - 0.02, BOX_H - TERRAIN_TOP - 0.05, BOX_D - 0.02), hazeMat);
haze.position.y = TERRAIN_TOP + (BOX_H - TERRAIN_TOP) / 2;
box.add(haze);

// 4) 박스 위쪽 가장자리에 얹힌 얼음(구름 역할) 덩어리 클러스터
const cloudIceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, transmission: 0.5, clearcoat: 1, flatShading: true });
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

// --- 절차적 지표 텍스처 (흙/이끼/자갈 얼룩무늬) ---
function createGroundTexture(opts) {
  const cw = 256, ch = 256;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const tctx = c.getContext('2d');
  tctx.fillStyle = opts.base;
  tctx.fillRect(0, 0, cw, ch);
  opts.speckLayers.forEach(layer => {
    for (let i = 0; i < layer.count; i++) {
      const x = Math.random() * cw, y = Math.random() * ch;
      const r = layer.minR + Math.random() * (layer.maxR - layer.minR);
      tctx.fillStyle = layer.color;
      tctx.globalAlpha = layer.alpha;
      tctx.beginPath();
      tctx.arc(x, y, r, 0, Math.PI * 2);
      tctx.fill();
    }
  });
  tctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const oceanFloorTex = createGroundTexture({
  base: '#c9c2a8',
  speckLayers: [
    { count: 220, minR: 1, maxR: 3, color: '#a89f80', alpha: 0.5 },
    { count: 60, minR: 2, maxR: 5, color: '#8f8567', alpha: 0.4 }
  ]
});
const forestFloorTex = createGroundTexture({
  base: '#3f4a2a',
  speckLayers: [
    { count: 260, minR: 1, maxR: 4, color: '#5a6e35', alpha: 0.55 }, // 이끼
    { count: 160, minR: 1, maxR: 3, color: '#2c3520', alpha: 0.5 }, // 그늘진 흙
    { count: 40, minR: 2, maxR: 5, color: '#6b7d42', alpha: 0.4 }
  ]
});
const cityFloorTex = createGroundTexture({
  base: '#4a4842',
  speckLayers: [
    { count: 300, minR: 1, maxR: 2.5, color: '#615e56', alpha: 0.6 }, // 자갈
    { count: 80, minR: 1, maxR: 2, color: '#2e2c28', alpha: 0.5 }
  ]
});

function zoneFloor(xOffset, groundTopY, texture, sideColor) {
  const h = Math.max(groundTopY, 0.01);
  const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.95 });
  const topMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
  // BoxGeometry 面 순서: [+x, -x, +y(윗면), -y(밑면), +z, -z]
  const mats = [sideMat, sideMat, topMat, sideMat, sideMat, sideMat];
  const block = new THREE.Mesh(new THREE.BoxGeometry(ZONE_W - 0.015, h, BOX_D - 0.02), mats);
  block.position.set(xOffset, h / 2, 0);
  block.castShadow = true;
  block.receiveShadow = true;
  box.add(block);
  return block;
}
zoneFloor(-ZONE_W, OCEAN_BASE, oceanFloorTex, 0xa89f83);
zoneFloor(0, WETLAND_BASE, forestFloorTex, 0x2c331c);
zoneFloor(ZONE_W, CITY_BASE, cityFloorTex, 0x3a3832);
// 세 블록이 높이가 달라서 경계면(옆면)이 자연스럽게 계단 절벽처럼 드러남 - 별도 리저 불필요


// --- 해양·빙하: 계속 움직이는 돔 파도 ---
const oceanGroup = new THREE.Group();
oceanGroup.position.x = -ZONE_W;
box.add(oceanGroup);

const waveW = ZONE_W - 0.08, waveD = BOX_D - 0.08;
const waveGeo = new THREE.PlaneGeometry(waveW, waveD, 36, 24);
const waveBaseY = TERRAIN_TOP - 0.02; // 물 수면은 지형 상한 바로 아래까지 채움
// pH가 낮아질수록(산성화) WAVE_CLEAR → WAVE_MURKY로 수면 색도 함께 탁해짐
const WAVE_CLEAR = new THREE.Color(0x123a55);
const WAVE_MURKY = new THREE.Color(0x7a6a42);
const waveMat = new THREE.MeshPhysicalMaterial({
  color: WAVE_CLEAR.clone(), transparent: true, opacity: 0.92, roughness: 0.1,
  transmission: 0.25, clearcoat: 0.9, side: THREE.DoubleSide
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
const waterH = Math.max(0.03, waveBaseY - OCEAN_BASE);
const waterBody = new THREE.Mesh(
  new THREE.BoxGeometry(waveW, waterH, waveD),
  new THREE.MeshPhysicalMaterial({ color: WATER_CLEAR.clone(), transparent: true, opacity: 0.75, roughness: 0.15, transmission: 0.2 })
);
waterBody.position.y = OCEAN_BASE + waterH / 2;
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

const iceMat = new THREE.MeshPhysicalMaterial({ color: 0xf3fbff, roughness: 0.1, transmission: 0.25, clearcoat: 0.85, flatShading: true });
const iceMeshes = [];
[[-0.5, -0.4], [0.3, 0.3], [0.55, -0.5], [-0.15, 0.5]].forEach(([x, z]) => {
  const s = 0.045 + Math.random() * 0.03;
  const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), iceMat);
  ice.position.set(x, waveBaseY + s * 0.5, z);
  ice.castShadow = true;
  oceanGroup.add(ice);
  iceMeshes.push({ mesh: ice, baseY: ice.position.y });
});

// --- 습지·숲 ---
const forestGroup = new THREE.Group();
box.add(forestGroup);
const rockMat = new THREE.MeshStandardMaterial({ color: 0x74705f, roughness: 0.95 });
[[-0.6, 0.5], [0.5, -0.55], [-0.5, -0.35]].forEach(([x, z]) => {
  const s = 0.05 + Math.random() * 0.035;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
  rock.position.set(x, WETLAND_BASE + s * 0.5, z);
  rock.castShadow = true;
  forestGroup.add(rock);
});
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.9 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7433, roughness: 0.8 });
const treeDefs = [[-0.3, -0.4], [0.4, 0.4], [0, 0.15], [0.55, -0.15], [-0.55, 0.35], [0.2, -0.55], [-0.15, 0.5]];
const treeMeshes = [];
treeDefs.forEach(([x, z]) => {
  const tree = new THREE.Group();
  // 작은 모종/새싹 느낌: 가는 줄기 + 타원형 잎 여러 장
  const h = 0.14 + Math.random() * 0.09;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, h, 5), trunkMat);
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
  tree.position.set(x, WETLAND_BASE, z);
  forestGroup.add(tree);
  treeMeshes.push({ group: tree, baseX: x, baseZ: z });
});

// 습지 진흙 패치: 일반 흙과 달리 어둡고 젖은 광택 + 얕은 물웅덩이
const wetlandPatch = new THREE.Mesh(
  new THREE.CircleGeometry(0.1, 32),
  new THREE.MeshPhysicalMaterial({ color: 0x2b2318, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 })
);
wetlandPatch.rotation.x = -Math.PI / 2;
wetlandPatch.position.set(-0.2, WETLAND_BASE + 0.006, 0.1);
forestGroup.add(wetlandPatch);
const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x3a6a7a, transparent: true, opacity: 0.75, roughness: 0.05, transmission: 0.3, clearcoat: 1 });
const puddles = [];
[[-0.03, -0.02, 0.035], [0.025, 0.03, 0.028], [-0.02, 0.04, 0.02]].forEach(([px, pz, pr]) => {
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(pr, 16), puddleMat);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(-0.2 + px, WETLAND_BASE + 0.009, 0.1 + pz);
  forestGroup.add(puddle);
  puddles.push(puddle);
});

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
  const bld = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, w),
    new THREE.MeshStandardMaterial({ color: bldColors[i % bldColors.length], roughness: 0.5, metalness: 0.15 })
  );
  bld.position.y = h / 2;
  bld.castShadow = true;
  bld.receiveShadow = true;
  bldGroup.add(bld);
  for (let wy = 0.06; wy < h - 0.03; wy += 0.07) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.75, 0.025),
      new THREE.MeshStandardMaterial({ color: 0xcfe0ea, roughness: 0.2, metalness: 0.3 })
    );
    win.position.set(0, wy, w / 2 + 0.001);
    bldGroup.add(win);
  }
  bldGroup.position.set(x, CITY_BASE, z);
  cityGroup.add(bldGroup);
  buildingMeshes.push(bldGroup);
});

const gasCarMat = new THREE.MeshStandardMaterial({ color: 0x5a5650, roughness: 0.4, metalness: 0.3 });
const evCarMat = new THREE.MeshStandardMaterial({ color: 0x3fb0a0, roughness: 0.3, metalness: 0.4, emissive: 0x0d3a35, emissiveIntensity: 0.3 });
const carSpots = [[-0.65, -0.15], [-0.3, 0.02], [0.05, -0.1], [0.4, 0.05], [0.65, -0.05],
                   [-0.5, 0.35], [-0.1, 0.32], [0.25, 0.3], [0.55, 0.35],
                   [-0.6, -0.55], [-0.05, -0.55], [0.5, -0.55]];
const carMeshes = [];
carSpots.forEach((pos, i) => {
  const car = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.05), gasCarMat);
  car.position.set(pos[0], CITY_BASE + 0.02, pos[1]);
  car.castShadow = true;
  car.visible = false;
  cityGroup.add(car);
  carMeshes.push(car);
});

const factory = new THREE.Group();
factory.position.set(0.6, CITY_BASE, 0.55);
cityGroup.add(factory);
const stack = new THREE.Mesh(
  new THREE.CylinderGeometry(0.03, 0.04, 0.35, 10),
  new THREE.MeshStandardMaterial({ color: 0x50524f, roughness: 0.7 })
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
  waterBody, WATER_CLEAR, WATER_MURKY, waveMat, WAVE_CLEAR, WAVE_MURKY,
  carMeshes, evCarMat, gasCarMat,
  smokeMat, smokeGeo, smokeCount, smokeLife, factory,
  buildingMeshes, captureTower, towerFan, wetlandPatch, treeMeshes,
  CLEAR_SKY, HAZY_SKY, TERRAIN_TOP, BOX_H, CITY_BASE,
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
  S.waterBody.material.transmission = 0.2 * (1 - phIntensity);   // 탁해질수록 투과 거의 0으로
  S.waterBody.material.opacity = 0.75 + phIntensity * 0.24;
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
    o.mesh.position.y = o.baseY - (1 - shrink) * 0.1;
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
    c.material = i < evCount ? S.evCarMat : S.gasCarMat;
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
}

// ================= 애니메이션 =================
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  t += 0.016;
  const S = bundles[activeTab];

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

  // 비대칭 브레이킹 웨이브: 전면(ly 양수 쪽)으로 갈수록 크게 말려 부서지는 느낌
  const intensity = Math.min(1, Math.max(0, (S.state.co2 - CO2_MIN) / (CO2_MAX - CO2_MIN)));
  const halfD = S.waveD / 2;
  for (let i = 0; i < S.wavePosAttr.count; i++) {
    const lx = S.waveBase[i * 3];
    const ly = S.waveBase[i * 3 + 1];
    const frontT = Math.max(0, Math.min(1, (ly / halfD + 1) / 2));
    const swell = Math.sin(lx * 1.5 + t * 0.7) * (0.05 + frontT * 0.09 + intensity * 0.02);
    const chop = Math.sin(lx * 6 + t * 2.1 + ly * 3) * 0.012 * frontT;
    S.wavePosAttr.setZ(i, swell + chop);
  }
  S.wavePosAttr.needsUpdate = true;
  S.waveGeo.computeVertexNormals();

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
