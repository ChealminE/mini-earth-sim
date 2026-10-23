"""
Mini Earth Model - 실시간 센서 데이터 중계 서버 (USB 시리얼 + BLE + WiFi(MQTT/HTTP) 겸용)
==========================================================================
네 가지 통신 방식을 동시에 지원합니다 (어떤 보드를 쓰든 무관, 방식만 맞으면 됨):

  1) USB 시리얼 -> 케이블로 연결, JSON 한 줄씩 Serial.println (우노 R3 / ESP32 공통)
                   HC-06(클래식 블루투스)도 윈도우에서 페어링하면 COM 포트로 잡혀서 이 경로를 탄다
  2) BLE        -> notify로 JSON 한 줄씩 방송 (우노+HM-10 / ESP32 네이티브 BLE)
  3) WiFi MQTT  -> 이 서버에 내장된 MQTT 브로커(포트 1883)로 발행 (ESP32)
  4) WiFi HTTP  -> HTTP POST로 /data 에 JSON 전송 (예전 방식, 명령은 못 받음)

전부 같은 파이프라인(handle_incoming)을 타기 때문에 보드/통신 방식을 섞어 써도
대시보드는 구분 없이 동작합니다.

양방향(명령) - "MiniEarth 표준 프로토콜"
  보드 → 서버: 센서 값  {"co2": 812, "temp": 24.1}
               보드 정보 {"_type":"info","dev":"uno-usb","interval":5000,"run":1,
                          "sensors":[{"id":"co2","name":"MH-Z19B","keys":["co2"],"on":1,"pwr":0}]}
  서버 → 보드: {"cmd":"info"} / {"cmd":"sensor","id":"co2","on":0} / {"cmd":"interval","ms":5000}
               {"cmd":"run","on":0} / {"cmd":"reboot"}
  basic_experiments/std_* 표준 코드가 이 프로토콜을 따릅니다. 예전 코드(값만 보내는 코드)도
  그대로 동작하고, 화면에 제어 버튼만 안 뜹니다.

MQTT 토픽 (<dev> = 보드 이름)
  miniearth/<dev>/data   보드 → 서버  센서 값
  miniearth/<dev>/info   보드 → 서버  보드 정보
  miniearth/<dev>/status 보드 → 서버  "online" / "offline" (Last Will로 전원이 끊겨도 알 수 있음)
  miniearth/<dev>/cmd    서버 → 보드  명령

실행 방법:
  python server.py                     # 시리얼 자동 감지 + 내장 MQTT 브로커
  python server.py --serial COM5       # 포트 직접 지정 (여러 개면 COM5,COM7)
  python server.py --no-serial         # 시리얼 아예 안 쓸 때
  python server.py --ble               # BLE 기기 이름으로 스캔해서 연결 (기본 이름: MiniEarth)
  python server.py --ble --ble-name MyBoard
  python server.py --ble --ble-address AA:BB:CC:DD:EE:FF   # 스캔 생략, 바로 연결
  python server.py --mqtt-host 127.0.0.1   # 내장 브로커 대신 따로 설치한 Mosquitto 사용
  python server.py --no-mqtt           # MQTT 끄기
  python server.py --no-browser        # 시작할 때 브라우저 자동으로 안 열리게

서버가 시작되면 기본적으로 브라우저가 자동으로 열립니다 (http://127.0.0.1:8000).
"""

import argparse
import asyncio
import contextlib
import csv
import hashlib
import json
import queue
import re
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()


