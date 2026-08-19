@echo off
cd /d "F:\APPS\Script Manager"
git pull origin main
powershell -ExecutionPolicy Bypass -Command "npm start"
