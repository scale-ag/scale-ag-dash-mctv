# CLAUDE.md — Contexto do projeto (MCTV · Funil de Vendas · queries + Financeiro)

> Este arquivo é lido automaticamente pelo Claude Code ao abrir o repositório.
> Ele carrega TODO o contexto necessário para continuar o trabalho sem depender
> de mensagens anteriores. Mantenha-o atualizado.
>
> Nasceu do modelo de dashboard da agência (mesmo motor de `scale-ag/giaco---FORM7`,
> que por sua vez veio de `scale-ag/dash-familia-aprovada-mtr-set26`). A diferença
> é que aqui o funil é de **VENDAS** (Initiate Checkout → compra), sem lista de leads.

---

## O que é

Dashboard de **Funil de Vendas** — app de BI estático (HTML/CSS/JS puro +
Chart.js via CDN) publicado no **GitHub Pages**, alimentado pelas **queries do
gerenciador** (Meta Ads, anúncio × dia) e pela aba **Financeiro** da planilha de
acompanhamento da MCTV, que se atualiza sozinho a cada ~30 min (build 100% na
nuvem via GitHub Actions, disparado externamente pelo cron-job.org).

- **Cliente:** MCTV ("Manhattan") · **Funil:** Funil de Vendas (nome definitivo ainda não informado) · **Plataforma:** Meta Ads
- **Repo:** `scale-ag/scale-ag-dash-mctv` · **URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Somente leitura** das planilhas. Nunca escrever de volta.

## Fontes de dados (Google Sheets) — DUAS planilhas

| # | Planilha | ID | Aba | Leitura |
|---|---|---|---|---|
| 1 | **Queries do gerenciador** (Meta Ads, "Manhattan") | `1ldYMpIPWZ5Dm4hD35TzE6aalXoz3k1sktK5hd2KAXAU` | gid `0` | `export?format=csv&gid=0`, com o gviz por gid de reserva (`fetch_gid`) |
| 2 | **MCTV \| ACOMPANHAMENTO GERAL \| LOOKER**, aba `Financeiro` | `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY` | pelo **nome** (`SHEET_FINANCEIRO`) | `gviz/tq?tqx=out:csv&headers=1&sheet=Financeiro` |

Histórico: 07/10/2026 a dash nasceu da aba Criativos; 08/10 o gestor pediu "só
da aba financeiro"; **09/10 o gestor mandou as queries** ("Atualiza a planilha de
queries do Manhatan", "Adicione as campanhas, conjuntos e criativos", "métricas
de iniciate checkout", "Taxas de conversão de checkout"). A aba Criativos **não
é lida**.

### 1. Queries (fonte de TODA a mídia e das conversões)
1 linha = **dia × campanha × conjunto × anúncio** (~290 linhas de 04/08 a 09/10/2026,
ordenadas do dia mais recente para o mais antigo). Colunas: `Day` · `Campaign Name` ·
`Ad Set Name` · `Ad Name` · `Amount Spent` · `Purchases` · `Cost per Purchase` ·
`Purchases Conversion Value` · `Checkouts Initiated` · `Cost per Checkout Initiated` ·
`Landing Page Views` · `Reach` · `Link Clicks` · `Impressions`. Números em pt-BR
(`"21,64"`), muitas células vazias (= 0).

`build.py` → `QCOLS`/`process_queries`: lê Day, Campaign/Ad Set/Ad Name, Amount
Spent (`sp`), Impressions (`im`), Link Clicks (`lc`), Landing Page Views (`lpv`),
Checkouts Initiated (`ic`), Purchases (`vd`) e Purchases Conversion Value (`fb`).
`Purchases` e `Checkouts Initiated` exigem o nome **exato** (o "contém" pegaria
`Cost per Purchase`/`Purchases Conversion Value`). Custos por linha são
ignorados (o navegador recalcula). **`Reach` não é lido**: alcance é deduplicado
e somar linhas anúncio × dia infla o número. Linha toda zerada é descartada
(anúncio parado; não muda soma). **Todas as colunas lidas são obrigatórias**
(`QOBRIGATORIAS`): se uma sumir ou for renomeada o build aborta e o Pages segue
com a última versão boa, em vez de publicar 0 venda/0 IC.

### 2. Financeiro (só o que as queries não têm)
1 linha = **1 dia**. Da aba entram **só** `Faturamento Líquido` (`fl`) e `Cliques`
(todos os cliques, `cl`) — payload `fin: [{d, fl, cl}]`. As demais colunas
(`Total Investido Ads`, `Faturamento Bruto`, `Vendas`, `Checkouts`, `Link Clicks`,
`Landing Page Views`…) servem só para a **conferência**: `conferencia_dias()`
compara dia a dia com a soma das queries e imprime `AVISO` no log se divergir.
Em 09/10/2026 as duas bateram em todos os dias (gasto, vendas, fat. bruto,
checkouts = Checkouts Initiated, cliques no link, visualizações).

