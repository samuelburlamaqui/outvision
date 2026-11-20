#!/usr/bin/env bash
# Aplica, em ordem, as migrações de supabase/migrations que ainda não foram aplicadas.
# Uso: DATABASE_URL=postgresql://... bash supabase/aplicar_migracoes.sh
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
export PGOPTIONS="-c client_min_messages=warning"
pasta="$(cd "$(dirname "$0")" && pwd)/migrations"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  create table if not exists public._migracoes (nome text primary key, aplicada_em timestamptz not null default now());
  alter table public._migracoes enable row level security;
  revoke all on public._migracoes from anon, authenticated;"

for arquivo in $(ls "$pasta"/*.sql | sort); do
  nome="$(basename "$arquivo")"
  if [ "$(psql "$DATABASE_URL" -tAq -c "select 1 from public._migracoes where nome = '$nome'")" = "1" ]; then
    echo "já aplicada: $nome"
    continue
  fi
  echo "aplicando: $nome"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$arquivo" -c "insert into public._migracoes (nome) values ('$nome')"
done
echo "migrações em dia"
