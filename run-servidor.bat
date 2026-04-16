@echo off
title Ferriol OS - Servidor local
cd /d "%~dp0"
echo.
echo  Carpeta del proyecto: %cd%
echo  Abri el navegador en:  http://localhost:3000/kiosco.html
echo  Para instalar la app:  en Chrome, usa el boton "Instalar app" que aparece abajo.
echo  Para salir:  Ctrl+C
echo.
npx -y serve -l 3000
pause
