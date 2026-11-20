-- Estrutura inicial do radar de obras.
--
-- Perfis: admin vê e encaminha todas as obras; vendedor vê só as obras
-- encaminhadas a ele. As regras ficam no banco (Row Level Security), então
-- valem para qualquer acesso feito com o login do usuário.
--
-- A rotina de carga usa a conexão direta do dono do banco e por isso não
-- passa pelas regras (grava obras e cargas).

-- ------------------------------------------------------------------ obras
create table if not exists public.obras (
  cno               text primary key,
  nome              text,
  responsavel       text,          -- nome empresarial; se pessoa física, o nome da obra
  cnpj              text,          -- vazio quando o responsável é pessoa física
  qualificacao      text,          -- código (0053 construtora, 0057 dono da obra...)
  situacao          text,          -- 01 nula, 02 ativa, 03 suspensa, 14 paralisada, 15 encerrada
  data_situacao     date,
  data_inicio       date,
  data_registro     date,
  uf                text,
  cod_municipio     text,
  municipio         text,
  bairro            text,
  tipo_logradouro   text,
  logradouro        text,
  numero            text,
  complemento       text,
  cep               text,
  unidade_medida    text,
  area_total        numeric,
  area_principal    numeric,       -- soma das áreas principais (cno_areas)
  destinacao        text,          -- destinação da maior área
  destinacoes       text,          -- todas as destinações
  categoria         text,          -- categoria da maior área (obra nova, reforma...)
  tipo_obra         text,
  cnaes             text[],
  vinculadas        text,          -- outras empresas ligadas à obra
  motivo_infra      text,          -- preenchido quando a regra considera infraestrutura
  prazo_meses       numeric,       -- prazo típico estimado (pipeline/regras.py)
  primeira_vez_em   timestamptz not null default now(),  -- quando a obra entrou na nossa base
  atualizado_em     timestamptz not null default now()
);
create index if not exists obras_municipio_idx on public.obras (municipio);
create index if not exists obras_situacao_inicio_idx on public.obras (situacao, data_inicio);

-- ------------------------------------------------------------------ usuários
create table if not exists public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  nome       text,
  papel      text not null default 'vendedor' check (papel in ('admin', 'vendedor')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- O primeiro usuário vira admin; os seguintes, vendedores.
-- (Cadastro aberto fica desligado no Supabase: usuários entram só por convite.)
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, email, nome, papel)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.perfis where papel = 'admin') then 'vendedor' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo);
$$;

-- ------------------------------------------------------------------ encaminhamentos
create table if not exists public.encaminhamentos (
  cno              text not null references public.obras (cno) on delete cascade,
  vendedor_id      uuid not null references public.perfis (id) on delete cascade,
  encaminhado_por  uuid references public.perfis (id) on delete set null,
  encaminhado_em   timestamptz not null default now(),
  primary key (cno, vendedor_id)
);
create index if not exists encaminhamentos_vendedor_idx on public.encaminhamentos (vendedor_id);

create or replace function public.encaminhada_para_mim(p_cno text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.encaminhamentos where cno = p_cno and vendedor_id = auth.uid());
$$;

-- ------------------------------------------------------------------ andamento
create table if not exists public.acompanhamento (
  cno            text not null references public.obras (cno) on delete cascade,
  vendedor_id    uuid not null references public.perfis (id) on delete cascade,
  status         text not null default 'nova'
                 check (status in ('nova', 'contato', 'visita', 'proposta', 'fechada', 'perdida')),
  proxima_acao   date,
  atualizado_em  timestamptz not null default now(),
  primary key (cno, vendedor_id)
);

create table if not exists public.anotacoes (
  id         bigint generated always as identity primary key,
  cno        text not null references public.obras (cno) on delete cascade,
  autor_id   uuid not null default auth.uid() references public.perfis (id) on delete cascade,
  texto      text not null check (length(texto) between 1 and 5000),
  criado_em  timestamptz not null default now()
);
create index if not exists anotacoes_cno_idx on public.anotacoes (cno);

