/* CityRail external passenger sources prototype v1 */
(function(){
  'use strict';
  const W = window;
  const D = document;
  const VERSION = 'external-passenger-sources-v1-20260623-preview-od';
  if (W.CityRailExternalPassengerSourcesV1) return;

  const TYPE_DEFS = {
    airport: { label:'机场', icon:'机', color:'#0A84FF', baseDaily:62000, zones:{ office:1.25, shopping:1.05, railway_station:1.10, residential:.92, leisure:.72, school:.36, airport:.18 }, rhythm:'airport' },
    railway: { label:'火车站', icon:'轨', color:'#34C759', baseDaily:82000, zones:{ residential:1.18, office:1.02, shopping:.96, airport:.62, school:.58, leisure:.66, railway_station:.28 }, rhythm:'railway' },
    port: { label:'港口', icon:'港', color:'#64D2FF', baseDaily:24000, zones:{ leisure:1.25, shopping:1.12, residential:.82, office:.64, railway_station:.55, airport:.22, school:.18 }, rhythm:'port' },
    bus: { label:'汽车站', icon:'巴', color:'#FF9F0A', baseDaily:36000, zones:{ residential:1.22, office:.92, railway_station:.82, shopping:.76, school:.62, leisure:.48, airport:.22 }, rhythm:'bus' },
    stadium: { label:'体育场馆', icon:'体', color:'#FF2D55', baseDaily:16000, zones:{ leisure:1.28, shopping:1.05, residential:.92, railway_station:.54, office:.42, school:.38, airport:.16 }, rhythm:'stadium' }
  };
  const INTENSITY_DEFS = {
    small: { label:'小', multiplier:.38 },
    medium: { label:'中', multiplier:.80 },
    large: { label:'大', multiplier:1.55 },
    huge: { label:'超大', multiplier:2.75 }
  };
  const TYPE_ORDER = ['airport','railway','port','bus','stadium'];
  const INTENSITY_ORDER = ['small','medium','large','huge'];
  const SOURCE_MODEL_DIAMETER_M = 180;
  const SOURCE_MODEL_MIN_PX = 18;
  const SOURCE_MODEL_MAX_PX = 110;
  const sid = v => String(v == null ? '' : v);
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = v => sid(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt = v => Math.max(0, Math.round(num(v))).toLocaleString('zh-CN');
  const S = () => W.state || {};
  const stations = () => Array.isArray(S().stations) ? S().stations : [];
  let sourceLayers = {};
  let rangeLayers = {};
  let selectedId = '';
  let placing = false;
  let movingId = '';
  let renderTimer = 0;
  let scaleRenderFrame = 0;
  let rangeRenderFrame = 0;
  let radiusCommitTimer = 0;
  let odRebuildTimer = 0;
  let rangePreviewUntil = 0;
  let sigLast = '';

  function havKm(aLat, aLng, bLat, bLng) {
    if (typeof W.haversine === 'function') return W.haversine(aLat, aLng, bLat, bLng);
    const R = 6371;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const q = s1 * s1 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
  }

  function ensureState() {
    const st = S();
    if (!Array.isArray(st.externalPassengerSources)) st.externalPassengerSources = [];
    st.externalPassengerSources = st.externalPassengerSources.map(cleanSource).filter(Boolean);
    return st.externalPassengerSources;
  }

  function cleanSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const type = TYPE_DEFS[raw.type] ? raw.type : 'airport';
    const intensity = INTENSITY_DEFS[raw.intensity] ? raw.intensity : 'medium';
    const def = TYPE_DEFS[type];
    return {
      id: sid(raw.id) || ('eps_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)),
      name: sid(raw.name || def.label),
      type,
      intensity,
      lat: num(raw.lat),
      lng: num(raw.lng),
      radiusKm: clamp(num(raw.radiusKm, 1), 0, 3),
      createdAt: num(raw.createdAt, Date.now()),
      updatedAt: num(raw.updatedAt, Date.now())
    };
  }

  function saveAndRefresh(reason, options) {
    options = options || {};
    try { if (typeof W.invalidateFlowCache === 'function') W.invalidateFlowCache(); else if (typeof invalidateFlowCache === 'function') invalidateFlowCache(); } catch(e) {}
    scheduleODRebuild(reason, options.delay == null ? 420 : options.delay, options.affectedStationIds || [], options);
    try { if (typeof W.updateUI === 'function') W.updateUI(); else if (typeof updateUI === 'function') updateUI(); } catch(e) {}
    try { if (typeof W.saveState === 'function') W.saveState(); else if (typeof saveState === 'function') saveState(); } catch(e) {}
    renderSources(reason);
    if (!isEditingName() && Date.now() > rangePreviewUntil) renderPanel(selectedId);
  }

  function persistOnly(reason) {
    try { if (typeof W.saveState === 'function') W.saveState(); else if (typeof saveState === 'function') saveState(); } catch(e) {}
    try { S().__cityrailExternalSourceDirty = (reason || 'external-source') + ':' + Date.now(); } catch(e) {}
  }

  function isEditingName() {
    const active = D.activeElement;
    return !!(active && active.matches && active.matches('.cr-eps-input[data-eps-field="name"]'));
  }

  function affectedStationIdsForSource(source) {
    if (!source) return [];
    const ids = [];
    try {
      affectedStations(source).forEach(r => {
        const id = sid(r && r.station && r.station.id);
        if (id && ids.indexOf(id) < 0) ids.push(id);
      });
    } catch(e) {}
    return ids;
  }

  function commitDemandChange(reason, source, delay) {
    const ids = affectedStationIdsForSource(source);
    try {
      S().__cityrailODDirtyScope = {
        reason: reason || 'external-source',
        source: 'external-passenger-source',
        mode: 'affected-stations',
        stationIds: ids,
        at: Date.now()
      };
    } catch(e) {}
    saveAndRefresh(reason, { delay: delay == null ? 760 : delay, affectedStationIds: ids, source: 'external-passenger-source' });
  }

  function scheduleODRebuild(reason, delay, affectedStationIds, options) {
    options = options || {};
    if (W.CityRailPerfCoordinatorV253 && typeof W.CityRailPerfCoordinatorV253.requestODRebuild === 'function') {
      W.CityRailPerfCoordinatorV253.requestODRebuild({
        reason: reason || '',
        delay: Math.max(0, Number(delay) || 0),
        affectedStationIds: affectedStationIds || [],
        source: options.source || 'external-passenger-source',
        topology: !!options.topology
      });
      W.__cityrailExternalSourcesLastODRebuild = {
        reason: reason || '',
        mode: 'coordinated',
        affectedStations: (affectedStationIds || []).length,
        at: Date.now()
      };
      return;
    }
    clearTimeout(odRebuildTimer);
    odRebuildTimer = setTimeout(() => {
      odRebuildTimer = 0;
      const t0 = W.performance && W.performance.now ? W.performance.now() : Date.now();
      try {
        if (typeof W.buildODMatrix === 'function') W.buildODMatrix();
        else if (typeof buildODMatrix === 'function') buildODMatrix();
      } catch(e) {
        W.__cityrailExternalSourcesLastError = 'rebuild:' + ((e && e.message) || e);
      }
      const t1 = W.performance && W.performance.now ? W.performance.now() : Date.now();
      W.__cityrailExternalSourcesLastODRebuild = { reason:reason || '', mode:'full-deferred', affectedStations:(affectedStationIds || []).length, ms:Math.round((t1 - t0) * 10) / 10, at:Date.now() };
      if (selectedId && Date.now() > rangePreviewUntil && !isEditingName()) renderPanel(selectedId);
    }, Math.max(0, Number(delay) || 0));
  }

  function rhythmValue(type, hour) {
    const h = ((Math.floor(num(hour)) % 24) + 24) % 24;
    const key = (TYPE_DEFS[type] || TYPE_DEFS.airport).rhythm;
    const g = (mid, width, amp) => amp * Math.exp(-Math.pow(h - mid, 2) / (2 * width * width));
    if (key === 'airport') return clamp(.18 + g(7,1.4,1.45) + g(13,2.2,.65) + g(20,2.4,1.35), .08, 2.4);
    if (key === 'railway') return clamp(.16 + g(8,1.5,1.55) + g(12.5,2.0,.82) + g(18,1.7,1.48) + g(22,1.2,.62), .08, 2.5);
    if (key === 'port') return clamp(.10 + g(9,2.4,.72) + g(15,2.6,.88) + g(19,1.8,.55), .06, 1.8);
    if (key === 'bus') return clamp(.14 + g(7.5,1.4,1.20) + g(17.5,1.6,1.08) + g(21,1.4,.48), .07, 2.1);
    if (key === 'stadium') return clamp(.04 + g(18.5,1.0,.70) + g(21.2,.72,2.35), .02, 2.8);
    return 1;
  }

  function directionSplit(type, hour) {
    const h = ((num(hour) % 24) + 24) % 24;
    let intoCity = .52;
    if (type === 'airport') intoCity = h < 10 ? .43 : (h < 16 ? .55 : .66);
    else if (type === 'railway') intoCity = h < 11 ? .50 : (h < 17 ? .57 : .63);
    else if (type === 'port') intoCity = h < 12 ? .62 : (h < 18 ? .54 : .46);
    else if (type === 'bus') intoCity = h < 10 ? .46 : (h < 17 ? .52 : .61);
    else if (type === 'stadium') intoCity = h < 18 ? .38 : (h < 21 ? .30 : .78);
    return { intoCity: clamp(intoCity, .18, .82), outCity: clamp(1 - intoCity, .18, .82) };
  }

  function sourceDaily(source) {
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const amp = INTENSITY_DEFS[source.intensity] || INTENSITY_DEFS.medium;
    return def.baseDaily * amp.multiplier;
  }

  function hourlyVolume(source, hour) {
    const vals = Array.from({length:24}, (_, h) => rhythmValue(source.type, h));
    const sum = vals.reduce((a,b) => a + b, 0) || 1;
    return sourceDaily(source) * rhythmValue(source.type, hour) / sum;
  }

  function affectedStations(source) {
    const radius = clamp(num(source.radiusKm, 1), 0, 3);
    const effective = Math.max(radius, .08);
    const list = [];
    stations().forEach(st => {
      if (!st) return;
      const d = havKm(source.lat, source.lng, num(st.lat), num(st.lng));
      if (radius <= 0 && d > .08) return;
      if (radius > 0 && d > radius) return;
      const raw = Math.exp(-Math.pow(d / Math.max(.12, effective * .58), 1.72));
      const w = clamp(raw, .035, 1);
      list.push({ station:st, distanceKm:d, weight:w });
    });
    const total = list.reduce((a, r) => a + r.weight, 0) || 1;
    list.forEach(r => { r.share = r.weight / total; });
    list.sort((a, b) => a.distanceKm - b.distanceKm);
    return list;
  }

  function stationZone(st) {
    try {
      if (typeof W.getStationZoneType === 'function') return W.getStationZoneType(st);
      if (typeof getStationZoneType === 'function') return getStationZoneType(st);
    } catch(e) {}
    return sid(st && (st.zoneType || (Array.isArray(st.zoneTypes) && st.zoneTypes[0]))) || 'residential';
  }

  function destinationWeights(source, stationList) {
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const accessIds = new Set(stationList.map(r => sid(r.station && r.station.id)));
    const rows = [];
    stations().forEach(st => {
      if (!st || accessIds.has(sid(st.id))) return;
      const zone = stationZone(st);
      const zoneW = num(def.zones[zone], .38);
      const pop = Math.sqrt(Math.max(1, num(st.population, 1)));
      const bias = clamp(num(st.flowBias, 1), .55, 2.2);
      const d = havKm(source.lat, source.lng, num(st.lat), num(st.lng));
      const distW = d < 2 ? .18 : clamp(Math.log1p(d) / 3.2, .35, 1.35);
      const score = zoneW * pop * Math.pow(bias, .42) * distW;
      if (score > 0) rows.push({ station:st, score, zone });
    });
    rows.sort((a, b) => b.score - a.score);
    const top = rows.slice(0, Math.min(36, rows.length));
    const sum = top.reduce((a, r) => a + r.score, 0) || 1;
    top.forEach(r => { r.share = r.score / sum; });
    return top;
  }

  function liveSourceSnapshot(source) {
    const hour = num(S().simulationHour, 12);
    const access = affectedStations(source);
    const destinations = destinationWeights(source, access);
    const split = directionSplit(source.type, hour);
    const hourly = hourlyVolume(source, hour);
    return {
      hour,
      access,
      destinations,
      split,
      hourly,
      daily: sourceDaily(source),
      topOD: destinations.slice(0, 5).map(d => ({
        name: sid(d.station && (d.station.name || d.station.id)),
        stationId: sid(d.station && d.station.id),
        share: d.share,
        zone: d.zone,
        hourly: hourly * d.share
      }))
    };
  }

  function applyExternalDemand(result) {
    const st = S();
    const sources = ensureState();
    const matrix = result && result.matrix;
    const odStations = result && Array.isArray(result.stations) ? result.stations : stations();
    if (!Array.isArray(matrix) || !odStations.length || !sources.length) return result;
    const idxById = Object.create(null);
    odStations.forEach((s, i) => { if (s) idxById[sid(s.id)] = i; });
    stations().forEach(s => {
      if (!s) return;
      s.__cityrailExternalSourceBoost = 1;
      s.__cityrailExternalSourceNames = [];
    });
    const hour = num(st.simulationHour, 12);
    const summaries = [];
    sources.forEach(source => {
      const access = affectedStations(source).filter(r => idxById[sid(r.station.id)] != null);
      if (!access.length) {
        summaries.push({ id:source.id, active:false, affected:0, hourly:0, daily:sourceDaily(source) });
        return;
      }
      const destinations = destinationWeights(source, access).filter(r => idxById[sid(r.station.id)] != null);
      if (!destinations.length) return;
      const split = directionSplit(source.type, hour);
      const hourN = hourlyVolume(source, hour);
      const daily = sourceDaily(source);
      const matrixVolume = daily / 42;
      access.forEach(a => {
        const boost = 1 + clamp((daily / 90000) * a.share * 1.18, .02, 1.85);
        a.station.__cityrailExternalSourceBoost = Math.max(num(a.station.__cityrailExternalSourceBoost, 1), boost);
        a.station.__cityrailExternalSourceNames = Array.from(new Set([...(a.station.__cityrailExternalSourceNames || []), source.name]));
      });
      access.forEach(a => {
        const ai = idxById[sid(a.station.id)];
        destinations.forEach(d => {
          const di = idxById[sid(d.station.id)];
          if (ai == null || di == null || ai === di) return;
          const base = matrixVolume * a.share * d.share;
          matrix[ai][di] = Math.max(0, num(matrix[ai][di]) + base * split.intoCity);
          matrix[di][ai] = Math.max(0, num(matrix[di][ai]) + base * split.outCity);
        });
      });
      summaries.push({
        id:source.id,
        active:true,
        affected:access.length,
        hourly:hourN,
        inbound:hourN * split.intoCity,
        outbound:hourN * split.outCity,
        daily
      });
    });
    st.externalPassengerSourceStats = summaries;
    return result;
  }

  function installODPatch() {
    const original = W.buildZoneODMatrix || (typeof buildZoneODMatrix === 'function' ? buildZoneODMatrix : null);
    if (!original || original.__cityrailExternalSourcesV1) return false;
    const wrapped = function(){
      const result = original.apply(this, arguments);
      try { return applyExternalDemand(result) || result; } catch(e) {
        W.__cityrailExternalSourcesLastError = 'od:' + ((e && e.message) || e);
        return result;
      }
    };
    wrapped.__cityrailExternalSourcesV1 = true;
    wrapped.__cityrailExternalSourcesOriginal = original;
    try { W.buildZoneODMatrix = wrapped; } catch(e) {}
    try { buildZoneODMatrix = wrapped; } catch(e) {}
    return true;
  }

  function ensureStyle() {
    if (D.getElementById('cityrail-external-sources-style')) return;
    const style = D.createElement('style');
    style.id = 'cityrail-external-sources-style';
    style.textContent = `
      .new-build-choice.cr-eps-build-choice{grid-template-columns:repeat(4,minmax(132px,1fr));width:min(880px,calc(100vw - 112px));min-width:0;overflow:visible;}
      #new-build-external-source .new-build-icon{background:rgba(10,132,255,.18);color:#8cc8ff;}
      .cr-eps-marker{width:var(--eps-size,34px);height:var(--eps-size,34px);border-radius:var(--eps-radius,13px);display:flex;align-items:center;justify-content:center;background:rgba(28,28,30,.86);border:1px solid rgba(255,255,255,.24);box-shadow:0 10px 28px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;font:850 var(--eps-font,13px)/1 -apple-system,BlinkMacSystemFont,"SF Pro Text","Microsoft YaHei",sans-serif;letter-spacing:0;}
      .cr-eps-marker span{width:var(--eps-inner,24px);height:var(--eps-inner,24px);border-radius:calc(var(--eps-inner,24px) * .38);display:flex;align-items:center;justify-content:center;color:#fff;}
      .cr-eps-marker.on{transform:scale(1.08);box-shadow:0 0 0 4px rgba(10,132,255,.18),0 14px 34px rgba(0,0,0,.36);}
      .cr-eps-panel{position:fixed;right:16px;top:86px;z-index:2147481500;width:390px;max-width:calc(100vw - 32px);max-height:calc(100vh - 112px);display:flex;flex-direction:column;border-radius:22px;background:rgba(28,28,30,.88);border:1px solid rgba(255,255,255,.14);box-shadow:0 26px 80px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.10);backdrop-filter:blur(30px) saturate(1.35);-webkit-backdrop-filter:blur(30px) saturate(1.35);color:#f5f5f7;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Microsoft YaHei",sans-serif;letter-spacing:0;}
      .cr-eps-panel.hidden{display:none;}
      .cr-eps-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.10);}
      .cr-eps-kicker{font-size:11px;font-weight:780;color:rgba(255,255,255,.48);margin-bottom:5px;}
      .cr-eps-title{font-size:19px;font-weight:850;color:#fff;line-height:1.2;}
      .cr-eps-close{width:30px;height:30px;border:0;border-radius:10px;background:rgba(255,255,255,.09);color:rgba(255,255,255,.75);font-size:18px;cursor:pointer;}
      .cr-eps-body{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px;}
      .cr-eps-field{display:flex;flex-direction:column;gap:7px;}
      .cr-eps-label{font-size:11px;font-weight:760;color:rgba(255,255,255,.52);}
      .cr-eps-input,.cr-eps-select{height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:#fff;padding:0 11px;font:650 13px/38px inherit;outline:0;}
      .cr-eps-input:focus,.cr-eps-select:focus{border-color:rgba(10,132,255,.72);box-shadow:0 0 0 4px rgba(10,132,255,.16);}
      .cr-eps-segment{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:6px;}
      .cr-eps-chip{height:34px;border-radius:11px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.07);color:rgba(255,255,255,.78);font-size:12px;font-weight:760;cursor:pointer;}
      .cr-eps-chip.active{background:#0A84FF;border-color:#0A84FF;color:#fff;box-shadow:0 8px 20px rgba(10,132,255,.24);}
      .cr-eps-range-row{display:grid;grid-template-columns:minmax(0,1fr)58px;align-items:center;gap:10px;}
      .cr-eps-range-row input{width:100%;accent-color:#0A84FF;}
      .cr-eps-value{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;font-weight:820;color:#fff;}
      .cr-eps-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
      .cr-eps-kpi{min-height:62px;border-radius:14px;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);}
      .cr-eps-kpi b{display:block;font-size:16px;line-height:1.1;margin-bottom:5px;color:#fff;font-variant-numeric:tabular-nums;}
      .cr-eps-kpi span{display:block;font-size:10px;color:rgba(255,255,255,.48);font-weight:650;}
      .cr-eps-bars{height:76px;display:grid;grid-template-columns:repeat(24,minmax(3px,1fr));gap:3px;align-items:end;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);}
      .cr-eps-bar{min-height:4px;border-radius:999px 999px 3px 3px;background:linear-gradient(180deg,#64D2FF,#0A84FF);}
      .cr-eps-bar.now{background:linear-gradient(180deg,#fff,#0A84FF);box-shadow:0 0 14px rgba(10,132,255,.55);}
      .cr-eps-list{display:flex;flex-direction:column;gap:6px;}
      .cr-eps-row{display:grid;grid-template-columns:minmax(0,1fr)72px;gap:8px;align-items:center;min-height:34px;padding:8px 9px;border-radius:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);}
      .cr-eps-row-name{font-size:12px;font-weight:720;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.9);}
      .cr-eps-row-sub{font-size:10px;color:rgba(255,255,255,.45);margin-top:2px;}
      .cr-eps-row-val{text-align:right;font-size:12px;font-weight:820;color:#fff;font-variant-numeric:tabular-nums;}
      .cr-eps-actions{display:flex;gap:8px;padding:12px 18px 16px;border-top:1px solid rgba(255,255,255,.10);}
      .cr-eps-actions button{height:36px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:#fff;font-size:13px;font-weight:780;cursor:pointer;flex:1;}
      .cr-eps-actions .danger{color:#ffb2ad;background:rgba(255,59,48,.12);border-color:rgba(255,59,48,.24);}
      .cr-eps-tip{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147481600;padding:10px 14px;border-radius:999px;background:rgba(28,28,30,.86);border:1px solid rgba(255,255,255,.14);color:#fff;font:760 13px/1 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;box-shadow:0 16px 44px rgba(0,0,0,.28);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}
      .cr-eps-tip.hidden{display:none;}
      html.cityrail-light-ui .cr-eps-marker{background:rgba(255,255,255,.88);border-color:rgba(0,0,0,.08);color:#1d1d1f;box-shadow:0 10px 28px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.78);}
      html.cityrail-light-ui .cr-eps-panel{background:rgba(255,255,255,.90);border-color:rgba(0,0,0,.09);color:#1d1d1f;box-shadow:0 26px 80px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.84);}
      html.cityrail-light-ui .cr-eps-title,html.cityrail-light-ui .cr-eps-value,html.cityrail-light-ui .cr-eps-kpi b,html.cityrail-light-ui .cr-eps-row-val{color:#1d1d1f;}
      html.cityrail-light-ui .cr-eps-kicker,html.cityrail-light-ui .cr-eps-label,html.cityrail-light-ui .cr-eps-kpi span,html.cityrail-light-ui .cr-eps-row-sub{color:rgba(29,29,31,.54);}
      html.cityrail-light-ui .cr-eps-input,html.cityrail-light-ui .cr-eps-select,html.cityrail-light-ui .cr-eps-chip,html.cityrail-light-ui .cr-eps-kpi,html.cityrail-light-ui .cr-eps-row{background:rgba(255,255,255,.72);border-color:rgba(0,0,0,.08);color:#1d1d1f;}
      html.cityrail-light-ui .cr-eps-row-name{color:rgba(29,29,31,.88);}
      html.cityrail-light-ui .cr-eps-close,html.cityrail-light-ui .cr-eps-actions button{background:rgba(60,60,67,.08);border-color:rgba(0,0,0,.08);color:#1d1d1f;}
      html.cityrail-light-ui .cr-eps-tip{background:rgba(255,255,255,.90);border-color:rgba(0,0,0,.08);color:#1d1d1f;}
      @media(max-width:760px){.new-build-choice.cr-eps-build-choice{grid-template-columns:repeat(2,minmax(0,1fr));width:100%;min-width:0;}.cr-eps-panel{left:10px;right:10px;top:auto;bottom:12px;width:auto;max-height:72vh;}.cr-eps-kpis{grid-template-columns:1fr 1fr;}}
    `;
    D.head.appendChild(style);
  }

  function ensurePanel() {
    let panel = D.getElementById('cr-eps-panel');
    if (panel) return panel;
    panel = D.createElement('aside');
    panel.id = 'cr-eps-panel';
    panel.className = 'cr-eps-panel hidden';
    panel.innerHTML = '<div class="cr-eps-head"><div><div class="cr-eps-kicker">外部客源点</div><div class="cr-eps-title" id="cr-eps-panel-title">客源点</div></div><button class="cr-eps-close" data-eps-act="close" aria-label="关闭">×</button></div><div class="cr-eps-body" id="cr-eps-panel-body"></div><div class="cr-eps-actions"><button data-eps-act="move">重新放置</button><button class="danger" data-eps-act="delete">删除</button></div>';
    try {
      if (W.L && W.L.DomEvent) {
        W.L.DomEvent.disableClickPropagation(panel);
        W.L.DomEvent.disableScrollPropagation(panel);
      }
    } catch(e) {}
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('input', onPanelInput);
    panel.addEventListener('change', onPanelInput);
    panel.addEventListener('keydown', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('input,select,textarea')) ev.stopPropagation();
    });
    panel.addEventListener('keyup', ev => {
      if (ev.target && ev.target.closest && ev.target.closest('input,select,textarea')) ev.stopPropagation();
    });
    panel.addEventListener('focusout', onPanelFocusOut);
    D.body.appendChild(panel);
    return panel;
  }

  function ensureTip() {
    let tip = D.getElementById('cr-eps-tip');
    if (!tip) {
      tip = D.createElement('div');
      tip.id = 'cr-eps-tip';
      tip.className = 'cr-eps-tip hidden';
      D.body.appendChild(tip);
    }
    return tip;
  }

  function setTip(text) {
    const tip = ensureTip();
    if (!text) {
      tip.classList.add('hidden');
      tip.textContent = '';
    } else {
      tip.textContent = text;
      tip.classList.remove('hidden');
    }
  }

  function selectedSource() {
    return ensureState().find(s => sid(s.id) === sid(selectedId)) || null;
  }

  function renderPanel(id) {
    const source = ensureState().find(s => sid(s.id) === sid(id));
    const panel = ensurePanel();
    if (!source) {
      panel.classList.add('hidden');
      return;
    }
    selectedId = source.id;
    panel.classList.remove('hidden');
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const titleEl = D.getElementById('cr-eps-panel-title');
    const body = D.getElementById('cr-eps-panel-body');
    if (!titleEl || !body) return;
    titleEl.textContent = source.name || def.label;
    const live = liveSourceSnapshot(source);
    const hour = live.hour;
    const split = live.split;
    const hourly = live.hourly;
    const affected = live.access;
    const trend = Array.from({length:24}, (_, h) => rhythmValue(source.type, h));
    const maxTrend = Math.max(1, ...trend);
    const nowHour = Math.floor(hour) % 24;
    const bars = trend.map((v, h) => '<div class="cr-eps-bar ' + (h === nowHour ? 'now' : '') + '" title="' + h + ':00" style="height:' + Math.round(12 + v / maxTrend * 88) + '%"></div>').join('');
    const topOD = live.topOD;
    const access = affected.slice(0, 8);
    body.innerHTML =
      '<div class="cr-eps-field"><div class="cr-eps-label">名称</div><input class="cr-eps-input" data-eps-field="name" maxlength="24" value="' + esc(source.name) + '"></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">类型</div><div class="cr-eps-segment" style="--cols:5">' + TYPE_ORDER.map(type => '<button class="cr-eps-chip ' + (source.type === type ? 'active' : '') + '" data-eps-type="' + type + '">' + esc(TYPE_DEFS[type].label) + '</button>').join('') + '</div></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">客流幅度</div><div class="cr-eps-segment" style="--cols:4">' + INTENSITY_ORDER.map(key => '<button class="cr-eps-chip ' + (source.intensity === key ? 'active' : '') + '" data-eps-intensity="' + key + '">' + esc(INTENSITY_DEFS[key].label) + '</button>').join('') + '</div></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">覆盖范围</div><div class="cr-eps-range-row"><input type="range" min="0" max="3" step="0.1" data-eps-field="radiusKm" value="' + source.radiusKm + '"><div class="cr-eps-value">' + source.radiusKm.toFixed(1) + 'km</div></div></div>' +
      '<div class="cr-eps-kpis"><div class="cr-eps-kpi"><b>' + fmt(sourceDaily(source)) + '</b><span>算法日客流</span></div><div class="cr-eps-kpi"><b>' + fmt(hourly) + '</b><span>当前小时</span></div><div class="cr-eps-kpi"><b>' + fmt(hourly * split.intoCity) + ' / ' + fmt(hourly * split.outCity) + '</b><span>进城 / 出城</span></div></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">客流趋势</div><div class="cr-eps-bars">' + bars + '</div></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">主要 OD</div><div class="cr-eps-list">' + (topOD.length ? topOD.map(row => '<div class="cr-eps-row"><div><div class="cr-eps-row-name">' + esc(def.label) + ' → ' + esc(row.name) + '</div><div class="cr-eps-row-sub">按类型、功能区和距离生成</div></div><div class="cr-eps-row-val">' + Math.round(num(row.share) * 100) + '%</div></div>').join('') : '<div class="cr-eps-row"><div class="cr-eps-row-name">暂无可达目的地</div><div class="cr-eps-row-val">-</div></div>') + '</div></div>' +
      '<div class="cr-eps-field"><div class="cr-eps-label">覆盖车站</div><div class="cr-eps-list">' + (access.length ? access.map(row => '<div class="cr-eps-row"><div><div class="cr-eps-row-name">' + esc(row.station.name || row.station.id) + '</div><div class="cr-eps-row-sub">' + row.distanceKm.toFixed(2) + 'km · 距离越近增益越高</div></div><div class="cr-eps-row-val">+' + Math.round((num(row.station.__cityrailExternalSourceBoost, 1) - 1) * 100) + '%</div></div>').join('') : '<div class="cr-eps-row"><div class="cr-eps-row-name">范围内暂无车站</div><div class="cr-eps-row-val">未接入</div></div>') + '</div></div>';
  }

  function onPanelClick(ev) {
    const target = ev.target;
    const act = target && target.closest && target.closest('[data-eps-act]');
    if (act) {
      const action = act.dataset.epsAct;
      if (action === 'close') {
        selectedId = '';
        ensurePanel().classList.add('hidden');
        renderSources('close-panel');
      } else if (action === 'delete') {
        const source = selectedSource();
        if (!source) return;
        S().externalPassengerSources = ensureState().filter(s => sid(s.id) !== sid(source.id));
        selectedId = '';
        ensurePanel().classList.add('hidden');
        saveAndRefresh('delete-source');
      } else if (action === 'move') {
        const source = selectedSource();
        if (!source) return;
        movingId = source.id;
        placing = false;
        setTip('点击地图重新放置客源点');
      }
      return;
    }
    const typeBtn = target && target.closest && target.closest('[data-eps-type]');
    if (typeBtn) {
      const source = selectedSource();
      if (!source) return;
      source.type = typeBtn.dataset.epsType;
      source.updatedAt = Date.now();
      commitDemandChange('type-change', source, 260);
      return;
    }
    const intensityBtn = target && target.closest && target.closest('[data-eps-intensity]');
    if (intensityBtn) {
      const source = selectedSource();
      if (!source) return;
      source.intensity = intensityBtn.dataset.epsIntensity;
      source.updatedAt = Date.now();
      commitDemandChange('intensity-change', source, 260);
    }
  }

  function onPanelInput(ev) {
    const field = ev.target && ev.target.dataset && ev.target.dataset.epsField;
    if (!field) return;
    const source = selectedSource();
    if (!source) return;
    if (field === 'radiusKm') {
      source.radiusKm = clamp(num(ev.target.value, source.radiusKm), 0, 3);
      source.updatedAt = Date.now();
      rangePreviewUntil = Date.now() + 900;
      updateRadiusReadout(ev.target, source.radiusKm);
      scheduleRangePreview(source);
      clearTimeout(radiusCommitTimer);
      clearTimeout(renderTimer);
      if (ev.type === 'change') {
        rangePreviewUntil = 0;
        radiusCommitTimer = setTimeout(() => {
          rangePreviewUntil = 0;
          commitDemandChange('radius-change', source, 260);
        }, 120);
      } else {
        persistOnly('radius-preview');
        radiusCommitTimer = setTimeout(() => {
          rangePreviewUntil = 0;
          commitDemandChange('radius-idle', source, 760);
        }, 760);
      }
      return;
    }
    if (field === 'name') {
      const rawName = sid(ev.target.value);
      const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
      source.name = rawName;
      source.updatedAt = Date.now();
      const titleEl = D.getElementById('cr-eps-panel-title');
      if (titleEl) titleEl.textContent = rawName.trim() || def.label;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => persistOnly('name-input'), 260);
      if (ev.type === 'change') commitSourceName(source, ev.target);
      return;
    }
    source.updatedAt = Date.now();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => saveAndRefresh('field-change'), 260);
  }

  function commitSourceName(source, input) {
    if (!source) return;
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const name = sid(source.name).trim() || def.label;
    source.name = name;
    source.updatedAt = Date.now();
    if (input) input.value = name;
    const titleEl = D.getElementById('cr-eps-panel-title');
    if (titleEl) titleEl.textContent = name;
    clearTimeout(renderTimer);
    persistOnly('name-commit');
    renderSources('name-commit');
  }

  function onPanelFocusOut(ev) {
    const field = ev.target && ev.target.dataset && ev.target.dataset.epsField;
    if (field !== 'name') return;
    const source = selectedSource();
    if (!source) return;
    commitSourceName(source, ev.target);
  }

  function updateRadiusReadout(input, value) {
    const row = input && input.closest && input.closest('.cr-eps-range-row');
    const out = row && row.querySelector && row.querySelector('.cr-eps-value');
    if (out) out.textContent = clamp(num(value, 0), 0, 3).toFixed(1) + 'km';
  }

  function scheduleRangePreview(source) {
    if (!source) return;
    const sourceId = source.id;
    if (rangeRenderFrame) return;
    const raf = W.requestAnimationFrame || function(fn){ return setTimeout(fn, 16); };
    rangeRenderFrame = raf(() => {
      rangeRenderFrame = 0;
      const fresh = ensureState().find(s => sid(s.id) === sid(sourceId));
      if (fresh) renderRangeLayer(fresh);
    });
  }

  function renderRangeLayer(source) {
    if (!W.map || !W.L || !source) return;
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const old = rangeLayers[source.id];
    if (old && old.setLatLng) {
      old.setLatLng([source.lat, source.lng]);
      old.setRadius(Math.max(0, source.radiusKm * 1000));
      old.setStyle({ color:def.color, fillColor:def.color });
      return;
    }
    rangeLayers[source.id] = W.L.circle([source.lat, source.lng], {
      radius: Math.max(0, source.radiusKm * 1000),
      interactive: false,
      className: 'cr-eps-range',
      color: def.color,
      weight: 1.5,
      opacity: .55,
      fillColor: def.color,
      fillOpacity: .075,
      dashArray: '5 6'
    }).addTo(W.map);
  }

  function sourceModelPixelSize(source) {
    if (!W.map || !W.L || !source || !W.map.latLngToLayerPoint) return 34;
    const lat = num(source.lat);
    const lng = num(source.lng);
    const dLat = (SOURCE_MODEL_DIAMETER_M / 1000) / 110.574;
    try {
      const a = W.map.latLngToLayerPoint([lat, lng]);
      const b = W.map.latLngToLayerPoint([lat + dLat, lng]);
      const px = Math.abs(a.y - b.y);
      return Math.round(clamp(px, SOURCE_MODEL_MIN_PX, SOURCE_MODEL_MAX_PX));
    } catch(e) {
      return 34;
    }
  }

  function sourceIcon(source) {
    const def = TYPE_DEFS[source.type] || TYPE_DEFS.airport;
    const size = sourceModelPixelSize(source);
    const inner = Math.max(12, Math.round(size * .70));
    const font = Math.max(9, Math.round(size * .38));
    const radius = Math.max(7, Math.round(size * .38));
    const html = '<div class="cr-eps-marker ' + (source.id === selectedId ? 'on' : '') + '" style="--eps-size:' + size + 'px;--eps-inner:' + inner + 'px;--eps-font:' + font + 'px;--eps-radius:' + radius + 'px"><span style="background:' + def.color + '">' + esc(def.icon) + '</span></div>';
    return W.L.divIcon({ className:'', html, iconSize:[size, size], iconAnchor:[size / 2, size / 2] });
  }

  function renderSources(reason) {
    if (!W.map || !W.L) return;
    ensureStyle();
    const sources = ensureState();
    const keep = new Set(sources.map(s => s.id));
    Object.keys(sourceLayers).forEach(id => {
      if (!keep.has(id)) {
        try { W.map.removeLayer(sourceLayers[id]); } catch(e) {}
        delete sourceLayers[id];
      }
    });
    Object.keys(rangeLayers).forEach(id => {
      if (!keep.has(id) || id !== selectedId) {
        try { W.map.removeLayer(rangeLayers[id]); } catch(e) {}
        delete rangeLayers[id];
      }
    });
    sources.forEach(source => {
      if (sourceLayers[source.id]) {
        sourceLayers[source.id].setLatLng([source.lat, source.lng]);
        sourceLayers[source.id].setIcon(sourceIcon(source));
      } else {
        const marker = W.L.marker([source.lat, source.lng], {
          icon: sourceIcon(source),
          interactive:true,
          zIndexOffset:9200
        }).addTo(W.map);
        marker.on('click', ev => {
          try { W.L.DomEvent.stop(ev); } catch(e) {}
          selectedId = source.id;
          renderSources('select-source');
          renderPanel(source.id);
        });
        sourceLayers[source.id] = marker;
      }
      if (source.id === selectedId) renderRangeLayer(source);
    });
  }

  function scheduleScaleRender() {
    if (scaleRenderFrame) return;
    const raf = W.requestAnimationFrame || function(fn){ return setTimeout(fn, 16); };
    scaleRenderFrame = raf(() => {
      scaleRenderFrame = 0;
      renderSources('map-scale');
    });
  }

  function installMapScaleWatch() {
    if (!W.map || !W.map.on || W.map.__cityrailExternalSourceScaleWatch) return;
    W.map.__cityrailExternalSourceScaleWatch = true;
    try { W.map.on('zoomend viewreset resize', scheduleScaleRender); } catch(e) {}
  }

  function placeSource(latlng) {
    const sources = ensureState();
    if (movingId) {
      const source = sources.find(s => sid(s.id) === sid(movingId));
      if (source) {
        source.lat = latlng.lat;
        source.lng = latlng.lng;
        source.updatedAt = Date.now();
        selectedId = source.id;
      }
      movingId = '';
      setTip('');
      saveAndRefresh('move-source');
      return;
    }
    const type = 'airport';
    const source = cleanSource({
      id:'eps_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name:TYPE_DEFS[type].label,
      type,
      intensity:'medium',
      radiusKm:1,
      lat:latlng.lat,
      lng:latlng.lng,
      createdAt:Date.now(),
      updatedAt:Date.now()
    });
    sources.push(source);
    selectedId = source.id;
    placing = false;
    setTip('');
    setToolActive(false);
    saveAndRefresh('new-source');
  }

  function mapCaptureClick(ev) {
    if (!placing && !movingId) return;
    if (!W.map || !W.L) return;
    const target = ev.target;
    if (target && target.closest && target.closest('button,input,select,textarea,a,.cr-eps-panel,#topbar,.leaflet-control')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    const ll = W.map.mouseEventToLatLng(ev);
    placeSource(ll);
  }

  function setToolActive(on) {
    const btn = D.getElementById('new-build-external-source');
    if (btn) btn.classList.toggle('active', !!on);
    if (W.map && W.map.getContainer) W.map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  function closeBuildDialog() {
    const overlay = D.getElementById('new-line-dialog-overlay');
    if (overlay) overlay.classList.add('hidden');
    const choice = D.getElementById('new-build-choice');
    const form = D.getElementById('new-line-form');
    const back = D.getElementById('new-line-back');
    const start = D.getElementById('new-line-start');
    if (choice) choice.classList.remove('hidden');
    if (form) form.classList.add('hidden');
    if (back) back.classList.add('hidden');
    if (start) start.classList.add('hidden');
  }

  function beginPlacement() {
    placing = true;
    movingId = '';
    closeBuildDialog();
    setToolActive(true);
    setTip('点击地图放置外部客源点');
  }

  function togglePlacement() {
    placing = !placing;
    movingId = '';
    setToolActive(placing);
    setTip(placing ? '点击地图放置外部客源点' : '');
  }

  function ensureBuildMenuCard() {
    const oldTopbarButton = D.getElementById('btn-external-source');
    if (oldTopbarButton && oldTopbarButton.parentNode) oldTopbarButton.parentNode.removeChild(oldTopbarButton);
    const choice = D.getElementById('new-build-choice');
    if (!choice) return;
    choice.classList.add('cr-eps-build-choice');
    if (D.getElementById('new-build-external-source')) return;
    const btn = D.createElement('button');
    btn.type = 'button';
    btn.className = 'new-build-card';
    btn.id = 'new-build-external-source';
    btn.dataset.action = 'new-build-external-source';
    btn.innerHTML = '<span class="new-build-icon">客</span><strong>客源点</strong><small>放置机场、火车站、港口、汽车站或体育场馆</small>';
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      beginPlacement();
    });
    choice.appendChild(btn);
  }

  function installBuildMenuClickGuard() {
    if (D.__cityrailExternalSourcesBuildMenuGuard) return;
    D.__cityrailExternalSourcesBuildMenuGuard = true;
    D.addEventListener('click', ev => {
      const btn = ev.target && ev.target.closest && ev.target.closest('#new-build-external-source');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      beginPlacement();
    }, true);
  }

  function signature() {
    const st = S();
    return [
      ensureState().map(s => [s.id, s.type, s.intensity, Math.round(s.lat * 1e5), Math.round(s.lng * 1e5), s.radiusKm].join(':')).join('|'),
      stations().map(s => [s.id, Math.round(num(s.lat) * 1e5), Math.round(num(s.lng) * 1e5), stationZone(s), Math.round(num(s.population, 0)), Math.round(num(s.flowBias, 1) * 100)].join(':')).join('|'),
      Math.floor(num(st.simulationHour, 0) * 4)
    ].join('||');
  }

  function installLoadWatch() {
    if (W.__cityrailExternalSourcesWatchEvents) return;
    W.__cityrailExternalSourcesWatchEvents = true;
    const watch = reason => {
      ensureBuildMenuCard();
      installMapScaleWatch();
      const sources = ensureState();
      if (!sources.length) {
        if (sigLast !== 'empty' || Object.keys(sourceLayers).length || Object.keys(rangeLayers).length) {
          sigLast = 'empty';
          renderSources(reason || 'watch-empty');
          if (selectedId) renderPanel(selectedId);
        }
        return;
      }
      const sig = signature();
      if (sig !== sigLast) {
        sigLast = sig;
        renderSources(reason || 'watch');
        if (selectedId && Date.now() > rangePreviewUntil && !isEditingName()) renderPanel(selectedId);
      }
      if (sources.length || selectedId) {
        clearTimeout(W.__cityrailExternalSourcesWatchTimer);
        W.__cityrailExternalSourcesWatchTimer = setTimeout(() => watch('watch-delay'), 4200);
      }
    };
    [900, 2400, 5200].forEach(ms => setTimeout(() => watch('watch-boot'), ms));
    try { W.addEventListener('cityrail-save-loaded', () => setTimeout(() => watch('watch-save'), 80)); } catch(e) {}
    try { D.addEventListener('visibilitychange', () => { if(!D.hidden) watch('watch-visible'); }, { passive:true }); } catch(e) {}
    D.addEventListener('click', event => {
      if (event.target && event.target.closest && event.target.closest('[data-eps-create],.cr-eps-panel,#build-menu,#settings-panel')) setTimeout(() => watch('watch-click'), 120);
    }, true);
  }

  function boot() {
    ensureStyle();
    ensurePanel();
    ensureTip();
    ensureBuildMenuCard();
    installBuildMenuClickGuard();
    installODPatch();
    installMapScaleWatch();
    if (W.map && W.map.getContainer) W.map.getContainer().addEventListener('click', mapCaptureClick, true);
    renderSources('boot');
    installLoadWatch();
    if (ensureState().length) scheduleODRebuild('boot', 900);
  }

  W.CityRailExternalPassengerSourcesV1 = {
    version: VERSION,
    types: TYPE_DEFS,
    intensities: INTENSITY_DEFS,
    list: () => ensureState().slice(),
    create(lat, lng, options) {
      const source = cleanSource(Object.assign({ lat, lng }, options || {}));
      ensureState().push(source);
      selectedId = source.id;
      saveAndRefresh('api-create');
      return source;
    },
    render: renderSources,
    open: renderPanel,
    affectedStations,
    report() {
      return {
        version: VERSION,
        sources: ensureState().length,
        selectedId,
        odPatched: !!((W.buildZoneODMatrix || {}). __cityrailExternalSourcesV1),
        stats: S().externalPassengerSourceStats || []
      };
    }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once:true });
  else setTimeout(boot, 0);
})();
