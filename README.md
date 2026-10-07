# Dashboard Funil de Vendas · MCTV (aba Criativos)

Dashboard **100% na nuvem** do funil de vendas da **MCTV** no **Meta Ads**,
alimentado pela aba **Criativos** da planilha *MCTV | Acompanhamento Geral*.
Build estático (HTML/CSS/JS puro + Chart.js via CDN) publicado no **GitHub Pages**
e reconstruído a cada ~30 min pelo GitHub Actions (disparado externamente pelo
cron-job.org).

**URL pública:** https://scale-ag.github.io/scale-ag-dash-mctv/

Somente leitura da planilha. O build **nunca** escreve de volta.

## O que a dash mostra

Funil: **Gasto → Impressões → Alcance → Cliques → Checkouts → Vendas → Faturamento**,
com CPM, Hook Rate, Frequência, CTR, CPC, Custo/Checkout, CPA, ROAS e Ticket médio.
Todas as métricas de custo saem **com imposto** (toggle "Imposto Meta" ligado por
padrão; fator 13,806%). Três páginas:

1. **Visão Geral de Vendas** — funil, evolução diária, tabela diária com heatmap,
   KPIs secundários e Vendas/Checkouts/Hook Rate/CPA por anúncio.
2. **Captura Meta Ads** — funil, donut checkout → venda, compilado dos anúncios,
   hierarquia Campanha → Conjunto → Anúncio com filtro cruzado e a tabela de
   retenção do vídeo por criativo.
3. **Relatório** — espelha a Visão Geral, com painel de metas (CPA, ROAS, amostra)
   e a tabela de Top Anúncios com status Avaliável / Em observação.

## Como atualiza

`.github/workflows/deploy.yml` roda `python build/build.py --out dist/index.html`
e publica `dist/` no Pages. Disparo: cron-job.org a cada 30 min (ver
`SETUP-CRON.md`), `schedule` nativo como backup e `push` na `main`.

## Rodar local

```bash
python build/build.py --criativos-file criativos.csv --out dist/index.html
```

Detalhes de colunas, derivações e decisões em `CLAUDE.md`.
