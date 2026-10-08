#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) do funil de VENDAS da MCTV a partir de
UMA aba publica do Google Sheets (somente leitura):

  - "MCTV | ACOMPANHAMENTO GERAL | LOOKER", aba "Financeiro": uma linha por DIA
    com o investimento no Meta Ads, o faturamento (bruto e liquido), o lucro, as
    vendas e checkouts e o trafego (cliques, CTR, cliques no link, visualizacoes
    da pagina de destino).

So esta aba e lida (pedido do gestor em 08/10/2026). A aba Criativos (anuncio x
dia) NAO entra mais: a dash nao tem quebra por campanha/conjunto/anuncio nem
metricas de video.

FUNIL DESTA CONTA:
    Gasto -> Impressoes -> Cliques -> Cliques no link -> Visualizacoes da pagina
          -> Checkouts -> Vendas -> Faturamento bruto -> Faturamento liquido -> Lucro
com CPM · CTR · CPC · Connect Rate · Custo/Checkout · CPA · ROAS · Ticket medio.

Colunas derivadas (a planilha nao traz a contagem pronta):
  - Impressoes = Cliques / CTR (o CTR da aba e Cliques / Impressoes em %). Bate
    com as impressoes da aba Criativos do mesmo dia (ex.: 04/08: 64 / 6,63% = 965).
  - ROAS, CPA, CPC, CTR, Connect Rate e Lucro sao RECALCULADOS no navegador a
    partir das contagens (somar as taxas de cada dia daria um numero errado no
    periodo, e o imposto precisa entrar no gasto). O "Lucro Real" da planilha e
    Faturamento Liquido - Investimento SEM imposto; a dash usa o gasto COM
    imposto quando o toggle esta ligado.

NAO EXISTE NESTA FONTE: anuncio/campanha/conjunto, alcance, frequencia, video,
lista de leads, MQL.

Este script apenas LE a planilha (CSV publico) e emite os REGISTROS BRUTOS
(fin[], um por dia) dentro do HTML. Todos os filtros, agregacoes, KPIs, tabelas
e graficos sao calculados no navegador (client-side). Nunca escreve nada de volta.

Teste local: --financeiro-file apontando para um CSV baixado.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

# Planilha "MCTV | ACOMPANHAMENTO GERAL | LOOKER", aba "Financeiro".
SPREADSHEET_ID = "1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY"
SHEET_FINANCEIRO = "Financeiro"
# Leitura pelo NOME da aba (gviz). headers=1 -> a 1a linha vira cabecalho (com
# headers=0 o gviz apaga o texto do cabecalho das colunas numericas). Cuidado: se
# a aba for renomeada, o gviz devolve a PRIMEIRA aba da planilha sem erro — por
# isso process() exige o cabecalho da Financeiro antes de aceitar as linhas.
GVIZ_URL = "https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&headers=1&sheet={sheet}"

# Identificação do cliente/conta (usada só em textos — não afeta os números).
CLIENT_NAME = "MCTV"
MAIN_PRODUCT = "Funil de Vendas"

ACCOUNT_TZ_NAME = "America/Sao_Paulo"  # "hoje" da dash (o dia da planilha entra como esta)
try:
    from zoneinfo import ZoneInfo
    ACCOUNT_TZ = ZoneInfo(ACCOUNT_TZ_NAME)
except Exception:
    ACCOUNT_TZ = timezone(timedelta(hours=-3))

BRT = timezone(timedelta(hours=-3))   # horario de Brasilia (so p/ o carimbo "ultima atualizacao")
TAX_FACTOR = 1.13806   # fator de imposto/taxa sobre o gasto de mídia paga (Meta Ads) = 13,806%.
                       # A coluna "Total Investido Ads" vem SEM imposto (bate com o gasto da
                       # aba Criativos). O toggle "Imposto Meta" ja vem LIGADO (app.js
                       # STATE.tax=true): gasto, CPM, CPC, CPA, ROAS e Lucro ja saem com o
                       # imposto aplicado. Faturamento (bruto e liquido) nunca leva imposto.

# --------------------------------------------------------------------------- #
# Metas & parâmetros da conta (DEFAULTS do painel editável da aba Relatório)
# --------------------------------------------------------------------------- #
# None = "meta não definida" (métrica aparece sem cor até o gestor preencher).
META_CPA = None            # meta de CPA (R$/venda)
META_ROAS = None           # ROAS mínimo desejado (faturamento bruto ÷ gasto)
VOLUME_MIN_AMOSTRAL = 2    # vendas mínimas para julgar CPA/ROAS de uma semana


# --------------------------------------------------------------------------- #
# Leitura
# --------------------------------------------------------------------------- #
FETCH_RETRIES = 3
FETCH_RETRY_DELAY = 15


