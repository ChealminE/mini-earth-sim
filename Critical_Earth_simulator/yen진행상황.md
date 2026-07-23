# 미니 지구 모델 — 진행상황 체크리스트 & 작업 로그

> 사용법: 작업 시작 전에 아래 체크리스트를 먼저 확인하고, 작업이 끝나면 맨 아래 "작업 로그"에 새 항목을 추가해서 쌓아갑니다.

---

## ✅ 진행상황 체크리스트

### 1. 통신 구조 / 데이터 형식
- [x] WiFi(ESP32) + USB(우노) 겸용 서버 구조 설계
- [x] JSON 자유 형식 규격 확정 (키 이름 자유, 필수 키 없음)
- [x] 잘못된 형식(파싱 실패) 시 서버가 무시하고 계속 동작하도록 처리

### 2. 서버 (server.py)
- [x] WiFi POST(`/data`) 수신 엔드포인트
- [x] USB 시리얼 자동 포트 탐지 + 수신 스레드
- [x] CSV 로깅 (필드 자동 확장)
- [x] WebSocket 브로드캐스트
- [x] 실행 자동화 배치파일(`.bat`) 작성 (`run_server.bat`)
- [x] 서버 구동 시 브라우저 자동 오픈 (`webbrowser.open`, `--no-browser`로 끌 수 있음)
- [x] 최초 설치용 배치파일(가상환경 생성 + `pip install`) (`setup.bat`)
- [x] requirements.txt 버전 오류 수정 (fastapi/uvicorn/websockets 실제 존재 버전으로) — .venv에 정상 설치 확인됨, 추가 수정 불필요
- [x] `setup.bat` 완료 시 바탕화면에 실행 바로가기 자동 생성 (매번 폴더 찾아 들어갈 필요 없이 아이콘 더블클릭만 하면 되게) — 이후 PyInstaller exe 방식으로 대체, 아래 참고
- [x] 학생 배포용 실행 가이드 작성 (`Critical_Earth_simulator/README.md`) — exe 다운로드 방식으로 갱신, SmartScreen/방화벽 경고 대처법 포함
- [x] **파이썬 설치 자체를 없애는 단일 실행파일(exe) 패키징** — PyInstaller로 `server.py`+파이썬 인터프리터+라이브러리+웹 리소스(index.html/js/texture_image/basic_experiments)를 `MiniEarthModel.exe` 하나로 빌드. `server.spec`(빌드 설정) + `build_exe.bat`(빌드 실행) 작성. 실제 빌드해서 index/js/textures/basic_experiments 서빙, POST /data, CSV 로깅(exe 옆에 정상 기록)까지 동작 확인함. requirements.txt에 있던 `bleak`가 실제로는 venv에 설치가 안 되어 있던 걸 이번에 발견/설치함(있어야 BLE 관련 hidden import가 정상 처리됨)

### 3. 프론트엔드 (tab-live.js / index.html)
- [x] 센서 키 자동 인식 (하드코딩 없이 동적 처리)
- [x] 센서 카드 그리드 표시
- [x] 다중 그래프 (최대 4개, X/Y축 독립 선택)
- [x] CO2 센서 → 3D 아크릴 효과 연동 (`sensorEffectMap` 구조)
- [x] 실험 시작/종료 버튼 + JSON 형식 안내 모달 (실험 시작 시마다 표시, "이번 실험에서 다시 보지 않기" 옵션은 실험 종료 시 초기화)
- [x] WebSocket 연결 상태 표시 + 자동 재연결 (실험 종료 시 재연결 안 함)
- [x] 온도 센서 → 3D 효과 매핑 추가 (동료가 원격에서 병합, 빙하 축소)
- [x] pH 센서 → 3D 효과 매핑 추가 (동료가 원격에서 병합, 해양 산성화/물색)
- [x] 습도 센서 → 3D 효과 매핑 추가 (동료가 원격에서 병합, 응결 물방울)
- [x] 메탄 센서 → 3D 효과 매핑 추가 (수조 바닥에서 올라오는 기포 파티클, `common.js`의 `applyState()`/`animate()`에 로직 추가)
- [x] "기본 실험" 목록/상세 모달 (보드·연결방식별 실험 설명 + 코드 미리보기/다운로드/복사) — `basic_experiments/` 폴더 구조로 관리, 콘텐츠는 GitHub/VSCode에서 폴더 하나에 `info.json`/`code.ino`/`circuit.png` 3개만 추가하면 확장 가능
- [ ] 각 기본 실험의 회로도(`circuit.png`) 이미지 추가 (현재는 없으면 "회로도 준비중" 플레이스홀더로 대체됨)
- [x] 학생 노트북에 서버/파이썬 설치를 원클릭에 가깝게 하는 패키징 — exe 하나로 완료(위 항목). "화면 열람 분리(정적 호스팅)"는 여전히 별개 문제로 동료 논의 대기 중(아래 "💬 논의 중" 참고), exe 방식과는 무관하게 진행됨
- [x] `MiniEarthModel.exe`를 GitHub Releases에 업로드 (`v1.0.0-exe`, `gh` CLI로 진행 — 설치부터 브라우저 기기 인증까지 본인 승인받아서 처리) — README에 `releases/latest` 다운로드 링크 반영
- [ ] `basic_experiments/`와 `firmware/`의 코드 중복 정리 — 맨 아래 "💬 논의 중" 섹션 참고, 미결정

