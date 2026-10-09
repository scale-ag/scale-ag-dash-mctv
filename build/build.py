#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) do funil de VENDAS da MCTV a partir de
DUAS planilhas publicas do Google Sheets (somente leitura):

  1. QUERIES do gerenciador (Meta Ads), "Manhattan" — uma linha por
     DIA x CAMPANHA x CONJUNTO x ANUNCIO: gasto, impressoes, cliques no link,
     visualizacoes da pagina de destino, checkouts iniciados (Initiate
     Checkout), compras e valor das compras. E a fonte de TODA a midia e das
     conversoes, e a unica com a quebra por campanha/conjunto/anuncio.
  2. "MCTV | ACOMPANHAMENTO GERAL | LOOKER", aba "Financeiro" — uma linha por
     DIA. Dela so entram o que as queries nao tem: Faturamento LIQUIDO (para o
     Lucro) e os Cliques (todos os cliques, nao so no link). Os dois so existem
     por dia, entao com filtro de campanha/conjunto/anuncio ficam "-".

As duas batem dia a dia (gasto, compras, faturamento bruto, checkouts, visitas,
cliques no link): a Financeiro e o resumo diario das mesmas queries. O build
compara as duas e avisa no log se divergirem (conferencia_dias).

FUNIL DESTA CONTA:
    Gasto -> Impressoes -> Cliques -> Cliques no link -> Visualizacoes da pagina
          -> Initiate Checkout -> Vendas -> Faturamento bruto -> Faturamento liquido -> Lucro
com CPM · CTR · CPC · Connect Rate · Custo/IC · Pagina->IC · IC->Venda · CPA ·
ROAS · Ticket medio.

ROAS, CPA, CTR, Connect Rate, taxas do checkout e Lucro sao RECALCULADOS no
navegador a partir das contagens (somar taxas de cada linha daria um numero
errado, e o imposto precisa entrar no gasto). O "Lucro Real" da planilha e
Faturamento Liquido - Investimento SEM imposto; a dash usa o gasto COM imposto
quando o toggle esta ligado.

NAO EXISTE NESTAS FONTES: alcance deduplicado (a coluna Reach das queries e por
linha; somar alcance nao da alcance, entao nao e lida), video, lista de leads, MQL.

Este script apenas LE as planilhas (CSV publico) e emite os REGISTROS BRUTOS
(meta[] = anuncio x dia, fin[] = dia) dentro do HTML. Todos os filtros,
agregacoes, KPIs, tabelas e graficos sao calculados no navegador. Nunca escreve
nada de volta.

Teste local: --queries-file e --financeiro-file apontando para CSVs baixados.
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

# Planilha de QUERIES do gerenciador (Meta Ads) — anúncio × dia. Enviada pelo
# gestor em 09/10/2026 ("Atualiza a planilha de queries do Manhatan").
SPREADSHEET_ID_QUERIES = "1ldYMpIPWZ5Dm4hD35TzE6aalXoz3k1sktK5hd2KAXAU"
GID_QUERIES = "0"
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
GVIZ_GID_URL = "https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&headers=1&gid={gid}"

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
                       # O "Amount Spent" das queries (= "Total Investido Ads" da Financeiro)
                       # vem SEM imposto. O toggle "Imposto Meta" ja vem LIGADO (app.js
                       # STATE.tax=true): gasto, CPM, CPC, CPA, ROAS e Lucro ja saem com o
                       # imposto aplicado. Faturamento (bruto e liquido) nunca leva imposto.

# --------------------------------------------------------------------------- #
# Metas & parâmetros da conta (DEFAULTS do painel editável da aba Relatório)
# --------------------------------------------------------------------------- #
# None = "meta não definida" (métrica aparece sem cor até o gestor preencher).
META_CPA = None            # meta de CPA (R$/venda)
META_ROAS = None           # ROAS mínimo desejado (faturamento bruto ÷ gasto)
VOLUME_MIN_AMOSTRAL = 2    # vendas mínimas para julgar CPA/ROAS de uma semana ou de um anúncio
META_CPIC = None           # meta de custo por Initiate Checkout (R$/IC)
SAMPLE_MIN_SPEND = 100     # gasto mínimo (R$, com imposto se ligado) p/ um anúncio sair de "Em observação"


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


