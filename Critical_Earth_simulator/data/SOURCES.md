# data/ 출처

출처는 이제 **등록부 `js/sources.js`** 한 곳에만 적는다(2차 개편 A5). 이 파일의 예전 내용(OWID 배출, 마우나로아)은 등록부의 `emis_gcp`, `co2_noaa_mlo` 항목으로 옮겼다.

- 사람이 읽는 출처 문서: `docs/데이터출처.md` (`node tools/gen_sources_doc.js` 로 등록부에서 생성)
- 원본 → 정리 CSV → `js/earth-data.js`: `python tools/gen_earth_data.py`
- 정리 CSV 첫 줄 주석에 원본 파일명·버전이 있다
