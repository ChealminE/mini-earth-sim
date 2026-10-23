// ============================================================================
// 출처 등록부(js/sources.js) → docs/데이터출처.md
// ----------------------------------------------------------------------------
// 논문 참고문헌·발표 자료를 정리할 때 쓰는 문서다. 손으로 고치지 말고 등록부를 고친 뒤 다시 만든다.
// 실행: node tools/gen_sources_doc.js
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SOURCES, SOURCE_KINDS } = require(path.join(ROOT, 'js', 'sources.js'));
const OUT = path.join(ROOT, 'docs', '데이터출처.md');

const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const entries = Object.entries(SOURCES);
const lines = [];
lines.push('# 데이터 출처');
lines.push('');
lines.push('> 자동 생성 문서 — 직접 고치지 말 것. 원본: `js/sources.js`, 다시 만들기: `node tools/gen_sources_doc.js`');
lines.push('>');
lines.push('> 상태: **확인** = 원문(데이터 파일·readme·문헌 발췌본과 쪽 이미지)에서 값을 직접 확인함, **미확인** = 확인하지 못함.');
lines.push('> 인용 표의 † = 인용 문구를 원문에서 옮기지 못하고 서지 정보로 적음(기관 누리집 인용 안내와 대조 필요).');
lines.push('');

// 1) 한눈에 보기
lines.push('## 한눈에 보기');
lines.push('');
lines.push('| 키 | 이름 | 종류 | 기관 | 버전 | 상태 |');
lines.push('|---|---|---|---|---|---|');
for (const [k, s] of entries) {
  lines.push(`| \`${k}\` | ${esc(s.label)} | ${SOURCE_KINDS[s.kind]} | ${esc(s.org)} | ${esc(s.version)} | ${s.status === 'verified' ? '확인' : '**미확인**'} |`);
}
lines.push('');

// 2) 종류별 상세
for (const [kind, ko] of Object.entries(SOURCE_KINDS)) {
  const group = entries.filter(([, s]) => s.kind === kind);
  if (!group.length) continue;
  lines.push(`## ${ko}`);
  lines.push('');
  for (const [k, s] of group) {
    lines.push(`### ${s.label} \`${k}\``);
    lines.push('');
    if (s.summary) lines.push(`${s.summary}`, '');
    const row = (name, v) => { if (v != null && v !== '' && v !== '-') lines.push(`- **${name}**: ${v}`); };
    row('기관', s.org);
    row('데이터셋', s.dataset);
    row('버전', s.version);
    row('쪽', s.page);
    row('파일', s.file ? '`' + s.file + '`' : '');
    row('인용', s.cite + (s.citeChecked === false ? ' †' : ''));
    row('링크', s.url);
    row('라이선스', s.license);
    row('상태', s.status === 'verified' ? '확인' : '**미확인**');
    row('비고', s.note);
    if (s.related && s.related.length) row('함께 볼 항목', s.related.map(r => '`' + r + '`').join(', '));
    lines.push('');
  }
}

// 3) 확인할 것
const unver = entries.filter(([, s]) => s.status === 'unverified');
const uncited = entries.filter(([, s]) => s.citeChecked === false);
lines.push('## 확인할 것');
lines.push('');
lines.push(`- 미확인 값 ${unver.length}개: ` + unver.map(([k]) => '`' + k + '`').join(', '));
lines.push(`- 인용 문구 대조 필요 ${uncited.length}개: ` + uncited.map(([k]) => '`' + k + '`').join(', '));
lines.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`[완료] ${path.relative(ROOT, OUT)} (${entries.length}개 항목)`);
