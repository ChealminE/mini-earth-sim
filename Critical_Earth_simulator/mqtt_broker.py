"""
Mini Earth Model - server.py에 내장되는 작은 MQTT 브로커 (MQTT 3.1.1)
=====================================================================
WiFi로 연결하는 ESP32가 센서 값을 "발행(publish)"하고, 서버가 보내는 명령을 "구독(subscribe)"
하려면 그 사이를 중계해 주는 브로커가 하나 있어야 한다. Mosquitto를 학생 PC마다 따로 설치하게
하는 대신, server.py를 켜면 브로커도 같이 켜지도록 여기 직접 구현했다.

수업용 LAN에서 보드 몇 대가 붙는 상황만 가정하므로 필요한 것만 넣었다:
  - CONNECT / CONNACK, DISCONNECT, PINGREQ / PINGRESP
  - PUBLISH (QoS 0·1·2 수신, 구독자에게는 QoS 0으로 전달), retain
  - SUBSCRIBE / UNSUBSCRIBE (와일드카드 + 와 # 지원)
  - Last Will (보드 전원이 갑자기 꺼지면 keepalive 시간 뒤에 "offline"을 대신 발행)
인증·TLS·세션 저장(clean session=0)은 지원하지 않는다.

server.py는 on_message 콜백으로 모든 발행 메시지를 받아보고, publish()로 명령을 보낸다.
"""

import asyncio
from typing import Callable, Dict, List, Optional, Set, Tuple

# 패킷 종류 (고정 헤더 상위 4비트)
CONNECT, CONNACK, PUBLISH, PUBACK, PUBREC, PUBREL, PUBCOMP = 1, 2, 3, 4, 5, 6, 7
SUBSCRIBE, SUBACK, UNSUBSCRIBE, UNSUBACK, PINGREQ, PINGRESP, DISCONNECT = 8, 9, 10, 11, 12, 13, 14


def topic_matches(pattern: str, topic: str) -> bool:
    """구독 패턴(+ 한 단계, # 이하 전부)이 실제 토픽과 맞는지."""
    p_parts = pattern.split("/")
    t_parts = topic.split("/")
    for i, p in enumerate(p_parts):
        if p == "#":
            return True
        if i >= len(t_parts):
            return False
        if p != "+" and p != t_parts[i]:
            return False
    return len(p_parts) == len(t_parts)


