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

  // 야장 측정 지점 - 조사한 경로가 지도에 남는다
  if (typeof FPField !== 'undefined' && FPField.rows.length) {
    c.strokeStyle = 'rgba(255,214,120,.9)';
    c.lineWidth = 1;
    for (const r of FPField.rows) {
      const x = X(r.x), y = Y(r.z);
      c.beginPath();
      c.moveTo(x - 2, y); c.lineTo(x + 2, y);
      c.moveTo(x, y - 2); c.lineTo(x, y + 2);
      c.stroke();
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
  c.textAlign = 'right';
  c.fillText('M 지도', W - PAD, H - 3);
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
