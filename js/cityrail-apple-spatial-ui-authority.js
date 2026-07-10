(function(){
  'use strict';
  const W=window,D=document,VERSION='v418-toolbar-center-authority';
  if(W.CityRailAppleSpatialUI&&W.CityRailAppleSpatialUI.version===VERSION) return;

  const toolbarGlyphs={
    'btn-navigate':'⇄',
    'btn-layer':'▧',
    'btn-line-stats':'▥',
    'btn-ctrl-center':'⌘',
    'btn-living-city':'∿',
    'btn-line-config':'⌁',
    'btn-new-line':'+',
    'btn-settings':'⚙'
  };
  const toolbarOrder={
    'btn-navigate':1,
    'btn-layer':2,
    'btn-ctrl-center':3,
    'btn-new-line':4,
    'btn-line-config':5,
    'btn-living-city':6,
    'btn-line-stats':7,
    'btn-settings':8
  };
  const toolbarLabels={
    'btn-navigate':'模拟导航',
    'btn-layer':'切换底图',
    'btn-line-stats':'线路统计',
    'btn-ctrl-center':'控制中心',
    'btn-living-city':'城市脉动',
    'btn-line-config':'线路配置',
    'btn-new-line':'新建',
    'btn-settings':'设置'
  };

  function byId(id){ return D.getElementById(id); }
  function applyRoot(){
    D.documentElement.classList.add('cityrail-apple-spatial-ui');
    D.documentElement.dataset.cityrailUiAuthority=VERSION;
  }
  function applyToolbar(){
    Object.keys(toolbarGlyphs).forEach(id=>{
      const btn=byId(id);
      if(!btn) return;
      btn.dataset.uiGlyph=toolbarGlyphs[id];
      btn.setAttribute('aria-label',toolbarLabels[id]||btn.textContent.trim()||id);
      if(!btn.title) btn.title=toolbarLabels[id]||btn.getAttribute('aria-label');
      btn.style.order=String(toolbarOrder[id]||99);
    });
    D.querySelectorAll('#topbar .tool-btn').forEach(btn=>{
      if(!Object.prototype.hasOwnProperty.call(toolbarGlyphs,btn.id)) return;
      if(!btn.getAttribute('aria-label')) btn.setAttribute('aria-label',btn.textContent.trim()||btn.id||'工具');
      if(!btn.title) btn.title=btn.getAttribute('aria-label');
    });
  }
  function bindPressFeedback(){
    if(D.documentElement.__cityrailAppleSpatialPressBound) return;
    D.documentElement.__cityrailAppleSpatialPressBound=true;
    const onDown=event=>{
      const btn=event.target&&event.target.closest&&event.target.closest('#topbar .tool-btn,button,[role="button"]');
      if(!btn||btn.disabled||btn.getAttribute('aria-disabled')==='true') return;
      btn.classList.add('cityrail-pressing');
    };
    const clear=()=>D.querySelectorAll('.cityrail-pressing').forEach(el=>el.classList.remove('cityrail-pressing'));
    D.addEventListener('pointerdown',onDown,true);
    ['pointerup','pointercancel','pointerleave','blur'].forEach(type=>W.addEventListener(type,clear,true));
  }
  function applyPanelRoles(){
    [
      ['settings-panel','设置'],
      ['new-line-dialog','新建'],
      ['nav-panel','模拟导航'],
      ['vt-panel','换乘设置'],
      ['line-stats-panel','线路统计'],
      ['line-config-panel','线路配置'],
      ['station-detail-panel','站点详情']
    ].forEach(([id,label])=>{
      const el=byId(id);
      if(!el) return;
      if(!el.getAttribute('role')) el.setAttribute('role','dialog');
      if(!el.getAttribute('aria-label')) el.setAttribute('aria-label',label);
    });
  }
  function install(){
    applyRoot();
    applyToolbar();
    applyPanelRoles();
    bindPressFeedback();
  }
  function observe(){
    if(D.documentElement.__cityrailAppleSpatialObserved) return;
    D.documentElement.__cityrailAppleSpatialObserved=true;
    const observer=new MutationObserver(records=>{
      if(records.some(record=>Array.from(record.addedNodes||[]).some(node=>node&&node.nodeType===1&&(node.id==='topbar'||(node.matches&&node.matches('.tool-btn'))||(node.querySelector&&node.querySelector('#topbar,.tool-btn')))))) applyToolbar();
    });
    observer.observe(D.documentElement,{childList:true,subtree:true});
  }

  if(D.readyState==='loading') D.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
  observe();
  W.addEventListener('cityrail:ui-refresh',install);
  W.CityRailAppleSpatialUI={version:VERSION,install,report(){return{version:VERSION,root:D.documentElement.classList.contains('cityrail-apple-spatial-ui'),toolbar:Object.keys(toolbarGlyphs).filter(id=>!!byId(id)).length,order:Object.keys(toolbarOrder).filter(id=>!!byId(id)).map(id=>[id,toolbarOrder[id]])};}};
})();
