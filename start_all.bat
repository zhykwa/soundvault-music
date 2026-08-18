@echo off
cd /d e:\flac
set Path=%SystemRoot%\system32;%SystemRoot%;C:\Users\ACER\AppData\Local\Microsoft\WindowsApps;C:\Users\ACER\AppData\Local\Packages\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\LocalCache\local-packages\Python312\Scripts;C:\Users\ACER\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin;%Path%

:: Start Flask app in background
start /b python -u app.py > app.log 2>&1

:: Wait 3 seconds for Flask server to launch
timeout /t 3 /nobreak >nul

:: Start Cloudflare Tunnel with auto-protocol for maximum stability
e:\flac\cloudflared.exe tunnel run --url http://127.0.0.1:5000 soundvault > tunnel.log 2>&1
