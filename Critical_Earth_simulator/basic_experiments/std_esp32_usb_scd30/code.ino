/*
  Mini Earth Model - 표준 코드 · ESP32-DevKitC V4 + USB 케이블
  ====================================================================
  SCD30(CO2·온도·습도)을(를) 읽어서 USB로 JSON 한 줄씩 보냅니다 (케이블을 꽂으면 서버가 자동으로 찾음).
  시뮬레이션 화면(직접 실험 탭)에서 이 보드에 명령을 보낼 수 있습니다:
    - 센서별 켜기/끄기   - 측정 간격 바꾸기   - 측정 멈춤/재개   - 재부팅

  보내는 값:  {"co2":812,"temp":24.61,"hum":48.20}   (키: co2, temp, hum)
  받는 명령:  {"cmd":"sensor","id":"scd30","on":0}   {"cmd":"interval","ms":10000}
              {"cmd":"run","on":0}   {"cmd":"reboot"}   {"cmd":"info"}

  라이브러리 (Arduino IDE 라이브러리 매니저에서 설치): Adafruit SCD30 (Adafruit BusIO·Adafruit Unified Sensor도 같이 설치)

  배선 (ESP32는 3.3V 보드):
    - SCD30 (I2C): VIN → 3.3V, GND → GND, SDA → GPIO21, SCL → GPIO22

  센서 "끄기": 전원 핀(..._POWER_PIN)을 -1로 두면 측정만 멈추고, 지정하면 그 핀을 LOW로 내려 전원을 실제로 끊습니다.
    SCD30은 평균 19mA·순간 최대 75mA라 MOSFET·릴레이 모듈을 거치세요 (DS18B20은 GPIO에 바로 꽂아도 됨).
  BAUD_RATE(9600)가 server.py의 --baud 값과 같아야 합니다. 업로드할 때는 서버·시리얼 모니터를 꺼 두세요.
*/

#include <Wire.h>
#include <Adafruit_SCD30.h>

// ===== 사용자 설정 (시뮬레이션 '실험 설계' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "esp32-usb";                   // @설정 보드 이름 | | 화면·MQTT 토픽에 쓰이는 이름 (영문·숫자·- 만). 보드를 여러 대 쓰면 서로 다르게 정하세요
const long BAUD_RATE = 9600;                    // @설정 USB 통신 속도 | bps | server.py의 --baud 값과 같아야 합니다 (기본 9600)
const unsigned long SEND_INTERVAL_MS = 10000;   // @설정 측정·전송 간격 | ms | 10000 = 10초, 60000 = 1분 (실험 중에 화면에서도 바꿀 수 있음)
const unsigned long RUN_MINUTES = 0;            // @설정 측정 시간 | 분 | 이 시간이 지나면 보드가 스스로 측정을 멈춥니다. 0이면 멈추지 않음
const int SDA_PIN = 21;                         // @설정 SCD30 SDA 핀 | GPIO | I2C 데이터 선
const int SCL_PIN = 22;                         // @설정 SCD30 SCL 핀 | GPIO | I2C 클록 선
const int SCD30_INTERVAL_S = 2;                 // @설정 SCD30 내부 측정 간격 | 초 | SCD30이 스스로 값을 새로 재는 주기 (2~1800). 전송 간격보다 짧게
const int SCD30_POWER_PIN = -1;                 // @설정 SCD30 전원 스위치 핀 | | MOSFET·릴레이 모듈 제어 핀. 없으면 -1 (끄기 = 측정만 멈춤)

// SCD30 (CO2·온도·습도, I2C) - 값은 loop()에서 준비될 때마다 읽어 두고, 보낼 때 최근 값을 쓴다
Adafruit_SCD30 scd30;
bool scd30Ok = false, scd30On = true;
float scdCo2 = NAN, scdTemp = NAN, scdHum = NAN;
unsigned long scd30ReadAt = 0, scd30WarmUntil = 0;

bool scd30Warming() { return scd30On && SCD30_POWER_PIN >= 0 && (long)(scd30WarmUntil - millis()) > 0; }

void scd30Begin() {
  scd30Ok = scd30.begin();
  if (scd30Ok) scd30.setMeasurementInterval(SCD30_INTERVAL_S);
}

void scd30SetPower(bool on) {
  scd30On = on;
  if (SCD30_POWER_PIN < 0) return;
  digitalWrite(SCD30_POWER_PIN, on ? HIGH : LOW);
  if (on) { delay(100); scd30Begin(); scd30WarmUntil = millis() + 10000UL; } // 다시 켜면 첫 값이 나오기까지 몇 초
}

void scd30Poll() {
  if (!scd30On || !scd30Ok || scd30Warming()) return;
  if (scd30.dataReady() && scd30.read()) {
    scdCo2 = scd30.CO2; scdTemp = scd30.temperature; scdHum = scd30.relative_humidity;
    scd30ReadAt = millis();
  }
}

unsigned long interval = SEND_INTERVAL_MS;
bool running = true;
unsigned long runStart = 0, lastSend = 0;