# ── 브라우저 저장(캐시) 정책 ─────────────────────────────
# StaticFiles(및 FileResponse)는 Cache-Control 없이 Last-Modified/ETag만 보내서,
# 브라우저가 자체 판단(heuristic caching)으로 js/css를 한동안 캐싱해버린다. 예전엔 그 때문에
# "분명히 고쳤는데 반영이 안 된 것처럼 보이는" 혼란이 반복돼서 모든 응답을 no-store(저장 금지)로 했는데,
# 그러면 화면을 옮길 때마다 텍스처·라이브러리(약 4MB)와 3D 코드를 매번 다시 받는다.
# 이제는 html을 내줄 때 서버가 js/css 주소 끝에 '파일 내용으로 만든 버전 표시(?v=...)'를 자동으로 붙인다
# (versioned_html). 파일이 바뀌면 주소가 바뀌어 새로 받고, 안 바뀌면 브라우저에 저장된 것을 그대로 쓴다.
#   ?v= 가 붙은 요청      → 1년 저장 (내용이 바뀌면 주소 자체가 바뀌므로 안전)
#   텍스처·라이브러리      → 저장하되 쓸 때마다 바뀌었는지만 확인 (안 바뀌었으면 본문 없이 '그대로' 응답)
#   그 밖 (html·json·.ino) → 지금처럼 매번 새로
@app.middleware("http")
async def cache_policy(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if request.query_params.get("v") and path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith(("/texture_image/", "/vendor/")):
        response.headers["Cache-Control"] = "no-cache"
    else:
        response.headers["Cache-Control"] = "no-store"
    return response


_version_cache: Dict[Path, tuple] = {}


def file_version(path: Path) -> str:
    """파일 내용의 짧은 지문. 수정 시각이 같으면 다시 읽지 않는다."""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return "0"
    cached = _version_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    digest = hashlib.md5(path.read_bytes()).hexdigest()[:10]
    _version_cache[path] = (mtime, digest)
    return digest


_ASSET_REF = re.compile(r'(\b(?:src|href)=")([^"?#:]+\.(?:js|css))(?:\?[^"]*)?(")')


def versioned_html(html_path: Path) -> HTMLResponse:
    """html 안의 우리 js/css 주소 끝에 내용 지문(?v=...)을 붙여서 돌려준다 (손으로 ?v=4 올릴 필요 없음).
    파일 자체는 고치지 않는다."""
    text = html_path.read_text(encoding="utf-8")

    def stamp(m):
        url = m.group(2)
        target = (RESOURCE_DIR / url.lstrip("/")) if url.startswith("/") else (html_path.parent / url)
        return f"{m.group(1)}{url}?v={file_version(target)}{m.group(3)}"

    return HTMLResponse(_ASSET_REF.sub(stamp, text))

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
SESSION_DIR = APP_DIR / "logs"  # 실험(시작~종료) 하나당 파일 하나

clients: List[WebSocket] = []
csv_fields: Optional[List[str]] = None

main_loop: Optional[asyncio.AbstractEventLoop] = None  # FastAPI(uvicorn)의 이벤트 루프 참조용
server_info: dict = {"ip": "127.0.0.1", "httpPort": 8000, "mqtt": None}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── 보드(장치) 목록 ─────────────────────────────────────────
# 장치 id는 "통신 경로" 기준으로 고정한다 (usb:COM14, ble:AA:BB.., mqtt:esp32-a, http:192.168.0.5).
# 보드가 info로 알려주는 이름(dev)은 화면 표시용 name에만 쓴다 - 이름이 바뀌어도
# 화면 쪽 센서 키 ↔ 장치 연결이 흔들리지 않게.
class Device:
    def __init__(self, dev_id: str, link: str, addr: str,
                 send: Optional[Callable[[str], Awaitable[bool]]] = None,
                 hw_reset: Optional[Callable[[], Awaitable[bool]]] = None):
        self.id = dev_id
        self.link = link          # usb / ble / mqtt / http
        self.addr = addr
        self.send = send          # 명령 한 줄 보내기 (못 보내는 경로면 None)
        self.hw_reset = hw_reset  # USB 케이블의 DTR/RTS 선으로 보드를 강제 리셋 (USB 전용)
        self.online = True
        self.info: Optional[dict] = None
        self.last_seen = 0.0

    @property
    def name(self) -> str:
        if self.info and self.info.get("dev"):
            return str(self.info["dev"])
        return self.addr

    def to_json(self) -> dict:
        return {
            "id": self.id, "link": self.link, "addr": self.addr, "name": self.name,
            "online": self.online, "lastSeen": self.last_seen * 1000 if self.last_seen else None,
            "info": self.info, "canCmd": self.send is not None, "canHwReset": self.hw_reset is not None,
        }


devices: Dict[str, Device] = {}


async def broadcast(obj: dict):
    text = json.dumps(obj, ensure_ascii=False)
    dead = []
    for ws in clients:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in clients:
            clients.remove(ws)


async def broadcast_devices():
    await broadcast({"_type": "devices", "devices": [d.to_json() for d in devices.values()]})


def register_device(dev: Device):
    old = devices.get(dev.id)
    if old is not None:
        dev.info = old.info  # 재연결이면 마지막으로 알던 보드 정보는 유지
    devices[dev.id] = dev
    if main_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast_devices(), main_loop)


def set_device_online(dev_id: str, online: bool):
    d = devices.get(dev_id)
    if d is None or d.online == online:
        return
    d.online = online
    if main_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast_devices(), main_loop)


# ── 실험 기록 세션 ─────────────────────────────────────────
# 6시간처럼 긴 실험에서는 브라우저 탭이 새로고침되거나 노트북 화면이 잠깐 꺼지는 일이 흔하다.
# 그래서 "기록 중인지 / 언제 자동 종료할지 / 지금까지 쌓인 값"은 브라우저가 아니라 서버가 들고 있고,
# 브라우저는 다시 열리면 /api/session으로 전부 되찾아 온다.
#   idle → (시작) → armed(조건 대기) → recording → ended
#   자동 시작 조건이 없으면 armed를 건너뛰고 바로 recording.
# light / lightEvents: 아크릴에 조명을 비추는 중인지 (실험 화면의 💡 버튼). 기록마다 _light(1/0)로 남기고,
# 켜고 끈 시각은 lightEvents에 모아서 그래프에 조명 켠 구간을 표시한다.
session: dict = {"state": "idle", "config": {}, "armedAt": None, "startedAt": None,
                 "endsAt": None, "endedAt": None, "endReason": None, "file": None, "records": [],
                 "light": 0, "lightEvents": []}
_session_file = None


def session_public() -> dict:
    s = {k: v for k, v in session.items() if k != "records"}
    s["count"] = len(session["records"])
    return {"_type": "session", **s}


def _trigger_met(trigger: dict, payload: dict, dev_id: str) -> bool:
    key = trigger.get("key")
    if not key or key not in payload:
        return False
    if trigger.get("dev") and trigger["dev"] != dev_id:
        return False
    try:
        v = float(payload[key])
        target = float(trigger.get("value"))
    except (TypeError, ValueError):
        return False
    return v >= target if trigger.get("op", ">=") == ">=" else v <= target


def _begin_recording(at: float):
    global _session_file
    session["state"] = "recording"
    session["startedAt"] = at * 1000
    dur = session["config"].get("durationSec")
    session["endsAt"] = (at + dur) * 1000 if dur else None
    SESSION_DIR.mkdir(exist_ok=True)
    # 파일 이름 = 학생이 실험 준비에서 정한 실험 이름 + 시각 (파일 이름에 못 쓰는 글자는 뺌)
    title = re.sub(r'[\\/:*?"<>|]', "", str(session["config"].get("name") or "")).strip()[:60] or "실험"
    name = f"{title}_{datetime.fromtimestamp(at).strftime('%Y%m%d_%H%M%S')}"
    session["file"] = name
    session["lightEvents"] = [{"t": at * 1000, "on": session["light"]}]
    _session_file = open(SESSION_DIR / f"{name}.jsonl", "a", encoding="utf-8")


