"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const META = DATA.meta, B = DATA.build;
const TAX = B.tax_factor || 1.0;
const TEM_HOLD = !!B.tem_hold;   // Hold_Rate vem zerado na planilha => coluna escondida

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>(v==null||!isFinite(v))?'-':'R$ '+nf2.format(v);
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const roasf=v=>(v==null||!isFinite(v))?'-':nf2.format(v)+'x';
const dimf=v=>v==null?'-':String(v);
const norm=s=>(s==null?'':String(s)).trim().toLowerCase();
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
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),
  dimMetric:'gasto',   // métrica dos gráficos de linha da hierarquia (Gasto/CTR/Hook/CPA)
  sort:{}, colw: JSON.parse(localStorage.getItem('dm_colw')||'{}'),
};
const taxf = ()=> STATE.tax ? TAX : 1;

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
const metaActive  = ()=> META.filter(m=>dateActive(m.d));
/* período do seletor IGNORANDO os dias clicados: é o que a tabela diária lista,
   para dar para clicar (Ctrl) em outros dias depois do primeiro */
const rangeActive = ()=> META.filter(m=>m.d && (!STATE.from || m.d>=STATE.from) && (!STATE.to || m.d<=STATE.to));
/* nº de dias do recorte (média por dia): dias clicados ou dias de calendário do
   período, limitado ao intervalo que a planilha cobre */
function periodDays(){
  if(STATE.selDays.size) return STATE.selDays.size;
  const f=[STATE.from,B.date_min].filter(Boolean).sort().pop(), t=[STATE.to,TODAY].filter(Boolean).sort()[0];
  if(!f||!t||f>t) return 1;
  return Math.round((new Date(t+'T00:00:00')-new Date(f+'T00:00:00'))/86400000)+1;
}

/* ---------------- aggregation ----------------
   Uma única fonte: a aba Criativos (1 linha = anúncio × dia). Campos do registro
   (build.py): sp=gasto (sem imposto) · im=impressões · rc=alcance · cl=cliques ·
   ck=checkouts · vd=vendas · fat=faturamento (ROAS da planilha × gasto) ·
   v3/hd = pessoas que passaram do hook/hold · p25/p50/p100 = plays do vídeo.
   Tudo é SOMA, então as taxas (Hook, retenção, ROAS) saem ponderadas pelo volume
   e batem com o que o gerenciador mostra para o período.
   Funil: Gasto → Impressões → Alcance → Cliques → Checkouts → Vendas → Faturamento.
   O imposto (taxf) multiplica SÓ o gasto; faturamento nunca leva imposto, então
   ROAS = faturamento ÷ (gasto × imposto). */
const FIELDS=['sp','im','rc','cl','ck','vd','fat','v3','hd','p25','p50','p100'];
const zeroAgg=()=>{ const a={}; FIELDS.forEach(f=>{a[f]=0;}); return a; };
function addTo(a,r){ FIELDS.forEach(f=>{ a[f]+=r[f]||0; }); return a; }
function derive(a){
  const g=a.sp*taxf();
  return {gasto:g, impr:a.im, reach:a.rc, clicks:a.cl, ck:a.ck, vd:a.vd, fat:a.fat,
    cpm:a.im?g/a.im*1000:null, freq:a.rc?a.im/a.rc:null,
    ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    cpck:a.ck?g/a.ck:null, convck:a.cl?a.ck/a.cl:null,
    cpa:a.vd?g/a.vd:null, conv:a.cl?a.vd/a.cl:null, ckv:a.ck?a.vd/a.ck:null,
    roas:g?a.fat/g:null, ticket:a.vd?a.fat/a.vd:null,
    hook:a.im?a.v3/a.im:null, hold:a.im?a.hd/a.im:null,
    r2550:a.p25?a.p50/a.p25:null, compl:a.p25?a.p100/a.p25:null};
}
function buildAgg(fM,dim){
  const m={};
  fM.forEach(r=>{ const k=r[dim]; addTo(m[k]||(m[k]=zeroAgg()), r); });
  return m;
}
function totals(fM){ const a=zeroAgg(); fM.forEach(r=>addTo(a,r)); return a; }
/* agregação diária */
function daily(fM){
  const days={};
  fM.forEach(r=>{ if(!r.d) return; addTo(days[r.d]||(days[r.d]={d:r.d,...zeroAgg()}), r); });
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
}

/* ---------------- generic interactive table ---------------- */
/* cfg: {id, cols:[{key,label,type,dim?,heat?:'gasto'|'ck'|'hook'|'vendas'|'roas',cls?}], rows:[{k,cells:{}, raw?}],
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
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
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
    return `<td class="${c.type==='dim'?'dim':''}${stkCls(c)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=fit?'100%':totalW+'px';
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
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && (c.type==='dim'||c.type==='date')){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
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
   Gasto=vermelho · Checkouts=azul · Hook=ciano · Vendas=verde · ROAS=amarelo. */
