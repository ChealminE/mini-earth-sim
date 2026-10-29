// ============================================================================
// 탐구 모드 검사 (2차 개편 E)
// ----------------------------------------------------------------------------
// 1) js/inquiry-steps.js 형식 검사: 모르는 동작·그래프·사건 표지, saveAs 중복, next 끊김, 출처 키
// 2) 단계 추가·삭제 시연: inquiry-steps.js 파일 글자만 고친 사본(경로 A에서 A3 삭제 + 새 단계 하나 끼워 넣기)을
//    읽어도 형식 검사를 통과하고 단계 순서가 기대대로 나오는지. 실행기(js/inquiry.js)는 건드리지 않는다.
// 3) 탐구 기록 CSV 형식 (열 순서, 쉼표·따옴표·줄바꿈 처리)
// 4) --browser [주소]: 2)의 고친 사본을 실제 화면에 내려보내(Playwright route) 경로 A를 끝까지 진행하고,
//    탐구를 켰다 끈 뒤 자유 조작 상태(시나리오·레버·재생 위치·전선·토글·팝오버)가 그대로인지 확인한다.
//    주소 기본값 http://127.0.0.1:8765/index.html?tab=future (예: npx http-server -p 8765 Critical_Earth_simulator).
//    경로 A는 현재 실태, C는 미래 예측 경로라(3차 E3) 화면 안에서 switchTab 으로 오간다
//
// 실행: node tools/test_inquiry.js            (실패하면 종료 코드 1)
//       node tools/test_inquiry.js --browser
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const InquiryCore = require(path.join(ROOT, 'js', 'inquiry.js'));
const { SOURCES } = require(path.join(ROOT, 'js', 'sources.js'));
const STEPS_FILE = path.join(ROOT, 'js', 'inquiry-steps.js');
// 그래프 작업대 자료 목록의 id (ws.load·askEvidence.need 검사, 3차 E3). get()만 엔진을 쓰므로 목록만 읽을 때는 엔진이 필요 없다
const CATALOG_IDS = (() => {
  const box = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'data-catalog.js'), 'utf8') + ';this.ids = DATA_CATALOG.map(it => it.id);', box);
  return box.ids;
})();

let fails = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

// 단계 파일 글자를 그대로 실행해 데이터를 얻는다 (브라우저와 같은 읽기 방식)
function loadSteps(text) {
  const box = { module: { exports: {} } };
  vm.runInNewContext(text, box);
  return box.module.exports;
}
const ids = p => InquiryCore.stepOrder(p).map(s => s.id).join(' ');

// ── 1) 지금 파일 ──
const text = fs.readFileSync(STEPS_FILE, 'utf8');
const D = loadSteps(text);
const errs = InquiryCore.validate(D.INQUIRY_PATHS, { markers: D.INQUIRY_MARKERS, sources: SOURCES, catalog: CATALOG_IDS });
check(errs.length === 0, '형식 검사 (inquiry-steps.js)', errs.join(' / '));
for (const p of D.INQUIRY_PATHS) console.log(`      경로 ${p.id}: ${ids(p)}`);
for (const c of D.INQUIRY_IMPACTS.levels) for (const it of c.items) {
  if (!SOURCES[it.src] || SOURCES[it.src].status !== 'verified') { check(false, `영향 카드 ${c.title} ${it.what}: 출처 ${it.src} 가 verified 가 아님`); }
}
check(true, `영향 카드 수치 ${D.INQUIRY_IMPACTS.levels.reduce((n, c) => n + c.items.length, 0)}개 모두 verified 출처`);

// ── 2) 단계 추가·삭제 (파일 글자만 고친다) ──
// 객체 하나를 지우는 법: "{ id: 'A3'" 에서 시작해 짝이 맞는 "}" 와 뒤따르는 ","까지 잘라 낸다
function cutStep(src, id) {
  const start = src.indexOf(`{ id: '${id}'`);
  if (start < 0) throw new Error(`단계 ${id} 없음`);
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  let end = i + 1;
  while (/[\s,]/.test(src[end]) && src[end] !== '\n') end++;
  return src.slice(0, start) + src.slice(end).replace(/^\s*\n/, '\n');
}
const NEW_STEP = `{ id: 'A1b', title: '(시험) 새로 넣은 단계', question: '교사가 끼워 넣은 질문입니다.',
        actions: [{ do: 'ws', load: ['co2'] }, { do: 'askText', saveAs: 'A_test_inserted' }] },
      `;
function editedText() {
  let t = cutStep(text, 'A3');
  const at = t.indexOf(`{ id: 'A2'`);
  return t.slice(0, at) + NEW_STEP + t.slice(at);
}
const edited = editedText();
const E = loadSteps(edited);
const pathA = E.INQUIRY_PATHS.find(p => p.id === 'A');
const errs2 = InquiryCore.validate(E.INQUIRY_PATHS, { markers: E.INQUIRY_MARKERS, sources: SOURCES, catalog: CATALOG_IDS });
check(errs2.length === 0, '단계 추가·삭제한 사본 형식 검사', errs2.join(' / '));
check(ids(pathA) === 'A1 A1b A2 A4 A5 A6', '경로 A 순서: A3 삭제 + A1b 추가', ids(pathA));

