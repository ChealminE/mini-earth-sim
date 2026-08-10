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
FPTools.init(camera);   // 단축바 + 손에 든 도구 (camera를 씬에 넣는 것도 여기서 처리)
FPWeather.init(FPWorld.scene);

function fit() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  FPTools.resize(w / h);
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
const hudCars = document.getElementById('hudCars');
const hudSea = document.getElementById('hudSea');
co2Slider.addEventListener('input', () => {
  co2Out.textContent = co2Slider.value;
  applyWorldCO2(Number(co2Slider.value));
});

// ── 시각 슬라이더 ───────────────────────────────────────────────────────────
// 기본은 정오에 멈춰 있다. 조사 도중에 시간이 흐르면 같은 지점을 다시 재도 값이 달라져
// 자료가 못 쓰게 되기 때문이다. 필요할 때만 흐르게 하고, 평소엔 이 슬라이더로 옮긴다.
const timeSlider = document.getElementById('timeSlider');
const timeOut = document.getElementById('timeOut');
const timeFlowChk = document.getElementById('timeFlowChk');
function syncTimeUI() {
  timeSlider.value = FPWorld.hour.toFixed(2);
  timeOut.textContent = hourLabel(FPWorld.hour);
  timeFlowChk.checked = FPWorld.timeFlowing;
}
timeSlider.addEventListener('input', () => {
  FPWorld.hour = Number(timeSlider.value);
  FPWorld.timeFlowing = false;      // 손으로 옮기면 자동 흐름은 멈춘다
  FPWorld.refresh();                // 광합성량이 바뀌므로 대기 상태도 다시 계산
  syncTimeUI();
});
timeFlowChk.addEventListener('change', () => { FPWorld.timeFlowing = timeFlowChk.checked; });

// ── 계절 ────────────────────────────────────────────────────────────────────
const seasonBtns = document.getElementById('seasonBtns');
function syncSeasonUI() {
  seasonBtns.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.season === FPWorld.season);
  });
}
seasonBtns.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  applySeason(b.dataset.season);
  syncSeasonUI();
  syncTimeUI();          // 일출·일몰이 바뀌므로 시각 표기도 갱신
});
applySeason(FPWorld.season);
syncSeasonUI();

// ── 날씨 ────────────────────────────────────────────────────────────────────
const weatherBtns = document.getElementById('weatherBtns');
const weatherRandomChk = document.getElementById('weatherRandomChk');
function syncWeatherUI() {
  weatherBtns.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.w === FPWeather.kind);
  });
  weatherRandomChk.checked = FPWeather.random;
}
weatherBtns.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  FPWeather.random = false;      // 손으로 고르면 무작위는 끈다
  FPWeather.set(b.dataset.w);
  syncWeatherUI();
});
weatherRandomChk.addEventListener('change', () => {
  FPWeather.setRandom(weatherRandomChk.checked);
});
syncWeatherUI();

// ── 환경음 ──────────────────────────────────────────────────────────────────
// 브라우저는 사용자 조작 없이 소리를 못 내게 막는다. 게임 시작(클릭) 시점에 켠다.
const soundChk = document.getElementById('soundChk');
soundChk.addEventListener('change', () => FPAudio.setEnabled(soundChk.checked));
glCanvas.addEventListener('click', () => { FPAudio.init(); FPAudio.setEnabled(soundChk.checked); });

// ── 야장 ────────────────────────────────────────────────────────────────────
FPField.init();
// 계측기가 값을 '확정'했을 때만 기록한다 (수렴 중인 값은 아직 못 믿는 값이라서)
FPTools.onMeasured = (tool, value, reading) => FPField.record(tool, value, reading);

// ── HUD ─────────────────────────────────────────────────────────────────────
const hudZone = document.getElementById('hudZone');
const hudPos = document.getElementById('hudPos');
const hudMode = document.getElementById('hudMode');
const waterOverlay = document.getElementById('waterOverlay');
const hudTime = document.getElementById('hudTime');
let hudTimer = 0;

