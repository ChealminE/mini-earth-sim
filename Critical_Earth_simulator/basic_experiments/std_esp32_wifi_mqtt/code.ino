/*
  Mini Earth Model - 표준 코드 · ESP32-DevKitC V4 + WiFi (MQTT)
  ====================================================================
  CO2(MH-Z19B) + 온도(DS18B20, 1~2개)를 읽어서 WiFi로 MQTT 브로커에 발행합니다.
  브로커는 server.py 안에 내장돼 있어서 따로 설치할 필요가 없습니다 (Mosquitto를 쓰고 있으면 그것도 됨).
  토픽:  miniearth/<보드 이름>/data · /info · /status(online/offline) ← 보드가 발행
         miniearth/<보드 이름>/cmd                                 ← 보드가 구독 (화면의 명령)
  시뮬레이션 화면(직접 실험 탭)에서 이 보드에 명령을 보낼 수 있습니다:
    - 센서별 켜기/끄기   - 측정 간격 바꾸기   - 측정 멈춤/재개   - 재부팅

  보내는 값:  {"co2":812,"temp":24.06,"temp2":23.81}
  보드 정보:  {"_type":"info","dev":"...", ... "sensors":[...]}  (켜질 때, 명령을 받을 때마다)
  받는 명령:  {"cmd":"sensor","id":"co2","on":0}   {"cmd":"interval","ms":5000}
              {"cmd":"run","on":0}   {"cmd":"reboot"}   {"cmd":"info"}

  준비:
    - Arduino IDE > 보드 매니저 > "esp32" (Espressif) 설치, 보드는 "ESP32 Dev Module" 선택
    - 라이브러리 매니저: OneWire, DallasTemperature, PubSubClient (Nick O'Leary)

  배선 (ESP32는 3.3V 보드):
    - MH-Z19B: VIN → 5V(VIN 핀), GND → GND, TX → GPIO16, RX → GPIO17
    - DS18B20: VCC → 3.3V, GND → GND, DATA → GPIO4 (+ DATA와 3.3V 사이 4.7kΩ 풀업 저항)

  센서 "끄기"는 두 가지로 동작합니다:
    - 전원 핀(..._POWER_PIN)을 -1로 두면: 측정만 멈춤 (전원은 계속 들어감)
    - 전원 핀을 지정하면: 그 핀을 LOW로 내려 센서 전원을 실제로 끊음
      · DS18B20은 전류가 아주 작아서 VCC를 GPIO 핀에 바로 꽂아도 됩니다.
      · MH-Z19B는 최대 약 150mA라 GPIO에 바로 꽂으면 안 됩니다. MOSFET·릴레이 모듈을 거치세요.
      · MH-Z19B는 전원을 다시 켜면 예열 시간(CO2_WARMUP_MS) 동안 값을 보내지 않습니다.

  WiFi 주의:
    - ESP32는 2.4GHz 와이파이만 됩니다 (5GHz 안 됨). 노트북과 같은 와이파이에 연결하세요.
    - MQTT_SERVER에는 시뮬레이션 화면 '직접 실험' > ⓘ 연결 정보에 나온 주소를 넣으세요.
    - 학교 와이파이는 기기끼리 통신을 막아 둔 경우가 많습니다. 안 되면 휴대폰 핫스팟에 둘 다 연결해 보세요.
    - 윈도우 방화벽이 1883 포트를 막으면 붙지 않습니다 (처음 server.py를 켤 때 '허용'을 누르세요).
*/

#include <OneWire.h>
#include <DallasTemperature.h>
#include <WiFi.h>
#include <PubSubClient.h>

