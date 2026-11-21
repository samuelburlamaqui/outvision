# Outvision — prospecção de obras

SaaS para apoiar o dia a dia de uma representação comercial que atende construtoras com:

- **Vibra**: fios e cabos elétricos (Vibra Fios e Cabos Elétricos)
- **Mohawk**: pisos e revestimentos (grupo Mohawk; no Brasil, Eliane)
- **Lorenzetti**: louças, metais sanitários, chuveiros e aquecedores
- **Assa Abloy**: fechaduras, ferragens, portas e controle de acesso (Papaiz, La Fonte, Yale, Silvana, Udinese)

A ideia central: em vez de depender só de encontrar obras na rua, usar o
**CNO — Cadastro Nacional de Obras** da Receita Federal (público e atualizado
diariamente) para descobrir obras novas, saber quem é o responsável e priorizar
quem visitar e ligar.

## Etapa atual: entender o dado

| O quê | Onde |
|---|---|
| Download automático dos arquivos da Receita | [`pipeline/baixar_receita.py`](pipeline/baixar_receita.py) |
| Análise de estrutura (colunas, códigos, datas, volumes) | [`pipeline/explorar_cno.py`](pipeline/explorar_cno.py) |
| Execução na nuvem (GitHub Actions) | [`.github/workflows/explorar-cno.yml`](.github/workflows/explorar-cno.yml) |
| **Resumo: como o dado funciona** | [`exploracao/ENTENDENDO_O_CNO.md`](exploracao/ENTENDENDO_O_CNO.md) |
| Análise comercial (Brasil) | [`exploracao/PROSPECCAO_BRASIL.md`](exploracao/PROSPECCAO_BRASIL.md) |
| Perfil técnico de cada coluna | [`exploracao/RELATORIO_CNO.md`](exploracao/RELATORIO_CNO.md) |
| Análise com olhar de prospecção | [`pipeline/analisar_prospeccao.py`](pipeline/analisar_prospeccao.py) |
| **Obras do Pará (≥ 800 m², sem infraestrutura)** | [`exploracao/OBRAS_PA.md`](exploracao/OBRAS_PA.md) |
| Regras do recorte, fases e janelas por produto | [`pipeline/regras.py`](pipeline/regras.py) |
| Gerador da planilha de obras | [`pipeline/gerar_leads.py`](pipeline/gerar_leads.py) |
| Dicionário de dados (texto) | [`exploracao/dicionario/`](exploracao/dicionario/) |

O Action roda sozinho a cada mudança no pipeline, ou manualmente em
**Actions → explorar-cno → Run workflow** (funciona pelo tablet).

> O repositório é público: só relatórios agregados vão para o git. CPFs são
> mascarados e a base completa fica apenas como artefato temporário do Actions.

## Próximas etapas (rascunho)

1. Entender o dado: campos, códigos, volume, frequência de atualização ← **agora**
2. Definir o "lead": quais obras interessam (região, tipo, área, fase, responsável PJ)
3. Pipeline diário: baixar → filtrar a região → detectar obras novas
4. App (pensado para tablet/celular): lista e mapa de obras, filtros, funil
   (novo → contato → visita → proposta → fechado), anotações, lembretes
5. Enriquecimento: dados do CNPJ da construtora (telefone, e-mail, porte)
