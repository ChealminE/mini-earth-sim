/*
  Mini Earth Model - 표준 코드 · 우노 R3 + HM-10 (BLE)
  ====================================================================
  CO2(MH-Z19B) + 온도(DS18B20, 1~2개)를 읽어서 HM-10 모듈로 JSON 한 줄씩 보냅니다.
  HM-10은 받은 글자를 그대로 BLE로 방송하고, PC(server.py --ble)가 보낸 명령도 그대로 우노에 넘겨 줍니다.
  시뮬레이션 화면(직접 실험 탭)에서 이 보드에 명령을 보낼 수 있습니다:
    - 센서별 켜기/끄기   - 측정 간격 바꾸기   - 측정 멈춤/재개   - 재부팅

  보내는 값:  {"co2":812,"temp":24.06,"temp2":23.81}
  보드 정보:  {"_type":"info","dev":"uno-hm10", ... "sensors":[...]}  (켜질 때, 명령을 받을 때마다)
  받는 명령:  {"cmd":"sensor","id":"co2","on":0}   {"cmd":"interval","ms":5000}
              {"cmd":"run","on":0}   {"cmd":"reboot"}   {"cmd":"info"}

  라이브러리 (Arduino IDE 라이브러리 매니저에서 설치):
    - OneWire (Jim Studt / Paul Stoffregen)
    - DallasTemperature (Miles Burton)

  센서 "끄기"는 두 가지로 동작합니다:
    - 전원 핀(..._POWER_PIN)을 -1로 두면: 측정만 멈춤 (전원은 계속 들어감)
    - 전원 핀을 지정하면: 그 핀을 LOW로 내려 센서 전원을 실제로 끊음
      · DS18B20은 전류가 아주 작아서(약 1.5mA) VCC를 디지털 핀에 바로 꽂아도 됩니다.
      · MH-Z19B는 최대 약 150mA라 핀에 바로 꽂으면 안 됩니다 (우노 핀은 40mA까지).
        MOSFET이나 릴레이 모듈을 거쳐 연결하고 그 모듈의 제어 핀을 적으세요.
      · MH-Z19B는 전원을 다시 켜면 예열 시간(CO2_WARMUP_MS) 동안 값을 보내지 않습니다.

  HM-10 연결 주의:
    - HM-10의 RX 핀은 3.3V용입니다. 우노 TX(5V) → HM-10 RX 사이에 저항 분배(1kΩ + 2kΩ)를 꼭 넣으세요.
    - server.py는 이름에 'MiniEarth'가 들어간 BLE 기기를 찾습니다. HM-10 기본 이름은 'HMSoft'라서
      서버를 run_server.bat 대신 `python server.py --ble --ble-name HMSoft` 로 켜거나,
      HM-10에 AT 명령(AT+NAMEMiniEarth1)으로 이름을 바꿔 두세요.
    - 우노는 SoftwareSerial을 한 번에 하나만 들을 수 있어서, CO2 센서를 읽는 짧은 순간(약 0.1초)에
      도착한 명령은 놓칠 수 있습니다. 화면 버튼이 반영 안 되면 한 번 더 누르세요.
*/

#include <SoftwareSerial.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <avr/wdt.h>

// ===== 사용자 설정 (시뮬레이션 '기본 실험' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "uno-hm10";            // @설정 보드 이름 | | 화면에 표시될 이름. 보드를 여러 대 쓰면 서로 다르게 정하세요
const unsigned long SEND_INTERVAL_MS = 5000;    // @설정 측정·전송 간격 | ms | 1000 = 1초. MH-Z19B는 약 5초마다 값이 새로 나오므로 5000 이상 권장 (실험 중에 화면에서도 바꿀 수 있음)
const unsigned long RUN_MINUTES = 0;            // @설정 측정 시간 | 분 | 이 시간이 지나면 보드가 스스로 측정을 멈춥니다. 0이면 멈추지 않음
const int BT_RX_PIN = 10;                       // @설정 HM-10의 TX가 꽂힌 우노 핀 | | 모듈 TX → 이 핀
const int BT_TX_PIN = 11;                       // @설정 HM-10의 RX가 꽂힌 우노 핀 | | 모듈 RX ← 이 핀 (저항 분배 필수)
const int MH_RX_PIN = 6;                        // @설정 MH-Z19B의 TX가 꽂힌 우노 핀 | | 센서 TX → 이 핀
const int MH_TX_PIN = 7;                        // @설정 MH-Z19B의 RX가 꽂힌 우노 핀 | | 센서 RX ← 이 핀
const int ONE_WIRE_PIN = 2;                     // @설정 DS18B20 데이터 핀 | | 데이터 핀과 5V 사이에 4.7kΩ 풀업 저항 필요
const int CO2_POWER_PIN = -1;                   // @설정 CO2 센서 전원 스위치 핀 | | MOSFET·릴레이 모듈 제어 핀. 없으면 -1 (끄기 = 측정만 멈춤)
const int TEMP_POWER_PIN = -1;                  // @설정 온도 센서 전원 핀 | | DS18B20 VCC를 꽂은 디지털 핀. 없으면 -1
const unsigned long CO2_WARMUP_MS = 60000;      // @설정 CO2 센서 예열 시간 | ms | 전원 핀으로 다시 켰을 때 이 시간 동안은 값을 보내지 않음
const long BT_BAUD = 9600;                      // @설정 HM-10 통신 속도 | bps | 모듈 기본값 9600 (AT 명령으로 바꾼 적이 없으면 그대로)

