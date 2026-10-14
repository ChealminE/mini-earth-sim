/*
  Mini Earth Model - 표준 코드 · ESP32-DevKitC V4 + WiFi (MQTT) + 블루투스 시리얼 (동시 전송)
  ====================================================================
  SCD30(CO2·온도·습도) + DS18B20(토양 온도)을(를) 읽어서 같은 값을 WiFi(MQTT)로 시뮬레이션에, 클래식 블루투스로 안드로이드 휴대폰('Serial Bluetooth Terminal' 앱)에 동시에 보냅니다.
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
  업로드 전 Arduino IDE > 도구 > Partition Scheme > "Huge APP" (WiFi + 블루투스를 같이 넣으면 기본 공간이 모자랄 수 있음).
  휴대폰은 안드로이드만 됩니다(아이폰은 클래식 블루투스 시리얼 미지원). 휴대폰 설정에서 BT_NAME과 페어링 → 앱의 Devices > Bluetooth Classic.
  WiFi: ESP32는 2.4GHz만 됩니다. MQTT_SERVER에는 화면 '직접 실험' > ⓘ 연결 정보의 주소를 넣으세요.
*/

#include <Wire.h>
#include <Adafruit_SCD30.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <BluetoothSerial.h>

// ===== 사용자 설정 (시뮬레이션 '실험 설계' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "esp32-wifi-bt";               // @설정 보드 이름 | | 화면·MQTT 토픽에 쓰이는 이름 (영문·숫자·- 만). 보드를 여러 대 쓰면 서로 다르게 정하세요
const char* WIFI_SSID = "와이파이이름";          // @설정 와이파이 이름 | | 노트북과 같은 와이파이 (2.4GHz만 됨)
const char* WIFI_PASSWORD = "비밀번호";         // @설정 와이파이 비밀번호 | |
const char* MQTT_SERVER = "192.168.0.10";       // @설정 MQTT 브로커 주소 | | 화면 '연결 정보'에 나온 노트북 주소
const int MQTT_PORT = 1883;                     // @설정 MQTT 포트 | | 보통 1883
const char* BT_NAME = "ESP32_SENSOR";           // @설정 블루투스 이름 | | 휴대폰에서 페어링할 때 보이는 이름. 여러 대면 서로 다르게
const int BT_FORMAT = 1;                        // @설정 휴대폰으로 보낼 형식 | | 1 = 표 형식(CSV, 엑셀로 열기 좋음) / 2 = 보기 좋은 글(측정 번호·경과시간·항목별 줄) / 0 = 시뮬레이션과 같은 JSON
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

WiFiClient net;
PubSubClient mqtt(net);
String topicBase = String("miniearth/") + DEVICE_NAME;
unsigned long lastWifiTry = 0, lastMqttTry = 0;

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  String line;
  for (unsigned int i = 0; i < len; i++) line += (char)payload[i];
  handleCommand(line.c_str());
}

// 와이파이·브로커 연결이 끊기면 몇 초마다 다시 시도 (loop를 멈추지 않게 기다리지 않고 바로 돌아옴)
void keepConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiTry > 10000 || lastWifiTry == 0) {
      lastWifiTry = millis();
      Serial.printf("와이파이 '%s' 연결 시도...\n", WIFI_SSID);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }
  if (mqtt.connected()) return;
  if (millis() - lastMqttTry < 5000 && lastMqttTry != 0) return;
  lastMqttTry = millis();
  Serial.printf("MQTT 브로커 %s:%d 연결 시도 (내 주소 %s)...\n", MQTT_SERVER, MQTT_PORT, WiFi.localIP().toString().c_str());
  // Last Will: 전원이 갑자기 꺼지면 브로커가 대신 "offline"을 알려 줌 → 화면에 '연결 끊김'
  if (mqtt.connect(DEVICE_NAME, (topicBase + "/status").c_str(), 0, true, "offline")) {
    Serial.println("MQTT 연결됨");
    mqtt.publish((topicBase + "/status").c_str(), "online", true);
    mqtt.subscribe((topicBase + "/cmd").c_str());
    sendInfo();
  } else {
    Serial.printf("MQTT 연결 실패 (상태 %d) - 주소·방화벽을 확인하세요\n", mqtt.state());
  }
}