### 4. Three.js 버전 대응
- [x] r128 → r160 업그레이드 반영
- [x] `outputEncoding`/`sRGBEncoding` → `outputColorSpace`/`SRGBColorSpace` 수정 (renderer) — 코드 확인 결과 이미 반영되어 있었음
- [x] `tex.encoding` → `tex.colorSpace` 수정 (createGroundTexture 내 텍스처) — 코드 확인 결과 이미 반영되어 있었음
- [ ] 색감 변화(Color Management) 육안 확인 및 필요 시 미세 조정

### 5. 하드웨어 통신 확장
- [x] ESP32-S3 네이티브 BLE / 우노+HM-10 방식 결정 (GATT, 둘 다 0xFFE0/0xFFE1 UUID 공유)
- [x] `esp32_ble_sketch.ino` / `uno_hm10_sketch.ino` 펌웨어 작성
- [x] `server.py`에 `bleak` 기반 BLE 리더 추가 (`--ble`, `--ble-name`, `--ble-address`)
- [ ] 실제 하드웨어(ESP32/우노+HM-10)로 연결 테스트 (하드웨어 준비되면 진행)

### 6. 문서화
- [x] "실시간 실험" 탭 기능명세서 작성
- [x] 진행상황 체크리스트 & 작업 로그 체계 수립 (본 문서)
- [x] 학생 배포용 실행 가이드(README) 작성 (`Critical_Earth_simulator/README.md`)

---

## 📝 작업 로그

### 2026-07-23
**완료한 작업:**
- `index.html`에 "실시간 실험" 탭 진입 시 JSON 형식 안내 모달 추가 (모달 HTML/CSS + `tab-live.js`의 열기/닫기 로직 + `main.js`의 탭 전환 시 호출)
- `tab-live.js`의 CO2 하드코딩 로직을 `sensorEffectMap` 구조로 리팩토링 (향후 센서별 3D 효과 확장 가능하도록)
- `index.html` 파일이 실수로 `tab-live.js` 내용으로 덮어써진 문제 발견 및 정상 버전으로 복구 안내
- Three.js r128 → r160 업그레이드에 따른 필수 수정 사항 확인 (`outputEncoding`, `tex.encoding` 관련 2곳 — 아직 코드 미반영, 다음 작업 시 처리 필요)
- ESP32-S3 + HM-10 조합은 Classic BT가 아닌 BLE임을 확인, GATT 기반 연동 방안 검토 (0xFFE0/0xFFE1 UUID 재사용 아이디어)
- 지능형과학실ON류 플랫폼의 "설치 없이 브라우저 연동" 원리가 Web Bluetooth API 기반임을 확인, 현재 프로젝트(WiFi/USB) 구조와의 차이점 정리
- 실행 자동화(배치파일 + 브라우저 자동 오픈) 개념 설계 완료, 구현은 다음 세션으로 이월
- "실시간 실험" 탭 기능명세서 작성
- (Claude Code 세션) `esp32_ble_sketch.ino`(ESP32 네이티브 BLE) / `uno_hm10_sketch.ino`(우노+HM-10) 펌웨어 작성, 둘 다 0xFFE0/0xFFE1 UUID 공유
- (Claude Code 세션) `server.py`에 `bleak` 기반 BLE 리더(`ble_reader_task`) 추가, `--ble`/`--ble-name`/`--ble-address` 옵션
- (Claude Code 세션) "실시간 실험" 탭에 실험 시작/종료 버튼 추가 — 안내 모달을 localStorage 영구 저장 대신 "이번 실험 동안만" 메모리 플래그로 변경, 실험 종료 후 재시작하면 다시 뜨도록 수정. 소켓 연결도 페이지 로드 시 자동이 아니라 실험 시작 버튼에 종속되도록 변경
- (Claude Code 세션) `setup.bat`(최초 설치: venv 생성 + pip install), `run_server.bat`(실행) 작성, `server.py`에 `webbrowser.open` 자동 오픈 추가 (`--no-browser`로 끌 수 있음)
- (Claude Code 세션) requirements.txt 버전이 .venv에 정상 설치되는 것 확인 (별도 수정 불필요)

