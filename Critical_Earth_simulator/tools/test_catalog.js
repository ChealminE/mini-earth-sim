// ============================================================================
// 자료 목록(js/data-catalog.js) · 그래프 작업대 계산(GraphWorkspaceCore) 검사 (3차 C1·C2, node)
// ----------------------------------------------------------------------------
// 교사가 data-catalog.js 를 고친 뒤 이것만 돌려 보면 되게 한다: 출처 키·색 토큰·정해진 값·자료 모양.
// 실행: node tools/test_catalog.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

// 브라우저와 같은 순서로 전역 스크립트를 한 컨텍스트에 불러온다 (index.html: … sources → earth-system → … → data-catalog)
const ctx = vm.createContext({ console, Math });
for (const f of ['js/earth-model.js', 'js/earth-data.js', 'js/sources.js', 'js/earth-system.js', 'js/data-catalog.js', 'js/graph-workspace.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { CAT, AXES, DECKS, HINTS, SOURCES } = vm.runInContext(
  '({ CAT: DATA_CATALOG, AXES: DATA_AXES, DECKS: DATA_DECKS, HINTS: DATA_HINTS, SOURCES })', ctx);
const theme = fs.readFileSync(path.join(ROOT, 'css/theme.css'), 'utf8');

// ── 1) 항목 형식 ──
const SCOPES = ['global', 'station', 'model'];
const FIELDS = ['id', 'label', 'short', 'unit', 'axis', 'src', 'scope', 'color', 'minSpan', 'order', 'deck', 'get'];
for (const it of CAT) {
  const missing = FIELDS.filter(k => it[k] === undefined);
  check(!missing.length, `${it.id}: 필드`, missing.length ? '없음: ' + missing.join(', ') : '');
  const srcs = [].concat(it.src);
  const bad = srcs.filter(k => !SOURCES[k]);
  check(srcs.length > 0 && !bad.length, `${it.id}: 출처 키가 js/sources.js 에 있음`, bad.join(', '));
  check(it.axis in AXES, `${it.id}: axis '${it.axis}' 가 DATA_AXES 에 있음`);
  check(SCOPES.includes(it.scope), `${it.id}: scope '${it.scope}'`);
  check(it.deck in DECKS, `${it.id}: deck '${it.deck}'`);
  check(new RegExp(`${it.color}\\s*:`).test(theme), `${it.id}: 색 토큰 ${it.color} 가 css/theme.css 에 있음`);
  check(typeof it.minSpan === 'number' && it.minSpan > 0, `${it.id}: minSpan > 0`);
  // 모형 계산 자료는 점선·'모형' 꼬리표로 관측과 구분한다(작업대 R7) — 출처도 모형/보정 항목이어야 한다
  if (it.scope === 'model') check(srcs.every(k => ['model', 'calibrated'].includes(SOURCES[k].kind)), `${it.id}: 모형 자료의 출처 종류가 model/calibrated`);
  else check(srcs.every(k => SOURCES[k].kind === 'obs'), `${it.id}: 관측 자료의 출처 종류가 obs`);
}
const dup = key => CAT.map(it => it[key]).filter((v, i, a) => a.indexOf(v) !== i);
check(!dup('id').length, 'id 중복 없음', dup('id').join(', '));
check(!dup('order').length, 'order 중복 없음', dup('order').join(', '));
const core = CAT.filter(it => it.deck === 'core').sort((a, b) => a.order - b.order).map(it => it.id);
check(core.join() === 'co2,temp,sst,ph', '기본 4장 순서 CO₂ → 기온 → 해수온 → pH (마스터 결정 2)', core.join(' → '));
check(CAT.filter(it => it.axis === 'dT').map(it => it.id).join() === 'temp,sst', '기온·해수온은 같은 축(dT)', '');

// ── 2) 자료 모양 ──
for (const it of CAT) {
  const pts = it.get();
  const okNum = pts.length > 1 && pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  check(okNum, `${it.id}: 점 ${pts.length}개, 연도·값 모두 수`, `${pts[0]?.x}~${pts[pts.length - 1]?.x}`);
  const inc = pts.every((p, i) => i === 0 || p.x > pts[i - 1].x);
  check(inc, `${it.id}: 연도가 엄격히 증가`);
  for (const p of pts.filter(q => q.seg)) {
    check(typeof p.seg.text === 'string' && SOURCES[p.seg.src], `${it.id}: ${p.x}년 이음 표시(seg)에 글과 출처 키`);
  }
  if (pts.some(p => p.lo !== undefined)) check(pts.every(p => p.lo <= p.y && p.y <= p.hi), `${it.id}: lo ≤ 값 ≤ hi`);
}
// 같은 페이지에서 두 번 불러도 같은 배열(모형 실행 캐시)이어야 한다
const a1 = CAT.find(it => it.id === 'sink_ocean').get(), a2 = CAT.find(it => it.id === 'sink_land').get();
check(a1.length === a2.length && a1[a1.length - 1].x === 2023, '모형 자료: 1750~2023 역사 실행 한 번 (바다·육지 같은 길이)', `${a1[0].x}~${a1[a1.length - 1].x}`);
const co2 = CAT.find(it => it.id === 'co2').get();
check(co2.filter(p => p.seg).map(p => p.x).join() === '1979', 'CO₂: CMIP6 → NOAA 이음 표시는 1979년 한 곳');

// ── 3) 안내 문구 ──
for (const h of HINTS.pairs) {
  check(h.pair.length === 2 && h.pair.every(id => CAT.some(it => it.id === id)), `안내 문구 짝 ${h.pair.join('+')} 가 목록에 있음`);
  check(/\?/.test(h.text), `안내 문구 ${h.pair.join('+')} 는 질문으로 (결론을 말하지 않음)`);
}

// ── 4) 그래프 작업대 계산 (js/graph-workspace.js GraphWorkspaceCore) — 합성 자료 ──
const G = vm.runInContext('GraphWorkspaceCore', ctx);
const line = (from, to, f) => Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y: f(from + i, i) }));
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
{
  // R3: minSpan 보다 좁은 자료 → 범위 폭 = minSpan (pH 0.01 출렁임이 급변처럼 보이지 않게)
  const r = G.axisRange([8.050, 8.055, 8.060], 0.1, 0.05);
  check(near(r.max - r.min, 0.1) && near((r.max + r.min) / 2, 8.055), 'axisRange: 좁은 자료는 폭 = minSpan, 가운데 유지', `${r.min.toFixed(4)}~${r.max.toFixed(4)}`);
  const w = G.axisRange([0, 10], 1, 0.05);
  check(near(w.min, -0.5) && near(w.max, 10.5), 'axisRange: 넓은 자료는 위아래 5 % 여백', `${w.min}~${w.max}`);
  check(G.axisRange([NaN, undefined], 1) === null, 'axisRange: 값이 없으면 null');
}
{
  const a = line(1750, 2025, x => x), b = line(1989, 2024, x => -x), c = line(1600, 1700, x => x);
  const cp = G.commonPeriod(a, b);
  check(cp && cp.from === 1989 && cp.to === 2024, 'commonPeriod: 1750~2025 ∩ 1989~2024 = 1989~2024', JSON.stringify(cp));
  check(G.commonPeriod(a, c) === null, 'commonPeriod: 겹치지 않으면 null (산점도·모양 비교 비활성)');
  const up = G.unionPeriod(a, b);
  check(up.from === 1750 && up.to === 2025, 'unionPeriod: 시간 보기 x축은 합집합', JSON.stringify(up));
  const n = G.normalize(line(2000, 2010, (x, i) => 5 + 2 * i), { from: 2002, to: 2006 });
  check(n.length === 5 && near(n[0].y, 0) && near(n[4].y, 1) && near(n[2].y, 0.5), 'normalize: 기간 안 최소 0 · 최대 1');
  const p1 = G.pearson(line(1990, 2020, x => 3 * x + 1), line(1985, 2010, x => 0.5 * x - 7));
  check(near(p1.r, 1) && p1.n === 21, '완전 상관 r = 1 (공통 연도 1990~2010, n = 21)', `r=${p1.r} n=${p1.n}`);
  const p2 = G.pearson(line(1990, 2020, x => x), line(1990, 2020, x => -2 * x));
  check(near(p2.r, -1), '반대 상관 r = −1', `r=${p2.r}`);
  const p3 = G.pearson(line(1990, 2020, x => x), line(1990, 2020, () => 4));
  check(p3.r === null, '한쪽이 일정하면 r 계산 불가(null)');
  check(G.pearson(a, c).n === 0 && G.pearson(a, c).r === null, '공통 연도가 없으면 n = 0, r = null');
  // 실제 자료: CO₂ × pH 는 공통 기간이 HOT 관측 기간(1989~)
  const real = G.commonPeriod(CAT.find(it => it.id === 'co2').get(), CAT.find(it => it.id === 'ph').get());
  check(real && real.from === 1989, '실제 자료 CO₂ ∩ pH 공통 기간은 1989년부터', JSON.stringify(real));
}

console.log(fails ? `\n실패 ${fails}개` : '\n전부 통과');
process.exit(fails ? 1 : 0);
