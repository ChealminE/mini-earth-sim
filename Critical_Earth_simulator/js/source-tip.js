// ============================================================================
// ⓘ 출처 상자 — js/sources.js 등록부를 읽어 숫자·그래프 옆 ⓘ에 출처를 띄운다 (2차 개편 B §4)
// ----------------------------------------------------------------------------
// 마크업: <button class="src-i" type="button" data-src="co2_noaa_gl" aria-label="출처 보기: …">ⓘ</button>
//         JS에서 만들 때는 srcButton('co2_noaa_gl') 이 같은 문자열을 돌려준다.
// 열림: 마우스 올림(150 ms 뒤) · 키보드 포커스 · 터치(탭).  전자칠판에는 마우스 올림이 없다.
// 닫힘: 마우스가 버튼·상자 둘 다에서 벗어남 · Esc · 바깥 탭 · 다른 ⓘ 열기.
// 상자는 문서에 하나만 만들어 재사용한다. 평소에는 화면 어디에도 출처 글을 따로 적지 않는다.
// 이벤트는 문서에 한 번만 걸어(위임) 나중에 그려진 ⓘ도 따로 연결할 필요가 없다.
// ============================================================================
function srcButton(key, extraClass = '') {
  const s = SOURCES[key];
  const label = s ? s.label : key;
  return `<button class="src-i${extraClass ? ' ' + extraClass : ''}" type="button" data-src="${key}"`
    + ` aria-label="출처 보기: ${label.replace(/"/g, '&quot;')}" aria-expanded="false">ⓘ</button>`;
}

const SourceTip = (() => {
  const OPEN_DELAY = 150, CLOSE_DELAY = 180, GAP = 8, MARGIN = 8;
  let box = null, current = null, openTimer = 0, closeTimer = 0;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'src-tip';
    box.id = 'srcTip';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '출처');
    box.hidden = true;
    box.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    box.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') scheduleClose(); });
    document.body.appendChild(box);
    return box;
  }

  function render(key) {
    const s = SOURCES[key];
    if (!s) return `<p class="st-warn">등록부에 없는 출처 키: ${esc(key)}</p>`;
    const meta = [s.org, s.dataset, s.version && s.version !== '-' ? s.version : '', s.page].filter(Boolean).map(esc).join(' · ');
    const rel = (s.related || []).filter(k => SOURCES[k]).map(k => {
      const r = SOURCES[k];
      return `<p class="st-rel-item"><b>${esc(SOURCE_KINDS[r.kind])}</b> ${esc(r.label)} — ${esc(r.org)}`
        + (r.status === 'unverified' ? ' <b>(확인 중)</b>' : '') + '</p>';
    }).join('');
    return (s.status === 'unverified' ? '<p class="st-warn">출처 확인 중인 값입니다</p>' : '')
      + `<span class="st-badge" data-kind="${esc(s.kind)}">${esc(SOURCE_KINDS[s.kind] || s.kind)}</span>`
      + `<p class="st-lead">${esc(s.label)}${s.summary ? ' — ' + esc(s.summary) : ''}</p>`
      + `<p class="st-meta">${meta}</p>`
      + `<p class="st-cite">${esc(s.cite)}</p>`
      + `<a class="st-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>`
      + (rel ? `<div class="st-rel">${rel}</div>` : '');
  }

  // 버튼 위쪽에 띄우고, 위 공간이 모자라면 아래로 뒤집는다. 좌우는 화면 안으로 밀어 넣는다.
  function place(btn) {
    const b = btn.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let top = b.top - GAP - h;
    if (top < MARGIN) top = Math.min(b.bottom + GAP, innerHeight - MARGIN - h);
    let left = b.left + b.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(innerWidth - MARGIN - w, left));
    box.style.top = Math.max(MARGIN, top) + 'px';
    box.style.left = left + 'px';
  }

  function open(btn) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    ensureBox();
    if (current && current !== btn) current.setAttribute('aria-expanded', 'false');
    current = btn;
    box.innerHTML = render(btn.dataset.src);
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', 'srcTip');
    place(btn);
  }
  function close() {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!box || box.hidden) return;
    box.hidden = true;
    if (current) current.setAttribute('aria-expanded', 'false');
    current = null;
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_DELAY);   // 버튼 → 상자로 마우스를 옮기는 사이에 닫히지 않게
  }

  const srcOf = el => el && el.closest ? el.closest('.src-i[data-src]') : null;

  // 마우스: 올리면 잠깐 뒤 열기, 버튼·상자 둘 다 벗어나면 닫기
  document.addEventListener('pointerover', e => {
    const b = srcOf(e.target);
    if (!b || e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    if (current === b) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => open(b), OPEN_DELAY);
  });
  document.addEventListener('pointerout', e => {
    const b = srcOf(e.target);
    if (!b || e.pointerType !== 'mouse') return;
    if (b.contains(e.relatedTarget)) return;
    clearTimeout(openTimer);
    if (current === b) scheduleClose();
  });
  // 탭·클릭: 열고 닫기를 바꾼다. 마우스로 올려 열린 상태에서 누르면 그대로 둔다(링크를 누르러 가는 중일 수 있다).
  document.addEventListener('click', e => {
    const b = srcOf(e.target);
    if (b) {
      e.preventDefault();
      if (current === b && !box.hidden && e.pointerType !== 'mouse') close();
      else open(b);
      return;
    }
    if (box && !box.hidden && !box.contains(e.target)) close();    // 바깥을 누르면 닫는다
  });
  // 키보드: 포커스가 오면 열고, 버튼·상자 밖으로 나가면 닫는다
  document.addEventListener('focusin', e => {
    const b = srcOf(e.target);
    if (b && b.matches(':focus-visible')) open(b);
    else if (box && !box.hidden && !box.contains(e.target) && e.target !== current) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !box || box.hidden) return;
    const b = current;
    close();
    if (b && box.contains(document.activeElement)) b.focus();
  });
  // 스크롤·크기 변경 때는 자리를 다시 잡는다 (스크롤 없는 화면이지만 상자 안 스크롤·창 크기 변경 대비)
  addEventListener('resize', () => { if (current && box && !box.hidden) place(current); });

  return { open, close, render, get current() { return current; } };
})();
