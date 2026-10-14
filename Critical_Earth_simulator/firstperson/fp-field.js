// ============================================================================
// 1인칭 모드 - 야장(野帳) & 횡단 조사
// ----------------------------------------------------------------------------
// 왜 필요한가:
//   측정이라는 행위는 만들어 놨는데 잰 값이 표시창에 잠깐 떴다가 사라졌다.
//   조감 모드에는 CSV/PNG 내보내기, 축 설정, 추세선, 그래프 병합까지 있는데
//   1인칭에서는 아무 결론도 못 내렸다. "구경하는 곳"에 머무르는 이유였다.
//
//   1인칭 모드가 조감 모드에 없는 걸 딱 하나 가지고 있다: 공간이다.
//   조감 모드는 전 지구 평균값 하나뿐이라 도시 열섬도, 나무 밑 CO2 저하도 보여줄 수 없다.
//   그 공간 변이를 숫자로 붙잡아 가져 나갈 수 있게 하는 것이 이 파일의 목적이다.
//
// CSV는 조감 모드 '실시간 실험' 탭과 같은 모양으로 뽑는다. 학생이 아두이노 실측과
// 1인칭 조사 결과를 같은 표에 놓고 비교할 수 있어야 하기 때문이다.
// ============================================================================

const FPField = {
  rows: [],          // {n, kind, label, spot, zone, value, unit, x, z, co2, hour, iso}
  transect: null,    // 진행 중인 횡단 조사
  panelOpen: false,
  tab: 'tasks',      // 야장을 열면 먼저 보이는 탭 - 처음 온 학생에게는 '무엇을 할지'가 먼저다
  exports: 0,        // CSV 내보내기 횟수 (탐구 과제 ④)
  _doneTasks: new Set(),
};

const SPOT_KO = {
  sea: '해수', ice: '빙하', beach: '해변 모래', green: '녹지 지면', city: '도시 지면',
  airOcean: '해양 대기', airGreen: '녹지 대기', airCity: '도심 대기',
  bodyRabbit: '토끼 체온', bodyDeer: '사슴 체온', bodyWolf: '늑대 체온',
  bodyBear: '곰 체온', bodyFish: '어류 체온',
};
const KIND_KO = { temp: '온도', ph: 'pH', co2: 'CO2', sea: '해수분석' };
// 바다를 잰 기록은 냉수대·경계·개방 해역으로 나눠 적는다 (유빙과의 거리로 정하는 위치 구분)
const SEA_CLASS_KO = { cold: '냉수대', edge: '냉수대 경계', open: '개방 해역' };
const CORAL_NEAR = 0.06;   // 산호에서 이 거리(실척 3m) 안에서 잰 바다 기록은 '산호 곁'으로 본다
// 해수 분석기 채널 (야장 통계·CSV가 쓰는 이름과 소수 자리)
const SW_CH = [
  { key: 'co2aq', ko: '해수분석 용존CO₂(µmol/kg)', unit: 'µmol/kg', dec: 1 },
  { key: 'dic',   ko: '해수분석 DIC(µmol/kg)',     unit: 'µmol/kg', dec: 0 },
  { key: 'omega', ko: '해수분석 Ω',                unit: '',        dec: 2 },
  { key: 'temp',  ko: '해수분석 수온(°C)',          unit: '°C',      dec: 2 },
];

