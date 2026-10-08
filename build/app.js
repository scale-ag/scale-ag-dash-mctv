"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const FIN = DATA.fin, B = DATA.build;
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
  sort:{}, colw: JSON.parse(localStorage.getItem('dm_colw')||'{}'),
};
const taxf = ()=> STATE.tax ? TAX : 1;

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}
const finActive  = ()=> FIN.filter(r=>dateActive(r.d));
/* período do seletor IGNORANDO os dias clicados: é o que a tabela diária lista,
   para dar para clicar (Ctrl) em outros dias depois do primeiro */
const rangeActive = ()=> FIN.filter(r=>r.d && (!STATE.from || r.d>=STATE.from) && (!STATE.to || r.d<=STATE.to));
/* nº de dias do recorte (média por dia): dias clicados ou dias de calendário do
   período, limitado ao intervalo que a planilha cobre */
function periodDays(){
  if(STATE.selDays.size) return STATE.selDays.size;
  const f=[STATE.from,B.date_min].filter(Boolean).sort().pop(), t=[STATE.to,TODAY].filter(Boolean).sort()[0];
  if(!f||!t||f>t) return 1;
  return Math.round((new Date(t+'T00:00:00')-new Date(f+'T00:00:00'))/86400000)+1;
}

/* ---------------- aggregation ----------------
   Uma única fonte: a aba Financeiro (1 linha = 1 dia). Campos do registro
   (build.py): sp=investimento no Meta (sem imposto) · im=impressões (Cliques ÷
   CTR) · cl=cliques · lc=cliques no link · lpv=visualizações da página de
   destino · ck=checkouts · vd=vendas · fb/fl=faturamento bruto/líquido.
   Tudo é SOMA, então as taxas (CTR, Connect Rate, ROAS, CPA) saem ponderadas
   pelo volume do período, e não pela média das taxas de cada dia.
   O imposto (taxf) multiplica SÓ o gasto; faturamento nunca leva imposto, então
   ROAS = faturamento ÷ (gasto × imposto) e Lucro = líquido − gasto × imposto. */
const FIELDS=['sp','im','cl','lc','lpv','ck','vd','fb','fl'];
const zeroAgg=()=>{ const a={}; FIELDS.forEach(f=>{a[f]=0;}); return a; };
function addTo(a,r){ FIELDS.forEach(f=>{ a[f]+=r[f]||0; }); return a; }
function derive(a){
  const g=a.sp*taxf(), lucro=a.fl-g;
  return {gasto:g, lucro,
    cpm:a.im?g/a.im*1000:null, ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    ctrl:a.im?a.lc/a.im:null, cpcl:a.lc?g/a.lc:null,
    connect:a.lc?a.lpv/a.lc:null, cplpv:a.lpv?g/a.lpv:null,
    cpck:a.ck?g/a.ck:null, lpvck:a.lpv?a.ck/a.lpv:null,
    cpa:a.vd?g/a.vd:null, ckv:a.ck?a.vd/a.ck:null, convpag:a.lpv?a.vd/a.lpv:null,
    roas:g?a.fb/g:null, roasl:g?a.fl/g:null, ticket:a.vd?a.fb/a.vd:null,
    taxa:a.fb?(a.fb-a.fl)/a.fb:null,             // taxas da plataforma de venda (% do bruto)
    roi:g?lucro/g:null, margem:a.fb?lucro/a.fb:null};
}
function totals(fM){ const a=zeroAgg(); fM.forEach(r=>addTo(a,r)); return a; }
/* agregação diária (a aba já tem 1 linha por dia; agrupar mantém a regra caso
   um dia apareça repetido) */
function daily(fM){
  const days={};
  fM.forEach(r=>{ if(!r.d) return; addTo(days[r.d]||(days[r.d]={d:r.d,...zeroAgg()}), r); });
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
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
    const tc=c.cls?c.cls({cells:cfg.total}):'';   // ex.: Lucro negativo em vermelho também no total
    return `<td class="${c.type==='dim'?'dim':''}${tc?' '+tc:''}${stkCls(c)}" title="${isFirst?'Total Geral':esc(fmtStd(c.type,v))}">${isFirst?'Total Geral':fmt(c.type,v)}</td>`;
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
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante).
   Gasto=vermelho · Checkouts=azul · Connect Rate=ciano · Vendas=verde · ROAS=amarelo. */
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
   até as Vendas. Sem as colunas de tráfego na planilha (tem_trafego=false), as
   etapas de clique no link e visualização ficam apagadas. */
