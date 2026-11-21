"""Testes das regras de prospecção com nomes reais de obras do CNO (PA).

Rodar: python -m pytest pipeline/test_regras.py   (ou: python pipeline/test_regras.py)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import regras as R  # noqa: E402

EXCLUIR = [
    "RECAPEAMENTO ASFALTICO EM CBUQ - PARAGOMINAS PA",
    "OBRA DE CONSTRUCAO E PAVIMENTACAO ROD PA322",
    "PAVIMENTAÇÃO COND MIRANTE DO VALE",
    "REFORMA DA PRAÇA MATRIZ, ANANINDEUA-PA",
    "UFV IPIXUNA",
    "Construção da Ponte do Bacaba",
    "RECONSTRUÇÃO DE 06 PONTES EM CONCRETO RURAL PARAUAPEBAS -PA",
    "PASSAGEM ANA DANTAS",
    "RUA IPÊ AMARELO - CANAÃ DOS CARAJÁS",
    "Supressão Vegetal e Terraplenagem Nassau Contrato",
    "SECRETARIA MUNICIPAL DE SANEAMENTO-Recuperação de Canais e G",
    "OBRAS DE RECUPERACAO DE VICINAIS NO MUNICIPIO",
    "EXECUÇÃO DOS SERVIÇOS DE TERRAPLENAGEM E DRENAGEM NO TERRENO",
    "NGTM - CONSORCIO PCB VIADUTO JOAO PAULO II",
    "SANEAMENTO BACARENA CONTRATO 006,069 E 071",
]
MANTER = [
    "OBRA CONSTRUÇÃO DO PRÉDIO DE 4 PAVIMENTOS DA FACULDADE DE ME",
    "ADEQUAÇÃO DO SEGUNDO PAVIMENTO DO BLOCO MODULAR UFOPA",
    "TAVARES ENGENHARIA E PAVIMENTACAO - ENGYPAV LTDA",
    "CONCRETIZAR CONSTRUTORA E TERRAPLENAGEM LTDA",
    "M DE SOUSA PONTES LTDA",
    "R. C. DE CARVALHO CARNEIRO LTDA",
    "ADEQUACOES DE ACESSIBILIDADE BB CAPITAO POCO - PA",
    "TERMINAL RODOVIARIO DE REDENÇÃO",
    "Reforma na EMEF NOVO TAUARI, Localizada na estrada do ICUI-G",
    "CONSTRUÇÃO DE QUADRA COBERTA - RODOVIA PATAL/ARAÍ",
    "TEXAS CONSTRUCOES E SANEAMENTO LTDA",
    "PORTAL TERRAPLENAGEM E CONSTRUCAO LTDA OBRA DA SESAU",
    "RESIDENCIAL VIA PARK",
    "CRECHE DE INHANGAPI",
]


def test_excluir_infraestrutura():
    for nome in EXCLUIR:
        assert R.motivo_infra(nome, ["4120400"]), nome


def test_manter_edificacoes():
    for nome in MANTER:
        assert R.motivo_infra(nome, ["4120400"]) is None, nome


def test_cnae():
    assert R.motivo_infra("CONSTRUTORA X LTDA", ["4211101"]) == "só CNAE de infraestrutura"
    assert R.motivo_infra("CONSTRUTORA X LTDA", ["4211101", "4120400"]) is None
    todos = sorted(R.CNAES_INFRA)  # marcou tudo: CNAE não é confiável
    assert R.motivo_infra("CONSTRUTORA X LTDA", todos) is None


def test_fases():
    assert R.fase(10) == "Início / fundação"
    assert R.fase(80) == "Acabamento"
    assert R.janelas_abertas(60) == ["Vibra", "Mohawk", "Lorenzetti"]
    assert R.janelas_abertas(90) == ["Lorenzetti", "Assa Abloy"]
    assert R.duracao_meses("Galpão industrial", 1500, "Obra Nova") == 6


if __name__ == "__main__":
    test_excluir_infraestrutura()
    test_manter_edificacoes()
    test_cnae()
    test_fases()
    print("ok")
