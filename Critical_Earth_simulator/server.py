"""
Mini Earth Model - 실시간 센서 데이터 중계 서버 (WiFi + USB 시리얼 + BLE 겸용)
==========================================================================
세 가지 입력 방식을 동시에 지원합니다:

  1) WiFi 보드 (ESP32 등) -> HTTP POST로 /data 에 JSON 전송
  2) USB 시리얼 보드 (아두이노 우노 등) -> 케이블로 연결, JSON 한 줄씩 Serial.println
  3) BLE 보드 (ESP32 네이티브 BLE, 또는 우노+HM-10 모듈) -> notify로 JSON 한 줄씩 방송
     (firmware/esp32_ble_sketch, firmware/uno_hm10_sketch 참고)

셋 다 결국 같은 파이프라인(handle_incoming)을 타기 때문에,
보드를 섞어 써도(탱크1=ESP32 WiFi, 탱크2=우노+HM-10 BLE) 대시보드는 구분 없이 동작합니다.

실행 방법:
  python server.py                     # 시리얼 자동 감지 시도
  python server.py --serial COM5       # 포트 직접 지정 (Windows 예시)
  python server.py --serial /dev/ttyUSB0
  python server.py --no-serial         # 시리얼 아예 안 쓸 때 (ESP32만 사용)
  python server.py --ble               # BLE 기기 이름으로 스캔해서 연결 (기본 이름: MiniEarth)
  python server.py --ble --ble-name MyBoard
  python server.py --ble --ble-address AA:BB:CC:DD:EE:FF   # 스캔 생략, 바로 연결
  python server.py --no-browser        # 시작할 때 브라우저 자동으로 안 열리게

서버가 시작되면 기본적으로 브라우저가 자동으로 열립니다 (http://127.0.0.1:8000).

같은 와이파이에 ESP32와 노트북이 있어야 하고,
우노는 USB 케이블로 노트북에 물려 있어야 하며,
BLE 보드는 노트북의 블루투스가 켜져 있어야 합니다 (별도 페어링 불필요, bleak가 직접 스캔/연결).
"""

import argparse
import asyncio
import csv
import json
import socket
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

BASE_DIR = Path(__file__).parent
LOG_PATH = BASE_DIR / "data_log.csv"

clients: list[WebSocket] = []
csv_fields: Optional[List[str]] = None

main_loop: Optional[asyncio.AbstractEventLoop] = None  # FastAPI(uvicorn)의 이벤트 루프 참조용


# ── 공통 파이프라인: 로깅 + 브라우저 브로드캐스트 ─────────────────
def log_to_csv(payload: dict):
    global csv_fields
    row = {"timestamp": datetime.now(timezone.utc).isoformat(), **payload}

    file_exists = LOG_PATH.exists()
    if not file_exists:
        csv_fields = list(row.keys())
    else:
        if csv_fields is None:
            with open(LOG_PATH, "r", newline="", encoding="utf-8") as f:
                csv_fields = next(csv.reader(f), list(row.keys()))
        for k in row.keys():
            if k not in csv_fields:
                csv_fields.append(k)

    write_header = not file_exists
    with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=csv_fields)
        if write_header:
            writer.writeheader()
        writer.writerow(row)


async def handle_incoming(payload: dict, source: str):
    """WiFi(POST)든 시리얼이든 여기로 들어오면 동일하게 처리."""
    payload = dict(payload)
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    payload["_source"] = source  # 어느 경로로 들어왔는지 구분용 (대시보드에서 무시해도 됨)
    log_to_csv(payload)

    dead = []
    for ws in clients:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)


# ── 1) WiFi 보드 경로: HTTP POST ─────────────────────────────
@app.get("/")
async def index():
    return FileResponse(BASE_DIR / "index.html")


@app.post("/data")
async def receive_data(request: Request):
    """ESP32 등 WiFi 보드가 여기로 센서 JSON을 POST.
    예: {"tank1_co2": 812.3, "tank1_temp": 23.4}
    """
    payload = await request.json()
    if not isinstance(payload, dict):
        return JSONResponse({"ok": False, "error": "JSON object가 아닙니다"}, status_code=400)
    await handle_incoming(payload, source="wifi")
    return {"ok": True, "received": payload}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in clients:
            clients.remove(websocket)


# style.css, js/*.js 등 정적 파일 서빙 (반드시 위의 라우트들 뒤에 등록해야
# "/", "/data", "/ws"가 이 마운트에 가로채이지 않음)
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/texture_image", StaticFiles(directory=BASE_DIR / "texture_image"), name="textures")
app.mount("/basic_experiments", StaticFiles(directory=BASE_DIR / "basic_experiments"), name="basic_experiments")


@app.get("/style.css")
async def style_css():
    return FileResponse(BASE_DIR / "style.css")


# ── 2) 시리얼 보드 경로: USB (우노 등) ─────────────────────────
def find_serial_port() -> Optional[str]:
    """연결된 시리얼 포트 중 그럴듯한 것을 자동으로 찾아본다."""
    import serial.tools.list_ports

    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None
    # Arduino/USB-Serial 칩(CH340, CP210x, FTDI 등) 이름이 들어간 포트 우선
    keywords = ["arduino", "ch340", "usb-serial", "cp210", "ftdi", "usb serial"]
    for p in ports:
        desc = (p.description or "").lower()
        if any(k in desc for k in keywords):
            return p.device
    return ports[0].device  # 못 찾으면 첫 번째 포트라도 시도


