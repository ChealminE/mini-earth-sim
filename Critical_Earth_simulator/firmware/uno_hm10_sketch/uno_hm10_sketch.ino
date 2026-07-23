/*
  Mini Earth Model - 아두이노 우노 R3 센서 데이터 전송 (HM-10 BLE 모듈 방식)
  ========================================================================
  우노 자체는 BLE가 없으므로 HM-10 모듈을 UART(TX/RX)로 붙여서
  BLE notify로 JSON을 방송합니다. USB 케이블(uno_sketch.ino)이 필요 없어짐.

  배선 (중요 - 전압 주의):
    - HM-10 VCC → 우노 5V (또는 3.3V, 모듈에 따라 다름 - 구입한 모듈 설명서 확인)
    - HM-10 GND → 우노 GND
    - HM-10 TX  → 우노 핀 2 (RX_PIN, 우노가 3.3V도 5V로 인식하므로 그대로 연결 가능)
    - HM-10 RX  → 우노 핀 3 (TX_PIN) *반드시 저항 분배(예: 1kΩ+2kΩ)로 5V→3.3V 낮춰서 연결*
      (HM-10 RX 핀에 5V를 그대로 물리면 모듈이 손상될 수 있음)

  HM-10 최초 1회 설정 (AT 명령, 시리얼 모니터로 직접 입력):
    - 이 스케치 업로드 전, 별도의 "AT 패스스루" 스케치나 FTDI 어댑터로
      HM-10에 AT+ROLE0 (peripheral 모드), AT+NOTI1 (notify 켜기) 정도만
      확인하면 됨. 대부분의 저가 HM-10 클론은 서비스 0xFFE0 / 특성 0xFFE1이
      출고 기본값이라 별도 설정 없이 바로 쓸 수 있는 경우가 많음.
    - 최초 연결 시 PC 블루투스 설정에서 페어링할 필요는 없음
      (BLE라서 server.py의 bleak 코드가 스캔 후 직접 연결함).

  중요:
    - 아래 BAUD_RATE는 HM-10 기본값(9600)과 반드시 일치해야 함
    - 이 스케치 업로드 중에는 HM-10의 RX/TX를 잠깐 분리하거나
      Arduino IDE 시리얼 모니터를 꺼두는 게 안전함 (업로드용 USB 시리얼과
      SoftwareSerial 핀이 겹치지 않지만, 업로드 중 노이즈 방지 차원)
    - key 이름은 자유롭게 정하면 대시보드가 자동 인식합니다
    - esp32_ble_sketch.ino와 동일한 UUID(0xFFE0/0xFFE1)를 쓰므로
      PC 쪽 bleak 코드는 보드 종류를 몰라도 됨
*/

#include <ArduinoJson.h>
#include <SoftwareSerial.h>

const int RX_PIN = 2;   // 우노 RX ← HM-10 TX
const int TX_PIN = 3;   // 우노 TX → HM-10 RX (반드시 분압저항 거쳐서 연결)
SoftwareSerial bleSerial(RX_PIN, TX_PIN);

const long BAUD_RATE = 9600;              // HM-10 기본 통신 속도
const unsigned long SEND_INTERVAL_MS = 2000;

// ── 센서 핀 예시 (실제 배선에 맞게 수정) ───────────────
const int PIN_TEMP = A0;
const int PIN_CO2   = A1;
const int PIN_CH4   = A2;

unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);       // 디버그 출력용 (USB)
  bleSerial.begin(BAUD_RATE); // HM-10과의 통신용
  Serial.println("HM-10 초기화 대기중...");
  delay(1000);
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

    String jsonStr;
    serializeJson(doc, jsonStr);

    bleSerial.println(jsonStr);   // HM-10이 이 줄을 그대로 BLE notify로 방송
    Serial.print("HM-10으로 전송: ");
    Serial.println(jsonStr);      // 디버그용 (USB 시리얼 모니터로 확인 가능)
  }
}
