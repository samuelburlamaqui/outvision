# Entendendo o CNO (Cadastro Nacional de Obras)

Base analisada: arquivo da Receita Federal gerado em **18/11/2026** (`cno.zip`, 340 MB
compactado, 1,4 GB descompactado). Detalhes técnicos completos em
[`RELATORIO_CNO.md`](RELATORIO_CNO.md); análise comercial em
[`PROSPECCAO_BRASIL.md`](PROSPECCAO_BRASIL.md).

## Em uma frase

Toda obra de construção civil no Brasil precisa ser registrada no CNO **logo no início**.
O arquivo traz todas elas — **3,7 milhões de obras**, das quais **~1 milhão estão ativas** —
com endereço, tamanho, tipo de obra e **quem é o responsável (com CNPJ quando é empresa)**.
Entram **~2.000 obras novas por dia útil** (~45 mil/mês) e o arquivo é atualizado diariamente.

## Os 5 arquivos e como se ligam

Todos se ligam pelo número do **CNO** (12 dígitos).

| Arquivo | Linhas | Uma linha é… | Campos mais úteis |
|---|---:|---|---|
| `cno.csv` | 3.702.503 | uma obra | situação, datas, endereço completo, CEP, município, UF, responsável (nome, CNPJ, qualificação), área total |
| `cno_areas.csv` | 4.676.828 | uma área da obra (uma obra pode ter várias) | **categoria** (obra nova, reforma…), **destinação** (residencial, comercial, galpão…), tipo (alvenaria…), metragem |
| `cno_cnaes.csv` | 4.053.191 | uma atividade (CNAE) da obra | CNAE: construção de edifícios, alvenaria, urbanização… |
| `cno_vinculos.csv` | 443.128 | um vínculo de responsabilidade | outras empresas ligadas à obra (ex.: construtora contratada), com datas |
| `cno_totais.csv` | 1 | totais de controle | serve para conferir se o download veio completo |

Formato: CSV separado por vírgula, aspas em todos os campos, codificação Windows-1252
(exceto `cno_cnaes`, UTF-8), datas `AAAA-MM-DD`, decimais com ponto.

## Códigos importantes

**Situação** (`cno.csv`):

| Código | Significado | Obras |
|---|---|---:|
| 02 | Ativa | 1.046.745 |
| 15 | Encerrada | 2.523.536 |
| 14 | Paralisada | 63.236 |
| 01 | Nula | 58.913 |
| 03 | Suspensa | 10.073 |

**Qualificação do responsável**: 0053 Pessoa jurídica construtora · 0057 Dono da obra ·
0064 Incorporador de construção civil · 0070 Proprietário do imóvel · 0109 Consórcio ·
0110 Construção em nome coletivo · 0111 Sociedade líder de consórcio

**Destinação** (`cno_areas.csv`): Residencial unifamiliar · Residencial multifamiliar ·
Comercial salas e lojas · Galpão industrial · Casa popular · Conjunto habitacional popular ·
Edifício de garagens

**Categoria**: Obra nova · Existente (regularização) · Acréscimo · Reforma · Demolição

Códigos conferidos no dicionário oficial da Receita: [`dicionario/cno-metadados.txt`](dicionario/cno-metadados.txt).

## O que isso significa para a prospecção

1. **Dá para saber de obra nova antes de ver o tapume.** A data de registro é praticamente
   o "nascimento" da obra.
2. **Só 1/3 das obras tem CNPJ do responsável.** Os outros 2/3 são pessoa física (casas) —
   nesses casos a Receita não publica o CPF, só o nome. Para o perfil de cliente dela
   (construtoras), o filtro "tem CNPJ" já limpa muito.
3. **O tamanho importa e está no dado.** Área e destinação permitem separar a casa de 70 m²
   do prédio de 10.000 m².
4. **Primeiro recorte (rascunho):** obra ativa, registrada nos últimos 12 meses, com CNPJ,
   ≥ 500 m², residencial multifamiliar / comercial / galpão / conjunto habitacional / garagens,
   obra nova, acréscimo ou reforma → **~24 mil obras no Brasil**, de ~17 mil empresas
   (~2 mil novas por mês). São Paulo capital sozinha: ~1.000 no ano.
5. **Telefone e e-mail não vêm no CNO.** Vêm do cadastro de CNPJ (outra base aberta da
   Receita) — é o próximo enriquecimento.

## Problemas de qualidade encontrados

- Áreas absurdas por erro de digitação (ex.: residencial com 13 milhões de m²): 1.398 obras
  acima de 300 mil m². Tratamos como "área suspeita".
- Datas de início antigas (1900, 1950…) em obras regularizadas.
- Texto livre sem padrão: "SN", "S/N", "s/n" no número; "CENTRO", "Centro", "centro" no bairro.
- "Código de localização" (plus code) preenchido em 60%, mas com lixo
  (`00000000+00`, `XXXXXXXX+XX`) — para mapa, melhor geocodificar pelo endereço/CEP.
