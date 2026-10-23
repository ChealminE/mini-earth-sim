// ============================================================================
// 아이콘 (인라인 SVG, 24×24, 선 굵기 2, currentColor)
// ----------------------------------------------------------------------------
// 왜 직접 그렸나: 이모지는 Windows·macOS·전자칠판마다 모양이 달라 같은 수업 자료가 다르게 보인다.
// 외부 아이콘 글꼴은 오프라인 교실 PC에서 안 뜰 수 있다. 그래서 단순한 도형으로 직접 그려 한 곳에 모았다
// (외부 라이선스 없음). 버튼에는 반드시 글자 레이블을 함께 단다 — 아이콘만 보고 추측하지 않게.
// 사용: Icons.svg('globe')  →  '<svg …>…</svg>' 문자열
// ============================================================================
const Icons = (() => {
  const P = {
    back: '<path d="M15 5l-7 7 7 7"/><path d="M8 12h12"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3.2 3 14.8 0 18"/><path d="M12 3c-3 3.2-3 14.8 0 18"/>',
    // 협약: 접힌 문서 + 서명선
    accord: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 11h7"/><path d="M9 14h5"/><path d="M9 18c1.2-1.5 2.2-1.5 3 0s2 1.4 3.5-.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    // 직접 설계: 쌓은 블록(샌드박스·건축)
    blocks: '<path d="M3 20h18"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/><rect x="8.5" y="6" width="7" height="7"/><path d="M12 3v3"/>',
    car: '<path d="M4 16v-3l2-5h9l3 5h2v3"/><path d="M3 16h18"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/><path d="M12 3l-2 3h3l-2 3"/>',
    factory: '<path d="M3 21V11l5 3v-3l5 3V5h4v16z"/><path d="M3 21h18"/><path d="M15 2.5c.8.6.8 1.4 0 2"/><path d="M8 18h2"/><path d="M12 18h2"/>',
    atom: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-60 12 12)"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    // 탄소 포집: 땅속으로 내려가는 관 + 화살표
    capture: '<path d="M3 13h18"/><path d="M9 3v14"/><path d="M15 3v14"/><path d="M9 17c0 2.5 6 2.5 6 0"/><path d="M12 6v6"/><path d="M10 10l2 2 2-2"/>',
    tree: '<path d="M12 21v-6"/><path d="M12 3l6 8h-3l4 5H5l4-5H6z"/>',
    building: '<rect x="5" y="3" width="14" height="18"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M11 21v-3h2v3"/>',
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
    record: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    eraser: '<path d="M7 20h13"/><path d="M4.5 15.5L14 6l5 5-7.5 7.5H8z"/><path d="M9.5 11L14.5 16"/>',
    leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15"/><path d="M5 19l8-8"/>',
    lines: '<path d="M3 20l5-6 4 3 5-8 4 4"/><path d="M3 4v16h18"/>',
    beaker: '<path d="M9 3v6l-5 10a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L15 9V3"/><path d="M8 3h8"/><path d="M6.5 15h11"/>',
    sink: '<path d="M4 12h16"/><path d="M12 3v9"/><path d="M12 12l-6 8M12 12l6 8M12 12v9"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    // CO₂ 보기: 공기 중에 흩어진 점 (2차 개편 D)
    dots: '<circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="18" cy="9" r="1.4" fill="currentColor"/><circle cx="8" cy="13" r="1.4" fill="currentColor"/><circle cx="15" cy="15" r="1.4" fill="currentColor"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="19" r="1.4" fill="currentColor"/>',
    // 지시약으로 보기: 물방울 + 색 띠
    drop: '<path d="M12 3c3.5 4.5 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.5 6-11z"/><path d="M7.5 14h9"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6L5 19a1.5 1.5 0 0 0 1.4 2h11.2a1.5 1.5 0 0 0 1.4-2L14 9V3"/>',
  };
  function svg(name, size = 24) {
    const body = P[name];
    if (!body) { console.warn('[icons] 없는 아이콘:', name); return ''; }
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2"`
      + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  // HTML 안에 <span data-icon="globe"></span> 을 두면 그 자리에 아이콘을 채운다 (정적 마크업용)
  function fill(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => { if (!el.firstChild) el.innerHTML = svg(el.dataset.icon, el.dataset.iconSize || 24); });
  }
  return { svg, fill, names: Object.keys(P) };
})();
