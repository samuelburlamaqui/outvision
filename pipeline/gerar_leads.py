#!/usr/bin/env python3
"""Gera a lista de obras para prospecção a partir dos Parquet do CNO.

Uso:
    python pipeline/gerar_leads.py <pasta_parquet> <saida.xlsx> <resumo.md> [--data-ref AAAA-MM-DD]

Aplica as regras de pipeline/regras.py: estado, área mínima, exclusão de
infraestrutura, fase estimada da obra e janela de cada linha de produto.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import urllib.parse
from collections import Counter

import duckdb

sys.path.insert(0, os.path.dirname(__file__))
import regras as R  # noqa: E402

QUALIFICACAO = {"0053": "Construtora", "0057": "Dono da obra", "0064": "Incorporador",
                "0070": "Proprietário do imóvel", "0109": "Consórcio", "0110": "Construção em nome coletivo",
                "0111": "Líder de consórcio"}  # conferido no dicionário oficial (cno-metadados.pdf)


def fmt_cnpj(s: str | None) -> str:
    s = (s or "").strip()
    if len(s) == 14 and s.isdigit():
        return f"{s[:2]}.{s[2:5]}.{s[5:8]}/{s[8:12]}-{s[12:]}"
    return s


def fmt_cno(s: str) -> str:
    return f"{s[:2]}.{s[2:5]}.{s[5:10]}/{s[10:]}" if len(s) == 12 else s


def carregar(parquet: str, ufs: list[str]) -> list[dict]:
    con = duckdb.connect()
    ufs_sql = ",".join(f"'{u}'" for u in ufs)
    sit_sql = ",".join(f"'{s}'" for s in R.SITUACOES_ACEITAS)
    con.execute(f"""
        CREATE TABLE obras AS SELECT * FROM read_parquet('{parquet}/cno.parquet')
        WHERE "Estado" IN ({ufs_sql}) AND "Situação" IN ({sit_sql})
    """)
    con.execute(f"""
        CREATE TABLE areas AS
        SELECT "CNO" AS cno,
               sum(TRY_CAST("Metragem" AS DOUBLE)) FILTER (WHERE "Tipo de Área" = 'Principal') AS area,
               arg_max("Destinação", TRY_CAST("Metragem" AS DOUBLE)) AS destinacao,
               arg_max("Categoria", TRY_CAST("Metragem" AS DOUBLE)) AS categoria,
               string_agg(DISTINCT "Destinação", ' + ') AS destinacoes
        FROM read_parquet('{parquet}/cno_areas.parquet')
        WHERE "CNO" IN (SELECT "CNO" FROM obras) GROUP BY 1
    """)
    con.execute(f"""
        CREATE TABLE cnaes AS SELECT "CNO" AS cno, list(DISTINCT "CNAE") AS cnaes
        FROM read_parquet('{parquet}/cno_cnaes.parquet')
        WHERE "CNO" IN (SELECT "CNO" FROM obras) GROUP BY 1
    """)
    # Nomes de empresas por CNPJ (para dar nome aos vínculos, que só trazem o CNPJ)
    con.execute(f"""
        CREATE TABLE nomes AS SELECT "NI do responsável" AS ni, any_value("Nome empresarial") AS nome
        FROM read_parquet('{parquet}/cno.parquet')
        WHERE "NI do responsável" <> '' AND "Nome empresarial" <> '' GROUP BY 1
    """)
    con.execute(f"""
        CREATE TABLE vinc AS
        SELECT v."CNO" AS cno,
               string_agg(coalesce(n.nome, 'CNPJ ' || substr(v."NI do responsável",1,2) || '.' ||
                          substr(v."NI do responsável",3,3) || '.' || substr(v."NI do responsável",6,3) || '/' ||
                          substr(v."NI do responsável",9,4) || '-' || substr(v."NI do responsável",13,2)) || ' (' ||
                          CASE v."Qualificação do contribuinte" WHEN '0053' THEN 'construtora'
                               WHEN '0064' THEN 'incorporadora' WHEN '0109' THEN 'consórcio'
                               WHEN '0110' THEN 'construção em nome coletivo' WHEN '0111' THEN 'líder de consórcio'
                               WHEN '0057' THEN 'dono da obra' WHEN '0070' THEN 'proprietário' ELSE v."Qualificação do contribuinte" END
                          || ')', '; ') AS vinculadas
        FROM read_parquet('{parquet}/cno_vinculos.parquet') v
        LEFT JOIN nomes n ON n.ni = v."NI do responsável"
        WHERE v."CNO" IN (SELECT "CNO" FROM obras) AND v."NI do responsável" <> ''
          AND (v."Data de fim" IS NULL OR v."Data de fim" = '')
        GROUP BY 1
    """)
    cur = con.execute("""
        SELECT o."CNO" cno, o."Nome" nome_obra, o."Nome empresarial" nome_empresarial,
               o."NI do responsável" cnpj, o."Qualificação do responsavel" qualificacao,
               o."Tipo de logradouro" tipo_log, o."Logradouro" logradouro, o."Número do logradouro" numero,
               o."Complemento" complemento, o."Bairro" bairro, o."CEP" cep, o."Nome do município" municipio,
               o."Estado" uf, TRY_CAST(o."Data de início" AS DATE) inicio,
               TRY_CAST(o."Data de registro" AS DATE) registro,
               a.area, a.destinacao, a.destinacoes, a.categoria, c.cnaes, v.vinculadas
        FROM obras o
        LEFT JOIN areas a ON a.cno = o."CNO"
        LEFT JOIN cnaes c ON c.cno = o."CNO"
        LEFT JOIN vinc v ON v.cno = o."CNO"
    """)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def classificar(obras: list[dict], data_ref: dt.date) -> tuple[list[dict], list[dict], Counter]:
    leads, excluidas, cortes = [], [], Counter()
    limite_inicio = dt.date.fromisoformat(R.INICIO_MINIMO)
    for o in obras:
        area = o["area"]
        suspeita = area is not None and area > R.AREA_SUSPEITA_M2
        if area is None or area < R.AREA_MINIMA_M2:
            cortes["área menor que o mínimo (ou sem área em m²)"] += 1
            continue
        if o["categoria"] in R.CATEGORIAS_EXCLUIDAS:
            cortes["categoria demolição"] += 1
            continue
        if o["inicio"] is None or o["inicio"] < limite_inicio:
            cortes[f"início antes de {limite_inicio:%d/%m/%Y}"] += 1
            continue
        motivo = R.motivo_infra(o["nome_obra"], o["cnaes"])
        if motivo:
            cortes["infraestrutura"] += 1
            excluidas.append({**o, "motivo": motivo})
            continue

        dur = R.duracao_meses(o["destinacao"], None if suspeita else area, o["categoria"])
        meses = (data_ref - o["inicio"]).days / 30.44
        pct = 100 * meses / dur
        o.update({
            "area_suspeita": suspeita,
            "duracao_meses": dur,
            "meses_decorridos": meses,
            "pct_prazo": pct,
            "fase": R.fase(pct),
            "janelas": R.janelas_abertas(pct),
        })
        o["concluida"] = pct >= 115  # só informativo: a obra continua na lista
        leads.append(o)
    return leads, excluidas, cortes


def prioridade(o: dict) -> tuple:
    """Ordena: janelas de produto abertas primeiro, depois obras com CNPJ, depois maior área."""
    produtos = [j for j in o["janelas"] if j != "Apresentação / especificação"]
    area_confiavel = 0 if o["area_suspeita"] else (o["area"] or 0)
    return (o.get("concluida", False), -len(produtos), not o["janelas"], not bool(o["cnpj"]), -area_confiavel)


def endereco(o: dict) -> str:
    partes = [f"{o['tipo_log'] or ''} {o['logradouro'] or ''}".strip(), o["numero"] or ""]
    s = ", ".join(p for p in partes if p and p.upper() not in ("SN", "S/N", "0", "00"))
    if o["complemento"]:
        s += f" - {o['complemento']}"
    return s


def link_mapa(o: dict) -> str:
    q = f"{endereco(o)}, {o['bairro'] or ''}, {o['municipio']} - {o['uf']}, {o['cep'] or ''}"
    return "https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote(q)


def escrever_xlsx(caminho: str, leads: list[dict], excluidas: list[dict], data_ref: dt.date) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    fonte = Font(name="Arial", size=10)
    fonte_cab = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    fill_cab = PatternFill("solid", fgColor="1F4E78")
    fill_janela = PatternFill("solid", fgColor="E2EFDA")
    link_font = Font(name="Arial", size=10, color="0563C1", underline="single")

    wb = Workbook()
    ws = wb.active
    ws.title = "Obras"
    cab = ["Agora é hora de", "Fase estimada", "% do prazo", "Município", "Bairro", "Endereço", "Mapa",
           "Nome da obra", "Responsável", "CNPJ", "Qualificação", "Empresas vinculadas", "Destinação",
           "Categoria", "Área (m²)", "Início", "Registro", "Prazo estimado (meses)", "CNO", "CEP", "Observação"]
    larg = [30, 22, 10, 18, 22, 40, 8, 40, 40, 20, 18, 40, 26, 12, 12, 11, 11, 12, 18, 10, 30]
    ws.append(cab)
    for i, c in enumerate(ws[1], 1):
        c.font, c.fill = fonte_cab, fill_cab
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = larg[i - 1]
    ws.row_dimensions[1].height = 30

    for o in sorted(leads, key=prioridade):
        obs = []
        if o["area_suspeita"]:
            obs.append("área provavelmente digitada errada")
        if o.get("concluida"):
            obs.append("pelo prazo estimado já deve ter terminado — confirmar")
        if not o["cnpj"]:
            obs.append("responsável pessoa física")
        ws.append([
            ", ".join(o["janelas"]) or ("Verificar se terminou" if o.get("concluida") else ""),
            o["fase"], o["pct_prazo"] / 100, o["municipio"], o["bairro"], endereco(o), "abrir",
            o["nome_obra"], o["nome_empresarial"] or o["nome_obra"], fmt_cnpj(o["cnpj"]),
            QUALIFICACAO.get(o["qualificacao"], o["qualificacao"]), o["vinculadas"] or "",
            o["destinacoes"] or o["destinacao"], o["categoria"], o["area"], o["inicio"], o["registro"],
            round(o["duracao_meses"]), fmt_cno(o["cno"]), o["cep"], "; ".join(obs),
        ])
        r = ws.max_row
        for c in ws[r]:
            c.font = fonte
        ws.cell(r, 3).number_format = "0%"
        ws.cell(r, 15).number_format = "#,##0"
        ws.cell(r, 16).number_format = "DD/MM/YYYY"
        ws.cell(r, 17).number_format = "DD/MM/YYYY"
        mapa = ws.cell(r, 7)
        mapa.hyperlink, mapa.font = link_mapa(o), link_font
        if any(j != "Apresentação / especificação" for j in o["janelas"]):
            ws.cell(r, 1).fill = fill_janela
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = ws.dimensions

    # Aba de excluídas, para conferir se o filtro de infraestrutura acertou
    wx = wb.create_sheet("Excluídas (infraestrutura)")
    wx.append(["Motivo", "Nome da obra", "Responsável", "Município", "Destinação declarada", "Área (m²)", "CNAEs", "CNO"])
    for i, w in enumerate([30, 50, 40, 18, 26, 12, 40, 18], 1):
        wx.column_dimensions[get_column_letter(i)].width = w
        wx.cell(1, i).font, wx.cell(1, i).fill = fonte_cab, fill_cab
    for o in sorted(excluidas, key=lambda x: -(x["area"] or 0)):
        wx.append([o["motivo"], o["nome_obra"], o["nome_empresarial"] or "", o["municipio"], o["destinacao"],
                   o["area"], ", ".join(o["cnaes"] or []), fmt_cno(o["cno"])])
        for c in wx[wx.max_row]:
            c.font = fonte
        wx.cell(wx.max_row, 6).number_format = "#,##0"
    wx.freeze_panes = "A2"
    wx.auto_filter.ref = wx.dimensions

    # Aba explicativa
    wl = wb.create_sheet("Como ler")
    wl.column_dimensions["A"].width = 32
    wl.column_dimensions["B"].width = 90
    linhas = [
        ("Fonte", "CNO — Cadastro Nacional de Obras, Receita Federal (dados abertos)"),
        ("Data de referência", data_ref.strftime("%d/%m/%Y") + " — fase e % do prazo foram calculados nesta data"),
        ("Recorte", f"Estado {', '.join(R.UFS)}; obra ativa; área principal ≥ {R.AREA_MINIMA_M2} m²; "
                    f"início a partir de {R.INICIO_MINIMO}; sem demolição; sem infraestrutura "
                    "(pavimentação, estradas, saneamento, pontes, redes de energia...)"),
        ("", ""),
        ("Como a fase é estimada", "% do prazo = meses desde o início ÷ prazo típico da obra. O prazo típico depende "
                                   "da destinação e da área (ex.: galpão de 1.500 m² ≈ 6 meses; prédio de 8.000 m² ≈ 28 meses)."
                                   " É uma ESTIMATIVA inicial para ser calibrada com a experiência de campo."),
        ("", ""),
        ("Janelas por produto (% do prazo)", ""),
    ]
    for nome, (ini, fim) in R.JANELAS.items():
        linhas.append((f"   {nome}", f"de {ini}% a {fim}% do prazo"))
    linhas += [("", ""), ("Fases (% do prazo)", "")]
    ant = 0
    for lim, nome in R.FASES:
        linhas.append((f"   {nome}", f"{ant}% a {lim}%" if lim < 10_000 else f"acima de {ant}%"))
        ant = lim
    linhas += [("", ""),
               ("Ordem da lista", "Primeiro as obras com janela de produto aberta agora, depois com CNPJ, depois as maiores."),
               ("Coluna Mapa", "Abre o endereço no Google Maps."),
               ("Aba Excluídas", "Obras tiradas por parecerem infraestrutura — vale conferir se alguma interessa.")]
    for a_, b_ in linhas:
        wl.append([a_, b_])
        for c in wl[wl.max_row]:
            c.font = Font(name="Arial", size=10, bold=bool(a_ and not a_.startswith("   ")))
            c.alignment = Alignment(wrap_text=True, vertical="top")
    wb.save(caminho)


def escrever_json(caminho: str, leads: list[dict], excluidas: list[dict], cortes: Counter,
                  total: int, data_ref: dt.date) -> None:
    """Dados para a página: meta (regras e contagens) + uma obra por linha."""
    import json

    def d(x):
        return x.isoformat() if x else None

    meta = {
        "data_ref": d(data_ref), "uf": R.UFS, "area_minima": R.AREA_MINIMA_M2, "inicio_minimo": R.INICIO_MINIMO,
        "ativas_no_estado": total, "cortes": dict(cortes),
        "janelas": [{"nome": k, "ini": v[0], "fim": v[1]} for k, v in R.JANELAS.items()],
        "fases": [{"ate": lim, "nome": nome} for lim, nome in R.FASES],
    }
    linhas = []
    for o in sorted(leads, key=prioridade):
        linhas.append({
            "cno": fmt_cno(o["cno"]), "obra": o["nome_obra"], "resp": o["nome_empresarial"] or o["nome_obra"],
            "cnpj": fmt_cnpj(o["cnpj"]), "qualif": QUALIFICACAO.get(o["qualificacao"], o["qualificacao"]),
            "vinc": o["vinculadas"] or "", "mun": o["municipio"], "bairro": o["bairro"], "end": endereco(o),
            "cep": o["cep"], "dest": o["destinacao"], "dests": o["destinacoes"], "cat": o["categoria"],
            "area": round(o["area"]) if o["area"] else None, "susp": o["area_suspeita"],
            "inicio": d(o["inicio"]), "registro": d(o["registro"]), "prazo": o["duracao_meses"],
            "mapa": link_mapa(o),
        })
    excl = [{"cno": fmt_cno(o["cno"]), "obra": o["nome_obra"], "resp": o["nome_empresarial"] or "",
             "mun": o["municipio"], "dest": o["destinacao"], "area": round(o["area"]) if o["area"] else None,
             "motivo": o["motivo"]} for o in sorted(excluidas, key=lambda x: -(x["area"] or 0))]
    with open(caminho, "w", encoding="utf-8") as f:
        f.write('{"meta":' + json.dumps(meta, ensure_ascii=False) + ',\n"excluidas":'
                + json.dumps(excl, ensure_ascii=False) + ',\n"obras":[\n')
        f.write(",\n".join(json.dumps(x, ensure_ascii=False) for x in linhas))
        f.write("\n]}\n")


def escrever_resumo(caminho: str, leads: list[dict], excluidas: list[dict], cortes: Counter,
                    total: int, data_ref: dt.date) -> None:
    ativos = leads
    n_conc = sum(1 for o in leads if o.get("concluida"))
    L = [f"# Obras para prospecção — {', '.join(R.UFS)}", "",
         f"Data de referência: **{data_ref:%d/%m/%Y}**. Regras em [`pipeline/regras.py`](../pipeline/regras.py).", "",
         f"Obras ativas no estado: **{total:,}**".replace(",", "."), "",
         "| Etapa do filtro | Obras retiradas |", "|---|---:|"]
    for k, v in cortes.most_common():
        L.append(f"| {k} | {v:,} |".replace(",", "."))
    L += ["", f"**Lista final: {len(leads):,} obras**".replace(",", ".") +
          f" — destas, {n_conc} já passaram do prazo estimado (podem ter terminado sem dar baixa no CNO).", ""]

    def tab(titulo, chave, itens, n=None):
        cnt = Counter(chave(o) for o in itens)
        out = [f"### {titulo}", "", "| | Obras |", "|---|---:|"]
        for k, v in cnt.most_common(n):
            out.append(f"| {k} | {v} |")
        return out + [""]

    L += tab("Por fase estimada", lambda o: o["fase"], ativos)
    jan = Counter(j for o in ativos for j in o["janelas"])
    L += ["### Janela aberta agora", "", "| Produto | Obras |", "|---|---:|"]
    for k in R.JANELAS:
        L.append(f"| {k} | {jan.get(k, 0)} |")
    L += [""]
    L += tab("Por destinação", lambda o: o["destinacao"], ativos)
    L += tab("Por município (top 20)", lambda o: o["municipio"], ativos, 20)
    L += tab("Responsável", lambda o: "Empresa (CNPJ)" if o["cnpj"] else "Pessoa física", ativos)
    faixas = Counter("800–2.000 m²" if o["area"] < 2000 else "2.000–5.000 m²" if o["area"] < 5000
                     else "5.000–20.000 m²" if o["area"] < 20000 else "acima de 20.000 m²" for o in ativos)
    L += ["### Por área", "", "| Faixa | Obras |", "|---|---:|"] + [f"| {k} | {v} |" for k, v in faixas.items()] + [""]
    L += tab("Infraestrutura excluída — motivos mais comuns", lambda o: o["motivo"], excluidas, 15)
    with open(caminho, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("parquet")
    ap.add_argument("xlsx")
    ap.add_argument("resumo")
    ap.add_argument("--data-ref", default=None)
    a = ap.parse_args()
    data_ref = dt.date.fromisoformat(a.data_ref) if a.data_ref else dt.date.today()

    obras = carregar(a.parquet, R.UFS)
    leads, excluidas, cortes = classificar(obras, data_ref)
    if a.xlsx.endswith(".xlsx"):
        escrever_xlsx(a.xlsx, leads, excluidas, data_ref)
    else:
        escrever_json(a.xlsx, leads, excluidas, cortes, len(obras), data_ref)
    escrever_resumo(a.resumo, leads, excluidas, cortes, len(obras), data_ref)
    print(f"{len(obras)} obras ativas -> {len(leads)} na lista ({len(excluidas)} infraestrutura excluídas)")
    print(dict(cortes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