const HEAT_HUE={gasto:'--heat-gasto', ck:'--heat-ck', hook:'--heat-hook', vendas:'--heat-vendas', roas:'--heat-roas'};
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
/* etapas do funil de vendas — iguais na Visão Geral, na Captura e no Relatório */
function funnelSteps(t){
  const dv=derive(t);
  return [
    ['Gasto Total', brl(dv.gasto), [], false, 'hl-gasto'],
    ['Impressões', intf(t.im), [['CPM',brl(dv.cpm)],['Hook Rate',pct(dv.hook)]]],
    ['Alcance', intf(t.rc), [['Frequência',numf(dv.freq)]]],
    ['Cliques', intf(t.cl), [['CTR',pct(dv.ctr)],['CPC',brl(dv.cpc)]]],
    ['Checkouts', intf(t.ck), [['Custo/Checkout',brl(dv.cpck)],['Clique→Checkout',pct(dv.convck)]]],
    ['Vendas', intf(t.vd), [['CPA',brl(dv.cpa)],['Checkout→Venda',pct(dv.ckv)]], false, 'hl-venda'],
    ['Faturamento', brl(t.fat), [['ROAS',roasf(dv.roas)],['Ticket médio',brl(dv.ticket)]], false, 'hl-fat'],
  ];
}

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
/* aviso "sem dados" sobre o canvas (ex.: nenhum anúncio vendeu no período) —
   sem ele o card fica com um eixo vazio e parece que quebrou. */
function chartEmpty(id, empty, msg){
  const el=document.getElementById(id); if(!el) return;
  const box=el.parentElement; let n=box.querySelector('.chart-empty');
  if(!empty){ if(n) n.remove(); return; }
  if(!n){ n=document.createElement('div'); n.className='chart-empty'; box.appendChild(n); }
  n.textContent=msg||'Sem dados no período';
}
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !d.length, 'Sem dados no período');
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted(), gr=cgrid();
  const cCk=cvar('--chart-ck'), cVd=cvar('--chart-vendas'), cGasto=cvar('--chart-gasto'), cFat=cvar('--chart-fat')||cink();
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Checkouts',data:d.map(x=>x.ck),backgroundColor:cCk,yAxisID:'y',borderRadius:3,order:4},
      {type:'bar',label:'Vendas',data:d.map(x=>x.vd),backgroundColor:cVd,yAxisID:'y',borderRadius:3,order:3},
      {type:'line',label:'Gasto',data:d.map(x=>+(x.sp*taxf()).toFixed(2)),borderColor:cGasto,backgroundColor:cGasto,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:1},
      {type:'line',label:'Faturamento',data:d.map(x=>+x.fat.toFixed(2)),borderColor:cFat,backgroundColor:cFat,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Checkouts · Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
function hbar(id, items, valFn, colorFn, top, unit){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  unit=unit||'vendas';
  let arr=items.filter(x=>valFn(x)>0).sort((a,b)=>valFn(b)-valFn(a)); if(top) arr=arr.slice(0,top);
  chartEmpty(id, !arr.length, 'Nenhum anúncio com '+unit+' no período');
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabels],
    data:{labels:arr.map(x=>barLbl(x.label)), datasets:[{label:unit,data:arr.map(valFn),backgroundColor:arr.map(colorFn||(()=>cvar('--chart-vendas'))),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:28}},
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>arr[c[0].dataIndex].label,label:c=>intf(c.raw)+' '+unit}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,precision:0,font:{size:10}},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10}},grid:{display:false}}}}});
}
const barLabels={id:'barLabels',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(!v)return; ctx.fillText(intf(v),el.x+5,el.y);});ctx.restore();}};
/* barras de TAXA (Hook Rate por anúncio): recebe a lista já ordenada, rotula em % */
function hbarPct(id, arr, color, emptyMsg){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !arr.length, emptyMsg);
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabelsPct],
    data:{labels:arr.map(x=>barLbl(x.label)), datasets:[{label:'%',data:arr.map(x=>x.v),backgroundColor:color||cvar('--chart-hook'),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:52}},
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>arr[c[0].dataIndex].label,label:c=>pct(c.raw)+(arr[c.dataIndex]&&arr[c.dataIndex].aux?' · '+arr[c.dataIndex].aux:'')}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>nf0.format(v*100)+'%'},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10}},grid:{display:false}}}}});
}
const barLabelsPct={id:'barLabelsPct',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(v==null)return; ctx.fillText(pct(v),el.x+5,el.y);});ctx.restore();}};

/* Donut de conversão (checkout → venda): verde = checkout que virou venda ·
   cinza = abandonou. É a etapa mais funda do funil que existe por anúncio. */
function donutCkVenda(id, vd, ck){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !ck, 'Nenhum checkout no período');
  const naoConv=Math.max(0,ck-vd);
  charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:['Virou venda','Não comprou'],datasets:[{data:[vd,naoConv],
      backgroundColor:[cvar('--good'),cvar('--bar-noq')],borderColor:cvar('--surface'),borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+intf(c.raw)+(ck?' ('+pct(c.raw/ck)+')':'')}}}}});
  const el2=document.getElementById('mConvPct'); if(el2) el2.textContent=pct(ck?vd/ck:null);
}
/* Métrica por dimensão (campanha/conjunto/anúncio) por dia — 1 linha por membro.
   A métrica é escolhida nos botões acima dos gráficos (STATE.dimMetric): Gasto,
   CTR, Hook Rate ou CPA. Venda é rara (poucas por dia), então um gráfico só de
   CPA ficaria quase vazio; por isso o padrão é o Gasto.
   Legenda é um painel HTML próprio (fora do canvas) — a legenda NATIVA do Chart.js
   quebra/trunca nomes longos porque respeita a largura do canvas; a nossa não.
   Clique numa linha da legenda OU numa linha do gráfico filtra a tabela (selDim);
   quando a tabela já tem seleção (STATE.mSel*), o gráfico plota SÓ as linhas
   selecionadas (a legenda continua listando todas p/ dar pra trocar a seleção). */
