# Dashboard Funil de Vendas · MCTV (aba Financeiro)

Dashboard **100% na nuvem** do funil de vendas da **MCTV** no **Meta Ads**,
alimentado só pela aba **Financeiro** da planilha *MCTV | Acompanhamento Geral*
(1 linha por dia).
Build estático (HTML/CSS/JS puro + Chart.js via CDN) publicado no **GitHub Pages**
e reconstruído a cada ~30 min pelo GitHub Actions (disparado externamente pelo
cron-job.org).

**URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/

Somente leitura da planilha. O build **nunca** escreve de volta.

## O que a dash mostra

Funil: **Gasto → Impressões → Cliques → Cliques no link → Visualizações da página →
Checkouts → Vendas → Faturamento bruto → Faturamento líquido → Lucro Real**, com
CPM, CTR, CPC, Connect Rate, Custo/Checkout, CPA, ROAS, Ticket médio, ROI e Margem.
Todas as métricas de custo saem **com imposto** (toggle "Imposto Meta" ligado por
padrão; fator 13,806%), inclusive o lucro. Três páginas:

1. **Visão Geral de Vendas** — funil, evolução diária, tabela diária com heatmap,
   KPIs secundários, lucro por dia, retorno acumulado, vendas por dia da semana e
   conversão por etapa.
2. **Tráfego Meta Ads** — funil até a venda, tráfego diário (cliques no link,
   visualizações, custo por visualização), tabela diária de tráfego, Connect Rate
   e custos por dia e donut checkout → venda.
3. **Relatório** — espelha a Visão Geral, com painel de metas (CPA, ROAS, vendas
   mínimas) e o resumo semanal com status Avaliável / Em observação.

A aba Financeiro não quebra por campanha, conjunto ou anúncio, então a dash não
tem essas tabelas nem métricas de vídeo.

## Como atualiza

`.github/workflows/deploy.yml` roda `python build/build.py --out dist/index.html`
e publica `dist/` no Pages (pela branch `gh-pages`, ou por `deploy-pages` se o
Source do Pages for trocado para GitHub Actions). Disparo: cron-job.org a cada 30 min (ver
`SETUP-CRON.md`), `schedule` nativo como backup e `push` na `main`.

## Rodar local

```bash
python build/build.py --financeiro-file financeiro.csv --out dist/index.html
```

Detalhes de colunas, derivações e decisões em `CLAUDE.md`.
