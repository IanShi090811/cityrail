;/* CityRail v146: single control-center snapshot owner. */
(function(){
  'use strict';
  const W=window,D=document,VERSION='v146.7-cloudflare-pages-functions';
  const REFRESH_MS=1600;
  const byId=id=>D.getElementById(id);
  const sid=v=>String(v==null?'':v);
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const fmt=v=>Math.max(0,Math.round(num(v))).toLocaleString('zh-CN');
  const fmtWan=v=>(Math.max(0,num(v))/10000).toFixed(1)+'万';
  const esc=v=>sid(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const state=()=>W.state||{};
  const visible=el=>!!(el&&!el.classList.contains('hidden')&&getComputedStyle(el).display!=='none');
  let refreshTimer=0,refreshRaf=0,pendingIdle=0,lastBuildAt=0,lastSnapshot=null,lastSignature='';
  let renderCount=0,skippedRenderCount=0,snapshotBuildMs=0;

  function formatTime(hour){
    const h=Math.floor(num(hour)); const m=Math.floor((num(hour)-h)*60+1e-6);
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  }
  function activeTrain(t){ return t&&!['done','removed','archived','inactive'].includes(sid(t.state)); }
  function cachedStats(st){ return st.__v114StatsCache||st.__v113StatsCache||st.__v112StatsCache||{}; }
  function lineLength(st,line){
    const cache=st.lineLengthCache||{};
    return num(cache[line.id],num(line.lengthKm,num(line.length)));
  }
  function makeSnapshot(){
    const started=performance.now(),st=state();
    const lines=Array.isArray(st.lines)?st.lines:[];
    const stations=Array.isArray(st.stations)?st.stations:[];
    const trains=Array.isArray(st.trains)?st.trains:[];
    const cacheApi=W.CityRailStatsCacheV114;
    const cached=cacheApi&&typeof cacheApi.stats==='function'?cacheApi.stats():cachedStats(st);
    const cachedLines=cached.line||{},cachedStations=cached.station||{};
    const statsRows=Array.isArray(st.lineStatsData)?st.lineStatsData:[];
    const fallbackFlow=new Map(statsRows.map(row=>[sid(row.id||row.lineId||row.name),num(row.flow||row.passengers)]));
    const trainCounts=new Map();
    let online=0;
    for(const train of trains){
      if(!activeTrain(train)) continue;
      online++;
      const id=sid(train.lineId);
      trainCounts.set(id,(trainCounts.get(id)||0)+1);
    }
    const lineNamesByStation=new Map();
    for(const line of lines){
      for(const stationId of (line.stationIds||[])){
        const id=sid(stationId),names=lineNamesByStation.get(id)||[];
        names.push(sid(line.name||line.id)); lineNamesByStation.set(id,names);
      }
    }
    const stationRows=[];
    let waiting=0;
    for(const station of stations){
      const row=cachedStations[sid(station.id)]||{};
      const stationWait=num(row.waiting,num((st.stationWaitingPool||{})[station.id]?.waiting));
      waiting+=stationWait;
      stationRows.push({
        id:sid(station.id),name:sid(station.name||station.id),
        lines:(lineNamesByStation.get(sid(station.id))||[]).join(' / ')||'-',
        waiting:stationWait,delivered:num(station.totalDelivered||station.delivered||row.delivered)
      });
    }
    const lineRows=lines.map(line=>{
      const id=sid(line.id),flow=num(cachedLines[id],num(fallbackFlow.get(id),num(fallbackFlow.get(sid(line.name)))));
      const active=trainCounts.get(id)||0,capacity=Math.max(1,active*num(line.capacity,1860));
      return {
        id,name:sid(line.name||line.id),color:sid(line.color||'#4fc3f7'),
        express:!!((line.expressService&&line.expressService.enabled)||line.expressEnabled),
        trainType:sid(line.trainType||'A'),cars:num(line.cars||line.carCount,8),
        speed:num(line.speed||line.maxSpeed,80),length:lineLength(st,line),active,flow,
        crowd:Math.min(999,Math.round(flow/capacity*100))
      };
    }).sort((a,b)=>num(a.id,999)-num(b.id,999)||a.name.localeCompare(b.name,'zh-CN'));
    let maxSegment=0;
    for(const segment of (Array.isArray(st.segmentFlowsCache)?st.segmentFlowsCache:[])){
      maxSegment=Math.max(maxSegment,num(segment.demandFlow||segment.flow));
    }
    const delivered=num(st._totalDelivered||st.totalDelivered);
    const generated=num(st._totalGenerated||st.totalGenerated||st.totalPassengerFlow);
    const onboard=trains.reduce((a,t)=>a+(activeTrain(t)?num(t.passengers||t.load||t.onboard):0),0);
    const totalFlow=Math.max(generated,delivered+waiting+onboard);
    const hourly=updateHourlySeries(st,totalFlow,st.simulationHour);
    const length=lineRows.reduce((sum,row)=>sum+row.length,0);
    const topStations=stationRows.sort((a,b)=>(b.waiting+b.delivered)-(a.waiting+a.delivered)||a.name.localeCompare(b.name,'zh-CN')).slice(0,5);
    const snap=Object.freeze({
      at:Date.now(),hour:num(st.simulationHour),speed:num(st.simSpeed),online,delivered,totalFlow,waiting,hourly:Object.freeze(hourly.slice(0,24)),
      fare:num(st._fareIncome||st.fareIncome),maxSegment,length,
      lineCount:new Set(lineRows.map(row=>row.name.replace(/支线|主线/g,''))).size,
      lineRows:Object.freeze(lineRows),topStations:Object.freeze(topStations)
    });
    snapshotBuildMs=performance.now()-started;
    lastBuildAt=performance.now(); lastSnapshot=snap;
    return snap;
  }
  function setText(id,value){ const el=byId(id),next=sid(value); if(el&&el.textContent!==next) el.textContent=next; }
  function setHTML(id,html){ const el=byId(id); if(!el||el.innerHTML===html) return; const wrap=el.parentElement,top=wrap&&wrap.scrollTop,left=wrap&&wrap.scrollLeft; el.innerHTML=html; if(wrap){wrap.scrollTop=top;wrap.scrollLeft=left;} }

  function formatMoney(v){
    const n=Math.max(0,Math.round(num(v)));
    if(n>=100000000) return '¥'+(n/100000000).toFixed(2).replace(/\.00$/,'')+'亿';
    if(n>=10000) return '¥'+(n/10000).toFixed(1).replace(/\.0$/,'')+'万';
    return '¥'+n.toLocaleString('zh-CN');
  }
  function ensureControlCenterCleanStructure(){
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
        card.querySelectorAll('.v101-run-diagram,.v102-run-diagram,.run-diagram-rate,.old-hourly,.ctrl-old-exec,.ctrl-empty:not(.ctrl-empty-row)').forEach(el=>el.remove());
        const legend=D.getElementById('cct-hourly-flow-legend');
        if(legend){
          legend.className='ctrl-v1464-hourly-legend';
          if(!D.getElementById('cct-hourly-flow-current')) legend.innerHTML='<span>0点—24点全线网总客流</span><span id="cct-hourly-flow-current">当前小时：--</span>';
          else {
            const first=legend.querySelector('span:not(#cct-hourly-flow-current)');
            if(first) first.textContent='0点—24点全线网总客流';
          }
        }
      }
    }
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
    let grid='';
    for(let i=0;i<=4;i++){ const yy=Pt+i*((H-Pt-Pb)/4); grid+=`<line class="grid" x1="${Px}" y1="${yy.toFixed(1)}" x2="${Wd-Pr}" y2="${yy.toFixed(1)}"></line>`; }
    for(let i=0;i<=24;i+=3){ const xx=i===24?Wd-Pr:x(i); grid+=`<line class="grid" x1="${xx.toFixed(1)}" y1="${Pt}" x2="${xx.toFixed(1)}" y2="${H-Pb}"></line><text x="${xx.toFixed(1)}" y="${H-10}" text-anchor="middle">${i}</text>`; }
    const pts=data.map((v,i)=>[x(i),y(v),v]);
    const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    const area=d+` L ${(Wd-Pr).toFixed(1)} ${H-Pb} L ${Px} ${H-Pb} Z`;
    const h=((Math.floor(num(snap.hour))%24)+24)%24, cur=pts[h]||pts[0];
    const html=`${grid}<line class="axis" x1="${Px}" y1="${H-Pb}" x2="${Wd-Pr}" y2="${H-Pb}"></line><path class="area" d="${area}"></path><path class="line" d="${d}"></path><circle class="dot" cx="${cur[0].toFixed(1)}" cy="${cur[1].toFixed(1)}" r="5"></circle><text x="${Px}" y="16">峰值 ${fmt(max)}</text><text x="${Wd-Pr}" y="16" text-anchor="end">0—24h</text>`;
    if(svg.innerHTML!==html) svg.innerHTML=html;
    const curEl=byId('cct-hourly-flow-current'); if(curEl) curEl.textContent=`当前小时：${String(h).padStart(2,'0')}:00 · ${fmt(cur[2])}`;
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
    setText('cct-big-flow',fmtWan(snap.totalFlow)); setText('cct-big-waiting',fmt(snap.waiting)); setText('cct-big-fare',formatMoney(snap.fare)); const oldIn=byId('cct-big-inbound'); if(oldIn) oldIn.textContent=fmt(snap.waiting); const oldOut=byId('cct-big-outbound'); if(oldOut) oldOut.textContent=formatMoney(snap.fare); const oldMax=byId('cct-big-max-seg'); if(oldMax) oldMax.closest('div')?.remove();
    const lineHTML=snap.lineRows.length?snap.lineRows.map(row=>`<tr data-line-id="${esc(row.id)}"><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(row.color)}"></span></td><td>${esc(row.name)}</td><td class="cc-express-cell"><button class="cc-express-open ${row.express?'on':'off'}" data-line-id="${esc(row.id)}">${row.express?'已开启':'未开启'}</button></td><td>${esc(row.trainType)}</td><td>${fmt(row.cars)}节</td><td>${fmt(row.speed)}km/h</td><td>${row.length.toFixed(1)}km</td><td>${fmt(row.active)}</td><td>${fmt(row.flow)}</td><td>${fmt(row.crowd)}%</td></tr>`).join(''):'<tr><td colspan="10" class="ctrl-empty-row">暂无数据</td></tr>';
    setHTML('cct-line-stats-body',lineHTML);
    const topHTML=snap.topStations.length?snap.topStations.map((row,index)=>`<tr><td>${index+1}</td><td>${esc(row.name)}</td><td>${esc(row.lines)}</td><td>${fmt(row.waiting)}</td><td>${fmt(row.delivered)}</td></tr>`).join(''):'<tr><td colspan="5" class="ctrl-empty-row">暂无数据</td></tr>';
    setHTML('cct-top5-body',topHTML);
    const ranked=snap.lineRows.slice().sort((a,b)=>b.flow-a.flow||a.name.localeCompare(b.name,'zh-CN')).slice(0,8),max=Math.max(1,...ranked.map(row=>row.flow));
    setHTML('cct-intensity-bars',ranked.length?ranked.map((row,index)=>`<div class="ctrl-bar-row"><div class="ctrl-bar-label" title="${esc(row.name)}">${index+1}. ${esc(row.name)}</div><div class="ctrl-bar-track"><div class="ctrl-bar-fill" style="width:${Math.max(2,row.flow/max*100)}%;background:${esc(row.color)}"></div></div><div class="ctrl-bar-val">${fmt(row.flow)}</div></div>`).join(''):'<div class="ctrl-empty-row">暂无数据</div>');
    setHTML('cct-line-status-list',snap.lineRows.slice(0,9).map(row=>`<div class="v145-line-status"><span style="color:${esc(row.color)}">●</span> ${esc(row.name)} · ${fmt(row.active)}列在线</div>`).join('')||'<div class="ctrl-empty-row">暂无线路</div>');
    renderHourlyChart(snap);
    normalizeControlCenterDisplay(snap);
    renderCount++;
  }
  function signature(snap){
    return JSON.stringify([snap.hour,snap.speed,snap.online,snap.delivered,snap.totalFlow,snap.waiting,snap.fare,snap.hourly,snap.length,snap.lineCount,snap.lineRows,snap.topStations]);
  }
  function refresh(force){
    const overlay=byId('ctrl-center-overlay');
    if(!visible(overlay)) return;
    if(W.CityRailInteractionV143&&W.CityRailInteractionV143.isBusy()&&!force){ skippedRenderCount++; return; }
    const run=()=>{
      pendingIdle=0;
      claimGlobals();
      const snap=makeSnapshot(),next=signature(snap);
      if(!force&&next===lastSignature){ skippedRenderCount++; return; }
      lastSignature=next;
      if(refreshRaf) cancelAnimationFrame(refreshRaf);
      refreshRaf=requestAnimationFrame(()=>{refreshRaf=0;renderSnapshot(snap);});
    };
    if(force) return run();
    if(pendingIdle) return;
    if('requestIdleCallback' in W) pendingIdle=requestIdleCallback(run,{timeout:500});
    else pendingIdle=setTimeout(run,0);
  }
  function clearOldOwners(){
    [
      '__cityrailV99ControlTimer','__cityrailV100ControlTimer','__cityrailV101ControlTimer','__v101ControlTimer',
      '__cityrailV102ControlTimer','__cityrailV109ControlTimer','__cityrailV111ControlTimer','__cityrailV112ControlTimer',
      '__cityrailV144ControlTimer'
    ].forEach(key=>{if(W[key]){try{clearInterval(W[key]);clearTimeout(W[key]);}catch(e){} W[key]=null;}});
    ['__cityrailV135Observer','__cityrailV142Cleaner','__cityrailV142StableObserver','__cityrailV142Observer','__cityrailV143MutationProbe'].forEach(key=>{const item=W[key];if(item&&typeof item.disconnect==='function'){try{item.disconnect();}catch(e){}} W[key]=null;});
  }
  function claimGlobals(){
    if(W.renderCtrlCenter&&W.renderCtrlCenter.__v145StableOwner) return;
    const render=()=>refresh(true); render.__v142StrictRenderer=true; render.__v145StableOwner=true;
    W.CityRailControlCenterV142={version:VERSION,render};
    W.CityRailControlCenterRenderer={version:VERSION,render};
    ['updateControlCenter','renderCtrlCenter','renderControlLineOps','renderLineStats'].forEach(name=>{try{W[name]=globalThis[name]=render;}catch(e){W[name]=render;}});
  }
  function legacyControlTimers(){
    return ['__cityrailV99ControlTimer','__cityrailV100ControlTimer','__cityrailV101ControlTimer','__cityrailV102ControlTimer','__cityrailV111ControlTimer','__cityrailV112ControlTimer','__cityrailV144ControlTimer'].filter(key=>!!W[key]);
  }
  function updateDiagnostics(){
    const root=D.documentElement,timers=legacyControlTimers();
    root.dataset.cityrailControlOwner=VERSION;
    root.dataset.cityrailLegacyControlSuppressed=String(!!W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__);
    root.dataset.cityrailLegacyControlTimers=timers.join(',');
    root.dataset.cityrailSingleControlOwner=String(!!(W.renderCtrlCenter&&W.renderCtrlCenter.__v145StableOwner&&!timers.length));
  }
  function installOwner(){
    claimGlobals();
    if(refreshTimer) clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>refresh(false),REFRESH_MS);
    W.__cityrailV145ControlTimer=refreshTimer;
    updateDiagnostics();
  }
  function bindEvents(){
    if(D.__cityrailV145Bound) return; D.__cityrailV145Bound=true;
    D.addEventListener('click',event=>{const button=event.target&&event.target.closest&&event.target.closest('#btn-ctrl-center');if(button)setTimeout(()=>refresh(true),0);},true);
    D.addEventListener('visibilitychange',()=>{if(!D.hidden)refresh(true);});
  }
  function report(){
    const timers=legacyControlTimers();
    return {
      version:VERSION,snapshotOwner:true,renderCount,skippedRenderCount,
      snapshotBuildMs:+snapshotBuildMs.toFixed(2),lastSnapshotAt:lastSnapshot&&lastSnapshot.at,
      controlVisible:visible(byId('ctrl-center-overlay')),
      dragCore:!!W.CityRailStationDragCore,
      legacyControlSuppressed:!!W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__,
      singleControlOwner:!!(W.renderCtrlCenter&&W.renderCtrlCenter.__v145StableOwner&&!timers.length),
      legacyControlTimers:timers
    };
  }
  function boot(){W.__CITYRAIL_DISABLE_LEGACY_CONTROL_CENTER__=true;clearOldOwners();installOwner();bindEvents();W.cityrailV145Report=report;W.cityrailV146Report=report;W.cityrailSelfCheck=report;D.documentElement.classList.add('cityrail-v145-ready');}
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setTimeout(boot,2300);setTimeout(()=>refresh(true),2500);
})();