const DIM_METRICS={
  gasto:{label:'Gasto',     fn:d=>d.gasto, fmt:brl, axis:v=>'R$'+nf0.format(v), suf:'de gasto'},
  ctr:  {label:'CTR',       fn:d=>d.ctr,   fmt:pct, axis:v=>nf1.format(v*100)+'%', suf:'CTR'},
  hook: {label:'Hook Rate', fn:d=>d.hook,  fmt:pct, axis:v=>nf0.format(v*100)+'%', suf:'Hook Rate'},
  cpa:  {label:'CPA',       fn:d=>d.cpa,   fmt:brl, axis:v=>'R$'+nf0.format(v), suf:'por venda'},
};
function dimChart(id, fM, agg, dim, selSet){
  destroy(id); const el=document.getElementById(id); const legEl=document.getElementById(id+'Legend');
  if(!el) return;
  const M=DIM_METRICS[STATE.dimMetric]||DIM_METRICS.gasto;
  const days=[...new Set(fM.filter(r=>r.d).map(r=>r.d))].sort();
  // membros com gasto, do maior para o menor gasto — ordem estável p/ cor e legenda
  const members=Object.keys(agg).filter(k=>agg[k].sp>0).sort((a,b)=>agg[b].sp-agg[a].sp);
  const pal=chartPalette(), mut=cmuted();
  const dimChar={'camp':'C','adset':'A','ad':'D'}[dim]||'C';
  const plotMembers = (selSet&&selSet.size) ? members.filter(m=>selSet.has(m)) : members;
  const dsets=plotMembers.map(mv=>{
    const idx=members.indexOf(mv);
    const byDay={}; days.forEach(d=>{byDay[d]=zeroAgg();});
    fM.forEach(r=>{ if(r[dim]===mv && r.d!=null && byDay[r.d]) addTo(byDay[r.d],r); });
    const data=days.map(d=>{ const v=M.fn(derive(byDay[d])); return (v==null||!isFinite(v))?null:+v.toFixed(4); });
    const col=pal[idx%pal.length];
    return {label:String(mv), data, borderColor:col, backgroundColor:col, borderWidth:2, pointRadius:2, tension:.25, spanGaps:true};
  });
  chartEmpty(id, !dsets.some(ds=>ds.data.some(v=>v!=null&&v!==0)), 'Sem '+M.label+' no período');
  charts[id]=new Chart(el,{type:'line',
    data:{labels:days.map(d=>d.slice(5)), datasets:dsets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},
      onClick:(e,act)=>{ if(act.length){ const idx=act[0].datasetIndex;
        if(idx!=null&&dsets[idx]) selDim(dimChar,dsets[idx].label,false); } },
      plugins:{
        legend:{display:false},
        tooltip:{displayColors:true,
          callbacks:{title:()=>'', label:c=>[c.dataset.label, M.fmt(c.raw)+' '+M.suf]}}
      },
      scales:{x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
        y:{ticks:{color:mut,font:{size:9},callback:M.axis},grid:{color:cgrid()},beginAtZero:true}}
    }
  });
  if(legEl){
    legEl.innerHTML = members.map((mv,idx)=>{
      const col=pal[idx%pal.length];
      const v = agg[mv]!=null ? M.fn(derive(agg[mv])) : null;
      const sel = !!(selSet && selSet.has(mv));
      return `<div class="cl-row${sel?' sel':''}" data-mv="${escHtml(mv)}" title="${escHtml(mv)}">`
        +`<span class="cl-swatch" style="background:${col}"></span>`
        +`<span class="cl-name">${escHtml(mv)}</span>`
        +`<span class="cl-val">${M.fmt(v)}</span></div>`;
    }).join('');
    legEl.querySelectorAll('.cl-row').forEach(row=>{
      row.addEventListener('click',()=>selDim(dimChar,row.dataset.mv,false));
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
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

/* ---------------- PAGE 1: Visão Geral ---------------- */
/* IDs dos elementos por página — a Visão Geral e o Relatório compartilham o
   MESMO corpo (renderGeralCore), só mudam os alvos no DOM. */
const GERAL_IDS={funnel:'geralFunnel',kpis2:'geralKpis2',combo:'gCombo',vdad:'gVdAd',ckad:'gCkAd',hookad:'gHookAd',cpaad:'gCpaAd',daily:'gDaily'};
const REL_IDS  ={funnel:'relFunnel', kpis2:'relKpis2', combo:'rCombo',vdad:'rVdAd',ckad:'rCkAd',hookad:'rHookAd',cpaad:'rCpaAd',daily:'rDaily'};
/* Hook Rate só é comparável entre anúncios com impressões suficientes — um
   anúncio com 20 impressões e 10 views de 3s teria "50%" e lideraria o ranking. */
const HOOK_MIN_IMPR=300;
const adShort=x=>{ x=String(x||'—'); return x.length>24?x.slice(0,23)+'…':x; };
/* rótulo do eixo das barras horizontais: mais curto, senão o Chart.js corta o
   começo do nome; o nome inteiro aparece no tooltip */
const barLbl=x=>{ x=String(x||'—'); return x.length>18?x.slice(0,17)+'…':x; };
function renderGeral(){ renderGeralCore(GERAL_IDS); }
function renderGeralCore(ids){
  const fM=metaActive();
  const t=totals(fM), dv=derive(t), g=dv.gasto;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(funnelSteps(t));

  // ---- métricas secundárias (não repetem o funil) ----
  const dd=daily(fM), nDays=periodDays();
  const adAgg=buildAgg(fM,'ad');
  let topAd=null, bestAd=null, bestHook=null, nAdsAtivos=0;
  Object.entries(adAgg).forEach(([ad,a])=>{
    if(a.sp>0) nAdsAtivos++;
    if(a.vd>0 && (topAd==null||a.vd>topAd.m||(a.vd===topAd.m&&a.fat>topAd.f))) topAd={ad,m:a.vd,f:a.fat};
    if(a.vd>0){ const c=(a.sp*taxf())/a.vd; if(bestAd==null||c<bestAd.v) bestAd={ad,v:c}; }
    if(a.im>=HOOK_MIN_IMPR){ const h=a.v3/a.im; if(bestHook==null||h>bestHook.v) bestHook={ad,v:h}; }
  });
  const nCampAtivas=Object.values(buildAgg(fM,'camp')).filter(a=>a.sp>0).length;
  const nAdsetsAtivos=Object.values(buildAgg(fM,'adset')).filter(a=>a.sp>0).length;
  const comVenda=dd.filter(x=>x.vd>0);
  const melhorDia=comVenda.length?comVenda.reduce((a,b)=>(b.vd>a.vd||(b.vd===a.vd&&b.fat>a.fat))?b:a):null;
  const k2=[
    {label:'Vendas por dia (média)',val:numf(t.vd/nDays),aux:brl(g/nDays)+' de gasto/dia'},
    {label:'Melhor CPA (anúncio)',val:bestAd?brl(bestAd.v):'-',aux:bestAd?escHtml(adShort(bestAd.ad)):'nenhuma venda no período'},
    {label:'Top anúncio (vendas)',val:topAd?intf(topAd.m):'-',aux:topAd?escHtml(adShort(topAd.ad)):'nenhuma venda no período'},
    {label:'Melhor Hook Rate (anúncio)',val:bestHook?pct(bestHook.v):'-',aux:bestHook?escHtml(adShort(bestHook.ad)):'mín. '+intf(HOOK_MIN_IMPR)+' impressões'},
    {label:'Anúncios com gasto',val:intf(nAdsAtivos),aux:intf(nAdsetsAtivos)+' conjuntos · '+intf(nCampAtivas)+' campanhas'},
    {label:'Melhor dia (vendas)',val:melhorDia?intf(melhorDia.vd):'-',aux:melhorDia?brdate(melhorDia.d)+' · '+brl(melhorDia.fat):'—'},
    {label:'Retenção do vídeo 25%→50%',val:pct(dv.r2550),aux:'25%→100%: '+pct(dv.compl)},
    {label:'Conversão (Vendas/Cliques)',val:pct(dv.conv),aux:t.vd?numf(t.cl/t.vd)+' cliques por venda':'—'},
  ];
  document.getElementById(ids.kpis2).innerHTML=k2.map(kpiCard).join('');
  comboChart(ids.combo, dd);

  const items=Object.entries(adAgg).map(([label,a])=>({label,a}));
  // vendas por anúncio (top 10)
  hbar(ids.vdad, items, x=>x.a.vd, ()=>cvar('--chart-vendas'), 10, 'vendas');
  // checkouts por anúncio (top 10)
  hbar(ids.ckad, items, x=>x.a.ck, ()=>cvar('--chart-ck'), 10, 'checkouts');
  // Hook Rate por anúncio (top 10, com impressões mínimas)
  const hookArr=items.filter(x=>x.a.im>=HOOK_MIN_IMPR&&x.a.v3>0)
    .map(x=>({label:x.label, v:x.a.v3/x.a.im, aux:intf(x.a.im)+' impressões'}))
    .sort((a,b)=>b.v-a.v).slice(0,10);
  hbarPct(ids.hookad, hookArr, cvar('--chart-hook'), 'Nenhum anúncio com '+intf(HOOK_MIN_IMPR)+'+ impressões');
  // CPA por anúncio (top 10 mais baratos) — barra menor = melhor, por isso ordenamos asc
  const cpaAd=items.filter(x=>x.a.vd>0&&x.a.sp>0)
    .map(x=>({label:x.label, v:(x.a.sp*taxf())/x.a.vd}))
    .sort((a,b)=>a.v-b.v).slice(0,10);
  hbarAsc(ids.cpaad, cpaAd);

  // tabela diaria, ultimo dia no topo + heatmap. Lista o período inteiro; os dias
  // clicados ficam destacados (e são o que o funil acima mostra)
  const fR=rangeActive(), tR=totals(fR);
  const dl=daily(fR).reverse();
  renderTable({id:ids.daily, cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:dailyCells({...tR,d:null},derive(tR),true),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}
/* barras de CUSTO (menor = melhor): mantém a ordem recebida e rotula em R$ */
function hbarAsc(id, arr){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  chartEmpty(id, !arr.length, 'Nenhuma venda no período');
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabelsBrl],
    data:{labels:arr.map(x=>barLbl(x.label)), datasets:[{label:'CPA',data:arr.map(x=>x.v),backgroundColor:cvar('--chart-cpa')||cvar('--chart-vendas'),borderRadius:3}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:62}},
      plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>arr[c[0].dataIndex].label,label:c=>brl(c.raw)+' por venda'}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,font:{size:10},callback:v=>'R$'+nf0.format(v)},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:10}},grid:{display:false}}}}});
}
const barLabelsBrl={id:'barLabelsBrl',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ch.data.datasets[0].data[i]; if(!v)return; ctx.fillText(brl(v),el.x+5,el.y);});ctx.restore();}};
/* ---------------- PAGE 3: Relatório ----------------
   Espelha a Visão Geral (renderGeralCore com IDs próprios) e, abaixo, acrescenta
   o painel de Metas e a tabela de Anúncios. */
