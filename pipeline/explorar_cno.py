#!/usr/bin/env python3
"""Exploração inicial dos arquivos do CNO (Cadastro Nacional de Obras).

Uso:
    python pipeline/explorar_cno.py <pasta_baixados> <pasta_saida_relatorio> <pasta_parquet>

- Descompacta .zip, converte PDFs do dicionário para texto.
- Para cada CSV: detecta codificação/separador, carrega no DuckDB e gera o perfil de
  cada coluna (preenchimento, valores distintos, valores mais comuns, datas).
- Escreve RELATORIO_CNO.md + perfil.json (agregados, sem dados pessoais) e exporta
  Parquet para uso posterior (fica só como artefato do Actions, não vai para o git).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import zipfile

import duckdb

CPF_RE = re.compile(r"(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)")
DATA_RES = {
    "AAAA-MM-DD": re.compile(r"^\d{4}-\d{2}-\d{2}"),
    "DD/MM/AAAA": re.compile(r"^\d{2}/\d{2}/\d{4}"),
    "AAAAMMDD": re.compile(r"^(19|20)\d{6}$"),
}
TOP_N = 15


def mascarar(v):
    """Esconde qualquer coisa com cara de CPF (o repositório é público)."""
    if v is None:
        return None
    s = str(v)
    s = CPF_RE.sub(lambda m: "***.***.***-" + m.group(1)[-2:] if len(re.sub(r"\D", "", m.group(1))) == 11 else m.group(1), s)
    return s


def log(msg: str) -> None:
    print(msg, flush=True)


def descompactar(pasta: str) -> None:
    for raiz, _, arqs in os.walk(pasta):
        for a in arqs:
            p = os.path.join(raiz, a)
            if a.lower().endswith(".zip") or zipfile.is_zipfile(p):
                destino = p + "_extraido"
                if os.path.isdir(destino):
                    continue
                log(f"-> descompactando {p}")
                try:
                    with zipfile.ZipFile(p) as z:
                        for info in z.infolist():
                            log(f"   • {info.filename}: {info.file_size / 1e6:,.1f} MB (compactado {info.compress_size / 1e6:,.1f} MB)")
                        z.extractall(destino)
                except Exception as e:  # noqa: BLE001
                    log(f"   ! erro ao descompactar: {e!r}")
    # zips dentro de zips
    for raiz, _, arqs in os.walk(pasta):
        for a in arqs:
            p = os.path.join(raiz, a)
            if a.lower().endswith(".zip") and not os.path.isdir(p + "_extraido"):
                descompactar(raiz)
                return


def listar(pasta: str) -> list[str]:
    saida = []
    for raiz, _, arqs in os.walk(pasta):
        for a in sorted(arqs):
            saida.append(os.path.join(raiz, a))
    return sorted(saida)


def pdf_para_texto(pdf: str, pasta_saida: str) -> str | None:
    os.makedirs(pasta_saida, exist_ok=True)
    nome = os.path.splitext(os.path.basename(pdf))[0] + ".txt"
    destino = os.path.join(pasta_saida, nome)
    try:
        subprocess.run(["pdftotext", "-layout", pdf, destino], check=True)
        log(f"   ✓ dicionário convertido: {destino}")
        return destino
    except Exception as e:  # noqa: BLE001
        log(f"   ! pdftotext falhou para {pdf}: {e!r}")
        return None


def detectar_codificacao(caminho: str) -> str:
    with open(caminho, "rb") as f:
        amostra = f.read(8 * 1024 * 1024)
    if amostra.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    try:
        amostra.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError as e:
        # pode ter cortado um caractere multibyte no fim da amostra
        if e.start > len(amostra) - 4:
            return "utf-8"
        return "cp1252"


def primeira_linha(caminho: str, cod: str) -> str:
    with open(caminho, "r", encoding=cod, errors="replace", newline="") as f:
        return f.readline().rstrip("\r\n")


def detectar_separador(linha: str) -> str:
    candidatos = [";", ",", "|", "\t"]
    return max(candidatos, key=lambda c: linha.count(c))


def contar_linhas(caminho: str) -> int:
    n = 0
    with open(caminho, "rb") as f:
        while True:
            b = f.read(16 * 1024 * 1024)
            if not b:
                break
            n += b.count(b"\n")
    return n


def para_utf8(caminho: str, cod: str, destino: str) -> str:
    if cod in ("utf-8", "utf-8-sig"):
        return caminho
    log(f"   convertendo {cod} -> utf-8")
    with open(caminho, "r", encoding=cod, errors="replace", newline="") as src, \
            open(destino, "w", encoding="utf-8", newline="") as dst:
        shutil.copyfileobj(src, dst, 16 * 1024 * 1024)
    return destino


def parece_cabecalho(campos: list[str]) -> bool:
    campos = [c.strip().strip('"') for c in campos]
    if not campos:
        return False
    com_letras = sum(1 for c in campos if re.search(r"[A-Za-zÀ-ú]", c))
    numericos = sum(1 for c in campos if re.fullmatch(r"[\d.,/-]+", c or "x"))
    return com_letras >= len(campos) * 0.8 and numericos == 0


def nome_tabela(caminho: str) -> str:
    base = os.path.splitext(os.path.basename(caminho))[0].lower()
    return re.sub(r"\W+", "_", base).strip("_") or "tabela"


def q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def perfil_coluna(con, tabela: str, col: str, total: int) -> dict:
    c = q(col)
    r = con.execute(f"""
        SELECT count(DISTINCT {c}),
               sum(CASE WHEN {c} IS NULL OR trim({c}) = '' THEN 1 ELSE 0 END),
               min(length({c})), max(length({c}))
        FROM {q(tabela)}
    """).fetchone()
    distintos, vazios, lmin, lmax = r
    top = con.execute(f"""
        SELECT {c} AS v, count(*) AS n FROM {q(tabela)}
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT {TOP_N}
    """).fetchall()
    amostra = [x[0] for x in con.execute(f"""
        SELECT {c} FROM {q(tabela)} WHERE {c} IS NOT NULL AND trim({c}) <> '' LIMIT 2000
    """).fetchall()]

    info = {
        "coluna": col,
        "distintos": distintos,
        "vazios": vazios,
        "pct_preenchido": round(100 * (1 - (vazios or 0) / total), 2) if total else None,
        "tam_min": lmin,
        "tam_max": lmax,
        "top": [{"valor": v if col.lower().startswith("total") else mascarar(v), "n": n, "pct": round(100 * n / total, 2) if total else None} for v, n in top],
    }

    # só digitos? (códigos, CNPJ, CEP...)
    if amostra and all(re.fullmatch(r"\d+", a.strip()) for a in amostra):
        info["so_digitos"] = True

    # datas
    for fmt, rx in DATA_RES.items():
        if amostra and sum(1 for a in amostra if rx.match(a.strip())) >= 0.95 * len(amostra):
            info["formato_data"] = fmt
            if fmt == "AAAA-MM-DD":
                ano, ym, dia = f"substr({c},1,4)", f"substr({c},1,7)", f"substr({c},1,10)"
            elif fmt == "DD/MM/AAAA":
                ano = f"substr({c},7,4)"
                ym = f"substr({c},7,4) || '-' || substr({c},4,2)"
                dia = f"substr({c},7,4) || '-' || substr({c},4,2) || '-' || substr({c},1,2)"
            else:
                ano = f"substr({c},1,4)"
                ym = f"substr({c},1,4) || '-' || substr({c},5,2)"
                dia = f"substr({c},1,4) || '-' || substr({c},5,2) || '-' || substr({c},7,2)"
            filtro = f"WHERE {c} IS NOT NULL AND trim({c}) <> ''"
            info["data_min"], info["data_max"] = con.execute(
                f"SELECT min({dia}), max({dia}) FROM {q(tabela)} {filtro}").fetchone()
            info["por_ano"] = con.execute(
                f"SELECT {ano} a, count(*) FROM {q(tabela)} {filtro} GROUP BY 1 ORDER BY 1").fetchall()
            info["ultimos_meses"] = con.execute(
                f"SELECT {ym} m, count(*) FROM {q(tabela)} {filtro} GROUP BY 1 ORDER BY 1 DESC LIMIT 18").fetchall()
            info["ultimos_dias"] = con.execute(
                f"SELECT {dia} d, count(*) FROM {q(tabela)} {filtro} GROUP BY 1 ORDER BY 1 DESC LIMIT 21").fetchall()
            break

    # numérico decimal (áreas)?
    eh_codigo = info.get("so_digitos") and (lmin or 0) >= 8  # CNO, CNPJ, CEP...: estatística não faz sentido
    if amostra and "formato_data" not in info and not eh_codigo and all(re.fullmatch(r"-?\d+([.,]\d+)?", a.strip()) for a in amostra):
        expr = f"TRY_CAST(replace({c}, ',', '.') AS DOUBLE)"
        r = con.execute(f"""
            SELECT min({expr}), quantile_cont({expr}, 0.5), avg({expr}), quantile_cont({expr}, 0.9),
                   quantile_cont({expr}, 0.99), max({expr})
            FROM {q(tabela)}
        """).fetchone()
        info["numerico"] = dict(zip(["min", "mediana", "media", "p90", "p99", "max"],
                                    [round(x, 2) if x is not None else None for x in r]))
    return info


def perfil_csv(con, caminho: str, pasta_tmp: str, pasta_parquet: str) -> dict:
    log(f"-> analisando {caminho} ({os.path.getsize(caminho) / 1e6:,.1f} MB)")
    t0 = time.time()
    cod = detectar_codificacao(caminho)
    linha1 = primeira_linha(caminho, cod)
    sep = detectar_separador(linha1)
    campos = linha1.split(sep)
    tem_cab = parece_cabecalho(campos)
    linhas_brutas = contar_linhas(caminho)
    log(f"   codificação={cod} separador={sep!r} cabeçalho={tem_cab} linhas_brutas={linhas_brutas:,}")
    log(f"   1ª linha: {mascarar(linha1)[:400]}")

    utf8 = para_utf8(caminho, cod, os.path.join(pasta_tmp, os.path.basename(caminho) + ".utf8"))
    tabela = nome_tabela(caminho)
    con.execute(f"DROP TABLE IF EXISTS {q(tabela)}")
    lit = lambda v: "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    con.execute(f"""
        CREATE TABLE {q(tabela)} AS
        SELECT * FROM read_csv({lit(utf8)}, delim={lit(sep)}, header={str(tem_cab).lower()},
                               all_varchar=true, quote='"', escape='"',
                               ignore_errors=true, null_padding=true, max_line_size=10000000)
    """)
    total = con.execute(f"SELECT count(*) FROM {q(tabela)}").fetchone()[0]
    colunas = [r[0] for r in con.execute(f"DESCRIBE {q(tabela)}").fetchall()]
    log(f"   carregadas {total:,} linhas, {len(colunas)} colunas: {colunas}")

    perfis = []
    for col in colunas:
        try:
            perfis.append(perfil_coluna(con, tabela, col, total))
        except Exception as e:  # noqa: BLE001
            perfis.append({"coluna": col, "erro": repr(e)})
            log(f"   ! erro no perfil de {col}: {e!r}")

    # 3 exemplos completos. Prefere linhas que tenham um CNPJ (empresa) em alguma coluna,
    # para não expor pessoas físicas no repositório público; CPFs são mascarados de todo jeito.
    tem_cnpj = " OR ".join(f"regexp_matches(coalesce({q(c)}, ''), '^\\d{{14}}$')" for c in colunas) or "false"
    exemplos = con.execute(f"""
        SELECT * FROM (SELECT * FROM {q(tabela)} WHERE {tem_cnpj} LIMIT 50000)
        USING SAMPLE reservoir(3 ROWS) REPEATABLE (42)
    """).fetchall()
    if not exemplos:
        exemplos = con.execute(f"SELECT * FROM {q(tabela)} USING SAMPLE reservoir(3 ROWS) REPEATABLE (42)").fetchall()
    exemplos = [[mascarar(v) for v in linha] for linha in exemplos]

    os.makedirs(pasta_parquet, exist_ok=True)
    try:
        con.execute(f"COPY {q(tabela)} TO '{os.path.join(pasta_parquet, tabela)}.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)")
    except Exception as e:  # noqa: BLE001
        log(f"   ! falha exportando parquet: {e!r}")

    if utf8 != caminho:
        os.remove(utf8)

    log(f"   ✓ perfil de {tabela} em {time.time() - t0:,.0f}s")
    return {
        "arquivo": os.path.basename(caminho),
        "tabela": tabela,
        "tamanho_mb": round(os.path.getsize(caminho) / 1e6, 1),
        "codificacao": cod,
        "separador": sep,
        "cabecalho": tem_cab,
        "primeira_linha": mascarar(linha1)[:1000],
        "linhas_brutas": linhas_brutas,
        "linhas_carregadas": total,
        "colunas": colunas,
        "perfis": perfis,
        "exemplos": exemplos,
    }


def chaves_comuns(con, tabelas: list[dict]) -> list[dict]:
    """Colunas com o mesmo nome em mais de uma tabela -> provável chave de ligação."""
    saida = []
    por_col: dict[str, list[str]] = {}
    for t in tabelas:
        for c in t["colunas"]:
            por_col.setdefault(c, []).append(t["tabela"])
    for col, tabs in por_col.items():
        if len(tabs) < 2:
            continue
        base = max(tabs, key=lambda x: next(t["linhas_carregadas"] for t in tabelas if t["tabela"] == x))
        for outra in tabs:
            if outra == base:
                continue
            try:
                r = con.execute(f"""
                    SELECT count(DISTINCT o.{q(col)}),
                           count(DISTINCT CASE WHEN b.k IS NOT NULL THEN o.{q(col)} END)
                    FROM {q(outra)} o
                    LEFT JOIN (SELECT DISTINCT {q(col)} AS k FROM {q(base)}) b ON b.k = o.{q(col)}
                """).fetchone()
                saida.append({"coluna": col, "tabela_base": base, "outra_tabela": outra,
                              "distintos_outra": r[0], "encontrados_na_base": r[1]})
            except Exception as e:  # noqa: BLE001
                saida.append({"coluna": col, "erro": repr(e)})
    return saida


def fmt_n(n) -> str:
    return f"{n:,}".replace(",", ".") if isinstance(n, int) else str(n)


def esc(v) -> str:
    s = "" if v is None else str(v)
    return s.replace("|", "\\|").replace("\n", " ")[:120]


def escrever_relatorio(saida: str, manifesto: dict | None, tabelas: list[dict], dicionarios: list[str],
                       ligacoes: list[dict], outros: list[str], erros: list[str]) -> None:
    L: list[str] = []
    L.append("# Exploração do CNO — Cadastro Nacional de Obras")
    L.append("")
    L.append(f"Gerado automaticamente em {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} pelo GitHub Action `explorar-cno`.")
    L.append("Valores com cara de CPF foram mascarados porque o repositório é público.")
    L.append("")

    if manifesto:
        L.append("## Arquivos publicados pela Receita")
        L.append("")
        L.append("| Compartilhamento | Arquivo | Tamanho | Última modificação | Método |")
        L.append("|---|---|---:|---|---|")
        for c in manifesto.get("compartilhamentos", []):
            if not c["arquivos"]:
                L.append(f"| {c['token']} | (nada baixado) | | | {esc(c['tentativas'])} |")
            for a in c["arquivos"]:
                tam = a.get("tamanho") or (a.get("download") or {}).get("bytes") or 0
                L.append(f"| {c['token']} | {esc(a['caminho'])} | {tam / 1e6:,.1f} MB | {esc(a.get('modificado'))} | {c.get('metodo')} |")
        L.append("")

    if dicionarios:
        L.append("## Dicionário de dados")
        L.append("")
        for d in dicionarios:
            L.append(f"- Texto extraído: [`{os.path.basename(d)}`](dicionario/{os.path.basename(d)})")
        L.append("")

    if outros:
        L.append("## Outros arquivos encontrados")
        L.append("")
        for o in outros:
            L.append(f"- `{o}`")
        L.append("")

    L.append("## Resumo das tabelas")
    L.append("")
    L.append("| Arquivo | Linhas | Colunas | Tamanho | Codificação | Separador |")
    L.append("|---|---:|---:|---:|---|---|")
    for t in tabelas:
        L.append(f"| {t['arquivo']} | {fmt_n(t['linhas_carregadas'])} (brutas {fmt_n(t['linhas_brutas'])}) | {len(t['colunas'])} | {t['tamanho_mb']:,} MB | {t['codificacao']} | `{t['separador']}` |")
    L.append("")

    if ligacoes:
        L.append("## Ligações entre tabelas (colunas com mesmo nome)")
        L.append("")
        L.append("| Coluna | Tabela base | Outra tabela | Distintos na outra | Encontrados na base |")
        L.append("|---|---|---|---:|---:|")
        for li in ligacoes:
            if "erro" in li:
                L.append(f"| {li['coluna']} | erro: {esc(li['erro'])} | | | |")
            else:
                L.append(f"| {li['coluna']} | {li['tabela_base']} | {li['outra_tabela']} | {fmt_n(li['distintos_outra'])} | {fmt_n(li['encontrados_na_base'])} |")
        L.append("")

    for t in tabelas:
        L.append(f"## Tabela `{t['arquivo']}`")
        L.append("")
        L.append(f"- Linhas: **{fmt_n(t['linhas_carregadas'])}** · Colunas: **{len(t['colunas'])}** · Cabeçalho no arquivo: {t['cabecalho']}")
        L.append(f"- Primeira linha bruta: `{esc(t['primeira_linha'])}`")
        L.append("")
        L.append("### Colunas")
        L.append("")
        L.append("| # | Coluna | % preenchido | Distintos | Tam. | Tipo percebido | Valores mais comuns |")
        L.append("|---:|---|---:|---:|---|---|---|")
        for i, p in enumerate(t["perfis"], 1):
            if "erro" in p:
                L.append(f"| {i} | {p['coluna']} | erro | | | | {esc(p['erro'])} |")
                continue
            tipo = p.get("formato_data") and f"data {p['formato_data']}" or ("número" if p.get("numerico") else ("dígitos" if p.get("so_digitos") else "texto"))
            top = "; ".join(f"{esc(x['valor'])} ({x['pct']}%)" for x in p["top"][:6])
            L.append(f"| {i} | `{p['coluna']}` | {p['pct_preenchido']} | {fmt_n(p['distintos'])} | {p['tam_min']}–{p['tam_max']} | {tipo} | {top} |")
        L.append("")

        if t["exemplos"]:
            L.append("### Exemplos de registros (amostra aleatória)")
            L.append("")
            L.append("| Coluna | Ex. 1 | Ex. 2 | Ex. 3 |")
            L.append("|---|---|---|---|")
            for ci, col in enumerate(t["colunas"]):
                vals = [esc(ex[ci]) if ci < len(ex) else "" for ex in t["exemplos"]]
                vals += [""] * (3 - len(vals))
                L.append(f"| `{col}` | " + " | ".join(vals) + " |")
            L.append("")

        L.append("### Detalhe por coluna")
        L.append("")
        for p in t["perfis"]:
            if "erro" in p:
                continue
            L.append(f"<details><summary><code>{p['coluna']}</code> — {fmt_n(p['distintos'])} distintos, {p['pct_preenchido']}% preenchido</summary>")
            L.append("")
            L.append("| Valor | Qtde | % |")
            L.append("|---|---:|---:|")
            for x in p["top"]:
                L.append(f"| {esc(x['valor'])} | {fmt_n(x['n'])} | {x['pct']} |")
            L.append("")
            if p.get("formato_data"):
                L.append(f"Datas de **{p['data_min']}** a **{p['data_max']}**.")
                L.append("")
                L.append("Por ano: " + ", ".join(f"{a}: {fmt_n(n)}" for a, n in p["por_ano"]))
                L.append("")
                L.append("Últimos meses: " + ", ".join(f"{m}: {fmt_n(n)}" for m, n in p["ultimos_meses"]))
                L.append("")
                L.append("Últimos dias com registro: " + ", ".join(f"{d}: {fmt_n(n)}" for d, n in p["ultimos_dias"]))
                L.append("")
            if p.get("numerico"):
                L.append("Estatísticas: " + ", ".join(f"{k}={v}" for k, v in p["numerico"].items()))
                L.append("")
            L.append("</details>")
            L.append("")

    if erros:
        L.append("## Erros durante a exploração")
        L.append("")
        for e in erros:
            L.append("```")
            L.append(e[-3000:])
            L.append("```")
        L.append("")

    with open(os.path.join(saida, "RELATORIO_CNO.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    baixados, saida, pasta_parquet = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(saida, exist_ok=True)
    pasta_tmp = os.path.join(baixados, "_tmp")
    os.makedirs(pasta_tmp, exist_ok=True)

    manifesto = None
    mpath = os.path.join(saida, "manifesto.json")
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as f:
            manifesto = json.load(f)

    erros: list[str] = []
    descompactar(baixados)
    arquivos = [a for a in listar(baixados) if "/_tmp/" not in a]
    log("Arquivos disponíveis:")
    for a in arquivos:
        log(f"   {a}  {os.path.getsize(a) / 1e6:,.1f} MB")

    con = duckdb.connect(os.path.join(pasta_tmp, "cno.duckdb"))
    con.execute("SET memory_limit='5GB'")
    con.execute(f"SET temp_directory='{pasta_tmp}/duck_tmp'")
    con.execute("SET preserve_insertion_order=false")

    dicionarios, tabelas, outros = [], [], []
    for a in arquivos:
        low = a.lower()
        try:
            if low.endswith(".pdf"):
                d = pdf_para_texto(a, os.path.join(saida, "dicionario"))
                if d:
                    dicionarios.append(d)
            elif low.endswith((".csv", ".txt")) or re.search(r"\.(csv|txt)\b", low):
                tabelas.append(perfil_csv(con, a, pasta_tmp, pasta_parquet))
            elif low.endswith(".zip") or zipfile.is_zipfile(a):
                continue
            else:
                # arquivo sem extensão conhecida: tenta como CSV se for texto
                with open(a, "rb") as f:
                    cab = f.read(4096)
                if cab[:4] == b"%PDF":
                    d = pdf_para_texto(a, os.path.join(saida, "dicionario"))
                    if d:
                        dicionarios.append(d)
                elif b"\x00" not in cab and (b";" in cab or b"," in cab):
                    tabelas.append(perfil_csv(con, a, pasta_tmp, pasta_parquet))
                else:
                    outros.append(os.path.relpath(a, baixados))
        except Exception:  # noqa: BLE001
            tb = f"{a}\n{traceback.format_exc()}"
            log(tb)
            erros.append(tb)

    ligacoes = []
    try:
        ligacoes = chaves_comuns(con, tabelas)
    except Exception:  # noqa: BLE001
        erros.append(traceback.format_exc())

    with open(os.path.join(saida, "perfil.json"), "w", encoding="utf-8") as f:
        json.dump({"tabelas": tabelas, "ligacoes": ligacoes, "dicionarios": [os.path.basename(d) for d in dicionarios],
                   "outros": outros, "erros": erros}, f, ensure_ascii=False, indent=1, default=str)
    escrever_relatorio(saida, manifesto, tabelas, dicionarios, ligacoes, outros, erros)
    log(f"Relatório escrito em {saida}/RELATORIO_CNO.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