void handleCommand(const char* line);
void sendInfo();
// ── 이번에 보낼 값 모으기 (센서별로 addNum → 마지막에 한 번에 JSON 한 줄) ──
const byte MAX_OUT = 8;
const char* outKey[MAX_OUT]; const char* outLabel[MAX_OUT]; const char* outUnit[MAX_OUT];
float outVal[MAX_OUT]; byte outDec[MAX_OUT]; byte outN = 0;
void addNum(const char* key, float v, byte dec, const char* label, const char* unit) {
  if (isnan(v) || outN >= MAX_OUT) return; // 읽기 실패한 값은 아예 빼서 보냄 (0으로 보내면 그래프에 가짜 값)
  outKey[outN] = key; outVal[outN] = v; outDec[outN] = dec; outLabel[outN] = label; outUnit[outN] = unit; outN++;
}

// 통로에서 글자를 모아 한 줄(\n)이 되면 명령으로 처리
String cmdBuf;
void feedCommandChar(char c) {
  if (c == '\n' || c == '\r') {
    if (cmdBuf.length()) { handleCommand(cmdBuf.c_str()); cmdBuf = ""; }
  } else if (cmdBuf.length() < 200) {
    cmdBuf += c;
  }
}

void emitLine(const String& json, bool isInfo) { Serial.println(json); }

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  String s = "{\"_type\":\"info\",\"dev\":\"";
  s += DEVICE_NAME;
  s += "\",\"board\":\"ESP32-DevKitC V4\",\"link\":\"usb\",\"fw\":\"std-1\",\"interval\":";
  s += interval;
  s += ",\"run\":";
  s += running ? 1 : 0;
  s += ",\"sensors\":[";
  s += "{\"id\":\"scd30\",\"name\":\"SCD30\",\"keys\":[\"co2\",\"temp\",\"hum\"],\"on\":";
  s += scd30On ? 1 : 0;
  s += ",\"pwr\":"; s += SCD30_POWER_PIN >= 0 ? 1 : 0;
  s += ",\"warm\":"; s += (scd30Warming()) ? 1 : 0;
  s += "}";
  s += "]}";
  emitLine(s, true);
}

// ── 명령 한 줄에서 값 꺼내기 (ArduinoJson 없이 - 우노 메모리가 2KB뿐이라 모든 표준 코드가 같은 방식) ──
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
  Serial.print("명령 받음: ");
  Serial.println(line);
  if (jsonIs(line, "cmd", "sensor")) {
    bool on = jsonNum(line, "on", 1) != 0;
    if (jsonIs(line, "id", "scd30")) scd30SetPower(on);
  } else if (jsonIs(line, "cmd", "interval")) {
    long ms = jsonNum(line, "ms", interval);
    if (ms >= 200) interval = ms;
  } else if (jsonIs(line, "cmd", "run")) {
    running = jsonNum(line, "on", 1) != 0;
    if (running) runStart = millis(); // 다시 켜면 측정 시간을 처음부터 잼
  } else if (jsonIs(line, "cmd", "reboot")) {
    delay(200);
    ESP.restart();
  } else if (!jsonIs(line, "cmd", "info")) {
    return; // 모르는 명령은 무시
  }
  sendInfo(); // 바뀐 상태를 화면에 알림
}

void sendData() {
  outN = 0;
  // 최근 값이 너무 오래됐으면(센서가 빠졌거나 꺼짐) 키를 빼서 그래프에 옛날 값이 계속 찍히지 않게
  if (scd30On && scd30ReadAt && millis() - scd30ReadAt < (unsigned long)SCD30_INTERVAL_S * 3000UL + 2000UL) {
    addNum("co2", scdCo2, 0, "CO2", "ppm");
    addNum("temp", scdTemp, 2, "SCD30 Temp", "C");
    addNum("hum", scdHum, 2, "Humidity", "%");
  }
  if (outN == 0) return; // 보낼 값이 없음
  String s = "{";
  for (byte i = 0; i < outN; i++) {
    if (i) s += ",";
    s += "\""; s += outKey[i]; s += "\":";
    s += String(outVal[i], (unsigned int)outDec[i]);
  }
  s += "}";
  emitLine(s, false);
}

void setup() {
  Serial.begin(BAUD_RATE);
  Wire.begin(SDA_PIN, SCL_PIN);
  if (SCD30_POWER_PIN >= 0) { pinMode(SCD30_POWER_PIN, OUTPUT); digitalWrite(SCD30_POWER_PIN, HIGH); delay(100); }
  scd30Begin();
  runStart = millis();
  sendInfo();
}

void loop() {
  while (Serial.available()) feedCommandChar(Serial.read());
  scd30Poll();

  if (running && RUN_MINUTES > 0 && millis() - runStart >= RUN_MINUTES * 60000UL) {
    running = false; // 정해 둔 측정 시간이 끝남
    sendInfo();
  }
  static bool lastWarm = false;
  bool warm = scd30Warming();
  if (warm != lastWarm) { lastWarm = warm; sendInfo(); } // 예열이 끝나면 화면의 '예열 중' 표시를 지움

  if (running && millis() - lastSend >= interval) {
    lastSend = millis();
    sendData();
  }
}
