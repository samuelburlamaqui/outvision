#!/usr/bin/env bash
# Nada a gerar no build: as chaves do Supabase são entregues pelo Worker em /config.js
# (worker/index.js), a partir das variáveis do painel da Cloudflare.
# Este script só garante que não exista um config.js estático que esconda o do Worker.
set -euo pipefail
rm -f "$(cd "$(dirname "$0")" && pwd)/config.js"
echo "ok: config.js vem do Worker"
