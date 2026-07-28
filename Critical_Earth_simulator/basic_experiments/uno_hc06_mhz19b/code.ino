/*
  Mini Earth Model - 우노 R3 센서 데이터 전송 (HC-06 클래식 블루투스 방식)
  ========================================================================
  주의: HC-06은 BLE가 아니라 클래식 블루투스(SPP)입니다. server.py의 --ble
  옵션(BLE 전용, bleak로 직접 스캔/연결)으로는 못 받고, 아래처럼 USB 시리얼과
  완전히 동일한 방식(--serial)으로 받습니다.

  연결 방법:
    1) 윈도우 블루투스 설정에서 HC-06과 먼저 페어링 (기본 PIN은 보통 1234 또는 0000)
    2) 페어링 완료되면 윈도우가 가상 COM 포트를 만들어줌
       (장치 관리자 > 포트(COM & LPT)에서 확인)
    3) python server.py --serial COM포트번호 로 실행
       (자동탐지 키워드에 블루투스 포트 이름이 안 걸릴 수 있어 직접 지정 권장)

  배선:
    - MH-Z19B: VCC→5V, GND→GND, TX→우노 핀10, RX→우노 핀11
    - HC-06: VCC→5V(또는 3.3V, 모듈 설명서 확인), GND→GND,
             TX→우노 핀2, RX→우노 핀3 *반드시 저항 분배(예: 1kΩ+2kΩ)로
             5V→3.3V 낮춰서 연결* (그대로 5V 물리면 모듈 손상 가능)

  중요:
    - 우노는 SoftwareSerial 여러 개를 선언할 수는 있지만 "수신"은 한 번에 하나만
      가능해서, 포트를 쓰기 직전에 반드시 그 포트의 listen()을 호출해야 합니다.
    - BAUD_RATE는 HC-06 기본값(9600)과 반드시 일치해야 함
*/

#include <SoftwareSerial.h>

SoftwareSerial co2Serial(10, 11);      // MH-Z19B (RX, TX)
SoftwareSerial bluetoothSerial(2, 3);  // HC-06 (RX, TX)

const long BAUD_RATE = 9600;
const unsigned long SEND_INTERVAL_MS = 2000;

const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
int consecutiveFailures = 0; // 연속 실패 횟수 - 너무 쌓이면 SoftwareSerial 자체를 재시작함

unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);        // 디버그 출력용 (USB)
  co2Serial.begin(BAUD_RATE);
  bluetoothSerial.begin(BAUD_RATE);
  Serial.println("MH-Z19B + HC-06 초기화 대기중...");
}

// MH-Z19B에서 CO2(ppm)를 읽음. 응답이 없거나 체크섬이 안 맞으면 -1.
// 우노 USB + MH-Z19B 실험(basic_experiments/uno_usb)에서 실제 하드웨어로 검증된 것과
// 동일한 로직 - 체크섬 확인 + 반이중 안전 지연 + 연속 3회 실패 시 SoftwareSerial 재시작.
int readCO2() {
  co2Serial.listen(); // 이 포트를 수신 모드로 전환
  delay(5);
  while (co2Serial.available()) co2Serial.read(); // 이전 응답 찌꺼기 비움
  co2Serial.write(READ_CO2_CMD, 9);

  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (co2Serial.available()) resp[i++] = co2Serial.read();
  }

  bool ok = false;
  if (i == 9 && resp[0] == 0xFF && resp[1] == 0x86) {
    byte checksum = 0;
    for (int j = 1; j < 8; j++) checksum += resp[j];
    checksum = 0xFF - checksum + 1;
    ok = (checksum == resp[8]);
  }

  if (!ok) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      co2Serial.end();
      delay(50);
      co2Serial.begin(BAUD_RATE);
      consecutiveFailures = 0;
    }
    return -1;
  }

  consecutiveFailures = 0;
  return resp[2] * 256 + resp[3];
}

void loop() {
  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  int co2 = readCO2();
  if (co2 == -1) return; // 이번 회차는 건너뜀 (다음 주기에 재시도)

  String json = "{\"co2\":" + String(co2) + "}";

  bluetoothSerial.listen(); // HC-06으로 전송하기 전 포트 전환
  delay(5);
  bluetoothSerial.println(json); // HC-06이 이 줄을 그대로 블루투스로 전달

  Serial.print("HC-06으로 전송: ");
  Serial.println(json); // 디버그용 (USB 시리얼 모니터로 확인 가능)
}
