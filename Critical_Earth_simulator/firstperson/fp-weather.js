// ============================================================================
// 1인칭 모드 - 날씨
// ----------------------------------------------------------------------------
// 맑음 / 비 / 폭풍(천둥번개) / 눈 / 스콜(소나기) / 안개 여섯 가지.
//
// 설계에서 가장 중요한 원칙: **날씨가 측정값을 실제로 바꾼다.**
// 장식으로만 두면 야장에 기록할 값어치가 없다. 변인이어야 학생이
// "비 오는 날과 맑은 날의 지면 온도를 비교"하는 조사를 설계할 수 있다.
// 특히 안개는 일교차를 0.4배로 죽인다 - 복사냉각과 복사가열을 둘 다 막기 때문이고,
// 실제로 안개 낀 날은 밤낮 온도차가 작다. 직접 재서 확인할 수 있는 사실이다.
//
// 하늘색·안개거리·조명 세기는 여기서 직접 건드리지 않는다. fp-world.js의
// WEATHER_ENV 테이블에 몫만 적어 두고 applyEnvironment()가 계절·시간과 합성한다.
// (그러지 않으면 "비가 개면 계절 색이 사라지는" 덮어쓰기 버그가 난다 - Stage A 참고)
// ============================================================================

const FPWeather = {
  kind: 'clear',
  random: false,          // 5분마다 무작위 전환. 기본 off - 아래 이유 참고
  _randTimer: 0,
  _squallLeft: 0,         // 스콜은 지속시간이 있는 상태다
  _flash: 0,              // 번개 섬광 잔여 시간
  _boltTimer: 4,
  rain: null, snow: null,
};

// 성능이 부족하면 이 두 상수만 낮추면 된다 (SEA_DENSITY와 같은 역할).
// 동료 노트북(2018년 Intel UHD 620) 기준으로 조정할 것.
// RAIN_COUNT/SNOW_COUNT 는 '입자 풀'의 크기다. 날씨별 rain/snow 값은 이 풀에 대한
// 비율이므로 1.0을 넘길 수 없다(넘기면 풀에 막혀 폭풍과 비가 같은 양이 된다).
const RAIN_COUNT = 2600;
const SNOW_COUNT = 1200;
const _flashColor = new THREE.Color(0xf2f6ff);

// 입자를 뿌리는 상자. 월드 전체에 뿌리면 대부분이 화면 밖이라 낭비이므로,
// 플레이어를 따라다니는 작은 상자 안에서만 돌린다.
const CELL_W = 0.55, CELL_H = 0.42;

// 날씨별 성질. sky/fog/light 몫은 fp-world.js의 WEATHER_ENV에 있고 여기엔 나머지만.
//   temp     기온 보정 [°C]
//   groundT  지면에 추가로 더할 보정 (눈은 지면이 특히 차갑다)
//   dayK     일교차 배수. 구름·안개가 복사냉각과 가열을 둘 다 막는다.
//   rain/snow 입자 수 배수
const WEATHER = {
  clear:  { ko: '맑음',  temp: 0,    groundT: 0,  dayK: 1.00, rain: 0,    snow: 0 },
  rain:   { ko: '비',    temp: -2.5, groundT: 0,  dayK: 0.55, rain: 0.55, snow: 0 },
  storm:  { ko: '폭풍',  temp: -3.5, groundT: 0,  dayK: 0.45, rain: 0.90, snow: 0, bolt: true },
  snow:   { ko: '눈',    temp: -1.0, groundT: -3, dayK: 0.60, rain: 0,    snow: 1.0 },
  squall: { ko: '스콜',  temp: -4.0, groundT: 0,  dayK: 0.50, rain: 1.00, snow: 0, squall: true },
  fog:    { ko: '안개',  temp: -0.5, groundT: 0,  dayK: 0.40, rain: 0,    snow: 0 },
};
const WEATHER_ORDER = ['clear', 'rain', 'storm', 'snow', 'squall', 'fog'];
function weatherDef() { return WEATHER[FPWeather.kind] || WEATHER.clear; }

