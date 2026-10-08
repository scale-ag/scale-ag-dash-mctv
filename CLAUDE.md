# CLAUDE.md — Contexto do projeto (MCTV · Funil de Vendas · aba Financeiro)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o repositório.
> Ele carrega TODO o contexto necessário para continuar o trabalho sem depender
> de mensagens anteriores. Mantenha-o atualizado.
>
> Nasceu do modelo de dashboard da agência (mesmo motor de `scale-ag/giaco---FORM7`,
> que por sua vez veio de `scale-ag/dash-familia-aprovada-mtr-set26`). A diferença
> é que aqui o funil é de **VENDAS** e a fonte é **uma aba só** (Financeiro, 1 linha por dia).

---

## O que é

Dashboard de **Funil de Vendas** — app de BI estático (HTML/CSS/JS puro +
Chart.js via CDN) publicado no **GitHub Pages**, alimentado pela aba **Financeiro**
da planilha de acompanhamento da MCTV, que se atualiza sozinho a cada ~30 min
(build 100% na nuvem via GitHub Actions, disparado externamente pelo cron-job.org).

- **Cliente:** MCTV · **Funil:** Funil de Vendas (nome definitivo ainda não informado) · **Plataforma:** Meta Ads
- **Repo:** `scale-ag/scale-ag-dash-mctv` · **URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Somente leitura** da planilha. Nunca escrever de volta.

## Fonte de dados (Google Sheets) — UMA aba

| Planilha | ID | Aba |
|---|---|---|
| **MCTV \| ACOMPANHAMENTO GERAL \| LOOKER**, aba `Financeiro` | `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY` | lida pelo **nome** (`SHEET_FINANCEIRO`) |

Em 08/10/2026 o gestor pediu: "Tem que puxar o dado dessa planilha só da aba
financeiro". Até então a dash lia a aba **Criativos** (anúncio × dia); essa aba
**não é mais lida** — por isso não há tabelas por campanha/conjunto/anúncio,
alcance, frequência nem métricas de vídeo. Se pedirem a quebra por anúncio de
volta, é ler a Criativos de novo além da Financeiro (desenvolvimento novo).

1 linha = **1 dia** (26 dias entre 04/08 e 07/10/2026 na primeira leitura; há dias
faltando e dias zerados). Colunas: `Data` · `Total Investido Ads` ·
`Faturamento Bruto` · `Faturamento Líquido` · `Lucro Real` · `ROAS` · `Vendas` ·
`Checkouts` · `CPA` · `Cliques` · `CTR` · `CPC` · `Link Clicks` ·
`Landing Page Views` · `Connect Rate (%)` (+ colunas vazias à direita). O build
lê pelo nome do cabeçalho (`build.py` → `COLS`): Data, Investido, Fat. bruto,
Fat. líquido, Lucro (só para conferência), Vendas, Checkouts, Cliques, CTR, Link
Clicks e Landing Page Views. `ROAS`, `CPA`, `CPC` e `Connect Rate` são ignoradas
porque o navegador recalcula a partir das contagens.
Números em pt-BR (`"1.294,00"`); contagens e R$ passam por `to_count` (ponto = milhar).

Leitura: `gviz/tq?tqx=out:csv&headers=1&sheet=Financeiro` (o gid da aba não
aparece no HTML público). **Pegadinha:** o gviz por nome devolve a PRIMEIRA aba
sem erro se o nome não existir; por isso `process()` exige as colunas `Data`,
`Total Investido Ads`, `Faturamento Bruto`, `Faturamento Líquido` e `Vendas` e
aborta o build se faltar alguma (o Pages segue com a última versão boa). As
demais são opcionais: se sumirem, o log avisa (`colunas_ausentes`) e a métrica
que depende delas aparece "-" (sem `Cliques`/`CTR`, impressões, CPM e CTR). Não use `headers=0`: ele zera o
texto do cabeçalho nas colunas numéricas.

### O que bate com o quê (conferido em 08/10/2026)
- `Total Investido Ads` = soma do `Gasto_Anuncio` da aba Criativos no mesmo dia,
  **sem imposto**.
