// ============================================================================
// 그래프 작업대 (3차 C2) — 자료 카드를 끌어 놓아 자기 그래프를 만들고 증거로 쓰는 공용 모듈
// ----------------------------------------------------------------------------
// 자료는 js/data-catalog.js(DATA_CATALOG), 실행기는 이 파일. 현재 실태 탭이 먼저 쓰고(3차 C3),
// 나중에 직접 실험 탭이 옮겨 올 수 있게 DOM은 넘겨받은 rootEl 안에만 만들고 id를 쓰지 않는다(한 화면에 여럿 있어도 된다).
//
// 이 작업대가 '증거 도구'가 되려면 학생이 축을 조작해 상관을 꾸며 낼 수 없어야 한다 (y축 규칙 R1~R8):
//   R1 같은 axis 는 한 축          R2 다른 axis 는 왼쪽 Y1·오른쪽 Y2, 축 글자색 = 계열 색
//   R3 축 범위는 보이는 기간의 값으로 자동(+5 % 여백, minSpan 보장) — 손으로 못 바꾼다(확대·끌기 없음)
//   R4 pH 축 뒤집기는 허용하되 축 제목·모서리 꼬리표·구성(flips)에 남긴다
//   R5 모양 비교: 공통 기간에서 0~1 정규화, '낮음/높음' 눈금, 최대 3개
//   R6 산점도: 공통 연도만, 점 색 = 연도 순, r·n·기간, "함께 변한다고 원인은 아니다"
//   R7 모형 = 점선, 한 지점 = 범례 꼬리표     R8 기간은 정해진 세 개(전체·1950~·1980~)
// 자료 기간 차이(3차 마스터 결정 6): 자료가 없는 구간은 옅은 빗금 + "자료 없음(1989년부터)", 이어 붙은 경계(seg)는 세로 점선 + 설명.
//
// 끌어 놓기는 마우스 전용(터치는 하지 않음 — 3차 결정 4). 이벤트 흐름은 직접 실험 탭 js/tab-live.js 의 카드 끌기
// (pointerdown → setPointerCapture → pointermove 에서 elementFromPoint 로 놓을 곳 표시 → pointerup)와 같게 해서
// 나중에 그 탭이 이 모듈로 옮겨 오기 쉽게 했다. 대체 조작: 카드 Enter/Space·[＋] = 넣기, 칩 [✕]·Delete = 빼기.
// ============================================================================

// ── 계산 (DOM 없음, node 검사: tools/test_catalog.js) ──
const GraphWorkspaceCore = (() => {
  const span = pts => (pts && pts.length ? { from: pts[0].x, to: pts[pts.length - 1].x } : null);
  // 축 범위: 값의 최소·최대 + 위아래 pad 여백, 그래도 폭이 minSpan 보다 좁으면 가운데를 두고 minSpan 으로 넓힌다
  function axisRange(values, minSpan = 0, pad = 0.05) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!Number.isFinite(lo)) return null;
    const p = (hi - lo) * pad;
    lo -= p; hi += p;
    if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    return { min: lo, max: hi };
  }
  // 여러 계열이 모두 자료를 가진 기간 (없으면 null)
  function commonPeriod(...lists) {
    let from = -Infinity, to = Infinity;
    for (const l of lists) { const s = span(l); if (!s) return null; from = Math.max(from, s.from); to = Math.min(to, s.to); }
    return from <= to ? { from, to } : null;
  }
  // 어느 한 계열이라도 자료를 가진 기간 (시간 보기 x축)
  function unionPeriod(...lists) {
    let from = Infinity, to = -Infinity;
    for (const l of lists) { const s = span(l); if (s) { from = Math.min(from, s.from); to = Math.max(to, s.to); } }
    return from <= to ? { from, to } : null;
  }
  const within = (pts, per) => (per ? pts.filter(p => p.x >= per.from && p.x <= per.to) : pts);
  // 기간 안의 최소 = 0, 최대 = 1 (모양 비교)
  function normalize(points, period) {
    const pts = within(points, period);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    const d = hi - lo || 1;
    return pts.map(p => ({ x: p.x, y: (p.y - lo) / d }));
  }
  // 같은 연도끼리 짝짓기 (산점도·상관)
  function pairByYear(a, b, period) {
    const mb = new Map(within(b, period).map(p => [p.x, p.y]));
    return within(a, period).filter(p => mb.has(p.x)).map(p => ({ year: p.x, x: p.y, y: mb.get(p.x) }));
  }
  // 피어슨 상관계수. 짝이 3개 미만이거나 한쪽이 일정하면 r = null
  function pearson(a, b, period) {
    const pairs = pairByYear(a, b, period), n = pairs.length;
    if (n < 3) return { r: null, n };
    const mx = pairs.reduce((s, p) => s + p.x, 0) / n, my = pairs.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of pairs) { const dx = p.x - mx, dy = p.y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n };
  }
  return { axisRange, commonPeriod, unionPeriod, within, normalize, pairByYear, pearson, span };
})();