// ── 기록 ────────────────────────────────────────────────────────────────────
// FPTools가 측정을 '확정'했을 때만 부른다(수렴 중인 값은 기록하지 않는다).
FPField.record = function (tool, value, reading) {
  // 해수 분석기는 한 번에 네 값(용존CO2·DIC·Ω·수온)을 낸다. 대표값은 Ω로 두고
  // 나머지는 sw에 함께 담는다. pH미터가 병기한 수온은 waterTemp에 둔다.
  const spec = { temp: '°C', ph: 'pH', co2: 'ppm', sea: 'Ω' }[tool.kind];
  const x = reading.at ? reading.at.x : FPPlayer.pos.x;
  const z = reading.at ? reading.at.z : FPPlayer.pos.z;
  // 바다를 잰 기록(온도계·pH미터·해수 분석기)은 어느 바다인지까지 적는다
  const isSea = reading.spot === 'sea' && tool.kind !== 'co2';
  const seaClass = isSea ? seaZoneClass(x, z) : null;
  const row = {
    n: this.rows.length + 1,
    kind: tool.kind,
    kindKo: KIND_KO[tool.kind],
    spot: reading.spot || '',
    spotKo: isSea ? `해수(${SEA_CLASS_KO[seaClass]})` : (SPOT_KO[reading.spot] || (reading.zone || '')),
    zone: reading.zone || '',
    seaClass,
    nearCoral: isSea && nearestCoralDist(x, z) < CORAL_NEAR,
    value,
    unit: spec,
    x, z,
    co2: FPWorld.co2,
    // ── 해수 상태·바람·게임 시간 (CSV 뒤쪽 열) ──
    sw: reading.values ? { ...reading.values } : null,     // 해수 분석기 측정값 (용존CO2·DIC·Ω·수온)
    waterTemp: reading.waterTemp != null ? reading.waterTemp                 // pH미터 병기 수온
             : (reading.values ? reading.values.temp
             : (tool.kind === 'temp' && isSea ? value : null)),               // 온도계로 잰 해수
    pco2Sw: FPWorld.pco2Sea,                  // 그 순간 해수 pCO2 (모형 상태)
    wind: FPAir.windLabel(),                  // 해풍 / 육풍 / 무풍
    gameTime: FPAir.elapsedDays * 24,         // 조사 시작 후 흐른 게임 시간 [h] (시각을 멈춰도 흐름)
    hour: FPWorld.hour,
    iso: new Date().toISOString(),
  };
  this.rows.push(row);
  // 이스터에그: 살아 있는 것의 체온을 처음 쟀을 때만 요점을 한 번 짚어 준다
  if (reading.creature && !this._bodySeen) {
    this._bodySeen = true;
    this.toast(row.spotKo.includes('어류')
      ? '🐟 어류는 변온동물이라 체온이 곧 수온입니다. 육지 동물과 비교해 보세요.'
      : '🐾 정온동물은 바깥 온도가 변해도 체온이 일정합니다. CO₂를 올려 보세요.', 6500);
  }
  if (this.transect) this.addTransectPoint(row);
  this.checkTasks();
  this.refresh();
  this.flash();
};

FPField.clear = function () {
  this.rows.length = 0;
  this.transect = null;
  this.exports = 0;
  this._doneTasks.clear();
  // 진행 중이던 측정이 나중에 확정돼서 '지운 뒤'에 한 줄 끼어드는 일을 막는다
  if (typeof FPTools !== 'undefined') FPTools.slots.forEach(t => { if (t) t.reading = null; });
  this.refresh();
};

