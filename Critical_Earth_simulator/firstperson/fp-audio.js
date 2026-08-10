// ============================================================================
// 1인칭 모드 - 환경음
// ----------------------------------------------------------------------------
// 오디오 파일을 두지 않고 WebAudio로 직접 합성한다. 이유:
//   - 이 프로젝트는 exe로 묶어 배포하고 학교 PC에서 오프라인으로 돌린다. 음원 파일이
//     늘어나면 배포 용량과 경로 문제만 커진다.
//   - 파도·바람·매미 소리는 노이즈와 사인파 몇 개면 충분히 그럴듯해진다.
//
// 소리는 서 있는 자리에 따라 섞인다. 바다에 가까우면 파도, 숲에서는 풀벌레,
// 도심에서는 차량 웅웅거림. 밤에는 낮과 다른 소리가 난다(매미 -> 귀뚜라미).
// 브라우저 정책상 사용자가 클릭하기 전에는 소리를 낼 수 없어서, 게임 시작
// (포인터락 진입) 시점에 초기화한다.
// ============================================================================

const FPAudio = {
  ctx: null, ready: false, enabled: true,
  nodes: {},
};

// 갈색 잡음(brown noise): 백색 잡음은 '치익' 하는 고음이라 파도로 안 들린다.
// 저역이 강한 갈색 잡음이라야 밀려왔다 빠지는 물소리가 된다.
function makeNoiseBuffer(ctx, seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}

FPAudio.init = function () {
  if (this.ready) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;                    // 오디오를 못 쓰는 환경이면 조용히 넘어간다
  const ctx = this.ctx = new AC();
  this.ready = true;

  const master = ctx.createGain();
  master.gain.value = this.enabled ? 0.5 : 0;
  master.connect(ctx.destination);
  this.nodes.master = master;

  // 채널 하나 = 잡음원 + 필터 + 음량. 음량만 바꿔서 장면에 맞게 섞는다.
  const mk = (buffer, filterType, freq, q) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    return { src, filter: f, gain: g };
  };

  const brown = makeNoiseBuffer(ctx, 4, true);
  const white = makeNoiseBuffer(ctx, 3, false);

  // 파도: 갈색 잡음을 저역통과. 게다가 LFO로 음량을 천천히 흔들어 밀물/썰물 느낌을 낸다.
  this.nodes.waves = mk(brown, 'lowpass', 420);
  {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.11;        // 약 9초 주기 = 너울 한 번
    lfoGain.gain.value = 0.45;
    lfo.connect(lfoGain);
    lfoGain.connect(this.nodes.waves.gain.gain);   // 기본 음량에 더해진다
    lfo.start();
    this.nodes.waveLfo = lfo;
  }
  // 바람: 잎사귀 스치는 소리. 대역통과한 백색 잡음.
  this.nodes.wind = mk(white, 'bandpass', 900, 0.7);
  // 도심 소음: 차량 주행음. 아주 낮은 대역만 남긴 갈색 잡음.
  this.nodes.city = mk(brown, 'lowpass', 180);
  // 수중: 물속에서는 고음이 다 죽고 먹먹해진다.
  this.nodes.under = mk(brown, 'lowpass', 150);

  // 풀벌레/매미: 짧은 삑 소리를 주기적으로 낸다. 낮에는 매미(높고 빠름),
  // 밤에는 귀뚜라미(낮고 느림)로 바뀐다 - 밤이 됐다는 걸 귀로도 알게 한다.
  this.nodes.chirpGain = ctx.createGain();
  this.nodes.chirpGain.gain.value = 0;
  this.nodes.chirpGain.connect(master);
  this._chirpT = 0;
};

FPAudio.setEnabled = function (on) {
  this.enabled = on;
  if (this.nodes.master) this.nodes.master.gain.value = on ? 0.5 : 0;
  if (on && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
};

// 한 번 울리는 벌레 소리. 오실레이터를 그때그때 만들고 버린다(짧아서 부담 없음).
FPAudio.chirp = function (night) {
  const ctx = this.ctx;
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = night ? 'sine' : 'sawtooth';
  const f = night ? 2600 + Math.random() * 300 : 4200 + Math.random() * 600;
  o.frequency.setValueAtTime(f, ctx.currentTime);
  const dur = night ? 0.09 : 0.05;
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g); g.connect(this.nodes.chirpGain);
  o.start();
  o.stop(ctx.currentTime + dur + 0.02);
};

// 매 프레임 호출. 현재 위치·시간에 맞춰 각 채널 음량을 부드럽게 옮긴다.
FPAudio.update = function (dt) {
  if (!this.ready || !this.enabled) return;
  const p = FPPlayer.pos, half = FPWorld.ZONE_W / 2;
  const under = FPPlayer.underwater;
  const lit = FPWorld.daylight != null ? FPWorld.daylight : 1;

  // 각 구역 중심으로부터의 거리로 섞는다. 경계에서 뚝 끊기지 않게.
  const near = (cx, r) => Math.max(0, 1 - Math.abs(p.x - cx) / r);
  const sea = near(-FPWorld.ZONE_W, FPWorld.ZONE_W * 1.5);
  const green = near(0, FPWorld.ZONE_W * 1.1);
  const city = near(FPWorld.ZONE_W, FPWorld.ZONE_W * 1.2);

  const N = this.nodes;
  // 수중에서는 바깥 소리가 거의 안 들리고 먹먹한 저음만 남는다
  const air = under ? 0.12 : 1;
  const to = (node, v) => {
    // 급하게 바꾸면 '툭' 하는 잡음이 난다. 지수적으로 따라가게 한다.
    node.gain.gain.value += (v - node.gain.gain.value) * Math.min(1, dt * 3);
  };
  to(N.waves, sea * 0.55 * air);
  // 바람은 어디서나 조금씩, 녹지에서 가장 크게. 밤에는 조금 잦아든다.
  to(N.wind, (0.05 + green * 0.16) * (0.6 + 0.4 * lit) * air);
  // 도심 차량 소음은 내연기관차 비율을 그대로 따라간다.
  // CO2를 낮춰 전부 전기차로 바꾸면 도시가 조용해진다 - 귀로 듣는 CO2 지표다.
  const gasRatio = FPWorld.cars && FPWorld.cars.length
    ? FPWorld.gasCarCount / FPWorld.cars.length : 0;
  to(N.city, city * (0.06 + 0.34 * gasRatio) * (0.55 + 0.45 * lit) * air);
  to(N.under, under ? 0.5 : 0);

  // 벌레 소리 - 녹지에서만, 밤일수록 잦게
  const night = lit < 0.4;
  N.chirpGain.gain.value += ((under ? 0 : green * 0.9) - N.chirpGain.gain.value) * Math.min(1, dt * 3);
  this._chirpT -= dt;
  if (this._chirpT <= 0 && green > 0.15 && !under) {
    this.chirp(night);
    this._chirpT = night ? 0.16 + Math.random() * 0.28 : 0.35 + Math.random() * 0.9;
  }
};
