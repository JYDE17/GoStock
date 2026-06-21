// ══════════════════════════════════════════════════════════
// CONFIG — Remplacez par vos valeurs Supabase
// ══════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://myfkbgnyrmqmomeldnza.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rou40UhYQNryo9xHbiYkug_F5CJRcjw';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let user = null, profile = null;
let products = [], locations = [], categories = [], uoms = [], suppliers = [], movements = [];
let stockMap = {};        // productId -> { total, byLocation: [{locId,qty}] }
let currentView = 'dashboard', filterStatus = 'all', filterCat = 'all', searchQ = '';
let bcFoundProduct = null, bcStream = null, bcInterval = null;
let recvCart = [], bcCartMode = false;

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
function authTab(tab, el) {
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('form-login').style.display  = tab==='login'  ? '':'none';
  document.getElementById('form-signup').style.display = tab==='signup' ? '':'none';
  setAuthErr('');
}
function setAuthErr(msg, isGood=false) {
  const e = document.getElementById('auth-err');
  e.textContent = msg;
  e.style.background = isGood ? 'var(--green-dim)' : 'var(--red-dim)';
  e.style.color = isGood ? 'var(--green)' : 'var(--red)';
  e.style.border = `1px solid ${isGood ? 'rgba(62,207,114,.3)' : 'rgba(245,69,92,.3)'}`;
  e.classList.toggle('show', !!msg);
}
async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pw    = document.getElementById('l-pw').value;
  if(!email||!pw){ setAuthErr('Remplissez tous les champs.'); return; }
  const btn = document.getElementById('l-btn');
  btn.disabled=true; btn.textContent='Connexion…';
  const {data,error} = await sb.auth.signInWithPassword({email,password:pw});
  btn.disabled=false; btn.textContent='Se connecter';
  if(error){ setAuthErr(error.message); return; }
  await onSignedIn(data.user);
}
async function doSignup() {
  const name  = document.getElementById('s-name').value.trim();
  const email = document.getElementById('s-email').value.trim();
  const pw    = document.getElementById('s-pw').value;
  if(!name||!email||!pw){ setAuthErr('Remplissez tous les champs.'); return; }
  if(pw.length<8){ setAuthErr('Mot de passe trop court (min 8).'); return; }
  const btn = document.getElementById('s-btn');
  btn.disabled=true; btn.textContent='Création…';
  const {data,error} = await sb.auth.signUp({email,password:pw,options:{data:{full_name:name}}});
  btn.disabled=false; btn.textContent='Créer mon compte';
  if(error){ setAuthErr(error.message); return; }
  if(data.user) await onSignedIn(data.user);
  else setAuthErr('Vérifiez votre courriel pour confirmer.', true);
}
async function doMagicLink() {
  const email = document.getElementById('l-email').value.trim();
  if(!email){ setAuthErr("Entrez votre courriel d'abord."); return; }
  const {error} = await sb.auth.signInWithOtp({email});
  if(error){ setAuthErr(error.message); return; }
  setAuthErr('✓ Lien envoyé ! Vérifiez votre courriel.', true);
}
async function doSignOut() {
  await sb.auth.signOut();
  user=null; profile=null;
  document.getElementById('auth-wrap').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
}
async function onSignedIn(u) {
  user = u;
  document.getElementById('auth-wrap').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  const {data:p} = await sb.from('profiles').select('*').eq('id',u.id).single();
  profile = p || {email:u.email, full_name:u.email, role:'viewer'};
  const isAdmin = profile.role==='admin', isMgr = profile.role==='manager';
  const isOperation = profile.role==='operation';
  const canWrite = isAdmin || isMgr || isOperation;

  // Sidebar — Admin section
  document.getElementById('admin-nav').style.display = (isAdmin||isMgr) ? '' : 'none';
  document.getElementById('dd-admin').style.display  = isAdmin ? '' : 'none';
  document.getElementById('dd-migrate').style.display= isAdmin ? '' : 'none';

  // Pending inventories nav (manager + admin)
  const navPending = document.getElementById('nav-pending-inv');
  if(navPending) navPending.style.display = (isAdmin||isMgr) ? '' : 'none';

  // Pending withdrawals nav (manager + admin)
  const navWd = document.getElementById('nav-pending-wd');
  if(navWd) navWd.style.display = (isAdmin||isMgr) ? '' : 'none';

  // More sheet — settings/users only for admin
  const moreSettings = document.getElementById('more-settings');
  const moreUsers    = document.getElementById('more-users');
  if(moreSettings) moreSettings.style.display = isAdmin ? '' : 'none';
  if(moreUsers)    moreUsers.style.display    = isAdmin ? '' : 'none';
  const init = (profile.full_name||u.email||'?').slice(0,2).toUpperCase();
  document.getElementById('u-avatar').textContent = init;
  document.getElementById('u-name').textContent   = (profile.full_name||u.email||'').split(' ')[0];
  document.getElementById('dd-name').textContent  = profile.full_name||'—';
  document.getElementById('dd-email').textContent = profile.email||u.email;
  const r = document.getElementById('dd-role');
  r.textContent = profile.role; r.className = 'role-badge role-'+profile.role;


  await loadAll();
  restoreNavState();
}
function toggleUserMenu(){ document.getElementById('u-dropdown').classList.toggle('show'); }
function toggleRapports(){
  const dd=document.getElementById('rapports-dropdown');
  if(dd) dd.style.display=dd.style.display==='none'?'':'none';
}
document.addEventListener('click', e => {
  if(!document.getElementById('user-wrap')?.contains(e.target))
    document.getElementById('u-dropdown')?.classList.remove('show');
  if(!document.getElementById('rapports-wrap')?.contains(e.target)){
    const dd=document.getElementById('rapports-dropdown');
    if(dd) dd.style.display='none';
  }
});

// ══════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════
async function logAction(action, data={}) {
  if(!user) return;
  try {
    await sb.from('audit_log').insert({
      user_id:user.id, user_email:profile?.email||user.email,
      action, ...data
    });
  } catch(e){ console.warn('Audit:', e.message); }
}

// ══════════════════════════════════════════════════════════
// DATA LOADING (from Supabase)
// ══════════════════════════════════════════════════════════
async function loadAll() {
  document.getElementById('refresh-icon').classList.add('spin');
  try {
    const [
      {data:prods},  {data:locs}, {data:cats}, {data:u},
      {data:stocks}, {data:moves}, {data:sups}
    ] = await Promise.all([
      sb.from('products').select('*,alert_enabled').eq('active',true).order('name'),
      sb.from('locations').select('*').eq('active',true).order('name'),
      sb.from('categories').select('*').order('name'),
      sb.from('uoms').select('*').order('name'),
      sb.from('stock').select('*'),
      sb.from('movements').select('*').order('created_at',{ascending:false}).limit(300),
      sb.from('suppliers').select('*').order('name')
    ]);
    products  = prods  || [];
    locations = locs   || [];
    categories= cats   || [];
    uoms      = u      || [];
    suppliers = sups   || [];
    movements = moves  || [];

    // Build stockMap: productId -> { total, byLocation }
    stockMap = {};
    (stocks||[]).forEach(s => {
      if(!stockMap[s.product_id]) stockMap[s.product_id] = {total:0, byLocation:[]};
      stockMap[s.product_id].total += s.quantity;
      stockMap[s.product_id].byLocation.push({locId:s.location_id, qty:s.quantity, reserved:s.reserved});
    });

    updateAlerts();
    // Don't re-render if we're in a mobile scanner operation
    const mScanViews = ['receive','transfer','reduce','inventory'];
    if(!(window.innerWidth <= 768 && mScanViews.includes(currentView) && window._msCtx?.selectedProduct !== undefined)) {
      renderView(currentView);
    }
    // Load pending inventories for manager/admin
    if(profile?.role==='admin'||profile?.role==='manager') {
      const prevCount = pendingInventories.length;
      await loadPendingInventories();
      // Notify if new ones arrived
      if(pendingInventories.length > prevCount) {
        toast(`📋 ${pendingInventories.length} inventaire${pendingInventories.length>1?'s':''} en attente de validation`, 'info');
      }
      const prevWd = pendingWithdrawals.length;
      await loadPendingWithdrawals();
      if(pendingWithdrawals.length > prevWd) {
        toast(`📦 ${pendingWithdrawals.length} retrait${pendingWithdrawals.length>1?'s':''} en attente d'approbation`, 'info');
      }
    }
  } catch(e) { toast('Erreur chargement: '+e.message,'error'); }
  document.getElementById('refresh-icon').classList.remove('spin');
}

function getQty(pid) { return stockMap[pid]?.total || 0; }
function getStatus(qty, productId) {
  const p = productId ? products.find(x=>x.id===productId) : null;
  const threshold = (p?.alert_threshold != null) ? p.alert_threshold : (window._alertThreshold || 4);
  if(qty<=0)         return {label:'Rupture',      color:'red',   key:'out'};
  if(qty<=threshold) return {label:'Stock faible', color:'amber', key:'low'};
  return                    {label:'En stock',      color:'green', key:'instock'};
}
function updateAlerts() {
  const cnt = products.filter(p => p.alert_enabled !== false && getQty(p.id) <= (p.alert_threshold ?? window._alertThreshold ?? 4)).length;
  const b = document.getElementById('alert-badge');
  if(b){ b.textContent=cnt; b.classList.toggle('hidden',cnt===0); }
}

// ══════════════════════════════════════════════════════════
// NAV
// ══════════════════════════════════════════════════════════
function nav(view, el) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const found = el || [...document.querySelectorAll('.nav-item')]
    .find(n=>(n.getAttribute('onclick')||'').includes(`'${view}'`));
  if(found) found.classList.add('active');
  const titles={dashboard:'Vue d\'ensemble',alerts:'Alertes',products:'Produits',
    locations:'Emplacements',movements:'Mouvements',receive:'Réceptionner',
    transfer:'Transfert',reduce:'Réduire stock',inventory:'Faire inventaire',
    create:'Créer article',users:'Utilisateurs',
    pendinginv:'Confirmation d\'inventaire',pendingwd:'Confirmation de retrait',forecast:'Prévisions de rupture',
    finance:'Financier',recvreport:'Rapport de réceptions',settings:'Paramètres',auditlog:'Journal d\'audit'};
  document.getElementById('topbar-title').textContent = titles[view]||view;
  renderView(view);
  syncMobTabs(view);
}
function goTo(view, pid) {
  nav(view);
  if(pid) setTimeout(()=>{
    const m={receive:'recv-product',transfer:'tf-product',reduce:'red-product'};
    const cb={receive:()=>updateRecvInfo(),transfer:()=>updateTfInfo(),reduce:()=>updateRedInfo()};
    const sel=document.getElementById(m[view]);
    if(sel){sel.value=pid;(cb[view]||function(){})();}
    if(view==='inventory'){
      const input=document.getElementById('inv-qty-'+pid);
      // Mobile card
      const mobileRow=document.getElementById('inv-row-'+pid);
      // Desktop row
      const desktopRow=document.getElementById('inv-row-d-'+pid);
      const row = mobileRow || desktopRow;
      if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.borderColor='var(--blue)';row.style.background='var(--blue-bg)';setTimeout(()=>{row.style.borderColor='';row.style.background='';},2500);}
      if(input){input.focus();input.select();}
    }
  }, 150);
}
function renderView(v) {
  const c = document.getElementById('main-content');
  const map={dashboard:vDashboard,alerts:vAlerts,products:vProducts,
    locations:vLocations,movements:vMovements,receive:vReceive,
    transfer:vTransfer,reduce:vReduce,inventory:vInventory,
    create:vCreate,users:vUsers,pendinginv:vPendingInventories,pendingwd:vPendingWithdrawals,forecast:vForecast,finance:vFinance,recvreport:vRecvReport,settings:vSettings,auditlog:vAuditLog};
  (map[v]||vDashboard)(c);
}
function onSearch() {
  searchQ=document.getElementById('global-search').value.toLowerCase();
  if(currentView==='products') vProducts(document.getElementById('main-content'));
}

// ══════════════════════════════════════════════════════════
// VIEWS
// ══════════════════════════════════════════════════════════
function vDashboard(c) {
  const total=products.length;
  const instock=products.filter(p=>getQty(p.id)>4).length;
  const low=products.filter(p=>{const q=getQty(p.id);return q>0&&q<=4;}).length;
  const out=products.filter(p=>getQty(p.id)<=0).length;
  const totalVal=products.reduce((s,p)=>(s+(getQty(p.id))*(p.cost_price||0)),0);
  const recentMoves=movements.slice(0,6);
  // Stock by location
  const locTotals={};
  Object.values(stockMap).forEach(sm=>sm.byLocation.forEach(b=>{
    locTotals[b.locId]=(locTotals[b.locId]||0)+b.qty;
  }));
  const topLocs=Object.entries(locTotals).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([lid,qty])=>{
    const l=locations.find(x=>x.id==lid);
    return {name:l?.name||'?',qty};
  });
  // Top categories
  const catCount={};
  products.forEach(p=>{const n=categories.find(c=>c.id===p.category_id)?.name||'Sans catégorie';catCount[n]=(catCount[n]||0)+1;});
  const topCats=Object.entries(catCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  c.innerHTML=`
  <div class="stats-row" style="grid-template-columns:repeat(5,1fr)">
    <div class="stat-card blue"><div class="stat-label">Produits</div><div class="stat-num">${total}</div><div class="stat-sub">dans le catalogue</div><i class="ti ti-package stat-icon"></i></div>
    <div class="stat-card green"><div class="stat-label">En stock</div><div class="stat-num" style="color:var(--green)">${instock}</div><div class="stat-sub">disponibles</div><i class="ti ti-check stat-icon"></i></div>
    <div class="stat-card amber"><div class="stat-label">Stock faible</div><div class="stat-num" style="color:var(--amber)">${low}</div><div class="stat-sub">sous le seuil</div><i class="ti ti-alert-triangle stat-icon"></i></div>
    <div class="stat-card red"><div class="stat-label">Rupture</div><div class="stat-num" style="color:var(--red)">${out}</div><div class="stat-sub">à commander</div><i class="ti ti-x stat-icon"></i></div>
    <div class="stat-card blue"><div class="stat-label">Valeur stock</div><div class="stat-num" style="font-size:17px">${fmtCAD(totalVal)}</div><div class="stat-sub">coût total</div><i class="ti ti-cash stat-icon"></i></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div class="table-card">
      <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-alert-triangle" style="color:var(--amber);margin-right:6px"></i>Alertes stock</div>
        <button class="btn" onclick="nav('alerts')">Voir tout</button></div>
      ${alertRows(6)}
    </div>
    <div class="table-card">
      <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-arrows-exchange" style="color:var(--blue);margin-right:6px"></i>Derniers mouvements</div>
        <button class="btn" onclick="nav('movements')">Voir tout</button></div>
      <table><thead><tr><th>Produit</th><th>Qté</th><th>Type</th><th>Date</th></tr></thead>
      <tbody>${recentMoves.length?recentMoves.map(m=>{
        const p=products.find(x=>x.id===m.product_id);
        const cols={receive:'green',reduce:'red',transfer:'blue',inventory:'purple',import:'gray'};
        return `<tr onclick="nav('movements')" style="cursor:pointer">
          <td style="font-size:12px;font-weight:500">${escHtml((p?.name||'—').slice(0,26))}</td>
          <td style="font-family:var(--font-mono);color:var(--${cols[m.movement_type]||'gray'})">${m.movement_type==='reduce'||m.location_from&&!m.location_to?'-':'+'}${Math.abs(m.quantity)}</td>
          <td><span class="badge badge-${cols[m.movement_type]||'gray'}">${m.movement_type||'—'}</span></td>
          <td style="font-size:11px;color:var(--text3)">${fmtDate(m.created_at)}</td>
        </tr>`;
      }).join(''):'<tr><td colspan="4" class="empty" style="padding:24px">Aucun mouvement</td></tr>'}
      </tbody></table>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="table-card">
      <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-map-pin" style="color:var(--purple);margin-right:6px"></i>Stock par emplacement</div></div>
      ${topLocs.length?`<table><thead><tr><th>Emplacement</th><th>Quantité</th></tr></thead><tbody>
        ${topLocs.map(l=>`<tr onclick="nav('locations')" style="cursor:pointer">
          <td style="font-weight:500">${escHtml(l.name)}</td>
          <td style="font-family:var(--font-mono);color:var(--blue)">${Math.round(l.qty)}</td>
        </tr>`).join('')}</tbody></table>`
        :'<div class="empty" style="padding:24px">Aucune donnée de stock</div>'}
    </div>
    <div class="table-card">
      <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-tag" style="color:var(--amber);margin-right:6px"></i>Par catégorie</div></div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        ${topCats.map(([name,count])=>{const pct=total?Math.round(count/total*100):0;return`<div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span>${escHtml(name)}</span><span style="color:var(--text3);font-family:var(--font-mono)">${count} (${pct}%)</span>
          </div>
          <div style="background:var(--bg2);border-radius:4px;height:6px;overflow:hidden">
            <div style="height:100%;background:var(--blue);width:${pct}%;border-radius:4px"></div>
          </div></div>`;}).join('')}
      </div>
    </div>
  </div>`;
}

function alertRows(limit=999) {
  const alerts=products.filter(p=>p.alert_enabled!==false && getQty(p.id)<=(p.alert_threshold??window._alertThreshold??4)).slice(0,limit);
  if(!alerts.length) return '<div class="empty" style="padding:24px"><i class="ti ti-check" style="color:var(--green)"></i>Aucune alerte</div>';
  return`<table><thead><tr><th>Produit</th><th>Réf.</th><th>Qté</th><th>Statut</th></tr></thead><tbody>
    ${alerts.map(p=>{const s=getStatus(getQty(p.id), p.id);return`<tr onclick="showProd(${p.id})">
      <td style="font-weight:500">${escHtml(p.name)}</td>
      <td class="mono">${escHtml(p.reference||'—')}</td>
      <td style="font-family:var(--font-mono)">${Math.round(getQty(p.id))}</td>
      <td><span class="badge badge-${s.color}">${s.label}</span></td>
    </tr>`;}).join('')}
  </tbody></table>`;
}

function renderAlertToggle(p) {
  const on = p.alert_enabled !== false;
  return `<div onclick="quickToggleAlert(event,${p.id})" style="
    width:40px;height:22px;border-radius:11px;position:relative;cursor:pointer;flex-shrink:0;
    background:${on?'var(--amber)':'var(--bg3)'};
    border:1px solid ${on?'var(--amber)':'var(--border2)'};
    transition:all .2s" title="${on?'Désactiver l\'alerte':'Activer l\'alerte'}">
    <div style="position:absolute;top:2px;left:${on?'18px':'2px'};width:16px;height:16px;
      border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
  </div>`;
}

async function quickToggleAlert(e, id) {
  e.stopPropagation();
  const p = products.find(x=>x.id===id); if(!p) return;
  const newVal = p.alert_enabled === false ? true : false;
  const {error} = await sb.from('products').update({alert_enabled:newVal}).eq('id',id);
  if(error){toast('Erreur: '+error.message,'error');return;}
  // Update local state immediately
  p.alert_enabled = newVal;
  updateAlerts();
  toast(newVal?`✓ Alertes activées — ${p.name}`:`✓ Alertes désactivées — ${p.name}`,'success');
  // Refresh current view
  const c = document.getElementById('main-content');
  if(currentView==='alerts') vAlerts(c);
  else if(currentView==='dashboard') vDashboard(c);
}

let alertFilter = 'all';

