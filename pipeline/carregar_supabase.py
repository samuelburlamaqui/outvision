#!/usr/bin/env python3
"""Carrega as obras de um estado do CNO no banco (Supabase/Postgres).

Uso:
    DATABASE_URL=postgresql://... python pipeline/carregar_supabase.py <pasta_ou_zip> [--uf PA] [--manifesto m.json]

- Lê os CSVs do CNO (de um .zip ou de uma pasta já descompactada).
- Monta uma linha por obra do estado, com área, destinação, categoria, CNAEs e
  empresas vinculadas; aplica as regras de pipeline/regras.py (infraestrutura e
  prazo típico).
- Grava em public.obras: insere as novas, atualiza só as que mudaram, e registra
  a carga em public.cargas.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile

import duckdb
import psycopg

sys.path.insert(0, os.path.dirname(__file__))
import regras as R  # noqa: E402

COLUNAS = [
    "cno", "nome", "responsavel", "cnpj", "qualificacao", "situacao", "data_situacao", "data_inicio",
    "data_registro", "uf", "cod_municipio", "municipio", "bairro", "tipo_logradouro", "logradouro", "numero",
    "complemento", "cep", "unidade_medida", "area_total", "area_principal", "destinacao", "destinacoes",
    "categoria", "tipo_obra", "cnaes", "vinculadas", "motivo_infra", "prazo_meses",
]
QUALIF_VINCULO = {"0053": "construtora", "0057": "dono da obra", "0064": "incorporadora", "0070": "proprietário",
                  "0109": "consórcio", "0110": "construção em nome coletivo", "0111": "líder de consórcio"}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def localizar_csvs(origem: str, tmp: str) -> dict[str, str]:
    """Devolve {nome_base: caminho} para cno, cno_areas, cno_cnaes, cno_vinculos, cno_totais."""
    if os.path.isfile(origem) and zipfile.is_zipfile(origem):
        with zipfile.ZipFile(origem) as z:
            z.extractall(tmp)
        origem = tmp
    achados = {}
    for raiz, _, arqs in os.walk(origem):
        for a in arqs:
            p = os.path.join(raiz, a)
            if a.lower().endswith(".zip") and zipfile.is_zipfile(p):
                with zipfile.ZipFile(p) as z:
                    destino = os.path.join(tmp, "zip_" + os.path.splitext(a)[0])
                    z.extractall(destino)
                for r2, _, a2 in os.walk(destino):
                    for b in a2:
                        if b.lower().endswith(".csv"):
                            achados[os.path.splitext(b)[0].lower()] = os.path.join(r2, b)
            elif a.lower().endswith(".csv"):
                achados.setdefault(os.path.splitext(a)[0].lower(), p)
    faltando = {"cno", "cno_areas", "cno_cnaes", "cno_vinculos"} - set(achados)
    if faltando:
        raise SystemExit(f"Arquivos do CNO não encontrados: {sorted(faltando)} em {origem}")
    return achados


def para_utf8(caminho: str, tmp: str) -> str:
    """Os CSVs do CNO vêm em Windows-1252 (exceto cno_cnaes). Converte para UTF-8."""
    with open(caminho, "rb") as f:
        amostra = f.read(4 * 1024 * 1024)
    try:
        amostra.decode("utf-8")
        return caminho
    except UnicodeDecodeError as e:
        if e.start > len(amostra) - 4:
            return caminho
    destino = os.path.join(tmp, os.path.basename(caminho) + ".utf8.csv")
    with open(caminho, "r", encoding="cp1252", errors="replace", newline="") as src, \
            open(destino, "w", encoding="utf-8", newline="") as dst:
        shutil.copyfileobj(src, dst, 16 * 1024 * 1024)
    return destino


def montar_obras(csvs: dict[str, str], uf: str, tmp: str) -> list[dict]:
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")
    leitura = "delim=',', header=true, all_varchar=true, quote='\"', escape='\"', ignore_errors=true, null_padding=true"

    def tabela(nome: str) -> str:
        caminho = para_utf8(csvs[nome], tmp).replace("'", "''")
        return f"read_csv('{caminho}', {leitura})"

    log("lendo cno.csv")
    con.execute(f"CREATE TABLE cno AS SELECT * FROM {tabela('cno')}")
    total = con.execute("SELECT count(*) FROM cno").fetchone()[0]
    if "cno_totais" in csvs:
        esperado = con.execute(f"SELECT \"Total de obras\" FROM {tabela('cno_totais')}").fetchone()[0]
        if int(esperado) != total:
            raise SystemExit(f"cno.csv incompleto: {total} linhas lidas, {int(esperado)} esperadas")
        log(f"cno.csv completo: {total:,} obras no Brasil")
    con.execute("CREATE TABLE obras_uf AS SELECT * FROM cno WHERE \"Estado\" = ?", [uf])
    con.execute("CREATE TABLE nomes AS SELECT \"NI do responsável\" AS ni, min(\"Nome empresarial\") AS nome "
                "FROM cno WHERE \"NI do responsável\" <> '' AND \"Nome empresarial\" <> '' GROUP BY 1")
    con.execute("DROP TABLE cno")
    log(f"{con.execute('SELECT count(*) FROM obras_uf').fetchone()[0]:,} obras em {uf}")

    log("lendo áreas, CNAEs e vínculos")
    con.execute(f"""
        CREATE TABLE areas AS
        SELECT "CNO" AS cno,
               sum(TRY_CAST("Metragem" AS DOUBLE)) FILTER (WHERE "Tipo de Área" = 'Principal') AS area_principal,
               -- maior área decide; empate resolvido pela ordem alfabética (resultado estável)
               list("Destinação" ORDER BY TRY_CAST("Metragem" AS DOUBLE) DESC NULLS LAST, "Destinação")[1] AS destinacao,
               string_agg(DISTINCT "Destinação", ' + ' ORDER BY "Destinação") AS destinacoes,
               list("Categoria" ORDER BY TRY_CAST("Metragem" AS DOUBLE) DESC NULLS LAST, "Categoria")[1] AS categoria,
               list("Tipo de obra" ORDER BY TRY_CAST("Metragem" AS DOUBLE) DESC NULLS LAST, "Tipo de obra")[1] AS tipo_obra
        FROM {tabela('cno_areas')} WHERE "CNO" IN (SELECT "CNO" FROM obras_uf) GROUP BY 1
    """)
    con.execute(f"""
        CREATE TABLE cnaes AS SELECT "CNO" AS cno, list(DISTINCT "CNAE" ORDER BY "CNAE") AS cnaes
        FROM {tabela('cno_cnaes')} WHERE "CNO" IN (SELECT "CNO" FROM obras_uf) GROUP BY 1
    """)
    casos = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in QUALIF_VINCULO.items())
    con.execute(f"""
        CREATE TABLE vinc AS
        SELECT v."CNO" AS cno,
               string_agg(coalesce(n.nome, 'CNPJ ' || v."NI do responsável") || ' (' ||
                          CASE v."Qualificação do contribuinte" {casos} ELSE v."Qualificação do contribuinte" END
                          || ')', '; ' ORDER BY coalesce(n.nome, v."NI do responsável"), v."Qualificação do contribuinte") AS vinculadas
        FROM {tabela('cno_vinculos')} v LEFT JOIN nomes n ON n.ni = v."NI do responsável"
        WHERE v."CNO" IN (SELECT "CNO" FROM obras_uf) AND v."NI do responsável" <> ''
          AND coalesce(v."Data de fim", '') = ''
        GROUP BY 1
    """)
    cur = con.execute("""
        SELECT o."CNO", o."Nome",
               coalesce(nullif(trim(o."Nome empresarial"), ''), o."Nome"),
               nullif(trim(o."NI do responsável"), ''),
               o."Qualificação do responsavel", o."Situação",
               TRY_CAST(o."Data da situação" AS DATE), TRY_CAST(o."Data de início" AS DATE),
               TRY_CAST(o."Data de registro" AS DATE), o."Estado", o."Código do municipio", o."Nome do município",
               o."Bairro", o."Tipo de logradouro", o."Logradouro", o."Número do logradouro",
               nullif(trim(o."Complemento"), ''), o."CEP", o."Unidade de medida", TRY_CAST(o."Área total" AS DOUBLE),
               a.area_principal, a.destinacao, a.destinacoes, a.categoria, a.tipo_obra, c.cnaes, v.vinculadas
        FROM obras_uf o
        LEFT JOIN areas a ON a.cno = o."CNO"
        LEFT JOIN cnaes c ON c.cno = o."CNO"
        LEFT JOIN vinc v ON v.cno = o."CNO"
    """)
    obras = []
    for r in cur.fetchall():
        o = dict(zip(COLUNAS[:27], r))
        o["motivo_infra"] = R.motivo_infra(o["nome"], o["cnaes"])
        area = o["area_principal"]
        area_ok = area if area is not None and area <= R.AREA_SUSPEITA_M2 else None
        o["prazo_meses"] = round(R.duracao_meses(o["destinacao"], area_ok, o["categoria"]), 1)
        obras.append(o)
    return obras


def gravar(obras: list[dict], url: str, arquivo_modificado: str | None) -> dict:
    sem_cno = [c for c in COLUNAS if c != "cno"]
    with psycopg.connect(url, autocommit=False) as conn, conn.cursor() as cur:
        cur.execute("SET statement_timeout = '10min'")
        cur.execute("CREATE TEMP TABLE carga (LIKE public.obras INCLUDING DEFAULTS) ON COMMIT DROP")
        log(f"enviando {len(obras):,} obras")
        with cur.copy(f"COPY carga ({', '.join(COLUNAS)}) FROM STDIN") as cp:
            for o in obras:
                cp.write_row([o[c] for c in COLUNAS])
        mudou = " OR ".join(f"o.{c} IS DISTINCT FROM excluded.{c}" for c in sem_cno)
        cur.execute(f"""
            INSERT INTO public.obras AS o ({', '.join(COLUNAS)})
            SELECT {', '.join(COLUNAS)} FROM carga
            ON CONFLICT (cno) DO UPDATE SET
              {', '.join(f'{c} = excluded.{c}' for c in sem_cno)},
              atualizado_em = now()
            WHERE {mudou}
            RETURNING (xmax = 0) AS nova
        """)
        res = cur.fetchall()
        novas = sum(1 for (n,) in res if n)
        atualizadas = len(res) - novas
        cur.execute("""
            INSERT INTO public.cargas (arquivo_modificado, obras_lidas, obras_novas, obras_atualizadas)
            VALUES (%s, %s, %s, %s) RETURNING id
        """, (arquivo_modificado, len(obras), novas, atualizadas))
        carga_id = cur.fetchone()[0]
        conn.commit()
    return {"carga": carga_id, "lidas": len(obras), "novas": novas, "atualizadas": atualizadas}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("origem", help="cno.zip ou pasta com os arquivos baixados")
    ap.add_argument("--uf", default="PA")
    ap.add_argument("--manifesto", help="manifesto.json do baixar_receita.py (para registrar a data do arquivo)")
    a = ap.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Defina DATABASE_URL")

    modificado = None
    if a.manifesto and os.path.exists(a.manifesto):
        with open(a.manifesto, encoding="utf-8") as f:
            m = json.load(f)
        for c in m.get("compartilhamentos", []):
            for arq in c.get("arquivos", []):
                if arq.get("caminho", "").lower().endswith(".zip"):
                    modificado = arq.get("modificado") or (arq.get("download") or {}).get("last_modified")

    tmp = tempfile.mkdtemp(prefix="cno_")
    try:
        csvs = localizar_csvs(a.origem, tmp)
        obras = montar_obras(csvs, a.uf, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    res = gravar(obras, url, modificado)
    log(f"carga {res['carga']}: {res['lidas']:,} obras lidas, {res['novas']:,} novas, {res['atualizadas']:,} atualizadas")
    resumo = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumo:
        with open(resumo, "a", encoding="utf-8") as f:
            f.write(f"### Carga de obras ({a.uf})\n\nArquivo da Receita: {modificado or 'desconhecido'}\n\n"
                    f"| Lidas | Novas | Atualizadas |\n|---:|---:|---:|\n"
                    f"| {res['lidas']:,} | {res['novas']:,} | {res['atualizadas']:,} |\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
