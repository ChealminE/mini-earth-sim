/*
  Mini Earth Model - 표준 코드 · ESP32-DevKitC V4 + BLE
  ====================================================================
  SCD30(CO2·온도·습도) + DS18B20(토양 온도)을(를) 읽어서 BLE notify로 JSON 한 줄씩 보냅니다 (HM-10과 같은 UUID, 서버를 --ble 로 켜기).
  시뮬레이션 화면(직접 실험 탭)에서 이 보드에 명령을 보낼 수 있습니다:
    - 센서별 켜기/끄기   - 측정 간격 바꾸기   - 측정 멈춤/재개   - 재부팅

  보내는 값:  {"co2":812,"temp":24.61,"hum":48.20,"soil_temp":19.88}   (키: co2, temp, hum, soil_temp, soil_temp2)
  받는 명령:  {"cmd":"sensor","id":"scd30","on":0}   {"cmd":"interval","ms":10000}
              {"cmd":"run","on":0}   {"cmd":"reboot"}   {"cmd":"info"}

  라이브러리 (Arduino IDE 라이브러리 매니저에서 설치): Adafruit SCD30 (Adafruit BusIO·Adafruit Unified Sensor도 같이 설치), OneWire, DallasTemperature

  배선 (ESP32는 3.3V 보드):
    - SCD30 (I2C): VIN → 3.3V, GND → GND, SDA → GPIO21, SCL → GPIO22
    - DS18B20: VCC → 3.3V, GND → GND, DATA → GPIO4 (+ DATA와 3.3V 사이 4.7kΩ 풀업 저항)

  센서 "끄기": 전원 핀(..._POWER_PIN)을 -1로 두면 측정만 멈추고, 지정하면 그 핀을 LOW로 내려 전원을 실제로 끊습니다.
    SCD30은 평균 19mA·순간 최대 75mA라 MOSFET·릴레이 모듈을 거치세요 (DS18B20은 GPIO에 바로 꽂아도 됨).
  서버를 run_server.bat 대신 `python server.py --ble` 로 켜세요. 서버는 이름에 'MiniEarth'가 들어간 기기를 찾습니다.
*/

#include <Wire.h>
#include <Adafruit_SCD30.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ===== 사용자 설정 (시뮬레이션 '실험 설계' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "MiniEarth-ESP32";             // @설정 보드 이름 | | BLE로 보이는 이름. 서버가 'MiniEarth'가 들어간 이름을 찾으므로 MiniEarth로 시작하게 두세요
const unsigned long SEND_INTERVAL_MS = 10000;   // @설정 측정·전송 간격 | ms | 10000 = 10초, 60000 = 1분 (실험 중에 화면에서도 바꿀 수 있음)
const unsigned long RUN_MINUTES = 0;            // @설정 측정 시간 | 분 | 이 시간이 지나면 보드가 스스로 측정을 멈춥니다. 0이면 멈추지 않음
const int SDA_PIN = 21;                         // @설정 SCD30 SDA 핀 | GPIO | I2C 데이터 선
const int SCL_PIN = 22;                         // @설정 SCD30 SCL 핀 | GPIO | I2C 클록 선
const int SCD30_INTERVAL_S = 2;                 // @설정 SCD30 내부 측정 간격 | 초 | SCD30이 스스로 값을 새로 재는 주기 (2~1800). 전송 간격보다 짧게
const int SCD30_POWER_PIN = -1;                 // @설정 SCD30 전원 스위치 핀 | | MOSFET·릴레이 모듈 제어 핀. 없으면 -1 (끄기 = 측정만 멈춤)
const int ONE_WIRE_PIN = 4;                     // @설정 DS18B20 데이터 핀 | GPIO | 데이터 핀과 3.3V 사이에 4.7kΩ 풀업 저항 필요
const int SOIL_POWER_PIN = -1;                  // @설정 DS18B20 전원 핀 | | VCC를 꽂은 디지털 핀 (전류가 작아 바로 꽂아도 됨). 없으면 -1

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

