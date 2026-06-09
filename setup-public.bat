@echo off
cd /d "%~dp0"
echo ============================================
echo  Paper Reading - Public Setup
echo ============================================
echo.
echo This will create a fresh instance with:
echo   - Empty database (no papers)
echo   - Default admin account (admin / admin123)
echo   - Per-user database mode enabled
echo.
echo Existing papers.db will be backed up.
echo.
set /p CONFIRM="Continue? (y/n): "
if /i not "%CONFIRM%"=="y" exit /b

:: Backup existing DB
if exist "papers.db" (
    echo Backing up papers.db to papers.db.bak...
    move /y papers.db papers.db.bak >nul
)
if exist "papers.db-wal" del /q papers.db-wal >nul 2>&1
if exist "papers.db-shm" del /q papers.db-shm >nul 2>&1

:: Create .env for per-user mode if not exists
if not exist ".env" (
    echo # Public mode - each user has own database > .env
    echo PAPERS_DB_MODE=per_user >> .env
    echo Created .env with per-user mode
)

:: Create empty directories if needed
if not exist "原始文献" mkdir "原始文献"
if not exist "文献分类" mkdir "文献分类"

echo.
echo Setup complete! Run 启动文献管理.bat to start.
echo Default login: admin / admin123
echo.
echo To restore your personal data, restore papers.db.bak
echo.
pause
