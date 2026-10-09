"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const FIN = DATA.fin, META = DATA.meta, B = DATA.build;
const TAX = B.tax_factor || 1.0;

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
// lucro pode ser negativo: "-R$ 190,59" (e não "R$ -190,59")
const brl=v=>(v==null||!isFinite(v))?'-':(v<0?'-R$ '+nf2.format(-v):'R$ '+nf2.format(v));
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const roasf=v=>(v==null||!isFinite(v))?'-':nf2.format(v)+'x';
const dimf=v=>v==null?'-':String(v);
const norm=s=>(s==null?'':String(s)).trim().toLowerCase();
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const brdate=d=>{ if(!d) return '-'; const p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const weekday=d=>{ const dt=new Date(d+'T00:00:00'); return isNaN(dt)?'':WD[dt.getDay()]; };

/* ---------------- date helpers ---------------- */
function pad(n){return String(n).padStart(2,'0');}
function dstr(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
function addDays(s,n){const dt=new Date(s+'T00:00:00');dt.setDate(dt.getDate()+n);return dstr(dt);}
const TODAY = B.today || B.date_max;

/* ---------------- STATE ---------------- */
const STATE = {
  page:'geral', from:(()=>{const [y,m]=TODAY.split('-'); return `${y}-${m}-01`;})(), to:TODAY, preset:'mes', tax:true,
  selDays:new Set(),
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),   // filtro cruzado campanha/conjunto/anúncio
  dimMetric:'gasto',   // métrica dos gráficos de linha da hierarquia
  sort:{}, colw: JSON.parse(localStorage.getItem('dm_colw')||'{}'),
};
const taxf = ()=> STATE.tax ? TAX : 1;

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
const inRange=d=>d && (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
/* Duas fontes (ver build.py):
   META = queries do gerenciador, 1 linha = anúncio × dia (gasto, impressões,
          cliques no link, visualizações, Initiate Checkout, vendas, fat. bruto);
   FIN  = aba Financeiro, 1 linha = dia, só com o que as queries não têm:
          fl = faturamento líquido e cl = cliques (todos).
   fl/cl só existem por DIA: com filtro de campanha/conjunto/anúncio ativo eles
   ficam null ("-") — atribuí-los a um anúncio seria inventar número. */
const dimActive=()=>!!(STATE.mSelC.size||STATE.mSelA.size||STATE.mSelAd.size);
/* recorte pelo filtro cruzado. ex = dimensão a NÃO filtrar — cada tabela da
   hierarquia ignora a própria seleção para continuar mostrando as linhas irmãs
   (multi-seleção com Ctrl). */
function dimFilter(rows, ex){
  if(ex!=='C'&&STATE.mSelC.size) rows=rows.filter(r=>STATE.mSelC.has(r.c));
  if(ex!=='A'&&STATE.mSelA.size) rows=rows.filter(r=>STATE.mSelA.has(r.s));
  if(ex!=='D'&&STATE.mSelAd.size) rows=rows.filter(r=>STATE.mSelAd.has(r.a));
  return rows; }
const metaActive = ex=> dimFilter(META.filter(r=>dateActive(r.d)), ex);
/* período do seletor IGNORANDO os dias clicados: é o que a tabela diária lista,
   para dar para clicar (Ctrl) em outros dias depois do primeiro */
const metaRange  = ex=> dimFilter(META.filter(r=>inRange(r.d)), ex);
/* linhas do recorte atual para funil/KPIs/gráficos: queries + (sem filtro de
   dimensão) as linhas diárias da Financeiro */
const scopeRows = ()=> metaActive().concat(dimActive()?[]:FIN.filter(r=>dateActive(r.d)));
const scopeRange= ()=> metaRange().concat(dimActive()?[]:FIN.filter(r=>inRange(r.d)));
/* dias de calendário entre f e t (inclusive) */
const nDaysBetween=(f,t)=>Math.round((new Date(t+'T00:00:00')-new Date(f+'T00:00:00'))/86400000)+1;
/* nº de dias do recorte (média por dia): dias clicados ou dias de calendário do
   período, limitado ao intervalo que a planilha cobre (do 1º ao último dia com
   linha — o dia de hoje só conta depois que a linha dele entra na aba). Dia sem
   linha no meio do intervalo conta como dia sem gasto. */
function periodDays(){
  if(STATE.selDays.size) return STATE.selDays.size;
  const f=[STATE.from,B.date_min].filter(Boolean).sort().pop(), t=[STATE.to,B.date_max||TODAY].filter(Boolean).sort()[0];
  if(!f||!t||f>t) return 1;
  return nDaysBetween(f,t);
}

/* ---------------- aggregation ----------------
   Campos: sp=gasto no Meta (sem imposto) · im=impressões · lc=cliques no link ·
   lpv=visualizações da página de destino · ic=Initiate Checkout (checkouts
   iniciados) · vd=vendas · fb=faturamento bruto (valor das compras) — das
   queries; fl=faturamento líquido · cl=cliques (todos) — da Financeiro, por dia.
   Tudo é SOMA, então as taxas (CTR, Connect Rate, taxas do checkout, ROAS, CPA)
   saem ponderadas pelo volume do período, e não pela média das taxas.
   O imposto (taxf) multiplica SÓ o gasto; faturamento nunca leva imposto, então
   ROAS = faturamento ÷ (gasto × imposto) e Lucro = líquido − gasto × imposto. */
const FIELDS=['sp','im','lc','lpv','ic','vd','fb','fl','cl'];
/* dias que a aba Financeiro já tem. As queries costumam trazer o dia de hoje (e
   às vezes ontem) antes da Financeiro: nesses dias o líquido e os cliques (todos)
   ainda NÃO EXISTEM — não são zero. */
const FIN_DAYS=new Set(FIN.map(r=>r.d));
/* além das somas: imF/spF = impressões e gasto só dos dias que a Financeiro
   cobre (base do CTR/CPC, que usam os cliques dela); flPend/clPend = o recorte
   tem dia sem Financeiro com venda (líquido desconhecido) / com tráfego */
const zeroAgg=()=>{ const a={imF:0,spF:0,flPend:0,clPend:0}; FIELDS.forEach(f=>{a[f]=0;}); return a; };
function addTo(a,r){ FIELDS.forEach(f=>{ a[f]+=r[f]||0; });
  if(r.c!=null){                                     // linha das queries (as da Financeiro não têm campanha)
    if(FIN_DAYS.has(r.d)){ a.imF+=r.im||0; a.spF+=r.sp||0; }
    else { if(r.fb>0) a.flPend=1; if(r.im>0||r.lc>0) a.clPend=1; }
  }
  return a; }
/* fl/cl não existem por campanha/conjunto/anúncio: viram null quando o agregado
   não vem do recorte diário completo (fin=false). No recorte completo, o líquido
   vira null se algum dia com venda ainda não está na Financeiro (dia sem venda
   tem líquido 0 de verdade); os cliques somam só os dias cobertos e o CTR/CPC
   usam a mesma base (imF/spF) — viram null se nenhum dia está coberto. */
function gate(a, fin){
  if(!fin){ a.fl=null; a.cl=null; return a; }
  if(a.flPend) a.fl=null;
  if(B.tem_cliques===false || (a.clPend && !a.imF)) a.cl=null;
  return a; }
const finOn=()=>!dimActive();
/* dias do recorte com venda que a Financeiro ainda não trouxe (líquido pendente) */
const finPend=rows=>[...new Set(rows.filter(r=>r.c!=null&&r.fb>0&&!FIN_DAYS.has(r.d)).map(r=>r.d))].sort();
/* por que o lucro/líquido aparece "-": filtro de dimensão ou dia pendente */
function flMsg(rows){ if(dimActive()) return SO_DIA;
  const p=finPend(rows); return p.length?'aba Financeiro ainda sem '+p.map(d=>brdate(d).slice(0,5)).join(', '):'—'; }
function derive(a){
  const g=a.sp*taxf(), hasFl=a.fl!=null, hasCl=a.cl!=null;
  const lucro=hasFl?a.fl-g:null;
  return {gasto:g, lucro,
    cpm:a.im?g/a.im*1000:null, ctr:hasCl&&a.imF?a.cl/a.imF:null, cpc:hasCl&&a.cl?a.spF*taxf()/a.cl:null,
    ctrl:a.im?a.lc/a.im:null, cpcl:a.lc?g/a.lc:null,
    connect:a.lc?a.lpv/a.lc:null, cplpv:a.lpv?g/a.lpv:null,
    // Initiate Checkout: custo e taxas de conversão do checkout
    cpic:a.ic?g/a.ic:null, lcic:a.lc?a.ic/a.lc:null, lpvic:a.lpv?a.ic/a.lpv:null, icv:a.ic?a.vd/a.ic:null,
    cpa:a.vd?g/a.vd:null, convpag:a.lpv?a.vd/a.lpv:null,
    roas:g?a.fb/g:null, roasl:hasFl&&g?a.fl/g:null, ticket:a.vd?a.fb/a.vd:null,
    taxa:hasFl&&a.fb?(a.fb-a.fl)/a.fb:null,      // taxas da plataforma de venda (% do bruto)
    roi:hasFl&&g?lucro/g:null, margem:hasFl&&a.fb?lucro/a.fb:null};
}
/* fin = o recorte inclui as linhas diárias da Financeiro (sem filtro de dimensão) */
function totals(rows, fin){ const a=zeroAgg(); rows.forEach(r=>addTo(a,r)); return gate(a, fin); }
function buildAgg(rows, dim){
  const m={};
  rows.forEach(r=>{ const k=r[dim]; if(k==null) return; addTo(m[k]||(m[k]=zeroAgg()), r); });
  Object.values(m).forEach(a=>gate(a,false));
  return m;
}
/* agregação diária */
function daily(rows, fin){
  const days={};
  rows.forEach(r=>{ if(!r.d) return; addTo(days[r.d]||(days[r.d]={d:r.d,...zeroAgg()}), r); });
  return Object.values(days).map(x=>gate(x,fin)).sort((a,b)=>a.d<b.d?-1:1);
}
/* semana começando na segunda-feira (chave = data da segunda) */
function weekStart(d){ const dt=new Date(d+'T00:00:00'); const dow=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-dow); return dstr(dt); }

/* ---------------- generic interactive table ---------------- */
/* cfg: {id, cols:[{key,label,type,dim?,heat?:'gasto'|'ck'|'connect'|'vendas'|'roas',cls?}], rows:[{k,cells:{}, raw?}],
        total:{}, selectable, selSet, onSelect } */
// medição de texto (canvas) p/ auto-largura de coluna — "caiba o nome inteiro" (dim)
// e auto-ajuste em duplo-clique na borda, como Google Sheets / Looker Studio.
let _measureCtx=null;
function textWidth(s, font){
  if(!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  _measureCtx.font=font;
  return _measureCtx.measureText(s==null?'':String(s)).width;
}
const fmtStd=(t,v)=> t==='roas'?roasf(v):t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='date'?brdate(v):t==='html'?'':dimf(v);
const FONT_DIM='500 12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_NUM='12.5px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
const FONT_HEAD='700 11px "Segoe UI",system-ui,-apple-system,Roboto,sans-serif';
function autoDimWidth(cfg,c){
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_DIM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_DIM); if(w>max) max=w; }
  // +4%: a medição no canvas sai alguns px menor que o texto renderizado na
  // célula (nomes longos com " | " cortavam com "…" por 3 a 13px)
  return Math.max(140, Math.min(1000, Math.round(max*1.04)+34)); // + padding (10+10) + folga p/ seta de ordenação
}
function autoColWidth(cfg,c){
  if(c.type==='dim') return autoDimWidth(cfg,c);
  let max=textWidth(c.label||'',FONT_HEAD);
  (cfg.rows||[]).forEach(r=>{ const w=textWidth(fmtStd(c.type,r.cells[c.key]),FONT_NUM); if(w>max) max=w; });
  if(cfg.total && cfg.total[c.key]!=null){ const w=textWidth(fmtStd(c.type,cfg.total[c.key]),FONT_NUM); if(w>max) max=w; }
  return Math.max(60, Math.min(260, Math.round(max)+24));
}
function colWidth(cfg,c){ const saved=(STATE.colw[cfg.id]||{})[c.key];
  // dimensão nunca trunca: mesmo com largura salva (redimensionada à mão numa
  // sessão anterior), nunca fica MENOR que o necessário p/ caber o nome mais
  // longo de agora — senão um nome novo/maior que o salvo volta a cortar com "…".
  if(c.type==='dim'){ const auto=autoDimWidth(cfg,c); return saved?Math.max(saved,auto):auto; }
  if(saved) return saved;
  // "R$ 1.487,42" não cabia nos 92px padrão (cortava com "…"); e o título
  // (CHECKOUTS, RET. 25%→50%) também não pode cortar: +30 = padding + seta de
  // ordenação, ×1,08 = letter-spacing do cabeçalho em caixa alta
  const base=c.w||(c.type==='date'?96:c.type==='brl'?110:92);
  return Math.max(base, Math.ceil(textWidth(String(c.label||'').toUpperCase(),FONT_HEAD)*1.08)+30); }