**다음에 할 일:**
- 실제 ESP32/우노+HM-10 하드웨어로 BLE 연결 테스트
- 학생 배포용 실행 가이드(README) 작성
- 색감 변화(Color Management) 육안 확인 및 필요 시 미세 조정

---

### 2026-07-23 (2)
**완료한 작업:**
- (Claude Code 세션) 메탄 센서 → 3D 기포 효과 구현: `common.js`에 기포 파티클 시스템(`bubbleGeo`/`bubbleMat`, 45개) 추가, `oceanGroup` 바닥에서 수면 근처까지 올라오다 리셋되는 애니메이션, `CH4_MIN`/`CH4_MAX`(200~4000ppm) 범위로 실측값 정규화해 농도가 높을수록 기포 밀도·속도 증가
- (Claude Code 세션) `tab-live.js`의 `sensorEffectMap`에 `methane`/`ch4` 키 매핑 활성화 (두 이름 다 인식)
- (Claude Code 세션) 실시간 실험 탭 안내 모달에 ph/temp/hum/methane 키워드 안내 추가 (기존엔 co2만 문서화되어 있었음)
- Three.js r160 관련 항목 코드 확인 결과 이미 `outputColorSpace`/`tex.colorSpace`로 반영되어 있음을 확인, 체크리스트만 갱신

**다음에 할 일:**
- 실제 ESP32/우노+HM-10 하드웨어로 BLE 연결 테스트
- 학생 배포용 실행 가이드(README) 작성
- 색감 변화(Color Management) 육안 확인 및 필요 시 미세 조정
- 기본 실험 회로도(`circuit.png`) 4종 추가

---

### 2026-07-23 (3)
**완료한 작업 (Claude Code 세션, 실시간 실험 탭 범위):**
- "기본 실험" 기능 신규 구현: 학생이 처음 접속했을 때 기본 제공 실험(보드/연결방식별)의 설명·회로도·코드를 보고 다운로드할 수 있는 목록/상세 모달
- 콘텐츠 구조를 `basic_experiments/<실험id>/{info.json, code.ino, circuit.png}` 폴더 단위로 설계 — GitHub/VSCode에서 폴더 하나 추가하는 것만으로 새 실험 등록 가능 (`index.json`에 한 줄 추가 필요)
- 초기 4개 실험은 `firmware/` 폴더에 이미 있던 4개 스케치(esp32_wifi/esp32_ble/uno_usb/uno_hm10_ble)를 그대로 코드 다운로드 콘텐츠로 사용
- `server.py`에 `/basic_experiments` 정적 마운트 한 줄 추가 (다른 서버 로직은 안 건드림)
- 코드 다운로드 UX: `.ino` 파일 다운로드 버튼(주 동선, 더블클릭하면 Arduino IDE가 바로 열림) + 모달 내 코드 미리보기/복사 버튼(보조 동선) 둘 다 제공
- 회로도 이미지가 아직 없는 실험은 깨진 이미지 대신 "회로도 준비중" 플레이스홀더 표시 (`onerror` 처리)

**다음에 할 일:**
- 기본 실험 4종 회로도(`circuit.png`) 추가 (본인 담당)
- 설치 자동화(서버 패키징) 설계/구현 — **동료와 "화면 열람 분리" 논의 후 착수** (아래 "💬 논의 중" 참고)
- 실제 ESP32/우노+HM-10 하드웨어로 BLE 연결 테스트
- 학생 배포용 실행 가이드(README) 작성
- 색감 변화(Color Management) 육안 확인 및 필요 시 미세 조정

---

