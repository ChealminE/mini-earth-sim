"""
가짜 센서 데이터 발생기 - 하드웨어 없이 3D 반영 테스트용
====================================================
server.py를 먼저 실행해둔 상태에서 이 스크립트를 돌리면,
2초마다 co2/ph/tmp/hum/methane 값을 http://localhost:8000/data 로 전송합니다.
실시간 실험 탭을 열어두면 값이 서서히 오르내리며 3D 씬(물색·빙하·응결·기포)이 바뀌는지 확인 가능.

실행 방법:
  python test_fake_sensor.py
"""

import json
import math
import time
import urllib.request

URL = "http://localhost:8000/data"

t = 0
while True:
    wave = math.sin(t / 10)
    payload = {
        "tank1_co2": round(420 + wave * 150, 1),      # 270~570 ppm
        "tank1_ph": round(7.9 - max(0, wave) * 0.3, 3),  # 7.6~7.9
        "tank1_temp": round(24 + wave * 8, 1),         # 16~32 C
        "tank1_hum": round(55 + wave * 25, 1),         # 30~80 %
        "tank1_methane": round(200 + max(0, wave) * 3600, 1),  # 200~3800 ppm
    }
    try:
        req = urllib.request.Request(
            URL, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
        print("전송:", payload)
    except Exception as e:
        print("전송 실패 (server.py가 켜져 있는지 확인):", e)

    t += 1
    time.sleep(2)