const SAMPLE_MIN_SPEND = (B.sample_min_spend!=null?B.sample_min_spend:100);
const SAMPLE_MIN_VENDAS = (B.sample_min_vendas!=null?B.sample_min_vendas:2);
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---- Metas & parâmetros (painel editável) — ajusta cores/amostra AO VIVO ----
   Defaults vêm do build.py; o usuário edita no painel (persistido em
   localStorage 'dm_metas') e a tabela de anúncios recolore CPA/ROAS e reavalia
   a amostra na hora. Meta null = "não definida" (métrica fica sem cor). */
const METAS_DEFAULT = {
  cpa:   (B.meta_cpa!=null?B.meta_cpa:null),
  roas:  (B.meta_roas!=null?B.meta_roas:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:SAMPLE_MIN_VENDAS),
  nDias: (B.n_dias_corte!=null?B.n_dias_corte:5),
};
function loadMetas(){
  let saved={}; try{ saved=JSON.parse(localStorage.getItem('dm_metas')||'{}'); }catch(e){}
  const m={...METAS_DEFAULT};
  ['cpa','roas'].forEach(k=>{ if(saved[k]!=null&&isFinite(saved[k])) m[k]=saved[k]; else if(k in saved && saved[k]===null) m[k]=null; });
  if(saved.volMin!=null&&isFinite(saved.volMin)&&saved.volMin>=1) m.volMin=saved.volMin;
  if(saved.nDias!=null&&isFinite(saved.nDias)&&saved.nDias>=1) m.nDias=saved.nDias;
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

/* ad -> (campanha, conjunto) dominantes por gasto. Um anúncio pode rodar em mais
   de uma campanha/conjunto; fica com a combinação de maior gasto. */
function adStructMap(fM){
  const acc={};
  fM.forEach(r=>{ const byCamp=acc[r.ad]=acc[r.ad]||{};
    const byAdset=byCamp[r.camp]=byCamp[r.camp]||{};
    byAdset[r.adset]=(byAdset[r.adset]||0)+r.sp; });
  const out={};
  Object.entries(acc).forEach(([ad,byCamp])=>{
    let best=null;
    Object.entries(byCamp).forEach(([camp,byAdset])=>{
      Object.entries(byAdset).forEach(([adset,sp])=>{
        if(!best||sp>best.sp) best={camp,adset,sp};
      });
    });
    out[ad]={camp:best.camp,adset:best.adset};
  });
  return out;
}
/* amostra relevante para JULGAR o anúncio (senão: "Em observação"). O limiar de
   vendas vem do painel de metas (volume mínimo amostral), editável ao vivo. O
   gasto comparado é o mesmo que a tabela mostra (com imposto, se ligado). */
function adSampleOk(a){ return a.sp*taxf()>=SAMPLE_MIN_SPEND && a.vd>=METAS.volMin; }
/* O resultado mais profundo desta conta é a VENDA: mais vendas primeiro; no
   empate, menor CPA; depois mais checkouts, menor custo/checkout e mais gasto
   (anúncio sem venda ainda é ordenado pelo sinal mais próximo dela). */
function cmpBest(a,b){                       // <0 => a antes (melhor)
  if(a.vd!==b.vd) return b.vd-a.vd;
  const da=derive(a), db=derive(b);
  const ca=da.cpa==null?Infinity:da.cpa, cb=db.cpa==null?Infinity:db.cpa;
  if(ca!==cb) return ca-cb;
  if(a.ck!==b.ck) return b.ck-a.ck;
  const ka=da.cpck==null?Infinity:da.cpck, kb=db.cpck==null?Infinity:db.cpck;
  if(ka!==kb) return ka-kb;
  return b.sp-a.sp; }

/* Colunas da tabela de anúncios. Anúncio fica FIXO à esquerda (position:sticky
   em .rel-adt), então dá pra ver sem rolar lateralmente — só as métricas do
   meio rolam. */
function adRowCells(ad,a,struct){
  const d=derive(a);
  return {ad, camp:struct.camp, adset:struct.adset,
    gasto:d.gasto, im:a.im, cpm:d.cpm, hook:d.hook, ctr:d.ctr, cpc:d.cpc,
    cl:a.cl, ck:a.ck, cpck:d.cpck, vd:a.vd, cpa:d.cpa, fat:a.fat, roas:d.roas,
    status:null};
}
const statusChip=obs=>obs?'<span class="rel-chip c-yellow">Em observação</span>':'<span class="rel-chip c-green">Avaliável</span>';
function relRenderAdTable(id,list){
  const el=document.getElementById(id); if(!el) return;
  const cols=[
    {key:'ad',label:'Anúncio',type:'dim',big:true,stk:'l1'},{key:'status',label:'Status',type:'dim',w:140},
    {key:'camp',label:'Campanha',type:'dim',big:true},{key:'adset',label:'Conjunto',type:'dim',big:true},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'im',label:'Impr.',type:'int'},
    {key:'cpm',label:'CPM',type:'brl'},{key:'hook',label:'Hook',type:'pct'},{key:'ctr',label:'CTR',type:'pct'},
    {key:'cpc',label:'CPC',type:'brl'},{key:'cl',label:'Cliques',type:'int'},
    {key:'ck',label:'Checkouts',type:'int'},{key:'cpck',label:'Custo/Ck',type:'brl'},
    {key:'vd',label:'Vendas',type:'int'},{key:'cpa',label:'CPA',type:'brl'},
    {key:'fat',label:'Fat.',type:'brl'},{key:'roas',label:'ROAS',type:'roas'},
  ];
  const rows=list.map(item=>{
    const cells=adRowCells(item.ad,item.a,item.struct);
    cells.status=item.obs?'Em observação':'Avaliável';  // texto p/ ordenar; o chip entra via afterRender
    return {k:item.ad, cells, _obs:item.obs, _cpa:cells.cpa, _roas:cells.roas};
  });
  renderTable({
    id, cols, rows, center:true,   // só as MÉTRICAS centralizam; dim fica à esquerda (CSS .dt-center)
    // roda em TODA renderização (inclusive ao ordenar por um cabeçalho) — chip de
    // status e cor de meta (CPA/ROAS) nunca somem ao clicar pra ordenar
    afterRender:(table,sortedRows)=>{
      table.querySelectorAll('tbody tr').forEach((tr,idx)=>{
        const item=sortedRows[idx]; if(!item) return;
        const tds=tr.querySelectorAll('td');
        cols.forEach((c,ci)=>{
          if(ci>=tds.length) return;
          const td=tds[ci];
          if(c.key==='status') td.innerHTML=statusChip(item._obs);
          if(c.key==='cpa'){ const mc=metaColorClass(item._cpa,METAS.cpa); if(mc) td.classList.add(mc); }
          if(c.key==='roas'){ const mc=metaColorClassHigh(item._roas,METAS.roas); if(mc) td.classList.add(mc); }
        });
      });
    }
  });
}

