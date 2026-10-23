# -*- coding: utf-8 -*-
"""
직접 실험 탭 테마 이관용 색 목록 뽑기 (docs/테마_이관_가이드.md 의 표를 만든다)
========================================================================
style.css 에서 직접 실험 전용 선택자가 쓰는 하드코딩 색과, 직접 실험 탭 JS(Chart.js·three.js)에서
색이 적힌 줄을 뽑는다. 동료 파일은 고치지 않고 읽기만 한다.

실행: python tools/list_live_colors.py > 출력.md   (가이드에 붙여 넣는다)
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 직접 실험 탭 전용 선택자 (style.css 주석과 클래스 이름 규칙에서 정리)
LIVE_SEL = re.compile(r"(#tab-live|#liveSetup|#liveRun|#liveDeviceList|#graphWin|body\.live-|body\.ls-|\.live-|\.lr-|\.ls-|"
                      r"\.dev-|\.fg-|\.gw-|\.an-|\.cs-|\.lc-|\.pl-|\.lm-|\.lp-|\.dl-|\.value-chip|\.toggle-btn|\.tag\b|"
                      r"\.conn-status|\.code-preview|\.exp-settings|\.empty-hint|\.icon-btn)")
COLOR = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)")

# 자주 쓰인 색 → 토큰 제안 (다크 → 종이 테마). 쓰임새(바탕/글자/강조)를 보고 고른 것이라 사람이 확인할 것.
SUGGEST = {
    "#5dcaa5": "--ctl-scen (조작 강조) / 상태 '켜짐'은 --data-ph 계열",
    "#9198a3": "--ink-2", "#7d838d": "--ink-3", "#e7e9ec": "--ink", "#cfd3da": "--ink-2",
    "#1b1e24": "--paper", "#23272f": "--paper-2", "#20242b": "--paper-2", "#262a31": "--paper-3",
    "#2a2e35": "--rule", "#2f343c": "--rule", "#3a3f47": "--rule", "#14171c": "--paper",
    "#10231c": "--ctl-scen-bg", "#2f8f7a": "--ctl-scen", "#ef9f27": "--warn", "#2a2118": "--warn-bg",
    "#e24b4a": "--data-temp (오류·정지)", "#85b7eb": "--ctl-time", "#6b7178": "--ink-3", "#565b62": "--ink-3",
    "#111": "--paper", "#333": "--rule", "#eee": "--ink", "#ccc": "--ink-2", "#1a1a1a": "--paper-2", "#2c2c2c": "--rule",
}


def rules(css):
    # 주석을 지우되 줄 수는 남겨 줄 번호가 원본과 같게 한다
    css = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        start = m.start(1) + len(m.group(1)) - len(m.group(1).lstrip())   # 선택자 첫 글자의 줄
        yield m.group(1).strip(), m.group(2), css[:start].count("\n") + 1


def main():
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    by_color = defaultdict(list)
    for sel, body, line in rules(css):
        if not LIVE_SEL.search(sel):
            continue
        for c in COLOR.findall(body):
            by_color[c.lower().replace(" ", "")].append((line, sel.split("\n")[-1][:60]))
    out = sys.stdout
    out.write("### style.css 직접 실험 전용 선택자의 하드코딩 색 (%d종)\n\n" % len(by_color))
    out.write("| 색 | 횟수 | 토큰 제안 | 처음 나온 줄·선택자 |\n|---|---|---|---|\n")
    for c, uses in sorted(by_color.items(), key=lambda kv: -len(kv[1])):
        line, sel = uses[0]
        out.write("| `%s` | %d | %s | %d `%s` |\n" % (c, len(uses), SUGGEST.get(c, "직접 판단 (rgba는 위 색의 투명도 변형)"), line,
                                                    sel.replace("|", "\\|")))
    out.write("\n### 직접 실험 탭 JS의 하드코딩 색이 있는 줄\n\n| 파일:줄 | 내용 |\n|---|---|\n")
    for f in ["js/tab-live.js", "js/live-analysis.js", "js/live-setup.js", "js/live-file.js", "js/live-fit.js"]:
        for i, ln in enumerate((ROOT / f).read_text(encoding="utf-8").splitlines(), 1):
            if COLOR.search(ln) or re.search(r"\b0x[0-9a-fA-F]{6}\b", ln) or re.search(r"\b(textColor|gridColor)\b", ln):
                out.write("| `%s:%d` | `%s` |\n" % (f, i, ln.strip()[:110].replace("|", "\\|").replace("`", "'")))


if __name__ == "__main__":
    main()