async function vAlerts(c) {
  c = c || document.getElementById('main-content');

  const lastRecv={}, totalRecv={};
  movements.forEach(m=>{
    if(m.movement_type==='receive'&&m.product_id){
      if(!lastRecv[m.product_id]||new Date(m.created_at)>new Date(lastRecv[m.product_id].date))
        lastRecv[m.product_id]={date:m.created_at,qty:m.quantity};
      totalRecv[m.product_id]=(totalRecv[m.product_id]||0)+(m.quantity||0);
    }
  });

  const enabled  = products.filter(p=>p.alert_enabled!==false);
  const disabled = products.filter(p=>p.alert_enabled===false);
  const all = enabled.filter(p=>getQty(p.id)<=(p.alert_threshold??window._alertThreshold??4));
  const out = all.filter(p=>getQty(p.id)<=0);
  const low = all.filter(p=>getQty(p.id)>0);
  let list  = alertFilter==='out'?out:alertFilter==='low'?low:all;
  const isMob = window.innerWidth<=768;

  const tableRow = p=>{
    const qty=getQty(p.id),s=getStatus(qty,p.id);
    const lr=lastRecv[p.id],tr=totalRecv[p.id];
    return`<tr onclick="showProd(${p.id})">
      <td style="font-weight:500">${escHtml(p.name)}</td>
      <td class="mono">${escHtml(p.reference||'—')}</td>
      <td style="font-family:var(--font-mono)">${Math.round(qty)}</td>
      <td><span class="badge badge-${s.color}">${s.label}</span></td>
      <td style="font-size:12px;color:var(--text2)">${lr?fmtDate(lr.date)+' <span style="color:var(--green);font-family:var(--font-mono)">+'+lr.qty+'</span>':'<span style="color:var(--text3)">—</span>'}</td>
      <td style="font-family:var(--font-mono);color:var(--blue)">${tr?Math.round(tr):'—'}</td>
      <td onclick="event.stopPropagation()">${renderAlertToggle(p)}</td>
    </tr>`;
  };

  if(isMob){
    c.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;padding-bottom:2px">
      <div class="pill ${alertFilter==='all'?'active':''}" onclick="alertFilter='all';vAlerts()">Toutes (${all.length})</div>
      <div class="pill ${alertFilter==='out'?'active':''}" onclick="alertFilter='out';vAlerts()">Rupture (${out.length})</div>
      <div class="pill ${alertFilter==='low'?'active':''}" onclick="alertFilter='low';vAlerts()">Faible (${low.length})</div>
      <div class="pill" onclick="openExportModal()" style="background:var(--green-dim);border-color:var(--green);color:var(--green);white-space:nowrap">
        <i class="ti ti-shopping-cart"></i> Lot d'achat
      </div>
    </div>
    ${list.length?list.map(p=>{
      const qty=getQty(p.id),s=getStatus(qty,p.id);
      const lr=lastRecv[p.id],tr=totalRecv[p.id];
      return`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:10px;cursor:pointer" onclick="showProd(${p.id})">${escHtml(p.name)}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span class="badge badge-${s.color}">${s.label}</span>
            ${renderAlertToggle(p)}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;cursor:pointer" onclick="showProd(${p.id})">
          <div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">Stock</div>
            <div style="font-size:22px;font-weight:800;font-family:var(--font-mono);color:var(--${s.color==='red'?'red':s.color==='amber'?'amber':'green'})">${Math.round(qty)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">Dernière récep.</div>
            <div style="font-size:11px;font-weight:600">${lr?new Date(lr.date).toLocaleDateString('fr-CA',{month:'short',day:'numeric'}):'—'}</div>
            ${lr?`<div style="font-size:10px;color:var(--green)">+${lr.qty}</div>`:''}
          </div>
          <div style="background:var(--bg2);border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">Total reçu</div>
            <div style="font-size:22px;font-weight:800;font-family:var(--font-mono);color:var(--blue)">${tr?Math.round(tr):'—'}</div>
          </div>
        </div>
        <button onclick="mobNav('receive')" style="width:100%;height:36px;background:var(--green-dim);border:1px solid var(--green);border-radius:8px;color:var(--green);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-head);margin-top:10px">
          <i class="ti ti-truck-delivery"></i> Réceptionner
        </button>
      </div>`;
    }).join(''):'<div class="empty" style="padding:32px"><i class="ti ti-check" style="color:var(--green);display:block;font-size:48px;opacity:.8;margin-bottom:12px"></i>Aucune alerte !</div>'}
    ${disabled.length?`
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;padding:8px 4px;margin-top:8px">
      Alertes désactivées (${disabled.length})
    </div>
    ${disabled.map(p=>`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;opacity:.6">
      <div style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="showProd(${p.id})">${escHtml(p.name)}</div>
      ${renderAlertToggle(p)}
    </div>`).join('')}`:``}`;
  } else {
    c.innerHTML=`<div class="table-card">
      <div class="table-toolbar">
        <div class="table-toolbar-title">Alertes <span style="color:var(--text3);font-size:12px">${list.length}/${all.length}</span></div>
        <div class="filter-pills">
          <div class="pill ${alertFilter==='all'?'active':''}" onclick="alertFilter='all';vAlerts()">Toutes (${all.length})</div>
          <div class="pill ${alertFilter==='out'?'active':''}" onclick="alertFilter='out';vAlerts()">Rupture (${out.length})</div>
          <div class="pill ${alertFilter==='low'?'active':''}" onclick="alertFilter='low';vAlerts()">Stock faible (${low.length})</div>
        </div>
        <button class="btn btn-success" onclick="openExportModal()" style="margin-left:8px;white-space:nowrap">
          <i class="ti ti-shopping-cart"></i> Lot d'achat
        </button>
      </div>
      <table><thead><tr>
        <th>Produit</th><th>Réf.</th><th>Qté</th><th>Statut</th>
        <th>Dernière réception</th><th>Total reçu</th><th>Alerte</th>
      </tr></thead>
      <tbody>${list.length?list.map(tableRow).join(''):'<tr><td colspan="7" class="empty" style="padding:24px"><i class="ti ti-check" style="color:var(--green)"></i> Aucune alerte</td></tr>'}</tbody>
      </table>
    </div>
    ${disabled.length?`<div class="table-card" style="margin-top:16px;opacity:.7">
      <div class="table-toolbar">
        <div class="table-toolbar-title" style="color:var(--text3)"><i class="ti ti-bell-off" style="margin-right:6px"></i>Alertes désactivées (${disabled.length})</div>
      </div>
      <table><thead><tr><th>Produit</th><th>Réf.</th><th>Qté</th><th>Statut</th><th>Dernière réception</th><th>Total reçu</th><th>Alerte</th></tr></thead>
      <tbody>${disabled.map(tableRow).join('')}</tbody></table>
    </div>`:''}`;
  }
}



function vProducts(c) {
  c=c||document.getElementById('main-content');
  let list=products;
  if(filterStatus!=='all') list=list.filter(p=>getStatus(getQty(p.id), p.id).key===filterStatus);
  if(filterCat!=='all') list=list.filter(p=>p.category_id==filterCat);
  if(searchQ) list=list.filter(p=>(p.name||'').toLowerCase().includes(searchQ)||(p.reference||'').toLowerCase().includes(searchQ)||(p.barcode||'').toLowerCase().includes(searchQ));
  const dispVal=list.reduce((s,p)=>s+getQty(p.id)*(p.cost_price||0),0);
  c.innerHTML=`<div class="table-card">
    <div class="table-toolbar">
      <div class="table-toolbar-title">Produits <span style="color:var(--text3);font-size:12px">${list.length}/${products.length}</span><span style="color:var(--green);font-size:12px;margin-left:10px" title="Valeur du stock affiché (qté × coût)"><i class="ti ti-cash" style="font-size:13px"></i> ${fmtCAD(dispVal)}</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="filter-pills">
          <div class="pill ${filterStatus==='all'?'active':''}"     onclick="setFilt('all',this)">Tous (${products.length})</div>
          <div class="pill ${filterStatus==='instock'?'active':''}" onclick="setFilt('instock',this)">En stock (${products.filter(p=>getQty(p.id)>4).length})</div>
          <div class="pill ${filterStatus==='low'?'active':''}"     onclick="setFilt('low',this)">Faible (${products.filter(p=>{const q=getQty(p.id);return q>0&&q<=4;}).length})</div>
          <div class="pill ${filterStatus==='out'?'active':''}"     onclick="setFilt('out',this)">Rupture (${products.filter(p=>getQty(p.id)<=0).length})</div>
        </div>
        <button class="btn btn-primary" onclick="nav('create')"><i class="ti ti-plus"></i> Créer</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg2);flex-wrap:wrap">
      <span style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-right:4px">Catégorie</span>
      <div class="pill ${filterCat==='all'?'active':''}" onclick="setCatFilt('all',this)">Toutes</div>
      ${categories.map(cat=>`<div class="pill ${filterCat==cat.id?'active':''}" onclick="setCatFilt(${cat.id},this)">${escHtml(cat.name)} <span style="opacity:.6">(${products.filter(p=>p.category_id===cat.id).length})</span></div>`).join('')}
    </div>
    <table class="tbl-products"><thead><tr><th>Produit</th><th>Référence</th><th>Code-barres</th><th>Catégorie</th><th>Qté dispo</th><th>Prix vente</th><th>Coût</th><th>Valeur</th><th>Statut</th></tr></thead>
    <tbody>${list.length?list.map(p=>{
      const qty=getQty(p.id), s=getStatus(qty, p.id);
      const cat=categories.find(c=>c.id===p.category_id);
      return`<tr onclick="showProd(${p.id})">
        <td style="font-weight:500">${escHtml(p.name)}</td>
        <td class="mono">${escHtml(p.reference||'—')}</td>
        <td class="mono">${escHtml(p.barcode||'—')}</td>
        <td style="color:var(--text2)">${escHtml(cat?.name||'—')}</td>
        <td style="font-family:var(--font-mono);font-weight:600;color:var(--${s.color==='green'?'green':s.color==='amber'?'amber':'red'})">${Math.round(qty)}</td>
        <td style="font-family:var(--font-mono)">${fmtCAD(p.sale_price)}</td>
        <td style="font-family:var(--font-mono)">${fmtCAD(p.cost_price)}</td>
        <td style="font-family:var(--font-mono);color:var(--green)">${fmtCAD(qty*(p.cost_price||0))}</td>
        <td><span class="badge badge-${s.color}">${s.label}</span></td>
      </tr>`;
    }).join(''):'<tr><td colspan="9" class="empty"><i class="ti ti-search" style="display:block;font-size:32px;opacity:.3;margin-bottom:8px"></i>Aucun produit</td></tr>'}
    </tbody></table></div>`;
}
function setFilt(f,el){filterStatus=f;document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));el.classList.add('active');vProducts(document.getElementById('main-content'));}
function setCatFilt(id,el){filterCat=id;vProducts(document.getElementById('main-content'));}

function vLocations(c) {
  const locTotals={};
  const locRefs={};
  const locVal={};
  Object.entries(stockMap).forEach(([pid,sm])=>{
    sm.byLocation.forEach(b=>{
      locTotals[b.locId]=(locTotals[b.locId]||0)+b.qty;
      if(!locRefs[b.locId]) locRefs[b.locId]=new Set();
      locRefs[b.locId].add(pid);
      const p=products.find(x=>x.id==pid);
      locVal[b.locId]=(locVal[b.locId]||0)+(b.qty*(p?.cost_price||0));
    });
  });
  const internal=locations.filter(l=>l.usage==='internal');
  c.innerHTML=`
  <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
    <button class="btn btn-primary" onclick="openNewLoc()"><i class="ti ti-plus"></i> Nouvel emplacement</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    ${internal.map(l=>`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:16px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'" onclick="showLoc(${l.id})">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px"><i class="ti ti-map-pin" style="color:var(--blue);margin-right:6px"></i>${escHtml(l.name)}</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px">${escHtml(l.full_path||'Emplacement interne')}</div>
      <div style="font-size:12px;color:var(--text2);display:flex;flex-direction:column;gap:3px">
        <div style="display:flex;justify-content:space-between"><span>${locRefs[l.id]?.size||0} références</span><span style="font-family:var(--font-mono);color:var(--blue)">${Math.round(locTotals[l.id]||0)} unités</span></div>
        <div style="display:flex;justify-content:space-between"><span>Valeur</span><span style="font-family:var(--font-mono)">${fmtCAD(locVal[l.id]||0)}</span></div>
      </div>
    </div>`).join('')||'<div style="color:var(--text3)">Aucun emplacement.</div>'}
  </div>
  <div class="table-card">
    <div class="table-toolbar"><div class="table-toolbar-title">Tous les emplacements (${locations.length})</div></div>
    <table><thead><tr><th>Nom</th><th>Chemin</th><th>Type</th><th>Références</th><th>Qté totale</th><th>Valeur</th></tr></thead>
    <tbody>${locations.map(l=>`<tr onclick="showLoc(${l.id})">
      <td style="font-weight:500">${escHtml(l.name)}</td>
      <td class="mono" style="font-size:11px">${escHtml(l.full_path||'')}</td>
      <td><span class="badge badge-${l.usage==='internal'?'blue':'gray'}">${l.usage}</span></td>
      <td style="font-family:var(--font-mono)">${locRefs[l.id]?.size||0}</td>
      <td style="font-family:var(--font-mono);color:var(--blue)">${Math.round(locTotals[l.id]||0)}</td>
      <td style="font-family:var(--font-mono)">${fmtCAD(locVal[l.id]||0)}</td>
    </tr>`).join('')}
    </tbody></table>
  </div>`;
}

function vMovements(c) {
  const cols={receive:'green',reduce:'red',transfer:'blue',inventory:'purple',import:'gray'};
  const typeLabel={receive:'Réception',reduce:'Sortie',transfer:'Transfert',inventory:'Inventaire',import:'Import'};

  // Expand transfers into 2 rows each
  const rows = [];
  movements.forEach(m => {
    if(m.movement_type === 'transfer' && m.location_from && m.location_to) {
      // Row 1: sortie du source
      rows.push({...m, _display:'out', _loc: m.location_from, _sign:'-'});
      // Row 2: entrée dans destination
      rows.push({...m, _display:'in',  _loc: m.location_to,   _sign:'+'});
    } else {
      const sign = (m.movement_type==='reduce' || (m.location_from && !m.location_to)) ? '-' : '+';
      rows.push({...m, _display:'single', _loc: m.location_from || m.location_to, _sign: sign});
    }
  });

  c.innerHTML=`<div class="table-card">
    <div class="table-toolbar"><div class="table-toolbar-title">Mouvements <span style="color:var(--text3);font-size:12px">${movements.length}</span></div></div>
    <table><thead><tr><th>Date</th><th>Produit</th><th>Qté</th><th>Type</th><th>Emplacement</th><th>Réf.</th><th>Par</th></tr></thead>
    <tbody>${rows.length ? rows.map(m => {
      const p  = products.find(x=>x.id===m.product_id);
      const loc = locations.find(x=>x.id===m._loc);
      const color = m._sign==='-' ? 'red' : cols[m.movement_type]||'green';
      const isTransfer = m.movement_type==='transfer';
      const locLabel = isTransfer
        ? (m._display==='out'
            ? `<span style="color:var(--red)"><i class="ti ti-arrow-up-right" style="font-size:11px"></i> ${escHtml(loc?.name||'—')}</span>`
            : `<span style="color:var(--green)"><i class="ti ti-arrow-down-left" style="font-size:11px"></i> ${escHtml(loc?.name||'—')}</span>`)
        : escHtml(loc?.name||'—');
      return `<tr style="${isTransfer?'background:rgba(59,130,246,.04)':''}">
        <td style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${fmtDate(m.created_at)}</td>
        <td style="font-weight:500;font-size:12px">${escHtml(p?.name||'—')}</td>
        <td style="font-family:var(--font-mono);font-weight:700;color:var(--${color})">${m._sign}${Math.abs(m.quantity)}</td>
        <td><span class="badge badge-${cols[m.movement_type]||'gray'}">${typeLabel[m.movement_type]||m.movement_type}</span></td>
        <td class="mono" style="font-size:12px">${locLabel}</td>
        <td class="mono">${escHtml(m.reference||'—')}</td>
        <td style="font-size:11px;color:var(--text3)">${escHtml(m.user_email||'—')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Aucun mouvement</td></tr>'}
    </tbody></table></div>`;
}

function vReceive(c) {
  c = c || document.getElementById('main-content');
  const internalLocs = locations.filter(l=>l.usage==='internal');
  const today = new Date().toISOString().slice(0,10);
  c.innerHTML = `<div style="max-width:760px;margin:0 auto">
    <div class="table-card" style="padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
        <div style="width:44px;height:44px;background:var(--green-dim);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--green)"><i class="ti ti-truck-delivery"></i></div>
        <div><div style="font-size:16px;font-weight:600">Réception de marchandises</div><div style="font-size:12px;color:var(--text3)">Saisir une facture fournisseur et les produits reçus</div></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label class="form-label">Fournisseur</label>
          <select id="recv-supplier" class="form-input">
            <option value="">-- Fournisseur --</option>
            ${suppliers.map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">N° de facture</label>
          <input id="recv-invoice" type="text" class="form-input" placeholder="ex: F-10482" autocomplete="off">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Date de réception</label>
          <input id="recv-date" type="date" class="form-input" value="${today}">
        </div>
        <div class="form-group"><label class="form-label">Emplacement destination *</label>
          <select id="recv-loc" class="form-input">
            <option value="">-- Emplacement --</option>
            ${internalLocs.map(l=>`<option value="${l.id}">${escHtml(l.full_path||l.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--blue);border-radius:10px;padding:12px 14px;margin:6px 0 14px">
        <div style="font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <i class="ti ti-barcode" style="font-size:14px"></i> Ajouter un produit
        </div>
        <div style="display:flex;gap:8px">
          <input id="recv-search" type="text" class="form-input" placeholder="Scanner ou taper code-barres / nom…" autocomplete="off"
            oninput="recvSearchInput()" onkeydown="if(event.key==='Enter'){event.preventDefault();recvSearchEnter();}">
          <button class="btn btn-primary" onclick="recvOpenScanner()" style="flex-shrink:0" title="Scanner avec la caméra"><i class="ti ti-camera"></i></button>
        </div>
        <div id="recv-search-results" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
      </div>

      <div id="recv-lines"></div>

      <div id="recv-foot" style="display:none">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 4px 4px;border-top:1px solid var(--border);margin-top:6px">
          <div style="font-size:13px;color:var(--text3)">Total avant taxes</div>
          <div id="recv-grand-total" style="font-size:20px;font-weight:700;font-family:var(--font-mono);color:var(--green)">${fmtCAD(0)}</div>
        </div>
        <div class="form-group" style="margin-top:10px"><label class="form-label">Note (optionnel)</label>
          <input id="recv-note" type="text" class="form-input" placeholder="Remarque…">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
          <button class="btn" onclick="recvCart=[];vReceive()">Vider</button>
          <button class="btn btn-success" onclick="submitReceive()"><i class="ti ti-check"></i> Valider la réception</button>
        </div>
      </div>
    </div>

    <div class="table-card" style="margin-top:16px">
      <div class="table-toolbar"><div class="table-toolbar-title">Réceptions récentes</div></div>
      <div id="recv-history" style="padding:14px"><div style="color:var(--text3);font-size:13px">Chargement…</div></div>
    </div>
  </div>`;
  recvRenderLines();
  loadRecvHistory();
  setTimeout(()=>document.getElementById('recv-search')?.focus(), 100);
}

function recvSearchInput(){
  const q=(document.getElementById('recv-search').value||'').toLowerCase().trim();
  const box=document.getElementById('recv-search-results'); if(!box)return;
  if(!q){box.innerHTML='';return;}
  const res=products.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.barcode||'').toLowerCase().includes(q)||(p.reference||'').toLowerCase().includes(q)).slice(0,6);
  box.innerHTML=res.length?res.map(p=>`<div onclick="recvPick(${p.id})" style="padding:8px 10px;background:var(--bg1);border:1px solid var(--border);border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font-size:13px">${escHtml(p.name)}${p.barcode?` <span class="mono" style="color:var(--text3);font-size:11px">${escHtml(p.barcode)}</span>`:''}</span>
      <i class="ti ti-plus" style="color:var(--green)"></i>
    </div>`).join(''):`<div style="color:var(--text3);font-size:12px;padding:4px">Aucun résultat</div>`;
}
function recvSearchEnter(){
  const q=(document.getElementById('recv-search').value||'').toLowerCase().trim(); if(!q)return;
  let p=products.find(x=>(x.barcode||'').toLowerCase()===q||(x.reference||'').toLowerCase()===q);
  if(!p){const r=products.filter(x=>(x.name||'').toLowerCase().includes(q)||(x.barcode||'').toLowerCase().includes(q));if(r.length===1)p=r[0];else if(r.length>1){recvSearchInput();return;}}
  if(p)recvPick(p.id); else toast('Produit introuvable','error');
}
function recvPick(pid){
  recvAddProduct(pid);
  const s=document.getElementById('recv-search'); if(s){s.value='';s.focus();}
  const box=document.getElementById('recv-search-results'); if(box)box.innerHTML='';
}
function recvAddProduct(pid){
  pid=parseInt(pid);
  const p=products.find(x=>x.id===pid); if(!p)return;
  const line=recvCart.find(l=>l.pid===pid);
  if(line){line.qty+=1;} else recvCart.push({pid, qty:1, cost:(p.cost_price||0)});
  recvRenderLines();
}
function recvRenderLines(){
  const box=document.getElementById('recv-lines'); if(!box)return;
  const foot=document.getElementById('recv-foot');
  if(!recvCart.length){box.innerHTML=`<div style="text-align:center;color:var(--text3);font-size:13px;padding:20px 0"><i class="ti ti-package" style="display:block;font-size:28px;opacity:.3;margin-bottom:6px"></i>Aucun produit ajouté</div>`;if(foot)foot.style.display='none';return;}
  if(foot)foot.style.display='';
  box.innerHTML=recvCart.map((l,i)=>{
    const p=products.find(x=>x.id===l.pid);
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg1);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p?.name||'—')}</div>
        <div style="font-size:11px;color:var(--text3)">Stock actuel : ${Math.round(getQty(l.pid))}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center"><label style="font-size:9px;color:var(--text3);text-transform:uppercase">Qté</label>
        <input type="number" min="0" step="1" value="${l.qty}" oninput="recvSetQty(${i},this.value)" class="form-input" style="width:62px;height:34px;text-align:center;padding:0 4px"></div>
      <div style="display:flex;flex-direction:column;align-items:center"><label style="font-size:9px;color:var(--text3);text-transform:uppercase">Coût/u</label>
        <input type="number" min="0" step="0.01" value="${l.cost}" oninput="recvSetCost(${i},this.value)" class="form-input" style="width:78px;height:34px;text-align:right;padding:0 6px"></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;min-width:66px"><label style="font-size:9px;color:var(--text3);text-transform:uppercase">Total</label>
        <div id="recv-lt-${i}" style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:var(--green)">${fmtCAD(l.qty*l.cost)}</div></div>
      <button onclick="recvRemove(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:4px"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
  recvUpdateTotal();
}
function recvSetQty(i,v){if(!recvCart[i])return;recvCart[i].qty=parseFloat(v)||0;const lt=document.getElementById('recv-lt-'+i);if(lt)lt.textContent=fmtCAD(recvCart[i].qty*recvCart[i].cost);recvUpdateTotal();}
function recvSetCost(i,v){if(!recvCart[i])return;recvCart[i].cost=parseFloat(v)||0;const lt=document.getElementById('recv-lt-'+i);if(lt)lt.textContent=fmtCAD(recvCart[i].qty*recvCart[i].cost);recvUpdateTotal();}
function recvRemove(i){recvCart.splice(i,1);recvRenderLines();}
function recvUpdateTotal(){const t=recvCart.reduce((s,l)=>s+l.qty*l.cost,0);const e=document.getElementById('recv-grand-total');if(e)e.textContent=fmtCAD(t);}
function recvOpenScanner(){bcCartMode=true;openBarcodeScanner('general');}

function _defaultLocFor(pid, selId){
  const sel=document.getElementById(selId); if(!sel||!pid) return;
  const best=[...(stockMap[pid]?.byLocation||[])].sort((a,b)=>b.qty-a.qty)[0];
  if(best && best.locId && [...sel.options].some(o=>o.value===String(best.locId))) sel.value=String(best.locId);
}
function updateRecvInfo() {
  const el=document.getElementById('recv-product'); if(!el)return;
  const pid=parseInt(el.value);
  const p=products.find(x=>x.id===pid);
  const box=document.getElementById('recv-info'); if(!box)return;
  if(p){box.style.display='';document.getElementById('recv-cur').textContent=`${Math.round(getQty(pid))}`;_defaultLocFor(pid,'recv-loc');}
  else{box.style.display='none';}
}

async function submitReceive(){
  const supId=document.getElementById('recv-supplier').value;
  const invoice=document.getElementById('recv-invoice').value.trim();
  const date=document.getElementById('recv-date').value;
  const locId=parseInt(document.getElementById('recv-loc').value);
  const note=document.getElementById('recv-note')?.value.trim()||'';
  if(!recvCart.length){toast('Ajoute au moins un produit','error');return;}
  if(!locId){toast('Choisis un emplacement de destination','error');return;}
  if(recvCart.some(l=>!l.qty||l.qty<=0)){toast('Chaque ligne doit avoir une quantité','error');return;}
  const total=recvCart.reduce((s,l)=>s+l.qty*l.cost,0);
  const l=locations.find(x=>x.id===locId);
  try{
    const {data:rec,error:e1}=await sb.from('receptions').insert({
      supplier_id: supId?parseInt(supId):null,
      location_id: locId,
      invoice_number: invoice||null,
      received_date: date||new Date().toISOString().slice(0,10),
      total_amount: total,
      note: note||null,
      created_by: user.id
    }).select().single();
    if(e1)throw e1;
    const items=recvCart.map(line=>({reception_id:rec.id,product_id:line.pid,quantity:line.qty,unit_cost:line.cost}));
    const {error:e2}=await sb.from('reception_items').insert(items);
    if(e2)throw e2;
    for(const line of recvCart){
      const existing=stockMap[line.pid]?.byLocation.find(b=>b.locId===locId);
      const newQty=(existing?.qty||0)+line.qty;
      await sb.from('stock').upsert({product_id:line.pid,location_id:locId,quantity:newQty},{onConflict:'product_id,location_id'});
      await sb.from('movements').insert({product_id:line.pid,location_to:locId,quantity:line.qty,movement_type:'receive',reference:invoice||null,notes:`Réception${invoice?' #'+invoice:''}`,user_id:user.id,user_email:profile?.email});
    }
    await logAction('receive',{reception_id:rec.id,invoice,total,lines:recvCart.length,location_to:l?.name});
    toast(`✓ Réception enregistrée — ${recvCart.length} produit(s), ${fmtCAD(total)}`,'success');
    recvCart=[];
    await loadAll();
    vReceive(document.getElementById('main-content'));
  }catch(err){toast('Erreur: '+err.message,'error');}
}

async function loadRecvHistory(){
  const box=document.getElementById('recv-history'); if(!box)return;
  try{
    const {data,error}=await sb.from('receptions').select('*').order('created_at',{ascending:false}).limit(15);
    if(error)throw error;
    if(!data||!data.length){box.innerHTML=`<div style="color:var(--text3);font-size:13px">Aucune réception enregistrée pour le moment.</div>`;return;}
    box.innerHTML=data.map(r=>{
      const sup=suppliers.find(s=>s.id===r.supplier_id);
      return `<div onclick="showReception(${r.id})" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 6px;border-bottom:1px solid var(--border);cursor:pointer">
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:500">${escHtml(sup?.name||'Fournisseur —')}${r.invoice_number?` · <span class="mono" style="color:var(--text3)">${escHtml(r.invoice_number)}</span>`:''}</div>
          <div style="font-size:11px;color:var(--text3)">${r.received_date||''}</div>
        </div>
        <div style="font-family:var(--font-mono);font-weight:600;color:var(--green);white-space:nowrap">${fmtCAD(r.total_amount)}</div>
      </div>`;
    }).join('');
  }catch(err){box.innerHTML=`<div style="color:var(--red);font-size:13px">Erreur chargement historique: ${escHtml(err.message)}</div>`;}
}
async function showReception(id){
  try{
    const [{data:rec},{data:items}]=await Promise.all([
      sb.from('receptions').select('*').eq('id',id).single(),
      sb.from('reception_items').select('*').eq('reception_id',id)
    ]);
    const sup=suppliers.find(s=>s.id===rec.supplier_id);
    const loc=locations.find(l=>l.id===rec.location_id);
    const rows=(items||[]).map(it=>{const p=products.find(x=>x.id===it.product_id);return `<tr><td>${escHtml(p?.name||'—')}</td><td style="text-align:center;font-family:var(--font-mono)">${Math.round(it.quantity)}</td><td style="text-align:right;font-family:var(--font-mono)">${fmtCAD(it.unit_cost)}</td><td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${fmtCAD(it.line_total)}</td></tr>`;}).join('');
    openModal(`Réception ${rec.invoice_number?'#'+escHtml(rec.invoice_number):''}`,`
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px;line-height:1.7">
        <div><strong>Fournisseur :</strong> ${escHtml(sup?.name||'—')}</div>
        <div><strong>Date :</strong> ${rec.received_date||'—'}</div>
        <div><strong>Emplacement :</strong> ${escHtml(loc?.full_path||loc?.name||'—')}</div>
        ${rec.note?`<div><strong>Note :</strong> ${escHtml(rec.note)}</div>`:''}
      </div>
      <table style="width:100%"><thead><tr><th>Produit</th><th style="text-align:center">Qté</th><th style="text-align:right">Coût/u</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-weight:700">
        <span>Total avant taxes</span><span style="font-family:var(--font-mono);color:var(--green)">${fmtCAD(rec.total_amount)}</span>
      </div>`);
  }catch(err){toast('Erreur: '+err.message,'error');}
}

function vRecvReport(c){
  c=c||document.getElementById('main-content');
  const today=new Date().toISOString().slice(0,10);
  const first=new Date(); first.setDate(1);
  const firstStr=first.toISOString().slice(0,10);
  c.innerHTML=`<div style="max-width:900px;margin:0 auto">
    <div class="table-card" style="padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:44px;height:44px;background:var(--green-dim);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--green)"><i class="ti ti-truck-delivery"></i></div>
        <div><div style="font-size:16px;font-weight:600">Rapport de réceptions</div><div style="font-size:12px;color:var(--text3)">Filtrer par période et fournisseur</div></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Du</label><input id="rr-from" type="date" class="form-input" value="${firstStr}"></div>
        <div class="form-group"><label class="form-label">Au</label><input id="rr-to" type="date" class="form-input" value="${today}"></div>
      </div>
      <div class="form-group"><label class="form-label">Fournisseur</label>
        <select id="rr-supplier" class="form-input">
          <option value="">Tous les fournisseurs</option>
          ${suppliers.map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn btn-primary" onclick="runRecvReport()"><i class="ti ti-search"></i> Générer</button>
      </div>
    </div>
    <div id="rr-results"></div>
  </div>`;
  runRecvReport();
}
async function runRecvReport(){
  const from=document.getElementById('rr-from').value;
  const to=document.getElementById('rr-to').value;
  const supId=document.getElementById('rr-supplier').value;
  const box=document.getElementById('rr-results'); if(!box)return;
  box.innerHTML=`<div class="table-card" style="padding:20px;color:var(--text3)">Chargement…</div>`;
  try{
    let q=sb.from('receptions').select('*').order('received_date',{ascending:false});
    if(from)q=q.gte('received_date',from);
    if(to)q=q.lte('received_date',to);
    if(supId)q=q.eq('supplier_id',parseInt(supId));
    const {data,error}=await q;
    if(error)throw error;
    if(!data||!data.length){box.innerHTML=`<div class="table-card" style="padding:24px;text-align:center;color:var(--text3)">Aucune réception sur cette période.</div>`;return;}
    const total=data.reduce((s,r)=>s+(r.total_amount||0),0);
    const rows=data.map(r=>{
      const sup=suppliers.find(s=>s.id===r.supplier_id);
      return `<tr onclick="showReception(${r.id})" style="cursor:pointer">
        <td style="font-family:var(--font-mono);font-size:12px">${r.received_date||'—'}</td>
        <td>${escHtml(sup?.name||'—')}</td>
        <td style="font-family:var(--font-mono);font-size:12px">${escHtml(r.invoice_number||'—')}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${fmtCAD(r.total_amount)}</td>
      </tr>`;
    }).join('');
    box.innerHTML=`<div class="table-card">
      <div class="table-toolbar"><div class="table-toolbar-title">${data.length} réception${data.length>1?'s':''}</div>
        <button class="btn" onclick="exportRecvReport()"><i class="ti ti-download"></i> CSV</button></div>
      <table style="width:100%"><thead><tr><th>Date</th><th>Fournisseur</th><th>N° facture</th><th style="text-align:right">Total avant taxes</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border)"><td colspan="3" style="text-align:right;font-weight:700;padding:12px 8px">TOTAL</td><td style="text-align:right;font-family:var(--font-mono);font-weight:700;color:var(--green);padding:12px 8px">${fmtCAD(total)}</td></tr></tfoot>
      </table></div>`;
    window._rrData=data;
  }catch(err){box.innerHTML=`<div class="table-card" style="padding:20px;color:var(--red)">Erreur: ${escHtml(err.message)}</div>`;}
}
function exportRecvReport(){
  const data=window._rrData||[];
  if(!data.length){toast('Rien à exporter','error');return;}
  const out=[['Date','Fournisseur','N° facture','Total avant taxes']];
  data.forEach(r=>{const sup=suppliers.find(s=>s.id===r.supplier_id);out.push([r.received_date||'',sup?.name||'',r.invoice_number||'',(r.total_amount||0).toFixed(2)]);});
  const csv=out.map(row=>row.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rapport_receptions.csv';a.click();
}
function vTransfer(c) {
  const internalLocs=locations.filter(l=>l.usage==='internal');
  c.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
  <div class="table-card" style="padding:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:44px;height:44px;background:var(--blue-bg);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--blue)"><i class="ti ti-transfer"></i></div>
      <div><div style="font-size:16px;font-weight:600">Transfert d'emplacement</div><div style="font-size:12px;color:var(--text3)">Déplacer du stock</div></div>
    </div>

    <!-- Scanner physique -->
    <div style="background:var(--bg2);border:1px solid var(--blue);border-radius:10px;padding:12px 14px;margin-bottom:18px">
      <div style="font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ti ti-barcode" style="font-size:14px"></i> Scanner physique ou recherche
      </div>
      <div style="display:flex;gap:8px">
        <input id="tf-scanner" type="text" class="form-input" placeholder="Scannez ou tapez un code-barres / nom…" autocomplete="off"
          oninput="scanSearch('tf')" onkeydown="if(event.key==='Enter'){event.preventDefault();scanConfirm('tf');}">
        <button class="btn btn-primary" onclick="scanConfirm('tf')" style="flex-shrink:0"><i class="ti ti-search"></i></button>
      </div>
      <div id="tf-scan-results" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Produit sélectionné *</label>
      <select id="tf-product" class="form-input" onchange="updateTfInfo()">
        <option value="">-- Produit --</option>
        ${products.filter(p=>getQty(p.id)>0).map(p=>`<option value="${p.id}">${escHtml(p.name)}${p.reference?' ['+p.reference+']':''}</option>`).join('')}
      </select>
    </div>
    <div id="tf-info" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
      Stock dispo : <strong id="tf-qty-info">—</strong>
    </div>
    <div style="display:grid;grid-template-columns:1fr 36px 1fr;align-items:end;gap:8px;margin-bottom:16px">
      <div class="form-group" style="margin:0"><label class="form-label">Source *</label>
        <select id="tf-from" class="form-input" onchange="checkTfLocs()">
          <option value="">-- De --</option>
          ${internalLocs.map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;padding-bottom:2px">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--bg3);border:1px solid var(--border2);display:flex;align-items:center;justify-content:center;color:var(--blue)"><i class="ti ti-arrow-right"></i></div>
      </div>
      <div class="form-group" style="margin:0"><label class="form-label">Destination *</label>
        <select id="tf-to" class="form-input" onchange="checkTfLocs()">
          <option value="">-- Vers --</option>
          ${internalLocs.map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="tf-warn" style="display:none;background:var(--amber-dim);border:1px solid var(--amber);border-radius:8px;padding:10px;font-size:12px;color:var(--amber);margin-bottom:12px"><i class="ti ti-alert-triangle" style="margin-right:6px"></i>Source et destination identiques</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Quantité *</label><input id="tf-qty" type="number" min="1" step="1" class="form-input" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Référence</label><input id="tf-ref" type="text" class="form-input" placeholder="TRF-001"></div>
    </div>
    <div class="form-group"><label class="form-label">Notes</label><textarea id="tf-note" class="form-input" rows="2" placeholder="Raison du transfert, commentaire…"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="vTransfer(document.getElementById('main-content'))">Annuler</button>
      <button class="btn btn-primary" onclick="submitTransfer()"><i class="ti ti-check"></i> Valider</button>
    </div>
  </div>
  <div class="table-card">
    <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-history" style="color:var(--purple);margin-right:6px"></i>Transferts récents</div></div>
    <table><thead><tr><th>Produit</th><th>Qté</th><th>De → Vers</th><th>Date</th></tr></thead>
    <tbody>${(()=>{
      const locIds=new Set(locations.filter(l=>l.usage==='internal').map(l=>l.id));
      const xfers=movements.filter(m=>m.movement_type==='transfer'&&locIds.has(m.location_from)&&locIds.has(m.location_to));
      if(!xfers.length) return '<tr><td colspan="4" class="empty">Aucun transfert</td></tr>';
      return xfers.slice(0,15).map(m=>{
        const p=products.find(x=>x.id===m.product_id);
        const lf=locations.find(x=>x.id===m.location_from);
        const lt=locations.find(x=>x.id===m.location_to);
        return`<tr><td style="font-size:12px">${escHtml(p?.name||'—')}</td>
          <td style="font-family:var(--font-mono);color:var(--blue)">${m.quantity}</td>
          <td style="font-size:11px;color:var(--text2)">${escHtml(lf?.name||'?')} → ${escHtml(lt?.name||'?')}</td>
          <td style="font-size:11px;color:var(--text3)">${fmtDate(m.created_at)}</td>
        </tr>`;
      }).join('');
    })()}
    </tbody></table>
  </div></div>`;
}
function updateTfInfo(){const pid=parseInt(document.getElementById('tf-product').value);const box=document.getElementById('tf-info');if(pid){box.style.display='';document.getElementById('tf-qty-info').textContent=Math.round(getQty(pid));_defaultLocFor(pid,'tf-from');checkTfLocs();}else{box.style.display='none';}}
function checkTfLocs(){const f=document.getElementById('tf-from')?.value,t=document.getElementById('tf-to')?.value;document.getElementById('tf-warn').style.display=(f&&t&&f===t)?'':'none';}
async function submitTransfer() {
  const pid=parseInt(document.getElementById('tf-product').value);
  const qty=parseFloat(document.getElementById('tf-qty').value);
  const fromId=parseInt(document.getElementById('tf-from').value);
  const toId=parseInt(document.getElementById('tf-to').value);
  const ref=document.getElementById('tf-ref').value.trim();
  const note=document.getElementById('tf-note').value.trim();
  if(!pid||!qty||qty<=0||!fromId||!toId){toast('Remplissez tous les champs','error');return;}
  if(fromId===toId){toast('Source = Destination','error');return;}
  const p=products.find(x=>x.id===pid);
  const fromStock=stockMap[pid]?.byLocation.find(b=>b.locId===fromId);
  if(!fromStock||fromStock.qty<qty){toast(`Stock insuffisant dans cet emplacement (${fromStock?.qty||0})`, 'error');return;}
  try {
    const fromQty=(fromStock.qty||0)-qty;
    const toExisting=stockMap[pid]?.byLocation.find(b=>b.locId===toId);
    const toQty=(toExisting?.qty||0)+qty;
    await sb.from('stock').upsert({product_id:pid,location_id:fromId,quantity:fromQty},{onConflict:'product_id,location_id'});
    await sb.from('stock').upsert({product_id:pid,location_id:toId,quantity:toQty},{onConflict:'product_id,location_id'});
    await sb.from('movements').insert({product_id:pid,location_from:fromId,location_to:toId,quantity:qty,movement_type:'transfer',reference:ref,notes:note||null,user_id:user.id,user_email:profile?.email});
    const lf=locations.find(x=>x.id===fromId),lt=locations.find(x=>x.id===toId);
    await logAction('transfer',{product_id:pid,product_name:p?.name,quantity:qty,location_from:lf?.name,location_to:lt?.name,reference:ref});
    toast(`✓ Transfert de ${qty} unités effectué !`,'success');
    await loadAll();
    vTransfer(document.getElementById('main-content'));
  } catch(e){toast('Erreur: '+e.message,'error');}
}

function vReduce(c) {
  const canConfirm = profile?.role==='admin' || profile?.role==='manager';
  c.innerHTML=`<div style="max-width:600px"><div class="table-card" style="padding:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:44px;height:44px;background:var(--red-dim);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--red)"><i class="ti ti-minus-vertical"></i></div>
      <div><div style="font-size:16px;font-weight:600">Réduire le stock</div><div style="font-size:12px;color:var(--text3)">Retirer des unités (vente, perte, casse…)</div></div>
    </div>

    <!-- Scanner physique -->
    <div style="background:var(--bg2);border:1px solid var(--blue);border-radius:10px;padding:12px 14px;margin-bottom:18px">
      <div style="font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ti ti-barcode" style="font-size:14px"></i> Scanner physique ou recherche
      </div>
      <div style="display:flex;gap:8px">
        <input id="red-scanner" type="text" class="form-input" placeholder="Scannez ou tapez un code-barres / nom…" autocomplete="off"
          oninput="scanSearch('red')" onkeydown="if(event.key==='Enter'){event.preventDefault();scanConfirm('red');}">
        <button class="btn btn-primary" onclick="scanConfirm('red')" style="flex-shrink:0"><i class="ti ti-search"></i></button>
      </div>
      <div id="red-scan-results" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
    </div>

    <div class="form-group">
      <label class="form-label">Produit sélectionné *</label>
      <select id="red-product" class="form-input" onchange="updateRedInfo()">
        <option value="">-- Produit --</option>
        ${products.filter(p=>getQty(p.id)>0).map(p=>`<option value="${p.id}">${escHtml(p.name)}${p.reference?' ['+p.reference+']':''} — ${Math.round(getQty(p.id))} dispo</option>`).join('')}
      </select>
    </div>
    <div id="red-info" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
      Stock actuel : <strong id="red-cur">—</strong>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Quantité *</label><input id="red-qty" type="number" min="1" step="1" class="form-input" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Raison</label>
        <select id="red-reason" class="form-input">
          <option>Sortie manuelle</option><option>Vente</option><option>Perte</option>
          <option>Casse</option><option>Périmé</option><option>Retour fournisseur</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Emplacement source *</label>
      <select id="red-loc" class="form-input">
        <option value="">-- Emplacement --</option>
        ${locations.filter(l=>l.usage==='internal').map(l=>`<option value="${l.id}">${escHtml(l.full_path||l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">Notes</label><textarea id="red-note" class="form-input" rows="2" placeholder="Détails supplémentaires, numéro de commande…"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="vReduce(document.getElementById('main-content'))">Annuler</button>
      <button class="btn btn-danger" onclick="submitReduce()"><i class="ti ti-minus"></i> Valider</button>
    </div>
  </div></div>${canConfirm?'<div id="reduce-confirm" style="margin-top:24px;max-width:980px"><div class="empty" style="padding:30px"><i class="ti ti-loader spin"></i></div></div>':''}`;
  if(canConfirm) renderReduceConfirm();
}
async function renderReduceConfirm(){
  await loadPendingWithdrawals();
  const el=document.getElementById('reduce-confirm'); if(!el) return;
  el.innerHTML = `
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);font-weight:600;margin:0 2px 12px;display:flex;align-items:center;gap:8px">
      <i class="ti ti-checks" style="color:var(--green);font-size:15px"></i> Confirmations de retrait en attente
      ${pendingWithdrawals.length?`<span class="badge badge-amber">${pendingWithdrawals.length}</span>`:''}
    </div>` + pendingWithdrawalsListHTML();
}
function updateRedInfo(){const pid=parseInt(document.getElementById('red-product').value);const box=document.getElementById('red-info');if(pid){box.style.display='';document.getElementById('red-cur').textContent=Math.round(getQty(pid));_defaultLocFor(pid,'red-loc');}else box.style.display='none';}
async function submitReduce() {
  const pid=parseInt(document.getElementById('red-product').value);
  const qty=parseFloat(document.getElementById('red-qty').value);
  const locId=parseInt(document.getElementById('red-loc').value);
  const reason=document.getElementById('red-reason').value;
  const note=document.getElementById('red-note').value.trim();
  if(!pid||!qty||qty<=0||!locId){toast('Remplissez tous les champs','error');return;}
  const available=getQty(pid);
  if(qty>available){toast(`Stock insuffisant (${Math.round(available)} dispo)`,'error');return;}
  const p=products.find(x=>x.id===pid), l=locations.find(x=>x.id===locId);
  try {
    const locStock=stockMap[pid]?.byLocation.find(b=>b.locId===locId);
    const newQty=Math.max(0,(locStock?.qty||0)-qty);
    await sb.from('stock').upsert({product_id:pid,location_id:locId,quantity:newQty},{onConflict:'product_id,location_id'});
    await sb.from('movements').insert({product_id:pid,location_from:locId,quantity:-qty,movement_type:'reduce',notes:note?`${reason} — ${note}`:reason,user_id:user.id,user_email:profile?.email});
    await logAction('reduce',{product_id:pid,product_name:p?.name,quantity:qty,location_from:l?.name,notes:reason});
    toast(`✓ -${qty} unités (${reason})`,'success');
    await loadAll();
    vReduce(document.getElementById('main-content'));
  } catch(e){toast('Erreur: '+e.message,'error');}
}

function vInventory(c) {
  c = c || document.getElementById('main-content');
  const isMob = window.innerWidth <= 768;
  if(isMob) { mScanInventory(c); return; }

  // ── Desktop : étape 1 — choisir l'emplacement ─────────────
  const internalLocs = locations.filter(l=>l.usage==='internal');
  const canConfirm = profile?.role==='admin' || profile?.role==='manager';

  c.innerHTML = `
  <div style="max-width:700px">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
      <div style="width:48px;height:48px;background:#1e1b4b;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--purple)">
        <i class="ti ti-clipboard-list"></i>
      </div>
      <div>
        <div style="font-size:18px;font-weight:700">Faire l'inventaire</div>
        <div style="font-size:13px;color:var(--text3)">Choisissez un emplacement à compter</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
      ${internalLocs.length ? internalLocs.map(l => {
        const totalQty = Object.values(stockMap)
          .reduce((s,sm) => s+(sm.byLocation.find(b=>b.locId===l.id)?.qty||0), 0);
        const refCount = Object.values(stockMap)
          .filter(sm => sm.byLocation.some(b=>b.locId===l.id&&b.qty>0)).length;
        return `<div onclick="dStartInventoryAtLoc(${l.id},'${escHtml(l.name).replace(/'/g,"\\'")}')"
          style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:20px;cursor:pointer;transition:all .15s"
          onmouseover="this.style.borderColor='var(--purple)';this.style.background='var(--bg2)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--bg1)'">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div style="width:38px;height:38px;background:#1e1b4b;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--purple)">
              <i class="ti ti-map-pin"></i>
            </div>
            <div style="font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l.name)}</div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2)">
            <span>${refCount} référence${refCount!==1?'s':''}</span>
            <span style="font-family:var(--font-mono);color:var(--purple);font-weight:700">${Math.round(totalQty)} unités</span>
          </div>
        </div>`;
      }).join('') : '<div class="empty">Aucun emplacement interne</div>'}
    </div>
  </div>${canConfirm?'<div id="inv-confirm" style="margin-top:24px;max-width:980px"><div class="empty" style="padding:30px"><i class="ti ti-loader spin"></i></div></div>':''}`;
  if(canConfirm) renderInvConfirm();
}
async function renderInvConfirm(){
  await loadPendingInventories();
  const el=document.getElementById('inv-confirm'); if(!el) return;
  el.innerHTML = `
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);font-weight:600;margin:0 2px 12px;display:flex;align-items:center;gap:8px">
      <i class="ti ti-checks" style="color:var(--green);font-size:15px"></i> Confirmations d'inventaire en attente
      ${pendingInventories.length?`<span class="badge badge-amber">${pendingInventories.length}</span>`:''}
    </div>` + pendingInventoriesListHTML();
}

// ── Desktop étape 2 : saisie inventaire pour un emplacement ──
let _dInvLocId = null, _dInvLocName = '', _dInvMap = {};

function dStartInventoryAtLoc(locId, locName) {
  _dInvLocId   = locId;
  _dInvLocName = locName;
  _dInvMap     = {};

  const c = document.getElementById('main-content');

  // Produits ayant du stock dans cet emplacement + tous les autres
  const locProds = products.filter(p =>
    (stockMap[p.id]?.byLocation||[]).some(b=>b.locId===locId)
  );
  const otherProds = products.filter(p =>
    !(stockMap[p.id]?.byLocation||[]).some(b=>b.locId===locId)
  );
  const allProds = [...locProds, ...otherProds];

  const isOp = profile?.role === 'operation';
  const actionLabel = isOp ? 'Soumettre pour validation' : 'Valider';

  c.innerHTML = `
  <div class="table-card">
    <div class="table-toolbar">
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px">
          <button onclick="vInventory()" class="btn" style="height:28px;padding:0 8px;font-size:12px;margin-right:4px"><i class="ti ti-arrow-left"></i></button>
          <i class="ti ti-map-pin" style="color:var(--purple)"></i> ${escHtml(locName)}
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">${locProds.length} références avec stock · laisser vide = ignoré</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="bc-btn" onclick="openBarcodeScanner('inventory')"><i class="ti ti-barcode"></i> Scanner cam.</button>
        <button class="btn ${isOp?'btn-amber':'btn-primary'}" onclick="dSubmitInventory()">
          <i class="ti ti-check"></i> ${actionLabel}
        </button>
      </div>
    </div>

    <!-- Scanner physique -->
    <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--blue-bg);border-bottom:1px solid var(--blue)">
      <i class="ti ti-barcode" style="color:var(--blue);font-size:16px;flex-shrink:0"></i>
      <input id="inv-scanner" type="text" placeholder="Scanner ou taper un code-barres / nom → Enter pour localiser…" autocomplete="off"
        style="flex:1;background:transparent;border:none;outline:none;color:var(--text1);font-size:13px;font-family:var(--font-head)"
        oninput="scanSearchInv()" onkeydown="if(event.key==='Enter'){event.preventDefault();scanInventory(this.value);this.value='';}">
    </div>
    <div id="inv-scanner-results" style="padding:0 16px;display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto"></div>

    <!-- Filtre -->
    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--bg2);border-bottom:1px solid var(--border)">
      <i class="ti ti-search" style="color:var(--text3)"></i>
      <input id="inv-search-desktop" type="text" placeholder="Filtrer les produits…" oninput="filterInvDesktop()"
        style="flex:1;background:transparent;border:none;outline:none;color:var(--text1);font-size:13px;font-family:var(--font-head)">
      <span style="font-size:11px;color:var(--text3)">Champs vides ignorés</span>
    </div>

    <!-- Table -->
    <div style="padding:0 16px">
      <div style="display:grid;grid-template-columns:1fr 90px 80px 90px 80px;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3)">
        <div>Produit</div>
        <div style="text-align:center">Réf.</div>
        <div style="text-align:center">Dans ${escHtml(locName)}</div>
        <div style="text-align:center">Compté</div>
        <div style="text-align:center">Diff.</div>
      </div>
      ${allProds.map(p => {
        const locQty = stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty||0;
        const s = getStatus(locQty, p.id);
        const inLoc = locProds.includes(p);
        return `<div class="inv-row" id="inv-row-d-${p.id}" style="${!inLoc?'opacity:.5':''}">
          <div class="inv-name">
            ${escHtml(p.name)}
            ${!inLoc ? '<span style="font-size:10px;color:var(--text3);margin-left:6px">(pas dans cet empl.)</span>' : ''}
          </div>
          <div style="width:80px;text-align:center;font-family:var(--font-mono);font-size:11px;color:var(--text3)">${escHtml(p.reference||'—')}</div>
          <div style="width:80px;text-align:center;font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--${s.color==='green'?'green':s.color==='amber'?'amber':'red'})">${Math.round(locQty)}</div>
          <div style="width:80px;text-align:center">
            <input class="inv-input" id="inv-qty-${p.id}" type="number" min="0" step="1" placeholder="—"
              oninput="calcDiff(${p.id},${locQty})">
          </div>
          <div style="width:70px;text-align:center;font-size:12px;font-weight:700;font-family:var(--font-mono)" id="inv-diff-${p.id}">—</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  setTimeout(()=>document.getElementById('inv-scanner')?.focus(), 100);
}

function calcDiff(pid, locQty) {
  const val = document.getElementById('inv-qty-'+pid)?.value;
  const d   = document.getElementById('inv-diff-'+pid);
  if(!d) return;
  if(val===''||val===undefined){ d.textContent='—'; d.style.color='var(--text3)'; return; }
  // Use locQty if provided (desktop), otherwise total (desktop old / mobile)
  const base = (locQty !== undefined) ? locQty : getQty(pid);
  const diff = parseFloat(val) - base;
  d.textContent = (diff>=0?'+':'') + Math.round(diff);
  d.style.color  = diff>0?'var(--green)':diff<0?'var(--red)':'var(--text3)';
}

async function dSubmitInventory() {
  const locId   = _dInvLocId;
  const locName = _dInvLocName;
  if(!locId){ toast('Emplacement manquant','error'); return; }

  // Collect filled fields only
  const items = [];
  for(const p of products){
    const val = document.getElementById('inv-qty-'+p.id)?.value;
    if(val===''||val===undefined) continue;
    const counted = parseFloat(val);
    if(isNaN(counted)) continue;
    const locQty = stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty||0;
    items.push({
      product_id:   p.id,
      product_name: p.name,
      counted,
      current:      Math.round(getQty(p.id)),
      diff:         counted - locQty,
    });
  }

  if(!items.length){ toast('Aucune saisie','info'); return; }

  // Rôle operation → soumettre pour validation
  if(profile?.role==='operation'){
    const invMap = {};
    items.forEach(i => { invMap[i.product_id] = {counted:i.counted, locId}; });
    const ok = await submitPendingInventory(invMap, locId, locName);
    if(ok) toast(`✓ ${items.length} produit${items.length>1?'s':''} soumis pour validation`,'success');
    return;
  }

  // Manager / admin → appliquer directement
  toast('Validation en cours…','info');
  let updates=0, skipped=0, errors=0;
  for(const item of items){
    const locQty = stockMap[item.product_id]?.byLocation.find(b=>b.locId===locId)?.qty||0;
    if(item.diff===0){ skipped++; continue; }
    try {
      await sb.from('stock').upsert(
        {product_id:item.product_id, location_id:locId, quantity:Math.max(0,item.counted)},
        {onConflict:'product_id,location_id'}
      );
      await sb.from('movements').insert({
        product_id:    item.product_id,
        location_from: item.diff<0 ? locId : null,
        location_to:   item.diff>0 ? locId : null,
        quantity:      Math.abs(item.diff),
        movement_type: 'inventory',
        user_id:       user.id,
        user_email:    profile?.email,
      });
      updates++;
    } catch(e){ errors++; console.error(e); }
  }

  await logAction('inventory',{notes:`${updates} ajustements (${locName})`});
  toast(`✓ ${updates} ajustement${updates>1?'s':''} — ${skipped} inchangé${skipped>1?'s':''}`,'success');
  if(errors) toast(`${errors} erreur(s)`,'error');
  await loadAll();
  vInventory(document.getElementById('main-content'));
}


function scanSearchInv(){const input=document.getElementById('inv-scanner');const results=document.getElementById('inv-scanner-results');if(!input||!results)return;const q=input.value.trim().toLowerCase();if(!q){results.innerHTML='';results.style.padding='0';return;}const matches=products.filter(p=>(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q||(p.barcode||'').toLowerCase().startsWith(q)||(p.reference||'').toLowerCase().startsWith(q)||(p.name||'').toLowerCase().includes(q)).slice(0,6);if(!matches.length){results.innerHTML='';return;}results.style.padding='8px 16px';results.innerHTML=matches.map(p=>{const qty=getQty(p.id),s=getStatus(qty,p.id);return`<div onclick="scanInventory('${escHtml(p.barcode||p.reference||p.name)}');document.getElementById('inv-scanner').value='';document.getElementById('inv-scanner-results').innerHTML='';document.getElementById('inv-scanner-results').style.padding='0';" style="display:flex;align-items:center;gap:10px;padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;margin-bottom:2px"><i class="ti ti-package" style="color:var(--text3);font-size:14px;flex-shrink:0"></i><div style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div><span class="badge badge-${s.color}" style="font-size:9px;flex-shrink:0">${Math.round(qty)}</span></div>`;}).join('');}

function filterInv() {
  const q = (document.getElementById('inv-search')?.value||'').toLowerCase();
  products.forEach(p=>{
    const r = document.getElementById('inv-row-'+p.id);
    if(r) r.style.display = (!q||(p.name||'').toLowerCase().includes(q)||(p.reference||'').toLowerCase().includes(q)) ? '' : 'none';
  });
}
function filterInvDesktop() {
  const q = (document.getElementById('inv-search-desktop')?.value||'').toLowerCase();
  products.forEach(p=>{
    const r = document.getElementById('inv-row-d-'+p.id);
    if(r) r.style.display = (!q||(p.name||'').toLowerCase().includes(q)||(p.reference||'').toLowerCase().includes(q)) ? '' : 'none';
  });
}
async function submitInventory() {
  let updates=0, skipped=0, errors=0;
  toast('Validation en cours…','info');
  for(const p of products){
    const val=document.getElementById('inv-qty-'+p.id)?.value;
    if(val===''||val===undefined) continue;
    const counted=parseFloat(val);
    if(isNaN(counted)) continue;

    // Trouver l'emplacement principal où ce produit a déjà du stock
    const existingLocs = stockMap[p.id]?.byLocation || [];
    // Prioriser l'emplacement avec le plus de stock, sinon premier emplacement interne
    const bestLoc = existingLocs.sort((a,b)=>b.qty-a.qty)[0]
      || { locId: locations.find(l=>l.usage==='internal')?.id };

    if(!bestLoc?.locId) continue;
    const locId = bestLoc.locId;

    // Calculer le diff par rapport au total actuel
    const currentTotal = getQty(p.id);
    const diff = counted - currentTotal;

    // Si aucun changement, skip
    if(diff === 0){ skipped++; continue; }

    try {
      // Mettre à jour uniquement cet emplacement : ajuster de la différence
      const currentLocQty = stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty || 0;
      const newLocQty = Math.max(0, currentLocQty + diff);
      await sb.from('stock').upsert(
        {product_id:p.id, location_id:locId, quantity:newLocQty},
        {onConflict:'product_id,location_id'}
      );
      await sb.from('movements').insert({
        product_id:p.id,
        location_to:   diff>0 ? locId : null,
        location_from: diff<0 ? locId : null,
        quantity:Math.abs(diff),
        movement_type:'inventory',
        user_id:user.id,
        user_email:profile?.email
      });
      updates++;
    } catch(e){ errors++; console.error(e); }
  }
  if(updates>0){
    toast(`✓ ${updates} ajustement${updates>1?'s':''} — ${skipped} inchangé${skipped>1?'s':''}`, 'success');
    await logAction('inventory',{notes:`${updates} ajustements`});
    await loadAll();
    vInventory(document.getElementById('main-content'));
  } else {
    toast(skipped > 0 ? `Aucun changement (${skipped} produit${skipped>1?'s':''} identique${skipped>1?'s':''})` : 'Aucune saisie', 'info');
  }
  if(errors) toast(`${errors} erreur(s)`,'error');
}

function vCreate(c) {
  c.innerHTML=`<div style="max-width:640px"><div class="table-card" style="padding:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:44px;height:44px;background:var(--blue-bg);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--blue)"><i class="ti ti-plus"></i></div>
      <div><div style="font-size:16px;font-weight:600">Créer un nouvel article</div><div style="font-size:12px;color:var(--text3)">Ajouté dans votre inventaire</div></div>
    </div>
    <div class="form-section">Informations générales</div>
    <div class="form-group"><label class="form-label">Nom *</label><input id="cr-name" type="text" class="form-input" placeholder="ex: Câble HDMI 2m"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Référence interne</label><input id="cr-ref" type="text" class="form-input" placeholder="CAB-HDMI-2M"></div>
      <div class="form-group"><label class="form-label">Code-barres</label><input id="cr-barcode" type="text" class="form-input" placeholder="1234567890123"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Catégorie</label>
        <select id="cr-cat" class="form-input">
          <option value="">-- Choisir --</option>
          ${categories.map(c=>`<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Unité de mesure</label>
        <select id="cr-uom" class="form-input">
          <option value="">-- Choisir --</option>
          ${uoms.map(u=>`<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fournisseur</label>
        <select id="cr-supplier" class="form-input">
          <option value="">-- Choisir --</option>
          ${suppliers.map(s=>`<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"></div>
    </div>
    <div class="form-section">Prix</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Prix de vente (CAD)</label><input id="cr-price" type="number" min="0" step="1" class="form-input" placeholder="0.00"></div>
      <div class="form-group"><label class="form-label">Coût (CAD)</label><input id="cr-cost" type="number" min="0" step="1" class="form-input" placeholder="0.00"></div>
    </div>
    <div class="form-section">Stock initial (optionnel)</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Quantité initiale</label><input id="cr-qty" type="number" min="0" step="1" class="form-input" placeholder="0"></div>
      <div class="form-group"><label class="form-label">Emplacement</label>
        <select id="cr-loc" class="form-input">
          <option value="">-- Aucun --</option>
          ${locations.filter(l=>l.usage==='internal').map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Description</label><textarea id="cr-desc" class="form-input" rows="2"></textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="vCreate(document.getElementById('main-content'))">Réinitialiser</button>
      <button class="btn btn-primary" onclick="submitCreate()"><i class="ti ti-check"></i> Créer</button>
    </div>
  </div></div>`;
}
async function submitCreate() {
  const name=document.getElementById('cr-name').value.trim();
  if(!name){toast('Nom obligatoire','error');return;}
  const vals={
    name, reference:document.getElementById('cr-ref').value.trim()||null,
    barcode:document.getElementById('cr-barcode').value.trim()||null,
    category_id:parseInt(document.getElementById('cr-cat').value)||null,
    uom_id:parseInt(document.getElementById('cr-uom').value)||null,
    sale_price:parseFloat(document.getElementById('cr-price').value)||0,
    cost_price:parseFloat(document.getElementById('cr-cost').value)||0,
    description:document.getElementById('cr-desc').value.trim()||null,
    supplier:document.getElementById('cr-supplier').value||null,
    active:true
  };
  try {
    const {data:prod,error}=await sb.from('products').insert(vals).select().single();
    if(error) throw error;
    // Initial stock
    const initQty=parseFloat(document.getElementById('cr-qty').value)||0;
    const initLoc=parseInt(document.getElementById('cr-loc').value)||null;
    if(initQty>0&&initLoc){
      await sb.from('stock').insert({product_id:prod.id,location_id:initLoc,quantity:initQty});
      await sb.from('movements').insert({product_id:prod.id,location_to:initLoc,quantity:initQty,movement_type:'receive',notes:'Stock initial',user_id:user.id,user_email:profile?.email});
    }
    await logAction('create',{product_name:name,quantity:initQty||null});
    toast(`✓ Article "${name}" créé !`,'success');
    await loadAll();
    vCreate(document.getElementById('main-content'));
  } catch(e){toast('Erreur: '+e.message,'error');}
}

// ── Product Detail Modal ───────────────────────────────────
async function showProd(id) {
  const p = products.find(x=>x.id===id); if(!p) return;
  const qty = getQty(id), s = getStatus(qty, id);
  const cat = categories.find(c=>c.id===p.category_id);
  const uom = uoms.find(u=>u.id===p.uom_id);
  const threshold = p.alert_threshold ?? window._alertThreshold ?? 4;

  const locLines = (stockMap[id]?.byLocation||[])
    .filter(b => b.qty > 0)
    .sort((a,b) => b.qty - a.qty)
    .map(b=>{
      const l = locations.find(x=>x.id===b.locId);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text1)">${escHtml(l?.name||'?')}</div>
          ${l?.full_path && l.full_path !== l.name ? `<div style="font-size:11px;color:var(--text3)">${escHtml(l.full_path)}</div>` : ''}
        </div>
        <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--green)">${Math.round(b.qty)}</span>
      </div>`;
    }).join('');

  // All locations including empty ones
  const allLocLines = (stockMap[id]?.byLocation||[])
    .sort((a,b) => b.qty - a.qty)
    .map(b=>{
      const l = locations.find(x=>x.id===b.locId);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text1)">${escHtml(l?.name||'?')}</div>
          ${l?.full_path && l.full_path !== l.name ? `<div style="font-size:11px;color:var(--text3)">${escHtml(l.full_path)}</div>` : ''}
        </div>
        <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--${b.qty>0?'green':'text3'})">${Math.round(b.qty)}</span>
      </div>`;
    }).join('');

  // Load history from Supabase
  const { data: history } = await sb.from('movements')
    .select('*').eq('product_id', id)
    .order('created_at', {ascending: false}).limit(50);

  // Réceptions de ce produit (fournisseur + coût) — affiché web seulement
  const { data: recvRows } = await sb.from('reception_items')
    .select('quantity,unit_cost,receptions(received_date,supplier_id,invoice_number)')
    .eq('product_id', id).order('id',{ascending:false}).limit(50);
  const recvHistHtml = (recvRows&&recvRows.length) ? `
    <div class="web-only" style="margin-bottom:18px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Réceptions — fournisseur &amp; coût</div>
      <div style="overflow-x:auto"><table style="width:100%">
        <thead><tr><th>Date</th><th>Fournisseur</th><th>Facture</th><th style="text-align:center">Qté</th><th style="text-align:right">Coût/u</th></tr></thead>
        <tbody>${recvRows.map(r=>{const rc=r.receptions||{};const sup=suppliers.find(s=>s.id===rc.supplier_id);return `<tr>
          <td style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${rc.received_date||'—'}</td>
          <td style="font-size:12px">${escHtml(sup?.name||'—')}</td>
          <td style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${escHtml(rc.invoice_number||'—')}</td>
          <td style="text-align:center;font-family:var(--font-mono)">${Math.round(r.quantity)}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${fmtCAD(r.unit_cost)}</td>
        </tr>`;}).join('')}</tbody>
      </table></div>
    </div>` : '';

  const cols = {receive:'green', reduce:'red', transfer:'blue', inventory:'purple', import:'gray'};
  const typeLabels = {receive:'Réception', reduce:'Sortie', transfer:'Transfert', inventory:'Inventaire', import:'Import'};

  // Expand transfers into 2 rows (sortie + entrée)
  const histExpanded = [];
  (history||[]).forEach(m => {
    if(m.movement_type==='transfer' && m.location_from && m.location_to) {
      histExpanded.push({...m, _sign:'-', _loc:m.location_from, _dir:'out'});
      histExpanded.push({...m, _sign:'+', _loc:m.location_to,   _dir:'in'});
    } else {
      const sign = (m.movement_type==='reduce'||(m.location_from&&!m.location_to)) ? '-' : '+';
      histExpanded.push({...m, _sign:sign, _loc:m.location_from||m.location_to, _dir:'single'});
    }
  });

  const historyRows = histExpanded.length ? histExpanded.map(m => {
    const loc = locations.find(x=>x.id===m._loc);
    const col = m._sign==='-' ? 'red' : cols[m.movement_type]||'green';
    const isTransfer = m.movement_type==='transfer';
    const locStr = isTransfer
      ? (m._dir==='out' ? `↑ ${loc?.name||'?'}` : `↓ ${loc?.name||'?'}`)
      : (loc?.name||'—');
    return `<tr style="${isTransfer?'background:rgba(59,130,246,.04)':''}">
      <td style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${m.created_at ? new Date(m.created_at).toLocaleString('fr-CA') : '—'}</td>
      <td><span class="badge badge-${cols[m.movement_type]||'gray'}">${typeLabels[m.movement_type]||m.movement_type}</span></td>
      <td style="font-family:var(--font-mono);font-weight:600;color:var(--${col})">${m._sign}${Math.abs(m.quantity)}</td>
      <td style="font-size:11px;color:var(--text2)">${escHtml(locStr)}</td>
      <td style="font-size:11px;color:var(--text3)">${escHtml(m.reference||'—')}</td>
      <td style="font-size:11px;color:var(--text3)">${escHtml(m.user_email||'—')}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="empty" style="padding:24px">Aucun mouvement enregistré</td></tr>`;

  openModal(p.name, `
    <!-- ONGLETS -->
    <div style="display:flex;gap:2px;background:var(--bg2);border-radius:8px;padding:4px;margin-bottom:16px">
      <button id="tab-details" onclick="switchProdTab('details')" style="flex:1;padding:7px;border-radius:6px;border:none;font-family:var(--font-head);font-size:13px;font-weight:500;cursor:pointer;background:var(--bg1);color:var(--text1);transition:all .15s">
        <i class="ti ti-info-circle" style="margin-right:5px"></i>Détails
      </button>
      <button id="tab-history" onclick="switchProdTab('history')" style="flex:1;padding:7px;border-radius:6px;border:none;font-family:var(--font-head);font-size:13px;font-weight:500;cursor:pointer;background:transparent;color:var(--text2);transition:all .15s">
        <i class="ti ti-history" style="margin-right:5px"></i>Historique <span style="font-size:11px;opacity:.7">(${(history||[]).length})</span>
      </button>
    </div>

    <!-- TAB DÉTAILS -->
    <div id="prodtab-details">
      <div class="detail-grid" style="margin-bottom:16px">
        <div class="detail-cell"><div class="detail-cell-label">Référence</div><div class="detail-cell-value" style="font-family:var(--font-mono)">${escHtml(p.reference||'—')}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">Code-barres</div><div class="detail-cell-value" style="font-family:var(--font-mono)">${escHtml(p.barcode||'—')}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">Catégorie</div><div class="detail-cell-value">${escHtml(cat?.name||'—')}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">Unité</div><div class="detail-cell-value">${escHtml(uom?.name||'—')}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">En main</div><div class="detail-cell-value" style="font-size:22px;font-weight:700;color:var(--${s.color==='green'?'green':s.color==='amber'?'amber':'red'})">${Math.round(qty)}<span style="font-size:12px;color:var(--text3);font-weight:400;margin-left:6px">unités</span></div></div>
        <div class="detail-cell"><div class="detail-cell-label">Statut</div><div class="detail-cell-value"><span class="badge badge-${s.color}">${s.label}</span></div></div>
        <div class="detail-cell"><div class="detail-cell-label">Prix vente</div><div class="detail-cell-value" style="font-family:var(--font-mono)">${fmtCAD(p.sale_price)}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">Coût</div><div class="detail-cell-value" style="font-family:var(--font-mono)">${fmtCAD(p.cost_price)}</div></div>
        <div class="detail-cell"><div class="detail-cell-label">Valeur du stock</div><div class="detail-cell-value" style="font-family:var(--font-mono);color:var(--green)">${fmtCAD(qty*(p.cost_price||0))}</div></div>
      </div>

      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <span>Stock par emplacement</span>
        <span style="font-family:var(--font-mono);color:var(--blue)">${(stockMap[id]?.byLocation||[]).length} emplacement${(stockMap[id]?.byLocation||[]).length!==1?'s':''}</span>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:0 14px;margin-bottom:16px">
        ${allLocLines || '<div style="padding:14px 0;font-size:13px;color:var(--text3);text-align:center">Aucun stock enregistré</div>'}
      </div>

      <!-- Alertes : toggle ON/OFF + seuil -->
      <div style="background:var(--amber-dim);border:1px solid rgba(245,166,35,.25);border-radius:10px;padding:14px 16px">
        <!-- Toggle ON/OFF -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="ti ti-bell" style="color:var(--amber);font-size:16px"></i>
            <span style="font-size:13px;font-weight:600">Alertes pour ce produit</span>
          </div>
          <!-- Toggle switch -->
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <span style="font-size:12px;color:var(--text3)" id="alert-toggle-label">${p.alert_enabled===false?'Désactivé':'Activé'}</span>
            <div id="alert-toggle" onclick="toggleAlertEnabled(${id})" style="
              width:44px;height:24px;border-radius:12px;position:relative;cursor:pointer;
              background:${p.alert_enabled===false?'var(--bg3)':'var(--amber)'};
              border:1px solid ${p.alert_enabled===false?'var(--border2)':'var(--amber)'};
              transition:all .2s
            ">
              <div style="
                position:absolute;top:2px;
                left:${p.alert_enabled===false?'2px':'20px'};
                width:18px;height:18px;border-radius:50%;
                background:#fff;transition:left .2s;
                box-shadow:0 1px 3px rgba(0,0,0,.3)
              " id="alert-toggle-knob"></div>
            </div>
          </label>
        </div>
        <!-- Seuil (masqué si désactivé) -->
        <div id="alert-threshold-section" style="display:${p.alert_enabled===false?'none':''}">
          <div style="display:flex;align-items:center;gap:10px">
            <input id="prod-threshold" type="number" min="0" max="9999" class="form-input" style="width:80px;text-align:center" value="${threshold}" placeholder="${window._alertThreshold||4}">
            <span style="font-size:13px;color:var(--text2)">unités</span>
            <button class="btn btn-amber" style="height:34px" onclick="saveProdThreshold(${id})"><i class="ti ti-check"></i> Sauvegarder</button>
            <button class="btn" style="height:34px;font-size:12px" onclick="document.getElementById('prod-threshold').value='';saveProdThreshold(${id})" title="Utiliser le seuil global"><i class="ti ti-refresh"></i> Global</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:7px">Seuil global : ${window._alertThreshold||4} unités · laisse vide pour l'utiliser</div>
        </div>
        <div id="alert-disabled-msg" style="display:${p.alert_enabled===false?'':'none'};font-size:12px;color:var(--text3)">
          Ce produit est exclu des alertes et du comptage de stock faible.
        </div>
      </div>
    </div>

    <!-- TAB HISTORIQUE -->
    <div id="prodtab-history" style="display:none">
      ${recvHistHtml}
      <div style="overflow-x:auto;max-height:400px;overflow-y:auto">
        <table style="min-width:500px">
          <thead><tr><th>Date</th><th>Type</th><th>Qté</th><th>Emplacement</th><th>Réf.</th><th>Par</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    </div>
  `, [
    {label:'<i class="ti ti-trash"></i>',         cls:'btn-danger',  action:`confirmDeleteProduct(${id})`},
    {label:'<i class="ti ti-printer"></i> Étiquette', cls:'',         action:`printLabel(${id})`},
    {label:'Réduire',                              cls:'btn-danger',  action:`closeModal();goTo('reduce',${id})`},
    {label:'Transférer',                           cls:'btn-success', action:`closeModal();goTo('transfer',${id})`},
    {label:'<i class="ti ti-pencil"></i> Modifier',cls:'btn-amber',   action:`openEditProduct(${id})`},
    {label:'<i class="ti ti-check"></i> Sauvegarder', cls:'btn-primary', action:`saveProdThresholdAndClose(${id})`},
  ]);
}

function openEditProduct(id) {
  const p = products.find(x=>x.id===id);
  if(!p) return;
  openModal(`Modifier — ${p.name}`, `
    <div class="form-section">Informations générales</div>
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="ep-name" type="text" class="form-input" value="${escHtml(p.name)}">
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Référence interne</label>
        <input id="ep-ref" type="text" class="form-input" value="${escHtml(p.reference||'')}">
      </div>
      <div class="form-group"><label class="form-label">Code-barres</label>
        <input id="ep-barcode" type="text" class="form-input" value="${escHtml(p.barcode||'')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Catégorie</label>
        <select id="ep-cat" class="form-input">
          <option value="">— Aucune —</option>
          ${categories.map(c=>`<option value="${c.id}" ${p.category_id===c.id?'selected':''}>${escHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Unité de mesure</label>
        <select id="ep-uom" class="form-input">
          <option value="">— Aucune —</option>
          ${uoms.map(u=>`<option value="${u.id}" ${p.uom_id===u.id?'selected':''}>${escHtml(u.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fournisseur</label>
        <select id="ep-supplier" class="form-input">
          <option value="">— Aucun —</option>
          ${suppliers.map(s=>`<option value="${escHtml(s.name)}" ${p.supplier===s.name?'selected':''}>${escHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"></div>
    </div>
    <div class="form-section">Prix</div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Prix de vente (CAD)</label>
        <input id="ep-price" type="number" min="0" step="1" class="form-input" value="${p.sale_price||0}">
      </div>
      <div class="form-group"><label class="form-label">Coût (CAD)</label>
        <input id="ep-cost" type="number" min="0" step="1" class="form-input" value="${p.cost_price||0}">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Description</label>
      <textarea id="ep-desc" class="form-input" rows="2">${escHtml(p.description||'')}</textarea>
    </div>
  `, [
    {label:'<i class="ti ti-check"></i> Sauvegarder', cls:'btn-primary', action:`submitEditProduct(${id})`},
  ]);
}

async function submitEditProduct(id) {
  const name     = document.getElementById('ep-name')?.value?.trim();
  const ref      = document.getElementById('ep-ref')?.value?.trim() || null;
  const barcode  = document.getElementById('ep-barcode')?.value?.trim() || null;
  const catId    = parseInt(document.getElementById('ep-cat')?.value) || null;
  const uomId    = parseInt(document.getElementById('ep-uom')?.value) || null;
  const supplier = document.getElementById('ep-supplier')?.value || null;
  const price    = parseFloat(document.getElementById('ep-price')?.value) || 0;
  const cost     = parseFloat(document.getElementById('ep-cost')?.value) || 0;
  const desc     = document.getElementById('ep-desc')?.value?.trim() || null;

  if(!name){ toast('Le nom est obligatoire','error'); return; }

  const { error } = await sb.from('products').update({
    name, reference:ref, barcode, category_id:catId, uom_id:uomId,
    supplier, sale_price:price, cost_price:cost, description:desc,
    updated_at: new Date().toISOString()
  }).eq('id', id);

  if(error){ toast('Erreur: '+error.message,'error'); return; }

  toast(`✓ "${name}" mis à jour`,'success');
  closeModal();
  await loadAll();
  vProducts(document.getElementById('main-content'));
}


function confirmDeleteProduct(id) {
  const p = products.find(x=>x.id===id);
  if(!p) return;
  openModal('Supprimer ce produit ?', `
    <div style="background:var(--red-dim);border:1px solid rgba(245,69,92,.3);border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <i class="ti ti-alert-triangle" style="color:var(--red);font-size:20px"></i>
        <span style="font-size:14px;font-weight:600;color:var(--red)">Action irréversible</span>
      </div>
      <div style="font-size:13px;color:var(--text2)">
        Tu vas supprimer <strong style="color:var(--text1)">${escHtml(p.name)}</strong> ainsi que tout son stock et ses mouvements associés.
      </div>
    </div>
  `, [
    {label:'<i class="ti ti-trash"></i> Supprimer définitivement', cls:'btn-danger', action:`deleteProduct(${id})`}
  ]);
}

async function deleteProduct(id) {
  const p = products.find(x=>x.id===id);
  try {
    // Delete stock lines first
    await sb.from('stock').delete().eq('product_id', id);
    // Delete movements
    await sb.from('movements').delete().eq('product_id', id);
    // Delete product
    const { error } = await sb.from('products').delete().eq('id', id);
    if(error) throw error;
    toast(`✓ "${p?.name}" supprimé`, 'success');
    closeModal();
    await loadAll();
    vProducts(document.getElementById('main-content'));
  } catch(e) { toast('Erreur: '+e.message, 'error'); }
}


function switchProdTab(tab) {
  document.getElementById('prodtab-details').style.display  = tab==='details' ? '' : 'none';
  document.getElementById('prodtab-history').style.display  = tab==='history' ? '' : 'none';
  document.getElementById('tab-details').style.background   = tab==='details' ? 'var(--bg1)' : 'transparent';
  document.getElementById('tab-details').style.color        = tab==='details' ? 'var(--text1)' : 'var(--text2)';
  document.getElementById('tab-history').style.background   = tab==='history' ? 'var(--bg1)' : 'transparent';
  document.getElementById('tab-history').style.color        = tab==='history' ? 'var(--text1)' : 'var(--text2)';
}

async function saveProdThreshold(id) {
  const val = document.getElementById('prod-threshold')?.value;
  const threshold = val === '' ? null : parseInt(val);
  const { error } = await sb.from('products').update({ alert_threshold: threshold }).eq('id', id);
  if(error) { toast('Erreur: '+error.message,'error'); return; }
  const p = products.find(x=>x.id===id);
  if(p) p.alert_threshold = threshold;
  updateAlerts();
  toast(threshold !== null ? `✓ Seuil de ${threshold} unités` : '✓ Seuil global utilisé', 'success');
}

async function saveProdThresholdAndClose(id) {
  await saveProdThreshold(id);
  closeModal();
}

async function toggleAlertEnabled(id) {
  const p = products.find(x=>x.id===id); if(!p) return;
  const newVal = p.alert_enabled === false ? true : false;
  const { error } = await sb.from('products').update({ alert_enabled: newVal }).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  p.alert_enabled = newVal;

  // Update toggle UI without closing modal
  const toggle    = document.getElementById('alert-toggle');
  const knob      = document.getElementById('alert-toggle-knob');
  const label     = document.getElementById('alert-toggle-label');
  const section   = document.getElementById('alert-threshold-section');
  const disabledMsg = document.getElementById('alert-disabled-msg');

  if(toggle){
    toggle.style.background = newVal ? 'var(--amber)' : 'var(--bg3)';
    toggle.style.borderColor = newVal ? 'var(--amber)' : 'var(--border2)';
  }
  if(knob)  knob.style.left  = newVal ? '20px' : '2px';
  if(label) label.textContent = newVal ? 'Activé' : 'Désactivé';
  if(section)    section.style.display    = newVal ? '' : 'none';
  if(disabledMsg) disabledMsg.style.display = newVal ? 'none' : '';

  updateAlerts();
  toast(newVal ? `✓ Alertes activées pour ${p.name}` : `✓ Alertes désactivées pour ${p.name}`, 'success');
  // Si on revient sur le dashboard, le rafraîchir aussi
  if(currentView==='dashboard') renderView('dashboard');
}





function showLoc(id) {
  const l=locations.find(x=>x.id===id); if(!l) return;
  const locProds=Object.entries(stockMap)
    .map(([pid,sm])=>({p:products.find(x=>x.id==pid),b:sm.byLocation.find(b=>b.locId===id)}))
    .filter(x=>x.p&&x.b&&x.b.qty>0)
    .sort((a,b)=>b.b.qty-a.b.qty);
  openModal(`Emplacement : ${l.name}`,`
    <div class="detail-grid" style="margin-bottom:16px">
      <div class="detail-cell"><div class="detail-cell-label">Nom</div><div class="detail-cell-value">${escHtml(l.name)}</div></div>
      <div class="detail-cell"><div class="detail-cell-label">Type</div><div class="detail-cell-value"><span class="badge badge-blue">${l.usage}</span></div></div>
      <div class="detail-cell" style="grid-column:span 2"><div class="detail-cell-label">Chemin</div><div class="detail-cell-value" style="font-family:var(--font-mono);font-size:12px">${escHtml(l.full_path||'—')}</div></div>
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Produits stockés ici</div>
    <div style="max-height:300px;overflow-y:auto;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:0 12px">
      ${locProds.length?locProds.map(({p,b})=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="font-weight:500">${escHtml(p.name)}</span>
          <span style="font-family:var(--font-mono);color:var(--blue)">${Math.round(b.qty)}</span>
        </div>`).join(''):'<div style="padding:16px;text-align:center;color:var(--text3)">Aucun produit</div>'}
    </div>
  `,[{label:'Fermer',cls:'',action:'closeModal()'}]);
}

function openNewLoc() {
  openModal('Nouvel emplacement',`
    <div class="form-group"><label class="form-label">Nom *</label><input id="nl-name" type="text" class="form-input" placeholder="ex: Entrepôt A - Rangée 3"></div>
    <div class="form-group"><label class="form-label">Emplacement parent</label>
      <select id="nl-parent" class="form-input">
        <option value="">-- Racine --</option>
        ${locations.filter(l=>l.usage==='internal').map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}
      </select>
    </div>
  `,[{label:'Fermer',cls:'',action:'closeModal()'},{label:'Créer',cls:'btn-primary',action:'submitNewLoc()'}]);
}
async function submitNewLoc() {
  const name=document.getElementById('nl-name')?.value?.trim();
  if(!name){toast('Nom obligatoire','error');return;}
  const parentId=parseInt(document.getElementById('nl-parent')?.value)||null;
  const parent=locations.find(l=>l.id===parentId);
  const fullPath=parent?`${parent.full_path||parent.name} / ${name}`:name;
  try {
    await sb.from('locations').insert({name,full_path:fullPath,usage:'internal',active:true,parent_id:parentId||null});
    toast(`Emplacement "${name}" créé !`,'success');
    closeModal();
    await loadAll();
    vLocations(document.getElementById('main-content'));
  } catch(e){toast('Erreur: '+e.message,'error');}
}

// ══════════════════════════════════════════════════════════
// MIGRATION VIEW (admin only)
// ══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════
// ADMIN VIEWS
// ══════════════════════════════════════════════════════════
async function vUsers(c) {
  c=c||document.getElementById('main-content');
  if(profile?.role!=='admin'){c.innerHTML='<div class="empty"><i class="ti ti-lock" style="display:block;font-size:40px;opacity:.3;margin-bottom:12px"></i>Accès réservé aux administrateurs</div>';return;}
  c.innerHTML='<div class="empty"><i class="ti ti-loader spin"></i></div>';
  const {data:prof}=await sb.from('profiles').select('*').order('created_at');
  c.innerHTML=`
  <div style="display:flex;justify-content:flex-end;margin-bottom:16px">
    <button class="btn btn-primary" onclick="openInvite()"><i class="ti ti-user-plus"></i> Créer un utilisateur</button>
  </div>
  <div class="table-card">
    <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-users" style="color:var(--blue);margin-right:6px"></i>Utilisateurs (${(prof||[]).length})</div></div>
    <table><thead><tr><th>Nom</th><th>Courriel</th><th>Rôle</th><th>Membre depuis</th><th>Changer rôle</th><th>Actions</th></tr></thead>
    <tbody>${(prof||[]).map(p=>`<tr>
      <td style="font-weight:500">${escHtml(p.full_name||'—')}</td>
      <td style="color:var(--text2);font-size:12px">${escHtml(p.email||'—')}</td>
      <td><span class="role-badge role-${p.role}">${p.role}</span></td>
      <td style="font-size:11px;color:var(--text3)">${p.created_at?new Date(p.created_at).toLocaleDateString('fr-CA'):'—'}</td>
      <td><select onchange="changeRole('${p.id}',this.value)" class="form-input" style="padding:4px 8px;height:auto;font-size:12px;width:auto">
        <option value="viewer"    ${p.role==='viewer'    ?'selected':''}>Viewer</option>
        <option value="operation" ${p.role==='operation' ?'selected':''}>Opération</option>
        <option value="manager"   ${p.role==='manager'   ?'selected':''}>Manager</option>
        <option value="admin"     ${p.role==='admin'     ?'selected':''}>Admin</option>
      </select></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-amber" style="height:28px;padding:0 10px;font-size:11px" onclick="openResetPassword('${p.id}','${escHtml(p.email||'')}','${escHtml(p.full_name||'')}')">
            <i class="ti ti-key"></i> MDP
          </button>
          ${p.id !== user.id ? `<button class="btn btn-danger" style="height:28px;padding:0 10px;font-size:11px" onclick="confirmDeleteUser('${p.id}','${escHtml(p.full_name||p.email||'')}')">
            <i class="ti ti-trash"></i>
          </button>` : `<span style="font-size:11px;color:var(--text3);padding:0 6px">Vous</span>`}
        </div>
      </td>
    </tr>`).join('')}
    </tbody></table>
  </div>
  <div style="margin-top:16px;background:var(--bg1);border:1px solid var(--border);border-radius:10px;padding:16px">
    <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em">Rôles</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:12px">
      <div style="padding:12px;background:var(--bg2);border-radius:8px"><span class="role-badge role-viewer" style="display:inline-block;margin-bottom:6px">Viewer</span><br style="margin-bottom:4px">Lecture seule</div>
      <div style="padding:12px;background:var(--bg2);border-radius:8px"><span class="role-badge role-operation" style="display:inline-block;margin-bottom:6px">Opération</span><br>Inventaire (soumis pour validation)</div>
      <div style="padding:12px;background:var(--bg2);border-radius:8px"><span class="role-badge role-manager" style="display:inline-block;margin-bottom:6px">Manager</span><br>Réception, transfert, validation inventaires</div>
      <div style="padding:12px;background:var(--bg2);border-radius:8px"><span class="role-badge role-admin" style="display:inline-block;margin-bottom:6px">Admin</span><br>Tout + gestion utilisateurs</div>
    </div>
  </div>`;
}

async function changeRole(uid, role) {
  const {error} = await sb.from('profiles').update({role}).eq('id', uid);
  if(error) {
    toast('Erreur: '+error.message, 'error');
    // Revert select to current value
    await vUsers(document.getElementById('main-content'));
  } else {
    toast('✓ Rôle mis à jour → '+role, 'success');
    // Update local profile if it's the current user
    if(uid === user?.id && profile) profile.role = role;
  }
}

function openResetPassword(uid, email, name) {
  const newPw = genPw();
  openModal(`Réinitialiser le mot de passe`, `
    <div style="background:var(--amber-dim);border:1px solid rgba(234,179,8,.25);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <i class="ti ti-key" style="color:var(--amber);font-size:16px"></i>
        <span style="font-size:13px;font-weight:600">Nouveau mot de passe pour <strong>${escHtml(name||email)}</strong></span>
      </div>
      <div style="font-size:12px;color:var(--text3)">${escHtml(email)}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Nouveau mot de passe</label>
      <div style="display:flex;gap:8px">
        <input id="reset-pw" type="text" class="form-input" value="${newPw}" style="font-family:var(--font-mono)">
        <button class="btn" onclick="document.getElementById('reset-pw').value=genPw()" title="Générer un nouveau"><i class="ti ti-refresh"></i></button>
      </div>
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--text3)">
      <i class="ti ti-info-circle" style="margin-right:6px"></i>
      Communique ce mot de passe à l'utilisateur. Il pourra le changer après connexion.
    </div>
  `, [
    {label:'Fermer', cls:'', action:'closeModal()'},
    {label:'<i class="ti ti-check"></i> Réinitialiser', cls:'btn-amber', action:`submitResetPassword('${uid}')`},
  ]);
}

async function submitResetPassword(uid) {
  const pw = document.getElementById('reset-pw')?.value?.trim();
  if(!pw||pw.length<8){toast('Mot de passe trop court (min 8 car.)','error');return;}
  try {
    // Use Supabase Admin API via service role — fallback to direct update if available
    const {data, error} = await sb.auth.admin?.updateUserById
      ? await sb.auth.admin.updateUserById(uid, {password: pw})
      : {data:null, error:{message:'API admin non disponible — utilise le dashboard Supabase'}};
    if(error) throw error;
    toast(`✓ Mot de passe réinitialisé`, 'success');
    closeModal();
  } catch(e) {
    // Fallback: show instructions
    openModal('Réinitialisation manuelle', `
      <div style="background:var(--blue-bg);border:1px solid var(--blue);border-radius:10px;padding:14px 16px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:var(--blue);margin-bottom:8px"><i class="ti ti-info-circle" style="margin-right:6px"></i>Réinitialisation via Supabase</div>
        <div style="font-size:12px;color:var(--text2);line-height:1.6">
          La clé publique ne permet pas de modifier les mots de passe d'autres utilisateurs.<br><br>
          Pour réinitialiser, va dans :<br>
          <strong style="color:var(--text1)">Supabase Dashboard → Authentication → Users → ${escHtml(uid)}</strong><br><br>
          Ou envoie un lien de réinitialisation par courriel :
        </div>
      </div>
      <button class="btn btn-primary" style="width:100%" onclick="sendResetEmail('${uid}')">
        <i class="ti ti-mail"></i> Envoyer un lien de réinitialisation par courriel
      </button>
    `, [{label:'Fermer', cls:'', action:'closeModal()'}]);
  }
}

async function sendResetEmail(uid) {
  // Get user email from profiles
  const {data:p} = await sb.from('profiles').select('email').eq('id',uid).single();
  if(!p?.email){toast('Courriel introuvable','error');return;}
  const {error} = await sb.auth.resetPasswordForEmail(p.email, {
    redirectTo: window.location.origin
  });
  if(error){toast('Erreur: '+error.message,'error');return;}
  toast(`✓ Lien de réinitialisation envoyé à ${p.email}`,'success');
  closeModal();
}

function confirmDeleteUser(uid, name) {
  openModal('Supprimer cet utilisateur ?', `
    <div style="background:var(--red-dim);border:1px solid rgba(242,86,104,.3);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <i class="ti ti-alert-triangle" style="color:var(--red);font-size:20px"></i>
        <span style="font-size:14px;font-weight:600;color:var(--red)">Action irréversible</span>
      </div>
      <div style="font-size:13px;color:var(--text2)">
        Supprimer le compte de <strong style="color:var(--text1)">${escHtml(name)}</strong> ?<br>
        <span style="font-size:12px;margin-top:4px;display:block">L'utilisateur ne pourra plus se connecter.</span>
      </div>
    </div>
  `, [
    {label:'Annuler', cls:'', action:'closeModal()'},
    {label:'<i class="ti ti-trash"></i> Supprimer', cls:'btn-danger', action:`submitDeleteUser('${uid}')`},
  ]);
}

async function submitDeleteUser(uid) {
  try {
    // Delete profile first (RLS allows admin)
    await sb.from('profiles').delete().eq('id', uid);
    toast('✓ Profil supprimé. Le compte auth sera nettoyé automatiquement.','success');
    closeModal();
    await vUsers(document.getElementById('main-content'));
  } catch(e){toast('Erreur: '+e.message,'error');}
}
function openInvite() {
  openModal('Créer un nouvel utilisateur', `
    <div class="form-group"><label class="form-label">Nom complet *</label><input id="inv-name" type="text" class="form-input" placeholder="Jean Tremblay"></div>
    <div class="form-group"><label class="form-label">Adresse courriel *</label><input id="inv-email" type="email" class="form-input" placeholder="jean@goplex.com"></div>
    <div class="form-group"><label class="form-label">Mot de passe temporaire *</label>
      <div style="display:flex;gap:8px">
        <input id="inv-pw" type="text" class="form-input" placeholder="min. 8 caractères" style="flex:1">
        <button class="btn" onclick="document.getElementById('inv-pw').value=genPw()" title="Générer"><i class="ti ti-refresh"></i></button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">L'utilisateur devra changer son mot de passe à la première connexion</div>
    </div>
    <div class="form-group"><label class="form-label">Rôle</label>
      <select id="inv-role" class="form-input">
        <option value="viewer">Viewer — lecture seule</option>
        <option value="operation">Opération — inventaire uniquement</option>
        <option value="manager">Manager — opérations stock + validation</option>
        <option value="admin">Admin — accès complet</option>
      </select>
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Créer le compte', cls:'btn-primary', action:'submitCreateUser()'}]);
}

function genPw() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({length:12}, ()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}

async function submitCreateUser() {
  const name  = document.getElementById('inv-name')?.value?.trim();
  const email = document.getElementById('inv-email')?.value?.trim();
  const pw    = document.getElementById('inv-pw')?.value?.trim();
  const role  = document.getElementById('inv-role')?.value;

  if(!name||!email||!pw){ toast('Remplissez tous les champs','error'); return; }
  if(pw.length < 8){ toast('Mot de passe trop court (min 8 car.)','error'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast('Adresse courriel invalide','error'); return; }

  const btn = document.querySelector('#modal-footer .btn-primary');
  if(btn){ btn.disabled=true; btn.innerHTML='<i class="ti ti-loader spin"></i> Création…'; }

  try {
    // signUp crée le compte SANS connecter l'utilisateur si autoConfirm est off
    // On sauvegarde la session admin avant
    const { data:adminSession } = await sb.auth.getSession();

    const { data, error } = await sb.auth.signUp({
      email, password: pw,
      options: { data: { full_name: name }, emailRedirectTo: null }
    });

    if(error) throw error;
    if(!data.user) throw new Error('Utilisateur non créé — vérifiez la configuration Supabase');

    // Mettre à jour le profil immédiatement
    await sb.from('profiles').upsert({
      id:        data.user.id,
      email,
      full_name: name,
      role,
    }, { onConflict: 'id' });

    // Si signUp a changé la session, restaurer la session admin
    const { data:newSession } = await sb.auth.getSession();
    if(newSession?.user?.id !== adminSession?.session?.user?.id) {
      // Re-sign in as admin — this shouldn't happen but just in case
      await sb.auth.setSession(adminSession.session);
    }

    toast(`✓ Compte créé pour ${name}`, 'success');
    closeModal();
    await vUsers(document.getElementById('main-content'));

    // Proposer d'envoyer les instructions d'installation
    setTimeout(() => openInstructions(name, email, pw), 300);

  } catch(e) {
    const msg = e.message?.includes('already registered')
      ? 'Ce courriel est déjà utilisé'
      : e.message?.includes('invalid')
      ? 'Courriel ou mot de passe invalide'
      : e.message || 'Erreur inconnue';
    toast(`Erreur: ${msg}`, 'error');
    if(btn){ btn.disabled=false; btn.innerHTML='Créer le compte'; }
  }
}

// ══════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════
async function vSettings(c) {
  c = c || document.getElementById('main-content');
  c.innerHTML = '<div class="empty"><i class="ti ti-loader spin"></i></div>';

  const { data: dbUoms  } = await sb.from('uoms').select('*').order('name');
  const { data: dbCats  } = await sb.from('categories').select('*').order('name');
  const { data: dbSups  } = await sb.from('suppliers').select('*').order('name');
  const { data: dbNotifs } = await sb.from('notification_schedules').select('*').order('created_at');
  _notifs = dbNotifs || [];

  c.innerHTML = `
  <div style="max-width:800px;display:flex;flex-direction:column;gap:20px">

    <!-- ── UNITÉS DE MESURE ── -->
    <div class="table-card">
      <div class="table-toolbar">
        <div class="table-toolbar-title"><i class="ti ti-ruler" style="color:var(--blue);margin-right:8px"></i>Unités de mesure</div>
        <button class="btn btn-primary" onclick="openAddUom()"><i class="ti ti-plus"></i> Ajouter</button>
      </div>
      <table>
        <thead><tr><th>Nom</th><th>Utilisée par</th><th>Action</th></tr></thead>
        <tbody id="uom-rows">
          ${(dbUoms||[]).length ? (dbUoms||[]).map(u => {
            const count = products.filter(p => p.uom_id === u.id).length;
            return `<tr>
              <td style="font-weight:500">${escHtml(u.name)}</td>
              <td><span class="badge badge-${count>0?'blue':'gray'}">${count} produit${count!==1?'s':''}</span></td>
              <td>
                <button class="btn" style="height:28px;padding:0 10px;font-size:12px" onclick="editUom(${u.id},'${escHtml(u.name)}')"><i class="ti ti-pencil"></i></button>
                <button class="btn btn-danger" style="height:28px;padding:0 10px;font-size:12px;margin-left:4px" onclick="deleteUom(${u.id},${count})"${count>0?' disabled title="Utilisée par des produits"':''}><i class="ti ti-trash"></i></button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="3" class="empty" style="padding:24px">Aucune unité — ajoutez-en une</td></tr>'}
        </tbody>
      </table>
      <div style="padding:12px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
        Exemples : unité, kg, litre, boîte, caisse, rouleau, paire, mètre…
      </div>
    </div>

    <!-- ── CATÉGORIES ── -->
    <div class="table-card">
      <div class="table-toolbar">
        <div class="table-toolbar-title"><i class="ti ti-tag" style="color:var(--amber);margin-right:8px"></i>Catégories de produits</div>
        <button class="btn btn-primary" onclick="openAddCat()"><i class="ti ti-plus"></i> Ajouter</button>
      </div>
      <table>
        <thead><tr><th>Nom</th><th>Produits</th><th>Action</th></tr></thead>
        <tbody id="cat-rows">
          ${(dbCats||[]).length ? (dbCats||[]).map(cat => {
            const count = products.filter(p => p.category_id === cat.id).length;
            return `<tr>
              <td style="font-weight:500">${escHtml(cat.name)}</td>
              <td><span class="badge badge-${count>0?'amber':'gray'}">${count} produit${count!==1?'s':''}</span></td>
              <td>
                <button class="btn" style="height:28px;padding:0 10px;font-size:12px" onclick="editCat(${cat.id},'${escHtml(cat.name)}')"><i class="ti ti-pencil"></i></button>
                <button class="btn btn-danger" style="height:28px;padding:0 10px;font-size:12px;margin-left:4px" onclick="deleteCat(${cat.id},${count})"${count>0?' disabled title="Utilisée par des produits"':''}><i class="ti ti-trash"></i></button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="3" class="empty" style="padding:24px">Aucune catégorie</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- ── FOURNISSEURS ── -->
    <div class="table-card">
      <div class="table-toolbar">
        <div class="table-toolbar-title"><i class="ti ti-truck" style="color:var(--green);margin-right:8px"></i>Fournisseurs</div>
        <button class="btn btn-primary" onclick="openAddSupplier()"><i class="ti ti-plus"></i> Ajouter</button>
      </div>
      <table>
        <thead><tr><th>Nom</th><th>Représentant</th><th>Téléphone</th><th>Produits</th><th>Action</th></tr></thead>
        <tbody id="supplier-rows">
          ${(dbSups||[]).length ? (dbSups||[]).map(s => {
            const count = products.filter(p => p.supplier === s.name).length;
            return `<tr>
              <td style="font-weight:500">${escHtml(s.name)}</td>
              <td style="color:var(--text2)">${escHtml(s.representative||'—')}</td>
              <td style="color:var(--text2);font-family:var(--font-mono);font-size:12px">${escHtml(s.phone||'—')}</td>
              <td><span class="badge badge-${count>0?'green':'gray'}">${count} produit${count!==1?'s':''}</span></td>
              <td>
                <button class="btn" style="height:28px;padding:0 10px;font-size:12px" onclick="editSupplier(${s.id})"><i class="ti ti-pencil"></i></button>
                <button class="btn btn-danger" style="height:28px;padding:0 10px;font-size:12px;margin-left:4px" onclick="deleteSupplier(${s.id},${count},'${escHtml(s.name)}')"${count>0?' disabled title="Utilisé par des produits"':''}><i class="ti ti-trash"></i></button>
              </td>
            </tr>`;
          }).join('') : '<tr><td colspan="5" class="empty" style="padding:24px">Aucun fournisseur — ajoutez-en un</td></tr>'}
        </tbody>
      </table>
      <div style="padding:12px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
        Les fournisseurs ajoutés ici apparaissent automatiquement dans le menu déroulant à la création/modification d'un produit.
      </div>
    </div>

    <!-- ── SEUIL D'ALERTE STOCK ── -->
    <div class="table-card" style="padding:20px 24px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <i class="ti ti-bell" style="font-size:20px;color:var(--amber)"></i>
        <div>
          <div style="font-size:14px;font-weight:600">Seuil d'alerte stock faible</div>
          <div style="font-size:12px;color:var(--text3)">En dessous de cette quantité, un produit apparaît en alerte</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <input id="threshold-val" type="number" min="1" max="100" class="form-input" style="width:100px" value="${window._alertThreshold||4}">
        <span style="font-size:13px;color:var(--text2)">unités</span>
        <button class="btn btn-primary" onclick="saveThreshold()"><i class="ti ti-check"></i> Sauvegarder</button>
      </div>
    </div>

    <!-- ── NOTIFICATIONS AUTOMATIQUES ── -->
    <div class="table-card">
      <div class="table-toolbar">
        <div class="table-toolbar-title"><i class="ti ti-mail" style="color:var(--purple);margin-right:8px"></i>Notifications automatiques</div>
        <button class="btn btn-primary" onclick="openAddNotif()"><i class="ti ti-plus"></i> Ajouter</button>
      </div>
      <div style="padding:10px 16px;background:var(--amber-dim);border-bottom:1px solid var(--amber);font-size:12px;color:var(--amber);display:flex;align-items:center;gap:8px;line-height:1.4">
        <i class="ti ti-alert-triangle" style="flex-shrink:0"></i>
        <span>Le moteur d'envoi n'est pas encore branché — tes règles sont enregistrées, mais aucun courriel ne part pour l'instant. On l'activera avec ta clé d'envoi (Resend).</span>
      </div>
      <table>
        <thead><tr><th>Rapport</th><th>Quand</th><th>Courriel</th><th>Actif</th><th>Action</th></tr></thead>
        <tbody>
          ${_notifs.length ? _notifs.map(n => `<tr>
            <td style="font-weight:500">${escHtml(notifReportLabel(n.report))}</td>
            <td style="color:var(--text2)">${escHtml(notifWhen(n))}</td>
            <td style="color:var(--text2);font-size:12px;font-family:var(--font-mono)">${escHtml(n.email)}</td>
            <td onclick="event.stopPropagation()">${renderNotifToggle(n)}</td>
            <td>
              <button class="btn" style="height:28px;padding:0 10px;font-size:12px" onclick="editNotif(${n.id})"><i class="ti ti-pencil"></i></button>
              <button class="btn btn-danger" style="height:28px;padding:0 10px;font-size:12px;margin-left:4px" onclick="deleteNotif(${n.id})"><i class="ti ti-trash"></i></button>
            </td>
          </tr>`).join('') : '<tr><td colspan="5" class="empty" style="padding:24px">Aucune notification — ajoutes-en une</td></tr>'}
        </tbody>
      </table>
      <div style="padding:12px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
        Choisis le rapport, la fréquence (quotidien, hebdo, mensuel ou une date précise), l'heure et le ou les courriels (sépare-les par des virgules).
      </div>
    </div>

  </div>`;
}

// ── NOTIFICATIONS AUTOMATIQUES ────────────────────────────
let _notifs = [];

function notifReportLabel(r){
  return ({rupture:'Alertes de rupture / stock faible', forecast:'Prévisions de rupture',
    lot_achat:"Lot d'achat (à commander)", inventaire:'Inventaire complet'})[r] || r;
}
function notifWhen(n){
  const days=['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const t=n.run_time||'08:00';
  if(n.frequency==='daily')   return `Tous les jours à ${t}`;
  if(n.frequency==='weekly')  return `Chaque ${days[n.day_of_week??1]} à ${t}`;
  if(n.frequency==='monthly') return `Le ${n.day_of_month||1} de chaque mois à ${t}`;
  if(n.frequency==='once')    return `Le ${n.run_date||'?'} à ${t}`;
  return t;
}
function renderNotifToggle(n){
  const on = n.active !== false;
  return `<div onclick="toggleNotif(${n.id})" style="width:40px;height:22px;border-radius:11px;position:relative;cursor:pointer;flex-shrink:0;
    background:${on?'var(--green)':'var(--bg3)'};border:1px solid ${on?'var(--green)':'var(--border2)'};transition:all .2s" title="${on?'Désactiver':'Activer'}">
    <div style="position:absolute;top:2px;left:${on?'18px':'2px'};width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>
  </div>`;
}

function _notifFields(n){
  n = n || {};
  const freq = n.frequency || 'daily';
  const days = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  return `
    <div class="form-group"><label class="form-label">Rapport à envoyer *</label>
      <select id="notif-report" class="form-input">
        <option value="rupture" ${n.report==='rupture'?'selected':''}>Alertes de rupture / stock faible</option>
        <option value="forecast" ${n.report==='forecast'?'selected':''}>Prévisions de rupture</option>
        <option value="lot_achat" ${n.report==='lot_achat'?'selected':''}>Lot d'achat (à commander)</option>
        <option value="inventaire" ${n.report==='inventaire'?'selected':''}>Inventaire complet</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fréquence *</label>
        <select id="notif-freq" class="form-input" onchange="notifFreqChange()">
          <option value="daily" ${freq==='daily'?'selected':''}>Tous les jours</option>
          <option value="weekly" ${freq==='weekly'?'selected':''}>Chaque semaine</option>
          <option value="monthly" ${freq==='monthly'?'selected':''}>Chaque mois</option>
          <option value="once" ${freq==='once'?'selected':''}>Une seule fois (date précise)</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Heure *</label>
        <input id="notif-time" type="time" class="form-input" value="${n.run_time||'08:00'}">
      </div>
    </div>
    <div class="form-group" id="notif-row-dow" style="display:${freq==='weekly'?'':'none'}">
      <label class="form-label">Jour de la semaine</label>
      <select id="notif-dow" class="form-input">
        ${days.map((d,i)=>`<option value="${i}" ${(n.day_of_week??1)===i?'selected':''}>${d.charAt(0).toUpperCase()+d.slice(1)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" id="notif-row-dom" style="display:${freq==='monthly'?'':'none'}">
      <label class="form-label">Jour du mois (1–31)</label>
      <input id="notif-dom" type="number" min="1" max="31" class="form-input" value="${n.day_of_month||1}">
    </div>
    <div class="form-group" id="notif-row-date" style="display:${freq==='once'?'':'none'}">
      <label class="form-label">Date</label>
      <input id="notif-date" type="date" class="form-input" value="${n.run_date||''}">
    </div>
    <div class="form-group"><label class="form-label">Courriel(s) *</label>
      <input id="notif-email" type="text" class="form-input" placeholder="toi@goplex.com, gerant@goplex.com" value="${escHtml(n.email||'')}">
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Plusieurs destinataires : sépare-les par des virgules.</div>
    </div>`;
}

function notifFreqChange(){
  const f = document.getElementById('notif-freq')?.value;
  const set = (id,show)=>{ const el=document.getElementById(id); if(el) el.style.display = show?'':'none'; };
  set('notif-row-dow',  f==='weekly');
  set('notif-row-dom',  f==='monthly');
  set('notif-row-date', f==='once');
}

function _readNotifForm(){
  const freq = document.getElementById('notif-freq')?.value;
  return {
    report:       document.getElementById('notif-report')?.value,
    frequency:    freq,
    run_time:     document.getElementById('notif-time')?.value || '08:00',
    day_of_week:  freq==='weekly'  ? parseInt(document.getElementById('notif-dow')?.value) : null,
    day_of_month: freq==='monthly' ? parseInt(document.getElementById('notif-dom')?.value) : null,
    run_date:     freq==='once'    ? (document.getElementById('notif-date')?.value || null) : null,
    email:        (document.getElementById('notif-email')?.value || '').trim(),
  };
}

function openAddNotif(){
  openModal('Nouvelle notification', _notifFields(),
    [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Ajouter',cls:'btn-primary',action:'submitAddNotif()'}]);
}
async function submitAddNotif(){
  const v = _readNotifForm();
  if(!v.email){ toast('Courriel obligatoire','error'); return; }
  if(v.frequency==='once' && !v.run_date){ toast('Choisis une date','error'); return; }
  const { error } = await sb.from('notification_schedules').insert(v);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('✓ Notification ajoutée','success');
  closeModal();
  vSettings(document.getElementById('main-content'));
}
function editNotif(id){
  const n = _notifs.find(x=>x.id===id);
  if(!n){ toast('Notification introuvable','error'); return; }
  openModal('Modifier la notification', _notifFields(n),
    [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Sauvegarder',cls:'btn-primary',action:`submitEditNotif(${id})`}]);
}
async function submitEditNotif(id){
  const v = _readNotifForm();
  if(!v.email){ toast('Courriel obligatoire','error'); return; }
  if(v.frequency==='once' && !v.run_date){ toast('Choisis une date','error'); return; }
  const { error } = await sb.from('notification_schedules').update(v).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('✓ Notification mise à jour','success');
  closeModal();
  vSettings(document.getElementById('main-content'));
}
async function deleteNotif(id){
  if(!confirm('Supprimer cette notification ?')) return;
  const { error } = await sb.from('notification_schedules').delete().eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('Notification supprimée','success');
  vSettings(document.getElementById('main-content'));
}
async function toggleNotif(id){
  const n = _notifs.find(x=>x.id===id); if(!n) return;
  const next = (n.active === false);   // si éteint -> allume
  const { error } = await sb.from('notification_schedules').update({active:next}).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(next?'✓ Notification activée':'Notification désactivée','success');
  vSettings(document.getElementById('main-content'));
}

// ── UOM CRUD ──────────────────────────────────────────────
function openAddUom() {
  openModal('Ajouter une unité de mesure', `
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="uom-name" type="text" class="form-input" placeholder="ex: kg, litre, boîte, caisse…">
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
      ${['unité','kg','g','litre','ml','boîte','caisse','rouleau','paire','mètre','cm','palette'].map(s=>
        `<span style="padding:3px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:20px;font-size:12px;cursor:pointer" onclick="document.getElementById('uom-name').value='${s}'">${s}</span>`
      ).join('')}
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Ajouter', cls:'btn-primary', action:'submitAddUom()'}]);
}

async function submitAddUom() {
  const name = document.getElementById('uom-name')?.value?.trim();
  if(!name){ toast('Nom obligatoire','error'); return; }
  const { error } = await sb.from('uoms').insert({ name });
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(`✓ Unité "${name}" ajoutée`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

function editUom(id, currentName) {
  openModal('Modifier l\'unité', `
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="uom-edit-name" type="text" class="form-input" value="${escHtml(currentName)}">
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Sauvegarder', cls:'btn-primary', action:`submitEditUom(${id})`}]);
}

async function submitEditUom(id) {
  const name = document.getElementById('uom-edit-name')?.value?.trim();
  if(!name){ toast('Nom obligatoire','error'); return; }
  const { error } = await sb.from('uoms').update({ name }).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(`✓ Unité mise à jour`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

async function deleteUom(id, count) {
  if(count > 0){ toast('Impossible — utilisée par des produits','error'); return; }
  if(!confirm('Supprimer cette unité ?')) return;
  const { error } = await sb.from('uoms').delete().eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('Unité supprimée','success');
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

// ── CATEGORY CRUD ─────────────────────────────────────────
function openAddCat() {
  openModal('Ajouter une catégorie', `
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="cat-name" type="text" class="form-input" placeholder="ex: Breuvage, Karting, Maintenance…">
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Ajouter', cls:'btn-primary', action:'submitAddCat()'}]);
}

async function submitAddCat() {
  const name = document.getElementById('cat-name')?.value?.trim();
  if(!name){ toast('Nom obligatoire','error'); return; }
  const { error } = await sb.from('categories').insert({ name });
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(`✓ Catégorie "${name}" ajoutée`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

function editCat(id, currentName) {
  openModal('Modifier la catégorie', `
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="cat-edit-name" type="text" class="form-input" value="${escHtml(currentName)}">
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Sauvegarder', cls:'btn-primary', action:`submitEditCat(${id})`}]);
}

async function submitEditCat(id) {
  const name = document.getElementById('cat-edit-name')?.value?.trim();
  if(!name){ toast('Nom obligatoire','error'); return; }
  const { error } = await sb.from('categories').update({ name }).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(`✓ Catégorie mise à jour`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

async function deleteCat(id, count) {
  if(count > 0){ toast('Impossible — des produits utilisent cette catégorie','error'); return; }
  if(!confirm('Supprimer cette catégorie ?')) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('Catégorie supprimée','success');
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

// ── SUPPLIER CRUD ─────────────────────────────────────────
function _supplierFields(s){
  s = s || {};
  return `
    <div class="form-group"><label class="form-label">Nom *</label>
      <input id="supplier-name" type="text" class="form-input" placeholder="ex: Sysco, Costco, GFS, Métro…" value="${escHtml(s.name||'')}">
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Représentant</label>
        <input id="supplier-rep" type="text" class="form-input" placeholder="Nom du contact" value="${escHtml(s.representative||'')}">
      </div>
      <div class="form-group"><label class="form-label">Téléphone</label>
        <input id="supplier-phone" type="text" class="form-input" placeholder="450-555-1234" value="${escHtml(s.phone||'')}">
      </div>
    </div>
    <div class="form-group"><label class="form-label">Courriel</label>
      <input id="supplier-email" type="email" class="form-input" placeholder="commandes@fournisseur.com" value="${escHtml(s.email||'')}">
    </div>
    <div class="form-group"><label class="form-label">Adresse</label>
      <textarea id="supplier-address" class="form-input" rows="2" placeholder="Adresse complète">${escHtml(s.address||'')}</textarea>
    </div>
    <div class="form-group"><label class="form-label">Notes</label>
      <textarea id="supplier-notes" class="form-input" rows="2" placeholder="Conditions, délai de livraison, n° de compte…">${escHtml(s.notes||'')}</textarea>
    </div>`;
}

function _readSupplierForm(){
  return {
    name:           document.getElementById('supplier-name')?.value?.trim() || '',
    representative: document.getElementById('supplier-rep')?.value?.trim() || null,
    phone:          document.getElementById('supplier-phone')?.value?.trim() || null,
    email:          document.getElementById('supplier-email')?.value?.trim() || null,
    address:        document.getElementById('supplier-address')?.value?.trim() || null,
    notes:          document.getElementById('supplier-notes')?.value?.trim() || null,
  };
}

function openAddSupplier() {
  openModal('Ajouter un fournisseur', _supplierFields(),
    [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Ajouter', cls:'btn-primary', action:'submitAddSupplier()'}]);
}

async function submitAddSupplier() {
  const vals = _readSupplierForm();
  if(!vals.name){ toast('Nom obligatoire','error'); return; }
  if(suppliers.some(s=>s.name.toLowerCase()===vals.name.toLowerCase())){ toast('Ce fournisseur existe déjà','error'); return; }
  const { error } = await sb.from('suppliers').insert(vals);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast(`✓ Fournisseur "${vals.name}" ajouté`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

function editSupplier(id) {
  const s = suppliers.find(x=>x.id===id);
  if(!s){ toast('Fournisseur introuvable','error'); return; }
  const oldName = (s.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  openModal('Modifier le fournisseur',
    _supplierFields(s) +
    `<div style="font-size:11px;color:var(--text3);margin-top:4px">Renommer le fournisseur met aussi à jour le nom sur les produits liés.</div>`,
    [{label:'Fermer',cls:'',action:'closeModal()'},{label:'Sauvegarder', cls:'btn-primary', action:`submitEditSupplier(${id},'${oldName}')`}]);
}

async function submitEditSupplier(id, oldName) {
  const vals = _readSupplierForm();
  if(!vals.name){ toast('Nom obligatoire','error'); return; }
  const { error } = await sb.from('suppliers').update(vals).eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  // Mise à jour en cascade du nom sur les produits liés
  if(oldName && oldName !== vals.name){
    await sb.from('products').update({ supplier:vals.name }).eq('supplier', oldName);
  }
  toast(`✓ Fournisseur mis à jour`,'success');
  closeModal();
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

async function deleteSupplier(id, count, name) {
  if(count > 0){ toast('Impossible — utilisé par des produits','error'); return; }
  if(!confirm(`Supprimer le fournisseur "${name}" ?`)) return;
  const { error } = await sb.from('suppliers').delete().eq('id', id);
  if(error){ toast('Erreur: '+error.message,'error'); return; }
  toast('Fournisseur supprimé','success');
  await loadAll();
  vSettings(document.getElementById('main-content'));
}

// ── ALERT THRESHOLD ───────────────────────────────────────
function saveThreshold() {
  const val = parseInt(document.getElementById('threshold-val')?.value) || 4;
  window._alertThreshold = val;
  localStorage.setItem('goplex_alert_threshold', val);
  toast(`✓ Seuil d'alerte : ${val} unités`,'success');
  updateAlerts();
}

// Load threshold on startup
window._alertThreshold = parseInt(localStorage.getItem('goplex_alert_threshold')) || 4;

async function vAuditLog(c) {
  c=c||document.getElementById('main-content');
  c.innerHTML='<div class="empty"><i class="ti ti-loader spin"></i></div>';
  const {data:logs}=await sb.from('audit_log').select('*').order('created_at',{ascending:false}).limit(200);
  const cols={receive:'green',reduce:'red',transfer:'blue',inventory:'purple',create:'amber',import:'gray'};
  c.innerHTML=`<div class="table-card">
    <div class="table-toolbar"><div class="table-toolbar-title"><i class="ti ti-list-check" style="color:var(--purple);margin-right:6px"></i>Journal d'audit (${(logs||[]).length})</div></div>
    <table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Produit</th><th>Qté</th><th>Emplacement</th><th>Réf.</th></tr></thead>
    <tbody>${(logs||[]).map(l=>`<tr>
      <td style="font-size:11px;font-family:var(--font-mono);color:var(--text3)">${l.created_at?new Date(l.created_at).toLocaleString('fr-CA'):'—'}</td>
      <td style="font-size:12px">${escHtml(l.user_email||'—')}</td>
      <td><span class="badge badge-${cols[l.action]||'gray'}">${l.action||'—'}</span></td>
      <td style="font-weight:500;font-size:12px">${escHtml(l.product_name||'—')}</td>
      <td style="font-family:var(--font-mono)">${l.quantity!=null?l.quantity:'—'}</td>
      <td style="font-size:11px;color:var(--text2)">${escHtml(l.location_from||'')}${l.location_to?' → '+escHtml(l.location_to):''}</td>
      <td class="mono">${escHtml(l.reference||'—')}</td>
    </tr>`).join('')||'<tr><td colspan="7" class="empty">Aucune entrée</td></tr>'}
    </tbody></table></div>`;
}

// ── MOBILE BOTTOM BAR ─────────────────────────────────────
const MOB_TAB_MAP = {
  dashboard:'mobtab-dashboard', receive:'mobtab-receive',
  reduce:'mobtab-reduce', inventory:'mobtab-inventory'
};

function syncMobTabs(view) {
  if(window.innerWidth > 768) return;
  document.querySelectorAll('.mob-tab').forEach(t=>t.classList.remove('active'));
  const tabId = MOB_TAB_MAP[view];
  if(tabId) document.getElementById(tabId)?.classList.add('active');
  else document.getElementById('mobtab-more')?.classList.add('active');
}

// Mobile back button
const MOB_BACK_VIEWS = ['receive','transfer','reduce','inventory','create','alerts','locations','movements','settings','users','auditlog'];
const MOB_BACK_DEST  = {receive:'dashboard',transfer:'dashboard',reduce:'dashboard',inventory:'dashboard',create:'products',alerts:'dashboard',locations:'dashboard',movements:'dashboard',settings:'dashboard',users:'dashboard',auditlog:'dashboard'};

function mobGoBack() {
  const dest = MOB_BACK_DEST[currentView] || 'dashboard';
  mobNav(dest);
}

function updateMobBackBtn(view) {
  const btn = document.getElementById('mob-back');
  if(!btn) return;
  const show = window.innerWidth <= 768 && MOB_BACK_VIEWS.includes(view);
  btn.style.display = show ? 'flex' : 'none';
}

function mobNav(view) {
  updateMobBackBtn(view);
  if(window.innerWidth <= 768 && ['transfer','reduce','inventory'].includes(view)) {
    currentView = view;
    document.getElementById('topbar-title').textContent = {
      transfer:'Transfert',
      reduce:'Réduire stock', inventory:'Faire inventaire'
    }[view];
    syncMobTabs(view);
    const c = document.getElementById('main-content');
    if(view==='transfer')  mScanTransfer(c);
    if(view==='reduce')    mScanReduce(c);
    if(view==='inventory') mScanInventory(c);
  } else {
    nav(view);
    syncMobTabs(view);
    updateMobBackBtn(view);
  }
}


// ══════════════════════════════════════════════════════════
// MOBILE SCANNER-STYLE VIEWS (style PowerScan)
// ══════════════════════════════════════════════════════════

function mScanUI(opts) {
  const locs = locations.filter(l=>l.usage==='internal');
  const c = document.getElementById('main-content');
  const colorMap = {green:'var(--green)',blue:'var(--blue)',red:'var(--red)',purple:'var(--purple)'};
  const col = opts.color;
  c.innerHTML = `
  <div id="ms-wrap" style="display:flex;flex-direction:column;gap:12px">
    <div style="background:var(--bg1);border:2px solid var(--${col});border-radius:16px;padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--${col});font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="ti ti-barcode"></i>Scanner ou rechercher</div>
      <input id="ms-scan" style="width:100%;height:52px;background:var(--bg2);border:1.5px solid var(--border);border-radius:12px;padding:0 14px;color:var(--text1);font-size:16px;font-family:var(--font-mono);outline:none;-webkit-appearance:none" type="text" placeholder="Code-barres, référence ou nom…" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text" oninput="msScanSearch('${opts.prefix}')" onkeydown="if(event.key==='Enter'){event.preventDefault();msScanConfirm('${opts.prefix}');}">
      <div id="ms-scan-results" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
      <div id="ms-not-found" style="background:var(--red-dim);border:1px solid rgba(245,69,92,.3);border-radius:10px;padding:12px;font-size:13px;color:var(--red);display:none;margin-top:8px">Produit introuvable</div>
    </div>
    <div id="ms-product-card" style="display:none;background:var(--bg1);border:1px solid var(--${col});border-radius:16px;padding:16px">
      <div id="ms-prod-name" style="font-size:18px;font-weight:700;margin-bottom:4px">—</div>
      <div id="ms-prod-sub" style="font-size:12px;color:var(--text3);margin-bottom:12px">—</div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Stock actuel</div><div id="ms-prod-qty" style="font-size:28px;font-weight:800;font-family:var(--font-mono)">—</div></div>
        <span class="badge" id="ms-prod-badge">—</span>
      </div>
      ${opts.extraFields||''}
    </div>
    <div id="ms-qty-zone" style="display:none;background:var(--bg1);border:1px solid var(--border);border-radius:16px;padding:16px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;font-weight:500">${opts.qtyLabel||'Quantité'}</div>
      <input id="ms-qty" style="width:100%;height:64px;background:var(--bg2);border:2px solid var(--border);border-radius:12px;font-size:32px;font-family:var(--font-mono);font-weight:700;text-align:center;color:var(--text1);outline:none;-webkit-appearance:none" type="number" inputmode="numeric" min="1" step="1" placeholder="0" oninput="msCheckReady('${opts.prefix}')" onkeydown="if(event.key==='Enter'){event.preventDefault();msSubmit('${opts.prefix}');}">
    </div>
    <button id="ms-confirm-btn" onclick="msSubmit('${opts.prefix}')" style="width:100%;height:56px;background:var(--${col==='green'?'green':col==='red'?'red':col==='blue'?'blue':'purple'});border:none;border-radius:14px;color:${col==='amber'?'#000':'#fff'};font-size:18px;font-weight:700;font-family:var(--font-head);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;opacity:.4;pointer-events:none;transition:all .2s">
      <i class="ti ti-check" style="font-size:22px"></i>${opts.confirmLabel||'Confirmer'}
    </button>
    <div id="ms-history-wrap" style="display:none">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Session en cours</div>
      <div id="ms-history" style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;overflow-y:auto;max-height:340px"></div>
    </div>
  </div>`;
  window._msCtx={prefix:opts.prefix,selectedProduct:null,sessionItems:[],locs};
  setTimeout(()=>document.getElementById('ms-scan')?.focus(),150);
}

function msScanSearch(prefix){
  const input=document.getElementById('ms-scan');
  const resultsEl=document.getElementById('ms-scan-results');
  if(!input||!resultsEl)return;
  document.getElementById('ms-not-found')?.style&&(document.getElementById('ms-not-found').style.display='none');
  const q=input.value.trim().toLowerCase();
  if(!q){resultsEl.innerHTML='';return;}
  const matches=products.filter(p=>(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q||(p.barcode||'').toLowerCase().startsWith(q)||(p.reference||'').toLowerCase().startsWith(q)||(p.name||'').toLowerCase().includes(q)).slice(0,6);
  if(!matches.length){resultsEl.innerHTML='';return;}
  resultsEl.innerHTML=matches.map(p=>{const qty=getQty(p.id),s=getStatus(qty,p.id);const exact=(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q;return`<div onclick="msSelectProduct(${p.id})" style="display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--bg${exact?'1':'2'});border:1.5px solid var(--${exact?'blue':'border'});border-radius:10px;cursor:pointer"><i class="ti ti-${exact?'circle-check':'package'}" style="color:var(--${exact?'blue':'text3'});font-size:18px;flex-shrink:0"></i><div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:${exact?700:500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</div><div style="font-size:11px;color:var(--text3)">${p.reference||p.barcode||''}</div></div><div style="text-align:right;flex-shrink:0"><div style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--${s.color==='green'?'green':s.color==='amber'?'amber':'red'})">${Math.round(qty)}</div><span class="badge badge-${s.color}" style="font-size:9px">${s.label}</span></div></div>`;}).join('');
}

function msScanConfirm(prefix){
  const input=document.getElementById('ms-scan');if(!input)return;
  const q=input.value.trim().toLowerCase();if(!q)return;
  let found=products.find(p=>(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q);
  if(!found)found=products.find(p=>(p.name||'').toLowerCase().includes(q));
  if(found)msSelectProduct(found.id);
  else{const nf=document.getElementById('ms-not-found');if(nf)nf.style.display='';document.getElementById('ms-scan-results').innerHTML='';}
}

function msSelectProduct(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  const qty=getQty(id),s=getStatus(qty,id);
  if(window._msCtx)window._msCtx.selectedProduct=p;
  const scanInput=document.getElementById('ms-scan');
  if(scanInput)scanInput.value='';
  document.getElementById('ms-scan-results').innerHTML='';
  const nf=document.getElementById('ms-not-found');if(nf)nf.style.display='none';
  document.getElementById('ms-prod-name').textContent=p.name;
  document.getElementById('ms-prod-sub').textContent=[p.reference?'REF: '+p.reference:'',p.barcode?'CB: '+p.barcode:'',categories.find(c=>c.id===p.category_id)?.name||''].filter(Boolean).join(' · ');

  // Si on est en mode inventaire avec emplacement, afficher qty de CET emplacement
  const locId = window._msCtx?.prefix==='inv' ? window._msCtx?.locId : null;
  const locQty = locId
    ? (stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty||0)
    : qty;

  const qtyEl=document.getElementById('ms-prod-qty');
  if(qtyEl) qtyEl.textContent=Math.round(locQty);

  // Label emplacement
  const locLabelEl=document.getElementById('ms-loc-label');
  if(locLabelEl) locLabelEl.textContent=window._msCtx?.locName||'—';

  // Total tous emplacements
  const totalEl=document.getElementById('ms-prod-total');
  if(totalEl) totalEl.textContent=Math.round(qty);

  const badge=document.getElementById('ms-prod-badge');
  // Status basé sur la qty de l'emplacement
  const sLoc = locId ? getStatus(locQty, id) : s;
  badge.textContent=sLoc.label;badge.className='badge badge-'+sLoc.color;
  document.getElementById('ms-product-card').style.display='';
  document.getElementById('ms-qty-zone').style.display='';
  const qtyInput=document.getElementById('ms-qty');
  if(qtyInput){qtyInput.value='';qtyInput.focus();qtyInput.select();}

  // Pré-sélection de l'emplacement par défaut = celui où le produit a le plus de stock
  const best = [...(stockMap[p.id]?.byLocation||[])].sort((a,b)=>b.qty-a.qty)[0];
  if(best && best.locId){
    const selId = {recv:'ms-recv-loc', red:'ms-red-loc', tf:'ms-tf-from'}[window._msCtx?.prefix];
    if(selId){
      const sel = document.getElementById(selId);
      if(sel && [...sel.options].some(o=>o.value===String(best.locId))) sel.value = String(best.locId);
    }
  }

  msCheckReady(window._msCtx?.prefix);
  if(navigator.vibrate)navigator.vibrate(40);
}

async function msSubmit(prefix){
  const p=window._msCtx?.selectedProduct;if(!p)return;
  const qty=parseFloat(document.getElementById('ms-qty')?.value||0);
  if(!qty||qty<=0){toast('Quantité requise','error');return;}
  const btn=document.getElementById('ms-confirm-btn');
  btn.style.opacity='0.4';btn.style.pointerEvents='none';btn.innerHTML='<i class="ti ti-loader spin" style="font-size:20px"></i>';
  try{
    if(prefix==='recv'){
      const locId=parseInt(document.getElementById('ms-recv-loc').value);
      if(!locId){toast('Choisir un emplacement','error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';return;}
      const existing=stockMap[p.id]?.byLocation?.find(b=>b.locId===locId);
      const newQty=(existing?.qty||0)+qty;
      await sb.from('stock').upsert({product_id:p.id,location_id:locId,quantity:newQty},{onConflict:'product_id,location_id'});
      await sb.from('movements').insert({product_id:p.id,location_to:locId,quantity:qty,movement_type:'receive',user_id:user.id,user_email:profile?.email});
      await logAction('receive',{product_id:p.id,product_name:p.name,quantity:qty});
    }else if(prefix==='red'){
      const locId=parseInt(document.getElementById('ms-red-loc').value);
      if(!locId){toast('Choisir un emplacement','error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';return;}
      const cur=stockMap[p.id]?.byLocation?.find(b=>b.locId===locId)?.qty||0;
      if(qty>cur){toast(`Stock insuffisant (${Math.round(cur)} dispo)`,'error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';return;}
      const note=document.getElementById('ms-red-note')?.value?.trim()||null;
      await sb.from('stock').upsert({product_id:p.id,location_id:locId,quantity:cur-qty},{onConflict:'product_id,location_id'});
      await sb.from('movements').insert({product_id:p.id,location_from:locId,quantity:qty,movement_type:'reduce',notes:note,user_id:user.id,user_email:profile?.email});
      await logAction('reduce',{product_id:p.id,product_name:p.name,quantity:qty});
    }else if(prefix==='tf'){
      const fromId=parseInt(document.getElementById('ms-tf-from').value);
      const toId=parseInt(document.getElementById('ms-tf-to').value);
      if(!fromId||!toId){toast('Choisir les emplacements','error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';return;}
      const cur=stockMap[p.id]?.byLocation?.find(b=>b.locId===fromId)?.qty||0;
      if(qty>cur){toast(`Stock insuffisant (${Math.round(cur)} dispo)`,'error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';return;}
      const dstCur=stockMap[p.id]?.byLocation?.find(b=>b.locId===toId)?.qty||0;
      const note=document.getElementById('ms-tf-note')?.value?.trim()||null;
      await sb.from('stock').upsert({product_id:p.id,location_id:fromId,quantity:cur-qty},{onConflict:'product_id,location_id'});
      await sb.from('stock').upsert({product_id:p.id,location_id:toId,quantity:dstCur+qty},{onConflict:'product_id,location_id'});
      await sb.from('movements').insert({product_id:p.id,location_from:fromId,location_to:toId,quantity:qty,movement_type:'transfer',notes:note,user_id:user.id,user_email:profile?.email});
      await logAction('transfer',{product_id:p.id,product_name:p.name,quantity:qty});
    }
    await loadAll();
    const si=window._msCtx.sessionItems;si.unshift({name:p.name,qty,prefix});
    const hw=document.getElementById('ms-history-wrap');const he=document.getElementById('ms-history');
    if(he&&hw){hw.style.display='';he.innerHTML=si.map(item=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px"><i class="ti ti-check" style="color:var(--green);flex-shrink:0"></i><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.name)}</span><span style="font-family:var(--font-mono);font-weight:700;color:var(--green);flex-shrink:0">+${item.qty}</span></div>`).join('');}
    if(navigator.vibrate)navigator.vibrate([40,20,40]);
    toast(`✓ ${p.name} — ${qty} unités`,'success');
    const pc=document.getElementById('ms-product-card');if(pc)pc.style.display='none';
    const qz=document.getElementById('ms-qty-zone');if(qz)qz.style.display='none';
    window._msCtx.selectedProduct=null;
    const btn2=document.getElementById('ms-confirm-btn');
    if(btn2){btn2.style.opacity='0.4';btn2.style.pointerEvents='none';btn2.innerHTML=`<i class="ti ti-check" style="font-size:22px"></i>${{recv:'Réceptionner',red:'Retirer du stock',tf:'Transférer'}[prefix]}`;}
    setTimeout(()=>document.getElementById('ms-scan')?.focus(),100);
  }catch(e){toast('Erreur: '+e.message,'error');btn.style.opacity='1';btn.style.pointerEvents='auto';btn.innerHTML='<i class="ti ti-check" style="font-size:22px"></i>Confirmer';}
}

function mScanReceive(c){
  const locs=locations.filter(l=>l.usage==='internal');
  mScanUI({prefix:'recv',color:'green',confirmLabel:'Réceptionner',qtyLabel:'Quantité reçue',
    extraFields:`<div><div style="font-size:12px;color:var(--text3);margin-bottom:6px">Emplacement destination *</div><select id="ms-recv-loc" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:15px;font-family:var(--font-head);outline:none" onchange="msCheckReady('recv')"><option value="">— Emplacement —</option>${locs.map(l=>`<option value="${l.id}">${escHtml(l.full_path||l.name)}</option>`).join('')}</select></div>`
  });
}

function mScanReduce(c){
  const locs=locations.filter(l=>l.usage==='internal');
  mScanUI({prefix:'red',color:'red',confirmLabel:'Retirer du stock',qtyLabel:'Quantité à retirer',
    extraFields:`
      <div style="margin-bottom:10px"><div style="font-size:12px;color:var(--text3);margin-bottom:6px">Emplacement source *</div><select id="ms-red-loc" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:15px;font-family:var(--font-head);outline:none" onchange="msCheckReady('red')"><option value="">— Emplacement —</option>${locs.map(l=>`<option value="${l.id}">${escHtml(l.full_path||l.name)}</option>`).join('')}</select></div>
      <div><div style="font-size:12px;color:var(--text3);margin-bottom:6px">Notes</div><textarea id="ms-red-note" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:14px;font-family:var(--font-head);outline:none;resize:none;min-height:60px" placeholder="Détails, numéro de commande…"></textarea></div>`
  });
}

function mScanTransfer(c){
  const locs=locations.filter(l=>l.usage==='internal');
  mScanUI({prefix:'tf',color:'blue',confirmLabel:'Transférer',qtyLabel:'Quantité à transférer',
    extraFields:`
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px"><div style="flex:1"><div style="font-size:12px;color:var(--text3);margin-bottom:6px">De *</div><select id="ms-tf-from" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:14px;font-family:var(--font-head);outline:none" onchange="msCheckReady('tf')"><option value="">— Source —</option>${locs.map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}</select></div><i class="ti ti-arrow-right" style="color:var(--blue);font-size:20px;flex-shrink:0;margin-top:18px"></i><div style="flex:1"><div style="font-size:12px;color:var(--text3);margin-bottom:6px">Vers *</div><select id="ms-tf-to" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:14px;font-family:var(--font-head);outline:none" onchange="msCheckReady('tf')"><option value="">— Dest. —</option>${locs.map(l=>`<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}</select></div></div>
      <div><div style="font-size:12px;color:var(--text3);margin-bottom:6px">Notes</div><textarea id="ms-tf-note" style="width:100%;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;padding:11px 12px;color:var(--text1);font-size:14px;font-family:var(--font-head);outline:none;resize:none;min-height:60px" placeholder="Raison du transfert…"></textarea></div>`
  });
}

function mScanInventory(c){
  // ── ÉTAPE 1 : sélection de l'emplacement ─────────────────
  const mc = document.getElementById('main-content');
  const internalLocs = locations.filter(l=>l.usage==='internal');

  mc.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:14px">
    <!-- Header -->
    <div style="background:var(--bg1);border:1px solid var(--border);border-radius:14px;padding:18px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
        <div style="width:42px;height:42px;background:#1e1b4b;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--purple)"><i class="ti ti-clipboard-list"></i></div>
        <div>
          <div style="font-size:16px;font-weight:700">Faire l'inventaire</div>
          <div style="font-size:12px;color:var(--text3)">Choisissez un emplacement à compter</div>
        </div>
      </div>
    </div>

    <!-- Sélection emplacement -->
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;padding:0 4px">Emplacement à inventorier</div>

    ${internalLocs.length ? internalLocs.map(l => {
      const locProds = Object.entries(stockMap)
        .filter(([pid, sm]) => sm.byLocation.some(b => b.locId===l.id && b.qty>0));
      const totalQty = stockMap ? Object.values(stockMap)
        .reduce((s, sm) => s + (sm.byLocation.find(b=>b.locId===l.id)?.qty||0), 0) : 0;
      const refCount = locProds.length;
      return `<div onclick="mStartInventoryAtLoc(${l.id},'${escHtml(l.name)}')"
        style="background:var(--bg1);border:1px solid var(--border);border-radius:14px;padding:16px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:border-color .15s"
        onmouseover="this.style.borderColor='var(--purple)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="width:46px;height:46px;background:#1e1b4b;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--purple);flex-shrink:0"><i class="ti ti-map-pin"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l.name)}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">${refCount} référence${refCount!==1?'s':''} · ${Math.round(totalQty)} unités</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:22px;font-weight:800;font-family:var(--font-mono);color:var(--purple)">${Math.round(totalQty)}</div>
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">unités</div>
        </div>
        <i class="ti ti-chevron-right" style="color:var(--text3);font-size:18px"></i>
      </div>`;
    }).join('') : '<div class="empty">Aucun emplacement interne</div>'}
  </div>`;

  window._msCtx = {prefix:'inv', selectedProduct:null, sessionItems:[], invMap:{}, locId:null, locName:''};
}

function mStartInventoryAtLoc(locId, locName) {
  // ── ÉTAPE 2 : scan des produits pour cet emplacement ────
  window._msCtx = {prefix:'inv', selectedProduct:null, sessionItems:[], invMap:{}, locId, locName};

  // Produits qui ont du stock dans cet emplacement
  const locProds = products.filter(p =>
    (stockMap[p.id]?.byLocation||[]).some(b=>b.locId===locId && b.qty>0)
  );
  const totalQty = Object.values(stockMap)
    .reduce((s,sm) => s+(sm.byLocation.find(b=>b.locId===locId)?.qty||0), 0);

  const mc = document.getElementById('main-content');
  mc.innerHTML = `
  <div style="display:flex;flex-direction:column;gap:12px">

    <!-- Topbar emplacement -->
    <div style="background:var(--bg1);border:1px solid var(--purple);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px">
      <button onclick="mScanInventory()" style="width:34px;height:34px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ti-arrow-left" style="font-size:16px"></i>
      </button>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><i class="ti ti-map-pin" style="color:var(--purple);margin-right:6px"></i>${escHtml(locName)}</div>
        <div style="font-size:11px;color:var(--text3)">${locProds.length} référence${locProds.length!==1?'s':''} · ${Math.round(totalQty)} unités en base</div>
      </div>
      <button onclick="msScanInvSubmit()" style="height:34px;padding:0 12px;background:var(--purple);border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-head);flex-shrink:0">
        <i class="ti ti-check"></i> ${profile?.role==='operation'?'Soumettre':'Valider'}
      </button>
    </div>

    <!-- Zone scan -->
    <div style="background:var(--bg1);border:2px solid var(--purple);border-radius:16px;padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--purple);font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="ti ti-barcode"></i>Scanner ou rechercher</div>
      <input id="ms-scan" style="width:100%;height:52px;background:var(--bg2);border:1.5px solid var(--border);border-radius:12px;padding:0 14px;color:var(--text1);font-size:16px;font-family:var(--font-mono);outline:none" type="text" placeholder="Code-barres, référence ou nom…" autocomplete="off" inputmode="text" oninput="msScanSearch('inv')" onkeydown="if(event.key==='Enter'){event.preventDefault();msScanConfirm('inv');}">
      <div id="ms-scan-results" style="margin-top:8px;display:flex;flex-direction:column;gap:4px"></div>
      <div id="ms-not-found" style="background:var(--red-dim);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px;font-size:13px;color:var(--red);display:none;margin-top:8px">Produit introuvable</div>
    </div>

    <!-- Produit sélectionné -->
    <div id="ms-product-card" style="display:none;background:var(--bg1);border:1px solid var(--purple);border-radius:16px;padding:16px">
      <div id="ms-prod-name" style="font-size:18px;font-weight:700;margin-bottom:4px">—</div>
      <div id="ms-prod-sub" style="font-size:12px;color:var(--text3);margin-bottom:12px">—</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px">
        <div style="background:var(--bg2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Dans <span id="ms-loc-label" style="color:var(--purple)">—</span></div>
          <div id="ms-prod-qty" style="font-size:28px;font-weight:800;font-family:var(--font-mono)">—</div>
        </div>
        <div style="background:var(--bg2);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Total tous empl.</div>
          <div id="ms-prod-total" style="font-size:28px;font-weight:800;font-family:var(--font-mono);color:var(--text2)">—</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0">
        <span class="badge" id="ms-prod-badge">—</span>
        <div id="ms-inv-diff" style="font-size:14px;font-family:var(--font-mono);font-weight:700"></div>
      </div>
    </div>

    <!-- Quantité -->
    <div id="ms-qty-zone" style="display:none;background:var(--bg1);border:1px solid var(--border);border-radius:16px;padding:16px">
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px;font-weight:500">Quantité comptée dans <strong style="color:var(--purple)">${escHtml(locName)}</strong></div>
      <input id="ms-qty" style="width:100%;height:64px;background:var(--bg2);border:2px solid var(--border);border-radius:12px;font-size:32px;font-family:var(--font-mono);font-weight:700;text-align:center;color:var(--text1);outline:none;-webkit-appearance:none" type="number" inputmode="numeric" min="0" step="1" placeholder="0" oninput="msInvDiff();msCheckReady('inv')" onkeydown="if(event.key==='Enter'){event.preventDefault();msInvAdd();}">
    </div>

    <!-- Bouton confirmer -->
    <button id="ms-confirm-btn" onclick="msInvAdd()" style="width:100%;height:56px;background:var(--purple);border:none;border-radius:14px;color:#fff;font-size:18px;font-weight:700;font-family:var(--font-head);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;opacity:.4;pointer-events:none;transition:all .2s">
      <i class="ti ti-plus" style="font-size:22px"></i>Enregistrer
    </button>

    <!-- Historique session -->
    <div id="ms-history-wrap" style="display:none">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px">Comptés cette session</div>
      <div id="ms-history" style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;overflow-y:auto;max-height:340px"></div>
    </div>

  </div>`;

  setTimeout(()=>document.getElementById('ms-scan')?.focus(), 150);
}

function msInvDiff(){
  const p=window._msCtx?.selectedProduct; if(!p) return;
  const locId=window._msCtx?.locId;
  const counted=parseFloat(document.getElementById('ms-qty')?.value||'');
  const diffEl=document.getElementById('ms-inv-diff'); if(!diffEl||isNaN(counted)) return;
  // Diff vs qty dans CET emplacement
  const locQty = locId
    ? (stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty||0)
    : getQty(p.id);
  const diff=counted-locQty;
  diffEl.textContent=(diff>=0?'+':'')+Math.round(diff);
  diffEl.style.color=diff>0?'var(--green)':diff<0?'var(--red)':'var(--text3)';
}

function msCheckReady(prefix){
  const qty=parseFloat(document.getElementById('ms-qty')?.value||0);
  const btn=document.getElementById('ms-confirm-btn');if(!btn)return;
  let ready=!!window._msCtx?.selectedProduct&&qty>=0&&document.getElementById('ms-qty')?.value!=='';
  if(prefix==='tf'){const f=document.getElementById('ms-tf-from')?.value;const t=document.getElementById('ms-tf-to')?.value;ready=ready&&qty>0&&!!f&&!!t&&f!==t;}
  else if(prefix==='recv')ready=ready&&qty>0&&!!document.getElementById('ms-recv-loc')?.value;
  else if(prefix==='red')ready=ready&&qty>0&&!!document.getElementById('ms-red-loc')?.value;
  btn.style.opacity=ready?'1':'0.4';btn.style.pointerEvents=ready?'auto':'none';
}

async function msInvAdd(){
  const p=window._msCtx?.selectedProduct;if(!p)return;
  const counted=parseFloat(document.getElementById('ms-qty')?.value||'');
  if(isNaN(counted)||counted<0){toast('Quantité invalide','error');return;}
  const locId=window._msCtx?.locId;
  const locQty=locId?(stockMap[p.id]?.byLocation.find(b=>b.locId===locId)?.qty||0):getQty(p.id);
  window._msCtx.invMap[p.id]={counted, locId};
  window._msCtx.sessionItems.unshift({name:p.name,counted,before:Math.round(locQty)});
  const hw=document.getElementById('ms-history-wrap');const he=document.getElementById('ms-history');
  if(he&&hw){hw.style.display='';he.innerHTML=window._msCtx.sessionItems.slice(0,8).map(item=>{
    const diff=item.counted-item.before;
    return`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px">
      <i class="ti ti-package" style="color:var(--text3);flex-shrink:0"></i>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.name)}</span>
      <span style="font-family:var(--font-mono);color:var(--text2);margin-right:8px">${item.counted}</span>
      <span style="font-family:var(--font-mono);font-weight:700;color:var(--${diff>0?'green':diff<0?'red':'text3'});flex-shrink:0">${diff>=0?'+':''}${diff}</span>
    </div>`;}).join('');}
  if(navigator.vibrate)navigator.vibrate([40,20,40]);
  toast(`✓ ${p.name}: ${counted}`,'success');
  document.getElementById('ms-product-card').style.display='none';
  document.getElementById('ms-qty-zone').style.display='none';
  if(document.getElementById('ms-inv-diff'))document.getElementById('ms-inv-diff').textContent='';
  window._msCtx.selectedProduct=null;
  const btn=document.getElementById('ms-confirm-btn');
  btn.style.opacity='0.4';btn.style.pointerEvents='none';
  setTimeout(()=>document.getElementById('ms-scan')?.focus(),100);
}

async function msScanInvSubmit(){
  const invMap=window._msCtx?.invMap||{};
  const locId=window._msCtx?.locId;
  const locName=window._msCtx?.locName||'—';
  const keys=Object.keys(invMap);
  if(!keys.length){toast('Aucun produit compté','error');return;}

  // Rôle operation → soumettre pour validation manager/admin
  if(profile?.role==='operation'){
    const ok = await submitPendingInventory(invMap, locId, locName);
    if(ok){
      toast(`✓ Inventaire soumis — en attente de validation`,'success');
      mScanInventory(document.getElementById('main-content'));
    }
    return;
  }

  // Manager / admin → appliquer directement
  let updates=0, skipped=0;
  for(const pid of keys){
    const {counted}=invMap[pid];
    const id=parseInt(pid);
    if(!locId) continue;
    const currentLocQty=stockMap[id]?.byLocation.find(b=>b.locId===locId)?.qty||0;
    const diff=counted-currentLocQty;
    if(diff===0){skipped++;continue;}
    const newQty=Math.max(0,counted);
    await sb.from('stock').upsert({product_id:id,location_id:locId,quantity:newQty},{onConflict:'product_id,location_id'});
    await sb.from('movements').insert({product_id:id,location_from:diff<0?locId:null,location_to:diff>0?locId:null,quantity:Math.abs(diff),movement_type:'inventory',user_id:user.id,user_email:profile?.email});
    updates++;
  }
  await logAction('inventory',{notes:`${updates} ajustements, ${skipped} inchangés`});
  toast(`✓ ${updates} ajustement${updates>1?'s':''} — ${skipped} inchangé${skipped>1?'s':''}`, 'success');
  await loadAll();
  mScanInventory(document.getElementById('main-content'));
}


function openMoreSheet() {
  document.getElementById('more-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('more-sheet').classList.add('show'), 10);
  const isAdmin     = profile?.role === 'admin';
  const canAdmin    = isAdmin || profile?.role === 'manager';
  const adminTitle = document.getElementById('more-admin-title');
  if(adminTitle) adminTitle.style.display = canAdmin ? '' : 'none';
  document.getElementById('more-settings').style.display    = isAdmin ? '' : 'none';
  document.getElementById('more-users').style.display       = isAdmin ? '' : 'none';
  const alertCnt = products.filter(p=>p.alert_enabled!==false&&getQty(p.id)<=(p.alert_threshold??window._alertThreshold??4)).length;
  document.getElementById('more-alerts-sub').textContent = alertCnt > 0 ? `${alertCnt} article(s) en alerte` : 'Aucune alerte';
  document.getElementById('more-user-email').textContent = profile?.email || '—';
}

function closeMoreSheet() {
  document.getElementById('more-sheet').classList.remove('show');
  document.getElementById('more-overlay').classList.remove('show');
}

// Swipe down to close more sheet
(function(){
  let startY = 0, isDragging = false;
  const sheet = document.getElementById('more-sheet');
  sheet.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    isDragging = true;
  }, {passive:true});
  sheet.addEventListener('touchmove', e => {
    if(!isDragging) return;
    const dy = e.touches[0].clientY - startY;
    if(dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, {passive:true});
  sheet.addEventListener('touchend', e => {
    if(!isDragging) return;
    isDragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    if(dy > 80) {
      closeMoreSheet();
    }
    sheet.style.transform = '';
  }, {passive:true});
})();


// ══════════════════════════════════════════════════════════
// INVENTAIRES EN ATTENTE
// ══════════════════════════════════════════════════════════
let pendingInventories = [];

async function loadPendingInventories() {
  const {data} = await sb.from('pending_inventories')
    .select('*').eq('status','pending').order('created_at',{ascending:false});
  pendingInventories = data || [];
  updatePendingBadge();
}

function updatePendingBadge() {
  const cnt = pendingInventories.length;
  const badge = document.getElementById('pending-inv-badge');
  if(badge){ badge.textContent=cnt; badge.classList.toggle('hidden', cnt===0); }
}

// Soumission inventaire en attente (rôle operation)
async function submitPendingInventory(invMap, locId, locName) {
  const items = Object.entries(invMap).map(([pid,data]) => {
    const p = products.find(x=>x.id===parseInt(pid));
    return {
      product_id:   parseInt(pid),
      product_name: p?.name||'—',
      counted:      data.counted,
      current:      Math.round(getQty(parseInt(pid))),
      loc_qty:      data.counted, // qty in that location
      diff:         data.counted - Math.round(getQty(parseInt(pid))),
    };
  });

  const {error} = await sb.from('pending_inventories').insert({
    created_by:    user.id,
    created_email: profile?.email,
    created_name:  profile?.full_name || profile?.email,
    location_id:   locId,
    location_name: locName,
    items:         JSON.stringify(items),
    status:        'pending',
  });

  if(error){ toast('Erreur soumission: '+error.message,'error'); return false; }
  await loadPendingInventories();
  return true;
}

// Vue de validation des inventaires en attente
function pendingInventoriesListHTML(){
  const all = pendingInventories;
  if(!all.length) return `<div style="background:var(--bg2);border:1px dashed var(--border2);border-radius:10px;padding:18px;text-align:center;font-size:13px;color:var(--text3)"><i class="ti ti-checks" style="color:var(--green);margin-right:6px"></i>Aucun inventaire en attente de confirmation</div>`;
  return all.map(inv => {
    const items = typeof inv.items==='string' ? JSON.parse(inv.items) : (inv.items||[]);
    const hasChanges = items.filter(i=>i.diff!==0);
    return `<div class="table-card" style="margin-bottom:16px">
      <div class="table-toolbar">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px">
            <i class="ti ti-clipboard-list" style="color:var(--purple)"></i>
            Emplacement : <strong>${escHtml(inv.location_name||'—')}</strong>
          </div>
          <div style="font-size:12px;color:var(--text3);margin-top:3px">
            Soumis par <strong style="color:var(--text2)">${escHtml(inv.created_name||inv.created_email||'—')}</strong>
            · ${fmtDate(inv.created_at)}
            · ${items.length} produit${items.length>1?'s':''}
            · ${hasChanges.length} modification${hasChanges.length>1?'s':''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-danger" onclick="rejectInventory('${inv.id}')"><i class="ti ti-x"></i> Rejeter</button>
          <button class="btn btn-success" onclick="approveInventory('${inv.id}')"><i class="ti ti-check"></i> Approuver & Appliquer</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Produit</th><th style="text-align:center">Stock actuel</th><th style="text-align:center">Compté</th><th style="text-align:center">Différence</th></tr></thead>
        <tbody>
          ${items.map(item => {
            const diff = item.diff || 0;
            const rowBg = diff<0?'rgba(242,86,104,.06)':diff>0?'rgba(52,211,104,.06)':'';
            return `<tr style="background:${rowBg}">
              <td style="font-weight:500">${escHtml(item.product_name||'—')}</td>
              <td style="text-align:center;font-family:var(--font-mono)">${item.current}</td>
              <td style="text-align:center;font-family:var(--font-mono);font-weight:600">${item.counted}</td>
              <td style="text-align:center;font-family:var(--font-mono);font-weight:700;color:var(--${diff>0?'green':diff<0?'red':'text3'})">
                ${diff===0?'—':(diff>0?'+':'')+diff}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('');
}
async function vPendingInventories(c) {
  c = c || document.getElementById('main-content');
  c.innerHTML = '<div class="empty"><i class="ti ti-loader spin"></i></div>';
  await loadPendingInventories();
  c.innerHTML = `<div style="margin-bottom:16px;font-size:14px;font-weight:600">${pendingInventories.length} inventaire${pendingInventories.length>1?'s':''} en attente de validation</div>` + pendingInventoriesListHTML();
}

async function approveInventory(invId) {
  const inv = pendingInventories.find(x=>x.id===invId); if(!inv) return;
  const items = typeof inv.items==='string' ? JSON.parse(inv.items) : (inv.items||[]);
  const locId = inv.location_id;
  if(!locId){ toast('Emplacement manquant','error'); return; }

  let updates=0, skipped=0;
  for(const item of items){
    const diff = item.counted - item.current;
    if(diff===0){ skipped++; continue; }
    const newQty = Math.max(0, item.counted);
    await sb.from('stock').upsert(
      {product_id:item.product_id, location_id:locId, quantity:newQty},
      {onConflict:'product_id,location_id'}
    );
    await sb.from('movements').insert({
      product_id:    item.product_id,
      location_from: diff<0 ? locId : null,
      location_to:   diff>0 ? locId : null,
      quantity:      Math.abs(diff),
      movement_type: 'inventory',
      user_id:       user.id,
      user_email:    profile?.email,
      notes:         `Approuvé par ${profile?.full_name||profile?.email}`,
    });
    updates++;
  }

  await sb.from('pending_inventories').update({
    status:        'approved',
    reviewed_by:   user.id,
    reviewed_email:profile?.email,
    reviewed_at:   new Date().toISOString(),
  }).eq('id', invId);

  await logAction('inventory',{notes:`${updates} ajustements approuvés (emplacement: ${inv.location_name})`});
  toast(`✓ Inventaire approuvé — ${updates} ajustement${updates>1?'s':''}`, 'success');
  await loadAll();
  renderView(currentView);
}

async function rejectInventory(invId) {
  const inv = pendingInventories.find(x=>x.id===invId); if(!inv) return;
  openModal('Rejeter cet inventaire ?', `
    <div style="background:var(--red-dim);border:1px solid rgba(242,86,104,.3);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-size:13px;color:var(--text2)">
        L'inventaire soumis par <strong style="color:var(--text1)">${escHtml(inv.created_name||inv.created_email)}</strong>
        pour <strong style="color:var(--text1)">${escHtml(inv.location_name)}</strong> sera supprimé sans être appliqué.
      </div>
    </div>
    <div class="form-group"><label class="form-label">Raison (optionnel)</label>
      <input id="reject-reason" type="text" class="form-input" placeholder="ex: erreurs de comptage, à refaire…">
    </div>
  `, [
    {label:'Annuler', cls:'', action:'closeModal()'},
    {label:'<i class="ti ti-x"></i> Rejeter', cls:'btn-danger', action:`submitRejectInventory('${invId}')`},
  ]);
}

async function submitRejectInventory(invId) {
  const reason = document.getElementById('reject-reason')?.value?.trim();
  await sb.from('pending_inventories').update({
    status:        'rejected',
    reviewed_by:   user.id,
    reviewed_email:profile?.email,
    reviewed_at:   new Date().toISOString(),
    notes:         reason||null,
  }).eq('id', invId);
  toast('Inventaire rejeté','info');
  closeModal();
  await loadPendingInventories();
  renderView(currentView);
}


// ══ RETRAITS EMPLOYÉ — approbation (admin/manager) ══════════
let pendingWithdrawals = [];

async function loadPendingWithdrawals() {
  const {data} = await sb.from('pending_withdrawals')
    .select('*').eq('status','pending').order('created_at',{ascending:false});
  pendingWithdrawals = data || [];
  updateWithdrawBadge();
}
function updateWithdrawBadge() {
  const cnt = pendingWithdrawals.length;
  const badge = document.getElementById('pending-wd-badge');
  if(badge){ badge.textContent=cnt; badge.classList.toggle('hidden', cnt===0); }
}

function pendingWithdrawalsListHTML(){
  const all = pendingWithdrawals;
  const internalLocs = locations.filter(l=>l.usage==='internal');
  if(!all.length) return `<div style="background:var(--bg2);border:1px dashed var(--border2);border-radius:10px;padding:18px;text-align:center;font-size:13px;color:var(--text3)"><i class="ti ti-checks" style="color:var(--green);margin-right:6px"></i>Aucun retrait en attente de confirmation</div>`;
  return all.map(wd => {
    const items = typeof wd.items==='string' ? JSON.parse(wd.items) : (wd.items||[]);
    let defLoc = internalLocs[0]?.id;
    const first = items[0];
    if(first){
      const byLoc = stockMap[first.product_id]?.byLocation||[];
      const best = [...byLoc].sort((a,b)=>b.qty-a.qty)[0];
      if(best) defLoc = best.locId;
    }
    return `<div class="table-card" style="margin-bottom:16px">
      <div class="table-toolbar">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px">
            <i class="ti ti-user" style="color:var(--purple)"></i>
            Employé : <strong>${escHtml(wd.username)}</strong>
          </div>
          <div style="font-size:12px;color:var(--text3);margin-top:3px">
            ${fmtDate(wd.created_at)} · ${items.length} produit${items.length>1?'s':''}${wd.notes?` · « ${escHtml(wd.notes)} »`:''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="wd-loc-${wd.id}" class="form-input" style="width:auto;height:34px">
            ${internalLocs.map(l=>`<option value="${l.id}" ${l.id===defLoc?'selected':''}>${escHtml(l.name)}</option>`).join('')}
          </select>
          <button class="btn btn-danger" onclick="rejectWithdrawal('${wd.id}')"><i class="ti ti-x"></i> Rejeter</button>
          <button class="btn btn-success" onclick="approveWithdrawal('${wd.id}')"><i class="ti ti-check"></i> Approuver & Réduire</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Produit</th><th style="text-align:center">Stock actuel</th><th style="text-align:center">Qté retirée</th><th style="text-align:center">Après</th></tr></thead>
        <tbody>
          ${items.map(it => {
            const cur = Math.round(getQty(it.product_id));
            const after = cur - (it.quantity||0);
            return `<tr style="${after<0?'background:rgba(242,86,104,.06)':''}">
              <td style="font-weight:500">${escHtml(it.product_name||'—')}</td>
              <td style="text-align:center;font-family:var(--font-mono)">${cur}</td>
              <td style="text-align:center;font-family:var(--font-mono);font-weight:700;color:var(--red)">-${it.quantity}</td>
              <td style="text-align:center;font-family:var(--font-mono);font-weight:600;color:var(--${after<0?'red':'text1'})">${after}${after<0?' ⚠':''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('');
}
async function vPendingWithdrawals(c) {
  c = c || document.getElementById('main-content');
  c.innerHTML = '<div class="empty"><i class="ti ti-loader spin"></i></div>';
  await loadPendingWithdrawals();
  c.innerHTML = `<div style="margin-bottom:16px;font-size:14px;font-weight:600">${pendingWithdrawals.length} retrait${pendingWithdrawals.length>1?'s':''} en attente d'approbation</div>` + pendingWithdrawalsListHTML();
}

async function approveWithdrawal(wdId) {
  const wd = pendingWithdrawals.find(x=>String(x.id)===String(wdId)); if(!wd) return;
  const items = typeof wd.items==='string' ? JSON.parse(wd.items) : (wd.items||[]);
  const locId = parseInt(document.getElementById('wd-loc-'+wdId)?.value);
  if(!locId){ toast('Choisis un emplacement','error'); return; }
  const locName = locations.find(l=>l.id===locId)?.name || '';

  let done=0;
  for(const it of items){
    const qty = it.quantity||0;
    if(qty<=0) continue;
    const locStock = stockMap[it.product_id]?.byLocation.find(b=>b.locId===locId);
    const newQty = Math.max(0, (locStock?.qty||0) - qty);
    await sb.from('stock').upsert(
      {product_id:it.product_id, location_id:locId, quantity:newQty},
      {onConflict:'product_id,location_id'}
    );
    await sb.from('movements').insert({
      product_id:    it.product_id,
      location_from: locId,
      quantity:      -qty,
      movement_type: 'reduce',
      user_id:       user.id,
      user_email:    profile?.email,
      notes:         `Retrait employé « ${wd.username} » — approuvé par ${profile?.full_name||profile?.email}`,
    });
    done++;
  }

  await sb.from('pending_withdrawals').update({
    status:'approved', reviewed_by:user.id, reviewed_email:profile?.email, reviewed_at:new Date().toISOString(),
  }).eq('id', wd.id);

  await logAction('reduce',{notes:`Retrait approuvé (${wd.username}) — ${done} produit(s) @ ${locName}`});
  toast(`✓ Retrait approuvé — ${done} produit${done>1?'s':''} retiré${done>1?'s':''}`,'success');
  await loadAll();
  renderView(currentView);
}

function rejectWithdrawal(wdId) {
  const wd = pendingWithdrawals.find(x=>String(x.id)===String(wdId)); if(!wd) return;
  openModal('Rejeter ce retrait ?', `
    <div style="background:var(--red-dim);border:1px solid rgba(242,86,104,.3);border-radius:10px;padding:14px;margin-bottom:14px;font-size:13px;color:var(--text2)">
      Le retrait soumis par <strong style="color:var(--text1)">${escHtml(wd.username)}</strong> sera rejeté sans toucher au stock.
    </div>
    <div class="form-group"><label class="form-label">Raison (optionnel)</label>
      <input id="wd-reject-reason" type="text" class="form-input" placeholder="ex: produit déjà compté, erreur…">
    </div>
  `, [
    {label:'Annuler', cls:'', action:'closeModal()'},
    {label:'<i class="ti ti-x"></i> Rejeter', cls:'btn-danger', action:`submitRejectWithdrawal('${wdId}')`},
  ]);
}

async function submitRejectWithdrawal(wdId) {
  const reason = document.getElementById('wd-reject-reason')?.value?.trim();
  await sb.from('pending_withdrawals').update({
    status:'rejected', reviewed_by:user.id, reviewed_email:profile?.email, reviewed_at:new Date().toISOString(), reject_reason:reason||null,
  }).eq('id', wdId);
  toast('Retrait rejeté','info');
  closeModal();
  await loadPendingWithdrawals();
  renderView(currentView);
}

// ══ KIOSQUE EMPLOYÉ — retrait sans authentification ═════════
let _kiosk = { username:'', products:[], cart:[] };

function openKiosk() {
  _kiosk = { username:'', products:[], cart:[] };
  document.getElementById('auth-wrap')?.classList.add('hidden');
  document.getElementById('kiosk-wrap')?.classList.remove('hidden');
  kioskRenderLogin();
}
function closeKiosk() {
  document.getElementById('kiosk-wrap')?.classList.add('hidden');
  document.getElementById('auth-wrap')?.classList.remove('hidden');
  _kiosk = { username:'', products:[], cart:[] };
}

function kioskRenderLogin() {
  const w = document.getElementById('kiosk-wrap');
  w.innerHTML = `
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-logo" style="background:transparent;width:64px;height:64px"><i class="ti ti-package-export" style="font-size:40px;color:var(--accent)"></i></div>
        <h1>Retrait de stock</h1>
        <p>Entre ton nom d'utilisateur pour commencer</p>
      </div>
      <div class="auth-body" style="padding:28px 32px">
        <input id="kiosk-user" class="auth-input" type="text" placeholder="Nom d'utilisateur" autocomplete="off" onkeydown="if(event.key==='Enter')kioskStart()">
        <button class="auth-btn" onclick="kioskStart()">Continuer</button>
        <button class="auth-btn" style="background:transparent;color:var(--text3);border:1px solid var(--border);margin-top:8px" onclick="closeKiosk()">Annuler</button>
      </div>
    </div>`;
  setTimeout(()=>document.getElementById('kiosk-user')?.focus(), 100);
}

async function kioskStart() {
  const username = document.getElementById('kiosk-user')?.value?.trim();
  if(!username){ toast("Entre ton nom d'utilisateur",'error'); return; }
  _kiosk.username = username;
  const w = document.getElementById('kiosk-wrap');
  w.innerHTML = '<div class="auth-card"><div class="empty" style="padding:60px"><i class="ti ti-loader spin" style="font-size:32px"></i></div></div>';
  try {
    const { data, error } = await sb.rpc('kiosk_products');
    if(error) throw error;
    _kiosk.products = data || [];
    kioskRenderWithdraw();
  } catch(e) {
    toast('Erreur de chargement: '+e.message,'error');
    kioskRenderLogin();
  }
}

function kioskRenderWithdraw() {
  const w = document.getElementById('kiosk-wrap');
  w.innerHTML = `
    <div class="auth-card" style="width:440px;max-height:92vh;display:flex;flex-direction:column">
      <div class="auth-header" style="padding:18px 24px;text-align:left;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em">Retrait de stock</div>
          <h1 style="font-size:18px">Bonjour ${escHtml(_kiosk.username)}</h1>
        </div>
        <button class="btn" onclick="closeKiosk()" style="height:34px" title="Quitter"><i class="ti ti-logout"></i></button>
      </div>
      <div style="padding:16px 24px;border-bottom:1px solid var(--border)">
        <input id="kiosk-search" class="auth-input" style="margin-bottom:8px" type="text" placeholder="Cherche un produit…" oninput="kioskFilter()" autocomplete="off">
        <div id="kiosk-results" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px 24px;min-height:120px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;margin-bottom:8px">Produits à retirer</div>
        <div id="kiosk-cart"></div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border)">
        <input id="kiosk-note" class="auth-input" style="margin-bottom:10px" type="text" placeholder="Note (optionnel)" autocomplete="off">
        <button class="auth-btn" id="kiosk-submit" onclick="kioskSubmit()">Soumettre le retrait</button>
      </div>
    </div>`;
  kioskRenderCart();
  setTimeout(()=>document.getElementById('kiosk-search')?.focus(), 100);
}

function kioskFilter() {
  const q = (document.getElementById('kiosk-search')?.value||'').toLowerCase().trim();
  const box = document.getElementById('kiosk-results');
  if(!box) return;
  if(!q){ box.innerHTML=''; return; }
  const matches = _kiosk.products.filter(p =>
    (p.name||'').toLowerCase().includes(q) ||
    (p.reference||'').toLowerCase().includes(q) ||
    (p.barcode||'').toLowerCase().includes(q)
  ).slice(0,8);
  box.innerHTML = matches.length ? matches.map(p => `
    <div onclick="kioskAddItem(${p.id})" style="display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
      <span style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--font-mono);flex-shrink:0;margin-left:8px">${Math.round(p.qty||0)} en stock</span>
    </div>`).join('') : '<div style="font-size:12px;color:var(--text3);padding:8px">Aucun résultat</div>';
}

function kioskAddItem(pid) {
  const p = _kiosk.products.find(x=>x.id===pid); if(!p) return;
  const existing = _kiosk.cart.find(c=>c.product_id===pid);
  if(existing) existing.quantity++;
  else _kiosk.cart.push({product_id:pid, product_name:p.name, quantity:1});
  const s=document.getElementById('kiosk-search'); if(s) s.value='';
  const r=document.getElementById('kiosk-results'); if(r) r.innerHTML='';
  kioskRenderCart();
}
function kioskSetQty(pid, val) {
  const it = _kiosk.cart.find(c=>c.product_id===pid); if(!it) return;
  it.quantity = Math.max(1, parseInt(val)||1);
}
function kioskRemoveItem(pid) {
  _kiosk.cart = _kiosk.cart.filter(c=>c.product_id!==pid);
  kioskRenderCart();
}
function kioskRenderCart() {
  const box = document.getElementById('kiosk-cart'); if(!box) return;
  if(!_kiosk.cart.length){ box.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:12px 0">Cherche un produit ci-dessus et tape dessus pour l\'ajouter.</div>'; return; }
  box.innerHTML = _kiosk.cart.map(it => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;margin-bottom:6px">
      <div style="flex:1;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(it.product_name)}</div>
      <input type="number" min="1" value="${it.quantity}" onchange="kioskSetQty(${it.product_id},this.value)" style="width:64px;height:38px;text-align:center;background:var(--bg1);border:1px solid var(--border2);border-radius:8px;color:var(--text1);font-family:var(--font-mono);font-size:16px;outline:none">
      <button onclick="kioskRemoveItem(${it.product_id})" style="width:34px;height:34px;border:none;background:var(--red-dim);color:var(--red);border-radius:8px;cursor:pointer"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

async function kioskSubmit() {
  if(!_kiosk.cart.length){ toast('Ajoute au moins un produit','error'); return; }
  const btn = document.getElementById('kiosk-submit');
  if(btn){ btn.disabled=true; btn.textContent='Envoi…'; }
  const note = document.getElementById('kiosk-note')?.value?.trim() || null;
  try {
    const { error } = await sb.rpc('kiosk_submit_withdrawal', {
      p_username: _kiosk.username,
      p_items:    _kiosk.cart,
      p_notes:    note,
    });
    if(error) throw error;
    kioskRenderDone();
  } catch(e) {
    toast('Erreur: '+e.message,'error');
    if(btn){ btn.disabled=false; btn.textContent='Soumettre le retrait'; }
  }
}

function kioskRenderDone() {
  const n = _kiosk.cart.length;
  const w = document.getElementById('kiosk-wrap');
  w.innerHTML = `
    <div class="auth-card">
      <div class="auth-body" style="padding:48px 32px;text-align:center">
        <div style="width:72px;height:72px;border-radius:50%;background:var(--green-dim);display:flex;align-items:center;justify-content:center;margin:0 auto 18px">
          <i class="ti ti-check" style="font-size:38px;color:var(--green)"></i>
        </div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">Retrait soumis !</div>
        <div style="font-size:13px;color:var(--text3);line-height:1.5">${n} produit${n>1?'s':''} envoyé${n>1?'s':''} pour approbation.<br>Un responsable doit l'approuver pour qu'il soit retiré du stock.</div>
        <div style="font-size:12px;color:var(--text3);margin-top:20px"><i class="ti ti-loader spin"></i> Déconnexion automatique…</div>
      </div>
    </div>`;
  setTimeout(closeKiosk, 3500);
}


const SCAN_SELECT_MAP={recv:'recv-product',tf:'tf-product',red:'red-product'};
const SCAN_UPDATE_MAP={recv:()=>updateRecvInfo(),tf:()=>updateTfInfo(),red:()=>updateRedInfo()};

function scanSearch(prefix){
  const input=document.getElementById(prefix+'-scanner');
  const results=document.getElementById(prefix+'-scan-results');
  if(!input||!results)return;
  const q=input.value.trim().toLowerCase();
  if(!q){results.innerHTML='';return;}
  const matches=products.filter(p=>
    (p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q||
    (p.barcode||'').toLowerCase().startsWith(q)||(p.reference||'').toLowerCase().startsWith(q)||
    (p.name||'').toLowerCase().includes(q)
  ).slice(0,8);
  if(!matches.length){results.innerHTML=`<div style="font-size:12px;color:var(--text3);padding:4px 0">Aucun résultat</div>`;return;}
  results.innerHTML=matches.map(p=>{
    const qty=getQty(p.id),s=getStatus(qty,p.id);
    const exact=(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q;
    return`<div onclick="scanSelect('${prefix}',${p.id})" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg${exact?'1':'2'});border:1px solid var(--${exact?'blue':'border'});border-radius:8px;cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='var(--bg${exact?'1':'2'})'">
      <i class="ti ti-${exact?'circle-check':'package'}" style="color:var(--${exact?'blue':'text3'});font-size:16px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:${exact?600:400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${p.reference?'REF: '+p.reference+' · ':''}${p.barcode?'CB: '+p.barcode:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--font-mono);font-size:13px;color:var(--${s.color==='green'?'green':s.color==='amber'?'amber':'red'})">${Math.round(qty)}</div>
        <span class="badge badge-${s.color}" style="font-size:9px">${s.label}</span>
      </div>
    </div>`;
  }).join('');
}

function scanSelect(prefix,productId){
  const sel=document.getElementById(SCAN_SELECT_MAP[prefix]);
  const input=document.getElementById(prefix+'-scanner');
  const results=document.getElementById(prefix+'-scan-results');
  if(sel)sel.value=productId;
  if(input){input.value='';input.focus();}
  if(results)results.innerHTML='';
  (SCAN_UPDATE_MAP[prefix]||function(){})();
  if(sel){sel.style.borderColor='var(--green)';sel.style.boxShadow='0 0 0 2px rgba(62,207,114,.25)';setTimeout(()=>{sel.style.borderColor='';sel.style.boxShadow='';},1200);}
  const qtyFields={recv:'recv-qty',tf:'tf-qty',red:'red-qty'};
  setTimeout(()=>document.getElementById(qtyFields[prefix])?.focus(),100);
  toast(`✓ ${products.find(x=>x.id===productId)?.name} sélectionné`,'success');
}

function scanConfirm(prefix){
  const input=document.getElementById(prefix+'-scanner');
  if(!input)return;
  const q=input.value.trim().toLowerCase();
  if(!q)return;
  let found=products.find(p=>(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q);
  if(!found)found=products.find(p=>(p.name||'').toLowerCase().includes(q));
  if(found)scanSelect(prefix,found.id);
  else{toast(`Produit introuvable : "${input.value}"`,'error');input.select();}
}

function scanInventory(code){
  const q=(code||'').trim().toLowerCase();
  if(!q)return;
  const found=products.find(p=>(p.barcode||'').toLowerCase()===q||(p.reference||'').toLowerCase()===q||(p.name||'').toLowerCase().includes(q));
  if(!found){toast(`Introuvable : "${code}"`,'error');return;}
  ['minv-row-','inv-row-d-'].forEach(pfx=>{
    const row=document.getElementById(pfx+found.id);
    if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.style.borderColor='var(--blue)';row.style.background='var(--blue-bg)';setTimeout(()=>{row.style.borderColor='';row.style.background='';},2000);}
  });
  const input=document.getElementById('inv-qty-'+found.id);
  if(input){input.focus();input.select();}
  toast(`↓ ${found.name}`,'info');
}

// ── COLLAPSIBLE NAV ───────────────────────────────────────
function toggleNavGroup(labelEl) {
  const items = labelEl.nextElementSibling;
  const isCollapsed = items.classList.contains('collapsed');
  items.classList.toggle('collapsed', !isCollapsed);
  labelEl.classList.toggle('collapsed', !isCollapsed);
  // Save state
  const key = 'nav_' + labelEl.textContent.trim().slice(0,10);
  localStorage.setItem(key, isCollapsed ? 'open' : 'closed');
}

// Restore nav state on load
function restoreNavState() {
  document.querySelectorAll('.nav-label').forEach(label => {
    const key = 'nav_' + label.textContent.trim().slice(0,10);
    const state = localStorage.getItem(key);
    if (state === 'closed') {
      const items = label.nextElementSibling;
      if (items) {
        items.classList.add('collapsed');
        label.classList.add('collapsed');
      }
    }
  });
}


// ══════════════════════════════════════════════════════════
function openBarcodeScanner(mode='general') {
  bcFoundProduct=null;
  document.getElementById('bc-overlay').classList.add('show');
  document.getElementById('bc-card').classList.remove('show');
  document.getElementById('bc-notfound').classList.remove('show');
  document.getElementById('bc-actions').style.display='none';
  document.getElementById('bc-manual').value='';
  setBcStatus('<i class="ti ti-camera" style="font-size:16px"></i><span>Initialisation…</span>');
  startCamera();
}
function closeBc(){bcCartMode=false;document.getElementById('bc-overlay').classList.remove('show');stopCamera();}
async function startCamera() {
  stopCamera();
  try {
    // iPhone needs specific constraints
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280, min: 640 },
        height: { ideal: 720,  min: 480 },
        focusMode: 'continuous',
      }
    };
    try {
      bcStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(e) {
      // Fallback — simpler constraints
      bcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    }
    const vid = document.getElementById('bc-video');
    vid.srcObject = bcStream;
    vid.setAttribute('playsinline', true);
    vid.setAttribute('autoplay', true);
    vid.muted = true;
    await vid.play();
    setBcStatus('<i class="ti ti-loader spin" style="font-size:16px"></i><span>Initialisation…</span>');
    startDecodeLoop();
  } catch(e) {
    setBcStatus('<i class="ti ti-camera-off" style="color:var(--amber);font-size:16px"></i><span style="color:var(--amber)">Caméra non disponible — utilise la saisie manuelle</span>');
  }
}
function stopCamera(){if(bcInterval){clearInterval(bcInterval);bcInterval=null;}if(bcStream){bcStream.getTracks().forEach(t=>t.stop());bcStream=null;}}
async function startDecodeLoop() {
  const vid = document.getElementById('bc-video');
  const cvs = document.getElementById('bc-canvas');
  const ctx = cvs.getContext('2d');

  // Load ZXing if not already loaded
  if(!window._zxingReader) {
    setBcStatus('<i class="ti ti-loader spin" style="font-size:16px"></i><span>Chargement du décodeur…</span>');
    try {
      await loadZXing();
    } catch(e) {
      setBcStatus('<i class="ti ti-alert-circle" style="color:var(--red);font-size:16px"></i><span style="color:var(--red)">Erreur décodeur — utilise la saisie manuelle</span>');
      return;
    }
  }

  setBcStatus('<i class="ti ti-scan" style="font-size:16px"></i><span>Pointez vers un code-barres…</span>');

  bcInterval = setInterval(async () => {
    if(vid.readyState < 2 || vid.paused) return;
    try {
      cvs.width  = vid.videoWidth;
      cvs.height = vid.videoHeight;
      ctx.drawImage(vid, 0, 0);

      // Try native BarcodeDetector first (Chrome/Android)
      if('BarcodeDetector' in window) {
        if(!window._bcd) window._bcd = new BarcodeDetector({
          formats:['ean_13','ean_8','code_128','code_39','qr_code','upc_a','upc_e','itf']
        });
        const bs = await window._bcd.detect(cvs);
        if(bs.length) { onBcDetected(bs[0].rawValue); return; }
      }

      // ZXing fallback (Safari iPhone)
      if(window._zxingReader) {
        const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const result  = await window._zxingReader.decodeFromImageData(imgData, cvs.width, cvs.height);
        if(result) onBcDetected(result.getText());
      }
    } catch(e) { /* not found yet, keep scanning */ }
  }, 300);
}

function loadZXing() {
  return new Promise((resolve, reject) => {
    if(window.ZXing) { initZXingReader(); resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload = () => { initZXingReader(); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function initZXingReader() {
  try {
    const hints = new Map();
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      window.ZXing.BarcodeFormat.EAN_13,
      window.ZXing.BarcodeFormat.EAN_8,
      window.ZXing.BarcodeFormat.CODE_128,
      window.ZXing.BarcodeFormat.CODE_39,
      window.ZXing.BarcodeFormat.QR_CODE,
      window.ZXing.BarcodeFormat.UPC_A,
      window.ZXing.BarcodeFormat.UPC_E,
      window.ZXing.BarcodeFormat.ITF,
      window.ZXing.BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new window.ZXing.MultiFormatReader();
    reader.setHints(hints);

    // Wrap in an async-friendly interface
    window._zxingReader = {
      decodeFromImageData: (imageData, width, height) => {
        return new Promise((resolve, reject) => {
          try {
            const lum    = new window.ZXing.RGBLuminanceSource(imageData.data, width, height);
            const binary = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(lum));
            const result = reader.decode(binary);
            resolve(result);
          } catch(e) { reject(e); }
        });
      }
    };
  } catch(e) {
    window._zxingReader = null;
  }
}
function onBcDetected(code) {
  const aim=document.querySelector('.bc-aim-inner');
  if(aim){aim.style.borderColor='var(--green)';setTimeout(()=>aim.style.borderColor='var(--blue)',600);}
  setBcStatus(`<i class="ti ti-check" style="color:var(--green);font-size:16px"></i><span style="color:var(--green)">Code: <strong style="font-family:var(--font-mono)">${escHtml(code)}</strong></span>`);
  stopCamera();
  searchByBarcode(code);
}
function bcManual(){const code=document.getElementById('bc-manual').value.trim();if(!code)return;searchByBarcode(code);}
async function searchByBarcode(code) {
  document.getElementById('bc-notfound').classList.remove('show');
  document.getElementById('bc-card').classList.remove('show');
  document.getElementById('bc-actions').style.display='none';
  // Search in loaded products
  let found=products.find(p=>(p.barcode||'').toLowerCase()===code.toLowerCase()||(p.reference||'').toLowerCase()===code.toLowerCase());
  // Fallback: query Supabase
  if(!found){
    const {data}=await sb.from('products').select('*').or(`barcode.eq.${code},reference.eq.${code}`).limit(1);
    if(data?.length){found=data[0];if(!products.find(x=>x.id===found.id))products.push(found);}
  }
  if(!found){
    document.getElementById('bc-notfound').classList.add('show');
    setTimeout(()=>{document.getElementById('bc-notfound').classList.remove('show');startCamera();},3000);
    return;
  }
  if(bcCartMode){
    recvAddProduct(found.id);
    setBcStatus(`<i class="ti ti-plus" style="color:var(--green);font-size:16px"></i><span style="color:var(--green)">${escHtml(found.name)} ajouté</span>`);
    setTimeout(()=>startCamera(),800);
    return;
  }
  bcFoundProduct=found;
  const qty=getQty(found.id), s=getStatus(qty, found.id);
  document.getElementById('bc-pname').textContent=found.name;
  document.getElementById('bc-pref').textContent=found.reference?`REF: ${found.reference}`:'';
  document.getElementById('bc-pqty').textContent=`${Math.round(qty)}`;
  document.getElementById('bc-pprice').textContent=fmtCAD(found.sale_price);
  document.getElementById('bc-pstatus').innerHTML=`<span class="badge badge-${s.color}">${s.label}</span>`;
  document.getElementById('bc-card').classList.add('show');
  document.getElementById('bc-actions').style.display='flex';
}
function bcAction(action){if(!bcFoundProduct)return;const id=bcFoundProduct.id;closeBc();goTo(action,id);}
function setBcStatus(html){const e=document.getElementById('bc-status');if(e)e.innerHTML=html;}

// ══════════════════════════════════════════════════════════
// MODAL & HELPERS
// ══════════════════════════════════════════════════════════
function openModal(title,body,buttons=[]) {
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=body;
  // First button goes left (if danger/destructive), rest go right
  const danger  = buttons.filter(b=>b.cls?.includes('danger'));
  const others  = buttons.filter(b=>!b.cls?.includes('danger'));
  const mkBtn   = b=>`<button class="btn ${b.cls||''}" onclick="${b.action}">${b.label}</button>`;
  document.getElementById('modal-footer').innerHTML=
    `<div style="display:flex;gap:7px">${danger.map(mkBtn).join('')}</div>`+
    `<div style="display:flex;gap:7px">${others.map(mkBtn).join('')}</div>`;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('show');}

function fmtCAD(n){return(n||0).toLocaleString('fr-CA',{style:'currency',currency:'CAD'});}
function fmtDate(d){if(!d)return'—';return new Date(d).toLocaleDateString('fr-CA',{day:'2-digit',month:'short',year:'numeric'});}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function toast(msg,type='info') {
  const w=document.getElementById('toast-wrap');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.innerHTML=`<i class="ti ti-${type==='success'?'check':type==='error'?'alert-circle':'info-circle'}"></i>${escHtml(msg)}`;
  w.appendChild(t); setTimeout(()=>t.remove(),4000);
}

// ══ EXPORTS CSV ═══════════════════════════════════════════
function downloadCSV(rows, filename){
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  // BOM \ufeff pour que les accents s'affichent correctement dans Excel
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent('\ufeff'+csv);
  a.download=filename; a.click();
}

// Modal d'export du rapport inventaire (état actuel OU mouvements par période)
function openInventoryExport(){
  const today=new Date().toISOString().slice(0,10);
  const monthAgo=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
  openModal('Exporter un rapport', `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-weight:600;margin-bottom:4px"><i class="ti ti-camera" style="color:var(--blue);margin-right:6px"></i>État actuel du stock</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Photo instantanée : chaque produit avec sa quantité, son coût et sa valeur de stock actuels.</div>
        <button class="btn btn-primary" onclick="exportCSV()"><i class="ti ti-download"></i> Exporter l'état actuel</button>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-weight:600;margin-bottom:4px"><i class="ti ti-calendar-stats" style="color:var(--green);margin-right:6px"></i>Mouvements sur une période</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Toutes les réceptions, réductions et transferts entre deux dates.</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">De</label><input id="exp-from" type="date" class="form-input" value="${monthAgo}"></div>
          <div class="form-group"><label class="form-label">Au</label><input id="exp-to" type="date" class="form-input" value="${today}"></div>
        </div>
        <button class="btn btn-primary" onclick="exportMovementsRange()"><i class="ti ti-download"></i> Exporter la période</button>
      </div>
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'}]);
}

function exportCSV() {
  if(!products.length){toast('Aucun produit','error');return;}
  const rows=[['Nom','Référence','Code-barres','Catégorie','Qté','Coût unitaire','Valeur du stock','Prix vente','Statut']];
  products.forEach(p=>{
    const cat=categories.find(c=>c.id===p.category_id);
    const qty=getQty(p.id);
    rows.push([p.name,p.reference||'',p.barcode||'',cat?.name||'',Math.round(qty),(p.cost_price||0),(qty*(p.cost_price||0)).toFixed(2),(p.sale_price||0),getStatus(qty, p.id).label]);
  });
  downloadCSV(rows,'inventaire_goplex.csv');
  closeModal();
  toast('✓ Inventaire exporté','success');
}

async function exportMovementsRange(){
  const from=document.getElementById('exp-from')?.value;
  const to=document.getElementById('exp-to')?.value;
  if(!from||!to){toast('Choisis les deux dates','error');return;}
  if(from>to){toast('La date « De » doit précéder « Au »','error');return;}
  toast('Génération du rapport…','info');
  const toEnd=new Date(to+'T23:59:59.999');
  const {data,error}=await sb.from('movements').select('*')
    .gte('created_at', from+'T00:00:00')
    .lte('created_at', toEnd.toISOString())
    .order('created_at',{ascending:true}).limit(10000);
  if(error){toast('Erreur: '+error.message,'error');return;}
  const typeFR={receive:'Réception',reduce:'Réduction',transfer:'Transfert',inventory:'Inventaire',import:'Import'};
  const pName=id=>products.find(p=>p.id===id)?.name||('Produit #'+id);
  const lName=id=>id?(locations.find(l=>l.id===id)?.name||('Empl. #'+id)):'';
  const rows=[['Date','Produit','Type','Quantité','Emplacement source','Emplacement destination','Référence','Note','Utilisateur']];
  (data||[]).forEach(m=>{
    rows.push([
      new Date(m.created_at).toLocaleString('fr-CA'),
      pName(m.product_id),
      typeFR[m.movement_type]||m.movement_type||'',
      m.quantity,
      lName(m.location_from),
      lName(m.location_to),
      m.reference||'',
      m.notes||'',
      m.user_email||''
    ]);
  });
  if(rows.length===1){toast('Aucun mouvement dans cette période','info');return;}
  downloadCSV(rows,`mouvements_${from}_au_${to}.csv`);
  closeModal();
  toast(`✓ ${rows.length-1} mouvement(s) exporté(s)`,'success');
}

// ══ ONGLET FINANCIER — valeur du stock par catégorie ═══════
function _financeAgg(){
  const agg={}; let grand=0, grandQty=0;
  products.forEach(p=>{
    const qty=getQty(p.id);
    const val=qty*(p.cost_price||0);
    const key=p.category_id||'none';
    if(!agg[key]) agg[key]={name:(categories.find(c=>c.id===p.category_id)?.name)||'Sans catégorie', count:0, value:0, qty:0};
    agg[key].count++; agg[key].value+=val; agg[key].qty+=qty;
    grand+=val; grandQty+=qty;
  });
  return {rows:Object.values(agg).sort((a,b)=>b.value-a.value), grand, grandQty};
}

function vFinance(c){
  c=c||document.getElementById('main-content');
  const {rows,grand,grandQty}=_financeAgg();
  const kpi=(label,val,col)=>`<div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;padding:18px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px">${label}</div>
    <div style="font-size:24px;font-weight:800;font-family:var(--font-mono);color:var(--${col||'text1'})">${val}</div></div>`;
  c.innerHTML=`
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
    ${kpi('Valeur totale du stock', fmtCAD(grand), 'green')}
    ${kpi('Unités en stock', Math.round(grandQty), 'text1')}
    ${kpi('Catégories', rows.length, 'blue')}
  </div>
  <div class="table-card">
    <div class="table-toolbar">
      <div class="table-toolbar-title"><i class="ti ti-coin" style="color:var(--green);margin-right:8px"></i>Valeur du stock par catégorie</div>
      <button class="btn" onclick="exportFinanceCSV()"><i class="ti ti-download"></i> Exporter</button>
    </div>
    <table>
      <thead><tr><th>Catégorie</th><th style="text-align:center">Produits</th><th style="text-align:center">Unités</th><th style="text-align:right">Valeur du stock</th><th style="text-align:right">% du total</th></tr></thead>
      <tbody>
        ${rows.length?rows.map(r=>`<tr>
          <td style="font-weight:500">${escHtml(r.name)}</td>
          <td style="text-align:center;font-family:var(--font-mono);color:var(--text2)">${r.count}</td>
          <td style="text-align:center;font-family:var(--font-mono);color:var(--text2)">${Math.round(r.qty)}</td>
          <td style="text-align:right;font-family:var(--font-mono);font-weight:600">${fmtCAD(r.value)}</td>
          <td style="text-align:right;font-family:var(--font-mono);color:var(--text3)">${grand>0?((r.value/grand)*100).toFixed(1):'0.0'} %</td>
        </tr>`).join(''):'<tr><td colspan="5" class="empty">Aucune donnée</td></tr>'}
      </tbody>
      <tfoot><tr style="border-top:2px solid var(--border2);font-weight:700;background:var(--bg2)">
        <td>Total</td>
        <td style="text-align:center;font-family:var(--font-mono)">${products.length}</td>
        <td style="text-align:center;font-family:var(--font-mono)">${Math.round(grandQty)}</td>
        <td style="text-align:right;font-family:var(--font-mono);color:var(--green)">${fmtCAD(grand)}</td>
        <td style="text-align:right;font-family:var(--font-mono)">100 %</td>
      </tr></tfoot>
    </table>
    <div style="padding:12px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
      Valeur = quantité en stock × coût unitaire. Les produits sans coût défini comptent pour 0 $.
    </div>
  </div>`;
}

function exportFinanceCSV(){
  const {rows,grand,grandQty}=_financeAgg();
  const out=[['Catégorie','Produits','Unités','Valeur du stock (CAD)','% du total']];
  rows.forEach(r=>out.push([r.name, r.count, Math.round(r.qty), r.value.toFixed(2), (grand>0?((r.value/grand)*100).toFixed(1):'0.0')]));
  out.push(['TOTAL', products.length, Math.round(grandQty), grand.toFixed(2), '100']);
  downloadCSV(out,'valeur_stock_par_categorie.csv');
  toast('✓ Rapport financier exporté','success');
}

// ══ ÉTIQUETTES DYMO 30330 (2" x 3/4") ════════════════════════
function printLabel(id) {
  const p = products.find(x=>x.id===id); if(!p) return;
  openModal(`Étiquette — ${p.name}`, `
    <div class="form-row">
      <div class="form-group"><label class="form-label">Nombre d'étiquettes</label>
        <input id="lbl-qty" type="number" min="1" max="100" value="1" class="form-input">
      </div>
      <div class="form-group"><label class="form-label">Afficher le prix</label>
        <select id="lbl-price" class="form-input">
          <option value="1">Oui</option>
          <option value="0">Non</option>
        </select>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text3);line-height:1.5">
      Format DYMO 30330 — 2″ × 3/4″. Dans la fenêtre d'impression, choisis l'imprimante <strong>DYMO LabelWriter 450</strong> et le format <strong>30330 Return Address</strong>, marges à 0.
    </div>
  `, [{label:'Fermer',cls:'',action:'closeModal()'},{label:'<i class="ti ti-printer"></i> Imprimer',cls:'btn-primary',action:`doPrintLabel(${id})`}]);
}

function doPrintLabel(id) {
  const p = products.find(x=>x.id===id); if(!p) return;
  const qty = Math.max(1, Math.min(100, parseInt(document.getElementById('lbl-qty')?.value)||1));
  const showPrice = document.getElementById('lbl-price')?.value !== '0';
  const code = p.barcode || p.reference || ('GPX'+p.id);

  // Générer le code-barres en SVG (JsBarcode est chargé dans cette fenêtre)
  let barcodeSvg = '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    JsBarcode(svg, String(code), {format:'CODE128', width:1.5, height:34, displayValue:true, fontSize:11, margin:0, textMargin:1});
    barcodeSvg = new XMLSerializer().serializeToString(svg);
  } catch(e) {
    barcodeSvg = `<div style="font-family:monospace;font-size:10pt">${escHtml(String(code))}</div>`;
  }

  const priceLine = (showPrice && p.sale_price) ? `<div class="lbl-price">${fmtCAD(p.sale_price)}</div>` : '';
  const oneLabel = `<div class="label">
      <div class="lbl-name">${escHtml(p.name)}</div>
      <div class="lbl-bc">${barcodeSvg}</div>
      ${priceLine}
    </div>`;

  const w = window.open('', '_blank', 'width=460,height=360');
  if(!w){ toast('Pop-up bloqué — autorise les fenêtres pour imprimer','error'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Étiquette — ${escHtml(p.name)}</title>
    <style>
      @page { size: 2in 0.75in; margin: 0; }
      * { margin:0; padding:0; box-sizing:border-box; }
      html,body { width:2in; }
      .label { width:2in; height:0.75in; padding:0.03in 0.06in;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        page-break-after:always; overflow:hidden; font-family:Arial,Helvetica,sans-serif; }
      .lbl-name { font-size:8.5pt; font-weight:700; line-height:1.05; text-align:center;
        max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .lbl-bc { line-height:0; }
      .lbl-bc svg { max-width:1.9in; height:0.34in; }
      .lbl-price { font-size:9pt; font-weight:700; margin-top:1px; }
      @media screen { body{background:#444;padding:18px;display:flex;flex-wrap:wrap;gap:8px}
        .label{background:#fff;border:1px solid #888;border-radius:3px} }
    </style></head><body>${Array.from({length:qty}).map(()=>oneLabel).join('')}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(()=>{ try{ w.print(); }catch(e){} }, 350);
  closeModal();
  toast(`${qty} étiquette${qty>1?'s':''} envoyée${qty>1?'s':''} à l'impression`,'success');
}

// ══ PRÉVISIONS DE RUPTURE ════════════════════════════════════
function vForecast(c) {
  c = c || document.getElementById('main-content');
  const now = Date.now();
  const WINDOW_DAYS = 30;
  const cutoff = now - WINDOW_DAYS*864e5;

  // Consommation = mouvements de type "reduce" sur la fenêtre
  const reduceMoves = movements.filter(m => m.movement_type==='reduce' && new Date(m.created_at).getTime() >= cutoff);
  let earliest = now;
  reduceMoves.forEach(m => { const t=new Date(m.created_at).getTime(); if(t<earliest) earliest=t; });
  const spanDays = Math.max(1, Math.min(WINDOW_DAYS, Math.round((now-earliest)/864e5) || 1));

  const consumed = {};
  reduceMoves.forEach(m => { consumed[m.product_id] = (consumed[m.product_id]||0) + Math.abs(m.quantity||0); });

  const rows = products.map(p => {
    const qty   = getQty(p.id);
    const total = consumed[p.id] || 0;
    const rate  = total / spanDays;                 // unités / jour
    const daysLeft = rate > 0 ? qty / rate : Infinity;
    const suggested = rate > 0 ? Math.max(1, Math.ceil(rate*14 - qty)) : 0; // pour ~14 jours
    return { p, qty, rate, daysLeft, suggested };
  })
  .filter(r => r.rate > 0)                            // garder ceux qui bougent
  .sort((a,b) => a.daysLeft - b.daysLeft);

  const soon7  = rows.filter(r => r.daysLeft <= 7).length;
  const soon14 = rows.filter(r => r.daysLeft > 7 && r.daysLeft <= 14).length;

  const fmtDays = d => d===Infinity ? '∞' : d>=999 ? '999+' : Math.round(d);
  const dateOf  = d => {
    if(d===Infinity) return '—';
    const dt = new Date(now + d*864e5);
    return dt.toLocaleDateString('fr-CA', {day:'numeric', month:'short', year:'numeric'});
  };

  c.innerHTML = `
  <div class="stats-row" style="grid-template-columns:repeat(3,1fr)">
    <div class="stat-card red"><div class="stat-label">Rupture &lt; 7 jours</div><div class="stat-num" style="color:var(--red)">${soon7}</div><div class="stat-sub">à commander en priorité</div><i class="ti ti-alert-triangle stat-icon"></i></div>
    <div class="stat-card amber"><div class="stat-label">Rupture 7–14 jours</div><div class="stat-num" style="color:var(--amber)">${soon14}</div><div class="stat-sub">à surveiller</div><i class="ti ti-clock stat-icon"></i></div>
    <div class="stat-card blue"><div class="stat-label">Produits suivis</div><div class="stat-num">${rows.length}</div><div class="stat-sub">avec consommation</div><i class="ti ti-chart-line stat-icon"></i></div>
  </div>
  <div class="table-card">
    <div class="table-toolbar">
      <div class="table-toolbar-title"><i class="ti ti-chart-line" style="color:var(--blue);margin-right:6px"></i>Prévisions de rupture</div>
      <span style="font-size:11px;color:var(--text3)">Basé sur la consommation des ${spanDays} derniers jour${spanDays>1?'s':''} (sorties de stock)</span>
    </div>
    <table>
      <thead><tr><th>Produit</th><th>Stock</th><th>Conso/jour</th><th>Jours restants</th><th>Rupture estimée</th><th>À commander (~14j)</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => {
        const col = r.daysLeft<=7 ? 'red' : r.daysLeft<=14 ? 'amber' : 'green';
        return `<tr onclick="showProd(${r.p.id})">
          <td style="font-weight:500">${escHtml(r.p.name)}</td>
          <td style="font-family:var(--font-mono)">${Math.round(r.qty)}</td>
          <td style="font-family:var(--font-mono);color:var(--text2)">${r.rate.toFixed(1)}</td>
          <td><span class="badge badge-${col}">${fmtDays(r.daysLeft)} j</span></td>
          <td style="font-size:12px;color:var(--text2)">${dateOf(r.daysLeft)}</td>
          <td style="font-family:var(--font-mono);font-weight:700;color:var(--green)">${r.suggested>0?'+'+r.suggested:'—'}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" class="empty" style="padding:32px"><i class="ti ti-chart-line" style="display:block;font-size:36px;opacity:.3;margin-bottom:8px"></i>Pas encore assez de sorties de stock pour estimer la consommation.<br>Les prévisions apparaîtront après quelques mouvements « Réduire stock ».</td></tr>'}
      </tbody>
    </table>
    <div style="padding:12px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">
      La consommation est calculée à partir des sorties de stock (ventes, pertes, usage). Plus l'historique est long, plus l'estimation est précise.
    </div>
  </div>`;
}

async function exportCommandeExcel(catId=null, supplierName=null) {
  const toOrder = products.filter(p =>
    p.alert_enabled !== false &&
    getQty(p.id) <= (p.alert_threshold ?? window._alertThreshold ?? 4) &&
    (catId === null || p.category_id == catId) &&
    (supplierName === null || (p.supplier||'') === supplierName)
  ).sort((a,b) => {
    const qa=getQty(a.id), qb=getQty(b.id);
    if(qa<=0&&qb>0) return -1;
    if(qb<=0&&qa>0) return 1;
    return a.name.localeCompare(b.name);
  });

  if(!toOrder.length){ toast('Aucun produit à commander pour cette sélection !','info'); return; }

  // Load SheetJS dynamically
  if(!window.XLSX) {
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
  }

  const today    = new Date().toLocaleDateString('fr-CA');
  const catName  = supplierName ? `Fournisseur : ${supplierName}`
                  : catId ? (categories.find(c=>c.id==catId)?.name||'Catégorie')
                  : 'Toutes catégories';
  const threshold = window._alertThreshold ?? 4;
  const wb = XLSX.utils.book_new();

  // ── Build data rows ──────────────────────────────────────
  const headers = ['Produit','Référence','Catégorie','Stock actuel','Seuil','Statut','Qté à commander','Notes'];
  const dataRows = toOrder.map(p => {
    const qty      = Math.round(getQty(p.id));
    const seuil    = p.alert_threshold ?? threshold;
    const cat      = categories.find(c=>c.id===p.category_id)?.name || '—';
    const s        = getStatus(qty, p.id);
    const suggested = Math.max(1, (seuil*2) - qty);
    return [p.name, p.reference||'—', cat, qty, seuil, s.label, suggested, ''];
  });

  const wsData = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // ── Column widths ────────────────────────────────────────
  ws['!cols'] = [
    {wch:32}, // Produit
    {wch:16}, // Référence
    {wch:18}, // Catégorie
    {wch:14}, // Stock actuel
    {wch:10}, // Seuil
    {wch:14}, // Statut
    {wch:18}, // Qté à commander
    {wch:28}, // Notes
  ];

  // ── Freeze header row ────────────────────────────────────
  ws['!freeze'] = {xSplit:0, ySplit:1};

  // ── Cell styles (header + data) ──────────────────────────
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Header row style
  for(let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({r:0, c});
    if(!ws[addr]) continue;
    ws[addr].s = {
      fill:   {fgColor:{rgb:'1A1A1E'}},
      font:   {bold:true, color:{rgb:'C9A84C'}, sz:11, name:'Calibri'},
      border: {bottom:{style:'medium', color:{rgb:'C9A84C'}}},
      alignment: {horizontal:'center', vertical:'center'},
    };
  }

  // Data rows
  toOrder.forEach((p, i) => {
    const row = i + 1; // 0 = header
    const qty = Math.round(getQty(p.id));
    const isOut = qty <= 0;
    const isLow = !isOut;
    const rowBg  = isOut ? 'FFEAEA' : isLow ? 'FFF8E8' : 'FFFFFF';
    const altBg  = isOut ? 'FFD6D6' : isLow ? 'FFF2D0' : 'F8F8F8';
    const bg     = i%2===0 ? rowBg : altBg;

    for(let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({r:row, c});
      if(!ws[addr]) ws[addr] = {t:'s', v:''};
      const isNumCol = c===3||c===4||c===6;
      const isStatusCol = c===5;
      let fontColor = '333333';
      if(isStatusCol) fontColor = isOut ? 'CC0000' : 'B85C00';
      if(c===6) fontColor = '1A6B3C'; // Qté à commander en vert
      ws[addr].s = {
        fill: {fgColor:{rgb:bg}},
        font: {
          name:'Calibri', sz:10,
          bold: c===0||c===6,
          color:{rgb:fontColor},
        },
        border: {
          bottom:{style:'thin', color:{rgb:'DDDDDD'}},
          right: {style:'thin', color:{rgb:'EEEEEE'}},
        },
        alignment: {
          horizontal: isNumCol ? 'center' : 'left',
          vertical: 'center',
        },
      };
    }
  });

  // Notes column — light dashed border hint
  for(let r=1; r<=toOrder.length; r++){
    const addr = XLSX.utils.encode_cell({r, c:7});
    if(ws[addr]) ws[addr].s = {
      ...ws[addr].s,
      fill:{fgColor:{rgb:'F5F5F5'}},
      border:{
        bottom:{style:'thin',color:{rgb:'DDDDDD'}},
        left:{style:'dashed',color:{rgb:'CCCCCC'}},
        right:{style:'thin',color:{rgb:'DDDDDD'}},
      },
    };
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Lot d\'achat');

  // ── Summary sheet ────────────────────────────────────────
  const rupture = toOrder.filter(p=>getQty(p.id)<=0);
  const faible  = toOrder.filter(p=>getQty(p.id)>0);
  const summaryData = [
    ['Résumé — Lot d\'achat GoPlex'],
    [],
    ['Généré le', today],
    ['Catégorie', catName],
    [],
    ['Statut','Nombre de produits'],
    ['Rupture de stock', rupture.length],
    ['Stock faible', faible.length],
    ['Total à commander', toOrder.length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{wch:28},{wch:20}];
  // Title style
  if(wsSummary['A1']) wsSummary['A1'].s = {
    font:{bold:true, sz:14, color:{rgb:'C9A84C'}, name:'Calibri'},
    fill:{fgColor:{rgb:'1A1A1E'}},
  };
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé');

  // ── Download ─────────────────────────────────────────────
  const slug = supplierName ? ('fournisseur_'+supplierName.replace(/\s+/g,'_'))
             : catId ? catName.replace(/\s+/g,'_')
             : 'complet';
  const filename = `lot_dachat_${slug}_${today.replace(/\//g,'-')}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`✓ ${toOrder.length} produits — ${filename}`,'success');
}

// ── Export groupé : par fournisseur OU par catégorie ─────────
async function exportGroupedExcel(groupBy) {
  // groupBy: 'supplier' | 'category'
  const toOrder = products.filter(p =>
    p.alert_enabled !== false &&
    getQty(p.id) <= (p.alert_threshold ?? window._alertThreshold ?? 4)
  );
  if(!toOrder.length){ toast('Aucun produit à commander !','info'); return; }

  // Load SheetJS dynamically
  if(!window.XLSX) {
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
  }

  const today     = new Date().toLocaleDateString('fr-CA');
  const threshold = window._alertThreshold ?? 4;
  const isSupplier   = groupBy === 'supplier';
  const secondaryLbl = isSupplier ? 'Catégorie' : 'Fournisseur';
  const noneLbl      = isSupplier ? 'Sans fournisseur' : 'Sans catégorie';

  const keyOf = p => isSupplier
    ? (p.supplier || noneLbl)
    : (categories.find(c=>c.id===p.category_id)?.name || noneLbl);
  const secondaryOf = p => isSupplier
    ? (categories.find(c=>c.id===p.category_id)?.name || '—')
    : (p.supplier || '—');
  const sugOf = p => {
    const qty=Math.round(getQty(p.id));
    const seuil=p.alert_threshold ?? threshold;
    return Math.max(1,(seuil*2)-qty);
  };

  // Regrouper
  const groups = {};
  toOrder.forEach(p => { const k=keyOf(p); (groups[k]=groups[k]||[]).push(p); });
  const groupNames = Object.keys(groups).sort((a,b)=>{
    if(a===noneLbl) return 1;
    if(b===noneLbl) return -1;
    return a.localeCompare(b);
  });

  const wb = XLSX.utils.book_new();
  const headers = ['Produit','Référence',secondaryLbl,'Stock actuel','Seuil','Statut','Qté à commander','Notes'];
  const NCOL = headers.length;
  const wsData = [headers];
  const groupHeaderRows = [];
  const subtotalRows    = [];
  const dataRowProd     = {};   // rowIdx -> product

  groupNames.forEach(gName => {
    const list = groups[gName].sort((a,b)=>{
      const qa=getQty(a.id), qb=getQty(b.id);
      if(qa<=0&&qb>0) return -1;
      if(qb<=0&&qa>0) return 1;
      return a.name.localeCompare(b.name);
    });
    groupHeaderRows.push(wsData.length);
    wsData.push([`${gName}  —  ${list.length} produit${list.length>1?'s':''}`,'','','','','','','']);
    let grpTotal = 0;
    list.forEach(p=>{
      const qty=Math.round(getQty(p.id));
      const seuil=p.alert_threshold ?? threshold;
      const s=getStatus(qty,p.id);
      const sug=sugOf(p); grpTotal+=sug;
      dataRowProd[wsData.length]=p;
      wsData.push([p.name, p.reference||'—', secondaryOf(p), qty, seuil, s.label, sug, '']);
    });
    subtotalRows.push(wsData.length);
    wsData.push(['','','','','','Sous-total',grpTotal,'']);
    wsData.push(['','','','','','','','']); // espaceur
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{wch:32},{wch:16},{wch:20},{wch:14},{wch:10},{wch:14},{wch:18},{wch:28}];
  ws['!freeze'] = {xSplit:0, ySplit:1};
  ws['!merges'] = groupHeaderRows.map(r => ({s:{r,c:0}, e:{r,c:NCOL-1}}));

  // En-tête colonnes
  for(let c=0;c<NCOL;c++){
    const a=XLSX.utils.encode_cell({r:0,c});
    if(!ws[a]) continue;
    ws[a].s={fill:{fgColor:{rgb:'1A1A1E'}},font:{bold:true,color:{rgb:'C9A84C'},sz:11,name:'Calibri'},border:{bottom:{style:'medium',color:{rgb:'C9A84C'}}},alignment:{horizontal:'center',vertical:'center'}};
  }
  // En-têtes de groupe (or)
  groupHeaderRows.forEach(r=>{
    for(let c=0;c<NCOL;c++){
      const a=XLSX.utils.encode_cell({r,c});
      if(!ws[a]) ws[a]={t:'s',v:''};
      ws[a].s={fill:{fgColor:{rgb:'C9A84C'}},font:{bold:true,sz:12,color:{rgb:'1A1A1E'},name:'Calibri'},alignment:{horizontal:'left',vertical:'center'}};
    }
  });
  // Lignes produits
  Object.entries(dataRowProd).forEach(([rStr,p])=>{
    const row=+rStr;
    const qty=Math.round(getQty(p.id));
    const isOut=qty<=0;
    const bg=isOut?'FFEAEA':'FFF8E8';
    for(let c=0;c<NCOL;c++){
      const a=XLSX.utils.encode_cell({r:row,c});
      if(!ws[a]) ws[a]={t:'s',v:''};
      const isNumCol=c===3||c===4||c===6;
      let fontColor='333333';
      if(c===5) fontColor=isOut?'CC0000':'B85C00';
      if(c===6) fontColor='1A6B3C';
      ws[a].s={fill:{fgColor:{rgb:bg}},font:{name:'Calibri',sz:10,bold:c===0||c===6,color:{rgb:fontColor}},border:{bottom:{style:'thin',color:{rgb:'DDDDDD'}},right:{style:'thin',color:{rgb:'EEEEEE'}}},alignment:{horizontal:isNumCol?'center':'left',vertical:'center'}};
    }
  });
  // Lignes sous-total
  subtotalRows.forEach(r=>{
    for(let c=0;c<NCOL;c++){
      const a=XLSX.utils.encode_cell({r,c});
      if(!ws[a]) ws[a]={t:'s',v:''};
      ws[a].s={fill:{fgColor:{rgb:'EFEAD8'}},font:{name:'Calibri',sz:10,bold:true,color:{rgb:c===6?'1A6B3C':'555555'}},alignment:{horizontal:c===6?'center':'right',vertical:'center'},border:{top:{style:'thin',color:{rgb:'C9A84C'}}}};
    }
  });

  XLSX.utils.book_append_sheet(wb, ws, isSupplier?'Par fournisseur':'Par catégorie');

  // ── Onglet Résumé ────────────────────────────────────────
  const summaryData = [
    [`Lot d'achat — ${isSupplier?'par fournisseur':'par catégorie'}`],
    [],
    ['Généré le', today],
    [],
    [isSupplier?'Fournisseur':'Catégorie','Produits','Qté à commander'],
    ...groupNames.map(g=>[g, groups[g].length, groups[g].reduce((s,p)=>s+sugOf(p),0)]),
    [],
    ['Total', toOrder.length, toOrder.reduce((s,p)=>s+sugOf(p),0)],
  ];
  const wsSum = XLSX.utils.aoa_to_sheet(summaryData);
  wsSum['!cols']=[{wch:28},{wch:14},{wch:18}];
  if(wsSum['A1']) wsSum['A1'].s={font:{bold:true,sz:14,color:{rgb:'C9A84C'},name:'Calibri'},fill:{fgColor:{rgb:'1A1A1E'}}};
  // En-tête tableau résumé
  ['A5','B5','C5'].forEach(a=>{ if(wsSum[a]) wsSum[a].s={font:{bold:true,color:{rgb:'C9A84C'},name:'Calibri'},fill:{fgColor:{rgb:'1A1A1E'}},alignment:{horizontal:'center'}}; });
  XLSX.utils.book_append_sheet(wb, wsSum, 'Résumé');

  const filename = `lot_dachat_par_${isSupplier?'fournisseur':'categorie'}_${today.replace(/\//g,'-')}.xlsx`;
  XLSX.writeFile(wb, filename);
  toast(`✓ ${toOrder.length} produits groupés par ${isSupplier?'fournisseur':'catégorie'} — ${filename}`,'success');
}

function openInstructions(name, email, pw) {
  const appUrl  = 'https://goplex.vercel.app';
  const subject = encodeURIComponent('GoPlex Inventaire - Acces a l application');
  const bodyLines = [
    'Bonjour ' + name + ',',
    '',
    'Voici vos acces a l application GoPlex Inventaire :',
    '',
    'Lien : ' + appUrl,
    'Courriel : ' + email,
    'Mot de passe temporaire : ' + pw,
    '',
    '--- INSTALLER SUR IPHONE ---',
    '',
    '1. Ouvrez Safari sur votre iPhone',
    '2. Allez sur : ' + appUrl,
    '3. Connectez-vous avec vos identifiants',
    '4. Appuyez sur l icone Partager (en bas de l ecran)',
    '5. Faites defiler et tapez "Sur l ecran d accueil"',
    '6. Tapez "Ajouter"',
    '',
    'L icone GoPlex apparaitra sur votre ecran d accueil.',
    '',
    '--- SUR ORDINATEUR ---',
    '',
    'Ouvrez simplement ' + appUrl + ' dans votre navigateur.',
    '',
    'Pour toute question, contactez votre administrateur.',
    '',
    '- L equipe GoPlex'
  ];
  const body = encodeURIComponent(bodyLines.join('\n'));
  const mailtoLink = 'mailto:' + email + '?subject=' + subject + '&body=' + body;

  openModal('Compte créé — Envoyer les instructions', `
    <div style="background:var(--green-dim);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <i class="ti ti-check" style="color:var(--green);font-size:18px"></i>
        <span style="font-size:14px;font-weight:600;color:var(--green)">Compte créé avec succès</span>
      </div>
      <div style="font-size:13px;color:var(--text2)"><strong style="color:var(--text1)">${escHtml(name)}</strong> · ${escHtml(email)}</div>
    </div>

    <div style="font-size:13px;color:var(--text2);margin-bottom:16px">
      Voulez-vous envoyer les instructions d'accès et d'installation à cet utilisateur ?
    </div>

    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px;color:var(--text2);line-height:1.8">
      <div style="font-weight:600;color:var(--text1);margin-bottom:6px">Le courriel contiendra :</div>
      <div><i class="ti ti-link" style="color:var(--accent);margin-right:6px"></i>Lien vers l'app</div>
      <div><i class="ti ti-key" style="color:var(--accent);margin-right:6px"></i>Identifiants de connexion</div>
      <div><i class="ti ti-brand-apple" style="color:var(--accent);margin-right:6px"></i>Étapes pour installer sur iPhone (Safari → Partager → Écran d'accueil)</div>
      <div><i class="ti ti-device-desktop" style="color:var(--accent);margin-right:6px"></i>Instructions pour ordinateur</div>
    </div>
  `, [
    {label:'Plus tard', cls:'', action:'closeModal()'},
    {label:'<i class="ti ti-mail"></i> Ouvrir dans mon courriel', cls:'btn-primary', action:`window.open('${mailtoLink}');closeModal()`},
  ]);
}

// ══ LOT D'ACHAT — flux en 2 étapes ════════════════════════
function _alertProds(){
  return products.filter(p => p.alert_enabled!==false && getQty(p.id)<=(p.alert_threshold??window._alertThreshold??4));
}

// Étape 1 : choisir la dimension
function openExportModal() {
  const alertProds = _alertProds();
  if(!alertProds.length){ toast('Aucun produit à commander !','info'); return; }

  openModal("Lot d'achat", `
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px">
      ${alertProds.length} produit${alertProds.length>1?'s':''} en alerte — comment veux-tu trier ton lot d'achat ?
    </div>
    <div onclick="exportStepCategory()"
      style="display:flex;align-items:center;justify-content:space-between;padding:16px;
             background:var(--amber-dim);border:2px solid var(--amber);border-radius:12px;
             cursor:pointer;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <i class="ti ti-tag" style="color:var(--amber);font-size:22px"></i>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--amber)">Par catégorie</div>
          <div style="font-size:11px;color:var(--text3)">Toutes les catégories ou une catégorie précise</div>
        </div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--amber)"></i>
    </div>
    <div onclick="exportStepSupplier()"
      style="display:flex;align-items:center;justify-content:space-between;padding:16px;
             background:var(--green-dim);border:2px solid var(--green);border-radius:12px;
             cursor:pointer">
      <div style="display:flex;align-items:center;gap:12px">
        <i class="ti ti-truck" style="color:var(--green);font-size:22px"></i>
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--green)">Par fournisseur</div>
          <div style="font-size:11px;color:var(--text3)">Tous les fournisseurs ou un fournisseur précis</div>
        </div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--green)"></i>
    </div>
  `, [{label:'Fermer', cls:'', action:'closeModal()'}]);
}

// Étape 2A : par catégorie
function exportStepCategory() {
  const alertProds = _alertProds();
  if(!alertProds.length){ toast('Aucun produit à commander !','info'); return; }

  const catCounts = {};
  alertProds.forEach(p => { const k = p.category_id || '__none__'; catCounts[k]=(catCounts[k]||0)+1; });
  const catOptions = Object.entries(catCounts)
    .sort((a,b)=>b[1]-a[1])
    .map(([cid, cnt]) => {
      const cat = cid==='__none__' ? 'Sans catégorie' : (categories.find(c=>c.id==cid)?.name||'?');
      return `<div onclick="exportCommandeExcel(${cid==='__none__'?'null':cid});closeModal()"
        style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
               background:var(--bg2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s"
        onmouseover="this.style.borderColor='var(--amber)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:10px">
          <i class="ti ti-tag" style="color:var(--amber);font-size:16px"></i>
          <span style="font-size:14px;font-weight:500">${escHtml(cat)}</span>
        </div>
        <span class="badge badge-amber">${cnt} produit${cnt>1?'s':''}</span>
      </div>`;
    }).join('');

  openModal("Lot d'achat — par catégorie", `
    <div onclick="exportCommandeExcel(null);closeModal()"
      style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;
             background:var(--accent-bg);border:2px solid var(--accent);border-radius:10px;cursor:pointer;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-file-spreadsheet" style="color:var(--accent);font-size:20px"></i>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--accent)">Toutes les catégories</div>
          <div style="font-size:11px;color:var(--text3)">Liste complète de tous les produits à commander</div>
        </div>
      </div>
      <span class="badge badge-orange">${alertProds.length} produits</span>
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;margin-bottom:8px">Une catégorie précise</div>
    <div style="display:flex;flex-direction:column;gap:6px">${catOptions}</div>
  `, [{label:'← Retour', cls:'', action:'openExportModal()'},{label:'Fermer', cls:'', action:'closeModal()'}]);
}

// Étape 2B : par fournisseur
function exportStepSupplier() {
  const alertProds = _alertProds();
  if(!alertProds.length){ toast('Aucun produit à commander !','info'); return; }
  const jsStr = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

  const supCounts = {};
  alertProds.forEach(p => { const k = p.supplier || '__none__'; supCounts[k]=(supCounts[k]||0)+1; });
  const supOptions = Object.entries(supCounts)
    .sort((a,b)=>b[1]-a[1])
    .map(([name, cnt]) => {
      const isNone = name==='__none__';
      const label  = isNone ? 'Sans fournisseur' : name;
      const arg    = isNone ? "''" : `'${jsStr(name)}'`;
      return `<div onclick="exportCommandeExcel(null,${arg});closeModal()"
        style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
               background:var(--bg2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s"
        onmouseover="this.style.borderColor='var(--green)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:10px">
          <i class="ti ti-truck" style="color:var(--green);font-size:16px"></i>
          <span style="font-size:14px;font-weight:500">${escHtml(label)}</span>
        </div>
        <span class="badge badge-green">${cnt} produit${cnt>1?'s':''}</span>
      </div>`;
    }).join('');

  openModal("Lot d'achat — par fournisseur", `
    <div onclick="exportGroupedExcel('supplier');closeModal()"
      style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;
             background:var(--green-dim);border:2px solid var(--green);border-radius:10px;cursor:pointer;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px">
        <i class="ti ti-file-spreadsheet" style="color:var(--green);font-size:20px"></i>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--green)">Tous les fournisseurs</div>
          <div style="font-size:11px;color:var(--text3)">Un seul fichier groupé par fournisseur, avec sous-totaux</div>
        </div>
      </div>
      <span class="badge badge-green">${alertProds.length} produits</span>
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;margin-bottom:8px">Un fournisseur précis</div>
    <div style="display:flex;flex-direction:column;gap:6px">${supOptions}</div>
  `, [{label:'← Retour', cls:'', action:'openExportModal()'},{label:'Fermer', cls:'', action:'closeModal()'}]);
}


document.addEventListener('keydown',e=>{
  if(e.key==='F2'||(e.ctrlKey&&e.key==='b')){e.preventDefault();openBarcodeScanner(currentView);}
  if(e.key==='Escape'&&document.getElementById('bc-overlay').classList.contains('show')) closeBc();
});

// ══════════════════════════════════════════════════════════
// Resize handler — switch inventory view on screen change
window.addEventListener('resize', ()=>{
  if(currentView==='inventory') vInventory(document.getElementById('main-content'));
});

// INIT
// ══════════════════════════════════════════════════════════
(async()=>{
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user) await onSignedIn(session.user);
  sb.auth.onAuthStateChange(async(event,session)=>{
    if(event==='SIGNED_IN'&&session?.user&&!user) await onSignedIn(session.user);
    // Ignore USER_UPDATED and other events that fire during account creation
  });
})();

// ══════════════════════════════════════════════════════════
// PWA — enregistrement du service worker (cache hors-ligne)
// ══════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e.message));
  });
}