// ── 화면 ──
const GraphWorkspace = (() => {
  const RANGES = ['all', 1950, 1980];
  const MODES = { time: '시간', shape: '모양 비교', scatter: '산점도' };
  const SCOPE_TAG = { global: '전 지구', station: '한 지점', model: '모형' };
  const SLOT_NAME = ['Y1', 'Y2', 'Y3'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, step) => { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3; return v.toFixed(d); };

  function create(root, opts) {
    const catalog = opts.catalog, axes = opts.axes || DATA_AXES, hints = opts.hints || DATA_HINTS;
    const decks = opts.decks || ['core', 'carbon', 'model'];
    const deckNames = opts.deckNames || DATA_DECKS;
    const C = Theme.color;
    const byId = id => catalog.find(it => it.id === id);
    // 자료는 카드마다 한 번만 만든다(모형 자료는 엔진 실행)
    const ptsCache = new Map();
    const pts = id => { if (!ptsCache.has(id)) ptsCache.set(id, byId(id).get()); return ptsCache.get(id); };
    const periodOf = id => GraphWorkspaceCore.span(pts(id));
    const srcKeys = it => [].concat(it.src);

    const st = { series: [], mode: 'time', range: 'all', commonOnly: false, flips: new Set(), lock: null };
    const listeners = [];
    const maxSlots = () => (st.mode === 'shape' ? 3 : (opts.maxSeries || 2));

    // ── 뼈대 ──
    root.classList.add('gw');
    root.innerHTML = `
      <div class="gw-main">
        <div class="gw-bar">
          <div class="gw-slots" role="group" aria-label="그래프에 놓은 자료"></div>
          <div class="gw-modes" role="group" aria-label="보기">${Object.entries(MODES).map(([k, v]) =>
            `<button class="btn btn--view btn--sm" type="button" data-mode="${k}" aria-pressed="false">${v}</button>`).join('')}</div>
        </div>
        <div class="gw-bar">
          <div class="gw-ranges" role="group" aria-label="기간"><span class="gw-label">기간</span>${RANGES.map(r =>
            `<button class="btn btn--time btn--sm" type="button" data-range="${r}" aria-pressed="false">${r === 'all' ? '전체' : r + '~'}</button>`).join('')}</div>
          <button class="btn btn--time btn--sm" type="button" data-act="common" aria-pressed="false">공통 기간만</button>
          <button class="btn btn--view btn--sm gw-flip" type="button" data-act="flip" aria-pressed="false" hidden>pH 축 뒤집기</button>
        </div>
        <p class="gw-banner" role="status" hidden></p>
        <div class="gw-plot" data-drop="plot">
          <canvas aria-label="작업대 그래프" role="img"></canvas>
          <div class="gw-tag" hidden></div>
          <div class="gw-segs"></div>
          <p class="gw-empty">여기에 카드를 끌어 놓으세요</p>
        </div>
        <div class="gw-hint"><p class="gw-hint-text readout"></p><span class="gw-hint-src"></span>
          ${opts.onSend ? '<button class="btn btn--rec btn--sm gw-send" type="button" data-act="send"><span data-icon="download"></span>학습지로 보내기</button>' : ''}</div>
      </div>
      <aside class="gw-deck" aria-label="자료 카드">
        <p class="gw-deck-help readout">카드를 왼쪽 그래프로 끌어 놓거나 ＋를 누르세요</p>
        ${decks.map(d => `<section class="gw-deck-group" data-deck="${d}" ${d === 'core' ? '' : 'hidden'}>
          ${d === 'core' ? '' : `<h4 class="gw-deck-name">${esc(deckNames[d])}</h4>`}
          <ul class="gw-cards">${catalog.filter(it => it.deck === d).sort((a, b) => a.order - b.order).map(cardHtml).join('')}</ul></section>`).join('')}
        ${decks.filter(d => d !== 'core').map(d =>
          `<button class="btn btn--nav btn--sm gw-deck-open" type="button" data-open-deck="${d}" aria-expanded="false">＋ ${esc(deckNames[d])}</button>`).join('')}
      </aside>`;
    const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
    if (typeof Icons !== 'undefined') Icons.fill(root);

    function cardHtml(it) {
      const per = periodOf(it.id);
      // 카드 이름은 먹색(회색 '자연 지구' 같은 선 색은 글자 대비가 모자란다), 계열 색은 왼쪽 띠와 모양선으로
      return `<li class="gw-card${it.scope === 'model' ? ' is-model' : ''}" data-id="${it.id}" tabindex="0" role="button" style="--card-c:${C(it.color)}"
          aria-label="${esc(it.label)} (${SCOPE_TAG[it.scope]}, ${per.from}~${per.to}). Enter로 그래프에 넣기">
        <span class="gw-card-head"><span class="gw-card-name">${esc(it.label)}</span>
          <button class="gw-card-add" type="button" tabindex="-1" aria-hidden="true" title="그래프에 넣기">＋</button></span>
        <span class="gw-card-tag scope-${it.scope}">${SCOPE_TAG[it.scope]}</span>
        <canvas class="gw-spark" width="160" height="26" aria-hidden="true"></canvas>
        <span class="gw-card-per readout">${per.from}~${per.to}</span>
      </li>`;
    }
    // 스파크라인: Chart.js 인스턴스를 쓰지 않고 2D 캔버스에 직접 (카드 10장 × 차트 = 무거움)
    function drawSpark(cv, it) {
      const p = pts(it.id), ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
      const xs = GraphWorkspaceCore.span(p), yr = GraphWorkspaceCore.axisRange(p.map(o => o.y), it.minSpan, 0.08);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C(it.color); ctx.lineWidth = 1.6;
      if (it.scope === 'model') ctx.setLineDash([4, 3]);
      ctx.beginPath();
      p.forEach((o, i) => {
        const x = ((o.x - xs.from) / (xs.to - xs.from || 1)) * (w - 2) + 1, y = h - 2 - ((o.y - yr.min) / (yr.max - yr.min)) * (h - 4);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    qa('.gw-card').forEach(c => drawSpark(c.querySelector('.gw-spark'), byId(c.dataset.id)));

    // ── 그래프 (Chart.js 한 개를 계속 갱신) ──
    const plot = q('.gw-plot');
    const hatchPlugin = {   // 자료가 없는 구간: 옅은 빗금 + "○○ 자료 없음 (1989년부터)"
      id: 'gwGaps',
      beforeDatasetsDraw(ch) {
        const gaps = ch.$gaps || [];
        if (!gaps.length) return;
        const { ctx, chartArea: a, scales: { x } } = ch;
        ctx.save();
        gaps.forEach((g, k) => {
          const x0 = Math.max(a.left, x.getPixelForValue(g.from)), x1 = Math.min(a.right, x.getPixelForValue(g.to));
          if (x1 - x0 < 2) return;
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, a.top, x1 - x0, a.bottom - a.top); ctx.clip();
          ctx.fillStyle = Theme.alpha('--ink', 0.035); ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
          ctx.strokeStyle = Theme.alpha('--ink', 0.1); ctx.lineWidth = 1;
          for (let s = x0 - (a.bottom - a.top); s < x1; s += 9) { ctx.beginPath(); ctx.moveTo(s, a.bottom); ctx.lineTo(s + (a.bottom - a.top), a.top); ctx.stroke(); }
          ctx.restore();
          ctx.fillStyle = C(g.color); ctx.font = `600 ${Theme.px('--fs-1')}px ${C('--font-body') || 'sans-serif'}`;
          ctx.textBaseline = 'top';
          const txt = g.text, tw = ctx.measureText(txt).width;
          if (tw < x1 - x0 - 8) ctx.fillText(txt, x0 + 6, a.top + 6 + k * (Theme.px('--fs-1') + 4));
        });
        ctx.restore();
      },
      afterDraw(ch) {   // 이음 경계(seg): 세로 점선. 설명은 HTML 표시(.gw-seg)를 그 자리로 옮긴다
        const segs = ch.$segs || [];
        const { ctx, chartArea: a, scales: { x } } = ch;
        ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        const marks = qa('.gw-seg');
        segs.forEach((s, i) => {
          const px = x.getPixelForValue(s.x);
          const inside = px >= a.left && px <= a.right;
          if (marks[i]) { marks[i].hidden = !inside; marks[i].style.left = px + 'px'; marks[i].style.top = a.top + 'px'; }
          if (!inside) return;
          ctx.strokeStyle = C(s.color);
          ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
        });
        ctx.restore();
      },
    };
    const chart = new Chart(q('.gw-plot canvas'), {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: { legend: Theme.legend(), tooltip: { filter: item => !!item.dataset.$id, callbacks: { label: tipLabel } } },
        scales: {},
        layout: { padding: { top: 4, right: 4 } },
      },
      plugins: [hatchPlugin],
    });
    function tipLabel(c) {
      const ds = c.dataset;
      if (!ds.$id) return null;
      if (st.mode === 'scatter') return `${c.raw.year}년 · ${ds.$xLabel} ${c.raw.x.toFixed(3)} · ${ds.$yLabel} ${c.raw.y.toFixed(3)}`;
      if (st.mode === 'shape') return `${c.raw.x}년 · ${ds.label} (0~1 정규화) ${c.raw.y.toFixed(2)}`;
      const it = byId(ds.$id);
      return `${c.raw.x}년 · ${it.short} ${c.raw.y.toFixed(it.minSpan >= 2 ? 1 : 3)}${it.unit ? ' ' + it.unit : ''}`;
    }

    // ── 그리기 ──
    function xPeriod(lists) {
      let per = st.mode === 'time' && !st.commonOnly ? GraphWorkspaceCore.unionPeriod(...lists) : GraphWorkspaceCore.commonPeriod(...lists);
      if (per && st.range !== 'all') per = per.to >= st.range ? { from: Math.max(per.from, st.range), to: per.to } : null;
      return per;
    }
    const lineDs = (it, data, extra = {}) => ({
      label: it.short + (it.scope === 'station' && !it.short.includes('한 지점') ? ' · 한 지점' : '') + (it.scope === 'model' && !it.short.includes('모형') ? ' · 모형' : ''),
      data, $id: it.id, showLine: true, borderColor: C(it.color), backgroundColor: C(it.color),
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, tension: 0.1,
      borderDash: it.scope === 'model' ? [6, 4] : [], ...extra,
    });
    // 같은 axis 끼리 묶어 축을 정한다 (R1·R2)
    function axisGroups(ids) {
      const groups = [];
      for (const id of ids) {
        const it = byId(id), g = groups.find(x => x.axis === it.axis);
        if (g) g.ids.push(id); else groups.push({ axis: it.axis, ids: [id] });
      }
      return groups;
    }
    function axisTitle(ids) {
      const its = ids.map(byId), unit = axes[its[0].axis].unit;
      return its.map(it => it.short).join(' · ') + (unit ? ` (${unit})` : '');
    }
    const flipped = ids => ids.some(id => st.flips.has(id));
    const colorOf = (scale, col) => { scale.title.color = col; scale.ticks.color = col; return scale; };
    function yScale(ids, values, position, visible = true) {
      const it0 = byId(ids[0]);
      const r = GraphWorkspaceCore.axisRange(values, Math.max(...ids.map(id => byId(id).minSpan)), 0.05) || { min: 0, max: 1 };
      const col = ids.length === 1 ? C(it0.color) : C('--ink-2');
      const flip = flipped(ids);
      const s = Theme.axis({
        type: 'linear', position, display: visible, min: r.min, max: r.max, reverse: flip,
        title: axisTitle(ids) + (flip ? ' (뒤집음 ↓)' : ''),
        ticks: { color: col, font: Theme.font(), maxTicksLimit: 6, callback: (v, i, ticks) => fmt(v, Math.abs((ticks[1]?.value ?? v + 1) - (ticks[0]?.value ?? v))) },
        grid: { drawOnChartArea: position === 'left', color: Theme.alpha('--rule', 0.55) },
      });
      return colorOf(s, col);   // 축 제목·눈금 = 계열 색 (R2). 두 계열이 한 축이면 먹색
    }

    function render() {
      const ids = st.series;
      const lists = ids.map(pts);
      const ds = [], scales = {}, gaps = [], segs = [];
      let banner = '', tag = '';
      q('.gw-empty').hidden = ids.length > 0;
      const per = ids.length ? xPeriod(lists) : null;
      const noCommon = ids.length > 1 && !per;
      if (ids.length && st.mode === 'time' && per) {
        const groups = axisGroups(ids);
        groups.forEach((g, gi) => {
          const yid = gi === 0 ? 'y' : 'y1';
          for (const id of g.ids) {
            const it = byId(id), p = GraphWorkspaceCore.within(pts(id), per);
            if (id === 'temp' || p.some(o => o.lo !== undefined)) {   // 불확도 띠: 위 경계를 다음 계열(아래 경계)까지 채운다
              ds.push({ ...lineDs(it, p.map(o => ({ x: o.x, y: o.hi })), { borderWidth: 0, fill: '+1', backgroundColor: Theme.alpha('--data-band', 1), borderDash: [] }), label: '_띠', yAxisID: yid, $id: null });
              ds.push({ ...lineDs(it, p.map(o => ({ x: o.x, y: o.lo })), { borderWidth: 0 }), label: '_띠 아래', yAxisID: yid, $id: null });
            }
            ds.push({ ...lineDs(it, p), yAxisID: yid });
            // 이 계열 자료가 없는 구간 (마스터 결정 6)
            const s = GraphWorkspaceCore.span(pts(id));
            if (s.from > per.from) gaps.push({ from: per.from, to: s.from, color: it.color, text: `${it.short} 자료 없음 (${s.from}년부터)` });
            if (s.to < per.to) gaps.push({ from: s.to, to: per.to, color: it.color, text: `${it.short} 자료 없음 (${s.to}년까지)` });
            for (const o of p) if (o.seg) segs.push({ x: o.x, color: it.color, ...o.seg });
          }
          const vals = g.ids.flatMap(id => GraphWorkspaceCore.within(pts(id), per).flatMap(o => [o.y, o.lo, o.hi].filter(Number.isFinite)));
          scales[yid] = yScale(g.ids, vals, gi === 0 ? 'left' : 'right');
        });
        scales.x = Theme.axis({ type: 'linear', min: per.from, max: per.to, ticks: { color: C('--ink-3'), font: Theme.font(), maxTicksLimit: 8, callback: v => String(v) } });
      } else if (ids.length && st.mode === 'shape' && per) {
        // R5: 공통 기간에서 0~1로. 축 눈금 대신 '낮음/높음'
        ids.forEach(id => ds.push({ ...lineDs(byId(id), GraphWorkspaceCore.normalize(pts(id), per)), yAxisID: 'y' }));
        scales.y = Theme.axis({ type: 'linear', min: -0.05, max: 1.05, title: '상대적 높낮이 (공통 기간 안)',
          ticks: { color: C('--ink-3'), font: Theme.font(), stepSize: 0.5, callback: v => (v === 0 ? '낮음' : v === 1 ? '높음' : '') } });
        scales.x = Theme.axis({ type: 'linear', min: per.from, max: per.to, ticks: { color: C('--ink-3'), font: Theme.font(), maxTicksLimit: 8, callback: v => String(v) } });
        banner = '모양만 비교합니다 — 크기와 단위는 비교할 수 없어요';
      } else if (ids.length === 2 && st.mode === 'scatter' && per) {
        // R6: x = Y1, y = Y2, 공통 연도만. 점 색 = 연도 순(옅음 → 진함)
        const [a, b] = ids.map(byId), pairs = GraphWorkspaceCore.pairByYear(pts(a.id), pts(b.id), per);
        const n = pairs.length, ink = C('--data-obs');
        ds.push({ label: `${per.from}년(옅음) → ${per.to}년(진함)`, data: pairs, $id: 'pair', $xLabel: a.short, $yLabel: b.short,
          showLine: false, pointRadius: 3, pointHoverRadius: 5, borderWidth: 0,
          pointBackgroundColor: pairs.map((p, i) => Theme.alpha('--data-obs', 0.15 + 0.85 * (n > 1 ? i / (n - 1) : 1))), backgroundColor: ink, borderColor: ink });
        scales.x = colorOf(yScale([a.id], pairs.map(p => p.x), 'bottom'), C(a.color));
        scales.x.grid = { color: Theme.alpha('--rule', 0.55) };
        scales.y = colorOf(yScale([b.id], pairs.map(p => p.y), 'left'), C(b.color));
        const { r } = GraphWorkspaceCore.pearson(pts(a.id), pts(b.id), per);
        banner = `상관계수 r = ${r == null ? '계산 불가' : r.toFixed(2)} · 자료 ${n}쌍 · ${per.from}~${per.to}년 — 함께 변한다고 원인이라는 뜻은 아니에요. 왜 함께 변하는지 설명이 필요해요`;
      }
      if (noCommon) banner = '두 자료가 함께 있는 기간이 없어요 — 공통 기간이 필요한 보기는 그릴 수 없습니다';
      else if (ids.length && !per) banner = `${st.range}년 이후 자료가 없어요 — 기간을 [전체]로 바꿔 보세요`;
      else if (st.mode === 'scatter' && ids.length === 1) banner = '산점도는 자료 두 개가 필요해요';
      // 뒤집기 꼬리표 (R4)
      const fl = ids.filter(id => st.flips.has(id));
      if (fl.length && st.mode !== 'shape') tag = `${fl.map(id => byId(id).short).join('·')} 축을 뒤집었어요 ↓`;
      // 같은 축을 쓰는 계열이 하나면 축 글자를 그 계열 색으로 (R2)
      chart.data.datasets = ds;
      chart.options.scales = scales;
      chart.options.plugins.legend.display = st.mode !== 'scatter' && ds.length > 0;
      chart.$gaps = gaps;
      chart.$segs = segs;
      q('.gw-segs').innerHTML = segs.map(s => `<span class="gw-seg"><span class="gw-seg-mark" tabindex="0" aria-label="자료 이음: ${esc(s.text)}">이음</span>
        <span class="gw-seg-text" role="tooltip">${esc(s.text)} ${srcButton(s.src)}</span></span>`).join('');
      const bannerEl = q('.gw-banner'), plotH = plot.clientHeight;
      bannerEl.hidden = !banner; bannerEl.textContent = banner;
      q('.gw-tag').hidden = !tag; q('.gw-tag').textContent = tag;
      chart.update('none');
      // 고정 문구가 나타나거나 줄 수가 바뀌면 분석창 높이가 바뀐다. Chart.js 자체 크기 맞춤은 다음 화면 갱신까지 기다려
      // 그사이 x축 글자가 안내 줄과 겹쳐 보였다 → 높이가 바뀌었으면 바로 맞춘다
      if (plot.clientHeight !== plotH) chart.resize();
      renderControls();
    }

    function renderControls() {
      const n = maxSlots();
      q('.gw-slots').innerHTML = Array.from({ length: n }, (_, i) => {
        const id = st.series[i], it = id && byId(id);
        return it
          ? `<span class="gw-slot is-full" data-slot="${i}" tabindex="0" aria-label="${SLOT_NAME[i]}: ${esc(it.label)}. Delete로 빼기" style="--slot-c:${C(it.color)}">
              <b>${SLOT_NAME[i]}</b> ${esc(it.short)}<button class="gw-slot-x" type="button" data-remove="${i}" aria-label="${esc(it.short)} 빼기">✕</button></span>`
          : `<span class="gw-slot" data-slot="${i}"><b>${SLOT_NAME[i]}</b> 여기에 놓기</span>`;
      }).join('');
      qa('[data-mode]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
        b.disabled = !!(st.lock && st.lock.modes && !st.lock.modes.includes(b.dataset.mode));
      });
      qa('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(String(st.range) === b.dataset.range)));
      const common = q('[data-act="common"]');
      common.setAttribute('aria-pressed', String(st.commonOnly || st.mode !== 'time'));
      common.disabled = st.mode !== 'time';   // 모양 비교·산점도는 항상 공통 기간
      // 뒤집기 버튼은 Y2에 pH가 있을 때만 (R4)
      const flipBtn = q('[data-act="flip"]'), y2 = st.series[1];
      flipBtn.hidden = !(y2 && byId(y2).axis === 'pH' && st.mode !== 'shape');
      flipBtn.setAttribute('aria-pressed', String(!!(y2 && st.flips.has(y2))));
      qa('.gw-card').forEach(c => {
        const on = st.series.includes(c.dataset.id), locked = !!(st.lock && st.lock.deck && !st.lock.deck.includes(c.dataset.id));
        c.classList.toggle('is-on', on);
        c.classList.toggle('is-locked', locked);
        c.setAttribute('aria-disabled', String(locked));
      });
      // 안내 줄: 조합에 맞는 질문 (data-catalog.js DATA_HINTS) + 놓은 자료의 출처 ⓘ
      const pair = st.series.length === 2 && hints.pairs.find(h => h.pair.every(id => st.series.includes(id)));
      const per = st.series.map(id => { const p = periodOf(id); return `${byId(id).short} ${p.from}~${p.to}`; }).join(' · ');
      q('.gw-hint-text').textContent = st.series.length === 0 ? hints.empty
        : pair ? pair.text : st.series.length === 1 ? hints.one : `자료 기간: ${per}`;
      const keys = [...new Set(st.series.flatMap(id => srcKeys(byId(id))))];
      q('.gw-hint-src').innerHTML = keys.map(k => srcButton(k)).join('');
      const send = q('[data-act="send"]');
      if (send) send.disabled = st.series.length === 0;
    }

    // ── 상태 바꾸기 ──
    function changed() { render(); const cfg = getConfig(); listeners.forEach(fn => fn(cfg)); }
    function add(id, slot) {
      const it = byId(id);
      if (!it || st.series.includes(id)) return false;   // 같은 자료를 두 번 넣지 않는다
      if (st.lock && st.lock.deck && !st.lock.deck.includes(id)) return false;
      const n = maxSlots();
      if (slot != null && slot < st.series.length) st.series[slot] = id;
      else if (st.series.length < n) st.series.push(id);
      else st.series[n - 1] = id;                         // 다 차 있으면 마지막 칸(Y2)을 바꾼다
      changed();
      return true;
    }
    function remove(slotOrId) {
      const i = typeof slotOrId === 'number' ? slotOrId : st.series.indexOf(slotOrId);
      if (i < 0 || i >= st.series.length) return;
      st.flips.delete(st.series[i]);
      st.series.splice(i, 1);   // 칸을 당긴다(Y1을 빼면 Y2가 Y1이 된다)
      changed();
    }
    function clear() { st.series = []; st.flips.clear(); changed(); }
    function setMode(m) {
      if (!MODES[m] || (st.lock && st.lock.modes && !st.lock.modes.includes(m))) return;
      st.mode = m;
      if (st.series.length > maxSlots()) st.series = st.series.slice(0, maxSlots());
      changed();
    }
    function setRange(r) { if (RANGES.map(String).includes(String(r))) { st.range = r === 'all' ? 'all' : Number(r); changed(); } }
    function setCommonOnly(b) { st.commonOnly = !!b; changed(); }
    function setFlip(id, b) { if (b && byId(id) && byId(id).axis === 'pH') st.flips.add(id); else st.flips.delete(id); changed(); }
    function getConfig() {
      return { series: [...st.series], mode: st.mode, range: st.range, commonOnly: st.commonOnly, flips: [...st.flips] };
    }
    function loadConfig(cfg) {
      st.mode = MODES[cfg.mode] ? cfg.mode : 'time';
      st.series = (cfg.series || []).filter(id => byId(id)).slice(0, maxSlots());
      st.range = RANGES.map(String).includes(String(cfg.range)) ? (cfg.range === 'all' ? 'all' : Number(cfg.range)) : 'all';
      st.commonOnly = !!cfg.commonOnly;
      st.flips = new Set((cfg.flips || []).filter(id => st.series.includes(id)));
      changed();
    }
    // 탐구 단계가 카드·보기를 제한할 때 (3차 E). lock(null) 로 풀기
    function lock(o) { st.lock = o || null; if (o && o.modes && !o.modes.includes(st.mode)) st.mode = o.modes[0]; changed(); }
    // 그 순간의 그림 (PNG 내려받기). 저장하지 않는다 — 구성(getConfig)만 저장하고 그림은 필요할 때 다시 그린다(마스터 §6-8)
    function toImage() {
      const src = chart.canvas, out = document.createElement('canvas');
      out.width = src.width; out.height = src.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = C('--paper'); ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0);
      return out.toDataURL('image/png');
    }

    // ── 조작 연결 ──
    root.addEventListener('click', e => {
      const t = e.target;
      const mode = t.closest('[data-mode]'); if (mode) return setMode(mode.dataset.mode);
      const rg = t.closest('[data-range]'); if (rg) return setRange(rg.dataset.range);
      const rm = t.closest('[data-remove]'); if (rm) return remove(Number(rm.dataset.remove));
      const act = t.closest('[data-act]');
      if (act && act.dataset.act === 'common') return setCommonOnly(!st.commonOnly);
      if (act && act.dataset.act === 'flip') { const y2 = st.series[1]; return setFlip(y2, !st.flips.has(y2)); }
      if (act && act.dataset.act === 'send') return opts.onSend(getConfig());
      const od = t.closest('[data-open-deck]');
      if (od) {
        const g = q(`.gw-deck-group[data-deck="${od.dataset.openDeck}"]`), open = g.hidden;
        g.hidden = !open; od.setAttribute('aria-expanded', String(open));
        od.textContent = `${open ? '－' : '＋'} ${deckNames[od.dataset.openDeck]}`;
        if (open) g.scrollIntoView({ block: 'nearest' });
        return;
      }
      const addBtn = t.closest('.gw-card-add');
      if (addBtn) return add(addBtn.closest('.gw-card').dataset.id);
    });
    root.addEventListener('keydown', e => {
      const card = e.target.closest('.gw-card');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); add(card.dataset.id); return; }
      const slot = e.target.closest('.gw-slot.is-full');
      if (slot && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); remove(Number(slot.dataset.slot)); }
    });

    // 끌어 놓기 (마우스 전용). 4 px 넘게 움직여야 끌기로 본다 — 그 전에는 [＋] 누르기 등 클릭을 그대로 둔다
    let drag = null;   // { id, card, ghost, x0, y0, target }
    root.addEventListener('pointerdown', e => {
      const card = e.target.closest('.gw-card');
      if (!card || e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button') || card.classList.contains('is-locked')) return;
      drag = { id: card.dataset.id, card, ghost: null, x0: e.clientX, y0: e.clientY, target: null };
      card.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.ghost = drag.card.cloneNode(true);
        drag.ghost.classList.add('gw-ghost');
        drag.ghost.style.width = drag.card.offsetWidth + 'px';
        document.body.appendChild(drag.ghost);
        root.classList.add('is-dragging');
      }
      drag.ghost.style.left = e.clientX + 8 + 'px';
      drag.ghost.style.top = e.clientY + 8 + 'px';
      // 끌고 있는 카드 밑의 놓을 곳 (복제 그림자는 pointer-events: none)
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under && root.contains(under) ? under.closest('[data-slot], [data-drop="plot"]') : null;
      if (drag.target && drag.target !== target) drag.target.classList.remove('drag-over');
      if (target) target.classList.add('drag-over');
      drag.target = target;
    });
    const endDrag = () => {
      if (!drag) return;
      const { id, ghost, target } = drag;
      drag = null;
      root.classList.remove('is-dragging');
      if (ghost) ghost.remove();
      if (!target) return;
      target.classList.remove('drag-over');
      // 칸에 놓으면 그 칸, 분석창 가운데에 놓으면 빈 칸 먼저(다 차 있으면 Y2를 바꾼다)
      add(id, target.dataset.slot != null ? Number(target.dataset.slot) : undefined);
    };
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);

    render();
    return {
      add, remove, clear, setMode, setRange, setCommonOnly, setFlip, getConfig, loadConfig, lock, toImage,
      on(ev, fn) { if (ev === 'change') listeners.push(fn); },
      resize() { chart.resize(); },
      chart,
    };
  }

  return { create };
})();