function funnelSteps(t){
  const dv=derive(t), semTrafego=B.tem_trafego===false;
  return [
    ['Gasto Total', brl(dv.gasto), [], false, 'hl-gasto'],
    ['Impressões', intf(t.im), [['CPM',brl(dv.cpm)]]],
    ['Cliques', intf(t.cl), [['CTR',pct(dv.ctr)],['CPC',brl(dv.cpc)]]],
    ['Cliques no link', intf(t.lc), [['CTR do link',pct(dv.ctrl)],['Custo/clique',brl(dv.cpcl)]], semTrafego],
    ['Visualizações da página', intf(t.lpv), [['Connect Rate',pct(dv.connect)],['Custo/visualização',brl(dv.cplpv)]], semTrafego],
    ['Checkouts', intf(t.ck), [['Custo/Checkout',brl(dv.cpck)],['Página→Checkout',pct(dv.lpvck)]]],
    ['Vendas', intf(t.vd), [['CPA',brl(dv.cpa)],['Checkout→Venda',pct(dv.ckv)]], false, 'hl-venda'],
    ['Faturamento bruto', brl(t.fb), [['ROAS',roasf(dv.roas)],['Ticket médio',brl(dv.ticket)]], false, 'hl-fat'],
    ['Faturamento líquido', brl(t.fl), [['ROAS líquido',roasf(dv.roasl)],['Taxas da venda',pct(dv.taxa)]]],
    ['Lucro Real', brl(dv.lucro), [['ROI',pct(dv.roi)],['Margem',pct(dv.margem)]], false, dv.lucro<0?'hl-gasto':'hl-venda'],
  ];
}
const lucroCls=v=>(v==null||!isFinite(v)||Math.abs(v)<0.005)?'':(v<0?'neg':'pos');

