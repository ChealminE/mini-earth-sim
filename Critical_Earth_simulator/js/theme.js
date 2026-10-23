// ============================================================================
// 디자인 토큰을 JS에서 읽기 (css/theme.css 의 :root 변수)
// ----------------------------------------------------------------------------
// 왜: Chart.js 축·선 색과 three.js 배경색이 JS 안에 하드코딩돼 있어서 CSS 테마를 바꿔도
// 그래프·3D만 예전 색으로 남았다. 이제 색은 CSS 토큰 한 곳에만 두고 여기서 읽는다.
// 주의: Chart.defaults 를 전역으로 바꾸지 않는다(직접 실험 탭 그래프까지 바뀐다).
//       탭별 옵션 함수에서 Theme.color()를 불러 쓴다.
// ============================================================================
const Theme = (() => {
  const cache = new Map();
  // CSS 변수 값 (예: Theme.color('--ink') → '#1d2025'). 토큰은 실행 중 바뀌지 않으므로 기억해 둔다.
  function color(name) {
    if (cache.has(name)) return cache.get(name);
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) console.warn('[theme] 정의되지 않은 토큰:', name);
    cache.set(name, v);
    return v;
  }
  // '#rrggbb' 또는 토큰 이름 → 'rgba(r,g,b,a)' (그래프 띠·격자처럼 옅게 쓸 때)
  function alpha(c, a) {
    const hex = c.startsWith('--') ? color(c) : c;
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // three.js 색 숫자 (예: renderer.setClearColor(Theme.hex('--paper')))
  function hex(name) {
    const m = /^#([0-9a-f]{6})$/i.exec(color(name));
    return m ? parseInt(m[1], 16) : 0x000000;
  }
  // 글자 크기 토큰(calc 식)을 px 숫자로 — Chart.js font.size 는 숫자를 받는다
  const pxCache = new Map();
  function px(name) {
    if (pxCache.has(name)) return pxCache.get(name);
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;visibility:hidden;font-size:var(${name})`;
    document.body.appendChild(probe);
    const v = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    pxCache.set(name, v);
    return v;
  }
  // 그래프 글꼴 (Chart.js font 객체)
  const font = (size = px('--fs-1'), weight = 400) => ({ family: color('--font-body') || 'sans-serif', size, weight });
  // 그래프 축·범례 (현재 실태·미래 예측 공용). 글자는 13 px 이상(--fs-1), 격자는 구분선 색을 옅게.
  function axis({ title, ...extra } = {}) {
    return {
      ticks: { color: color('--ink-3'), font: font() },
      grid: { color: alpha('--rule', 0.55) },
      border: { color: color('--rule') },
      title: title ? { display: true, text: title, color: color('--ink-2'), font: font() } : { display: false },
      ...extra,
    };
  }
  // '_'로 시작하는 계열 이름(불확도 띠의 아래 경계 같은 보조 계열)은 범례에서 뺀다.
  // align: 'end'는 쓰지 않는다 - Chart.js 4.4.1에서 한 줄의 마지막 항목이 그려지지 않았다(1920×1080 실측).
  const legend = () => ({ display: true, align: 'center',
    labels: { color: color('--ink-2'), font: font(), boxWidth: 18, boxHeight: 3, padding: 8, filter: it => !it.text.startsWith('_') } });
  return { color, alpha, hex, px, font, axis, legend };
})();