def _end_session(reason: str):
    global _session_file
    if session["state"] not in ("armed", "recording"):
        return
    session["state"] = "ended"
    session["endedAt"] = time.time() * 1000
    session["endReason"] = reason
    if _session_file is not None:
        _session_file.close()
        _session_file = None
        _write_session_csv()


def _write_session_csv():
    """실험이 끝나면 기록을 엑셀에서 바로 열리는 CSV로도 남겨 둔다 (logs/실험_날짜_시각.csv)."""
    recs = session["records"]
    if not recs or not session["file"]:
        return
    fields = ["timestamp", "elapsed_s", "_dev"]
    if any("_light" in r for r in recs):
        fields.append("light")  # 조명 1 = 켬, 0 = 끔
    for r in recs:
        for k in r:
            if k not in fields and not k.startswith("_t") and k != "_light":
                fields.append(k)
    t0 = session["startedAt"] or 0
    with open(SESSION_DIR / f"{session['file']}.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in recs:
            w.writerow({**r, "elapsed_s": round((r["_t"] - t0) / 1000, 3), "light": r.get("_light", "")})


async def session_tick():
    """자동 종료 시간 확인 (값이 안 들어와도 시간이 되면 끝나야 하므로 1초마다 따로 확인)."""
    while True:
        await asyncio.sleep(1)
        if session["state"] == "recording" and session["endsAt"] and time.time() * 1000 >= session["endsAt"]:
            _end_session("time")
            await broadcast(session_public())


# ── 공통 파이프라인: 로깅 + 브라우저 브로드캐스트 ─────────────────
def log_to_csv(payload: dict):
    global csv_fields
    row = {"timestamp": now_iso(), **payload}

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


async def handle_incoming(payload: dict, dev_id: str):
    """어느 경로로 들어왔든 여기로 모여서 동일하게 처리."""
    dev = devices.get(dev_id)
    if dev is not None:
        dev.last_seen = time.time()
        if not dev.online:
            dev.online = True
            await broadcast_devices()

    # 보드 정보(센서 목록·켜짐 상태·측정 간격)는 값이 아니므로 기록하지 않고 장치 목록만 갱신
    if payload.get("_type") == "info":
        if dev is not None:
            dev.info = {k: v for k, v in payload.items() if k != "_type"}
            await broadcast_devices()
        return
    if payload.get("_type"):
        return  # 앞으로 생길 다른 메시지 종류는 일단 무시 (값으로 오인해서 그래프에 섞이지 않게)

    payload = {k: v for k, v in payload.items() if not str(k).startswith("_")}
    now = time.time()
    payload["timestamp"] = now_iso()
    payload["_source"] = dev.link if dev else "unknown"  # 어느 경로로 들어왔는지 구분용
    payload["_dev"] = dev_id
    log_to_csv(payload)

    changed = False
    if session["state"] == "armed" and _trigger_met(session["config"].get("trigger") or {}, payload, dev_id):
        _begin_recording(now)
        changed = True
    if session["state"] == "recording":
        if session["endsAt"] and now * 1000 >= session["endsAt"]:
            _end_session("time")
            changed = True
        else:
            rec = {**payload, "_t": now * 1000, "_light": session["light"]}
            session["records"].append(rec)
            if _session_file is not None:
                _session_file.write(json.dumps(rec, ensure_ascii=False) + "\n")
                _session_file.flush()
            payload["_rec"] = True  # 화면은 이 표시가 붙은 값만 그래프·분석에 쌓는다
            payload["_t"] = rec["_t"]
            payload["_light"] = rec["_light"]
    if changed:
        await broadcast(session_public())
    await broadcast(payload)


# ── 받은 줄 그대로 화면에 (직접 실험의 '🖥 시리얼 모니터' 창) ─────────────
# 값(JSON)이 아닌 디버그 출력·오류 메시지도 그대로 보여 줘서 "값이 안 들어와요"를 찾게 한다.
# 최근 줄은 서버에도 조금 남겨 두어 화면을 새로 열어도 바로 보이게.
raw_recent: list = []


def raw_line(dev_id: str, text: str):
    """어느 스레드에서 불러도 됨 (시리얼 스레드·외부 MQTT 스레드·이벤트 루프)."""
    item = {"_type": "raw", "dev": dev_id, "line": str(text)[:400], "t": time.time() * 1000}
    raw_recent.append(item)
    del raw_recent[:-300]
    if main_loop is None:
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is main_loop:
        asyncio.create_task(broadcast(item))
    else:
        asyncio.run_coroutine_threadsafe(broadcast(item), main_loop)


def submit_incoming(payload: dict, dev_id: str):
    """다른 스레드(시리얼·외부 MQTT)에서 들어온 값을 메인 이벤트 루프로 넘긴다."""
    if main_loop is not None:
        asyncio.run_coroutine_threadsafe(handle_incoming(payload, dev_id), main_loop)


# 시작 화면(4개 박스: 현재실태/미래예측/직접실험/1인칭 탐험) - 이제 이게 진입점.
# 각 대시보드 탭은 더 이상 페이지 안에서 서로 전환하지 않고, 항상 여기로 돌아왔다가
# 원하는 박스를 다시 골라 들어가는 구조라 "/"는 이 화면이 맡는다.
@app.get("/")
async def select_page():
    return versioned_html(RESOURCE_DIR / "select.html")


# 브라우저가 페이지마다 /favicon.ico를 자동으로 요청하는데, 아이콘 파일이 없어서 콘솔에 매번
# "404 Not Found"가 찍혔다. 오류처럼 보여 혼란스러우므로 "내용 없음(204)"으로 조용히 답한다.
@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


# 현재실태/미래예측/직접실험 대시보드 (예전엔 "/"였음) - ?tab=current|future|live로 접속
@app.get("/dashboard")
async def dashboard():
    return versioned_html(RESOURCE_DIR / "index.html")


# 1인칭 탐험 모드 첫 페이지도 버전 표시를 붙여서 준다 (아래 /firstperson 정적 마운트보다 먼저 등록)
@app.get("/firstperson/")
@app.get("/firstperson/index.html")
async def firstperson_page():
    return versioned_html(RESOURCE_DIR / "firstperson" / "index.html")


# ── WiFi HTTP 경로 (예전 방식): POST /data ──────────────────────
@app.post("/data")
async def receive_data(request: Request):
    """WiFi로 통신하는 보드가 여기로 센서 JSON을 POST. 이 경로로는 명령을 돌려보낼 수 없다.
    예: {"tank1_co2": 812.3, "tank1_temp": 23.4}
    """
    payload = await request.json()
    if not isinstance(payload, dict):
        return JSONResponse({"ok": False, "error": "JSON object가 아닙니다"}, status_code=400)
    host = request.client.host if request.client else "unknown"
    dev_id = f"http:{host}"
    if dev_id not in devices:
        register_device(Device(dev_id, "http", host))
    raw_line(dev_id, json.dumps(payload, ensure_ascii=False))
    await handle_incoming(payload, dev_id)
    return {"ok": True, "received": payload}


@app.get("/api/info")
async def api_info():
    """화면의 '연결 정보'에 띄울 값 - ESP32 코드에 넣을 서버(브로커) 주소 등."""
    return server_info


@app.get("/api/raw")
async def api_raw():
    return raw_recent


@app.get("/api/session")
async def api_session():
    """브라우저를 새로 열었을 때 진행 중이던(또는 방금 끝난) 실험 기록을 통째로 되찾는 용도."""
    return {**session_public(), "records": session["records"]}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        await websocket.send_text(json.dumps({"_type": "devices", "devices": [d.to_json() for d in devices.values()]}, ensure_ascii=False))
        await websocket.send_text(json.dumps(session_public(), ensure_ascii=False))
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await handle_ws_message(websocket, msg)
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in clients:
            clients.remove(websocket)


async def handle_ws_message(ws: WebSocket, msg: dict):
    kind = msg.get("_type")
    if kind == "cmd":
        dev = devices.get(msg.get("dev"))
        cmd = msg.get("cmd")
        if dev is None or not isinstance(cmd, dict):
            ok, why = False, "그런 보드가 없습니다"
        elif cmd.get("cmd") == "_hwreset":
            ok = bool(dev.hw_reset) and await dev.hw_reset()
            why = "" if ok else "USB로 연결된 보드만 강제 리셋할 수 있습니다"
        elif dev.send is None:
            ok, why = False, "이 통신 방식(HTTP)으로는 보드에 명령을 보낼 수 없습니다"
        else:
            ok = await dev.send(json.dumps(cmd, ensure_ascii=False))
            why = "" if ok else "보내기 실패 (연결이 끊겼을 수 있음)"
        await ws.send_text(json.dumps({"_type": "cmd_result", "ok": ok, "msg": why,
                                       "dev": msg.get("dev"), "cmd": cmd}, ensure_ascii=False))
    elif kind == "session":
        action = msg.get("action")
        if action == "start":
            if session["state"] in ("armed", "recording"):
                return
            cfg = msg.get("config") or {}
            session.update({"state": "armed", "config": cfg, "armedAt": time.time() * 1000,
                            "startedAt": None, "endsAt": None, "endedAt": None, "endReason": None,
                            "file": None, "records": [], "lightEvents": []})
            if not cfg.get("trigger"):
                _begin_recording(time.time())
            await broadcast(session_public())
        elif action == "stop":
            _end_session("manual")
            await broadcast(session_public())
        elif action == "light":
            on = 1 if msg.get("on") else 0
            if session["light"] != on:
                session["light"] = on
                if session["state"] == "recording":
                    session["lightEvents"].append({"t": time.time() * 1000, "on": on})
                await broadcast(session_public())
    elif kind == "rescan":
        serial_rescan_event.set()


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
            # 실험 준비 화면은 보드 이름표를 '보드 종류'와 '통신 방식'으로 나눠 고르게 한다.
            # 따로 적어 두면 그 값을 쓰고, 없으면 화면이 이름표("우노 R3 + HM-10 (BLE)")에서 알아서 나눈다.
            **({"boardType": info["boardType"]} if info.get("boardType") else {}),
            **({"link": info["link"]} if info.get("link") else {}),
        })
    return items


