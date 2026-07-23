/*
  Mini Earth Model - 아두이노 우노 R3 센서 데이터 전송 (USB 시리얼 방식)
  ====================================================================
  우노는 와이파이가 없으므로 USB 케이블로 노트북과 연결한 상태에서
  Serial.println()으로 JSON 한 줄씩 출력합니다.
  server.py가 이 시리얼 포트를 자동으로 읽어서 브라우저로 중계합니다.

  중요:
    - 아래 BAUD_RATE는 server.py 실행 시 --baud 옵션과 반드시 일치해야 함
      (기본값 9600으로 맞춰져 있음, 서버 쪽 기본값도 9600)
    - 이 스케치 업로드 중에는 Arduino IDE의 시리얼 모니터를 꺼두세요
      (포트를 하나만 열 수 있어서 server.py와 충돌합니다)
    - key 이름은 자유롭게 정하면 대시보드가 자동 인식합니다
*/

#include <ArduinoJson.h>

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 2000;

// ── 센서 핀 예시 (실제 배선에 맞게 수정) ───────────────
const int PIN_TEMP = A0;
const int PIN_CO2   = A1;
const int PIN_CH4   = A2;

unsigned long lastSend = 0;

void setup() {
  Serial.begin(BAUD_RATE);
}

// 센서 읽기: 실제 센서 코드로 이 부분만 교체하면 됩니다.
void readSensors(JsonDocument& doc) {
  int rawTemp = analogRead(PIN_TEMP);
  int rawCo2  = analogRead(PIN_CO2);
  int rawCh4  = analogRead(PIN_CH4);

  // 우노는 10bit ADC (0~1023)
  doc["tank1_temp_c"]  = 15.0 + (rawTemp / 1023.0) * 20.0;
  doc["tank1_co2_ppm"] = 400 + (rawCo2  / 1023.0) * 2000.0;
  doc["tank2_ch4_ppm"] = 5   + (rawCh4  / 1023.0) * 50.0;
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();

    JsonDocument doc;
    readSensors(doc);

    serializeJson(doc, Serial);
    Serial.println();  // 한 줄 = 한 건의 데이터 (서버가 줄 단위로 읽음)
  }
}