-- ------------------------------------------------------------------ cargas
create table if not exists public.cargas (
  id                  bigint generated always as identity primary key,
  iniciada_em         timestamptz not null default now(),
  arquivo_modificado  text,         -- data do arquivo na Receita
  obras_lidas         integer,
  obras_novas         integer,
  obras_atualizadas   integer,
  observacao          text
);

-- ------------------------------------------------------------------ regras de acesso
alter table public.obras            enable row level security;
alter table public.perfis           enable row level security;
alter table public.encaminhamentos  enable row level security;
alter table public.acompanhamento   enable row level security;
alter table public.anotacoes        enable row level security;
alter table public.cargas           enable row level security;

-- obras: admin vê todas; vendedor, só as encaminhadas a ele. Ninguém altera pelo site.
drop policy if exists obras_ler on public.obras;
create policy obras_ler on public.obras for select to authenticated
  using (public.eh_admin() or public.encaminhada_para_mim(cno));

-- perfis: cada um vê o próprio; admin vê e altera todos.
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin());
drop policy if exists perfis_admin_altera on public.perfis;
create policy perfis_admin_altera on public.perfis for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- encaminhamentos: admin cria e remove; vendedor vê os seus.
drop policy if exists enc_ler on public.encaminhamentos;
create policy enc_ler on public.encaminhamentos for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_admin());
drop policy if exists enc_admin_insere on public.encaminhamentos;
create policy enc_admin_insere on public.encaminhamentos for insert to authenticated
  with check (public.eh_admin());
drop policy if exists enc_admin_remove on public.encaminhamentos;
create policy enc_admin_remove on public.encaminhamentos for delete to authenticated
  using (public.eh_admin());

-- acompanhamento: vendedor mantém o das obras encaminhadas a ele; admin vê e altera tudo.
drop policy if exists acomp_ler on public.acompanhamento;
create policy acomp_ler on public.acompanhamento for select to authenticated
  using (vendedor_id = auth.uid() or public.eh_admin());
drop policy if exists acomp_insere on public.acompanhamento;
create policy acomp_insere on public.acompanhamento for insert to authenticated
  with check (public.eh_admin() or (vendedor_id = auth.uid() and public.encaminhada_para_mim(cno)));
drop policy if exists acomp_altera on public.acompanhamento;
create policy acomp_altera on public.acompanhamento for update to authenticated
  using (public.eh_admin() or (vendedor_id = auth.uid() and public.encaminhada_para_mim(cno)))
  with check (public.eh_admin() or (vendedor_id = auth.uid() and public.encaminhada_para_mim(cno)));

-- anotações: quem vê a obra lê as anotações dela e pode escrever em seu próprio nome.
drop policy if exists anot_ler on public.anotacoes;
create policy anot_ler on public.anotacoes for select to authenticated
  using (public.eh_admin() or public.encaminhada_para_mim(cno));
drop policy if exists anot_insere on public.anotacoes;
create policy anot_insere on public.anotacoes for insert to authenticated
  with check (autor_id = auth.uid() and (public.eh_admin() or public.encaminhada_para_mim(cno)));
drop policy if exists anot_apaga on public.anotacoes;
create policy anot_apaga on public.anotacoes for delete to authenticated
  using (autor_id = auth.uid() or public.eh_admin());

-- cargas: só o admin acompanha.
drop policy if exists cargas_ler on public.cargas;
create policy cargas_ler on public.cargas for select to authenticated
  using (public.eh_admin());

-- Visitantes sem login não acessam nada; usuários logados só o que está abaixo
-- (o Supabase concede tudo por padrão; aqui fica explícito o mínimo).
revoke all on public.obras, public.perfis, public.encaminhamentos, public.acompanhamento,
              public.anotacoes, public.cargas from anon, authenticated;
revoke execute on function public.criar_perfil() from public, anon, authenticated;
grant select on public.obras, public.perfis, public.encaminhamentos, public.acompanhamento,
                public.anotacoes, public.cargas to authenticated;
grant update (nome, papel, ativo) on public.perfis to authenticated;
grant insert, delete on public.encaminhamentos to authenticated;
grant insert, update on public.acompanhamento to authenticated;
grant insert, delete on public.anotacoes to authenticated;