`process_fin` exige `Data`, `Total Investido Ads`, `Faturamento Bruto`,
`Faturamento Líquido` e `Vendas` e aborta se faltar (o gviz por nome devolve a
PRIMEIRA aba sem erro se a aba for renomeada). Não use `headers=0`: ele zera o
texto do cabeçalho nas colunas numéricas. **Dia repetido** fica com a última linha.
`Lucro Real` da aba = Faturamento Líquido − Total Investido, **sem imposto**; o
build avisa se a fórmula mudar (`lucro_diverge`).

### Regra que vale em todo o projeto: o que só existe por DIA
Faturamento líquido, Lucro e Cliques (todos) vêm da Financeiro, que **não quebra
por campanha/conjunto/anúncio**. Com filtro de campanha/conjunto/anúncio ativo
(`dimActive()` em `app.js`) esses valores ficam `null` ("-"): o funil apaga as
etapas, os gráficos de lucro mostram aviso e os KPIs de lucro mostram "só por dia
(aba Financeiro)". Atribuí-los a um anúncio seria inventar número.
`scopeRows()`/`scopeRange()` juntam as linhas das queries com as da Financeiro só
quando não há filtro de dimensão; `gate(a, fin)` zera `fl`/`cl` para `null` nos
agregados que não vêm do recorte diário completo.

**Dia que está nas queries mas ainda não na Financeiro** (as queries costumam
trazer hoje antes): ali líquido e cliques (todos) **não existem**, não são zero
(`FIN_DAYS` em `app.js`). Dia sem venda tem líquido 0 de verdade; dia com venda
deixa o líquido/lucro do recorte em "-" ("aba Financeiro ainda sem DD/MM"). Os
cliques (todos) somam só os dias cobertos e o CTR/CPC usam o gasto e as
impressões desses mesmos dias (`imF`/`spF`). Os gráficos de lucro pulam o dia pendente.

**Nomes repetidos:** conjuntos e anúncios repetem nome entre campanhas
("00 - Seguidores" em 4 campanhas, "AD04" em 6). A hierarquia agrupa por nome
(mesmo critério dos outros dashs da agência); clique simples num conjunto/anúncio
mantém a campanha/conjunto já escolhidos (`selDim` limpa só o próprio nível e os
de baixo), então o recorte bate com a linha clicada.

### Imposto da mídia paga
`TAX_FACTOR = 1.13806` (13,806%) em `build.py`. Toggle "Imposto Meta" **ligado por
padrão** (`STATE.tax=true`): multiplica só o gasto, e com ele CPM, CPC, custos por
etapa, CPA, ROAS (= faturamento ÷ gasto com imposto) e **Lucro** (= líquido − gasto
com imposto). Faturamento bruto e líquido nunca levam imposto.

## Funil

`Gasto → Impressões → Cliques (todos) → Cliques no link → Visualizações da página →
Initiate Checkout → Vendas → Faturamento bruto → Faturamento líquido → Lucro Real`, com
CPM · CTR · CPC · CTR do link · Custo/clique no link · Connect Rate (visualizações ÷
cliques no link) · Custo/visualização · **Custo/IC** · **Página→IC** (IC ÷
visualizações) · **Clique→IC** (IC ÷ cliques no link) · **IC→Venda** (vendas ÷ IC) ·
CPA · ROAS · Ticket médio · ROAS líquido · Taxas da venda · ROI · Margem.
**IC** = Initiate Checkout (`Checkouts Initiated` das queries). Não há lead/MQL.
Taxas são sempre soma ÷ soma no recorte (ponderadas), nunca média de taxas.

## Arquitetura / arquivos

```
build/build.py            # lê as queries + a aba Financeiro (read-only), emite REGISTROS BRUTOS (meta[] anúncio × dia, fin[] dia); render() costura os arquivos abaixo
build/template.html       # esqueleto HTML. Placeholders __STYLES__, __APP_JS__, __DATA_JSON__, __BUILD_ID__, __GENERATED_BRT__
build/identidade-visual.css  # TODAS as cores (tema escuro=padrão / claro no botão Tema)
build/estilos.css         # layout/componentes
build/app.js              # lógica + renderização (KPIs, funil, tabelas, hierarquia, filtro cruzado, period-picker, heatmap, Relatório)
.github/workflows/deploy.yml  # roda build.py e publica no Pages via branch gh-pages (workflow_dispatch + schedule + push)
dist/index.html           # saída gerada (gitignored; o Actions reconstrói)
GUIA-REPLICACAO.md        # como replicar este modelo para outros clientes
SETUP-CRON.md             # valores exatos do cron-job.org (só o token fica como TOKEN_AQUI)
```

O `build.py` **não agrega**: exporta as linhas cruas e TODA a lógica (filtros de
data, KPIs, tabelas, gráficos, heatmap, imposto) roda no navegador.

