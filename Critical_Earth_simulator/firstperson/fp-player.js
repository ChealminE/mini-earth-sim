// ============================================================================
// 1인칭 모드 - 플레이어(이동·시점·중력·지형추종·충돌)
// ----------------------------------------------------------------------------
// 스케일 기준: 눈높이 0.032유닛을 사람 눈높이 약 1.6m로 본다 => 1유닛 ≈ 50m.
// 이 환산 위에서 나무(0.2유닛)는 10m, 최고층 건물(0.48유닛)은 24m(약 8층)로 읽힌다.
// 아래 속도·점프·보폭 값은 전부 이 환산에 맞춰 정한 것이라 하나만 바꾸면 어색해진다.
// ============================================================================

const FPPlayer = {
  // ── 신체/이동 상수 ──────────────────────────────────────────────────────
  EYE_H: 0.032,          // 눈높이 (≈1.6m)
  CROUCH_EYE_H: 0.019,   // 앉았을 때
  RADIUS: 0.009,         // 충돌 반지름 (≈0.45m 폭)
  STEP_H: 0.013,         // 이 높이 이하 턱은 걸어서 그냥 올라감 (마인크래프트의 반블록 계단 느낌)
  WALK: 0.09,            // ≈4.5m/s
  SPRINT: 0.19,
  CROUCH_SPEED: 0.04,
  SWIM: 0.055,
  GRAVITY: 0.62,
  JUMP_V: 0.195,         // 도달 높이 ≈0.031유닛 = 딱 자기 키만큼
  BUOYANCY: 0.35,        // 물속 부력 (중력을 상당 부분 상쇄)

  FOV_BASE: 75,          // 마인크래프트 기본(70)보다 살짝 넓게 - 소품이 더 크게 느껴짐
  FOV_SPRINT: 84,
  FOV_WATER: 62,

  // ── 상태 ────────────────────────────────────────────────────────────────
  pos: new THREE.Vector3(0, 0, 1.2),   // 발 위치
  vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: -0.05,
  onGround: false, inWater: false, underwater: false,
  crouching: false, sprinting: false, flying: false,
  bobPhase: 0, bobY: 0, bobX: 0,
  thirdPerson: false,
  curFov: 75,
  keys: Object.create(null),

  camera: null, avatar: null,
  _ray: new THREE.Raycaster(),
  _down: new THREE.Vector3(0, -1, 0),
  _origin: new THREE.Vector3(),
};

FPPlayer.init = function (camera, canvas) {
  this.camera = camera;
  camera.fov = this.FOV_BASE;
  // 눈높이가 0.032인데 near가 0.1이면 발밑이 전부 잘려나간다. near를 아주 작게 잡는 게 필수
  camera.near = 0.002;
  camera.far = 60;
  camera.updateProjectionMatrix();

  this.avatar = buildAvatar();
  this.avatar.visible = false;
  FPWorld.scene.add(this.avatar);

  this.respawn();
  bindInput(this, canvas);
};

FPPlayer.respawn = function () {
  this.pos.set(0, FPWorld.GROUND_BASE + 0.05, 1.2);
  this.vel.set(0, 0, 0);
  this.yaw = Math.PI; this.pitch = -0.05;
  this.flying = false;
};

// ── 지형 높이: 레이캐스터로 바닥 표면을 실제로 맞춰서 잰다 ──────────────────
// 절차적 노이즈 수식을 직접 계산할 수도 있지만, 레이캐스터를 쓰면 구역 경계의
// 절벽·도시의 평지·해저까지 한 코드로 처리되고 지형을 나중에 바꿔도 그대로 따라온다.
FPPlayer.terrainHeightAt = function (x, z) {
  this._origin.set(x, 1.6, z);
  this._ray.set(this._origin, this._down);
  this._ray.far = 3.0;
  const hits = this._ray.intersectObjects(FPWorld.walkables, false);
  return hits.length ? hits[0].point.y : -1;
};

