(function(){
  'use strict';
  const W=window,D=document,VERSION='v504-maplibre-3d-base-layer-keyboard';
  if(W.__cityrailMaplibrePmtilesAuthority) return;
  W.__cityrailMaplibrePmtilesAuthority=true;
  const B=W.CityRailStateBridge;
  const U=W.CityRailCoreUtils;

  const VECTOR_KEY='pmtilesVector';
  const THREE_D_KEY='maplibre3d';
  const DEFAULT_BASE_LAYER='dark';
  const RASTER_KEYS=['dark','autonavi2026Road','autonavi2026Satellite','tencentSatellite','tencentTerrain','cartoLight','cartoVoyager','esriImagery'];
  const RASTER_ALIAS_KEYS=['satellite','cartoDark','light','street','osm','osmStandard','gaodeRoad','gaodeSatellite','gray','topo','hot','voyager'];
  const ORDER=['dark','autonavi2026Road','autonavi2026Satellite','tencentSatellite','tencentTerrain','cartoLight','cartoVoyager','esriImagery',VECTOR_KEY,THREE_D_KEY];
  const LABELS={
    pmtilesVector:'矢量地图',
    maplibre3d:'3D地图',
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
    '3d':THREE_D_KEY,
    threeD:THREE_D_KEY,
    maplibre3d:THREE_D_KEY,
    cityrail3d:THREE_D_KEY,
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
  const THREE_D_STORAGE_KEY='cityrail_3d_map';
  const THREE_D_CAMERA_STORAGE_KEY='cityrail_3d_camera';
  const THREE_D_VIEW={ pitch:62, bearing:-25, zoom:15.5 };
  const BUILDING_LAYER_ID='cityrail-3d-buildings';
  const LINE_SOURCE_ID='cityrail-3d-lines';
  const STATION_SOURCE_ID='cityrail-3d-stations';
  const LINE_UNDERLAY_LAYER_ID='cityrail-3d-line-underlay';
  const LINE_LAYER_ID='cityrail-3d-line';
  const STATION_HALO_LAYER_ID='cityrail-3d-station-halo';
  const STATION_LAYER_ID='cityrail-3d-station';
  const STATION_LABEL_LAYER_ID='cityrail-3d-station-label';
  const state={
    active:false,
    gl:null,
    container:null,
    virtualLayer:null,
    threeDLayer:null,
    previousSetter:null,
    lastError:null,
    protocolInstalled:false,
    styleUrl:'',
    rasterDefs:null,
    setterPatched:false,
    resourceMode:null,
    vectorLocked:false,
    deferredSyncReason:'',
    lastResizeWidth:0,
    lastResizeHeight:0,
    threeD:false,
    threeDPitch:THREE_D_VIEW.pitch,
    threeDBearing:THREE_D_VIEW.bearing,
    overlaySignature:'',
    overlayFrame:0,
    overlayTimer:0
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
  function isMaplibreKey(key){ return key===VECTOR_KEY || key===THREE_D_KEY; }
  function isThreeDKey(key){ return canonicalKey(key)===THREE_D_KEY; }
  function automaticReason(reason){
    return /^(v\d+|boot|dom|late|ensure|visible|save-loaded|city-open-default|home-deferred|city-enter|finalize|clean)/i.test(String(reason||''));
  }
  function vectorDef(key){
    const next=canonicalKey(key||VECTOR_KEY);
    return {
      vector:true,
      coord:'wgs84',
      label:LABELS[next]||LABELS[VECTOR_KEY],
      maplibre3d:next===THREE_D_KEY,
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
    return Object.assign({[VECTOR_KEY]:vectorDef(VECTOR_KEY),[THREE_D_KEY]:vectorDef(THREE_D_KEY)},rasterDefs());
  }
  function choiceKeys(){
    ensureVirtualLayer();
    return ORDER.filter(key=>isMaplibreKey(key)||(W.tileLayers&&W.tileLayers[key]));
  }
  function publishMapChoices(){
    try{
      const choices=W.CityRailMapChoicesV219;
      if(choices){
        choices.labels=Object.assign({},choices.labels||{},LABELS);
        choices.defs=Object.assign({},choices.defs||{},defs());
      }
      if(W.CityRailCleanDomesticBasemap){
        W.CityRailCleanDomesticBasemap.labels=Object.assign({},W.CityRailCleanDomesticBasemap.labels||{},LABELS);
      }
    }catch(e){}
  }
  function coordForKey(key){
    const def=defs()[canonicalKey(key)] || {};
    return String(def.coord || (def.options && (def.options.cityrailCoord || def.options.coordSystem || def.options.coordinateSystem)) || 'wgs84').toLowerCase();
  }
  function dataAnchor(){
    const adapter=W.CityRailMapCoordinateAdapter;
    let center=null;
    try{ center=adapter&&typeof adapter.dataCenter==='function' ? adapter.dataCenter() : (W.map&&W.map.getCenter&&W.map.getCenter()); }catch(e){ center=null; }
    let zoom=11;
    try{ zoom=Number(W.map&&W.map.getZoom&&W.map.getZoom())||zoom; }catch(e){}
    let point=null;
    try{ if(center&&W.map&&W.map.latLngToContainerPoint) point=W.map.latLngToContainerPoint([center.lat,center.lng]); }catch(e){ point=null; }
    return {center,zoom,point};
  }
  function preserveAnchorPoint(anchor){
    if(!anchor||!anchor.center||!anchor.point||!W.map||!W.map.latLngToContainerPoint||!W.map.panBy) return false;
    try{
      const after=W.map.latLngToContainerPoint([anchor.center.lat,anchor.center.lng]);
      const dx=after.x-anchor.point.x;
      const dy=after.y-anchor.point.y;
      if(Math.abs(dx)>0.01||Math.abs(dy)>0.01) W.map.panBy([dx,dy],{animate:false});
      return true;
    }catch(e){ return false; }
  }
  function reanchorAfterLayer(key,reason,anchor){
    const adapter=W.CityRailMapCoordinateAdapter;
    if(!adapter||typeof adapter.reanchor!=='function'||!anchor||!anchor.center) return false;
    try{
      adapter.reanchor(coordForKey(key),'base-layer-'+canonicalKey(key)+'-'+(reason||VERSION),anchor.center,anchor.zoom);
      preserveAnchorPoint(anchor);
      return true;
    }catch(e){ return false; }
  }
  function installStyle(){
    if(D.getElementById('cityrail-maplibre-pmtiles-style')) return;
    const style=D.createElement('style');
    style.id='cityrail-maplibre-pmtiles-style';
    style.textContent=[
      '#map .cityrail-maplibre-basemap{position:absolute;inset:0;z-index:210;pointer-events:none;visibility:hidden;background:#eef2f4;}',
      'html.cityrail-vector-basemap-active #map .cityrail-maplibre-basemap{visibility:visible;}',
      'html.cityrail-maplibre-3d-active #map .cityrail-maplibre-basemap{visibility:visible;background:#dce4e8;}',
      'html.cityrail-vector-basemap-active #map .leaflet-tile-pane{display:none!important;opacity:0!important;visibility:hidden!important;}',
      'html.cityrail-vector-basemap-active:not(.cityrail-maplibre-3d-active) #map .leaflet-cityrailOpenRailwayPane-pane,html.cityrail-vector-basemap-active:not(.cityrail-maplibre-3d-active) #map .leaflet-cityrailOpenRailway-pane{display:block!important;opacity:1!important;visibility:visible!important;}',
      'html.cityrail-maplibre-3d-active #map .leaflet-cityrailOpenRailwayPane-pane,html.cityrail-maplibre-3d-active #map .leaflet-cityrailOpenRailway-pane{display:none!important;opacity:0!important;visibility:hidden!important;}',
      'html.cityrail-maplibre-3d-active #map .cityrail-line-path{opacity:.001!important;}',
      'html.cityrail-maplibre-3d-active #map .leaflet-tooltip-pane{display:none!important;}',
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
      const adapter=W.CityRailMapCoordinateAdapter;
      const c=adapter&&typeof adapter.dataCenter==='function' ? adapter.dataCenter() : W.map.getCenter();
      return {center:[Number(c.lng)||fallback.center[0],Number(c.lat)||fallback.center[1]],zoom:Number(W.map.getZoom&&W.map.getZoom())||fallback.zoom};
    }catch(e){ return fallback; }
  }
  function largeNetworkZoomActive(){
    try{ return !!(typeof W.cityrailLargeNetworkZoomActive==='function'&&W.cityrailLargeNetworkZoomActive()); }catch(e){ return false; }
  }
  function resizeIfNeeded(reason){
    if(!state.gl||!state.container) return;
    const r=state.container.getBoundingClientRect?state.container.getBoundingClientRect():{width:0,height:0};
    const w=Math.round(Number(r.width)||0), h=Math.round(Number(r.height)||0);
    if(reason==='load'||reason==='resize'||Math.abs(w-state.lastResizeWidth)>1||Math.abs(h-state.lastResizeHeight)>1){
      state.lastResizeWidth=w;
      state.lastResizeHeight=h;
      try{ state.gl.resize(); }catch(e){}
    }
  }
  function clamp(value,min,max){ return Math.max(min,Math.min(max,num(value,min))); }
  function normalizeBearing(value){
    let n=num(value,0)%360;
    if(n>180) n-=360;
    if(n<-180) n+=360;
    return Math.round(n*10)/10;
  }
  function load3DCamera(){
    try{
      const raw=W.localStorage&&W.localStorage.getItem(THREE_D_CAMERA_STORAGE_KEY);
      if(!raw) return;
      const parsed=JSON.parse(raw);
      state.threeDPitch=clamp(parsed&&parsed.pitch,0,70);
      state.threeDBearing=normalizeBearing(parsed&&parsed.bearing);
    }catch(e){}
  }
  function save3DCamera(){
    try{ W.localStorage.setItem(THREE_D_CAMERA_STORAGE_KEY,JSON.stringify({pitch:state.threeDPitch,bearing:state.threeDBearing})); }catch(e){}
  }
  function set3DCamera(next,reason,animate){
    const pitch=Object.prototype.hasOwnProperty.call(next||{},'pitch') ? clamp(next.pitch,0,70) : state.threeDPitch;
    const bearing=Object.prototype.hasOwnProperty.call(next||{},'bearing') ? normalizeBearing(next.bearing) : state.threeDBearing;
    state.threeDPitch=pitch;
    state.threeDBearing=bearing;
    save3DCamera();
    if(state.gl&&state.active&&state.threeD){
      const view=leafletView();
      const camera={center:view.center,zoom:Math.max(num(view.zoom,0),THREE_D_VIEW.zoom),pitch,bearing};
      try{
        if(animate!==false&&state.gl.easeTo) state.gl.easeTo(Object.assign({duration:180},camera));
        else state.gl.jumpTo(camera);
      }catch(e){}
    }
    D.documentElement.dataset.cityrail3dPitch=String(Math.round(pitch));
    D.documentElement.dataset.cityrail3dBearing=String(Math.round(bearing));
    D.documentElement.dataset.cityrail3dCamera=reason||'camera';
    return {pitch,bearing};
  }
  function reset3DCamera(reason){
    return set3DCamera({pitch:THREE_D_VIEW.pitch,bearing:THREE_D_VIEW.bearing},reason||'reset',true);
  }
  function sid(value){ return String(value == null ? '' : value); }
  function num(value,fallback=0){ const n=Number(value); return Number.isFinite(n) ? n : fallback; }
  function finiteCoord(lat,lng){
    const y=Number(lat), x=Number(lng);
    return Number.isFinite(y)&&Number.isFinite(x)&&Math.abs(y)<=85.2&&Math.abs(x)<=180;
  }
  function cleanColor(value,fallback){
    const text=String(value||'').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : (fallback||'#0a84ff');
  }
  function stationPos(station,lineId){
    if(!station) return null;
    try{
      if(typeof W.getStationPosition==='function'){
        const pos=W.getStationPosition(station,lineId);
        if(pos&&finiteCoord(pos.lat,pos.lng)) return {lat:num(pos.lat),lng:num(pos.lng)};
      }
    }catch(e){}
    const lp=station.linePositions&&lineId!=null?station.linePositions[sid(lineId)]:null;
    if(lp&&finiteCoord(lp.lat,lp.lng)) return {lat:num(lp.lat),lng:num(lp.lng)};
    return finiteCoord(station.lat,station.lng) ? {lat:num(station.lat),lng:num(station.lng)} : null;
  }
  const stations=B.stations;
  const lines=B.lines;
  function stationById(id){
    try{
      const idx=W.cityrailGetRuntimeIndexes&&W.cityrailGetRuntimeIndexes();
      if(idx&&idx.stationById) return idx.stationById.get(sid(id)) || null;
    }catch(e){}
    return stations().find(st=>sid(st&&st.id)===sid(id)) || null;
  }
  function isConnector(line){
    try{ if(typeof W.cityrailIsConnectorLine==='function') return !!W.cityrailIsConnectorLine(line); }catch(e){}
    return !!(line&&(line.isConnector||line.kind==='connector'||line.type==='connector'));
  }
  function lineNodes(line){
    try{
      if(typeof W.getLineTrainNodes==='function'){
        const nodes=W.getLineTrainNodes(line);
        if(Array.isArray(nodes)&&nodes.length>=2) return nodes;
      }
    }catch(e){}
    const out=[];
    (Array.isArray(line&&line.stationIds)?line.stationIds:[]).forEach((stationId,index)=>{
      const st=stationById(stationId);
      const pos=stationPos(st,line&&line.id);
      if(pos) out.push({lat:pos.lat,lng:pos.lng,type:'station',id:stationId});
      (Array.isArray(line&&line.waypoints)?line.waypoints:[])
        .filter(wp=>Math.round(num(wp&&wp.segIdx,-1))===index)
        .sort((a,b)=>num(a&&a.order,0)-num(b&&b.order,0))
        .forEach(wp=>{ if(finiteCoord(wp.lat,wp.lng)) out.push({lat:num(wp.lat),lng:num(wp.lng),type:'waypoint'}); });
    });
    return out;
  }
  function simplifyCoords(coords,maxPoints){
    if(!Array.isArray(coords)||coords.length<=maxPoints) return coords;
    const out=[coords[0]];
    const step=(coords.length-1)/(maxPoints-1);
    for(let i=1;i<maxPoints-1;i++) out.push(coords[Math.max(1,Math.min(coords.length-2,Math.round(i*step)))]);
    out.push(coords[coords.length-1]);
    return out;
  }
  function lineFeature(line,index){
    if(!line||!Array.isArray(line.stationIds)||line.stationIds.length<2) return null;
    const coords=lineNodes(line)
      .map(point=>[num(point&&point.lng,NaN),num(point&&point.lat,NaN)])
      .filter(point=>finiteCoord(point[1],point[0]));
    if(coords.length<2) return null;
    const connector=isConnector(line);
    return {
      type:'Feature',
      id:sid(line.id||index),
      properties:{
        id:sid(line.id||index),
        name:sid(line.name||line.ref||line.id||'线路'),
        color:cleanColor(line.color,connector?'#8e8e93':'#0a84ff'),
        connector:connector?1:0
      },
      geometry:{type:'LineString',coordinates:simplifyCoords(coords,1800)}
    };
  }
  function stationColor(station){
    const id=sid(station&&station.id);
    const hit=lines().find(line=>!isConnector(line)&&Array.isArray(line.stationIds)&&line.stationIds.some(stationId=>sid(stationId)===id));
    return cleanColor(hit&&hit.color,'#f5f7fb');
  }
  function buildLineGeoJSON(){
    const features=[];
    lines().forEach((line,index)=>{
      const feature=lineFeature(line,index);
      if(feature) features.push(feature);
    });
    return {type:'FeatureCollection',features};
  }
  function buildStationGeoJSON(){
    const features=[];
    stations().forEach((station,index)=>{
      const pos=stationPos(station,null);
      if(!pos) return;
      features.push({
        type:'Feature',
        id:sid(station.id||index),
        properties:{
          id:sid(station.id||index),
          name:sid(station.name||station.id||'车站'),
          color:stationColor(station)
        },
        geometry:{type:'Point',coordinates:[pos.lng,pos.lat]}
      });
    });
    return {type:'FeatureCollection',features};
  }
  function hashText(text){
    let h=2166136261;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return (h>>>0).toString(36);
  }
  function overlaySignature(){
    const st=B.get();
    const lineSig=lines().map(line=>[
      sid(line&&line.id),
      sid(line&&line.name),
      sid(line&&line.color),
      Array.isArray(line&&line.stationIds)?line.stationIds.length:0,
      Array.isArray(line&&line.waypoints)?line.waypoints.length:0,
      num(line&&line._topologyVersion,0),
      num(line&&line._geometryVersion,0)
    ].join(':')).join('|');
    const stationSig=stations().map(station=>[
      sid(station&&station.id),
      sid(station&&station.name),
      num(station&&station.lat,0).toFixed(6),
      num(station&&station.lng,0).toFixed(6),
      station&&station.linePositions?Object.keys(station.linePositions).length:0
    ].join(':')).join('|');
    return [VERSION,st.activeCityKey||'',lines().length,stations().length,hashText(lineSig),hashText(stationSig)].join('|');
  }
  function ensureSource(gl,id,data){
    const existing=gl.getSource(id);
    if(existing&&typeof existing.setData==='function') existing.setData(data);
    else gl.addSource(id,{type:'geojson',data,lineMetrics:false,tolerance:.22,buffer:96});
  }
  function addLayerIfMissing(gl,layer){
    if(!gl.getLayer(layer.id)) gl.addLayer(layer);
  }
  function vectorSourceName(gl){
    const style=gl&&gl.getStyle&&gl.getStyle();
    const sources=style&&style.sources||{};
    if(sources.openmaptiles) return 'openmaptiles';
    const hit=Object.keys(sources).find(key=>sources[key]&&sources[key].type==='vector');
    return hit||'openmaptiles';
  }
  function ensureBuildingLayer(gl){
    if(!gl||gl.getLayer(BUILDING_LAYER_ID)) return;
    gl.addLayer({
      id:BUILDING_LAYER_ID,
      type:'fill-extrusion',
      source:vectorSourceName(gl),
      'source-layer':'building',
      minzoom:14,
      paint:{
        'fill-extrusion-color':'#d8d8d8',
        'fill-extrusion-height':['coalesce',['to-number',['get','render_height']],['to-number',['get','height']],['*',['coalesce',['to-number',['get','building:levels']],4],3],12],
        'fill-extrusion-base':['coalesce',['to-number',['get','render_min_height']],['to-number',['get','min_height']],0],
        'fill-extrusion-opacity':.88
      }
    });
  }
  function ensureGameLayers(gl){
    const lineData=buildLineGeoJSON();
    const stationData=buildStationGeoJSON();
    ensureSource(gl,LINE_SOURCE_ID,lineData);
    ensureSource(gl,STATION_SOURCE_ID,stationData);
    addLayerIfMissing(gl,{id:LINE_UNDERLAY_LAYER_ID,type:'line',source:LINE_SOURCE_ID,paint:{
      'line-color':'rgba(255,255,255,.88)',
      'line-width':['interpolate',['linear'],['zoom'],8,4,12,6,16,10],
      'line-opacity':['case',['==',['get','connector'],1],.18,.42],
      'line-blur':1.6
    },layout:{'line-cap':'round','line-join':'round'}});
    addLayerIfMissing(gl,{id:LINE_LAYER_ID,type:'line',source:LINE_SOURCE_ID,paint:{
      'line-color':['get','color'],
      'line-width':['interpolate',['linear'],['zoom'],8,2.3,12,3.8,16,7.2],
      'line-opacity':['case',['==',['get','connector'],1],.72,.96]
    },layout:{'line-cap':'round','line-join':'round'}});
    addLayerIfMissing(gl,{id:STATION_HALO_LAYER_ID,type:'circle',source:STATION_SOURCE_ID,minzoom:9,paint:{
      'circle-color':'rgba(255,255,255,.95)',
      'circle-radius':['interpolate',['linear'],['zoom'],9,2.5,13,4.8,16,8.2],
      'circle-opacity':.88,
      'circle-stroke-color':'rgba(0,0,0,.24)',
      'circle-stroke-width':1
    }});
    addLayerIfMissing(gl,{id:STATION_LAYER_ID,type:'circle',source:STATION_SOURCE_ID,minzoom:9,paint:{
      'circle-color':['get','color'],
      'circle-radius':['interpolate',['linear'],['zoom'],9,1.4,13,2.8,16,4.6],
      'circle-opacity':.94
    }});
    addLayerIfMissing(gl,{id:STATION_LABEL_LAYER_ID,type:'symbol',source:STATION_SOURCE_ID,minzoom:13,layout:{
      'text-field':['get','name'],
      'text-font':['Noto Sans Regular'],
      'text-size':['interpolate',['linear'],['zoom'],13,10,16,12],
      'text-anchor':'top',
      'text-offset':[0,.85],
      'text-allow-overlap':false,
      'text-ignore-placement':false
    },paint:{
      'text-color':'#111827',
      'text-halo-color':'rgba(255,255,255,.92)',
      'text-halo-width':1.4
    }});
    state.overlaySignature=overlaySignature();
    D.documentElement.dataset.cityrail3dLines=String(lineData.features.length);
    D.documentElement.dataset.cityrail3dStations=String(stationData.features.length);
  }
  function refreshGameLayers(reason){
    if(!state.threeD||!state.gl||!state.gl.isStyleLoaded||!state.gl.isStyleLoaded()) return false;
    const sig=overlaySignature();
    if(sig===state.overlaySignature&&reason!=='force') return true;
    try{ ensureGameLayers(state.gl); D.documentElement.dataset.cityrail3dOverlaySync=reason||'sync'; return true; }
    catch(error){ state.lastError=error&&error.message?error.message:String(error); D.documentElement.dataset.cityrail3dOverlayError=state.lastError.slice(0,160); return false; }
  }
  function scheduleOverlayRefresh(reason,delay=80){
    if(state.overlayTimer) W.clearTimeout(state.overlayTimer);
    state.overlayTimer=W.setTimeout(()=>{ state.overlayTimer=0; refreshGameLayers(reason||'timer'); },delay);
  }
  function bindOverlaySync(){
    if(W.__cityrail3dOverlaySyncBound) return;
    W.__cityrail3dOverlaySyncBound=true;
    ['cityrail-save-loaded','cityrail:runtime-integrity','cityrail:dailyPassengerReset'].forEach(name=>{
      try{ W.addEventListener(name,()=>scheduleOverlayRefresh(name,120)); }catch(e){}
    });
    const names=['renderLine','refreshLinePolyline','refreshAllStations'];
    names.forEach(name=>{
      const fn=W[name];
      if(typeof fn!=='function'||fn.__cityrail3dWrapped) return;
      const wrapped=function(){
        const result=fn.apply(this,arguments);
        scheduleOverlayRefresh(name,90);
        return result;
      };
      U.markWrapper(wrapped,'__cityrail3dWrapped',fn);
      try{ W[name]=wrapped; }catch(e){}
    });
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
      maxPitch:70,
      maxTileCacheSize:768
    });
    state.gl.on('error',event=>{
      state.lastError=event&&event.error?String(event.error.message||event.error):'maplibre error';
      D.documentElement.dataset.cityrailVectorBasemapError=state.lastError.slice(0,120);
    });
    state.gl.once('load',()=>{
      if(state.threeD){
        try{ ensureBuildingLayer(state.gl); ensureGameLayers(state.gl); }catch(e){ state.lastError=e&&e.message?e.message:String(e); }
      }
      syncCamera('load');
    });
    state.gl.on('styledata',()=>{
      if(!state.threeD) return;
      try{ ensureBuildingLayer(state.gl); ensureGameLayers(state.gl); }catch(e){}
    });
    return state.gl;
  }
  function syncCamera(reason){
    if(!state.gl||!state.active) return;
    if(largeNetworkZoomActive()){
      state.deferredSyncReason=reason||'large-network-zoom';
      D.documentElement.dataset.cityrailVectorBasemapSync='deferred-'+state.deferredSyncReason;
      return;
    }
    const view=leafletView();
    const camera=state.threeD
      ? {center:view.center,zoom:view.zoom,bearing:state.threeDBearing,pitch:state.threeDPitch}
      : {center:view.center,zoom:view.zoom,bearing:0,pitch:0};
    try{ state.gl.jumpTo(camera); }catch(e){}
    if(state.threeD) refreshGameLayers(reason||'camera');
    resizeIfNeeded(reason||'sync');
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
    try{ D.addEventListener('cityrail:large-network-zoom-idle',()=>{ const reason=state.deferredSyncReason||'large-network-zoom-idle'; state.deferredSyncReason=''; schedule(reason); }); }catch(e){}
  }
  function ensureVirtualLayer(){
    if(!W.L||!W.tileLayers) return null;
    if(!state.virtualLayer) state.virtualLayer=W.L.layerGroup();
    if(!state.threeDLayer) state.threeDLayer=W.L.layerGroup();
    state.virtualLayer.options=Object.assign({},state.virtualLayer.options||{},{cityrailCoord:'wgs84',coordSystem:'wgs84',coordinateSystem:'wgs84'});
    state.threeDLayer.options=Object.assign({},state.threeDLayer.options||{},{cityrailCoord:'wgs84',coordSystem:'wgs84',coordinateSystem:'wgs84',maplibre3d:true});
    W.tileLayers[VECTOR_KEY]=state.virtualLayer;
    W.tileLayers[THREE_D_KEY]=state.threeDLayer;
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
    if(!layer||isMaplibreKey(key)||isOpenRailwayLayer(key,layer)) return false;
    if(RASTER_KEYS.includes(key)||RASTER_ALIAS_KEYS.includes(key)) return true;
    try{
      const url=String(layer._url||'');
      if(url) return true;
    }catch(e){}
    return false;
  }
  function setOpenRailwayHiddenFor3D(hidden,reason){
    try{
      const overlay=W.__cityrailOrmOverlay || (W.tileLayers&&W.tileLayers.openrailway);
      if(hidden&&overlay&&W.map&&W.map.hasLayer&&W.map.hasLayer(overlay)) W.map.removeLayer(overlay);
    }catch(e){}
    try{
      D.querySelectorAll('#map .leaflet-cityrailOpenRailwayPane-pane,#map .leaflet-cityrailOpenRailway-pane').forEach(pane=>{
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
    D.documentElement.dataset.cityrail3dOverlayIsolation=hidden?(reason||VERSION):'off';
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
    const activeKey=state.threeD ? THREE_D_KEY : VECTOR_KEY;
    if(!state.active && !isMaplibreKey(canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer))) return false;
    D.documentElement.classList.add('cityrail-vector-basemap-active');
    D.documentElement.classList.toggle('cityrail-maplibre-3d-active',state.threeD);
    D.documentElement.dataset.cityrailBaseLayer=activeKey;
    D.documentElement.dataset.cityrailVectorIsolation=reason||VERSION;
    const container=ensureContainer();
    if(container){
      container.style.setProperty('z-index','210','important');
      container.style.setProperty('visibility','visible','important');
      container.style.setProperty('pointer-events','none','important');
    }
    removeRasterLayers();
    setLeafletTilePaneHidden(true);
    setOpenRailwayHiddenFor3D(state.threeD,reason||'isolation');
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
          if((state.active||isMaplibreKey(canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer)))&&isRasterBaseLayer(key,layer)){
            W.setTimeout(()=>{ try{ if(W.map&&W.map.hasLayer(layer)) W.map.removeLayer(layer); enforceVectorIsolation('guard-'+(key||'raster')); }catch(e){} },0);
          }
        }catch(e){}
      });
    }catch(e){}
  }
  function syncChoiceState(activeKey){
    ensureVirtualLayer();
    publishMapChoices();
    if(Array.isArray(W.layerKeys)){
      W.layerKeys.splice(0,W.layerKeys.length,...choiceKeys());
    }
    const key=canonicalKey(activeKey||W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER);
    const idx=Math.max(0,(W.layerKeys||ORDER).indexOf(key));
    try{ currentLayerIdx=idx; }catch(e){}
    W.currentLayerIdx=idx;
    W.__cityrailPreferredMapLayerKey=(W.layerKeys&&W.layerKeys[idx])||key;
    const btn=D.getElementById('btn-layer');
    if(btn){
      btn.textContent=LABELS[W.__cityrailPreferredMapLayerKey]||LABELS[VECTOR_KEY];
      btn.title='切换底图：CARTO、高德、腾讯、Esri、矢量地图、3D地图。高德和腾讯使用 GCJ-02，其余底图使用 WGS84。';
    }
    D.documentElement.dataset.cityrailBaseLayer=W.__cityrailPreferredMapLayerKey;
    D.documentElement.dataset.cityrailMapChoices=VERSION;
    try{ if(typeof W.cityrailSyncMapCredit==='function') W.cityrailSyncMapCredit(W.__cityrailPreferredMapLayerKey); }catch(e){}
    try{
      if(W.__cityrailPreferredMapLayerKey===THREE_D_KEY){
        const credit=D.getElementById('cityrail-map-credit');
        if(credit) credit.textContent='地图：3D地图';
      }
    }catch(e){}
  }
  function activateVector(reason,modeKey){
    const activeKey=isThreeDKey(modeKey) ? THREE_D_KEY : VECTOR_KEY;
    const anchor=dataAnchor();
    state.vectorLocked=true;
    state.threeD=activeKey===THREE_D_KEY;
    W.__cityrailVectorBaseLayerLocked=true;
    W.__cityrailUserSelectedBaseLayer=true;
    W.__cityrailPreferredMapLayerKey=activeKey;
    D.documentElement.classList.add('cityrail-vector-basemap-active');
    D.documentElement.classList.toggle('cityrail-maplibre-3d-active',state.threeD);
    D.documentElement.dataset.cityrail3dMap=state.threeD?'on':'off';
    D.documentElement.dataset.cityrailBaseLayer=activeKey;
    D.documentElement.dataset.cityrailBaseLayerReason=reason||VERSION;
    try{
      if(W.CityRailMapCoordinateAdapter&&typeof W.CityRailMapCoordinateAdapter.setActive==='function'){
        if(typeof W.CityRailMapCoordinateAdapter.reanchor==='function') {
          W.CityRailMapCoordinateAdapter.reanchor('wgs84','vector-basemap-'+(reason||VERSION),anchor.center,anchor.zoom);
          preserveAnchorPoint(anchor);
        }
        else W.CityRailMapCoordinateAdapter.setActive('wgs84','vector-basemap-'+(reason||VERSION));
      }else{
        D.documentElement.dataset.cityrailMapCoord='wgs84';
      }
    }catch(e){
      D.documentElement.dataset.cityrailMapCoord='wgs84';
    }
    syncChoiceState(activeKey);
    if(!enteredCity()) return true;
    const layer=ensureVirtualLayer();
    const targetLayer=activeKey===THREE_D_KEY ? state.threeDLayer : layer;
    try{ if(targetLayer&&W.map&&!W.map.hasLayer(targetLayer)) targetLayer.addTo(W.map); }catch(e){}
    try{
      const otherLayer=activeKey===THREE_D_KEY ? state.virtualLayer : state.threeDLayer;
      if(otherLayer&&W.map&&W.map.hasLayer(otherLayer)) W.map.removeLayer(otherLayer);
    }catch(e){}
    removeRasterLayers();
    state.active=true;
    bindRasterLayerGuard();
    enforceVectorIsolation(reason||'activate');
    if(state.threeD) bindOverlaySync();
    ensureMaplibre().then(()=>{
      if(state.threeD){
        try{ ensureBuildingLayer(state.gl); ensureGameLayers(state.gl); }catch(e){}
        apply3DCamera(reason||'activate-3d');
      }else{
        syncCamera(reason||'activate');
      }
    }).catch(error=>{
      state.lastError=error&&error.message?error.message:String(error);
      D.documentElement.dataset.cityrailVectorBasemapError=state.lastError.slice(0,120);
    });
    bindSync();
    if(state.threeD) bindKeyboardControls();
    try{ if(W.map&&W.map.invalidateSize) W.map.invalidateSize(); }catch(e){}
    return true;
  }
  function deactivateVector(){
    state.vectorLocked=false;
    W.__cityrailVectorBaseLayerLocked=false;
    state.active=false;
    state.threeD=false;
    D.documentElement.classList.remove('cityrail-vector-basemap-active');
    D.documentElement.classList.remove('cityrail-maplibre-3d-active');
    D.documentElement.dataset.cityrail3dMap='off';
    setLeafletTilePaneHidden(false);
    setOpenRailwayHiddenFor3D(false,'deactivate');
    try{
      if(state.container){
        state.container.style.removeProperty('visibility');
        state.container.style.setProperty('pointer-events','none','important');
      }
    }catch(e){}
    try{
      if(state.virtualLayer&&W.map&&W.map.hasLayer(state.virtualLayer)) W.map.removeLayer(state.virtualLayer);
    }catch(e){}
    try{
      if(state.threeDLayer&&W.map&&W.map.hasLayer(state.threeDLayer)) W.map.removeLayer(state.threeDLayer);
    }catch(e){}
  }
  function setLayer(key,reason){
    const next=canonicalKey(key);
    if(next===VECTOR_KEY) return activateVector(reason||'set-vector',VECTOR_KEY);
    if(next===THREE_D_KEY) return activateVector(reason||'set-3d',THREE_D_KEY);
    const anchor=dataAnchor();
    const currentKey=canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer);
    if((state.vectorLocked||W.__cityrailVectorBaseLayerLocked||isMaplibreKey(currentKey)) && automaticReason(reason)){
      state.active=true;
      state.vectorLocked=true;
      W.__cityrailVectorBaseLayerLocked=true;
      W.__cityrailPreferredMapLayerKey=currentKey===THREE_D_KEY?THREE_D_KEY:VECTOR_KEY;
      syncChoiceState(W.__cityrailPreferredMapLayerKey);
      return enforceVectorIsolation('blocked-raster-'+(reason||VERSION));
    }
    deactivateVector();
    syncChoiceState(next);
    if(state.previousSetter&&state.previousSetter!==W.cityrailSetBaseMapLayer){
      const result=state.previousSetter(next,reason||VERSION);
      syncChoiceState(next);
      reanchorAfterLayer(next,reason||VERSION,anchor);
      return result;
    }
    reanchorAfterLayer(next,reason||VERSION,anchor);
    return true;
  }
  function apply3DCamera(reason){
    const m=W.map;
    try{
      if(m&&typeof m.getZoom==='function'&&typeof m.setZoom==='function'&&enteredCity()){
        const z=Number(m.getZoom())||0;
        if(z<14.2) m.setZoom(THREE_D_VIEW.zoom,{animate:true});
      }
    }catch(e){}
    const view=leafletView();
    try{
      if(state.gl&&state.gl.easeTo) state.gl.easeTo({center:view.center,zoom:Math.max(num(view.zoom,0),THREE_D_VIEW.zoom),pitch:state.threeDPitch,bearing:state.threeDBearing,duration:650});
    }catch(e){ syncCamera(reason||'3d-camera'); }
  }
  function set3DEnabled(on,reason){
    return on ? setLayer(THREE_D_KEY,reason||'3d-on') : setLayer(VECTOR_KEY,reason||'3d-off');
  }
  function toggle3D(reason){ return set3DEnabled(!state.threeD,reason||'toggle'); }
  function editableTarget(target){
    const el=target&&target.closest?target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]'):null;
    return !!el;
  }
  function adjust3DBearing(delta,reason){
    return set3DCamera({bearing:state.threeDBearing+num(delta,0)},reason||'bearing',true);
  }
  function adjust3DPitch(delta,reason){
    return set3DCamera({pitch:state.threeDPitch+num(delta,0)},reason||'pitch',true);
  }
  function bindKeyboardControls(){
    if(W.__cityrail3dKeyboardControlsBound) return;
    W.__cityrail3dKeyboardControlsBound=true;
    W.addEventListener('keydown',event=>{
      if(!state.threeD||!state.active||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||editableTarget(event.target)) return;
      const key=String(event.key||'');
      let handled=true;
      if(key==='ArrowLeft'||key==='q'||key==='Q') adjust3DBearing(-10,'keyboard-bearing-left');
      else if(key==='ArrowRight'||key==='e'||key==='E') adjust3DBearing(10,'keyboard-bearing-right');
      else if(key==='ArrowUp'||key==='r'||key==='R') adjust3DPitch(5,'keyboard-pitch-up');
      else if(key==='ArrowDown'||key==='f'||key==='F') adjust3DPitch(-5,'keyboard-pitch-down');
      else if(key==='0') reset3DCamera('keyboard-reset');
      else handled=false;
      if(handled){
        event.preventDefault();
        event.stopPropagation();
      }
    },true);
  }
  function nextLayer(){
    syncChoiceState();
    const keys=choiceKeys();
    const cur=canonicalKey(W.__cityrailPreferredMapLayerKey||DEFAULT_BASE_LAYER);
    const idx=Math.max(0,keys.indexOf(cur));
    return setLayer(keys[(idx+1)%keys.length]||VECTOR_KEY,'cycle');
  }
  function patchSetters(){
    if(W.CityRailUnifiedMapControl&&typeof W.CityRailUnifiedMapControl.registerMaplibre==='function'){
      if(!state.previousSetter&&typeof W.CityRailUnifiedMapControl.setRasterBaseLayer==='function') state.previousSetter=W.CityRailUnifiedMapControl.setRasterBaseLayer;
      W.CityRailUnifiedMapControl.registerMaplibre({setLayer,nextLayer});
      state.setterPatched=true;
      return;
    }
    if(!state.previousSetter&&typeof W.cityrailSetBaseMapLayer==='function') state.previousSetter=W.cityrailSetBaseMapLayer;
    if(!state.rasterDefs) state.rasterDefs=rasterDefs();
    if(!state.setterPatched&&state.previousSetter){
      W.cityrailSetBaseMapLayer=function(key,reason){
        const next=canonicalKey(key);
        if(next===VECTOR_KEY) return setLayer(VECTOR_KEY,reason||'global-vector');
        if(next===THREE_D_KEY) return setLayer(THREE_D_KEY,reason||'global-3d');
        return setLayer(next,reason||'global-raster');
      };
      W.cityrailSetBaseMapLayer.__v416Previous=state.previousSetter;
      state.setterPatched=true;
    }
  }
  function bindButton(){
    if(W.CityRailUnifiedMapControl) return;
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
    U.markWrapper(api.openCity,'__v438ServerOnDemandMap',old);
    return true;
  }
  function boot(reason){
    patchSetters();
    installStyle();
    ensureVirtualLayer();
    load3DCamera();
    bindRasterLayerGuard();
    bindButton();
    bindKeyboardControls();
    installOpenCityWrapper();
    let wanted=canonicalKey(W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer||DEFAULT_BASE_LAYER);
    try{
      W.localStorage.removeItem(THREE_D_STORAGE_KEY);
    }catch(e){}
    if(state.vectorLocked||W.__cityrailVectorBaseLayerLocked) wanted=state.threeD?THREE_D_KEY:VECTOR_KEY;
    state.threeD=wanted===THREE_D_KEY;
    D.documentElement.classList.toggle('cityrail-maplibre-3d-active',state.threeD);
    D.documentElement.dataset.cityrail3dMap=state.threeD?'on':'off';
    syncChoiceState(wanted);
    if(state.threeD){
      bindOverlaySync();
      setLayer(THREE_D_KEY,reason||'boot-3d');
    } else if(wanted===VECTOR_KEY) setLayer(VECTOR_KEY,reason||'boot-vector');
    return true;
  }

  W.CityRailMapLibrePmtilesAuthority={
    version:VERSION,
    key:VECTOR_KEY,
    threeDKey:THREE_D_KEY,
    keys:()=>ORDER.slice(),
    setLayer,
    nextLayer,
    sync:boot,
    set3DEnabled,
    toggle3D,
    is3DEnabled:()=>!!state.threeD,
    rotate3D:adjust3DBearing,
    pitch3D:adjust3DPitch,
    reset3DCamera,
    refresh3D:()=>refreshGameLayers('force'),
    gl:()=>state.gl,
    enforceVectorIsolation,
    resourceMode:vectorServerMode,
    installOpenCityWrapper,
    report:()=>({
      version:VERSION,
      active:state.active,
      threeD:state.threeD,
      currentKey:W.__cityrailPreferredMapLayerKey||D.documentElement.dataset.cityrailBaseLayer||'',
      pitch:state.threeDPitch,
      bearing:state.threeDBearing,
      styleUrl:state.styleUrl||styleUrl(),
      maplibreLoaded:!!W.maplibregl,
      protocolInstalled:state.protocolInstalled,
      container:!!(state.container&&state.container.isConnected),
      lastError:state.lastError,
      resourceMode:state.resourceMode,
      overlaySignature:state.overlaySignature,
      lines:Number(D.documentElement.dataset.cityrail3dLines)||0,
      stations:Number(D.documentElement.dataset.cityrail3dStations)||0,
      choices:ORDER.slice()
    })
  };
  W.CityRailMapLibre3D={
    version:VERSION,
    enable:(reason)=>set3DEnabled(true,reason||'api-enable'),
    disable:(reason)=>set3DEnabled(false,reason||'api-disable'),
    toggle:(reason)=>toggle3D(reason||'api-toggle'),
    enabled:()=>!!state.threeD,
    rotate:(delta,reason)=>adjust3DBearing(delta,reason||'api-rotate'),
    pitch:(delta,reason)=>adjust3DPitch(delta,reason||'api-pitch'),
    resetCamera:(reason)=>reset3DCamera(reason||'api-reset'),
    refresh:(reason)=>refreshGameLayers(reason||'api-refresh'),
    report:()=>W.CityRailMapLibrePmtilesAuthority.report()
  };

  if(D.readyState==='complete') boot('now');
  else D.addEventListener('DOMContentLoaded',()=>boot('dom'),{once:true});
  [500,1800,4200,7600].forEach(ms=>W.setTimeout(()=>boot('late-'+ms),ms));
  try{ W.addEventListener('cityrail-save-loaded',()=>W.setTimeout(()=>boot('save-loaded'),0)); }catch(e){}
})();
