// ============================================================================
// 1인칭 모드 - 미니맵
// ----------------------------------------------------------------------------
// 왼쪽 아래에 하늘에서 내려다본 지도를 그린다. 현위치를 점으로, 보고 있는 방향을
// 부채꼴로 표시한다.
//
// three.js로 두 번째 씬을 만들어 위에서 렌더하는 방법도 있지만, 그러면 드로우콜이
// 두 배가 된다(수중에서 이미 578개다). 맵이 6x3짜리 고정 지형이고 그릴 것도
// 구역 3개 + 도로 2줄 + 점 몇 개뿐이라 2D 캔버스로 직접 그리는 편이 훨씬 싸다.
//
// 좌표 변환: 월드 (x, z) -> 화면 (sx, sy).
//   x∈[-3,3] -> 가로,  z∈[-1.5,1.5] -> 세로 (z가 커지면 화면 아래로)
// 시선 방향은 fp-player.js의 전진 벡터 (sin yaw, 0, cos yaw) 를 그대로 쓴다.
// z가 아래로 증가하게 그리므로 화면에서도 (sin yaw, cos yaw) 가 그대로 맞는다.
// ============================================================================

const FPMinimap = {
  mode: 1,          // 0=끔, 1=보통, 2=크게
  _t: 0,
};

// mode별 캔버스 가로 폭(px). 단축바는 화면 중앙 하단에 있으므로 좁은 화면(1000px)에서도
// 겹치지 않는 선까지만 키운다.
const MINI_SIZES = [0, 220, 310];
const MINI_REFRESH = 0.1;              // 초당 10회면 충분하다 (매 프레임 그릴 이유가 없다)