/* Top Anúncios (separado p/ recolorir sem re-renderizar os gráficos quando o
   usuário edita as metas). Mostra TODOS os anúncios com gasto (campeões com
   amostra relevante primeiro, depois pela qualidade). Só os que têm amostra
   relevante (adSampleOk) recebem "Avaliável"; o resto fica "Em observação". */
function renderRelAds(){
  const fM=metaActive();
  const struct=adStructMap(fM);
  const agg=buildAgg(fM,'ad');
  const pool=Object.entries(agg).filter(([ad,a])=>a.sp>0).map(([ad,a])=>({ad, a, struct:struct[ad]||{camp:'—',adset:'—'}}));

  const all=pool.slice().sort((x,y)=>{ const sx=adSampleOk(x.a), sy=adSampleOk(y.a);
    if(sx!==sy) return sx?-1:1; return cmpBest(x.a,y.a); })
    .map(it=>({...it, obs:!adSampleOk(it.a)}));
  const champs=all.filter(it=>!it.obs).length;

  relRenderAdTable('relTop',all);
  document.getElementById('relTopCount').textContent =
    champs+' '+(champs===1?'avaliável':'avaliáveis')+' de '+all.length+' anúncio'+(all.length===1?'':'s')+' com gasto';
}

/* nota de referência do painel de metas (mostra as metas ativas + legenda de cor) */
function renderMetasNote(){
  const el=document.getElementById('relMetasNote'); if(!el) return;
  const cpa=METAS.cpa==null?'<b>não definida</b>':('<b>'+brl(METAS.cpa)+'</b>');
  const roas=METAS.roas==null?'<b>não definida</b>':('<b>'+roasf(METAS.roas)+'</b>');
  el.innerHTML=`Referência ativa — Meta CPA: ${cpa} · Meta ROAS: ${roas} · Amostra mínima: <b>${intf(METAS.volMin)} venda${METAS.volMin===1?'':'s'}</b> e <b>${brl(SAMPLE_MIN_SPEND)}</b> de gasto · Referência de corte: <b>${intf(METAS.nDias)} dias</b> fora da meta (critério do gestor; a tabela não aplica sozinha). `
    +((METAS.cpa==null&&METAS.roas==null)?'Preencha as metas para colorir CPA e ROAS na tabela de anúncios. ':'')
    +'Código de cor: <span class="mc-lg mc-green">verde = na meta</span> <span class="mc-lg mc-yellow">amarelo = até 30% fora</span> <span class="mc-lg mc-red">vermelho = além disso</span>.';
}
function syncMetasInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=(v==null?'':v); };
  set('metaCpa',METAS.cpa); set('metaRoas',METAS.roas); set('metaVolMin',METAS.volMin); set('metaNdias',METAS.nDias);
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
  renderRelAds();
}