# style.css, js/*.js 등 정적 파일 서빙 (반드시 위의 라우트들 뒤에 등록해야
# "/", "/data", "/ws"가 이 마운트에 가로채이지 않음)
app.mount("/js", StaticFiles(directory=RESOURCE_DIR / "js"), name="js")
# three.js·Chart.js를 인터넷(CDN) 대신 여기서 준다 - 인터넷이 없거나 느린 교실에서도 3D·그래프가 뜨게
app.mount("/vendor", StaticFiles(directory=RESOURCE_DIR / "vendor"), name="vendor")
app.mount("/texture_image", StaticFiles(directory=RESOURCE_DIR / "texture_image"), name="textures")
app.mount("/basic_experiments", StaticFiles(directory=RESOURCE_DIR / "basic_experiments"), name="basic_experiments")
# 1인칭 탐험 모드 (firstperson/index.html) - html=True라 /firstperson/ 으로 접속하면 index.html이 열림
app.mount("/firstperson", StaticFiles(directory=RESOURCE_DIR / "firstperson", html=True), name="firstperson")


@app.get("/style.css")
async def style_css():
    return FileResponse(RESOURCE_DIR / "style.css")


# ── 1) USB 시리얼 경로 ─────────────────────────
# 학생마다 보드/USB칩/포트 번호가 제각각이라 이름 키워드만으론 못 믿는다
# (엉뚱한 COM포트를 집어서 열려다 실패하는 사고를 실제로 겪었음).
# 그래서 후보 포트를 실제로 열어 JSON 한 줄이 오는지까지 확인해서 진짜 장치를 찾는다.
# basic_experiments의 CO2(MH-Z19B) 예제들은 30초에 한 번만 전송하므로(code.ino의
# SEND_INTERVAL_MS), 포트마다 순서대로 기다리면 최악의 경우 포트 수 x 30초가 걸린다.
# 그래서 후보를 전부 동시에 열어서 지켜본다 (전체 대기 시간이 포트 개수와 무관하게 전송 주기 한 번만큼만 걸리게).
# 우노와 ESP32를 동시에 USB로 꽂는 경우가 생겨서, 이제 JSON을 보내는 포트는 "전부" 채택한다.
SERIAL_PROBE_SECONDS = 33.0  # 기본 실험 코드 중 가장 긴 전송 주기(30초)보다 살짝 여유
SERIAL_POLL_SECONDS = 3.0    # 새로 꽂힌 포트가 있는지 확인하는 주기

