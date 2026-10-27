// ============================================================================
// 자료 목록(js/data-catalog.js) 검사 (3차 C1, node)
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
for (const f of ['js/earth-model.js', 'js/earth-data.js', 'js/sources.js', 'js/earth-system.js', 'js/data-catalog.js']) {
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

console.log(fails ? `\n실패 ${fails}개` : '\n전부 통과');
process.exit(fails ? 1 : 0);