// ===== 사용자 설정 (시뮬레이션 '기본 실험' 화면에서 바꿔서 받을 수 있어요) =====
const char* DEVICE_NAME = "esp32-wifi";                  // @설정 보드 이름 | | MQTT 토픽에 들어가는 이름 (영문·숫자·- 만). 보드를 여러 대 쓰면 서로 다르게 정하세요
const char* WIFI_SSID = "와이파이이름";          // @설정 와이파이 이름 | | 노트북과 같은 와이파이 (2.4GHz만 됨)
const char* WIFI_PASSWORD = "비밀번호";         // @설정 와이파이 비밀번호 | |
const char* MQTT_SERVER = "192.168.0.10";       // @설정 MQTT 브로커 주소 | | 화면 '연결 정보'에 나온 노트북 주소
const int MQTT_PORT = 1883;                     // @설정 MQTT 포트 | | 보통 1883
const unsigned long SEND_INTERVAL_MS = 5000;    // @설정 측정·전송 간격 | ms | 1000 = 1초. MH-Z19B는 약 5초마다 값이 새로 나오므로 5000 이상 권장 (실험 중에 화면에서도 바꿀 수 있음)
const unsigned long RUN_MINUTES = 0;            // @설정 측정 시간 | 분 | 이 시간이 지나면 보드가 스스로 측정을 멈춥니다. 0이면 멈추지 않음
const int MH_RX_PIN = 16;                       // @설정 MH-Z19B의 TX가 꽂힌 핀 | GPIO | 센서 TX → 이 핀
const int MH_TX_PIN = 17;                       // @설정 MH-Z19B의 RX가 꽂힌 핀 | GPIO | 센서 RX ← 이 핀
const int ONE_WIRE_PIN = 4;                     // @설정 DS18B20 데이터 핀 | GPIO | 데이터 핀과 3.3V 사이에 4.7kΩ 풀업 저항 필요
const int CO2_POWER_PIN = -1;                   // @설정 CO2 센서 전원 스위치 핀 | GPIO | MOSFET·릴레이 모듈 제어 핀. 없으면 -1 (끄기 = 측정만 멈춤)
const int TEMP_POWER_PIN = -1;                  // @설정 온도 센서 전원 핀 | GPIO | DS18B20 VCC를 꽂은 GPIO. 없으면 -1
const unsigned long CO2_WARMUP_MS = 60000;      // @설정 CO2 센서 예열 시간 | ms | 전원 핀으로 다시 켰을 때 이 시간 동안은 값을 보내지 않음

// ===== 센서 =====
HardwareSerial mhzSerial(2); // ESP32는 하드웨어 시리얼이 3개라 SoftwareSerial이 필요 없음
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature tempSensors(&oneWire);
const byte READ_CO2_CMD[9] = {0xFF, 0x01, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00, 0x79};

// 센서 상태 (화면 명령으로 바뀜)
bool co2On = true, tempOn = true;
unsigned long co2WarmUntil = 0;
unsigned long interval = SEND_INTERVAL_MS;
bool running = true;
unsigned long runStart = 0;
unsigned long lastSend = 0;

void handleCommand(const char* line);
void sendInfo();

WiFiClient net;
PubSubClient mqtt(net);
String topicBase = String("miniearth/") + DEVICE_NAME;
unsigned long lastWifiTry = 0, lastMqttTry = 0;

void emitData(const String& json) {
  if (mqtt.connected()) mqtt.publish((topicBase + "/data").c_str(), json.c_str());
  Serial.println(json);
}

void emitInfo(const String& json) {
  if (mqtt.connected()) mqtt.publish((topicBase + "/info").c_str(), json.c_str());
  Serial.println(json);
}

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

bool co2Warming() {
  return co2On && CO2_POWER_PIN >= 0 && (long)(co2WarmUntil - millis()) > 0;
}