// 서 있을 수 있는 최종 바닥 높이 = 지형 + (이미 그 위에 올라와 있는 구조물의 윗면).
// 건물 옥상·유빙·자동차 지붕에 올라설 수 있게 해주는 부분.
FPPlayer.groundHeightAt = function (x, z, feetY) {
  let g = this.terrainHeightAt(x, z);
  const tol = this.STEP_H;
  for (const b of FPWorld.boxes) {
    if (x > b.minX - this.RADIUS && x < b.maxX + this.RADIUS &&
        z > b.minZ - this.RADIUS && z < b.maxZ + this.RADIUS) {
      if (b.top > g && b.top <= feetY + tol) g = b.top;
    }
  }
  for (const c of FPWorld.cylinders) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + this.RADIUS) {
      if (c.top > g && c.top <= feetY + tol) g = c.top;
    }
  }
  return g;
};

// 수면 높이 (해양 구역 안에서만 유효, 밖이면 -Infinity)
FPPlayer.waterHeightAt = function (x, z, t) {
  const lx = x + FPWorld.ZONE_W;               // oceanGroup 로컬 x
  const halfW = (FPWorld.ZONE_W - 0.08) / 2, halfD = FPWorld.waveD / 2;
  if (Math.abs(lx) > halfW || Math.abs(z) > halfD) return -Infinity;
  const k = Math.min(1, Math.max(0, (FPWorld.co2 - 280) / 320));
  return FPWorld.waveBaseY + FPWorld.waveHeightAt(lx, -z, t, k, halfD);
};

