#!/usr/bin/env bash
# Comando de build na Cloudflare. Se as variáveis de build SUPABASE_URL e SUPABASE_ANON_KEY
# existirem, gera site/config.js com as chaves PÚBLICAS do Supabase. Se não existirem, apaga
# config.js e o Worker entrega /config.js a partir das variáveis de runtime (worker/index.js).
set -euo pipefail
pasta="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  # aceita a URL do jeito que vier do painel: tira espaços, /rest/v1, /auth/v1 e barras finais
  url="$(printf '%s' "$SUPABASE_URL" | tr -d '[:space:]' | sed -E 's#/(rest|auth)/v1/?$##; s#/+$##')"
  chave="$(printf '%s' "$SUPABASE_ANON_KEY" | tr -d '[:space:]')"
  printf 'window.RADAR_CONFIG = { supabaseUrl: "%s", supabaseKey: "%s" };\n' "$url" "$chave" > "$pasta/config.js"
  echo "config.js gerado para $url"
else
  rm -f "$pasta/config.js"
  echo "sem variáveis de build: config.js virá do Worker"
fi
