#!/usr/bin/env python3
"""Gera os arquivos da marca Radar de Obras (SVG com texto em curvas).

Uso:
    python marca/gerar_marca.py <pasta_com_fontes_Sora> <pasta_saida>

Precisa de: fonttools, uharfbuzz. Fonte: Sora (Google Fonts, licença OFL),
arquivos Sora-Regular.ttf / Sora-Bold.ttf ou os .ttf baixados do Google Fonts.
"""
from __future__ import annotations

import os
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# ------------------------------------------------------------------ cores da marca
OURO = "#E9A93C"            # cor da marca (fundo do ícone, botão principal)
OURO_CLARO = "#FDF3DF"      # fundos suaves (item selecionado)
OURO_TEXTO = "#8A5A00"      # ouro escuro para texto e links sobre branco
MARINHO = "#161C2D"         # azul-marinho quase preto (traço do ícone, texto)
BRANCO = "#FFFFFF"          # texto da marca sobre fundo marinho
FUNDO_ESCURO = MARINHO


def icone_svg(tamanho: int = 512, fundo: str = OURO, tinta: str = MARINHO, canto: float = 116,
              x0: float = 0, y0: float = 0, so_desenho: bool = False) -> str:
    """Ícone: tela de radar com o ponteiro varrendo e um bloco (a obra) recém-detectado.

    Desenhado numa grade de 512; `tamanho` escala tudo.
    """
    import math

    k = tamanho / 512
    cx = cy = 256
    R = 178                     # aro externo
    r_int = 86                  # anel interno
    sw = 28                     # espessura do aro

    def ponto(ang: float, r: float) -> tuple[float, float]:
        a = math.radians(ang)   # 0° = direita, sentido horário (eixo y do SVG para baixo)
        return cx + r * math.cos(a), cy + r * math.sin(a)

    ponteiro, rastro = -35, 95  # ponteiro a -35°; rastro de 95° atrás dele (anti-horário)
    rr = R - sw / 2
    x1, y1 = ponto(ponteiro - rastro, rr)
    x2, y2 = ponto(ponteiro, rr)
    bx, by = ponto(ponteiro - 42, 128)  # a obra, entre os anéis, logo atrás do ponteiro
    lado = 44

    partes = []
    if not so_desenho:
        partes.append(f'<rect width="512" height="512" rx="{canto}" fill="{fundo}"/>')
    partes += [
        # rastro da varredura
        f'<path d="M {cx} {cy} L {x1:.1f} {y1:.1f} A {rr} {rr} 0 0 1 {x2:.1f} {y2:.1f} Z" '
        f'fill="{tinta}" fill-opacity="0.3"/>',
        # anéis
        f'<circle cx="{cx}" cy="{cy}" r="{r_int}" fill="none" stroke="{tinta}" stroke-width="16"/>',
        f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" stroke="{tinta}" stroke-width="{sw}"/>',
        # ponteiro e centro
        f'<path d="M {cx} {cy} L {x2:.1f} {y2:.1f}" stroke="{tinta}" stroke-width="18" stroke-linecap="round"/>',
        f'<circle cx="{cx}" cy="{cy}" r="24" fill="{tinta}"/>',
        # a obra
        f'<rect x="{bx - lado / 2:.1f}" y="{by - lado / 2:.1f}" width="{lado}" height="{lado}" rx="9" fill="{tinta}"/>',
    ]
    return (f'<g transform="translate({x0} {y0}) scale({k:.5f})">' + "".join(partes) + "</g>")