// ── 탐구 과제 ───────────────────────────────────────────────────────────────
// 이 모드에 튜토리얼도 과제도 없어서, 학생을 떨어뜨려 놓으면 뭘 할지 몰랐다.
// 새 과학을 만들지 않고 설계안(10.09변경사항정리.md) 8절의 학습 활동 ①~④를 그대로 옮겼다.
//
// 판정은 '야장에 쌓인 기록 수'로만 한다. 모형 값이나 측정값이 맞는지는 보지 않는다 -
// 계측 노이즈 때문에 판정이 흔들리면 안 되고, 결론은 학생이 평균·표준편차로 내야 하기 때문이다.
// 바다 기록의 '냉수대/개방 해역'·'산호 곁'은 값이 아니라 잰 위치로 나눈 것이다(record 참고).
const NIGHT_FROM = 18, NIGHT_TO = 6;       // 활동 ②의 '저녁~새벽' (시계 시각 기준)
function isEveningToDawn(hour) { return hour >= NIGHT_FROM || hour < NIGHT_TO; }
const INQUIRY = [
  {
    id: 1, title: '① 차가운 바다 vs 따뜻한 바다',
    concept: '헨리 법칙 · 온도와 평형상수 · 상쇄 효과',
    goal: '수온이 다른 두 바다에서 용존 CO₂ · Ω · pH가 어떻게 다른지 비교한다.',
    how: '냉수대(유빙 바로 옆)와 개방 해역에서 4번 해수분석기로 각각 5회 이상, 2번 pH미터로 각각 3회 이상 재시오.',
    think: '차가운 물이 CO₂를 더 많이 녹이는데 pH는 왜 거의 같을까? 평형상수 여러 개가 함께 움직이면?',
    subs: [
      { label: '냉수대 분석', goal: 5, test: r => r.kind === 'sea' && r.seaClass === 'cold' },
      { label: '개방 해역 분석', goal: 5, test: r => r.kind === 'sea' && r.seaClass === 'open' },
      { label: '냉수대 pH', goal: 3, test: r => r.kind === 'ph' && r.seaClass === 'cold' },
      { label: '개방 해역 pH', goal: 3, test: r => r.kind === 'ph' && r.seaClass === 'open' },
    ],
  },
  {
    id: 2, title: '② 밤바람이 바다를 바꾼다',
    concept: '대기–해양 상호작용 · 동적 평형 · 측정 오차와 평균',
    goal: '밤 육풍이 도심 CO₂를 바다로 실어 오면 해수 pH가 어떻게 변하는지 시간을 두고 본다.',
    how: '저녁~새벽(18~06시)에 바다 위 공기 CO₂(3번)와 해수 pH(2번)를 각각 5회 이상, 비교용으로 낮에도 해수 pH를 5회 재시오. 시각은 설정(E)에서 옮기거나 T로 흐르게 하세요.',
    think: '바다는 대기를 천천히 따라갑니다(약 2게임일). 밤으로 옮기자마자 재면 아직 낮의 바다입니다 — 설정창의 해수 pCO₂가 해양 대기에 다가갈 때까지 기다리며 반복해서 재고 평균을 비교하세요. 차이(약 0.02~0.03)는 pH미터 오차(±0.02)와 비슷합니다.',
    subs: [
      { label: '밤 해양 대기 CO₂', goal: 5, test: r => r.kind === 'co2' && r.zone === 'ocean' && isEveningToDawn(r.hour) },
      { label: '밤 해수 pH', goal: 5, test: r => r.kind === 'ph' && isEveningToDawn(r.hour) },
      { label: '낮 해수 pH', goal: 5, test: r => r.kind === 'ph' && !isEveningToDawn(r.hour) },
    ],
  },
  {
    id: 3, title: '③ 백화인가, 석회화 저해인가',
    concept: '열 스트레스와 산성화의 구분 (오개념 교정)',
    goal: '따뜻한 곳 산호와 차가운 곳 산호가 서로 다른 이유로 아프다는 것을 구분한다.',
    how: '산호 바로 곁(3 m 이내) 바다를 4번 해수분석기로 — 개방 해역 산호 3회, 냉수대 산호 3회 재시오.',
    think: 'CO₂를 600 ppm 이상으로 올려 보세요. 하얗게 바랜 산호(백화)와 회갈색으로 쪼그라든 산호(석회화 저해)는 각각 어디에 있나? 원인은 수온인가 Ω인가?',
    subs: [
      { label: '개방 해역 산호', goal: 3, test: r => r.kind === 'sea' && r.nearCoral && r.seaClass === 'open' },
      { label: '냉수대 산호', goal: 3, test: r => r.kind === 'sea' && r.nearCoral && r.seaClass !== 'open' },
    ],
  },
  {
    id: 4, title: '④ 상자 속 바다와 모형',
    concept: '평형 모형의 예측력과 한계 · 완충 작용 · 실측–가상 융합',
    goal: '아크릴 상자 실측과 비교할 가상 바다의 기준값을 만든다.',
    how: '해양 대기 CO₂ · 해수 수온 · 해수 pH를 각각 3회 이상 기록하고 CSV로 내보내시오. 상자 실측은 조감 모드 \'실시간 실험\' 탭에서 같은 형식의 CSV로 받아 한 표에 놓고 비교합니다.',
    think: '같은 CO₂ · 같은 수온이면 모형은 같은 pH를 냅니다. 상자 속 실측 pH는 모형을 얼마나 따르나? 어긋난다면 왜일까? (인공해수 · 총알칼리도 · 평형까지 걸리는 시간)',
    subs: [
      { label: '해양 대기 CO₂', goal: 3, test: r => r.kind === 'co2' && r.zone === 'ocean' },
      { label: '해수 수온', goal: 3, test: r => r.waterTemp != null && r.zone === 'ocean' },
      { label: '해수 pH', goal: 3, test: r => r.kind === 'ph' },
      { label: 'CSV 내보내기', goal: 1, exportCount: true },
    ],
  },
];
FPField.taskProgress = function () {
  return INQUIRY.map(t => {
    const subs = t.subs.map(s => {
      const n = s.exportCount ? this.exports : this.rows.reduce((a, r) => a + (s.test(r) ? 1 : 0), 0);
      return { label: s.label, goal: s.goal, n, ok: n >= s.goal };
    });
    const need = subs.reduce((a, s) => a + s.goal, 0);
    const have = subs.reduce((a, s) => a + Math.min(s.n, s.goal), 0);
    return { task: t, subs, frac: have / need, done: subs.every(s => s.ok) };
  });
};
// 새로 완료된 과제가 있으면 한 번만 알려 준다
FPField.checkTasks = function () {
  for (const p of this.taskProgress()) {
    if (p.done && !this._doneTasks.has(p.task.id)) {
      this._doneTasks.add(p.task.id);
      this.toast(`✅ 탐구 과제 ${p.task.title} 완료 — 야장(F) '기록 · 통계'에서 평균을 비교해 보세요.`, 6500);
    }
  }
};
FPField.renderTasks = function () {
  const box = document.getElementById('fieldTasks');
  if (!box) return;
  const prog = this.taskProgress();
  const doneN = prog.filter(p => p.done).length;
  const tally = document.getElementById('fieldTaskTally');
  if (tally) tally.textContent = `${doneN}/${prog.length}`;
  const intro = document.getElementById('fieldTaskIntro');
  if (intro) {
    intro.innerHTML = !this.rows.length
      ? '<b>어디서부터?</b> ①부터 시작하세요. 키 <b>4</b>로 해수분석기를 들고, 바다 위 흰 얼음(유빙) <b>바로 옆 바다</b>를 겨눠 좌클릭합니다. ' +
        '표시창 아래 막대가 다 차면 값이 야장에 자동으로 기록되고, 아래 카드의 진행도가 올라갑니다. 그다음 유빙에서 멀리 떨어진 바다에서도 똑같이 재세요.'
      : (doneN === prog.length
        ? '<b>네 과제를 모두 마쳤습니다.</b> \'기록 · 통계\' 탭의 평균·표준편차로 각 과제의 질문에 답해 보세요.'
        : `<b>${doneN}/${prog.length} 완료.</b> 회색 칸이 남은 조건입니다. 같은 지점을 여러 번 재야 하는 이유는 계측기 오차 때문입니다 — 한 번 잰 값은 못 믿습니다.`);
  }
  box.innerHTML = prog.map(p => {
    const t = p.task;
    return `<div class="task-card${p.done ? ' done' : ''}">` +
      `<div class="t-head"><span class="t-title">${t.title}</span>` +
      `<span class="t-badge">${p.done ? '✓ 완료' : Math.round(p.frac * 100) + '%'}</span></div>` +
      `<div class="t-concept">${t.concept}</div>` +
      `<p class="t-line"><b>목표</b> ${t.goal}</p>` +
      `<p class="t-line"><b>조건</b> ${t.how}</p>` +
      `<div class="t-bar"><i style="width:${(p.frac * 100).toFixed(0)}%"></i></div>` +
      `<div class="t-subs">${p.subs.map(s =>
        `<span class="t-sub${s.ok ? ' ok' : ''}">${s.label} ${Math.min(s.n, s.goal)}/${s.goal}</span>`).join('')}</div>` +
      `<p class="t-think">생각해 볼 것: ${t.think}</p>` +
      `</div>`;
  }).join('');
};
FPField.setTab = function (tab) {
  this.tab = tab;
  document.querySelectorAll('.field-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const tv = document.getElementById('fieldTasksView'), rv = document.getElementById('fieldRecordsView');
  if (tv) tv.classList.toggle('hidden', tab !== 'tasks');
  if (rv) rv.classList.toggle('hidden', tab !== 'records');
  if (tab === 'records') this.drawTransect();
};

// ── 통계: 같은 지점 종류를 반복 측정했을 때의 평균과 표준편차 ────────────────
// 계측기에 재현성 오차를 넣어 둔 이유가 여기 있다. 한 번 잰 값은 못 믿고,
// 여러 번 재서 평균을 내야 참값에 가까워진다는 걸 표로 보게 하려는 것이다.
// 해수 분석기 기록 한 줄은 용존CO2·DIC·Ω·수온 네 항목으로 펼쳐서 센다.
FPField.summary = function () {
  const g = new Map();
  const add = (key, kindKo, spotKo, unit, dec, v) => {
    if (!g.has(key)) g.set(key, { kindKo, spotKo, unit, dec, v: [] });
    g.get(key).v.push(v);
  };
  for (const r of this.rows) {
    if (r.sw) {
      for (const ch of SW_CH) add(r.kind + ch.key + '|' + r.spotKo, ch.ko, r.spotKo, ch.unit, ch.dec, r.sw[ch.key]);
    } else {
      add(r.kind + '|' + r.spotKo, r.kindKo, r.spotKo, r.unit, r.unit === 'ppm' ? 0 : 2, r.value);
    }
  }
  const out = [];
  for (const s of g.values()) {
    const n = s.v.length;
    const mean = s.v.reduce((a, b) => a + b, 0) / n;
    // 표본표준편차(n-1). 측정 자료를 다룰 때 쓰는 쪽이다.
    const sd = n > 1 ? Math.sqrt(s.v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    out.push({ ...s, n, mean, sd });
  }
  out.sort((a, b) => a.kindKo.localeCompare(b.kindKo) || a.spotKo.localeCompare(b.spotKo));
  return out;
};

// ── 횡단 조사 ───────────────────────────────────────────────────────────────
// 해안에서 도심까지 일직선으로 걸으며 일정 간격마다 측정하는, 야외조사의 기본 설계.
// 시작점을 잡아 두면 이후 측정이 '시작점으로부터의 거리'와 함께 기록되고,
// 거리-값 그래프가 그려진다. 도시 열섬은 이 그래프 한 장으로 끝난다.
FPField.startTransect = function () {
  const p = FPPlayer.pos;
  this.transect = {
    x0: p.x, z0: p.z,
    // 측정 항목별로 따로 모은다. 온도와 CO2를 한 축에 겹쳐 그리면 눈금이 무의미해지지만,
    // 처음 찍힌 항목으로 고정해 버리면 그 뒤 다른 도구로 잰 값이 전부 조용히 버려진다.
    // (실제로 그랬다: 앞선 CO2 측정 하나 때문에 온도 17점이 통째로 사라졌다.)
    // 한 번 걸으면서 온도도 재고 CO2도 재는 편이 조사로서도 자연스럽다.
    byKind: new Map(),
    startedAt: new Date().toISOString(),
  };
  this.refresh();
};
// 해안선 평행 조사 프리셋: 빙하 냉수대 → 개방 해역. 시작점을 내 자리 대신 가장 가까운
// 유빙 중심에 둔다. 해수 분석기로 재면 거리-수온·Ω 그래프가 한 장에 같이 그려진다.
FPField.startCoastTransect = function () {
  const p = FPPlayer.pos;
  let best = null, bd = Infinity;
  for (const ice of FPWorld.iceMeshes) {
    const c = ice.userData.collider;
    if (!c) continue;
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return this.startTransect();
  this.transect = {
    x0: best.x, z0: best.z, preset: 'coast',
    byKind: new Map(),
    startedAt: new Date().toISOString(),
  };
  this.refresh();
};
FPField.addTransectPoint = function (row) {
  const T = this.transect;
  if (!T.byKind.has(row.kind)) T.byKind.set(row.kind, []);
  const arr = T.byKind.get(row.kind);
  const d = Math.hypot(row.x - T.x0, row.z - T.z0) * 50;   // 1유닛 = 50m
  arr.push({ d, v: row.value, t: row.sw ? row.sw.temp : null, spotKo: row.spotKo, zone: row.zone });
  arr.sort((a, b) => a.d - b.d);
};
// 그래프에 그릴 계열: 지금 들고 있는 도구의 항목을 우선하되, 그게 부족하면 점이 가장 많은 쪽.
FPField.transectSeries = function () {
  const T = this.transect;
  if (!T) return null;
  // 해안선 평행 조사는 수온·Ω를 한 장에 보려는 조사라 해수 분석기 계열을 먼저 그린다
  if (T.preset === 'coast' && T.byKind.get('sea') && T.byKind.get('sea').length >= 2) {
    return { kind: 'sea', points: T.byKind.get('sea') };
  }
  const held = FPTools.slots[FPTools.selected];
  if (held && T.byKind.get(held.kind) && T.byKind.get(held.kind).length >= 2) {
    return { kind: held.kind, points: T.byKind.get(held.kind) };
  }
  let best = null;
  for (const [kind, points] of T.byKind) {
    if (!best || points.length > best.points.length) best = { kind, points };
  }
  return best;
};
FPField.endTransect = function () {
  this.transect = null;
  this.refresh();
};

// ── CSV ─────────────────────────────────────────────────────────────────────
// 조감 모드 '실시간 실험' 탭이 내보내는 CSV와 같은 자리에 같은 뜻의 열을 둔다.
// BOM을 붙이는 이유: 안 붙이면 엑셀이 한글 헤더를 깨서 연다.
FPField.toCSV = function () {
  // 앞 12열은 예전 그대로(순서·이름 불변). 해수 상태·바람·게임 시간은 그 뒤에 붙인다.
  // 해당 없는 칸은 비워 둔다(예: 온도계 기록의 co2_aq).
  const head = ['번호', '측정항목', '측정지점', '구역', '측정값', '단위',
                'X(m)', 'Z(m)', '시작점거리(m)', '설정CO2(ppm)', '시각(h)', '기록시각',
                'water_temp(°C)', 'co2_aq(µmol/kg)', 'dic(µmol/kg)', 'omega',
                'pco2_sw(ppm)', 'wind', 'game_time(h)'];
  const f = (v, d) => (v == null || !isFinite(v) ? '' : v.toFixed(d));
  const T = this.transect;
  const lines = [head.join(',')];
  for (const r of this.rows) {
    const d = T ? (Math.hypot(r.x - T.x0, r.z - T.z0) * 50).toFixed(1) : '';
    lines.push([
      r.n, r.kindKo, r.spotKo, r.zone, r.value.toFixed(r.unit === 'ppm' ? 0 : 2), r.unit,
      (r.x * 50).toFixed(1), (r.z * 50).toFixed(1), d, r.co2,
      r.hour == null ? '' : r.hour.toFixed(2), r.iso,
      f(r.waterTemp, 1), f(r.sw && r.sw.co2aq, 1), f(r.sw && r.sw.dic, 0), f(r.sw && r.sw.omega, 2),
      f(r.pco2Sw, 1), r.wind || '', f(r.gameTime, 2),
    ].join(','));
  }
  return '﻿' + lines.join('\r\n');
};
FPField.download = function () {
  if (!this.rows.length) return;
  this.exports++;
  this.checkTasks();
  this.refresh();
  const blob = new Blob([this.toCSV()], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  a.download = `미니지구_야외조사_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ── 화면 ────────────────────────────────────────────────────────────────────
FPField.init = function () {
  this.el = document.getElementById('fieldPanel');
  this.badge = document.getElementById('fieldBadge');
  document.getElementById('fieldCsvBtn').addEventListener('click', () => this.download());
  document.getElementById('fieldClearBtn').addEventListener('click', () => this.clear());
  document.getElementById('fieldTransectBtn').addEventListener('click', () => {
    if (this.transect) this.endTransect(); else this.startTransect();
  });
  document.getElementById('fieldCoastBtn').addEventListener('click', () => {
    if (this.transect) this.endTransect(); else this.startCoastTransect();
  });
  document.getElementById('fieldCloseBtn').addEventListener('click', () => this.close());
  document.querySelectorAll('.field-tabs button').forEach(b =>
    b.addEventListener('click', () => this.setTab(b.dataset.tab)));
  this.setTab(this.tab);
  this.refresh();
};
FPField.open = function () {
  this.panelOpen = true;
  this.el.classList.remove('hidden');
  this.refresh();
};
FPField.close = function () {
  this.panelOpen = false;
  this.el.classList.add('hidden');
};
FPField.toggle = function () { this.panelOpen ? this.close() : this.open(); };

// 짧은 안내 문구. 이스터에그를 처음 발견했을 때 한 번만 띄운다.
FPField.toast = function (msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(this._toastT);
  this._toastT = setTimeout(() => el.classList.remove('on'), ms || 5000);
};

// 측정이 기록될 때마다 화면 구석 배지를 잠깐 밝힌다 (패널을 안 열어놔도 남은 걸 알게)
FPField.flash = function () {
  if (!this.badge) return;
  this.badge.classList.add('on');
  clearTimeout(this._flashT);
  this._flashT = setTimeout(() => this.badge.classList.remove('on'), 700);
};

FPField.refresh = function () {
  if (!this.el) return;
  const cnt = document.getElementById('fieldCount');
  if (cnt) cnt.textContent = this.rows.length;
  const doneN = this._doneTasks.size;
  if (this.badge) this.badge.textContent = `야장 ${this.rows.length} · 과제 ${doneN}/${INQUIRY.length}`;
  this.renderTasks();
  const tb = document.getElementById('fieldTBody');
  if (tb) {
    const recent = this.rows.slice(-12).reverse();
    tb.innerHTML = recent.length ? recent.map(r =>
      `<tr><td>${r.n}</td><td>${r.kindKo}</td><td>${r.spotKo}</td>` +
      `<td class="num">${r.sw ? `Ω ${r.sw.omega.toFixed(2)} · ${r.sw.temp.toFixed(1)}°C`
                               : `${r.value.toFixed(r.unit === 'ppm' ? 0 : 2)} ${r.unit}`}</td>` +
      `<td class="num dim">${(r.x * 50).toFixed(0)}, ${(r.z * 50).toFixed(0)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">아직 기록이 없습니다. 도구를 들고 좌클릭해 측정하세요.</td></tr>';
  }
  const sb = document.getElementById('fieldSummary');
  if (sb) {
    const s = this.summary();
    sb.innerHTML = s.length ? s.map(r =>
      `<tr><td>${r.kindKo}</td><td>${r.spotKo}</td><td class="num">${r.n}</td>` +
      `<td class="num">${r.mean.toFixed(r.dec)}</td>` +
      `<td class="num">${r.sd == null ? '—' : '±' + r.sd.toFixed(r.dec + 1)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="empty">같은 지점을 두 번 이상 재면 평균과 표준편차가 나옵니다.</td></tr>';
  }
  const tBtn = document.getElementById('fieldTransectBtn');
  if (tBtn) tBtn.textContent = this.transect ? '횡단 조사 종료' : '횡단 조사 시작';
  const cBtn = document.getElementById('fieldCoastBtn');
  if (cBtn) cBtn.style.display = this.transect ? 'none' : '';
  const tState = document.getElementById('fieldTransectState');
  if (tState) {
    if (this.transect) {
      const parts = [...this.transect.byKind].map(([k, v]) => `${KIND_KO[k]} ${v.length}점`);
      const coast = this.transect.preset === 'coast';
      tState.textContent =
        (coast ? '해안선 평행 조사 · 유빙 ' : '시작점 ') +
        `(${(this.transect.x0 * 50).toFixed(0)}, ${(this.transect.z0 * 50).toFixed(0)}) 기준 · ` +
        (parts.length ? parts.join(' · ') : (coast
          ? '유빙 옆 바다부터 개방 해역 쪽으로 멀어지며 4번 해수분석기로 일정 간격마다 재세요'
          : '아직 측정 없음'));
    } else {
      tState.textContent = '시작할 지점에 서서 버튼을 누르고, 일직선으로 걸으며 일정 간격마다 측정하세요. ' +
        '"해안선 평행 조사"는 가장 가까운 유빙을 시작점으로 잡습니다(냉수대 → 개방 해역).';
    }
  }
  this.drawTransect();
};

// 거리-값 그래프. 외부 라이브러리 없이 캔버스에 직접 그린다
// (1인칭 모드는 three.js 말고는 의존성을 안 두는 게 원칙이라서).
FPField.drawTransect = function () {
  const cv = document.getElementById('fieldChart');
  if (!cv) return;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  const T = this.transect;
  const series = this.transectSeries();
  const pts = series ? series.points : [];
  const PAD_L = 46, PAD_R = 12, PAD_T = 12, PAD_B = 26;

  c.fillStyle = '#0d1418';
  c.fillRect(0, 0, W, H);
  if (pts.length < 2) {
    c.fillStyle = '#5b6a72';
    c.font = '13px sans-serif';
    c.textAlign = 'center';
    c.fillText(T ? '두 지점 이상 측정하면 그래프가 그려집니다' : '횡단 조사를 시작하세요', W / 2, H / 2);
    return;
  }
  const dMax = Math.max(...pts.map(p => p.d)) || 1;
  let vMin = Math.min(...pts.map(p => p.v)), vMax = Math.max(...pts.map(p => p.v));
  if (vMax - vMin < 1e-6) { vMax += 1; vMin -= 1; }
  const pad = (vMax - vMin) * 0.15;
  vMin -= pad; vMax += pad;
  const X = d => PAD_L + (d / dMax) * (W - PAD_L - PAD_R);
  const Y = v => H - PAD_B - ((v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);

  // 축 + 눈금
  c.strokeStyle = '#2a3a42'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(PAD_L, PAD_T); c.lineTo(PAD_L, H - PAD_B); c.lineTo(W - PAD_R, H - PAD_B); c.stroke();
  c.fillStyle = '#7e8f99'; c.font = '11px sans-serif'; c.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const v = vMin + (vMax - vMin) * i / 3;
    c.fillText(v.toFixed(1), PAD_L - 5, Y(v) + 4);
    c.strokeStyle = '#1c2a31';
    c.beginPath(); c.moveTo(PAD_L, Y(v)); c.lineTo(W - PAD_R, Y(v)); c.stroke();
  }
  c.textAlign = 'center';
  c.fillText('0', PAD_L, H - 8);
  c.fillText(dMax.toFixed(0) + ' m', W - PAD_R, H - 8);

  // 구역별 점 색: 해양 파랑 / 녹지 초록 / 도심 주황
  const ZC = { ocean: '#5aa9d6', green: '#6fbf5a', city: '#e2934b' };
  c.strokeStyle = '#9fb3bd'; c.lineWidth = 2;
  c.beginPath();
  pts.forEach((p, i) => { const x = X(p.d), y = Y(p.v); i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.stroke();
  for (const p of pts) {
    c.fillStyle = ZC[p.zone] || '#9fb3bd';
    c.beginPath(); c.arc(X(p.d), Y(p.v), 4, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#7e8f99'; c.font = '11px sans-serif'; c.textAlign = 'left';
  c.fillText(series.kind === 'sea' ? 'Ω (해수 분석기)' : (KIND_KO[series.kind] || ''), PAD_L + 4, PAD_T + 10);

  // 해수 분석기: 같은 점들의 수온을 오른쪽 축으로 겹쳐 그린다 (냉수대에서 멀어질수록 수온↑ Ω↑)
  const tp = series.kind === 'sea' ? pts.filter(p => p.t != null) : [];
  if (tp.length >= 2) {
    let tMin = Math.min(...tp.map(p => p.t)), tMax = Math.max(...tp.map(p => p.t));
    if (tMax - tMin < 1e-6) { tMax += 1; tMin -= 1; }
    const tPad = (tMax - tMin) * 0.15;
    tMin -= tPad; tMax += tPad;
    const YT = v => H - PAD_B - ((v - tMin) / (tMax - tMin)) * (H - PAD_T - PAD_B);
    c.strokeStyle = '#e2934b'; c.lineWidth = 1.5; c.setLineDash([4, 3]);
    c.beginPath();
    tp.forEach((p, i) => { const x = X(p.d), y = YT(p.t); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke(); c.setLineDash([]);
    c.fillStyle = '#e2934b';
    for (const p of tp) { c.beginPath(); c.arc(X(p.d), YT(p.t), 3, 0, Math.PI * 2); c.fill(); }
    c.textAlign = 'right'; c.font = '11px sans-serif';
    c.fillText(`수온 ${tMax.toFixed(1)}°C`, W - PAD_R, PAD_T + 10);
    c.fillText(`${tMin.toFixed(1)}°C`, W - PAD_R, H - PAD_B - 4);
  }
};