serial_rescan_event = threading.Event()  # 화면의 '포트 다시 찾기' 버튼
active_serial: Dict[str, "SerialLink"] = {}
# 포트 이름 → (장치 설명, 블루투스 가상 포트인지). 콘솔 안내 문구를 포트 종류에 맞게 고르려고 기억해 둔다.
port_details: Dict[str, tuple] = {}


def _is_bluetooth_port(p) -> bool:
    # Windows는 블루투스 기기를 한 번이라도 페어링하면 "블루투스 링크를 통한 표준 직렬" COM 포트를
    # 보통 2개(보내기용·받기용) 만들어 두고, 보드를 안 꽂아도 계속 목록에 남는다. 설명 문구는
    # Windows 언어마다 다르므로 언어와 무관한 하드웨어 ID(BTHENUM)를 먼저 본다.
    hwid = (p.hwid or "").upper()
    desc = (p.description or "").lower()
    return "BTHENUM" in hwid or "bluetooth" in desc or "블루투스" in desc


def _list_candidate_ports() -> List[str]:
    """연결된 포트 목록. Arduino/USB-Serial 칩(CH340, CP210x, FTDI 등) 이름이 들어간 포트를 우선순위로 정렬.
    HC-06(클래식 블루투스) 코드는 블루투스 가상 포트로 들어오므로 블루투스 포트도 빼지 않는다."""
    import serial.tools.list_ports

    ports = list(serial.tools.list_ports.comports())
    keywords = ["arduino", "ch340", "usb-serial", "cp210", "ftdi", "usb serial"]

    def looks_like_device(p) -> bool:
        desc = (p.description or "").lower()
        return any(k in desc for k in keywords)

    for p in ports:
        port_details[p.device] = (p.description or "", _is_bluetooth_port(p))
    return [p.device for p in sorted(ports, key=lambda p: not looks_like_device(p))]


def _port_label(port: str) -> str:
    # Windows 설명은 끝에 "(COM4)"가 이미 붙어 있어서 그대로 쓰면 포트 이름이 두 번 나온다
    desc = port_details.get(port, ("", False))[0].replace(f"({port})", "").strip()
    return f"{port} ({desc})" if desc and desc not in (port, "n/a") else port


def _is_bt(port: str) -> bool:
    return port_details.get(port, ("", False))[1]


def _probe_serial_port(port: str, baud: int, probe_seconds: float):
    """포트를 열어서 최대 probe_seconds 동안 JSON 한 줄이 오는지 확인.
    결과를 ("found", 열린 포트, 첫 JSON) / ("busy" 또는 "bt_unreachable", None, None) / ("no_data", None, None) 로 돌려준다 -
    그래야 자동 감지가 실패했을 때 "포트는 있는데 다른 프로그램이 물고 있음"인지 "포트는 열리는데
    JSON이 안 옴(보드레이트 불일치 등)"인지 콘솔에서 바로 구분해서 알려줄 수 있다.
    찾으면 포트를 닫지 않고 그대로 넘긴다 - 우노는 포트를 열 때마다 리셋되므로 닫았다 다시 열면
    부팅을 두 번 하게 된다."""
    import serial

    try:
        ser = serial.Serial(port, baud, timeout=0.5)
    except Exception as e:
        if _is_bt(port):
            # 블루투스 보내기용 포트는 여는 순간 페어링된 기기에 무선으로 접속을 시도하는데, 그 기기가
            # 꺼져 있거나 멀리 있으면 몇 초~수십 초 뒤 "세마포 제한 시간 만료(오류 121)"로 실패한다.
            # 예전엔 이것도 "다른 프로그램이 사용 중"이라고 안내해서 엉뚱한 프로그램을 찾게 만들었다.
            print(f"[시리얼] {_port_label(port)} 열기 실패 — 블루투스 가상 포트입니다. 페어링해 둔 기기(HC-06 등)가 "
                  f"꺼져 있거나 멀리 있으면 이렇게 됩니다. 블루투스 보드를 쓰지 않는다면 무시해도 됩니다. ({e})")
            return "bt_unreachable", None, None
        print(f"[시리얼] {_port_label(port)} 열기 실패 ({e}) — 아두이노 IDE 시리얼 모니터, CoolTerm 등 다른 프로그램이 "
              f"이 포트를 이미 사용 중일 수 있습니다. 닫고 '포트 다시 찾기'를 눌러보세요.")
        return "busy", None, None
    deadline = time.time() + probe_seconds
    while time.time() < deadline:
        try:
            line = ser.readline().decode("utf-8").strip()
        except UnicodeDecodeError:
            continue  # 잡음으로 깨진 줄 - 이번 줄만 버리고 계속 기다림
        except Exception:
            break
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue  # 보드가 디버그 텍스트를 찍어도 무시하고 계속 기다림
        if isinstance(payload, dict):
            return "found", ser, payload
    ser.close()
    return "no_data", None, None


