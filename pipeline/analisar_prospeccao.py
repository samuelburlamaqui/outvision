#!/usr/bin/env python3
"""Análise do CNO com olhar de prospecção comercial.

Uso:
    python pipeline/analisar_prospeccao.py <pasta_parquet> <saida.md> [--uf SP,PR] [--exemplos]

Lê os Parquet gerados por explorar_cno.py e responde:
  - quantas obras estão ativas e quantas entram por mês
  - que tipo de obra (destinação, categoria, área) e quem é o responsável (PJ x PF)
  - um primeiro recorte de "obras com potencial" para pisos/revestimentos, cabos e ASSA ABLOY

Os significados dos códigos foram conferidos no dicionário oficial
(exploracao/dicionario/cno-metadados.txt).
"""
from __future__ import annotations

import argparse
import os
import time

import duckdb

SITUACAO = {"01": "Nula", "02": "Ativa", "03": "Suspensa", "14": "Paralisada", "15": "Encerrada"}
QUALIFICACAO = {
    "0053": "Construtora",
    "0057": "Dono da obra",
    "0064": "Incorporador de construção civil",
    "0070": "Proprietário do imóvel",
    "0109": "Consórcio",
    "0110": "Construção em nome coletivo",
    "0111": "Sociedade líder de consórcio",
}
CNAE = {
    "4120400": "Construção de edifícios",
    "4399103": "Obras de alvenaria",
    "4299599": "Outras obras de engenharia civil",
    "4311801": "Demolição de edifícios",
    "4399199": "Serviços especializados p/ construção",
    "4213800": "Obras de urbanização",
}
# Destinações que costumam comprar volume de piso/revestimento, cabos e ferragens/fechaduras
DESTINACOES_ALVO = ("Residencial multifamiliar", "Comercial salas e lojas", "Galpão industrial",
                    "Conjunto habitacional popular", "Edifício de Garagens")
CATEGORIAS_ALVO = ("Obra Nova", "Acréscimo", "Reforma")
AREA_MIN = 500  # m²
AREA_SUSPEITA = 300_000  # m² — acima disso quase sempre é erro de digitação no cadastro


def fmt(n) -> str:
    if n is None:
        return "–"
    if isinstance(n, float):
        return f"{n:,.0f}".replace(",", ".")
    return f"{n:,}".replace(",", ".")


