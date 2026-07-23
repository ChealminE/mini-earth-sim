/*
  Mini Earth Model - ESP32 BLE(GATT) 센서 데이터 전송
  ====================================================
  역할: 센서값을 주기적으로 읽어서 BLE notify로 방송.
        WiFi가 없는 환경(집/야외 등)에서 esp32_sketch.ino(WiFi HTTP POST) 대신 사용.

  준비물:
    1. Arduino IDE > 라이브러리 매니저 > "ArduinoJson" 설치 (Benoit Blanchon)
    2. ESP32 보드 패키지에 기본 포함된 BLE 라이브러리 사용 (별도 설치 불필요)
    3. PC 쪽에서는 server.py가 bleak로 이 기기에 연결해 notify를 구독함
       (server.py의 BLE 리더 코드는 별도로 추가 예정)

  UUID를 HM-10 모듈의 표준값(0xFFE0/0xFFE1)과 동일하게 맞춰둠.
  이유: 우노+HM-10 조합과 ESP32 네이티브 BLE 조합을 PC 쪽에서
       완전히 같은 UUID로 구독할 수 있어서, bleak 코드를 보드 종류에
       따라 분기하지 않아도 됨 (uno_hm10_sketch.ino와 세트로 사용).

  BLE notify는 한 번에 보낼 수 있는 바이트 수가 MTU 크기에 따라 제한됨
  (협상 실패 시 기본 20바이트, 아래서 247바이트로 요청함).
  센서 종류가 늘어나 JSON이 너무 길어지면(≈230바이트 이상) 아래 두 방법 중 하나를 쓸 것:
    1) key 이름을 짧게 줄이기 (예: tank1_temp_c → t1t)
    2) 여러 characteristic으로 나눠 보내기
  센서는 아직 미확정이라 더미값 + 실제 아날로그 핀 읽기 예시를 함께 둠.
  실제 센서가 정해지면 readSensors() 함수 안의 값만 교체하면 됩니다.
*/

#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── 설정값 (여기만 수정하면 됨) ──────────────────────
const char* DEVICE_NAME = "MiniEarth-ESP32";
const unsigned long SEND_INTERVAL_MS = 2000;   // 전송 주기 (2초)

// HM-10 표준 UUID (우노+HM-10 조합과 동일하게 맞춤, uno_hm10_sketch.ino 참고)
#define SERVICE_UUID        "0000ffe0-0000-1000-8000-00805f9b34fb"
#define CHARACTERISTIC_UUID "0000ffe1-0000-1000-8000-00805f9b34fb"

// ── 센서 핀 예시 (실제 배선에 맞게 수정) ───────────────
const int PIN_TEMP = 34;   // 예: 온도 센서 아날로그 핀
const int PIN_CO2   = 35;   // 예: MH-Z19 등 CO2 센서
const int PIN_CH4   = 32;   // 예: MQ-4 등 가스 센서

BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
unsigned long lastSend = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("BLE 중앙기기(PC) 연결됨");
  }
  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    Serial.println("BLE 연결 끊김, 다시 광고 시작");
    server->getAdvertising()->start();
  }
};

// 센서 읽기: 실제 센서 코드로 이 부분만 교체하면 됩니다.
// key 이름은 자유롭게 정하면 대시보드가 자동으로 인식합니다.
void readSensors(JsonDocument& doc) {
  int rawTemp = analogRead(PIN_TEMP);
  int rawCo2  = analogRead(PIN_CO2);
  int rawCh4  = analogRead(PIN_CH4);

  doc["tank1_temp_c"]  = 15.0 + (rawTemp / 4095.0) * 20.0;   // 15~35도 범위로 매핑 (예시)
  doc["tank1_co2_ppm"] = 400 + (rawCo2  / 4095.0) * 2000.0;  // 400~2400ppm 범위 (예시)
  doc["tank2_ch4_ppm"] = 5   + (rawCh4  / 4095.0) * 50.0;    // 5~55ppm 범위 (예시)
}

void sendData() {
  if (!deviceConnected) return;   // 연결된 중앙기기 없으면 notify 못 보냄

  JsonDocument doc;
  readSensors(doc);

  String jsonStr;
  serializeJson(doc, jsonStr);

  pCharacteristic->setValue(jsonStr.c_str());
  pCharacteristic->notify();
  Serial.printf("notify 전송: %s\n", jsonStr.c_str());
}

void setup() {
  Serial.begin(115200);

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(247);   // 더 큰 JSON을 한 번에 보내기 위해 MTU 확장 요청

  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());  // notify 구독을 위해 필수
  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->start();

  Serial.println("BLE 광고 시작. PC에서 연결 대기중...");
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    sendData();
  }
}
