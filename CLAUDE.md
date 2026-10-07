# CLAUDE.md — Contexto do projeto (MCTV · Funil de Vendas · aba Criativos)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o repositório.
> Ele carrega TODO o contexto necessário para continuar o trabalho sem depender
> de mensagens anteriores. Mantenha-o atualizado.
>
> Nasceu do modelo de dashboard da agência (mesmo motor de `scale-ag/giaco---FORM7`,
> que por sua vez veio de `scale-ag/dash-familia-aprovada-mtr-set26`). A diferença
> é que aqui o funil é de **VENDAS** e a fonte é **uma planilha só** (aba Criativos).

---

## O que é

Dashboard de **Funil de Vendas** — app de BI estático (HTML/CSS/JS puro +
Chart.js via CDN) publicado no **GitHub Pages**, alimentado pela aba **Criativos**
da planilha de acompanhamento da MCTV, que se atualiza sozinho a cada ~30 min
(build 100% na nuvem via GitHub Actions, disparado externamente pelo cron-job.org).

- **Cliente:** MCTV · **Funil:** Funil de Vendas (nome definitivo ainda não informado) · **Plataforma:** Meta Ads
- **Repo:** `scale-ag/scale-ag-dash-mctv` · **URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Somente leitura** da planilha. Nunca escrever de volta.

## Fonte de dados (Google Sheets) — UMA planilha

| Planilha | ID | Aba (gid) |
|---|---|---|
| **MCTV \| ACOMPANHAMENTO GERAL \| LOOKER**, aba `Criativos` | `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY` | `1077415496` |

1 linha = **anúncio × dia**, já extraída do Meta Ads. A aba tem estas 23 colunas: `Data` · `Anuncio_Nome` · `Campanha` ·
`Conjunto` · `Alcance` · `Frequencia` · `Impressoes` · `CPM` · `Cliques no Link` ·
`Gasto_Anuncio` · `Vendas` · `CPA` · `Checkouts` · `Hook_Rate` · `Hold_Rate` ·
`Play 25%` · `Retenção 25>50%` · `Retenção 75>100%` · `Play 100%` · `CTR` · `CPC` ·
`ROAS` · `Chave_Unica`. O build lê 19 delas pelo nome do cabeçalho (`build.py` →
`COLS`); `Frequencia`, `CPM`, `CPA` e `Retenção 75>100%` são ignoradas, porque o
navegador recalcula frequência, CPM e CPA (com imposto) a partir das contagens.
Números em pt-BR (`"107,00"`); contagens e R$ sem casas decimais (`"1.019"`) são
lidas por `to_count` (ponto = milhar).

Leitura: `export?format=csv&gid=` e, se falhar, `gviz/tq?tqx=out:csv&headers=1&gid=`.
Não use `headers=0` no gviz: ele zera o texto do cabeçalho nas colunas numéricas.

### Por que não há "queries do gerenciador" cruzadas
O pedido original mandou também uma planilha de queries
(`1isqdUhhwZDVKzJuPE_1_FWCyCjdKxgigAlsEs4z2N5Q`, aba "IA | Queries META - Giaco"),
mas ela é da conta **Ingenium** (sigla `IA`), não da MCTV, e vinha com gasto,
impressões e alcance zerados. Como a aba Criativos já traz gasto, impressões,
cliques e vendas por anúncio e dia, a dash usa só ela. Se chegar a planilha de
queries **da MCTV**, dá para cruzar por `Campanha · Conjunto · Anúncio` (é
desenvolvimento novo).

### Regras de derivação (`build.py` → `process`)
- **Cliques** = `Gasto ÷ CPC` (ou `CTR × Impressões ÷ 100` quando o CPC é 0),
  porque a coluna `Cliques no Link` vem **sempre vazia**. As duas contas batem.
- **Faturamento** = `ROAS × Gasto` (gasto cru, sem imposto). Nunca leva imposto.
- **Vídeo** vira contagem para somar certo entre dias/anúncios:
  `v3 = Hook% × Impr ÷ 100`, `hd = Hold% × Impr ÷ 100`,
  `p50 = Ret25>50% × Play25 ÷ 100`. As taxas no navegador saem ponderadas
  (Hook = v3/impr, Ret. 25→50 = p50/p25, Ret. 25→100 = p100/p25).
- **Hold_Rate** vem zerado na planilha → `tem_hold=false` esconde a coluna.
- **Chave_Unica** (id do anúncio + dia) deduplica: linha repetida fica a última.
- **Build vazio não publica:** se a aba vier sem linhas válidas (vazia, HTML de
  login porque deixou de ser pública, cabeçalho irreconhecível), o `build.py` sai
  com erro e o Pages continua com a última versão boa.
- `MAIN_PRODUCT_PREFIX = None` → entram todas as campanhas da aba (as antigas
  `[CAP] [VENDAS] ...` e as novas `MC | E4-VEN | ...`). Para restringir, ponha a
  sigla (ex. `"MC"`).
- **Alcance** é a soma das linhas (anúncio × dia), não o alcance deduplicado do
  Meta; a Frequência derivada (Impr ÷ Alcance) fica **subestimada**. Está na dash
  por fidelidade ao modelo, com essa ressalva escrita na nota da página 2.

