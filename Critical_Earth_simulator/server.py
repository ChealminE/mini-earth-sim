"""
Mini Earth Model - 실시간 센서 데이터 중계 서버 (WiFi + USB 시리얼 + BLE 겸용)
==========================================================================
세 가지 통신 방식을 동시에 지원합니다 (어떤 보드를 쓰든 무관, 방식만 맞으면 됨):

  1) WiFi 방식 -> HTTP POST로 /data 에 JSON 전송
  2) USB 시리얼 방식 -> 케이블로 연결, JSON 한 줄씩 Serial.println
  3) BLE 방식 -> notify로 JSON 한 줄씩 방송
     (basic_experiments/esp32_ble, basic_experiments/uno_hm10_ble 참고)

셋 다 결국 같은 파이프라인(handle_incoming)을 타기 때문에,
보드/통신 방식을 섞어 써도(탱크1=WiFi, 탱크2=BLE) 대시보드는 구분 없이 동작합니다.

실행 방법:
  python server.py                     # 시리얼 자동 감지 시도
  python server.py --serial COM5       # 포트 직접 지정 (Windows 예시)
  python server.py --serial /dev/ttyUSB0
  python server.py --no-serial         # 시리얼 아예 안 쓸 때 (WiFi/BLE만 사용)
  python server.py --ble               # BLE 기기 이름으로 스캔해서 연결 (기본 이름: MiniEarth)
  python server.py --ble --ble-name MyBoard
  python server.py --ble --ble-address AA:BB:CC:DD:EE:FF   # 스캔 생략, 바로 연결
  python server.py --no-browser        # 시작할 때 브라우저 자동으로 안 열리게

서버가 시작되면 기본적으로 브라우저가 자동으로 열립니다 (http://127.0.0.1:8000).

WiFi 방식은 같은 와이파이에 보드와 노트북이 있어야 하고,
USB 시리얼 방식은 케이블로 노트북에 물려 있어야 하며,
BLE 방식은 노트북의 블루투스가 켜져 있어야 합니다 (별도 페어링 불필요, bleak가 직접 스캔/연결).
"""

import argparse
import asyncio
import csv
import json
import queue
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()


