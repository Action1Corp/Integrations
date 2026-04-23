@echo off
setlocal

cd /d "C:\Tools\entra-action1-connector"

node index.js --config ".\config.json" --apply



endlocal
