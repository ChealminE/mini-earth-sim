"""
가짜 보드 - 실제 아두이노/ESP32 없이 '직접 실험' 탭을 시험해 보는 용도
=====================================================================
basic_experiments/std_* 표준 코드와 똑같은 MQTT 프로토콜로 센서 값을 보내고,
화면에서 누른 명령(센서 켜기/끄기, 측정 간격, 일시정지, 재부팅)에 반응한다.

  python tools/fake_device.py                   # 내장 브로커(127.0.0.1:1883)에 'fake-esp32'로 접속
  python tools/fake_device.py --dev tank2 --interval 1000
  python tools/fake_device.py --spike 120       # 120초 뒤 CO2가 8000ppm 넘게 치솟음 (자동 시작 조건 시험용)

server.py가 먼저 켜져 있어야 한다. paho-mqtt가 필요하다 (requirements.txt에 포함).
"""

import argparse
import json
import math
import random
import time

import paho.mqtt.client as paho


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--dev", default="fake-esp32")
    ap.add_argument("--interval", type=int, default=2000, help="측정·전송 간격(ms)")
    ap.add_argument("--spike", type=float, default=0, help="이 초가 지나면 CO2가 급격히 올라감 (0이면 안 함)")
    args = ap.parse_args()

    base = f"miniearth/{args.dev}"
    state = {
        "interval": args.interval,
        "run": 1,
        "sensors": [
            {"id": "co2", "name": "MH-Z19B", "keys": ["co2"], "on": 1, "pwr": 1},
            {"id": "temp", "name": "DS18B20 x2", "keys": ["temp", "temp2"], "on": 1, "pwr": 0},
        ],
    }
    booted = time.time()

    def info():
        return json.dumps({"dev": args.dev, "board": "가짜 ESP32 (시험용)", "link": "wifi-mqtt",
                           "fw": "std-1", **state}, ensure_ascii=False)

    def on_connect(c, userdata, flags, reason_code, properties=None):
        print(f"[가짜 보드] 브로커 연결됨 ({args.host}:{args.port}) — 이름 {args.dev}")
        c.subscribe(f"{base}/cmd")
        c.publish(f"{base}/status", "online", retain=True)
        c.publish(f"{base}/info", info())

    def on_message(c, userdata, m):
        nonlocal booted
        try:
            cmd = json.loads(m.payload.decode("utf-8"))
        except Exception:
            return
        print(f"[가짜 보드] 명령 받음: {cmd}")
        kind = cmd.get("cmd")
        if kind == "sensor":
            for s in state["sensors"]:
                if s["id"] == cmd.get("id"):
                    s["on"] = 1 if cmd.get("on") else 0
        elif kind == "interval":
            state["interval"] = max(200, int(cmd.get("ms", state["interval"])))
        elif kind == "run":
            state["run"] = 1 if cmd.get("on") else 0
        elif kind == "reboot":
            print("[가짜 보드] 재부팅 흉내 (2초)")
            c.publish(f"{base}/status", "offline", retain=True)
            time.sleep(2)
            booted = time.time()
            c.publish(f"{base}/status", "online", retain=True)
        c.publish(f"{base}/info", info())

    client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=args.dev)
    client.will_set(f"{base}/status", "offline", retain=True)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.host, args.port, keepalive=15)
    client.loop_start()

    try:
        while True:
            time.sleep(state["interval"] / 1000)
            if not state["run"]:
                continue
            t = time.time() - booted
            data = {}
            on = {s["id"]: s["on"] for s in state["sensors"]}
            if on["co2"]:
                co2 = 650 + 120 * math.sin(t / 60) + random.gauss(0, 8)
                if args.spike and t > args.spike:
                    co2 += min(9000, (t - args.spike) * 150)
                data["co2"] = round(co2)
            if on["temp"]:
                data["temp"] = round(24 + 1.5 * math.sin(t / 90) + random.gauss(0, 0.05), 2)
                data["temp2"] = round(22 + 0.8 * math.sin(t / 120) + random.gauss(0, 0.05), 2)
            if data:
                client.publish(f"{base}/data", json.dumps(data))
    except KeyboardInterrupt:
        client.publish(f"{base}/status", "offline", retain=True)
        client.disconnect()


if __name__ == "__main__":
    main()
