/*
  Mini Earth Model - 우노 R3 센서 데이터 전송 (USB 시리얼 방식)
  ====================================================================
  CO2(MH-Z19B) + 온도 센서 2개(DS18B20, 같은 핀에 병렬 연결)를 함께 읽어서
  JSON 한 줄로 Serial.println 출력합니다.
  server.py가 이 시리얼 포트를 자동으로 읽어서 브라우저로 중계합니다.

  센서 배선:
    - MH-Z19B: VCC→5V, GND→GND, TX→우노 핀6(MH_RX), RX→우노 핀7(MH_TX)
    - DS18B20 x2: 데이터 핀을 전부 우노 핀2(ONE_WIRE_BUS)에 병렬 연결
      + 4.7kΩ 풀업 저항 (데이터 핀 - VCC 사이)

  라이브러리 설치 필요 (Arduino IDE 라이브러리 매니저):
    - OneWire (Jim Studt / Paul Stoffregen)
    - DallasTemperature (Miles Burton)

  중요:
    - BAUD_RATE는 server.py 실행 시 --baud 옵션과 반드시 일치해야 함 (기본 9600)
    - 이 스케치 업로드 중에는 Arduino IDE의 시리얼 모니터를 꺼두세요 (포트 충돌 방지)
    - key 이름은 자유롭게 정하면 대시보드가 자동 인식합니다
*/

#include <SoftwareSerial.h>
#include <OneWire.h>
#include <DallasTemperature.h>

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 30000; // 30초마다 전송

// ── MH-Z19B 배선 (실제 배선에 맞게 수정) ───────────────
const int MH_RX = 6;   // 우노 RX ← MH-Z19B TX
const int MH_TX = 7;   // 우노 TX → MH-Z19B RX
SoftwareSerial mhz19(MH_RX, MH_TX);

// MH-Z19B "농도 읽기" 명령 (표준 프로토콜, 고정값)
const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
int consecutiveFailures = 0; // 연속 실패 횟수 - 너무 쌓이면 SoftwareSerial 자체를 재시작함

// ── DS18B20 배선 ────────────────────────────────────
#define ONE_WIRE_BUS 2
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);

unsigned long lastSend = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  mhz19.begin(9600); // MH-Z19B는 항상 9600bps 고정
  tempSensors.begin();
}

// MH-Z19B에 측정 명령을 보내고 9바이트 응답을 읽어 CO2(ppm)를 계산.
// 응답이 없거나 체크섬이 안 맞으면 -1을 반환 (호출한 쪽에서 그 값만 건너뜀).
// 우노 USB + MH-Z19B 실험(basic_experiments/uno_usb)에서 실제 하드웨어로 검증된 것과
// 동일한 로직 - 체크섬 확인 + 반이중 안전 지연 + 연속 3회 실패 시 SoftwareSerial 재시작으로
// 장시간 실험에서도 통신이 멈추지 않도록 함.
int readCO2() {
  while (mhz19.available()) mhz19.read(); // 이전 응답의 남은 바이트가 있으면 먼저 비움
  delay(5); // SoftwareSerial은 반이중이라, 직전 송수신이 끝난 뒤에 새 명령을 보내야 안전함
  mhz19.write(READ_CO2_CMD, 9);

  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (mhz19.available()) resp[i++] = mhz19.read();
  }
  if (i < 9) return -1; // 응답을 다 못 받음 (센서 예열중이거나 배선 문제)
  if (resp[0] != 0xFF || resp[1] != 0x86) return -1; // 시작 바이트가 다르면 잘못된 응답

  byte checksum = 0;
  for (int j = 1; j < 8; j++) checksum += resp[j];
  checksum = 0xFF - checksum + 1;
  if (checksum != resp[8]) return -1; // 체크섬 불일치 (통신 오류)

  consecutiveFailures = 0;
  return resp[2] * 256 + resp[3];
}

void loop() {
  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  int co2 = readCO2();
  if (co2 == -1) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      mhz19.end();
      delay(50);
      mhz19.begin(9600);
      consecutiveFailures = 0;
    }
  }

  tempSensors.requestTemperatures();
  float temp1 = tempSensors.getTempCByIndex(0);
  float temp2 = tempSensors.getTempCByIndex(1);

  // 값이 하나 실패해도(-1 / DEVICE_DISCONNECTED_C) 그 키만 빼고 나머지는 정상 전송
  Serial.print("{");
  bool first = true;
  if (co2 != -1) { Serial.print("\"co2\":"); Serial.print(co2); first = false; }
  if (temp1 != DEVICE_DISCONNECTED_C) { if (!first) Serial.print(","); Serial.print("\"temp1\":"); Serial.print(temp1, 2); first = false; }
  if (temp2 != DEVICE_DISCONNECTED_C) { if (!first) Serial.print(","); Serial.print("\"temp2\":"); Serial.print(temp2, 2); }
  Serial.println("}");
}
