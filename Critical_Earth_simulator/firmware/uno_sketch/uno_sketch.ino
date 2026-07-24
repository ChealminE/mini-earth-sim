/*
  Mini Earth Model - 아두이노 우노 R3 센서 데이터 전송 (USB 시리얼 방식)
  ====================================================================
  우노는 와이파이가 없으므로 USB 케이블로 노트북과 연결한 상태에서
  Serial.println()으로 JSON 한 줄씩 출력합니다.
  server.py가 이 시리얼 포트를 자동으로 읽어서 브라우저로 중계합니다.

  센서: MH-Z19B (적외선 CO2 센서, UART 통신)
    - MH-Z19B VCC → 우노 5V, GND → 우노 GND
    - MH-Z19B TX  → 우노 핀 2 (RX_PIN)
    - MH-Z19B RX  → 우노 핀 3 (TX_PIN)
    - 배선이 다르면 아래 RX_PIN/TX_PIN 값만 바꾸면 됩니다.

  중요:
    - 아래 BAUD_RATE는 server.py 실행 시 --baud 옵션과 반드시 일치해야 함
      (기본값 9600으로 맞춰져 있음, 서버 쪽 기본값도 9600)
    - 이 스케치 업로드 중에는 Arduino IDE의 시리얼 모니터를 꺼두세요
      (포트를 하나만 열 수 있어서 server.py와 충돌합니다)
    - key 이름은 자유롭게 정하면 대시보드가 자동 인식합니다
*/

#include <SoftwareSerial.h>

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 2000;

// ── MH-Z19B 배선 (실제 배선에 맞게 수정) ───────────────
const int RX_PIN = 2;   // 우노 RX ← MH-Z19B TX
const int TX_PIN = 3;   // 우노 TX → MH-Z19B RX
SoftwareSerial mhz19(RX_PIN, TX_PIN);

// MH-Z19B "농도 읽기" 명령 (표준 프로토콜, 고정값)
const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};

unsigned long lastSend = 0;
int consecutiveFailures = 0; // 연속 실패 횟수 - 너무 쌓이면 SoftwareSerial 자체를 재시작함

void setup() {
  Serial.begin(BAUD_RATE);
  mhz19.begin(9600); // MH-Z19B는 항상 9600bps 고정
}

// MH-Z19B에 측정 명령을 보내고 9바이트 응답을 읽어 CO2(ppm)를 계산.
// 응답이 없거나 체크섬이 안 맞으면 -1을 반환 (호출한 쪽에서 이번 회차는 건너뜀).
int readCO2() {
  while (mhz19.available()) mhz19.read(); // 이전 응답의 남은 바이트가 있으면 먼저 비움 (안 하면 다음 응답과 섞여서 체크섬이 계속 어긋남)
  delay(5); // SoftwareSerial은 반이중이라, 직전 송수신이 완전히 끝난 뒤에 새 명령을 보내야 안전함
  mhz19.write(READ_CO2_CMD, 9);

  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (mhz19.available()) {
      resp[i++] = mhz19.read();
    }
  }
  if (i < 9) return -1; // 응답을 다 못 받음 (센서 예열중이거나 배선 문제)

  if (resp[0] != 0xFF || resp[1] != 0x86) return -1; // 시작 바이트가 다르면 잘못된 응답

  byte checksum = 0;
  for (int j = 1; j < 8; j++) checksum += resp[j];
  checksum = 0xFF - checksum + 1;
  if (checksum != resp[8]) return -1; // 체크섬 불일치 (통신 오류)

  return resp[2] * 256 + resp[3];
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();

    int co2 = readCO2();

    if (co2 < 0) {
      consecutiveFailures++;
      // 연속으로 계속 실패하면 SoftwareSerial 내부 상태가 꼬였을 가능성이 커서,
      // 완전히 껐다 켜서 초기화함 (버퍼 flush만으로는 못 푸는 경우가 있었음)
      if (consecutiveFailures >= 3) {
        mhz19.end();
        delay(50);
        mhz19.begin(9600);
        consecutiveFailures = 0;
      }
      return; // 이번 회차는 건너뜀 (다음 주기에 재시도)
    }

    consecutiveFailures = 0;
    Serial.print("{\"tank1_co2_ppm\":");
    Serial.print(co2);
    Serial.println("}");
  }
}