def fetch_gid(sid: str, gid: str) -> list[list[str]]:
    """export?format=csv devolve os valores crus; se a planilha recusar o export
    (já aconteceu de dar 401 com a planilha pública), cai no gviz pelo gid."""
    try:
        return fetch_csv(EXPORT_URL.format(sid=sid, gid=gid))
    except (urllib.error.HTTPError, ValueError) as exc:
        print(f"[fetch_gid] export falhou ({exc!r}); tentando o gviz", file=sys.stderr)
        return fetch_csv(GVIZ_GID_URL.format(sid=sid, gid=gid))


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
# Aba Financeiro -> registros por dia
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
# (o Faturamento Líquido entra aqui porque sem ele o Lucro sairia = −gasto em
# todos os dias, um número errado e não um "-")
OBRIGATORIAS = ("day", "spent", "fb", "fl", "vendas")


def process_fin(rows):
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
    info = {
        "tem_trafego": ix["link_clicks"] is not None and ix["lpv"] is not None,
        "linhas_descartadas": {"sem_data": sem_data, "duplicadas": duplicadas},
        "lucro_diverge": lucro_diverge,
        # colunas opcionais que não vieram: a métrica que depende delas fica "-"
        "colunas_ausentes": [k for k in COLS if ix.get(k) is None],
    }
    return fin, info


# --------------------------------------------------------------------------- #
# Queries do gerenciador -> registros anúncio × dia
# --------------------------------------------------------------------------- #
QCOLS = {
    "day": ["day", "dia", "data", "date"],
    "camp": ["campaign name", "campanha", "nome da campanha"],
    "adset": ["ad set name", "conjunto", "nome do conjunto de anuncios"],
    "ad": ["ad name", "anuncio", "nome do anuncio"],
    "spent": ["amount spent", "valor usado", "gasto"],
    "im": ["impressions", "impressoes"],
    "lc": ["link clicks", "cliques no link"],
    "lpv": ["landing page views", "visualizacoes da pagina de destino"],
    "ic": ["checkouts initiated", "initiate checkout", "finalizacoes de compra iniciadas"],
    "vd": ["purchases", "compras"],
    "fb": ["purchases conversion value", "valor de conversao da compra", "purchase value"],
}
# sem estas a planilha não é a de queries (ou mudou demais): o build para e o
# Pages segue com a última versão boa. Todas as métricas entram: uma coluna
# renomeada (ex. "Purchases" -> "Website Purchases") publicaria 0 venda em vez
# de avisar.
QOBRIGATORIAS = ("day", "camp", "adset", "ad", "spent", "im", "lc", "lpv", "ic", "vd", "fb")
QNUM = ("spent", "im", "lc", "lpv", "ic", "vd", "fb")


