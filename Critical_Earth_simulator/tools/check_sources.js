// ============================================================================
// 출처 등록부 검사 - 빌드 전에 돌린다 (tools/build_single_html.py가 먼저 부른다)
// ----------------------------------------------------------------------------
// 1) 화면(HTML·JS)의 data-src="키" / srcButton('키' 가 전부 js/sources.js 에 있는가
// 2) 모든 항목에 label·kind·cite·url·status 가 있고 값이 정해진 목록 안인가, related 키가 있는가
// 3) data/raw 원본을 가리키는 항목의 version 이 원본 머리말(또는 파일 이름)에 그대로 있는가
//    - NOAA 자료는 매달 갱신된다. raw를 새로 받고 등록부를 안 고치면 여기서 걸린다.
// unverified·citeChecked:false 항목은 실패가 아니라 목록으로 알린다(PR에 옮길 것).
//
// 실행: node tools/check_sources.js      (실패하면 종료 코드 1)
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SOURCES } = require(path.join(ROOT, 'js', 'sources.js'));
const KINDS = ['obs', 'model', 'param', 'assumption', 'calibrated'];
const STATUS = ['verified', 'unverified'];

const errors = [];
const err = m => errors.push(m);

// ── 1) 화면에서 쓰는 키 ─────────────────────────────────────────────────────
// 직접 실험 탭·1인칭은 이번 범위 밖이지만 같은 규칙을 따르도록 함께 훑는다.
const SCAN_DIRS = ['.', 'js', 'firstperson'];
const files = [];
for (const d of SCAN_DIRS) {
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (/\.(html|js)$/.test(f) && f !== 'sources.js') files.push(path.join(d, f));
  }
}
const used = new Map();   // 키 -> 처음 나온 파일
const PATTERNS = [/data-src\s*=\s*["']([^"'$`{}]+)["']/g, /srcButton\(\s*["']([\w]+)["']/g];
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const key = m[1].trim();
      if (!used.has(key)) used.set(key, f);
      if (!(key in SOURCES)) err(`${f}: data-src "${key}" 가 등록부에 없음`);
    }
  }
}

// ── 2) 항목 필드 ─────────────────────────────────────────────────────────────
for (const [k, s] of Object.entries(SOURCES)) {
  for (const need of ['label', 'kind', 'cite', 'url', 'status']) {
    if (!s[need] || !String(s[need]).trim()) err(`${k}: ${need} 없음`);
  }
  if (s.kind && !KINDS.includes(s.kind)) err(`${k}: kind "${s.kind}" 는 ${KINDS.join('|')} 중 하나여야 함`);
  if (s.status && !STATUS.includes(s.status)) err(`${k}: status "${s.status}" 는 verified|unverified`);
  if (s.url && !/^https?:\/\//.test(s.url)) err(`${k}: url 이 http(s)로 시작하지 않음`);
  for (const r of s.related || []) if (!(r in SOURCES)) err(`${k}: related "${r}" 가 등록부에 없음`);
  if (s.file && !fs.existsSync(path.join(ROOT, s.file))) err(`${k}: file ${s.file} 이 없음`);
}

// ── 3) 원본 버전 표기 ────────────────────────────────────────────────────────
for (const [k, s] of Object.entries(SOURCES)) {
  if (!s.file || !s.file.startsWith('data/raw/') || !s.version) continue;
  const full = path.join(ROOT, s.file);
  if (!fs.existsSync(full)) continue;
  // 머리말 60줄(큰 RCMIP 파일도 앞부분만 읽는다)과 파일 이름에서 찾는다
  const fd = fs.openSync(full, 'r'), buf = Buffer.alloc(16384);
  const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
  const head = buf.slice(0, n).toString('latin1').split(/\r?\n/).slice(0, 60).join('\n');
  const want = s.version.replace(/^RCMIP /, '');
  const inName = path.basename(s.file).includes(want) || path.basename(s.file).includes(want.replace(/\./g, '-'));
  if (!head.includes(want) && !inName) err(`${k}: version "${s.version}" 이 원본 ${s.file} 머리말·이름에 없음 (원본이 갱신됐나?)`);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
const unver = Object.entries(SOURCES).filter(([, s]) => s.status === 'unverified').map(([k]) => k);
const uncited = Object.entries(SOURCES).filter(([, s]) => s.citeChecked === false).map(([k]) => k);
console.log(`등록부 ${Object.keys(SOURCES).length}개 항목, 화면에서 쓰는 키 ${used.size}개 (${files.length}개 파일 검사)`);
console.log(`unverified ${unver.length}개: ${unver.join(', ')}`);
console.log(`인용 문구 원문 대조 필요(citeChecked: false) ${uncited.length}개: ${uncited.join(', ')}`);
if (errors.length) {
  console.log('\n실패 ' + errors.length + '건\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('통과');
