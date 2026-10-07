#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a dashboard estatica (index.html) do funil de VENDAS da MCTV a partir de
UMA aba publica do Google Sheets (somente leitura):

  - "MCTV | ACOMPANHAMENTO GERAL | LOOKER", aba "Criativos" (gid 1077415496):
    uma linha por ANUNCIO x DIA, ja com campanha/conjunto e as metricas do
    gerenciador (gasto, impressoes, alcance, CTR, CPC) + os eventos de venda
    (Checkouts, Vendas, ROAS) + as metricas de video do criativo (Hook Rate,
    Hold Rate, Play 25%, Retencao 25>50%, Play 100%).

Esta aba ja e o cruzamento pronto (gerenciador + vendas por anuncio), entao
NAO ha lista de leads nem casamento por nome: cada linha entra como esta.

FUNIL DESTA CONTA:
    Gasto -> Impressoes -> Alcance -> Cliques -> Checkouts -> Vendas -> Faturamento
com CPM · Frequencia · CTR · CPC · Custo/Checkout · CPA · ROAS · Ticket medio.

Colunas derivadas (a planilha nao traz o numero pronto):
  - Cliques: a coluna "Cliques no Link" vem VAZIA. O clique sai de Gasto/CPC
    (ou de CTR x Impressoes quando o CPC e zero) — as duas contas batem.
  - Faturamento: ROAS x Gasto (o ROAS da planilha e calculado sobre o gasto
    SEM imposto). Na dash o ROAS e recalculado sobre o gasto COM imposto.
  - Hook/Hold/Retencao: a planilha traz %; o build converte em CONTAGEM
    (views de 3s = Hook% x Impressoes; Play 50% = Ret25>50% x Play 25%) para
    que qualquer agregacao (periodo, campanha, anuncio) seja uma media
    ponderada correta, e nao a media das porcentagens.

NAO EXISTE NESTA CONTA: lista de leads, MQL/qualificacao e CAC por lead.

Este script apenas LE a planilha (export CSV publico) e emite os REGISTROS
BRUTOS (meta[]) dentro do HTML. Todos os filtros, agregacoes, KPIs, tabelas e
graficos sao calculados no navegador (client-side). Nunca escreve nada de volta.

Teste local: --criativos-file apontando para um CSV baixado.
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
import urllib.request
from datetime import datetime, timezone, timedelta

# Planilha "MCTV | ACOMPANHAMENTO GERAL | LOOKER", aba "Criativos".
SPREADSHEET_ID = "1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY"
GID_CRIATIVOS = "1077415496"
EXPORT_URL = "https://docs.google.com/spreadsheets/d/{sid}/export?format=csv&gid={gid}"
# Plano B: o export as vezes responde 401 mesmo com a planilha publica; o gviz
# (headers=1 -> 1a linha vira cabecalho) le a mesma aba.
GVIZ_URL = "https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&headers=1&gid={gid}"

# Identificação do cliente/conta (usada só em textos — não afeta os números).
CLIENT_NAME = "MCTV"
MAIN_PRODUCT = "Funil de Vendas"
# Prefixo de campanha que entra na dash. None/"" = TODAS as campanhas da aba.
# A aba tem as campanhas antigas "[CAP] [VENDAS] ..." (agosto) e as novas
# "MC | E1-CAP ..." / "MC | E4-VEN ..." (setembro em diante); todas sao da
# operacao de vendas da MCTV, entao o padrao e nao filtrar.
MAIN_PRODUCT_PREFIX = None

ACCOUNT_TZ_NAME = "America/Sao_Paulo"  # "hoje" da dash (o dia da planilha entra como esta)
try:
    from zoneinfo import ZoneInfo
    ACCOUNT_TZ = ZoneInfo(ACCOUNT_TZ_NAME)
except Exception:
    ACCOUNT_TZ = timezone(timedelta(hours=-3))

BRT = timezone(timedelta(hours=-3))   # horario de Brasilia (so p/ o carimbo "ultima atualizacao")
TAX_FACTOR = 1.13806   # fator de imposto/taxa sobre o gasto de mídia paga (Meta Ads) = 13,806%.
                       # O toggle "Imposto Meta" ja vem LIGADO (app.js STATE.tax=true): gasto,
                       # CPM, CPC, Custo/Checkout, CPA e ROAS ja saem com o imposto aplicado.
                       # Desligar o toggle mostra o gasto bruto. Faturamento nunca leva imposto.