class SerialLink:
    """열린 시리얼 포트 하나 = 보드 하나. 읽기는 전용 스레드, 쓰기(명령)는 잠금을 걸고 바로."""

    def __init__(self, port: str, ser, baud: int):
        self.port = port
        self.ser = ser
        self.baud = baud
        self.lock = threading.Lock()
        self.dev_id = f"usb:{port}"
        register_device(Device(self.dev_id, "usb", port, send=self.send, hw_reset=self.hw_reset))

    async def send(self, line: str) -> bool:
        try:
            with self.lock:
                self.ser.write((line + "\n").encode("utf-8"))
            return True
        except Exception:
            return False

    async def hw_reset(self) -> bool:
        """USB-시리얼 칩의 DTR/RTS 선을 흔들어서 보드를 리셋한다.
        우노: DTR이 다시 켜지는 순간 리셋 / ESP32 DevKitC: RTS가 EN(리셋) 핀에 연결돼 있음."""
        def pulse():
            with self.lock:
                self.ser.dtr = False
                self.ser.rts = True
                time.sleep(0.1)
                self.ser.rts = False
                time.sleep(0.05)
                self.ser.dtr = True
        try:
            await asyncio.get_running_loop().run_in_executor(None, pulse)
            return True
        except Exception:
            return False

    def read_forever(self, first_payload: Optional[dict]):
        print(f"[시리얼] 연결됨: {self.port}")
        if first_payload is not None:
            submit_incoming(first_payload, self.dev_id)
        # 우노 표준 코드는 부팅할 때 info를 한 번 보내지만, 서버가 늦게 붙으면 놓치므로 한 번 물어본다
        try:
            with self.lock:
                self.ser.write(b'{"cmd":"info"}\n')
        except Exception:
            pass
        while True:
            try:
                # errors="ignore"로 읽으면 배선/보드레이트 문제로 바이트가 깨졌을 때 그 바이트만
                # 조용히 지워버려서 "temp"가 "tmp"처럼 다른 문자열로 둔갑한 채로도 JSON 파싱에
                # 성공할 수 있었다 - 대시보드 입장에선 그게 완전히 새로운 센서로 보여 카드가 계속
                # 늘어나는 것처럼 보인 원인 중 하나. strict로 읽어서 깨진 줄은 통째로 버린다.
                rawb = self.ser.readline()
                try:
                    line = rawb.decode("utf-8").strip()
                except UnicodeDecodeError:
                    raw_line(self.dev_id, "(깨진 줄 — 통신 속도(baud)나 배선을 확인하세요) " + rawb.decode("utf-8", errors="replace").strip())
                    raise
                if not line:
                    continue
                raw_line(self.dev_id, line)
                payload = json.loads(line)  # JSON이 아닌 디버그 출력 줄은 여기서 자동으로 걸러짐
                if isinstance(payload, dict):
                    submit_incoming(payload, self.dev_id)
            except UnicodeDecodeError:
                continue  # 잡음으로 깨진 줄 - 이번 줄만 버리고 다음 줄 계속 읽음
            except json.JSONDecodeError:
                continue  # 보드가 중간에 다른 디버그 텍스트를 찍어도 무시하고 계속 진행
            except Exception as e:
                print(f"[시리얼] {self.port} 연결 끊김: {e}")
                break
        try:
            self.ser.close()
        except Exception:
            pass
        active_serial.pop(self.port, None)
        set_device_online(self.dev_id, False)


def _adopt_port(port: str, ser, baud: int, first_payload: Optional[dict]):
    link = SerialLink(port, ser, baud)
    active_serial[port] = link
    threading.Thread(target=link.read_forever, args=(first_payload,), daemon=True).start()


