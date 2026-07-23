/*
  Mini Earth Model - ESP32 센서 데이터 전송
  ==========================================
  역할: 센서값을 주기적으로 읽어서 노트북의 Python 서버로 HTTP POST 전송

  준비물:
    1. Arduino IDE > 라이브러리 매니저 > "ArduinoJson" 설치 (Benoit Blanchon)
    2. 아래 WIFI_SSID / WIFI_PASSWORD / SERVER_IP 수정
    3. SERVER_IP는 server.py 실행 시 터미널에 출력되는 IP 주소

  센서는 아직 미확정이라 더미값 + 실제 아날로그 핀 읽기 예시를 함께 둠.
  실제 센서가 정해지면 readSensors() 함수 안의 값만 교체하면 됩니다.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── 설정값 (여기만 수정하면 됨) ──────────────────────
const char* WIFI_SSID     = "your_wifi_name";
const char* WIFI_PASSWORD = "your_wifi_password";
const char* SERVER_IP     = "192.168.0.10";   // server.py 실행 시 출력된 IP로 교체
const int   SERVER_PORT   = 8000;
const unsigned long SEND_INTERVAL_MS = 2000;   // 전송 주기 (2초)

// ── 센서 핀 예시 (실제 배선에 맞게 수정) ───────────────
const int PIN_TEMP   = 34;   // 예: 온도 센서 아날로그 핀
const int PIN_CO2     = 35;   // 예: MH-Z19 등 CO2 센서
const int PIN_CH4     = 32;   // 예: MQ-4 등 가스 센서

unsigned long lastSend = 0;

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi 연결중");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("연결됨. IP: ");
  Serial.println(WiFi.localIP());
}

// 센서 읽기: 실제 센서 코드로 이 부분만 교체하면 됩니다.
// key 이름은 자유롭게 정하면 대시보드가 자동으로 인식합니다.
void readSensors(JsonDocument& doc) {
  // 예시: 아날로그 원시값을 그럴듯한 단위로 변환 (실제 캘리브레이션 필요)
  int rawTemp = analogRead(PIN_TEMP);
  int rawCo2  = analogRead(PIN_CO2);
  int rawCh4  = analogRead(PIN_CH4);

  doc["tank1_temp_c"]  = 15.0 + (rawTemp / 4095.0) * 20.0;   // 15~35도 범위로 매핑 (예시)
  doc["tank1_co2_ppm"] = 400 + (rawCo2  / 4095.0) * 2000.0;  // 400~2400ppm 범위 (예시)
  doc["tank2_ch4_ppm"] = 5   + (rawCh4  / 4095.0) * 50.0;    // 5~55ppm 범위 (예시)
}

void sendData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi 끊김, 재연결 시도");
    connectWiFi();
    return;
  }

  JsonDocument doc;
  readSensors(doc);

  String jsonStr;
  serializeJson(doc, jsonStr);

  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/data";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(jsonStr);
  if (code > 0) {
    Serial.printf("전송 완료 [%d]: %s\n", code, jsonStr.c_str());
  } else {
    Serial.printf("전송 실패: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  connectWiFi();
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    sendData();
  }
}