# --------------------------------------------------------------------------- #
# Regras da aba Relatório (Top anúncios)
# --------------------------------------------------------------------------- #
# Amostra mínima para julgar um anúncio. Abaixo disso ele entra como
# "Em observação" — nunca é classificado só porque teve 1 venda com pouco gasto.
SAMPLE_MIN_SPEND = 100.0   # gasto mínimo (R$) para amostra relevante
SAMPLE_MIN_VENDAS = 2      # vendas mínimas para julgar o anúncio

# Metas & parâmetros da conta (DEFAULTS do painel editável da aba Relatório).
# None = "meta não definida" (métrica aparece sem cor até o gestor preencher).
META_CPA = None            # meta de CPA (R$/venda)
META_ROAS = None           # ROAS mínimo desejado
VOLUME_MIN_AMOSTRAL = SAMPLE_MIN_VENDAS
N_DIAS_CORTE = 5           # dias consecutivos acima do teto p/ considerar corte


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


def fetch_sheet(sid: str, gid: str) -> list[list[str]]:
    try:
        return fetch_csv(EXPORT_URL.format(sid=sid, gid=gid))
    except urllib.error.HTTPError as exc:
        print(f"[fetch_sheet] export respondeu {exc.code}; lendo pelo gviz", file=sys.stderr)
        return fetch_csv(GVIZ_URL.format(sid=sid, gid=gid))


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


def header_index(header, wanted, fallback):
    """Acha cada coluna pelo nome do cabeçalho: primeiro nome exato, depois
    "contém"."""
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
    # Cabeçalho irreconhecível (renomearam tudo): cai nas posições atuais da aba.
    # Se ele foi reconhecido, coluna ausente fica ausente — usar a posição dela
    # leria outra métrica no lugar (ex.: Checkouts no lugar de Cliques).
    if sum(v is not None for v in idx.values()) < len(wanted) // 2:
        return dict(fallback)
    return idx


def cell(row, i):
    if i is None or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


# --------------------------------------------------------------------------- #
# Processamento -> registros brutos
# --------------------------------------------------------------------------- #
COLS = {
    "day": ["data", "day"],
    "ad": ["anuncio_nome", "anuncio", "ad name"],
    "campaign": ["campanha", "campaign name"],
    "adset": ["conjunto", "ad set name"],
    "reach": ["alcance", "reach"],
    "impr": ["impressoes", "impressions"],
    "clicks": ["cliques no link", "link clicks"],
    "spent": ["gasto_anuncio", "gasto", "amount spent"],
    "vendas": ["vendas", "purchases"],
    "checkouts": ["checkouts", "checkout"],
    "hook": ["hook_rate", "hook rate"],
    "hold": ["hold_rate", "hold rate"],
    "p25": ["play 25%"],
    "r2550": ["retencao 25>50%"],
    "p100": ["play 100%"],
    "ctr": ["ctr"],
    "cpc": ["cpc"],
    "roas": ["roas"],
    "key": ["chave_unica"],
}
# posição atual das colunas na aba (só vale se o cabeçalho mudar de nome)
FALLBACK = {"day": 0, "ad": 1, "campaign": 2, "adset": 3, "reach": 4, "impr": 6, "clicks": 8,
            "spent": 9, "vendas": 10, "checkouts": 12, "hook": 13, "hold": 14, "p25": 15,
            "r2550": 16, "p100": 18, "ctr": 19, "cpc": 20, "roas": 21, "key": 22}


def clicks_of(raw_clicks: str, spent: float, cpc: float, ctr: float, impr: float) -> float:
    """Cliques no link. A coluna vem vazia na aba; quando vier preenchida, vale
    ela. Senão: Gasto/CPC (o CPC da planilha é Gasto/Cliques) e, com CPC zero,
    CTR x Impressões (o CTR é Cliques/Impressões em %)."""
    if raw_clicks:
        return to_float(raw_clicks)
    if cpc > 0 and spent > 0:
        return float(round(spent / cpc))
    if ctr > 0 and impr > 0:
        return float(round(ctr * impr / 100.0))
    return 0.0