def _encode_len(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 0x80
        out.append(b)
        if not n:
            return bytes(out)


def _str(s: str) -> bytes:
    b = s.encode("utf-8")
    return len(b).to_bytes(2, "big") + b


def _packet(ptype: int, flags: int, body: bytes) -> bytes:
    return bytes([(ptype << 4) | flags]) + _encode_len(len(body)) + body


class _Client:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.client_id = ""
        self.subs: Set[str] = set()
        self.will: Optional[Tuple[str, bytes, bool]] = None
        self.keepalive = 60
        self.peer = writer.get_extra_info("peername")

    def send(self, data: bytes):
        try:
            self.writer.write(data)
        except Exception:
            pass


class MiniBroker:
    def __init__(self, on_message: Optional[Callable[[str, bytes], None]] = None,
                 on_client_change: Optional[Callable[[str, bool], None]] = None):
        self.on_message = on_message
        self.on_client_change = on_client_change
        self.clients: Dict[str, _Client] = {}
        self.retained: Dict[str, bytes] = {}
        self.server: Optional[asyncio.AbstractServer] = None

    async def start(self, host: str = "0.0.0.0", port: int = 1883):
        self.server = await asyncio.start_server(self._handle, host, port)

    # ── 서버 쪽에서 직접 발행 (명령 보내기) ──
    def publish(self, topic: str, payload: bytes, retain: bool = False):
        if retain:
            if payload:
                self.retained[topic] = payload
            else:
                self.retained.pop(topic, None)
        pkt = _packet(PUBLISH, 0, _str(topic) + payload)  # 실시간 전달은 retain 플래그 없이
        for c in list(self.clients.values()):
            if any(topic_matches(s, topic) for s in c.subs):
                c.send(pkt)
        if self.on_message:
            try:
                self.on_message(topic, payload)
            except Exception as e:
                print(f"[MQTT] 메시지 처리 오류: {e}")

    async def _read_packet(self, c: _Client) -> Tuple[int, int, bytes]:
        timeout = c.keepalive * 1.5 if c.keepalive else None
        first = await asyncio.wait_for(c.reader.readexactly(1), timeout)
        mult, length = 1, 0
        for _ in range(4):
            b = (await c.reader.readexactly(1))[0]
            length += (b & 0x7F) * mult
            if not b & 0x80:
                break
            mult *= 128
        body = await c.reader.readexactly(length) if length else b""
        return first[0] >> 4, first[0] & 0x0F, body

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        c = _Client(reader, writer)
        clean_exit = False
        try:
            # 첫 패킷은 반드시 CONNECT여야 함 (10초 안에)
            c.keepalive = 10
            ptype, _, body = await self._read_packet(c)
            if ptype != CONNECT:
                return
            if not self._on_connect(c, body):
                return
            while True:
                ptype, flags, body = await self._read_packet(c)
                if ptype == PUBLISH:
                    self._on_publish(c, flags, body)
                elif ptype == PUBREL:
                    c.send(_packet(PUBCOMP, 0, body[:2]))
                elif ptype == SUBSCRIBE:
                    self._on_subscribe(c, body)
                elif ptype == UNSUBSCRIBE:
                    self._on_unsubscribe(c, body)
                elif ptype == PINGREQ:
                    c.send(_packet(PINGRESP, 0, b""))
                elif ptype == DISCONNECT:
                    clean_exit = True
                    return
                await writer.drain()
        except (asyncio.IncompleteReadError, asyncio.TimeoutError, ConnectionError, OSError):
            pass
        except Exception as e:
            print(f"[MQTT] {c.client_id or c.peer} 처리 중 오류: {e}")
        finally:
            if c.client_id and self.clients.get(c.client_id) is c:
                del self.clients[c.client_id]
                if not clean_exit and c.will:
                    topic, msg, retain = c.will
                    self.publish(topic, msg, retain)
                if self.on_client_change:
                    self.on_client_change(c.client_id, False)
            try:
                writer.close()
            except Exception:
                pass

    def _on_connect(self, c: _Client, body: bytes) -> bool:
        pos = 0
        name_len = int.from_bytes(body[pos:pos + 2], "big"); pos += 2 + name_len
        level = body[pos]; pos += 1
        flags = body[pos]; pos += 1
        c.keepalive = int.from_bytes(body[pos:pos + 2], "big"); pos += 2
        if level not in (3, 4):
            c.send(_packet(CONNACK, 0, bytes([0, 1])))  # 지원하지 않는 프로토콜 버전
            return False

        def read_field():
            nonlocal pos
            n = int.from_bytes(body[pos:pos + 2], "big")
            v = body[pos + 2:pos + 2 + n]
            pos += 2 + n
            return v

        c.client_id = read_field().decode("utf-8", errors="replace") or f"anon-{id(c)}"
        if flags & 0x04:  # Will 플래그
            will_topic = read_field().decode("utf-8", errors="replace")
            will_msg = read_field()
            c.will = (will_topic, will_msg, bool(flags & 0x20))
        # 사용자 이름/비밀번호는 받기만 하고 검사하지 않음 (교실 LAN 전용)

        old = self.clients.get(c.client_id)
        if old is not None:  # 같은 ID로 다시 접속하면(보드 재부팅 등) 예전 연결은 끊는다
            old.will = None
            try:
                old.writer.close()
            except Exception:
                pass
        self.clients[c.client_id] = c
        c.send(_packet(CONNACK, 0, bytes([0, 0])))
        if self.on_client_change:
            self.on_client_change(c.client_id, True)
        return True

    def _on_publish(self, c: _Client, flags: int, body: bytes):
        qos = (flags >> 1) & 0x03
        retain = bool(flags & 0x01)
        n = int.from_bytes(body[0:2], "big")
        topic = body[2:2 + n].decode("utf-8", errors="replace")
        pos = 2 + n
        if qos > 0:
            packet_id = body[pos:pos + 2]
            pos += 2
            c.send(_packet(PUBACK if qos == 1 else PUBREC, 0, packet_id))
        self.publish(topic, body[pos:], retain)

    def _on_subscribe(self, c: _Client, body: bytes):
        packet_id = body[0:2]
        pos = 2
        granted = bytearray()
        new_subs: List[str] = []
        while pos < len(body):
            n = int.from_bytes(body[pos:pos + 2], "big")
            topic = body[pos + 2:pos + 2 + n].decode("utf-8", errors="replace")
            pos += 2 + n + 1  # 요청 QoS 바이트는 건너뜀 (항상 0으로 허가)
            c.subs.add(topic)
            new_subs.append(topic)
            granted.append(0)
        c.send(_packet(SUBACK, 0, packet_id + bytes(granted)))
        for t, payload in self.retained.items():
            if any(topic_matches(s, t) for s in new_subs):
                c.send(_packet(PUBLISH, 0x01, _str(t) + payload))

    def _on_unsubscribe(self, c: _Client, body: bytes):
        packet_id = body[0:2]
        pos = 2
        while pos < len(body):
            n = int.from_bytes(body[pos:pos + 2], "big")
            c.subs.discard(body[pos + 2:pos + 2 + n].decode("utf-8", errors="replace"))
            pos += 2 + n
        c.send(_packet(UNSUBACK, 0, packet_id))
