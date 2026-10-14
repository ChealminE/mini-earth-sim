# -*- coding: utf-8 -*-
"""
단일 HTML 빌더 - 조감 모드 + 1인칭 탐험 모드를 파일 하나로 묶는다.
========================================================================
결과물: dist/MiniEarth.html  (더블클릭하면 브라우저에서 바로 열림, 서버·인터넷 불필요)

왜 iframe인가
  두 모드는 js/earth-model.js 를 각각 읽는다. 한 문서에 같이 넣으면 `const CO2_MIN`
  이 두 번 선언돼 SyntaxError가 난다. CSS도 style.css(조감)와 firstperson/style.css가
  같은 클래스명을 다르게 정의한다. iframe(srcdoc)에 넣으면 전역 스코프와 CSS가 문서
  단위로 갈라지므로, 두 모드의 소스를 한 줄도 고치지 않고 그대로 쓸 수 있다.

왜 부모가 자산을 들고 있나
  three.min.js(654KB)와 텍스처(base64 4.6MB)는 두 모드가 똑같이 쓴다. 각 iframe의
  srcdoc에 통째로 박으면 파일에 같은 내용이 두 벌 들어가 5MB 넘게 커진다. 그래서
  부모 문서가 window.__A__ 에 한 벌만 들고 있고, iframe은 빈 껍데기로 띄운 뒤
  부모가 자식 document에 <script>를 꽂아 넣는 방식으로 부팅한다.
  (file:// 에서도 srcdoc iframe은 부모와 같은 출처라 parent 접근이 된다 - 실측 확인)

재빌드: python tools/build_single_html.py
"""

import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "MiniEarth.html"

MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def read(rel):
    p = ROOT / rel
    if not p.exists():
        sys.exit("[실패] 파일이 없습니다: %s" % rel)
    return p.read_text(encoding="utf-8")


def js_str(s):
    """JS 문자열 리터럴로. </script> 가 HTML 파서를 끊지 않게 </ 를 전부 이스케이프."""
    return json.dumps(s, ensure_ascii=False).replace("</", "<\\/")


def data_uri(path):
    mime = MIME.get(path.suffix.lower())
    if not mime:
        sys.exit("[실패] 처리할 수 없는 자산 형식: %s" % path.name)
    return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode("ascii"))


def body_of(html):
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S | re.I)
    if not m:
        sys.exit("[실패] <body>를 찾지 못했습니다")
    # 스크립트 태그는 부모가 순서대로 주입하므로 마크업에서는 빼낸다
    return re.sub(r"<script\b[^>]*>.*?</script>", "", m.group(1), flags=re.S | re.I).strip()


def inline_styles_of(html):
    """<head>의 <style> 블록 내용을 이어 붙인다 (index.html은 모달 CSS를 거기 둔다)."""
    head = re.search(r"<head[^>]*>(.*?)</head>", html, re.S | re.I)
    if not head:
        return ""
    return "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", head.group(1), re.S | re.I))


# ── 1. 공유 라이브러리 ────────────────────────────────────────────────
vendor = ROOT / "vendor"
if not (vendor / "three.min.js").exists() or not (vendor / "chart.umd.min.js").exists():
    sys.exit(
        "[실패] vendor/ 에 라이브러리가 없습니다. 아래 두 줄을 먼저 실행하세요.\n"
        "  curl -L -o vendor/three.min.js https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js\n"
        "  curl -L -o vendor/chart.umd.min.js https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js")

LIB = {
    "three": (vendor / "three.min.js").read_text(encoding="utf-8"),
    "chart": (vendor / "chart.umd.min.js").read_text(encoding="utf-8"),
}

# ── 2. 텍스처 → data URI ─────────────────────────────────────────────
TEX = {}
for p in sorted((ROOT / "texture_image").iterdir()):
    if p.is_file() and p.suffix.lower() in MIME:
        TEX["texture_image/" + p.name] = data_uri(p)

# ── 3. 두 모드의 CSS / 마크업 / 스크립트 ──────────────────────────────
aerial_html = read("index.html")
fp_html = read("firstperson/index.html")

CSS = {
    "aerial": read("style.css") + "\n" + inline_styles_of(aerial_html),
    "fp": read("firstperson/style.css") + "\n" + inline_styles_of(fp_html),
}
BODY = {"aerial": body_of(aerial_html), "fp": body_of(fp_html)}

AERIAL_JS = ["js/earth-model.js", "js/earth-data.js", "js/earth-system.js", "js/common.js", "js/tab-current.js",
             "js/tab-future.js", "js/live-fit.js", "js/xlsx-lite.js", "js/tab-live.js",
             "js/live-analysis.js", "js/live-setup.js", "js/live-file.js", "js/main.js"]