// ── 측정값 색점 ─────────────────────────────────────────────────────────────
// 이 시뮬의 강점은 공간 변이(열섬·나무 밑 CO2·냉수대)인데, 측정하면 숫자 하나만 나와서
// 패턴이 안 보였다. 지금 손에 든 도구의 기록만 골라 값에 따라 색을 칠한다.
// 축은 고정이다 - 기록 범위에 맞춰 늘이면 도심만 열 번 재도 노이즈가 빨강~파랑으로 퍼진다.
//   온도  : 0 → 36 °C, 파랑 → 흰색 → 빨강 (18 °C 근처가 흰색)
//   CO2   : 설정 CO2 대비 −60 → +120 ppm, 초록 → 노랑 → 주황 (슬라이더를 바꿔도 공간 패턴이 같게)
//   pH    : 7.65 → 8.25, 주황 → 노랑 → 파랑
//   해수 분석기: Ω 0.8 → 3.5, 빨강(1 밑 = 용해) → 주황 → 청록
const DOT_SCALE = {
  temp: { lo: 0, hi: 36, stops: ['#38a0ff', '#f2ecdc', '#e8402f'], label: '온도', fmt: v => v.toFixed(0) + '°', val: r => r.value },
  co2:  { lo: -60, hi: 120, stops: ['#4fc36a', '#e8d25a', '#e8642a'], label: 'CO₂ 평균 대비', fmt: v => (v > 0 ? '+' : '') + v.toFixed(0), val: r => r.value - r.co2 },
  ph:   { lo: 7.65, hi: 8.25, stops: ['#e8683a', '#e2d35c', '#4a9be0'], label: 'pH', fmt: v => v.toFixed(2), val: r => r.value },
  sea:  { lo: 0.8, hi: 3.5, stops: ['#e2483a', '#f0b45c', '#5dcaa5'], label: 'Ω', fmt: v => v.toFixed(1), val: r => r.value },
};
function _hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
for (const k in DOT_SCALE) DOT_SCALE[k].rgb = DOT_SCALE[k].stops.map(_hex);
function dotColor(S, v) {
  const t = Math.min(1, Math.max(0, (v - S.lo) / (S.hi - S.lo))) * (S.rgb.length - 1);
  const i = Math.min(S.rgb.length - 2, Math.floor(t)), f = t - i;
  const a = S.rgb[i], b = S.rgb[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

FPMinimap.init = function () {
  this.el = document.getElementById('minimap');
  if (!this.el) return;
  this.ctx = this.el.getContext('2d');
  this.applyMode();
};

FPMinimap.toggle = function () {
  this.mode = (this.mode + 1) % 3;
  this.applyMode();
};

FPMinimap.applyMode = function () {
  const w = MINI_SIZES[this.mode];
  if (!this.el) return;
  if (w === 0) { this.el.style.display = 'none'; return; }
  this.el.style.display = 'block';
  // 맵이 6x3(가로:세로 = 2:1)이라 캔버스도 그 비율에 여백만 더한다
  const h = Math.round(w / 2) + 14;
  this.el.width = w;
  this.el.height = h;
  this.el.style.width = w + 'px';
  this.el.style.height = h + 'px';
  this._t = MINI_REFRESH;   // 다음 프레임에 바로 다시 그리게
};

FPMinimap.update = function (dt) {
  if (this.mode === 0 || !this.ctx) return;
  this._t -= dt;
  if (this._t > 0) return;
  // 남은 시간을 버리지 않고 차감해야 실제 주기가 정확해진다.
  // (= MINI_REFRESH 로 리셋하면 매번 한 프레임분이 버려져 초당 10회가 8회가 된다)
  this._t += MINI_REFRESH;
  this.draw();
};

FPMinimap.draw = function () {
  const c = this.ctx, W = this.el.width, H = this.el.height;
  const BW = FPWorld.BOX_W, BD = FPWorld.BOX_D, Z = FPWorld.ZONE_W;
  const PAD = 6;
  const mw = W - PAD * 2, mh = mw / (BW / BD);     // 지도 영역
  const oy = PAD + 4;
  const X = wx => PAD + (wx + BW / 2) / BW * mw;
  const Y = wz => oy + (wz + BD / 2) / BD * mh;

  c.clearRect(0, 0, W, H);
  // 바탕
  c.fillStyle = 'rgba(10,15,19,.72)';
  c.strokeStyle = 'rgba(120,150,165,.28)';
  c.lineWidth = 1;
  roundRect(c, 0.5, 0.5, W - 1, H - 1, 8);
  c.fill(); c.stroke();

  // 구역 세 덩어리
  const zones = [[-Z, '#26536e'], [0, '#3d6b32'], [Z, '#575a5e']];
  for (const [cx, col] of zones) {
    c.fillStyle = col;
    c.fillRect(X(cx - Z / 2), Y(-BD / 2), mw / 3, mh);
  }

  // 도로 (Stage D에서 내보낸 좌표를 그대로 쓴다)
  const RD = FPWorld.road;
  if (RD) {
    c.strokeStyle = '#8e9298';
    c.lineWidth = Math.max(1.5, RD.width / BW * mw);
    c.beginPath();
    c.moveTo(X(Z - RD.mainHalf), Y(RD.mainZ));
    c.lineTo(X(Z + RD.mainHalf), Y(RD.mainZ));
    c.moveTo(X(Z + RD.crossX), Y(-RD.crossHalf));
    c.lineTo(X(Z + RD.crossX), Y(RD.crossHalf));
    c.stroke();
  }

  // 나무 (녹지가 어디까지인지 한눈에 보인다)
  c.fillStyle = 'rgba(120,190,95,.75)';
  for (const t of FPWorld.trees) {
    c.beginPath(); c.arc(X(t.x), Y(t.z), 1.6, 0, Math.PI * 2); c.fill();
  }

  // 달리는 자동차 - 내연은 회색, 전기는 청록
  for (const car of FPWorld.cars) {
    const wx = car.group.position.x + Z, wz = car.group.position.z;
    c.fillStyle = car.isGas ? '#c9c2b6' : '#4fd6c0';
    c.fillRect(X(wx) - 1.5, Y(wz) - 1.5, 3, 3);
  }

  // 야장 측정 지점 - 조사한 경로가 지도에 남는다.
  // 손에 든 도구의 기록은 값에 따라 색점으로, 나머지 기록은 흐린 십자로.
  if (typeof FPField !== 'undefined' && FPField.rows.length) {
    const held = typeof FPTools !== 'undefined' ? FPTools.slots[FPTools.selected] : null;
    const S = held ? DOT_SCALE[held.kind] : null;
    c.strokeStyle = S ? 'rgba(255,214,120,.35)' : 'rgba(255,214,120,.9)';
    c.lineWidth = 1;
    let colored = 0;
    for (const r of FPField.rows) {
      if (S && r.kind === held.kind) { colored++; continue; }
      const x = X(r.x), y = Y(r.z);
      c.beginPath();
      c.moveTo(x - 2, y); c.lineTo(x + 2, y);
      c.moveTo(x, y - 2); c.lineTo(x, y + 2);
      c.stroke();
    }
    if (S && colored) {
      // 작은 지도라 점은 크게, 테두리는 밝게 - 파란 바다 위 파란 점도 묻히지 않게
      const rad = this.mode === 2 ? 3.6 : 2.8;
      c.strokeStyle = 'rgba(255,255,255,.85)';
      for (const r of FPField.rows) {
        if (r.kind !== held.kind) continue;
        c.fillStyle = dotColor(S, S.val(r));
        c.beginPath(); c.arc(X(r.x), Y(r.z), rad, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      this._legend = S;   // 범례는 아래 글자 줄에 ('M 지도' 자리) - 지도 위를 가리지 않게
    } else {
      this._legend = null;
    }
    // 횡단 조사 중이면 시작점에서 현위치까지 선을 그어 준다
    const T = FPField.transect;
    if (T) {
      c.strokeStyle = 'rgba(255,214,120,.55)';
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(X(T.x0), Y(T.z0));
      c.lineTo(X(FPPlayer.pos.x), Y(FPPlayer.pos.z));
      c.stroke();
      c.setLineDash([]);
    }
  }

  // 플레이어: 시야 부채꼴 + 점
  const px = X(FPPlayer.pos.x), py = Y(FPPlayer.pos.z);
  // 전진 벡터 (sin yaw, cos yaw). 화면 y가 월드 +z 방향이라 그대로 쓰면 된다.
  const yaw = FPPlayer.yaw;
  const half = (75 / 2) * Math.PI / 180;          // 카메라 FOV 75도의 절반
  // canvas의 arc는 +x축에서 시작해 시계방향으로 각을 재므로, (sin,cos)를 atan2로 바꾼다
  const ang = Math.atan2(Math.cos(yaw), Math.sin(yaw));
  const R = Math.max(14, mw * 0.07);
  const grd = c.createRadialGradient(px, py, 0, px, py, R);
  grd.addColorStop(0, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = grd;
  c.beginPath();
  c.moveTo(px, py);
  c.arc(px, py, R, ang - half, ang + half);
  c.closePath();
  c.fill();

  c.fillStyle = '#ffffff';
  c.strokeStyle = 'rgba(0,0,0,.6)';
  c.lineWidth = 1;
  c.beginPath(); c.arc(px, py, 3, 0, Math.PI * 2); c.fill(); c.stroke();

  // 아래 눈금: 현재 구역과 조작 안내
  c.fillStyle = '#8fa3ad';
  c.font = '10px sans-serif';
  c.textAlign = 'left';
  c.fillText(FPPlayer.currentZone(), PAD, H - 3);
  const L = FPField && FPField.rows.length ? this._legend : null;
  if (!L) {
    c.textAlign = 'right';
    c.fillText('M 지도', W - PAD, H - 3);
    return;
  }
  // 범례: [이름 최소 ▬▬▬ 최대] 를 오른쪽 아래에
  c.font = '9px sans-serif';
  const hiTxt = L.fmt(L.hi), loTxt = L.fmt(L.lo);
  const LW = Math.round(W * 0.2), LH = 4;
  const xr = W - PAD - c.measureText(hiTxt).width - 3;
  const lx = xr - LW, ly = H - 9;
  c.textAlign = 'right';
  c.fillStyle = '#d6e2e8';
  c.fillText(hiTxt, W - PAD, H - 3);
  const g = c.createLinearGradient(lx, 0, lx + LW, 0);
  L.stops.forEach((col, i) => g.addColorStop(i / (L.stops.length - 1), col));
  c.fillStyle = g;
  c.fillRect(lx, ly, LW, LH);
  c.fillStyle = '#d6e2e8';
  c.fillText(`${L.label} ${loTxt}`, lx - 3, H - 3);
};

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
