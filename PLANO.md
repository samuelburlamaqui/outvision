# Plano — radar de obras (SaaS)

Operado 100% pela nuvem, a partir de um tablet. Claude escreve e publica o código;
o dono só faz configurações únicas pelo navegador.

## Requisitos

- Acesso pelo navegador.
- Perfis: **admin** (vê todas as obras e encaminha) e **vendedores** (veem só as obras encaminhadas a eles).
- Obras atualizadas automaticamente a partir do CNO da Receita (zip de ~350 MB, ~1,4 GB aberto). A cada ~4 dias basta.
- Repositório público durante o desenvolvimento, privado depois.
- Uso interno, sem venda por enquanto. Custo o mais baixo possível.

## Arquitetura

| Peça | Serviço | Custo | Papel |
|---|---|---|---|
| Código e rotina de dados | GitHub + GitHub Actions | grátis | Guarda o código; a cada 4 dias baixa o CNO, filtra o Pará e grava no banco |
| Banco + login + permissões | Supabase (Postgres, Auth, Row Level Security) | grátis | Obras, usuários, encaminhamentos, andamento e anotações; login por código no e-mail |
| Site | Cloudflare Pages | grátis | Site estático publicado sozinho a cada envio para o GitHub (funciona com repositório privado) |
| Domínio | Registro.br + DNS na Cloudflare | ~R$ 40/ano | Endereço próprio |

Por que assim: não há servidor para manter. O site é estático e fala direto com o Supabase.
Quem pode ver o quê é garantido no próprio banco (Row Level Security), não no navegador.

### Dados (rascunho)

- `obras` — uma linha por obra do Pará (CNO, endereço, responsável, área, tipo, datas, situação, data da última atualização).
- `perfis` — usuário, nome, papel (`admin` | `vendedor`).
- `encaminhamentos` — obra → vendedor, quem encaminhou e quando.
- `andamento` — status da obra para o vendedor (nova, contato feito, visita, proposta, fechada, perdida), próxima ação, anotações.

Regras de acesso: admin lê e escreve tudo; vendedor lê só as obras encaminhadas a ele e escreve só o andamento delas.

### Rotina de atualização (GitHub Actions, a cada 4 dias)

1. Confere na Receita se o arquivo mudou (data de modificação); se não mudou, encerra.
2. Baixa e abre o zip, filtra o Pará com DuckDB (cerca de 1 minuto).
3. Grava as obras no Supabase (insere novas, atualiza as existentes, marca as encerradas).
4. Registra quantas obras novas entraram.

**Risco:** o site da Receita pode recusar downloads vindos dos servidores do GitHub (fora do Brasil).
**Plano B:** o dono baixa o zip no tablet e anexa numa Release do GitHub; a rotina dispara sozinha com esse arquivo.

## Etapas

| # | Etapa | Quem faz o quê |
|---|---|---|
| 0 ✅ | Destravar o GitHub | Dono: instalar o app do Claude no repositório. Claude: enviar tudo o que já foi feito |
| 1 ✅ | Testar o download automático (funcionou: ~6 min para 340 MB) | Claude: rotina no GitHub Actions baixando da Receita. Se falhar, montar o plano B |
| 2 ✅ | Banco (36.552 obras do PA carregadas em 20/11) | Dono: criar conta e projeto no Supabase, colar 2 chaves nas configurações do GitHub. Claude: tabelas, regras de acesso, carga inicial |
| 3 | Site | Dono: criar conta na Cloudflare e conectar o repositório. Claude: login, tela do admin (todas as obras, encaminhar), tela do vendedor (minhas obras, andamento, anotações) |
| 4 | Domínio | Dono: registrar no Registro.br e trocar os servidores DNS. Claude: passar os valores e configurar |
| 5 | Rotina ligada | Claude: agendamento a cada 4 dias e aviso de obras novas |
| 6 | Fechar o repositório | Dono: tornar privado quando estabilizar |