FP_JS = ["js/earth-model.js", "firstperson/fp-world.js", "firstperson/fp-weather.js",
         "firstperson/fp-audio.js", "firstperson/fp-minimap.js", "firstperson/fp-field.js",
         "firstperson/fp-tools.js", "firstperson/fp-player.js", "firstperson/fp-main.js"]


# index.html 쪽에 스크립트가 추가됐는데 이 목록을 안 고치면 조용히 깨진 파일이 나온다.
# 빌드할 때마다 HTML의 실제 <script src> 순서와 대조해서, 어긋나면 즉시 멈춘다.
def script_srcs(html):
    # three.js·Chart.js는 빌더가 vendor/ 에서 직접 넣으므로 목록 대조에서 뺀다 (CDN 주소든 vendor/ 주소든)
    return [s for s in re.findall(r'<script[^>]+src="([^"]+)"', html)
            if "cdn.jsdelivr.net" not in s and not s.lstrip("/").startswith("vendor/")]


def norm_src(s, prefix):
    s = s.split("?")[0].lstrip("/")
    return s if "/" in s else prefix + s


for label, html, expected, prefix in (
        ("index.html", aerial_html, AERIAL_JS, ""),
        ("firstperson/index.html", fp_html, FP_JS, "firstperson/")):
    actual = [norm_src(s, prefix) for s in script_srcs(html)]
    if actual != expected:
        sys.exit("[실패] %s 의 스크립트 순서가 빌더 목록과 다릅니다.\n"
                 "  HTML : %s\n  빌더 : %s\n"
                 "  tools/build_single_html.py 의 목록을 맞춰 주세요." % (label, actual, expected))

JS = {"aerial": [read(f) for f in AERIAL_JS], "fp": [read(f) for f in FP_JS]}

# ── 4. 시작 화면(껍데기) ─────────────────────────────────────────────
SHELL_CSS = """
* { box-sizing: border-box; }
html, body { margin:0; height:100%; }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: radial-gradient(ellipse at 50% 20%, #1c2129 0%, #14171c 60%);
  color:#e7e9ec; }
#home { min-height:100vh; display:flex; flex-direction:column; align-items:center;
  justify-content:center; padding:40px 20px; }
.header { text-align:center; margin-bottom:36px; }
.header h1 { font-size:22px; font-weight:700; margin:0 0 8px; }
.header p { font-size:13px; color:#9198a3; margin:0; line-height:1.6; }
.grid { display:grid; grid-template-columns:repeat(2, minmax(220px,320px)); gap:18px;
  width:100%; max-width:700px; }
@media (max-width:560px){ .grid { grid-template-columns:1fr; } }
.card { display:flex; flex-direction:column; gap:8px; background:#1b1e24;
  border:1px solid #2a2e35; border-radius:14px; padding:22px 20px; cursor:pointer;
  color:inherit; text-align:left; font:inherit;
  transition:border-color .15s, transform .15s, background .15s; }
.card:hover { border-color:#5DCAA5; background:#20242b; transform:translateY(-2px); }
.card .icon { font-size:28px; }
.card .title { font-size:15.5px; font-weight:600; }
.card .desc { font-size:12px; color:#9198a3; line-height:1.6; }
.card .badge { align-self:flex-start; font-size:10px; margin-top:2px; padding:2px 8px;
  border-radius:10px; background:#10231c; color:#5DCAA5; border:1px solid #2f8f7a; }
.card.off { opacity:.55; cursor:not-allowed; }
.card.off:hover { border-color:#2a2e35; background:#1b1e24; transform:none; }
.footer-hint { margin-top:28px; font-size:11px; color:#565b62; text-align:center; line-height:1.7; }
#viewer { display:none; position:fixed; inset:0; background:#101216; }
#viewer.on { display:block; }
#frame { width:100%; height:100%; border:0; display:block; }
/* 1인칭 화면은 좌하단에 미니맵, 하단 중앙에 도구 단축바가 있다. 우하단만 비어 있다. */
#back { display:none; position:fixed; right:12px; bottom:12px; z-index:50; font:inherit;
  font-size:12px; padding:7px 13px; border-radius:9px; cursor:pointer; color:#cfd4da;
  background:rgba(18,22,27,.82); border:1px solid #39404a; }
#back.on { display:block; }
#back:hover { border-color:#5DCAA5; color:#fff; }
#loading { position:fixed; inset:0; display:none; align-items:center; justify-content:center;
  color:#8b929c; font-size:13px; z-index:40; }
#loading.on { display:flex; }
"""

