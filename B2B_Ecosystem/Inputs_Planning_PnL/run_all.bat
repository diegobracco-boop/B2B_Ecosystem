@echo off
REM ============================================================
REM  Inputs Planning P&L — genera planas + JSON canonicos y sube a Drive
REM  Uso mensual: doble clic (o run_all.bat)
REM  Requisito 1 vez: python auth_drive.py  (token_drive.json)
REM ============================================================
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo === PLANAS de proyecciones ===
python plana_projections_builder.py budget       || goto :err
python plana_projections_builder.py forecast     || goto :err
python plana_projections_builder.py runrate      || goto :err
python plana_projections_builder.py lastrunrate  || goto :err

echo.
echo === PLANA de Actuals FY2027 (se actualiza cada mes) ===
python plana_actuals_builder.py 2027             || goto :err

echo.
echo === JSON canonicos por concepto -> Drive ===
python json_builder.py all                        || goto :err

echo.
echo ============================================================
echo   LISTO: planas + 5 JSON (budget/forecast/runrate/lastrunrate/actuals) en Drive.
echo ============================================================
pause
goto :eof
:err
echo.
echo *** ERROR: se detuvo. Revisa el mensaje de arriba. ***
echo    (Si es de auth: corre  python auth_drive.py  una vez.)
pause
exit /b 1