/* ---------------- charts ---------------- */
const charts={};
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
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
/* Evolução diária: Checkouts e Vendas (barras) · Gasto e Faturamento bruto (linhas) */
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
      {type:'line',label:'Faturamento bruto',data:d.map(x=>+x.fb.toFixed(2)),borderColor:cFat,backgroundColor:cFat,yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:legendOpts(),
        tooltip:{callbacks:{title:c=>c.length?dayTitle(d[c[0].dataIndex].d):'',label:c=>{const v=c.raw; return c.dataset.label+': '+(c.dataset.yAxisID==='y1'?brl(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10},precision:0},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Checkouts · Vendas',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'R$',color:mut,font:{size:10}}}}}
  });
}
/* Lucro Real por dia (líquido − gasto com imposto): barra verde = lucro ·
   vermelha = prejuízo. Dias sem gasto e sem faturamento ficam de fora. */
function lucroChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const rows=d.filter(x=>x.sp>0||x.fl>0);
  chartEmpty(id, !rows.length, 'Sem gasto nem faturamento no período');
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
  chartEmpty(id, !d.length, 'Sem dados no período');
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
/* Checkouts e vendas somados por dia da semana (segunda a domingo) */
function weekdayChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const ORDER=[1,2,3,4,5,6,0], ck=Array(7).fill(0), vd=Array(7).fill(0);
  d.forEach(x=>{ const w=new Date(x.d+'T00:00:00').getDay(); ck[w]+=x.ck; vd[w]+=x.vd; });
  chartEmpty(id, !ck.some(Boolean)&&!vd.some(Boolean), 'Nenhum checkout no período');
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'bar',
    data:{labels:ORDER.map(i=>WD[i]), datasets:[
      {label:'Checkouts',data:ORDER.map(i=>ck[i]),backgroundColor:cvar('--chart-ck'),borderRadius:3},
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
    {label:'Página → Checkout', v:dv.lpvck, aux:intf(t.ck)+' checkouts de '+intf(t.lpv)+' visualizações'},
    {label:'Checkout → Venda', v:dv.ckv, aux:intf(t.vd)+' vendas de '+intf(t.ck)+' checkouts'},
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
/* Donut de conversão (checkout → venda): verde = checkout que virou venda ·
   cinza = abandonou. */
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

/* ---------------- KPI cards ---------------- */
function kpiCard(k){ return `<div class="kpi ${k.hero?'hero':''}"><div class="kl"><span>${k.label}</span>${k.pill?`<span class="pill q">${k.pill}</span>`:''}</div><div class="kv ${k.tone||''}">${k.val}</div><div class="ka">${k.aux||''}</div></div>`; }

/* ---------------- tabelas diárias ---------------- */
/* Visão Geral / Relatório: o resultado do dia. Cabe na largura do card (fit),
   por isso o tráfego fica na tabela da página Tráfego. */
const DAILY_COLS=[
  {key:'date',label:'Data',type:'date',w:86},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto',w:92},
  {key:'lpv',label:'Visualiz.',type:'int'},
  {key:'ck',label:'Checkouts',type:'int',heat:'ck',w:84},{key:'vd',label:'Vendas',type:'int',heat:'vendas'},
  {key:'cpa',label:'CPA',type:'brl'},{key:'fb',label:'Fat. bruto',type:'brl',w:92},
  {key:'fl',label:'Fat. líq.',type:'brl',w:92},
  {key:'lucro',label:'Lucro',type:'brl',w:96,cls:r=>lucroCls(r.cells.lucro)},
  {key:'roas',label:'ROAS',type:'roas',heat:'roas'},
];
/* Tráfego Meta Ads: do gasto ao checkout */
const TRAFFIC_COLS=[
  {key:'date',label:'Data',type:'date',w:86},{key:'wd',label:'Dia',type:'dim',w:46},
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto',w:92},
  {key:'im',label:'Impr.',type:'int'},{key:'cpm',label:'CPM',type:'brl'},
  {key:'cl',label:'Cliques',type:'int'},{key:'ctr',label:'CTR',type:'pct'},
  {key:'lc',label:'Cliq. link',type:'int'},{key:'lpv',label:'Visualiz.',type:'int'},
  {key:'connect',label:'Connect',type:'pct',heat:'connect'},{key:'cplpv',label:'Custo/Vis.',type:'brl'},
  {key:'ck',label:'Checkouts',type:'int',heat:'ck',w:84},
];
function dayCells(x,d,isTotal){
  return {date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d),
    gasto:d.gasto, im:x.im, cpm:d.cpm, cl:x.cl, ctr:d.ctr, lc:x.lc, lpv:x.lpv, connect:d.connect, cplpv:d.cplpv,
    ck:x.ck, vd:x.vd, cpa:d.cpa, fb:x.fb, fl:x.fl, lucro:d.lucro, roas:d.roas};
}
/* tabela diária: lista o período inteiro do seletor (último dia no topo); os
   dias clicados ficam destacados e são o que o resto da página mostra */
function renderDailyTable(id, cols){
  const fR=rangeActive(), tR=totals(fR);
  const dl=daily(fR).reverse();
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
const GERAL_IDS={funnel:'geralFunnel',kpis2:'geralKpis2',combo:'gCombo',lucro:'gLucro',acum:'gAcum',wd:'gWd',conv:'gConv',daily:'gDaily'};
const REL_IDS  ={funnel:'relFunnel', kpis2:'relKpis2', combo:'rCombo',lucro:'rLucro',acum:'rAcum',wd:'rWd',conv:'rConv',daily:'rDaily'};
function renderGeral(){ renderGeralCore(GERAL_IDS); }
function renderGeralCore(ids){
  const fM=finActive();
  const t=totals(fM), dv=derive(t), g=dv.gasto;
  document.getElementById(ids.funnel).innerHTML=funnelHTML(funnelSteps(t));

  // ---- métricas secundárias (não repetem o funil) ----
  const dd=daily(fM), nDays=periodDays();
  const lucroDia=x=>x.fl-x.sp*taxf();
  const ativos=dd.filter(x=>x.sp>0||x.fl>0);           // dias com gasto ou faturamento
  const diasGasto=dd.filter(x=>x.sp>0).length, diasVenda=dd.filter(x=>x.vd>0).length;
  const diasLucro=ativos.filter(x=>lucroDia(x)>0).length, diasPrej=ativos.filter(x=>lucroDia(x)<0).length;
  const melhor=ativos.length?ativos.reduce((a,b)=>lucroDia(b)>lucroDia(a)?b:a):null;
  const pior=ativos.length?ativos.reduce((a,b)=>lucroDia(b)<lucroDia(a)?b:a):null;
  // ROAS bruto em que o lucro zera: líquido = gasto  =>  bruto ÷ gasto = bruto ÷ líquido
  const roasEq=t.fl>0?t.fb/t.fl:null;
  const k2=[
    {label:'Vendas por dia (média)',val:numf(t.vd/nDays),aux:brl(g/nDays)+' de gasto/dia'},
    {label:'Lucro por dia (média)',val:brl(dv.lucro/nDays),tone:lucroCls(dv.lucro),aux:brl(t.fl/nDays)+' de faturamento líquido/dia'},
    {label:'Dias com venda',val:intf(diasVenda),aux:'de '+intf(diasGasto)+' dia'+(diasGasto===1?'':'s')+' com gasto'},
    {label:'Dias no lucro',val:intf(diasLucro),aux:intf(diasPrej)+' no prejuízo'},
    {label:'Melhor dia (lucro)',val:melhor?brl(lucroDia(melhor)):'-',tone:melhor?lucroCls(lucroDia(melhor)):'',aux:melhor?brdate(melhor.d)+' · '+intf(melhor.vd)+' venda'+(melhor.vd===1?'':'s'):'—'},
    {label:'Pior dia (lucro)',val:pior?brl(lucroDia(pior)):'-',tone:pior?lucroCls(lucroDia(pior)):'',aux:pior?brdate(pior.d)+' · '+intf(pior.vd)+' venda'+(pior.vd===1?'':'s'):'—'},
    {label:'ROAS de equilíbrio',val:roasf(roasEq),aux:roasEq!=null?'ROAS bruto p/ lucro zero · atual '+roasf(dv.roas):'nenhuma venda no período'},
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
function renderMeta(){
  const fM=finActive();
  const t=totals(fM), dd=daily(fM);
  document.getElementById('metaFunnel').innerHTML=funnelHTML(funnelSteps(t).slice(0,7));
  trafficCombo('mCombo', dd);
  lineDaily('mConnect', dd, [{label:'Connect Rate',fn:x=>derive(x).connect,color:cvar('--chart-connect')}],
    pct, v=>nf0.format(v*100)+'%', 'Sem cliques no link no período');
  lineDaily('mCustos', dd, [
      {label:'Custo por clique no link',fn:x=>derive(x).cpcl,color:cvar('--chart-lc')},
      {label:'Custo por visualização',fn:x=>derive(x).cplpv,color:cvar('--chart-cpa')}],
    brl, v=>'R$'+nf1.format(v), 'Sem tráfego no período');
  donutCkVenda('mConvDonut', t.vd, t.ck);
  renderDailyTable('tDaily', TRAFFIC_COLS);
}

/* ---------------- PAGE 3: Relatório ----------------
   Espelha a Visão Geral (renderGeralCore com IDs próprios) e, abaixo, acrescenta
   o painel de Metas e o resumo por semana. */
/* ---- Metas & parâmetros (painel editável) — recolore o resumo AO VIVO ----
   Defaults vêm do build.py; o usuário edita no painel (persistido em
   localStorage 'dm_metas') e a tabela semanal recolore CPA/ROAS e reavalia a
   amostra na hora. Meta null = "não definida" (métrica fica sem cor). */
const METAS_DEFAULT = {
  cpa:   (B.meta_cpa!=null?B.meta_cpa:null),
  roas:  (B.meta_roas!=null?B.meta_roas:null),
  volMin:(B.volume_min_amostral!=null?B.volume_min_amostral:2),
};
function loadMetas(){
  let saved={}; try{ saved=JSON.parse(localStorage.getItem('dm_metas')||'{}'); }catch(e){}
  const m={...METAS_DEFAULT};
  ['cpa','roas'].forEach(k=>{ if(saved[k]!=null&&isFinite(saved[k])) m[k]=saved[k]; else if(k in saved && saved[k]===null) m[k]=null; });
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
/* Resumo por semana (segunda a domingo) do período. A aba Financeiro não tem
   quebra por anúncio, então é aqui que o gestor compara a evolução com as
   metas. Semana com menos vendas que o volume mínimo fica "Em observação". */
function renderRelWeeks(){
  const fM=finActive();
  const wk={};
  fM.forEach(r=>{ const k=weekStart(r.d);
    const w=wk[k]||(wk[k]={ini:k,dias:0,first:r.d,last:r.d,...zeroAgg()});
    addTo(w,r); w.dias++; if(r.d<w.first) w.first=r.d; if(r.d>w.last) w.last=r.d; });
  const list=Object.values(wk).sort((a,b)=>a.ini<b.ini?1:-1);   // semana mais recente no topo
  const ddmm=d=>brdate(d).slice(0,5);
  const cellsOf=(w,d)=>({ini:w.ini, per:ddmm(w.first)+(w.first===w.last?'':' a '+ddmm(w.last)),
    status:'', dias:w.dias, gasto:d.gasto, lc:w.lc, lpv:w.lpv, connect:d.connect, ck:w.ck, vd:w.vd,
    cpa:d.cpa, fb:w.fb, fl:w.fl, lucro:d.lucro, roas:d.roas});
  const rows=list.map(w=>{ const d=derive(w), obs=w.vd<METAS.volMin, cells=cellsOf(w,d);
    cells.status=obs?'Em observação':'Avaliável';   // texto p/ ordenar; o chip entra via afterRender
    return {k:w.ini, cells, _obs:obs, _cpa:d.cpa, _roas:d.roas}; });
  const tt=totals(fM), td=derive(tt);
  const total={...cellsOf({ini:null,first:'',last:'',dias:fM.length,...tt},td), ini:null, per:'', status:''};
  const cols=[
    {key:'ini',label:'Semana',type:'date',w:96},{key:'per',label:'Dias com dado',type:'dim'},
    {key:'status',label:'Status',type:'dim',w:140},{key:'dias',label:'Dias',type:'int',w:60},
    {key:'gasto',label:'Gasto',type:'brl'},{key:'lc',label:'Cliq. link',type:'int'},
    {key:'lpv',label:'Visualiz.',type:'int'},{key:'connect',label:'Connect',type:'pct'},
    {key:'ck',label:'Checkouts',type:'int'},{key:'vd',label:'Vendas',type:'int'},
    {key:'cpa',label:'CPA',type:'brl'},{key:'fb',label:'Fat. bruto',type:'brl'},
    {key:'fl',label:'Fat. líq.',type:'brl'},
    {key:'lucro',label:'Lucro',type:'brl',cls:r=>lucroCls(r.cells.lucro)},
    {key:'roas',label:'ROAS',type:'roas'},
  ];
  renderTable({id:'relTop', cols, rows, total, center:true,
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
  const nAval=rows.filter(r=>!r._obs).length;
  document.getElementById('relTopCount').textContent =
    list.length+' semana'+(list.length===1?'':'s')+' · '+nAval+' '+(nAval===1?'avaliável':'avaliáveis');
}

/* nota de referência do painel de metas (mostra as metas ativas + legenda de cor) */
function renderMetasNote(){
  const el=document.getElementById('relMetasNote'); if(!el) return;
  const cpa=METAS.cpa==null?'<b>não definida</b>':('<b>'+brl(METAS.cpa)+'</b>');
  const roas=METAS.roas==null?'<b>não definida</b>':('<b>'+roasf(METAS.roas)+'</b>');
  el.innerHTML=`Referência ativa — Meta CPA: ${cpa} · Meta ROAS: ${roas} · Semana avaliável a partir de <b>${intf(METAS.volMin)} venda${METAS.volMin===1?'':'s'}</b>. `
    +((METAS.cpa==null&&METAS.roas==null)?'Preencha as metas para colorir CPA e ROAS no resumo semanal. ':'')
    +'Código de cor: <span class="mc-lg mc-green">verde = na meta</span> <span class="mc-lg mc-yellow">amarelo = até 30% fora</span> <span class="mc-lg mc-red">vermelho = além disso</span>.';
}
function syncMetasInputs(){
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=(v==null?'':v); };
  set('metaCpa',METAS.cpa); set('metaRoas',METAS.roas); set('metaVolMin',METAS.volMin);
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
   Clicar numa data da tabela diária filtra a página inteira, inclusive o funil
   que fica ACIMA da tabela. Sem um aviso fixo no topo dá para olhar o funil e
   achar que é o total do período. Esta barra torna o filtro impossível de não
   ver e dá como sair dele. */
function activeFilters(){
  const out=[];
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
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.selDays.clear(); applyPreset('mes'); });
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

/* painel de Metas & parâmetros — edita ao vivo, salva em localStorage e recolore
   o resumo semanal (sem re-renderizar os gráficos) */
(function wireMetas(){
  const num=el=>{ const s=(el&&el.value||'').trim(); if(s==='') return null; const n=parseFloat(s.replace(',','.')); return isFinite(n)?n:null; };
  const onEdit=()=>{
    METAS.cpa=num(document.getElementById('metaCpa'));
    METAS.roas=num(document.getElementById('metaRoas'));
    const vm=num(document.getElementById('metaVolMin')); METAS.volMin=(vm!=null&&vm>=1)?Math.round(vm):METAS_DEFAULT.volMin;
    saveMetas(); renderMetasNote();
    if(STATE.page==='rel') renderRelWeeks();   // só a tabela, sem mexer nos gráficos
  };
  ['metaCpa','metaRoas','metaVolMin'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input',onEdit); });
  const rb=document.getElementById('relMetasReset');
  if(rb) rb.addEventListener('click',()=>{ Object.assign(METAS,METAS_DEFAULT);
    try{ localStorage.removeItem('dm_metas'); }catch(e){} syncMetasInputs(); if(STATE.page==='rel') renderRelWeeks(); });
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