CARDS = [
    ("current", "\U0001F30D", "현재 실태",
     "1988~2023년 CO₂ 농도·기온편차·해양 pH·화석연료 배출 실측 데이터 그래프", ""),
    ("future", "\U0001F52E", "미래 예측",
     "CO₂ 농도를 슬라이더로 바꿔가며 미래의 기온·해양 산성화를 예측", ""),
    ("live", "\U0001F52C", "직접 실험",
     "센서 실시간 측정 — 이 단일 파일 버전에서는 쓸 수 없습니다 (server.py 필요)", "off"),
    ("fp", "\U0001F9ED", "탐험",
     "1인칭 시점으로 걸어다니며 환경을 조사하는 탐험 모드", ""),
]

cards_html = "\n".join(
    '    <button class="card {off}" data-go="{key}"{dis}>'
    '<div class="icon">{icon}</div><div class="title">{title}</div>'
    '<div class="desc">{desc}</div>{badge}</button>'.format(
        key=k, icon=i, title=t, desc=d, off=off, dis=" disabled" if off else "",
        badge='<div class="badge">별도 모드</div>' if k == "fp" else "")
    for k, i, t, d, off in CARDS)

# ── 5. 껍데기 로직 + 자식 문서 부팅 ──────────────────────────────────
BOOT_JS = r"""
window.__home__ = function () {
  document.getElementById('viewer').classList.remove('on');
  document.getElementById('back').classList.remove('on');
  document.getElementById('frame').srcdoc = '';
  try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
};

// 부모가 자식 window 안에서 코드 한 덩이를 실행시킨다.
// (자식 document에 <script>를 꽂으면 자식 전역 스코프에서 돈다 = 모드별 스코프 분리)
function runIn(w, code) {
  var s = w.document.createElement('script');
  s.textContent = code;
  w.document.head.appendChild(s);
}

// file:// 의 불투명 출처에서 localStorage 접근이 막히는 브라우저가 있다.
// 막히면 main.js / fp-main.js 가 최상위에서 바로 죽으므로 메모리 저장소로 대체한다.
var SHIM_STORAGE =
  "try { window.localStorage.setItem('__t','1'); window.localStorage.removeItem('__t'); }" +
  "catch (e) { var S = {}; Object.defineProperty(window, 'localStorage', { configurable: true, value: {" +
  "  getItem: function (k) { return Object.prototype.hasOwnProperty.call(S, k) ? S[k] : null; }," +
  "  setItem: function (k, v) { S[k] = String(v); }," +
  "  removeItem: function (k) { delete S[k]; }, clear: function () { S = {}; } } }); }";

// 텍스처는 부모가 data URI로 한 벌만 들고 있다. 앱 소스는 'texture_image/x.jpg' 또는
// '/texture_image/x.jpg' 로 부르므로, 로더 진입점에서 경로를 바꿔치기한다.
var SHIM_TEX =
  "(function () { var M = parent.__A__.tex;" +
  " function norm(u) { return String(u).split('?')[0].replace(/^\\.?\\//, ''); }" +
  " var P = THREE.TextureLoader.prototype, orig = P.load;" +
  " P.load = function (url, a, b, c) { return orig.call(this, M[norm(url)] || url, a, b, c); }; })();";

window.__boot__ = function (w, mode, tab) {
  var A = window.__A__, d = w.document;
  d.title = (mode === 'fp') ? '미니 지구 · 1인칭 탐험' : '미니 지구 모델';

  var st = d.createElement('style');
  st.textContent = A.css[mode];
  d.head.appendChild(st);

  // 앱 스크립트들이 최상위에서 getElementById 를 부르므로 마크업이 먼저 있어야 한다
  d.body.innerHTML = A.body[mode];

  runIn(w, SHIM_STORAGE);
  runIn(w, A.lib.three);
  if (mode === 'aerial') runIn(w, A.lib.chart);
  runIn(w, SHIM_TEX);
  for (var i = 0; i < A.js[mode].length; i++) runIn(w, A.js[mode][i]);

  if (mode === 'aerial') {
    var home = d.querySelector('.home-link');
    if (home) {
      home.removeAttribute('href');
      home.style.cursor = 'pointer';
      home.addEventListener('click', function () { parent.__home__(); });
    }
    if (tab && typeof w.switchTab === 'function') w.switchTab(tab);

    // 센서 탭은 server.py(WebSocket)가 있어야 돈다. 단일 파일에서는 막고 이유를 알린다.
    var btn = d.getElementById('startStopBtn');
    if (btn) {
      btn.disabled = true;
      btn.title = '단일 파일 버전에서는 센서 연결을 쓸 수 없습니다';
      // disabled 만으로는 초록색 그대로라 눌리는 것처럼 보인다
      btn.style.opacity = '.4';
      btn.style.cursor = 'not-allowed';
    }
    var live = d.getElementById('tab-live');
    if (live) {
      var note = d.createElement('div');
      note.style.cssText = 'margin:10px 0;padding:11px 14px;border-radius:9px;line-height:1.7;' +
        'background:#2a2118;border:1px solid #6b4f2a;color:#e8c893;font-size:12.5px';
      note.innerHTML = '이 <b>단일 HTML 파일</b> 버전에서는 실시간 센서 측정을 쓸 수 없습니다. ' +
        '센서 값은 <b>server.py</b> 가 중계하는데, 파일 하나만으로는 그 서버가 없기 때문입니다.<br>' +
        '실제 측정을 하려면 저장소를 받아 <b>run_server.bat</b> 을 실행한 뒤 ' +
        '<b>http://127.0.0.1:8000</b> 으로 접속하세요.';
      live.insertBefore(note, live.firstChild);
    }
  } else {
    // 1인칭에는 "처음으로" 링크가 없다. 포인터락이 풀려 있을 때만 껍데기 버튼을 보여 준다.
    document.getElementById('back').classList.add('on');
    w.document.addEventListener('pointerlockchange', function () {
      var locked = !!w.document.pointerLockElement;
      document.getElementById('back').classList.toggle('on', !locked);
    });
  }
  document.getElementById('loading').classList.remove('on');
};

function open_(mode, tab) {
  document.getElementById('loading').classList.add('on');
  document.getElementById('viewer').classList.add('on');
  if (mode === 'aerial') document.getElementById('back').classList.remove('on');
  document.getElementById('frame').srcdoc =
    '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
    '<scr' + 'ipt>parent.__boot__(window,' + JSON.stringify(mode) + ',' +
    JSON.stringify(tab || null) + ')</scr' + 'ipt></body></html>';
}

document.querySelectorAll('.card[data-go]').forEach(function (el) {
  el.addEventListener('click', function () {
    var g = el.getAttribute('data-go');
    if (g === 'fp') open_('fp', null); else open_('aerial', g);
  });
});
document.getElementById('back').addEventListener('click', window.__home__);
"""