def process_queries(rows):
    header = rows[0] if rows else []
    ix = header_index(header, QCOLS)
    # "Purchases" não pode cair em "Purchases Conversion Value" nem em "Cost per
    # Purchase" (o "contém" pegaria qualquer um): exige o nome exato
    hn = [norm(h) for h in header]
    for key, nomes in (("vd", ("purchases", "compras")),
                       ("ic", ("checkouts initiated", "initiate checkout",
                               "finalizacoes de compra iniciadas"))):
        ix[key] = next((hn.index(n) for n in nomes if n in hn), None)
    faltando = [k for k in QOBRIGATORIAS if ix.get(k) is None]
    if faltando:
        raise SystemExit(f"A planilha de queries mudou de formato: faltam as colunas {faltando}. "
                         f"Cabeçalho lido: {header[:8]}")

    meta = []
    sem_data = 0
    zeradas = 0
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        day = parse_date(cell(row, ix["day"]))
        if not day:
            if any(cell(row, ix[k]) for k in ("spent", "ic", "vd")):
                sem_data += 1
            continue
        vals = {k: to_count(cell(row, ix[k])) for k in QNUM}
        # linha sem nenhum número (anúncio parado naquele dia) não muda soma
        # nenhuma; fica de fora para o payload não crescer à toa
        if not any(vals.values()):
            zeradas += 1
            continue
        meta.append({
            "d": day,
            "c": cell(row, ix["camp"]) or "(sem campanha)",
            "s": cell(row, ix["adset"]) or "(sem conjunto)",
            "a": cell(row, ix["ad"]) or "(sem anúncio)",
            "sp": round(vals["spent"], 2),
            "im": vals["im"], "lc": vals["lc"], "lpv": vals["lpv"],
            "ic": vals["ic"], "vd": vals["vd"], "fb": round(vals["fb"], 2),
        })
    meta.sort(key=lambda r: (r["d"], r["c"], r["s"], r["a"]))
    info = {
        "linhas_descartadas": {"sem_data": sem_data, "zeradas": zeradas},
        "colunas_ausentes": [k for k in QCOLS if ix.get(k) is None],
    }
    return meta, info


def conferencia_dias(fin, meta):
    """As duas planilhas devem bater dia a dia (a Financeiro resume as mesmas
    queries). Devolve os dias em que não batem, para o log — a dash usa as
    queries para mídia/conversões e a Financeiro só para líquido e cliques."""
    q = {}
    for r in meta:
        a = q.setdefault(r["d"], {"sp": 0.0, "fb": 0.0, "vd": 0.0, "ic": 0.0, "lc": 0.0, "lpv": 0.0})
        for k in a:
            a[k] += r[k]
    pares = (("sp", "sp", 0.05), ("fb", "fb", 0.05), ("vd", "vd", 0), ("ck", "ic", 0),
             ("lc", "lc", 0), ("lpv", "lpv", 0))
    out = []
    for f in fin:
        a = q.get(f["d"], {"sp": 0.0, "fb": 0.0, "vd": 0.0, "ic": 0.0, "lc": 0.0, "lpv": 0.0})
        dif = [f"{kq} {f[kf]:g}≠{a[kq]:g}" for kf, kq, tol in pares if abs(f[kf] - a[kq]) > tol + 1e-9]
        if dif:
            out.append(f"{f['d']}: " + ", ".join(dif))
    dias_fin = {f["d"] for f in fin}
    for d in sorted(set(q) - dias_fin):
        if q[d]["sp"] or q[d]["vd"] or q[d]["fb"]:
            out.append(f"{d}: só nas queries (gasto {q[d]['sp']:g})")
    return out


