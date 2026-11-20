#!/usr/bin/env python3
"""Baixa todos os arquivos de compartilhamentos públicos do Nextcloud da Receita Federal.

Uso:
    python pipeline/baixar_receita.py <pasta_destino> <manifesto.json> TOKEN [TOKEN ...]

O TOKEN é o trecho depois de /index.php/s/ no link de compartilhamento, por exemplo
https://arquivos.receitafederal.gov.br/index.php/s/XEa8aE7wJdMGzkE -> XEa8aE7wJdMGzkE

Tenta, nesta ordem:
  1. WebDAV público novo  (/public.php/dav/files/<token>/)
  2. WebDAV público antigo (/public.php/webdav/, usuário = token)
  3. Download direto do compartilhamento (/index.php/s/<token>/download)
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE = os.environ.get("RECEITA_BASE", "https://arquivos.receitafederal.gov.br")
UA = "outvision-cno-pipeline/0.1"
NS = {"d": "DAV:"}
PROPFIND_BODY = (
    b'<?xml version="1.0"?>'
    b'<d:propfind xmlns:d="DAV:"><d:prop>'
    b"<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/>"
    b"</d:prop></d:propfind>"
)


def abrir(url: str, metodo: str = "GET", auth: str | None = None,
          headers: dict | None = None, data: bytes | None = None, tentativas: int = 4, espera_base: int = 5):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    if auth is not None:
        h["Authorization"] = "Basic " + base64.b64encode(f"{auth}:".encode()).decode()
    ultimo_erro = None
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, method=metodo, headers=h, data=data)
            return urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            # 4xx não adianta repetir
            if 400 <= e.code < 500:
                raise
            ultimo_erro = e
        except Exception as e:  # noqa: BLE001
            ultimo_erro = e
        espera = espera_base * (2 ** i)
        print(f"   ! falha em {metodo} {url}: {ultimo_erro} — nova tentativa em {espera}s", flush=True)
        time.sleep(espera)
    raise ultimo_erro  # type: ignore[misc]


def propfind(url: str, auth: str | None) -> list[dict]:
    with abrir(url, "PROPFIND", auth, {"Depth": "1", "Content-Type": "application/xml"}, PROPFIND_BODY, tentativas=2) as r:
        corpo = r.read()
    raiz = ET.fromstring(corpo)
    itens = []
    for resp in raiz.findall("d:response", NS):
        href = resp.findtext("d:href", default="", namespaces=NS)
        props: dict = {}
        for ps in resp.findall("d:propstat", NS):
            status = ps.findtext("d:status", default="", namespaces=NS)
            if " 200 " not in status:
                continue
            p = ps.find("d:prop", NS)
            if p is None:
                continue
            props["dir"] = p.find("d:resourcetype/d:collection", NS) is not None
            tam = p.findtext("d:getcontentlength", default="", namespaces=NS)
            props["tamanho"] = int(tam) if tam.strip().isdigit() else None
            props["modificado"] = p.findtext("d:getlastmodified", default="", namespaces=NS)
            props["tipo"] = p.findtext("d:getcontenttype", default="", namespaces=NS)
        itens.append({"href": href, **props})
    return itens


def listar_recursivo(raiz_url: str, auth: str | None) -> list[dict]:
    """Retorna só arquivos, com 'url' absoluta e 'caminho' relativo à raiz do compartilhamento."""
    raiz_path = urllib.parse.urlparse(raiz_url).path
    arquivos, fila, vistos = [], [raiz_url], set()
    while fila:
        url = fila.pop()
        if url in vistos:
            continue
        vistos.add(url)
        atual_path = urllib.parse.urlparse(url).path.rstrip("/")
        for item in propfind(url, auth):
            href_path = urllib.parse.urlparse(item["href"]).path
            if href_path.rstrip("/") == atual_path:
                continue
            abs_url = BASE + href_path
            rel = urllib.parse.unquote(href_path[len(raiz_path):]) if href_path.startswith(raiz_path) else urllib.parse.unquote(href_path)
            if item.get("dir"):
                fila.append(abs_url if abs_url.endswith("/") else abs_url + "/")
            else:
                arquivos.append({**item, "url": abs_url, "caminho": rel.lstrip("/")})
    return arquivos


def baixar(url: str, destino: str, auth: str | None, tentativas: int = 4, espera_base: int = 5) -> dict:
    os.makedirs(os.path.dirname(destino) or ".", exist_ok=True)
    inicio = time.time()
    with abrir(url, "GET", auth, tentativas=tentativas, espera_base=espera_base) as r:
        info = {"status": r.status, "content_type": r.headers.get("Content-Type"),
                "content_disposition": r.headers.get("Content-Disposition"),
                "last_modified": r.headers.get("Last-Modified")}
        total = 0
        proximo_log = 50 * 1024 * 1024
        with open(destino + ".parcial", "wb") as f:
            while True:
                bloco = r.read(1024 * 1024)
                if not bloco:
                    break
                f.write(bloco)
                total += len(bloco)
                if total >= proximo_log:
                    print(f"     … {total / 1e6:,.0f} MB", flush=True)
                    proximo_log += 50 * 1024 * 1024
    os.replace(destino + ".parcial", destino)
    info.update({"bytes": total, "segundos": round(time.time() - inicio, 1)})
    print(f"   ✓ {destino}: {total / 1e6:,.1f} MB em {info['segundos']}s", flush=True)
    return info


def nome_do_content_disposition(cd: str | None, padrao: str) -> str:
    if not cd:
        return padrao
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd) or re.search(r'filename="?([^";]+)"?', cd)
    return urllib.parse.unquote(m.group(1)) if m else padrao


def processar_token(token: str, pasta: str) -> dict:
    registro: dict = {"token": token, "link": f"{BASE}/index.php/s/{token}", "tentativas": [], "arquivos": []}
    destino_base = os.path.join(pasta, token)

    # 1) download direto do compartilhamento — é o caminho que a Receita atende;
    #    tenta por até ~8 min (15s, 30s, 1min, 2min, 4min) porque o servidor às vezes recusa conexões
    url = f"{BASE}/index.php/s/{token}/download"
    try:
        print(f"-> [{token}] download direto: {url}", flush=True)
        tmp = os.path.join(destino_base, "_download")
        info = baixar(url, tmp, None, tentativas=6, espera_base=15)
        nome = nome_do_content_disposition(info.get("content_disposition"), f"{token}.bin")
        final = os.path.join(destino_base, nome)
        os.replace(tmp, final)
        registro["metodo"] = "download-direto"
        registro["arquivos"] = [{"caminho": nome, "url": url, "local": final, "tamanho": info["bytes"],
                                 "modificado": info.get("last_modified"), "download": info}]
        registro["tentativas"].append({"metodo": "download-direto", "ok": True})
        return registro
    except Exception as e:  # noqa: BLE001
        print(f"   ! download direto falhou: {e!r}", flush=True)
        registro["tentativas"].append({"metodo": "download-direto", "ok": False, "erro": repr(e)})

    # 2) reserva: listar e baixar pelo WebDAV público
    candidatos = [
        (f"{BASE}/public.php/dav/files/{token}/", None, "webdav-novo"),
        (f"{BASE}/public.php/webdav/", token, "webdav-antigo"),
    ]
    for raiz, auth, nome in candidatos:
        try:
            print(f"-> [{token}] listando via {nome}: {raiz}", flush=True)
            arquivos = listar_recursivo(raiz, auth)
            registro["tentativas"].append({"metodo": nome, "ok": True, "qtd": len(arquivos)})
            if not arquivos:
                continue
            for a in arquivos:
                local = os.path.join(destino_base, a["caminho"])
                a["download"] = baixar(a["url"], local, auth)
                a["local"] = local
            registro["metodo"] = nome
            registro["arquivos"] = arquivos
            return registro
        except Exception as e:  # noqa: BLE001
            print(f"   ! {nome} falhou: {e!r}", flush=True)
            registro["tentativas"].append({"metodo": nome, "ok": False, "erro": repr(e)})
    return registro


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    pasta, manifesto, tokens = sys.argv[1], sys.argv[2], sys.argv[3:]
    os.makedirs(pasta, exist_ok=True)
    resultado = {"gerado_em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "compartilhamentos": []}
    for t in tokens:
        resultado["compartilhamentos"].append(processar_token(t, pasta))
    os.makedirs(os.path.dirname(manifesto) or ".", exist_ok=True)
    with open(manifesto, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    ok = any(c["arquivos"] for c in resultado["compartilhamentos"])
    print(f"Manifesto salvo em {manifesto}. Algum arquivo baixado: {ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