- `Vendas`/`Checkouts` = soma da Criativos (10 vendas, 74 checkouts no total).
- `Faturamento Bruto` = ROAS × gasto da Criativos (R$ 3.157,00 no total).
- `Faturamento Líquido` ≈ bruto × 0,9101 (taxas da plataforma de venda, ~9%).
- `Lucro Real` = Faturamento Líquido − Total Investido, **sem imposto** (todas as linhas).
- `Link Clicks` = os "cliques" da aba Criativos; `Cliques` é o total de cliques do anúncio.
- Impressões = `Cliques` ÷ `CTR` bate com as impressões da Criativos (±1 por arredondamento do CTR).

### Regras de derivação (`build.py` → `process`)
- **Impressões** = `Cliques × 100 ÷ CTR` (o CTR da aba é Cliques ÷ Impressões em %).
- **Lucro** é recalculado no navegador: Faturamento Líquido − Gasto × imposto. Com o
  toggle desligado bate com o `Lucro Real` da planilha; o build avisa no log se a
  fórmula da planilha mudar (`lucro_diverge`).
- **Dia repetido** fica com a última linha (não soma duas vezes).
- **Build vazio não publica:** aba sem linhas válidas ou cabeçalho de outra aba
  → `build.py` sai com erro e o Pages continua com a última versão boa.

### Imposto da mídia paga
`TAX_FACTOR = 1.13806` (13,806%) em `build.py`. Toggle "Imposto Meta" **ligado por
padrão** (`STATE.tax=true`): multiplica só o gasto, e com ele CPM, CPC, custos por
etapa, CPA, ROAS (= faturamento ÷ gasto com imposto) e **Lucro** (= líquido − gasto
com imposto). Faturamento bruto e líquido nunca levam imposto.

## Funil

`Gasto → Impressões → Cliques → Cliques no link → Visualizações da página →
Checkouts → Vendas → Faturamento bruto → Faturamento líquido → Lucro Real`, com
CPM · CTR · CPC · CTR do link · Custo/clique no link · Connect Rate (visualizações ÷
cliques no link) · Custo/visualização · Custo/Checkout · Página→Checkout · CPA ·
Checkout→Venda · ROAS · Ticket médio · ROAS líquido · Taxas da venda · ROI · Margem.
Não há lead/MQL nesta fonte.

## Arquitetura / arquivos

```
build/build.py            # lê a aba Financeiro (read-only), emite REGISTROS BRUTOS (fin[], 1 por dia); render() costura os arquivos abaixo
build/template.html       # esqueleto HTML. Placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__, __GENERATED_BRT__
build/identidade-visual.css  # TODAS as cores (tema escuro=padrão / claro no botão Tema)
build/estilos.css         # layout/componentes
build/app.js              # lógica + renderização (KPIs, funil, tabelas, period-picker, heatmap, Relatório)
.github/workflows/deploy.yml  # roda build.py e publica no Pages via branch gh-pages (workflow_dispatch + schedule + push)
dist/index.html           # saída gerada (gitignored; o Actions reconstrói)
GUIA-REPLICACAO.md        # como replicar este modelo para outros clientes
SETUP-CRON.md             # valores exatos do cron-job.org (só o token fica como TOKEN_AQUI)
```

O `build.py` **não agrega**: exporta as linhas cruas e TODA a lógica (filtros de
data, KPIs, tabelas, gráficos, heatmap, imposto) roda no navegador.

### Páginas
1. **Visão Geral de Vendas** — funil completo + evolução diária (Checkouts/Vendas
   em barras, Gasto/Faturamento bruto em linha) + tabela diária com heatmap e lucro
   colorido + 8 KPIs secundários (vendas e lucro por dia, dias com venda, dias no
   lucro, melhor/pior dia, ROAS de equilíbrio = bruto ÷ líquido, conversão da página)
   + lucro por dia, retorno acumulado, checkouts/vendas por dia da semana e
   conversão por etapa.
