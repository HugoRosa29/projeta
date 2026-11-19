@echo off
setlocal
cd /d "%~dp0.."
if not exist backend\.venv\Scripts\python.exe (
  echo Ambiente Python ausente. Siga a instalacao no README.md.
  exit /b 1
)
if not exist frontend\dist\index.html (
  echo Interface compilada ausente. Execute npm.cmd run build dentro de frontend.
  exit /b 1
)
backend\.venv\Scripts\python.exe -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:5173/health', timeout=2); assert r.read() == b'{\"status\":\"ok\"}'" >nul 2>&1
if not errorlevel 1 (
  echo Projeta ja esta rodando: http://127.0.0.1:5173
  exit /b 0
)
docker compose up -d --wait db
if errorlevel 1 (
  echo Nao foi possivel iniciar o banco. Abra o Docker Desktop e tente novamente.
  exit /b 1
)
cd backend
echo Abra http://127.0.0.1:5173 - Ctrl+C encerra a interface e a API.
.venv\Scripts\python.exe -m uvicorn local_preview:app --app-dir scripts --host 127.0.0.1 --port 5173
exit /b %errorlevel%