/* colunas padrão das tabelas de heatmap por dia. Impressões e CPC ficam de fora
   porque a tabela cabe na largura do card (fit) e com 14 colunas os valores em R$
   cortavam; os dois estão no funil e nas tabelas da hierarquia. */
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date',w:86},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto',w:92},
  {key:'cpm',label:'CPM',type:'brl'},{key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},
  {key:'hook',label:'Hook',type:'pct',heat:'hook'},
  {key:'ck',label:'Checkouts',type:'int',heat:'ck',w:84},{key:'vd',label:'Vendas',type:'int',heat:'vendas'},
  {key:'cpa',label:'CPA',type:'brl'},{key:'fat',label:'Fat.',type:'brl',w:92},
  {key:'roas',label:'ROAS',type:'roas',heat:'roas'},
];
function dailyCells(x,d,isTotal){
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d),
    gasto:d.gasto, im:x.im, cpm:d.cpm, cl:x.cl, ctr:d.ctr, cpc:d.cpc, hook:d.hook,
    ck:x.ck, vd:x.vd, cpa:d.cpa, fat:x.fat, roas:d.roas};
}

/* ---------------- PAGE 2: Captura Meta Ads ---------------- */
/* recorte pelo filtro cruzado (campanha/conjunto/anúncio). ex = dimensão a NÃO
   filtrar — cada tabela da hierarquia ignora a própria seleção para continuar
   mostrando as linhas irmãs (multi-seleção com Ctrl). */
