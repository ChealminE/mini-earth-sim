// ================= 직접 실험 - 통계 · 추세식 · 데이터 편집 계산 (화면과 무관한 순수 계산) =================
// 그래프 카드의 추세선과 아래쪽 '데이터 분석·편집' 칸이 같은 함수를 쓴다.
// 점은 전부 {x, y} 형태.

// ── 기본 통계 ──────────────────────────────────────
function describeValues(values) {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  if (n === 0) return { n: 0 };
  const sorted = [...v].sort((a, b) => a - b);
  const sum = v.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // 학생 실험 데이터는 모집단이 아니라 표본이라 n−1로 나누는 표본표준편차를 쓴다
  // (1인칭 모드 야장도 같은 정의 - 두 화면 숫자가 어긋나지 않게)
  const std = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, min: sorted[0], max: sorted[n - 1], mean, median, std, range: sorted[n - 1] - sorted[0] };
}

// ── 추세식(회귀) ────────────────────────────────────
const FIT_MODELS = [
  { id: 'linear', label: '직선 (일차식)', short: '직선' },
  { id: 'poly2', label: '이차식 (포물선)', short: '이차식' },
  { id: 'poly3', label: '삼차식', short: '삼차식' },
  { id: 'exp', label: '지수 함수 (y = a·eᵇˣ)', short: '지수' },
  { id: 'log', label: '로그 함수 (y = a + b·ln x)', short: '로그' },
  { id: 'power', label: '거듭제곱 (y = a·xᵇ)', short: '거듭제곱' },
];

// 연립방정식 풀이 (가우스 소거, 부분 피벗)
function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// 다항식 최소제곱. 6시간 실험이면 x(초)가 2만을 넘어서 x³이 10¹³이 되므로 그대로 풀면 수치가 깨진다.
// x를 평균 0·표준편차 1로 바꿔(u) 푼 뒤, 식을 원래 x에 대한 계수로 다시 펼친다.
function polyFit(points, degree) {
  const n = points.length;
  if (n <= degree) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const sx = Math.sqrt(points.reduce((a, p) => a + (p.x - mx) ** 2, 0) / n) || 1;
  const m = degree + 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  for (const p of points) {
    const u = (p.x - mx) / sx;
    const pw = [1];
    for (let k = 1; k < 2 * m; k++) pw.push(pw[k - 1] * u);
    for (let i = 0; i < m; i++) {
      b[i] += p.y * pw[i];
      for (let j = 0; j < m; j++) A[i][j] += pw[i + j];
    }
  }
  const a = solveLinearSystem(A, b);
  if (!a) return null;
  // Σ a_k ((x−mx)/sx)^k 를 x의 거듭제곱 계수로 펼침
  const coef = new Array(m).fill(0);
  const binom = (k, j) => { let r = 1; for (let t = 1; t <= j; t++) r = r * (k - t + 1) / t; return r; };
  for (let k = 0; k < m; k++) {
    for (let j = 0; j <= k; j++) coef[j] += a[k] / sx ** k * binom(k, j) * (-mx) ** (k - j);
  }
  return {
    coef, // coef[j] = x^j의 계수
    predict: (x) => { const u = (x - mx) / sx; let y = 0, pw = 1; for (let k = 0; k < m; k++) { y += a[k] * pw; pw *= u; } return y; },
  };
}

function rSquared(points, predict) {
  const mean = points.reduce((a, p) => a + p.y, 0) / points.length;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    ssRes += (p.y - predict(p.x)) ** 2;
    ssTot += (p.y - mean) ** 2;
  }
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

// 유효숫자 4자리로 보기 좋게 (아주 크거나 작으면 지수 표기)
function fmtCoef(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3).replace('e+', '×10^').replace('e-', '×10^-');
  return String(Number(v.toPrecision(4)));
}

function signed(v, first) {
  const s = fmtCoef(Math.abs(v));
  if (first) return (v < 0 ? '−' : '') + s;
  return (v < 0 ? ' − ' : ' + ') + s;
}

function polyEquation(coef) {
  let out = 'y = ';
  let first = true;
  for (let j = coef.length - 1; j >= 0; j--) {
    if (coef[j] === 0) continue;
    const term = j === 0 ? '' : j === 1 ? 'x' : `x${j === 2 ? '²' : '³'}`;
    out += signed(coef[j], first) + term;
    first = false;
  }
  return first ? 'y = 0' : out;
}

