# Dashboard Funil de Vendas · MCTV (queries Meta Ads + aba Financeiro)

Dashboard **100% na nuvem** do funil de vendas da **MCTV** no **Meta Ads**,
alimentado pelas **queries do gerenciador** (1 linha por anúncio e dia: gasto,
impressões, cliques no link, visualizações, Initiate Checkout, compras e valor)
e pela aba **Financeiro** da planilha *MCTV | Acompanhamento Geral* (faturamento
líquido e cliques totais, 1 linha por dia).
Build estático (HTML/CSS/JS puro + Chart.js via CDN) publicado no **GitHub Pages**
e reconstruído a cada ~30 min pelo GitHub Actions (disparado externamente pelo
cron-job.org).

**URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/

Somente leitura das planilhas. O build **nunca** escreve de volta.

## O que a dash mostra

Funil: **Gasto → Impressões → Cliques → Cliques no link → Visualizações da página →
Initiate Checkout → Vendas → Faturamento bruto → Faturamento líquido → Lucro Real**,
com CPM, CTR, CPC, Connect Rate, Custo/IC, Página→IC, Clique→IC, IC→Venda, CPA,
ROAS, Ticket médio, ROI e Margem (IC = Initiate Checkout).
Todas as métricas de custo saem **com imposto** (toggle "Imposto Meta" ligado por
padrão; fator 13,806%), inclusive o lucro. Três páginas:

1. **Visão Geral de Vendas** — funil, evolução diária, tabela diária com heatmap,
   KPIs do checkout (IC, Custo/IC e as taxas de conversão do checkout), KPIs
   secundários, lucro por dia, retorno acumulado, IC/vendas por dia da semana e
   conversão por etapa.
2. **Tráfego Meta Ads** — funil até a venda, tráfego diário, tabela diária de
   tráfego e checkout, Connect Rate e custos por dia, IC e custo por IC por dia,
   taxas do checkout por dia, donut IC → venda e a hierarquia **Campanha →
   Conjunto → Criativo** (tabelas + gráfico por dia, filtro cruzado com Ctrl).
3. **Relatório** — espelha a Visão Geral, com painel de metas (CPA, ROAS,
   Custo/IC, vendas mínimas), resumo semanal e Top Anúncios com status
   Avaliável / Em observação.

Faturamento líquido, lucro e cliques (todos) só existem por dia (aba Financeiro):
com filtro de campanha, conjunto ou anúncio eles aparecem "-".

## Como atualiza

`.github/workflows/deploy.yml` roda `python build/build.py --out dist/index.html`
e publica `dist/` no Pages (pela branch `gh-pages`, ou por `deploy-pages` se o
Source do Pages for trocado para GitHub Actions). Disparo: cron-job.org a cada 30 min (ver
`SETUP-CRON.md`), `schedule` nativo como backup e `push` na `main`.

## Rodar local

```bash
python build/build.py --queries-file queries.csv --financeiro-file financeiro.csv --out dist/index.html
```

Detalhes de colunas, derivações e decisões em `CLAUDE.md`.