def fetch_csv(url: str) -> list[list[str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "dash-mctv-bot/1.0"})
    last_err: Exception | None = None
    for attempt in range(1, FETCH_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            # planilha que deixou de ser pública redireciona para o login do
            # Google com HTTP 200: isso é HTML, não CSV
            if raw.lstrip()[:1] == "<":
                raise ValueError(f"resposta em HTML, não CSV: {url}")
            return list(csv.reader(io.StringIO(raw)))
        except urllib.error.HTTPError:
            raise                       # 401/404 nao melhoram tentando de novo
        except (TimeoutError, urllib.error.URLError) as exc:
            last_err = exc
            if attempt < FETCH_RETRIES:
                print(f"[fetch_csv] tentativa {attempt}/{FETCH_RETRIES} falhou ({exc!r}); "
                      f"tentando de novo em {FETCH_RETRY_DELAY}s...", file=sys.stderr)
                time.sleep(FETCH_RETRY_DELAY)
    raise last_err


def fetch_sheet(sid: str, sheet: str) -> list[list[str]]:
    return fetch_csv(GVIZ_URL.format(sid=sid, sheet=urllib.parse.quote(sheet)))


def read_csv_file(path: str) -> list[list[str]]:
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.reader(f))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(s: str | None) -> str:
    return strip_accents((s or "").strip().lower())