// ── 입자 ────────────────────────────────────────────────────────────────────
FPWeather.init = function (scene) {
  // 비: LineSegments(방울당 정점 2개)라 '빗줄기'로 보인다. Points로는 점만 흩날린다.
  const rp = new Float32Array(RAIN_COUNT * 6);
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({
    color: 0xa8c4d8, transparent: true, opacity: 0.55, fog: false,
  }));
  // 정점을 매 프레임 갱신하는데 three.js는 boundingSphere를 생성 시점에 한 번만
  // 계산한다. 끄지 않으면 통째로 컬링돼 사라진다 (이 저장소에서 이미 두 번 데였다).
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);
  this.rain = { mesh: rain, pos: rp, v: new Float32Array(RAIN_COUNT) };
  for (let i = 0; i < RAIN_COUNT; i++) this.rain.v[i] = 0.9 + Math.random() * 0.7;

  // 눈: 느리게 내리며 좌우로 하늘거린다.
  // 크기는 실척으로 따져야 한다 - 1유닛 = 50m라 0.008이면 눈송이가 40cm짜리 판때기가
  // 되어 화면이 흰 사각형으로 뒤덮인다(실제로 그랬다). 0.0018 = 약 9cm 정도로 잡는다.
  // PointsMaterial은 텍스처가 없으면 정사각형으로 그려지므로 둥근 알파맵을 씌운다.
  const flake = document.createElement('canvas');
  flake.width = flake.height = 32;
  {
    const c = flake.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  }
  const sp = new Float32Array(SNOW_COUNT * 3);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snow = new THREE.Points(sgeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.0018, transparent: true, opacity: 0.95,
    map: new THREE.CanvasTexture(flake), alphaTest: 0.02,
    depthWrite: false, fog: false,
  }));
  snow.frustumCulled = false;
  snow.visible = false;
  scene.add(snow);
  this.snow = { mesh: snow, pos: sp, phase: new Float32Array(SNOW_COUNT) };
  for (let i = 0; i < SNOW_COUNT; i++) this.snow.phase[i] = Math.random() * 10;

  this.scatter();
};

// 입자를 플레이어 주위 상자에 흩뿌린다 (첫 배치 및 날씨 전환 시)
FPWeather.scatter = function () {
  const p = FPPlayer ? FPPlayer.pos : { x: 0, y: 0.5, z: 0 };
  const R = this.rain.pos, S = this.snow.pos;
  for (let i = 0; i < RAIN_COUNT; i++) {
    const x = p.x + (Math.random() - 0.5) * CELL_W;
    const y = p.y + (Math.random() - 0.2) * CELL_H;
    const z = p.z + (Math.random() - 0.5) * CELL_W;
    R[i * 6] = x; R[i * 6 + 1] = y; R[i * 6 + 2] = z;
    R[i * 6 + 3] = x; R[i * 6 + 4] = y - 0.012; R[i * 6 + 5] = z;
  }
  for (let i = 0; i < SNOW_COUNT; i++) {
    S[i * 3] = p.x + (Math.random() - 0.5) * CELL_W;
    S[i * 3 + 1] = p.y + (Math.random() - 0.2) * CELL_H;
    S[i * 3 + 2] = p.z + (Math.random() - 0.5) * CELL_W;
  }
};

// ── 전환 ────────────────────────────────────────────────────────────────────
FPWeather.set = function (kind) {
  if (!WEATHER[kind]) return;
  this.kind = kind;
  FPWorld.weather = kind;                 // applyEnvironment()가 읽는다
  const W = WEATHER[kind];
  this._squallLeft = W.squall ? 120 + Math.random() * 60 : 0;   // 스콜은 2~3분
  this._flash = 0;
  this._boltTimer = 2 + Math.random() * 5;
  const rn = this.rain.mesh, sn = this.snow.mesh;
  rn.visible = W.rain > 0;
  sn.visible = W.snow > 0;
  rn.material.opacity = 0.38 + 0.30 * W.rain;
  // 폭풍은 빗줄기를 길고 기울어지게
  this._tilt = kind === 'storm' ? 0.05 : (kind === 'squall' ? 0.03 : 0.012);
  this._rainN = Math.min(RAIN_COUNT, Math.round(RAIN_COUNT * W.rain));
  this._snowN = Math.min(SNOW_COUNT, Math.round(SNOW_COUNT * W.snow));
  rn.geometry.setDrawRange(0, this._rainN * 2);
  sn.geometry.setDrawRange(0, this._snowN);
  if (W.rain || W.snow) this.scatter();
  FPWorld.refresh();
  if (typeof FPAudio !== 'undefined') FPAudio.setWeather(kind, W);
};

FPWeather.setRandom = function (on) {
  this.random = on;
  this._randTimer = 300;    // 5분
};