BluetoothSerial SerialBT;
bool btHadClient = false;
unsigned long measurementCount = 0;

// 이번에 모은 값 중 key의 값 (없으면 빈칸) - 휴대폰용 표 형식에 씀
String fieldOf(const char* key) {
  for (byte i = 0; i < outN; i++) if (strcmp(outKey[i], key) == 0) return String(outVal[i], (unsigned int)outDec[i]);
  return "";
}

String hhmmss(unsigned long sec) {
  char b[16];
  snprintf(b, sizeof(b), "%02lu:%02lu:%02lu", sec / 3600, (sec % 3600) / 60, sec % 60);
  return String(b);
}

void sendBtHeader() {
  if (BT_FORMAT == 1) SerialBT.println("elapsed_s,co2,temp,hum,soil_temp,soil_temp2");
  if (BT_FORMAT == 2) SerialBT.println("측정 시작 - SCD30 + DS18B20");
}

void emitLine(const String& json, bool isInfo) {
  // 같은 측정값을 두 곳으로: WiFi(MQTT) → 시뮬레이션, 블루투스 → 휴대폰
  if (mqtt.connected()) mqtt.publish((topicBase + (isInfo ? "/info" : "/data")).c_str(), json.c_str());
  Serial.println(json);
  if (isInfo || !SerialBT.hasClient()) return;
  unsigned long sec = (millis() - runStart) / 1000;
  if (BT_FORMAT == 1) {
    String line = String(sec);
    line += ","; line += fieldOf("co2");
    line += ","; line += fieldOf("temp");
    line += ","; line += fieldOf("hum");
    line += ","; line += fieldOf("soil_temp");
    line += ","; line += fieldOf("soil_temp2");
    SerialBT.println(line);
  } else if (BT_FORMAT == 2) {
    measurementCount++;
    char no[8]; snprintf(no, sizeof(no), "%03lu", measurementCount);
    SerialBT.println("============================================================");
    SerialBT.println(String("[측정 ") + no + "] 경과시간: " + hhmmss(sec));
    for (byte i = 0; i < outN; i++) SerialBT.println(String(outLabel[i]) + " = " + String(outVal[i], (unsigned int)outDec[i]) + " " + outUnit[i]);
    SerialBT.println("------------------------------------------------------------");
  } else {
    SerialBT.println(json);
  }
}

// 휴대폰 앱에서 보낸 글자를 모아 한 줄이 되면 명령으로 처리 (화면 명령과 같은 형식)
String btCmdBuf;
void pollBluetooth() {
  bool has = SerialBT.hasClient();
  if (has && !btHadClient) sendBtHeader(); // 휴대폰이 새로 연결되면 머리줄부터
  btHadClient = has;
  while (SerialBT.available()) {
    char c = SerialBT.read();
    if (c == '\n' || c == '\r') {
      if (btCmdBuf.length()) { handleCommand(btCmdBuf.c_str()); btCmdBuf = ""; }
    } else if (btCmdBuf.length() < 200) {
      btCmdBuf += c;
    }
  }
}

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  String s = "{\"_type\":\"info\",\"dev\":\"";
  s += DEVICE_NAME;
  s += "\",\"board\":\"ESP32-DevKitC V4\",\"link\":\"mqtt+bt\",\"fw\":\"std-1\",\"interval\":";
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
    mqtt.publish((topicBase + "/status").c_str(), "offline", true);
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
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setBufferSize(512); // 보드 정보 JSON이 기본 크기(256바이트)보다 길어서 늘림
  mqtt.setCallback(onMqttMessage);
  keepConnected();
  SerialBT.begin(BT_NAME); // 클래식 블루투스 시작 (휴대폰에서 페어링해서 연결)
}

void loop() {
  keepConnected();
  mqtt.loop();
  pollBluetooth();
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