# ── 6. 조립 ──────────────────────────────────────────────────────────
assets = (
    "window.__A__={\n"
    "lib:{three:%s,chart:%s},\n"
    "css:{aerial:%s,fp:%s},\n"
    "body:{aerial:%s,fp:%s},\n"
    "js:{aerial:[%s],fp:[%s]},\n"
    "tex:{%s}\n};\n"
) % (
    js_str(LIB["three"]), js_str(LIB["chart"]),
    js_str(CSS["aerial"]), js_str(CSS["fp"]),
    js_str(BODY["aerial"]), js_str(BODY["fp"]),
    ",".join(js_str(s) for s in JS["aerial"]),
    ",".join(js_str(s) for s in JS["fp"]),
    ",".join("%s:%s" % (json.dumps(k), json.dumps(v)) for k, v in TEX.items()),
)

page = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>미니 지구 모델 시뮬레이션</title>
<style>%s</style>
</head>
<body>
<div id="home">
  <div class="header">
    <h1>미니 지구 모델 시뮬레이션</h1>
    <p>보고 싶은 화면을 골라 들어가세요. 설치도 인터넷 연결도 필요 없습니다.</p>
  </div>
  <div class="grid">
%s
  </div>
  <div class="footer-hint">이 파일 하나에 전부 들어 있습니다 — 더블클릭하면 바로 열립니다.<br>
  실시간 센서 측정만 server.py 가 필요합니다.</div>
</div>
<div id="viewer"><iframe id="frame" allow="pointer-lock; fullscreen; autoplay"></iframe></div>
<div id="loading">불러오는 중…</div>
<button id="back">← 처음으로</button>
<script>
%s
%s
</script>
</body>
</html>
""" % (SHELL_CSS, cards_html, assets, BOOT_JS)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(page, encoding="utf-8")

print("빌드 완료: %s" % OUT.relative_to(ROOT).as_posix())
print("  크기          %.2f MB" % (OUT.stat().st_size / 1048576))
print("  텍스처        %d개" % len(TEX))
print("  스크립트      조감 %d개 / 1인칭 %d개" % (len(JS["aerial"]), len(JS["fp"])))
