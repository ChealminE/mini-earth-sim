# -*- coding: utf-8 -*-
"""
원본(data/raw) -> 정리 CSV(data/*.csv) -> js/earth-data.js 변환기
========================================================================
왜 두 단계인가
  1) 원본은 기관마다 형식이 다르다(NOAA 주석 머리말, HOT 탭 구분 텍스트, RCMIP 넓은 표).
     사람이 열어 보고 대조할 수 있도록 같은 모양의 정리 CSV를 먼저 만든다.
     정리 CSV 첫 줄 주석에 원본 파일명·버전을 적어, 화면 값이 어느 판에서 왔는지 끝까지 따라갈 수 있게 한다.
  2) 단일 HTML 빌드(dist/MiniEarth.html)는 더블클릭(file://)으로 열리기 때문에
     브라우저가 CSV를 fetch로 읽을 수 없다. 그래서 정리 CSV를 JS 전역 상수로 바꿔 둔다.
     js/earth-data.js 에는 앱이 실제로 쓰는 것만 넣는다(검증 전용 자료는 테스트가 CSV를 직접 읽는다).

원본 파일(data/raw/)은 절대 고치지 않는다. 새 판을 받으면 raw를 바꾸고 이 스크립트를 다시 돌린다.
historical_emissions_gtc.csv 는 raw가 없는 정리 파일이라(OWID에서 변환해 둔 것) 그대로 읽기만 한다.

실행: python tools/gen_earth_data.py
"""

import csv
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = ROOT / "js" / "earth-data.js"

MTCO2_PER_GTC = 3664.0        # CO2 1 Gt = 탄소 12/44 Gt  ->  MtCO2 ÷ 3664 = GtC
HADCRUT_BASE = (1850, 1900)   # 산업화 이전 기준 기간 (IPCC AR6와 같은 정의)
CO2_SPLICE_YEAR = 1979        # 이 해부터 NOAA 지구 평균 관측, 그 전은 CMIP6 재구성
SSP_KEYS = ["ssp119", "ssp126", "ssp245"]
SSP_FIRST, SSP_LAST = 2015, 2200   # 앱이 쓰는 SSP 구간 (RCMIP의 SSP는 2015년부터 갈라진다)
# HadCRUT5 연평균 파일에는 생성 날짜가 없다. 원본을 받은 해(2026-10-23, 커밋 e4d1d5f)의 값은
# 아직 진행 중인 해의 부분 평균이므로 뺀다. 새 판을 받으면 이 값도 받은 해로 바꾼다.
HADCRUT_DOWNLOAD_YEAR = 2026

RCMIP_EMIS = RAW / "rcmip" / "rcmip-emissions-annual-means-v5-1-0.csv"
RCMIP_CONC = RAW / "rcmip" / "rcmip-concentrations-annual-means-v5-1-0.csv"
# 변수 이름은 RCMIP 파일 머리에서 직접 확인한 실제 이름이다(지시서의 기대 이름과 같았다).
VAR_FOSSIL = "Emissions|CO2|MAGICC Fossil and Industrial"
VAR_AFOLU = "Emissions|CO2|MAGICC AFOLU"
VAR_CONC = "Atmospheric Concentrations|CO2"


def fail(msg):
    sys.exit("[실패] " + msg)


def rcmip_version(path):
    m = re.search(r"v(\d+)-(\d+)-(\d+)", path.name)
    return "v%s.%s.%s" % m.groups() if m else fail("RCMIP 파일 이름에서 버전을 찾지 못함: " + path.name)


