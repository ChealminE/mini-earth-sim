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
- [ ] 실행 자동화 배치파일(`.bat`) 작성
- [ ] 서버 구동 시 브라우저 자동 오픈 (`webbrowser.open`)
- [ ] 최초 설치용 배치파일(가상환경 생성 + `pip install`)
- [ ] requirements.txt 버전 오류 수정 (fastapi/uvicorn/websockets 실제 존재 버전으로) — Claude Code 세션에서 진행 중

### 3. 프론트엔드 (tab-live.js / index.html)
- [x] 센서 키 자동 인식 (하드코딩 없이 동적 처리)
- [x] 센서 카드 그리드 표시
- [x] 다중 그래프 (최대 4개, X/Y축 독립 선택)
- [x] CO2 센서 → 3D 아크릴 효과 연동 (`sensorEffectMap` 구조)
- [x] JSON 형식 안내 모달 (실시간 실험 탭 최초 진입 시 표시, "다시 보지 않기" 옵션)
- [x] WebSocket 연결 상태 표시 + 자동 재연결
- [ ] 온도 센서 → 3D 효과 매핑 추가
- [ ] pH 센서 → 3D 효과 매핑 추가 (해양 산성화 표현 등)
- [ ] 메탄 센서 → 3D 효과 매핑 추가 (기포 효과 등)

### 4. Three.js 버전 대응
- [x] r128 → r160 업그레이드 반영
- [ ] `outputEncoding`/`sRGBEncoding` → `outputColorSpace`/`SRGBColorSpace` 수정 (renderer)
- [ ] `tex.encoding` → `tex.colorSpace` 수정 (createGroundTexture 내 텍스처)
- [ ] 색감 변화(Color Management) 육안 확인 및 필요 시 미세 조정

### 5. 하드웨어 통신 확장 (검토 단계, 미착수)
- [ ] ESP32-S3 + HM-10(BLE) 연동 방식 결정 여부 (Classic BT 아님 → GATT 방식 필요)
- [ ] BLE 방식 채택 시 `server.py`에 `bleak` 기반 리더 추가 (또는 Web Bluetooth로 서버 자체를 대체)

### 6. 문서화
- [x] "실시간 실험" 탭 기능명세서 작성
- [x] 진행상황 체크리스트 & 작업 로그 체계 수립 (본 문서)
- [ ] 학생 배포용 실행 가이드(README) 작성

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

**다음에 할 일:**
- Three.js r160 관련 2곳 코드 수정 (`common.js`)
- 실행 자동화 배치파일 실제 작성 및 `server.py`에 `webbrowser.open` 추가
- (선택) 온도/pH/메탄 센서용 3D 효과 로직 설계

---

<!-- 새 작업 로그는 이 아래에 최신순으로 추가해주세요 -->