### Páginas
1. **Visão Geral de Vendas** — funil completo + evolução diária (Initiate
   Checkout/Vendas em barras, Gasto/Faturamento bruto em linha) + tabela diária
   (Gasto, IC, Custo/IC, Vendas, IC→Venda, CPA, Fat. bruto, Fat. líq., Lucro, ROAS)
   + **4 KPIs do checkout** (Initiate Checkout com Custo/IC, Página→IC, Clique no
   link→IC, IC→Venda) + 8 KPIs secundários (vendas e lucro por dia, dias com venda,
   dias no lucro, melhor/pior dia, ROAS de equilíbrio = bruto ÷ líquido, conversão
   da página) + lucro por dia, retorno acumulado, IC/vendas por dia da semana e
   conversão por etapa.
2. **Tráfego Meta Ads** (hash `#meta`) — funil até as Vendas, tráfego diário,
   tabela diária de tráfego (… Connect, Custo/Vis., IC, Custo/IC, Pág.→IC, Vendas,
   IC→Venda), qualidade do tráfego (Connect Rate por dia, custo por etapa,
   conversão por etapa), **Checkout** (IC e custo por IC por dia, taxas Página→IC
   e IC→Venda por dia, donut IC→venda) e a **hierarquia Campanha → Conjunto →
   Criativo**: 3 tabelas (nome + Gasto travados à esquerda, `band:'l'` →
   `renderSplitTable`) com Impr., CPM, Cliq. link, CTR link, CPC link, Visualiz.,
   Connect, IC, Custo/IC, Pág.→IC, Clique→IC, Vendas, IC→Venda, CPA, Fat. bruto e
   ROAS, cada uma com gráfico de linha por dia (métrica nos botões: Gasto, CTR,
   IC, Custo/IC, CPA) e legenda clicável.
3. **Relatório** — espelha a Visão Geral + painel de **Metas** (Meta CPA, Meta
   ROAS, **Meta Custo/IC**, vendas mínimas p/ avaliar; `localStorage['dm_metas']`)
   + **Resumo semanal** (segunda a domingo, mais recente no topo; Avaliável =
   vendas ≥ mínimo; semana cortada pelo período aparece parcial "01/10 a 04/10")
   + **Top Anúncios** (todos os anúncios com gasto/IC/venda; Avaliável = gasto ≥
   `SAMPLE_MIN_SPEND` e vendas ≥ mínimo; ordem: avaliáveis, mais vendas, menor CPA,
   mais IC, menor Custo/IC; campanha/conjunto = onde o anúncio mais gastou). CPA,
   ROAS e Custo/IC colorem vs meta nas duas tabelas.
   **Sem Insights de Tráfego por IA** (não foi pedido; não há Routine).

Médias "por dia" dividem pelos dias de calendário do período, do 1º ao último dia
que as planilhas têm (hoje só conta quando a linha de hoje entra). Dia sem linha
no meio conta como dia sem gasto (a conta pula dias parados, ex. 23/08 a 25/09).

**Filtro cruzado:** clique numa campanha/conjunto/anúncio (tabela ou legenda do
gráfico) filtra a página inteira e as outras páginas; Ctrl = vários (OU dentro
da dimensão, E entre dimensões). Cada tabela da hierarquia ignora a própria
seleção (`metaActive('C'|'A'|'D')`) para as linhas irmãs continuarem visíveis.
Clique numa data da tabela diária filtra por dia. A barra "Filtro ativo" no topo
mostra tudo que está aplicado; "Remover Filtros" limpa e volta para "Este mês".

Heatmap de cor fixa por métrica: **Gasto=vermelho · IC=azul (`--heat-ck`) ·
Connect Rate=ciano · Vendas=verde · ROAS=amarelo** (`--heat-*` em
`identidade-visual.css`). Lucro: verde quando positivo, vermelho no prejuízo.

**Regras obrigatórias das tabelas** (ver `GUIA-REPLICACAO.md`): cabeçalho sticky;
ordenação tri‑state; colunas redimensionáveis (persist localStorage); linha
"Total Geral" fixa; dimensão nunca truncada; seleção com toggle + Ctrl multi;
filtro cruzado bidirecional; tabela diária com último dia no topo.

## Rodar/testar local

```bash
python build/build.py --queries-file queries.csv --financeiro-file financeiro.csv --out dist/index.html
# (o sandbox do agente NÃO alcança docs.google.com por curl; o WebFetch lê o CSV
#  público, mas às vezes engole células vazias — confira o nº de colunas por linha.
#  O runner do GitHub Actions tem internet e busca os CSVs ao vivo.)
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
- Metas de CPA/ROAS/Custo por IC (hoje "não definidas"; edite no painel ou em
  `META_CPA`/`META_ROAS`/`META_CPIC` no `build.py`).
- cron-job.org não estava disparando em 08–09/10 (a dash só atualizava pelo
  `schedule` do GitHub, irregular). Conferir o job do gestor.
