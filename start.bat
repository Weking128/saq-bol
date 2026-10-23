@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите версию 20.19 или новее: https://nodejs.org
  pause
  exit /b 1
)
if not exist ".env" (
  echo Не найден файл .env. Скопируйте .env.example в .env и укажите MONGODB_URI и ADMIN_PASSWORD.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Устанавливаем зависимости...
  call npm install --no-audit --no-fund
)
echo Запуск квеста «Сақ бол!»...
echo Игра:         http://localhost:3000
echo Админ-панель: http://localhost:3000/admin
echo Чтобы остановить сервер, закройте это окно.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node dev-server.js
pause
