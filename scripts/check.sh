#!/usr/bin/env bash
# O portão. Um comando, igual para pessoas, agentes e CI.
#
#   ./scripts/check.sh            execução completa
#   ./scripts/check.sh --fast     sem o build do frontend
#
# Os testes do backend usam um PostgreSQL real (veja `make db`).
set -uo pipefail

cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

# Python do venv (Windows usa Scripts/, Unix usa bin/)
PY="python3"
if [[ -x backend/.venv/Scripts/python.exe ]]; then PY="$PWD/backend/.venv/Scripts/python.exe"
elif [[ -x backend/.venv/bin/python ]]; then PY="$PWD/backend/.venv/bin/python"; fi

failures=()
step() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then printf '\033[32m  ✓ %s\033[0m\n' "$name"
  else printf '\033[31m  ✗ %s\033[0m\n' "$name"; failures+=("$name"); fi
}

in_git() { git rev-parse --is-inside-work-tree >/dev/null 2>&1; }

guard_artifacts() {
  in_git || { echo "  (fora de um repositório git — verificação ignorada)"; return 0; }
  local tracked
  tracked=$(git ls-files -- '*/var/*' 'var/*' '.env' '*/.env' '*/.env.local' 2>/dev/null || true)
  if [[ -n "$tracked" ]]; then
    echo "Artefatos de execução ou segredos versionados:"; echo "$tracked" | sed 's/^/    /'
    echo "  Corrija: git rm --cached <arquivo>"; return 1
  fi
}

guard_secrets() {
  in_git || { echo "  (fora de um repositório git — verificação ignorada)"; return 0; }
  local hits
  hits=$(git grep -nIE '(sk-[A-Za-z0-9_-]{32,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' \
    -- . ':!*.example' ':!scripts/check.sh' 2>/dev/null || true)
  if [[ -n "$hits" ]]; then echo "Possível credencial versionada:"; echo "$hits" | sed 's/^/    /'; return 1; fi
}

db_up() {
  "$PY" - <<'EOF'
import os, sys
import psycopg
url = os.environ.get("TEST_ADMIN_URL", "postgresql://projeta:projeta@127.0.0.1:55432/postgres")
try:
    psycopg.connect(url, connect_timeout=3).close()
except Exception as e:
    print(f"PostgreSQL de teste indisponível ({type(e).__name__}). Rode: make db", file=sys.stderr)
    sys.exit(1)
EOF
}

b_format() { (cd backend && "$PY" -m ruff format --check src tests scripts); }
b_lint()   { (cd backend && "$PY" -m ruff check src tests scripts); }
b_tests()  { db_up && (cd backend && "$PY" -m pytest -q); }

f_ready() { [[ -d frontend/node_modules ]] || { echo "frontend não instalado — rode: make setup"; return 1; }; }
f_types() { f_ready && (cd frontend && npx --no-install tsc -b --noEmit); }
f_lint()  { f_ready && (cd frontend && npx --no-install eslint . --max-warnings 0); }
f_tests() { f_ready && (cd frontend && npx --no-install vitest run); }
f_build() { f_ready && (cd frontend && npx --no-install vite build); }

step "sem artefatos de execução versionados" guard_artifacts
step "sem credenciais na árvore"              guard_secrets
step "backend: formatação"                    b_format
step "backend: lint"                          b_lint
step "backend: testes"                        b_tests
step "frontend: tipos"                        f_types
step "frontend: lint"                         f_lint
step "frontend: testes"                       f_tests
[[ $FAST -eq 1 ]] || step "frontend: build"   f_build

printf '\n'
if [[ ${#failures[@]} -eq 0 ]]; then printf '\033[32m✓ todas as verificações passaram\033[0m\n'; exit 0; fi
printf '\033[31m✗ %d verificação(ões) falharam:\033[0m\n' "${#failures[@]}"
printf '    - %s\n' "${failures[@]}"
exit 1
