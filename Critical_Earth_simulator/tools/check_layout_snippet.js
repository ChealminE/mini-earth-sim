// ============================================================================
// 화면 검사 스니펫 (3차 대격변, 로컬 사람 확인용)
// ----------------------------------------------------------------------------
// 왜 스니펫인가: 이번 작업은 로컬에서 하고, Playwright를 새로 설치하지 않는다(용량·시간).
// 사람이 실제 브라우저(실제 GPU)로 화면을 열고, 개발자 도구 콘솔에 이 파일 내용을 통째로 붙여 넣으면
// 마스터 §5의 6·7·10번 항목을 잰다. 결과 표를 그대로 복사해 Claude에게 보내면 된다.
// 창 크기는 개발자 도구 기기 툴바(Ctrl+Shift+M)에서 1280×720 / 1366×768 / 1440×900 / 1920×1080 으로 맞춘다.
// 앱 코드가 아니다 - index.html에 넣지 말 것(빌더 목록에도 넣지 않는다).
// ============================================================================
(() => {
  const de = document.documentElement;
  const vw = innerWidth, vh = innerHeight;

  // 6. 문서 전체 스크롤 (학습지 패널 내부 스크롤은 허용이라 문서 기준만 본다)
  const scrollY = de.scrollHeight - vh, scrollX = de.scrollWidth - vw;

  // 7. 보이는 글자 최솟값: 화면 안에 실제로 그려진 텍스트 노드의 부모 요소만 센다
  let minFs = Infinity, minEl = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('[hidden], [aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < minFs) { minFs = fs; minEl = el; }
  }

  // 10. 드로우콜 (common.js 최상위 let - 콘솔에서는 이름으로 보인다)
  let dc = null;
  try { dc = lastFrameDrawCalls; } catch (e) { /* 이 화면에 3D가 없음 */ }

  // 학습지 패널 크기 (B1 확인용). id가 바뀌면 여기만 고친다
  const ws = document.getElementById('worksheet');
  const wsRect = ws ? ws.getBoundingClientRect() : null;

  const row = {
    '주소': location.pathname + location.search,
    '창': `${vw}×${vh}`,
    '세로 넘침(px, 0이어야 함)': scrollY,
    '가로 넘침(px, 0이어야 함)': scrollX,
    '최소 글자(px, ≥13)': Number.isFinite(minFs) ? minFs : '없음',
    '최소 글자 요소': minEl ? (minEl.id ? '#' + minEl.id : minEl.className || minEl.tagName) : '-',
    '드로우콜': dc,
    '학습지 폭 비율': wsRect ? (wsRect.width / vw * 100).toFixed(1) + ' %' : '학습지 없음',
  };
  console.table([row]);
  console.log('결과 표를 복사해 보내 주세요. 콘솔에 빨간 오류가 있으면 그것도 함께.');
  return row;
})();