### 2026-07-23 (4)
**완료한 작업 (Claude Code 세션, 코드 변경 없음 — 논의/문서만):**
- `basic_experiments/`와 `firmware/` 코드 중복 문제 확인 (지금은 파일 복사본이라 나중에 `firmware/` 수정 시 어긋날 수 있음) — 해결 방안은 논의했지만 미착수, 아래 "💬 논의 중" 참고
- 설치 자동화 착수하려다 "학생이 시뮬레이션 화면 안에서 전부 해결"을 하려면 정적 호스팅 분리(화면 열람에 서버가 필요 없게)가 선행돼야 한다는 걸 확인 — 이건 프로젝트 배포 구조 전체에 영향을 줘서 동료 논의 없이 임의로 결정하지 않기로 함
- 그래서 설치 자동화 구현은 **보류**, 대신 논의 내용을 아래 "💬 논의 중" 섹션에 정리

**다음에 할 일:**
- 동료와 "화면 열람 분리(정적 호스팅)" 여부 논의 → 결정되는 대로 설치 자동화 착수
- 기본 실험 4종 회로도(`circuit.png`) 추가 (본인 담당)

---

### 2026-07-24
**완료한 작업 (Claude Code 세션, "화면 열람 분리"는 건드리지 않는 범위):**
- `setup.bat` 완료 시 바탕화면에 "미니 지구 모델 실행" 바로가기 자동 생성 (매번 클릭 자체는 없앨 수 없지만, 폴더 찾아 들어가는 수고는 줄임) — PowerShell `-EncodedCommand`(Base64/UTF-16LE)로 한글 포함 명령을 cmd에서 안전하게 넘기도록 처리
- `Critical_Earth_simulator/README.md` 신규 작성 — GitHub Download ZIP부터 설치/실행/기본 실험 사용법/자주 겪는 문제까지, 학생이 이거 하나만 보고 따라할 수 있게 정리
- Temp 폴더에서 발견한 별도 `basic_experiments` 설계안(스키마 다름, 출처 불확실) 기록 — 아래 "💬 논의 중" 참고

**다음에 할 일:**
- 동료와 "화면 열람 분리(정적 호스팅)" 여부 논의 → 결정되는 대로 남은 설치 자동화(원클릭 다운로드, 포터블 파이썬 등) 진행
- 기본 실험 4종 회로도(`circuit.png`) 추가 (본인 담당)
- `setup.bat`의 바탕화면 바로가기 생성이 실제 더블클릭 환경에서 잘 되는지 직접 1회 확인 (이 세션에서 자동화 테스트 환경 제약으로 완전히 검증 못함, 아래 참고)

---

### 2026-07-24 (2)
**완료한 작업 (Claude Code 세션):**
- 바탕화면 바로가기 방식 대신, **파이썬 설치 자체가 필요 없는 단일 실행파일(exe)**로 방향 전환 (본인 요청: "학생이 따로 뭔가 조작할 필요없이")
- `server.py`의 `BASE_DIR`를 `RESOURCE_DIR`(번들된 읽기전용 리소스, exe일 땐 `sys._MEIPASS`)/`APP_DIR`(계속 남아야 하는 파일용, exe일 땐 exe가 있는 폴더)로 분리 — `python server.py`로 그냥 실행하는 기존 개발 방식은 동작 그대로 유지됨
- `server.spec`(PyInstaller 빌드 설정) + `build_exe.bat`(빌드 실행 배치파일) 작성
- 실제로 `MiniEarthModel.exe` 빌드 성공, 실행해서 아래 전부 확인함:
  - index.html/style.css/js/texture_image/basic_experiments 전부 정상 서빙
  - `POST /data` 정상 동작
  - `data_log.csv`가 임시 폴더가 아니라 exe 옆에 정상적으로 쌓임 (RESOURCE_DIR/APP_DIR 분리가 제대로 동작한다는 뜻)
- 빌드 과정에서 `requirements.txt`에 있는 `bleak`가 실제로는 `.venv`에 설치 안 되어 있던 걸 발견 — 설치해서 해결 (BLE 관련 기능이 지금까지 조용히 깨져있었을 가능성, `--ble` 옵션 실사용 전 재확인 필요)
- `.gitignore`에 `Critical_Earth_simulator/build/`, `dist/` 추가 (exe는 git에 커밋하지 않고 GitHub Releases로 배포하는 걸 전제)
- `README.md`를 exe 다운로드 방식 기준으로 재작성, SmartScreen/방화벽 경고 대처법 추가

**주의할 점 / 확인 필요:**
- exe는 서명이 안 되어 있어서 SmartScreen/방화벽 경고가 뜸 (정상, README에 대처법 적어둠) — 학교 방화벽 정책에 따라 막힐 수도 있어서 실제 학교 환경에서 한 번 테스트 필요
- 코드(`server.py`, `js/`, `basic_experiments/` 등)가 바뀔 때마다 `build_exe.bat`으로 재빌드하고 Release를 새로 올려야 함 — 이 사이클 자체는 아직 실습 안 해봄
- (업데이트: 아래 2026-07-24 (3)에서 실제로 Release 업로드까지 완료됨)