### Imposto da mídia paga
`TAX_FACTOR = 1.13806` (13,806%) em `build.py`. Toggle "Imposto Meta" **ligado por
padrão** (`STATE.tax=true`): multiplica só o gasto, e com ele CPM, CPC, Custo/Checkout,
CPA e ROAS (ROAS = faturamento ÷ gasto com imposto).

## Funil

`Gasto → Impressões → Alcance → Cliques → Checkouts → Vendas → Faturamento`,
com CPM · Hook Rate · Frequência · CTR · CPC · Custo/Checkout · Clique→Checkout ·
CPA · Checkout→Venda · ROAS · Ticket médio. Não há lead/MQL nesta fonte.

## Arquitetura / arquivos

```
build/build.py            # lê a aba Criativos (read-only), emite REGISTROS BRUTOS (meta[]); render() costura os arquivos abaixo
build/template.html       # esqueleto HTML. Placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__, __GENERATED_BRT__
build/identidade-visual.css  # TODAS as cores (tema escuro=padrão / claro no botão Tema)
build/estilos.css         # layout/componentes
build/app.js              # lógica + renderização (KPIs, funil, tabelas, filtro cruzado, period-picker, heatmap, Relatório)
.github/workflows/deploy.yml  # roda build.py e publica no Pages (workflow_dispatch + schedule + push)
dist/index.html           # saída gerada (gitignored; o Actions reconstrói)
GUIA-REPLICACAO.md        # como replicar este modelo para outros clientes
SETUP-CRON.md             # valores exatos do cron-job.org (só o token fica como TOKEN_AQUI)
```

O `build.py` **não agrega**: exporta as linhas cruas e TODA a lógica (filtros de
data, filtro cruzado, KPIs, tabelas, gráficos, heatmap, imposto) roda no navegador.

### Páginas
1. **Visão Geral de Vendas** — funil + evolução diária (Checkouts/Vendas em barras,
   Gasto/Faturamento em linha) + tabela diária com heatmap + 8 KPIs secundários +
   Vendas, Checkouts, Hook Rate e CPA por anúncio.
2. **Captura Meta Ads** — funil, combinação diária, vendas por anúncio, donut
   checkout→venda, compilado dos anúncios, tabela diária, hierarquia
   Campanha → Conjunto → Anúncio com filtro cruzado e gráfico de linha por
   membro (botões Gasto · CTR · Hook Rate · CPA) e a tabela de **retenção do
   vídeo por criativo**.
3. **Relatório** — espelha a Visão Geral + painel de **Metas** (Meta CPA, Meta
   ROAS, volume mínimo de vendas, N dias p/ corte; `localStorage['dm_metas']`) +
   **Top Anúncios** (Avaliável = gasto ≥ R$ 100 e vendas ≥ volume mínimo; ranking
   por vendas, CPA, checkouts, custo/checkout). CPA e ROAS colorem vs meta.
   **Sem Insights de Tráfego por IA** (não foi pedido; não há Routine).

Heatmap de cor fixa por métrica: **Gasto=vermelho · Checkouts=azul · Hook=ciano ·
Vendas=verde · ROAS=amarelo** (`--heat-*` em `identidade-visual.css`).

**Regras obrigatórias das tabelas** (ver `GUIA-REPLICACAO.md`): cabeçalho sticky;
ordenação tri‑state; colunas redimensionáveis (persist localStorage); linha
"Total Geral" fixa; dimensão nunca truncada; seleção com toggle + Ctrl multi;
filtro cruzado bidirecional; tabela diária com último dia no topo.

## Rodar/testar local

```bash
python build/build.py --criativos-file criativos.csv --out dist/index.html
# (o sandbox do agente NÃO alcança docs.google.com; use um CSV local para testar.
#  O runner do GitHub Actions tem internet e busca o CSV ao vivo.)
```

## Publicação — problemas conhecidos
1. **Push:** se a integração GitHub da sessão for somente‑leitura (403), o caminho
   é `git push` direto para `github.com` com o **PAT do gestor**. Nunca gravar o
   token no `.git/config` (usar URL efêmera `https://x-access-token:<TOKEN>@github.com/...`).
2. **cron-job.org só funciona na `main`:** `workflow_dispatch` só existe na branch padrão.
3. **Pages precisa ser ligado à mão:** Settings → Pages → Source: **GitHub Actions**.
   O `enablement: true` do `configure-pages` não liga sozinho (o GITHUB_TOKEN não
   tem permissão de criar o site) e a sessão do agente também não consegue (o
   proxy bloqueia a API de Pages e a criação de repositório na org).
4. **Proxy do sandbox:** o ambiente do agente costuma NÃO alcançar `docs.google.com`,
   `*.github.io` nem a API REST de Actions/Pages — mas o runner do Actions alcança tudo.
5. **Token exposto:** se um token foi colado no chat, **revogar e gerar um novo**.

## Pendências
- Nome do funil (hoje "Funil de Vendas").
- Metas de CPA/ROAS (hoje "não definidas"; edite no painel ou em `META_CPA`/`META_ROAS` no `build.py`).
- Planilha de queries **da MCTV**, se quiserem cruzar com o gerenciador.
