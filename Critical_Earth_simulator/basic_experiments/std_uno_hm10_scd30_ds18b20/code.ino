/*
  Mini Earth Model - 표준 코드 · 우노 R3 + HM-10 (BLE)
  ====================================================================
  SCD30(CO2·온도·습도) + DS18B20(토양 온도)을(를) 읽어서 HM-10 모듈로 JSON 한 줄씩 보냅니다 (서버를 --ble 로 켜기, HM-10 기본 이름은 HMSoft → --ble-name HMSoft).
  시뮬레이션 화면(직접 실험 탭)에서 이 보드에 명령을 보낼 수 있습니다:
    - 센서별 켜기/끄기   - 측정 간격 바꾸기   - 측정 멈춤/재개   - 재부팅

  보내는 값:  {"co2":812,"temp":24.61,"hum":48.20,"soil_temp":19.88}   (키: co2, temp, hum, soil_temp, soil_temp2)
  받는 명령:  {"cmd":"sensor","id":"scd30","on":0}   {"cmd":"interval","ms":10000}
              {"cmd":"run","on":0}   {"cmd":"reboot"}   {"cmd":"info"}

  라이브러리 (Arduino IDE 라이브러리 매니저에서 설치): Adafruit SCD30 (Adafruit BusIO·Adafruit Unified Sensor도 같이 설치), OneWire, DallasTemperature

  센서 "끄기": 전원 핀(..._POWER_PIN)을 -1로 두면 측정만 멈추고, 지정하면 그 핀을 LOW로 내려 전원을 실제로 끊습니다.
    SCD30은 평균 19mA·순간 최대 75mA라 MOSFET·릴레이 모듈을 거치세요 (DS18B20은 핀에 바로 꽂아도 됨).
  SCD30 배선(I2C): VIN → 5V, GND → GND, SDA → A4, SCL → A5
  HM-10 RX는 3.3V용입니다 - 우노 TX(핀 BT_TX_PIN) → 1kΩ → RX, RX → 2kΩ → GND 로 분압하세요.
*/

#include <SoftwareSerial.h>
#include <Wire.h>
#include <Adafruit_SCD30.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <avr/wdt.h>

// ===== 사용자 설정 (시뮬레이션 '실험 설계' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "uno-hm10";            // @설정 보드 이름 | | 화면에 표시될 이름. 보드를 여러 대 쓰면 서로 다르게 정하세요
const unsigned long SEND_INTERVAL_MS = 10000;   // @설정 측정·전송 간격 | ms | 10000 = 10초, 60000 = 1분 (실험 중에 화면에서도 바꿀 수 있음)
const unsigned long RUN_MINUTES = 0;            // @설정 측정 시간 | 분 | 이 시간이 지나면 보드가 스스로 측정을 멈춥니다. 0이면 멈추지 않음
const int SCD30_INTERVAL_S = 2;                 // @설정 SCD30 내부 측정 간격 | 초 | SCD30이 스스로 값을 새로 재는 주기 (2~1800). 전송 간격보다 짧게
const int SCD30_POWER_PIN = -1;                 // @설정 SCD30 전원 스위치 핀 | | MOSFET·릴레이 모듈 제어 핀. 없으면 -1 (끄기 = 측정만 멈춤)
const int ONE_WIRE_PIN = 2;                     // @설정 DS18B20 데이터 핀 |  | 데이터 핀과 5V 사이에 4.7kΩ 풀업 저항 필요
const int SOIL_POWER_PIN = -1;                  // @설정 DS18B20 전원 핀 | | VCC를 꽂은 디지털 핀 (전류가 작아 바로 꽂아도 됨). 없으면 -1
const int BT_RX_PIN = 10;                       // @설정 HM-10의 TX가 꽂힌 우노 핀 | | 모듈 TX → 이 핀
const int BT_TX_PIN = 11;                       // @설정 HM-10의 RX가 꽂힌 우노 핀 | | 모듈 RX ← 이 핀 (저항 분배 필수)
const long BT_BAUD = 9600;                      // @설정 HM-10 통신 속도 | bps | 모듈 기본값 9600

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
// DS18B20 (토양 온도, 1-Wire) - 한 선에 2개까지 soil_temp, soil_temp2
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature ds18b20(&oneWire);
bool soilOn = true;

void soilSetPower(bool on) {
  soilOn = on;
  if (SOIL_POWER_PIN < 0) return;
  digitalWrite(SOIL_POWER_PIN, on ? HIGH : LOW);
  if (on) { delay(50); ds18b20.begin(); } // 전원이 다시 들어오면 센서를 새로 찾아야 함
}

unsigned long interval = SEND_INTERVAL_MS;
bool running = true;
unsigned long runStart = 0, lastSend = 0;
SoftwareSerial bt(BT_RX_PIN, BT_TX_PIN);
Stream& link = bt; // 값을 보내고 명령을 받는 통로 (이 코드에서는 HM-10)

