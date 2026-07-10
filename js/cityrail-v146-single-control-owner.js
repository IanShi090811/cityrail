;/* CityRail v146: single control-center snapshot owner. */
(function(){
  'use strict';
  const W=window,D=document,VERSION='v146.18-unified-control-center';
  const REFRESH_MS=5600;
  const byId=id=>D.getElementById(id);
  const sid=v=>String(v==null?'':v);
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const fmt=v=>Math.max(0,Math.round(num(v))).toLocaleString('zh-CN');
  const fmtWan=v=>(Math.max(0,num(v))/10000).toFixed(1)+'万';
  const esc=v=>sid(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const state=()=>W.state||{};
  const visible=el=>!!(el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none');
  let refreshTimer=0,refreshRaf=0,pendingIdle=0,lastBuildAt=0,lastSnapshot=null,lastSignature='',selectedFareLineId='';
  let renderCount=0,skippedRenderCount=0,snapshotBuildMs=0;
  function lineSortText(line){ return sid(line&&(line.name||line.label||line.code||line.no||line.number||line.id)); }
  function lineSortNumber(line){ const explicit=num(line&&(line.no??line.number),NaN); if(Number.isFinite(explicit)) return explicit; const m=lineSortText(line).match(/\d+/); return m?Number(m[0]):Infinity; }
  function compareLinesByNumber(a,b){
    if(typeof W.cityrailCompareLinesByNumber==='function') return W.cityrailCompareLinesByNumber(a,b);
    const an=lineSortNumber(a),bn=lineSortNumber(b),af=Number.isFinite(an),bf=Number.isFinite(bn);
    if(af!==bf) return af?-1:1;
    if(af&&an!==bn) return an-bn;
    return lineSortText(a).localeCompare(lineSortText(b),'zh-CN',{numeric:true,sensitivity:'base'});
  }
  function sortedLinesByNumber(lines){ return (Array.isArray(lines)?lines.slice():[]).sort(compareLinesByNumber); }
  function compareRowsByLineNumber(a,b){ return compareLinesByNumber(a&&a.line?a.line:a,b&&b.line?b.line:b); }
	  const LINE_STATS_COLUMNS=[
    {key:'color',label:'',width:42},
    {key:'line',label:'线路',width:150},
    {key:'express',label:'快慢车',width:92},
    {key:'type',label:'车型',width:72},
    {key:'cars',label:'编组',width:72},
    {key:'speed',label:'速度',width:84},
    {key:'length',label:'长度',width:84},
    {key:'trains',label:'列车数',width:82},
    {key:'ridership',label:'客流量',width:118},
	    {key:'crowding',label:'拥挤度',width:88}
	  ];

  function createControlCenterSystem(){
    const panels=new Map();
    const scrollSurfaces=new Map();
    let started=false,bound=false;
    const publicRender=function(){ return refresh(true); };
    publicRender.__cityrailControlCenterSystem=true;
    publicRender.__v145StableOwner=true;
    publicRender.__v142StrictRenderer=true;
    function registerPanel(id,entry){
      const key=sid(id).trim();
      if(!key||!entry) return false;
      panels.set(key,Object.assign({id:key,order:100,ensure:null,render:null},entry,{id:key}));
      return true;
    }
    function renderPanels(snap){
      Array.from(panels.values()).sort((a,b)=>num(a.order)-num(b.order)||sid(a.id).localeCompare(sid(b.id))).forEach(panel=>{
        try{
          if(typeof panel.ensure==='function') panel.ensure();
          if(typeof panel.render==='function') panel.render(snap);
        }catch(e){
          try{ state().__cityrailControlCenterPanelErrors=Object.assign({},state().__cityrailControlCenterPanelErrors||{},{[panel.id]:(e&&e.message)||String(e)}); }catch(_){}
        }
      });
    }
    function registerScrollSurface(id,selector){
      const key=sid(id).trim(),sel=sid(selector).trim();
      if(!key||!sel) return false;
      scrollSurfaces.set(key,sel);
      return true;
    }
    function chartTheme(){
      const light=D.documentElement.classList.contains('cityrail-light-ui');
      return light ? {
        mode:'light',
        text:'#1d1d1f',
        textSoft:'rgba(29,29,31,.68)',
        textFaint:'rgba(60,60,67,.50)',
        panel:'rgba(255,255,255,.78)',
        panelStrong:'rgba(255,255,255,.92)',
        pane:'linear-gradient(180deg,rgba(255,255,255,.90),rgba(247,248,252,.82))',
        mapPane:'radial-gradient(circle at 18% 18%,rgba(0,122,255,.10),transparent 34%),linear-gradient(180deg,rgba(255,255,255,.92),rgba(246,248,252,.78))',
        chartBg:'linear-gradient(180deg,rgba(255,255,255,.94),rgba(247,248,252,.86))',
        border:'rgba(0,0,0,.095)',
        grid:'rgba(60,60,67,.16)',
        axis:'rgba(60,60,67,.30)',
        local:'#d70015',
        express:'#007aff',
        flowCold:'#0a84ff',
        flowMid:'#007aff',
        flowHot:'#188038',
        node:'rgba(255,255,255,.86)',
        nodeStroke:'rgba(0,0,0,.12)',
        labelStroke:'rgba(255,255,255,.76)',
        blend:'multiply'
      } : {
        mode:'dark',
        text:'rgba(255,255,255,.94)',
        textSoft:'rgba(255,255,255,.68)',
        textFaint:'rgba(255,255,255,.46)',
        panel:'rgba(255,255,255,.055)',
        panelStrong:'rgba(255,255,255,.075)',
        pane:'linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.032))',
        mapPane:'radial-gradient(circle at 18% 18%,rgba(10,132,255,.16),transparent 34%),linear-gradient(180deg,rgba(8,12,20,.60),rgba(8,12,20,.22))',
        chartBg:'linear-gradient(180deg,rgba(255,255,255,.035),rgba(0,0,0,.14))',
        border:'rgba(255,255,255,.12)',
        grid:'rgba(255,255,255,.08)',
        axis:'rgba(255,255,255,.18)',
        local:'#FF453A',
        express:'#0A84FF',
        flowCold:'#64D2FF',
        flowMid:'#0A84FF',
        flowHot:'#30D158',
        node:'rgba(255,255,255,.075)',
        nodeStroke:'rgba(255,255,255,.13)',
        labelStroke:'rgba(5,7,12,.72)',
        blend:'screen'
      };
    }
    function applyChartTheme(root){
      const target=root||D.documentElement;
      const theme=chartTheme();
      Object.keys(theme).forEach(key=>{
        if(key==='mode') return;
        target.style.setProperty('--cr-chart-'+key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()),theme[key]);
      });
      target.dataset.cityrailChartTheme=theme.mode;
      return theme;
    }
    function normalizeScrollSurfaces(){
      const overlay=byId('ctrl-center-overlay');
      if(overlay){
        overlay.dataset.controlCenterOwner=VERSION;
        overlay.querySelectorAll('[data-control-scroll-managed="true"]').forEach(el=>{
          delete el.dataset.controlScrollSurface;
          el.removeAttribute('data-control-scroll-managed');
        });
      }
      scrollSurfaces.forEach((selector,id)=>{
        D.querySelectorAll(selector).forEach(el=>{
          el.dataset.controlScrollSurface=id;
          el.setAttribute('data-control-scroll-managed','true');
        });
      });
    }
    function installPublicApi(){
      W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__=true;
      W.__CITYRAIL_CONTROL_CENTER_OWNER__=VERSION;
      ['updateControlCenter','renderCtrlCenter','renderControlLineOps','renderLineStats'].forEach(name=>{try{W[name]=globalThis[name]=publicRender;}catch(e){W[name]=publicRender;}});
      const api={
        version:VERSION,
        render:publicRender,
        refresh:publicRender,
        registerPanel,
        registerScrollSurface,
        normalizeScrollSurfaces,
        chartTheme,
        applyChartTheme,
        panels:()=>Array.from(panels.keys()),
        scrollSurfaces:()=>Array.from(scrollSurfaces.keys()),
        report:reportState
      };
      W.CityRailControlCenterSystem=api;
      W.CityRailControlCenterRenderer=api;
      W.CityRailControlCenterV146=api;
      W.CityRailControlCenterV142=api;
      return api;
    }
    function start(){
      installPublicApi();
      ensureLineStatsStructure(byId('cct-line-stats-body'));
      if(refreshTimer) clearInterval(refreshTimer);
      refreshTimer=setInterval(()=>refresh(false),REFRESH_MS);
      W.__cityrailControlCenterSystemTimer=refreshTimer;
      started=true;
      updateDiagnostics();
    }
    function bindEvents(){
      if(bound) return;
      bound=true;
      D.addEventListener('click',event=>{const button=event.target&&event.target.closest&&event.target.closest('#btn-ctrl-center');if(button)setTimeout(()=>refresh(true),0);},true);
      D.addEventListener('click',event=>{
        const btn=event.target&&event.target.closest&&event.target.closest('#ctrl-nav .ctrl-nav-item[data-tab]');
        if(!btn) return;
        activateControlTab(btn);
      },true);
      D.addEventListener('click',event=>{const row=event.target&&event.target.closest&&event.target.closest('.cr200-depot-row[data-depot-id]');if(row&&W.CityRailDepotService&&typeof W.CityRailDepotService.openDepotPanel==='function') W.CityRailDepotService.openDepotPanel(row.dataset.depotId);},true);
      D.addEventListener('click',event=>{
        const lineBtn=event.target&&event.target.closest&&event.target.closest('#cct-fare-policy-card [data-line-fare-id]');
        if(lineBtn){
          selectedFareLineId=sid(lineBtn.dataset.lineFareId);
          renderFarePanel({farePolicy:farePolicyReport()});
          return;
        }
        const lineReset=event.target&&event.target.closest&&event.target.closest('#cct-fare-policy-card [data-line-fare-reset]');
        if(lineReset && selectedFareLineId){
          setLineFareMultiplier(selectedFareLineId,1);
          renderFarePanel({farePolicy:farePolicyReport()});
          return;
        }
        const preset=event.target&&event.target.closest&&event.target.closest('#cct-fare-policy-card [data-fare-preset]');
        if(preset){
          const report=farePolicyReport();
          setFarePolicy(farePresetPolicy(sid(preset.dataset.farePreset||'standard'),report));
          refresh(true);
          return;
        }
        const reset=event.target&&event.target.closest&&event.target.closest('#cct-fare-policy-card [data-fare-reset]');
        if(reset){
          setFarePolicy(farePresetPolicy('standard',farePolicyReport()));
          refresh(true);
        }
      },true);
      D.addEventListener('input',event=>{
        const lineInput=event.target&&event.target.closest&&event.target.closest('#fare-line-multiplier');
        if(lineInput && selectedFareLineId){
          setLineFareMultiplier(selectedFareLineId,num(lineInput.value,1));
          renderFarePanel({farePolicy:farePolicyReport()});
          return;
        }
        const input=event.target&&event.target.closest&&event.target.closest('#cct-fare-policy-card [data-fare-field]');
        if(!input||input.disabled) return;
        const report=farePolicyReport();
        if(sid((report.policy||{}).preset)!=='custom') return;
        const key=sid(input.dataset.fareField);
        const next=Object.assign({},report.policy||{},{preset:'custom'});
        next[key]=num(input.value);
        setFarePolicy(next);
        renderFarePanel({farePolicy:farePolicyReport()});
      },true);
      D.addEventListener('visibilitychange',()=>{if(!D.hidden)refresh(true);});
    }
    function reportState(){ return {version:VERSION,started,bound,panelCount:panels.size,panels:Array.from(panels.keys()),scrollSurfaces:Array.from(scrollSurfaces.keys())}; }
    return {registerPanel,renderPanels,registerScrollSurface,normalizeScrollSurfaces,chartTheme,applyChartTheme,installPublicApi,start,bindEvents,reportState};
  }
  const controlCenterSystem=createControlCenterSystem();

	  function trainTypeName(v){
    const raw=sid(v||'A').trim();
    const key=raw==='A鼓'?'A':(raw==='B2'?'B1':raw);
    const names={A:'A型车',B1:'B型(B1)',C:'C型车',D:'D型车',L:'L型车',As:'As型车',APM:'APM列车',MAGLEV:'磁悬浮列车'};
    return names[key]||key||'A型车';
  }
  function formatTime(hour){
    const h=Math.floor(num(hour)); const m=Math.floor((num(hour)-h)*60+1e-6);
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  }
  function activeTrain(t){ return t&&!['done','removed','archived','inactive'].includes(sid(t.state)); }
  function canonicalPassengerVolume(st,waiting,onboard){
    if(typeof W.cityrailCanonicalPassengerVolume==='function') return W.cityrailCanonicalPassengerVolume(st,waiting,onboard);
    const generated=num(st._totalGenerated||st.totalGenerated||st.totalPassengerFlow);
    const delivered=num(st._totalDelivered||st.totalDelivered);
    return Math.max(0,Math.round(Math.max(generated,delivered+num(waiting)+num(onboard))));
  }
  function fareRevenueYuan(st){
	    if(typeof W.cityrailCanonicalFareRevenueYuan==='function') return num(W.cityrailCanonicalFareRevenueYuan());
	    if(typeof W.cityrailComputeFareRevenueYuan==='function') return num(W.cityrailComputeFareRevenueYuan());
	    return num(st._fareRevenueYuan||st._fareRevenue||st._fareIncome||st.fareIncome);
	  }
	  function farePolicyReport(){
	    if(typeof W.cityrailFarePolicyReport==='function'){
	      try{ return W.cityrailFarePolicyReport(); }catch(e){}
	    }
	    const st=state(),policy=Object.assign({preset:'standard',base:3,baseKm:6,step:1,stepKm:10,cap:15,multiplier:1},st.farePolicy||{});
	    return {policy,cityDefault:Object.assign({},policy),demandMultiplier:1,samples:{km6:policy.base,km12:policy.base+policy.step,km24:policy.cap,defaultKm12:policy.base+policy.step}};
  }
  function cachedStats(st){ return st.__v114StatsCache||st.__v113StatsCache||st.__v112StatsCache||{}; }
  function passengerStats(st){
    const api=W.CityRailPassengerStatsLedger;
    if(api&&typeof api.snapshot==='function'){
      try{ return api.snapshot(); }catch(e){}
    }
    const stations=Array.isArray(st.stations)?st.stations:[];
    const stationMap=new Map();
    let waiting=0,onboard=0;
    for(const station of stations){
      const id=sid(station&&station.id);
      const pool=(st.stationWaitingPool||{})[id]||(st.stationWaitingPool||{})[sid(id)]||{};
      const row={id,station,waiting:num(pool.waiting),up:Math.ceil(num(pool.waiting)/2),down:Math.floor(num(pool.waiting)/2),delivered:num(pool.totalDelivered||station&&station.totalDelivered||station&&station.delivered),lineNames:[],flow:num(pool.totalDelivered||station&&station.totalFlow)};
      stationMap.set(id,row);
      waiting+=row.waiting;
    }
    for(const train of (Array.isArray(st.trains)?st.trains:[])) if(activeTrain(train)) onboard+=num(train.load??train.passengers??train.onboard);
    const delivered=num(st._totalDelivered||st.totalDelivered);
    return {waiting,onboard,delivered,totalFlow:canonicalPassengerVolume(st,waiting,onboard),stationMap,topStations:Array.from(stationMap.values()),lineFlow:new Map(),lineWaiting:new Map()};
  }
  function havKm(a,b){
    if(!a||!b) return 0;
    const R=6371,lat1=num(a.lat)*Math.PI/180,lat2=num(b.lat)*Math.PI/180,dlat=(num(b.lat)-num(a.lat))*Math.PI/180,dlng=(num(b.lng)-num(a.lng))*Math.PI/180;
    const x=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlng/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
  }
  function stationPosition(station,lineId){
    return station&&station.linePositions&&station.linePositions[lineId]?station.linePositions[lineId]:station;
  }
  function stationGroupName(station){
    return sid(station&&(station.name||station.id)).trim()||sid(station&&station.id);
  }
  function addLineName(list,name){
    const value=sid(name).trim();
    if(value&&!list.includes(value)) list.push(value);
  }
  function liveLineLength(st,line){
    if(!line||!Array.isArray(line.stationIds)) return 0;
    const sm=new Map((Array.isArray(st.stations)?st.stations:[]).map(sta=>[sid(sta.id),sta]));
    const wps=Array.isArray(line.waypoints)?line.waypoints:[];
    const nodes=[];
    line.stationIds.forEach((stationId,i)=>{
      const sta=sm.get(sid(stationId));
      if(!sta) return;
      const pos=stationPosition(sta,line.id);
      nodes.push({lat:num(pos&&pos.lat),lng:num(pos&&pos.lng)});
      if(i<line.stationIds.length-1){
        wps.filter(w=>num(w.segIdx,-1)===i).sort((a,b)=>num(a.order)-num(b.order)).forEach(w=>nodes.push({lat:num(w.lat),lng:num(w.lng)}));
      }
    });
    let total=0;
    for(let i=1;i<nodes.length;i++) total+=havKm(nodes[i-1],nodes[i]);
    return total;
  }
  function lineLength(st,line){
    const cache=st.lineLengthCache||{};
    return num(cache[line.id],num(line.lengthKm,num(line.length)));
  }
  function refreshLiveLineLengths(st){
    if(!st||!Array.isArray(st.lines)) return 0;
    st.lineLengthCache=st.lineLengthCache||{};
    let total=0;
    for(const line of st.lines){
      const len=liveLineLength(st,line);
      st.lineLengthCache[line.id]=len;
      line.lengthKm=len;
      total+=len;
    }
    st._networkLengthKmLive=total;
    return total;
  }
  function connectorLineForStats(line){
    return !!(line && (line.kind==='connector' || line.type==='connector' || line.isConnectorLine===true));
  }
  function trainOnConnectorLineForStats(train, connector){
    if(!train || !connectorLineForStats(connector)) return false;
    const route=train.routePlan||{};
    const connectorId=sid((train&&train._connectorLineId)||route.connectorLineId||train&&train.connectorLineId);
    if(connectorId!==sid(connector.id)) return false;
    const routeIds=Array.isArray(route.stationIds)?route.stationIds.map(sid):[];
    const connectorIds=Array.isArray(connector.stationIds)?connector.stationIds.map(sid):[];
    if(routeIds.length<2 || connectorIds.length<2) return false;
    const nextIdx=Math.max(0,Math.min(routeIds.length-1,Math.round(num(train.nextStationIdx??train.nextStationIndex??train.targetStationIndex))));
    const prevIdx=num(train.direction)===1 ? nextIdx+1 : nextIdx-1;
    if(prevIdx<0 || prevIdx>=routeIds.length || prevIdx===nextIdx) return false;
    const a=routeIds[prevIdx], b=routeIds[nextIdx];
    return (a===connectorIds[0]&&b===connectorIds[1]) || (a===connectorIds[1]&&b===connectorIds[0]);
  }
  function trainLineIdsForStats(train,lineById){
    const ids=[];
    const primary=sid(train&&train.lineId);
    if(primary) ids.push(primary);
    const route=(train&&train.routePlan)||{};
    const connectorId=sid((train&&train._connectorLineId)||route.connectorLineId||train&&train.connectorLineId);
    const connectorLine=lineById&&lineById.get(connectorId);
    if(connectorId&&trainOnConnectorLineForStats(train,connectorLine)&&!ids.includes(connectorId)) ids.push(connectorId);
    return ids;
  }
  function makeSnapshot(){
    const started=performance.now(),st=state();
    refreshLiveLineLengths(st);
    const lines=Array.isArray(st.lines)?st.lines:[];
    const stations=Array.isArray(st.stations)?st.stations:[];
    const trains=Array.isArray(st.trains)?st.trains:[];
    const pstats=passengerStats(st);
    const cacheApi=W.CityRailStatsCacheV114;
    const cached=cacheApi&&typeof cacheApi.stats==='function'?cacheApi.stats():cachedStats(st);
    const cachedLines=cached.line||{},cachedStations=cached.station||{};
    const statsRows=Array.isArray(st.lineStatsData)?st.lineStatsData:[];
    const fallbackFlow=new Map(statsRows.map(row=>[sid(row.id||row.lineId||row.name),num(row.flow||row.passengers)]));
    const lineById=new Map(lines.map(line=>[sid(line&&line.id),line]));
    const trainCounts=new Map();
    const trainLoads=new Map();
    const trainCaps=new Map();
    let online=0;
    for(const train of trains){
      if(!activeTrain(train)) continue;
      online++;
      const load=num(train.load??train.passengers??train.onboard??train.passengerCount);
      const cap=num(train.capacity??train.maxCapacity??train.crushCapacity??train.maxLoad,0);
      for(const id of trainLineIdsForStats(train,lineById)){
        trainCounts.set(id,(trainCounts.get(id)||0)+1);
        trainLoads.set(id,(trainLoads.get(id)||0)+load);
        if(cap>0) trainCaps.set(id,(trainCaps.get(id)||0)+cap);
      }
    }
    const lineNamesByStation=new Map();
    for(const line of lines){
      for(const stationId of (line.stationIds||[])){
        const id=sid(stationId),names=lineNamesByStation.get(id)||[];
        names.push(sid(line.name||line.id)); lineNamesByStation.set(id,names);
      }
    }
    const stationGroups=new Map();
    for(const station of stations){
      const row=cachedStations[sid(station.id)]||{};
      const pool=(st.stationWaitingPool||{})[station.id]||(st.stationWaitingPool||{})[sid(station.id)]||{};
      const ledgerRow=pstats.stationMap&&pstats.stationMap.get(sid(station.id));
      const stationWait=num(ledgerRow&&ledgerRow.waiting,num(row.waiting,num(pool.waiting)));
      const stationDelivered=num(ledgerRow&&ledgerRow.delivered,num(pool.totalDelivered,num(pool.deliveredTotal,num(station.totalDelivered||station.delivered||row.delivered))));
      const key=stationGroupName(station);
      const existing=stationGroups.get(key);
      if(existing){
        existing.waiting+=stationWait;
        existing.delivered+=stationDelivered;
        existing.stationIds.push(sid(station.id));
        (lineNamesByStation.get(sid(station.id))||[]).forEach(name=>addLineName(existing.lineNames,name));
      }else{
        const lineNames=[];
        (lineNamesByStation.get(sid(station.id))||[]).forEach(name=>addLineName(lineNames,name));
        stationGroups.set(key,{
          id:sid(station.id),stationIds:[sid(station.id)],name:sid(station.name||station.id),
          lineNames,waiting:stationWait,delivered:stationDelivered
        });
      }
    }
    const stationRows=Array.from(stationGroups.values()).map(row=>Object.assign(row,{lines:row.lineNames.join(' / ')||'-'}));
    const lineRows=sortedLinesByNumber(lines).map(line=>{
      const id=sid(line.id),flow=Math.max(num(pstats.lineFlow&&pstats.lineFlow.get(id)),num(pstats.lineWaiting&&pstats.lineWaiting.get(id)),num(cachedLines[id],num(fallbackFlow.get(id),num(fallbackFlow.get(sid(line.name))))));
      const active=trainCounts.get(id)||0;
      const load=trainLoads.get(id)||0;
      const capacity=trainCaps.get(id)||Math.max(0,active*num(line.capacity,1860));
      return {
        id,name:sid(line.name||line.id),color:sid(line.color||'#4fc3f7'),
        express:!!((line.expressService&&line.expressService.enabled)||line.expressEnabled),
        trainType:trainTypeName(line.trainType||'A'),cars:num(line.cars||line.carCount,8),
        speed:num(line.speed||line.maxSpeed,80),length:lineLength(st,line),active,flow,
        crowd:capacity>0?Math.min(999,Math.round(load/capacity*100)):0
      };
    }).sort(compareRowsByLineNumber);
    let maxSegment=0;
    for(const segment of (Array.isArray(st.segmentFlowsCache)?st.segmentFlowsCache:[])){
      maxSegment=Math.max(maxSegment,num(segment.demandFlow||segment.flow));
    }
    const delivered=num(st._totalDelivered||st.totalDelivered);
    const waiting=num(pstats.waiting);
    const onboard=num(pstats.onboard,trains.reduce((a,t)=>a+(activeTrain(t)?num(t.passengers||t.load||t.onboard):0),0));
    const totalFlow=num(pstats.totalFlow,canonicalPassengerVolume(st,waiting,onboard));
    const hourly=updateHourlySeries(st,totalFlow,st.simulationHour);
    const length=lineRows.reduce((sum,row)=>sum+row.length,0);
    const topStations=stationRows.sort((a,b)=>(b.waiting+b.delivered)-(a.waiting+a.delivered)||a.name.localeCompare(b.name,'zh-CN')).slice(0,5);
	    const depots=depotSnapshot();
	    const snap=Object.freeze({
	      at:Date.now(),hour:num(st.simulationHour),speed:num(st.simSpeed),online,delivered,totalFlow,waiting,hourly:Object.freeze(hourly.slice(0,24)),
		      fare:fareRevenueYuan(st),farePolicy:farePolicyReport(),maxSegment,length,
	      lineCount:new Set(lineRows.map(row=>row.name.replace(/支线|主线/g,''))).size,
	      lineRows:Object.freeze(lineRows),topStations:Object.freeze(topStations),depots:Object.freeze(depots)
	    });
    snapshotBuildMs=performance.now()-started;
    lastBuildAt=performance.now(); lastSnapshot=snap;
    return snap;
  }
  function setText(id,value){ const el=byId(id),next=sid(value); if(el&&el.textContent!==next) el.textContent=next; }
  function setHTML(id,html){ const el=byId(id); if(!el||el.innerHTML===html) return; const wrap=el.parentElement,top=wrap&&wrap.scrollTop,left=wrap&&wrap.scrollLeft; el.innerHTML=html; if(wrap){wrap.scrollTop=top;wrap.scrollLeft=left;} }
  function findStableChild(root,selector,id){
    const target=sid(id);
    return Array.from(root.querySelectorAll(selector)).find(el=>sid(el.dataset.lineId)===target)||null;
  }
  function renderLineStatsEmpty(tbody){
    ensureLineStatsStructure(tbody);
    Array.from(tbody.children).forEach(child=>child.remove());
    const tr=D.createElement('tr'),td=D.createElement('td');
    tr.className='ctrl-empty-row';
    td.colSpan=LINE_STATS_COLUMNS.length;
    td.textContent='暂无数据';
    tr.appendChild(td);
    tbody.appendChild(tr);
    tbody.dataset.cityrailStableRows='empty';
  }
  function ensureLineStatsStructure(tbody){
    if(!tbody) return null;
    const table=tbody.closest('table');
    if(!table) return tbody;
    table.id='cct-line-stats-table';
    table.dataset.controlTable='line-stats';
    table.dataset.controlOwner=VERSION;
    table.classList.add('cityrail-control-line-table');
    const sig=LINE_STATS_COLUMNS.map(col=>col.key+':'+col.width).join('|');
    const colgroups=Array.from(table.querySelectorAll('colgroup[data-control-line-cols]'));
    let colgroup=colgroups[0];
    if(!colgroup){
      colgroup=D.createElement('colgroup');
      table.insertBefore(colgroup,table.firstChild);
    }
    colgroups.slice(1).forEach(el=>el.remove());
    colgroup.dataset.controlLineCols='v146';
    if(colgroup.dataset.sig!==sig){
      colgroup.innerHTML=LINE_STATS_COLUMNS.map(col=>`<col data-col="${esc(col.key)}" style="width:${num(col.width,80)}px">`).join('');
      colgroup.dataset.sig=sig;
    }
    const thead=table.tHead||table.createTHead();
    const tr=thead.rows[0]||thead.insertRow();
    if(thead.dataset.sig!==sig){
      tr.innerHTML=LINE_STATS_COLUMNS.map(col=>`<th data-col="${esc(col.key)}" class="cc-col cc-col-${esc(col.key)}">${esc(col.label)}</th>`).join('');
      thead.dataset.sig=sig;
    }
    return tbody;
  }
  function ensureLineStatsRow(tbody,row){
    const id=sid(row.id);
    let tr=findStableChild(tbody,'tr[data-line-id]',id);
    if(tr&&(tr.dataset.cityrailStableRow!=='v146'||!tr.querySelector('[data-col="crowding"]'))){
      tr.remove();
      tr=null;
    }
    if(!tr){
      tr=D.createElement('tr');
      tr.dataset.lineId=id;
      tr.dataset.cityrailStableRow='v146';
      tr.innerHTML='<td data-col="color"><span data-f="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%"></span></td><td data-col="line" data-f="name"></td><td data-col="express" class="cc-express-cell"><button class="cc-express-open" data-f="express" type="button"></button></td><td data-col="type" data-f="trainType"></td><td data-col="cars" data-f="cars"></td><td data-col="speed" data-f="speed"></td><td data-col="length" data-f="length"></td><td data-col="trains" data-f="active"></td><td data-col="ridership" data-f="flow"></td><td data-col="crowding" data-f="crowd"></td>';
    }
    return tr;
  }
  function renderLineStatsTable(rows){
    const tbody=byId('cct-line-stats-body');
    if(!tbody) return;
    ensureLineStatsStructure(tbody);
    if(!rows.length){
      renderLineStatsEmpty(tbody);
      return;
    }
    const keep=new Set();
    rows.forEach((row,index)=>{
      const id=sid(row.id);
      keep.add(id);
      const tr=ensureLineStatsRow(tbody,row);
      const desired=tbody.children[index];
      if(desired!==tr) tbody.insertBefore(tr,desired||null);
      const dot=tr.querySelector('[data-f="dot"]');
      if(dot&&dot.style.backgroundColor!==row.color) dot.style.backgroundColor=row.color;
      const values={
        name:row.name,
        trainType:row.trainType,
        cars:fmt(row.cars)+'节',
        speed:fmt(row.speed)+'km/h',
        length:row.length.toFixed(1)+'km',
        active:fmt(row.active),
        flow:fmt(row.flow),
        crowd:fmt(row.crowd)+'%'
      };
      Object.keys(values).forEach(key=>{
        const cell=tr.querySelector(`[data-f="${key}"]`);
        const next=sid(values[key]);
        if(cell&&cell.textContent!==next) cell.textContent=next;
      });
      const btn=tr.querySelector('[data-f="express"]');
      if(btn){
        const text=row.express?'已开启':'未开启';
        if(btn.textContent!==text) btn.textContent=text;
        btn.dataset.lineId=id;
        btn.classList.toggle('on',!!row.express);
        btn.classList.toggle('off',!row.express);
        btn.setAttribute('aria-label',text);
        btn.title='';
      }
    });
    Array.from(tbody.querySelectorAll('tr[data-line-id]')).forEach(tr=>{
      if(!keep.has(sid(tr.dataset.lineId))) tr.remove();
    });
    Array.from(tbody.querySelectorAll('tr:not([data-line-id])')).forEach(tr=>tr.remove());
    tbody.dataset.cityrailStableRows='line-stats';
  }
  function renderLineStatusEmpty(list){
    Array.from(list.children).forEach(child=>child.remove());
    const item=D.createElement('div');
    item.className='ctrl-empty-row';
    item.textContent='暂无线路';
    list.appendChild(item);
    list.dataset.cityrailStableRows='empty';
  }
  function ensureLineStatusRow(list,row){
    const id=sid(row.id);
    let item=findStableChild(list,'.v145-line-status[data-line-id]',id);
    if(item&&item.dataset.cityrailStableRow!=='v146'){
      item.remove();
      item=null;
    }
    if(!item){
      item=D.createElement('div');
      item.className='v145-line-status';
      item.dataset.lineId=id;
      item.dataset.cityrailStableRow='v146';
      item.style.display='grid';
      item.style.gridTemplateColumns='14px minmax(0,1fr) 6.5em';
      item.style.alignItems='center';
      item.style.columnGap='6px';
      item.style.minHeight='29px';
      item.innerHTML='<span data-f="dot">●</span><span data-f="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><span data-f="active" style="font-variant-numeric:tabular-nums;text-align:right"></span>';
    }
    return item;
  }
  function renderLineStatusList(rows){
    const list=byId('cct-line-status-list');
    if(!list) return;
    const allRows=rows.slice();
    list.dataset.lineCount=String(allRows.length);
    if(!allRows.length){
      renderLineStatusEmpty(list);
      return;
    }
    const keep=new Set();
    allRows.forEach((row,index)=>{
      const id=sid(row.id);
      keep.add(id);
      const item=ensureLineStatusRow(list,row);
      const desired=list.children[index];
      if(desired!==item) list.insertBefore(item,desired||null);
      const dot=item.querySelector('[data-f="dot"]');
      if(dot&&dot.style.color!==row.color) dot.style.color=row.color;
      const name=item.querySelector('[data-f="name"]');
      const active=item.querySelector('[data-f="active"]');
      const nameText=sid(row.name);
      const activeText=fmt(row.active)+'列在线';
      if(name&&name.textContent!==nameText) name.textContent=nameText;
      if(active&&active.textContent!==activeText) active.textContent=activeText;
      item.title=nameText+' · '+activeText;
    });
    Array.from(list.querySelectorAll('.v145-line-status[data-line-id]')).forEach(item=>{
      if(!keep.has(sid(item.dataset.lineId))) item.remove();
    });
    Array.from(list.children).forEach(child=>{
      if(!child.classList.contains('v145-line-status')||!child.dataset.lineId||!keep.has(sid(child.dataset.lineId))) child.remove();
    });
    list.dataset.cityrailStableRows='line-status';
  }

  function formatMoney(v){
    const n=Math.max(0,Math.round(num(v)));
    if(n>=100000000) return '¥'+(n/100000000).toFixed(2).replace(/\.00$/,'')+'亿';
    if(n>=10000) return '¥'+(n/10000).toFixed(1).replace(/\.0$/,'')+'万';
    return '¥'+n.toLocaleString('zh-CN');
  }
  function activateControlTab(btn){
    const ov=byId('ctrl-center-overlay');
    if(!ov||!btn) return;
    const tab=sid(btn.dataset.tab||'overview')||'overview';
    ov.querySelectorAll('#ctrl-nav .ctrl-nav-item').forEach(item=>item.classList.toggle('active',item===btn));
    ov.setAttribute('data-active-tab',tab);
    refresh(true);
  }
  function dailyReportSnapshot(snap){
    const api=W.CityRailLivingCity;
    if(api&&typeof api.tick==='function') {
      try { api.tick('control-center-daily'); } catch(e) {}
    }
    if(api&&typeof api.dailyReport==='function'){
      try{ return api.dailyReport(); }catch(e){}
    }
    const topStation=(snap.topStations||[])[0]||{};
    const topLine=(snap.lineRows||[]).slice().sort((a,b)=>num(b.flow)-num(a.flow))[0]||{};
    return {
      version:'control-center',
      hour:num(snap.hour),
      current:{
        totalDayFlow:num(snap.totalFlow),
        vitality:0,
        pressure:0,
        satisfaction:0,
        growthStations:0,
        stressedStations:0,
        stationCount:(snap.topStations||[]).length,
        lineCount:num(snap.lineCount),
        trainCount:num(snap.online)
      },
      topGrowth:[],
      topPressure:topStation.name?[{name:topStation.name,value:0,waiting:topStation.waiting,stage:'重点车站'}]:[],
      topLines:topLine.name?[{name:topLine.name,pressure:topLine.crowd,waiting:0,trains:topLine.active,crowd:topLine.crowd}]:[],
      recommendations:[{severity:'info',title:'城市脉动尚未完成本次采样',body:'开始模拟后，运营日报会显示跨天成长、站区压力和城市表现。'}],
      lastDay:null,
      prevDay:null,
      delta:{flow:0,performance:0}
    };
  }
  function trendText(value,suffix){
    const v=num(value);
    if(Math.abs(v)<0.05) return '持平';
    const abs=Math.abs(v);
    return (v>0?'+':'-')+(abs>=1000?fmt(abs):abs.toFixed(abs>=10?0:1))+(suffix||'');
  }
	  function ensureControlCenterCleanStructure(){
		    const topbar=byId('ctrl-topbar');
    if(topbar&&!byId('cct-network-length-stat')){
      const lineCountStat=byId('cct-line-count')&&byId('cct-line-count').closest('.ctrl-top-stat');
      const stat=D.createElement('div');
      stat.id='cct-network-length-stat';
      stat.className='ctrl-top-stat';
      stat.innerHTML='<span class="ts-label">线网总长度</span><span class="ts-val" id="cct-network-length">0.0 km</span>';
      if(lineCountStat&&lineCountStat.nextSibling) topbar.insertBefore(stat,lineCountStat.nextSibling);
      else topbar.insertBefore(stat,byId('ctrl-close-btn')||null);
    }
    const flowTitle=[...D.querySelectorAll('.ctrl-card-title')].find(el=>sid(el.textContent).trim()==='全网客流概览');
    if(flowTitle){
      const card=flowTitle.closest('.ctrl-card');
      const grid=card&&card.querySelector('.ctrl-v1464-flow-overview');
      if(card&&!grid){
        [...card.children].forEach(ch=>{ if(ch!==flowTitle) ch.remove(); });
        const box=D.createElement('div');
        box.className='ctrl-v1464-flow-overview';
        box.setAttribute('data-control-section','network-flow-overview');
        box.innerHTML='<div><div class="ctrl-big-num" id="cct-big-flow">0.0万</div><div class="ctrl-big-sub">全网总客流</div></div><div><div class="ctrl-big-num" id="cct-big-waiting">0</div><div class="ctrl-big-sub">全网候车</div></div><div><div class="ctrl-big-num" id="cct-big-fare">¥0</div><div class="ctrl-big-sub">客票收入</div></div>';
        card.appendChild(box);
      }
    }
    const hourly=D.getElementById('cct-hourly-flow-svg');
    if(hourly){
      const card=hourly.closest('.ctrl-card');
      if(card){
        card.classList.add('full','cr-flow-rhythm-card');
        card.classList.remove('half');
        const title=card.querySelector('.ctrl-card-title');
        if(title) title.textContent='客流节律';
        card.querySelectorAll('.v101-run-diagram,.v102-run-diagram,.run-diagram-rate,.old-hourly,.ctrl-old-exec,.ctrl-empty:not(.ctrl-empty-row)').forEach(el=>el.remove());
        const legend=D.getElementById('cct-hourly-flow-legend');
        if(legend){
          legend.className='ctrl-v1464-hourly-legend';
          if(!D.getElementById('cct-hourly-flow-current')) legend.innerHTML='<span>0点—24点全线网总客流 · 蓝色区间为高峰</span><span id="cct-hourly-flow-current">当前小时：--</span>';
          else {
            const first=legend.querySelector('span:not(#cct-hourly-flow-current)');
            if(first) first.textContent='0点—24点全线网总客流 · 蓝色区间为高峰';
          }
        }
        if(!D.getElementById('cct-flow-rhythm-stats')){
          const stats=D.createElement('div');
          stats.id='cct-flow-rhythm-stats';
          stats.className='cr-flow-rhythm-stats';
          stats.innerHTML='<div><span>当前小时</span><b id="cct-flow-rhythm-current">--</b></div><div><span>今日峰值</span><b id="cct-flow-rhythm-peak">--</b></div><div><span>峰谷比</span><b id="cct-flow-rhythm-ratio">--</b></div>';
          card.appendChild(stats);
        }
      }
    }
	    const nav=byId('ctrl-nav');
		    if(nav&&!nav.querySelector('.ctrl-nav-item[data-tab="depots"]')){
	      const btnDepot=D.createElement('button');
	      btnDepot.className='ctrl-nav-item';
	      btnDepot.dataset.tab='depots';
	      btnDepot.dataset.action='depots';
	      btnDepot.title='车辆段';
	      btnDepot.setAttribute('aria-label','车辆段');
	      btnDepot.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 19V8.5L12 4l8 4.5V19"/><path d="M7 19v-7h10v7"/><path d="M9 15h6"/></svg>';
	      nav.appendChild(btnDepot);
	    }
		    ensureDepotCard();
		    ensureFareCard();
		    ensureDailyReportCard();
	    const btnDepot=nav&&nav.querySelector('.ctrl-nav-item[data-tab="depots"]');
	    if(btnDepot){
	      btnDepot.title='车辆段';
	      btnDepot.dataset.action='depots';
	      btnDepot.setAttribute('aria-label','车辆段');
		    }
	    if(nav&&!nav.querySelector('.ctrl-nav-item[data-tab="fare-policy"]')){
	      const btnFare=D.createElement('button');
	      btnFare.className='ctrl-nav-item';
	      btnFare.dataset.tab='fare-policy';
	      btnFare.dataset.action='fare-policy';
	      btnFare.title='票价政策';
	      btnFare.setAttribute('aria-label','票价政策');
	      btnFare.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M6 4h12v16H6z"/><path d="M9 10h6"/><path d="M9 14h4"/></svg>';
	      nav.appendChild(btnFare);
	    }
	    const btnFare=nav&&nav.querySelector('.ctrl-nav-item[data-tab="fare-policy"]');
		    if(btnFare){
	      btnFare.title='票价政策';
	      btnFare.dataset.action='fare-policy';
	      btnFare.setAttribute('aria-label','票价政策');
	    }
	    if(nav&&!nav.querySelector('.ctrl-nav-item[data-tab="daily-report"]')){
	      const btnDaily=D.createElement('button');
	      btnDaily.className='ctrl-nav-item';
	      btnDaily.dataset.tab='daily-report';
	      btnDaily.dataset.action='daily-report';
	      btnDaily.title='运营日报';
	      btnDaily.setAttribute('aria-label','运营日报');
	      btnDaily.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8"/><path d="M8 12h5"/><path d="M8 16h7"/><path d="M17 3v4"/><path d="M7 3v4"/></svg>';
	      nav.appendChild(btnDaily);
	    }
		  }
		  function ensureDepotCard(){
		    const grid=byId('ctrl-content-grid'); if(!grid) return null;
	    let card=byId('cr200-depot-card');
	    if(card) return card;
	    card=D.createElement('div');
	    card.id='cr200-depot-card';
	    card.className='ctrl-card full cr200-depot-card';
	    card.innerHTML='<div class="ctrl-card-title">车辆段状态</div><div class="cr200-depot-summary"><div><span>总容量</span><b id="cct-depot-capacity">0</b></div><div><span>在段车辆</span><b id="cct-depot-stored">0</b></div><div><span>正线运营</span><b id="cct-depot-service">0</b></div><div><span>回段中</span><b id="cct-depot-pullin">0</b></div><div><span>检修车辆</span><b id="cct-depot-maint">0</b></div></div><div id="cct-depot-list" class="cr200-depot-list"></div><div id="cct-depot-alert" class="cr200-depot-alert" style="display:none"></div>';
	    grid.appendChild(card);
	    return card;
	  }
	  function ensureFareCard(){
	    const grid=byId('ctrl-content-grid'); if(!grid) return null;
	    let card=byId('cct-fare-policy-card');
	    if(card) return card;
	    card=D.createElement('div');
	    card.id='cct-fare-policy-card';
	    card.className='ctrl-card full cr210-fare-card';
	    card.innerHTML=[
	      '<div class="cr210-fare-head"><div><div class="cr210-fare-title">票价政策</div><div class="cr210-fare-sub" id="cct-fare-policy-sub">城市默认</div></div><div class="cr210-fare-badge" id="cct-fare-demand">客流 100%</div></div>',
	      '<div class="cr210-segment" role="tablist" aria-label="票价预设"><button type="button" data-fare-preset="standard">标准</button><button type="button" data-fare-preset="low">低票价</button><button type="button" data-fare-preset="high">高票价</button><button type="button" data-fare-preset="custom">自定义</button></div>',
	      '<div class="cr210-fare-grid">',
	      '<div class="cr210-field"><label>起步价 <b id="fare-val-base">--</b></label><input data-fare-field="base" type="number" min="0" max="80" step="0.5"></div>',
	      '<div class="cr210-field"><label>起步里程 <b id="fare-val-baseKm">--</b></label><input data-fare-field="baseKm" type="number" min="1" max="40" step="0.5"></div>',
	      '<div class="cr210-field"><label>递增票价 <b id="fare-val-step">--</b></label><input data-fare-field="step" type="number" min="0" max="30" step="0.5"></div>',
	      '<div class="cr210-field"><label>递增里程 <b id="fare-val-stepKm">--</b></label><input data-fare-field="stepKm" type="number" min="1" max="40" step="0.5"></div>',
	      '<div class="cr210-field"><label>最高票价 <b id="fare-val-cap">--</b></label><input data-fare-field="cap" type="number" min="1" max="300" step="0.5"></div>',
	      '<div class="cr210-field"><label>票价倍率 <b id="fare-val-multiplier">--</b></label><input data-fare-field="multiplier" type="number" min="0.5" max="20" step="0.05"></div>',
	      '</div>',
	      '<div class="cr210-samples"><div class="cr210-sample"><span>6 km</span><b id="fare-sample-6">--</b></div><div class="cr210-sample"><span>12 km</span><b id="fare-sample-12">--</b></div><div class="cr210-sample"><span>24 km</span><b id="fare-sample-24">--</b></div><div class="cr210-sample"><span>默认 12 km</span><b id="fare-sample-default">--</b></div></div>',
	      '<div class="cr210-fare-actions"><button type="button" data-fare-reset>恢复城市默认</button></div>',
	      '<div class="cr210-line-section"><div class="cr210-line-head"><b>线路单独计费</b><span>按乘坐里程加权</span></div><div class="cr210-line-buttons" id="cct-fare-line-buttons"></div><div class="cr210-line-editor" id="cct-fare-line-editor"><div class="cr210-line-editor-name"><i id="fare-line-color" class="cr210-line-color" aria-hidden="true"></i><div><b id="fare-line-name">选择一条线路</b><span id="fare-line-sub">默认 1.00x</span></div></div><label>线路票价倍率<input id="fare-line-multiplier" type="number" min="0.5" max="30" step="0.05"></label><button type="button" data-line-fare-reset>恢复 1.00x</button></div></div>'
	    ].join('');
	    grid.appendChild(card);
	    return card;
	  }
	  function ensureDailyReportCard(){
	    const grid=byId('ctrl-content-grid'); if(!grid) return null;
	    let card=byId('cct-daily-report-card');
	    if(card) return card;
	    card=D.createElement('div');
	    card.id='cct-daily-report-card';
	    card.className='ctrl-card full cr-daily-card';
	    card.innerHTML='<div class="cr-daily-head"><div><div class="cr-daily-title">运营日报</div><div class="cr-daily-sub" id="cct-daily-sub">城市脉动跨天统计</div></div><div class="cr-daily-badge" id="cct-daily-badge">实时</div></div><div id="cct-daily-body"></div>';
	    const flowCard=D.querySelector('.ctrl-passenger-flow-card');
	    if(flowCard&&flowCard.parentNode===grid) grid.insertBefore(card,flowCard);
	    else grid.appendChild(card);
	    return card;
	  }
		  function depotSnapshot(){
	    const api=W.CityRailDepotService;
	    if(api&&typeof api.report==='function'){
	      try{ return api.report(); }catch(e){}
	    }
	    return {rows:[],totals:{capacity:0,stored:0,inService:0,pullingIn:0,pullingOut:0,maintenance:0,shortage:0},virtualFallback:false};
	  }
	  function farePresetPolicy(preset, report){
	    const d=Object.assign({},report.cityDefault||{});
	    if(preset==='low') return Object.assign(d,{preset:'low',multiplier:0.85});
	    if(preset==='high') return Object.assign(d,{preset:'high',multiplier:1.2});
	    if(preset==='custom') return Object.assign({},report.policy||d,{preset:'custom'});
	    return Object.assign(d,{preset:'standard',multiplier:1});
	  }
	  function fmtFareValue(value, suffix){
	    const n=num(value);
	    const fixed=Math.abs(n-Math.round(n))<0.001?String(Math.round(n)):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
	    return fixed + (suffix||'');
	  }
	  function setFarePolicy(next){
	    if(typeof W.cityrailSetFarePolicy==='function') W.cityrailSetFarePolicy(next);
	    else state().farePolicy=Object.assign({},state().farePolicy||{},next||{});
	    if(W.CityRailStatsCacheV114&&typeof W.CityRailStatsCacheV114.markDirty==='function') W.CityRailStatsCacheV114.markDirty('fare-policy');
	  }
	  function setLineFareMultiplier(lineId,value){
	    if(typeof W.cityrailSetLineFareMultiplier==='function') W.cityrailSetLineFareMultiplier(lineId,value);
	    else {
	      const st=state();
	      const line=(st.lines||[]).find(l=>sid(l.id)===sid(lineId));
	      if(line) line.fareMultiplier=Math.max(0.5,Math.min(30,num(value,1)));
	    }
	    if(W.CityRailStatsCacheV114&&typeof W.CityRailStatsCacheV114.markDirty==='function') W.CityRailStatsCacheV114.markDirty('line-fare-policy');
	  }
	  function contrastText(hex){
	    const raw=sid(hex||'').replace('#','');
	    if(raw.length<6) return '#fff';
	    const r=parseInt(raw.slice(0,2),16),g=parseInt(raw.slice(2,4),16),b=parseInt(raw.slice(4,6),16);
	    return (r*299+g*587+b*114)/1000 > 150 ? '#111827' : '#fff';
	  }
	  function renderLineFareControls(report){
	    const lines=sortedLinesByNumber(Array.isArray(report&&report.lines)?report.lines:[]);
	    const list=byId('cct-fare-line-buttons');
	    if(!list) return;
	    if(!lines.length){
	      list.innerHTML='<div class="ctrl-empty-row">暂无线路</div>';
	      selectedFareLineId='';
	      setText('fare-line-name','暂无线路');
	      setText('fare-line-sub','建成线路后可设置');
	      const swatch=byId('fare-line-color');
	      if(swatch) swatch.style.background='transparent';
	      const input=byId('fare-line-multiplier');
	      if(input) input.disabled=true;
	      return;
	    }
	    if(!selectedFareLineId || !lines.some(line=>sid(line.id)===sid(selectedFareLineId))) selectedFareLineId=sid(lines[0].id);
	    const html=lines.map(line=>{
	      const color=sid(line.color||'#0A84FF');
	      const text=contrastText(color);
	      return `<button type="button" class="cr210-line-btn ${sid(line.id)===sid(selectedFareLineId)?'on':''}" data-line-fare-id="${esc(line.id)}" style="--line-color:${esc(color)};--line-text:${esc(text)}" title="${esc(line.name)} · ${fmtFareValue(num(line.fareMultiplier,1),'x')}"><span class="cr210-line-swatch" aria-hidden="true"></span><span>${esc(line.name)}</span></button>`;
	    }).join('');
	    if(list.innerHTML!==html) list.innerHTML=html;
	    const selected=lines.find(line=>sid(line.id)===sid(selectedFareLineId))||lines[0];
	    const selectedColor=sid(selected.color||'#0A84FF');
	    const swatch=byId('fare-line-color');
	    if(swatch) swatch.style.background=selectedColor;
	    const editor=byId('cct-fare-line-editor');
	    if(editor) editor.style.setProperty('--line-color', selectedColor);
	    setText('fare-line-name',selected.name||selected.id);
	    setText('fare-line-sub','当前 '+fmtFareValue(num(selected.fareMultiplier,1),'x'));
	    const input=byId('fare-line-multiplier');
	    if(input){
	      input.disabled=false;
	      if(D.activeElement!==input) input.value=String(num(selected.fareMultiplier,1));
	    }
	  }
	  function renderFarePanel(snap){
		    const ov=byId('ctrl-center-overlay');
		    if(ov&&ov.getAttribute('data-active-tab')!=='fare-policy') return;
		    ensureFareCard();
		    const report=(snap&&snap.farePolicy)||farePolicyReport();
		    const policy=report.policy||{};
		    const preset=sid(policy.preset||'standard');
		    const editable=preset==='custom';
		    D.querySelectorAll('#cct-fare-policy-card [data-fare-preset]').forEach(btn=>btn.classList.toggle('on',sid(btn.dataset.farePreset)===preset));
		    const fields={base:'¥',baseKm:' km',step:'¥',stepKm:' km',cap:'¥',multiplier:'x'};
		    Object.keys(fields).forEach(key=>{
		      const input=byId('cct-fare-policy-card')&&D.querySelector(`#cct-fare-policy-card [data-fare-field="${key}"]`);
		      const value=key==='multiplier'?num(policy[key],1):num(policy[key]);
		      if(input){
		        input.disabled=!editable;
		        input.title=editable?'':'选择“自定义”后可修改';
		        if(D.activeElement!==input) input.value=String(value);
		      }
		      const label=byId('fare-val-'+key);
		      if(label) label.textContent=fmtFareValue(value,fields[key]);
		    });
	    const demand=Math.round(num(report.demandMultiplier,1)*100);
	    setText('cct-fare-demand','客流 '+demand+'%');
	    const city=sid(policy.cityId||'默认');
	    const sub=byId('cct-fare-policy-sub');
	    if(sub) sub.textContent=city+' · '+({standard:'标准',low:'低票价',high:'高票价',custom:'自定义'}[preset]||'自定义');
	    const samples=report.samples||{};
	    setText('fare-sample-6','¥'+fmt(num(samples.km6)));
	    setText('fare-sample-12','¥'+fmt(num(samples.km12)));
	    setText('fare-sample-24','¥'+fmt(num(samples.km24)));
	    setText('fare-sample-default','¥'+fmt(num(samples.defaultKm12)));
	    renderLineFareControls(report);
	  }
	  function updateHourlySeries(st,totalFlow,hour){
    const arr=Array.isArray(st.__v1464HourlyTotal)?st.__v1464HourlyTotal:Array(24).fill(0);
    while(arr.length<24) arr.push(0);
    const h=((Math.floor(num(hour))%24)+24)%24;
    arr[h]=Math.max(num(arr[h]),num(totalFlow));
    st.__v1464HourlyTotal=arr.slice(0,24);
    return st.__v1464HourlyTotal;
  }
	  function renderHourlyChart(snap){
    const svg=byId('cct-hourly-flow-svg'); if(!svg) return;
    const data=(snap.hourly||[]).slice(0,24); while(data.length<24) data.push(0);
    const Wd=900,H=220,Px=38,Pr=18,Pt=24,Pb=34;
    const max=Math.max(1,...data);
    const x=i=>Px+i*((Wd-Px-Pr)/23);
    const y=v=>H-Pb-(num(v)/max)*(H-Pt-Pb);
    let grid='', bands='';
    const band=(from,to,cls)=>{ const bx=x(from), bw=x(to)-x(from); bands+=`<rect class="band ${cls}" x="${bx.toFixed(1)}" y="${Pt}" width="${bw.toFixed(1)}" height="${H-Pt-Pb}"></rect>`; };
    band(7,9,'peak'); band(17,19,'peak'); band(0,6,'offpeak'); band(22,23,'offpeak');
    for(let i=0;i<=4;i++){ const yy=Pt+i*((H-Pt-Pb)/4); grid+=`<line class="grid" x1="${Px}" y1="${yy.toFixed(1)}" x2="${Wd-Pr}" y2="${yy.toFixed(1)}"></line>`; }
    for(let i=0;i<=24;i+=3){ const xx=i===24?Wd-Pr:x(i); grid+=`<line class="grid" x1="${xx.toFixed(1)}" y1="${Pt}" x2="${xx.toFixed(1)}" y2="${H-Pb}"></line><text x="${xx.toFixed(1)}" y="${H-10}" text-anchor="middle">${i}</text>`; }
    const pts=data.map((v,i)=>[x(i),y(v),v]);
    const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    const area=d+` L ${(Wd-Pr).toFixed(1)} ${H-Pb} L ${Px} ${H-Pb} Z`;
    const h=((Math.floor(num(snap.hour))%24)+24)%24, cur=pts[h]||pts[0];
    const html=`${bands}${grid}<line class="axis" x1="${Px}" y1="${H-Pb}" x2="${Wd-Pr}" y2="${H-Pb}"></line><path class="area" d="${area}"></path><path class="line" d="${d}"></path><circle class="dot" cx="${cur[0].toFixed(1)}" cy="${cur[1].toFixed(1)}" r="5"></circle><text x="${Px}" y="16">峰值 ${fmt(max)}</text><text x="${Wd-Pr}" y="16" text-anchor="end">0—24h</text>`;
    if(svg.innerHTML!==html) svg.innerHTML=html;
    const curEl=byId('cct-hourly-flow-current'); if(curEl) curEl.textContent=`当前小时：${String(h).padStart(2,'0')}:00 · ${fmt(cur[2])}`;
    const nonzero=data.filter(v=>num(v)>0), valley=nonzero.length?Math.min(...nonzero):0, ratio=valley>0?(max/valley):0;
    setText('cct-flow-rhythm-current',fmt(cur[2]));
    setText('cct-flow-rhythm-peak',fmt(max));
    setText('cct-flow-rhythm-ratio',ratio>0?ratio.toFixed(ratio>=10?0:1)+'x':'--');
	  }
	  function renderDepotPanel(snap){
	    ensureDepotCard();
	    const report=snap.depots||depotSnapshot();
	    const totals=report.totals||{};
	    setText('cct-depot-capacity',fmt(totals.capacity));
	    setText('cct-depot-stored',fmt(totals.stored));
	    setText('cct-depot-service',fmt(totals.inService));
	    setText('cct-depot-pullin',fmt(totals.pullingIn));
	    setText('cct-depot-maint',fmt(totals.maintenance));
	    const rows=Array.isArray(report.rows)?report.rows:[];
	    const list=byId('cct-depot-list');
	    if(list){
	      if(!rows.length){
	        setHTML('cct-depot-list','<div class="ctrl-empty-row">暂无车辆段。点击地图工具栏“车辆段”建设。</div>');
	      }else{
	        const html=rows.map(row=>{
	          const lineNames=(row.lineNames||[]).length?(row.lineNames||[]).join(' / '):(row.isVirtual?'旧存档临时兜底':'未绑定线路');
	          const cap=row.isVirtual?'临时':fmt(row.capacity);
	          return `<div class="cr200-depot-row ${num(row.shortage)>0?'shortage':''}" data-depot-id="${esc(row.id)}"><div class="cr200-depot-namebox"><div class="cr200-depot-name">${esc(row.name)}${row.isVirtual?' · 虚拟':''}</div><div class="cr200-depot-lines">${esc(lineNames)}</div></div><div class="cr200-depot-stat"><span>容量</span><b>${cap}</b></div><div class="cr200-depot-stat"><span>在段</span><b>${row.isVirtual?'--':fmt(row.stored)}</b></div><div class="cr200-depot-stat"><span>正线</span><b>${fmt(row.inService)}</b></div><div class="cr200-depot-stat"><span>出/入段</span><b>${fmt(row.pullingOut)}/${fmt(row.pullingIn)}</b></div><div class="cr200-depot-stat"><span>检修</span><b>${fmt(row.maintenance)}</b></div></div>`;
	        }).join('');
	        setHTML('cct-depot-list',html);
	      }
	    }
	    const alert=byId('cct-depot-alert');
	    if(alert){
	      const shortageRows=rows.filter(row=>num(row.shortage)>0);
	      if(shortageRows.length){
	        const first=shortageRows[0];
	        const line=(snap.lineRows||[]).find(row=>sid(row.id)===sid(first.lastShortageLineId));
	        const missing=(first.missingConnections||[]).length>0 || first.lastShortageReason==='missing_depot_connection';
	        const text=missing
	          ? `车辆段未接入${line?line.name:'绑定线路'}的接轨站，列车无法出库。`
	          : `车辆段库存不足，${line?line.name:'线路'}无法完全兑现高峰发车间隔。`;
	        if(alert.textContent!==text) alert.textContent=text;
	        alert.style.display='';
	      }else{
	        alert.style.display='none';
	      }
	    }
	  }

	  function renderDailyReportPanel(snap){
	    ensureDailyReportCard();
	    const ov=byId('ctrl-center-overlay');
	    if(ov&&ov.getAttribute('data-active-tab')!=='daily-report') return;
	    const report=dailyReportSnapshot(snap);
	    const current=report.current||{};
	    const hour=Math.floor(num(report.hour));
	    const minute=Math.floor((num(report.hour)-hour)*60+1e-6);
	    const time=String(((hour%24)+24)%24).padStart(2,'0')+':'+String(minute).padStart(2,'0');
	    setText('cct-daily-sub','第 '+fmt(report.serviceDay||0)+' 天 · '+time+' · '+fmt(current.stationCount)+' 座站区 · '+fmt(current.lineCount)+' 条线路');
	    setText('cct-daily-badge',report.lastDay?'跨天日报':'实时日报');
	    const growthRows=(report.topGrowth||[]).map(row=>`<div class="cr-daily-row"><div><strong>${esc(row.name)}</strong><small>${esc(row.stage||'站区')} · 今日 ${fmt(row.dayFlow)}</small></div><em>+${Math.max(0,num(row.value)).toFixed(1)}</em></div>`).join('');
	    const pressureRows=(report.topPressure||[]).map(row=>`<div class="cr-daily-row"><div><strong>${esc(row.name)}</strong><small>${esc(row.stage||'站区')} · 候车 ${fmt(row.waiting)}</small></div><em>${Math.round(num(row.value))}%</em></div>`).join('');
	    const lineRows=(report.topLines||[]).map(row=>`<div class="cr-daily-row"><div><strong>${esc(row.name)}</strong><small>${fmt(row.trains)} 列在线 · 候车 ${fmt(row.waiting)}</small></div><em>${Math.round(num(row.pressure))}%</em></div>`).join('');
	    const recRows=(report.recommendations||[]).map(row=>`<div class="cr-daily-note"><b>${esc(row.title||'运营建议')}</b><br>${esc(row.body||'继续观察当前城市表现。')}</div>`).join('');
	    const last=report.lastDay;
	    const dayText=last
	      ? `上个运营日 ${fmt(last.stations)} 座站区 · 客流 ${fmtWan(last.flow)} · 表现 ${Math.round(num(last.performance))}`
	      : '开始跨天运营后，这里会记录上一天的城市表现。';
	    const html=[
	      '<div class="cr-daily-kpis">',
	      `<div class="cr-daily-kpi"><span>今日站区客流</span><b>${fmtWan(current.totalDayFlow)}</b></div>`,
	      `<div class="cr-daily-kpi"><span>累计城市客流</span><b>${fmtWan(current.lifetimeFlow)}</b></div>`,
	      `<div class="cr-daily-kpi"><span>城市活力</span><b>${Math.round(num(current.vitality))}</b></div>`,
	      `<div class="cr-daily-kpi"><span>治理压力</span><b>${Math.round(num(current.pressure))}</b></div>`,
	      `<div class="cr-daily-kpi"><span>满意度</span><b>${Math.round(num(current.satisfaction))}</b></div>`,
	      `<div class="cr-daily-kpi"><span>成长站区</span><b>${fmt(current.growthStations)}</b></div>`,
	      `<div class="cr-daily-kpi"><span>承压站区</span><b>${fmt(current.stressedStations)}</b></div>`,
	      `<div class="cr-daily-kpi"><span>较前一日</span><b>${trendText(report.delta&&report.delta.performance,'')}</b></div>`,
	      '</div>',
	      '<div class="cr-daily-grid">',
	      `<section class="cr-daily-panel"><h4>昨日概览</h4><div class="cr-daily-note">${esc(dayText)}${report.delta&&report.delta.flow?'<br>客流变化 '+esc(trendText(report.delta.flow,'')):''}</div><h4>成长最快站区</h4><div class="cr-daily-list">${growthRows||'<div class="cr-daily-note">暂无明显成长站区。</div>'}</div></section>`,
	      `<section class="cr-daily-panel"><h4>需要关注</h4><div class="cr-daily-list">${pressureRows||'<div class="cr-daily-note">暂无高压站区。</div>'}${lineRows}</div></section>`,
	      `<section class="cr-daily-panel"><h4>运营建议</h4>${recRows||'<div class="cr-daily-note">当前运行平稳，继续观察跨天变化。</div>'}</section>`,
	      `<section class="cr-daily-panel"><h4>日报口径</h4><div class="cr-daily-note">站区成长、压力和满意度来自城市脉动；实时客流随当天运营刷新，跨天进度会保留并根据新一天表现回退或增长。</div></section>`,
	      '</div>'
	    ].join('');
	    setHTML('cct-daily-body',html);
	  }

  function normalizeControlCenterDisplay(snap){
    const flow=fmtWan(snap.totalFlow);
    const big=byId('cct-big-flow'); if(big&&big.textContent!==flow) big.textContent=flow;
    const top=byId('cct-total-flow'); if(top&&top.textContent!==flow) top.textContent=flow;
    const lineById=new Map((snap.lineRows||[]).map(row=>[sid(row.id),row]));
    D.querySelectorAll('#ctrl-center-overlay .cc-express-cell .cc-express-open[data-line-id]').forEach(btn=>{
      const row=lineById.get(sid(btn.dataset.lineId));
      const text=row&&row.express?'已开启':'未开启';
      if(btn.textContent!==text) btn.textContent=text;
      btn.setAttribute('aria-label',text);
      btn.title='';
    });
  }

  function renderSnapshot(snap){
    ensureControlCenterCleanStructure();
    const hour=snap.hour,period=typeof W.getHeadwayPeriod==='function'?W.getHeadwayPeriod(hour):(hour>=7&&hour<9||hour>=17&&hour<19?'peak':'normal');
    setText('cct-time',formatTime(hour)); setText('cct-period',({peak:'高峰',normal:'平峰',offpeak:'低峰'}[period]||'--'));
    setText('cct-speed',snap.speed+'x'); setText('cct-online-trains',snap.online); setText('cct-total-flow',fmtWan(snap.totalFlow));
    setText('cct-intensity',(snap.length>0?fmt(snap.delivered/snap.length):'0')+'/km'); setText('cct-line-count',snap.lineCount);
    setText('cct-network-length',snap.length.toFixed(1)+' km');
    setText('cct-big-flow',fmtWan(snap.totalFlow)); setText('cct-big-waiting',fmt(snap.waiting)); setText('cct-big-fare',formatMoney(snap.fare)); const oldIn=byId('cct-big-inbound'); if(oldIn) oldIn.textContent=fmtWan(snap.totalFlow); const oldOut=byId('cct-big-outbound'); if(oldOut) oldOut.textContent=formatMoney(snap.fare); const oldMax=byId('cct-big-max-seg'); if(oldMax) oldMax.closest('div')?.remove();
    renderLineStatsTable(snap.lineRows);
    const topHTML=snap.topStations.length?snap.topStations.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.name)}</td><td>${esc(row.lines)}</td><td>${fmt(row.waiting)}</td><td>${fmt(row.delivered)}</td></tr>`).join(''):'<tr><td colspan="5" class="ctrl-empty-row">暂无数据</td></tr>';
    setHTML('cct-top5-body',topHTML);
    const ranked=snap.lineRows.slice().sort((a,b)=>b.flow-a.flow||a.name.localeCompare(b.name,'zh-CN')).slice(0,8),max=Math.max(1,...ranked.map(row=>row.flow));
    setHTML('cct-intensity-bars',ranked.length?ranked.map((row,index)=>`<div class="ctrl-bar-row"><div class="ctrl-bar-label" title="${esc(row.name)}">${index+1}. ${esc(row.name)}</div><div class="ctrl-bar-track"><div class="ctrl-bar-fill" style="width:${Math.max(2,row.flow/max*100)}%;background:${esc(row.color)}"></div></div><div class="ctrl-bar-val">${fmt(row.flow)}</div></div>`).join(''):'<div class="ctrl-empty-row">暂无数据</div>');
		    renderLineStatusList(snap.lineRows);
		    renderHourlyChart(snap);
		    controlCenterSystem.renderPanels(snap);
		    controlCenterSystem.normalizeScrollSurfaces();
		    normalizeControlCenterDisplay(snap);
    renderCount++;
  }
  function signature(snap){
	    return JSON.stringify([snap.hour,snap.speed,snap.online,snap.delivered,snap.totalFlow,snap.waiting,snap.fare,snap.farePolicy,snap.hourly,snap.length,snap.lineCount,snap.lineRows,snap.topStations,snap.depots]);
  }
  function refresh(force){
    const overlay=byId('ctrl-center-overlay');
    if(!visible(overlay)) return;
    if(W.CityRailInteractionV143&&W.CityRailInteractionV143.isBusy()&&!force){ skippedRenderCount++; return; }
    const run=()=>{
      pendingIdle=0;
      controlCenterSystem.installPublicApi();
      const snap=makeSnapshot(),next=signature(snap);
      if(!force&&next===lastSignature){ skippedRenderCount++; return; }
      lastSignature=next;
      if(refreshRaf) cancelAnimationFrame(refreshRaf);
      refreshRaf=requestAnimationFrame(()=>{refreshRaf=0;controlCenterSystem.applyChartTheme(D.documentElement);renderSnapshot(snap);});
    };
    if(force) return run();
    if(pendingIdle) return;
    if('requestIdleCallback' in W) pendingIdle=requestIdleCallback(run,{timeout:500});
    else pendingIdle=setTimeout(run,0);
  }
  function updateDiagnostics(){
    const root=D.documentElement,system=controlCenterSystem.reportState();
    root.dataset.cityrailControlOwner=VERSION;
    root.dataset.cityrailLegacyControlSuppressed=String(!!W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__);
    root.dataset.cityrailControlPanels=system.panels.join(',');
    root.dataset.cityrailSingleControlOwner=String(!!(W.renderCtrlCenter&&W.renderCtrlCenter.__cityrailControlCenterSystem));
  }
  function activeTab(){ return sid(byId('ctrl-center-overlay')&&byId('ctrl-center-overlay').getAttribute('data-active-tab')); }
  function registerDefaultPanels(){
    controlCenterSystem.registerPanel('depots',{order:20,ensure:ensureDepotCard,render:renderDepotPanel});
    controlCenterSystem.registerPanel('fare-policy',{order:30,ensure:ensureFareCard,render:renderFarePanel});
    controlCenterSystem.registerPanel('daily-report',{order:40,ensure:ensureDailyReportCard,render:renderDailyReportPanel});
    controlCenterSystem.registerPanel('od-visual',{order:70,render:()=>{if(activeTab()==='od-visual'&&W.CityRailODVisualizerV177&&typeof W.CityRailODVisualizerV177.render==='function') W.CityRailODVisualizerV177.render();}});
    controlCenterSystem.registerPanel('station-data',{order:80,render:()=>{if(activeTab()==='station-data'&&W.CityRailStationDataViewV207&&typeof W.CityRailStationDataViewV207.render==='function') W.CityRailStationDataViewV207.render();}});
    controlCenterSystem.registerPanel('train-graph',{order:90,render:()=>{if(activeTab()==='train-graph'&&W.CityRailTrainGraphV161&&typeof W.CityRailTrainGraphV161.render==='function') W.CityRailTrainGraphV161.render();}});
    controlCenterSystem.registerScrollSurface('control-main','#ctrl-main');
    controlCenterSystem.registerScrollSurface('line-stats-table','#cct-line-stats-scroll-wrap,.ctrl-line-stats-scroll-wrap');
    controlCenterSystem.registerScrollSurface('alerts','#ctrl-alerts');
    controlCenterSystem.registerScrollSurface('fare-line-selector','#cct-fare-line-buttons');
  }
  function report(){
    const system=controlCenterSystem.reportState();
    return {
      version:VERSION,snapshotOwner:true,renderCount,skippedRenderCount,
      snapshotBuildMs:+snapshotBuildMs.toFixed(2),lastSnapshotAt:lastSnapshot&&lastSnapshot.at,
      controlVisible:visible(byId('ctrl-center-overlay')),
      dragCore:!!W.CityRailStationDragCore,
      legacyControlSuppressed:!!W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__,
      singleControlOwner:!!(W.renderCtrlCenter&&W.renderCtrlCenter.__cityrailControlCenterSystem),
      system,
      stableLineStatsRows:sid(byId('cct-line-stats-body')&&byId('cct-line-stats-body').dataset.cityrailStableRows),
      stableLineStatusRows:sid(byId('cct-line-status-list')&&byId('cct-line-status-list').dataset.cityrailStableRows)
    };
  }
  function boot(){
    registerDefaultPanels();
    controlCenterSystem.start();
    controlCenterSystem.bindEvents();
    ensureControlCenterCleanStructure();
    W.cityrailV145Report=report;
    W.cityrailV146Report=report;
    W.cityrailSelfCheck=report;
    D.documentElement.classList.add('cityrail-v145-ready');
    requestAnimationFrame(()=>refresh(true));
  }
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

;/* CityRail v179 - passenger rhythm cards */