#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"
BLECharacteristic* bleChar = nullptr;
volatile bool bleConnected = false;
String bleRx; // BLE 콜백에서 받은 글자 (loop에서 처리 - 콜백 안에서 오래 일하면 BLE가 끊길 수 있음)

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override { bleConnected = true; }
  void onDisconnect(BLEServer* server) override {
    bleConnected = false;
    server->getAdvertising()->start(); // 끊기면 다시 광고해서 서버가 재접속할 수 있게
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto v = c->getValue();
    for (size_t i = 0; i < v.length(); i++) bleRx += (char)v[i];
  }
};

// notify는 한 번에 20바이트까지만 확실히 가므로 잘라서 보내고, 줄 끝(\n)으로 한 덩어리임을 알린다
void emitLine(const String& json, bool isInfo) {
  Serial.println(json);
  if (!bleConnected) return;
  String s = json + "\n";
  for (size_t i = 0; i < s.length(); i += 20) {
    String part = s.substring(i, i + 20);
    bleChar->setValue((uint8_t*)part.c_str(), part.length());
    bleChar->notify();
    delay(10);
  }
}

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  String s = "{\"_type\":\"info\",\"dev\":\"";
  s += DEVICE_NAME;
  s += "\",\"board\":\"ESP32-DevKitC V4\",\"link\":\"ble\",\"fw\":\"std-1\",\"interval\":";
  s += interval;
  s += ",\"run\":";
  s += running ? 1 : 0;
  s += ",\"sensors\":[";
  s += "{\"id\":\"scd30\",\"name\":\"SCD30\",\"keys\":[\"co2\",\"temp\",\"hum\"],\"on\":";
  s += scd30On ? 1 : 0;
  s += ",\"pwr\":"; s += SCD30_POWER_PIN >= 0 ? 1 : 0;
  s += ",\"warm\":"; s += (scd30Warming()) ? 1 : 0;
  s += "}";
  s += ",{\"id\":\"soil\",\"name\":\"DS18B20\",\"keys\":[\"soil_temp\",\"soil_temp2\"],\"on\":";
  s += soilOn ? 1 : 0;
  s += ",\"pwr\":"; s += SOIL_POWER_PIN >= 0 ? 1 : 0;
  s += ",\"warm\":"; s += (false) ? 1 : 0;
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
    else if (jsonIs(line, "id", "soil")) soilSetPower(on);
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
  if (soilOn) {
    ds18b20.requestTemperatures();
    float t0 = ds18b20.getTempCByIndex(0), t1 = ds18b20.getTempCByIndex(1);
    if (t0 != DEVICE_DISCONNECTED_C) addNum("soil_temp", t0, 2, "Soil Temp", "C");
    if (t1 != DEVICE_DISCONNECTED_C) addNum("soil_temp2", t1, 2, "Soil Temp 2", "C");
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
  Serial.begin(115200);
  Wire.begin(SDA_PIN, SCL_PIN);
  if (SCD30_POWER_PIN >= 0) { pinMode(SCD30_POWER_PIN, OUTPUT); digitalWrite(SCD30_POWER_PIN, HIGH); delay(100); }
  scd30Begin();
  if (SOIL_POWER_PIN >= 0) { pinMode(SOIL_POWER_PIN, OUTPUT); digitalWrite(SOIL_POWER_PIN, HIGH); delay(50); }
  ds18b20.begin();
  runStart = millis();
  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);
  bleChar = service->createCharacteristic(CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY |
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  bleChar->addDescriptor(new BLE2902()); // notify 구독을 위해 필수
  bleChar->setCallbacks(new CharCallbacks());
  service->start();
  BLEDevice::getAdvertising()->addServiceUUID(SERVICE_UUID);
  BLEDevice::getAdvertising()->start();
}

void loop() {
  static bool wasConnected = false;
  if (bleConnected && !wasConnected) { delay(300); sendInfo(); } // 서버가 붙으면 보드 정보부터
  wasConnected = bleConnected;
  while (bleRx.length()) { char c = bleRx[0]; bleRx.remove(0, 1); feedCommandChar(c); }
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