function metaScope(ex, base){ let fM=base||metaActive();
  if(ex!=='C'&&STATE.mSelC.size) fM=fM.filter(r=>STATE.mSelC.has(r.camp));
  if(ex!=='A'&&STATE.mSelA.size) fM=fM.filter(r=>STATE.mSelA.has(r.adset));
  if(ex!=='D'&&STATE.mSelAd.size) fM=fM.filter(r=>STATE.mSelAd.has(r.ad));
  return fM; }
/* selecao multipla: Ctrl adiciona (OR) sem sumir as demais linhas; clique simples troca a ancora */
function selDim(dim,key,ctrl){
  const sets={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}, s=sets[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const sole=s.has(key)&&s.size===1&&!Object.entries(sets).some(([k2,x])=>k2!==dim&&x.size);
    Object.values(sets).forEach(x=>x.clear()); if(!sole) s.add(key); }
  // renderAll (e não renderMeta direto) para a barra de filtros ativos no topo
  // acompanhar o clique.
  renderAll();
}
function renderMeta(){
  const fM=metaScope(null);   // KPIs, funil, graficos e tabela diaria
  const t=totals(fM), dv=derive(t);
  document.getElementById('metaFunnel').innerHTML=funnelHTML(funnelSteps(t));

  comboChart('mCombo', daily(fM));
  const adAggM=buildAgg(fM,'ad');
  const items=Object.entries(adAggM).map(([label,a])=>({label,a}));
  // barras de vendas por anúncio
  hbar('mVdAd', items, x=>x.a.vd, ()=>cvar('--chart-vendas'), 10, 'vendas');
  // donut de conversão (checkout -> venda)
  donutCkVenda('mConvDonut', t.vd, t.ck);
  // Compilado dos Anúncios — quem vendeu primeiro (menor CPA no topo), depois
  // os demais pelo número de checkouts
  const topRows=items.filter(x=>x.a.sp>0).map(({label,a})=>{const d=derive(a);
    return {k:label, cells:{dim:label,gasto:d.gasto,ck:a.ck,vd:a.vd,cpa:d.cpa,roas:d.roas}, a};})
    .sort((x,y)=>cmpBest(x.a,y.a)).slice(0,10);
  // sem fit: largura automática por coluna + scroll horizontal dentro do card
  renderTable({id:'mTopCpa', center:true,
    cols:[{key:'dim',label:'Anúncios',type:'dim',big:true},
      {key:'gasto',label:'Gasto',type:'brl'},
      {key:'ck',label:'Checkouts',type:'int'},{key:'vd',label:'Vendas',type:'int'},
      {key:'cpa',label:'CPA',type:'brl'},{key:'roas',label:'ROAS',type:'roas'}],
    rows:topRows});

  const fR=metaScope(null, rangeActive()), tR=totals(fR);   // período inteiro (ver renderGeralCore)
  const dl=daily(fR).reverse();
  renderTable({id:'tDaily', cols:DAILY_COLS, center:true, fit:true,
    rows:dl.map(x=>{const d=derive(x); return {k:x.d, cells:dailyCells(x,d)};}),
    total:dailyCells({...tR,d:null},derive(tR),true),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });

  // hierarquia — cada tabela vem do escopo que exclui a PRÓPRIA dimensão,
  // então todas as linhas irmãs continuam visíveis para multi-seleção (Ctrl).
  // band:'l' (dim+Gasto) fica grudado na borda esquerda; as demais colunas
  // rolam horizontalmente juntas (band do meio).
  const hcols=[
    {key:'dim',label:'',type:'dim',big:true,band:'l'},{key:'gasto',label:'Gasto',type:'brl',band:'l'},
    {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
    {key:'rc',label:'Alcance',type:'int'},{key:'freq',label:'Freq.',type:'num'},
    {key:'hook',label:'Hook',type:'pct'},
    {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},{key:'cpc',label:'CPC',type:'brl'},
    {key:'ck',label:'Checkouts',type:'int'},{key:'cpck',label:'Custo/Ck',type:'brl'},
    {key:'vd',label:'Vendas',type:'int'},{key:'cpa',label:'CPA',type:'brl'},
    {key:'fat',label:'Fat.',type:'brl'},{key:'roas',label:'ROAS',type:'roas'},
  ];
  const hcells=(k,a)=>{const d=derive(a);
    return {dim:k,gasto:d.gasto,im:a.im,cpm:d.cpm,rc:a.rc,freq:d.freq,hook:d.hook,cl:a.cl,ctr:d.ctr,cpc:d.cpc,
      ck:a.ck,cpck:d.cpck,vd:a.vd,cpa:d.cpa,fat:a.fat,roas:d.roas};};
  function hierRows(map){ return Object.entries(map).map(([k,a])=>({k, cells:hcells(k,a)})); }
  function totRowOf(tt){ return {...hcells(null,tt), dim:null}; }
  const Sc=metaScope('C'), Sa=metaScope('A'), Sd=metaScope('D');
  const aggC=buildAgg(Sc,'camp'), aggA=buildAgg(Sa,'adset'), aggD=buildAgg(Sd,'ad');
  renderTable({id:'tCamp', cols:hcols.map((c,i)=>i===0?{...c,label:'Campanha'}:c), rows:hierRows(aggC), total:totRowOf(totals(Sc)),
    selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', cols:hcols.map((c,i)=>i===0?{...c,label:'Conjunto',big:true}:c), rows:hierRows(aggA), total:totRowOf(totals(Sa)),
    selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', cols:hcols.map((c,i)=>i===0?{...c,label:'Anúncio'}:c), rows:hierRows(aggD), total:totRowOf(totals(Sd)),
    selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});

  // cada gráfico varia a dimensão da sua tabela — métrica escolhida nos botões,
  // 1 linha por membro, legenda própria e filtro bidirecional com a tabela.
  renderDimMetricBtns();
  dimChart('chCamp', Sc, aggC, 'camp', STATE.mSelC);
  dimChart('chAdset', Sa, aggA, 'adset', STATE.mSelA);
  dimChart('chAd', Sd, aggD, 'ad', STATE.mSelAd);

  // retenção do vídeo por criativo (é o que a aba Criativos tem de próprio)
  const vRows=items.filter(x=>x.a.im>0).map(({label,a})=>{const d=derive(a);
    return {k:label, cells:{ad:label,im:a.im,hook:d.hook,hold:d.hold,p25:a.p25,r2550:d.r2550,p100:a.p100,compl:d.compl,ctr:d.ctr,vd:a.vd}};})
    .sort((x,y)=>y.cells.im-x.cells.im);
  document.getElementById('qCount').textContent=vRows.length+' anúncio'+(vRows.length===1?'':'s');
  const vt=derive(t);
  renderTable({id:'tCriativos', center:true,
    cols:[{key:'ad',label:'Anúncio',type:'dim',big:true},{key:'im',label:'Impr.',type:'int'},
      {key:'hook',label:'Hook Rate',type:'pct'},
      ...(TEM_HOLD?[{key:'hold',label:'Hold Rate',type:'pct'}]:[]),
      {key:'p25',label:'Play 25%',type:'int'},{key:'r2550',label:'Ret. 25%→50%',type:'pct'},
      {key:'p100',label:'Play 100%',type:'int'},{key:'compl',label:'Ret. 25%→100%',type:'pct'},
      {key:'ctr',label:'CTR',type:'pct'},{key:'vd',label:'Vendas',type:'int'}],
    rows:vRows,
    total:{ad:null,im:t.im,hook:vt.hook,hold:vt.hold,p25:t.p25,r2550:vt.r2550,p100:t.p100,compl:vt.compl,ctr:vt.ctr,vd:t.vd}});
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
function setPage(p){ STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.getElementById('page-geral').classList.toggle('active',p==='geral');
  document.getElementById('page-meta').classList.toggle('active',p==='meta');
  document.getElementById('page-rel').classList.toggle('active',p==='rel');
  document.getElementById('ptitle').textContent = p==='meta'?'Captura Meta Ads':(p==='rel'?'Relatório':'Visão Geral de Vendas');
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'', p==='meta'?'#meta':(p==='rel'?'#rel':'#geral'));
  renderAll();
}
/* ---------------- barra de filtros ativos ----------------
   Clicar numa linha de campanha/conjunto/anúncio filtra a página inteira,
   inclusive o funil e a tabela diária, que ficam ACIMA das tabelas onde o
   clique acontece. Sem um aviso fixo no topo dá para olhar o funil e achar que
   é o total do período quando na verdade é o recorte de uma campanha — foi
   exatamente o que aconteceu. Esta barra torna o filtro impossível de não ver e
   dá como sair dele. */
function activeFilters(){
  const out=[];
  const lista=(set,rot,limpar)=>{ if(!set.size) return;
    const v=[...set]; out.push({rot, txt: v.length===1?v[0]:v.length+' selecionados',
      full:v.join(' · '), limpar}); };
  lista(STATE.mSelC,'Campanha',()=>STATE.mSelC.clear());
  lista(STATE.mSelA,'Conjunto',()=>STATE.mSelA.clear());
  lista(STATE.mSelAd,'Anúncio',()=>STATE.mSelAd.clear());
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
        +`<b>${x.rot}:</b> ${escHtml(x.txt)}<button class="fb-x" type="button" aria-label="Remover filtro">✕</button></span>`).join('')
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
   a tabela de anúncios (sem re-renderizar os gráficos) */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const onEdit=()=>{
    METAS.cpa=num(document.getElementById('metaCpa'));
    METAS.roas=num(document.getElementById('metaRoas'));
    const vm=num(document.getElementById('metaVolMin')); METAS.volMin=(vm!=null&&vm>=1)?Math.round(vm):METAS_DEFAULT.volMin;
    const nd=num(document.getElementById('metaNdias')); METAS.nDias=(nd!=null&&nd>=1)?Math.round(nd):METAS_DEFAULT.nDias;
    saveMetas(); renderMetasNote();
    if(STATE.page==='rel') renderRelAds();   // só a tabela, sem mexer nos gráficos
  };
  ['metaCpa','metaRoas','metaVolMin','metaNdias'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',onEdit); });
  const rb=document.getElementById('relMetasReset');
  if(rb) rb.addEventListener('click',()=>{ Object.assign(METAS,METAS_DEFAULT);
    try{ localStorage.removeItem('dm_metas'); }catch(e){} syncMetasInputs(); if(STATE.page==='rel') renderRelAds(); });
  syncMetasInputs();
})();

document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build __BUILD_ID__';
document.getElementById('buildFoot2').textContent='· build __BUILD_ID__';

syncDateInputs();
setPage(location.hash==='#meta'?'meta':(location.hash==='#rel'?'rel':'geral'));
window.addEventListener('hashchange',()=>{ const p=location.hash==='#meta'?'meta':(location.hash==='#rel'?'rel':'geral'); if(p!==STATE.page) setPage(p); });

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);