// ===== 센서 =====
SoftwareSerial mhz19(MH_RX_PIN, MH_TX_PIN);
SoftwareSerial bt(BT_RX_PIN, BT_TX_PIN);
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature tempSensors(&oneWire);
const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};
int co2Failures = 0; // 연속 실패 횟수 - 너무 쌓이면 SoftwareSerial 자체를 재시작함

// 센서 상태 (화면 명령으로 바뀜)
bool co2On = true, tempOn = true;
unsigned long co2WarmUntil = 0;  // 이 시각(millis)까지는 예열 중
unsigned long interval = SEND_INTERVAL_MS;
bool running = true;
unsigned long runStart = 0;
unsigned long lastSend = 0;

Stream& link = bt; // 값을 보내고 명령을 받는 통로 (이 코드에서는 HM-10)

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  bool warm = co2On && CO2_POWER_PIN >= 0 && (long)(co2WarmUntil - millis()) > 0;
  link.print(F("{\"_type\":\"info\",\"dev\":\""));
  link.print(DEVICE_NAME);
  link.print(F("\",\"board\":\"Arduino Uno R3\",\"link\":\"ble\",\"fw\":\"std-1\",\"interval\":"));
  link.print(interval);
  link.print(F(",\"run\":"));
  link.print(running ? 1 : 0);
  link.print(F(",\"sensors\":[{\"id\":\"co2\",\"name\":\"MH-Z19B\",\"keys\":[\"co2\"],\"on\":"));
  link.print(co2On ? 1 : 0);
  link.print(F(",\"pwr\":"));
  link.print(CO2_POWER_PIN >= 0 ? 1 : 0);
  link.print(F(",\"warm\":"));
  link.print(warm ? 1 : 0);
  link.print(F("},{\"id\":\"temp\",\"name\":\"DS18B20\",\"keys\":[\"temp\",\"temp2\"],\"on\":"));
  link.print(tempOn ? 1 : 0);
  link.print(F(",\"pwr\":"));
  link.print(TEMP_POWER_PIN >= 0 ? 1 : 0);
  link.println(F("}]}"));
}

// ── 센서 전원 ───────────────────────────────────────
void setCo2Power(bool on) {
  co2On = on;
  if (CO2_POWER_PIN < 0) return;
  digitalWrite(CO2_POWER_PIN, on ? HIGH : LOW);
  if (on) co2WarmUntil = millis() + CO2_WARMUP_MS;
}

void setTempPower(bool on) {
  tempOn = on;
  if (TEMP_POWER_PIN < 0) return;
  digitalWrite(TEMP_POWER_PIN, on ? HIGH : LOW);
  if (on) { delay(50); tempSensors.begin(); } // 전원이 다시 들어오면 센서를 새로 찾아야 함
}

// ── 명령 한 줄에서 값 꺼내기 (ArduinoJson 없이 - 우노 메모리가 2KB뿐이라) ──
const char* findKey(const char* s, const char* key) {
  char pat[16];
  snprintf(pat, sizeof(pat), "\"%s\"", key);
  const char* p = strstr(s, pat);
  if (!p) return nullptr;
  p += strlen(pat);
  while (*p == ' ' || *p == ':') p++;
  return p;
}

long jsonNum(const char* s, const char* key, long def) {
  const char* p = findKey(s, key);
  return p ? atol(p) : def;
}

bool jsonIs(const char* s, const char* key, const char* value) {
  const char* p = findKey(s, key);
  if (!p || *p != '"') return false;
  p++;
  size_t n = strlen(value);
  return strncmp(p, value, n) == 0 && p[n] == '"';
}

void handleCommand(const char* line) {
  if (jsonIs(line, "cmd", "sensor")) {
    bool on = jsonNum(line, "on", 1) != 0;
    if (jsonIs(line, "id", "co2")) setCo2Power(on);
    else if (jsonIs(line, "id", "temp")) setTempPower(on);
  } else if (jsonIs(line, "cmd", "interval")) {
    long ms = jsonNum(line, "ms", interval);
    if (ms >= 200) interval = ms;
  } else if (jsonIs(line, "cmd", "run")) {
    running = jsonNum(line, "on", 1) != 0;
    if (running) runStart = millis(); // 다시 켜면 측정 시간을 처음부터 잼
  } else if (jsonIs(line, "cmd", "reboot")) {
    link.println(F("{\"_type\":\"log\",\"msg\":\"rebooting\"}"));
    delay(50);
    wdt_enable(WDTO_15MS); // 감시 타이머를 켜고 일부러 기다리게 해서 보드를 리셋시킴
    while (true) {}
  } else if (!jsonIs(line, "cmd", "info")) {
    return; // 모르는 명령은 무시
  }
  sendInfo(); // 바뀐 상태를 화면에 알림
}

