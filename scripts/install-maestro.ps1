# Installs Maestro (tests of the APK on the emulator) and sets JAVA_HOME / PATH for the current Windows user.
# Run from the paraph folder:  powershell -ExecutionPolicy Bypass -File scripts\install-maestro.ps1
$ErrorActionPreference = 'Stop'

# 1. Java: the one shipped with Android Studio
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (-not (Test-Path "$jbr\bin\java.exe")) { throw "Java introuvable dans $jbr : installez Android Studio d'abord." }
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jbr, 'User')
$env:JAVA_HOME = $jbr

# Android SDK (adb, emulator)
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')

# 2. Maestro
$dest = 'C:\maestro'
$zip = Join-Path $env:TEMP 'maestro.zip'
Write-Host 'Téléchargement de Maestro...'
Invoke-WebRequest 'https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip' -OutFile $zip
Expand-Archive $zip -DestinationPath $dest -Force
$bin = (Get-ChildItem $dest -Recurse -Filter 'maestro.bat' | Select-Object -First 1).DirectoryName
if (-not $bin) { throw 'maestro.bat introuvable après décompression.' }

# 3. PATH (user): Maestro + adb; also removes a literal "%PATH%" left by an earlier setx
$tools = "$env:LOCALAPPDATA\Android\Sdk\platform-tools"
$parts = ([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') | Where-Object { $_ -and $_ -ne '%PATH%' }
foreach ($d in @($bin, $tools)) { if ($parts -notcontains $d) { $parts += $d } }
[Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
$env:Path = "$env:Path;$bin;$tools"

Write-Host ''
& "$bin\maestro.bat" --version
Write-Host "Maestro installé dans $bin"
Write-Host 'Fermez complètement VS Code puis rouvrez-le avant de lancer : npm run test:apk'
