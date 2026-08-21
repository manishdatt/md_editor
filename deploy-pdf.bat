@echo off
setlocal EnableExtensions

set "PROJECT_ID=shbd-506216"
set "REGION=europe-west1"
set "BUILD_SA=192979785963-compute@developer.gserviceaccount.com"
set "CONFIG=pdf-service/cloudbuild.yaml"
set "SOURCE=pdf-service"

echo Submitting Cloud Build for pdf-service (project %PROJECT_ID%)...
gcloud builds submit %SOURCE% ^
  --config=%CONFIG% ^
  --region=%REGION% ^
  --project=%PROJECT_ID% ^
  --service-account=%BUILD_SA%
if errorlevel 1 (
  echo.
  echo Deploy failed.
  echo If you see an impersonation error, grant the Cloud Build service account
  echo "Service Account Token Creator" on %BUILD_SA% (IAM ^& Admin - IAM).
  exit /b 1
)

echo.
echo Deploy complete. Service URL:
gcloud run services describe pdf-service --region=%REGION% --project=%PROJECT_ID% --format="value(status.url)"
exit /b 0
