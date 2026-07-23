# PyInstaller 빌드 설정 파일.
# 코드/웹 리소스가 바뀔 때마다 재빌드 필요: build_exe.bat 더블클릭 (또는 pyinstaller server.spec)
# 결과물: dist/MiniEarthModel.exe (이 파일 하나가 파이썬 인터프리터 + 라이브러리 + index.html/js/텍스처/기본실험까지 전부 포함)

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('index.html', '.'),
        ('style.css', '.'),
        ('js', 'js'),
        ('texture_image', 'texture_image'),
        ('basic_experiments', 'basic_experiments'),
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