function renderTable(cfg){
  // tabelas com colunas travadas EM BANDA (band:'l'/'r' — não confundir com o
  // stk:'l1'/'r' do rel-adt, esquema à parte, só 1 coluna de cada lado) usam
  // um motor separado — ver renderSplitTable — porque aqui há VÁRIAS colunas
  // coladas de cada lado, e a soma delas pode superar a largura do card:
  // position:sticky por célula nesse caso gruda as bandas por cima do miolo
  // em vez de ao lado (o miolo fica permanentemente encoberto, sem posição
  // de scroll que o revele). 3 <table> lado a lado, cada uma só do tamanho
  // que precisa, não tem esse problema.
  if(cfg.cols.some(c=>c.band)) return renderSplitTable(cfg);
  const table=document.getElementById(cfg.id); if(!table) return;
  table.classList.toggle('dt-center', !!cfg.center);   // Mar01: dados centralizados
  const fit=!!cfg.fit;                                  // fit: cabe 100% da largura, sem scroll
  table.classList.toggle('dt-fit', fit);
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && (c.type==='dim'||c.type==='date')){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      // "-" (sem valor) vai sempre para o fim: no crescente, um CPA "-" (sem venda)
      // não pode aparecer como o mais barato
      const na=va==null||!isFinite(va), nb=vb==null||!isFinite(vb);
      if(na||nb) return na===nb?0:(na?1:-1);
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  // métricas de custo sempre com "R$" (mesmo em tabelas densas/fit) — % nas de taxa, sem símbolo nas demais
  const fmt=(t,v)=> t==='roas'?roasf(v):t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='date'?brdate(v):t==='html'?(v==null?'-':String(v)):escHtml(dimf(v));
  const widths=fit?[]:cfg.cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
  // modo fit: dimensão/data com largura fixa; colunas numéricas dividem o resto por igual
  const fitW=c=> c.w?c.w+'px' : c.type==='date'?'74px' : c.type==='dim'?(c.big?'210px':'116px') : '';
  const colgroup='<colgroup>'+cfg.cols.map((c,i)=>{
    const w=fit?fitW(c):(widths[i]+'px'); return `<col${w?` style="width:${w}"`:''}>`;
  }).join('')+'</colgroup>';
  const esc=s=>String(s==null?'':s).replace(/"/g,'&quot;');
  const stkCls=c=>c.stk?' stk-'+c.stk:'';
  let thead='<thead><tr>'+cfg.cols.map((c,i)=>{
    const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
    return `<th class="${c.type==='dim'?'dim ':''}${sc}${stkCls(c)}" data-k="${c.key}" data-ci="${i}" title="${esc(c.label)}">${c.label}${fit?'':'<span class="rsz"></span>'}</th>`;
  }).join('')+'</tr></thead>';
  // title = valor SEMPRE completo (mesmo em fit, onde a célula pode abreviar/cortar) — passe o mouse p/ ver
  let tbody='<tbody>'+rows.map(r=>{
    const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
    const tds=cfg.cols.map(c=>{
      const v=r.cells[c.key]; let bg='';
      if(c.heat && ext[c.key]) bg=`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`;
      const cls=(c.type==='dim'?'dim':'')+(c.cls&&c.cls(r)?' '+c.cls(r):'')+stkCls(c);
      const ttl=c.type==='html'?'':` title="${esc(fmtStd(c.type,v))}"`;
      return `<td class="${cls}" style="${bg}"${ttl}>${fmt(c.type,v)}</td>`;
    }).join('');
    return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
  }).join('')+'</tbody>';
  let tfoot='';
  if(cfg.total){ tfoot='<tfoot><tr>'+cfg.cols.map((c,i)=>{
    const v=cfg.total[c.key]; const isFirst=i===0&&v==null;
    const tc=c.cls?c.cls({cells:cfg.total}):'';   // ex.: Lucro negativo em vermelho também no total
    return `<td class="${c.type==='dim'?'dim':''}${tc?' '+tc:''}${stkCls(c)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=fit?'100%':totalW+'px';
  // fit: ocupa o card inteiro, mas nunca abaixo do que cabe sem cortar valor
  // (colunas fixas + ~76px por coluna livre); abaixo disso a tabela rola dentro
  // do card, em vez de espremer Vendas/CPA/ROAS até sumirem
  table.style.minWidth=fit?cfg.cols.reduce((s,c)=>s+(parseInt(fitW(c),10)||76),0)+'px':'';
  table.innerHTML=colgroup+thead+tbody+tfoot;
  const cols=table.querySelector('colgroup').children;
  // sort handlers
  table.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderTable(cfg);
    });
  });
  // resize handlers (drag right border) -> resize the <col>, grow the table
  if(!fit) table.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, ci=+th.dataset.ci, x0=e.clientX;
      const w0=cols[ci].offsetWidth, tw0=table.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); cols[ci].style.width=nw+'px'; table.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw; };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; localStorage.setItem('dm_colw',JSON.stringify(STATE.colw)); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
    // duplo-clique na borda = auto-ajustar largura ao conteúdo (como Sheets/Looker)
    g.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, c=cfg.cols.find(x=>x.key===k);
      const nw=autoColWidth(cfg,c);
      STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
      localStorage.setItem('dm_colw',JSON.stringify(STATE.colw));
      renderTable(cfg);
    });
  });
  // row select
  if(cfg.selectable && cfg.onSelect){
    table.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
  // hook pós-renderização (roda de novo em CADA re-render, inclusive ao ordenar,
  // pra chips/cores customizados nunca sumirem ao clicar num cabeçalho)
  if(cfg.afterRender) cfg.afterRender(table, rows);
}
/* ---------------- tabela "split" (colunas travadas em banda) ----------------
   3 <table> independentes lado a lado (esquerda fixa · meio com scroll
   próprio · direita fixa). Cada seção rola VERTICALMENTE por conta própria
   (max-height igual ao do .tbl-wrap ancestral + overflow-y:auto — ver CSS
   .dt-split-fixed/.dt-split-scroll) e um listener de 'scroll' sincroniza as
   3 (scrollTop) pra se comportarem como uma tabela só. Isso evita as 2
   armadilhas de quando isso era 1 única faixa por posição:
   1) cabeçalho "solto": se só o miolo tem overflow-x:auto, o CSS força
      overflow-y a virar "auto" nele também (canonicalização do spec) —
      mas como o miolo nunca chega a rolar de fato sozinho (cresce até
      caber o conteúdo), ele vira um scroll container que nunca se move,
      e o sticky do thead gruda relativo A ELE, não ao .tbl-wrap que
      realmente rola — daí o cabeçalho "sobe" junto com o resto ao rolar.
   2) banda cobrindo o miolo: position:sticky por célula numa única
      <table> não sobra espaço pro miolo quando (banda esquerda + banda
      direita) > largura do card — o miolo fica permanentemente atrás das
      bandas, sem posição de scroll que o revele.
   Cada seção rolando por si (bounded, overflow-y:auto de verdade) faz o
   sticky nativo funcionar sem ressalva nenhuma, e cada uma só ocupa o
   espaço que ela mesma precisa — cabendo tudo, o flex nem mostra barra de
   rolagem e fica idêntico a uma tabela única. */
function renderSplitTable(cfg){
  const root=document.getElementById(cfg.id); if(!root) return;
  const wrap=root.closest('.tbl-wrap');
  // tela estreita: se a banda travada (nome + Gasto) deixa menos de ~360px para
  // as métricas, o miolo ficaria espremido (no celular a própria banda não
  // cabe). Aí a tabela vira uma só, que rola inteira — o nome continua sem cortar.
  const leftW=cfg.cols.filter(c=>c.band==='l').reduce((sum,c)=>sum+colWidth(cfg,c),0);
  const wrapW=wrap?wrap.clientWidth:0;
  if(wrapW && wrapW-leftW<360){
    if(root.tagName!=='TABLE') root.outerHTML=`<table class="dt" id="${cfg.id}"></table>`;
    return renderTable({...cfg, cols:cfg.cols.map(c=>{ const {band,...rest}=c; return rest; })});
  }
  // posição de rolagem da renderização anterior (cada clique re-renderiza tudo;
  // sem isto a tabela voltava para o topo/esquerda a cada Ctrl+clique)
  const oldMid=root.classList.contains('dt-split')?root.querySelector('.dt-split-scroll'):null;
  const keepTop=oldMid?oldMid.scrollTop:0, keepLeft=oldMid?oldMid.scrollLeft:0;
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && (c.type==='dim'||c.type==='date')){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      // "-" (sem valor) vai sempre para o fim: no crescente, um CPA "-" (sem venda)
      // não pode aparecer como o mais barato
      const na=va==null||!isFinite(va), nb=vb==null||!isFinite(vb);
      if(na||nb) return na===nb?0:(na?1:-1);
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  const fmt=(t,v)=> t==='roas'?roasf(v):t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='date'?brdate(v):t==='html'?(v==null?'-':String(v)):escHtml(dimf(v));
  const esc=s=>String(s==null?'':s).replace(/"/g,'&quot;');
  const leftCols=cfg.cols.filter(c=>c.band==='l'), rightCols=cfg.cols.filter(c=>c.band==='r'), midCols=cfg.cols.filter(c=>!c.band);
  function section(cols){
    const widths=cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
    const colgroup='<colgroup>'+cols.map((c,i)=>`<col style="width:${widths[i]}px">`).join('')+'</colgroup>';
    const thead='<thead><tr>'+cols.map(c=>{
      const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
      return `<th class="${c.type==='dim'?'dim ':''}${sc}" data-k="${c.key}" title="${esc(c.label)}">${c.label}<span class="rsz"></span></th>`;
    }).join('')+'</tr></thead>';
    const tbody='<tbody>'+rows.map(r=>{
      const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
      const tds=cols.map(c=>{
        const v=r.cells[c.key]; let bg='';
        if(c.heat && ext[c.key]) bg=`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`;
        const cls=(c.type==='dim'?'dim':'')+(c.cls&&c.cls(r)?' '+c.cls(r):'');
        const ttl=c.type==='html'?'':` title="${esc(fmtStd(c.type,v))}"`;
        return `<td class="${cls}" style="${bg}"${ttl}>${fmt(c.type,v)}</td>`;
      }).join('');
      return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
    }).join('')+'</tbody>';
    let tfoot='';
    if(cfg.total){ tfoot='<tfoot><tr>'+cols.map(c=>{
      const v=cfg.total[c.key]; const isFirst=cfg.cols.indexOf(c)===0&&v==null;
      return `<td class="${c.type==='dim'?'dim':''}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
    }).join('')+'</tr></tfoot>'; }
    return `<table class="dt${cfg.center?' dt-center':''}" style="width:${totalW}px">${colgroup}${thead}${tbody}${tfoot}</table>`;
  }
  // altura de cada seção = a mesma altura máxima do .tbl-wrap ancestral
  // (tbl-normal/tbl-double/inline) — rolam juntas dentro do mesmo limite
  // visual de sempre, sem precisar que o .tbl-wrap role por fora.
  const maxH=wrap?parseFloat(getComputedStyle(wrap).maxHeight):NaN;
  const hStyle=isFinite(maxH)?` style="max-height:${maxH}px"`:'';
  // troca a própria tag por <div> (um <table> não pode ter <div> como filho —
  // o parser HTML descarta; outerHTML recria o nó com a tag certa). Funciona
  // tanto na 1ª renderização (raiz ainda é a <table> do template) quanto nas
  // seguintes (raiz já é a <div class="dt-split"> da renderização anterior).
  root.outerHTML =
    `<div id="${cfg.id}" class="dt-split">`+
      `<div class="dt-split-fixed dt-split-l"${hStyle}>${section(leftCols)}</div>`+
      `<div class="dt-split-scroll"${hStyle}>${section(midCols)}</div>`+
      `<div class="dt-split-fixed dt-split-r"${hStyle}>${section(rightCols)}</div>`+
    `</div>`;
  const fresh=document.getElementById(cfg.id);
  // A seção do meio é a única com barra de rolagem HORIZONTAL; essa barra come
  // altura do scrollport dela (clientHeight menor). Se as seções fixas ficarem
  // com o mesmo max-height, o rodapé sticky ("Total Geral") delas fica ~7px mais
  // baixo que o do meio e o scroll vertical delas anda um pouco mais — as linhas
  // saem de sincronia (o "degrau"). Descontamos a altura da barra das seções
  // fixas p/ os 3 scrollports terem exatamente a mesma altura útil.
  (function alignScrollports(){
    const mid=fresh.querySelector('.dt-split-scroll'); if(!mid) return;
    const sb=mid.offsetHeight-mid.clientHeight;   // altura da barra horizontal (0 se não houver)
    if(!(sb>0) || !isFinite(maxH)) return;
    fresh.querySelectorAll('.dt-split-fixed').forEach(el=>{ el.style.maxHeight=(maxH-sb)+'px'; });
  })();
  // hover sincronizado: passar o mouse em QUALQUER seção (esquerda/meio/direita)
  // acende a linha correspondente (mesmo índice) nas 3 — senão o :hover nativo
  // só pega a seção sob o cursor, e visualmente parece que só um pedaço da
  // linha "existe" (ver CSS .dt-split table.dt tbody tr:hover desativado).
  const bodyRows=['.dt-split-l','.dt-split-scroll','.dt-split-r'].map(sel=>{
    const t=fresh.querySelector(sel+' table.dt'); return t?[...t.querySelectorAll('tbody tr')]:[];
  });
  // trava de segurança do alinhamento: mesmo com a altura fixa do CSS, qualquer
  // diferença de fração de pixel entre as seções (fonte diferente por SO, zoom
  // do navegador) acumularia linha a linha e viraria "degrau". Aqui a altura
  // REAL de cada linha é medida nas 3 seções e a maior (arredondada p/ cima,
  // em pixel inteiro) é aplicada às 3 — as bordas ficam sempre na mesma altura.
  (function lockRowHeights(){
    const secs=bodyRows.filter(a=>a.length);
    if(secs.length<2) return;
    const n=Math.min(...secs.map(a=>a.length));
    const hs=[]; for(let i=0;i<n;i++) hs.push(Math.ceil(Math.max(...secs.map(a=>a[i].getBoundingClientRect().height))));
    for(let i=0;i<n;i++) secs.forEach(a=>{ a[i].style.height=hs[i]+'px'; });
    // mesma trava p/ cabeçalho e rodapé (se um for 1px mais alto, TODAS as
    // linhas daquela seção descem junto e a tabela inteira sai de sincronia)
    ['thead tr','tfoot tr'].forEach(sel=>{
      const els=[...fresh.querySelectorAll('.dt-split-l '+sel+', .dt-split-scroll '+sel+', .dt-split-r '+sel)]
        .filter(tr=>tr.children.length);
      if(els.length<2) return;
      const h=Math.ceil(Math.max(...els.map(tr=>tr.getBoundingClientRect().height)));
      els.forEach(tr=>{ tr.style.height=h+'px'; });
    });
  })();
  fresh.querySelectorAll('.dt-split-l, .dt-split-scroll, .dt-split-r').forEach(el=>{ el.scrollTop=keepTop; });
  const midNow=fresh.querySelector('.dt-split-scroll'); if(midNow) midNow.scrollLeft=keepLeft;
  rows.forEach((r,i)=>{
    const trio=bodyRows.map(trs=>trs[i]).filter(Boolean);
    trio.forEach(tr=>{
      tr.addEventListener('mouseenter',()=>trio.forEach(t=>t.classList.add('hover-row')));
      tr.addEventListener('mouseleave',()=>trio.forEach(t=>t.classList.remove('hover-row')));
    });
  });
  // as 3 seções rolam verticalmente cada uma por conta própria (CSS acima) —
  // sincroniza scrollTop entre elas pra se comportarem como 1 tabela só,
  // não importa sobre qual seção o mouse rolou.
  const secs=[...fresh.querySelectorAll('.dt-split-l, .dt-split-scroll, .dt-split-r')];
  let syncing=false;
  secs.forEach(el=>el.addEventListener('scroll',()=>{
    if(syncing) return; syncing=true;
    secs.forEach(o=>{ if(o!==el) o.scrollTop=el.scrollTop; });
    requestAnimationFrame(()=>{ syncing=false; });
  }));
  // sort: clicar em QUALQUER cabeçalho (das 3 tabelas) reordena as 3 juntas
  fresh.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderSplitTable(cfg);
    });
  });
  // resize: cada coluna só afeta a largura da SUA seção (as 3 tabelas são
  // independentes, então redimensionar ao vivo não desalinha nada)
  fresh.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, x0=e.clientX;
      const sectionTable=th.closest('table'), ths=[...th.parentElement.children];
      const ci=ths.indexOf(th), col=sectionTable.querySelector('colgroup').children[ci];
      const w0=col.offsetWidth, tw0=sectionTable.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); col.style.width=nw+'px'; sectionTable.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw; };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; localStorage.setItem('dm_colw',JSON.stringify(STATE.colw)); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
    g.addEventListener('dblclick',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, c=cfg.cols.find(x=>x.key===k);
      const nw=autoColWidth(cfg,c);
      STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw;
      localStorage.setItem('dm_colw',JSON.stringify(STATE.colw));
      renderSplitTable(cfg);
    });
  });
  if(cfg.selectable && cfg.onSelect){
    fresh.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
  if(cfg.afterRender) cfg.afterRender(fresh, rows);
}
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante).
   Gasto=vermelho · Initiate Checkout=azul · Connect Rate=ciano · Vendas=verde · ROAS=amarelo. */
