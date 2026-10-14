# data/ 출처

| 파일 | 내용 | 출처 / 라이선스 |
|---|---|---|
| `historical_emissions_gtc.csv` | 1750~2024 세계 CO₂ 배출량 (화석연료·산업 `fossil_gtc`, 토지이용 변화 `luc_gtc`, 단위 GtC/yr) | Our World in Data, CO₂ and Greenhouse Gas Emissions (원자료 Global Carbon Project), CC BY 4.0 — https://github.com/owid/co2-data |
| `mlo_annual.csv` | 1959~2025 마우나로아 CO₂ 연평균 (ppm), 엔진 검증용 | NOAA GML (datasets/co2-ppm 경유) |

- 변환: MtCO₂ ÷ 3664 = GtC
- `luc_estimated = 1`인 행(1750~1849)은 원자료에 토지이용 배출이 없어 0.27 GtC에서 1850년 값까지 선형으로 추정한 값