**다음에 할 일 (이후 (3)에서 갱신됨):**
- ~~`MiniEarthModel.exe`를 GitHub Releases에 실제로 올릴지/언제 올릴지 결정~~ → (3)에서 완료
- 실제 학교 네트워크/컴퓨터에서 exe 실행 테스트 (방화벽 정책 등)
- 동료와 "화면 열람 분리(정적 호스팅)" 여부 논의 (exe 방식과는 별개 문제로 여전히 미결정)
- 기본 실험 4종 회로도(`circuit.png`) 추가 (본인 담당)

---

### 2026-07-24 (3)
**완료한 작업 (Claude Code 세션):**
- `MiniEarthModel.exe`를 실제로 **GitHub Releases에 업로드** — 레포가 비공개라 공개 노출 위험이 없음을 확인하고 진행
- `git`에 저장된 자격증명을 API/`gh`에 재사용하려던 첫 시도는 Claude Code 안전장치가 자동 차단 → 우회하지 않고, `gh` CLI를 winget으로 새로 설치한 뒤 `gh auth login`의 브라우저 기기 인증 코드를 본인이 직접 승인하는 정상적인 방식으로 전환
- `v1.0.0-exe` 태그로 Release 생성 + `MiniEarthModel.exe` 첨부 (`gh release create`), 업로드된 자산 크기까지 재확인
- `README.md`의 다운로드 안내를 `.../releases/latest` 실제 링크로 교체
- 커밋 2건(exe 패키징 전체, README 링크 갱신) 푸시 완료

**다음에 할 일:**
- 실제 학교 네트워크/컴퓨터에서 exe 실행 테스트 (SmartScreen/방화벽 정책 등)
- 코드가 바뀌면 `build_exe.bat` 재빌드 → 새 Release 업로드 절차를 한 번 직접 해보기 (아직 미실습)
- 동료와 "화면 열람 분리(정적 호스팅)" 여부 논의 (exe 방식과는 별개 문제로 여전히 미결정)
- 기본 실험 4종 회로도(`circuit.png`) 추가 (본인 담당)
- `basic_experiments/`와 `firmware/`의 코드 중복 정리 여부 결정

---

## 💬 논의 중 / 결정 필요 (미결정 사항 모아두는 곳)

### `basic_experiments/`와 `firmware/`의 코드 중복 (2026-07-23 제기)
- **현재 상태:** `basic_experiments/<id>/code.ino`는 `firmware/xxx_sketch/xxx_sketch.ino`를 그대로 복사해서 넣은 것 — 완전히 같은 내용의 별도 파일 2벌이 존재.
- **문제:** `firmware/` 쪽 코드가 나중에 수정되면(실제 센서 핀·캘리브레이션 확정 등) `basic_experiments/` 쪽은 자동으로 안 따라감. 둘 중 하나만 고치면 서로 어긋남.
- **대안(Claude 제안, 미결정):** 복사본을 없애고 `firmware/`를 원본으로 삼기. `server.py`에 `/firmware` 정적 마운트를 하나 더 추가하고, `basic_experiments/<id>/info.json`의 `code_file`이 로컬 사본 대신 `firmware/xxx_sketch/xxx_sketch.ino` 경로를 직접 가리키게 바꾸면 중복 제거 가능.
- **결정 필요한 것:** 이 구조 변경을 지금 할지, 나중에 할지 / `info.json` 스키마를 바꿀지(`code_file` → 절대경로 or `code_url` 필드 추가) 등.

