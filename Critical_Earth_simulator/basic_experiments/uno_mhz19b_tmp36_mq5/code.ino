/*
  Mini Earth Model - 우노 R3 센서 데이터 전송 (USB 시리얼 방식)
  ====================================================================
  CO2(MH-Z19B) + 온도(TMP36) + 가스(MQ-5)를 함께 읽어서
  JSON 한 줄로 Serial.println 출력합니다.
  server.py가 이 시리얼 포트를 자동으로 읽어서 브라우저로 중계합니다.

  센서 배선:
    - MH-Z19B: VCC→5V, GND→GND, TX→우노 핀2, RX→우노 핀3
    - TMP36:   VCC→5V, GND→GND, OUT→우노 A0
    - MQ-5:    VCC→5V, GND→GND, AOUT→우노 A1

  중요:
    - MQ-5는 반도체식 가스 센서라 예열 시간이 필요하고(스펙상 몇 분 단위 권장),
      원시 아날로그 값(0~1023)이 그대로는 ppm이 아닙니다. 실제 농도로 쓰려면
      Ro(청정공기 저항값) 기준 캘리브레이션이 필요해서, 지금은 "gas_raw"라는
      이름으로만 보냅니다. 3D 메탄 효과는 "methane"/"ch4"라는 정확한 키 이름에만
      반응하므로, 지금 상태로는 카드/그래프에만 표시되고 3D 효과는 안 붙습니다.
      (캘리브레이션 값이 정해지면 key 이름을 methane으로 바꾸면 바로 연동됩니다.)
    - BAUD_RATE는 server.py 실행 시 --baud 옵션과 반드시 일치해야 함 (기본 9600)
    - 이 스케치 업로드 중에는 Arduino IDE의 시리얼 모니터를 꺼두세요 (포트 충돌 방지)
*/

#include <SoftwareSerial.h>

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 30000; // 30초마다 전송

// ── MH-Z19B 배선 (실제 배선에 맞게 수정) ───────────────
const int RX_PIN = 2;   // 우노 RX ← MH-Z19B TX
const int TX_PIN = 3;   // 우노 TX → MH-Z19B RX
SoftwareSerial mhz19(RX_PIN, TX_PIN);
const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
int consecutiveFailures = 0; // 연속 실패 횟수 - 너무 쌓이면 SoftwareSerial 자체를 재시작함

// ── 아날로그 센서 배선 ──────────────────────────────
const int TMP36_PIN = A0;
const int MQ5_PIN = A1;

unsigned long lastSend = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  mhz19.begin(9600); // MH-Z19B는 항상 9600bps 고정
}

// MH-Z19B에 측정 명령을 보내고 9바이트 응답을 읽어 CO2(ppm)를 계산.
// 응답이 없거나 체크섬이 안 맞으면 -1을 반환.
// 우노 USB + MH-Z19B 실험(basic_experiments/uno_usb)에서 실제 하드웨어로 검증된 것과
// 동일한 로직 - 체크섬 확인 + 반이중 안전 지연 + 연속 3회 실패 시 SoftwareSerial 재시작.
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

  int rawTemp = analogRead(TMP36_PIN);
  float voltage = rawTemp * (5.0 / 1024.0);
  float temperatureC = (voltage - 0.5) * 100.0; // TMP36 스펙: 500mV에서 0도, 10mV당 1도 상승

  int gasRaw = analogRead(MQ5_PIN); // 아직 보정 안 된 원시값 (캘리브레이션 전)

  Serial.print("{");
  if (co2 != -1) { Serial.print("\"co2\":"); Serial.print(co2); Serial.print(","); }
  Serial.print("\"temp\":"); Serial.print(temperatureC, 2);
  Serial.print(",\"gas_raw\":"); Serial.print(gasRaw);
  Serial.println("}");
}