def process(rows):
    header = rows[0] if rows else []
    ix = header_index(header, COLS, FALLBACK)
    faltando = [k for k in ("day", "ad", "campaign", "spent", "impr") if ix.get(k) is None]
    if faltando:
        raise SystemExit(f"Colunas obrigatórias não encontradas na aba Criativos: {faltando}")

    meta = []
    vistos = {}
    fora_prefixo = 0
    sem_data = 0
    duplicadas = 0
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        day = parse_date(cell(row, ix["day"]))
        camp = cell(row, ix["campaign"])
        if not day:
            if camp or cell(row, ix["ad"]):
                sem_data += 1
            continue
        if MAIN_PRODUCT_PREFIX and not norm(camp).startswith(norm(MAIN_PRODUCT_PREFIX)):
            fora_prefixo += 1
            continue
        sp = to_float(cell(row, ix["spent"]))
        im = to_float(cell(row, ix["impr"]))
        cpc = to_float(cell(row, ix["cpc"]))
        ctr = to_float(cell(row, ix["ctr"]))
        hook = to_float(cell(row, ix["hook"]))
        hold = to_float(cell(row, ix["hold"]))
        p25 = to_float(cell(row, ix["p25"]))
        roas = to_float(cell(row, ix["roas"]))
        rec = {
            "d": day,
            "camp": camp or "(sem campanha)",
            "adset": cell(row, ix["adset"]) or "(sem conjunto)",
            "ad": cell(row, ix["ad"]) or "(sem anúncio)",
            "sp": round(sp, 4),
            "im": im,
            "rc": to_float(cell(row, ix["reach"])),
            "cl": clicks_of(cell(row, ix["clicks"]), sp, cpc, ctr, im),
            "ck": to_float(cell(row, ix["checkouts"])),
            "vd": to_float(cell(row, ix["vendas"])),
            "fat": round(roas * sp, 2),
            # contagens de vídeo (ver docstring): % -> número de pessoas
            "v3": round(hook * im / 100.0, 2),
            "hd": round(hold * im / 100.0, 2),
            "p25": p25,
            "p50": round(to_float(cell(row, ix["r2550"])) * p25 / 100.0, 2),
            "p100": to_float(cell(row, ix["p100"])),
        }
        # Chave_Unica = id do anúncio + dia. Linha repetida (mesma chave) não
        # pode somar duas vezes: fica a última.
        key = cell(row, ix["key"])
        if key:
            if key in vistos:
                meta[vistos[key]] = rec
                duplicadas += 1
                continue
            vistos[key] = len(meta)
        meta.append(rec)

    dates = sorted({m["d"] for m in meta if m["d"]})
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
            # a planilha só traz Hold Rate zerado hoje; sem dado, a coluna some
            "tem_hold": any(m["hd"] > 0 for m in meta),
            "sample_min_spend": SAMPLE_MIN_SPEND,
            "sample_min_vendas": SAMPLE_MIN_VENDAS,
            "meta_cpa": META_CPA,
            "meta_roas": META_ROAS,
            "volume_min_amostral": VOLUME_MIN_AMOSTRAL,
            "n_dias_corte": N_DIAS_CORTE,
            "linhas_descartadas": {"sem_data": sem_data, "fora_do_prefixo": fora_prefixo,
                                   "duplicadas": duplicadas},
        },
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
    # "</" escapado: um nome de anúncio com "</script>" não fecha o bloco de dados
    tpl = tpl.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    tpl = tpl.replace("__BUILD_ID__", data["build"]["build_id"])
    tpl = tpl.replace("__GENERATED_BRT__", data["build"]["generated_at_brt"])
    return tpl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--criativos-file", help="CSV local da aba Criativos (teste)")
    ap.add_argument("--template", default="build/template.html")
    ap.add_argument("--out", default="dist/index.html")
    args = ap.parse_args()

    rows = (read_csv_file(args.criativos_file) if args.criativos_file
            else fetch_sheet(SPREADSHEET_ID, GID_CRIATIVOS))
    data = process(rows)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(render(data, args.template))

    b = data["build"]
    d = b["linhas_descartadas"]
    m = data["meta"]
    sp = sum(r["sp"] for r in m)
    print("== build ok ==", file=sys.stderr)
    print(f"  periodo    : {b['date_min']} -> {b['date_max']}", file=sys.stderr)
    print(f"  linhas     : {len(m)} (anúncio x dia)", file=sys.stderr)
    print(f"  descartadas: {d['sem_data']} sem data · {d['fora_do_prefixo']} fora do prefixo · "
          f"{d['duplicadas']} duplicadas", file=sys.stderr)
    print(f"  gasto      : R$ {sp:,.2f} (sem imposto; fator {TAX_FACTOR})", file=sys.stderr)
    print(f"  impressoes : {sum(r['im'] for r in m):,.0f} · cliques {sum(r['cl'] for r in m):,.0f}",
          file=sys.stderr)
    print(f"  checkouts  : {sum(r['ck'] for r in m):,.0f} · vendas {sum(r['vd'] for r in m):,.0f} · "
          f"faturamento R$ {sum(r['fat'] for r in m):,.2f}", file=sys.stderr)
    print(f"  out        : {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
