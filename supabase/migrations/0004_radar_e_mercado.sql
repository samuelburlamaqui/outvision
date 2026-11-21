-- Radar sem área mínima e cálculos da área de Insights (Mercado).

-- ------------------------------------------------------------------ radar
-- Obras do radar: ativas, iniciadas a partir de 2023, de qualquer tamanho
-- (com área informada), sem infraestrutura. As regras de acesso das tabelas
-- continuam valendo (security_invoker): admin vê todas, vendedor só as dele.
create or replace view public.obras_radar with (security_invoker = true) as
  select * from public.obras
  where situacao = '02' and data_inicio >= date '2023-01-01' and area_principal > 0 and motivo_infra is null;

create or replace view public.obra_empresas_radar with (security_invoker = true) as
  select oe.* from public.obra_empresas oe
  join public.obras_radar r on r.cno = oe.cno;

revoke all on public.obras_radar, public.obra_empresas_radar from anon;
grant select on public.obras_radar, public.obra_empresas_radar to authenticated;

-- ------------------------------------------------------------------ mercado (só admin)
-- Obras que começaram em cada período, de qualquer situação (inclusive já encerradas),
-- sem as regularizações de obras antigas (categoria "Existente").
-- "infra" marca infraestrutura e obras sem área em m², para o painel poder esconder.
-- Áreas acima de 300 mil m² (quase sempre erro de digitação) contam como 300 mil.

create or replace function public.mercado_por_tipo(p_desde date, p_municipio text default null)
returns table (mes date, tipo text, infra boolean, obras integer, m2 numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('month', o.data_inicio)::date,
         coalesce(o.destinacao, 'Sem área informada'),
         (o.motivo_infra is not null or o.destinacao is null),
         count(*)::integer,
         round(sum(least(coalesce(o.area_principal, 0), 300000)))
  from public.obras o
  where public.eh_admin()
    and o.data_inicio >= p_desde and o.data_inicio <= current_date
    and coalesce(o.categoria, '') <> 'Existente'
    and (p_municipio is null or o.municipio = p_municipio)
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

create or replace function public.mercado_por_cidade(p_desde date, p_tipo text default null)
returns table (trimestre date, municipio text, infra boolean, obras integer, m2 numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select date_trunc('quarter', o.data_inicio)::date,
         o.municipio,
         (o.motivo_infra is not null or o.destinacao is null),
         count(*)::integer,
         round(sum(least(coalesce(o.area_principal, 0), 300000)))
  from public.obras o
  where public.eh_admin()
    and o.data_inicio >= p_desde and o.data_inicio <= current_date
    and coalesce(o.categoria, '') <> 'Existente'
    and (p_tipo is null or coalesce(o.destinacao, 'Sem área informada') = p_tipo)
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

revoke execute on function public.mercado_por_tipo(date, text), public.mercado_por_cidade(date, text) from public, anon;
grant execute on function public.mercado_por_tipo(date, text), public.mercado_por_cidade(date, text) to authenticated;
