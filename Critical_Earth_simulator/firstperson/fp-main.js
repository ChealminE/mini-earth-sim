// ============================================================================
// 1인칭 모드 - 부트스트랩 & 프레임 루프
// ============================================================================
const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const camera = new THREE.PerspectiveCamera(75, 1, 0.002, 60);

buildFirstPersonWorld(renderer);
applyWorldCO2(418);
FPPlayer.init(camera, glCanvas);

function fit() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', fit);
fit();

// ── 화면 밝기 슬라이더 (main 브랜치와 동일한 이유: 노트북마다 체감 밝기가 달라서) ──
const brightness = document.getElementById('brightnessSlider');
const savedExposure = Number(localStorage.getItem('fpExposure'));
if (savedExposure) { renderer.toneMappingExposure = savedExposure; brightness.value = savedExposure; }
brightness.addEventListener('input', () => {
  renderer.toneMappingExposure = Number(brightness.value);
  localStorage.setItem('fpExposure', brightness.value);
});

// ── CO2 슬라이더: 걸어다니면서 하늘이 흐려지는 걸 실시간으로 보게 하는 게 목적 ──
const co2Slider = document.getElementById('co2Slider');
const co2Out = document.getElementById('co2Out');
co2Slider.addEventListener('input', () => {
  co2Out.textContent = co2Slider.value;
  applyWorldCO2(Number(co2Slider.value));
});

// ── HUD ─────────────────────────────────────────────────────────────────────
const hudZone = document.getElementById('hudZone');
const hudPos = document.getElementById('hudPos');
const hudMode = document.getElementById('hudMode');
const waterOverlay = document.getElementById('waterOverlay');
let hudTimer = 0;

// ── 프레임 루프 ─────────────────────────────────────────────────────────────
let t = 0, last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  t += dt;

  FPPlayer.update(dt, t);
  updateSunShadow(FPPlayer.pos.x, FPPlayer.pos.z);

  // 수면 파도 (원본과 동일한 수식 - 1인칭에선 눈앞에서 출렁이는 게 보임)
  const intensity = Math.min(1, Math.max(0, (FPWorld.co2 - 280) / 320));
  const halfD = FPWorld.waveD / 2;
  const pa = FPWorld.wavePosAttr, base = FPWorld.waveBase;
  for (let i = 0; i < pa.count; i++) {
    pa.setZ(i, FPWorld.waveHeightAt(base[i * 3], base[i * 3 + 1], t, intensity, halfD));
  }
  pa.needsUpdate = true;
  FPWorld.waveGeo.computeVertexNormals();
  FPWorld.waterNormal.offset.x = (t * 0.012) % 1;
  FPWorld.waterNormal.offset.y = (t * 0.007) % 1;

  // 공장 연기
  const sm = FPWorld.smoke;
  const sp = sm.geo.attributes.position;
  for (let i = 0; i < sm.count; i++) {
    sm.life[i] += dt * (0.12 + (i % 7) * 0.012);
    if (sm.life[i] > 1) sm.life[i] = 0;
    const life = sm.life[i];
    sp.setXYZ(i,
      sm.x + Math.sin(i * 12.9 + t * 0.3) * 0.06 * life,
      FPWorld.GROUND_BASE + 0.35 + life * 0.75,
      sm.z + Math.cos(i * 7.3 + t * 0.2) * 0.06 * life);
  }
  sp.needsUpdate = true;
  FPWorld.towerFan.rotation.z = t * 1.4;

  // 수중 화면 효과
  waterOverlay.classList.toggle('on', FPPlayer.underwater);

  // HUD는 초당 몇 번만 갱신 (매 프레임 DOM을 건드릴 이유가 없음)
  hudTimer += dt;
  if (hudTimer > 0.12) {
    hudTimer = 0;
    hudZone.textContent = FPPlayer.currentZone();
    // 1유닛=50m 환산으로 미터 표기 - 스케일을 체감하게 하려는 의도
    hudPos.textContent =
      `X ${(FPPlayer.pos.x * 50).toFixed(0)}m · Z ${(FPPlayer.pos.z * 50).toFixed(0)}m · 고도 ${((FPPlayer.pos.y - FPWorld.OCEAN_BASE) * 50).toFixed(1)}m`;
    const mode = [];
    if (FPPlayer.flying) mode.push('비행');
    if (FPPlayer.thirdPerson) mode.push('3인칭');
    if (FPPlayer.inWater) mode.push('수영');
    else if (FPPlayer.crouching) mode.push('앉기');
    else if (FPPlayer.sprinting) mode.push('달리기');
    hudMode.textContent = mode.length ? mode.join(' · ') : '걷기';
  }

  renderer.render(FPWorld.scene, camera);
}
animate();
