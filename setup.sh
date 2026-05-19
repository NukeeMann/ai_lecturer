#!/usr/bin/env bash
#
# AI Lecturer — jednorazowy setup dla macOS.
#
# Uruchom z roota sklonowanego repo. Instaluje Node.js LTS (przez Homebrew)
# jeśli brakuje, instaluje zależności npm, instaluje Claude Code CLI globalnie,
# otwiera interaktywną sesję `claude` do pierwszego logowania, opcjonalnie
# stawia TTS/STT (Coqui XTTS + whisper.cpp — natywnie, bez WSL), a na końcu
# uruchamia serwer deweloperski.
#
# Odpowiednik setup.ps1 dla Windows. Skrypt jest idempotentny — można go
# uruchamiać wielokrotnie.
#
# Flagi:
#   --skip-dev     pomiń końcowe `npm run dev`
#   --skip-login   pomiń interaktywne logowanie do `claude`
#   --skip-media   pomiń setup TTS/STT
#
# Przykłady:
#   ./setup.sh
#   ./setup.sh --skip-login
#   ./setup.sh --skip-dev --skip-login --skip-media

set -euo pipefail

SKIP_DEV=0
SKIP_LOGIN=0
SKIP_MEDIA=0

for arg in "$@"; do
  case "${arg}" in
    --skip-dev)   SKIP_DEV=1 ;;
    --skip-login) SKIP_LOGIN=1 ;;
    --skip-media) SKIP_MEDIA=1 ;;
    -h|--help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      echo "Nieznana flaga: ${arg} (dozwolone: --skip-dev --skip-login --skip-media)" >&2
      exit 1
      ;;
  esac
done

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; GRAY='\033[0;90m'; NC='\033[0m'
step() { printf '\n'"${CYAN}"'=== %s ==='"${NC}"'\n' "$*"; }
info() { printf '%s\n' "$*"; }
warn() { printf "${YELLOW}"'%s'"${NC}"'\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- 0. Sanity: musi działać z roota repo ----
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
  echo "Nie znaleziono package.json w '${REPO_ROOT}'. Uruchom skrypt z roota repo AI Lecturer." >&2
  exit 1
fi
cd "${REPO_ROOT}"

# ---- 1. Platforma ----
step "Sprawdzanie platformy"
if [[ "$(uname -s)" != "Darwin" ]]; then
  warn "Ten skrypt jest dla macOS. Na Windows użyj setup.ps1, na Linux uruchom kroki ręcznie z README."
  exit 1
fi
info "macOS $(sw_vers -productVersion 2>/dev/null || echo '?') — OK"

# ---- 2. Homebrew ----
step "Homebrew"
if ! have brew; then
  warn "Brak 'brew'. Zainstaluj Homebrew ze strony https://brew.sh i uruchom skrypt ponownie."
  warn "Komenda instalacyjna:"
  warn '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
# Upewnij się, że brew jest w PATH (Apple Silicon vs Intel).
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
info "Wykryto: $(brew --version | head -1)"

# ---- 3. Node.js ----
step "Node.js"
if ! have node; then
  info "Instaluję Node.js przez Homebrew…"
  brew install node
else
  info "Wykryto: $(node --version)"
fi
if ! have npm; then
  warn "npm nadal niedostępny w tej sesji. Otwórz nowy terminal i uruchom skrypt ponownie."
  exit 1
fi
info "npm: $(npm --version)"

# ---- 4. npm install ----
step "npm install"
npm install

# ---- 5. Claude Code CLI ----
step "Claude Code CLI"
if ! have claude; then
  info "Instaluję @anthropic-ai/claude-code globalnie…"
  npm install -g @anthropic-ai/claude-code
fi
if have claude; then
  info "Wykryto: $(claude --version)"
else
  warn "claude nadal niedostępny w PATH. Otwórz nowy terminal i uruchom skrypt ponownie,"
  warn "albo zainstaluj natywnie: curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi

# ---- 6. Logowanie (interaktywne) ----
if [[ "${SKIP_LOGIN}" -eq 0 ]]; then
  step "Logowanie do Claude Code (interaktywne)"
  info "Za chwilę uruchomi się REPL 'claude'. Jeśli nie jesteś zalogowany:"
  info "  1) wpisz '/login' i naciśnij Enter,"
  info "  2) otwórz pokazany URL w przeglądarce i autoryzuj,"
  info "  3) wklej kod z powrotem do terminala."
  info "Kiedy skończysz, wyjdź przez '/exit' (lub Ctrl+C) — skrypt ruszy dalej."
  read -r -p "Naciśnij Enter, aby uruchomić 'claude'… "
  claude || true
else
  printf "${GRAY}"'Pomijam logowanie (--skip-login).'"${NC}"'\n'
fi

# ---- 7. TTS/STT (Coqui XTTS + whisper.cpp) — natywnie na macOS ----
if [[ "${SKIP_MEDIA}" -eq 0 ]]; then
  step "TTS/STT (Coqui XTTS + whisper.cpp)"
  # whisper.cpp/Coqui wymagają: cmake, ffmpeg, git, python3.
  MISSING_BREW=()
  have cmake   || MISSING_BREW+=("cmake")
  have ffmpeg  || MISSING_BREW+=("ffmpeg")
  have git     || MISSING_BREW+=("git")
  have python3 || MISSING_BREW+=("python")
  if [[ "${#MISSING_BREW[@]}" -gt 0 ]]; then
    info "Doinstalowuję przez Homebrew: ${MISSING_BREW[*]}"
    brew install "${MISSING_BREW[@]}"
  fi

  info "Uruchamiam setup-stt.sh (whisper.cpp build + model ~140MB)…"
  if bash scripts/setup-stt.sh; then
    info "STT OK."
  else
    warn "setup-stt.sh zakończony błędem. Sprawdź log i uruchom ponownie ręcznie."
  fi

  info "Uruchamiam setup-tts.sh (Coqui XTTS venv + model ~1.8GB — to potrwa)…"
  if bash scripts/setup-tts.sh; then
    info "TTS OK."
  else
    warn "setup-tts.sh zakończony błędem. Sprawdź log i uruchom ponownie ręcznie."
  fi
else
  printf "${GRAY}"'Pomijam TTS/STT (--skip-media).'"${NC}"'\n'
fi

# ---- 8. Serwer deweloperski ----
if [[ "${SKIP_DEV}" -eq 0 ]]; then
  step "Uruchamianie portalu (npm run dev)"
  info "Portal: http://localhost:3000"
  info "Ctrl+C zatrzymuje serwer."
  ( sleep 4; open "http://localhost:3000" >/dev/null 2>&1 || true ) &
  npm run dev
else
  printf '\n'"${GREEN}"'Setup zakończony. Aby uruchomić portal: npm run dev (http://localhost:3000).'"${NC}"'\n'
fi
