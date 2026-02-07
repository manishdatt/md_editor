@echo off
setlocal EnableExtensions

set "REPO_URL=https://github.com/manishdatt/md_editor.git"
set "BRANCH=main"
set "COMMIT_MSG=%*"

if "%COMMIT_MSG%"=="" set "COMMIT_MSG=chore: update project"

if not exist ".git" (
  echo Initializing git repository...
  git init || goto :error
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo Adding origin remote...
  git remote add origin "%REPO_URL%" || goto :error
) else (
  echo Updating origin remote...
  git remote set-url origin "%REPO_URL%" || goto :error
)

echo Staging changes...
git add -A || goto :error

echo Creating commit...
git commit -m "%COMMIT_MSG%" >nul 2>&1
if errorlevel 1 (
  echo No new commit created ^(possibly no changes^).
)

echo Setting branch to %BRANCH%...
git branch -M %BRANCH% || goto :error

echo Pushing to %REPO_URL%...
git push -u origin %BRANCH% || goto :error

echo.
echo Push complete.
exit /b 0

:error
echo.
echo Push failed.
exit /b 1
