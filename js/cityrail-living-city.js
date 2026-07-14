;/* CityRail City Pulse: city growth, passenger persona, and congestion governance. */
(function(){
  'use strict';

  const W = window;
  const D = document;
  const FEATURE = 'living-city';
  const VERSION = 'living-city-20260708-v7-toolbar-icon-clean';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const sid = v => String(v == null ? '' : v);
  const esc = v => sid(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt = v => Math.round(Math.max(0, num(v))).toLocaleString('zh-CN');
  const pct = v => Math.round(clamp(v, 0, 100)) + '%';
  const byId = id => D.getElementById(id);
  const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const state = () => {
    try { if (W.CityRail && CityRail.state && typeof CityRail.state.get === 'function') return CityRail.state.get(); } catch(e) {}
    return W.state || {};
  };
  const lines = () => Array.isArray(state().lines) ? state().lines : [];
  const stations = () => Array.isArray(state().stations) ? state().stations : [];
  const trains = () => Array.isArray(state().trains) ? state().trains : [];
  const batches = () => Array.isArray(state().batches) ? state().batches : [];
  const activeTrain = t => t && !['done','removed','archived','inactive','retired'].includes(sid(t.state));
  const trainLoad = t => Math.max(num(t && t.load), num(t && t.passengers), num(t && t.onboard), num(t && t.passengerCount));
  const lineName = line => line && (line.name || line.label || line.no || line.id) || '线路';
  const stationName = st => st && (st.name || st.label || st.id) || '车站';
  const rawCount = b => Math.max(0, num(b && (b.count || b.passengers || b.size), 0));

  let open = false;
  let activeTab = 'pulse';
  let selectedCampaign = '';
  let lastSig = '';
  let renderTimer = 0;
  let pulseTimer = 0;
	  let growthLayer = null;
	  let growthLegend = null;
	  let growthCanvas = null;
	  let growthCanvasFrame = 0;
	  let growthMapRows = [];
	  let mapGrowthVisible = false;
	  let lastGrowthMapSig = '';
	  let lastGrowthMapRenderAt = 0;
	  let lastDemandFactorSig = '';
	  let lastDemandInvalidatedAt = 0;
	  const betaNoticeKey = 'cityrail:living-city-beta-notice:v1';

  const personas = [
    { id:'commuter', name:'通勤刚需', color:'#0A84FF', time:0.92, transfers:0.56, crowd:0.62, fare:0.34 },
    { id:'student', name:'学生客流', color:'#30D158', time:0.54, transfers:0.58, crowd:0.42, fare:0.86 },
    { id:'tourist', name:'游客访客', color:'#BF5AF2', time:0.44, transfers:0.92, crowd:0.74, fare:0.38 },
    { id:'shopper', name:'商业休闲', color:'#FF9F0A', time:0.62, transfers:0.66, crowd:0.70, fare:0.48 },
    { id:'price', name:'价格敏感', color:'#64D2FF', time:0.46, transfers:0.52, crowd:0.50, fare:1.00 },
    { id:'local', name:'本地熟客', color:'#FFD60A', time:0.70, transfers:0.40, crowd:0.84, fare:0.50 }
  ];

  const zoneNames = {
    residential:'住宅', office:'办公', shopping:'商业', school:'学校',
    railway_station:'枢纽', airport:'机场', leisure:'文旅'
  };

  function living(){
    const st = state();
    if (!st.livingCity || typeof st.livingCity !== 'object') {
      st.livingCity = {
        version: VERSION,
        enabled: true,
        cells: Object.create(null),
        stationPolicies: Object.create(null),
        linePolicies: Object.create(null),
        personaMix: Object.create(null),
        demandFactors: Object.create(null),
        catchments: Object.create(null),
        campaigns: Object.create(null),
        campaignRewards: [],
        cityModifiers: Object.create(null),
        completedDays: [],
        events: [],
        tickCount: 0,
        lastTickHour: null
      };
    }
    if (!st.livingCity.cells) st.livingCity.cells = Object.create(null);
    if (!st.livingCity.stationPolicies) st.livingCity.stationPolicies = Object.create(null);
    if (!st.livingCity.linePolicies) st.livingCity.linePolicies = Object.create(null);
    if (!st.livingCity.personaMix) st.livingCity.personaMix = Object.create(null);
    if (!st.livingCity.demandFactors) st.livingCity.demandFactors = Object.create(null);
    if (!st.livingCity.catchments) st.livingCity.catchments = Object.create(null);
    if (!st.livingCity.campaigns) st.livingCity.campaigns = Object.create(null);
    if (!Array.isArray(st.livingCity.campaignRewards)) st.livingCity.campaignRewards = [];
    if (!st.livingCity.cityModifiers) st.livingCity.cityModifiers = Object.create(null);
    if (!Array.isArray(st.livingCity.completedDays)) st.livingCity.completedDays = [];
    if (!Array.isArray(st.livingCity.events)) st.livingCity.events = [];
    return st.livingCity;
  }

  function stableHash(text){
    let h = 2166136261;
    const s = sid(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function liveIds(){
    return {
      stationIds: new Set(stations().map(st => sid(st && st.id)).filter(Boolean)),
      lineIds: new Set(lines().map(line => sid(line && line.id)).filter(Boolean))
    };
  }

  function pruneLivingState(lc){
    const ids = liveIds();
    Object.keys(lc.cells || {}).forEach(id => { if (!ids.stationIds.has(sid(id))) delete lc.cells[id]; });
    Object.keys(lc.stationPolicies || {}).forEach(id => { if (!ids.stationIds.has(sid(id))) delete lc.stationPolicies[id]; });
    Object.keys(lc.demandFactors || {}).forEach(id => { if (!ids.stationIds.has(sid(id))) delete lc.demandFactors[id]; });
    Object.keys(lc.catchments || {}).forEach(id => { if (!ids.stationIds.has(sid(id))) delete lc.catchments[id]; });
    Object.keys(lc.linePolicies || {}).forEach(id => { if (!ids.lineIds.has(sid(id))) delete lc.linePolicies[id]; });
    lc.events = (lc.events || []).filter(e => !e.stationId || ids.stationIds.has(sid(e.stationId))).slice(0, 18);
  }

  function lineById(id){
    const key = sid(id);
    return lines().find(l => sid(l && l.id) === key) || null;
  }

  function stationById(id){
    const key = sid(id);
    return stations().find(st => sid(st && st.id) === key) || null;
  }

  function servedLinesForStation(stationId){
    const key = sid(stationId);
    return lines().filter(line => Array.isArray(line && line.stationIds) && line.stationIds.some(id => sid(id) === key));
  }

  function stationPool(stationId){
    const pools = state().stationWaitingPool || {};
    return pools[stationId] || pools[sid(stationId)] || {};
  }

  function serviceDay(){
    return Math.max(0, Math.floor(num(state().__cityrailServiceDay, 0)));
  }

  function operationalFlowOf(day){
    return Math.max(0, num(day && day.arrived) + num(day && day.delivered) + num(day && day.boarded) * 0.55);
  }

  function operationalPerformance(day){
    const arrived = Math.max(0, num(day && day.arrived));
    const delivered = Math.max(0, num(day && day.delivered));
    const boarded = Math.max(0, num(day && day.boarded));
    const waiting = Math.max(0, num(day && day.peakWaiting, day && day.waiting));
    const pressure = clamp(num(day && day.avgPressure, day && day.pressure), 0, 100);
    const flow = operationalFlowOf(day);
    if (flow <= 0 && waiting <= 0) return 62;
    const completion = arrived > 0 ? clamp((delivered + boarded * 0.35) / arrived, 0, 1.18) : (flow > 0 ? 0.62 : 0.48);
    const pressureScore = clamp(100 - pressure * 0.72 - waiting / 90, 0, 100);
    return clamp(completion * 58 + pressureScore * 0.42, 0, 100);
  }

  function ensureCellOperationalMemory(cell, seed){
    if (!cell || typeof cell !== 'object') return cell;
    const seedFlow = Math.max(0, num(seed && seed.arrived) + num(seed && seed.delivered) + num(seed && seed.boarded));
    if (!Number.isFinite(Number(cell.lifetimeArrived))) cell.lifetimeArrived = Math.max(0, num(cell.arrived), num(seed && seed.arrived));
    if (!Number.isFinite(Number(cell.lifetimeDelivered))) cell.lifetimeDelivered = Math.max(0, num(cell.delivered), num(seed && seed.delivered));
    if (!Number.isFinite(Number(cell.lifetimeBoarded))) cell.lifetimeBoarded = Math.max(0, num(seed && seed.boarded));
    if (!Number.isFinite(Number(cell.bestDailyFlow))) cell.bestDailyFlow = seedFlow;
    if (!Number.isFinite(Number(cell.flowEma))) cell.flowEma = seedFlow;
    if (!Number.isFinite(Number(cell.performanceEma))) cell.performanceEma = operationalPerformance({
      arrived:num(seed && seed.arrived),
      delivered:num(seed && seed.delivered),
      boarded:num(seed && seed.boarded),
      peakWaiting:num(seed && seed.waiting),
      avgPressure:num(cell.pressure, 0)
    });
    if (!Array.isArray(cell.dayHistory)) cell.dayHistory = [];
    if (!Number.isFinite(Number(cell.dayKey))) cell.dayKey = serviceDay();
    ['dayArrived','dayDelivered','dayBoarded','dayPeakWaiting','dayPressureSum','dayPressureSamples','dayAccessSum','dayAccessSamples'].forEach(key => {
      if (!Number.isFinite(Number(cell[key]))) cell[key] = 0;
    });
    return cell;
  }

  function mergeCellOperationalMemory(target, cells){
    ensureCellOperationalMemory(target);
    (cells || []).forEach(cell => {
      if (!cell || cell === target) return;
      ensureCellOperationalMemory(cell);
      target.lifetimeArrived = Math.max(num(target.lifetimeArrived), 0) + Math.max(0, num(cell.lifetimeArrived));
      target.lifetimeDelivered = Math.max(num(target.lifetimeDelivered), 0) + Math.max(0, num(cell.lifetimeDelivered));
      target.lifetimeBoarded = Math.max(num(target.lifetimeBoarded), 0) + Math.max(0, num(cell.lifetimeBoarded));
      target.dayArrived = Math.max(num(target.dayArrived), num(cell.dayArrived));
      target.dayDelivered = Math.max(num(target.dayDelivered), num(cell.dayDelivered));
      target.dayBoarded = Math.max(num(target.dayBoarded), num(cell.dayBoarded));
      target.dayPeakWaiting = Math.max(num(target.dayPeakWaiting), num(cell.dayPeakWaiting));
      target.bestDailyFlow = Math.max(num(target.bestDailyFlow), num(cell.bestDailyFlow));
      target.flowEma = Math.max(num(target.flowEma), num(cell.flowEma));
      target.performanceEma = avg([num(target.performanceEma), num(cell.performanceEma)].filter(Number.isFinite));
      target.dayHistory = (target.dayHistory || []).concat(cell.dayHistory || []).slice(0, 18);
    });
  }

  function finalizeCellDay(cell){
    if (!cell || !Number.isFinite(Number(cell.dayKey))) return null;
    const day = {
      day: Math.max(0, Math.floor(num(cell.dayKey))),
      arrived: Math.max(0, num(cell.dayArrived)),
      delivered: Math.max(0, num(cell.dayDelivered)),
      boarded: Math.max(0, num(cell.dayBoarded)),
      peakWaiting: Math.max(0, num(cell.dayPeakWaiting)),
      avgPressure: num(cell.dayPressureSamples) > 0 ? num(cell.dayPressureSum) / Math.max(1, num(cell.dayPressureSamples)) : num(cell.pressure),
      avgAccess: num(cell.dayAccessSamples) > 0 ? num(cell.dayAccessSum) / Math.max(1, num(cell.dayAccessSamples)) : num(cell.accessibility),
      closedAt: Date.now()
    };
    day.flow = operationalFlowOf(day);
    day.performance = operationalPerformance(day);
    cell.lastCompletedDay = day.day;
    cell.lastDayFlow = day.flow;
    cell.lastDayPerformance = day.performance;
    cell.bestDailyFlow = Math.max(num(cell.bestDailyFlow), day.flow);
    cell.flowEma = num(cell.flowEma) > 0 ? num(cell.flowEma) * 0.72 + day.flow * 0.28 : day.flow;
    cell.performanceEma = num(cell.performanceEma) * 0.74 + day.performance * 0.26;
    cell.dayHistory = [day].concat(cell.dayHistory || []).slice(0, 18);
    return day;
  }

  function startCellDay(cell, dayKey){
    cell.dayKey = Math.max(0, Math.floor(num(dayKey)));
    cell.dayArrived = 0;
    cell.dayDelivered = 0;
    cell.dayBoarded = 0;
    cell.dayPeakWaiting = 0;
    cell.dayPressureSum = 0;
    cell.dayPressureSamples = 0;
    cell.dayAccessSum = 0;
    cell.dayAccessSamples = 0;
  }

  function updateCellOperationalMemory(cell, live, pressure, access){
    ensureCellOperationalMemory(cell, live);
    const day = serviceDay();
    if (Math.floor(num(cell.dayKey)) !== day) {
      finalizeCellDay(cell);
      startCellDay(cell, day);
    }
    const prevArrived = Math.max(0, num(cell.dayArrived));
    const prevDelivered = Math.max(0, num(cell.dayDelivered));
    const prevBoarded = Math.max(0, num(cell.dayBoarded));
    const nextArrived = Math.max(prevArrived, Math.max(0, num(live && live.arrived)));
    const nextDelivered = Math.max(prevDelivered, Math.max(0, num(live && live.delivered)));
    const nextBoarded = Math.max(prevBoarded, Math.max(0, num(live && live.boarded)));
    cell.lifetimeArrived += Math.max(0, nextArrived - prevArrived);
    cell.lifetimeDelivered += Math.max(0, nextDelivered - prevDelivered);
    cell.lifetimeBoarded += Math.max(0, nextBoarded - prevBoarded);
    cell.dayArrived = nextArrived;
    cell.dayDelivered = nextDelivered;
    cell.dayBoarded = nextBoarded;
    cell.dayPeakWaiting = Math.max(num(cell.dayPeakWaiting), Math.max(0, num(live && live.waiting)));
    cell.dayPressureSum += clamp(pressure, 0, 100);
    cell.dayPressureSamples += 1;
    cell.dayAccessSum += clamp(access, 0, 100);
    cell.dayAccessSamples += 1;
    const today = {
      arrived: cell.dayArrived,
      delivered: cell.dayDelivered,
      boarded: cell.dayBoarded,
      peakWaiting: cell.dayPeakWaiting,
      avgPressure: cell.dayPressureSum / Math.max(1, cell.dayPressureSamples)
    };
    const dayFlow = operationalFlowOf(today);
    const lifetimeFlow = operationalFlowOf({
      arrived: cell.lifetimeArrived,
      delivered: cell.lifetimeDelivered,
      boarded: cell.lifetimeBoarded
    });
    const currentPerformance = operationalPerformance(today);
    const baselinePerformance = clamp(num(cell.performanceEma, currentPerformance), 0, 100);
    const observedEnough = dayFlow >= Math.max(90, num(cell.flowEma) * 0.22) || num(live && live.waiting) > 360;
    const regressionPenalty = observedEnough ? clamp((baselinePerformance - currentPerformance) * 0.13, 0, 9) : 0;
    cell.dayFlow = dayFlow;
    cell.lifetimeFlow = lifetimeFlow;
    cell.currentPerformance = currentPerformance;
    cell.regressionPenalty = regressionPenalty;
    return { dayFlow, lifetimeFlow, currentPerformance, baselinePerformance, regressionPenalty };
  }

  function rolloverLivingDay(reason){
    const lc = living();
    const day = serviceDay();
    const closed = [];
    Object.keys(lc.cells || {}).forEach(id => {
      const cell = lc.cells[id];
      if (!cell || !Number.isFinite(Number(cell.dayKey)) || Math.floor(num(cell.dayKey)) === day) return;
      const row = finalizeCellDay(cell);
      if (row) closed.push(row);
      startCellDay(cell, day);
    });
    if (closed.length) {
      const summary = {
        day: closed[0].day,
        reason: reason || 'day-rollover',
        stations: closed.length,
        flow: closed.reduce((a, row) => a + num(row.flow), 0),
        performance: avg(closed.map(row => num(row.performance)).filter(Number.isFinite)),
        at: Date.now()
      };
      lc.completedDays = [summary].concat(lc.completedDays || []).slice(0, 30);
    }
    return closed.length;
  }

  function distanceM(a, b){
    if (!a || !b) return Infinity;
    const lat1 = num(a.lat, NaN), lng1 = num(a.lng, NaN);
    const lat2 = num(b.lat, NaN), lng2 = num(b.lng, NaN);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
    const r = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function cleanTransferName(raw){
    if (typeof W.cityrailCleanTransferStationName === 'function') {
      try { return W.cityrailCleanTransferStationName(raw); } catch(e) {}
    }
    let text = sid(raw).trim().replace(/\s+/g, '');
    text = text.replace(/[（(]\s*\d+\s*[）)]$/u, '');
    text = text.replace(/(?:站)?[._-]?\d+$/u, '站');
    text = text.replace(/([^\d])\d+$/u, '$1');
    text = text.replace(/站站$/u, '站');
    return text || sid(raw).trim();
  }

  function transferBaseName(raw){
    return cleanTransferName(raw).replace(/站$/u, '');
  }

  function transferRelationKey(a, b, la, lb){
    const sa = sid(a), sb = sid(b);
    const stPair = [sa, sb].sort().join('~');
    const linePair = [sid(la), sid(lb)].sort().join('|');
    return stPair + '|' + linePair;
  }

  function stationLineIdsSet(stationId){
    return new Set(servedLinesForStation(stationId).map(line => sid(line && line.id)).filter(Boolean));
  }

  function transferAllowed(stationA, stationB, lineA, lineB){
    try {
      if (typeof W.cityrailIsTransferAllowed === 'function') return W.cityrailIsTransferAllowed(stationA, stationB, lineA, lineB) !== false;
    } catch(e) {}
    const st = state();
    const key = transferRelationKey(stationA, stationB, lineA, lineB);
    if (st.transferRelations && st.transferRelations[key] === false) return false;
    if (st.disabledTransferRelations && st.disabledTransferRelations[key]) return false;
    if (sid(stationA) === sid(stationB)) {
      const sameStationKey = [sid(stationA), sid(lineA), sid(lineB)].sort().join('|');
      if (st.disabledTransferRelations && st.disabledTransferRelations[sameStationKey]) return false;
      const station = stationById(stationA);
      if (station && station._disabledTransferPairs) {
        const pair = [sid(lineA), sid(lineB)].sort().join('|');
        if (station._disabledTransferPairs[pair]) return false;
      }
    }
    return true;
  }

  function explicitTransferPeers(stationId){
    const key = sid(stationId);
    const out = new Set();
    const transfers = Array.isArray(state().virtualTransfers) ? state().virtualTransfers : [];
    transfers.forEach(vt => {
      if (!vt || vt.enabled === false || vt.disabled === true) return;
      const a = sid(vt.stationA || vt.fromStationId || vt.from);
      const b = sid(vt.stationB || vt.toStationId || vt.to);
      if (!a || !b || (a !== key && b !== key)) return;
      const lineA = sid(vt.lineAId || vt.fromLineId || vt.lineA);
      const lineB = sid(vt.lineBId || vt.toLineId || vt.lineB);
      if (lineA && lineB && !transferAllowed(a, b, lineA, lineB)) return;
      out.add(a === key ? b : a);
    });
    return out;
  }

  function shouldUnifyTransferStations(a, b){
    if (!a || !b || sid(a.id) === sid(b.id)) return false;
    if (explicitTransferPeers(a.id).has(sid(b.id))) return true;
    const aLines = stationLineIdsSet(a.id);
    const bLines = stationLineIdsSet(b.id);
    if (new Set([...aLines, ...bLines]).size < 2) return false;
    const d = distanceM(a, b);
    if (!Number.isFinite(d) || d > 90) return false;
    const sameBase = transferBaseName(a.name || a.id) && transferBaseName(a.name || a.id) === transferBaseName(b.name || b.id);
    const transferNamed = !!(a.__transferSameName || b.__transferSameName || a.__transferUnifiedName || b.__transferUnifiedName);
    return sameBase && transferNamed;
  }

  function transferGroupForStation(stationId){
    const root = stationById(stationId);
    if (!root) return [];
    const seen = new Set([sid(root.id)]);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift();
      explicitTransferPeers(cur.id).forEach(id => {
        if (seen.has(id)) return;
        const peer = stationById(id);
        if (peer) {
          seen.add(id);
          queue.push(peer);
        }
      });
      stations().forEach(other => {
        const oid = sid(other && other.id);
        if (!other || seen.has(oid)) return;
        if (!shouldUnifyTransferStations(cur, other)) return;
        seen.add(oid);
        queue.push(other);
      });
    }
    return Array.from(seen).map(stationById).filter(Boolean);
  }

  function transferStationGroups(){
    const out = [];
    const seen = new Set();
    const indexOfStation = station => Math.max(0, stations().findIndex(item => sid(item && item.id) === sid(station && station.id)));
    stations().forEach(st => {
      if (!st || st.id == null || seen.has(sid(st.id))) return;
      const group = transferGroupForStation(st.id);
      const members = (group.length ? group : [st]).filter(item => item && item.id != null);
      members.forEach(item => seen.add(sid(item.id)));
      const ranked = members.slice().sort((a, b) => {
        const manualDelta = (b.__manualName === true ? 1 : 0) - (a.__manualName === true ? 1 : 0);
        if (manualDelta) return manualDelta;
        const lineDelta = stationLineIdsSet(b.id).size - stationLineIdsSet(a.id).size;
        if (lineDelta) return lineDelta;
        return indexOfStation(a) - indexOfStation(b);
      });
      const rep = ranked[0] || members[0] || st;
      out.push({ id:sid(rep.id), station:rep, stations:members, stationIds:members.map(item => sid(item.id)) });
    });
    return out;
  }

  function groupPolicy(lc, group){
    const ids = (group && group.stationIds) || [];
    const policy = lc.stationPolicies[group.id] || (lc.stationPolicies[group.id] = {});
    ids.forEach(id => {
      const item = lc.stationPolicies[id];
      if (!item || item === policy) return;
      if (item.metering) policy.metering = true;
      if (num(item.todBoost, 0) > num(policy.todBoost, 0)) policy.todBoost = num(item.todBoost, 0);
    });
    return policy;
  }

  function mutateGroupPolicy(lc, stationId, mutator){
    const group = transferGroupForStation(stationId);
    const ids = (group.length ? group : [stationById(stationId)]).filter(Boolean).map(st => sid(st.id));
    if (!ids.includes(sid(stationId))) ids.unshift(sid(stationId));
    ids.forEach(id => {
      const policy = lc.stationPolicies[id] || (lc.stationPolicies[id] = {});
      mutator(policy, id);
      policy.updatedAt = Date.now();
    });
    return ids;
  }

  function zonesOf(st){
    const arr = Array.isArray(st && st.zoneTypes) ? st.zoneTypes : (st && st.zoneType ? [st.zoneType] : []);
    return arr.length ? arr.slice(0, 4) : ['residential'];
  }

  function zoneFactor(zones){
    let f = 1;
    if (zones.includes('office')) f += 0.18;
    if (zones.includes('railway_station')) f += 0.26;
    if (zones.includes('airport')) f += 0.22;
    if (zones.includes('shopping')) f += 0.13;
    if (zones.includes('school')) f += 0.08;
    if (zones.includes('leisure')) f += 0.07;
    return f;
  }

  function stageLabel(value){
    if (value >= 82) return '都会核心';
    if (value >= 66) return '增长极';
    if (value >= 48) return '成熟站区';
    if (value >= 30) return '培育站区';
    return '待激活';
  }

	  function stageColor(value){
	    if (value >= 82) return '#FFD60A';
	    if (value >= 66) return '#BF5AF2';
	    if (value >= 48) return '#30D158';
	    if (value >= 30) return '#0A84FF';
	    return '#8E8E93';
	  }

	  function nextStageInfo(value){
	    const stages = [
	      { name:'培育站区', value:30 },
	      { name:'成熟站区', value:48 },
	      { name:'增长极', value:66 },
	      { name:'都会核心', value:82 }
	    ];
	    for (const stage of stages) {
	      if (num(value) < stage.value) return { name:stage.name, threshold:stage.value, gap:stage.value - num(value) };
	    }
	    return { name:'最高阶段', threshold:100, gap:0 };
	  }

  function cityModifier(name, fallback){
    const lc = living();
    return num(lc.cityModifiers && lc.cityModifiers[name], fallback || 0);
  }

  function catchmentForStation(lc, id, cell, lineCount, zones, policy){
    const tod = num(policy && policy.todBoost, 0);
    const development = num(cell && cell.development, 0);
    const hubBonus = zones.includes('railway_station') || zones.includes('airport') ? 110 : 0;
    const core = clamp(620 + lineCount * 60 + tod * 24 + development * 1.35, 420, 980);
    const outer = clamp(780 + development * 5.4 + lineCount * 92 + tod * 60 + hubBonus, 650, 1800);
    const inner = clamp(260 + Math.min(80, development), 260, 360);
    const score = clamp(outer / 24 + lineCount * 2.6 + tod * 1.8, 0, 100);
    const saved = lc.catchments[id] || (lc.catchments[id] = {});
    saved.innerM = Math.round(inner);
    saved.coreM = Math.round(core);
    saved.outerM = Math.round(outer);
    saved.score = Math.round(score);
    saved.updatedAt = Date.now();
    return saved;
  }

  function computeStationDemandFactor(row, policy, catchment){
    const development = num(row && row.development, 0);
    const pressure = num(row && row.pressure, 0);
    const tod = num(policy && policy.todBoost, 0);
    const stageBoost = clamp(0.80 + development / 185, 0.82, 1.32);
    const todBoost = 1 + tod * 0.032;
    const catchmentBoost = 1 + Math.max(0, num(catchment && catchment.outerM, 800) - 800) / 5600;
    const pressureCut = clamp(1 - Math.max(0, pressure - 58) * 0.006, 0.68, 1);
    const meteringCut = policy && policy.metering ? clamp(0.74 + cityModifier('meteringEfficiency', 0), 0.70, 0.88) : 1;
    const campaignDemand = 1 + cityModifier('demandConfidence', 0);
    return clamp(stageBoost * todBoost * catchmentBoost * pressureCut * meteringCut * campaignDemand, 0.45, 1.70);
  }

  function updateLivingInfluence(lc, rows){
    const factors = lc.demandFactors || (lc.demandFactors = Object.create(null));
    let changed = 0;
    rows.forEach(row => {
      const id = sid(row && row.id);
      if (!id) return;
      const ids = Array.isArray(row.stationIds) && row.stationIds.length ? row.stationIds.map(sid) : [id];
      const policy = lc.stationPolicies[id] || {};
      const next = computeStationDemandFactor(row, policy, row.catchment);
      const prev = num(factors[id] && factors[id].factor, 1);
      if (Math.abs(prev - next) > 0.025) changed++;
      const factorRow = {
        factor:+next.toFixed(4),
        development:Math.round(num(row.development)),
        pressure:Math.round(num(row.pressure)),
        metering:!!policy.metering,
        todLevel:num(policy.todBoost, 0),
        updatedAt:Date.now()
      };
      ids.forEach(stationId => {
        factors[stationId] = Object.assign({ groupId:id }, factorRow);
        const station = stationById(stationId);
        if (station) station.__livingCityDemandFactor = factorRow.factor;
      });
    });
    const sig = rows.map(row => sid(row.id) + ':' + Math.round(num(factors[sid(row.id)] && factors[sid(row.id)].factor, 1) * 100)).join('|');
    const now = Date.now();
    if (changed && sig !== lastDemandFactorSig && now - lastDemandInvalidatedAt > 12000) {
      lastDemandFactorSig = sig;
      lastDemandInvalidatedAt = now;
      try {
        if (W.CityRailPassengerDemandService && typeof W.CityRailPassengerDemandService.invalidate === 'function') {
          W.CityRailPassengerDemandService.invalidate('living-city-demand-factor');
        }
      } catch(e) {}
    }
    return changed;
  }

  function stationDemandFactor(stationOrId){
    const id = typeof stationOrId === 'object' && stationOrId ? stationOrId.id : stationOrId;
    const row = living().demandFactors && living().demandFactors[sid(id)];
    return row ? clamp(num(row.factor, 1), 0.45, 1.85) : 1;
  }

  function personaSeedForStation(st, zones, waiting, delivered){
    const total = Object.create(null);
    personas.forEach(p => { total[p.id] = 1; });
    total.commuter += zones.includes('residential') ? 14 : 2;
    total.commuter += zones.includes('office') ? 12 : 1;
    total.student += zones.includes('school') ? 18 : 2;
    total.tourist += zones.includes('airport') || zones.includes('railway_station') ? 12 : 1;
    total.shopper += zones.includes('shopping') || zones.includes('leisure') ? 14 : 2;
    total.price += zones.includes('residential') || zones.includes('school') ? 7 : 2;
    total.local += 8 + Math.min(10, delivered / 900);
    total.commuter += Math.min(16, delivered / 650);
    total.tourist += Math.min(9, waiting / 800);
    return total;
  }

  function choosePersona(seed, salt){
    const total = personas.reduce((a, p) => a + Math.max(0, num(seed[p.id], 0)), 0) || 1;
    let r = stableHash(salt || Date.now()) / 4294967295 * total;
    for (const p of personas) {
      r -= Math.max(0, num(seed[p.id], 0));
      if (r <= 0) return p.id;
    }
    return 'commuter';
  }

  function routePreferenceKey(pref){
    if (!pref || typeof pref !== 'object') return 'standard';
    return sid(pref.personaId || pref.id || pref.persona || 'mixed') + ':' + [
      Math.round(num(pref.timeWeight, .7) * 10),
      Math.round(num(pref.transferAversion, .6) * 10),
      Math.round(num(pref.crowdAversion, .5) * 10),
      Math.round(num(pref.fareSensitivity, .4) * 10)
    ].join('');
  }

  function assignPassengerPreference(batch, stationMap){
    if (!batch) return null;
    if (batch.routePreference && typeof batch.routePreference === 'object') {
      batch.routePreference._routePreferenceKey = batch.routePreference._routePreferenceKey || routePreferenceKey(batch.routePreference);
      return batch.routePreference;
    }
    const lc = living();
    const stMap = stationMap || new Map(stations().map(st => [sid(st.id), st]));
    const origin = stMap.get(sid(batch.originId)) || stMap.get(sid(batch.currentStationId));
    const zones = zonesOf(origin);
    const seed = personaSeedForStation(origin, zones, 0, 0);
    const personaId = batch._livingPersona || choosePersona(seed, [batch.originId, batch.destinationId, batch.id, batch.count].join('>'));
    const persona = personas.find(p => p.id === personaId) || personas[0];
    batch._livingPersona = persona.id;
    batch.routePreference = {
      personaId: persona.id,
      timeWeight: persona.time,
      transferAversion: persona.transfers,
      crowdAversion: persona.crowd,
      fareSensitivity: persona.fare
    };
    batch.routePreference._routePreferenceKey = routePreferenceKey(batch.routePreference);
    if (!batch._livingPersonaCounted) {
      lc.personaMix[persona.id] = num(lc.personaMix[persona.id]) + Math.max(1, num(batch.count || batch.passengers || batch.size, 1));
      batch._livingPersonaCounted = true;
    }
    return batch.routePreference;
  }

  function annotatePassengerPersonas(limit){
    const stMap = new Map(stations().map(st => [sid(st.id), st]));
    let done = 0;
    for (const b of batches()) {
      if (!b || (b.routePreference && b._livingPersonaCounted) || done >= limit) continue;
      assignPassengerPreference(b, stMap);
      done++;
    }
    return done;
  }

  function computeLineStats(){
    const lineRows = new Map();
    const byLineWaiting = new Map();
    const byLineBoarded = new Map();
    const byLineStale = new Map();
    for (const b of batches()) {
      if (!b) continue;
      const count = rawCount(b);
      if (count <= 0) continue;
      const leg = Array.isArray(b.legs) ? b.legs[num(b.currentLeg, 0)] : null;
      const lid = sid(leg && leg.lineId || b.lineId);
      if (!lid) {
        if (sid(b.state) === 'waiting' && b.trainId == null) byLineStale.set('__unrouted__', num(byLineStale.get('__unrouted__')) + count);
        continue;
      }
      if (sid(b.state) === 'waiting' && b.trainId == null) byLineWaiting.set(lid, num(byLineWaiting.get(lid)) + count);
      if (sid(b.state) === 'on_train') byLineBoarded.set(lid, num(byLineBoarded.get(lid)) + count);
    }
    for (const line of lines()) {
      if (!line || !Array.isArray(line.stationIds) || line.stationIds.length < 2) continue;
      const lid = sid(line.id);
      const lineTrains = trains().filter(t => {
        if (!activeTrain(t)) return false;
        const rp = t.routePlan || {};
        return sid(t.lineId) === lid || sid(rp.connectorLineId) === lid || sid(rp.parentLineId) === lid || sid(rp.targetLineId) === lid;
      });
      const onboard = lineTrains.reduce((a, t) => a + trainLoad(t), 0);
      const capacity = lineTrains.reduce((a, t) => a + Math.max(1, num(t.maxLoad || t.capacity, 1200)), 0);
      const waiting = num(byLineWaiting.get(lid));
      const missingFleet = waiting > 0 && lineTrains.length === 0;
      const crowd = capacity > 0 ? onboard / capacity * 100 : 0;
      const pressure = Math.min(100, crowd * 0.62 + waiting / Math.max(1, line.stationIds.length * 22) + (missingFleet ? 28 : 0));
      lineRows.set(lid, {
        id: lid,
        line,
        name: lineName(line),
        waiting,
        onboard,
        boarded: num(byLineBoarded.get(lid)),
        trains: lineTrains.length,
        capacity,
        crowd,
        pressure,
        missingFleet,
        stationCount: line.stationIds.length,
        headwayPeak: num(line.peakHeadwayMin, 2),
        headwayNormal: num(line.normalHeadwayMin, 4),
        headwayOffpeak: num(line.offPeakHeadwayMin, 6)
      });
    }
    if (num(byLineStale.get('__unrouted__')) > 0) {
      lineRows.set('__unrouted__', {
        id:'__unrouted__',
        line:null,
        name:'未分配路径',
        waiting:num(byLineStale.get('__unrouted__')),
        onboard:0,
        boarded:0,
        trains:0,
        capacity:0,
        crowd:0,
        pressure:100,
        missingFleet:true,
        stationCount:0,
        headwayPeak:0,
        headwayNormal:0,
        headwayOffpeak:0
      });
    }
    return lineRows;
  }

  function computeStationRows(lineRows){
    const lc = living();
    const rows = [];
    for (const group of transferStationGroups()) {
      const st = group.station;
      if (!st || st.id == null) continue;
      const id = sid(group.id || st.id);
      const groupStations = group.stations && group.stations.length ? group.stations : [st];
      const stationIds = group.stationIds && group.stationIds.length ? group.stationIds : groupStations.map(item => sid(item.id));
      const stationLineMap = new Map();
      groupStations.forEach(item => servedLinesForStation(item.id).forEach(line => stationLineMap.set(sid(line.id), line)));
      const stationLines = Array.from(stationLineMap.values());
      const zoneSet = new Set();
      groupStations.forEach(item => zonesOf(item).forEach(zone => zoneSet.add(zone)));
      const zones = Array.from(zoneSet);
      if (!zones.length) zones.push('residential');
      const totals = groupStations.reduce((acc, item) => {
        const pool = stationPool(item.id);
        acc.waiting += Math.max(0, num(pool.waiting));
        acc.delivered += Math.max(0, num(pool.totalDelivered || item.totalDelivered || item.delivered));
        acc.arrived += Math.max(0, num(pool.totalArrived || item.totalArrived || item.totalGenerated));
        acc.boarded += Math.max(0, num(pool.totalBoarded || item.totalBoarded));
        acc.flowBias = Math.max(acc.flowBias, num(item.flowBias, 1));
        if (Number.isFinite(num(item.lat, NaN)) && Number.isFinite(num(item.lng, NaN))) {
          acc.lat += num(item.lat);
          acc.lng += num(item.lng);
          acc.geoCount++;
        }
        return acc;
      }, { waiting:0, delivered:0, arrived:0, boarded:0, flowBias:1, lat:0, lng:0, geoCount:0 });
      const waiting = totals.waiting;
      const delivered = totals.delivered;
      const arrived = totals.arrived;
      const boarded = totals.boarded;
      const groupLat = totals.geoCount ? totals.lat / totals.geoCount : num(st.lat);
      const groupLng = totals.geoCount ? totals.lng / totals.geoCount : num(st.lng);
      const policy = groupPolicy(lc, group);
      let cell = lc.cells[id];
      const legacyCells = stationIds.map(stationId => lc.cells[stationId]).filter(Boolean);
      if (!cell) {
        const seedTarget = 14 + stationLines.length * 7 + Math.log1p(arrived + delivered + boarded) * 1.8 + zoneFactor(zones) * 3.5;
        const seedDevelopment = legacyCells.length ? avg(legacyCells.map(item => num(item.development, seedTarget * 0.62))) : seedTarget * 0.62;
        cell = lc.cells[id] = {
          id,
          development: clamp(seedDevelopment, 8, 88),
          lastDevelopment: clamp(seedDevelopment, 8, 88),
          createdAt: Date.now()
        };
      }
      ensureCellOperationalMemory(cell, totals);
      if (legacyCells.some(item => item && item !== cell)) {
        mergeCellOperationalMemory(cell, legacyCells);
        stationIds.forEach(stationId => { if (sid(stationId) !== id) delete lc.cells[stationId]; });
      }
	      const linePressure = stationLines.reduce((a, line) => a + num(lineRows.get(sid(line.id)) && lineRows.get(sid(line.id)).pressure), 0) / Math.max(1, stationLines.length);
	      const lineAccess = stationLines.length * 15;
	      const durableFlow = operationalFlowOf({ arrived:cell.lifetimeArrived, delivered:cell.lifetimeDelivered, boarded:cell.lifetimeBoarded });
	      const todayFlowRaw = operationalFlowOf({ arrived, delivered, boarded });
	      const flowAccess = Math.log1p(todayFlowRaw + durableFlow * 0.11) * 3.5;
	      const zoneAccess = zoneFactor(zones) * 6.2;
	      const access = clamp(lineAccess + flowAccess + zoneAccess, 0, 100);
	      const meteringRelief = policy.metering ? clamp(0.18 + cityModifier('meteringEfficiency', 0), 0.18, 0.34) : 0;
	      const platformPressure = waiting / Math.max(1, 160 + stationLines.length * 260) * 100 * (1 - meteringRelief);
	      const linePressurePart = linePressure * 0.42;
	      const pressure = clamp(platformPressure + linePressurePart, 0, 100);
	      const operation = updateCellOperationalMemory(cell, { arrived, delivered, boarded, waiting }, pressure, access);
	      const baseScore = 14;
	      const accessBoost = access * 0.44;
	      const memoryDemandBoost = clamp(Math.log1p(operation.lifetimeFlow) * 0.74, 0, 18);
	      const todayDemandBoost = clamp(Math.log1p(operation.dayFlow) * 0.95, 0, 8);
	      const demandBoost = clamp(memoryDemandBoost + todayDemandBoost, 0, 26);
	      const biasBoost = (totals.flowBias - 1) * 12;
	      const todBoost = num(policy.todBoost, 0) * 7;
	      const pressurePenalty = pressure * 0.22;
	      const regressionPenalty = operation.regressionPenalty;
	      const target = clamp(baseScore + accessBoost + demandBoost + biasBoost + todBoost - pressurePenalty - regressionPenalty + cityModifier('equityDevelopment', 0) * 5, 8, 96);
      cell.lastDevelopment = num(cell.development, target);
      const changeRate = state().isSimulating ? 0.026 : 0.012;
      const rate = target >= cell.development ? changeRate : changeRate * 0.48;
      cell.development = clamp(cell.development + (target - cell.development) * rate, 4, 100);
      cell.accessibility = access;
	      cell.pressure = pressure;
	      cell.waiting = waiting;
	      cell.arrived = arrived;
	      cell.delivered = delivered;
	      cell.boarded = boarded;
	      cell.zones = zones;
	      cell.stage = stageLabel(cell.development);
	      cell.satisfaction = clamp(96 - pressure * 0.56 + access * 0.18 - Math.max(0, waiting - 1600) / 90 - (policy.metering ? 3 : 0), 0, 100);
	      const catchment = catchmentForStation(lc, id, cell, stationLines.length, zones, policy);
	      const next = nextStageInfo(cell.development);
	      rows.push(Object.assign({}, cell, {
	        station: st,
	        stations: groupStations,
	        stationIds,
	        id,
	        name: stationName(st),
	        lat: groupLat,
	        lng: groupLng,
	        isTransferGroup: stationIds.length > 1,
	        memberCount: stationIds.length,
	        lineCount: stationLines.length,
	        lineNames: stationLines.map(lineName).join(' / ') || '-',
	        zoneText: zones.map(z => zoneNames[z] || z).join(' / '),
	        catchment,
	        delta: cell.development - cell.lastDevelopment,
	        targetDevelopment: target,
	        lifetimeFlow: operation.lifetimeFlow,
	        dayFlow: operation.dayFlow,
	        currentPerformance: operation.currentPerformance,
	        baselinePerformance: operation.baselinePerformance,
	        regressionPenalty,
	        nextStage: next.name,
	        nextGap: next.gap,
	        todLevel: num(policy.todBoost, 0),
	        metering: !!policy.metering,
	        growthParts: {
	          base: baseScore,
	          lineAccess,
	          flowAccess,
	          zoneAccess,
	          accessBoost,
	          demandBoost,
	          memoryDemandBoost,
	          todayDemandBoost,
	          biasBoost,
	          todBoost,
	          regressionPenalty,
	          pressurePenalty,
	          platformPressure,
	          linePressurePart,
	          meteringRelief: meteringRelief * 100
	        },
	        personaSeed: personaSeedForStation(st, zones, waiting, delivered)
	      }));
    }
    rows.sort((a, b) => (b.development + b.pressure * 0.3) - (a.development + a.pressure * 0.3));
    return rows;
  }

  function cityPulse(stationRows, lineRows){
    const count = Math.max(1, stationRows.length);
    const vitality = stationRows.reduce((a, r) => a + r.development, 0) / count;
    const pressure = stationRows.reduce((a, r) => a + r.pressure, 0) / count;
    const satisfaction = stationRows.reduce((a, r) => a + r.satisfaction, 0) / count;
    const waiting = stationRows.reduce((a, r) => a + r.waiting, 0);
    const activeLines = Array.from(lineRows.values()).filter(r => r.trains > 0 || r.waiting > 0);
    const lineStress = activeLines.reduce((a, r) => a + r.pressure, 0) / Math.max(1, activeLines.length);
    const equity = clamp(100 - standardDeviation(stationRows.map(r => r.accessibility)) * 1.35, 0, 100);
    const growth = stationRows.filter(r => r.delta > 0.08).length;
    const fleetGap = Array.from(lineRows.values()).filter(r => r.missingFleet).length;
    const catchmentCoverage = stationRows.reduce((a, r) => a + num(r.catchment && r.catchment.score), 0) / count;
    return {
      vitality,
      pressure: Math.max(pressure, lineStress * 0.82),
      satisfaction,
      equity,
      catchmentCoverage,
      waiting,
      growth,
      lineStress,
      activeLines: activeLines.length,
      fleetGap
    };
  }

  function networkHealth(stationRows, lineRows){
    const rows = Array.from(lineRows.values()).filter(r => r.id !== '__unrouted__');
    const stationCount = stationRows.length;
    const lineCount = rows.length;
    const trainCount = trains().filter(activeTrain).length;
    const waiting = stationRows.reduce((a, r) => a + r.waiting, 0);
    const unresolved = num(lineRows.get('__unrouted__') && lineRows.get('__unrouted__').waiting);
    const noLineStations = stationRows.filter(r => r.lineCount === 0).length;
    const missingFleet = rows.filter(r => r.missingFleet).length;
    const stressed = rows.filter(r => r.pressure >= 70).length;
    const health = clamp(
      100
      - noLineStations * 6
      - missingFleet * 11
      - stressed * 5
      - unresolved / 220
      - waiting / Math.max(1200, stationCount * 90),
      0,
      100
    );
    let status = 'ready';
    if (!stationCount) status = 'empty';
    else if (!lineCount) status = 'no-lines';
    else if (unresolved > 0) status = 'unrouted';
    else if (!trainCount && waiting > 0) status = 'no-service';
    else if (missingFleet > 0) status = 'fleet-gap';
    else if (stressed > 0) status = 'stressed';
    return { stationCount, lineCount, trainCount, waiting, unresolved, noLineStations, missingFleet, stressed, health, status };
  }

  function standardDeviation(values){
    if (!values.length) return 0;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length);
  }

  function buildRecommendations(stationRows, lineRows){
    const out = [];
    const health = networkHealth(stationRows, lineRows);
    if (health.status === 'empty') {
      return [{
        type:'build',
        severity:'info',
        title:'城市尚未接入轨道',
        body:'先建设至少两个车站和一条线路，城市脉动才会开始记录站区成长、乘客偏好和运营压力。',
        action:'开始建设'
      }];
    }
    if (health.status === 'no-lines') {
      return [{
        type:'build',
        severity:'warn',
        title:'车站尚未形成线路',
        body:'已有车站但没有可运营线路。站区不会获得可达性，也不会形成稳定客流。',
        action:'新建线路'
      }];
    }
    if (health.unresolved > 0) {
      out.push({
        type:'repair',
        severity:'critical',
        title:'存在未分配路径客流',
        body:'有 ' + fmt(health.unresolved) + ' 名候车乘客暂时无法映射到有效线路。建议检查断开的换乘、被删车站或未重算的线路。',
        action:'重算诊断'
      });
    }
    if (health.status === 'no-service' || health.missingFleet > 0) {
      Array.from(lineRows.values())
        .filter(line => line.id !== '__unrouted__' && line.missingFleet)
        .slice(0, 3)
        .forEach(line => out.push({
          type:'dispatch',
          severity:'critical',
          title: line.name + ' 有客流但无线车',
          body:'候车 ' + fmt(line.waiting) + '，当前没有在线列车。先补车或检查车辆段接轨，否则站区压力会继续累积。',
          action:'打开线路',
          lineId: line.id
        }));
    }
    const hotStations = stationRows.slice().sort((a, b) => b.pressure - a.pressure).slice(0, 5);
    const hotLines = Array.from(lineRows.values()).sort((a, b) => b.pressure - a.pressure).slice(0, 4);
    for (const line of hotLines) {
      if (line.id === '__unrouted__') continue;
      if (line.missingFleet) continue;
      if (line.pressure < 42 && line.waiting < 900) continue;
      if (line.headwayPeak > 1.2) {
        out.push({
          type:'headway',
          severity: line.pressure > 78 ? 'critical' : 'warn',
          title: line.name + ' 高峰能力不足',
          body: '候车 ' + fmt(line.waiting) + '，拥挤度 ' + pct(line.crowd) + '。建议缩短高峰间隔并重新平衡车辆段出车。',
          action:'压缩高峰间隔',
          lineId: line.id
        });
      } else if (line.crowd > 92) {
        out.push({
          type:'express',
          severity:'warn',
          title: line.name + ' 满载区间过长',
          body:'间隔已很短，继续加密收益有限。建议配置快慢车或越行站，把长距离客流从小站慢车中分离。',
          action:'打开快慢车',
          lineId: line.id
        });
      }
    }
    for (const st of hotStations) {
      if (st.pressure < 45 && st.waiting < 1200) continue;
      out.push({
        type:'station',
        severity: st.pressure > 82 ? 'critical' : 'warn',
        title: st.name + ' 站区承压',
        body:'候车 ' + fmt(st.waiting) + '，站区阶段为“' + st.stage + '”。建议启用站区限流，并把周边开发转向分散型 TOD。',
        action:'启用限流',
        stationId: sid(st.id)
      });
    }
    const underused = stationRows.filter(r => r.accessibility > 52 && r.development < 44 && r.pressure < 35).slice(0, 3);
    for (const st of underused) {
      out.push({
        type:'tod',
        severity:'info',
        title: st.name + ' 可作为增长引擎',
        body:'可达性 ' + pct(st.accessibility) + '，拥堵压力较低。适合导入办公、商业或居住复合开发。',
        action:'启动 TOD',
        stationId: sid(st.id)
      });
    }
    if (!out.length) {
      out.push({
        type:'stable',
        severity:'ok',
        title:'线网处于可控状态',
        body:'当前没有严重瓶颈。可以扩大站区开发，观察城市增长如何反向改变客流。',
        action:'刷新诊断'
      });
    }
    return out.slice(0, 8);
  }

  function tick(reason){
    const st = state();
    const lc = living();
    pruneLivingState(lc);
    rolloverLivingDay(reason || 'tick');
    const lineRows = computeLineStats();
    const stationRows = computeStationRows(lineRows);
    updateLivingInfluence(lc, stationRows);
    const pulse = cityPulse(stationRows, lineRows);
    const health = networkHealth(stationRows, lineRows);
    const recs = buildRecommendations(stationRows, lineRows);
    annotatePassengerPersonas(st.isSimulating ? 480 : 120);
    lc.version = VERSION;
    lc.tickCount = num(lc.tickCount) + 1;
    lc.lastReason = reason || 'tick';
    lc.lastTickAt = Date.now();
    lc.lastTickHour = num(st.simulationHour);
    lc.snapshot = {
      at: lc.lastTickAt,
      hour: num(st.simulationHour),
      pulse,
      health,
	      stationRows: stationRows.slice(0, 80).map(row => ({
	        id: sid(row.id),
	        name: row.name,
	        stage: row.stage,
	        development: row.development,
        accessibility: row.accessibility,
        pressure: row.pressure,
        satisfaction: row.satisfaction,
        waiting: row.waiting,
        delivered: row.delivered,
        arrived: row.arrived,
        boarded: row.boarded,
        lifetimeFlow: row.lifetimeFlow,
        dayFlow: row.dayFlow,
        currentPerformance: row.currentPerformance,
        baselinePerformance: row.baselinePerformance,
        regressionPenalty: row.regressionPenalty,
		        lineCount: row.lineCount,
		        memberCount: row.memberCount,
		        stationIds: row.stationIds,
		        lineNames: row.lineNames,
		        zoneText: row.zoneText,
	        catchment: row.catchment,
		        delta: row.delta,
		        targetDevelopment: row.targetDevelopment,
		        nextStage: row.nextStage,
		        nextGap: row.nextGap,
		        todLevel: row.todLevel,
	        metering: row.metering,
		        growthParts: row.growthParts
		      })),
	      mapRows: stationRows.map(row => ({
	        id: sid(row.id),
	        name: row.name,
	        lat: num(row.lat),
	        lng: num(row.lng),
	        stage: row.stage,
	        development: row.development,
	        accessibility: row.accessibility,
	        pressure: row.pressure,
	        satisfaction: row.satisfaction,
	        waiting: row.waiting,
	        delivered: row.delivered,
	        lifetimeFlow: row.lifetimeFlow,
	        dayFlow: row.dayFlow,
	        regressionPenalty: row.regressionPenalty,
	        lineCount: row.lineCount,
	        memberCount: row.memberCount,
	        zoneText: row.zoneText,
	        catchment: row.catchment,
	        delta: row.delta
	      })),
	      lineRows: Array.from(lineRows.values()).map(row => ({
	        id: row.id,
	        name: row.name,
	        waiting: row.waiting,
        onboard: row.onboard,
        trains: row.trains,
        crowd: row.crowd,
        pressure: row.pressure,
        headwayPeak: row.headwayPeak
      })).sort((a, b) => b.pressure - a.pressure),
      recommendations: recs,
      persona: personaSnapshot(lc),
      charts: buildCharts(stationRows, lineRows, health)
    };
	    campaignProgress(lc.snapshot);
	    maybeRecordEvent(lc, stationRows, pulse);
	    if (mapGrowthVisible) showGrowthMap(lc.snapshot);
	    scheduleRender();
	    return lc.snapshot;
	  }

  function personaSnapshot(lc){
    const mix = Object.create(null);
    personas.forEach(p => { mix[p.id] = num(lc.personaMix[p.id], 0); });
    const total = personas.reduce((a, p) => a + mix[p.id], 0) || 1;
    return personas.map(p => Object.assign({}, p, {
      count: mix[p.id],
      share: mix[p.id] / total * 100
    }));
  }

  function buildCharts(stationRows, lineRows, health){
    const lineRowsSorted = Array.from(lineRows.values()).sort((a, b) => b.pressure - a.pressure).slice(0, 12);
    const stages = ['待激活','培育站区','成熟站区','增长极','都会核心'];
    const stageCounts = stages.map(stage => stationRows.filter(r => r.stage === stage).length);
    const pressureBands = [0, 0, 0, 0];
    stationRows.forEach(r => {
      if (r.pressure >= 75) pressureBands[3]++;
      else if (r.pressure >= 50) pressureBands[2]++;
      else if (r.pressure >= 25) pressureBands[1]++;
      else pressureBands[0]++;
    });
    return {
      lines: lineRowsSorted.map(r => ({ id:r.id, name:r.name, pressure:r.pressure, waiting:r.waiting, trains:r.trains, crowd:r.crowd, missingFleet:!!r.missingFleet })),
      stages: stages.map((name, i) => ({ name, count: stageCounts[i] })),
      pressureBands: [
        { name:'舒展', count:pressureBands[0], color:'#30D158' },
        { name:'关注', count:pressureBands[1], color:'#64D2FF' },
        { name:'承压', count:pressureBands[2], color:'#FF9F0A' },
        { name:'拥堵', count:pressureBands[3], color:'#FF453A' }
      ],
      status: health.status
    };
  }

  function dailyReport(){
    const lc = living();
    const snap = currentSnapshot();
    const stations = Array.isArray(snap.stationRows) ? snap.stationRows : [];
    const lines = Array.isArray(snap.lineRows) ? snap.lineRows : [];
    const completed = Array.isArray(lc.completedDays) ? lc.completedDays : [];
    const lastDay = completed[0] || null;
    const prevDay = completed[1] || null;
    const totalDayFlow = stations.reduce((sum, row) => sum + Math.max(0, num(row.dayFlow)), 0);
    const lifetimeFlow = stations.reduce((sum, row) => sum + Math.max(0, num(row.lifetimeFlow)), 0);
    const pressure = snap.pulse ? num(snap.pulse.pressure) : avg(stations.map(row => num(row.pressure)));
    const vitality = snap.pulse ? num(snap.pulse.vitality) : avg(stations.map(row => num(row.development)));
    const satisfaction = snap.pulse ? num(snap.pulse.satisfaction) : avg(stations.map(row => num(row.satisfaction)));
    const growthStations = stations.filter(row => num(row.delta) > 0.08).length;
    const stressedStations = stations.filter(row => num(row.pressure) >= 65 || num(row.waiting) >= 900).length;
    const topGrowth = stations.slice().sort((a, b) => num(b.delta) - num(a.delta)).slice(0, 5).map(row => ({
      id:sid(row.id),
      name:row.name,
      value:num(row.delta),
      stage:row.stage,
      dayFlow:num(row.dayFlow)
    }));
    const topPressure = stations.slice().sort((a, b) => num(b.pressure) - num(a.pressure)).slice(0, 5).map(row => ({
      id:sid(row.id),
      name:row.name,
      value:num(row.pressure),
      waiting:num(row.waiting),
      stage:row.stage
    }));
    const topLines = lines.slice().sort((a, b) => num(b.pressure) - num(a.pressure)).slice(0, 5).map(row => ({
      id:sid(row.id),
      name:row.name,
      pressure:num(row.pressure),
      waiting:num(row.waiting),
      trains:num(row.trains),
      crowd:num(row.crowd)
    }));
    return {
      version: VERSION,
      serviceDay: serviceDay(),
      hour: num(snap.hour),
      generatedAt: Date.now(),
      current: {
        vitality,
        pressure,
        satisfaction,
        totalDayFlow,
        lifetimeFlow,
        growthStations,
        stressedStations,
        stationCount: stations.length,
        lineCount: snap.health ? num(snap.health.lineCount) : lines.length,
        trainCount: snap.health ? num(snap.health.trainCount) : 0
      },
      lastDay,
      prevDay,
      delta: {
        flow: lastDay && prevDay ? num(lastDay.flow) - num(prevDay.flow) : 0,
        performance: lastDay && prevDay ? num(lastDay.performance) - num(prevDay.performance) : 0
      },
      topGrowth,
      topPressure,
      topLines,
      recommendations: (snap.recommendations || []).slice(0, 4).map(row => ({
        severity:row.severity,
        title:row.title,
        body:row.body,
        action:row.action,
        lineId:row.lineId,
        stationId:row.stationId
      }))
    };
  }

  function maybeRecordEvent(lc, stationRows, pulse){
    if (lc.tickCount % 4 !== 0) return;
    const lead = stationRows[0];
    if (!lead) return;
    const text = lead.pressure > 78
      ? lead.name + ' 的站台压力正在改变全网出行选择'
      : (lead.delta > 0.18 ? lead.name + ' 站区因可达性提升进入增长通道' : '城市对线网的响应保持稳定');
    const last = lc.events[0] && lc.events[0].text;
    if (last === text) return;
    lc.events.unshift({ at: Date.now(), hour: num(state().simulationHour), text, pulse: Math.round(pulse.vitality) });
    lc.events = lc.events.slice(0, 18);
  }

  function campaignProgress(snap){
    const lc = living();
    const campaign = lc.activeCampaign;
    if (!campaign) return;
    const row = lc.campaigns[campaign] || (lc.campaigns[campaign] = { id:campaign, startedAt:Date.now(), startedTick:num(lc.tickCount), startedHour:num(state().simulationHour) });
    const progress = campaign === 'rush'
      ? clamp(100 - snap.pulse.pressure, 0, 100)
      : campaign === 'expo'
        ? clamp(snap.pulse.satisfaction * 0.72 + Math.min(28, snap.pulse.activeLines * 3), 0, 100)
        : clamp(snap.pulse.vitality * 0.7 + snap.pulse.equity * 0.3, 0, 100);
    const ticks = Math.max(0, num(lc.tickCount) - num(row.startedTick));
    const completed = progress >= 88;
    const failed = !completed && ticks >= 48 && progress < 52;
    lc.campaigns[campaign] = Object.assign(row, {
      id: campaign,
      progress,
      bestProgress: Math.max(num(row.bestProgress), progress),
      ticks,
      updatedAt: Date.now(),
      complete: !!(row.complete || completed),
      failed: !!(row.failed || failed)
    });
    if (completed && !row.rewardedAt) {
      grantCampaignReward(campaign);
      lc.campaigns[campaign].rewardedAt = Date.now();
      lc.activeCampaign = '';
    } else if (failed && !row.failedAt) {
      lc.campaigns[campaign].failedAt = Date.now();
      lc.activeCampaign = '';
      lc.events.unshift({ at: Date.now(), hour: num(state().simulationHour), text: campaignName(campaign) + ' 未达成，城市信心小幅下降', pulse: Math.round(snap.pulse.vitality) });
      lc.cityModifiers.demandConfidence = clamp(num(lc.cityModifiers.demandConfidence) - 0.025, -0.08, 0.12);
    }
  }

  function campaignName(id){
    return { rush:'晨峰失衡', expo:'会展散场', newtown:'新城崛起' }[id] || id || '战役';
  }

  function grantCampaignReward(id){
    const lc = living();
    const rewards = lc.campaignRewards || (lc.campaignRewards = []);
    if (rewards.some(r => r && r.id === id)) return;
    const reward = { id, name:campaignName(id), at:Date.now(), hour:num(state().simulationHour) };
    if (id === 'rush') {
      reward.effect = '限流效率 +8%';
      lc.cityModifiers.meteringEfficiency = clamp(num(lc.cityModifiers.meteringEfficiency) + 0.08, 0, 0.18);
    } else if (id === 'expo') {
      reward.effect = '城市出行信心 +5%';
      lc.cityModifiers.demandConfidence = clamp(num(lc.cityModifiers.demandConfidence) + 0.05, -0.08, 0.12);
    } else {
      reward.effect = '均衡开发加成 +8%';
      lc.cityModifiers.equityDevelopment = clamp(num(lc.cityModifiers.equityDevelopment) + 0.08, 0, 0.18);
    }
    rewards.unshift(reward);
    lc.campaignRewards = rewards.slice(0, 12);
    lc.events.unshift({ at: Date.now(), hour: num(state().simulationHour), text: campaignName(id) + ' 完成，获得奖励：' + reward.effect, pulse: 0 });
  }

  function currentSnapshot(){
    const lc = living();
    if (lc.snapshot) return lc.snapshot;
    return tick('initial');
  }

  function schedulePulse(){
    clearTimeout(pulseTimer);
    const st = state();
    const delay = st.isSimulating ? 2300 : 6500;
    pulseTimer = setTimeout(() => {
      try {
        const lc = living();
        const hour = num(state().simulationHour);
        const last = num(lc.lastTickHour, -99);
        if (state().isSimulating || Math.abs(hour - last) > 0.02 || !lc.snapshot) tick('pulse');
      } catch(e) {
        console.warn('[CityRail City Pulse]', e);
      }
      schedulePulse();
    }, delay);
  }

  function installStyle(){
    if (byId('cityrail-living-city-style')) return;
    const style = D.createElement('style');
    style.id = 'cityrail-living-city-style';
    style.textContent = `
      #btn-living-city{position:relative;background:linear-gradient(135deg,rgba(10,132,255,.26),rgba(48,209,88,.16));color:#fff;border-color:rgba(10,132,255,.38);font-weight:850;}
	      #btn-living-city::after{display:none!important;content:none!important;}
	      #living-city-overlay{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.42);backdrop-filter:blur(28px) saturate(170%);-webkit-backdrop-filter:blur(28px) saturate(170%);}
	      #living-city-overlay.hidden{display:none!important;}
	      #living-city-beta-notice{position:fixed;inset:0;z-index:2300;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.46);backdrop-filter:blur(24px) saturate(165%);-webkit-backdrop-filter:blur(24px) saturate(165%);color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif;}
	      #living-city-beta-notice.hidden{display:none!important;}
	      .lc-beta-card{width:min(460px,calc(100vw - 36px));border:1px solid rgba(255,255,255,.16);border-radius:20px;background:rgba(22,22,25,.88);box-shadow:0 34px 100px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.10);padding:22px;}
	      .lc-beta-card h2{margin:0;font-size:20px;font-weight:950;letter-spacing:0;}
	      .lc-beta-card p{margin:13px 0 0;font-size:14px;line-height:1.72;color:rgba(255,255,255,.72);}
	      .lc-beta-card button{width:100%;height:40px;margin-top:18px;border:1px solid rgba(10,132,255,.72);border-radius:12px;background:#0A84FF;color:#fff;font-weight:900;cursor:pointer;font-family:inherit;}
	      .lc-beta-card button:disabled{border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.08);color:rgba(255,255,255,.48);cursor:not-allowed;}
	      .lc-shell{width:min(1180px,calc(100vw - 28px));height:min(780px,calc(100vh - 28px));display:grid;grid-template-columns:240px minmax(0,1fr);overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:24px;background:rgba(22,22,25,.82);box-shadow:0 38px 120px rgba(0,0,0,.46),inset 0 1px 0 rgba(255,255,255,.10);color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif;}
      .lc-side{padding:20px 16px;border-right:1px solid rgba(255,255,255,.10);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));display:flex;flex-direction:column;gap:14px;min-width:0;}
      .lc-brand{padding:2px 4px 10px;}
      .lc-kicker{font-size:11px;font-weight:900;letter-spacing:.14em;color:rgba(255,255,255,.42);}
      .lc-title{margin-top:6px;font-size:25px;line-height:1.05;font-weight:900;letter-spacing:0;}
      .lc-sub{margin-top:8px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.58);}
      .lc-tabs{display:grid;gap:8px;}
      .lc-tab{height:42px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.045);color:rgba(255,255,255,.70);font-weight:800;text-align:left;padding:0 13px;cursor:pointer;}
      .lc-tab.on{background:rgba(10,132,255,.92);border-color:rgba(10,132,255,.95);color:#fff;box-shadow:0 12px 28px rgba(10,132,255,.22),inset 0 1px 0 rgba(255,255,255,.24);}
      .lc-score{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px;}
      .lc-score div{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;background:rgba(255,255,255,.04);}
      .lc-score b{display:block;font-size:20px;letter-spacing:0;font-variant-numeric:tabular-nums;}
      .lc-score span{display:block;margin-top:3px;font-size:11px;color:rgba(255,255,255,.48);}
      .lc-main{min-width:0;min-height:0;display:flex;flex-direction:column;}
	      .lc-head{height:66px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 22px;border-bottom:1px solid rgba(255,255,255,.10);}
	      .lc-head h2{margin:0;font-size:18px;font-weight:900;letter-spacing:0;}
	      .lc-head p{margin:3px 0 0;color:rgba(255,255,255,.52);font-size:12px;}
	      .lc-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
	      .lc-close{width:34px;height:34px;border:1px solid rgba(255,255,255,.12);border-radius:50%;background:rgba(255,255,255,.06);color:rgba(255,255,255,.78);font-size:19px;cursor:pointer;}
	      .lc-content{flex:1;min-height:0;overflow:auto;padding:18px 22px 24px;scrollbar-gutter:stable;}
	      .lc-grid{display:grid;gap:12px;}
      .lc-grid.kpi{grid-template-columns:repeat(5,minmax(0,1fr));}
      .lc-card{border:1px solid rgba(255,255,255,.10);border-radius:8px;background:rgba(255,255,255,.055);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);padding:14px;min-width:0;}
      .lc-card h3{margin:0 0 10px;font-size:13px;font-weight:900;color:rgba(255,255,255,.86);}
      .lc-kpi b{display:block;font-size:28px;line-height:1;font-weight:950;letter-spacing:0;font-variant-numeric:tabular-nums;}
      .lc-kpi span{display:block;margin-top:8px;font-size:12px;color:rgba(255,255,255,.52);}
      .lc-meter{height:8px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden;}
      .lc-meter i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#0A84FF,#30D158);}
      .lc-two{grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);}
      .lc-list{display:grid;gap:8px;}
      .lc-row{display:grid;grid-template-columns:minmax(130px,1fr) 86px 86px 86px;gap:10px;align-items:center;padding:10px 0;border-top:1px solid rgba(255,255,255,.08);}
      .lc-row:first-child{border-top:0;}
      .lc-name b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .lc-name span{display:block;margin-top:3px;font-size:11px;color:rgba(255,255,255,.46);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .lc-num{text-align:right;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;}
      .lc-rec{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:rgba(255,255,255,.045);}
      .lc-rec.critical{border-color:rgba(255,69,58,.30);background:rgba(255,69,58,.08);}
      .lc-rec.warn{border-color:rgba(255,159,10,.28);background:rgba(255,159,10,.075);}
      .lc-rec.ok{border-color:rgba(48,209,88,.28);background:rgba(48,209,88,.07);}
      .lc-rec-title{font-size:13px;font-weight:900;}
      .lc-rec-body{margin-top:4px;font-size:12px;line-height:1.45;color:rgba(255,255,255,.58);}
      .lc-action{height:32px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;font-weight:850;padding:0 12px;cursor:pointer;white-space:nowrap;}
      .lc-action.primary{background:#0A84FF;border-color:#0A84FF;}
      .lc-persona{display:grid;grid-template-columns:130px 1fr 48px;gap:10px;align-items:center;padding:9px 0;border-top:1px solid rgba(255,255,255,.08);}
      .lc-persona:first-child{border-top:0;}
      .lc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;}
      .lc-status{display:grid;grid-template-columns:1.1fr repeat(4,minmax(0,.8fr));gap:10px;margin-bottom:12px;}
      .lc-status-main{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(255,255,255,.10);border-radius:8px;background:rgba(255,255,255,.055);padding:13px 14px;}
      .lc-health-ring{width:68px;height:68px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#30D158 calc(var(--v)*1%),rgba(255,255,255,.10) 0);font-weight:950;font-variant-numeric:tabular-nums;}
      .lc-health-ring span{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:rgba(22,22,25,.92);}
      .lc-stat{border:1px solid rgba(255,255,255,.10);border-radius:8px;background:rgba(255,255,255,.045);padding:10px 12px;min-width:0;}
      .lc-stat b{display:block;font-size:20px;line-height:1;font-variant-numeric:tabular-nums;}
      .lc-stat span{display:block;margin-top:7px;font-size:11px;color:rgba(255,255,255,.52);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .lc-bars{display:grid;gap:9px;}
      .lc-bar{display:grid;grid-template-columns:minmax(96px,1fr) minmax(120px,2fr) 58px;gap:10px;align-items:center;}
      .lc-bar label{font-size:12px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .lc-bar small{font-size:11px;color:rgba(255,255,255,.50);text-align:right;font-variant-numeric:tabular-nums;}
      .lc-segments{display:flex;height:12px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08);}
      .lc-segments i{display:block;min-width:2px;}
      .lc-flow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;}
	      .lc-flow-tile{min-height:74px;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:rgba(255,255,255,.04);padding:10px;}
	      .lc-flow-tile b{display:block;font-size:18px;font-variant-numeric:tabular-nums;}
	      .lc-flow-tile span{display:block;margin-top:6px;font-size:11px;color:rgba(255,255,255,.52);}
	      .lc-stage-guide{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;}
	      .lc-stage{border:1px solid rgba(255,255,255,.09);border-radius:8px;background:rgba(255,255,255,.04);padding:10px;min-height:86px;}
	      .lc-stage i{display:block;width:18px;height:18px;border-radius:50%;margin-bottom:8px;box-shadow:0 0 18px color-mix(in srgb,var(--stage-color),transparent 44%);}
	      .lc-stage b{display:block;font-size:13px;line-height:1.25;}
	      .lc-stage span{display:block;margin-top:6px;font-size:11px;line-height:1.35;color:rgba(255,255,255,.52);}
	      .lc-grow-list{display:grid;gap:10px;}
	      .lc-grow-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,1.25fr) 104px;gap:12px;align-items:center;border-top:1px solid rgba(255,255,255,.08);padding:12px 0;}
	      .lc-grow-row:first-child{border-top:0;padding-top:0;}
	      .lc-grow-meta b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
	      .lc-grow-meta span{display:block;margin-top:4px;font-size:11px;color:rgba(255,255,255,.48);line-height:1.35;}
	      .lc-grow-pill{display:inline-flex;align-items:center;height:20px;margin-top:7px;padding:0 7px;border:1px solid rgba(255,255,255,.10);border-radius:999px;background:rgba(255,255,255,.05);font-size:10px;font-weight:850;color:rgba(255,255,255,.68);}
	      .lc-breakdown{display:grid;gap:5px;min-width:0;}
	      .lc-mini-bar{display:grid;grid-template-columns:62px minmax(72px,1fr) 42px;gap:8px;align-items:center;}
	      .lc-mini-bar label{font-size:11px;color:rgba(255,255,255,.54);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
	      .lc-mini-bar div{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;}
	      .lc-mini-bar i{display:block;height:100%;border-radius:999px;background:#0A84FF;}
	      .lc-mini-bar small{text-align:right;font-size:10px;color:rgba(255,255,255,.48);font-variant-numeric:tabular-nums;}
	      .lc-grow-actions{display:grid;gap:7px;justify-items:stretch;}
	      .lc-grow-actions .lc-action{width:100%;height:30px;padding:0 8px;font-size:12px;}
	      .lc-grow-actions .lc-action:disabled{opacity:.42;cursor:not-allowed;background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.08);}
	      #cityrail-living-map-legend{position:fixed;right:18px;bottom:18px;z-index:1600;width:min(330px,calc(100vw - 36px));border:1px solid rgba(255,255,255,.18);border-radius:16px;background:rgba(22,22,25,.82);box-shadow:0 24px 72px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.10);backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif;padding:13px;pointer-events:auto;}
	      #cityrail-living-map-legend.hidden{display:none!important;}
	      .lc-map-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:900;}
	      .lc-map-title button{width:28px;height:28px;border:1px solid rgba(255,255,255,.12);border-radius:50%;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;}
	      .lc-map-key{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;}
	      .lc-map-key div{display:flex;align-items:center;gap:7px;font-size:11px;color:rgba(255,255,255,.66);min-width:0;}
	      .lc-map-key i{display:block;width:12px;height:12px;border-radius:50%;flex:0 0 auto;background:var(--key-color);}
	      .lc-map-note{margin-top:10px;font-size:11px;line-height:1.45;color:rgba(255,255,255,.52);}
	      #cityrail-living-growth-canvas{position:absolute;left:0;top:0;width:100%;height:100%;z-index:645;pointer-events:none;}
	      .lc-campaigns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
	      .lc-campaign{display:flex;flex-direction:column;gap:12px;min-height:220px;}
      .lc-campaign strong{font-size:17px;}
      .lc-campaign p{font-size:12px;line-height:1.55;color:rgba(255,255,255,.58);}
      .lc-event{font-size:12px;line-height:1.5;color:rgba(255,255,255,.62);padding:9px 0;border-top:1px solid rgba(255,255,255,.08);}
      .lc-event:first-child{border-top:0;}
      html.cityrail-light-ui #living-city-overlay{background:rgba(248,250,252,.40);}
      html.cityrail-light-ui .lc-shell{background:rgba(255,255,255,.86);color:#111827;border-color:rgba(15,23,42,.10);box-shadow:0 34px 90px rgba(15,23,42,.20),inset 0 1px 0 rgba(255,255,255,.82);}
      html.cityrail-light-ui .lc-side,html.cityrail-light-ui .lc-head{border-color:rgba(15,23,42,.10);}
      html.cityrail-light-ui .lc-sub,html.cityrail-light-ui .lc-head p,html.cityrail-light-ui .lc-name span,html.cityrail-light-ui .lc-rec-body,html.cityrail-light-ui .lc-event,html.cityrail-light-ui .lc-score span{color:rgba(17,24,39,.58);}
      html.cityrail-light-ui .lc-card,html.cityrail-light-ui .lc-rec,html.cityrail-light-ui .lc-score div{background:rgba(248,250,252,.82);border-color:rgba(15,23,42,.10);}
      html.cityrail-light-ui .lc-status-main,html.cityrail-light-ui .lc-stat,html.cityrail-light-ui .lc-flow-tile{background:rgba(248,250,252,.82);border-color:rgba(15,23,42,.10);}
	      html.cityrail-light-ui .lc-health-ring span{background:rgba(255,255,255,.94);}
	      html.cityrail-light-ui .lc-stat span,html.cityrail-light-ui .lc-bar small,html.cityrail-light-ui .lc-flow-tile span{color:rgba(17,24,39,.54);}
	      html.cityrail-light-ui .lc-row,html.cityrail-light-ui .lc-persona,html.cityrail-light-ui .lc-event{border-color:rgba(15,23,42,.09);}
	      html.cityrail-light-ui .lc-tab{background:rgba(248,250,252,.72);color:rgba(17,24,39,.70);border-color:rgba(15,23,42,.10);}
	      html.cityrail-light-ui .lc-close,html.cityrail-light-ui .lc-action{background:rgba(248,250,252,.88);color:#111827;border-color:rgba(15,23,42,.12);}
	      html.cityrail-light-ui #living-city-beta-notice{background:rgba(248,250,252,.44);}
	      html.cityrail-light-ui .lc-beta-card{background:rgba(255,255,255,.90);color:#111827;border-color:rgba(15,23,42,.10);box-shadow:0 28px 80px rgba(15,23,42,.20),inset 0 1px 0 rgba(255,255,255,.86);}
	      html.cityrail-light-ui .lc-beta-card p{color:rgba(17,24,39,.66);}
	      html.cityrail-light-ui .lc-beta-card button:disabled{background:rgba(15,23,42,.06);color:rgba(17,24,39,.42);border-color:rgba(15,23,42,.08);}
	      html.cityrail-light-ui .lc-grow-row{border-color:rgba(15,23,42,.09);}
	      html.cityrail-light-ui .lc-grow-meta span,html.cityrail-light-ui .lc-grow-pill,html.cityrail-light-ui .lc-mini-bar label,html.cityrail-light-ui .lc-mini-bar small{color:rgba(17,24,39,.56);}
	      html.cityrail-light-ui .lc-grow-pill{background:rgba(15,23,42,.04);border-color:rgba(15,23,42,.09);}
	      html.cityrail-light-ui #cityrail-living-map-legend{background:rgba(255,255,255,.88);color:#111827;border-color:rgba(15,23,42,.12);box-shadow:0 22px 56px rgba(15,23,42,.18),inset 0 1px 0 rgba(255,255,255,.90);}
	      html.cityrail-light-ui .lc-map-key div,html.cityrail-light-ui .lc-map-note,html.cityrail-light-ui .lc-stage span{color:rgba(17,24,39,.56);}
	      @media(max-width:920px){.lc-shell{grid-template-columns:1fr;height:calc(100vh - 18px);width:calc(100vw - 18px);}.lc-side{border-right:0;border-bottom:1px solid rgba(255,255,255,.10);}.lc-tabs{grid-template-columns:repeat(5,minmax(0,1fr));}.lc-tab{height:36px;text-align:center;padding:0 6px;font-size:12px;}.lc-score{display:none}.lc-grid.kpi,.lc-two,.lc-campaigns,.lc-status,.lc-flow-grid,.lc-stage-guide,.lc-grow-row{grid-template-columns:1fr}.lc-row{grid-template-columns:1fr 64px 64px 64px}.lc-bar{grid-template-columns:minmax(86px,1fr) minmax(90px,1.4fr) 48px}.lc-head{height:auto;min-height:62px;padding:12px 16px}.lc-content{padding:14px 16px 18px;}#cityrail-living-map-legend{left:10px;right:10px;bottom:10px;width:auto}.lc-head-actions .lc-action{padding:0 10px;}}
	    `;
	    D.head.appendChild(style);
	  }

	  function leafletMap(){
	    return W.map && W.L && typeof W.L.layerGroup === 'function' && W.map.addLayer ? W.map : null;
	  }

	  function clearGrowthMap(){
	    if (growthLayer && growthLayer.map && growthLayer.redraw) {
	      try { growthLayer.map.off('move zoom resize zoomend moveend', growthLayer.redraw); } catch(e) {}
	    }
	    if (growthCanvasFrame) {
	      try { W.cancelAnimationFrame(growthCanvasFrame); } catch(e) {}
	      growthCanvasFrame = 0;
	    }
	    if (growthCanvas && growthCanvas.parentNode) {
	      try { growthCanvas.parentNode.removeChild(growthCanvas); } catch(e) {}
	    }
	    growthCanvas = null;
	    growthLayer = null;
	    growthMapRows = [];
	    lastGrowthMapSig = '';
	    lastGrowthMapRenderAt = 0;
	  }

	  function ensureGrowthLegend(){
	    installStyle();
	    if (growthLegend) return growthLegend;
	    growthLegend = D.createElement('div');
	    growthLegend.id = 'cityrail-living-map-legend';
	    growthLegend.className = 'hidden';
	    growthLegend.innerHTML = `
	      <div class="lc-map-title"><span>车站成长地图</span><button type="button" data-lc-map-close aria-label="关闭">×</button></div>
	      <div class="lc-map-key">
	        <div><i style="--key-color:#8E8E93"></i><span>待激活</span></div>
	        <div><i style="--key-color:#0A84FF"></i><span>培育站区</span></div>
	        <div><i style="--key-color:#30D158"></i><span>成熟站区</span></div>
	        <div><i style="--key-color:#BF5AF2"></i><span>增长极</span></div>
	        <div><i style="--key-color:#FFD60A"></i><span>都会核心</span></div>
	        <div><i style="--key-color:#FF453A"></i><span>红圈=承压</span></div>
	      </div>
	      <div class="lc-map-note"><span id="lc-map-note-count">等待车站数据</span>。淡色大圈是站区服务圈，实心圈是成长阶段，红色外圈表示候车和线路压力正在压制继续成长。</div>`;
	    growthLegend.addEventListener('click', e => {
	      if (e.target && e.target.closest && e.target.closest('[data-lc-map-close]')) hideGrowthMap();
	    });
	    D.body.appendChild(growthLegend);
	    return growthLegend;
	  }

	  function growthMapSig(snap){
	    const rows = (snap && snap.mapRows) || [];
	    const pulse = (snap && snap.pulse) || {};
	    return [
	      rows.length,
	      Math.round(num(snap && snap.hour) * 10),
	      Math.round(num(pulse.vitality)),
	      Math.round(num(pulse.pressure)),
	      Math.round(num(pulse.satisfaction)),
	      Math.round(num(pulse.catchmentCoverage))
	    ].join(':');
	  }

	  function ensureGrowthCanvas(map){
	    if (growthCanvas && growthCanvas.parentNode) return growthCanvas;
	    const container = map && map.getContainer && map.getContainer();
	    if (!container) return null;
	    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
	    growthCanvas = D.createElement('canvas');
	    growthCanvas.id = 'cityrail-living-growth-canvas';
	    container.appendChild(growthCanvas);
	    if (!growthLayer) {
	      growthLayer = { canvas:growthCanvas, map, bound:false };
	      const redraw = () => scheduleGrowthCanvasRender();
	      try {
	        map.on('move zoom resize zoomend moveend', redraw);
	        growthLayer.bound = true;
	        growthLayer.redraw = redraw;
	      } catch(e) {}
	    }
	    return growthCanvas;
	  }

	  function metersToPixels(map, lat, meters){
	    const zoom = map && map.getZoom ? map.getZoom() : 12;
	    const mpp = 40075016.686 * Math.max(0.18, Math.cos(num(lat) * Math.PI / 180)) / Math.pow(2, zoom + 8);
	    return clamp(num(meters) / Math.max(0.1, mpp), 4, 130);
	  }

	  function drawGrowthCanvas(){
	    growthCanvasFrame = 0;
	    const m = leafletMap();
	    const canvas = growthCanvas || (m && ensureGrowthCanvas(m));
	    if (!m || !canvas) return;
	    const container = m.getContainer && m.getContainer();
	    const rect = container && container.getBoundingClientRect ? container.getBoundingClientRect() : { width:0, height:0 };
	    const dpr = Math.min(2, W.devicePixelRatio || 1);
	    const w = Math.max(1, Math.round(rect.width));
	    const h = Math.max(1, Math.round(rect.height));
	    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
	      canvas.width = Math.round(w * dpr);
	      canvas.height = Math.round(h * dpr);
	      canvas.style.width = w + 'px';
	      canvas.style.height = h + 'px';
	    }
	    const ctx = canvas.getContext('2d');
	    if (!ctx) return;
	    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	    ctx.clearRect(0, 0, w, h);
	    let growthCount = 0;
	    let pressureCount = 0;
	    const rows = growthMapRows || [];
	    for (const row of rows) {
	      const lat = num(row.lat, NaN);
	      const lng = num(row.lng, NaN);
	      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
	      let p = null;
	      try { p = m.latLngToContainerPoint([lat, lng]); } catch(e) {}
	      if (!p || p.x < -160 || p.y < -160 || p.x > w + 160 || p.y > h + 160) continue;
	      const color = stageColor(row.development);
	      const outerPx = metersToPixels(m, lat, row.catchment && row.catchment.outerM);
	      const corePx = metersToPixels(m, lat, row.catchment && row.catchment.coreM);
	      ctx.beginPath();
	      ctx.arc(p.x, p.y, outerPx, 0, Math.PI * 2);
	      ctx.strokeStyle = color;
	      ctx.globalAlpha = 0.13;
	      ctx.lineWidth = 1.5;
	      ctx.stroke();
	      ctx.beginPath();
	      ctx.arc(p.x, p.y, corePx, 0, Math.PI * 2);
	      ctx.globalAlpha = 0.18;
	      ctx.lineWidth = 1;
	      ctx.stroke();
	      const radius = clamp(5 + num(row.development) / 6.5, 5, 20);
	      ctx.beginPath();
	      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
	      ctx.globalAlpha = clamp(.18 + num(row.development) / 360, .18, .48);
	      ctx.fillStyle = color;
	      ctx.fill();
	      ctx.globalAlpha = .9;
	      ctx.lineWidth = num(row.delta) > .08 ? 3 : 2;
	      ctx.strokeStyle = color;
	      ctx.stroke();
	      growthCount++;
	      if (num(row.pressure) >= 55) {
	        ctx.beginPath();
	        ctx.arc(p.x, p.y, radius + clamp(num(row.pressure) / 18, 3, 7), 0, Math.PI * 2);
	        ctx.globalAlpha = clamp(num(row.pressure) / 100, .42, .92);
	        ctx.lineWidth = 2;
	        ctx.strokeStyle = '#FF453A';
	        ctx.stroke();
	        pressureCount++;
	      }
	    }
	    ctx.globalAlpha = 1;
	    if (growthLayer) {
	      growthLayer._cityrailLivingGrowthCount = growthCount;
	      growthLayer._cityrailLivingPressureCount = pressureCount;
	    }
	    const countEl = byId('lc-map-note-count');
	    if (countEl) countEl.textContent = '已绘制 ' + fmt(growthCount) + ' 个站区、' + fmt(pressureCount) + ' 个承压圈';
	  }

	  function scheduleGrowthCanvasRender(){
	    if (!mapGrowthVisible) return;
	    if (growthCanvasFrame) return;
	    growthCanvasFrame = W.requestAnimationFrame ? W.requestAnimationFrame(drawGrowthCanvas) : W.setTimeout(drawGrowthCanvas, 16);
	  }

	  function showGrowthMap(snap, force){
	    const m = leafletMap();
	    if (!m) return false;
	    const rows = (snap && snap.mapRows) || (snap && snap.stationRows) || [];
	    const sig = growthMapSig(snap);
	    const now = Date.now();
	    if (!force && growthLayer && sig === lastGrowthMapSig) return true;
	    if (!force && growthLayer && now - lastGrowthMapRenderAt < 1400) return true;
	    ensureGrowthCanvas(m);
	    growthMapRows = rows;
	    lastGrowthMapSig = sig;
	    lastGrowthMapRenderAt = now;
	    const legend = ensureGrowthLegend();
	    legend.classList.remove('hidden');
	    mapGrowthVisible = true;
	    scheduleGrowthCanvasRender();
	    const btn = byId('btn-living-city');
	    if (btn) btn.classList.add('active');
	    return true;
	  }

	  function hideGrowthMap(){
	    mapGrowthVisible = false;
	    clearGrowthMap();
	    if (growthLegend) growthLegend.classList.add('hidden');
	    if (!open) {
	      const btn = byId('btn-living-city');
	      if (btn) btn.classList.remove('active');
	    }
	  }

	  function showMapOnly(){
	    const snap = tick('growth-map');
	    if (!showGrowthMap(snap, true)) {
	      note('地图还没有准备好，已保留站区成长面板');
	      return;
	    }
	    open = false;
	    const root = byId('living-city-overlay');
	    if (root) root.classList.add('hidden');
	  }

	  function betaNoticeSeen(){
	    try { return W.localStorage && W.localStorage.getItem(betaNoticeKey) === 'seen'; } catch(e) {}
	    return !!living().betaNoticeSeen;
	  }

	  function markBetaNoticeSeen(){
	    living().betaNoticeSeen = true;
	    try { if (W.localStorage) W.localStorage.setItem(betaNoticeKey, 'seen'); } catch(e) {}
	  }

	  function showBetaNotice(afterClose){
	    installStyle();
	    let root = byId('living-city-beta-notice');
	    if (!root) {
	      root = D.createElement('div');
	      root.id = 'living-city-beta-notice';
	      root.className = 'hidden';
	      root.innerHTML = `
	        <div class="lc-beta-card" role="dialog" aria-modal="true" aria-label="城市脉动测试提示">
	          <h2>城市脉动测试提示</h2>
	          <p>“城市脉动”功能目前处于测试阶段，正常游玩将不受影响，但本功能可能会有不完善及不合理之处，欢迎联系开发者反馈意见，您的每次反馈都在让游戏变得更好</p>
	          <button type="button" id="lc-beta-confirm" disabled>请阅读 3 秒</button>
	        </div>`;
	      D.body.appendChild(root);
	    }
	    const btn = byId('lc-beta-confirm');
	    root.classList.remove('hidden');
	    let remaining = 3;
	    if (btn) {
	      btn.disabled = true;
	      btn.textContent = '请阅读 ' + remaining + ' 秒';
	    }
	    clearInterval(root.__livingCityBetaTimer);
	    root.__livingCityBetaTimer = setInterval(() => {
	      remaining--;
	      if (!btn) return;
	      if (remaining > 0) btn.textContent = '请阅读 ' + remaining + ' 秒';
	      else {
	        clearInterval(root.__livingCityBetaTimer);
	        root.__livingCityBetaTimer = 0;
	        btn.disabled = false;
	        btn.textContent = '我知道了';
	      }
	    }, 1000);
	    if (btn && !btn.__livingCityBetaBound) {
	      btn.__livingCityBetaBound = true;
	      btn.addEventListener('click', () => {
	        if (btn.disabled) return;
	        clearInterval(root.__livingCityBetaTimer);
	        root.__livingCityBetaTimer = 0;
	        root.classList.add('hidden');
	        markBetaNoticeSeen();
	        if (typeof afterClose === 'function') afterClose();
	      });
	    }
	  }

	  function ensureButton(){
	    const top = byId('topbar');
    if (!top || byId('btn-living-city')) return;
    const btn = D.createElement('button');
    btn.className = 'tool-btn';
    btn.id = 'btn-living-city';
    btn.type = 'button';
    btn.title = '城市脉动：城市增长、乘客偏好与拥堵治理';
    btn.dataset.uiGlyph = '∿';
    btn.setAttribute('aria-label', '城市脉动');
    btn.textContent = '城市脉动';
    const ctrl = byId('btn-ctrl-center');
    if (ctrl && ctrl.nextSibling) top.insertBefore(btn, ctrl.nextSibling);
    else top.appendChild(btn);
  }

  function ensureOverlay(){
    installStyle();
    let root = byId('living-city-overlay');
    if (root) return root;
    root = D.createElement('div');
    root.id = 'living-city-overlay';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="lc-shell" role="dialog" aria-modal="true" aria-label="城市脉动">
        <aside class="lc-side">
          <div class="lc-brand">
            <div class="lc-kicker">CITY PULSE</div>
            <div class="lc-title">城市脉动</div>
            <div class="lc-sub">线路会改变城市，城市会反过来改变客流和调度压力。</div>
          </div>
          <div class="lc-tabs">
            <button class="lc-tab on" data-lc-tab="pulse" type="button">城市脉搏</button>
            <button class="lc-tab" data-lc-tab="growth" type="button">站区成长</button>
            <button class="lc-tab" data-lc-tab="people" type="button">乘客偏好</button>
            <button class="lc-tab" data-lc-tab="govern" type="button">拥堵治理</button>
            <button class="lc-tab" data-lc-tab="campaign" type="button">战役模式</button>
          </div>
          <div class="lc-score">
            <div><b id="lc-side-vitality">--</b><span>城市活力</span></div>
            <div><b id="lc-side-pressure">--</b><span>治理压力</span></div>
          </div>
        </aside>
	        <main class="lc-main">
	          <div class="lc-head">
	            <div><h2 id="lc-panel-title">城市脉搏</h2><p id="lc-panel-sub">查看轨道系统如何改变城市结构</p></div>
	            <div class="lc-head-actions">
	              <button class="lc-action" type="button" data-lc-action="map">地图光环</button>
	              <button class="lc-close" id="lc-close" type="button" aria-label="关闭">×</button>
	            </div>
	          </div>
	          <div class="lc-content" id="lc-content"></div>
	        </main>
      </div>`;
    D.body.appendChild(root);
    root.addEventListener('click', e => {
      const tab = e.target && e.target.closest && e.target.closest('[data-lc-tab]');
      const act = e.target && e.target.closest && e.target.closest('[data-lc-action]');
      if (e.target === root || (e.target && e.target.id === 'lc-close')) closePanel();
      if (tab) { activeTab = tab.getAttribute('data-lc-tab') || 'pulse'; render(true); }
      if (act) performAction(act);
    });
    D.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closePanel(); });
    return root;
  }

  function openPanel(){
    open = true;
    ensureOverlay().classList.remove('hidden');
    const btn = byId('btn-living-city');
    if (btn) btn.classList.add('active');
    tick('open');
    render(true);
  }

	  function closePanel(){
	    open = false;
	    const root = byId('living-city-overlay');
	    if (root) root.classList.add('hidden');
	    hideGrowthMap();
	    const btn = byId('btn-living-city');
	    if (btn) btn.classList.remove('active');
	  }

  function scheduleRender(){
    if (!open) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => render(false), 80);
  }

  function render(force){
    if (!open) return;
    const snap = currentSnapshot();
    const sig = JSON.stringify([activeTab, snap.health && snap.health.status, Math.round(snap.pulse.vitality), Math.round(snap.pulse.pressure), snap.stationRows.length, snap.recommendations.length, snap.persona.map(p => Math.round(p.share)).join('.')]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    D.querySelectorAll('.lc-tab').forEach(btn => btn.classList.toggle('on', btn.getAttribute('data-lc-tab') === activeTab));
    const title = {
      pulse:'城市脉搏', growth:'站区成长', people:'乘客偏好', govern:'拥堵治理', campaign:'战役模式'
    }[activeTab] || '城市脉动';
    const sub = {
      pulse:'轨道系统正在塑造城市结构',
      growth:'每个站区都有自己的成长阶段和压力',
      people:'同一 OD 的乘客不再拥有同一种路径偏好',
      govern:'把拥堵拆解成可执行的运营动作',
      campaign:'以真实运营矛盾作为目标的场景挑战'
    }[activeTab] || '';
    const titleEl = byId('lc-panel-title');
    const subEl = byId('lc-panel-sub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub;
    const sideV = byId('lc-side-vitality');
    const sideP = byId('lc-side-pressure');
    if (sideV) sideV.textContent = Math.round(snap.pulse.vitality);
    if (sideP) sideP.textContent = Math.round(snap.pulse.pressure);
    const content = byId('lc-content');
    if (!content) return;
    if (activeTab === 'growth') content.innerHTML = renderGrowth(snap);
    else if (activeTab === 'people') content.innerHTML = renderPeople(snap);
    else if (activeTab === 'govern') content.innerHTML = renderGovern(snap);
    else if (activeTab === 'campaign') content.innerHTML = renderCampaign(snap);
    else content.innerHTML = renderPulse(snap);
  }

  function kpi(label, value, hint, width, color){
    return `<div class="lc-card lc-kpi"><b>${esc(value)}</b><span>${esc(label)} · ${esc(hint || '')}</span><div class="lc-meter" style="margin-top:12px"><i style="width:${pct(width)};background:${esc(color || 'linear-gradient(90deg,#0A84FF,#30D158)')}"></i></div></div>`;
  }

  function healthLabel(status){
    return {
      empty:'待建设',
      'no-lines':'未成网',
      'no-service':'待发车',
      unrouted:'路径异常',
      'fleet-gap':'运力缺口',
      stressed:'局部拥堵',
      ready:'运行中'
    }[status] || '运行中';
  }

  function renderHealth(snap){
    const h = snap.health || {};
    const score = Math.round(num(h.health, 0));
    return `<div class="lc-status">
      <div class="lc-status-main"><div><div class="lc-rec-title">网络状态 · ${esc(healthLabel(h.status))}</div><div class="lc-rec-body">候车 ${fmt(h.waiting)} · 未分配 ${fmt(h.unresolved)} · 运力缺口 ${fmt(h.missingFleet)}</div></div><div class="lc-health-ring" style="--v:${score}"><span>${score}</span></div></div>
      <div class="lc-stat"><b>${fmt(h.stationCount)}</b><span>车站</span></div>
      <div class="lc-stat"><b>${fmt(h.lineCount)}</b><span>线路</span></div>
      <div class="lc-stat"><b>${fmt(h.trainCount)}</b><span>在线列车</span></div>
      <div class="lc-stat"><b>${fmt(h.stressed)}</b><span>承压线路</span></div>
    </div>`;
  }

  function segmentBar(rows){
    const total = Math.max(1, rows.reduce((a, r) => a + num(r.count), 0));
    return `<div class="lc-segments">${rows.map(r => `<i title="${esc(r.name)} ${fmt(r.count)}" style="width:${pct(num(r.count) / total * 100)};background:${esc(r.color || '#0A84FF')}"></i>`).join('')}</div>
      <div class="lc-bars" style="margin-top:10px">${rows.map(r => `<div class="lc-bar"><label>${esc(r.name)}</label><div class="lc-meter"><i style="width:${pct(num(r.count) / total * 100)};background:${esc(r.color || '#0A84FF')}"></i></div><small>${fmt(r.count)}</small></div>`).join('')}</div>`;
  }

  function countBarsHtml(rows, color){
    const max = Math.max(1, ...rows.map(r => num(r.count)));
    return `<div class="lc-bars">${rows.map(r => `<div class="lc-bar"><label>${esc(r.name)}</label><div class="lc-meter"><i style="width:${pct(num(r.count) / max * 100)};background:${esc(color || '#0A84FF')}"></i></div><small>${fmt(r.count)}</small></div>`).join('')}</div>`;
  }

  function lineBarsHtml(rows){
    if (!rows.length) return '<div class="lc-event">还没有可运营线路。</div>';
    return `<div class="lc-bars">${rows.map(r => {
      const color = r.missingFleet ? '#FF453A' : (r.pressure >= 70 ? '#FF9F0A' : '#0A84FF');
      return `<div class="lc-bar"><label>${esc(r.name)}</label><div class="lc-meter"><i style="width:${pct(r.pressure)};background:${esc(color)}"></i></div><small>${fmt(r.waiting)} / ${fmt(r.trains)}列</small></div>`;
    }).join('')}</div>`;
  }

	  function renderPulse(snap){
	    const top = snap.stationRows.slice(0, 7);
	    const events = (living().events || []).slice(0, 6);
	    return `
      ${renderHealth(snap)}
      <div class="lc-grid kpi">
        ${kpi('城市活力', Math.round(snap.pulse.vitality), '站区成长均值', snap.pulse.vitality)}
        ${kpi('治理压力', Math.round(snap.pulse.pressure), '拥堵与候车综合', snap.pulse.pressure, 'linear-gradient(90deg,#FF9F0A,#FF453A)')}
        ${kpi('满意度', Math.round(snap.pulse.satisfaction), '乘客体感', snap.pulse.satisfaction, 'linear-gradient(90deg,#64D2FF,#30D158)')}
        ${kpi('公平性', Math.round(snap.pulse.equity), '可达性差异', snap.pulse.equity, 'linear-gradient(90deg,#BF5AF2,#0A84FF)')}
        ${kpi('服务圈', Math.round(snap.pulse.catchmentCoverage), '站区覆盖能力', snap.pulse.catchmentCoverage, 'linear-gradient(90deg,#FFD60A,#30D158)')}
      </div>
      <div class="lc-grid lc-two" style="margin-top:12px">
        <section class="lc-card"><h3>站区压力分布</h3>${segmentBar(snap.charts.pressureBands)}<div style="height:10px"></div>${stationRowsHtml(top)}</section>
	        <section class="lc-card"><h3>线路压力排行</h3>${lineBarsHtml(snap.charts.lines.slice(0, 7))}<div style="height:10px"></div>${events.length ? events.map(e => `<div class="lc-event">${esc(formatHour(e.hour))} · ${esc(e.text)}</div>`).join('') : '<div class="lc-event">开始模拟后，城市会记录线网带来的结构变化。</div>'}</section>
	      </div>`;
	  }

	  function renderStageGuide(){
	    const rows = [
	      { name:'待激活', color:'#8E8E93', range:'0-29', body:'未形成稳定客流或线路接入弱' },
	      { name:'培育站区', color:'#0A84FF', range:'30-47', body:'开始吸引通勤和本地出行' },
	      { name:'成熟站区', color:'#30D158', range:'48-65', body:'可达性和客流已经稳定' },
	      { name:'增长极', color:'#BF5AF2', range:'66-81', body:'多线路、多功能站区带动片区' },
	      { name:'都会核心', color:'#FFD60A', range:'82+', body:'高可达、高需求的城市核心节点' }
	    ];
	    return `<section class="lc-card"><h3>车站分级</h3><div class="lc-stage-guide">${rows.map(r => `
	      <div class="lc-stage" style="--stage-color:${esc(r.color)}"><i style="background:${esc(r.color)}"></i><b>${esc(r.name)}</b><span>${esc(r.range)} · ${esc(r.body)}</span></div>`).join('')}</div></section>`;
	  }

	  function renderGrowthRules(){
	    const rows = [
	      { value:'线路接入', body:'线路越多，基础可达性越强' },
	      { value:'跨天客流', body:'到达、上车、送达会被长期记录' },
	      { value:'可达性', body:'低换乘成本和稳定服务会放大增长' },
	      { value:'站区功能', body:'办公、枢纽、商业等有不同吸引力' },
	      { value:'TOD 引导', body:'玩家启动 TOD 后提高成长目标' },
	      { value:'压力可控', body:'候车和拥挤过高会压制成长' },
	      { value:'持续运营', body:'新一天表现变差会让进度回退' },
	      { value:'均衡线网', body:'孤立站和断线站不会凭空升级' }
	    ];
	    return `<section class="lc-card"><h3>成长条件</h3><div class="lc-flow-grid">${rows.map(r => `<div class="lc-flow-tile"><b>${esc(r.value)}</b><span>${esc(r.body)}</span></div>`).join('')}</div></section>`;
	  }

	  function todEligibility(row){
	    if (!row || row.lineCount <= 0) return { ok:false, text:'未接入线路' };
	    if (row.accessibility <= 52) return { ok:false, text:'可达性不足' };
	    if (row.pressure >= 35) return { ok:false, text:'先降压力' };
	    if (row.development >= 66) return { ok:false, text:'已成增长极' };
	    return { ok:true, text:row.todLevel ? '继续 TOD' : '启动 TOD' };
	  }

	  function blockerText(row){
	    if (!row) return '';
	    if (row.lineCount <= 0) return '没有线路接入，站区不会自然成长';
	    if (row.pressure >= 55) return '候车和线路压力偏高，正在压制成长';
	    if (row.accessibility < 38) return '可达性偏低，需要更多线路或换乘连接';
	    if (num(row.growthParts && row.growthParts.demandBoost) < 8) return '跨天累计客流还不够';
	    if (row.nextGap <= 0) return '已经达到最高阶段';
	    return '继续保持服务稳定，成长会逐步兑现';
	  }

	  function miniContribution(label, value, color, scale, negative){
	    const v = Math.max(0, num(value));
	    return `<div class="lc-mini-bar"><label>${esc(label)}</label><div><i style="width:${pct(v / Math.max(1, num(scale, 40)) * 100)};background:${esc(color || '#0A84FF')}"></i></div><small>${negative ? '-' : '+'}${fmt(v)}</small></div>`;
	  }

	  function stationGrowthRowsHtml(rows){
	    if (!rows.length) return '<div class="lc-event">还没有车站。先建设线路，城市才会开始响应。</div>';
	    return `<div class="lc-grow-list">${rows.map(row => {
	      const parts = row.growthParts || {};
	      const tod = todEligibility(row);
	      const gap = Math.max(0, num(row.nextGap));
	      const targetDelta = num(row.targetDevelopment) - num(row.development);
	      return `<div class="lc-grow-row">
	        <div class="lc-grow-meta">
	          <b>${esc(row.name)}</b>
	          <span>${esc(row.stage)} · ${esc(row.zoneText)} · ${esc(row.lineNames)}</span>
	          <span>目标 ${pct(row.targetDevelopment)} · 当前 ${pct(row.development)} · 今日 ${fmt(row.dayFlow)} · 累计 ${fmt(row.lifetimeFlow)}</span>
	          <div class="lc-grow-pill">${gap > 0 ? '距 ' + esc(row.nextStage) + ' 还差 ' + pct(gap) : '已达到最高阶段'}</div>
	        </div>
	        <div class="lc-breakdown">
	          ${miniContribution('可达性', parts.accessBoost, '#0A84FF', 44)}
	          ${miniContribution('跨天客流', parts.memoryDemandBoost, '#30D158', 18)}
	          ${miniContribution('今日运营', parts.todayDemandBoost, '#64D2FF', 8)}
	          ${miniContribution('TOD', parts.todBoost, '#BF5AF2', 35)}
	          ${miniContribution('限流缓解', parts.meteringRelief, '#64D2FF', 34)}
	          ${miniContribution('压力扣分', parts.pressurePenalty, '#FF453A', 18, true)}
	          ${parts.regressionPenalty > 0.05 ? miniContribution('表现回退', parts.regressionPenalty, '#FF453A', 9, true) : ''}
	          <div class="lc-event" style="padding:2px 0 0;border:0">${esc(blockerText(row))}${targetDelta > 0 ? ' · 成长趋势 +' + pct(targetDelta) : ''}</div>
	        </div>
	        <div class="lc-grow-actions">
	          <button class="lc-action ${tod.ok ? 'primary' : ''}" type="button" data-lc-action="tod" data-station-id="${esc(row.id)}" ${tod.ok ? '' : 'disabled'} title="${esc(tod.text)}">${esc(tod.text)}</button>
	          <div class="lc-num">TOD ${fmt(row.todLevel || 0)}/5</div>
	        </div>
	      </div>`;
	    }).join('')}</div>`;
	  }

	  function renderGrowth(snap){
	    return `
	      ${renderHealth(snap)}
	      <div class="lc-grid" style="margin-bottom:12px">
	        ${renderStageGuide()}
	        ${renderGrowthRules()}
	      </div>
	      <div class="lc-grid lc-two">
	        <section class="lc-card"><h3>成长阶段结构</h3>${countBarsHtml(snap.charts.stages, '#0A84FF')}</section>
	        <section class="lc-card"><h3>站区压力分布</h3>${segmentBar(snap.charts.pressureBands)}<div class="lc-flow-grid" style="margin-top:12px">${snap.charts.pressureBands.map(b => `<div class="lc-flow-tile"><b>${fmt(b.count)}</b><span>${esc(b.name)}站区</span></div>`).join('')}</div></section>
	      </div>
	      <section class="lc-card" style="margin-top:12px"><h3>车站成长拆解</h3>${stationGrowthRowsHtml(snap.stationRows.slice(0, 18))}</section>`;
	  }

  function stationRowsHtml(rows){
    if (!rows.length) return '<div class="lc-event">还没有车站。先建设线路，城市才会开始响应。</div>';
    return rows.map(row => `
      <div class="lc-row">
        <div class="lc-name"><b>${esc(row.name)}</b><span>${esc(row.stage)} · ${esc(row.zoneText)} · ${esc(row.lineNames)}</span></div>
        <div class="lc-num">${pct(row.development)}<div class="lc-meter"><i style="width:${pct(row.development)}"></i></div></div>
        <div class="lc-num">${pct(row.pressure)}<div class="lc-meter"><i style="width:${pct(row.pressure)};background:linear-gradient(90deg,#FF9F0A,#FF453A)"></i></div></div>
        <div class="lc-num">${fmt(row.waiting)}</div>
      </div>`).join('');
  }

  function renderPeople(snap){
    const rows = snap.persona;
    return `
      <div class="lc-grid lc-two">
        <section class="lc-card"><h3>乘客偏好结构</h3>${rows.map(p => `
          <div class="lc-persona">
            <div><span class="lc-dot" style="background:${esc(p.color)}"></span><b>${esc(p.name)}</b></div>
            <div class="lc-meter"><i style="width:${pct(p.share)};background:${esc(p.color)}"></i></div>
            <div class="lc-num">${pct(p.share)}</div>
          </div>`).join('')}</section>
        <section class="lc-card"><h3>路径选择差异</h3>
          ${rows.map(p => `<div class="lc-bar"><label><span class="lc-dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</label><div class="lc-segments"><i style="width:${pct(p.time * 100)};background:#0A84FF"></i><i style="width:${pct(p.transfers * 100)};background:#FF9F0A"></i><i style="width:${pct(p.crowd * 100)};background:#FF453A"></i><i style="width:${pct(p.fare * 100)};background:#64D2FF"></i></div><small>${fmt(p.count)}</small></div>`).join('')}
          <div class="lc-event">蓝=时间，橙=换乘，红=拥挤，青=票价</div>
        </section>
      </div>`;
  }

  function renderGovern(snap){
    return `
      ${renderHealth(snap)}
      <div class="lc-grid lc-two">
        <section class="lc-card"><h3>线路压力</h3>${lineBarsHtml(snap.charts.lines)}</section>
        <section class="lc-card"><h3>拥堵治理建议</h3><div class="lc-list">${snap.recommendations.map(renderRecommendation).join('')}</div></section>
      </div>`;
  }

  function renderRecommendation(rec){
    const attrs = [
      `data-lc-action="${esc(rec.type || 'refresh')}"`,
      rec.lineId ? `data-line-id="${esc(rec.lineId)}"` : '',
      rec.stationId ? `data-station-id="${esc(rec.stationId)}"` : ''
    ].filter(Boolean).join(' ');
    return `<div class="lc-rec ${esc(rec.severity || 'info')}"><div><div class="lc-rec-title">${esc(rec.title)}</div><div class="lc-rec-body">${esc(rec.body)}</div></div><button class="lc-action ${rec.severity === 'critical' ? 'primary' : ''}" type="button" ${attrs}>${esc(rec.action || '执行')}</button></div>`;
  }

	  function renderCampaign(snap){
	    const lc = living();
	    const cards = [
	      { id:'rush', name:'晨峰失衡', goal:'把治理压力压到 30 以下，同时保持满意度不低于 72。', body:'郊区大客流涌入核心区，换乘站开始过载。你需要用加密、限流和快慢车组织守住早高峰。' },
	      { id:'expo', name:'会展散场', goal:'让活跃线路保持 4 条以上，并把满意度推到 82。', body:'大型活动结束，短时间客流集中爆发。你要让游客、购物和本地通勤分流。' },
	      { id:'newtown', name:'新城崛起', goal:'把城市活力和公平性同时推高，让新城站区成为增长极。', body:'新线开通后，城市开发开始沿轨道重组。你要避免只有核心区变强。' }
	    ];
	    const rewards = (lc.campaignRewards || []).slice(0, 6);
	    return `<div class="lc-campaigns">${cards.map(c => {
	      const row = lc.campaigns[c.id] || {};
	      const on = lc.activeCampaign === c.id;
	      const done = !!row.complete;
	      const failed = !!row.failed;
	      const label = done ? '已完成' : (failed ? '重开战役' : (on ? '进行中 ' + pct(row.progress || 0) : '启动战役'));
	      return `<section class="lc-card lc-campaign"><strong>${esc(c.name)}</strong><p>${esc(c.body)}</p><p>${esc(c.goal)}</p><div class="lc-meter"><i style="width:${pct(row.progress || 0)};background:${failed ? '#FF453A' : (done ? '#30D158' : 'linear-gradient(90deg,#0A84FF,#30D158)')}"></i></div><div class="lc-event" style="padding:0;border:0">最佳 ${pct(row.bestProgress || row.progress || 0)} · ${done ? '奖励已保存' : (failed ? '上次未达成' : '48 次城市脉搏内达成可获得奖励')}</div><button class="lc-action ${on ? 'primary' : ''}" type="button" data-lc-action="campaign" data-campaign-id="${esc(c.id)}">${esc(label)}</button></section>`;
	    }).join('')}</div>
	    <section class="lc-card" style="margin-top:12px"><h3>战役奖励</h3>${rewards.length ? rewards.map(r => `<div class="lc-event">${esc(formatHour(r.hour))} · ${esc(r.name)} · ${esc(r.effect || '')}</div>`).join('') : '<div class="lc-event">完成战役后，奖励会保存到当前存档并持续影响城市脉动。</div>'}</section>`;
	  }

	  function performAction(btn){
	    const action = btn.getAttribute('data-lc-action');
	    const st = state();
	    const lc = living();
	    if (action === 'map') {
	      showMapOnly();
	      return;
	    }
	    if (action === 'headway') {
	      const line = lineById(btn.getAttribute('data-line-id'));
	      if (line) {
	        line.peakHeadwayMin = Math.max(1, Math.round((num(line.peakHeadwayMin, 2) - 0.5) * 4) / 4);
        line.normalHeadwayMin = Math.max(1.25, Math.round((num(line.normalHeadwayMin, 4) - 0.25) * 4) / 4);
        line.headwayManual = true;
        line._headwayManual = true;
        line._livingCityAdjustedAt = Date.now();
        note('已压缩 ' + lineName(line) + ' 的高峰间隔');
      }
    } else if (action === 'station') {
      const id = btn.getAttribute('data-station-id');
      const current = lc.stationPolicies[id] || {};
      const nextMetering = !current.metering;
      mutateGroupPolicy(lc, id, policy => { policy.metering = nextMetering; });
      note((nextMetering ? '已启用 ' : '已关闭 ') + (stationName(stationById(id))) + ' 站区限流，后续进站需求会随之调整');
    } else if (action === 'tod') {
      const id = btn.getAttribute('data-station-id');
      const currentBoost = num(lc.stationPolicies[id] && lc.stationPolicies[id].todBoost, 0);
      const nextBoost = clamp(currentBoost + 1, 0, 5);
      mutateGroupPolicy(lc, id, policy => { policy.todBoost = nextBoost; });
      note(stationName(stationById(id)) + ' 已启动 TOD 增长引导');
    } else if (action === 'express') {
      const id = btn.getAttribute('data-line-id');
      closePanel();
      try {
        if (typeof W.openExpressConfig === 'function') W.openExpressConfig(id);
        else if (W.CityRailLineConfigV137 && typeof W.CityRailLineConfigV137.open === 'function') W.CityRailLineConfigV137.open();
      } catch(e) {}
    } else if (action === 'dispatch') {
      const id = btn.getAttribute('data-line-id');
      closePanel();
      try {
        if (typeof W.openLineConfig === 'function') W.openLineConfig(id);
        else if (W.CityRailLineConfigV137 && typeof W.CityRailLineConfigV137.open === 'function') W.CityRailLineConfigV137.open(id);
      } catch(e) {}
    } else if (action === 'repair') {
      try {
        if (typeof W.cityrailRebuildPassengerIndexesV74 === 'function') W.cityrailRebuildPassengerIndexesV74();
        if (typeof W.invalidateFlowCache === 'function') W.invalidateFlowCache();
      } catch(e) {}
      note('已重算客流索引和城市脉动诊断');
    } else if (action === 'build') {
      closePanel();
      try { byId('btn-new-line') && byId('btn-new-line').click(); } catch(e) {}
    } else if (action === 'campaign') {
      lc.activeCampaign = btn.getAttribute('data-campaign-id') || 'rush';
      lc.campaigns[lc.activeCampaign] = Object.assign(lc.campaigns[lc.activeCampaign] || {}, {
        id: lc.activeCampaign,
        startedAt: Date.now(),
        startedTick: num(lc.tickCount),
        startedHour: num(st.simulationHour),
        failed: false
      });
      selectedCampaign = lc.activeCampaign;
      note('战役已启动：' + campaignName(selectedCampaign));
    }
    tick('action-' + action);
    render(true);
  }

  function note(text){
    const lc = living();
    lc.events.unshift({ at: Date.now(), hour: num(state().simulationHour), text: text, pulse: 0 });
    lc.events = lc.events.slice(0, 18);
    try { if (typeof W.cityrailShowDialog === 'function') W.cityrailShowDialog(text, '城市脉动'); } catch(e) {}
  }

  function formatHour(hour){
    const h = Math.floor(num(hour, 0));
    const m = Math.floor((num(hour, 0) - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function boot(){
    installStyle();
    ensureButton();
    ensureOverlay();
    const btn = byId('btn-living-city');
    if (btn && !btn.__livingCityBound) {
      btn.__livingCityBound = true;
      btn.addEventListener('click', e => {
        e.preventDefault();
        ['settings-overlay','nav-overlay','ctrl-center-overlay','new-line-dialog-overlay'].forEach(id => {
          const el = byId(id);
          if (el) el.classList.add('hidden');
	        });
	        D.querySelectorAll('#topbar .tool-btn.active').forEach(el => { if (el.id !== 'btn-living-city') el.classList.remove('active'); });
	        if (open) closePanel();
	        else if (mapGrowthVisible) hideGrowthMap();
	        else if (!betaNoticeSeen()) showBetaNotice(openPanel);
	        else openPanel();
	      });
	    }
    if (!living().snapshot) tick('boot');
    schedulePulse();
  }

  W.CityRailLivingCity = {
    version: VERSION,
    open: openPanel,
	    close: closePanel,
	    tick,
	    showGrowthMap,
	    hideGrowthMap,
	    rolloverDay: rolloverLivingDay,
	    dailyReport,
	    stationDemandFactor,
	    assignPassengerPreference,
    snapshot: currentSnapshot,
    report(){
      const snap = currentSnapshot();
      return {
	        version: VERSION,
	        enabled: !!living().enabled,
	        stations: num(snap.health && snap.health.stationCount, snap.stationRows.length),
	        recommendations: snap.recommendations.length,
        vitality: Math.round(snap.pulse.vitality),
        pressure: Math.round(snap.pulse.pressure),
        catchmentCoverage: Math.round(snap.pulse.catchmentCoverage),
        demandFactors: Object.keys(living().demandFactors || {}).length,
        campaignRewards: (living().campaignRewards || []).length,
        persona: snap.persona.map(p => ({ id:p.id, share:Math.round(p.share) }))
      };
    }
  };
  W.cityrailLivingCityStationDemandFactor = stationDemandFactor;

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
  W.addEventListener('cityrail-save-loaded', () => setTimeout(() => tick('save-loaded'), 120));
  W.addEventListener('cityrail:dailyPassengerReset', ev => setTimeout(() => {
    try { rolloverLivingDay((ev && ev.detail && ev.detail.reason) || 'dailyPassengerReset'); tick('dailyPassengerReset'); } catch(e) {}
  }, 0));
  D.addEventListener('visibilitychange', () => { if (!D.hidden) setTimeout(() => tick('visible'), 80); }, { passive:true });
})();
