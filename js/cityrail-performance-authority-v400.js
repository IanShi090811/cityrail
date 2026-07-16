/* CityRail v276: consolidated render/control performance authority.
   This module is loaded last and owns expensive rendering schedules. It does not
   change passenger demand formulas, OD weights, route choice, or dispatch logic. */
(function(){
  'use strict';
  const W = window;
  const D = document;
  const VERSION = 'v400-runtime-performance-authority-20260707';
  if (W.__cityrailRenderAuthorityV276) return;
  W.__cityrailRenderAuthorityV276 = true;
  W.__cityrailRenderAuthorityV275 = true;
  W.__cityrailPerformanceAuthorityV255 = true;

  const now = () => (W.performance && W.performance.now) ? W.performance.now() : Date.now();
  const sid = v => String(v == null ? '' : v);
  const state = () => W.state || {};
  const byId = id => D.getElementById(id);
  const visible = el => {
    if (!el || (el.classList && el.classList.contains('hidden'))) return false;
    const cs = W.getComputedStyle ? W.getComputedStyle(el) : null;
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    const r = el.getBoundingClientRect && el.getBoundingClientRect();
    return !r || (r.width > 1 && r.height > 1);
  };
  const idle = (fn, timeout) => {
    if (W.requestIdleCallback) return W.requestIdleCallback(fn, { timeout: timeout || 1000 });
    return W.setTimeout(fn, 0);
  };

  const report = {
    version: VERSION,
    retiredTimers: Object.create(null),
    calls: Object.create(null),
    skipped: Object.create(null),
    last: Object.create(null),
    maintenance: Object.create(null)
  };

  function count(name, bucket) {
    const target = bucket || report.calls;
    target[name] = (target[name] || 0) + 1;
  }

  function assignGlobal(name, fn) {
    W[name] = fn;
    try { Function('fn', 'try{' + name + '=fn}catch(e){}')(fn); } catch(e) {}
  }

  function readGlobal(name) {
    let fn = W[name] || globalThis[name];
    if (typeof fn === 'function') return fn;
    try { fn = Function('try{return ' + name + '}catch(e){return null}')(); } catch(e) { fn = null; }
    return typeof fn === 'function' ? fn : null;
  }

  function rootFunction(fn) {
    const seen = new Set();
    let cur = fn;
    while (cur && typeof cur.__original === 'function' && !seen.has(cur)) {
      seen.add(cur);
      cur = cur.__original;
    }
    return typeof cur === 'function' ? cur : fn;
  }

  const obsoleteTimers = [
    '__cityrailV99WaitingAudit','__cityrailV99ATSTimer','__cityrailV99CompactTimer',
    '__cityrailV100CompactTimer','__v101PerfTimer',
    '__cityrailV102PerfTimer','__cityrailV111AtsTimer',
    '__cityrailV112StationTimer','__cityrailV113MainTimer','__cityrailV113DemandTimer',
    '__cityrailV113CompressTimer','__cityrailV114CanvasTimer','__cityrailV114Scheduler','__cityrailV114CompressTimer',
    '__cityrailV138UiTimer','__cityrailV138FleetTimer','__cityrailV142Tick','__cityrailV168MaintainTimer','__cityrailV169TrainPositionTimer',
    '__cityrailV207StationDataTimer','__cityrailV211Timer',
    '__cityrailV217DepotGuideSyncTimer','__cityrailV227StationTimer','__cityrailV156UiTimer','__cityrailV160DailyTimer',
    '__cityrailV161GraphTimer','__cityrailV171AtsFlushTimer','__cityrailV172CleanTimer','__cityrailV179RhythmTimer',
	    '__cityrailV219MapChoiceTimer','__cityrailV135Observer','__cityrailV142Cleaner','__cityrailV156Observer',
	    '__cityrailV147CompressTimer','__cityrailV147IconTimer',
	    '__cityrailV149DepthTimer','__CITYRAIL_V98_PERF_TIMER__','__cityrailV253CanvasAuthorityTimer',
	    '__cityrailV255TrainCleanupTimer',
	    '__cityrailV163MaintainTimer','__cityrailV164MaintainTimer','__cityrailV165IdleTimer','__cityrailV165PatchTimer',
		    '__cityrailV166MaintainTimer','__cityrailV167DwellTimer','__cityrailV168FastTimer','__cityrailV80SegmentMax2Timer'
	  ];

  function retireTimerKey(key) {
    const item = W[key];
    if (!item) return false;
    try { W.clearInterval(item); W.clearTimeout(item); } catch(e) {}
    try { if (item && typeof item.disconnect === 'function') item.disconnect(); } catch(e) {}
    W[key] = null;
    report.retiredTimers[key] = (report.retiredTimers[key] || 0) + 1;
    return true;
  }

  function sweepTimers() {
    obsoleteTimers.forEach(retireTimerKey);
    if (W.CityRailBackgroundTaskGovernorV245 && typeof W.CityRailBackgroundTaskGovernorV245.sweep === 'function') {
      try { W.CityRailBackgroundTaskGovernorV245.sweep('v255-authority'); } catch(e) {}
    }
  }

  const maintenance = { timer: 0 };

  function runRuntimeMaintenance(reason) {
    const st = state();
    report.maintenance.runs = (report.maintenance.runs || 0) + 1;
    report.maintenance.lastReason = reason || '';
    report.maintenance.lastAt = Date.now();
    sweepTimers();
    const batches = Array.isArray(st.batches) ? st.batches.length : 0;
    const run = () => {
      try {
        if (batches > 12000 && W.CityRailNoLossPassengerPerfV159 && typeof W.CityRailNoLossPassengerPerfV159.compact === 'function') {
          W.CityRailNoLossPassengerPerfV159.compact();
          report.maintenance.compactions = (report.maintenance.compactions || 0) + 1;
        }
      } catch(e) {}
      try {
        if (batches > 24000 && typeof W.compactWaitingBatchesV9 === 'function') {
          W.compactWaitingBatchesV9();
          report.maintenance.waitingCompactions = (report.maintenance.waitingCompactions || 0) + 1;
        }
      } catch(e) {}
    };
    if (batches > 12000) idle(run, 1800);
  }

  function scheduleRuntimeMaintenance(delay, reason) {
    if (maintenance.timer) W.clearTimeout(maintenance.timer);
    maintenance.timer = W.setTimeout(() => {
      maintenance.timer = 0;
      runRuntimeMaintenance(reason || 'scheduled');
      const st = state();
      const next = D.hidden ? 30000 : (st.isSimulating === true ? 12000 : 24000);
      scheduleRuntimeMaintenance(next, 'loop');
    }, Math.max(1000, Number(delay) || 12000));
  }

  function installStyle() {
    if (byId('cityrail-v255-performance-authority-style')) return;
    const st = D.createElement('style');
    st.id = 'cityrail-v255-performance-authority-style';
    st.textContent = `
      html.cityrail-v255-map-active .leaflet-tooltip-pane,
      html.cityrail-v255-map-active .station-label,
      html.cityrail-v255-map-active .leaflet-tooltip.station-name-tooltip,
      html.cityrail-v255-map-active .transfer-corridor-label,
      html.cityrail-v255-map-active .cityrail-v102-transfer-pane,
      html.cityrail-v255-map-active .transfer-corridor-v100,
      html.cityrail-v255-map-active .transfer-corridor-v101,
      html.cityrail-v255-map-active .cr-eps-range,
      html.cityrail-v255-map-active .line-node-marker:not(.selected){display:none!important;}
      html.cityrail-v255-lod-coarse .leaflet-tooltip-pane,
      html.cityrail-v255-lod-coarse .station-label,
      html.cityrail-v255-lod-coarse .leaflet-tooltip.station-name-tooltip,
      html.cityrail-v255-lod-coarse .line-node-marker:not(.selected){display:none!important;}
      #cityrail-train-canvas-v114{position:absolute;left:0;top:0;width:100%;height:100%;z-index:690;pointer-events:none;contain:layout paint size;}
      #cityrail-train-canvas-v31,#cityrail-train-canvas-v50{display:none!important;}
      html.cityrail-v255-map-active #cityrail-train-canvas-v114,
      html.cityrail-v255-lod-coarse #cityrail-train-canvas-v114,
      #map.low-zoom #cityrail-train-canvas-v114{display:none!important;}
      .cityrail-v102-transfer-pane,.transfer-corridor-v100,.transfer-corridor-v101,.transfer-corridor-label,.transfer-corridor-platform-dot{pointer-events:none!important;}
    `;
    D.head.appendChild(st);
  }

  const mapState = {
    bound: false,
    active: false,
    until: 0,
    timer: 0,
    lodFrame: 0,
    lastLod: ''
  };

  function networkWeight() {
    const st = state();
    const stations = Array.isArray(st.stations) ? st.stations.length : 0;
    const lines = Array.isArray(st.lines) ? st.lines.length : 0;
    const trains = Array.isArray(st.trains) ? st.trains.length : 0;
    return stations + lines * 9 + trains * 0.65;
  }

  function applyLOD(reason) {
    mapState.lodFrame = 0;
    const m = W.map;
    const zoom = m && typeof m.getZoom === 'function' ? Number(m.getZoom()) || 0 : 13;
    const weight = networkWeight();
    const coarse = zoom < (weight > 680 ? 12.35 : weight > 360 ? 11.75 : 10.85);
    D.documentElement.classList.toggle('cityrail-v255-lod-coarse', coarse);
    mapState.lastLod = coarse ? 'coarse' : 'detail';
    try { state().__cityrailV255LOD = { level: mapState.lastLod, reason: reason || '', weight, zoom, at: Date.now() }; } catch(e) {}
  }

  function scheduleLOD(reason) {
    if (mapState.lodFrame) return;
    mapState.lodFrame = W.requestAnimationFrame ? W.requestAnimationFrame(() => applyLOD(reason)) : W.setTimeout(() => applyLOD(reason), 16);
  }

  function setMapActive(on, hold) {
    mapState.active = !!on;
    mapState.until = on ? now() + (hold || 360) : 0;
    D.documentElement.classList.toggle('cityrail-v255-map-active', !!on);
    if (mapState.timer) W.clearTimeout(mapState.timer);
    if (on) {
      mapState.timer = W.setTimeout(() => {
        if (now() >= mapState.until - 4) setMapActive(false);
      }, hold || 360);
    }
  }

  function mapActive() {
    return mapState.active || now() < mapState.until || !!(W.cityrailMapInteractionIsActive && W.cityrailMapInteractionIsActive());
  }

  function bindMap() {
    const m = W.map && W.map.on ? W.map : null;
    if (!m || mapState.bound) return false;
    mapState.bound = true;
    ['dragstart','movestart','zoomstart'].forEach(ev => { try { m.on(ev, () => { setMapActive(true, 720); scheduleLOD(ev); }); } catch(e) {} });
    ['drag','move','zoom'].forEach(ev => { try { m.on(ev, () => setMapActive(true, 620)); } catch(e) {} });
    ['dragend','moveend','zoomend','resize','viewreset'].forEach(ev => { try { m.on(ev, () => { setMapActive(false); scheduleLOD(ev); requestMapFlush(ev); }); } catch(e) {} });
    scheduleLOD('bind');
    return true;
  }

  const renderQueue = {
    control: { pending:false, force:false, last:0, min:1200, base:null },
    ats: { pending:false, force:false, last:0, min:1050, base:null, args:null },
    train: { pending:false, force:false, last:0, min:90, base:null, args:null },
    map: { pending:false, force:false, last:0, min:180, base:null, args:null }
  };

  const controlPulse = { timer: 0 };

  function scheduleControlPulse(delay) {
    if (controlPulse.timer) W.clearTimeout(controlPulse.timer);
    controlPulse.timer = W.setTimeout(() => {
      controlPulse.timer = 0;
      const overlay = byId('ctrl-center-overlay');
      if (!visible(overlay) || D.hidden) return;
      scheduleTask('control', { force:false });
      scheduleControlPulse(state().isSimulating === true ? 1800 : 4200);
    }, Math.max(240, Number(delay) || 1800));
  }

  function scheduleTask(name, opts) {
    const q = renderQueue[name];
    if (!q) return;
    opts = opts || {};
    q.force = !!(q.force || opts.force);
    if (opts.args) q.args = opts.args;
    if (q.pending) return;
    q.pending = true;
    const run = () => {
      q.pending = false;
      const t = now();
      if (!q.force && t - q.last < q.min) {
        W.setTimeout(() => scheduleTask(name, { force:false }), Math.max(24, q.min - (t - q.last)));
        return;
      }
      q.force = false;
      q.last = t;
      executeTask(name);
    };
    if (name === 'control' || name === 'ats') {
      W.requestAnimationFrame ? W.requestAnimationFrame(run) : W.setTimeout(run, 0);
    } else {
      W.requestAnimationFrame ? W.requestAnimationFrame(run) : W.setTimeout(run, 16);
    }
  }

  function executeTask(name) {
    try {
      if (name === 'control') {
        if (!visible(byId('ctrl-center-overlay'))) { count(name, report.skipped); return; }
        const base = renderQueue.control.base || (W.CityRailControlCenterRenderer && W.CityRailControlCenterRenderer.render);
        if (typeof base === 'function') base();
      } else if (name === 'ats') {
        const lineId = renderQueue.ats.args && renderQueue.ats.args[0] != null ? renderQueue.ats.args[0] : W.opsCurrentLineId;
        const dir = renderQueue.ats.args && renderQueue.ats.args[1] != null ? renderQueue.ats.args[1] : (W.opsCurrentDir || 0);
        if (lineId == null) { count(name, report.skipped); return; }
        const base = renderQueue.ats.base;
        if (typeof base === 'function') base(lineId, dir);
      } else if (name === 'train') {
        scheduleTrainCanvas(true);
      } else if (name === 'map') {
        if (mapActive()) { requestMapFlush('still-active'); return; }
        const base = renderQueue.map.base;
        if (typeof base === 'function') base.apply(W, renderQueue.map.args || []);
      }
      count(name);
      report.last[name] = Date.now();
    } catch(e) {
      report.last[name + 'Error'] = (e && e.message) || String(e);
    }
  }

  function installPanelAuthority() {
    const system = W.CityRailControlCenterSystem;
    if (system && typeof system.render === 'function' && system.render.__cityrailControlCenterSystem) {
      renderQueue.control.base = system.render;
      ['updateControlCenter','renderCtrlCenter','renderControlLineOps','renderLineStats'].forEach(name => assignGlobal(name, system.render));
      W.CityRailControlCenterRenderer = system;
      W.CityRailControlCenterV142 = system;
    } else {
      const currentControl = readGlobal('renderCtrlCenter');
      const renderer = W.CityRailControlCenterRenderer;
      const rendererBase = renderer && typeof renderer.render === 'function' && !renderer.render.__cityrailV276Authority ? rootFunction(renderer.render) : null;
      const globalBase = currentControl && !currentControl.__cityrailV276Authority ? rootFunction(currentControl) : null;
      const controlBase = typeof rendererBase === 'function'
        ? function(){ return rendererBase.call(renderer); }
        : globalBase;
      if (typeof controlBase === 'function') {
        renderQueue.control.base = controlBase;
      }
    }
    if (typeof renderQueue.control.base === 'function' && !(W.CityRailControlCenterSystem && W.CityRailControlCenterSystem.render === renderQueue.control.base)) {
      const control = function(force) {
        scheduleTask('control', { force: force === true });
      };
      control.__cityrailV276Authority = true;
      control.__cityrailV255Authority = true;
      ['updateControlCenter','renderCtrlCenter','renderControlLineOps','renderLineStats'].forEach(name => assignGlobal(name, control));
      W.CityRailControlCenterRenderer = { version: VERSION, render: control };
      W.CityRailControlCenterV142 = W.CityRailControlCenterRenderer;
    }

    const currentAts = readGlobal('renderLineOpsPanel');
    const atsBase = currentAts && !currentAts.__cityrailV276Authority ? rootFunction(currentAts) : null;
    if (typeof atsBase === 'function') {
      renderQueue.ats.base = atsBase;
    }
    if (typeof renderQueue.ats.base === 'function') {
      const ats = function(lineId, dir) {
        W.opsCurrentLineId = lineId != null ? lineId : W.opsCurrentLineId;
        W.opsCurrentDir = dir != null ? dir : (W.opsCurrentDir || 0);
        scheduleTask('ats', { force:false, args:[W.opsCurrentLineId, W.opsCurrentDir || 0] });
      };
      ats.__cityrailV276Authority = true;
      ats.__cityrailV255Authority = true;
      ['renderLineOpsPanel','refreshAtsPanel','updateAtsPanel'].forEach(name => assignGlobal(name, ats));
    }
  }

  function cleanupDomTrainMarkers() {
    let removed = 0;
    if (W.trainMarkers) {
      Object.keys(W.trainMarkers).forEach(id => {
        try { if (W.trainMarkers[id] && W.map && W.map.removeLayer) W.map.removeLayer(W.trainMarkers[id]); } catch(e) {}
        delete W.trainMarkers[id];
        removed++;
      });
    }
    ['cityrail-train-canvas-v31','cityrail-train-canvas-v50'].forEach(id => {
      const el = byId(id);
      if (el) {
        try { el.remove(); } catch(e) {}
      }
    });
    return removed;
  }

  const trainCanvas = {
    canvas: null,
    ctx: null,
    raf: 0,
    lastDraw: 0,
    width: 0,
    height: 0,
    dpr: 1,
    models: [],
    headings: Object.create(null)
  };

  const modelCache = {
    lineSig: '',
    stationSig: '',
    lineMap: new Map(),
    stationMap: new Map(),
    nodes: new Map()
  };

  function hashText(value) {
    const text = sid(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function lineSignature(lines) {
    let hash = 2166136261;
    const arr = Array.isArray(lines) ? lines : [];
    for (let i = 0; i < arr.length; i++) {
      const line = arr[i] || {};
      const ids = Array.isArray(line.stationIds) ? line.stationIds : [];
      const wps = Array.isArray(line.waypoints) ? line.waypoints : [];
      hash ^= hashText(line.id); hash = Math.imul(hash, 16777619);
      hash ^= Math.round(Number(line._geometryVersion || 0)); hash = Math.imul(hash, 16777619);
      hash ^= Math.round(Number(line._topologyVersion || 0)); hash = Math.imul(hash, 16777619);
      hash ^= hashText(line._runtimeRouteId || ''); hash = Math.imul(hash, 16777619);
      hash ^= ids.length; hash = Math.imul(hash, 16777619);
      if (ids.length) {
        hash ^= hashText(ids[0]); hash = Math.imul(hash, 16777619);
        hash ^= hashText(ids[ids.length - 1]); hash = Math.imul(hash, 16777619);
      }
      hash ^= wps.length; hash = Math.imul(hash, 16777619);
      for (let j = 0; j < wps.length; j++) {
        const wp = wps[j] || {};
        hash ^= Math.round(Number(wp.lat || 0) * 1e5); hash = Math.imul(hash, 16777619);
        hash ^= Math.round(Number(wp.lng || 0) * 1e5); hash = Math.imul(hash, 16777619);
        hash ^= Math.round(Number(wp.segIdx || 0)); hash = Math.imul(hash, 16777619);
        hash ^= Math.round(Number(wp.order || 0)); hash = Math.imul(hash, 16777619);
      }
    }
    return [arr.length, hash >>> 0].join(':');
  }

  function stationSignature(stations) {
    let hash = 2166136261;
    const arr = Array.isArray(stations) ? stations : [];
    for (let i = 0; i < arr.length; i++) {
      const st = arr[i] || {};
      hash ^= hashText(st.id); hash = Math.imul(hash, 16777619);
      hash ^= Math.round(Number(st.lat || 0) * 1e5); hash = Math.imul(hash, 16777619);
      hash ^= Math.round(Number(st.lng || 0) * 1e5); hash = Math.imul(hash, 16777619);
    }
    return [arr.length, hash >>> 0].join(':');
  }

  function ensureModelIndexes(st) {
    const lines = Array.isArray(st.lines) ? st.lines : [];
    const stations = Array.isArray(st.stations) ? st.stations : [];
    const lSig = lineSignature(lines);
    if (modelCache.lineSig !== lSig) {
      modelCache.lineSig = lSig;
      modelCache.lineMap = new Map();
      modelCache.nodes = new Map();
      lines.forEach(line => {
        if (line && line.id != null) modelCache.lineMap.set(sid(line.id), line);
      });
    }
    const sSig = stationSignature(stations);
    if (modelCache.stationSig !== sSig) {
      modelCache.stationSig = sSig;
      modelCache.stationMap = new Map();
      stations.forEach(station => {
        if (station && station.id != null) modelCache.stationMap.set(sid(station.id), station);
      });
    }
    return modelCache;
  }

  function lineById(id) {
    const key = sid(id);
    return (state().lines || []).find(line => sid(line && line.id) === key) || null;
  }

  function stationById(id) {
    const key = sid(id);
    return (state().stations || []).find(st => sid(st && st.id) === key) || null;
  }

  function stationPos(station, line) {
    if (!station) return null;
    try {
      if (line && typeof W.getStationPosition === 'function') {
        const pos = W.getStationPosition(station, line.id);
        if (pos && Number.isFinite(Number(pos.lat)) && Number.isFinite(Number(pos.lng))) return { lat:Number(pos.lat), lng:Number(pos.lng) };
      }
    } catch(e) {}
    return Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lng)) ? { lat:Number(station.lat), lng:Number(station.lng) } : null;
  }

  function lineNodes(line) {
    if (!line) return [];
    const attachStationIndex = nodes => {
      if (!Array.isArray(nodes)) return [];
      if (nodes._stationNodeIndexes) return nodes;
      const index = Object.create(null);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || node.type !== 'station' || node.id == null) continue;
        const key = sid(node.id);
        if (!index[key]) index[key] = [];
        index[key].push(i);
      }
      try {
        Object.defineProperty(nodes, '_stationNodeIndexes', {
          value:index,
          configurable:true
        });
      } catch(e) {
        nodes._stationNodeIndexes = index;
      }
      return nodes;
    };
    try {
      if (typeof W.getLineTrainNodes === 'function') {
        const nodes = W.getLineTrainNodes(line);
        if (Array.isArray(nodes) && nodes.length) return attachStationIndex(nodes);
      }
    } catch(e) {}
    const nodes = [];
    const ids = Array.isArray(line.stationIds) ? line.stationIds : [];
    ids.forEach((id, index) => {
      const st = stationById(id);
      const pos = stationPos(st, line);
      if (pos) nodes.push({ id, type:'station', lat:pos.lat, lng:pos.lng, stationIndex:index });
      (line.waypoints || [])
        .filter(wp => Number(wp && wp.segIdx) === index)
        .sort((a,b) => Number(a.order || 0) - Number(b.order || 0))
        .forEach(wp => {
          if (Number.isFinite(Number(wp.lat)) && Number.isFinite(Number(wp.lng))) nodes.push({ type:'waypoint', lat:Number(wp.lat), lng:Number(wp.lng) });
        });
    });
    return attachStationIndex(nodes);
  }

  function trainLatLng(train, line, nodes) {
    if (!train || !line || !Array.isArray(nodes) || !nodes.length) return null;
    if (train.state === 'dwelling' || train.state === 'turning_back') {
      const st = stationById((line.stationIds || [])[Number(train.nextStationIdx)]);
      const pos = stationPos(st, line);
      if (pos) return pos;
    }
    const idx = Math.max(0, Math.min(nodes.length - 2, Math.floor(Number(train.segIndex) || 0)));
    const a = nodes[idx], b = nodes[idx + 1];
    if (!a || !b) return null;
    const p = Math.max(0, Math.min(1, Number(train.segProgress) || 0));
    return { lat:Number(a.lat) + (Number(b.lat) - Number(a.lat)) * p, lng:Number(a.lng) + (Number(b.lng) - Number(a.lng)) * p };
  }

  function targetLatLng(train, line, nodes, fallback) {
    if (!train || !line || !Array.isArray(nodes)) return fallback;
    const targetId = (line.stationIds || [])[Number(train.nextStationIdx)];
    if (targetId != null) {
      if (Number(train.direction) === 0) {
        for (let i = Math.max(0, Number(train.segIndex) || 0); i < nodes.length; i++) {
          if (nodes[i] && nodes[i].type === 'station' && sid(nodes[i].id) === sid(targetId)) return nodes[i];
        }
      } else {
        for (let i = Math.min(nodes.length - 1, (Number(train.segIndex) || 0) + 1); i >= 0; i--) {
          if (nodes[i] && nodes[i].type === 'station' && sid(nodes[i].id) === sid(targetId)) return nodes[i];
        }
      }
    }
    const idx = Math.max(0, Math.min(nodes.length - 2, Math.floor(Number(train.segIndex) || 0)));
    return Number(train.direction) === 0 ? (nodes[idx + 1] || fallback) : (nodes[idx] || fallback);
  }

  function ensureTrainCanvas() {
    const m = W.map;
    if (!m || !m.getContainer || !D.body) return false;
    let canvas = byId('cityrail-train-canvas-v114');
    if (!canvas) {
      canvas = D.createElement('canvas');
      canvas.id = 'cityrail-train-canvas-v114';
      canvas.className = 'cityrail-train-canvas-v114';
      m.getContainer().appendChild(canvas);
    }
    if (trainCanvas.canvas !== canvas) {
      trainCanvas.canvas = canvas;
      trainCanvas.ctx = canvas.getContext('2d', { alpha:true, desynchronized:true });
      try { m.off && m.off('click', onTrainCanvasClick); m.on && m.on('click', onTrainCanvasClick); } catch(e) {}
    }
    const size = m.getSize ? m.getSize() : { x:m.getContainer().clientWidth || 1, y:m.getContainer().clientHeight || 1 };
    const dpr = networkWeight() > 760 ? 1 : Math.max(1, Math.min(1.5, Number(W.devicePixelRatio) || 1));
    if (trainCanvas.width !== size.x || trainCanvas.height !== size.y || trainCanvas.dpr !== dpr) {
      trainCanvas.width = size.x;
      trainCanvas.height = size.y;
      trainCanvas.dpr = dpr;
      canvas.width = Math.max(1, Math.round(size.x * dpr));
      canvas.height = Math.max(1, Math.round(size.y * dpr));
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      if (trainCanvas.ctx) trainCanvas.ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    return !!trainCanvas.ctx;
  }

  function shouldDrawTrains() {
    const st = state();
    if (st.showTrains === false) return false;
    const m = W.map;
    const zoom = m && m.getZoom ? Number(m.getZoom()) || 0 : 13;
    const low = Number(W.LABEL_ZOOM_THRESHOLD || 12);
    const high = Number(W.HIGH_ZOOM_THRESHOLD || 17);
    return zoom >= low && zoom < high && !mapActive();
  }

  function canvasPointHeading(a, b) {
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.05) return null;
    return ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
  }

  function collectTrainModels() {
    const st = state();
    const m = W.map;
    const L = W.L;
    if (!m || !L || !Array.isArray(st.trains)) return [];
    const indexes = ensureModelIndexes(st);
    const cachedLine = lineId => indexes.lineMap.get(sid(lineId)) || null;
    const cachedStation = stationId => indexes.stationMap.get(sid(stationId)) || null;
    const cachedStationPos = (station, line) => {
      if (!station) return null;
      try {
        if (line && typeof W.getStationPosition === 'function') {
          const pos = W.getStationPosition(station, line.id);
          if (pos && Number.isFinite(Number(pos.lat)) && Number.isFinite(Number(pos.lng))) return { lat:Number(pos.lat), lng:Number(pos.lng) };
        }
      } catch(e) {}
      return Number.isFinite(Number(station.lat)) && Number.isFinite(Number(station.lng)) ? { lat:Number(station.lat), lng:Number(station.lng) } : null;
    };
    const cachedNodes = line => {
      if (!line || line.id == null) return [];
      const key = sid(line.id) + '|' + (line._geometryVersion || 0) + '|' + (line._topologyVersion || 0) + '|' + (line._runtimeRouteId || '');
      if (indexes.nodes.has(key)) return indexes.nodes.get(key);
      const nodes = lineNodes(line);
      indexes.nodes.set(key, nodes);
      return nodes;
    };
    const cachedTrainLatLng = (train, line, nodes) => {
      if (!train || !line || !Array.isArray(nodes) || !nodes.length) return null;
      if (train.state === 'dwelling' || train.state === 'turning_back') {
        const stn = cachedStation((line.stationIds || [])[Number(train.nextStationIdx)]);
        const pos = cachedStationPos(stn, line);
        if (pos) return pos;
      }
      const idx = Math.max(0, Math.min(nodes.length - 2, Math.floor(Number(train.segIndex) || 0)));
      const a = nodes[idx], b = nodes[idx + 1];
      if (!a || !b) return null;
      const p = Math.max(0, Math.min(1, Number(train.segProgress) || 0));
      return { lat:Number(a.lat) + (Number(b.lat) - Number(a.lat)) * p, lng:Number(a.lng) + (Number(b.lng) - Number(a.lng)) * p };
    };
	    const cachedTargetLatLng = (train, line, nodes, fallback) => {
	      if (!train || !line || !Array.isArray(nodes)) return fallback;
	      const targetId = (line.stationIds || [])[Number(train.nextStationIdx)];
	      if (targetId != null) {
	        const indexed = nodes._stationNodeIndexes && nodes._stationNodeIndexes[sid(targetId)];
	        const seg = Math.max(0, Number(train.segIndex) || 0);
	        if (indexed && indexed.length) {
	          if (Number(train.direction) === 0) {
	            for (let i = 0; i < indexed.length; i++) {
	              if (indexed[i] >= seg && nodes[indexed[i]]) return nodes[indexed[i]];
	            }
	          } else {
	            for (let i = indexed.length - 1; i >= 0; i--) {
	              if (indexed[i] <= seg + 1 && nodes[indexed[i]]) return nodes[indexed[i]];
	            }
	          }
	        }
	        if (Number(train.direction) === 0) {
	          for (let i = Math.max(0, Number(train.segIndex) || 0); i < nodes.length; i++) {
	            if (nodes[i] && nodes[i].type === 'station' && sid(nodes[i].id) === sid(targetId)) return nodes[i];
          }
        } else {
          for (let i = Math.min(nodes.length - 1, (Number(train.segIndex) || 0) + 1); i >= 0; i--) {
            if (nodes[i] && nodes[i].type === 'station' && sid(nodes[i].id) === sid(targetId)) return nodes[i];
          }
        }
      }
      const idx = Math.max(0, Math.min(nodes.length - 2, Math.floor(Number(train.segIndex) || 0)));
      return Number(train.direction) === 0 ? (nodes[idx + 1] || fallback) : (nodes[idx] || fallback);
    };
    let bounds = null;
    try { bounds = m.getBounds().pad(0.18); } catch(e) {}
    const models = [];
    for (const train of st.trains) {
      if (!train || train.state === 'waiting' || train.state === 'done') continue;
      const line = cachedLine(train.lineId);
      if (!line) continue;
      const nodes = cachedNodes(line);
      const ll = cachedTrainLatLng(train, line, nodes);
      if (!ll) continue;
      const latLng = L.latLng(ll.lat, ll.lng);
      if (bounds && !bounds.contains(latLng)) continue;
      const point = m.latLngToContainerPoint(latLng);
      const target = cachedTargetLatLng(train, line, nodes, ll);
      let heading = null;
      try { heading = canvasPointHeading(point, m.latLngToContainerPoint(L.latLng(target.lat, target.lng))); } catch(e) {}
      if (!Number.isFinite(Number(heading))) heading = trainCanvas.headings[sid(train.id)] ?? (Number(train.direction) === 0 ? 90 : 270);
      trainCanvas.headings[sid(train.id)] = heading;
      models.push({ id:sid(train.id), train, line, x:point.x, y:point.y, heading, color:line.color || '#30d158', overloaded:!!train.overloaded, express:train.serviceType === 'express' });
    }
    return models;
  }

  function drawTrain(ctx, model) {
    const size = model.express ? 8.2 : 7.2;
    ctx.save();
    ctx.translate(model.x, model.y);
    ctx.rotate((Number(model.heading) || 0) * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.78, size * 0.72);
    ctx.lineTo(0, size * 0.18);
    ctx.lineTo(-size * 0.78, size * 0.72);
    ctx.closePath();
    ctx.fillStyle = model.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.35;
    ctx.fill();
    ctx.stroke();
    if (model.overloaded) {
      ctx.beginPath();
      ctx.arc(0, 0, size + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function clearTrainCanvas() {
    if (!ensureTrainCanvas()) return;
    trainCanvas.ctx.clearRect(0, 0, trainCanvas.width, trainCanvas.height);
    trainCanvas.models = [];
  }

  function drawTrainCanvas(force) {
    trainCanvas.raf = 0;
    cleanupDomTrainMarkers();
    if (!ensureTrainCanvas()) return;
    if (!force && !shouldDrawTrains()) { clearTrainCanvas(); return; }
    const ctx = trainCanvas.ctx;
    ctx.clearRect(0, 0, trainCanvas.width, trainCanvas.height);
    const models = collectTrainModels();
    trainCanvas.models = models;
    models.forEach(model => drawTrain(ctx, model));
    report.last.trainCanvasModels = models.length;
    report.last.trainCanvasAt = Date.now();
  }

  function scheduleTrainCanvas(force) {
    renderQueue.train.force = !!(renderQueue.train.force || force);
    if (trainCanvas.raf) return;
    const weight = networkWeight();
    const min = force ? 0 : (mapActive() ? 520 : (weight > 1050 ? 220 : (weight > 720 ? 160 : 110)));
    const elapsed = now() - trainCanvas.lastDraw;
    const run = () => {
      trainCanvas.lastDraw = now();
      drawTrainCanvas(renderQueue.train.force);
      renderQueue.train.force = false;
    };
    if (elapsed < min && !force) {
      W.setTimeout(() => scheduleTrainCanvas(false), Math.max(24, min - elapsed));
      return;
    }
    trainCanvas.raf = W.requestAnimationFrame ? W.requestAnimationFrame(run) : W.setTimeout(run, 16);
  }

  function onTrainCanvasClick(event) {
    const point = event && (event.containerPoint || event.layerPoint);
    if (!point || !trainCanvas.models.length || !W.L || !W.map) return;
    let best = null, bestD = Infinity;
    trainCanvas.models.forEach(model => {
      const d = Math.hypot(model.x - point.x, model.y - point.y);
      if (d < 15 && d < bestD) { best = model; bestD = d; }
    });
    if (!best) return;
    const html = typeof W.buildTrainPopupHTML === 'function'
      ? W.buildTrainPopupHTML(best.train, best.line)
      : `<b>${best.line.name || best.line.id}</b><br>载客 ${Math.round(Number(best.train.load || best.train.passengers || 0))}`;
    try {
      W.L.popup({ className:'train-info-popup', closeButton:true })
        .setLatLng(W.map.containerPointToLatLng(W.L.point(best.x, best.y)))
        .setContent(html)
        .openOn(W.map);
    } catch(e) {}
  }

  function installTrainAuthority() {
    const train = function() {
      renderQueue.train.args = Array.prototype.slice.call(arguments);
      scheduleTrainCanvas(arguments[0] === true);
    };
    train.__cityrailV275Authority = true;
    train.__cityrailV255Authority = true;
    assignGlobal('renderAllTrainMarkers', train);
    if (W.__cityrailV255TrainCleanupTimer) W.clearInterval(W.__cityrailV255TrainCleanupTimer);
    if (W.__cityrailV114CanvasTimer) W.clearInterval(W.__cityrailV114CanvasTimer);
    W.__cityrailV114CanvasTimer = null;
    if (W.__cityrailV275TrainTimer) W.clearInterval(W.__cityrailV275TrainTimer);
    W.__cityrailV275TrainTimer = W.setInterval(() => {
      if (!D.hidden && state().isSimulating === true) scheduleTrainCanvas(false);
    }, 240);
    cleanupDomTrainMarkers();
    scheduleTrainCanvas(true);
  }

  function clearLayerValue(layer) {
    try { if (layer && W.map && W.map.removeLayer) W.map.removeLayer(layer); } catch(e) {}
    try { if (layer && typeof layer.clearLayers === 'function') layer.clearLayers(); } catch(e) {}
  }

  function removeTransferCorridorLayers() {
    [
      '__cityrailV102TransferLayer','__cityrailV101TransferLayer','__cityrailV100TransferLayer',
      '__transferCorridorLayer','transferCorridorLayer'
    ].forEach(k => {
      clearLayerValue(W[k]);
      W[k] = null;
    });
    D.querySelectorAll('.cityrail-v102-transfer-pane,.transfer-corridor-v100,.transfer-corridor-v101,.transfer-corridor-label,.transfer-corridor-platform-dot').forEach(el => {
      try { el.remove(); } catch(e) {}
    });
  }

  function installTransferCorridorAuthority() {
    const noop = function() {
      removeTransferCorridorLayers();
      try { state().showTransferCorridors = false; } catch(e) {}
      count('transferCorridorNoop');
      return null;
    };
    noop.__cityrailV255Noop = true;
    ['renderTransferCorridors','renderTransferCorridorsV100','renderTransferCorridorsV101','refreshTransferCorridors'].forEach(name => {
      assignGlobal(name, noop);
    });
    if (W.CityRailTransferCorridors) {
      W.CityRailTransferCorridors.refresh = noop;
      W.CityRailTransferCorridors.enable = noop;
      W.CityRailTransferCorridors.disable = noop;
    } else {
      W.CityRailTransferCorridors = { version: VERSION, refresh: noop, enable: noop, disable: noop };
    }
    removeTransferCorridorLayers();
  }

  function requestMapFlush(reason) {
    if (renderQueue.map.pending) return;
    renderQueue.map.pending = true;
    W.setTimeout(() => {
      renderQueue.map.pending = false;
      if (mapActive()) return requestMapFlush('active-' + (reason || ''));
      try { cleanupDomTrainMarkers(); } catch(e) {}
      try { scheduleTrainCanvas(true); } catch(e) {}
      scheduleLOD('flush-' + (reason || ''));
      report.last.mapFlush = Date.now();
    }, 140);
  }

  function installSaveLoadAuthority() {
    const api = W.CityRailSave;
    if (!api || api.__cityrailV255Authority) return false;
    ['applySnapshot','loadLocal','importFile'].forEach(name => {
      const base = api[name];
      if (typeof base !== 'function') return;
      api[name] = function() {
        const result = base.apply(this, arguments);
        const after = () => {
          try { sweepTimers(); } catch(e) {}
          try { installTransferCorridorAuthority(); } catch(e) {}
          try { if (W.CityRailPerfCoordinatorV253 && typeof W.CityRailPerfCoordinatorV253.requestODRebuild === 'function') W.CityRailPerfCoordinatorV253.requestODRebuild({ reason:'save-load-v255', topology:true, delay:480 }); } catch(e) {}
          requestMapFlush('save-load-' + name);
        };
        if (result && typeof result.then === 'function') result.then(() => idle(after, 1200), () => idle(after, 1200));
        else idle(after, 1200);
        return result;
      };
      api[name].__cityrailV255Authority = true;
      api[name].__original = base;
    });
    api.__cityrailV255Authority = true;
    return true;
  }

  function installMutationRefresh() {
    if (D.__cityrailV255Events) return;
    D.__cityrailV255Events = true;
    D.addEventListener('click', ev => {
      const target = ev.target;
      if (!target || !target.closest) return;
      if (target.closest('#btn-ctrl-center,#ctrl-center-overlay,[data-control-section]')) {
        W.setTimeout(() => scheduleTask('control', { force:true }), 80);
        W.setTimeout(() => scheduleControlPulse(300), 120);
      }
      if (target.closest('#line-config-overlay,#line-ops-panel,.ats-v82-board,.ats-v86-scroll-range')) {
        W.setTimeout(() => scheduleTask('ats', { force:true, args:[W.opsCurrentLineId, W.opsCurrentDir || 0] }), 80);
      }
      if (target.closest('#station-detail-overlay,#line-config-overlay,#new-build-choice')) {
        W.setTimeout(() => requestMapFlush('ui-click'), 120);
      }
    }, true);
    D.addEventListener('input', ev => {
      const target = ev.target;
      if (target && target.closest && target.closest('#station-detail-overlay,#line-config-overlay,#ctrl-center-overlay')) {
        W.setTimeout(() => {
          scheduleTask('control', { force:false });
          scheduleTask('ats', { force:false, args:[W.opsCurrentLineId, W.opsCurrentDir || 0] });
        }, 220);
      }
    }, true);
    D.addEventListener('visibilitychange', () => {
      if (!D.hidden) {
        scheduleTask('control', { force:true });
        scheduleControlPulse(500);
        requestMapFlush('visible');
      }
    }, { passive:true });
  }

  const perfHud = {
    version: 'v323-left-bottom-performance-hud',
    timer: 0,
    raf: 0,
    frames: 0,
    fps: 0,
    lastFrameAt: 0,
    lastFrameMs: 0,
    lastFpsAt: 0,
    lastSnapshot: null,
    hidden: false
  };

  function perfHudEnabled() {
    try {
      if (W.__CITYRAIL_ENABLE_PERF_HUD__ === true) return true;
      if (new URLSearchParams(W.location && W.location.search || '').get('perf') === '1') return true;
      return W.localStorage && W.localStorage.getItem('cityrail:perfHud') === '1';
    } catch(e) {
      return false;
    }
  }

  function fmtInt(value) {
    return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('zh-CN');
  }

  function fmtMs(value) {
    const n = Number(value) || 0;
    return n < 10 ? n.toFixed(1) : String(Math.round(n));
  }

  function fmtHour(value) {
    const hour = Math.max(0, Number(value) || 0);
    const total = Math.floor(hour * 60 + 0.5) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function installPerfHudStyle() {
    if (byId('cityrail-v323-perf-hud-style')) return;
    const st = D.createElement('style');
    st.id = 'cityrail-v323-perf-hud-style';
    st.textContent = `
      #cityrail-v114-perf.cityrail-perf-hud-v323{
        position:fixed!important;
        left:14px!important;
        right:auto!important;
        bottom:14px!important;
        z-index:5400!important;
        min-width:168px;
        max-width:min(240px,calc(100vw - 28px));
        padding:8px 10px 9px;
        border:1px solid rgba(255,255,255,.14);
        border-radius:8px;
        background:rgba(6,10,16,.78);
        color:rgba(245,250,255,.92);
        box-shadow:0 10px 30px rgba(0,0,0,.32);
        backdrop-filter:blur(12px) saturate(145%);
        -webkit-backdrop-filter:blur(12px) saturate(145%);
        font:600 11px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;
        letter-spacing:0;
        pointer-events:none!important;
        contain:layout paint style;
      }
      #cityrail-v114-perf.cityrail-perf-hud-v323.v135-hidden,
      #cityrail-v114-perf.cityrail-perf-hud-v323.cityrail-perf-hud-hidden{display:none!important;}
      .cityrail-perf-hud-v323 .cr-perf-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;}
      .cityrail-perf-hud-v323 .cr-perf-title{font-size:10px;font-weight:850;color:rgba(255,255,255,.55);text-transform:uppercase;}
      .cityrail-perf-hud-v323 .cr-perf-fps{font-size:15px;font-weight:900;color:#32d17d;white-space:nowrap;}
      .cityrail-perf-hud-v323 .cr-perf-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;}
      .cityrail-perf-hud-v323 .cr-perf-row{min-width:0;display:flex;align-items:baseline;justify-content:space-between;gap:7px;white-space:nowrap;}
      .cityrail-perf-hud-v323 .cr-perf-row span{color:rgba(255,255,255,.52);font-weight:700;}
      .cityrail-perf-hud-v323 .cr-perf-row b{overflow:hidden;text-overflow:ellipsis;font-size:11px;color:rgba(255,255,255,.94);}
      .cityrail-perf-hud-v323 .cr-perf-row.wide{grid-column:1 / -1;}
      @media(max-width:640px){
        #cityrail-v114-perf.cityrail-perf-hud-v323{left:10px!important;bottom:10px!important;min-width:150px;padding:7px 8px;font-size:10px;}
        .cityrail-perf-hud-v323 .cr-perf-grid{grid-template-columns:1fr;}
        .cityrail-perf-hud-v323 .cr-perf-fps{font-size:13px;}
      }
    `;
    D.head.appendChild(st);
  }

  function ensurePerfHud() {
    installPerfHudStyle();
    let hud = byId('cityrail-v114-perf') || D.querySelector('.perf-hud');
    if (!hud) {
      hud = D.createElement('div');
      hud.id = 'cityrail-v114-perf';
      D.body.appendChild(hud);
    }
    hud.id = 'cityrail-v114-perf';
    hud.classList.add('perf-hud', 'cityrail-perf-hud-v323');
    hud.setAttribute('aria-hidden', 'true');
    hud.style.pointerEvents = 'none';
    return hud;
  }

  function perfHudBlocked() {
    if (perfHud.hidden) return true;
    const blockers = [
      '#settings-overlay:not(.hidden)',
      '#line-config-v137-overlay:not(.hidden)',
      '#line-config-v135-overlay:not(.hidden)',
      '#line-config-v134-overlay:not(.hidden)',
      '#city-select-screen:not(.hidden)',
      '#payment-screen:not(.hidden)',
      '#payment-success-screen:not(.hidden)',
      '#station-stats-overlay:not(.hidden)',
      '.modal:not(.hidden)'
    ];
    return !!D.querySelector(blockers.join(','));
  }

  function passengerSnapshot(st) {
    try {
      if (typeof W.cityrailPassengerStatsSnapshot === 'function') {
        const snap = W.cityrailPassengerStatsSnapshot();
        if (snap) return {
          waiting: snap.waiting,
          onboard: snap.onboard,
          totalFlow: snap.totalFlow,
          buildMs: snap.buildMs
        };
      }
    } catch(e) {}
    let waiting = 0;
    const pools = st.stationWaitingPool || {};
    Object.keys(pools).forEach(id => { waiting += Math.max(0, Number(pools[id] && pools[id].waiting) || 0); });
    let onboard = 0;
    (Array.isArray(st.trains) ? st.trains : []).forEach(train => { onboard += Math.max(0, Number(train && (train.load ?? train.passengers ?? train.onboard)) || 0); });
    return { waiting, onboard, totalFlow: Math.max(waiting + onboard, Number(st._totalGenerated || st.totalGenerated || 0) || 0), buildMs: 0 };
  }

  function routeCacheSize() {
    let total = 0;
    let found = false;
    try {
      const api = W.CityRailExpressRouteChoiceV32;
      if (api && typeof api.report === 'function') {
        const r = api.report();
        if (r && Number.isFinite(Number(r.routeCacheSize))) {
          total += Math.max(0, Number(r.routeCacheSize) || 0);
          found = true;
        }
      }
    } catch(e) {}
    try {
      const api = W.CityRailRuntimeRouteCache;
      if (api && typeof api.report === 'function') {
        const r = api.report();
        if (r && Number.isFinite(Number(r.routeCacheSize))) {
          total += Math.max(0, Number(r.routeCacheSize) || 0);
          found = true;
        }
      }
    } catch(e) {}
    try {
      if (typeof W.cityrailNavigationV198Report === 'function') {
        const r = W.cityrailNavigationV198Report();
        if (r && Number.isFinite(Number(r.routeCacheSize))) {
          total += Math.max(0, Number(r.routeCacheSize) || 0);
          found = true;
        }
      }
    } catch(e) {}
    return found ? total : null;
  }

  function collectPerfHudSnapshot() {
    const st = state();
    const pass = passengerSnapshot(st);
    const routeCache = routeCacheSize();
    return {
      fps: perfHud.fps,
      frameMs: perfHud.lastFrameMs,
      simulating: st.isSimulating === true,
      time: fmtHour(st.simulationHour),
      lines: Array.isArray(st.lines) ? st.lines.length : 0,
      stations: Array.isArray(st.stations) ? st.stations.length : 0,
      trains: Array.isArray(st.trains) ? st.trains.length : 0,
      batches: Array.isArray(st.batches) ? st.batches.length : 0,
      waiting: pass.waiting,
      onboard: pass.onboard,
      totalFlow: pass.totalFlow,
      statsMs: pass.buildMs || 0,
      routeCache,
      lod: mapState.lastLod || ''
    };
  }

  function renderPerfHud() {
    if (!perfHudEnabled()) {
      hidePerfHud();
      return perfHud.lastSnapshot || null;
    }
    const hud = ensurePerfHud();
    const snap = collectPerfHudSnapshot();
    perfHud.lastSnapshot = snap;
    const hasMap = !!byId('map');
    const hasNetwork = snap.lines > 0 || snap.stations > 0 || snap.trains > 0 || snap.batches > 0 || !!state().__lastLoadAt;
    const hidden = !hasMap || !hasNetwork || perfHudBlocked();
    hud.classList.toggle('v135-hidden', hidden);
    hud.classList.toggle('cityrail-perf-hud-hidden', hidden);
    if (hidden) return snap;
    const cacheText = snap.routeCache == null ? '-' : fmtInt(snap.routeCache);
    hud.innerHTML =
      '<div class="cr-perf-top"><div class="cr-perf-title">Performance</div><div class="cr-perf-fps">' + fmtInt(snap.fps) + ' FPS</div></div>' +
      '<div class="cr-perf-grid">' +
      '<div class="cr-perf-row"><span>帧耗时</span><b>' + fmtMs(snap.frameMs) + ' ms</b></div>' +
      '<div class="cr-perf-row"><span>状态</span><b>' + (snap.simulating ? '运行' : '暂停') + '</b></div>' +
      '<div class="cr-perf-row"><span>列车</span><b>' + fmtInt(snap.trains) + '</b></div>' +
      '<div class="cr-perf-row"><span>候车</span><b>' + fmtInt(snap.waiting) + '</b></div>' +
      '<div class="cr-perf-row"><span>批次</span><b>' + fmtInt(snap.batches) + '</b></div>' +
      '<div class="cr-perf-row"><span>缓存</span><b>' + cacheText + '</b></div>' +
      '<div class="cr-perf-row wide"><span>线网</span><b>' + fmtInt(snap.lines) + '线 / ' + fmtInt(snap.stations) + '站 / ' + snap.time + '</b></div>' +
      '</div>';
    return snap;
  }

  function samplePerfFrame(ts) {
    if (!perfHudEnabled()) {
      perfHud.raf = 0;
      return;
    }
    if (perfHud.lastFrameAt) perfHud.lastFrameMs = Math.max(0, ts - perfHud.lastFrameAt);
    perfHud.lastFrameAt = ts;
    perfHud.frames += 1;
    if (!perfHud.lastFpsAt) perfHud.lastFpsAt = ts;
    const elapsed = ts - perfHud.lastFpsAt;
    if (elapsed >= 900) {
      perfHud.fps = Math.round(perfHud.frames * 1000 / Math.max(1, elapsed));
      perfHud.frames = 0;
      perfHud.lastFpsAt = ts;
    }
    perfHud.raf = W.requestAnimationFrame ? W.requestAnimationFrame(samplePerfFrame) : W.setTimeout(() => samplePerfFrame(now()), 1000 / 30);
  }

  function installPerfHud() {
    if (!perfHudEnabled()) {
      hidePerfHud();
      if (perfHud.timer) W.clearInterval(perfHud.timer);
      perfHud.timer = 0;
      return;
    }
    ensurePerfHud();
    if (!perfHud.raf) perfHud.raf = W.requestAnimationFrame ? W.requestAnimationFrame(samplePerfFrame) : W.setTimeout(() => samplePerfFrame(now()), 1000 / 30);
    if (perfHud.timer) W.clearInterval(perfHud.timer);
    renderPerfHud();
    perfHud.timer = W.setInterval(renderPerfHud, 2500);
  }

  function hidePerfHud() {
    perfHud.hidden = true;
    try { W.localStorage && W.localStorage.removeItem('cityrail:perfHud'); } catch(e) {}
    const hud = byId('cityrail-v114-perf');
    if (hud) hud.classList.add('cityrail-perf-hud-hidden', 'v135-hidden');
  }

  function showPerfHud() {
    perfHud.hidden = false;
    try { W.localStorage && W.localStorage.setItem('cityrail:perfHud', '1'); } catch(e) {}
    installPerfHud();
    renderPerfHud();
  }

  function install() {
    installStyle();
    sweepTimers();
    bindMap();
    installPanelAuthority();
    installTrainAuthority();
    installTransferCorridorAuthority();
    installSaveLoadAuthority();
    installMutationRefresh();
    installPerfHud();
    scheduleControlPulse(900);
    scheduleRuntimeMaintenance(2400, 'install');
    scheduleLOD('install');
    try { D.documentElement.dataset.cityrailPerformanceAuthority = VERSION; } catch(e) {}
  }

  function boot() {
    install();
    if (!W.__cityrailV255SweepEvents) {
      W.__cityrailV255SweepEvents = true;
      let pendingSweep = 0;
      const scheduleSweep = delay => {
        if (pendingSweep) return;
        pendingSweep = W.setTimeout(() => {
          pendingSweep = 0;
          sweepTimers();
          bindMap();
          installSaveLoadAuthority();
          removeTransferCorridorLayers();
          runRuntimeMaintenance('event-sweep');
        }, delay || 260);
        W.__cityrailV255SweepTimer = pendingSweep;
      };
      try { W.addEventListener('cityrail-save-loaded', () => scheduleSweep(80)); } catch(e) {}
      try { D.addEventListener('visibilitychange', () => { if (!D.hidden) scheduleSweep(120); }, { passive:true }); } catch(e) {}
    }
  }

  W.CityRailRenderAuthorityV276 = W.CityRailRenderAuthorityV275 = W.CityRailPerformanceAuthorityV255 = {
    version: VERSION,
    install,
    sweepTimers,
    scheduleTask,
    requestMapFlush,
    showPerfHud,
    hidePerfHud,
    mapActive,
    scheduleTrainCanvas,
    report: () => Object.assign({}, report, {
      renderAuthority: VERSION,
      mapBound: mapState.bound,
      mapActive: mapActive(),
      lod: mapState.lastLod,
      activeTimers: obsoleteTimers.filter(k => !!W[k]),
      domTrainMarkers: W.trainMarkers ? Object.keys(W.trainMarkers).length : 0,
      trainCanvas: {
        present: !!byId('cityrail-train-canvas-v114'),
        models: trainCanvas.models.length,
        rafPending: !!trainCanvas.raf,
        drawAt: report.last.trainCanvasAt || null,
        rendererOwnsGlobal: !!(W.renderAllTrainMarkers && W.renderAllTrainMarkers.__cityrailV275Authority)
      },
      controlAuthority: {
        ownsRenderer: !!(W.CityRailControlCenterRenderer && W.CityRailControlCenterRenderer.version === VERSION),
        ownsGlobal: !!(W.renderCtrlCenter && W.renderCtrlCenter.__cityrailV276Authority),
        hasBase: typeof renderQueue.control.base === 'function',
        pending: !!renderQueue.control.pending,
        minMs: renderQueue.control.min
      },
      atsAuthority: {
        ownsGlobal: !!(W.renderLineOpsPanel && W.renderLineOpsPanel.__cityrailV276Authority),
        hasBase: typeof renderQueue.ats.base === 'function',
        pending: !!renderQueue.ats.pending,
        minMs: renderQueue.ats.min
      },
      perfHud: Object.assign({}, perfHud.lastSnapshot || {}, {
        version: perfHud.version,
        present: !!byId('cityrail-v114-perf'),
        hidden: !!(byId('cityrail-v114-perf') && byId('cityrail-v114-perf').classList.contains('v135-hidden'))
      }),
      transferCorridorElements: D.querySelectorAll('.cityrail-v102-transfer-pane,.transfer-corridor-v100,.transfer-corridor-v101,.transfer-corridor-label,.transfer-corridor-platform-dot').length
    })
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