def to_float(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v).strip())
    if not s:
        return 0.0
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def to_count(v) -> float:
    """Contagens e valores em R$. Se alguém tirar as casas decimais da coluna na
    planilha, o export passa a mostrar "1.294" (pt-BR: ponto = milhar), que o
    to_float leria como 1,294. Só para estas colunas — numa taxa como o CTR um
    "6.125" sem vírgula pode ser decimal de verdade."""
    s = re.sub(r"[^\d,.\-]", "", str(v if v is not None else "").strip())
    if "," not in s and re.fullmatch(r"-?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    return to_float(s)


def parse_date(v: str) -> str | None:
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    s = s.split()[0]
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%b %d, %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def header_index(header, wanted):
    """Acha cada coluna pelo nome do cabeçalho: primeiro nome exato, depois
    "contém". Coluna ausente fica None (nunca cai numa posição fixa: com a aba
    errada isso leria outra métrica no lugar)."""
    idx = {}
    hn = [norm(h) for h in header]
    for key, aliases in wanted.items():
        found = None
        for a in aliases:
            a = norm(a)
            if a in hn:
                found = hn.index(a)
                break
        if found is None:
            for a in aliases:
                a = norm(a)
                found = next((i for i, h in enumerate(hn) if a and a in h), None)
                if found is not None:
                    break
        idx[key] = found
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos (1 por dia)
# --------------------------------------------------------------------------- #
COLS = {
    "day": ["data", "dia", "day"],
    "spent": ["total investido ads", "total investido", "investimento", "gasto", "amount spent"],
    "fb": ["faturamento bruto"],
    "fl": ["faturamento liquido"],
    "lucro": ["lucro real", "lucro"],
    "vendas": ["vendas", "purchases"],
    "checkouts": ["checkouts", "checkout"],
    "clicks": ["cliques", "clicks"],
    "ctr": ["ctr"],
    "link_clicks": ["link clicks", "cliques no link"],
    "lpv": ["landing page views", "visualizacoes da pagina de destino", "visualizacoes da pagina"],
}
# sem estas colunas a aba não é a Financeiro (ou mudou demais): o build para em
# vez de publicar números de outra aba
OBRIGATORIAS = ("day", "spent", "fb", "vendas")


def process(rows):
    header = rows[0] if rows else []
    ix = header_index(header, COLS)
    faltando = [k for k in OBRIGATORIAS if ix.get(k) is None]
    if faltando:
        raise SystemExit(f"A aba {SHEET_FINANCEIRO} não foi encontrada ou mudou de formato: "
                         f"faltam as colunas {faltando}. Cabeçalho lido: {header[:8]}")
    # "Cliques" (todos os cliques) não pode cair em "Link Clicks"/"Cliques no link"
    if ix["clicks"] is not None and ix["clicks"] == ix["link_clicks"]:
        ix["clicks"] = None

    fin = []
    por_dia = {}
    sem_data = 0
    duplicadas = 0
    lucro_diverge = []
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        day = parse_date(cell(row, ix["day"]))
        if not day:
            if any(cell(row, ix[k]) for k in ("spent", "fb", "vendas")):
                sem_data += 1
            continue
        sp = to_count(cell(row, ix["spent"]))
        fl = to_count(cell(row, ix["fl"]))
        cl = to_count(cell(row, ix["clicks"]))
        ctr = to_float(cell(row, ix["ctr"]))
        rec = {
            "d": day,
            "sp": round(sp, 2),
            "fb": round(to_count(cell(row, ix["fb"])), 2),
            "fl": round(fl, 2),
            "vd": to_count(cell(row, ix["vendas"])),
            "ck": to_count(cell(row, ix["checkouts"])),
            "cl": cl,
            # impressões: o CTR da aba é Cliques ÷ Impressões (em %)
            "im": float(round(cl * 100.0 / ctr)) if ctr > 0 and cl > 0 else 0.0,
            "lc": to_count(cell(row, ix["link_clicks"])),
            "lpv": to_count(cell(row, ix["lpv"])),
        }
        # Conferência: o Lucro Real da aba é Faturamento Líquido − Investimento
        # (sem imposto). A dash recalcula; aqui só avisa se a fórmula mudar.
        lucro_txt = cell(row, ix["lucro"])
        if lucro_txt and abs(to_count(lucro_txt) - (fl - sp)) > 0.02:
            lucro_diverge.append(day)
        # um dia por linha: dia repetido não pode somar duas vezes, fica o último
        if day in por_dia:
            fin[por_dia[day]] = rec
            duplicadas += 1
            continue
        por_dia[day] = len(fin)
        fin.append(rec)

    fin.sort(key=lambda r: r["d"])
    dates = [r["d"] for r in fin]
    now_brt = datetime.now(BRT)
    hoje_conta = datetime.now(ACCOUNT_TZ)
    return {
        "build": {
            "generated_at_brt": now_brt.strftime("%d/%m/%Y %H:%M"),
            "build_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
            "today": hoje_conta.strftime("%Y-%m-%d"),
            "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
            "tax_factor": TAX_FACTOR,
            "client_name": CLIENT_NAME,
            "main_product": MAIN_PRODUCT,
            "meta_cpa": META_CPA,
            "meta_roas": META_ROAS,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "tem_trafego": ix["link_clicks"] is not None and ix["lpv"] is not None,
            "linhas_descartadas": {"sem_data": sem_data, "duplicadas": duplicadas},
            "lucro_diverge": lucro_diverge,
        },
        "fin": fin,
    }


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #
def render(data, template_path):
    # A dashboard e montada a partir de arquivos separados (visual x logica):
    #   template.html          -> esqueleto HTML (placeholders __STYLES__/__APP_JS__)
    #   identidade-visual.css  -> TODAS as cores (edite aqui p/ mexer so em cor)
    #   estilos.css            -> layout/componentes
    #   app.js                 -> logica + renderizacao
    # Esta funcao so COSTURA os arquivos e injeta os dados; nao altera nada deles.
    base = os.path.dirname(os.path.abspath(template_path))

    def readf(name):
        with open(os.path.join(base, name), "r", encoding="utf-8") as f:
            return f.read()

    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    styles = readf("identidade-visual.css") + "\n" + readf("estilos.css")
    tpl = tpl.replace("__STYLES__", styles)
    tpl = tpl.replace("__APP_JS__", readf("app.js"))
    # "</" escapado: um texto da planilha com "</script>" não fecha o bloco de dados
    tpl = tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--financeiro-file", help="CSV local da aba Financeiro (teste)")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    rows = (read_csv_file(args.financeiro_file) if args.financeiro_file
            else fetch_sheet(SPREADSHEET_ID, SHEET_FINANCEIRO))
    data = process(rows)
    if not data["fin"]:
        # aba vazia ou sem nenhuma data válida: falhar aqui faz o Actions parar
        # antes de publicar e o Pages segue com a última versão boa
        raise SystemExit(f"ERRO: a aba {SHEET_FINANCEIRO} veio sem nenhuma linha válida; "
                         "abortando para não publicar uma dash zerada")

    html = render(data, args.template)      # antes de abrir o arquivo: erro aqui não deixa index.html vazio
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    b = data["build"]
    d = b["linhas_descartadas"]
    m = data["fin"]
    sp = sum(r["sp"] for r in m)
    fl = sum(r["fl"] for r in m)
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo    : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    print(f"  dias       : {len(m)} · descartadas: {d['sem_data']} sem data · "
          f"{d['duplicadas']} dias repetidos", file=sys.stderr)
    print(f"  gasto      : R$ {sp:,.2f} (sem imposto; fator {TAX_FACTOR})", file=sys.stderr)
    print(f"  trafego    : impressoes {sum(r['im'] for r in m):,.0f} · cliques {sum(r['cl'] for r in m):,.0f} · "
          f"no link {sum(r['lc'] for r in m):,.0f} · visualizacoes {sum(r['lpv'] for r in m):,.0f}",
          file=sys.stderr)
    print(f"  vendas     : checkouts {sum(r['ck'] for r in m):,.0f} · vendas {sum(r['vd'] for r in m):,.0f} · "
          f"bruto R$ {sum(r['fb'] for r in m):,.2f} · liquido R$ {fl:,.2f}", file=sys.stderr)
    print(f"  lucro      : R$ {fl - sp:,.2f} sem imposto · R$ {fl - sp * TAX_FACTOR:,.2f} com imposto",
          file=sys.stderr)
    if b["lucro_diverge"]:
        print(f"  AVISO: Lucro Real da planilha != Fat. Liquido - Investido em "
              f"{len(b['lucro_diverge'])} dia(s): {', '.join(b['lucro_diverge'][:10])}", file=sys.stderr)
    if not b["tem_trafego"]:
        print("  AVISO: colunas Link Clicks / Landing Page Views ausentes; Connect Rate fica '-'",
              file=sys.stderr)
    print(f"  out        : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
