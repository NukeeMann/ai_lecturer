#Requires -Version 5.1
<#
.SYNOPSIS
  AI Lecturer — one-shot Windows setup.

.DESCRIPTION
  Run from inside the cloned repo. Installs Node.js LTS (via winget) if missing,
  installs npm dependencies, installs the Claude Code CLI globally, opens an
  interactive `claude` session for first-time login, then starts the dev server.

.PARAMETER SkipDev
  Skip the final `npm run dev` step (everything else still runs).

.PARAMETER SkipLogin
  Skip the interactive `claude` login prompt (use if already logged in).

.PARAMETER SkipMedia
  Skip TTS/STT setup (Coqui XTTS + whisper.cpp via WSL).

.EXAMPLE
  .\setup.ps1
  .\setup.ps1 -SkipLogin
  .\setup.ps1 -SkipDev -SkipLogin -SkipMedia
#>
[CmdletBinding()]
param(
    [switch]$SkipDev,
    [switch]$SkipLogin,
    [switch]$SkipMedia
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Test-Cmd([string]$name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user | Where-Object { $_ }) -join ';'
}

# ---- 0. Sanity: must run from repo root ----
$repoRoot = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
    Write-Error "Nie znaleziono package.json w '$repoRoot'. Uruchom skrypt z roota repo AI Lecturer."
    exit 1
}
Set-Location -LiteralPath $repoRoot

# ---- 1. winget ----
Write-Step "Sprawdzanie winget"
if (-not (Test-Cmd 'winget')) {
    Write-Host "Brak 'winget'. Zainstaluj 'App Installer' ze sklepu Microsoft Store, " -ForegroundColor Yellow
    Write-Host "potem uruchom skrypt ponownie." -ForegroundColor Yellow
    exit 1
}
Write-Host "OK"

# ---- 2. Node.js LTS ----
Write-Step "Node.js"
if (-not (Test-Cmd 'node')) {
    Write-Host "Instaluję Node.js LTS przez winget..."
    winget install --id OpenJS.NodeJS.LTS -e `
        --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        Write-Error "winget install Node.js zakończył się błędem ($LASTEXITCODE)."
        exit $LASTEXITCODE
    }
    Update-PathFromRegistry
} else {
    Write-Host "Wykryto: $(node --version)"
}

if (-not (Test-Cmd 'npm')) {
    Write-Host "npm nadal niedostępny w tej sesji. Otwórz NOWE okno PowerShell i uruchom skrypt ponownie." -ForegroundColor Yellow
    exit 1
}

# ---- 3. npm install ----
Write-Step "npm install"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install nie powiódł się ($LASTEXITCODE)."
    exit $LASTEXITCODE
}

# ---- 4. Claude Code CLI ----
Write-Step "Claude Code CLI"
if (-not (Test-Cmd 'claude')) {
    Write-Host "Instaluję @anthropic-ai/claude-code globalnie..."
    npm install -g @anthropic-ai/claude-code
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Instalacja Claude Code CLI nie powiodła się ($LASTEXITCODE)."
        exit $LASTEXITCODE
    }
    Update-PathFromRegistry
}
if (Test-Cmd 'claude') {
    Write-Host "Wykryto: $(claude --version)"
} else {
    Write-Error "claude nadal niedostępny w PATH. Otwórz nowy PowerShell i uruchom skrypt ponownie."
    exit 1
}

# ---- 5. Login (interaktywny) ----
if (-not $SkipLogin) {
    Write-Step "Logowanie do Claude Code (interaktywne)"
    Write-Host "Za chwilę uruchomi się REPL 'claude'. Jeśli nie jesteś zalogowany:"
    Write-Host "  1) wpisz '/login' i naciśnij Enter,"
    Write-Host "  2) otwórz pokazany URL w przeglądarce i autoryzuj,"
    Write-Host "  3) wklej kod z powrotem do terminala."
    Write-Host "Kiedy skończysz, wyjdź przez '/exit' (lub Ctrl+C) — skrypt automatycznie ruszy dalej."
    Read-Host "Naciśnij Enter, aby uruchomić 'claude'"
    claude
} else {
    Write-Host "Pomijam logowanie (--SkipLogin)." -ForegroundColor DarkGray
}

# ---- 6. TTS/STT (Coqui XTTS + whisper.cpp) — uruchamiane w WSL ----
if (-not $SkipMedia) {
    Write-Step "TTS/STT (Coqui XTTS + whisper.cpp)"
    if (-not (Test-Cmd 'wsl')) {
        Write-Host "Nie wykryto 'wsl'. Pomijam TTS/STT setup." -ForegroundColor Yellow
        Write-Host "Aby zainstalować ręcznie: uruchom 'scripts/setup-tts.sh' i 'scripts/setup-stt.sh' w Linux/WSL2." -ForegroundColor DarkGray
    } else {
        $repoLinux = (& wsl wslpath -a "$repoRoot") -join "`n"
        $repoLinux = $repoLinux.Trim()
        if (-not $repoLinux) {
            Write-Host "Nie udało się przetłumaczyć ścieżki repo na format WSL. Pomijam TTS/STT." -ForegroundColor Yellow
        } else {
            Write-Host "Repo w WSL: $repoLinux"
            Write-Host "Doinstalowuję cmake + build-essential + python3-venv w WSL (może poprosić o hasło sudo)..."
            wsl bash -lc "sudo apt-get update -qq && sudo apt-get install -y cmake build-essential python3-venv ffmpeg curl git"
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Instalacja pakietów apt nie powiodła się ($LASTEXITCODE). Pomijam TTS/STT." -ForegroundColor Yellow
            } else {
                Write-Host "Uruchamiam setup-stt.sh (whisper.cpp build + model ~140MB)..."
                wsl bash -lc "cd '$repoLinux' && bash scripts/setup-stt.sh"
                $sttExit = $LASTEXITCODE
                if ($sttExit -ne 0) {
                    Write-Host "setup-stt.sh zakończony błędem ($sttExit). Sprawdź log i uruchom ponownie." -ForegroundColor Yellow
                }
                Write-Host "Uruchamiam setup-tts.sh (Coqui XTTS venv + model ~1.8GB — to potrwa)..."
                wsl bash -lc "cd '$repoLinux' && bash scripts/setup-tts.sh"
                $ttsExit = $LASTEXITCODE
                if ($ttsExit -ne 0) {
                    Write-Host "setup-tts.sh zakończony błędem ($ttsExit). Sprawdź log i uruchom ponownie." -ForegroundColor Yellow
                }
            }
        }
    }
} else {
    Write-Host "Pomijam TTS/STT (--SkipMedia)." -ForegroundColor DarkGray
}

# ---- 7. Dev server ----
if (-not $SkipDev) {
    Write-Step "Uruchamianie portalu (npm run dev)"
    Write-Host "Portal: http://localhost:3000"
    Write-Host "Ctrl+C zatrzymuje serwer."
    try { Start-Process "http://localhost:3000" } catch { }
    npm run dev
} else {
    Write-Host ""
    Write-Host "Setup zakończony. Aby uruchomić portal: 'npm run dev' (http://localhost:3000)." -ForegroundColor Green
}