def serial_manager(baud: int, fixed_ports: Optional[List[str]]):
    """포트 찾기 + 계속 읽기를 전부 백그라운드 스레드에서 처리.
    예전엔 uvicorn을 띄우기 *전에* 여기서 최대 33초를 기다렸기 때문에, 포트를 못 찾으면
    브라우저 페이지 자체가 그동안 안 열렸다 (학생 입장에선 서버가 멈춘 것처럼 보임).
    이제 서버가 먼저 뜨고 이 스레드가 뒤에서 찾는다. 케이블을 나중에 꽂거나 뺐다 다시 꽂아도
    포트 목록이 바뀌면 새 포트만 다시 확인한다 (이미 확인해서 JSON이 없던 포트를 계속 열어보면
    우노가 그때마다 리셋되므로, '포트 다시 찾기'를 누르기 전엔 다시 안 건드린다)."""
    import serial

    if fixed_ports:
        while True:
            for port in fixed_ports:
                if port in active_serial:
                    continue
                try:
                    ser = serial.Serial(port, baud, timeout=2)
                    print(f"[시리얼] {port} @ {baud}bps (직접 지정)")
                    _adopt_port(port, ser, baud, None)
                except Exception as e:
                    print(f"[시리얼] {port} 연결 실패: {e} — 5초 뒤 다시 시도")
            time.sleep(5)

    tried: set = set()
    announced_empty = False
    while True:
        if serial_rescan_event.is_set():
            serial_rescan_event.clear()
            tried.clear()
            print("[시리얼] 포트 다시 찾기 요청 받음")
        present = _list_candidate_ports()
        tried &= set(present)  # 뽑힌 포트는 잊어버려서, 다시 꽂히면 새로 확인
        new_ports = [p for p in present if p not in active_serial and p not in tried]
        if not present and not active_serial and not announced_empty:
            print("[시리얼] 연결된 포트가 없습니다 (USB 케이블이 꽂혀 있는지 확인하세요). 꽂으면 자동으로 찾습니다.")
            announced_empty = True
        if new_ports:
            announced_empty = False
            print(f"[시리얼] 포트 {len(new_ports)}개 확인 중 ({', '.join(_port_label(p) for p in new_ports)}, "
                  f"최대 {int(SERIAL_PROBE_SECONDS)}초 — 전송 주기가 긴 실험 코드도 있어서 시간이 걸릴 수 있음)…")
            results: Dict[str, str] = {}

            def worker(port: str):
                status, ser, first = _probe_serial_port(port, baud, SERIAL_PROBE_SECONDS)
                results[port] = status
                if status == "found":
                    _adopt_port(port, ser, baud, first)

            threads = [threading.Thread(target=worker, args=(p,), daemon=True) for p in new_ports]
            for t in threads:
                t.start()
            for t in threads:
                t.join(SERIAL_PROBE_SECONDS + 2)
            tried.update(new_ports)
            no_data = [p for p, s in results.items() if s == "no_data"]
            # 블루투스 받기용 포트는 기기가 없어도 잘 열리고 아무것도 안 오는 게 정상이라,
            # 보드레이트를 의심하라는 안내와 섞으면 보드가 없는 PC에서도 고장처럼 보인다.
            bt_quiet = [p for p in no_data if _is_bt(p)]
            usb_quiet = [p for p in no_data if not _is_bt(p)]
            if bt_quiet:
                print(f"[시리얼] {', '.join(_port_label(p) for p in bt_quiet)} — 블루투스 가상 포트라 열렸지만 "
                      f"{int(SERIAL_PROBE_SECONDS)}초 동안 데이터가 없었습니다. HC-06 보드를 쓰는 중이 아니면 무시해도 됩니다.")
            if usb_quiet:
                print(f"[시리얼] {', '.join(_port_label(p) for p in usb_quiet)} 포트는 열렸지만 {int(SERIAL_PROBE_SECONDS)}초 동안 올바른 "
                      f"JSON을 받지 못했습니다 — 보드레이트가 스케치의 Serial.begin() 값과 일치하는지 "
                      f"(서버는 기본 {baud}bps, 다르면 --baud 옵션으로 지정), 스케치가 JSON을 제대로 출력하는지 확인하세요. "
                      f"WiFi·BLE용 ESP32 코드는 USB로 115200bps 디버그 글만 찍으므로, 전원만 USB로 받는 거라면 이 안내는 무시해도 됩니다.")
        serial_rescan_event.wait(SERIAL_POLL_SECONDS)


# ── 2) BLE 경로 ─────────────────────────
# basic_experiments의 ESP32 BLE 코드와 우노+HM-10이 같은 UUID를 쓰기 때문에
# 보드 종류를 몰라도 이 코드 하나로 둘 다 처리됨. 같은 특성(FFE1)에 써서 명령도 보낸다.
BLE_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb"
BLE_CHUNK = 20  # HM-10은 한 번에 20바이트까지만 받으므로 명령을 잘라서 보낸다


async def ble_reader_task(name_filter: str, address: Optional[str]):
    """bleak으로 BLE 기기에 연결해 notify를 구독.
    시리얼과 달리 asyncio 네이티브라 별도 스레드 없이 이벤트 루프 위에서 그대로 돈다.
    연결이 끊기거나 기기를 못 찾으면 계속 재시도한다 (시리얼 자동 재접속과 동일한 정책).
    """
    from bleak import BleakClient, BleakScanner

    while True:
        buffer = ""
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
                dev_id = f"ble:{target}"

                async def send(line: str) -> bool:
                    try:
                        data = (line + "\n").encode("utf-8")
                        for i in range(0, len(data), BLE_CHUNK):
                            await client.write_gatt_char(BLE_CHAR_UUID, data[i:i + BLE_CHUNK], response=False)
                            await asyncio.sleep(0.02)
                        return True
                    except Exception:
                        return False

                def handle_notify(_, data: bytearray):
                    nonlocal buffer
                    buffer += data.decode("utf-8", errors="ignore")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        raw_line(dev_id, line)
                        try:
                            payload = json.loads(line)  # 디버그 출력이 섞여 들어와도 여기서 자동으로 걸러짐
                        except json.JSONDecodeError:
                            continue
                        if isinstance(payload, dict):
                            asyncio.create_task(handle_incoming(payload, dev_id))

                register_device(Device(dev_id, "ble", target, send=send))
                print(f"[BLE] 연결됨: {target}")
                await client.start_notify(BLE_CHAR_UUID, handle_notify)
                await send('{"cmd":"info"}')
                while client.is_connected:
                    await asyncio.sleep(1)
                set_device_online(dev_id, False)
                print("[BLE] 연결 끊김, 재접속 시도")
        except Exception as e:
            print(f"[BLE] 오류: {e}, 5초 후 재시도")
            await asyncio.sleep(5)


# ── 3) WiFi MQTT 경로 ─────────────────────────
MQTT_PREFIX = "miniearth"
mqtt_publish: Optional[Callable[[str, bytes], None]] = None


def mqtt_on_message(topic: str, payload: bytes):
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != MQTT_PREFIX:
        return
    _, dev, kind = parts
    dev_id = f"mqtt:{dev}"
    if kind == "cmd":
        return  # 서버 자신이 보낸 명령이 되돌아온 것
    if dev_id not in devices:
        def send_factory(name: str):
            async def send(line: str) -> bool:
                if mqtt_publish is None:
                    return False
                mqtt_publish(f"{MQTT_PREFIX}/{name}/cmd", line.encode("utf-8"))
                return True
            return send
        register_device(Device(dev_id, "mqtt", dev, send=send_factory(dev)))
    raw_line(dev_id, f"[{kind}] " + payload.decode("utf-8", errors="replace").strip())
    if kind == "status":
        text = payload.decode("utf-8", errors="ignore").strip().lower()
        set_device_online(dev_id, text != "offline")
        return
    if kind not in ("data", "info"):
        return
    try:
        obj = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return
    if not isinstance(obj, dict):
        return
    if kind == "info":
        obj["_type"] = "info"
    submit_incoming(obj, dev_id)