// ── 이번에 보낼 값 모으기 (센서별로 addNum → 마지막에 한 번에 JSON 한 줄) ──
const byte MAX_OUT = 8;
const char* outKey[MAX_OUT]; const char* outLabel[MAX_OUT]; const char* outUnit[MAX_OUT];
float outVal[MAX_OUT]; byte outDec[MAX_OUT]; byte outN = 0;
void addNum(const char* key, float v, byte dec, const char* label, const char* unit) {
  if (isnan(v) || outN >= MAX_OUT) return; // 읽기 실패한 값은 아예 빼서 보냄 (0으로 보내면 그래프에 가짜 값)
  outKey[outN] = key; outVal[outN] = v; outDec[outN] = dec; outLabel[outN] = label; outUnit[outN] = unit; outN++;
}

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  link.print(F("{\"_type\":\"info\",\"dev\":\""));
  link.print(DEVICE_NAME);
  link.print(F("\",\"board\":\"Arduino Uno R3\",\"link\":\"ble\",\"fw\":\"std-1\",\"interval\":"));
  link.print(interval);
  link.print(F(",\"run\":"));
  link.print(running ? 1 : 0);
  link.print(F(",\"sensors\":["));
  link.print(F("{\"id\":\"scd30\",\"name\":\"SCD30\",\"keys\":[\"co2\",\"temp\",\"hum\"],\"on\":"));
  link.print(scd30On ? 1 : 0);
  link.print(F(",\"pwr\":")); link.print(SCD30_POWER_PIN >= 0 ? 1 : 0);
  link.print(F(",\"warm\":")); link.print((scd30Warming()) ? 1 : 0);
  link.print('}');
  link.print(F(",{\"id\":\"soil\",\"name\":\"DS18B20\",\"keys\":[\"soil_temp\",\"soil_temp2\"],\"on\":"));
  link.print(soilOn ? 1 : 0);
  link.print(F(",\"pwr\":")); link.print(SOIL_POWER_PIN >= 0 ? 1 : 0);
  link.print(F(",\"warm\":")); link.print((false) ? 1 : 0);
  link.print('}');
  link.println(F("]}"));
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
  if (jsonIs(line, "cmd", "sensor")) {
    bool on = jsonNum(line, "on", 1) != 0;
    if (jsonIs(line, "id", "scd30")) scd30SetPower(on);
    else if (jsonIs(line, "id", "soil")) soilSetPower(on);
  } else if (jsonIs(line, "cmd", "interval")) {
    long ms = jsonNum(line, "ms", interval);
    if (ms >= 200) interval = ms;
  } else if (jsonIs(line, "cmd", "run")) {
    running = jsonNum(line, "on", 1) != 0;
    if (running) runStart = millis(); // 다시 켜면 측정 시간을 처음부터 잼
  } else if (jsonIs(line, "cmd", "reboot")) {
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

void sendData() {
  outN = 0;
  // 최근 값이 너무 오래됐으면(센서가 빠졌거나 꺼짐) 키를 빼서 그래프에 옛날 값이 계속 찍히지 않게
  if (scd30On && scd30ReadAt && millis() - scd30ReadAt < (unsigned long)SCD30_INTERVAL_S * 3000UL + 2000UL) {
    addNum("co2", scdCo2, 0, "CO2", "ppm");
    addNum("temp", scdTemp, 2, "SCD30 Temp", "C");
    addNum("hum", scdHum, 2, "Humidity", "%");
  }
  if (soilOn) {
    ds18b20.requestTemperatures();
    float t0 = ds18b20.getTempCByIndex(0), t1 = ds18b20.getTempCByIndex(1);
    if (t0 != DEVICE_DISCONNECTED_C) addNum("soil_temp", t0, 2, "Soil Temp", "C");
    if (t1 != DEVICE_DISCONNECTED_C) addNum("soil_temp2", t1, 2, "Soil Temp 2", "C");
  }
  if (outN == 0) return; // 보낼 값이 없음
  link.print('{');
  for (byte i = 0; i < outN; i++) {
    if (i) link.print(',');
    link.print('"'); link.print(outKey[i]); link.print(F("\":"));
    link.print(outVal[i], outDec[i]);
  }
  link.println('}');
}

void setup() {
  bt.begin(BT_BAUD);
  Wire.begin();
  if (SCD30_POWER_PIN >= 0) { pinMode(SCD30_POWER_PIN, OUTPUT); digitalWrite(SCD30_POWER_PIN, HIGH); delay(100); }
  scd30Begin();
  if (SOIL_POWER_PIN >= 0) { pinMode(SOIL_POWER_PIN, OUTPUT); digitalWrite(SOIL_POWER_PIN, HIGH); delay(50); }
  ds18b20.begin();
  runStart = millis();
  sendInfo();
}

void loop() {
  pollCommands();
  scd30Poll();

  if (running && RUN_MINUTES > 0 && millis() - runStart >= RUN_MINUTES * 60000UL) {
    running = false; // 정해 둔 측정 시간이 끝남
    sendInfo();
  }
  static bool lastWarm = false;
  bool warm = scd30Warming() || false;
  if (warm != lastWarm) { lastWarm = warm; sendInfo(); } // 예열이 끝나면 화면의 '예열 중' 표시를 지움

  if (running && millis() - lastSend >= interval) {
    lastSend = millis();
    sendData();
  }
}
