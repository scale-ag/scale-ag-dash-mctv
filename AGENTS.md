# AGENTS.md — Dash Funil de Vendas · MCTV (aba Criativos)

> Contexto completo em **`CLAUDE.md`** (mesma pasta) — leia-o antes de mexer no
> projeto. Este arquivo é um resumo para agentes/ferramentas que seguem a
> convenção `AGENTS.md`.

## O essencial

- **Repo:** `scale-ag/scale-ag-dash-mctv` · **Pages:** https://scale-ag.github.io/scale-ag-dash-mctv/
- **Fonte única:** aba `Criativos` (gid `1077415496`) da planilha `1X6XKBc65KVsfrFIoBHsk_rxC4iUrzu0l9VSYoaF6PHY`, somente leitura. 1 linha = anúncio × dia.
- **Funil:** `Gasto → Impressões → Alcance → Cliques → Checkouts → Vendas → Faturamento`.
- **Derivados no build:** Cliques = Gasto ÷ CPC (a coluna de cliques vem vazia); Faturamento = ROAS × Gasto; métricas de vídeo convertidas em contagens para somar certo.
- **Imposto:** `TAX_FACTOR=1.13806`; toggle "Imposto Meta" **ligado por padrão**; nunca aplicado ao faturamento.
- **Sem Insights por IA** e sem cruzamento com planilha de queries (a enviada era de outro cliente).
- **Build:** `python build/build.py --criativos-file criativos.csv --out dist/index.html` (sem o flag, busca o CSV público — precisa alcançar `docs.google.com`).

## Onde mexer

| Quero mudar… | Arquivo |
|---|---|
| planilha, colunas, imposto, limiares de amostra, metas padrão | `build/build.py` |
| cores (tema claro/escuro, heatmap) | `build/identidade-visual.css` |
| layout/componentes | `build/estilos.css` |
| cálculos, tabelas, gráficos, Relatório | `build/app.js` |
| textos/estrutura das páginas | `build/template.html` |
| frequência/forma do deploy | `.github/workflows/deploy.yml` + `SETUP-CRON.md` |