// ── 충돌: 원기둥/사각 콜라이더 밖으로 밀어냄 ────────────────────────────────
// "머리 위로 지나갈 수 있는 낮은 물체"는 막지 않는다(top <= 발높이+STEP_H면 통과 후 올라섬).
FPPlayer.resolveCollisions = function (feetY) {
  const R = this.RADIUS, headY = feetY + this.EYE_H;
  for (const c of FPWorld.cylinders) {
    if (c.top <= feetY + this.STEP_H) continue;   // 낮은 턱은 그냥 넘어감
    const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + R;
    if (d < min && d > 1e-6) {
      const push = (min - d) / d;
      this.pos.x += dx * push;
      this.pos.z += dz * push;
    }
  }
  for (const b of FPWorld.boxes) {
    if (b.top <= feetY + this.STEP_H) continue;
    const cx = Math.max(b.minX, Math.min(this.pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(this.pos.z, b.maxZ));
    let dx = this.pos.x - cx, dz = this.pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < R) {
      if (d > 1e-6) {
        const push = (R - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      } else {
        // 박스 내부로 완전히 파고든 경우: 가장 가까운 면으로 밀어냄
        const toMinX = this.pos.x - b.minX, toMaxX = b.maxX - this.pos.x;
        const toMinZ = this.pos.z - b.minZ, toMaxZ = b.maxZ - this.pos.z;
        const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
        if (m === toMinX) this.pos.x = b.minX - R;
        else if (m === toMaxX) this.pos.x = b.maxX + R;
        else if (m === toMinZ) this.pos.z = b.minZ - R;
        else this.pos.z = b.maxZ + R;
      }
    }
  }
  void headY;
};

// ── 매 프레임 갱신 ──────────────────────────────────────────────────────────
FPPlayer.update = function (dt, t) {
  dt = Math.min(dt, 0.05);   // 탭 전환 후 큰 dt로 지형을 뚫고 나가는 걸 방지
  const k = this.keys;

  this.crouching = !!(k['ControlLeft'] || k['KeyC']);
  this.sprinting = !!(k['ShiftLeft'] || k['ShiftRight']) && !this.crouching;

  // 입력 -> 원하는 이동 방향 (시선 기준)
  // 시선 앞쪽 forward=(sin yaw, 0, cos yaw), 오른쪽 right=(-cos yaw, 0, sin yaw)
  let fwd = 0, strafe = 0;
  if (k['KeyW']) fwd += 1;
  if (k['KeyS']) fwd -= 1;
  if (k['KeyD']) strafe += 1;
  if (k['KeyA']) strafe -= 1;
  const len = Math.hypot(fwd, strafe);
  if (len > 0) { fwd /= len; strafe /= len; }   // 대각선 이동이 더 빨라지지 않게 정규화
  const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
  const wishX = fwd * sin - strafe * cos;
  const wishZ = fwd * cos + strafe * sin;

  const waterY = this.waterHeightAt(this.pos.x, this.pos.z, t);
  this.inWater = this.pos.y < waterY;

  let speed = this.crouching ? this.CROUCH_SPEED : (this.sprinting ? this.SPRINT : this.WALK);
  if (this.inWater && !this.flying) speed = this.SWIM;
  if (this.flying) speed = this.sprinting ? this.SPRINT * 2.5 : this.SPRINT;

  // 수평 속도: 목표 속도로 부드럽게 수렴 (지상은 빠르게, 공중은 느리게 = 관성)
  const rate = this.flying ? 10 : (this.onGround ? 14 : (this.inWater ? 6 : 2.2));
  const f = 1 - Math.exp(-rate * dt);
  this.vel.x += (wishX * speed - this.vel.x) * f;
  this.vel.z += (wishZ * speed - this.vel.z) * f;

  // 수직
  if (this.flying) {
    let vy = 0;
    if (k['Space']) vy += speed;
    if (k['ControlLeft'] || k['KeyC']) vy -= speed;
    this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-10 * dt));
  } else if (this.inWater) {
    // 물속: 중력을 부력이 상당 부분 상쇄 -> 천천히 가라앉고, Space로 헤엄쳐 오름
    this.vel.y -= (this.GRAVITY - this.BUOYANCY) * dt;
    if (k['Space']) this.vel.y += this.BUOYANCY * 2.2 * dt;
    this.vel.y *= Math.exp(-2.5 * dt);                 // 물의 저항
    this.vel.y = Math.max(-0.09, Math.min(0.09, this.vel.y));
  } else {
    this.vel.y -= this.GRAVITY * dt;
    if (k['Space'] && this.onGround) {
      this.vel.y = this.JUMP_V;
      this.onGround = false;
    }
  }

  // 이동 적용
  const prevX = this.pos.x, prevZ = this.pos.z;
  this.pos.x += this.vel.x * dt;
  this.pos.z += this.vel.z * dt;

  // 맵 밖으로 못 나가게 (아크릴 상자 안쪽 벽이 곧 세계의 끝)
  const limX = FPWorld.BOX_W / 2 - 0.035, limZ = FPWorld.BOX_D / 2 - 0.035;
  this.pos.x = Math.max(-limX, Math.min(limX, this.pos.x));
  this.pos.z = Math.max(-limZ, Math.min(limZ, this.pos.z));

  if (!this.flying) this.resolveCollisions(this.pos.y);

  // 지형 추종: 새 위치의 바닥 높이를 재서, 오를 수 있는 턱이면 따라 올라가고
  // 못 오르는 절벽이면 이동 자체를 되돌린다
  const ground = this.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
  if (!this.flying && this.onGround && ground > this.pos.y + this.STEP_H) {
    this.pos.x = prevX; this.pos.z = prevZ;     // 너무 높은 벽 - 못 올라감
    this.vel.x = 0; this.vel.z = 0;
  }

  this.pos.y += this.vel.y * dt;
  const g2 = this.groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
  if (!this.flying && this.pos.y <= g2) {
    this.pos.y = g2;
    if (this.vel.y < 0) this.vel.y = 0;
    this.onGround = true;
  } else {
    this.onGround = false;
  }

  // 세계 밖으로 떨어졌으면 리스폰
  if (this.pos.y < -0.6) this.respawn();

  // ── 카메라 ───────────────────────────────────────────────────────────────
  const eyeH = this.crouching ? this.CROUCH_EYE_H : this.EYE_H;

  // 헤드밥: 실제 이동 속도에 비례해서 위아래+좌우로 흔들림 (걷는 느낌의 핵심)
  const hSpeed = Math.hypot(this.vel.x, this.vel.z);
  if (this.onGround && hSpeed > 0.005) {
    this.bobPhase += dt * (hSpeed / this.WALK) * 9.5;
    const amp = eyeH * 0.035 * Math.min(1.6, hSpeed / this.WALK);
    this.bobY = Math.sin(this.bobPhase * 2) * amp;
    this.bobX = Math.cos(this.bobPhase) * amp * 0.8;
  } else {
    this.bobY += (0 - this.bobY) * (1 - Math.exp(-8 * dt));
    this.bobX += (0 - this.bobX) * (1 - Math.exp(-8 * dt));
  }

  const eyeY = this.pos.y + eyeH + this.bobY;
  this.underwater = eyeY < waterY;

  // 시야각: 달릴 때 넓어지고 물속에선 좁아짐 (속도감·압박감)
  let targetFov = this.FOV_BASE;
  if (this.underwater) targetFov = this.FOV_WATER;
  else if (this.sprinting && hSpeed > this.WALK * 1.1) targetFov = this.FOV_SPRINT;
  this.curFov += (targetFov - this.curFov) * (1 - Math.exp(-7 * dt));
  if (Math.abs(this.camera.fov - this.curFov) > 0.01) {
    this.camera.fov = this.curFov;
    this.camera.updateProjectionMatrix();
  }

  const dir = new THREE.Vector3(
    Math.sin(this.yaw) * Math.cos(this.pitch),
    Math.sin(this.pitch),
    Math.cos(this.yaw) * Math.cos(this.pitch)
  );
  // 1인칭 기준 눈 위치. 좌우 흔들림은 시선 오른쪽 방향으로 준다
  const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  const eye = new THREE.Vector3(this.pos.x, eyeY, this.pos.z).addScaledVector(right, this.bobX);

  if (this.thirdPerson) {
    // 3인칭: 시선 반대쪽으로 물러선다. 지형을 뚫지 않도록 바닥 위로 살짝 띄움
    const back = 0.11;
    const camPos = eye.clone().addScaledVector(dir, -back);
    const camGround = this.terrainHeightAt(camPos.x, camPos.z);
    camPos.y = Math.max(camPos.y, camGround + 0.012);
    this.camera.position.copy(camPos);
    this.camera.lookAt(eye.clone().addScaledVector(dir, 0.3));
    this.avatar.visible = true;
    this.avatar.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.avatar.rotation.y = this.yaw + Math.PI;
    this.avatar.scale.setScalar(this.crouching ? 0.62 : 1);
  } else {
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(dir));
    this.avatar.visible = false;
  }
};