// 지우면 안 되는 경우도 잡는지: next가 지운 단계를 가리키면 오류
const broken = loadSteps(cutStep(text, 'A3').replace(`{ id: 'A2',`, `{ id: 'A2', next: 'A3',`));
const errs3 = InquiryCore.validate(broken.INQUIRY_PATHS, { markers: broken.INQUIRY_MARKERS });
check(errs3.some(e => e.includes('next "A3"')), '지운 단계를 next로 가리키면 검사가 알림', errs3[0] || '');

// 탭에 맞지 않는 동작을 잡는지 (3차 E3): 현재 실태 경로에 재생·시나리오·자연 지구, 미래 예측 경로에 작업대, 목록에 없는 자료
{
  const bad = [
    { id: 'X', tab: 'current', title: 't', steps: [{ id: 'X1', title: 't', question: 'q', actions: [
      { do: 'play', from: 2023, to: 2100 }, { do: 'setScenario', preset: 'ssp245' }, { do: 'toggleNature', on: true },
      { do: 'pickPoint', chart: 'co2', saveAs: 'x_p' }, { do: 'ws', load: ['co2', 'nope'] }, { do: 'card', id: 'sink' }] }] },
    { id: 'Y', tab: 'future', title: 't', steps: [{ id: 'Y1', title: 't', question: 'q', actions: [{ do: 'ws', load: ['co2'] }] }] },
    { id: 'Z', title: 't', steps: [{ id: 'Z1', title: 't', question: 'q', actions: [] }] },
  ];
  const e = InquiryCore.validate(bad, { catalog: CATALOG_IDS }).join(' / ');
  const want = ['play 는 미래 예측', 'setScenario 는 미래 예측', 'toggleNature 는 미래 예측', "pickPoint 는 chart: 'ws'", '"nope" 가 DATA_CATALOG', 'card sink', '작업대(ws)는 현재 실태', '경로 Z: tab'];
  const miss = want.filter(w => !e.includes(w));
  check(!miss.length, '탭에 맞지 않는 동작·tab 없는 경로·목록에 없는 자료를 검사가 알림', miss.length ? '못 잡음: ' + miss.join(', ') : `${want.length}종`);
}
// 3D 보기 동작 view3d 의 mode (3차 F에서 'ir' 추가): 두 탭 모두에서 쓸 수 있고, 목록에 없는 mode 는 알린다
{
  const step = mode => [{ id: 'V', tab: 'current', title: 't', steps: [{ id: 'V1', title: 't', question: 'q', actions: [{ do: 'view3d', mode }] }] },
    { id: 'W', tab: 'future', title: 't', steps: [{ id: 'W1', title: 't', question: 'q', actions: [{ do: 'view3d', mode }] }] }];
  const ok = InquiryCore.validate(step('ir'), { catalog: CATALOG_IDS });
  const bad = InquiryCore.validate(step('xray'), { catalog: CATALOG_IDS }).join(' / ');
  check(ok.length === 0 && InquiryCore.VIEW3D_MODES.includes('ir') && bad.includes('view3d mode'),
    "view3d mode 'ir'(적외선 보기)는 두 탭에서 통과, 없는 mode 는 검사가 알림", ok.join(' / ') || bad);
}
for (const p of D.INQUIRY_PATHS) console.log(`      경로 ${p.id} → ${p.tab}`);

// ── 3) 탐구 기록 CSV ──
const rows = InquiryCore.logRows(
  { a: { path: 'A', step: 'A1', question: 'q, "인용"', answer: '두 줄\n응답', year: '', value: '', time: '2026-10-23T05:00:02Z' },
    empty: { path: 'A', step: 'A2', question: 'q', answer: '  ', year: '', value: '', time: '2026-10-23T05:00:01Z' } },
  [{ path: 'C', step: 'C2', question: 'q', answer: '기록', year: 2100, value: 2.2567, time: '2026-10-23T05:00:00Z' }]);
const csv = InquiryCore.toCsv(rows).split('\r\n');
check(csv[0] === 'path,step,question,answer,year,value,time', 'CSV 머리줄', csv[0]);
check(rows.length === 2 && rows[0].step === 'C2', 'CSV 시간 순서 · 빈 응답 제외');
check(InquiryCore.toCsv(rows).includes('"q, ""인용"""') && InquiryCore.toCsv(rows).includes('"두 줄\n응답"'), 'CSV 쉼표·따옴표·줄바꿈 감싸기');