const HEAT_HUE={gasto:'--heat-gasto', ck:'--heat-ck', connect:'--heat-connect', vendas:'--heat-vendas', roas:'--heat-roas'};
function heat(v,lo,hi,kind){
  if(v==null||!isFinite(v)||hi===lo||!HEAT_HUE[kind]) return 'transparent';
  const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  const c=hx2rgb(cvar(HEAT_HUE[kind]));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.06+0.5*t).toFixed(3)})`;
}
function toggleSet(set,key,ctrl,others){
  if(ctrl){ set.has(key)?set.delete(key):set.add(key); }
  else { const only=set.has(key)&&set.size===1; set.clear(); if(!only) set.add(key); }
  if(others) others.forEach(s=>s.clear());
}

/* ---------------- funil ---------------- */
function funnelHTML(steps){ return steps.map(s=>`
    <div class="step ${s[3]?'na':''} ${s[4]||''}"><div class="step-main"><div class="m-label">${s[0]}</div><div class="m-val">${s[1]}</div></div>
    <div class="secs">${s[2].map(x=>`<div><span class="s-label">${x[0]}</span><span class="s-val">${x[1]}</span></div>`).join('')}</div></div>`).join(''); }
/* etapas do funil — a Visão Geral e o Relatório mostram todas; o Tráfego vai
   até as Vendas. Cliques (todos), faturamento líquido e lucro só existem por dia
   (aba Financeiro): com filtro de campanha/conjunto/anúncio a etapa fica apagada
   com "-". */
function funnelSteps(t){
  const dv=derive(t), semCl=t.cl==null, semFl=t.fl==null;
  return [
    ['Gasto Total', brl(dv.gasto), [], false, 'hl-gasto'],
    ['Impressões', intf(t.im), [['CPM',brl(dv.cpm)]]],
    ['Cliques (todos)', semCl?'-':intf(t.cl), [['CTR',pct(dv.ctr)],['CPC',brl(dv.cpc)]], semCl],
    ['Cliques no link', intf(t.lc), [['CTR do link',pct(dv.ctrl)],['Custo/clique',brl(dv.cpcl)]]],
    ['Visualizações da página', intf(t.lpv), [['Connect Rate',pct(dv.connect)],['Custo/visualização',brl(dv.cplpv)]]],
    ['Initiate Checkout', intf(t.ic), [['Custo/IC',brl(dv.cpic)],['Página→IC',pct(dv.lpvic)],['Clique→IC',pct(dv.lcic)]]],
    ['Vendas', intf(t.vd), [['CPA',brl(dv.cpa)],['IC→Venda',pct(dv.icv)]], false, 'hl-venda'],
    ['Faturamento bruto', brl(t.fb), [['ROAS',roasf(dv.roas)],['Ticket médio',brl(dv.ticket)]], false, 'hl-fat'],
    ['Faturamento líquido', brl(t.fl), [['ROAS líquido',roasf(dv.roasl)],['Taxas da venda',pct(dv.taxa)]], semFl],
    ['Lucro Real', brl(dv.lucro), [['ROI',pct(dv.roi)],['Margem',pct(dv.margem)]], semFl, semFl?'':(dv.lucro<0?'hl-gasto':'hl-venda')],
  ];
}
const lucroCls=v=>(v==null||!isFinite(v)||Math.abs(v)<0.005)?'':(v<0?'neg':'pos');

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
/* aviso "sem dados" sobre o canvas (ex.: nenhuma venda no período) — sem ele o
   card fica com um eixo vazio e parece que quebrou. */
function chartEmpty(id, empty, msg){
  const el=document.getElementById(id); if(!el) return;
  const box=el.parentElement; let n=box.querySelector('.chart-empty');
  if(!empty){ if(n) n.remove(); return; }
  if(!n){ n=document.createElement('div'); n.className='chart-empty'; box.appendChild(n); }
  n.textContent=msg||'Sem dados no período';
}
const legendOpts=()=>({labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}});
const dayTitle=d=>brdate(d)+' · '+weekday(d);
/* Evolução diária: Initiate Checkout e Vendas (barras) · Gasto e Faturamento bruto (linhas) */
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !d.length, 'Sem dados no período');
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const cCk=cvar('--chart-ck'), cVd=cvar('--chart-vendas'), cGasto=cvar('--chart-gasto'), cFat=cvar('--chart-fat')||cink();
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Initiate Checkout',data:d.map(x=>x.ic),backgroundColor:cCk,yAxisID:'y',borderRadius:3,order:4},
      {type:'bar',label:'Vendas',data:d.map(x=>x.vd),backgroundColor:cVd,yAxisID:'y',borderRadius:3,order:3},
      {type:'line',label:'Gasto',data:d.map(x=>+(x.sp*taxf()).toFixed(2)),borderColor:cGasto,backgroundColor:cGasto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:1},
      {type:'line',label:'Faturamento bruto',data:d.map(x=>+x.fb.toFixed(2)),borderColor:cFat,backgroundColor:cFat,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:legendOpts(),
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'IC · Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
/* aviso dos gráficos que dependem do faturamento líquido (só existe por dia) */
const MSG_SO_DIA='Lucro só existe por dia (aba Financeiro) — remova o filtro de campanha/conjunto/anúncio';
const SO_DIA='só por dia (aba Financeiro)';
/* Lucro Real por dia (líquido − gasto com imposto): barra verde = lucro ·
   vermelha = prejuízo. Dias sem gasto e sem faturamento ficam de fora. */
function lucroChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  // com filtro de dimensão não há líquido em dia nenhum; sem filtro, só some o
  // dia que a Financeiro ainda não trouxe
  const semFl=dimActive();
  const rows=semFl?[]:d.filter(x=>x.fl!=null&&(x.sp>0||x.fl>0));
  chartEmpty(id, !rows.length, semFl?MSG_SO_DIA:'Sem gasto nem faturamento no período');
  const vals=rows.map(x=>+(x.fl-x.sp*taxf()).toFixed(2));
  const good=cvar('--good'), bad=cvar('--bad'), mut=cmuted();
  charts[id]=new Chart(el,{type:'bar',
    data:{labels:rows.map(x=>x.d.slice(5)), datasets:[{label:'Lucro',data:vals,backgroundColor:vals.map(v=>v>=0?good:bad),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>c.length?dayTitle(rows[c[0].dataIndex].d):'',label:c=>'Lucro: '+brl(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()}}}}});
}
/* Retorno acumulado no período: gasto (com imposto) × faturamento líquido. Onde
   a linha verde passa a vermelha, o período empatou. */
function acumChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const semFl=dimActive();
  d=semFl?[]:d.filter(x=>x.fl!=null);   // dia ainda sem Financeiro fica de fora das duas curvas
  chartEmpty(id, !d.length, semFl?MSG_SO_DIA:'Sem dados no período');
  let cg=0, cf=0; const G=[], F=[];
  d.forEach(x=>{ cg+=x.sp*taxf(); cf+=x.fl; G.push(+cg.toFixed(2)); F.push(+cf.toFixed(2)); });
  const mut=cmuted(), cG=cvar('--chart-gasto'), cF=cvar('--good');
  charts[id]=new Chart(el,{type:'line',
    data:{labels:d.map(x=>x.d.slice(5)), datasets:[
      {label:'Gasto acumulado',data:G,borderColor:cG,backgroundColor:cG,borderWidth:2,pointRadius:1.5,tension:.2},
      {label:'Fat. líquido acumulado',data:F,borderColor:cF,backgroundColor:cF,borderWidth:2,pointRadius:1.5,tension:.2}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:8,usePointStyle:true,font:{size:10}}},
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>c.dataset.label+': '+brl(c.raw),
          footer:c=>c.length?'Lucro acumulado: '+brl(F[c[0].dataIndex]-G[c[0].dataIndex]):''}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()}}}}});
}
/* Initiate Checkout e vendas somados por dia da semana (segunda a domingo) */
function weekdayChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const ORDER=[1,2,3,4,5,6,0], ck=Array(7).fill(0), vd=Array(7).fill(0);
  d.forEach(x=>{ const w=new Date(x.d+'T00:00:00').getDay(); ck[w]+=x.ic; vd[w]+=x.vd; });
  chartEmpty(id, !ck.some(Boolean)&&!vd.some(Boolean), 'Nenhum Initiate Checkout no período');
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar',
    data:{labels:ORDER.map(i=>WD[i]), datasets:[
      {label:'Initiate Checkout',data:ORDER.map(i=>ck[i]),backgroundColor:cvar('--chart-ck'),borderRadius:3},
      {label:'Vendas',data:ORDER.map(i=>vd[i]),backgroundColor:cvar('--chart-vendas'),borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:cink(),boxWidth:8,usePointStyle:true,font:{size:10}}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+intf(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:mut,font:{size:9},precision:0},grid:{color:cgrid()}}}}});
}
/* barras de TAXA: recebe a lista na ordem do funil e rotula em % */
function hbarPct(id, arr, color, emptyMsg){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !arr.length, emptyMsg);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabelsPct],
    data:{labels:arr.map(x=>x.label), datasets:[{label:'%',data:arr.map(x=>x.v),backgroundColor:color||cvar('--chart-connect'),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:52}},
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>arr[c[0].dataIndex].label,label:c=>pct(c.raw)+(arr[c.dataIndex]&&arr[c.dataIndex].aux?' · '+arr[c.dataIndex].aux:'')}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>nf0.format(v*100)+'%'},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10}},grid:{display:false}}}}});
}
const barLabelsPct={id:'barLabelsPct',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(v==null)return; ctx.fillText(pct(v),el.x+5,el.y);});ctx.restore();}};
/* taxas de conversão do funil no período, etapa a etapa */
function convChart(id, t){
  const dv=derive(t);
  const arr=[
    {label:'Connect Rate', v:dv.connect, aux:intf(t.lpv)+' visualizações de '+intf(t.lc)+' cliques no link'},
    {label:'Página → IC', v:dv.lpvic, aux:intf(t.ic)+' IC de '+intf(t.lpv)+' visualizações'},
    {label:'Clique → IC', v:dv.lcic, aux:intf(t.ic)+' IC de '+intf(t.lc)+' cliques no link'},
    {label:'IC → Venda', v:dv.icv, aux:intf(t.vd)+' vendas de '+intf(t.ic)+' Initiate Checkout'},
    {label:'Página → Venda', v:dv.convpag, aux:intf(t.vd)+' vendas de '+intf(t.lpv)+' visualizações'},
  ].filter(x=>x.v!=null&&isFinite(x.v));
  hbarPct(id, arr, cvar('--chart-connect'), 'Sem visitas à página no período');
}
/* Tráfego diário: cliques no link e visualizações (barras) · custo por
   visualização (linha, R$) */
function trafficCombo(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !d.length, 'Sem dados no período');
  const mut=cmuted(), gr=cgrid(), cLc=cvar('--chart-lc'), cLpv=cvar('--chart-lpv'), cCusto=cvar('--chart-cpa');
  charts[id]=new Chart(el,{
    data:{labels:d.map(x=>x.d.slice(5)), datasets:[
      {type:'bar',label:'Cliques no link',data:d.map(x=>x.lc),backgroundColor:cLc,yAxisID:'y',borderRadius:3,order:3},
      {type:'bar',label:'Visualizações',data:d.map(x=>x.lpv),backgroundColor:cLpv,yAxisID:'y',borderRadius:3,order:2},
      {type:'line',label:'Custo por visualização',data:d.map(x=>x.lpv?+(x.sp*taxf()/x.lpv).toFixed(2):null),borderColor:cCusto,backgroundColor:cCusto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,spanGaps:true,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:legendOpts(),
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(c.raw):intf(c.raw))}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Cliques · Visualizações',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
/* linhas diárias de uma ou mais taxas (Connect Rate, custos por etapa) */
function lineDaily(id, d, series, fmt, axis, emptyMsg){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const dsets=series.map(s=>({label:s.label,
    data:d.map(x=>{ const v=s.fn(x); return (v==null||!isFinite(v))?null:+v.toFixed(4); }),
    borderColor:s.color, backgroundColor:s.color, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true}));
  chartEmpty(id, !dsets.some(ds=>ds.data.some(v=>v!=null)), emptyMsg);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'line',
    data:{labels:d.map(x=>x.d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:series.length>1?legendOpts():{display:false},
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>c.dataset.label+': '+fmt(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{beginAtZero:true,ticks:{color:mut,font:{size:9},callback:axis},grid:{color:cgrid()}}}}});
}
/* Donut de conversão (Initiate Checkout → venda): verde = checkout que virou
   venda · cinza = abandonou. */
function donutCkVenda(id, vd, ck){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !ck, 'Nenhum Initiate Checkout no período');
  const naoConv=Math.max(0,ck-vd);
  charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:['Virou venda','Não comprou'],datasets:[{data:[vd,naoConv],
      backgroundColor:[cvar('--good'),cvar('--bar-noq')],borderColor:cvar('--surface'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+intf(c.raw)+(ck?' ('+pct(c.raw/ck)+')':'')}}}}});
  const el2=document.getElementById('mConvPct'); if(el2) el2.textContent=pct(ck?vd/ck:null);
}

/* ---------------- gráficos de linha da hierarquia ----------------
   1 linha por campanha/conjunto/anúncio, na métrica escolhida nos botões. A
   legenda é HTML (lista rolável) porque a do Chart.js corta nomes longos.
   Clique numa linha da legenda OU numa linha do gráfico filtra a tabela (selDim);
   quando a tabela já tem seleção, o gráfico plota SÓ as linhas selecionadas (a
   legenda continua listando todas p/ dar pra trocar a seleção). */
const DIM_METRICS={
  gasto:{label:'Gasto',   fn:d=>d.gasto, fmt:brl, axis:v=>'R$'+nf0.format(v), suf:'de gasto'},
  ctr:  {label:'CTR',     fn:d=>d.ctrl,  fmt:pct, axis:v=>nf1.format(v*100)+'%', suf:'CTR do link'},
  ic:   {label:'IC',      fn:(d,a)=>a.ic, fmt:intf, axis:v=>nf0.format(v), suf:'Initiate Checkout'},
  cpic: {label:'Custo/IC',fn:d=>d.cpic,  fmt:brl, axis:v=>'R$'+nf0.format(v), suf:'por IC'},
  cpa:  {label:'CPA',     fn:d=>d.cpa,   fmt:brl, axis:v=>'R$'+nf0.format(v), suf:'por venda'},
};
const DIM_KEY={C:'c', A:'s', D:'a'};
function dimChart(id, rows, agg, dimChar, selSet){
  destroy(id); const el=document.getElementById(id); const legEl=document.getElementById(id+'Legend');
  if(!el) return;
  const dim=DIM_KEY[dimChar];
  const M=DIM_METRICS[STATE.dimMetric]||DIM_METRICS.gasto;
  const days=[...new Set(rows.filter(r=>r.d).map(r=>r.d))].sort();
  // membros com gasto ou checkout, do maior para o menor gasto — ordem estável p/ cor e legenda
  const members=Object.keys(agg).filter(k=>agg[k].sp>0||agg[k].ic>0||agg[k].vd>0).sort((a,b)=>agg[b].sp-agg[a].sp);
  const pal=chartPalette(), mut=cmuted();
  const plotMembers = (selSet&&selSet.size) ? members.filter(m=>selSet.has(m)) : members;
  const dsets=plotMembers.map(mv=>{
    const idx=members.indexOf(mv);
    const byDay={}; days.forEach(d=>{byDay[d]=zeroAgg();});
    rows.forEach(r=>{ if(r[dim]===mv && r.d!=null && byDay[r.d]) addTo(byDay[r.d],r); });
    const data=days.map(d=>{ const a=gate(byDay[d],false), v=M.fn(derive(a),a); return (v==null||!isFinite(v))?null:+v.toFixed(4); });
    const col=pal[idx%pal.length];
    return {label:String(mv), data, borderColor:col, backgroundColor:col, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true};
  });
  chartEmpty(id, !dsets.some(ds=>ds.data.some(v=>v!=null&&v!==0)), 'Sem '+M.label+' no período');
  charts[id]=new Chart(el,{type:'line',
    data:{labels:days.map(d=>d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
      // setTimeout: selDim re-renderiza e destrói ESTE gráfico, e o Chart.js
      // ainda está despachando o evento nele (TypeError em afterEvent)
      onClick:(e,act)=>{ if(act.length){ const idx=act[0].datasetIndex;
        if(idx!=null&&dsets[idx]){ const ctrl=!!(e.native&&(e.native.ctrlKey||e.native.metaKey));
          setTimeout(()=>selDim(dimChar,dsets[idx].label,ctrl),0); } } },
      plugins:{legend:{display:false},
        tooltip:{displayColors:true,
          callbacks:{title:c=>c.length?dayTitle(days[c[0].dataIndex]):'', label:c=>[c.dataset.label, M.fmt(c.raw)+' '+M.suf]}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:M.axis},grid:{color:cgrid()},beginAtZero:true}}
    }
  });
  if(legEl){
    legEl.innerHTML = members.map((mv,idx)=>{
      const col=pal[idx%pal.length];
      const v = agg[mv]!=null ? M.fn(derive(agg[mv]),agg[mv]) : null;
      const sel = !!(selSet && selSet.has(mv));
      return `<div class="cl-row${sel?' sel':''}" data-mv="${escHtml(mv)}" title="${escHtml(mv)}">`
        +`<span class="cl-swatch" style="background:${col}"></span>`
        +`<span class="cl-name">${escHtml(mv)}</span>`
        +`<span class="cl-val">${M.fmt(v)}</span></div>`;
    }).join('');
    legEl.querySelectorAll('.cl-row').forEach(row=>{
      // dataset.mv volta desescapado pelo próprio navegador (o HTML veio de escHtml)
      row.addEventListener('click',e=>selDim(dimChar,row.dataset.mv,e.ctrlKey||e.metaKey));
    });
  }
}
/* botões de métrica dos gráficos da hierarquia (um conjunto acima de cada gráfico,
   todos ligados ao mesmo STATE.dimMetric) */
function renderDimMetricBtns(){
  document.querySelectorAll('.dm-switch').forEach(host=>{
    host.innerHTML=Object.entries(DIM_METRICS).map(([k,m])=>
      `<button type="button" class="dm-btn${STATE.dimMetric===k?' active':''}" data-m="${k}">${m.label}</button>`).join('');
    host.querySelectorAll('.dm-btn').forEach(b=>b.addEventListener('click',()=>{ STATE.dimMetric=b.dataset.m; renderAll(); }));
  });
}

/* ---------------- KPI cards ---------------- */
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv ${k.tone||''}">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

/* ---------------- tabelas diárias ---------------- */
/* Visão Geral / Relatório: o resultado do dia, do gasto ao lucro. */
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date',w:86},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto',w:92},
  {key:'ic',label:'IC',type:'int',heat:'ck'},{key:'cpic',label:'Custo/IC',type:'brl',w:84},
  {key:'vd',label:'Vendas',type:'int',heat:'vendas'},{key:'icv',label:'IC→Venda',type:'pct',w:84},
  {key:'cpa',label:'CPA',type:'brl',w:84},{key:'fb',label:'Fat. bruto',type:'brl',w:92},
  {key:'fl',label:'Fat. líq.',type:'brl',w:92},
  {key:'lucro',label:'Lucro',type:'brl',w:96,cls:r=>lucroCls(r.cells.lucro)},
  {key:'roas',label:'ROAS',type:'roas',heat:'roas'},
];
/* Tráfego Meta Ads: do gasto à venda, passando pelo checkout */
const TRAFFIC_COLS=[
  {key:'date',label:'Data',type:'date',w:86},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto',w:92},
  {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl',w:84},
  {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},
  {key:'lc',label:'Cliq. link',type:'int'},{key:'lpv',label:'Visualiz.',type:'int'},
  {key:'connect',label:'Connect',type:'pct',heat:'connect'},{key:'cplpv',label:'Custo/Vis.',type:'brl',w:84},
  {key:'ic',label:'IC',type:'int',heat:'ck'},{key:'cpic',label:'Custo/IC',type:'brl',w:84},
  {key:'lpvic',label:'Pág.→IC',type:'pct'},
  {key:'vd',label:'Vendas',type:'int',heat:'vendas'},{key:'icv',label:'IC→Venda',type:'pct',w:84},
];
function dayCells(x,d,isTotal){
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d),
    gasto:d.gasto, im:x.im, cpm:d.cpm, cl:x.cl, ctr:d.ctr, lc:x.lc, lpv:x.lpv, connect:d.connect, cplpv:d.cplpv,
    ic:x.ic, cpic:d.cpic, lpvic:d.lpvic, lcic:d.lcic, icv:d.icv,
    vd:x.vd, cpa:d.cpa, fb:x.fb, fl:x.fl, lucro:d.lucro, roas:d.roas};
}
/* tabela diária: lista o período inteiro do seletor (último dia no topo); os
   dias clicados ficam destacados e são o que o resto da página mostra. Segue o
   filtro de campanha/conjunto/anúncio. */
function renderDailyTable(id, cols){
  const fin=finOn(), fR=scopeRange(), tR=totals(fR,fin);
  const dl=daily(fR,fin).reverse();
  renderTable({id, cols, center:true, fit:true,
    rows:dl.map(x=>({k:x.d, cells:dayCells(x,derive(x))})),
    total:dayCells({...tR,d:null},derive(tR),true),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}

/* ---------------- PAGE 1: Visão Geral ---------------- */
/* IDs dos elementos por página — a Visão Geral e o Relatório compartilham o
   MESMO corpo (renderGeralCore), só mudam os alvos no DOM. */
const GERAL_IDS={funnel:'geralFunnel',kpisCk:'geralKpisCk',kpis2:'geralKpis2',combo:'gCombo',lucro:'gLucro',acum:'gAcum',wd:'gWd',conv:'gConv',daily:'gDaily'};
const REL_IDS  ={funnel:'relFunnel', kpisCk:'relKpisCk', kpis2:'relKpis2', combo:'rCombo',lucro:'rLucro',acum:'rAcum',wd:'rWd',conv:'rConv',daily:'rDaily'};
/* cards do Initiate Checkout: volume, custo e as taxas de conversão do checkout */
function checkoutKpis(t, nDays){
  const dv=derive(t);
  return [
    {label:'Initiate Checkout',val:intf(t.ic),aux:'Custo/IC '+brl(dv.cpic)+' · '+numf(t.ic/nDays)+' por dia'},
    {label:'Página → IC',val:pct(dv.lpvic),aux:intf(t.ic)+' IC de '+intf(t.lpv)+' visualizações da página'},
    {label:'Clique no link → IC',val:pct(dv.lcic),aux:intf(t.ic)+' IC de '+intf(t.lc)+' cliques no link'},
    {label:'IC → Venda',val:pct(dv.icv),aux:intf(t.vd)+' venda'+(t.vd===1?'':'s')+' de '+intf(t.ic)+' IC · '+intf(Math.max(0,t.ic-t.vd))+' sem compra'},
  ];
}
function renderGeral(){ renderGeralCore(GERAL_IDS); }
function renderGeralCore(ids){
  const fin=finOn(), rows=scopeRows();
  const t=totals(rows,fin), dv=derive(t), g=dv.gasto;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(funnelSteps(t));

  const dd=daily(rows,fin), nDays=periodDays();
  document.getElementById(ids.kpisCk).innerHTML=checkoutKpis(t,nDays).map(kpiCard).join('');

  // ---- métricas secundárias (não repetem o funil) ----
  // lucro/faturamento líquido só existem por dia: com filtro de campanha/conjunto/
  // anúncio os cards que dependem deles ficam "-"
  const semFl=t.fl==null, porque=semFl?flMsg(rows):'';
  const lucroDia=x=>x.fl-x.sp*taxf();
  const ativos=dd.filter(x=>x.fl!=null&&(x.sp>0||x.fl>0));  // dias com gasto ou faturamento (e com líquido)
  const diasGasto=dd.filter(x=>x.sp>0).length, diasVenda=dd.filter(x=>x.vd>0).length;
  const diasLucro=ativos.filter(x=>lucroDia(x)>0).length, diasPrej=ativos.filter(x=>lucroDia(x)<0).length;
  const melhor=ativos.length?ativos.reduce((a,b)=>lucroDia(b)>lucroDia(a)?b:a):null;
  const pior=ativos.length?ativos.reduce((a,b)=>lucroDia(b)<lucroDia(a)?b:a):null;
  // ROAS bruto em que o lucro zera: líquido = gasto  =>  bruto ÷ gasto = bruto ÷ líquido
  const roasEq=!semFl&&t.fl>0?t.fb/t.fl:null;
  const diaAux=x=>x?brdate(x.d)+' · '+intf(x.vd)+' venda'+(x.vd===1?'':'s'):(dimActive()?SO_DIA:'—');
  const k2=[
    {label:'Vendas por dia (média)',val:numf(t.vd/nDays),aux:brl(g/nDays)+' de gasto/dia'},
    {label:'Lucro por dia (média)',val:semFl?'-':brl(dv.lucro/nDays),tone:semFl?'':lucroCls(dv.lucro),aux:semFl?porque:brl(t.fl/nDays)+' de faturamento líquido/dia'},
    {label:'Dias com venda',val:intf(diasVenda),aux:'de '+intf(diasGasto)+' dia'+(diasGasto===1?'':'s')+' com gasto'},
    {label:'Dias no lucro',val:dimActive()?'-':intf(diasLucro),aux:dimActive()?SO_DIA:intf(diasPrej)+' no prejuízo'},
    {label:'Melhor dia (lucro)',val:melhor?brl(lucroDia(melhor)):'-',tone:melhor?lucroCls(lucroDia(melhor)):'',aux:diaAux(melhor)},
    {label:'Pior dia (lucro)',val:pior?brl(lucroDia(pior)):'-',tone:pior?lucroCls(lucroDia(pior)):'',aux:diaAux(pior)},
    {label:'ROAS de equilíbrio',val:roasf(roasEq),aux:semFl?porque:(roasEq!=null?'ROAS bruto p/ lucro zero · atual '+roasf(dv.roas):'nenhuma venda no período')},
    {label:'Conversão da página (Vendas/Visualiz.)',val:pct(dv.convpag),aux:t.vd?numf(t.lpv/t.vd)+' visualizações por venda':'—'},
  ];
  document.getElementById(ids.kpis2).innerHTML=k2.map(kpiCard).join('');

  comboChart(ids.combo, dd);
  lucroChart(ids.lucro, dd);
  acumChart(ids.acum, dd);
  weekdayChart(ids.wd, dd);
  convChart(ids.conv, t);

  renderDailyTable(ids.daily, DAILY_COLS);
}

/* ---------------- PAGE 2: Tráfego Meta Ads ---------------- */
/* seleção da hierarquia: Ctrl adiciona (OU) sem sumir as demais linhas; clique
   simples troca a seleção DESTE nível e limpa os níveis abaixo, mas mantém os de
   cima. Conjuntos e anúncios repetem nome entre campanhas ("00 - Seguidores"
   está em 4, "AD04" em 6): sem manter a campanha, clicar no conjunto que a
   tabela mostrava com R$ 184 dentro dela trocaria o recorte para os R$ 782 do
   nome somado em todas. */
function selDim(dim,key,ctrl){
  const sets={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}, s=sets[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const ORD=['C','A','D'], below=ORD.slice(ORD.indexOf(dim)+1);
    const sole=s.has(key)&&s.size===1&&!below.some(k=>sets[k].size);
    [dim,...below].forEach(k=>sets[k].clear()); if(!sole) s.add(key); }
  // renderAll (e não renderMeta direto) para a barra de filtros ativos no topo
  // acompanhar o clique.
  renderAll();
}
/* colunas das 3 tabelas da hierarquia. band:'l' (nome + Gasto) fica grudado
   na esquerda; o resto rola junto. Faturamento líquido, lucro e cliques (todos)
   não entram: só existem por dia. */
const HIER_COLS=[
  {key:'dim',label:'',type:'dim',big:true,band:'l'},{key:'gasto',label:'Gasto',type:'brl',band:'l'},
  {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
  {key:'lc',label:'Cliq. link',type:'int'},{key:'ctrl',label:'CTR link',type:'pct'},{key:'cpcl',label:'CPC link',type:'brl'},
  {key:'lpv',label:'Visualiz.',type:'int'},{key:'connect',label:'Connect',type:'pct'},
  {key:'ic',label:'IC',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
  {key:'lpvic',label:'Pág.→IC',type:'pct'},{key:'lcic',label:'Clique→IC',type:'pct'},
  {key:'vd',label:'Vendas',type:'int'},{key:'icv',label:'IC→Venda',type:'pct'},{key:'cpa',label:'CPA',type:'brl'},
  {key:'fb',label:'Fat. bruto',type:'brl'},{key:'roas',label:'ROAS',type:'roas'},
];
function hierCells(k,a){ const d=derive(a);
  return {dim:k, gasto:d.gasto, im:a.im, cpm:d.cpm, lc:a.lc, ctrl:d.ctrl, cpcl:d.cpcl, lpv:a.lpv, connect:d.connect,
    ic:a.ic, cpic:d.cpic, lpvic:d.lpvic, lcic:d.lcic, vd:a.vd, icv:d.icv, cpa:d.cpa, fb:a.fb, roas:d.roas}; }
/* Initiate Checkout por dia (barras) e custo por IC (linha, R$) */
function icCombo(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !d.some(x=>x.ic>0), 'Nenhum Initiate Checkout no período');
  const mut=cmuted(), gr=cgrid(), cCk=cvar('--chart-ck'), cVd=cvar('--chart-vendas'), cCusto=cvar('--chart-cpa');
  charts[id]=new Chart(el,{
    data:{labels:d.map(x=>x.d.slice(5)), datasets:[
      {type:'bar',label:'Initiate Checkout',data:d.map(x=>x.ic),backgroundColor:cCk,yAxisID:'y',borderRadius:3,order:3},
      {type:'bar',label:'Vendas',data:d.map(x=>x.vd),backgroundColor:cVd,yAxisID:'y',borderRadius:3,order:2},
      {type:'line',label:'Custo por IC',data:d.map(x=>x.ic?+(x.sp*taxf()/x.ic).toFixed(2):null),borderColor:cCusto,backgroundColor:cCusto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,spanGaps:true,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:8,usePointStyle:true,font:{size:10}}},
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(c.raw):intf(c.raw))}}},
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:9},precision:0},grid:{color:gr},beginAtZero:true},
        y1:{position:'right',ticks:{color:mut,font:{size:9},callback:v=>'R$'+nf0.format(v)},grid:{display:false},beginAtZero:true}}}
  });
}
function renderMeta(){
  const fin=finOn(), rows=scopeRows();
  const t=totals(rows,fin), dd=daily(rows,fin);
  document.getElementById('metaFunnel').innerHTML=funnelHTML(funnelSteps(t).slice(0,7));
  trafficCombo('mCombo', dd);
  renderDailyTable('tDaily', TRAFFIC_COLS);

  // qualidade do tráfego
  lineDaily('mConnect', dd, [{label:'Connect Rate',fn:x=>derive(x).connect,color:cvar('--chart-connect')}],
    pct, v=>nf0.format(v*100)+'%', 'Sem cliques no link no período');
  lineDaily('mCustos', dd, [
      {label:'Custo por clique no link',fn:x=>derive(x).cpcl,color:cvar('--chart-lc')},
      {label:'Custo por visualização',fn:x=>derive(x).cplpv,color:cvar('--chart-cpa')}],
    brl, v=>'R$'+nf1.format(v), 'Sem tráfego no período');
  convChart('mConv', t);

  // checkout
  icCombo('mIc', dd);
  lineDaily('mIcTaxas', dd, [
      {label:'Página → IC',fn:x=>derive(x).lpvic,color:cvar('--chart-ck')},
      {label:'IC → Venda',fn:x=>derive(x).icv,color:cvar('--chart-vendas')}],
    pct, v=>nf0.format(v*100)+'%', 'Sem visualizações da página no período');
  donutCkVenda('mConvDonut', t.vd, t.ic);

  // hierarquia — cada tabela vem do recorte que IGNORA a própria dimensão,
  // então as linhas irmãs continuam visíveis para multi-seleção (Ctrl).
  const hierRows=map=>Object.entries(map).map(([k,a])=>({k, cells:hierCells(k,a)}));
  const totRowOf=tt=>({...hierCells(null,tt), dim:null});
  const Sc=metaActive('C'), Sa=metaActive('A'), Sd=metaActive('D');
  const aggC=buildAgg(Sc,'c'), aggA=buildAgg(Sa,'s'), aggD=buildAgg(Sd,'a');
  const colsOf=lbl=>HIER_COLS.map((c,i)=>i===0?{...c,label:lbl}:c);
  renderTable({id:'tCamp', cols:colsOf('Campanha'), rows:hierRows(aggC), total:totRowOf(totals(Sc,false)),
    selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', cols:colsOf('Conjunto'), rows:hierRows(aggA), total:totRowOf(totals(Sa,false)),
    selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', cols:colsOf('Anúncio'), rows:hierRows(aggD), total:totRowOf(totals(Sd,false)),
    selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});

  // cada gráfico abre a dimensão da sua tabela por dia — métrica escolhida nos
  // botões, 1 linha por membro, legenda própria e filtro nos dois sentidos.
  renderDimMetricBtns();
  dimChart('chCamp', Sc, aggC, 'C', STATE.mSelC);
  dimChart('chAdset', Sa, aggA, 'A', STATE.mSelA);
  dimChart('chAd', Sd, aggD, 'D', STATE.mSelAd);
}

/* ---------------- PAGE 3: Relatório ----------------
   Espelha a Visão Geral (renderGeralCore com IDs próprios) e, abaixo, acrescenta
   o painel de Metas, o resumo por semana e a tabela de anúncios. */
/* ---- Metas & parâmetros (painel editável) — recolore as tabelas AO VIVO ----
   Defaults vêm do build.py; o usuário edita no painel (persistido em
   localStorage 'dm_metas') e as tabelas recolorem CPA/ROAS/Custo por IC e
   reavaliam a amostra na hora. Meta null = "não definida" (métrica sem cor). */
const SAMPLE_MIN_SPEND = (B.sample_min_spend!=null?B.sample_min_spend:100);
const METAS_DEFAULT = {
  cpa:   (B.meta_cpa!=null?B.meta_cpa:null),
  roas:  (B.meta_roas!=null?B.meta_roas:null),
  cpic:  (B.meta_cpic!=null?B.meta_cpic:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:2),
};
function loadMetas(){
  let saved={}; try{ saved=JSON.parse(localStorage.getItem('dm_metas')||'{}'); }catch(e){}
  const m={...METAS_DEFAULT};
  ['cpa','roas','cpic'].forEach(k=>{ if(saved[k]!=null&&isFinite(saved[k])) m[k]=saved[k]; else if(k in saved && saved[k]===null) m[k]=null; });
  if(saved.volMin!=null&&isFinite(saved.volMin)&&saved.volMin>=1) m.volMin=saved.volMin;
  return m;
}
const METAS = loadMetas();
function saveMetas(){ try{ localStorage.setItem('dm_metas', JSON.stringify(METAS)); }catch(e){} }
/* código de cor de um CUSTO vs meta (menor=melhor): verde ≤ meta; amarelo até
   meta×1,3 (atenção); vermelho acima (teto). Meta não definida => sem cor. */
function metaColorClass(v, meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v<=meta) return 'mc-green';
  if(v<=meta*1.3) return 'mc-yellow';
  return 'mc-red';
}
/* idem para um RETORNO (maior=melhor, ROAS): verde ≥ meta; amarelo até 30%
   abaixo; vermelho abaixo disso. */
function metaColorClassHigh(v, meta){
  if(meta==null||v==null||!isFinite(v)||!isFinite(meta)||meta<=0) return '';
  if(v>=meta) return 'mc-green';
  if(v>=meta*0.7) return 'mc-yellow';
  return 'mc-red';
}
const statusChip=obs=>obs?'<span class="rel-chip c-yellow">Em observação</span>':'<span class="rel-chip c-green">Avaliável</span>';
/* pós-renderização comum das tabelas do Relatório: chip de status e cor de meta
   (CPA, ROAS, Custo/IC). Roda em TODA renderização, inclusive ao ordenar. */
function relAfterRender(cols){
  return (table,sortedRows)=>{
    table.querySelectorAll('tbody tr').forEach((tr,idx)=>{
      const item=sortedRows[idx]; if(!item) return;
      const tds=tr.querySelectorAll('td');
      cols.forEach((c,ci)=>{
        if(ci>=tds.length) return;
        const td=tds[ci];
        if(c.key==='status') td.innerHTML=statusChip(item._obs);
        if(c.key==='cpa'){ const mc=metaColorClass(item.cells.cpa,METAS.cpa); if(mc) td.classList.add(mc); }
        if(c.key==='cpic'){ const mc=metaColorClass(item.cells.cpic,METAS.cpic); if(mc) td.classList.add(mc); }
        if(c.key==='roas'){ const mc=metaColorClassHigh(item.cells.roas,METAS.roas); if(mc) td.classList.add(mc); }
      });
    });
  };
}
/* Resumo por semana (segunda a domingo) do período. Semana com menos vendas que
   o volume mínimo fica "Em observação". */
function renderRelWeeks(){
  const fin=finOn(), rows=scopeRows();
  const wk={};
  rows.forEach(r=>{ const k=weekStart(r.d);
    addTo(wk[k]||(wk[k]={ini:k,...zeroAgg()}), r); });
  Object.values(wk).forEach(w=>gate(w,fin));
  /* dias do recorte dentro da semana: os dias clicados, ou a semana cortada pelo
     período do seletor e pelo intervalo que a planilha cobre — a mesma regra do
     periodDays. Assim a semana do início/fim do período aparece como parcial
     ("01/10 a 04/10", 4 dias) em vez de parecer uma semana cheia. */
  const janela=w=>{ const fim=addDays(w.ini,6);
    if(STATE.selDays.size){ const ds=[...STATE.selDays].filter(d=>d>=w.ini&&d<=fim).sort();
      return {first:ds[0], last:ds[ds.length-1], dias:ds.length}; }
    const f=[w.ini,STATE.from,B.date_min].filter(Boolean).sort().pop(), t=[fim,STATE.to,B.date_max].filter(Boolean).sort()[0];
    return {first:f, last:t, dias:nDaysBetween(f,t)}; };
  const list=Object.values(wk).map(w=>Object.assign(w,janela(w))).sort((a,b)=>a.ini<b.ini?1:-1);   // semana mais recente no topo
  const ddmm=d=>brdate(d).slice(0,5);
  const cellsOf=(w,d)=>({ini:w.ini, per:ddmm(w.first)+(w.first===w.last?'':' a '+ddmm(w.last)),
    status:'', dias:w.dias, gasto:d.gasto, lc:w.lc, lpv:w.lpv, connect:d.connect,
    ic:w.ic, cpic:d.cpic, lpvic:d.lpvic, icv:d.icv, vd:w.vd,
    cpa:d.cpa, fb:w.fb, fl:w.fl, lucro:d.lucro, roas:d.roas});
  const trows=list.map(w=>{ const d=derive(w), obs=w.vd<METAS.volMin, cells=cellsOf(w,d);
    cells.status=obs?'Em observação':'Avaliável';   // texto p/ ordenar; o chip entra via afterRender
    return {k:w.ini, cells, _obs:obs}; });
  const tt=totals(rows,fin), td=derive(tt);
  const total={...cellsOf({ini:null,first:'',last:'',dias:periodDays(),...tt},td), ini:null, per:'', status:''};
  const cols=[
    {key:'ini',label:'Semana',type:'date',w:96},{key:'per',label:'Período',type:'dim'},
    {key:'status',label:'Status',type:'dim',w:140},{key:'dias',label:'Dias',type:'int',w:60},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'lc',label:'Cliq. link',type:'int'},
    {key:'lpv',label:'Visualiz.',type:'int'},{key:'connect',label:'Connect',type:'pct'},
    {key:'ic',label:'IC',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
    {key:'lpvic',label:'Pág.→IC',type:'pct'},{key:'icv',label:'IC→Venda',type:'pct'},
    {key:'vd',label:'Vendas',type:'int'},
    {key:'cpa',label:'CPA',type:'brl'},{key:'fb',label:'Fat. bruto',type:'brl'},
    {key:'fl',label:'Fat. líq.',type:'brl'},
    {key:'lucro',label:'Lucro',type:'brl',cls:r=>lucroCls(r.cells.lucro)},
    {key:'roas',label:'ROAS',type:'roas'},
  ];
  renderTable({id:'relWeeks', cols, rows:trows, total, center:true, afterRender:relAfterRender(cols)});
  const nAval=trows.filter(r=>!r._obs).length;
  document.getElementById('relWeeksCount').textContent =
    list.length+' semana'+(list.length===1?'':'s')+' · '+nAval+' '+(nAval===1?'avaliável':'avaliáveis');
}

/* anúncio -> (campanha, conjunto) dominantes por gasto. O mesmo nome de anúncio
   pode rodar em mais de uma campanha/conjunto; fica a combinação de maior gasto. */
function adStructMap(rows){
  const acc={};
  rows.forEach(r=>{ const byCamp=acc[r.a]=acc[r.a]||{};
    const byAdset=byCamp[r.c]=byCamp[r.c]||{};
    byAdset[r.s]=(byAdset[r.s]||0)+(r.sp||0); });
  const out={};
  Object.entries(acc).forEach(([ad,byCamp])=>{
    let best=null;
    Object.entries(byCamp).forEach(([c,byAdset])=>{
      Object.entries(byAdset).forEach(([s,sp])=>{ if(!best||sp>best.sp) best={c,s,sp}; });
    });
    out[ad]={c:best.c, s:best.s};
  });
  return out;
}
/* amostra relevante para JULGAR o anúncio (senão "Em observação"): gasto mínimo
   (o mesmo que a tabela mostra, com imposto se ligado) e o nº de vendas do
   painel de metas. */
function adSampleOk(a){ return a.sp*taxf()>=SAMPLE_MIN_SPEND && a.vd>=METAS.volMin; }
/* O resultado mais profundo desta conta é a VENDA: mais vendas primeiro; no
   empate, menor CPA; depois mais Initiate Checkout, menor custo por IC e mais
   gasto (anúncio sem venda é ordenado pelo sinal mais próximo dela). */
function cmpBest(a,b){                       // <0 => a antes (melhor)
  if(a.vd!==b.vd) return b.vd-a.vd;
  const da=derive(a), db=derive(b);
  const ca=da.cpa==null?Infinity:da.cpa, cb=db.cpa==null?Infinity:db.cpa;
  if(ca!==cb) return ca-cb;
  if(a.ic!==b.ic) return b.ic-a.ic;
  const ka=da.cpic==null?Infinity:da.cpic, kb=db.cpic==null?Infinity:db.cpic;
  if(ka!==kb) return ka-kb;
  return b.sp-a.sp; }
/* Top Anúncios: todos os anúncios com gasto ou checkout no recorte, os
   avaliáveis primeiro e depois pela qualidade (cmpBest). Anúncio fica fixo à
   esquerda (stk-l1); as métricas rolam. */
function renderRelAds(){
  const rows=metaActive();
  const struct=adStructMap(rows);
  const agg=buildAgg(rows,'a');
  const all=Object.entries(agg).filter(([ad,a])=>a.sp>0||a.ic>0||a.vd>0)
    .map(([ad,a])=>({ad, a, st:struct[ad]||{c:'—',s:'—'}, obs:!adSampleOk(a)}))
    .sort((x,y)=>{ if(x.obs!==y.obs) return x.obs?1:-1; return cmpBest(x.a,y.a); });
  const cols=[
    {key:'ad',label:'Anúncio',type:'dim',big:true,stk:'l1'},{key:'status',label:'Status',type:'dim',w:140},
    {key:'camp',label:'Campanha',type:'dim',big:true},{key:'adset',label:'Conjunto',type:'dim',big:true},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'lc',label:'Cliq. link',type:'int'},{key:'ctrl',label:'CTR link',type:'pct'},
    {key:'lpv',label:'Visualiz.',type:'int'},{key:'connect',label:'Connect',type:'pct'},
    {key:'ic',label:'IC',type:'int'},{key:'cpic',label:'Custo/IC',type:'brl'},
    {key:'lpvic',label:'Pág.→IC',type:'pct'},{key:'icv',label:'IC→Venda',type:'pct'},
    {key:'vd',label:'Vendas',type:'int'},{key:'cpa',label:'CPA',type:'brl'},
    {key:'fb',label:'Fat. bruto',type:'brl'},{key:'roas',label:'ROAS',type:'roas'},
  ];
  const trows=all.map(it=>{ const d=derive(it.a);
    const cells={ad:it.ad, status:it.obs?'Em observação':'Avaliável', camp:it.st.c, adset:it.st.s,
      gasto:d.gasto, im:it.a.im, cpm:d.cpm, lc:it.a.lc, ctrl:d.ctrl, lpv:it.a.lpv, connect:d.connect,
      ic:it.a.ic, cpic:d.cpic, lpvic:d.lpvic, icv:d.icv, vd:it.a.vd, cpa:d.cpa, fb:it.a.fb, roas:d.roas};
    return {k:it.ad, cells, _obs:it.obs}; });
  renderTable({id:'relTop', cols, rows:trows, center:true, afterRender:relAfterRender(cols)});
  const champs=all.filter(it=>!it.obs).length;
  document.getElementById('relTopCount').textContent =
    champs+' '+(champs===1?'avaliável':'avaliáveis')+' de '+all.length+' anúncio'+(all.length===1?'':'s');
}

/* nota de referência do painel de metas (mostra as metas ativas + legenda de cor) */
function renderMetasNote(){
  const el=document.getElementById('relMetasNote'); if(!el) return;
  const fmtMeta=(v,f)=>v==null?'<b>não definida</b>':('<b>'+f(v)+'</b>');
  const vm=intf(METAS.volMin)+' venda'+(METAS.volMin===1?'':'s');
  el.innerHTML=`Referência ativa — Meta CPA: ${fmtMeta(METAS.cpa,brl)} · Meta ROAS: ${fmtMeta(METAS.roas,roasf)} · Meta Custo/IC: ${fmtMeta(METAS.cpic,brl)} · `
    +`Semana avaliável a partir de <b>${vm}</b>; anúncio avaliável com <b>${vm}</b> e <b>${brl(SAMPLE_MIN_SPEND)}</b> de gasto. `
    +((METAS.cpa==null&&METAS.roas==null&&METAS.cpic==null)?'Preencha as metas para colorir CPA, ROAS e Custo/IC nas tabelas. ':'')
    +'Código de cor: <span class="mc-lg mc-green">verde = na meta</span> <span class="mc-lg mc-yellow">amarelo = até 30% fora</span> <span class="mc-lg mc-red">vermelho = além disso</span>.';
}
function syncMetasInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=(v==null?'':v); };
  set('metaCpa',METAS.cpa); set('metaRoas',METAS.roas); set('metaCpic',METAS.cpic); set('metaVolMin',METAS.volMin);
  renderMetasNote();
}

function renderRelatorio(){
  renderGeralCore(REL_IDS);   // espelho da Visão Geral (funil, KPIs, gráficos, tabela diária)

  // cabeçalho do período
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  document.getElementById('relPeriodName').textContent = STATE.selDays.size?'Dias selecionados':(pr?pr[1]:'Personalizado');
  let rangeTxt='';
  if(STATE.selDays.size){ const v=[...STATE.selDays].sort();
    rangeTxt=v.map(brdate).join(' · ')+` · ${v.length} dia${v.length>1?'s':''}`; }
  else if(STATE.from&&STATE.to){ const nD=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
    rangeTxt=`${brdate(STATE.from)} a ${brdate(STATE.to)}`+(nD>0?` · ${nD} dia${nD>1?'s':''}`:''); }
  document.getElementById('relPeriodRange').textContent=rangeTxt;

  renderMetasNote();
  renderRelWeeks();
  renderRelAds();
}

/* ---------------- date presets ---------------- */
const PRESETS=[
  ['hoje','Hoje',()=>[TODAY,TODAY]],
  ['ontem','Ontem',()=>[addDays(TODAY,-1),addDays(TODAY,-1)]],
  ['3d','3 dias',()=>[addDays(TODAY,-2),TODAY]],
  ['7d','7 dias',()=>[addDays(TODAY,-6),TODAY]],
  ['14d','14 dias',()=>[addDays(TODAY,-13),TODAY]],
  ['30d','30 dias',()=>[addDays(TODAY,-29),TODAY]],
  ['mes','Este mês',()=>{const [y,m]=TODAY.split('-');return [`${y}-${m}-01`,TODAY];}],
  ['mespass','Mês passado',()=>{const dt=new Date(TODAY+'T00:00:00');const f=new Date(dt.getFullYear(),dt.getMonth()-1,1);const l=new Date(dt.getFullYear(),dt.getMonth(),0);return [dstr(f),dstr(l)];}],
  ['todo','Todo período',()=>[B.date_min,B.date_max]],
];
/* rótulo do botão de período — mostra o intervalo aplicado dentro do próprio botão */
function syncDateInputs(){
  const el=document.getElementById('periodBtnLabel'); if(!el) return;
  if(STATE.selDays.size){ el.textContent=STATE.selDays.size+(STATE.selDays.size>1?' dias selecionados':' dia selecionado'); return; }
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  if(STATE.from&&STATE.to) el.textContent=brdate(STATE.from)+' – '+brdate(STATE.to)+(pr?' · '+pr[1]:'');
  else el.textContent='Selecionar período';
}
function applyPreset(id){ const p=PRESETS.find(x=>x[0]===id); if(!p)return; const [f,t]=p[2]();
  STATE.from=f; STATE.to=t; STATE.preset=id; STATE.selDays.clear(); ppClose(); syncDateInputs(); renderAll(); }

/* ---- popover do seletor de período (estilo Data Studio) ---- */
const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_PT=['D','S','T','Q','Q','S','S'];
const PP={from:null,to:null,preset:'',fromView:'',toView:''};
function ymView(ds){ return (ds||TODAY).slice(0,7); }
function shiftView(view,delta){ const [y,m]=view.split('-').map(Number); const dt=new Date(y,m-1+delta,1); return dt.getFullYear()+'-'+pad(dt.getMonth()+1); }
function ppIsOpen(){ const pop=document.getElementById('periodPop'); return pop && !pop.hidden; }
function ppOpen(){
  PP.from=STATE.from; PP.to=STATE.to; PP.preset=STATE.selDays.size?'':STATE.preset;
  PP.fromView=ymView(STATE.from); PP.toView=ymView(STATE.to);
  document.getElementById('periodPop').hidden=false;
  document.getElementById('periodBtn').setAttribute('aria-expanded','true');
  ppRenderAll();
}
function ppClose(){ const pop=document.getElementById('periodPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('periodBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function ppRenderAll(){ ppRenderPresets(); ppRenderCal('from'); ppRenderCal('to'); ppRenderRange(); }
function ppRenderPresets(){
  const host=document.getElementById('ppPresets');
  host.innerHTML=PRESETS.map(p=>`<button class="pp-preset ${PP.preset===p[0]?'active':''}" data-p="${p[0]}">${p[1]}</button>`).join('');
  host.querySelectorAll('.pp-preset').forEach(c=>c.addEventListener('click',()=>{
    const p=PRESETS.find(x=>x[0]===c.dataset.p); const [f,t]=p[2]();
    PP.from=f; PP.to=t; PP.preset=p[0]; PP.fromView=ymView(f); PP.toView=ymView(t); ppRenderAll();
  }));
}
function ppRenderCal(side){
  const host=document.getElementById(side==='from'?'ppCalFrom':'ppCalTo');
  const view=side==='from'?PP.fromView:PP.toView;
  const [y,m]=view.split('-').map(Number);
  const startDow=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<span class="pp-day empty"></span>';
  for(let d=1;d<=dim;d++){
    const ds=view+'-'+pad(d);
    const inR=PP.from&&PP.to&&ds>=PP.from&&ds<=PP.to, isEdge=(ds===PP.from||ds===PP.to);
    const cls=['pp-day']; if(inR) cls.push('in'); if(ds===PP.from) cls.push('edge-l'); if(ds===PP.to) cls.push('edge-r'); if(isEdge) cls.push('sel');
    cells+=`<button class="${cls.join(' ')}" data-side="${side}" data-d="${ds}">${d}</button>`;
  }
  host.innerHTML=`<div class="pp-cal-head"><span class="pp-cal-title">${side==='from'?'Data de início':'Data de término'}</span></div>
    <div class="pp-cal-nav"><button class="pp-nav" data-nav="-1">‹</button><span class="pp-cal-month">${MONTHS_PT[m-1]} ${y}</span><button class="pp-nav" data-nav="1">›</button></div>
    <div class="pp-dow">${DOW_PT.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pp-grid">${cells}</div>`;
  host.querySelectorAll('.pp-nav').forEach(b=>b.addEventListener('click',()=>{
    const nv=shiftView(view,+b.dataset.nav); if(side==='from') PP.fromView=nv; else PP.toView=nv; ppRenderCal(side);
  }));
  host.querySelectorAll('.pp-day[data-d]').forEach(b=>b.addEventListener('click',()=>ppPickDay(side,b.dataset.d)));
}
function ppPickDay(side,ds){
  PP.preset='';
  if(side==='from'){ PP.from=ds; if(PP.to&&PP.from>PP.to) PP.to=PP.from; }
  else { PP.to=ds; if(PP.from&&PP.to<PP.from) PP.from=PP.to; }
  ppRenderAll();
}
function ppRenderRange(){
  const el=document.getElementById('ppRange');
  if(PP.from&&PP.to){ const n=Math.round((new Date(PP.to+'T00:00:00')-new Date(PP.from+'T00:00:00'))/86400000)+1;
    el.textContent=brdate(PP.from)+' – '+brdate(PP.to)+(n>0?' · '+n+(n>1?' dias':' dia'):''); }
  else el.textContent='Selecione as datas';
}
function ppApply(){
  if(!PP.from||!PP.to){ ppClose(); return; }
  STATE.from=PP.from; STATE.to=PP.to; STATE.preset=PP.preset||''; STATE.selDays.clear();
  ppClose(); syncDateInputs(); renderAll();
}

