# AGENTS.md — Dash Funil de Vendas · MCTV (queries + aba Financeiro)

> Contexto completo em **`CLAUDE.md`** (mesma pasta) — leia-o antes de mexer no
> projeto. Este arquivo é um resumo para agentes/ferramentas que seguem a
> convenção `AGENTS.md`.

## O essencial

- **Repo:** `scale-ag/scale-ag-dash-mctv` · **Pages:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Fontes (somente leitura):** (1) **queries do gerenciador** `1ldYMpIPWZ5Dm4hD35TzE6aalXoz3k1sktK5hd2KAXAU` gid 0 — anúncio × dia, fonte de gasto, impressões, cliques no link, visualizações, Initiate Checkout, vendas e fat. bruto; (2) aba `Financeiro` (lida pelo nome, via gviz) da planilha `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY` — 1 linha = 1 dia, só fat. líquido e cliques (todos); o resto dela serve para conferência no log.
- **Funil:** `Gasto → Impressões → Cliques → Cliques no link → Visualizações → Initiate Checkout → Vendas → Fat. bruto → Fat. líquido → Lucro`.
- **Derivados:** ROAS, CPA, CTR, Connect Rate, Custo/IC, Página→IC, Clique→IC, IC→Venda e Lucro recalculados no navegador a partir das contagens. Hierarquia Campanha → Conjunto → Criativo com filtro cruzado; fat. líquido, lucro e cliques (todos) ficam "-" sob filtro de dimensão (só existem por dia).
- **Imposto:** `TAX_FACTOR=1.13806`; toggle "Imposto Meta" **ligado por padrão**; entra no gasto e no lucro, nunca no faturamento.
- **Sem Insights por IA.**
- **Build:** `python build/build.py --queries-file queries.csv --financeiro-file financeiro.csv --out dist/index.html` (sem os flags, busca os CSVs públicos — precisa alcançar `docs.google.com`).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| planilha, colunas, imposto, metas padrão | `build/build.py` |
| cores (tema claro/escuro, heatmap) | `build/identidade-visual.css` |
| layout/componentes | `build/estilos.css` |
| cálculos, tabelas, gráficos, Relatório | `build/app.js` |
| textos/estrutura das páginas | `build/template.html` |
| frequência/forma do deploy | `.github/workflows/deploy.yml` + `SETUP-CRON.md` |
