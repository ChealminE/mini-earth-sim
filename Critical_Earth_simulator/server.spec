# PyInstaller 빌드 설정 파일.
# 코드/웹 리소스가 바뀔 때마다 재빌드 필요: build_exe.bat 더블클릭 (또는 pyinstaller server.spec)
# 결과물: dist/MiniEarthModel.exe (이 파일 하나가 파이썬 인터프리터 + 라이브러리 + index.html/js/텍스처/기본실험까지 전부 포함)

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('index.html', '.'),
        # 시작 화면. server.py 가 "/" 에서 이 파일을 돌려준다.
        ('select.html', '.'),
        ('style.css', '.'),
        ('js', 'js'),
        ('texture_image', 'texture_image'),
        ('basic_experiments', 'basic_experiments'),
        # 1인칭 탐험 모드. StaticFiles(directory=...) 는 폴더가 없으면 import 시점에
        # RuntimeError 를 내므로, 빠뜨리면 exe 가 첫 화면도 못 띄우고 죽는다.
        ('firstperson', 'firstperson'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'bleak.backends.winrt',
        # server.py가 함수 안에서 import하는 모듈들 (내장 MQTT 브로커 / Mosquitto 연결용).
        # PyInstaller가 대개 알아서 찾지만, 빠지면 exe에서 WiFi(MQTT)만 조용히 안 되므로 명시한다.
        'mqtt_broker',
        'paho.mqtt.client',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='MiniEarthModel',
    console=True,
)
