@echo off
title SoundVault Custom Domain Tunnel
echo =======================================================
echo   SoundVault - Cloudflare Tunnel for music.kelompok11cc.my.id
echo =======================================================
echo.
e:\flac\cloudflared.exe tunnel run --url http://127.0.0.1:5000 soundvault
pause
