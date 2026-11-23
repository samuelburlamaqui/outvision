-- Data da última atualização das obras, para todos os usuários logados.
-- A tabela de cargas continua visível só para o admin; esta função devolve apenas a data.

create or replace function public.ultima_atualizacao()
returns table (em timestamptz, arquivo text)
language sql
stable
security definer
set search_path = public
as $$
  select iniciada_em, arquivo_modificado from public.cargas order by iniciada_em desc limit 1
$$;

revoke all on function public.ultima_atualizacao() from public, anon;
grant execute on function public.ultima_atualizacao() to authenticated;