// ── 매 프레임 ───────────────────────────────────────────────────────────────
FPWeather.update = function (dt) {
  const W = weatherDef();
  const p = FPPlayer.pos;

  // 스콜은 2~3분 뒤 저절로 갠다 (지속시간이 성질인 유일한 날씨)
  if (this._squallLeft > 0) {
    this._squallLeft -= dt;
    if (this._squallLeft <= 0) this.set('clear');
  }
  // 무작위 날씨: 5분마다 다른 것으로 바꾼다.
  // 기본이 off인 이유는 시간 흐름과 같다 - 조사 중에 날씨가 바뀌면 자료를 못 쓴다.
  if (this.random) {
    this._randTimer -= dt;
    if (this._randTimer <= 0) {
      this._randTimer = 300;
      const pool = WEATHER_ORDER.filter(k => k !== this.kind && k !== 'squall');
      this.set(pool[Math.floor(Math.random() * pool.length)]);
    }
  }

  // 번개: 3~9초 간격. 섬광은 조명을 확 올렸다 되돌리고, 천둥은 거리만큼 늦게 들린다.
  if (W.bolt) {
    this._boltTimer -= dt;
    if (this._boltTimer <= 0) {
      this._boltTimer = 3 + Math.random() * 6;
      this._flash = 0.18;
      const dist = 0.3 + Math.random() * 0.7;          // 0=코앞, 1=멀리
      if (typeof FPAudio !== 'undefined') {
        setTimeout(() => FPAudio.thunder(dist), dist * 2200);
      }
    }
  }
  if (this._flash > 0) {
    this._flash = Math.max(0, this._flash - dt);
    const L = FPWorld.lights;
    if (L) {
      const f = this._flash / 0.18;
      // 기준값에 얹는다. 매 프레임 '더하기'를 하면 값이 누적되므로 항상
      // applyEnvironment()가 정한 세기를 다시 계산한 뒤 그 위에 섬광을 얹는다.
      const base = L.base.ambient * (0.30 + 0.70 * FPWorld.daylight) * weatherEnv().lightK;
      L.ambient.intensity = base + 2.2 * f;
      FPWorld.skyMat.color.lerp(_flashColor, f * 0.75);
    }
    // 섬광이 끝나는 순간 원래 상태로 정확히 되돌린다
    if (this._flash === 0) FPWorld.refresh();
  }

  if (this._rainN) this.updateRain(dt, p, W);
  if (this._snowN) this.updateSnow(dt, p);
};

FPWeather.updateRain = function (dt, p, W) {
  const R = this.rain.pos, V = this.rain.v;
  const half = CELL_W / 2, top = p.y + CELL_H * 0.8, bottom = p.y - CELL_H * 0.2;
  const len = 0.012 + this._tilt * 0.4;
  const tilt = this._tilt;
  for (let i = 0; i < this._rainN; i++) {
    const j = i * 6;
    let y = R[j + 1] - V[i] * dt;
    let x = R[j] + tilt * V[i] * dt;
    if (y < bottom) {
      // 아래로 빠지면 상자 위쪽에서 다시 태어난다 (플레이어를 따라다니는 상자)
      y = top;
      x = p.x + (Math.random() - 0.5) * CELL_W;
      R[j + 2] = p.z + (Math.random() - 0.5) * CELL_W;
    }
    // 플레이어가 이동하면 상자 밖으로 나간 입자를 반대쪽으로 감아 넣는다
    if (x - p.x > half) x -= CELL_W; else if (x - p.x < -half) x += CELL_W;
    let z = R[j + 2];
    if (z - p.z > half) z -= CELL_W; else if (z - p.z < -half) z += CELL_W;
    R[j] = x; R[j + 1] = y; R[j + 2] = z;
    R[j + 3] = x - tilt * len * 8; R[j + 4] = y - len; R[j + 5] = z;
  }
  this.rain.mesh.geometry.attributes.position.needsUpdate = true;
};

FPWeather.updateSnow = function (dt, p) {
  const S = this.snow.pos, PH = this.snow.phase;
  const half = CELL_W / 2, top = p.y + CELL_H * 0.8, bottom = p.y - CELL_H * 0.2;
  const t = performance.now() / 1000;
  for (let i = 0; i < this._snowN; i++) {
    const j = i * 3;
    let y = S[j + 1] - 0.045 * dt;                     // 비보다 훨씬 느리게
    let x = S[j] + Math.sin(t * 0.8 + PH[i]) * 0.012 * dt;   // 좌우로 하늘거리며
    let z = S[j + 2] + Math.cos(t * 0.6 + PH[i]) * 0.012 * dt;
    if (y < bottom) {
      y = top;
      x = p.x + (Math.random() - 0.5) * CELL_W;
      z = p.z + (Math.random() - 0.5) * CELL_W;
    }
    if (x - p.x > half) x -= CELL_W; else if (x - p.x < -half) x += CELL_W;
    if (z - p.z > half) z -= CELL_W; else if (z - p.z < -half) z += CELL_W;
    S[j] = x; S[j + 1] = y; S[j + 2] = z;
  }
  this.snow.mesh.geometry.attributes.position.needsUpdate = true;
};

// ── 측정값에 주는 영향 (fp-tools.js가 부른다) ────────────────────────────────
function weatherTempOffset(spot) {
  const W = weatherDef();
  // 눈이 올 때 지면이 특히 차가운 건 눈이 햇빛을 되쏘고(알베도) 녹으면서 열을 빼앗기 때문
  const isGround = spot === 'green' || spot === 'city' || spot === 'beach';
  return W.temp + (isGround ? W.groundT : 0);
}
function weatherDiurnalK() { return weatherDef().dayK; }
