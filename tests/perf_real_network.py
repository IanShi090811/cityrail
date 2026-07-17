#!/usr/bin/env python3
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import requests
    import websocket
except ImportError as exc:
    requests = None
    websocket = None
    OPTIONAL_IMPORT_ERROR = exc

ROOT = Path(__file__).resolve().parents[1]
CHROMIUM_CANDIDATES = [
    os.environ.get("CHROMIUM"),
    shutil.which("chromium"),
    shutil.which("chromium-browser"),
    shutil.which("google-chrome"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
CHROMIUM = next((p for p in CHROMIUM_CANDIDATES if p and Path(p).exists()), None)


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def start_server():
    port = free_port()
    os.chdir(ROOT)
    srv = ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv, port


class CDP:
    def __init__(self, wsurl):
        self.ws = websocket.create_connection(wsurl, timeout=30)
        self.i = 0

    def cmd(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.i:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expr, await_promise=False):
        res = self.cmd("Runtime.evaluate", {
            "expression": expr,
            "awaitPromise": await_promise,
            "returnByValue": True,
            "timeout": 120000,
        })
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"])
        return res.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


HELPER_JS = r"""
(() => {
  if (window.__cityrailRealNetworkPerf) return window.__cityrailRealNetworkPerf;
  const sid = value => String(value == null ? '' : value);
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const cleanName = value => sid(value).replace(/\s+/g, '').replace(/站$/u, '').replace(/Station$/i, '').replace(/[()（）［］\[\]【】]/g, '').toLowerCase();
  const meters = (a, b) => {
    if (!a || !b) return Infinity;
    try {
      if (typeof window.haversine === 'function') return window.haversine(num(a.lat), num(a.lng), num(b.lat), num(b.lng)) * 1000;
    } catch(e) {}
    const r = 6371000;
    const lat1 = num(a.lat) * Math.PI / 180;
    const lat2 = num(b.lat) * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLng = (num(b.lng) - num(a.lng)) * Math.PI / 180;
    const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return r * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
  };
  let nextStation = 1;
  let nextLine = 1;
  let nextWp = 1;
  function nextId(prefix) {
    if (prefix === 'line') return 'perf_line_' + nextLine++;
    if (prefix === 'wp') return 'perf_wp_' + nextWp++;
    return 'perf_station_' + nextStation++;
  }
  function routeServiceName(route) {
    const ref = sid(route && route.ref).trim();
    const name = sid(route && route.name).split(/\s*(?:[:：]|=>|→|↔|⇄|<->| - | – | — | -- )\s*/)[0].trim();
    if (ref) return /^\d+[A-Za-z]?$/.test(ref) ? ref.toUpperCase() + '号线' : (/线$/u.test(ref) ? ref : ref + '线');
    return name || '真实线网线路';
  }
  function routeIsLoop(route) {
    return !!(route && (route.isLoop || route.loopMode === 'closed-ring' || route.closedLoop || route.isCircular));
  }
  function populationFor(candidate, index) {
    try {
      if (typeof window.cityrailInitialStationPopulation === 'function') return window.cityrailInitialStationPopulation(candidate.lat, candidate.lng, index);
    } catch(e) {}
    return 1000;
  }
  function zoneTypesFor(candidate) {
    try {
      if (typeof window.inferZoneTypesByArea === 'function') return window.inferZoneTypesByArea(candidate.lat, candidate.lng, { name:candidate.name });
    } catch(e) {}
    return ['residential'];
  }
  function resetState() {
    const st = window.state;
    try { if (typeof window.stopSimulation === 'function') window.stopSimulation(); } catch(e) {}
    Object.assign(st, {
      stations: [],
      lines: [],
      depots: [],
      trains: [],
      virtualTransfers: [],
      stationWaitingPool: {},
      batches: [],
      _batchAccum: {},
      _batchMap: {},
      _totalDelivered: 0,
      _totalGenerated: 0,
      _lineRidership: {},
      _segmentActualFlow: {},
      lineStatsData: [],
      segmentFlowsCache: [],
      stationFlowMap: {},
      simulationHour: 6,
      isSimulating: false
    });
    nextStation = 1;
    nextLine = 1;
    nextWp = 1;
    try { if (typeof window.invalidateFlowCache === 'function') window.invalidateFlowCache(); } catch(e) {}
  }
  function applyLoop(line, route) {
    if (!routeIsLoop(route) || !Array.isArray(line.stationIds) || line.stationIds.length < 3) return;
    while (line.stationIds.length > 2 && sid(line.stationIds[line.stationIds.length - 1]) === sid(line.stationIds[0])) line.stationIds.pop();
    Object.assign(line, {
      __loopChoice:'loop',
      isLoop:true,
      loopMode:'closed-ring',
      loopClosedExplicit:true,
      loopStartStationId:line.stationIds[0],
      loopEndStationId:line.stationIds[0],
      loopDirection:0,
      loopTerminalDistanceM:Math.max(0, Math.round(num(route.loopTerminalDistanceM, 0)))
    });
  }
  function transferInfo(distanceM) {
    const d = Math.max(0, Math.round(num(distanceM, 0)));
    if (d <= 100) return { type:'platform_same', penaltyMin:1.5 };
    if (d <= 300) return { type:'short_corridor', penaltyMin:3 };
    if (d <= 500) return { type:'long_corridor', penaltyMin:6 };
    return { type:'virtual', penaltyMin:10 };
  }
  function transferKey(aId, bId, lineAId, lineBId) {
    return [sid(aId), sid(bId)].sort().join('~') + '|' + [sid(lineAId), sid(lineBId)].sort().join('|');
  }
  function addTransfer(row) {
    const st = window.state;
    if (!row || !row.stationA || !row.stationB || !row.lineA || !row.lineB) return false;
    if (sid(row.stationA.id) === sid(row.stationB.id) || sid(row.lineA.id) === sid(row.lineB.id)) return false;
    const d = meters(row.stationA, row.stationB);
    if (!Number.isFinite(d) || d > 600) return false;
    const key = transferKey(row.stationA.id, row.stationB.id, row.lineA.id, row.lineB.id);
    if (st.virtualTransfers.some(vt => transferKey(vt.stationA, vt.stationB, vt.lineAId, vt.lineBId) === key)) return false;
    const info = transferInfo(d);
    st.virtualTransfers.push({
      stationA:row.stationA.id,
      stationB:row.stationB.id,
      lineAId:row.lineA.id,
      lineBId:row.lineB.id,
      type:info.type,
      penaltyMin:info.penaltyMin,
      distanceM:Math.round(d),
      source:'perf-real-network'
    });
    return true;
  }
  async function importCity(city) {
    resetState();
    const started = performance.now();
    const data = await fetch('/fixtures/real-network/' + city + '.json').then(r => r.json());
    const st = window.state;
    const stationByPlatform = new Map();
    const importedRows = [];
    const routes = (data.routes || []).slice(0, 80);
    for (const route of routes) {
      const stationIds = [];
      const oldToNewSeg = new Map();
      const stationRows = [];
      let lastId = '';
      (route.stations || []).forEach((candidate, index) => {
        const platformKey = sid(candidate.platformKey) || [cleanName(candidate.name), Math.round(num(candidate.lat) * 100000), Math.round(num(candidate.lng) * 100000)].join(':');
        let station = stationByPlatform.get(platformKey);
        if (!station) {
          const zones = zoneTypesFor(candidate);
          station = {
            id:nextId('station'),
            name:candidate.name,
            lat:num(candidate.lat),
            lng:num(candidate.lng),
            population:populationFor(candidate, index),
            zoneTypes:zones,
            zoneType:zones[0] || 'residential',
            sourceImport:{ type:'perf-real-network', platformKey, transferKey:candidate.transferKey || cleanName(candidate.name) },
            sourceOsmRefs:Array.from(new Set(candidate.osmRefs || []))
          };
          try { if (typeof window.applyCityStationRealism === 'function') window.applyCityStationRealism(station); } catch(e) {}
          st.stations.push(station);
          st.stationWaitingPool[station.id] = { waiting:0, totalArrived:0, totalBoarded:0, totalDelivered:0, totalTransfer:0 };
          stationByPlatform.set(platformKey, station);
        }
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
      if (stationIds.length < 2) continue;
      const waypoints = (route.waypoints || []).map(w => {
        const segIdx = oldToNewSeg.get(Math.round(num(w.segIdx)));
        if (segIdx == null) return null;
        return { id:nextId('wp'), lat:num(w.lat), lng:num(w.lng), segIdx, order:num(w.order), sourceImport:'perf-real-network' };
      }).filter(Boolean);
      const line = {
        id:nextId('line'),
        name:routeServiceName(route),
        color:route.color || '#0a84ff',
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
        offPeakHeadwayMin:6,
        normalHeadwayMin:4,
        peakHeadwayMin:2,
        pathMode:'ordered',
        requiresRealDepot:false,
        sourceImport:{ type:'perf-real-network', relationId:route.relationId, ref:route.ref || '', network:route.network || '', variantRole:route.variantRole || 'main' }
      };
      if (route.variantRole === 'branch') line.branchTransferPenalty = 2;
      applyLoop(line, route);
      try { if (typeof window.cityrailNormalizeLineIdentity === 'function') window.cityrailNormalizeLineIdentity(line, 'perf-real-network'); } catch(e) {}
      st.lines.push(line);
      importedRows.push({ route, line, stationRows });
    }
    const transferGroups = new Map();
    importedRows.forEach(row => {
      row.stationRows.forEach(item => {
        const key = cleanName(item.candidate && item.candidate.name) || sid(item.candidate && item.candidate.transferKey);
        if (!key) return;
        if (!transferGroups.has(key)) transferGroups.set(key, []);
        transferGroups.get(key).push({ station:item.station, line:row.line });
      });
    });
    let transfers = 0;
    transferGroups.forEach(list => {
      const bestByLinePair = new Map();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (sid(a.line.id) === sid(b.line.id) || sid(a.station.id) === sid(b.station.id)) continue;
          const d = meters(a.station, b.station);
          if (!Number.isFinite(d) || d > 600) continue;
          const key = [sid(a.line.id), sid(b.line.id)].sort().join('|');
          const prev = bestByLinePair.get(key);
          if (!prev || d < prev.distanceM) bestByLinePair.set(key, { stationA:a.station, stationB:b.station, lineA:a.line, lineB:b.line, distanceM:d });
        }
      }
      bestByLinePair.forEach(row => { if (addTransfer(row)) transfers++; });
    });
    try { if (typeof window.invalidateFlowCache === 'function') window.invalidateFlowCache(); } catch(e) {}
    const importMs = performance.now() - started;
    return { city, importMs, routes:routes.length, lines:st.lines.length, stations:st.stations.length, transfers, waypoints:st.lines.reduce((a,l)=>a+(l.waypoints||[]).length,0) };
  }
  function timeCall(fn) {
    const t = performance.now();
    const value = fn();
    return { ms:performance.now() - t, value };
  }
  function percentile(values, p) {
    if (!values.length) return 0;
    const arr = values.slice().sort((a,b)=>a-b);
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * p)));
    return arr[idx];
  }
  function installProfileCounter() {
    const profile = {
      createPassengerBatch:{ calls:0, ms:0 },
      computePassengerRoute:{ calls:0, ms:0 },
      generatePassengers:{ calls:0, ms:0 },
      demandTick:{ calls:0, ms:0 },
      runSimulation:{ calls:0, ms:0 },
      updateTrains:{ calls:0, ms:0 },
      renderAllTrainMarkers:{ calls:0, ms:0 }
    };
    const wrap = (name, bucket) => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn.__cityrailPerfProfileWrapped) return;
      const wrapped = function(...args) {
        const t = performance.now();
        try {
          return fn.apply(this, args);
        } finally {
          profile[bucket].calls++;
          profile[bucket].ms += performance.now() - t;
        }
      };
      wrapped.__cityrailPerfProfileWrapped = true;
      try { window[name] = wrapped; } catch(e) {}
    };
    wrap('createPassengerBatch', 'createPassengerBatch');
    wrap('computePassengerRoute', 'computePassengerRoute');
    wrap('generatePassengers', 'generatePassengers');
    wrap('runSimulation', 'runSimulation');
    wrap('updateTrains', 'updateTrains');
    wrap('renderAllTrainMarkers', 'renderAllTrainMarkers');
    if (window.CityRailPassengerDemandService && typeof window.CityRailPassengerDemandService.tick === 'function' && !window.CityRailPassengerDemandService.tick.__cityrailPerfProfileWrapped) {
      const base = window.CityRailPassengerDemandService.tick;
      const wrapped = function(...args) {
        const t = performance.now();
        try {
          return base.apply(this, args);
        } finally {
          profile.demandTick.calls++;
          profile.demandTick.ms += performance.now() - t;
        }
      };
      wrapped.__cityrailPerfProfileWrapped = true;
      window.CityRailPassengerDemandService.tick = wrapped;
    }
    return profile;
  }
  function spawnStressTrains(trainsPerLine = 4) {
    const st = window.state;
    st.trains = [];
    try { if (window.trainMarkers) Object.values(window.trainMarkers).forEach(m => window.map && window.map.removeLayer && window.map.removeLayer(m)); } catch(e) {}
    const lines = (st.lines || []).filter(line => line && Array.isArray(line.stationIds) && line.stationIds.length >= 2);
    for (const line of lines) {
      const nodes = typeof window.getLineTrainNodes === 'function' ? window.getLineTrainNodes(line) : [];
      if (!nodes || nodes.length < 2) continue;
      const slots = Math.max(1, Math.round(trainsPerLine));
      for (let i = 0; i < slots; i++) {
        const dir = i % 2;
        let train = null;
        if (typeof window.createTrainObj === 'function') train = window.createTrainObj(line, dir, 0, nodes);
        else train = { id:'perf_train_' + line.id + '_' + i, lineId:line.id, direction:dir, load:0, maxLoad:1200, _passengerIds:[] };
        const stationCount = line.stationIds.length;
        const stationIdx = dir === 0
          ? Math.max(0, Math.min(stationCount - 2, Math.floor((i + 1) * stationCount / (slots + 1))))
          : Math.max(1, Math.min(stationCount - 1, stationCount - 1 - Math.floor((i + 1) * stationCount / (slots + 1))));
        let placed = false;
        try {
          if (typeof window.placeTrainAtStationBalanced === 'function') placed = window.placeTrainAtStationBalanced(train, line, nodes, stationIdx, dir);
        } catch(e) {}
        if (!placed) {
          train.nextStationIdx = stationIdx;
          train.segIndex = Math.max(0, Math.min(nodes.length - 2, Math.floor(i * Math.max(1, nodes.length - 1) / slots)));
          train.segProgress = dir === 0 ? 0 : 1;
          train.state = 'dwelling';
          train.dwellRemaining = 10;
        }
        train.depTime = 0;
        train._perfStressTrain = true;
        st.trains.push(train);
      }
    }
    try { if (typeof window.renderAllTrainMarkers === 'function') window.renderAllTrainMarkers(); } catch(e) {}
    return { lines:lines.length, trains:st.trains.length };
  }
  function frameStats(values) {
    const sum = values.reduce((a,b) => a + b, 0);
    return {
      avg: values.length ? sum / values.length : 0,
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.length ? Math.max(...values) : 0
    };
  }
  async function settleFrames(count = 8) {
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
  async function frameProbe({ durationMs = 5000, interact = false, updateDt = 0.5, warmupFrames = 8 } = {}) {
    await settleFrames(warmupFrames);
    const frameIntervals = [];
    const updateTimes = [];
    const renderTimes = [];
    const longTasks = [];
    let observer = null;
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration || 0);
      });
      observer.observe({ entryTypes:['longtask'] });
    } catch(e) {}
    const st = window.state;
    st.isSimulating = true;
    let last = performance.now();
    const started = last;
    let interactionTimer = 0;
    await new Promise(resolve => {
      const step = now => {
        frameIntervals.push(now - last);
        last = now;
        if (interact && window.map && now - interactionTimer > 550) {
          interactionTimer = now;
          try {
            if ((Math.floor((now - started) / 550) % 3) === 0 && typeof window.map.zoomIn === 'function') window.map.zoomIn(0.25, { animate:true });
            else if ((Math.floor((now - started) / 550) % 3) === 1 && typeof window.map.zoomOut === 'function') window.map.zoomOut(0.25, { animate:true });
            else if (typeof window.map.panBy === 'function') window.map.panBy([90, 45], { animate:true, duration:0.18 });
          } catch(e) {}
        }
        const update = timeCall(() => {
          if (typeof window.updateTrains === 'function') window.updateTrains(updateDt);
        });
        updateTimes.push(update.ms);
        if (typeof window.renderAllTrainMarkers === 'function') {
          const render = timeCall(() => window.renderAllTrainMarkers());
          renderTimes.push(render.ms);
        }
        if (now - started >= durationMs) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (observer) {
      try { observer.disconnect(); } catch(e) {}
    }
    return {
      durationMs,
      warmupFrames,
      interact,
      frames:frameIntervals.length,
      fps: frameIntervals.length ? 1000 / (frameIntervals.reduce((a,b) => a + b, 0) / frameIntervals.length) : 0,
      frameMs:frameStats(frameIntervals),
      updateMs:frameStats(updateTimes),
      renderMs:frameStats(renderTimes),
      longTasks:{ count:longTasks.length, totalMs:longTasks.reduce((a,b) => a + b, 0), p95:percentile(longTasks, 0.95), max:longTasks.length ? Math.max(...longTasks) : 0 }
    };
  }
  async function stress(city, options = {}) {
    const imported = await importCity(city);
    const st = window.state;
    st.isSimulating = true;
    st.simSpeed = Number(options.simSpeed) || 24;
    st.simulationHour = 6;
    const od = timeCall(() => typeof window.buildODMatrix === 'function' ? window.buildODMatrix() : null);
    const spawned = spawnStressTrains(Number(options.trainsPerLine) || 4);
    await settleFrames(12);
    const idle = await frameProbe({ durationMs:Number(options.durationMs) || 5000, interact:false, updateDt:Number(options.updateDt) || 0.5, warmupFrames:8 });
    const interaction = await frameProbe({ durationMs:Number(options.durationMs) || 5000, interact:true, updateDt:Number(options.updateDt) || 0.5, warmupFrames:8 });
    st.isSimulating = false;
    return {
      imported,
      odMs:od.ms,
      spawned,
      batches:Array.isArray(st.batches) ? st.batches.length : 0,
      trains:Array.isArray(st.trains) ? st.trains.length : 0,
      idle,
      interaction,
      routeCache: window.CityRailRuntimeRouteCache && window.CityRailRuntimeRouteCache.report ? window.CityRailRuntimeRouteCache.report() : null
    };
  }
  async function bench(city, ticks) {
    ticks = Math.max(1, Math.round(Number(ticks) || 180));
    const imported = await importCity(city);
    const st = window.state;
    st.isSimulating = true;
    st.simSpeed = 24;
    const od = timeCall(() => {
      if (typeof window.buildODMatrix === 'function') return window.buildODMatrix();
      return null;
    });
    const initTrains = timeCall(() => {
      if (typeof window.initAllTrains === 'function') window.initAllTrains('perf-real-network');
    });
    const trainTimes = [];
    const demandTimes = [];
    const statsTimes = [];
    const renderTimes = [];
    const profile = installProfileCounter();
    const generatedStart = Number(st._totalGenerated) || 0;
    for (let i = 0; i < ticks; i++) {
      st.simulationHour = (6 + (i / 60)) % 24;
      const stats = timeCall(() => {
        st.__cityrailLastRunSimulationAt = 0;
        if (typeof window.runSimulation === 'function') window.runSimulation();
      });
      statsTimes.push(stats.ms);
      const demand = timeCall(() => {
        if (typeof window.cityrailGeneratePassengerDemandTick === 'function') window.cityrailGeneratePassengerDemandTick(60, 'perf');
        else if (typeof window.generatePassengers === 'function') window.generatePassengers(60);
      });
      demandTimes.push(demand.ms);
      const trains = timeCall(() => {
        if (typeof window.updateTrains === 'function') window.updateTrains(1);
      });
      trainTimes.push(trains.ms);
      if (i % 30 === 0) {
        const render = timeCall(() => {
          if (typeof window.renderAllTrainMarkers === 'function') window.renderAllTrainMarkers();
        });
        renderTimes.push(render.ms);
      }
    }
    st.isSimulating = false;
    return {
      imported,
      ticks,
      odMs: od.ms,
      initTrainsMs: initTrains.ms,
      trains: st.trains.length,
      batches: st.batches.length,
      generated: Math.max(0, (Number(st._totalGenerated) || 0) - generatedStart),
      delivered: Number(st._totalDelivered) || 0,
      trainTickAvgMs: trainTimes.reduce((a,b)=>a+b,0) / trainTimes.length,
      trainTickP95Ms: percentile(trainTimes, 0.95),
      demandTickAvgMs: demandTimes.reduce((a,b)=>a+b,0) / demandTimes.length,
      demandTickP95Ms: percentile(demandTimes, 0.95),
      statsTickAvgMs: statsTimes.reduce((a,b)=>a+b,0) / statsTimes.length,
      statsTickP95Ms: percentile(statsTimes, 0.95),
      renderAvgMs: renderTimes.length ? renderTimes.reduce((a,b)=>a+b,0) / renderTimes.length : 0,
      profile,
      routeCache: window.CityRailRuntimeRouteCache && window.CityRailRuntimeRouteCache.report ? window.CityRailRuntimeRouteCache.report() : null
    };
  }
  window.__cityrailRealNetworkPerf = { importCity, bench, stress, spawnStressTrains, frameProbe };
  return window.__cityrailRealNetworkPerf;
})()
"""


def main():
    cities = sys.argv[1:] or ["beijing", "shanghai", "guangzhou"]
    if not requests or not websocket:
        print(f"SKIP: optional browser dependencies unavailable ({OPTIONAL_IMPORT_ERROR})")
        return 0
    if not CHROMIUM:
        print("SKIP: chromium not found")
        return 0

    srv, port = start_server()
    dbg = free_port()
    profile = tempfile.mkdtemp(prefix="cityrail-perf-")
    proc = subprocess.Popen([
        CHROMIUM,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--remote-allow-origins=*",
        f"--remote-debugging-port={dbg}",
        f"--user-data-dir={profile}",
        f"http://127.0.0.1:{port}/index.html",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    c = None
    try:
        wsurl = None
        for _ in range(120):
            try:
                tabs = requests.get(f"http://127.0.0.1:{dbg}/json", timeout=0.5).json()
                if tabs:
                    wsurl = tabs[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                time.sleep(0.1)
        if not wsurl:
            print("FAIL: cannot connect chromium devtools")
            return 1
        c = CDP(wsurl)
        c.cmd("Runtime.enable")
        c.cmd("Page.enable")
        time.sleep(7)
        c.eval(HELPER_JS)
        results = []
        for city in cities:
            result = c.eval(f"window.__cityrailRealNetworkPerf.bench({json.dumps(city)}, 180)", await_promise=True)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        print(json.dumps({"results": results}, ensure_ascii=False, indent=2))
        return 0
    finally:
        if c:
            c.close()
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        srv.shutdown()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
