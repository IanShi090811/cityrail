(function(){
  'use strict';
  const W=window,D=document,VERSION='v446-vector-basemap-isolation';
  if(W.__cityrailMaplibrePmtilesAuthority) return;
  W.__cityrailMaplibrePmtilesAuthority=true;

  const VECTOR_KEY='pmtilesVector';
  const DEFAULT_BASE_LAYER='dark';
  const RASTER_KEYS=['dark','autonavi2026Road','autonavi2026Satellite','tencentSatellite','tencentTerrain','cartoLight','cartoVoyager','esriImagery'];
  const RASTER_ALIAS_KEYS=['satellite','cartoDark','light','street','osm','osmStandard','gaodeRoad','gaodeSatellite','gray','topo','hot','voyager'];
  const ORDER=['dark','autonavi2026Road','autonavi2026Satellite','tencentSatellite','tencentTerrain','cartoLight','cartoVoyager','esriImagery',VECTOR_KEY];
  const LABELS={
    pmtilesVector:'矢量地图',
    dark:'CARTO暗色',
    autonavi2026Road:'高德2026标准',
    autonavi2026Satellite:'高德2026卫星',
    tencentSatellite:'腾讯卫星',
    tencentTerrain:'腾讯地形',
    cartoLight:'CARTO浅色',
    cartoVoyager:'CARTO Voyager',
    esriImagery:'Esri影像'
  };
  const LEGACY_KEY_MAP={
    osm:VECTOR_KEY,
    osmStandard:VECTOR_KEY,
    satellite:'esriImagery',
    cartoDark:'dark',
    gaode:'autonavi2026Road',
    amap:'autonavi2026Road',
    gaodeRoad:'autonavi2026Road',
    amapRoad:'autonavi2026Road',
    'gaode-road':'autonavi2026Road',
    'amap-road':'autonavi2026Road',
    gaodeSatellite:'autonavi2026Satellite',
    amapSatellite:'autonavi2026Satellite',
    'gaode-satellite':'autonavi2026Satellite',
    'amap-satellite':'autonavi2026Satellite',
    'autonavi-2026-road':'autonavi2026Road',
    'autonavi-2026-satellite':'autonavi2026Satellite',
    tencentSatellite:'tencentSatellite',
    'tencent-satellite':'tencentSatellite',
    tencentTerrain:'tencentTerrain',
    'tencent-terrain':'tencentTerrain'
  };
  const DEFAULT_STYLE_URL='https://tiles.openfreemap.org/styles/liberty';
  const state={
    active:false,
    gl:null,
    container:null,
    virtualLayer:null,
    previousSetter:null,
    lastError:null,
    protocolInstalled:false,
    styleUrl:'',
    rasterDefs:null,
    setterPatched:false,
    resourceMode:null,
    vectorLocked:false
  };
  let ProtocolCtor=null;

  function enteredCity(){
    try{
      if(typeof W.cityrailHasEnteredCityMap==='function') return !!W.cityrailHasEnteredCityMap();
      return !!(W.__cityrailEnteredCityMap || D.documentElement.classList.contains('cityrail-city-entered'));
    }catch(e){ return false; }
  }
  function styleUrl(){
    const url=String(W.CITYRAIL_PMTILES_STYLE_URL||W.CITYRAIL_VECTOR_BASEMAP_STYLE_URL||DEFAULT_STYLE_URL).trim();
    return url||DEFAULT_STYLE_URL;
  }
  function canonicalKey(key){
    const raw=String(key||'').trim();
    const mapped=LEGACY_KEY_MAP[raw]||raw;
    return ORDER.includes(mapped)?mapped:DEFAULT_BASE_LAYER;
  }
  function automaticReason(reason){
    return /^(v\d+|boot|dom|late|ensure|visible|save-loaded|city-open-default|home-deferred|city-enter|finalize|clean)/i.test(String(reason||''));
  }
  function vectorDef(){
    return {
      vector:true,
      coord:'wgs84',
      label:LABELS[VECTOR_KEY],
      styleUrl:styleUrl(),
      options:{cityrailCoord:'wgs84',coordSystem:'wgs84',coordinateSystem:'wgs84'}
    };
  }
  function rasterDefs(){
    const existing=state.rasterDefs || (W.CityRailMapChoicesV219&&W.CityRailMapChoicesV219.defs) || {};
    const defs={};
    RASTER_KEYS.forEach(key=>{ if(existing[key]) defs[key]=existing[key]; });
    return defs;
  }
  function defs(){
    return Object.assign({[VECTOR_KEY]:vectorDef()},rasterDefs());
  }
  function installStyle(){
    if(D.getElementById('cityrail-maplibre-pmtiles-style')) return;
    const style=D.createElement('style');
    style.id='cityrail-maplibre-pmtiles-style';
    style.textContent=[
      '#map .cityrail-maplibre-basemap{position:absolute;inset:0;z-index:210;pointer-events:none;visibility:hidden;background:#eef2f4;}',
      'html.cityrail-vector-basemap-active #map .cityrail-maplibre-basemap{visibility:visible;}',
      'html.cityrail-vector-basemap-active #map .leaflet-tile-pane{display:none!important;opacity:0!important;visibility:hidden!important;}',
      '#map .leaflet-pane,#map .leaflet-control-container{position:absolute;}',
      '#map .maplibregl-control-container{display:none!important;}'
    ].join('\n');
    (D.head||D.documentElement).appendChild(style);
  }
  async function installProtocol(){
    if(state.protocolInstalled) return true;
    if(!W.maplibregl) return false;
    if(!ProtocolCtor){
      const mod=await import('../vendor/pmtiles/pmtiles.esm.js');
      ProtocolCtor=mod&&mod.Protocol;
    }
    if(!ProtocolCtor) return false;
    const protocol=new ProtocolCtor({metadata:true});
    W.maplibregl.addProtocol('pmtiles',protocol.tile);
    W.__cityrailPmtilesProtocol=protocol;
    state.protocolInstalled=true;
    return true;
  }
  function mapContainer(){
    try{ return (W.map&&W.map.getContainer&&W.map.getContainer()) || D.getElementById('map'); }catch(e){ return D.getElementById('map'); }
  }
  function ensureContainer(){
    if(state.container&&state.container.isConnected) return state.container;
    const host=mapContainer();
    if(!host) return null;
    let node=D.getElementById('cityrail-maplibre-basemap');
    if(!node){
      node=D.createElement('div');
      node.id='cityrail-maplibre-basemap';
      node.className='cityrail-maplibre-basemap';
      node.setAttribute('aria-hidden','true');
      host.insertBefore(node,host.firstChild||null);
    }
    state.container=node;
    node.style.zIndex='210';
    return node;
  }
  function leafletView(){
    const fallback={center:[121.4737,31.2304],zoom:11};
    try{
      if(!W.map||typeof W.map.getCenter!=='function') return fallback;
      const c=W.map.getCenter();
      return {center:[Number(c.lng)||fallback.center[0],Number(c.lat)||fallback.center[1]],zoom:Number(W.map.getZoom&&W.map.getZoom())||fallback.zoom};
    }catch(e){ return fallback; }
  }
  async function ensureMaplibre(){
    if(!W.maplibregl) return null;
    installStyle();
    await installProtocol();
    const container=ensureContainer();
    if(!container) return null;
    const currentStyle=styleUrl();
    if(state.gl&&state.styleUrl===currentStyle) return state.gl;
    if(state.gl){
      try{ state.gl.remove(); }catch(e){}
      state.gl=null;
    }
    const view=leafletView();
    state.styleUrl=currentStyle;
    state.gl=new W.maplibregl.Map({
      container,
      style:currentStyle,
      center:view.center,
      zoom:view.zoom,
      interactive:false,
      attributionControl:false,
      fadeDuration:0,
      preserveDrawingBuffer:false,
      antialias:false,
      maxTileCacheSize:768
    });
    state.gl.on('error',event=>{
      state.lastError=event&&event.error?String(event.error.message||event.error):'maplibre error';
      D.documentElement.dataset.cityrailVectorBasemapError=state.lastError.slice(0,120);
    });
    state.gl.once('load',()=>syncCamera('load'));
    return state.gl;
  }
  function syncCamera(reason){
    if(!state.gl||!state.active) return;
    const view=leafletView();
    try{ state.gl.jumpTo({center:view.center,zoom:view.zoom,bearing:0,pitch:0}); }catch(e){}
    try{ state.gl.resize(); }catch(e){}
    D.documentElement.dataset.cityrailVectorBasemapSync=reason||'sync';
  }
  function bindSync(){
    const m=W.map;
    if(!m||m.__cityrailVectorBasemapSyncBound) return;
    m.__cityrailVectorBasemapSyncBound=true;
    let raf=0;
    const schedule=reason=>{
      if(raf) return;
      raf=W.requestAnimationFrame?W.requestAnimationFrame(()=>{ raf=0; syncCamera(reason); }):W.setTimeout(()=>{ raf=0; syncCamera(reason); },16);
    };
    ['move','zoom','moveend','zoomend','resize'].forEach(ev=>{ try{ m.on(ev,()=>schedule(ev)); }catch(e){} });
  }
  function ensureVirtualLayer(){
    if(!W.L||!W.tileLayers) return null;
    if(!state.virtualLayer) state.virtualLayer=W.L.layerGroup();
    state.virtualLayer.options=Object.assign({},state.virtualLayer.options||{},{cityrailCoord:'wgs84',coordSystem:'wgs84',coordinateSystem:'wgs84'});
    W.tileLayers[VECTOR_KEY]=state.virtualLayer;
    if(W.tileLayers.osm){
      try{ if(W.map&&W.map.hasLayer(W.tileLayers.osm)) W.map.removeLayer(W.tileLayers.osm); }catch(e){}
      try{ delete W.tileLayers.osm; }catch(e){ W.tileLayers.osm=undefined; }
    }
    return state.virtualLayer;
  }
  function layerKeyFor(layer){
    try{
      const entries=Object.entries(W.tileLayers||{});
      const hit=entries.find(([,candidate])=>candidate===layer);
      return hit ? hit[0] : '';
    }catch(e){ return ''; }
  }
  function isOpenRailwayLayer(key,layer){
    try{
      const cls=String(layer&&layer.options&&layer.options.className||'');
      const url=String(layer&&layer._url||'');
      return key==='openrailway' || /openrailway/i.test(cls) || /openrailway/i.test(url);
    }catch(e){ return key==='openrailway'; }
  }
  function isRasterBaseLayer(key,layer){
    if(!layer||key===VECTOR_KEY||isOpenRailwayLayer(key,layer)) return false;
    if(RASTER_KEYS.includes(key)||RASTER_ALIAS_KEYS.includes(key)) return true;
    try{
      const url=String(layer._url||'');
      if(url) return true;
    }catch(e){}
    return false;
  }
  function removeRasterLayers(){
    try{
      Object.keys(W.tileLayers||{}).forEach(key=>{
        const layer=W.tileLayers&&W.tileLayers[key];
        if(isRasterBaseLayer(key,layer)&&W.map&&W.map.hasLayer(layer)) W.map.removeLayer(layer);
      });
    }catch(e){}
  }
  function setLeafletTilePaneHidden(hidden){
    try{
      const panes=D.querySelectorAll('#map .leaflet-tile-pane');
      panes.forEach(pane=>{
        if(hidden){
          pane.style.setProperty('display','none','important');
          pane.style.setProperty('opacity','0','important');
          pane.style.setProperty('visibility','hidden','important');
        }else{
          pane.style.removeProperty('display');
          pane.style.removeProperty('opacity');
          pane.style.removeProperty('visibility');
        }
      });
    }catch(e){}
  }
  function enforceVectorIsolation(reason){
    if(!state.active && canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer)!==VECTOR_KEY) return false;
    D.documentElement.classList.add('cityrail-vector-basemap-active');
    D.documentElement.dataset.cityrailBaseLayer=VECTOR_KEY;
    D.documentElement.dataset.cityrailVectorIsolation=reason||VERSION;
    const container=ensureContainer();
    if(container){
      container.style.setProperty('z-index','210','important');
      container.style.setProperty('visibility','visible','important');
      container.style.setProperty('pointer-events','none','important');
    }
    removeRasterLayers();
    setLeafletTilePaneHidden(true);
    return true;
  }
  function bindRasterLayerGuard(){
    const m=W.map;
    if(!m||m.__cityrailVectorRasterGuardBound) return;
    m.__cityrailVectorRasterGuardBound=true;
    try{
      m.on('layeradd',event=>{
        try{
          const layer=event&&event.layer;
          const key=layerKeyFor(layer);
          if((state.active||canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer)===VECTOR_KEY)&&isRasterBaseLayer(key,layer)){
            W.setTimeout(()=>{ try{ if(W.map&&W.map.hasLayer(layer)) W.map.removeLayer(layer); enforceVectorIsolation('guard-'+(key||'raster')); }catch(e){} },0);
          }
        }catch(e){}
      });
    }catch(e){}
  }
  function syncChoiceState(activeKey){
    ensureVirtualLayer();
    if(Array.isArray(W.layerKeys)){
      W.layerKeys.splice(0,W.layerKeys.length,...ORDER.filter(key=>key===VECTOR_KEY||(W.tileLayers&&W.tileLayers[key])));
    }
    const key=canonicalKey(activeKey||W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER);
    const idx=Math.max(0,(W.layerKeys||ORDER).indexOf(key));
    try{ currentLayerIdx=idx; }catch(e){}
    W.currentLayerIdx=idx;
    W.__cityrailPreferredMapLayerKey=(W.layerKeys&&W.layerKeys[idx])||key;
    const btn=D.getElementById('btn-layer');
    if(btn){
      btn.textContent=LABELS[W.__cityrailPreferredMapLayerKey]||LABELS[VECTOR_KEY];
      btn.title='切换缓存底图：CARTO、高德、腾讯、Esri、矢量地图。高德和腾讯使用 GCJ-02，其余底图使用 WGS84。';
    }
    D.documentElement.dataset.cityrailBaseLayer=W.__cityrailPreferredMapLayerKey;
    D.documentElement.dataset.cityrailMapChoices=VERSION;
    try{ if(typeof W.cityrailSyncMapCredit==='function') W.cityrailSyncMapCredit(W.__cityrailPreferredMapLayerKey); }catch(e){}
  }
  function activateVector(reason){
    state.vectorLocked=true;
    W.__cityrailVectorBaseLayerLocked=true;
    W.__cityrailUserSelectedBaseLayer=true;
    W.__cityrailPreferredMapLayerKey=VECTOR_KEY;
    D.documentElement.classList.add('cityrail-vector-basemap-active');
    D.documentElement.dataset.cityrailBaseLayer=VECTOR_KEY;
    D.documentElement.dataset.cityrailBaseLayerReason=reason||VERSION;
    try{
      if(W.CityRailMapCoordinateAdapter&&typeof W.CityRailMapCoordinateAdapter.setActive==='function'){
        W.CityRailMapCoordinateAdapter.setActive('wgs84','vector-basemap-'+(reason||VERSION));
      }else{
        D.documentElement.dataset.cityrailMapCoord='wgs84';
      }
    }catch(e){
      D.documentElement.dataset.cityrailMapCoord='wgs84';
    }
    syncChoiceState(VECTOR_KEY);
    if(!enteredCity()) return true;
    const layer=ensureVirtualLayer();
    try{ if(layer&&W.map&&!W.map.hasLayer(layer)) layer.addTo(W.map); }catch(e){}
    removeRasterLayers();
    state.active=true;
    bindRasterLayerGuard();
    enforceVectorIsolation(reason||'activate');
    ensureMaplibre().then(()=>syncCamera(reason||'activate')).catch(error=>{
      state.lastError=error&&error.message?error.message:String(error);
      D.documentElement.dataset.cityrailVectorBasemapError=state.lastError.slice(0,120);
    });
    bindSync();
    try{ if(W.map&&W.map.invalidateSize) W.map.invalidateSize(); }catch(e){}
    return true;
  }
  function deactivateVector(){
    state.vectorLocked=false;
    W.__cityrailVectorBaseLayerLocked=false;
    state.active=false;
    D.documentElement.classList.remove('cityrail-vector-basemap-active');
    setLeafletTilePaneHidden(false);
    try{
      if(state.container){
        state.container.style.removeProperty('visibility');
        state.container.style.setProperty('pointer-events','none','important');
      }
    }catch(e){}
    try{
      if(state.virtualLayer&&W.map&&W.map.hasLayer(state.virtualLayer)) W.map.removeLayer(state.virtualLayer);
    }catch(e){}
  }
  function setLayer(key,reason){
    const next=canonicalKey(key);
    if(next===VECTOR_KEY) return activateVector(reason||'set-vector');
    if((state.vectorLocked||W.__cityrailVectorBaseLayerLocked||canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer)===VECTOR_KEY) && automaticReason(reason)){
      state.active=true;
      state.vectorLocked=true;
      W.__cityrailVectorBaseLayerLocked=true;
      W.__cityrailPreferredMapLayerKey=VECTOR_KEY;
      syncChoiceState(VECTOR_KEY);
      return enforceVectorIsolation('blocked-raster-'+(reason||VERSION));
    }
    deactivateVector();
    syncChoiceState(next);
    if(state.previousSetter&&state.previousSetter!==W.cityrailSetBaseMapLayer){
      const result=state.previousSetter(next,reason||VERSION);
      syncChoiceState(next);
      return result;
    }
    return true;
  }
  function nextLayer(){
    syncChoiceState();
    const keys=ORDER.filter(key=>key===VECTOR_KEY||(W.tileLayers&&W.tileLayers[key]));
    const cur=canonicalKey(W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER);
    const idx=Math.max(0,keys.indexOf(cur));
    return setLayer(keys[(idx+1)%keys.length]||VECTOR_KEY,'cycle');
  }
  function patchSetters(){
    if(!state.previousSetter&&typeof W.cityrailSetBaseMapLayer==='function') state.previousSetter=W.cityrailSetBaseMapLayer;
    if(!state.rasterDefs) state.rasterDefs=rasterDefs();
    if(!state.setterPatched&&state.previousSetter){
      W.cityrailSetBaseMapLayer=function(key,reason){
        const next=canonicalKey(key);
        if(next===VECTOR_KEY) return setLayer(VECTOR_KEY,reason||'global-vector');
        return setLayer(next,reason||'global-raster');
      };
      W.cityrailSetBaseMapLayer.__v416Previous=state.previousSetter;
      state.setterPatched=true;
    }
  }
  function bindButton(){
    const btn=D.getElementById('btn-layer');
    const handle=event=>{
      if(!(event.target&&event.target.closest&&event.target.closest('#btn-layer'))) return;
      event.preventDefault();
      event.stopPropagation();
      if(event.stopImmediatePropagation) event.stopImmediatePropagation();
      W.__cityrailUserSelectedBaseLayer=true;
      nextLayer();
    };
    if(!W.__cityrailVectorMapWindowButtonBound){
      W.__cityrailVectorMapWindowButtonBound=true;
      W.addEventListener('click',handle,true);
    }
    if(!btn||btn.__cityrailVectorMapButtonBound) return;
    btn.__cityrailVectorMapButtonBound=true;
    btn.addEventListener('click',handle,true);
  }
  function profileList(){
    const out=[];
    try{ Object.values(W.CITYRAIL_CITY_PROFILES||{}).forEach(p=>p&&out.push(p)); }catch(e){}
    try{ if(W.CityRailCityProfilesV175&&typeof W.CityRailCityProfilesV175.profiles==='function') W.CityRailCityProfilesV175.profiles().forEach(p=>p&&out.push(p)); }catch(e){}
    return out;
  }
  function profileById(id){
    const key=String(id||'').trim();
    return profileList().find(p=>p&&(p.id===key||p.key===key||p.zh===key||p.en===key)) || (W.state&&W.state.cityProfile) || W.__cityrailCurrentCityProfile || (W.CITYRAIL_CITY_PROFILES&&W.CITYRAIL_CITY_PROFILES.shanghai) || {id:'shanghai',key:'shanghai',zh:'上海',en:'Shanghai',center:[31.2304,121.4737],zoom:11,networkKm:100};
  }
  function cityCacheId(profile){
    return String((profile&&(profile.id||profile.key||profile.zh||profile.en))||'shanghai').trim()||'shanghai';
  }
  function cityRadiusM(profile){
    const id=cityCacheId(profile);
    if(id==='chongqing') return 160000;
    if(id==='beijing'||id==='tianjin'||id==='chengdu') return 110000;
    if(id==='hongkong'||id==='macau'||id==='sanya'||id==='xiamen') return 65000;
    const km=Number(profile&&profile.networkKm);
    if(Number.isFinite(km)&&km>0) return Math.max(42000,Math.min(150000,Math.round(km*460)));
    return 85000;
  }
  function cityBounds(profile){
    const center=Array.isArray(profile&&profile.center)?profile.center:[31.2304,121.4737];
    const lat=Number(center[0])||31.2304;
    const lng=Number(center[1])||121.4737;
    const radius=cityRadiusM(profile);
    const latDelta=radius/111320;
    const lngDelta=radius/(111320*Math.max(.18,Math.cos(lat*Math.PI/180)));
    return {south:Math.max(-85,lat-latDelta),north:Math.min(85,lat+latDelta),west:Math.max(-180,lng-lngDelta),east:Math.min(180,lng+lngDelta),radius,center:{lat,lng}};
  }
  function lngLatToTile(lat,lng,z){
    const rad=lat*Math.PI/180;
    const n=Math.pow(2,z);
    const x=Math.floor((lng+180)/360*n);
    const y=Math.floor((1-Math.log(Math.tan(rad)+1/Math.cos(rad))/Math.PI)/2*n);
    return {x:Math.max(0,Math.min(n-1,x)),y:Math.max(0,Math.min(n-1,y)),n};
  }
  function tileRange(bounds,z){
    const points=[
      lngLatToTile(bounds.south,bounds.west,z),
      lngLatToTile(bounds.south,bounds.east,z),
      lngLatToTile(bounds.north,bounds.west,z),
      lngLatToTile(bounds.north,bounds.east,z)
    ];
    const n=points[0]&&points[0].n||Math.pow(2,z);
    return {
      n,
      minX:Math.max(0,Math.min.apply(null,points.map(p=>p.x))),
      maxX:Math.min(n-1,Math.max.apply(null,points.map(p=>p.x))),
      minY:Math.max(0,Math.min.apply(null,points.map(p=>p.y))),
      maxY:Math.min(n-1,Math.max.apply(null,points.map(p=>p.y)))
    };
  }
  function templateUrl(tpl,z,x,y){
    return String(tpl||'').replace(/\{z\}/g,String(z)).replace(/\{x\}/g,String(x)).replace(/\{y\}/g,String(y)).replace(/\{r\}/g,'');
  }
  function uniqueUrls(list){
    const seen=new Set(),out=[];
    list.forEach(url=>{ const u=String(url||'').trim(); if(u&&!seen.has(u)){ seen.add(u); out.push(u); } });
    return out;
  }
  function vectorServerMode(profile){
    const packet={city:cityCacheId(profile||profileById()),mode:'server-on-demand',prewarm:false,ready:false,at:new Date().toISOString()};
    state.resourceMode=packet;
    try{
      D.documentElement.dataset.cityrailVectorOfflineReady='server-on-demand';
      delete D.documentElement.dataset.cityrailVectorOfflineProgress;
      delete D.documentElement.dataset.cityrailVectorOfflineError;
    }catch(e){}
    return packet;
  }

  function installOpenCityWrapper(){
    const api=W.CityRailCityProfilesV175;
    if(!api||typeof api.openCity!=='function'||api.openCity.__v438ServerOnDemandMap) return false;
    const old=api.openCity;
    api.openCity=async function(id){
      const result=old.apply(this,arguments);
      try{
        W.setTimeout(()=>{ try{ setLayer(W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER,'city-open-default-online-first'); }catch(e){} },1200);
        Promise.resolve(result).then(()=>{ try{ setLayer(W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER,'city-open-default-complete'); }catch(e){} }).catch(error=>{
          state.lastError=error&&error.message?error.message:String(error);
        });
      }catch(e){}
      return result;
    };
    api.openCity.__v438ServerOnDemandMap=true;
    api.openCity.__original=old;
    return true;
  }
  function boot(reason){
    patchSetters();
    installStyle();
    ensureVirtualLayer();
    bindRasterLayerGuard();
    bindButton();
    installOpenCityWrapper();
    const wanted=(state.vectorLocked||W.__cityrailVectorBaseLayerLocked) ? VECTOR_KEY : canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer||DEFAULT_BASE_LAYER);
    syncChoiceState(wanted);
    if(wanted===VECTOR_KEY) enforceVectorIsolation(reason||'boot-vector');
    return true;
  }

  W.CityRailMapLibrePmtilesAuthority={
    version:VERSION,
    key:VECTOR_KEY,
    keys:()=>ORDER.slice(),
    setLayer,
    nextLayer,
    sync:boot,
    enforceVectorIsolation,
    resourceMode:vectorServerMode,
    installOpenCityWrapper,
    report:()=>({
      version:VERSION,
      active:state.active,
      styleUrl:state.styleUrl||styleUrl(),
      maplibreLoaded:!!W.maplibregl,
      protocolInstalled:state.protocolInstalled,
      container:!!(state.container&&state.container.isConnected),
      lastError:state.lastError,
      resourceMode:state.resourceMode,
      choices:ORDER.slice()
    })
  };

  if(D.readyState==='complete') boot('now');
  else D.addEventListener('DOMContentLoaded',()=>boot('dom'),{once:true});
  [500,1800,4200,7600].forEach(ms=>W.setTimeout(()=>boot('late-'+ms),ms));
  try{ W.addEventListener('cityrail-save-loaded',()=>W.setTimeout(()=>boot('save-loaded'),0)); }catch(e){}
})();
