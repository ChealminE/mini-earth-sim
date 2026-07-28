/*
  Mini Earth Model - 우노 R3 센서 데이터 전송 (HM-10 BLE 모듈 방식, CO2 센서 2개)
  ========================================================================
  MH-Z19B CO2 센서 2개(예: 탱크1/탱크2)를 동시에 읽어서 HM-10을 통해
  BLE notify로 JSON을 방송합니다.

  배선 (중요 - 전압 주의):
    - MH-Z19B #1: VCC→5V, GND→GND, TX→우노 핀2, RX→우노 핀3
    - MH-Z19B #2: VCC→5V, GND→GND, TX→우노 핀4, RX→우노 핀5
    - HM-10: VCC→5V(또는 3.3V, 모듈 설명서 확인), GND→GND,
             TX→우노 핀6, RX→우노 핀7 *반드시 저항 분배(예: 1kΩ+2kΩ)로
             5V→3.3V 낮춰서 연결* (그대로 5V 물리면 모듈 손상 가능)

  중요:
    - 우노는 SoftwareSerial을 여러 개 선언할 수는 있지만 "수신"은 한 번에 하나만
      가능해서, 센서를 읽기 직전에 반드시 그 포트의 listen()을 호출해야 합니다.
      (전송(hm10.println 등)은 listen() 상태와 무관하게 항상 가능합니다.)
    - BAUD_RATE는 HM-10 기본값(9600)과 반드시 일치해야 함
    - key 이름은 자유롭게 정하면 대시보드가 자동 인식합니다. 여기서는 같은 종류
      센서가 2개라 co2_1/co2_2로 나눠 보내는데, 이러면 이름만으로는 3D CO2 효과가
      자동으로 안 붙습니다 - 실시간 실험 탭 센서 카드의 드롭다운에서 원하는 쪽을
      "CO2" 역할로 직접 지정하면 3D 효과에 연결됩니다.
    - esp32_ble_sketch.ino / uno_hm10_ble와 동일한 UUID(0xFFE0/0xFFE1)를 씁니다
*/

#include <SoftwareSerial.h>

SoftwareSerial mhz19_1(2, 3); // MH-Z19B #1
SoftwareSerial mhz19_2(4, 5); // MH-Z19B #2
SoftwareSerial hm10(6, 7);    // HM-10 BLE 모듈 (RX 핀에 저항 분배 회로 필수)

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 30000; // 30초마다 전송

const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
int fail1 = 0, fail2 = 0; // 센서별 연속 실패 횟수 - 너무 쌓이면 해당 포트만 재시작

unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);   // 디버그 출력용 (USB)
  mhz19_1.begin(BAUD_RATE);
  mhz19_2.begin(BAUD_RATE);
  hm10.begin(BAUD_RATE);
  Serial.println("HM-10 + MH-Z19B x2 초기화 대기중...");
  delay(1000);
}

// 지정한 포트에서 CO2(ppm)를 읽음. 응답이 없거나 체크섬이 안 맞으면 -1.
// 우노 USB + MH-Z19B 실험(basic_experiments/uno_usb)에서 실제 하드웨어로 검증된 것과
// 동일한 체크섬/재시도 로직에, 여러 SoftwareSerial을 다루기 위한 listen() 전환만 추가함.
int readCO2(SoftwareSerial &port, int &failCount) {
  port.listen(); // 이 포트를 수신 모드로 전환 (전환 순간 다른 포트는 수신 불가)
  delay(5);
  while (port.available()) port.read(); // 이전 응답 찌꺼기 비움
  port.write(READ_CO2_CMD, 9);

  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (port.available()) resp[i++] = port.read();
  }

  bool ok = false;
  if (i == 9 && resp[0] == 0xFF && resp[1] == 0x86) {
    byte checksum = 0;
    for (int j = 1; j < 8; j++) checksum += resp[j];
    checksum = 0xFF - checksum + 1;
    ok = (checksum == resp[8]);
  }

  if (!ok) {
    failCount++;
    if (failCount >= 3) { port.end(); delay(50); port.begin(BAUD_RATE); failCount = 0; }
    return -1;
  }

  failCount = 0;
  return resp[2] * 256 + resp[3];
}

void loop() {
  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  int co2_1 = readCO2(mhz19_1, fail1);
  int co2_2 = readCO2(mhz19_2, fail2);

  String json = "{";
  bool first = true;
  if (co2_1 != -1) { json += "\"co2_1\":" + String(co2_1); first = false; }
  if (co2_2 != -1) { if (!first) json += ","; json += "\"co2_2\":" + String(co2_2); }
  json += "}";

  hm10.println(json);       // HM-10이 이 줄을 그대로 BLE notify로 방송
  Serial.print("HM-10으로 전송: ");
  Serial.println(json);     // 디버그용 (USB 시리얼 모니터로 확인 가능)
}