2. **Tráfego Meta Ads** (hash `#meta`) — funil até as Vendas, tráfego diário
   (cliques no link e visualizações em barras, custo por visualização em linha),
   tabela diária de tráfego (Impr., CPM, Cliques, CTR, Cliq. link, Visualiz.,
   Connect, Custo/Vis., Checkouts), Connect Rate por dia, custo por etapa por dia e
   donut checkout→venda.
3. **Relatório** — espelha a Visão Geral + painel de **Metas** (Meta CPA, Meta
   ROAS, vendas mínimas p/ avaliar a semana; `localStorage['dm_metas']`) +
   **Resumo semanal** (segunda a domingo, mais recente no topo; Avaliável =
   vendas ≥ mínimo, senão Em observação; CPA e ROAS colorem vs meta). Semana
   cortada pelo período aparece parcial ("01/10 a 04/10", 4 dias).

Médias "por dia" dividem pelos dias de calendário do período, do 1º ao último dia
que a aba tem (hoje só conta quando a linha de hoje entra). Dia sem linha no meio
conta como dia sem gasto (a aba pula dias parados, ex. 23/08 a 25/09).
   **Sem Insights de Tráfego por IA** (não foi pedido; não há Routine).

Filtro: só por **dia** (clique na tabela diária, Ctrl = vários) e pelo período do
seletor; não há filtro cruzado por campanha porque a fonte não tem campanha.

Heatmap de cor fixa por métrica: **Gasto=vermelho · Checkouts=azul · Connect
Rate=ciano · Vendas=verde · ROAS=amarelo** (`--heat-*` em `identidade-visual.css`).
Lucro: verde quando positivo, vermelho no prejuízo.

**Regras obrigatórias das tabelas** (ver `GUIA-REPLICACAO.md`): cabeçalho sticky;
ordenação tri‑state; colunas redimensionáveis (persist localStorage); linha
"Total Geral" fixa; dimensão nunca truncada; seleção com toggle + Ctrl multi;
tabela diária com último dia no topo.

## Rodar/testar local

```bash
python build/build.py --financeiro-file financeiro.csv --out dist/index.html
# (o sandbox do agente NÃO alcança docs.google.com por curl; o WebFetch lê o CSV
#  público. O runner do GitHub Actions tem internet e busca o CSV ao vivo.)
```

## Publicação — problemas conhecidos
1. **Push:** se a integração GitHub da sessão for somente‑leitura (403), o caminho
   é `git push` direto para `github.com` com o **PAT do gestor**. Nunca gravar o
   token no `.git/config` (usar URL efêmera `https://x-access-token:<TOKEN>@github.com/...`).
2. **cron-job.org só funciona na `main`:** `workflow_dispatch` só existe na branch padrão.
3. **Pages publica pela branch `gh-pages`:** o GITHUB_TOKEN não consegue criar o
   site no modo "GitHub Actions" (`configure-pages` com `enablement` falha com
   "Resource not accessible by integration") e o proxy da sessão bloqueia a API
   de Pages. O que funcionou: a sessão empurrou uma branch `gh-pages` com o
   `index.html`, e esse primeiro push **ligou o Pages sozinho** (Deploy from a
   branch → `gh-pages`). O `deploy.yml` lê o `build_type` do Pages a cada
   execução: `workflow` → upload + `deploy-pages`; qualquer outro → commit órfão
   com push forçado na `gh-pages` (a branch guarda só a versão atual).
4. **Proxy do sandbox:** o ambiente do agente costuma NÃO alcançar `docs.google.com`,
   `*.github.io` nem a API REST de Actions/Pages — mas o runner do Actions alcança tudo.
5. **Token exposto:** se um token foi colado no chat, **revogar e gerar um novo**.

## Pendências
- Nome do funil (hoje "Funil de Vendas").
- Metas de CPA/ROAS (hoje "não definidas"; edite no painel ou em `META_CPA`/`META_ROAS` no `build.py`).
- Quebra por campanha/conjunto/anúncio (só existe na aba Criativos, que deixou de ser lida a pedido do gestor).