# StaticFiles(및 FileResponse)는 Cache-Control 없이 Last-Modified/ETag만 보내서,
# 브라우저가 자체 판단(heuristic caching)으로 js/css를 한동안 캐싱해버린다. 이 프로젝트는
# 수업 중에도 index.html/js/*.js가 자주 바뀌는데, 새로고침만으로는 브라우저가 옛날 파일을
# 계속 쓰는 바람에 "분명히 고쳤는데 반영이 안 된 것처럼 보이는" 혼란이 반복됐다.
# 학생 수가 많지 않은 로컬/교실용 서버라 캐싱으로 얻는 성능 이득보다 이 혼란을 막는 게 더 중요해서
# 모든 응답에 no-store를 강제한다.
@app.middleware("http")
async def no_cache(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response

# PyInstaller로 exe로 묶으면 index.html/js/texture_image 등 번들된 리소스는 실행할 때마다
# 임시 폴더(sys._MEIPASS)에 풀리므로 거기서 읽어야 하고, data_log.csv처럼 계속 남아있어야
# 하는 파일은 그 임시 폴더가 아니라 exe가 실제로 놓인 위치(APP_DIR)에 써야 함.
# `python server.py`로 그냥 실행할 때는 둘 다 이 파일이 있는 폴더로 동일하게 동작(기존과 같음).
if getattr(sys, "frozen", False):
    RESOURCE_DIR = Path(sys._MEIPASS)
    APP_DIR = Path(sys.executable).parent
else:
    RESOURCE_DIR = Path(__file__).parent
    APP_DIR = RESOURCE_DIR

LOG_PATH = APP_DIR / "data_log.csv"

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


# 시작 화면(4개 박스: 현재실태/미래예측/직접실험/1인칭 탐험) - 이제 이게 진입점.
# 각 대시보드 탭은 더 이상 페이지 안에서 서로 전환하지 않고, 항상 여기로 돌아왔다가
# 원하는 박스를 다시 골라 들어가는 구조라 "/"는 이 화면이 맡는다.
@app.get("/")
async def select_page():
    return FileResponse(RESOURCE_DIR / "select.html")


# 현재실태/미래예측/직접실험 대시보드 (예전엔 "/"였음) - ?tab=current|future|live로 접속
@app.get("/dashboard")
async def dashboard():
    return FileResponse(RESOURCE_DIR / "index.html")


# ── 1) WiFi 방식 경로: HTTP POST ─────────────────────────────


@app.post("/data")
async def receive_data(request: Request):
    """WiFi로 통신하는 보드가 여기로 센서 JSON을 POST.
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


# "기본 실험" 목록은 파일로 관리하지 않고 basic_experiments/ 폴더를 직접 스캔해서 만든다.
# info.json이 있는 폴더만 자동으로 목록에 뜨므로, 새 실험을 추가하려면
# basic_experiments/<새폴더>/{info.json, code.ino}만 넣으면 끝 (index.json 수정 불필요).
# 아래 mount보다 먼저 등록해야 이 경로가 정적 파일 서빙에 가로채이지 않는다.
@app.get("/basic_experiments/index.json")
async def basic_experiments_index():
    base = RESOURCE_DIR / "basic_experiments"
    items = []
    for entry in sorted(base.iterdir()):
        if not entry.is_dir():
            continue
        info_path = entry / "info.json"
        if not info_path.exists():
            continue
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue  # info.json이 깨져 있으면 목록에서 조용히 제외
        items.append({
            "id": entry.name,
            "title": info.get("title", entry.name),
            "board": info.get("board", "기타"),
            "sensors": info.get("sensors", []),
        })
    return items


# style.css, js/*.js 등 정적 파일 서빙 (반드시 위의 라우트들 뒤에 등록해야
# "/", "/data", "/ws"가 이 마운트에 가로채이지 않음)
app.mount("/js", StaticFiles(directory=RESOURCE_DIR / "js"), name="js")
app.mount("/texture_image", StaticFiles(directory=RESOURCE_DIR / "texture_image"), name="textures")
app.mount("/basic_experiments", StaticFiles(directory=RESOURCE_DIR / "basic_experiments"), name="basic_experiments")
# 1인칭 탐험 모드 (firstperson/index.html) - html=True라 /firstperson/ 으로 접속하면 index.html이 열림
app.mount("/firstperson", StaticFiles(directory=RESOURCE_DIR / "firstperson", html=True), name="firstperson")


@app.get("/style.css")
async def style_css():
    return FileResponse(RESOURCE_DIR / "style.css")


# ── 2) USB 시리얼 방식 경로 ─────────────────────────
# 학생마다 보드/USB칩/포트 번호가 제각각이라 이름 키워드만으론 못 믿는다
# (엉뚱한 COM포트를 집어서 열려다 실패하는 사고를 실제로 겪었음).
# 그래서 후보 포트를 실제로 열어 JSON 한 줄이 오는지까지 확인해서 진짜 장치를 찾는다.
# basic_experiments의 CO2(MH-Z19B) 예제들은 30초에 한 번만 전송하므로(code.ino의
# SEND_INTERVAL_MS), 포트마다 순서대로 기다리면 최악의 경우 포트 수 x 30초가 걸린다.
# 그래서 후보를 전부 동시에 열어서 지켜보고 가장 먼저 JSON을 내놓는 포트를 채택한다
# (전체 대기 시간이 포트 개수와 무관하게 전송 주기 한 번만큼만 걸리게).
SERIAL_PROBE_SECONDS = 33.0  # 기본 실험 코드 중 가장 긴 전송 주기(30초)보다 살짝 여유

def _list_candidate_ports() -> List[str]:
    """연결된 포트 목록. Arduino/USB-Serial 칩(CH340, CP210x, FTDI 등) 이름이 들어간 포트를 우선순위로 정렬."""
    import serial.tools.list_ports

    ports = list(serial.tools.list_ports.comports())
    keywords = ["arduino", "ch340", "usb-serial", "cp210", "ftdi", "usb serial"]

    def looks_like_device(p) -> bool:
        desc = (p.description or "").lower()
        return any(k in desc for k in keywords)

    return [p.device for p in sorted(ports, key=lambda p: not looks_like_device(p))]


def _probe_serial_port(port: str, baud: int, probe_seconds: float, stop_event: threading.Event) -> str:
    """포트를 열어서 최대 probe_seconds 동안 JSON 한 줄이 오는지 확인.
    다른 포트가 먼저 찾아지면(stop_event) 바로 포기한다.
    결과를 "found"/"busy"/"no_data" 세 가지로 구분해서 돌려준다 - 그래야 자동 감지가 실패했을 때
    "포트가 아예 없음"인지 "포트는 있는데 다른 프로그램이 물고 있음"인지 "포트는 열리는데
    JSON이 안 옴(보드레이트 불일치 등)"인지 콘솔에서 바로 구분해서 알려줄 수 있다."""
    import serial

    try:
        ser = serial.Serial(port, baud, timeout=0.5)
    except Exception as e:
        print(f"[시리얼] {port} 열기 실패 ({e}) — 아두이노 IDE 시리얼 모니터 등 다른 프로그램이 "
              f"이 포트를 이미 사용 중일 수 있습니다. 닫고 다시 시도해보세요.")
        return "busy"
    try:
        deadline = time.time() + probe_seconds
        while time.time() < deadline and not stop_event.is_set():
            try:
                line = ser.readline().decode("utf-8").strip()
            except UnicodeDecodeError:
                continue  # 잡음으로 깨진 줄 - 이번 줄만 버리고 계속 기다림
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue  # 보드가 디버그 텍스트를 찍어도 무시하고 계속 기다림
            if isinstance(payload, dict):
                return "found"
        return "no_data"
    finally:
        ser.close()


def find_serial_port(baud: int) -> Optional[str]:
    """연결된 포트 후보들을 동시에 열어보고, 그중 실제로 JSON을 보내는 포트를 찾는다."""
    candidates = _list_candidate_ports()
    if not candidates:
        print("[시리얼] 연결된 포트가 없습니다 (USB 케이블이 꽂혀 있는지 확인하세요).")
        return None

    print(f"[시리얼] 포트 {len(candidates)}개 동시 확인 중 "
          f"(최대 {int(SERIAL_PROBE_SECONDS)}초 — 전송 주기가 긴 실험 코드도 있어서 시간이 걸릴 수 있음)…")
    found: "queue.Queue[str]" = queue.Queue()
    results: dict[str, str] = {}
    stop_event = threading.Event()

    def worker(port: str):
        status = _probe_serial_port(port, baud, SERIAL_PROBE_SECONDS, stop_event)
        results[port] = status
        if status == "found":
            found.put(port)

    threads = [threading.Thread(target=worker, args=(p,), daemon=True) for p in candidates]
    for t in threads:
        t.start()

    try:
        port = found.get(timeout=SERIAL_PROBE_SECONDS + 1)
    except queue.Empty:
        port = None
    stop_event.set()
    for t in threads:
        t.join(timeout=1)

    if port is None:
        no_data_ports = [p for p, s in results.items() if s == "no_data"]
        if no_data_ports:
            print(f"[시리얼] {', '.join(no_data_ports)} 포트는 열렸지만 {int(SERIAL_PROBE_SECONDS)}초 동안 올바른 "
                  f"JSON을 받지 못했습니다 — 보드레이트가 스케치의 Serial.begin() 값과 일치하는지 "
                  f"(서버는 기본 {baud}bps, 다르면 --baud 옵션으로 지정), 스케치가 JSON을 제대로 출력하는지 확인하세요.")
    return port


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
            # errors="ignore"로 읽으면 배선/보드레이트 문제로 바이트가 깨졌을 때 그 바이트만
            # 조용히 지워버려서 "temp"가 "tmp"처럼 다른 문자열로 둔갑한 채로도 JSON 파싱에
            # 성공할 수 있었다 - 대시보드 입장에선 그게 완전히 새로운 센서로 보여 카드가 계속
            # 늘어나는 것처럼 보인 원인 중 하나. strict로 읽어서 깨진 줄은 통째로 버린다.
            line = ser.readline().decode("utf-8").strip()
            if not line:
                continue
            payload = json.loads(line)  # JSON이 아닌 디버그 출력 줄은 여기서 자동으로 걸러짐
            if isinstance(payload, dict) and main_loop is not None:
                asyncio.run_coroutine_threadsafe(
                    handle_incoming(payload, source="serial"), main_loop
                )
        except UnicodeDecodeError:
            continue  # 잡음으로 깨진 줄 - 이번 줄만 버리고 다음 줄 계속 읽음
        except json.JSONDecodeError:
            continue  # 우노가 중간에 다른 디버그 텍스트를 찍어도 무시하고 계속 진행
        except Exception as e:
            print(f"[시리얼] 읽기 오류: {e}")
            break


# ── 3) BLE 방식 경로 ─────────────────────────
# basic_experiments/esp32_ble, basic_experiments/uno_hm10_ble가 같은 UUID를 쓰기 때문에
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
    # 한국어 Windows의 기본 콘솔 인코딩(cp949)은 —, … 같은 특수문자를 못 담아서, 그런 문자가
    # 섞인 print()가 실행되는 순간 UnicodeEncodeError로 스레드/서버가 죽는다. 백그라운드 스레드에서
    # 이게 터지면 "포트를 못 찾음"이 아니라 스레드 자체가 조용히 죽어버려서 원인 파악이 훨씬 어려웠다.
    # 콘솔을 UTF-8로 강제 전환해서 이 클래스의 오류를 원천 차단한다 (exe로 빌드했을 때도 동일 적용).
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

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
    print(f"  WiFi 전송 주소:        http://{ip}:8000/data")

    if args.no_serial:
        print("  시리얼 입력: 비활성화 (--no-serial)")
    elif args.serial:
        print(f"  USB 시리얼 포트: {args.serial} @ {args.baud}bps (직접 지정)")
    else:
        print(f"  USB 시리얼: 서버가 뜬 뒤 백그라운드에서 자동으로 찾습니다 "
              f"(최대 {int(SERIAL_PROBE_SECONDS)}초 정도 걸릴 수 있지만, 그동안에도 대시보드는 바로 쓸 수 있습니다)")

    if args.ble:
        target_desc = args.ble_address or f"이름에 '{args.ble_name}' 포함된 기기"
        print(f"  BLE 입력: 활성화 ({target_desc})")
    else:
        print("  BLE 입력: 비활성화 (--ble 로 켤 수 있음)")
    print("=" * 55)

    def start_serial_input():
        """포트 찾기 + 계속 읽기를 전부 이 백그라운드 스레드에서 처리.
        예전엔 uvicorn을 띄우기 *전에* 여기서 최대 33초를 기다렸기 때문에, 포트를 못 찾으면
        브라우저 페이지 자체가 그동안 안 열렸다 (학생 입장에선 서버가 멈춘 것처럼 보임).
        이제 서버가 먼저 뜨고 이 스레드가 뒤에서 찾으므로 대시보드는 바로 쓸 수 있다."""
        port = args.serial or find_serial_port(args.baud)
        if not port:
            print("  USB 시리얼: 연결된 포트를 찾지 못했습니다 "
                  "(케이블 연결 후 --serial 로 직접 지정하거나 서버를 다시 시작하세요)")
            return
        serial_reader_thread(port, args.baud)

    @app.on_event("startup")
    async def start_inputs_if_needed():
        global main_loop
        main_loop = asyncio.get_running_loop()
        if not args.no_browser:
            webbrowser.open("http://127.0.0.1:8000")
        if not args.no_serial:
            threading.Thread(target=start_serial_input, daemon=True).start()
        if args.ble:
            asyncio.create_task(ble_reader_task(args.ble_name, args.ble_address))

    uvicorn.run(app, host="0.0.0.0", port=8000)