def build_payload(fin, fin_info, meta, q_info):
    dates = sorted({r["d"] for r in fin} | {r["d"] for r in meta})
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
            "meta_cpic": META_CPIC,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "sample_min_spend": SAMPLE_MIN_SPEND,
            "tem_trafego": fin_info["tem_trafego"],
            "tem_cliques": "clicks" not in fin_info["colunas_ausentes"],
            "linhas_descartadas": fin_info["linhas_descartadas"],
            "linhas_descartadas_queries": q_info["linhas_descartadas"],
            "lucro_diverge": fin_info["lucro_diverge"],
            "colunas_ausentes": fin_info["colunas_ausentes"],
            "colunas_ausentes_queries": q_info["colunas_ausentes"],
            "conferencia": conferencia_dias(fin, meta),
        },
        # o navegador só usa da Financeiro o que as queries não têm
        "fin": [{"d": r["d"], "fl": r["fl"], "cl": r["cl"]} for r in fin],
        "meta": meta,
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
    # todo "<" vira \u003c (continua JSON válido): um nome de anúncio com
    # "</script>" ou "<!--<script" não fecha nem engole o bloco de dados
    tpl = tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False).replace("<", "\\u003c"))
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries-file", help="CSV local da planilha de queries (teste)")
    ap.add_argument("--financeiro-file", help="CSV local da aba Financeiro (teste)")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    q_rows = (read_csv_file(args.queries_file) if args.queries_file
              else fetch_gid(SPREADSHEET_ID_QUERIES, GID_QUERIES))
    f_rows = (read_csv_file(args.financeiro_file) if args.financeiro_file
              else fetch_sheet(SPREADSHEET_ID, SHEET_FINANCEIRO))
    meta, q_info = process_queries(q_rows)
    fin, fin_info = process_fin(f_rows)
    # planilha vazia ou sem nenhuma data válida: falhar aqui faz o Actions parar
    # antes de publicar e o Pages segue com a última versão boa
    if not meta:
        raise SystemExit("ERRO: a planilha de queries veio sem nenhuma linha válida; "
                         "abortando para não publicar uma dash zerada")
    if not fin:
        raise SystemExit(f"ERRO: a aba {SHEET_FINANCEIRO} veio sem nenhuma linha válida; "
                         "abortando para não publicar uma dash sem faturamento líquido")
    data = build_payload(fin, fin_info, meta, q_info)

    html = render(data, args.template)      # antes de abrir o arquivo: erro aqui não deixa index.html vazio
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    b = data["build"]
    d = b["linhas_descartadas"]
    dq = b["linhas_descartadas_queries"]
    sp = sum(r["sp"] for r in meta)
    fl = sum(r["fl"] for r in fin)
    soma = lambda k: sum(r[k] for r in meta)
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo    : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    print(f"  queries    : {len(meta)} linhas anuncio x dia · {len({r['c'] for r in meta})} campanhas · "
          f"{len({r['s'] for r in meta})} conjuntos · {len({r['a'] for r in meta})} anuncios · "
          f"descartadas: {dq['sem_data']} sem data, {dq['zeradas']} zeradas", file=sys.stderr)
    print(f"  financeiro : {len(fin)} dias · descartadas: {d['sem_data']} sem data · "
          f"{d['duplicadas']} dias repetidos", file=sys.stderr)
    print(f"  gasto      : R$ {sp:,.2f} (sem imposto; fator {TAX_FACTOR})", file=sys.stderr)
    print(f"  trafego    : impressoes {soma('im'):,.0f} · cliques {sum(r['cl'] for r in fin):,.0f} · "
          f"no link {soma('lc'):,.0f} · visualizacoes {soma('lpv'):,.0f}", file=sys.stderr)
    print(f"  vendas     : initiate checkout {soma('ic'):,.0f} · vendas {soma('vd'):,.0f} · "
          f"bruto R$ {soma('fb'):,.2f} · liquido R$ {fl:,.2f}", file=sys.stderr)
    print(f"  lucro      : R$ {fl - sp:,.2f} sem imposto · R$ {fl - sp * TAX_FACTOR:,.2f} com imposto",
          file=sys.stderr)
    if b["conferencia"]:
        print(f"  AVISO: queries x Financeiro nao batem em {len(b['conferencia'])} dia(s):", file=sys.stderr)
        for linha in b["conferencia"][:15]:
            print(f"         {linha}", file=sys.stderr)
    if b["lucro_diverge"]:
        print(f"  AVISO: Lucro Real da planilha != Fat. Liquido - Investido em "
              f"{len(b['lucro_diverge'])} dia(s): {', '.join(b['lucro_diverge'][:10])}", file=sys.stderr)
    if b["colunas_ausentes"]:
        print(f"  AVISO: colunas nao encontradas na aba {SHEET_FINANCEIRO}: {', '.join(b['colunas_ausentes'])}",
              file=sys.stderr)
    if b["colunas_ausentes_queries"]:
        print(f"  aviso: colunas opcionais nao encontradas nas queries: {', '.join(b['colunas_ausentes_queries'])}",
              file=sys.stderr)
    print(f"  out        : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
