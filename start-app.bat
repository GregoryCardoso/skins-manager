@echo off
chcp 65001 >nul
title Skins Manager
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js não está instalado.
  echo Baixe a versão LTS em https://nodejs.org, instale e abra este arquivo de novo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -p "process.versions.node"') do set "NODE_VERSION=%%v"
for /f "delims=" %%m in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%m"
if %NODE_MAJOR% LSS 20 (
  echo O Skins Manager precisa do Node.js 20 ou mais novo. Versão encontrada: %NODE_VERSION%.
  echo Baixe a versão LTS em https://nodejs.org, instale e abra este arquivo de novo.
  pause
  exit /b 1
)

REM Se o app já estiver rodando, só abre o navegador (e avisa se quem o mantém é o app desktop).
node "scripts\startHelpers.js" running
if not errorlevel 1 (
  node "scripts\startHelpers.js" desktop-lock
  if not errorlevel 1 (
    echo O Skins Manager já está aberto pelo app desktop.
    echo Abrindo o navegador nele...
  ) else (
    echo O Skins Manager já está aberto. Abrindo o navegador...
  )
  node "scripts\openWhenReady.js"
  exit /b 0
)

REM Primeira vez: instala as dependências.
set "NEED_INSTALL="
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist "backend\node_modules" set "NEED_INSTALL=1"
if not exist "frontend\node_modules" set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  echo Primeira vez: instalando os componentes do app. Pode demorar alguns minutos...
  call npm.cmd run install:all
  if errorlevel 1 (
    echo.
    echo Não foi possível instalar os componentes do app. Verifique a internet e abra este arquivo de novo.
    pause
    exit /b 1
  )
)

REM Compila a interface só quando precisa (sem build ou codigo mais novo).
node "scripts\startHelpers.js" needs-build
if not errorlevel 1 (
  echo Montando a tela do app. Isso só acontece na primeira vez ou depois de uma atualização...
  call npm.cmd run build
  if errorlevel 1 (
    echo.
    echo Não foi possível montar a tela do app. Leia a mensagem acima e abra este arquivo de novo.
    pause
    exit /b 1
  )
)

REM Abre o navegador assim que o servidor responder.
start "" /b node "scripts\openWhenReady.js"

echo Iniciando o Skins Manager. Para fechar o app, feche esta janela.
call npm.cmd run serve
if errorlevel 1 (
  echo.
  echo O Skins Manager parou com erro. Leia a mensagem acima.
  pause
  exit /b 1
)