// model: FIT_MODELS의 id. 맞출 수 없으면 { error: '이유' }.
function fitModel(points, model) {
  const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return { error: '점이 2개 이상 있어야 합니다' };
  let predict, equation;

  if (model === 'linear' || model === 'poly2' || model === 'poly3') {
    const deg = model === 'linear' ? 1 : model === 'poly2' ? 2 : 3;
    if (pts.length <= deg) return { error: `점이 ${deg + 1}개 이상 있어야 합니다` };
    const f = polyFit(pts, deg);
    if (!f) return { error: '모든 점의 x가 같아서 식을 정할 수 없습니다' };
    predict = f.predict;
    equation = polyEquation(f.coef);
    const r2 = rSquared(pts, predict);
    return { model, predict, equation, r2, n: pts.length, slope: deg === 1 ? f.coef[1] : undefined };
  }

  // 아래 셋은 로그를 씌워 직선으로 바꾼 뒤 푼다 → 로그를 못 씌우는 값(0 이하)이 있으면 쓸 수 없다
  if (model === 'exp') {
    if (pts.some(p => p.y <= 0)) return { error: 'y가 0 이하인 값이 있어서 지수 함수를 쓸 수 없습니다' };
    const f = polyFit(pts.map(p => ({ x: p.x, y: Math.log(p.y) })), 1);
    if (!f) return { error: '식을 정할 수 없습니다' };
    const a = Math.exp(f.coef[0]), b = f.coef[1];
    predict = (x) => a * Math.exp(b * x);
    equation = `y = ${fmtCoef(a)}·e^(${fmtCoef(b)}x)`;
  } else if (model === 'log') {
    if (pts.some(p => p.x <= 0)) return { error: 'x가 0 이하인 값이 있어서 로그 함수를 쓸 수 없습니다' };
    const f = polyFit(pts.map(p => ({ x: Math.log(p.x), y: p.y })), 1);
    if (!f) return { error: '식을 정할 수 없습니다' };
    const a = f.coef[0], b = f.coef[1];
    predict = (x) => a + b * Math.log(x);
    equation = `y = ${fmtCoef(a)}${signed(b, false)}·ln x`;
  } else if (model === 'power') {
    if (pts.some(p => p.x <= 0 || p.y <= 0)) return { error: 'x나 y가 0 이하인 값이 있어서 거듭제곱 함수를 쓸 수 없습니다' };
    const f = polyFit(pts.map(p => ({ x: Math.log(p.x), y: Math.log(p.y) })), 1);
    if (!f) return { error: '식을 정할 수 없습니다' };
    const a = Math.exp(f.coef[0]), b = f.coef[1];
    predict = (x) => a * x ** b;
    equation = `y = ${fmtCoef(a)}·x^${fmtCoef(b)}`;
  } else {
    return { error: '알 수 없는 식 종류' };
  }
  // R²는 변환한 값이 아니라 원래 y 기준으로 계산해야 모형끼리 비교가 공정하다
  return { model, predict, equation, r2: rSquared(pts, predict), n: pts.length };
}

// 추세 곡선을 그릴 점 (곡선이면 직선 두 점으로는 모양이 안 나오므로 여러 점)
function fitCurvePoints(fit, xMin, xMax, steps = 80) {
  if (!fit || fit.error || !(xMax > xMin)) return [];
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (xMax - xMin) * i / steps;
    const y = fit.predict(x);
    if (Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

// ── 데이터 편집 단계 ─────────────────────────────────
function trimRange(points, xMin, xMax) {
  return points.filter(p => (xMin === '' || xMin == null || p.x >= Number(xMin)) &&
                            (xMax === '' || xMax == null || p.x <= Number(xMax)));
}

// 평균에서 표준편차의 k배보다 멀리 떨어진 값을 뺀다
function removeOutliers(points, k) {
  const s = describeValues(points.map(p => p.y));
  if (s.n < 3 || s.std === 0) return { kept: points, removed: [] };
  const kept = [], removed = [];
  for (const p of points) (Math.abs(p.y - s.mean) > k * s.std ? removed : kept).push(p);
  return { kept, removed };
}

// 연속한 N개씩 묶어 평균 (예: 1초 간격 데이터를 5개씩 → 5초 간격 평균 데이터). 남는 꼬리도 하나로 묶는다.
function blockAverage(points, n) {
  n = Math.max(1, Math.floor(n));
  if (n === 1) return points;
  const out = [];
  for (let i = 0; i < points.length; i += n) {
    const g = points.slice(i, i + n);
    out.push({ x: g.reduce((a, p) => a + p.x, 0) / g.length, y: g.reduce((a, p) => a + p.y, 0) / g.length });
  }
  return out;
}

// 이동 평균: 각 점을 '자기 포함 직전 N개' 평균으로 바꾼다 (점 개수는 처음 N−1개만큼 줄어듦)
function movingAverage(points, n) {
  n = Math.max(1, Math.floor(n));
  if (n === 1) return points;
  const out = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].y;
    if (i >= n) sum -= points[i - n].y;
    if (i >= n - 1) out.push({ x: points[i].x, y: sum / n });
  }
  return out;
}

// 그래프에 그릴 때만 점을 솎는다 (원본은 그대로). 구간마다 최솟값·최댓값 점을 남겨서
// 순간적으로 튄 값(센서 오류·급변)이 솎아내기 때문에 화면에서 사라지지 않게 한다.
function downsampleMinMax(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const buckets = Math.floor(maxPoints / 2);
  const size = points.length / buckets;
  const out = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size), end = Math.min(points.length, Math.floor((b + 1) * size));
    if (start >= end) continue;
    let lo = start, hi = start;
    for (let i = start + 1; i < end; i++) {
      if (points[i].y < points[lo].y) lo = i;
      if (points[i].y > points[hi].y) hi = i;
    }
    if (lo === hi) out.push(points[lo]);
    else if (lo < hi) out.push(points[lo], points[hi]);
    else out.push(points[hi], points[lo]);
  }
  return out;
}
