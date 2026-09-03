#!/usr/bin/env bash
# Guardián de datos de TAG TRACE.
#
# Impide que un dato industrial real llegue al repositorio. Es bloqueante: lo ejecutan
# tanto el hook de pre-commit sobre los ficheros preparados como la integración continua
# sobre el árbol completo. Ver ADR-0007, ADR-0014 y SECURITY_PRIVACY.md.
#
#   bash scripts/check_data.sh              # revisa todo lo versionado
#   bash scripts/check_data.sh f1 f2 ...    # revisa solo esos ficheros

set -uo pipefail

FORBIDDEN_ANYWHERE='csv|tsv|txt|agvproj|xlsx|xls|xlsm|parquet|duckdb|sqlite|sqlite3|db|zip|7z|rar|log|pem|key|p12|pfx'
SYNTHETIC_ONLY='csv|tsv|txt|agvproj'
SYNTHETIC_DIR='fixtures/synthetic/'
status=0

note() { printf '  - %s\n' "$1"; }

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(git ls-files)
fi

echo "Guardián de datos: revisando ${#files[@]} ficheros."

# 1. Extensiones prohibidas fuera de los fixtures sintéticos.
for file in "${files[@]}"; do
  [ -n "$file" ] || continue
  case "$file" in
    scripts/check_data.sh|.gitignore|.githooks/*|.github/workflows/*) continue ;;
  esac
  ext="${file##*.}"
  [ "$ext" = "$file" ] && continue
  ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"

  if printf '%s' "$ext" | grep -Eq "^($SYNTHETIC_ONLY)$"; then
    case "$file" in
      "$SYNTHETIC_DIR"*) ;;
      *) note "extensión de datos fuera de $SYNTHETIC_DIR: $file"; status=1 ;;
    esac
  elif printf '%s' "$ext" | grep -Eq "^($FORBIDDEN_ANYWHERE)$"; then
    note "extensión prohibida en el repositorio: $file"
    status=1
  fi
done

# 2. Todo fixture debe declararse sintético mediante su manifiesto.
for file in "${files[@]}"; do
  case "$file" in
    "$SYNTHETIC_DIR"*) ;;
    *) continue ;;
  esac
  [ -f "$file" ] || continue
  manifest="$(dirname "$file")/MANIFEST.md"
  if [ ! -f "$manifest" ]; then
    note "fixture sin MANIFEST.md en su carpeta: $file"
    status=1
  elif ! grep -q 'synthetic: true' "$manifest"; then
    note "el manifiesto no declara 'synthetic: true': $manifest"
    status=1
  fi
done

# 3. Secretos evidentes. Patrones estrechos: buscamos credenciales, no la palabra credencial.
secret_patterns=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{36}'
  'xox[abprs]-[A-Za-z0-9-]{10,}'
  'sk-[A-Za-z0-9]{32,}'
)
for file in "${files[@]}"; do
  [ -f "$file" ] || continue
  case "$file" in scripts/check_data.sh) continue ;; esac
  grep -Iq . "$file" 2>/dev/null || continue   # omite binarios
  for pattern in "${secret_patterns[@]}"; do
    if grep -Eq -- "$pattern" "$file"; then
      note "posible secreto en $file (patrón: $pattern)"
      status=1
    fi
  done
done

if [ "$status" -ne 0 ]; then
  cat <<'MSG'

Guardián de datos: RECHAZADO.

Este repositorio es público y solo admite código, documentación y fixtures sintéticos.
Los datos de planta se quedan en tu dispositivo. Si el fichero es de verdad sintético,
colócalo bajo fixtures/synthetic/ junto a un MANIFEST.md que declare 'synthetic: true'.

No uses git add -f para saltarte esto.
MSG
  exit 1
fi

echo "Guardián de datos: correcto."
