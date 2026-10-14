# 미니 지구 시뮬레이션 — AI 작업 안내

실제로 쓰는 앱은 **`Critical_Earth_simulator/`** 하나다. 파이썬 서버(FastAPI) + 순수 HTML/JS(three.js, Chart.js)이고 빌드 도구가 없다.
루트의 `app/`·`package.json` 등 Next.js 파일과 루트 `Critical_Earth_simulator.html`은 초기 프로토타입이라 지금 앱과 연결되지 않는다.

## 구조
- `server.py` — USB 시리얼·BLE·WiFi(MQTT/HTTP)로 센서 값을 받아 WebSocket으로 화면에 중계, 보드에 명령 전달, 실험 기록 세션(자동 시작·종료) 관리
- `mqtt_broker.py` — server.py에 내장된 작은 MQTT 브로커 (1883을 Mosquitto가 쓰고 있으면 그쪽에 붙음)
- `select.html` 시작 화면 → `index.html?tab=current|future|live` 조감 3탭 / `firstperson/` 1인칭 탐험
- `js/earth-model.js` — 조감·1인칭이 공유하는 과학 모델(탄산 평형·기온 회귀). 예측식은 여기서만 고친다
- 직접 실험 탭: `js/live-setup.js`(실험 준비: 이름·보드 고르기·실험 설계·회로도·코드 받기·센서 배치), `js/tab-live.js`(연결·보드 패널·그래프), `js/live-analysis.js`(분석·편집), `js/live-fit.js`(통계·회귀), `js/xlsx-lite.js`(엑셀)
- `basic_experiments/<id>/{info.json, code.ino}` — 폴더만 넣으면 서버가 목록을 자동 생성. `std_*`가 원격 제어 표준 코드

## 실행·확인
- `Critical_Earth_simulator/run_server.bat` (또는 `.venv\Scripts\python server.py`) → http://127.0.0.1:8000
- 보드 없이 시험: `.venv\Scripts\python tools\fake_device.py` (가짜 ESP32, MQTT). 값이 `data_log.csv`에 쌓이므로 시험 후 정리
- 우노 스케치 컴파일: Arduino IDE에 들어 있는 `arduino-cli`로 `--fqbn arduino:avr:uno`

## 지켜야 할 것
- **`index.html`에 `<script>`를 추가·삭제하면 `tools/build_single_html.py`의 `AERIAL_JS` 목록도 같은 순서로 맞춘다** (안 맞으면 단일 HTML 빌드가 멈춤)
- **server.py에 새 모듈·폴더를 쓰면 `server.spec`(exe 빌드)에도 넣는다.** 빠진 폴더를 `StaticFiles`로 마운트하면 exe가 시작하자마자 죽는다
- `data_log.csv`, `logs/`, `.venv/`, `build/`, `dist/`는 각자 PC에만 두는 파일이다 (git 제외)
- 두 사람이 작업한다: **yen(yen01-spec)** = 직접 실험 탭·서버·하드웨어, **철민(ChealminE)** = 1인칭 모드·과학 모델·논문 대응.
  작업 기록은 각자 `yen진행상황.md` / `철민진행상황.md`에 남긴다
- 공유 브랜치(`feature/first-person-mode`)에 바로 푸시하지 말고 작업 브랜치를 따서 진행한다
- 주석은 한국어로, "무엇"보다 "왜 이렇게 했는지"를 적는 것이 이 저장소의 스타일이다