/* ---------------- navigation & boot ---------------- */
const PAGE_TITLES={geral:'Visão Geral de Vendas', meta:'Tráfego Meta Ads', rel:'Relatório'};
function setPage(p){ STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.getElementById('page-geral').classList.toggle('active',p==='geral');
  document.getElementById('page-meta').classList.toggle('active',p==='meta');
  document.getElementById('page-rel').classList.toggle('active',p==='rel');
  document.getElementById('ptitle').textContent = PAGE_TITLES[p]||PAGE_TITLES.geral;
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'', p==='meta'?'#meta':(p==='rel'?'#rel':'#geral'));
  renderAll();
}
/* ---------------- barra de filtros ativos ----------------
   Clicar numa data da tabela diária ou numa campanha/conjunto/anúncio filtra a
   página inteira, inclusive o funil que fica ACIMA da tabela. Sem um aviso fixo
   no topo dá para olhar o funil e achar que é o total do período. Esta barra
   torna o filtro impossível de não ver e dá como sair dele. */
function activeFilters(){
  const out=[];
  const lista=(set,rot)=>{ if(!set.size) return;
    const v=[...set]; out.push({rot, txt: v.length===1?v[0]:v.length+' selecionados',
      full:v.join(' · '), limpar:()=>set.clear()}); };
  lista(STATE.mSelC,'Campanha');
  lista(STATE.mSelA,'Conjunto');
  lista(STATE.mSelAd,'Anúncio');
  if(STATE.selDays.size){ const v=[...STATE.selDays].sort();
    out.push({rot:'Dias', txt: v.length===1?brdate(v[0]):v.length+' dias selecionados',
      full:v.map(brdate).join(' · '), limpar:()=>STATE.selDays.clear()}); }
  return out;
}
function renderFilterBar(){
  const el=document.getElementById('filterBar'); if(!el) return;
  const f=activeFilters();
  document.getElementById('clearBtn').classList.toggle('active', f.length>0);
  if(!f.length){ el.hidden=true; el.innerHTML=''; return; }
  el.hidden=false;
  el.innerHTML='<span class="fb-lead">Filtro ativo — os números abaixo são só deste recorte:</span>'
    + f.map((x,i)=>`<span class="fb-chip" data-i="${i}" title="${escHtml(x.rot+': '+x.full)}">`
        +`<span class="fb-txt"><b>${x.rot}:</b> ${escHtml(x.txt)}</span><button class="fb-x" type="button" aria-label="Remover filtro">✕</button></span>`).join('')
    + '<button class="fb-all" type="button">Remover todos</button>';
  el.querySelectorAll('.fb-x').forEach(b=>b.addEventListener('click',e=>{
    e.stopPropagation(); f[+b.closest('.fb-chip').dataset.i].limpar(); syncDateInputs(); renderAll(); }));
  el.querySelector('.fb-all').addEventListener('click',()=>{
    f.forEach(x=>x.limpar()); syncDateInputs(); renderAll(); });
}

