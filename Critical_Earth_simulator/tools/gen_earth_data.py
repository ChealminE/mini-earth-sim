# -*- coding: utf-8 -*-
"""
data/*.csv -> js/earth-data.js 변환기
========================================================================
왜 필요한가
  단일 HTML 빌드(dist/MiniEarth.html)는 더블클릭(file://)으로 열리기 때문에
  브라우저가 CSV를 fetch로 읽을 수 없다. 그래서 CSV를 JS 전역 상수로 미리 바꿔 둔다.
  CSV가 원본이다. 데이터를 고칠 일이 생기면 CSV를 고치고 이 스크립트를 다시 돌린다.

실행: python tools/gen_earth_data.py
"""

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "js" / "earth-data.js"


def read_rows(name):
    with open(DATA / name, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def consecutive_years(years, name):
    # 배열 인덱스 = 연도 - startYear 로 쓰므로 빠진 해가 있으면 값이 한 칸씩 밀린다
    for a, b in zip(years, years[1:]):
        if b != a + 1:
            sys.exit("[실패] %s: %d 다음 해가 %d 입니다 (연도가 연속이어야 함)" % (name, a, b))


def num(s):
    # CSV 표기 그대로 옮긴다 (1.0 -> 1 처럼 바꾸지 않게 float 대신 원문 유지 후 검증만)
    float(s)
    return s


def main():
    em = read_rows("historical_emissions_gtc.csv")
    em_years = [int(r["year"]) for r in em]
    consecutive_years(em_years, "historical_emissions_gtc.csv")

    mlo = read_rows("mlo_annual.csv")
    mlo_years = [int(r["Year"]) for r in mlo]
    consecutive_years(mlo_years, "mlo_annual.csv")

    def arr(vals):
        return "[" + ",".join(num(v) for v in vals) + "]"

    js = (
        "// ============================================================================\n"
        "// 자동 생성 파일 - 직접 고치지 말 것.\n"
        "// 원본: data/*.csv  (출처: data/SOURCES.md)\n"
        "// 다시 만들기: python tools/gen_earth_data.py\n"
        "// ----------------------------------------------------------------------------\n"
        "// emissions: 세계 CO2 배출량 [GtC/yr], 배열 인덱스 = 연도 - startYear\n"
        "//   fossil = 화석연료·산업, luc = 토지이용 변화,\n"
        "//   lucEstimated = 1이면 원자료에 없어 선형으로 추정한 해 (1750~1849)\n"
        "// mlo: 마우나로아 CO2 연평균 [ppm] (엔진 검증·관측점 표시용)\n"
        "// ============================================================================\n"
        "const EARTH_DATA = {\n"
        "  emissions: {\n"
        "    startYear: %d,\n"
        "    fossil: %s,\n"
        "    luc: %s,\n"
        "    lucEstimated: %s,\n"
        "  },\n"
        "  mlo: {\n"
        "    startYear: %d,\n"
        "    ppm: %s,\n"
        "  },\n"
        "};\n"
    ) % (
        em_years[0],
        arr(r["fossil_gtc"] for r in em),
        arr(r["luc_gtc"] for r in em),
        arr(r["luc_estimated"] for r in em),
        mlo_years[0],
        arr(r["Mean"] for r in mlo),
    )
    OUT.write_text(js, encoding="utf-8")
    print("[완료] %s  (배출 %d~%d, MLO %d~%d)" % (OUT.relative_to(ROOT), em_years[0], em_years[-1],
                                                mlo_years[0], mlo_years[-1]))


if __name__ == "__main__":
    main()
