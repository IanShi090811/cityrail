;/* CityRail real-world network importer. Opens idle; fetches compact OSM route data only on demand. */
(function(){
  'use strict';
  const W = window, D = document;
  const VERSION = 'v487-rail-graph-route-geometry';
  if (W.CityRailRealNetworkImporter && W.CityRailRealNetworkImporter.version === VERSION) return;

  const PRESETS = [
    { id:'shanghai', name:'上海', bbox:[31.05,121.25,31.45,121.65] },
    { id:'beijing', name:'北京', bbox:[39.55,115.85,40.30,117.05] },
    { id:'guangzhou', name:'广州', bbox:[22.75,113.05,23.55,113.85] },
    { id:'shenzhen', name:'深圳', bbox:[22.35,113.70,22.90,114.65] },
    { id:'chengdu', name:'成都', bbox:[30.35,103.75,30.95,104.35] },
    { id:'chongqing', name:'重庆', bbox:[29.35,106.20,29.85,106.85] },
    { id:'wuhan', name:'武汉', bbox:[30.30,114.00,30.80,114.65] },
    { id:'nanjing', name:'南京', bbox:[31.85,118.55,32.20,119.05] },
    { id:'hangzhou', name:'杭州', bbox:[30.05,119.95,30.45,120.45] },
    { id:'xian', name:'西安', bbox:[34.05,108.65,34.45,109.25] },
    { id:'suzhou', name:'苏州', bbox:[31.05,120.35,31.55,120.95] },
    { id:'tianjin', name:'天津', bbox:[38.85,116.85,39.35,117.65] },
    { id:'zhengzhou', name:'郑州', bbox:[34.50,113.35,34.95,114.10] },
    { id:'qingdao', name:'青岛', bbox:[35.85,119.85,36.45,120.75] },
    { id:'changsha', name:'长沙', bbox:[27.95,112.65,28.40,113.25] },
    { id:'shenyang', name:'沈阳', bbox:[41.55,123.15,42.05,123.75] },
    { id:'dalian', name:'大连', bbox:[38.75,121.25,39.15,122.10] },
    { id:'current', name:'当前地图视野', bbox:null },
  ];
  const MAX_IMPORT_ROUTES = 80;
  const MAX_BBOX_SPAN = 1.9;
  let importPlan = null;
  let previewLayer = null;
  let isLoading = false;

  function byId(id){ return D.getElementById(id); }
  function sid(value){ return String(value == null ? '' : value); }
  function num(value, fallback){
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }
  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function appState(){
    try { if (W.CityRail && W.CityRail.state && typeof W.CityRail.state.get === 'function') return W.CityRail.state.get(); } catch(e) {}
    return W.state || {};
  }
  function stations(){ const st = appState(); return Array.isArray(st.stations) ? st.stations : []; }
  function lines(){ const st = appState(); return Array.isArray(st.lines) ? st.lines : []; }
  function meters(a, b){
    if (!a || !b) return Infinity;
    try { if (typeof W.haversine === 'function') return W.haversine(num(a.lat), num(a.lng), num(b.lat), num(b.lng)) * 1000; } catch(e) {}
    const r = 6371000;
    const lat1 = num(a.lat) * Math.PI / 180;
    const lat2 = num(b.lat) * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLng = (num(b.lng) - num(a.lng)) * Math.PI / 180;
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return r * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  }
  function cleanName(name){
    return String(name || '').replace(/\s+/g, '').replace(/站$/u, '').replace(/Station$/i, '').replace(/[()（）［］\[\]【】]/g, '').toLowerCase();
  }
  function nextId(prefix){
    try { if (typeof W.genId === 'function') return W.genId(); } catch(e) {}
    try { if (typeof genId === 'function') return genId(); } catch(e) {}
    return (prefix || 'osm') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function validBbox(bbox){
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;
    const n = bbox.map(Number);
    if (n.some(v => !Number.isFinite(v))) return false;
    return n[0] >= -90 && n[2] <= 90 && n[1] >= -180 && n[3] <= 180 && n[0] < n[2] && n[1] < n[3]
      && (n[2] - n[0]) <= MAX_BBOX_SPAN && (n[3] - n[1]) <= MAX_BBOX_SPAN;
  }
  function currentMapBbox(){
    try {
      if (!W.map || typeof W.map.getBounds !== 'function') return null;
      const b = W.map.getBounds();
      return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
    } catch(e) { return null; }
  }
  function selectedPreset(){
    const select = byId('cr-rni-city');
    return PRESETS.find(item => item.id === (select && select.value)) || PRESETS[0];
  }
  function bboxForSelection(){
    const preset = selectedPreset();
    const bbox = preset.id === 'current' ? currentMapBbox() : preset.bbox;
    if (!validBbox(bbox)) return null;
    return bbox.map(v => Math.round(Number(v) * 1000000) / 1000000);
  }
  function apiUrl(bbox){
    const localStaticPreview = W.location && /^https?:$/.test(W.location.protocol) &&
      /^(127\.0\.0\.1|localhost)$/i.test(W.location.hostname || '') &&
      !/^(3011|8080)$/.test(String(W.location.port || ''));
    const base = (W.location && W.location.protocol === 'file:') || localStaticPreview
      ? 'http://127.0.0.1:3011'
      : '';
    return base + '/api/osm/rail-network?bbox=' + encodeURIComponent(bbox.join(',')) + '&v=20260716-v487-rail-graph-route-geometry';
  }
  function setText(id, text){
    const el = byId(id);
    if (el) el.textContent = String(text);
  }
  function setStatus(text, isError){
    const el = byId('cr-rni-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }
  function setLoading(value){
    isLoading = !!value;
    D.querySelectorAll('#cr-rni-panel [data-rni-act]').forEach(btn => {
      if (btn.dataset.rniAct !== 'close') btn.disabled = isLoading;
    });
  }
  function trimTerminalInfo(value){
    let text = sid(value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.replace(/[（(【\[]([^）)】\]]*(?:=>|→|↔|⇄|<->| - | – | — |--|至|到)[^）)】\]]*)[）)】\]]/g, '').trim();
    text = text.split(/\s*(?:[:：]|=>|→|↔|⇄|<->| - | – | — | -- )\s*/)[0].trim();
    return text;
  }
  function normalizeRouteServiceName(value){
    let text = trimTerminalInfo(value);
    if (!text) return '';
    text = text
      .replace(/^.*?(?:地铁|軌道交通|轨道交通|市域铁路|市郊铁路)\s*/u, '')
      .replace(/^(?:Metro|Subway|Underground|MRT|LRT)\s+/i, '')
      .replace(/^(?:Line|线路|路線|路线)\s*/i, '')
      .replace(/\bLine\b/ig, '线')
      .replace(/\s*线$/u, '线')
      .replace(/\s+/g, '')
      .trim();
    const numeric = text.match(/^0*(\d+[A-Za-z]?)$/);
    if (numeric) return numeric[1].toUpperCase() + '号线';
    if (/^(?:OSM|线路)$/i.test(text)) return '';
    return /线$/u.test(text) ? text : text + '线';
  }
  function routeServiceName(route){
    const fromName = normalizeRouteServiceName(route && route.name);
    let base = fromName;
    if (!base) {
      const ref = sid(route && route.ref).trim();
      if (ref) {
        const numeric = ref.match(/^0*(\d+[A-Za-z]?)$/);
        base = numeric ? numeric[1].toUpperCase() + '号线' : (/线$/u.test(ref) ? ref : ref + '线');
      }
    }
    if (!base) base = '真实线网线路';
    if (route && route.variantRole === 'branch') {
      const suffix = Math.max(1, Math.round(num(route.branchIndex, 1))) > 1 ? '支线' + Math.round(num(route.branchIndex, 1)) : '支线';
      return /支线\d*$/u.test(base) ? base : base + suffix;
    }
    return base;
  }
  function routeCategoryLabel(route){
    const key = sid(route && route.routeCategory);
    const map = {
      metro:'地铁',
      light_rail:'轻轨',
      monorail:'单轨',
      maglev:'磁浮',
      tram:'有轨',
      suburban_rail:'市郊/市域',
      intercity_rail:'城际',
      regional_urban_rail:'区域轨道',
    };
    return map[key] || '';
  }
  function installStyle(){
    if (byId('cityrail-real-network-importer-style')) return;
    const style = D.createElement('style');
    style.id = 'cityrail-real-network-importer-style';
    style.textContent = `
      #new-build-choice.cr-rni-build-choice,
      #new-build-choice.cr-rni-build-choice.cr269-has-connector{grid-template-columns:repeat(5,minmax(112px,1fr))!important;width:min(1040px,calc(100vw - 112px))!important;min-width:0!important;overflow:visible!important;}
      #new-build-real-network{display:grid!important;grid-template-rows:auto auto auto!important;align-content:center!important;justify-items:center!important;row-gap:8px!important;text-align:center!important;min-width:0!important;}
      #new-build-real-network .new-build-icon{display:flex!important;background:rgba(10,132,255,.18);color:#8cc8ff;}
      #new-build-real-network strong{display:block!important;font-size:16px;font-weight:780;line-height:1.1;white-space:nowrap;}
      #new-build-real-network small{display:block!important;max-width:132px!important;text-align:center!important;line-height:1.28!important;white-space:normal!important;}
      .cr-rni-panel{--cr-object-accent:#0a84ff;position:fixed;right:18px;top:76px;bottom:86px;z-index:2147481500;width:min(520px,calc(100vw - 36px));display:flex;flex-direction:column;border-radius:20px;background:var(--cr-object-bg,rgba(12,14,18,.88));border:1px solid var(--cr-object-border,rgba(255,255,255,.13));box-shadow:none;backdrop-filter:blur(12px) saturate(126%);-webkit-backdrop-filter:blur(12px) saturate(126%);color:var(--cr-object-text,#f8fafc);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Microsoft YaHei",sans-serif;letter-spacing:0;}
      .cr-rni-panel.hidden{display:none;}
      .cr-rni-head{display:grid;grid-template-columns:minmax(0,1fr)34px;gap:12px;align-items:center;padding:28px 20px 16px;border-bottom:1px solid var(--cr-object-line,rgba(255,255,255,.095));}
      .cr-rni-title{font-size:28px;font-weight:880;line-height:1.08;color:var(--cr-object-text,#f8fafc);}
      .cr-rni-close{width:34px;height:34px;border:1px solid var(--cr-object-border,rgba(255,255,255,.13));border-radius:999px;background:rgba(255,255,255,.055);color:var(--cr-object-muted,rgba(235,241,248,.62));font-size:18px;cursor:pointer;box-shadow:none;}
      .cr-rni-body{padding:12px 20px 14px;overflow:auto;display:flex;flex-direction:column;gap:12px;min-height:0;scrollbar-gutter:stable;}
      .cr-rni-field{display:flex;flex-direction:column;gap:8px;border:1px solid var(--cr-object-border,rgba(255,255,255,.13));border-left-color:var(--cr-object-accent,#0a84ff);border-radius:12px;background:var(--cr-object-card,rgba(18,21,27,.76));padding:12px;box-shadow:none;}
      .cr-rni-field label{font-size:12px;font-weight:820;color:var(--cr-object-muted,rgba(235,241,248,.62));}
      .cr-rni-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;}
      .cr-rni-select{height:34px;border-radius:8px;border:1px solid var(--cr-object-line,rgba(255,255,255,.095))!important;background:rgba(4,7,11,.30)!important;color:var(--cr-object-text,#f8fafc)!important;padding:0 10px;font:650 13px/34px inherit;outline:0;box-shadow:none!important;min-width:0;}
      .cr-rni-select option{background:#11151b;color:#f8fafc;}
      .cr-rni-btn{height:34px;border-radius:8px;border:1px solid var(--cr-object-border,rgba(255,255,255,.13));background:rgba(255,255,255,.055);color:var(--cr-object-text,#f8fafc);font-size:13px;font-weight:780;cursor:pointer;box-shadow:none;padding:0 12px;white-space:nowrap;}
      .cr-rni-btn.primary{background:var(--cr-object-accent,#0a84ff);border-color:var(--cr-object-accent,#0a84ff);color:#fff;}
      .cr-rni-btn:disabled{opacity:.45;cursor:not-allowed;}
      .cr-rni-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
      .cr-rni-kpi{min-height:58px;border-radius:10px;padding:9px;background:rgba(5,8,12,.28);border:1px solid var(--cr-object-line,rgba(255,255,255,.095));}
      .cr-rni-kpi b{display:block;font-size:16px;line-height:1.1;margin-bottom:5px;color:var(--cr-object-text,#f8fafc);font-variant-numeric:tabular-nums;}
      .cr-rni-kpi span{display:block;font-size:10px;color:var(--cr-object-faint,rgba(235,241,248,.42));font-weight:760;}
      .cr-rni-list{display:flex;flex-direction:column;gap:7px;}
      .cr-rni-line{display:grid;grid-template-columns:20px 12px minmax(0,1fr) auto;gap:8px;align-items:center;min-height:42px;padding:8px 9px;border-radius:10px;background:rgba(5,8,12,.28);border:1px solid var(--cr-object-line,rgba(255,255,255,.095));}
      .cr-rni-line input{accent-color:var(--cr-object-accent,#0a84ff);}
      .cr-rni-swatch{width:12px;height:12px;border-radius:999px;background:var(--line-color,#0a84ff);box-shadow:0 0 0 2px rgba(255,255,255,.13);}
      .cr-rni-name{font-size:13px;font-weight:820;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--cr-object-text,#f8fafc);}
      .cr-rni-meta{font-size:10px;color:var(--cr-object-faint,rgba(235,241,248,.42));margin-top:2px;}
      .cr-rni-badge{font-size:11px;font-weight:820;color:var(--cr-object-muted,rgba(235,241,248,.62));font-variant-numeric:tabular-nums;}
      .cr-rni-status{min-height:18px;font-size:12px;line-height:1.45;color:var(--cr-object-muted,rgba(235,241,248,.62));}
      .cr-rni-status.error{color:#ffb4ad;}
      .cr-rni-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:12px 20px 18px;border-top:1px solid var(--cr-object-line,rgba(255,255,255,.095));background:rgba(9,11,15,.82);backdrop-filter:blur(10px) saturate(120%);-webkit-backdrop-filter:blur(10px) saturate(120%);}
      .cr-rni-preview-station{width:10px;height:10px;border-radius:999px;border:2px solid #fff;background:#0a84ff;box-shadow:0 0 0 2px rgba(10,132,255,.35);}
      html.cityrail-light-ui .cr-rni-panel{background:rgba(255,255,255,.94);border-color:rgba(0,0,0,.10);color:#1d1d1f;}
      html.cityrail-light-ui .cr-rni-select{background:#fff!important;color:#1d1d1f!important;border-color:rgba(0,0,0,.12)!important;}
      html.cityrail-light-ui .cr-rni-select option{background:#fff;color:#1d1d1f;}
      @media(max-width:760px){#new-build-choice.cr-rni-build-choice,#new-build-choice.cr-rni-build-choice.cr269-has-connector{grid-template-columns:repeat(5,minmax(84px,1fr))!important;width:100%!important;}.cr-rni-panel{left:10px;right:10px;top:auto;bottom:84px;width:auto;max-height:min(68vh,620px);}.cr-rni-actions{grid-template-columns:1fr;}.cr-rni-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}}
    `;
    D.head.appendChild(style);
  }
  function ensurePanel(){
    let panel = byId('cr-rni-panel');
    if (panel) return panel;
    panel = D.createElement('aside');
    panel.id = 'cr-rni-panel';
    panel.className = 'cr-rni-panel cityrail-object-panel hidden';
    panel.innerHTML = `
      <div class="cr-rni-head cityrail-object-panel-head">
        <div><div class="cr-rni-title">真实线网导入</div></div>
        <button type="button" class="cr-rni-close" data-rni-act="close" aria-label="关闭">×</button>
      </div>
      <div class="cr-rni-body cityrail-object-panel-body">
        <div class="cr-rni-field">
          <label for="cr-rni-city">城市范围</label>
          <div class="cr-rni-row"><select id="cr-rni-city" class="cr-rni-select"></select><button type="button" class="cr-rni-btn" data-rni-act="use-view">当前视野</button></div>
        </div>
        <div class="cr-rni-field">
          <label>读取结果</label>
          <div class="cr-rni-kpis">
            <div class="cr-rni-kpi"><b id="cr-rni-kpi-lines">0</b><span>线路</span></div>
            <div class="cr-rni-kpi"><b id="cr-rni-kpi-stations">0</b><span>车站</span></div>
            <div class="cr-rni-kpi"><b id="cr-rni-kpi-nodes">0</b><span>节点</span></div>
          </div>
        </div>
        <div class="cr-rni-field">
          <label>导入线路</label>
          <div id="cr-rni-list" class="cr-rni-list"><div class="cr-rni-status">未加载</div></div>
        </div>
        <div id="cr-rni-status" class="cr-rni-status"></div>
      </div>
      <div class="cr-rni-actions cityrail-object-panel-actions">
        <button type="button" class="cr-rni-btn" data-rni-act="load">获取</button>
        <button type="button" class="cr-rni-btn" data-rni-act="preview">预览</button>
        <button type="button" class="cr-rni-btn primary" data-rni-act="import">导入选中</button>
      </div>`;
    D.body.appendChild(panel);
    const select = panel.querySelector('#cr-rni-city');
    select.innerHTML = PRESETS.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    return panel;
  }
  function applyBuildChoiceLayout(choice){
    const el = choice || byId('new-build-choice');
    if (!el) return;
    const compact = W.innerWidth <= 760;
    el.style.setProperty('grid-template-columns', compact ? 'repeat(5,minmax(84px,1fr))' : 'repeat(5,minmax(112px,1fr))', 'important');
    el.style.setProperty('width', compact ? '100%' : 'min(1040px,calc(100vw - 112px))', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  }
  function ensureBuildEntry(){
    const choice = byId('new-build-choice');
    if (!choice) return false;
    choice.classList.add('cr-rni-build-choice');
    applyBuildChoiceLayout(choice);
    if (byId('new-build-real-network')) return true;
    const btn = D.createElement('button');
    btn.type = 'button';
    btn.id = 'new-build-real-network';
    btn.dataset.action = 'new-build-real-network';
    btn.innerHTML = '<span class="new-build-icon" aria-hidden="true">◎</span><strong>真实线网</strong><small>复刻真实线路、车站、节点</small>';
    choice.appendChild(btn);
    applyBuildChoiceLayout(choice);
    return true;
  }
  function showPanel(){
    installStyle();
    ensurePanel().classList.remove('hidden');
    const overlay = byId('new-line-dialog-overlay');
    const choice = byId('new-build-choice');
    if (overlay) overlay.classList.add('hidden');
    if (choice) choice.classList.add('hidden');
  }
  function hidePanel(){
    const panel = byId('cr-rni-panel');
    if (panel) panel.classList.add('hidden');
  }
  function selectedRoutes(){
    const routes = importPlan && Array.isArray(importPlan.routes) ? importPlan.routes : [];
    const checked = Array.from(D.querySelectorAll('#cr-rni-list [data-rni-route]:checked')).map(el => Number(el.value));
    return routes.filter((_, index) => checked.includes(index)).slice(0, MAX_IMPORT_ROUTES);
  }
  function renderKpis(){
    const selected = selectedRoutes();
    const stationKeys = new Set();
    const nodes = selected.reduce((sum, route) => {
      (route.stations || []).forEach(st => stationKeys.add(cleanName(st.name) + ':' + Math.round(num(st.lat) * 10000) + ':' + Math.round(num(st.lng) * 10000)));
      return sum + (route.waypoints ? route.waypoints.length : 0);
    }, 0);
    setText('cr-rni-kpi-lines', selected.length);
    setText('cr-rni-kpi-stations', stationKeys.size);
    setText('cr-rni-kpi-nodes', nodes);
  }
  function renderList(){
    const list = byId('cr-rni-list');
    if (!list) return;
    const routes = importPlan && Array.isArray(importPlan.routes) ? importPlan.routes : [];
    if (!routes.length) {
      list.innerHTML = '<div class="cr-rni-status">没有可导入线路</div>';
      renderKpis();
      return;
    }
    list.innerHTML = routes.map((route, index) => `
      <label class="cr-rni-line" style="--line-color:${esc(route.color || '#0a84ff')}">
        <input type="checkbox" data-rni-route value="${index}" ${index < MAX_IMPORT_ROUTES ? 'checked' : ''}>
        <span class="cr-rni-swatch"></span>
        <span><span class="cr-rni-name">${esc(routeServiceName(route))}</span><span class="cr-rni-meta">${esc(route.network || route.route || 'OSM')} · ${esc(route.ref || ('#' + route.relationId))}${route.variantRole === 'branch' && route.branchJunctionName ? ' · 接入 ' + esc(route.branchJunctionName) : ''}</span></span>
        <span class="cr-rni-badge">${routeCategoryLabel(route) ? esc(routeCategoryLabel(route)) + ' · ' : ''}${(route.stations || []).length}站${route.variantRole === 'branch' ? ' · 支线' : (route.variantRole === 'section' ? ' · 区段' : '')}${routeIsLoop(route) ? ' · 环线' : ''}</span>
      </label>`).join('');
    list.querySelectorAll('[data-rni-route]').forEach(input => input.addEventListener('change', () => {
      renderKpis();
      previewSelected();
    }));
    renderKpis();
  }
  async function loadNetwork(){
    if (isLoading) return;
    const bbox = bboxForSelection();
    if (!bbox) { setStatus('当前没有可用地图范围', true); return; }
    clearPreview();
    setLoading(true);
    setStatus('正在读取真实线路数据…');
    try {
      const response = await fetch(apiUrl(bbox), { method:'GET', headers:{ accept:'application/json' }, cache:'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok === false) throw new Error(data && data.error ? data.error : '读取失败');
      importPlan = { bbox, routes:Array.isArray(data.routes) ? data.routes : [], summary:data.summary || {}, loadedAt:Date.now() };
      renderList();
      setStatus(importPlan.routes.length ? '已读取 ' + importPlan.routes.length + ' 条线路' : '该范围没有找到可导入线路', !importPlan.routes.length);
      previewSelected();
    } catch(e) {
      importPlan = null;
      renderList();
      setStatus('读取失败：' + ((e && e.message) || e), true);
    } finally {
      setLoading(false);
    }
  }
  function clearPreview(){
    try { if (previewLayer && W.map && W.map.removeLayer) W.map.removeLayer(previewLayer); } catch(e) {}
    previewLayer = null;
  }
  function previewSelected(){
    clearPreview();
    const selected = selectedRoutes();
    if (!selected.length || !W.L || !W.map) { renderKpis(); return; }
    previewLayer = W.L.layerGroup().addTo(W.map);
    const bounds = [];
    selected.forEach(route => {
      const color = route.color || '#0a84ff';
      const points = [];
      const loop = routeIsLoop(route);
      const closureSegIdx = (route.stations || []).length - 1;
      (route.stations || []).forEach((station, i) => {
        points.push([station.lat, station.lng]);
        bounds.push([station.lat, station.lng]);
        (route.waypoints || []).filter(w => Math.round(num(w.segIdx)) === i && !(loop && i === closureSegIdx)).sort((a, b) => num(a.order) - num(b.order)).forEach(w => {
          points.push([w.lat, w.lng]);
          bounds.push([w.lat, w.lng]);
        });
      });
      if (loop && (route.stations || []).length > 2) {
        const first = route.stations[0];
        (route.waypoints || []).filter(w => Math.round(num(w.segIdx)) === closureSegIdx).sort((a, b) => num(a.order) - num(b.order)).forEach(w => {
          points.push([w.lat, w.lng]);
          bounds.push([w.lat, w.lng]);
        });
        points.push([first.lat, first.lng]);
      }
      if (points.length > 1) W.L.polyline(points, { color, weight:5, opacity:.82, dashArray:'7 6', interactive:false }).addTo(previewLayer);
      (route.stations || []).forEach(st => {
        const icon = W.L.divIcon({ className:'', html:'<div class="cr-rni-preview-station"></div>', iconSize:[10,10], iconAnchor:[5,5] });
        W.L.marker([st.lat, st.lng], { icon, interactive:false }).addTo(previewLayer);
      });
    });
    try { if (bounds.length && W.L.latLngBounds) W.map.fitBounds(W.L.latLngBounds(bounds), { padding:[42,42], animate:false }); } catch(e) {}
    renderKpis();
  }
  function findStation(candidate){
    const platformKey = sid(candidate && candidate.platformKey);
    return stations().find(st => {
      const source = st && st.sourceImport || {};
      if (platformKey && sid(source.platformKey) === platformKey) return true;
      const refs = new Set((candidate.osmRefs || []).map(sid));
      const existingRefs = Array.isArray(st.sourceOsmRefs) ? st.sourceOsmRefs.map(sid) : [];
      return existingRefs.some(ref => refs.has(ref)) && meters(st, candidate) < 6;
    }) || null;
  }
  function populationFor(candidate){
    try { if (typeof W.cityrailInitialStationPopulation === 'function') return W.cityrailInitialStationPopulation(candidate.lat, candidate.lng, candidate.name); } catch(e) {}
    try { if (typeof cityrailInitialStationPopulation === 'function') return cityrailInitialStationPopulation(candidate.lat, candidate.lng, candidate.name); } catch(e) {}
    return 1000;
  }
  function zoneTypesFor(candidate){
    try { if (typeof W.inferZoneTypesByArea === 'function') return W.inferZoneTypesByArea(candidate.lat, candidate.lng, { name:candidate.name }); } catch(e) {}
    try { if (typeof inferZoneTypesByArea === 'function') return inferZoneTypesByArea(candidate.lat, candidate.lng, { name:candidate.name }); } catch(e) {}
    return ['residential'];
  }
  function ensureStation(candidate){
    const existing = findStation(candidate);
    if (existing) {
      existing.sourceOsmRefs = Array.from(new Set([...(existing.sourceOsmRefs || []), ...(candidate.osmRefs || [])]));
      return existing;
    }
    const zoneTypes = zoneTypesFor(candidate);
    const station = {
      id: nextId('station'),
      name: candidate.name,
      lat: candidate.lat,
      lng: candidate.lng,
      population: populationFor(candidate),
      zoneTypes,
      zoneType: zoneTypes[0] || 'residential',
      sourceOsmRefs: Array.from(new Set(candidate.osmRefs || [])),
      sourceImport: {
        type:'osm-overpass-platform',
        platformKey:candidate.platformKey || '',
        transferKey:candidate.transferKey || cleanName(candidate.name),
        rawLat:candidate.rawLat,
        rawLng:candidate.rawLng,
        importedAt:Date.now()
      },
      __transferSameName:true,
      __cityrailAutoZoneVersion:'v302-realistic-multi-zone',
    };
    try { if (typeof W.applyCityStationRealism === 'function') W.applyCityStationRealism(station); else if (typeof applyCityStationRealism === 'function') applyCityStationRealism(station); } catch(e) {}
    stations().push(station);
    return station;
  }
  function colorFor(route){
    if (route.color) return route.color;
    try { if (typeof W.getNextColor === 'function') return W.getNextColor(); } catch(e) {}
    try { if (typeof getNextColor === 'function') return getNextColor(); } catch(e) {}
    return '#0a84ff';
  }
  function alreadyImported(route){
    const relationId = sid(route && route.relationId);
    return !!relationId && lines().some(line => sid(line && line.sourceImport && line.sourceImport.relationId) === relationId);
  }
  function routeIsLoop(route){
    return !!(route && (route.isLoop || route.loopMode === 'closed-ring' || route.closedLoop || route.isCircular));
  }
  function applyLoopOperation(line, route){
    if (!line || !routeIsLoop(route) || !Array.isArray(line.stationIds) || line.stationIds.length < 3) return;
    while (line.stationIds.length > 2 && sid(line.stationIds[line.stationIds.length - 1]) === sid(line.stationIds[0])) {
      line.stationIds.pop();
    }
    line.__loopChoice = 'loop';
    line.__loopCandidate = false;
    line.isLoop = true;
    line.loopMode = 'closed-ring';
    line.loopClosedExplicit = true;
    line.loopStartStationId = line.stationIds[0];
    line.loopEndStationId = line.stationIds[0];
    line.loopDirection = 0;
    line.loopTerminalDistanceM = Math.max(0, Math.round(num(route.loopTerminalDistanceM, 0)));
  }
  function makeLine(route, stationIds, waypoints){
    const line = {
      id: nextId('line'),
      name: routeServiceName(route),
      color: colorFor(route),
      stationIds,
      waypoints,
      trainType:'A',
      cars:6,
      speed:80,
      trackMode:'double',
      trackCount:2,
      trackOperation:'directional-pair',
      firstTrain:6,
      lastTrain:22,
      offPeakHeadwayMin: 6,
      normalHeadwayMin: 4,
      peakHeadwayMin: 2,
      _headwayManual:false,
      pathMode:'ordered',
	      requiresRealDepot:true,
	      sourceImport: { type:'osm-overpass', relationId:route.relationId, ref:route.ref || '', network:route.network || '', routeCategory:route.routeCategory || '', originalName:route.name || '', variantRole:route.variantRole || 'main', branchBaseKey:route.branchBaseKey || route.key || '', branchIndex:Math.max(0, Math.round(num(route.branchIndex, 0))), branchJunctionName:route.branchJunctionName || '', isLoop:routeIsLoop(route), loopReason:route.loopReason || '', importedAt:Date.now(), version:VERSION },
	    };
	    if (route && route.variantRole === 'branch') {
	      line.branchTransferPenalty = 2;
	      line.realNetworkBranchRole = 'branch';
	      line.realNetworkBranchBaseKey = route.branchBaseKey || route.key || '';
	      line.realNetworkBranchIndex = Math.max(1, Math.round(num(route.branchIndex, 1)));
	    } else if (route && route.variantRole === 'section') {
	      line.realNetworkBranchRole = 'section';
	      line.realNetworkBranchBaseKey = route.branchBaseKey || route.key || '';
	      line.realNetworkBranchIndex = Math.max(1, Math.round(num(route.branchIndex, 1)));
	    } else if (route && route.branchGroupSize > 1) {
	      line.realNetworkBranchRole = 'main';
	      line.realNetworkBranchBaseKey = route.branchBaseKey || route.key || '';
	    }
    applyLoopOperation(line, route);
    try { if (typeof W.cityrailNormalizeLineIdentity === 'function') W.cityrailNormalizeLineIdentity(line, 'real-network-import'); } catch(e) {}
    return line;
  }
  function remapWaypoints(route, oldToNewSeg){
    return (route.waypoints || []).map(w => {
      const segIdx = oldToNewSeg.get(Math.round(num(w.segIdx)));
      if (segIdx == null) return null;
      return { id:nextId('wp'), lat:num(w.lat), lng:num(w.lng), segIdx, order:num(w.order), sourceImport:'osm-overpass' };
    }).filter(Boolean);
  }
  function transferPairKey(aId, bId, lineAId, lineBId){
    const stationsKey = [sid(aId), sid(bId)].sort().join('~');
    const linesKey = [sid(lineAId), sid(lineBId)].sort().join('|');
    return stationsKey + '|' + linesKey;
  }
  function hasVirtualTransfer(aId, bId, lineAId, lineBId){
    const key = transferPairKey(aId, bId, lineAId, lineBId);
    const st = appState();
    return (Array.isArray(st.virtualTransfers) ? st.virtualTransfers : []).some(vt =>
      transferPairKey(vt && (vt.stationA || vt.fromStationId || vt.from), vt && (vt.stationB || vt.toStationId || vt.to), vt && (vt.lineAId || vt.fromLineId || vt.lineA), vt && (vt.lineBId || vt.toLineId || vt.lineB)) === key
    );
  }
  function transferInfoForDistance(distanceM){
    const d = Math.max(0, Math.round(num(distanceM, 0)));
    if (d <= 100) return { type:'platform_same', penaltyMin:1.5 };
    if (d <= 300) return { type:'short_corridor', penaltyMin:3 };
    if (d <= 500) return { type:'long_corridor', penaltyMin:6 };
    return { type:'virtual', penaltyMin:10 };
  }
  function ensureVirtualTransfer(row){
    if (!row || !row.stationA || !row.stationB || !row.lineA || !row.lineB) return false;
    if (sid(row.stationA.id) === sid(row.stationB.id)) return false;
    if (sid(row.lineA.id) === sid(row.lineB.id)) return false;
    if (hasVirtualTransfer(row.stationA.id, row.stationB.id, row.lineA.id, row.lineB.id)) return false;
    const distanceM = meters(row.stationA, row.stationB);
    if (!Number.isFinite(distanceM) || distanceM > 600) return false;
    const info = transferInfoForDistance(distanceM);
    const st = appState();
    st.virtualTransfers = Array.isArray(st.virtualTransfers) ? st.virtualTransfers : [];
    row.stationA.__transferSameName = true;
    row.stationB.__transferSameName = true;
    row.stationA.__transferSameNameSourceId = row.stationB.id;
    row.stationB.__transferSameNameSourceId = row.stationA.id;
    row.stationA.__transferSameNameReason = 'real-network-platform-transfer';
    row.stationB.__transferSameNameReason = 'real-network-platform-transfer';
    st.virtualTransfers.push({
      stationA:row.stationA.id,
      stationB:row.stationB.id,
      lineAId:row.lineA.id,
      lineBId:row.lineB.id,
      type:info.type,
      penaltyMin:info.penaltyMin,
      distanceM:Math.round(distanceM),
      source:'osm-real-network-platform-transfer',
      transferKey:row.transferKey,
      updatedAt:Date.now()
    });
    return true;
  }
  function createPlatformTransfers(importedRows){
    const groups = new Map();
    importedRows.forEach(row => {
      (row.stationRows || []).forEach(item => {
        const key = cleanName(item.candidate && item.candidate.name) || sid(item.candidate && item.candidate.transferKey);
        if (!key || !item.station || !row.line) return;
        const list = groups.get(key) || [];
        list.push({ transferKey:key, station:item.station, line:row.line, index:item.index });
        groups.set(key, list);
      });
    });
    let created = 0;
    groups.forEach(list => {
      const bestByLinePair = new Map();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (sid(a.line.id) === sid(b.line.id) || sid(a.station.id) === sid(b.station.id)) continue;
          const d = meters(a.station, b.station);
          if (!Number.isFinite(d) || d > 600) continue;
          const key = [sid(a.line.id), sid(b.line.id)].sort().join('|');
          const prev = bestByLinePair.get(key);
          if (!prev || d < prev.distanceM) bestByLinePair.set(key, { stationA:a.station, stationB:b.station, lineA:a.line, lineB:b.line, distanceM:d, transferKey:a.transferKey });
        }
      }
      bestByLinePair.forEach(row => { if (ensureVirtualTransfer(row)) created++; });
	    });
	    return created;
	  }
  function linkImportedBranchFamilies(importedRows){
    const groups = new Map();
    importedRows.forEach(row => {
      const key = sid(row && row.route && (row.route.branchBaseKey || row.route.key));
      if (!key) return;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    });
    let linked = 0;
    groups.forEach(list => {
      if (list.length < 2) return;
      list.sort((a, b) => Math.round(num(a && a.route && a.route.branchIndex, 0)) - Math.round(num(b && b.route && b.route.branchIndex, 0)));
      const main = list.find(row => sid(row && row.route && row.route.variantRole) !== 'branch') || list[0];
      if (!main || !main.line) return;
      main.line.realNetworkBranchRole = 'main';
      main.line.realNetworkBranchBaseKey = sid(main.route && (main.route.branchBaseKey || main.route.key));
      list.forEach(row => {
        if (!row || !row.line || row === main) return;
        row.line.parentLineId = main.line.id;
        row.line.branchTransferPenalty = Math.min(2, num(row.line.branchTransferPenalty, 2) || 2);
        row.line.realNetworkBranchRole = 'branch';
        row.line.realNetworkBranchBaseKey = main.line.realNetworkBranchBaseKey;
        row.line.realNetworkBranchParentRelationId = main.route && main.route.relationId;
        if (row.route && row.route.branchJunctionName) row.line.realNetworkBranchJunctionName = row.route.branchJunctionName;
        linked++;
      });
    });
    return linked;
  }
  function nearestBranchTransferPair(mainRow, branchRow){
    const mainStations = (mainRow && mainRow.stationRows || []).map(item => item.station).filter(Boolean);
    const branchStations = (branchRow && branchRow.stationRows || []).map(item => item.station).filter(Boolean);
    let best = null;
    mainStations.forEach(mainStation => {
      branchStations.forEach(branchStation => {
        const distanceM = meters(mainStation, branchStation);
        if (Number.isFinite(distanceM) && (!best || distanceM < best.distanceM)) best = { mainStation, branchStation, distanceM };
      });
    });
    return best && best.distanceM <= 800 ? best : null;
  }
  function createBranchTransfers(importedRows){
    const groups = new Map();
    importedRows.forEach(row => {
      const key = sid(row && row.route && (row.route.branchBaseKey || row.route.key));
      if (!key) return;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    });
    let created = 0;
    groups.forEach(list => {
      if (list.length < 2) return;
      list.sort((a, b) => Math.round(num(a && a.route && a.route.branchIndex, 0)) - Math.round(num(b && b.route && b.route.branchIndex, 0)));
      const main = list.find(row => sid(row && row.route && row.route.variantRole) !== 'branch') || list[0];
      if (!main || !main.line) return;
      list.forEach(row => {
        if (!row || !row.line || row === main || sid(row.route && row.route.variantRole) !== 'branch') return;
        const pair = nearestBranchTransferPair(main, row);
        if (!pair || !pair.mainStation || !pair.branchStation) return;
        if (sid(pair.mainStation.id) === sid(pair.branchStation.id)) return;
        if (hasVirtualTransfer(pair.mainStation.id, pair.branchStation.id, main.line.id, row.line.id)) return;
        const st = appState();
        st.virtualTransfers = Array.isArray(st.virtualTransfers) ? st.virtualTransfers : [];
        pair.mainStation.__transferSameName = true;
        pair.branchStation.__transferSameName = true;
        pair.mainStation.__transferSameNameSourceId = pair.branchStation.id;
        pair.branchStation.__transferSameNameSourceId = pair.mainStation.id;
        pair.mainStation.__transferSameNameReason = 'real-network-branch-transfer';
        pair.branchStation.__transferSameNameReason = 'real-network-branch-transfer';
        st.virtualTransfers.push({
          stationA:pair.mainStation.id,
          stationB:pair.branchStation.id,
          lineAId:main.line.id,
          lineBId:row.line.id,
          type:'branch_junction',
          penaltyMin:2,
          distanceM:Math.round(pair.distanceM),
          source:'osm-real-network-branch-transfer',
          transferKey:sid(row.route && (row.route.branchBaseKey || row.route.key)),
          updatedAt:Date.now()
        });
        created++;
      });
    });
    return created;
  }
  function importSelected(){
    const selected = selectedRoutes();
    if (!selected.length) { setStatus('没有选中的线路', true); return; }
    let imported = 0;
    let skipped = 0;
    const importedRows = [];
    selected.forEach(route => {
      if (alreadyImported(route)) { skipped++; return; }
      const stationIds = [];
      const oldToNewSeg = new Map();
      let lastId = '';
      const stationRows = [];
      (route.stations || []).forEach((candidate, index) => {
        const station = ensureStation(candidate);
        if (!station || !station.id) return;
        stationRows.push({ station, candidate, index });
        if (sid(station.id) !== lastId) {
          stationIds.push(station.id);
          if (index > 0) oldToNewSeg.set(index - 1, stationIds.length - 2);
          lastId = sid(station.id);
        }
      });
      if (routeIsLoop(route)) {
        while (stationIds.length > 2 && sid(stationIds[stationIds.length - 1]) === sid(stationIds[0])) stationIds.pop();
        oldToNewSeg.set(Math.max(0, (route.stations || []).length - 1), Math.max(0, stationIds.length - 1));
      }
      if (stationIds.length < 2) { skipped++; return; }
      const line = makeLine(route, stationIds, remapWaypoints(route, oldToNewSeg));
      lines().push(line);
      importedRows.push({ route, line, stationRows });
      imported++;
      try { if (typeof W.renderLine === 'function') W.renderLine(line); else if (typeof renderLine === 'function') renderLine(line); } catch(e) {}
	    });
	    const branches = linkImportedBranchFamilies(importedRows);
	    const branchTransfers = createBranchTransfers(importedRows);
	    const transfers = createPlatformTransfers(importedRows);
    try { if (typeof W.refreshAllStations === 'function') W.refreshAllStations(); else if (typeof refreshAllStations === 'function') refreshAllStations(); } catch(e) {}
    try { if (typeof W.invalidateFlowCache === 'function') W.invalidateFlowCache(); else if (typeof invalidateFlowCache === 'function') invalidateFlowCache(); } catch(e) {}
    try { if (typeof W.updateUI === 'function') W.updateUI(); else if (typeof updateUI === 'function') updateUI(); } catch(e) {}
    try { if (typeof W.saveState === 'function') W.saveState(); else if (typeof saveState === 'function') saveState(); } catch(e) {}
    clearPreview();
	    setStatus('已导入 ' + imported + ' 条线路，识别 ' + branches + ' 条支线，创建 ' + (transfers + branchTransfers) + ' 组换乘' + (skipped ? '，跳过 ' + skipped + ' 条' : ''));
	  }
  function installEvents(){
    if (D.__cityrailRealNetworkImporterEvents) return;
    D.__cityrailRealNetworkImporterEvents = true;
    D.addEventListener('click', ev => {
      const action = ev.target && ev.target.closest && ev.target.closest('[data-rni-act]');
      if (action) {
        ev.preventDefault();
        ev.stopPropagation();
        const act = action.dataset.rniAct;
        if (act === 'close') hidePanel();
        else if (act === 'use-view') { const sel = byId('cr-rni-city'); if (sel) sel.value = 'current'; setStatus('已切换到当前地图视野'); }
        else if (act === 'load') loadNetwork();
        else if (act === 'preview') previewSelected();
        else if (act === 'import') importSelected();
        return;
      }
      const card = ev.target && ev.target.closest && ev.target.closest('#new-build-real-network');
      if (!card) return;
      ev.preventDefault();
      ev.stopPropagation();
      showPanel();
    }, true);
    W.addEventListener('resize', ensureBuildEntry);
  }
  function boot(reason){
    installStyle();
    ensureBuildEntry();
    ensurePanel();
    installEvents();
  }
  W.CityRailRealNetworkImporter = {
    version:VERSION,
    boot,
    open:showPanel,
    load:loadNetwork,
    preview:previewSelected,
    importSelected,
    clearPreview,
    report:() => ({
      version:VERSION,
      loadedRoutes: importPlan && importPlan.routes ? importPlan.routes.length : 0,
      selectedRoutes: selectedRoutes().length,
      previewActive: !!previewLayer,
    }),
  };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => boot('dom'), { once:true }); else boot('immediate');
  ['cityrail-save-loaded','cityrail:runtime-integrity'].forEach(name => {
    try { W.addEventListener(name, () => W.setTimeout(() => boot(name), 0)); } catch(e) {}
  });
  [300,1200,3000].forEach(ms => W.setTimeout(() => boot('timer-' + ms), ms));
})();
