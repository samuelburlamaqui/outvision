#!/usr/bin/env bash
# Comando de build na Cloudflare Pages: gera site/config.js com as chaves PÚBLICAS do Supabase.
# As variáveis SUPABASE_URL e SUPABASE_ANON_KEY ficam nas configurações do projeto na Cloudflare.
set -euo pipefail
pasta="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "AVISO: SUPABASE_URL ou SUPABASE_ANON_KEY não definidas; o site vai abrir sem conexão com o banco."
  echo 'window.RADAR_CONFIG = null;' > "$pasta/config.js"
  exit 0
fi
printf 'window.RADAR_CONFIG = { supabaseUrl: "%s", supabaseKey: "%s" };\n' "${SUPABASE_URL%/}" "$SUPABASE_ANON_KEY" > "$pasta/config.js"
echo "config.js gerado para ${SUPABASE_URL}"