class Texto:
    def __init__(self, caminho_ttf: str):
        self.tt = TTFont(caminho_ttf)
        self.glyphset = self.tt.getGlyphSet()
        self.ordem = self.tt.getGlyphOrder()
        self.upem = self.tt["head"].unitsPerEm
        self.xh = getattr(self.tt["OS/2"], "sxHeight", 0) or 0.5 * self.upem
        blob = hb.Blob.from_file_path(caminho_ttf)
        self.hbfont = hb.Font(hb.Face(blob))

    def caminho(self, texto: str, tam: float, x: float, base: float, espaco: float = 0) -> tuple[str, float]:
        """Retorna (path d, largura) do texto em curvas, com kerning (HarfBuzz)."""
        buf = hb.Buffer()
        buf.add_str(texto)
        buf.guess_segment_properties()
        hb.shape(self.hbfont, buf, {"kern": True, "liga": True})
        s = tam / self.upem
        ds, cx = [], x
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            nome = self.ordem[info.codepoint]
            pen = SVGPathPen(self.glyphset)
            self.glyphset[nome].draw(TransformPen(pen, (s, 0, 0, -s, cx + pos.x_offset * s, base - pos.y_offset * s)))
            if pen.getCommands():
                ds.append(pen.getCommands())
            cx += pos.x_advance * s + espaco
        return " ".join(ds), cx - x - espaco


def logo_svg(bold: Texto, regular: Texto, cor_texto: str, altura: int = 128, fundo: str | None = None,
             cor_icone: str = OURO, tinta_icone: str = MARINHO) -> tuple[str, float, float]:
    tam = altura * 0.56
    pad = altura * 0.22 if fundo else 0
    xt = pad + altura + altura * 0.26
    cy = pad + altura / 2
    base = cy + bold.xh * tam / bold.upem / 2      # centraliza a altura-x no ícone
    d1, w1 = bold.caminho("radar", tam, xt, base, espaco=-tam * 0.01)
    d2, w2 = regular.caminho("de obras", tam, xt + w1 + tam * 0.24, base)
    largura = xt + w1 + tam * 0.24 + w2 + pad
    alt_total = altura + 2 * pad
    corpo = []
    if fundo:
        corpo.append(f'<rect width="{largura:.1f}" height="{alt_total:.1f}" fill="{fundo}"/>')
    corpo.append(icone_svg(altura, fundo=cor_icone, tinta=tinta_icone, x0=pad, y0=pad))
    corpo.append(f'<path d="{d1}" fill="{cor_texto}"/><path d="{d2}" fill="{cor_texto}"/>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largura:.1f} {alt_total:.1f}" '
           f'width="{largura:.0f}" height="{alt_total:.0f}" role="img" aria-label="Radar de Obras">'
           + "".join(corpo) + "</svg>")
    return svg, largura, alt_total


def achar_fonte(pasta: str, peso: int) -> str:
    nomes = {400: ["Sora-Regular.ttf", "xMQOuFFYT72X5wkB_18qmnndmSdSnn-K.ttf"],
             700: ["Sora-Bold.ttf", "xMQOuFFYT72X5wkB_18qmnndmSe1mX-K.ttf"]}[peso]
    for n in nomes:
        p = os.path.join(pasta, n)
        if os.path.exists(p):
            return p
    raise SystemExit(f"Fonte Sora {peso} não encontrada em {pasta}")


def main() -> int:
    fontes, saida = sys.argv[1], sys.argv[2]
    os.makedirs(saida, exist_ok=True)
    bold, regular = Texto(achar_fonte(fontes, 700)), Texto(achar_fonte(fontes, 400))

    def salvar(nome: str, conteudo: str) -> None:
        with open(os.path.join(saida, nome), "w", encoding="utf-8") as f:
            f.write(conteudo)
        print("escrito", nome)

    salvar("icone.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" '
                        'role="img" aria-label="Radar de Obras">' + icone_svg() + "</svg>")
    salvar("icone-escuro.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" '
                               'role="img" aria-label="Radar de Obras">'
                               + icone_svg(fundo=MARINHO, tinta=OURO) + "</svg>")
    salvar("logo.svg", logo_svg(bold, regular, MARINHO)[0])
    salvar("logo-fundo-escuro.svg", logo_svg(bold, regular, BRANCO)[0])
    salvar("logo-com-fundo.svg", logo_svg(bold, regular, MARINHO, fundo="#FFFFFF")[0])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
