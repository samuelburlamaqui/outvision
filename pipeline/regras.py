"""Regras de negócio da prospecção — tudo que for ajuste fino fica aqui.

Estas regras são o ponto de partida; a ideia é calibrar com a experiência de campo
(ex.: botão "não é obra de interesse" no app alimentando novas palavras-chave).
"""
from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------- recorte
UFS = ["PA"]
AREA_MINIMA_M2 = 800
AREA_SUSPEITA_M2 = 300_000  # acima disso quase sempre é erro de digitação
INICIO_MINIMO = "2023-01-01"  # só obras que começaram a partir desta data
SITUACOES_ACEITAS = ["02"]  # 02 = Ativa
CATEGORIAS_EXCLUIDAS = ["Demolição"]

# ---------------------------------------------------------------- infraestrutura
# CNAEs de obra que não compra piso/revestimento, cabo de edificação nem ferragem.
CNAES_INFRA = {
    "4211101",  # rodovias e ferrovias
    "4211102",  # sinalização de pistas
    "4212000",  # pontes, viadutos (obras de arte especiais)
    "4213800",  # urbanização: ruas, praças, calçadas
    "4221901",  # barragens p/ energia
    "4221902",  # estações e redes de distribuição de energia
    "4221903",  # manutenção de redes de energia
    "4221904",  # redes de telecomunicações
    "4221905",  # manutenção de redes de telecom
    "4222701",  # redes de água e esgoto
    "4222702",  # irrigação
    "4223500",  # dutos (exceto água/esgoto)
    "4291000",  # portos, obras marítimas e fluviais
    "4399105",  # poços de água
    "4311801",  # demolição
}
# Se a obra marcou muitos CNAEs ("marcou tudo"), o CNAE não diz nada — vale o nome.
CNAES_MAX_CONFIAVEL = 8

# Palavras no nome da obra que indicam infraestrutura (sem acento, maiúsculas).
# FORTES: excluem sempre (o nome descreve o serviço).
_INFRA_FORTE = [
    r"PAVIMENTAC", r"PAVIMENTAR", r"ASFALT", r"RECAPE", r"VICINA", r"VIADUTO", r"DRENAGEM",
    r"\bPONTES? (DE|EM|DO|DA|SOBRE|MISTA|RURA)", r"CONSTRUCAO D[AE] PONTE", r"RECONSTRUCAO D[AE] \d* ?PONTE",
    r"ABASTECIMENTO DE AGUA", r"ADUTORA", r"REDES? DE (ESGOTO|AGUA)", r"ESGOTAMENTO",
    r"\bORLA\b", r"\bPRACA\b", r"\bCANA(L|IS)\b", r"URBANIZA", r"LOTEAMENTO", r"SINALIZA",
    r"MEIO.?FIO", r"CALCAD", r"CALCAMENTO", r"LINHA DE TRANSMIS", r"REDES? (DE )?DISTRIBUI",
    r"REDES? ELETRICA", r"ILUMINACAO PUBLICA", r"TRAPICHE", r"PORTO (URBANO|FLUVIAL|PUBLICO)",
    r"TERMINAL HIDROV", r"HIDROVIA", r"POCOS? (ARTESIANO|TUBULAR|DE AGUA)", r"PERFURACAO DE POCO",
    r"BARRAGEM", r"\bATERRO\b", r"MURO DE (CONTENCAO|ARRIMO)", r"GASODUTO", r"ENROCAMENTO",
    r"DRAGAGEM", r"\bUFV\b", r"FOTOVOLTAIC", r"USINA SOLAR", r"MANUTENCAO DE VIAS", r"VIAS URBANAS",
    r"SUPRESSAO VEGETAL", r"TERRAPLENAGEM E DRENAGEM", r"SERVICOS? DE TERRAPL",
]
# FRACAS: só excluem se o nome não indicar uma edificação.
_INFRA_FRACA = [r"ESTRADA", r"RODOVIA", r"\bROD\b", r"\bBR.?\d{3}", r"\bPA.?\d{3}", r"TERRAPL",
                r"SANEAMENTO"]
