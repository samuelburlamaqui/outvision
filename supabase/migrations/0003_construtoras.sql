-- Construtoras: liga cada obra às empresas envolvidas (responsável e vínculos)
-- e agrupa matriz e filiais pela raiz do CNPJ (8 primeiros dígitos).
-- "Minhas construtoras": cada usuário salva as empresas que interessam a ele.

-- ------------------------------------------------------------------ empresas
create table if not exists public.empresas (
  cnpj_basico     text primary key,          -- 8 primeiros dígitos: matriz e filiais juntas
  nome            text,                      -- razão social
  cnpjs           text[],                    -- CNPJs completos vistos no CNO
  obras_total     integer,                   -- todas as obras no estado, qualquer situação, desde sempre
  obras_ativas    integer,                   -- obras com situação ativa
  primeira_obra   date,                      -- início mais antigo
  ultima_obra     date,                      -- início mais recente
  atualizado_em   timestamptz not null default now()
);

-- ------------------------------------------------------------------ obra ↔ empresa
create table if not exists public.obra_empresas (
  cno           text not null references public.obras (cno) on delete cascade,
  cnpj          text not null,
  cnpj_basico   text not null references public.empresas (cnpj_basico) on delete cascade,
  papel         text not null check (papel in ('responsavel', 'vinculo')),
  qualificacao  text not null default '',    -- 0053 construtora, 0057 dono da obra, 0064 incorporador...
  ativo         boolean not null default true,  -- vínculo sem data de fim
  primary key (cno, cnpj, papel, qualificacao)
);
create index if not exists obra_empresas_basico_idx on public.obra_empresas (cnpj_basico);

-- ------------------------------------------------------------------ minhas construtoras
create table if not exists public.empresas_salvas (
  usuario_id   uuid not null default auth.uid() references public.perfis (id) on delete cascade,
  cnpj_basico  text not null references public.empresas (cnpj_basico) on delete cascade,
  salva_em     timestamptz not null default now(),
  primary key (usuario_id, cnpj_basico)
);

-- ------------------------------------------------------------------ regras de acesso
alter table public.empresas        enable row level security;
alter table public.obra_empresas   enable row level security;
alter table public.empresas_salvas enable row level security;

-- quem vê a obra vê as empresas dela
drop policy if exists oe_ler on public.obra_empresas;
create policy oe_ler on public.obra_empresas for select to authenticated
  using (public.eh_admin() or public.encaminhada_para_mim(cno));

create or replace function public.empresa_visivel(p_basico text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.eh_admin() or exists (
    select 1 from public.obra_empresas oe
    join public.encaminhamentos e on e.cno = oe.cno
    where oe.cnpj_basico = p_basico and e.vendedor_id = auth.uid());
$$;

drop policy if exists empresas_ler on public.empresas;
create policy empresas_ler on public.empresas for select to authenticated
  using (public.empresa_visivel(cnpj_basico));

-- cada um vê, salva e remove só as próprias
drop policy if exists salvas_ler on public.empresas_salvas;
create policy salvas_ler on public.empresas_salvas for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists salvas_insere on public.empresas_salvas;
create policy salvas_insere on public.empresas_salvas for insert to authenticated
  with check (usuario_id = auth.uid() and public.empresa_visivel(cnpj_basico));
drop policy if exists salvas_remove on public.empresas_salvas;
create policy salvas_remove on public.empresas_salvas for delete to authenticated
  using (usuario_id = auth.uid());

revoke all on public.empresas, public.obra_empresas, public.empresas_salvas from anon, authenticated;
grant select on public.empresas, public.obra_empresas, public.empresas_salvas to authenticated;
grant insert, delete on public.empresas_salvas to authenticated;