# ── 정리 CSV 쓰기/읽기 ───────────────────────────────────────────────────────
def write_clean(name, comment_lines, header, rows):
    with open(DATA / name, "w", encoding="utf-8", newline="") as f:
        for c in comment_lines:
            f.write("# " + c + "\n")
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def read_clean(name):
    with open(DATA / name, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def consecutive_years(years, name):
    # 배열 인덱스 = 연도 - startYear 로 쓰므로 빠진 해가 있으면 값이 한 칸씩 밀린다
    for a, b in zip(years, years[1:]):
        if b != a + 1:
            fail("%s: %d 다음 해가 %d 입니다 (연도가 연속이어야 함)" % (name, a, b))


def fmt(v, d):
    return ("%." + str(d) + "f") % v


# ── 1) NOAA GML CO2 연평균 ───────────────────────────────────────────────────
def noaa(raw_name, out_name, label):
    path = RAW / "noaa" / raw_name
    lines = path.read_text(encoding="utf-8").splitlines()
    created = None
    for ln in lines:
        m = re.match(r"#\s*File Creation:\s*(.+)$", ln)
        if m:
            created = m.group(1).strip()
    if not created:
        fail("%s 머리말에 File Creation 줄이 없음" % raw_name)
    # 'Fri Oct  9 13:08:02 2026' - 이 해는 아직 끝나지 않았으므로 그 해 이후 값은 뺀다
    created_year = datetime.strptime(" ".join(created.split()), "%a %b %d %H:%M:%S %Y").year
    body = [ln for ln in lines if ln and not ln.startswith("#")]
    rows = []
    for r in csv.DictReader(body):
        y = int(r["year"])
        if y >= created_year:
            continue
        rows.append([y, r["mean"].strip(), r["unc"].strip()])
    write_clean(out_name, [
        "원본: data/raw/noaa/%s (NOAA GML, %s)" % (raw_name, label),
        "원본 버전: File Creation: %s" % created,
        "완전한 해만: 파일 생성 해(%d) 이후 값 제외. 단위 ppm (건조 공기 몰분율)" % created_year,
    ], ["year", "ppm", "unc"], rows)
    return created, rows


# ── 2) RCMIP: 넓은 표에서 World 행 골라내기 ──────────────────────────────────
def rcmip_rows(path, want):
    """want: {(scenario, variable): None}. 맞는 행의 {연도: 값}과 단위를 채워 돌려준다."""
    found = {}
    with open(path, encoding="utf-8", newline="") as f:
        rd = csv.reader(f)
        head = next(rd)
        idx = {h: i for i, h in enumerate(head)}
        for need in ("Scenario", "Region", "Variable", "Unit"):
            if need not in idx:
                fail("%s 머리에 %s 열이 없음" % (path.name, need))
        ycols = [(int(h), i) for i, h in enumerate(head) if h.isdigit()]
        for row in rd:
            key = (row[idx["Scenario"]], row[idx["Variable"]])
            if row[idx["Region"]] != "World" or key not in want:
                continue
            if key in found:
                fail("%s: %s 행이 둘 이상" % (path.name, key))
            series = {y: float(row[i]) for y, i in ycols if row[i] != ""}
            found[key] = (series, row[idx["Unit"]])
    missing = [k for k in want if k not in found]
    if missing:
        fail("%s 에 없는 행: %s" % (path.name, missing))
    return found


def interp(series, y):
    # SSP는 2015, 2020, 2030 … 2100, 이후 10년 간격이다. 사이 해는 선형 보간한다.
    if y in series:
        return series[y]
    xs = sorted(series)
    for a, b in zip(xs, xs[1:]):
        if a < y < b:
            return series[a] + (series[b] - series[a]) * (y - a) / (b - a)
    fail("보간 범위 밖: %d" % y)


def rcmip(ver):
    conc = rcmip_rows(RCMIP_CONC, {(s, VAR_CONC): None for s in ["historical"] + SSP_KEYS})
    emis = rcmip_rows(RCMIP_EMIS, {(s, v): None for s in SSP_KEYS for v in (VAR_FOSSIL, VAR_AFOLU)})
    for (s, v), (_, unit) in conc.items():
        if unit != "ppm":
            fail("농도 단위가 ppm이 아님: %s %s" % (s, unit))
    for (s, v), (_, unit) in emis.items():
        if unit != "Mt CO2/yr":
            fail("배출 단위가 Mt CO2/yr가 아님: %s %s %s" % (s, v, unit))

    hist = conc[("historical", VAR_CONC)][0]
    write_clean("co2_cmip6_hist.csv", [
        "원본: data/raw/rcmip/%s (RCMIP %s)" % (RCMIP_CONC.name, ver),
        "행: Scenario=historical, Region=World, Variable=%s, 단위 ppm" % VAR_CONC,
        "CMIP6 역사 농도(Meinshausen et al. 2017)의 연평균. 1750~2014",
    ], ["year", "ppm"], [[y, fmt(hist[y], 3)] for y in range(1750, 2015)])

    rows = []
    for y in range(SSP_FIRST, SSP_LAST + 1):
        r = [y]
        for s in SSP_KEYS:
            r.append(fmt(interp(emis[(s, VAR_FOSSIL)][0], y) / MTCO2_PER_GTC, 4))
            r.append(fmt(interp(emis[(s, VAR_AFOLU)][0], y) / MTCO2_PER_GTC, 4))
        rows.append(r)
    pts = sorted(y for y in emis[("ssp245", VAR_FOSSIL)][0] if y >= SSP_FIRST)
    write_clean("ssp_emissions.csv", [
        "원본: data/raw/rcmip/%s (RCMIP %s)" % (RCMIP_EMIS.name, ver),
        "행: Region=World, Variable=%s(fossil) / %s(luc), 단위 Mt CO2/yr -> ÷%g = GtC/yr"
        % (VAR_FOSSIL, VAR_AFOLU, MTCO2_PER_GTC),
        "원자료 시점: %s → 사이 해는 선형 보간. 2100년 이후는 원자료의 연장 경로(extension) 그대로"
        % ",".join(str(p) for p in pts[:4] + ["…"] + pts[-3:]),
        "조화(2023년 GCP 값에 잇기)는 하지 않은 원값이다. 조화는 js/earth-system.js 가 한다",
    ], ["year"] + ["%s_%s" % (s, k) for s in SSP_KEYS for k in ("fossil", "luc")], rows)

    rows = []
    for y in range(SSP_FIRST, SSP_LAST + 1):
        rows.append([y] + [fmt(conc[(s, VAR_CONC)][0][y], 3) for s in SSP_KEYS])
    write_clean("ssp_concentrations.csv", [
        "원본: data/raw/rcmip/%s (RCMIP %s)" % (RCMIP_CONC.name, ver),
        "행: Region=World, Variable=%s, 단위 ppm. 엔진 결과 비교(검증) 전용 - 앱에는 넣지 않는다" % VAR_CONC,
    ], ["year"] + SSP_KEYS, rows)
    return pts


# ── 3) HadCRUT5 ──────────────────────────────────────────────────────────────
def hadcrut():
    files = sorted((RAW / "hadcrut").glob("HadCRUT.5.*.analysis.summary_series.global.annual.csv"))
    if len(files) != 1:
        fail("HadCRUT5 연평균 원본이 정확히 하나여야 함: %s" % [f.name for f in files])
    path = files[0]
    ver = re.match(r"HadCRUT\.(5(?:\.\d+)+)\.analysis", path.name).group(1)
    with open(path, encoding="utf-8", newline="") as f:
        rd = csv.reader(f)
        head = next(rd)
        if head[0] != "Time" or not head[1].startswith("Anomaly"):
            fail("HadCRUT5 머리가 예상과 다름: %s" % head)
        raw = [(int(r[0]), float(r[1]), float(r[2]), float(r[3])) for r in rd if r]
    base = [a for y, a, _, _ in raw if HADCRUT_BASE[0] <= y <= HADCRUT_BASE[1]]
    if len(base) != HADCRUT_BASE[1] - HADCRUT_BASE[0] + 1:
        fail("HadCRUT5 기준 기간 자료가 모자람")
    off = sum(base) / len(base)
    rows = [[y, fmt(a - off, 4), fmt(lo - off, 4), fmt(hi - off, 4)]
            for y, a, lo, hi in raw if y < HADCRUT_DOWNLOAD_YEAR]
    write_clean("temp_hadcrut5_annual.csv", [
        "원본: data/raw/hadcrut/%s (Met Office Hadley Centre / CRU, HadCRUT %s)" % (path.name, ver),
        "원본 기준 1961~1990 -> 1850~1900 평균(%.4f °C)을 빼서 산업화 이전 기준으로 변환" % off,
        "lo/hi = 원본의 2.5%% / 97.5%% 신뢰 한계에 같은 값을 뺀 것. %d년(받은 해, 진행 중) 제외" % HADCRUT_DOWNLOAD_YEAR,
    ], ["year", "anom", "lo", "hi"], rows)
    return ver, off, rows


# ── 3b) HadSST4 ──────────────────────────────────────────────────────────────
def hadsst():
    files = sorted((RAW / "hadsst").glob("HadSST.4.*_annual_GLOBE.csv"))
    if len(files) != 1:
        fail("HadSST4 연평균 원본이 정확히 하나여야 함: %s" % [f.name for f in files])
    path = files[0]
    ver = re.match(r"HadSST\.(4(?:\.\d+)+)_annual", path.name).group(1)
    with open(path, encoding="utf-8", newline="") as f:
        rd = csv.reader(f)
        head = next(rd)
        # 머리줄(4.2.0.0): year,anomaly,total_uncertainty,...,lower/upper_bound_95pct_bias_uncertainty_range
        # 95 % 열은 '편향(bias) 불확실성만'의 범위라 전체 불확실성 띠로 쓰면 띠가 실제보다 좁아 보인다.
        # total_uncertainty 가 1σ인지 원본 안내서로 확인하지 못했으므로 띠는 그리지 않고 편차만 쓴다.
        if "year" not in head or "anomaly" not in head:
            fail("HadSST4 머리가 예상과 다름: %s" % head)
        iy, ia = head.index("year"), head.index("anomaly")
        raw = [(int(r[iy]), float(r[ia])) for r in rd if r]
    base = [a for y, a in raw if HADCRUT_BASE[0] <= y <= HADCRUT_BASE[1]]
    if len(base) != HADCRUT_BASE[1] - HADCRUT_BASE[0] + 1:
        fail("HadSST4 기준 기간 자료가 모자람")
    off = sum(base) / len(base)
    rows = [[y, fmt(a - off, 4)] for y, a in raw if y < HADCRUT_DOWNLOAD_YEAR]
    write_clean("sst_hadsst4_annual.csv", [
        "원본: data/raw/hadsst/%s (Met Office Hadley Centre, HadSST %s)" % (path.name, ver),
        "원본 기준 1961~1990 -> 1850~1900 평균(%.4f °C)을 빼서 산업화 이전 기준으로 변환 (HadCRUT5와 같은 방법)" % off,
        "anom = 전 지구 표층 해수온 편차. 화면은 EarthSystem.PARAMS.sst0 + anom 으로 그린다. %d년(받은 해) 제외" % HADCRUT_DOWNLOAD_YEAR,
    ], ["year", "anom"], rows)
    return ver, off, rows


# ── 4) HOT Station ALOHA ─────────────────────────────────────────────────────
def hot():
    path = RAW / "hot" / "HOT_surface_CO2.txt"
    lines = path.read_text(encoding="latin-1").splitlines()
    updated = next((ln.strip().strip("\t") for ln in lines if ln.startswith("Last updated")), None)
    if not updated:
        fail("HOT 원본에 'Last updated' 줄이 없음")
    hi = next(i for i, ln in enumerate(lines) if ln.startswith("cruise\t"))
    head = lines[hi].split("\t")
    for need in ("date", "temp", "sal", "TA", "pHcalc_insitu"):
        if need not in head:
            fail("HOT 원본에 %s 열이 없음" % need)
    by = {}
    for ln in lines[hi + 1:]:
        cells = ln.split("\t")
        if not cells[0].strip():
            continue
        r = dict(zip(head, cells))
        d = datetime.strptime(r["date"].strip(), "%d-%b-%y")
        by.setdefault(d.year, []).append((d.month, r))

    def mean_of(items, col):
        v = [float(r[col]) for _, r in items if r[col].strip() and float(r[col]) != -999]
        return (sum(v) / len(v), len(v)) if v else (None, 0)

    ph_rows, ta_rows = [], []
    for y in sorted(by):
        items = by[y]
        # 상반기·하반기 모두 측정이 있어야 연평균으로 본다. 1988년은 10~12월 2회뿐이라(관측 시작 해)
        # 계절이 한쪽으로 치우친 평균이 된다.
        if not (any(m <= 6 for m, _ in items) and any(m >= 7 for m, _ in items)):
            continue
        ph, n = mean_of(items, "pHcalc_insitu")
        t, _ = mean_of(items, "temp")
        if ph is not None:
            ph_rows.append([y, fmt(ph, 4), n, fmt(t, 2)])
        ta, nt = mean_of(items, "TA")
        s, _ = mean_of(items, "sal")
        if ta is not None:
            ta_rows.append([y, fmt(ta, 1), fmt(s, 3), nt])
    cite_note = "readme가 지정한 인용: Dore et al. 2009, PNAS 106:12235-12240"
    write_clean("ph_hot_annual.csv", [
        "원본: data/raw/hot/HOT_surface_CO2.txt (Hawaii Ocean Time-series, Station ALOHA 22°45'N 158°00'W)",
        "원본 버전: %s" % updated,
        "ph = pHcalc_insitu(DIC·TA로 계산, 현장 수온, total scale)의 항해별 표층(0~30 dbar) 평균을 해마다 평균",
        "n = 그 해 항해 수, temp_c = 같은 항해들의 현장 수온 평균. 상·하반기 측정이 모두 있는 해만. " + cite_note,
    ], ["year", "ph", "n", "temp_c"], ph_rows)
    write_clean("ta_hot.csv", [
        "원본: data/raw/hot/HOT_surface_CO2.txt (Station ALOHA), 원본 버전: %s" % updated,
        "ta = 총알칼리도 TA [µeq/kg], sal = 염분 [PSU], 항해별 표층 평균의 연평균. 엔진 상수(OCEAN_TA, S) 근거용",
    ], ["year", "ta", "sal", "n"], ta_rows)
    return updated, ph_rows, ta_rows


# ── 5) js/earth-data.js ──────────────────────────────────────────────────────
def arr(vals):
    return "[" + ",".join("null" if v in ("", None) else str(v) for v in vals) + "]"


def check_num(v):
    float(v)          # CSV 표기 그대로 옮기되 숫자인지만 확인한다 (1.0 -> 1 처럼 바꾸지 않게)
    return v


def build_js(versions):
    em = read_clean("historical_emissions_gtc.csv")
    em_years = [int(r["year"]) for r in em]
    consecutive_years(em_years, "historical_emissions_gtc.csv")

    gl = read_clean("co2_noaa_gl_annual.csv")
    gl_years = [int(r["year"]) for r in gl]
    consecutive_years(gl_years, "co2_noaa_gl_annual.csv")
    if gl_years[0] != CO2_SPLICE_YEAR:
        fail("NOAA 지구 평균이 %d년에 시작하지 않음 (이음매 연도와 다름)" % CO2_SPLICE_YEAR)

    cm = [r for r in read_clean("co2_cmip6_hist.csv") if int(r["year"]) < CO2_SPLICE_YEAR]
    consecutive_years([int(r["year"]) for r in cm], "co2_cmip6_hist.csv")

    hc = read_clean("temp_hadcrut5_annual.csv")
    hc_years = [int(r["year"]) for r in hc]
    consecutive_years(hc_years, "temp_hadcrut5_annual.csv")

    hs = read_clean("sst_hadsst4_annual.csv")
    hs_years = [int(r["year"]) for r in hs]
    consecutive_years(hs_years, "sst_hadsst4_annual.csv")

    ph = read_clean("ph_hot_annual.csv")
    ph_years = [int(r["year"]) for r in ph]
    consecutive_years(ph_years, "ph_hot_annual.csv")

    ssp = read_clean("ssp_emissions.csv")
    ssp_years = [int(r["year"]) for r in ssp]
    consecutive_years(ssp_years, "ssp_emissions.csv")
    ssp_js = "".join(
        "    %s: { fossil: %s, luc: %s },\n" % (
            s, arr(check_num(r[s + "_fossil"]) for r in ssp), arr(check_num(r[s + "_luc"]) for r in ssp))
        for s in SSP_KEYS)

    js = (
        "// ============================================================================\n"
        "// 자동 생성 파일 - 직접 고치지 말 것.\n"
        "// 원본: data/raw/* -> data/*.csv (출처: js/sources.js 등록부)\n"
        "// 다시 만들기: python tools/gen_earth_data.py\n"
        "// ----------------------------------------------------------------------------\n"
        "// 배열 인덱스 = 연도 - startYear\n"
        "// emissions: 세계 CO2 배출량 [GtC/yr] (GCP via OWID)\n"
        "//   fossil = 화석연료·산업, luc = 토지이용 변화,\n"
        "//   lucEstimated = 1이면 원자료에 없어 선형으로 추정한 해 (1750~1849)\n"
        "// co2Noaa: NOAA GML 지구 평균 CO2 [ppm], unc = 불확도  (%s)\n"
        "// co2Cmip6: CMIP6 역사 농도 [ppm], NOAA가 시작하는 %d년 앞까지만 (RCMIP %s)\n"
        "// tempHadcrut: HadCRUT %s 기온 편차 [°C], 1850~1900 기준으로 변환, lo/hi = 95%% 범위\n"
        "// sstHadsst: HadSST %s 표층 해수온 편차 [°C], 1850~1900 기준으로 변환 (그래프는 sst0 + anom)\n"
        "// phHot: HOT Station ALOHA 표층 pH 연평균 (pHcalc_insitu, total scale)  (%s)\n"
        "// ssp: RCMIP SSP 배출 [GtC/yr], 조화 전 원값, 연 단위로 보간 (RCMIP %s)\n"
        "// ============================================================================\n"
        "const EARTH_DATA = {\n"
        "  emissions: {\n"
        "    startYear: %d,\n"
        "    fossil: %s,\n"
        "    luc: %s,\n"
        "    lucEstimated: %s,\n"
        "  },\n"
        "  co2Noaa: { startYear: %d, ppm: %s, unc: %s },\n"
        "  co2Cmip6: { startYear: %d, ppm: %s },\n"
        "  tempHadcrut: { startYear: %d, anom: %s, lo: %s, hi: %s },\n"
        "  sstHadsst: { startYear: %d, anom: %s },\n"
        "  phHot: { startYear: %d, ph: %s },\n"
        "  ssp: {\n"
        "    startYear: %d,\n"
        "%s"
        "  },\n"
        "};\n"
    ) % (
        versions["noaa_gl"], CO2_SPLICE_YEAR, versions["rcmip"], versions["hadcrut"], versions["hadsst"], versions["hot"],
        versions["rcmip"],
        em_years[0],
        arr(check_num(r["fossil_gtc"]) for r in em),
        arr(check_num(r["luc_gtc"]) for r in em),
        arr(check_num(r["luc_estimated"]) for r in em),
        gl_years[0], arr(check_num(r["ppm"]) for r in gl), arr(check_num(r["unc"]) for r in gl),
        int(cm[0]["year"]), arr(check_num(r["ppm"]) for r in cm),
        hc_years[0], arr(check_num(r["anom"]) for r in hc), arr(check_num(r["lo"]) for r in hc),
        arr(check_num(r["hi"]) for r in hc),
        hs_years[0], arr(check_num(r["anom"]) for r in hs),
        ph_years[0], arr(check_num(r["ph"]) for r in ph),
        ssp_years[0], ssp_js,
    )
    OUT.write_text(js, encoding="utf-8")
    return dict(em=(em_years[0], em_years[-1]), gl=(gl_years[0], gl_years[-1]), cm=(int(cm[0]["year"]), int(cm[-1]["year"])),
                hc=(hc_years[0], hc_years[-1]), hs=(hs_years[0], hs_years[-1]), ph=(ph_years[0], ph_years[-1]), ssp=(ssp_years[0], ssp_years[-1]))


def main():
    gl_ver, _ = noaa("co2_annmean_gl.csv", "co2_noaa_gl_annual.csv", "Globally averaged marine surface annual mean")
    mlo_ver, _ = noaa("co2_annmean_mlo.csv", "co2_noaa_mlo_annual.csv", "Mauna Loa annual mean")
    ver = rcmip_version(RCMIP_EMIS)
    if rcmip_version(RCMIP_CONC) != ver:
        fail("RCMIP 배출·농도 파일 버전이 다름")
    pts = rcmip(ver)
    hc_ver, hc_off, _ = hadcrut()
    hs_ver, hs_off, _ = hadsst()
    hot_ver, ph_rows, ta_rows = hot()
    rng = build_js({"noaa_gl": "File Creation: " + gl_ver, "rcmip": ver, "hadcrut": hc_ver, "hadsst": hs_ver, "hot": hot_ver})
    print("[완료] 정리 CSV 9개 + %s" % OUT.relative_to(ROOT))
    print("  NOAA 지구 평균 %d~%d (%s), MLO (%s)" % (rng["gl"] + (gl_ver, mlo_ver)))
    print("  CMIP6 역사 농도 앱용 %d~%d, RCMIP %s, SSP 원자료 시점 %d~%d" % (rng["cm"] + (ver, pts[0], pts[-1])))
    print("  HadCRUT %s %d~%d, 1850~1900 평균 %.4f °C 를 뺌" % ((hc_ver,) + rng["hc"] + (hc_off,)))
    print("  HadSST %s %d~%d, 1850~1900 평균 %.4f °C 를 뺌" % ((hs_ver,) + rng["hs"] + (hs_off,)))
    print("  HOT pH %d~%d (%s), TA %d개 해" % (rng["ph"] + (hot_ver, len(ta_rows))))
    print("  배출 %d~%d, SSP %d~%d" % (rng["em"] + rng["ssp"]))


if __name__ == "__main__":
    main()