async def start_embedded_broker(port: int) -> bool:
    global mqtt_publish
    from mqtt_broker import MiniBroker
    broker = MiniBroker(on_message=mqtt_on_message)
    try:
        await broker.start("0.0.0.0", port)
    except OSError:
        return False
    mqtt_publish = lambda topic, data: broker.publish(topic, data)
    return True


def start_external_mqtt(host: str, port: int) -> bool:
    """Mosquitto 등 따로 켜 둔 브로커에 '구독자'로 붙는다 (paho-mqtt 필요)."""
    global mqtt_publish
    try:
        import paho.mqtt.client as paho
    except ImportError:
        print("[MQTT] paho-mqtt가 설치돼 있지 않아 외부 브로커에 붙을 수 없습니다 (pip install paho-mqtt)")
        return False
    client = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=f"miniearth-server-{int(time.time())}")

    def on_connect(c, userdata, flags, reason_code, properties=None):
        print(f"[MQTT] 외부 브로커 {host}:{port} 연결됨")
        c.subscribe(f"{MQTT_PREFIX}/#")

    client.on_connect = on_connect
    client.on_message = lambda c, u, m: mqtt_on_message(m.topic, m.payload)
    try:
        client.connect(host, port, keepalive=30)
    except Exception as e:
        print(f"[MQTT] 외부 브로커 {host}:{port} 연결 실패: {e}")
        return False
    client.loop_start()
    mqtt_publish = lambda topic, data: client.publish(topic, data)
    return True


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
    parser.add_argument("--serial", type=str, default=None, help="시리얼 포트 직접 지정 (예: COM5 또는 COM5,COM7)")
    parser.add_argument("--baud", type=int, default=9600, help="시리얼 통신 속도 (스케치의 Serial.begin 값과 반드시 일치)")
    parser.add_argument("--no-serial", action="store_true", help="시리얼 입력을 사용하지 않음")
    parser.add_argument("--ble", action="store_true", help="BLE(ESP32 네이티브 BLE 또는 우노+HM-10) 입력 사용")
    parser.add_argument("--ble-name", type=str, default="MiniEarth", help="BLE 기기 이름에 포함될 문자열 (기본: MiniEarth)")
    parser.add_argument("--ble-address", type=str, default=None, help="BLE 기기 MAC/UUID 직접 지정 (스캔 생략, 더 빠름)")
    parser.add_argument("--mqtt-port", type=int, default=1883, help="내장 MQTT 브로커 포트 (기본 1883)")
    parser.add_argument("--mqtt-host", type=str, default=None, help="내장 브로커 대신 이 주소의 브로커(Mosquitto 등)에 연결")
    parser.add_argument("--no-mqtt", action="store_true", help="MQTT를 사용하지 않음")
    parser.add_argument("--no-browser", action="store_true", help="서버 시작 시 브라우저 자동으로 열지 않음")
    parser.add_argument("--port", type=int, default=8000, help="웹 서버 포트 (기본 8000)")
    args = parser.parse_args()

    import uvicorn

    ip = get_local_ip()
    server_info["ip"] = ip
    server_info["httpPort"] = args.port
    print("=" * 55)
    print(f"  브라우저 접속:        http://{ip}:{args.port}")
    print(f"  WiFi(HTTP) 전송 주소:  http://{ip}:{args.port}/data")

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

    # @app.on_event("startup")는 FastAPI에서 폐기 예정이라 실행할 때마다 DeprecationWarning이 길게
    # 찍혔고, Starlette 1.0부터는 아예 없어져 라이브러리 버전을 올리면 서버가 안 뜨게 된다.
    # 같은 일을 lifespan(서버 시작~종료를 감싸는 함수)으로 한다. args를 써야 해서 여기서 끼운다.
    @contextlib.asynccontextmanager
    async def lifespan(_app):
        await start_inputs_if_needed()
        yield

    app.router.lifespan_context = lifespan

    async def start_inputs_if_needed():
        global main_loop
        main_loop = asyncio.get_running_loop()
        asyncio.create_task(session_tick())

        if not args.no_mqtt:
            if args.mqtt_host:
                ok = await main_loop.run_in_executor(None, start_external_mqtt, args.mqtt_host, args.mqtt_port)
                if ok:
                    server_info["mqtt"] = {"mode": "external", "host": args.mqtt_host, "port": args.mqtt_port}
            elif await start_embedded_broker(args.mqtt_port):
                server_info["mqtt"] = {"mode": "embedded", "host": ip, "port": args.mqtt_port}
                print(f"  WiFi(MQTT) 브로커:     {ip}:{args.mqtt_port} (서버에 내장, ESP32 코드의 MQTT_SERVER에 이 주소)")
            else:
                # 1883 포트가 이미 쓰이고 있으면 대개 Mosquitto가 서비스로 켜져 있는 경우라 그쪽에 붙는다
                print(f"  [MQTT] {args.mqtt_port} 포트를 이미 다른 프로그램(Mosquitto 등)이 쓰고 있어 그 브로커에 연결합니다")
                ok = await main_loop.run_in_executor(None, start_external_mqtt, "127.0.0.1", args.mqtt_port)
                if ok:
                    server_info["mqtt"] = {"mode": "external", "host": ip, "port": args.mqtt_port}
        print("=" * 55)

        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{args.port}")
        if not args.no_serial:
            fixed = [p.strip() for p in args.serial.split(",")] if args.serial else None
            threading.Thread(target=serial_manager, args=(args.baud, fixed), daemon=True).start()
        if args.ble:
            asyncio.create_task(ble_reader_task(args.ble_name, args.ble_address))

    uvicorn.run(app, host="0.0.0.0", port=args.port)