// 현재 서 있는 구역 이름 (HUD용)
FPPlayer.currentZone = function () {
  const x = this.pos.x, half = FPWorld.ZONE_W / 2;
  if (this.underwater) return '해양 (수중)';
  if (x < -half) return '해양·빙하';
  if (x > half) return '도시';
  return '습지·숲';
};

// ── 간단한 저폴리 아바타 (3인칭에서만 보임) ──────────────────────────────────
function buildAvatar() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b58c, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3f6fa8, roughness: 0.85 });
  const E = FPPlayer.EYE_H;
  const body = new THREE.Mesh(new THREE.BoxGeometry(E * 0.34, E * 0.46, E * 0.2), cloth);
  body.position.y = E * 0.52;
  const head = new THREE.Mesh(new THREE.BoxGeometry(E * 0.26, E * 0.26, E * 0.26), skin);
  head.position.y = E * 0.9;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(E * 0.14, E * 0.3, E * 0.16), cloth);
  legL.position.set(-E * 0.09, E * 0.15, 0);
  const legR = legL.clone(); legR.position.x = E * 0.09;
  [body, head, legL, legR].forEach(m => { m.castShadow = true; g.add(m); });
  return g;
}

// ── 입력 바인딩 ─────────────────────────────────────────────────────────────
function bindInput(P, canvas) {
  const settingsPanel = document.getElementById('settingsPanel');
  const overlayEl = document.getElementById('startOverlay');

  // E키 설정창: 포인터락 상태에서는 마우스 커서가 없어서 슬라이더를 못 만진다.
  // E를 누르면 포인터락을 풀어 커서를 돌려주고, 다시 E(또는 닫기)로 게임에 복귀한다.
  function openSettings() {
    P.settingsOpen = true;
    settingsPanel.classList.remove('hidden');
    overlayEl.classList.add('hidden');
    P.keys = Object.create(null);              // 열린 동안 이동 입력 정리
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeSettings() {
    P.settingsOpen = false;
    settingsPanel.classList.add('hidden');
    // 브라우저가 포인터락 재요청을 잠깐 막을 수 있으므로, 실패하면 시작 오버레이로 폴백
    if (canvas.requestPointerLock) canvas.requestPointerLock();
    setTimeout(() => {
      if (document.pointerLockElement !== canvas && !P.settingsOpen) overlayEl.classList.remove('hidden');
    }, 350);
  }
  P.openSettings = openSettings;
  P.closeSettings = closeSettings;
  P.toggleSettings = () => (P.settingsOpen ? closeSettings() : openSettings());
  document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);

  // 야장도 설정창과 똑같이 커서를 돌려줘야 표를 읽고 버튼을 누를 수 있다.
  // 두 창이 동시에 열리면 서로 가리므로 하나를 열면 다른 하나는 닫는다.
  function openField() {
    if (P.settingsOpen) closeSettings();
    P.settingsOpen = true;                     // 게임 조작 차단은 설정창과 같은 플래그를 쓴다
    FPField.open();
    overlayEl.classList.add('hidden');
    P.keys = Object.create(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeField() {
    FPField.close();
    P.settingsOpen = false;
    if (canvas.requestPointerLock) canvas.requestPointerLock();
    setTimeout(() => {
      if (document.pointerLockElement !== canvas && !P.settingsOpen) overlayEl.classList.remove('hidden');
    }, 350);
  }
  P.toggleField = () => (FPField.panelOpen ? closeField() : openField());
  document.getElementById('fieldCloseBtn').addEventListener('click', closeField);

  window.addEventListener('keydown', e => {
    // e.repeat 가드: 키를 누르고 있으면 keydown이 연속으로 들어와 창이 깜빡인다
    if (e.code === 'KeyE') {
      if (!e.repeat) { if (FPField.panelOpen) closeField(); else P.toggleSettings(); }
      e.preventDefault(); return;
    }
    if (e.code === 'KeyF') { if (!e.repeat) P.toggleField(); e.preventDefault(); return; }
    if (P.settingsOpen) return;                // 설정창·야장이 열려 있으면 게임 조작 차단
    P.keys[e.code] = true;
    if (e.code === 'F5' || e.code === 'KeyV') { P.thirdPerson = !P.thirdPerson; e.preventDefault(); }
    if (e.code === 'KeyG') P.flying = !P.flying;    // F는 야장이 가져갔다
    if (e.code === 'KeyT' && !e.repeat) FPWorld.timeFlowing = !FPWorld.timeFlowing;
    if (e.code === 'KeyR') P.respawn();
    if (e.code === 'KeyH') document.getElementById('helpPanel').classList.toggle('hidden');
    if (e.code === 'Space') e.preventDefault();   // 스페이스로 페이지가 스크롤되는 것 방지
    // 숫자키 1~9로 단축바 선택
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) FPTools.select(n - 1);
    }
  });
  window.addEventListener('keyup', e => { P.keys[e.code] = false; });
  window.addEventListener('blur', () => { P.keys = Object.create(null); });

  const LOOK = 0.0022, PITCH_LIMIT = 1.53;
  function look(dx, dy) {
    P.yaw -= dx * LOOK;
    P.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, P.pitch - dy * LOOK));
  }

  // 마인크래프트식 조작: 전체화면 + 포인터락. 마우스 커서가 화면에 갇혀서
  // 버튼을 누르지 않아도 마우스를 움직이는 것만으로 시점이 돈다(드래그 방식 폐지).
  const overlay = document.getElementById('startOverlay');
  function enterGame() {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      // 실패해도(권한/브라우저 정책) 포인터락만으로 플레이는 가능해야 하므로 무시하고 진행
      root.requestFullscreen().catch(() => {});
    }
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }
  P.enterGame = enterGame;
  overlay.addEventListener('click', enterGame);
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas && !P.settingsOpen) enterGame();
  });

  window.addEventListener('pointermove', e => {
    if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  });

  // 도구를 든 상태에서 좌클릭 = 측정
  window.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas) return;
    FPTools.use();
  });

  // 포인터락이 풀리면(ESC) 다시 안내 오버레이를 띄운다.
  // 단, E키로 설정창을 연 경우는 의도된 해제이므로 오버레이를 띄우지 않는다.
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) overlay.classList.add('hidden');
    else if (!P.settingsOpen) overlay.classList.remove('hidden');
    if (!locked) P.keys = Object.create(null);
  });
}