def tabela_md(cab: list[str], linhas: list[tuple], alinhar_dir: set[int] | None = None) -> str:
    alinhar_dir = alinhar_dir or set()
    out = ["| " + " | ".join(cab) + " |",
           "|" + "|".join("---:" if i in alinhar_dir else "---" for i in range(len(cab))) + "|"]
    for ln in linhas:
        out.append("| " + " | ".join(fmt(v) if isinstance(v, (int, float)) else str(v if v is not None else "")
                                     for v in ln) + " |")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("parquet")
    ap.add_argument("saida")
    ap.add_argument("--uf", default="", help="Filtra estados, ex.: SP,PR")
    ap.add_argument("--exemplos", action="store_true", help="Inclui lista de exemplos de obras (nomes de empresas)")
    a = ap.parse_args()

    con = duckdb.connect()
    p = a.parquet
    con.execute(f"CREATE VIEW cno_raw AS SELECT * FROM read_parquet('{p}/cno.parquet')")
    con.execute(f"CREATE VIEW areas_raw AS SELECT * FROM read_parquet('{p}/cno_areas.parquet')")
    con.execute(f"CREATE VIEW cnaes AS SELECT * FROM read_parquet('{p}/cno_cnaes.parquet')")

    filtro_uf = ""
    if a.uf:
        ufs = ",".join(f"'{u.strip().upper()}'" for u in a.uf.split(",") if u.strip())
        filtro_uf = f"WHERE \"Estado\" IN ({ufs})"

    # Tabela de obras normalizada
    con.execute(f"""
        CREATE TABLE obras AS
        SELECT
            "CNO" AS cno,
            "Situação" AS situacao,
            "Qualificação do responsavel" AS qualificacao,
            nullif(trim("NI do responsável"), '') AS cnpj_responsavel,
            coalesce(nullif(trim("Nome empresarial"), ''), "Nome") AS responsavel,
            "Nome" AS nome_obra,
            "Estado" AS uf,
            "Nome do município" AS municipio,
            "Bairro" AS bairro,
            "CEP" AS cep,
            TRY_CAST("Data de início" AS DATE) AS data_inicio,
            TRY_CAST("Data de registro" AS DATE) AS data_registro,
            TRY_CAST("Data da situação" AS DATE) AS data_situacao,
            "Unidade de medida" AS unidade,
            TRY_CAST("Área total" AS DOUBLE) AS area_total
        FROM cno_raw {filtro_uf}
    """)
    # Áreas resumidas por obra: área principal, destinação e categoria predominantes
    con.execute("""
        CREATE TABLE areas AS
        SELECT "CNO" AS cno,
               sum(TRY_CAST("Metragem" AS DOUBLE)) FILTER (WHERE "Tipo de Área" = 'Principal') AS area_principal,
               arg_max("Destinação", TRY_CAST("Metragem" AS DOUBLE)) AS destinacao,
               arg_max("Categoria", TRY_CAST("Metragem" AS DOUBLE)) AS categoria,
               arg_max("Tipo de obra", TRY_CAST("Metragem" AS DOUBLE)) AS tipo_obra,
               count(*) AS qtd_areas
        FROM areas_raw GROUP BY 1
    """)
    con.execute("""
        CREATE TABLE base AS
        SELECT o.*, a.destinacao, a.categoria, a.tipo_obra,
               CASE WHEN a.area_principal <= {AREA_SUSPEITA} THEN a.area_principal END AS area_principal,
               a.area_principal > {AREA_SUSPEITA} AS area_suspeita,
               o.cnpj_responsavel IS NOT NULL AS pj
        FROM obras o LEFT JOIN areas a USING (cno)
    """.format(AREA_SUSPEITA=AREA_SUSPEITA))
    ref = con.execute("SELECT max(data_registro) FROM base").fetchone()[0]
    con.execute(f"CREATE MACRO dias_atras(d) AS DATE '{ref}' - d")

    L: list[str] = []
    titulo = f"# CNO — análise para prospecção{' (' + a.uf.upper() + ')' if a.uf else ' (Brasil)'}"
    L += [titulo, "", f"Data de referência (registro mais recente na base): **{ref}**. "
          f"Gerado em {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}.", "",
          "> Códigos conferidos no dicionário oficial da Receita (exploracao/dicionario/cno-metadados.txt).", ""]

    total, susp = con.execute("SELECT count(*), count(*) FILTER (WHERE area_suspeita) FROM base").fetchone()
    L += [f"Total de obras na base: **{fmt(total)}**. Obras com área principal acima de "
          f"{fmt(AREA_SUSPEITA)} m² (provável erro de cadastro, área ignorada nas contas): {fmt(susp)}.", ""]

    # 1. Situação
    rows = con.execute("SELECT situacao, count(*) n FROM base GROUP BY 1 ORDER BY 2 DESC").fetchall()
    L += ["## 1. Situação das obras", "",
          tabela_md(["Código", "Situação", "Obras", "%"],
                    [(s, SITUACAO.get(s, "?"), n, f"{100*n/total:.1f}%") for s, n in rows], {2, 3}), ""]

    # 2. Fluxo de obras novas
    rows = con.execute("""
        SELECT strftime(data_registro, '%Y-%m') m, count(*) n,
               count(*) FILTER (WHERE pj) n_pj,
               count(*) FILTER (WHERE pj AND destinacao IN (SELECT unnest(?::VARCHAR[])) ) n_pj_alvo
        FROM base WHERE data_registro >= dias_atras(395) GROUP BY 1 ORDER BY 1 DESC
    """, [list(DESTINACOES_ALVO)]).fetchall()
    L += ["## 2. Obras novas registradas por mês", "",
          "Toda obra precisa ser registrada no CNO no início — por isso a data de registro é o melhor "
          "sinal de *obra nova*.", "",
          tabela_md(["Mês", "Obras registradas", "Com CNPJ (empresa)", "Empresa + destinação-alvo"], rows, {1, 2, 3}), ""]

    # 3. Perfil das obras ativas registradas nos últimos 12 meses
    con.execute("""
        CREATE TABLE recentes AS SELECT * FROM base
        WHERE situacao = '02' AND data_registro >= dias_atras(365)
    """)
    n_rec = con.execute("SELECT count(*) FROM recentes").fetchone()[0]
    L += ["## 3. Obras ativas registradas nos últimos 12 meses", "", f"Total: **{fmt(n_rec)}**", ""]

    rows = con.execute("""
        SELECT coalesce(destinacao, '(sem área)'), count(*) n, count(*) FILTER (WHERE pj) pj,
               median(area_principal) med, quantile_cont(area_principal, 0.9) p90
        FROM recentes GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    L += ["### Por destinação", "",
          tabela_md(["Destinação", "Obras", "Com CNPJ", "Área mediana (m²)", "Área p90 (m²)"], rows, {1, 2, 3, 4}), ""]

    rows = con.execute("SELECT coalesce(categoria,'(sem área)'), count(*) FROM recentes GROUP BY 1 ORDER BY 2 DESC").fetchall()
    L += ["### Por categoria", "", tabela_md(["Categoria", "Obras"], rows, {1}), ""]

    rows = con.execute("""
        SELECT qualificacao, count(*) n, count(*) FILTER (WHERE pj) pj FROM recentes GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    L += ["### Por qualificação do responsável", "",
          tabela_md(["Código", "Qualificação", "Obras", "Com CNPJ"],
                    [(q, QUALIFICACAO.get(q, "?"), n, pj) for q, n, pj in rows], {2, 3}), ""]

    rows = con.execute("""
        SELECT CASE WHEN area_principal IS NULL THEN '0. sem área'
                    WHEN area_principal < 100 THEN '1. até 100 m²'
                    WHEN area_principal < 300 THEN '2. 100–300 m²'
                    WHEN area_principal < 500 THEN '3. 300–500 m²'
                    WHEN area_principal < 1000 THEN '4. 500–1.000 m²'
                    WHEN area_principal < 5000 THEN '5. 1.000–5.000 m²'
                    WHEN area_principal < 20000 THEN '6. 5.000–20.000 m²'
                    ELSE '7. acima de 20.000 m²' END faixa,
               count(*) n, count(*) FILTER (WHERE pj) pj
        FROM recentes GROUP BY 1 ORDER BY 1
    """).fetchall()
    L += ["### Por faixa de área", "", tabela_md(["Faixa", "Obras", "Com CNPJ"], rows, {1, 2}), ""]

    rows = con.execute("""
        SELECT c."CNAE", count(*) n FROM recentes r JOIN cnaes c ON c."CNO" = r.cno GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    """).fetchall()
    L += ["### Por CNAE da obra", "",
          tabela_md(["CNAE", "Descrição", "Obras"], [(c, CNAE.get(c, ""), n) for c, n in rows], {2}), ""]

    # 4. Recorte de potencial
    con.execute(f"""
        CREATE TABLE potencial AS SELECT * FROM recentes
        WHERE pj AND (area_principal >= {AREA_MIN} OR area_suspeita)
          AND destinacao IN (SELECT unnest(?::VARCHAR[]))
          AND categoria IN (SELECT unnest(?::VARCHAR[]))
    """, [list(DESTINACOES_ALVO), list(CATEGORIAS_ALVO)])
    n_pot = con.execute("SELECT count(*) FROM potencial").fetchone()[0]
    L += ["## 4. Primeiro recorte de \"obras com potencial\"", "",
          f"Critérios (rascunho, a validar): situação **Ativa**, registrada nos **últimos 12 meses**, "
          f"responsável **com CNPJ**, área principal **≥ {AREA_MIN} m²**, destinação em "
          f"{', '.join(DESTINACOES_ALVO)} e categoria {', '.join(CATEGORIAS_ALVO)}.", "",
          f"Resultado: **{fmt(n_pot)} obras** ({100*n_pot/max(n_rec,1):.1f}% das ativas recentes).", ""]

    rows = con.execute("""
        SELECT uf, count(*) n, count(*) FILTER (WHERE data_registro >= dias_atras(90)) n90,
               sum(area_principal) area
        FROM potencial GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    L += ["### Por estado", "", tabela_md(["UF", "Obras (12 meses)", "Últimos 90 dias", "Área somada (m²)"], rows, {1, 2, 3}), ""]

    rows = con.execute("""
        SELECT uf, municipio, count(*) n, count(*) FILTER (WHERE data_registro >= dias_atras(90)) n90
        FROM potencial GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30
    """).fetchall()
    L += ["### Municípios com mais obras com potencial", "",
          tabela_md(["UF", "Município", "Obras (12 meses)", "Últimos 90 dias"], rows, {2, 3}), ""]

    rows = con.execute("""
        SELECT destinacao, count(*) n, median(area_principal) FROM potencial GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    L += ["### Por destinação", "", tabela_md(["Destinação", "Obras", "Área mediana (m²)"], rows, {1, 2}), ""]

    rows = con.execute("""
        SELECT count(DISTINCT cnpj_responsavel),
               count(*) FILTER (WHERE cnpj_responsavel IN (
                   SELECT cnpj_responsavel FROM potencial GROUP BY 1 HAVING count(*) >= 3))
        FROM potencial
    """).fetchone()
    L += [f"Empresas responsáveis distintas: **{fmt(rows[0])}** — "
          f"obras de empresas com 3+ obras no recorte: **{fmt(rows[1])}**.", ""]

    if a.exemplos:
        rows = con.execute("""
            SELECT responsavel, count(*) n, sum(area_principal) area, string_agg(DISTINCT uf, ',') ufs
            FROM potencial GROUP BY cnpj_responsavel, responsavel ORDER BY 2 DESC, 3 DESC LIMIT 25
        """).fetchall()
        L += ["### Empresas com mais obras no recorte", "",
              tabela_md(["Empresa", "Obras", "Área somada (m²)", "UFs"], rows, {1, 2}), ""]
        rows = con.execute("""
            SELECT data_registro, uf, municipio, bairro, destinacao, categoria, area_principal, responsavel
            FROM potencial WHERE data_registro >= dias_atras(30)
            ORDER BY area_principal DESC LIMIT 25
        """).fetchall()
        L += ["### Maiores obras com potencial registradas nos últimos 30 dias", "",
              tabela_md(["Registro", "UF", "Município", "Bairro", "Destinação", "Categoria", "Área (m²)", "Responsável"],
                        rows, {6}), ""]

    os.makedirs(os.path.dirname(a.saida) or ".", exist_ok=True)
    with open(a.saida, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print(f"Escrito {a.saida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
