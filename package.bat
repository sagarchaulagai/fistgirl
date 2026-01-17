@echo off
set "target=fistgirl.fda"
set "temp_zip=fistgirl.zip"
set "source_dir=add-on"

echo Packaging contents of %source_dir% into %target%...

if exist "%temp_zip%" del "%temp_zip%"
if exist "%target%" del "%target%"

:: Use PowerShell to zip the contents to a .zip file first
powershell -Command "Compress-Archive -Path '%source_dir%\*' -DestinationPath '%temp_zip%' -Force"

if exist "%temp_zip%" (
    ren "%temp_zip%" "%target%"
    echo.
    echo Done! %target% has been created successfully.
) else (
    echo.
    echo Error: Failed to create %temp_zip%.
)

pause
