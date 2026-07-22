# 미니지구 시뮬레이션 (mini-earth-sim)

아크릴 상자(해양·습지·도시) 모형에 아두이노/ESP32 센서를 연동하고, 실측·시나리오 데이터를 3D 미니 지구와 실시간 그래프로 시각화하는 프로젝트입니다.

## 구성

- **`Critical_Earth_simulator.html`** — Three.js 기반 3D 시뮬레이터. SSP 기후 시나리오 예측 그래프, 복사강제력 물리식(ΔF=5.35·ln(C/280)) 반영, 파도·연기·응결·빙하 파티클 애니메이션 포함.
- **`app/`** — 위 시뮬레이터를 Next.js 대시보드 형태로 재구성한 웹앱 (`app/page.tsx`).
- **`extract_nc.py`** — SSP 시나리오별 기후 모델 `.nc` 파일에서 대한민국 격자를 추출해 연도별 CSV(기온·강수량·CO₂ 농도)로 변환하는 스크립트.
- **`mini_earth_plan.md`** — 아크릴 상자 + 아두이노 센서 + ESP32 실측값을 시뮬레이터에 연동하기 위한 구현 계획서 (데이터 흐름, 입력 소스 추상화 설계 등).
- **`sync.bat`** — 변경사항을 GitHub에 올리는 동기화 스크립트 (더블클릭 실행).

## 개발 환경 실행 (Next.js 대시보드)

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) 에서 확인.