// ── 보드 정보 보내기 (화면이 버튼을 그릴 때 씀) ──────────
void sendInfo() {
  String s = "{\"_type\":\"info\",\"dev\":\"";
  s += DEVICE_NAME;
  s += "\",\"board\":\"ESP32-DevKitC V4\",\"link\":\"mqtt\",\"fw\":\"std-1\",\"interval\":";
  s += interval;
  s += ",\"run\":";
  s += running ? 1 : 0;
  s += ",\"sensors\":[{\"id\":\"co2\",\"name\":\"MH-Z19B\",\"keys\":[\"co2\"],\"on\":";
  s += co2On ? 1 : 0;
  s += ",\"pwr\":";
  s += CO2_POWER_PIN >= 0 ? 1 : 0;
  s += ",\"warm\":";
  s += co2Warming() ? 1 : 0;
  s += "},{\"id\":\"temp\",\"name\":\"DS18B20\",\"keys\":[\"temp\",\"temp2\"],\"on\":";
  s += tempOn ? 1 : 0;
  s += ",\"pwr\":";
  s += TEMP_POWER_PIN >= 0 ? 1 : 0;
  s += "}]}";
  emitInfo(s);
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

// ── 명령 한 줄에서 값 꺼내기 (우노 표준 코드와 같은 방식 - 라이브러리 없이) ──
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
    if (jsonIs(line, "id", "co2")) setCo2Power(on);
    else if (jsonIs(line, "id", "temp")) setTempPower(on);
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

// ── 센서 읽기 ───────────────────────────────────────
int readCO2() {
  while (mhzSerial.available()) mhzSerial.read();
  mhzSerial.write(READ_CO2_CMD, 9);
  byte resp[9];
  unsigned long start = millis();
  int i = 0;
  while (i < 9 && millis() - start < 1000) {
    if (mhzSerial.available()) resp[i++] = mhzSerial.read();
  }
  if (i < 9 || resp[0] != 0xFF || resp[1] != 0x86) return -1;
  byte checksum = 0;
  for (int j = 1; j < 8; j++) checksum += resp[j];
  checksum = 0xFF - checksum + 1;
  if (checksum != resp[8]) return -1;
  return resp[2] * 256 + resp[3];
}

void sendData() {
  int co2 = (co2On && !co2Warming()) ? readCO2() : -1;
  float t[2] = {DEVICE_DISCONNECTED_C, DEVICE_DISCONNECTED_C};
  if (tempOn) {
    tempSensors.requestTemperatures();
    for (int i = 0; i < 2; i++) t[i] = tempSensors.getTempCByIndex(i);
  }
  // 읽기 실패한 센서·연결 안 된 센서는 키를 아예 빼서 보냄 (0으로 보내면 그래프에 가짜 값이 찍힘)
  String s = "{";
  if (co2 >= 0) { s += "\"co2\":"; s += co2; }
  for (int i = 0; i < 2; i++) {
    if (t[i] == DEVICE_DISCONNECTED_C) continue;
    if (s.length() > 1) s += ",";
    s += i == 0 ? "\"temp\":" : "\"temp2\":";
    s += String(t[i], 2);
  }
  s += "}";
  if (s.length() > 2) emitData(s);
}

void setup() {
  Serial.begin(115200);
  mhzSerial.begin(9600, SERIAL_8N1, MH_RX_PIN, MH_TX_PIN); // MH-Z19B 자체 통신 속도는 9600 고정
  if (CO2_POWER_PIN >= 0) pinMode(CO2_POWER_PIN, OUTPUT);
  if (TEMP_POWER_PIN >= 0) pinMode(TEMP_POWER_PIN, OUTPUT);
  setCo2Power(true);
  setTempPower(true);
  co2WarmUntil = 0; // 처음 켤 때는 바로 측정 (MH-Z19B는 켜진 뒤 약 1분은 값이 부정확할 수 있음)
  tempSensors.begin();
  runStart = millis();
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setBufferSize(512); // 보드 정보 JSON이 기본 크기(256바이트)보다 길어서 늘림
  mqtt.setCallback(onMqttMessage);
  keepConnected();
}

void loop() {
  keepConnected();
  mqtt.loop();

  if (running && RUN_MINUTES > 0 && millis() - runStart >= RUN_MINUTES * 60000UL) {
    running = false; // 정해 둔 측정 시간이 끝남
    sendInfo();
  }
  static bool lastWarm = false;
  if (co2Warming() != lastWarm) { lastWarm = co2Warming(); sendInfo(); } // 예열이 끝나면 화면의 '예열 중' 표시를 지움

  if (running && millis() - lastSend >= interval) {
    lastSend = millis();
    sendData();
  }
}