_EDIFICACAO = [
    r"ESCOLA", r"\bE\.?M\.?E\.?I?\.?F", r"CRECHE", r"HOSPITAL", r"\bUBS\b", r"POSTO DE SAUDE", r"CLINICA",
    r"PREDIO", r"EDIFICIO", r"\bBLOCO", r"TERMINAL RODOVIARIO", r"GINASIO", r"QUADRA COBERTA", r"GALPAO",
    r"\bLOJA", r"RESIDENCIAL", r"HOTEL", r"SHOPPING", r"FACULDADE", r"UNIVERSIDADE", r"CAMPUS",
    r"IGREJA", r"TEMPLO", r"MERCADO", r"ARMAZEM", r"AGENCIA", r"\bSEDE\b", r"REFORMA D[AEO]",
]
# Nome que começa como endereço de rua costuma ser obra de pavimentação/drenagem
# (em Belém as ruas são "Passagem", "Travessa"...).
_COMECA_COMO_RUA = r"^(RUA|AVENIDA|AV\.|TRAVESSA|TV\.|PASSAGEM|PSG\.|ALAMEDA|RAMAL|VIELA|BECO)\s"
# Quando o "nome da obra" é só o nome da empresa, palavras como "Terraplenagem" ou
# "Pavimentação" descrevem a empresa, não a obra.
_NOME_DE_EMPRESA = r"\b(LTDA|EIRELI|EPP|SPE)\b|\bS/S\b|\bS[/.]?A\.?\s*$|\bME\s*$"

RE_INFRA_FORTE = re.compile("|".join(_INFRA_FORTE) + "|" + _COMECA_COMO_RUA)
RE_INFRA_FRACA = re.compile("|".join(_INFRA_FRACA))
RE_EDIFICACAO = re.compile("|".join(_EDIFICACAO))
RE_NOME_DE_EMPRESA = re.compile(_NOME_DE_EMPRESA)


def sem_acento(s: str | None) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).upper()


def motivo_infra(nome_obra: str | None, cnaes: list[str] | None) -> str | None:
    """Retorna o motivo de exclusão por infraestrutura, ou None se a obra interessa."""
    nome = sem_acento(nome_obra).strip()
    if nome and not RE_NOME_DE_EMPRESA.search(nome):
        m = RE_INFRA_FORTE.search(nome)
        if m:
            return f"nome contém '{m.group(0).strip()}'"
        m = RE_INFRA_FRACA.search(nome)
        if m and not RE_EDIFICACAO.search(nome):
            return f"nome contém '{m.group(0).strip()}'"
    cnaes = [c for c in (cnaes or []) if c]
    if cnaes and len(cnaes) <= CNAES_MAX_CONFIAVEL and set(cnaes) <= CNAES_INFRA:
        return "só CNAE de infraestrutura"
    return None


# ---------------------------------------------------------------- fases da obra
# Duração típica (meses) por destinação e área. Estimativa inicial — calibrar com a prática.
def duracao_meses(destinacao: str | None, area: float | None, categoria: str | None) -> float:
    a = area or 0
    d = destinacao or ""
    if d == "Galpão industrial":
        m = 6 if a < 2_000 else 9 if a < 10_000 else 12
    elif d == "Comercial salas e lojas":
        m = 10 if a < 2_000 else 14 if a < 5_000 else 20 if a < 15_000 else 26
    elif d == "Residencial multifamiliar":
        m = 14 if a < 2_000 else 20 if a < 5_000 else 28 if a < 15_000 else 36
    elif d == "Residencial unifamiliar":
        m = 12 if a < 2_000 else 18
    elif d in ("Conjunto habitacional popular", "Casa popular"):
        m = 14 if a < 5_000 else 20 if a < 20_000 else 26
    elif d == "Edifício de Garagens":
        m = 12 if a < 5_000 else 18
    else:
        m = 12
    if categoria == "Reforma":
        m *= 0.6
    elif categoria == "Acréscimo":
        m *= 0.8
    return m


# Fases pela % do prazo decorrido
FASES = [
    (15, "Início / fundação"),
    (45, "Estrutura"),
    (70, "Alvenaria e instalações"),
    (95, "Acabamento"),
    (115, "Finalização"),
    (10_000, "Provavelmente concluída"),
]

# Janela de cada linha de produto, em % do prazo. Antes de qualquer janela, vale
# apresentar a representação e tentar entrar na especificação (memorial descritivo).
JANELAS = {
    "Apresentação / especificação": (0, 30),
    "Cabos elétricos": (30, 65),
    "Pisos e revestimentos": (50, 85),
    "ASSA ABLOY": (70, 100),
}


def fase(pct: float | None) -> str:
    if pct is None:
        return "Sem data"
    for limite, nome in FASES:
        if pct < limite:
            return nome
    return FASES[-1][1]


def janelas_abertas(pct: float | None) -> list[str]:
    if pct is None:
        return []
    return [nome for nome, (ini, fim) in JANELAS.items() if ini <= pct < fim]