### 설치 자동화 진입점 — 화면 열람을 서버 없이도 되게 분리할지 (2026-07-23 제기, 논의 보류)
- **하고 싶은 것:** 학생이 "시뮬레이션 화면 안에서" zip 다운로드부터 설치까지 전부 해결.
- **문제(닭과 달걀):** 지금 구조는 `server.py`가 켜져 있어야만 그 화면 자체를 볼 수 있음. 그런데 처음 오는 학생은 서버도 파일도 없는 상태라, "화면 안의 다운로드 버튼"에 애초에 접속할 방법이 없음.
- **완전히 해결하려면:** 정적 파일(`index.html`/`js`/`texture_image` 등)을 GitHub Pages 등에 따로 호스팅해서 서버 없이도 화면이 항상 뜨게 만들어야 함. 브라우저가 `localhost` 접속은 예외적으로 허용해서 기술적으론 가능(호스팅된 페이지 → `ws://localhost:8000`로 연결). 다만 `server.py`에 CORS 등을 추가로 손대야 하고, 이건 실시간 실험 탭 범위를 넘어 **프로젝트 전체 배포 방식**을 바꾸는 결정이라 동료와 상의가 필요함.
- **임시 대안(보류 중엔 이걸로):** GitHub 저장소(README)를 다운로드 진입점으로 사용 — GitHub는 서버 없이도 누구나 접근 가능하므로 닭과 달걀 문제가 없음.
- **결정 필요한 것:** 화면 열람을 분리할지 말지. → **2026-07-23, 동료와 논의 후 결정하기로 보류.** 그 전까지는 설치 자동화 구현을 시작하지 않음.
- **2026-07-24 진행:** "화면 열람 분리"는 여전히 미결정(동료 논의 대기)이지만, 그것과 무관하게 할 수 있는 범위(위의 임시 대안 + 배치파일 개선)는 진행함 — `setup.bat`에 바탕화면 바로가기 자동 생성 추가, `README.md` 작성. 화면 열람 분리 자체는 아직 손 안 댐.
- **2026-07-24 (2) 업데이트:** 본인이 "바탕화면 바로가기 말고, 파이썬 설치도 학생이 신경 안 쓰게" 요청 → PyInstaller 단일 exe(`MiniEarthModel.exe`) 방식으로 전환, 빌드/테스트 완료. **이건 "화면 열람 분리"와는 다른 문제라 그대로 진행함** — exe든 뭐든 `server.py`가 떠 있어야 화면이 보이는 건 동일하고, 단지 "그 server.py를 띄우는 과정"이 파이썬 설치 없이 exe 하나로 끝난다는 차이일 뿐. 그래서 동료 논의 없이 진행해도 되는 범위로 판단함.

### `MiniEarthModel.exe`를 GitHub Releases에 언제 올릴지 (2026-07-24 제기 → 같은 날 해결)
- **해결됨:** 레포가 비공개라 공개 노출 위험이 없다는 걸 확인하고 바로 진행하기로 함.
- **진행 과정 메모:** 저장된 git 자격증명을 다른 도구(API/`gh`)에 재사용하려는 시도는 Claude Code 안전장치가 자동 차단함 — 정상적인 방법(`gh auth login`의 브라우저 기기 인증 코드 승인)으로 본인이 직접 승인한 뒤에야 진행됨. `gh` CLI는 winget으로 새로 설치함.
- **결과:** `v1.0.0-exe` 태그로 Release 생성, `MiniEarthModel.exe` 첨부 완료. `README.md`에 `.../releases/latest` 다운로드 링크 반영.
- **남은 것:** 코드가 바뀔 때마다 `build_exe.bat`으로 재빌드 → 새 Release(또는 기존 Release 자산 교체)로 갱신하는 절차를 아직 실습 안 해봄 (다음에 코드 변경 생기면 처음 해보게 됨).

### 참고: `basic_experiments` 스키마가 다른 별도 설계안 발견 (2026-07-24, 출처 불확실)
- Temp 폴더에서 `진행상황.md`/`실시간실험_기능명세서.md`의 다른 버전을 발견함 — `server.py`는 동일했지만 문서 내용이 다름. "기본 실험" 기능을 `meta.json`(우리는 `info.json`) + 실험 폴더 하나에 `esp32_sketch.ino`+`uno_sketch.ino` 같이 저장(우리는 보드/연결방식별로 폴더 분리) + 서버가 폴더 스캔해서 목록 자동 생성(우리는 `index.json` 수동 관리) 방식으로 독립적으로 설계해둠. 파이썬 포터블/임베디드 자동 설치, "웹페이지가 아니라 런처 파일이 진짜 진입점" 결론도 적혀 있었음.
- **본인 확인:** "동료 결론은 아닐 것" — 출처/신뢰도 불확실. 실제 코드 구현은 없었음(문서만).
- **왜 적어두는지:** 나중에 이 내용이 실제로 동료 쪽에서 다시 나오면, 지금 구현된 것(`info.json`/폴더 분리/`index.json`)과 스키마가 다르다는 걸 바로 알아볼 수 있게.

---

<!-- 새 작업 로그는 이 아래에 최신순으로 추가해주세요 -->