function renderAll(){ renderFilterBar();
  if(STATE.page==='meta') renderMeta(); else if(STATE.page==='rel') renderRelatorio(); else renderGeral(); }

function applyTheme(){ const t=localStorage.getItem('dm_theme'); if(t==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); }
applyTheme();
document.getElementById('themeBtn').addEventListener('click',()=>{ const dark=document.documentElement.getAttribute('data-theme')==='dark'; localStorage.setItem('dm_theme',dark?'light':'dark'); applyTheme(); renderAll(); });

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
document.getElementById('taxToggle').addEventListener('click',function(){ STATE.tax=!STATE.tax; this.classList.toggle('on',STATE.tax); renderAll(); });
/* seletor de período: abre/fecha popover, aplicar/cancelar, fechar ao clicar fora/Esc */
document.getElementById('periodBtn').addEventListener('click',e=>{ e.stopPropagation(); ppIsOpen()?ppClose():ppOpen(); });
document.getElementById('ppApply').addEventListener('click',ppApply);
document.getElementById('ppCancel').addEventListener('click',ppClose);
document.getElementById('periodPop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{ if(ppIsOpen()) ppClose(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&ppIsOpen()) ppClose(); });
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.mSelC.clear();STATE.mSelA.clear();STATE.mSelAd.clear();STATE.selDays.clear(); applyPreset('mes'); });
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

