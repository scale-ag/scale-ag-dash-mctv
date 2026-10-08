# AGENTS.md — Dash Funil de Vendas · MCTV (aba Financeiro)

> Contexto completo em **`CLAUDE.md`** (mesma pasta) — leia-o antes de mexer no
> projeto. Este arquivo é um resumo para agentes/ferramentas que seguem a
> convenção `AGENTS.md`.

## O essencial

- **Repo:** `scale-ag/scale-ag-dash-mctv` · **Pages:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Fonte única:** aba `Financeiro` (lida pelo nome, via gviz) da planilha `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY`, somente leitura. 1 linha = 1 dia. A aba Criativos não é mais lida.
- **Funil:** `Gasto → Impressões → Cliques → Cliques no link → Visualizações → Checkouts → Vendas → Fat. bruto → Fat. líquido → Lucro`.
- **Derivados:** Impressões = Cliques ÷ CTR (no build); ROAS, CPA, CTR, Connect Rate e Lucro recalculados no navegador a partir das contagens. Sem quebra por anúncio.
- **Imposto:** `TAX_FACTOR=1.13806`; toggle "Imposto Meta" **ligado por padrão**; entra no gasto e no lucro, nunca no faturamento.
- **Sem Insights por IA** e sem cruzamento com planilha de queries (a enviada era de outro cliente).
- **Build:** `python build/build.py --financeiro-file financeiro.csv --out dist/index.html` (sem o flag, busca o CSV público — precisa alcançar `docs.google.com`).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| planilha, colunas, imposto, metas padrão | `build/build.py` |
| cores (tema claro/escuro, heatmap) | `build/identidade-visual.css` |
| layout/componentes | `build/estilos.css` |
| cálculos, tabelas, gráficos, Relatório | `build/app.js` |
| textos/estrutura das páginas | `build/template.html` |
| frequência/forma do deploy | `.github/workflows/deploy.yml` + `SETUP-CRON.md` |
