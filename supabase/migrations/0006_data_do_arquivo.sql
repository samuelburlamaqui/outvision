-- A data mostrada no site ("dados atualizados em") passa a ser a do arquivo da Receita
-- carregado por último. Quando o download falha, a rotina recarrega o último arquivo baixado,
-- e a data da carga não diria a verdade sobre quão novos são os dados.
-- Arquivos sem data reconhecível (ex.: cópia da release) usam a data da carga.

create or replace function public.ultima_atualizacao()
returns table (em timestamptz, arquivo text)
language sql
stable
security definer
set search_path = public
as $$
  -- a ordenação usa c.iniciada_em (com o nome da tabela): sem isso o "case" abaixo, que também
  -- se chamaria iniciada_em, passaria a ser o critério de ordem
  select case when c.arquivo_modificado ~ '^[A-Z][a-z]{2}, [0-9]' then c.arquivo_modificado::timestamptz else c.iniciada_em end as em,
         c.arquivo_modificado as arquivo
    from public.cargas c order by c.iniciada_em desc limit 1
$$;

revoke all on function public.ultima_atualizacao() from public, anon;
grant execute on function public.ultima_atualizacao() to authenticated;