// ── 4) 브라우저 ──
async function browser(url) {
  const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const perr = [];
  page.on('pageerror', e => perr.push(e.message));
  page.on('console', m => { if (m.type() === 'error') perr.push(m.text()); });
  await page.route('**/js/inquiry-steps.js*', r => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body: edited }));
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { localStorage.removeItem('inquiry.v1'); } catch (e) {} });

  // 자유 조작 상태를 일부러 바꿔 둔다: 직접 설계 레버, 재생 위치·전선, 자연 지구, Ω, 팝오버
  await page.evaluate(() => {
    setPreset('custom');
    FUT.levers = { ...FUT.levers, ev: 0.6, ccs: 1.5 }; leversToInputs(FUT.levers); showLeverValues(); recomputeFuture(false);
    setYear(2150); advanceFrontier(2150); renderFuture();
    // 팝오버는 두 탭 모두에서 쓰는 '바다 속 탄소'로 — '탄소는 어디로?'는 미래 예측 전용 카드라 현재 실태로 가면 닫힌다(3차 E2, 의도)
    setNatureView(true); setOmegaView(true); setPopover('popSpec');
  });
  await page.waitForTimeout(600);
  // 현재 실태 작업대도 바꿔 둔다(탐구 경로 A·B가 작업대를 쓴다 — 3차 E3)
  await page.evaluate(() => { currentWorkspace.add('temp'); currentWorkspace.setMode('shape'); });
  const state = () => page.evaluate(() => JSON.stringify({ preset: FUT.preset, levers: FUT.levers, year: FUT.year, frontier: FUT.frontier,
    nature: FUT.showNature, omega: VIEW.omega, validate: VIEW.validate, pop: !document.getElementById('popSpec').hidden,
    lever: !document.getElementById('fcLevers').hidden, xmax: charts[0].options.scales.x.max, slider: tlScrub.max,
    cam: getCameraView().target.join(), ds: charts.map(c => c.data.datasets.length).join(), ws: JSON.stringify(currentWorkspace.getConfig()) }));
  const before = await state();

  // 경로 A는 현재 실태(3차 E3): 화면 안에서 탭을 바꾼다(머리줄 링크는 페이지를 다시 연다)
  await page.evaluate(() => switchTab('current'));
  await page.waitForTimeout(600);
  await page.click('#inqModeOn');
  await page.click('[data-path="A"]');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(300);
    seen.push(await page.evaluate(() => `${document.querySelector('.inq-title').textContent} [${document.querySelector('.inq-progress').textContent.replace(/\s+/g, '')}]`));
    await page.click('[data-inq="next"]');
  }
  check(seen[1].startsWith('(시험) 새로 넣은 단계') && seen.every(s => !s.includes('그때 무슨 일이')) && seen[0].includes('1/6'),
    '화면: 고친 사본으로 경로 A 진행 (새 단계 보임, 지운 단계 없음, 6단계)', seen.map(s => s.split(' [')[1]).join(' '));
  // 다른 경로 하나에서 시나리오를 바꿔 본 뒤 끈다(C2는 시나리오를 고른다). C는 미래 예측 경로
  await page.evaluate(() => switchTab('future'));
  await page.waitForTimeout(600);
  await page.click('[data-path="C"]');
  await page.click('[data-inq="next"]');
  await page.click('[data-scen="ssp119"]');
  await page.waitForTimeout(500);
  await page.click('#inqModeFree');
  await page.waitForTimeout(1300);
  const after = await state();
  check(before === after, '탐구를 켰다 꺼도 자유 조작 상태가 그대로', before === after ? '' : `\n      전 ${before}\n      후 ${after}`);
  // 탐구를 켠 채 새로 고침: 저장된 탐구로 다시 열려야 한다. 예전에는 inquiry.js 가 초기화 도중 탐구를 켜다 TDZ 오류로 멈춰
  // 화면이 booting 에 가려진 채 미래 예측 탭이 열리지 않았다(3차 B1 중 발견)
  await page.click('#inqModeOn');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(1500);
  const re = await page.evaluate(() => ({ booting: document.documentElement.classList.contains('booting'),
    on: document.body.classList.contains('inq-on'), panel: !document.getElementById('inqPanel').hidden }));
  check(!re.booting && re.on && re.panel, '탐구를 켠 채 새로 고쳐도 화면이 열리고 탐구가 이어짐', JSON.stringify(re));
  await page.evaluate(() => { try { localStorage.removeItem('inquiry.v1'); } catch (e) {} });
  check(perr.length === 0, '콘솔 오류 없음', perr.join(' / '));
  await b.close();
}

(async () => {
  const i = process.argv.indexOf('--browser');
  if (i >= 0) await browser(process.argv[i + 1] && !process.argv[i + 1].startsWith('-') ? process.argv[i + 1] : 'http://127.0.0.1:8765/index.html?tab=future');
  console.log(fails ? `\n실패 ${fails}개` : '\n전부 통과');
  process.exit(fails ? 1 : 0);
})();