char cmdBuf[96];
byte cmdLen = 0;

void pollCommands() {
  while (link.available()) {
    char c = link.read();
    if (c == '\n' || c == '\r') {
      if (cmdLen > 0) { cmdBuf[cmdLen] = '\0'; handleCommand(cmdBuf); cmdLen = 0; }
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }
}

// ── 센서 읽기 ───────────────────────────────────────
// 응답이 없거나 체크섬이 안 맞으면 -1. (basic_experiments/uno_usb에서 실제 하드웨어로 검증된 로직)
int readCO2() {
  mhz19.listen(); // SoftwareSerial은 한 번에 하나만 들을 수 있음 - 읽는 동안만 센서 쪽으로
  while (mhz19.available()) mhz19.read();
  mhz19.write(READ_CO2_CMD, 9);
  mhz19.flush();
  delay(5); // SoftwareSerial은 반이중이라 송신 직후 바로 읽으면 첫 바이트를 놓칠 수 있음

  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (mhz19.available()) resp[i++] = mhz19.read();
  }
  bt.listen(); // 다시 명령을 들을 수 있게
  bool ok = false;
  if (i == 9 && resp[0] == 0xFF && resp[1] == 0x86) {
    byte checksum = 0;
    for (int j = 1; j < 8; j++) checksum += resp[j];
    checksum = 0xFF - checksum + 1;
    ok = (checksum == resp[8]);
  }
  if (!ok) {
    if (++co2Failures >= 3) { mhz19.end(); delay(50); mhz19.begin(9600); bt.listen(); co2Failures = 0; }
    return -1;
  }
  co2Failures = 0;
  return resp[2] * 256 + resp[3];
}

void sendData() {
  int co2 = -1;
  if (co2On && (CO2_POWER_PIN < 0 || (long)(co2WarmUntil - millis()) <= 0)) co2 = readCO2();
  float t[2] = {DEVICE_DISCONNECTED_C, DEVICE_DISCONNECTED_C};
  if (tempOn) {
    tempSensors.requestTemperatures();
    for (int i = 0; i < 2; i++) t[i] = tempSensors.getTempCByIndex(i);
  }
  if (co2 < 0 && t[0] == DEVICE_DISCONNECTED_C && t[1] == DEVICE_DISCONNECTED_C) return; // 보낼 값이 없음

  // 읽기 실패한 센서·연결 안 된 센서는 키를 아예 빼서 보냄 (0으로 보내면 그래프에 가짜 값이 찍힘)
  bool any = false;
  link.print('{');
  if (co2 >= 0) { link.print(F("\"co2\":")); link.print(co2); any = true; }
  for (int i = 0; i < 2; i++) {
    if (t[i] == DEVICE_DISCONNECTED_C) continue;
    if (any) link.print(',');
    link.print(i == 0 ? F("\"temp\":") : F("\"temp2\":"));
    link.print(t[i], 2);
    any = true;
  }
  link.println('}');
}

void setup() {
  Serial.begin(9600); // USB는 확인용 (시리얼 모니터)
  mhz19.begin(9600); // MH-Z19B 자체 통신 속도는 9600 고정
  bt.begin(BT_BAUD);
  bt.listen();
  if (CO2_POWER_PIN >= 0) pinMode(CO2_POWER_PIN, OUTPUT);
  if (TEMP_POWER_PIN >= 0) pinMode(TEMP_POWER_PIN, OUTPUT);
  setCo2Power(true);
  setTempPower(true);
  co2WarmUntil = 0; // 처음 켤 때는 이미 USB 연결 중에 예열됐다고 보고 바로 측정 (MH-Z19B는 켜진 뒤 약 1분은 값이 부정확할 수 있음)
  tempSensors.begin();
  runStart = millis();
  sendInfo();
}

void loop() {
  pollCommands();

  if (running && RUN_MINUTES > 0 && millis() - runStart >= RUN_MINUTES * 60000UL) {
    running = false; // 정해 둔 측정 시간이 끝남
    sendInfo();
  }
  static bool lastWarm = false;
  bool warm = co2On && CO2_POWER_PIN >= 0 && (long)(co2WarmUntil - millis()) > 0;
  if (warm != lastWarm) { lastWarm = warm; sendInfo(); } // 예열이 끝나면 화면의 '예열 중' 표시를 지움

  if (running && millis() - lastSend >= interval) {
    lastSend = millis();
    sendData();
  }
}