def serial_reader_thread(port: str, baud: int):
    """별도 스레드에서 시리얼 포트를 계속 읽으며 JSON 라인을 파싱.
    아두이노 우노 스케치가 Serial.println(jsonString) 형태로 보낸다고 가정.
    """
    import serial

    print(f"[시리얼] {port} @ {baud}bps 연결 시도")
    try:
        ser = serial.Serial(port, baud, timeout=2)
    except Exception as e:
        print(f"[시리얼] 연결 실패: {e}")
        return

    print(f"[시리얼] 연결됨: {port}")
    while True:
        try:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            payload = json.loads(line)  # JSON이 아닌 디버그 출력 줄은 여기서 자동으로 걸러짐
            if isinstance(payload, dict) and main_loop is not None:
                asyncio.run_coroutine_threadsafe(
                    handle_incoming(payload, source="serial"), main_loop
                )
        except json.JSONDecodeError:
            continue  # 우노가 중간에 다른 디버그 텍스트를 찍어도 무시하고 계속 진행
        except Exception as e:
            print(f"[시리얼] 읽기 오류: {e}")
            break


# ── 3) BLE 보드 경로: ESP32 네이티브 BLE / 우노+HM-10 ─────────────
# esp32_ble_sketch.ino와 uno_hm10_sketch.ino가 같은 UUID를 쓰기 때문에
# 보드 종류를 몰라도 이 코드 하나로 둘 다 처리됨.
BLE_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"


async def ble_reader_task(name_filter: str, address: Optional[str]):
    """bleak으로 BLE 기기에 연결해 notify를 구독.
    시리얼과 달리 asyncio 네이티브라 별도 스레드 없이 이벤트 루프 위에서 그대로 돈다.
    연결이 끊기거나 기기를 못 찾으면 계속 재시도한다 (시리얼 자동 재접속과 동일한 정책).
    """
    from bleak import BleakClient, BleakScanner

    buffer = ""

    def handle_notify(_, data: bytearray):
        nonlocal buffer
        buffer += data.decode("utf-8", errors="ignore")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)  # 우노 디버그 출력이 섞여 들어와도 여기서 자동으로 걸러짐
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                asyncio.create_task(handle_incoming(payload, source="ble"))

    while True:
        try:
            target = address
            if not target:
                print(f"[BLE] 이름에 '{name_filter}' 포함된 기기 검색중...")
                device = await BleakScanner.find_device_by_filter(
                    lambda d, adv: d.name is not None and name_filter.lower() in d.name.lower()
                )
                if device is None:
                    print(f"[BLE] '{name_filter}' 기기를 찾지 못함, 5초 후 재검색")
                    await asyncio.sleep(5)
                    continue
                target = device.address

            async with BleakClient(target) as client:
                print(f"[BLE] 연결됨: {target}")
                await client.start_notify(BLE_CHAR_UUID, handle_notify)
                while client.is_connected:
                    await asyncio.sleep(1)
                print("[BLE] 연결 끊김, 재접속 시도")
        except Exception as e:
            print(f"[BLE] 오류: {e}, 5초 후 재시도")
            await asyncio.sleep(5)


def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", type=str, default=None, help="시리얼 포트 직접 지정 (예: COM5, /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=9600, help="시리얼 통신 속도 (우노 스케치와 반드시 일치)")
    parser.add_argument("--no-serial", action="store_true", help="시리얼 입력을 사용하지 않음 (ESP32만 사용)")
    parser.add_argument("--ble", action="store_true", help="BLE(ESP32 네이티브 BLE 또는 우노+HM-10) 입력 사용")
    parser.add_argument("--ble-name", type=str, default="MiniEarth", help="BLE 기기 이름에 포함될 문자열 (기본: MiniEarth)")
    parser.add_argument("--ble-address", type=str, default=None, help="BLE 기기 MAC/UUID 직접 지정 (스캔 생략, 더 빠름)")
    parser.add_argument("--no-browser", action="store_true", help="서버 시작 시 브라우저 자동으로 열지 않음")
    args = parser.parse_args()

    import uvicorn

    ip = get_local_ip()
    print("=" * 55)
    print(f"  브라우저 접속:        http://{ip}:8000")
    print(f"  ESP32(WiFi) 전송 주소: http://{ip}:8000/data")

    if not args.no_serial:
        port = args.serial or find_serial_port()
        if port:
            print(f"  우노(USB 시리얼) 포트: {port} @ {args.baud}bps")
        else:
            print("  우노(USB 시리얼): 연결된 포트를 찾지 못함 (연결 후 --serial 로 직접 지정 가능)")
    else:
        print("  시리얼 입력: 비활성화 (--no-serial)")

    if args.ble:
        target_desc = args.ble_address or f"이름에 '{args.ble_name}' 포함된 기기"
        print(f"  BLE 입력: 활성화 ({target_desc})")
    else:
        print("  BLE 입력: 비활성화 (--ble 로 켤 수 있음)")
    print("=" * 55)

    @app.on_event("startup")
    async def start_inputs_if_needed():
        global main_loop
        main_loop = asyncio.get_running_loop()
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:8000")
        if not args.no_serial:
            port = args.serial or find_serial_port()
            if port:
                t = threading.Thread(target=serial_reader_thread, args=(port, args.baud), daemon=True)
                t.start()
        if args.ble:
            asyncio.create_task(ble_reader_task(args.ble_name, args.ble_address))

    uvicorn.run(app, host="0.0.0.0", port=8000)