// ── 프레임 루프 ─────────────────────────────────────────────────────────────
let t = 0, last = performance.now();
const _wn = [0, 0, 0];   // 파도 법선 임시 버퍼 (프레임마다 새로 할당하지 않으려고 밖에 둠)
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  t += dt;

  FPPlayer.update(dt, t);
  FPTools.update(dt);          // 측정 중인 계측기의 값이 안정되어 가는 과정
  updateTime(dt);              // 시간 흐름이 켜져 있을 때만 동작
  FPWeather.update(dt);        // 비/눈 입자, 번개, 스콜 종료, 무작위 전환
  FPAudio.update(dt);          // 위치·시간·내연차 비율에 맞춰 환경음을 섞는다
  updateSunShadow(FPPlayer.pos.x, FPPlayer.pos.z);

  // 수면 파도: 잔물결까지 형상으로 만들고 매 프레임 법선을 다시 계산해야
  // 환경맵 반사가 물결 기울기를 따라 잘게 반짝인다 (반사가 보이는 핵심)
  const intensity = FPWorld.co2k;
  const halfD = FPWorld.waveD / 2;
  const pa = FPWorld.wavePosAttr, base = FPWorld.waveBase;
  const na = FPWorld.waveGeo.attributes.normal;
  // setZ()/setXYZ()는 정점 7천 개 × 매 프레임이면 호출 오버헤드만으로도 무시 못 할 비용이라
  // 타입드 배열에 직접 쓴다 (needsUpdate만 세워주면 결과는 동일)
  const parr = pa.array, narr = na.array;
  for (let i = 0, p = 0; i < pa.count; i++, p += 3) {
    const lx = base[p], ly = base[p + 1];
    parr[p + 2] = FPWorld.waveHeightAt(lx, ly, t, intensity, halfD);
    FPWorld.waveNormalAt(lx, ly, t, intensity, _wn);
    narr[p] = _wn[0]; narr[p + 1] = _wn[1]; narr[p + 2] = _wn[2];
  }
  pa.needsUpdate = true;
  na.needsUpdate = true;
  // 물 옆면의 윗변도 같은 파도식으로 맞춰 올려 수면과 정확히 맞물리게 한다
  updateWaterWalls(t, intensity, halfD);
  // 미세 법선맵을 서로 다른 속도로 흘려서 정지된 무늬처럼 보이지 않게
  FPWorld.waterNormal.offset.x = (t * 0.02) % 1;
  FPWorld.waterNormal.offset.y = (t * 0.013) % 1;

  updateClouds(dt);
  updateCars(dt);              // 도로 주행 + 앞차 추종 + 교차로 양보
  updateAnimals(dt, t);
  updateOceanLife(dt, t);
  updateExhaust(dt);

  // 공장 연기 (양·속도는 CO2에 따라 applyWorldCO2가 정한 rate를 따름)
  const sm = FPWorld.smoke;
  const sp = sm.geo.attributes.position;
  for (let i = 0; i < sm.count; i++) {
    sm.life[i] += dt * (sm.rate + (i % 7) * 0.012);
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
    hudTime.textContent = hourLabel(FPWorld.hour) + (FPWorld.timeFlowing ? '' : ' · 정지 (T)')
      + ` · ${SEASONS[FPWorld.season].ko} · ${WEATHER[FPWeather.kind].ko}`;
    const gas = FPWorld.gasCarCount, ev = FPWorld.cars.length - gas;
    hudCars.textContent = `내연 ${gas} · 전기 ${ev}`;
    hudSea.textContent =
      `${FPWorld.seaTemp.toFixed(1)}°C · pH ${oceanPH(FPWorld.co2).toFixed(2)} · Ω ${FPWorld.aragonite.toFixed(2)}` +
      ` · 백화 ${Math.round(FPWorld.coralBleaching * 100)}%` +
      ` · 어류 ${FPWorld.aliveFish}/${FPWorld.fish.length} · 수초 ${FPWorld.alivePlants}/${FPWorld.plantTotal}`;
  }

  renderer.render(FPWorld.scene, camera);
  FPTools.render(renderer);   // 손·도구는 깊이 버퍼를 비우고 맨 위에 덧그림
}
animate();