/* painel de Metas & parâmetros — edita ao vivo, salva em localStorage e recolore
   o resumo semanal e a tabela de anúncios (sem re-renderizar os gráficos) */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const relTables=()=>{ if(STATE.page==='rel'){ renderRelWeeks(); renderRelAds(); } };   // só as tabelas, sem mexer nos gráficos
  const onEdit=()=>{
    METAS.cpa=num(document.getElementById('metaCpa'));
    METAS.roas=num(document.getElementById('metaRoas'));
    METAS.cpic=num(document.getElementById('metaCpic'));
    const vm=num(document.getElementById('metaVolMin')); METAS.volMin=(vm!=null&&vm>=1)?Math.round(vm):METAS_DEFAULT.volMin;
    saveMetas(); renderMetasNote(); relTables();
  };
  ['metaCpa','metaRoas','metaCpic','metaVolMin'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',onEdit); });
  const rb=document.getElementById('relMetasReset');
  if(rb) rb.addEventListener('click',()=>{ Object.assign(METAS,METAS_DEFAULT);
    try{ localStorage.removeItem('dm_metas'); }catch(e){} syncMetasInputs(); relTables(); });
  syncMetasInputs();
})();

document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build __BUILD_ID__';
document.getElementById('buildFoot2').textContent='· build __BUILD_ID__';

syncDateInputs();
setPage(location.hash==='#meta'?'meta':(location.hash==='#rel'?'rel':'geral'));
window.addEventListener('hashchange',()=>{ const p=location.hash==='#meta'?'meta':(location.hash==='#rel'?'rel':'geral'); if(p!==STATE.page) setPage(p); });

/* a hierarquia escolhe entre banda travada e tabela única pela largura do card:
   re-renderiza quando a largura muda (só a largura — no celular a barra de
   endereço muda a altura ao rolar) */
let _rzW=window.innerWidth, _rzT=null;
window.addEventListener('resize',()=>{ if(window.innerWidth===_rzW) return; _rzW=window.innerWidth;
  clearTimeout(_rzT); _rzT=setTimeout(()=>{ if(STATE.page==='meta') renderMeta(); },250); });

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);
