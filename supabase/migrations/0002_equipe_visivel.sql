-- Todos os usuários logados veem a lista da equipe (nome, e-mail, papel),
-- para mostrar quem escreveu cada anotação e para quem cada obra foi encaminhada.
-- Alterar perfis continua sendo só do admin.
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (true);
