/* CityRail schematic route map generator. */
(function(){
  'use strict';
  const W = window;
  const D = document;
  const VERSION = 'v6-control-center-metro-diagram-20260716';
  if (W.CityRailSchematicMap && W.CityRailSchematicMap.version === VERSION) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PAPER = '#ffffff';
  const TEXT = '#0f172a';
  const MUTED = '#64748b';
  const GRID = 48;
  const DEFAULT = {
    anchorWeight: 0.34,
    idealStationDistance: 42,
    maxIterations: 130,
    cornerRadius: 18,
    labelCollision: false
  };
  const RENDER = {
    lineWidth: 7,
    lineUnderlay: 13,
    stationR: 5.8,
    stationStroke: 1.9,
    transferInnerRatio: 0.48,
    crossingGapR: 8.8,
    labelStroke: 3.2
  };

  const sid = value => String(value == null ? '' : value);
  const byId = id => D.getElementById(id);
  const state = () => W.state || {};
  const esc = value => sid(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = value => Math.round(value * 10) / 10;

  let lastSvgText = '';
  let lastFileBase = 'cityrail-schematic';
  let currentMode = 'final';
  let lastRenderSignature = '';

  function cfg(options) {
    const source = Object.assign({}, DEFAULT, W.cityrailSchematicConfig || {}, options || {});
    return {
      anchorWeight: clamp(num(source.anchorWeight, DEFAULT.anchorWeight), 0, 0.45),
      idealStationDistance: clamp(num(source.idealStationDistance, DEFAULT.idealStationDistance), 34, 78),
      maxIterations: clamp(Math.round(num(source.maxIterations, DEFAULT.maxIterations)), 60, 360),
      cornerRadius: clamp(num(source.cornerRadius, DEFAULT.cornerRadius), 8, 28),
      labelCollision: source.labelCollision === true
    };
  }

  function isConnectorLine(line) {
    if (!line) return true;
    try {
      if (typeof W.cityrailIsConnectorLine === 'function' && W.cityrailIsConnectorLine(line)) return true;
    } catch(e) {}
    const text = [line.type, line.kind, line.lineType, line.source, line.sourceType, line.sourceImport && line.sourceImport.type].filter(Boolean).join(' ');
    return !!(line.isConnector || line.connectorLine || line.connectorConfig || /connector|联络线|连接线/i.test(text));
  }

  function lineIsLoop(line) {
    if (!line) return false;
    try {
      if (typeof W.isLoopLine === 'function' && W.isLoopLine(line)) return true;
    } catch(e) {}
    return !!(line.isLoop || line.loopClosedExplicit || line.closedLoop || line.isCircular || line.loopMode === 'closed-ring' || line.__loopChoice === 'loop');
  }

  function routeName(line) {
    return sid(line && (line.name || line.displayName || line.ref || line.id)) || '未命名线路';
  }

  function compareLines(a, b) {
    if (typeof W.cityrailCompareLinesByNumber === 'function') return W.cityrailCompareLinesByNumber(a, b);
    const text = line => sid(line && (line.name || line.label || line.code || line.no || line.number || line.id));
    const ordinal = line => {
      const explicit = Number(line && (line.no ?? line.number));
      if (Number.isFinite(explicit)) return explicit;
      const m = text(line).match(/\d+/);
      return m ? Number(m[0]) : Infinity;
    };
    const an = ordinal(a), bn = ordinal(b);
    const af = Number.isFinite(an), bf = Number.isFinite(bn);
    if (af !== bf) return af ? -1 : 1;
    if (af && an !== bn) return an - bn;
    return text(a).localeCompare(text(b), 'zh-CN', { numeric:true, sensitivity:'base' });
  }

  function stationMap() {
    const map = new Map();
    (Array.isArray(state().stations) ? state().stations : []).forEach(station => {
      if (station && station.id != null) map.set(sid(station.id), station);
    });
    return map;
  }

  function activeLines() {
    return (Array.isArray(state().lines) ? state().lines : [])
      .filter(line => line && !isConnectorLine(line) && Array.isArray(line.stationIds) && line.stationIds.length >= 2)
      .map(line => Object.assign({}, line, {
        stationIds: line.stationIds.map(id => sid(id)).filter(Boolean)
      }))
      .filter(line => line.stationIds.length >= 2)
      .sort(compareLines);
  }

  function stationGeo(station, lineId) {
    const pos = station && station.linePositions && lineId != null ? station.linePositions[lineId] : null;
    const lat = pos && Number.isFinite(Number(pos.lat)) ? Number(pos.lat) : Number(station && station.lat);
    const lng = pos && Number.isFinite(Number(pos.lng)) ? Number(pos.lng) : Number(station && station.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function rawTransferPairs() {
    const s = state();
    const raw = []
      .concat(Array.isArray(s.virtualTransfers) ? s.virtualTransfers : [])
      .concat(Array.isArray(s.transferLinks) ? s.transferLinks : [])
      .concat(Array.isArray(s.walkingTransfers) ? s.walkingTransfers : []);
    const out = [];
    raw.forEach(item => {
      if (!item) return;
      const a = Array.isArray(item) ? item[0] : item.fromStationId || item.fromStation || item.stationA || item.a || item.sourceStationId || item.source || item.from;
      const b = Array.isArray(item) ? item[1] : item.toStationId || item.toStation || item.stationB || item.b || item.targetStationId || item.target || item.to;
      const ak = sid(a);
      const bk = sid(b);
      if (ak && bk && ak !== bk) out.push([ak, bk]);
    });
    return out;
  }

  function makeUnionFind(ids) {
    const parent = new Map(ids.map(id => [id, id]));
    const find = id => {
      let p = parent.get(id) || id;
      if (p !== id) {
        p = find(p);
        parent.set(id, p);
      }
      return p;
    };
    const union = (a, b) => {
      if (!parent.has(a) || !parent.has(b)) return;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    return { find, union };
  }

  function buildDataModel(lines, stations) {
    lines.forEach(line => {
      const seen = new Set();
      line.stationIds.forEach((id, index) => {
        if (!stations.has(id)) throw new Error(`线路 ${routeName(line)} 引用了不存在的车站 ${id}`);
        if (seen.has(id)) throw new Error(`线路 ${routeName(line)} 存在重复车站 ${stations.get(id).name || id}`);
        if (index > 0 && line.stationIds[index - 1] === id) throw new Error(`线路 ${routeName(line)} 存在连续重复车站 ${stations.get(id).name || id}`);
        seen.add(id);
      });
    });

    const uf = makeUnionFind(Array.from(stations.keys()));
    rawTransferPairs().forEach(pair => uf.union(pair[0], pair[1]));
    const stationRoot = new Map();
    const roots = new Map();

    lines.forEach(line => {
      line.stationIds.forEach(id => {
        const station = stations.get(id);
        const geo = stationGeo(station, line.id) || stationGeo(station, null);
        const rootId = uf.find(id);
        stationRoot.set(id, rootId);
        if (!roots.has(rootId)) {
          roots.set(rootId, {
            stationId: rootId,
            name: station && station.name ? station.name : rootId,
            gxSum: 0,
            gySum: 0,
            geoCount: 0,
            gx: NaN,
            gy: NaN,
            tx: NaN,
            ty: NaN,
            lines: new Set(),
            members: new Set(),
            terminal: false
          });
        }
        const node = roots.get(rootId);
        node.members.add(id);
        node.lines.add(sid(line.id));
        if (geo) {
          node.gxSum += geo.lng;
          node.gySum += geo.lat;
          node.geoCount++;
        }
      });
    });

    roots.forEach(node => {
      if (node.geoCount) {
        node.gx = node.gxSum / node.geoCount;
        node.gy = node.gySum / node.geoCount;
      }
    });
    lines.forEach(line => {
      const ids = rootSequence(line, { stationRoot });
      if (roots.has(ids[0])) roots.get(ids[0]).terminal = true;
      if (roots.has(ids[ids.length - 1])) roots.get(ids[ids.length - 1]).terminal = true;
    });
    return { stations:roots, stationRoot };
  }

  function rootSequence(line, model) {
    const out = [];
    (line.stationIds || []).forEach(id => {
      const root = model.stationRoot.get(id) || id;
      if (root && out[out.length - 1] !== root) out.push(root);
    });
    return out;
  }

  function pairKey(a, b) {
    return [sid(a), sid(b)].sort().join('~');
  }

  function buildGraphEdges(lines, model) {
    const edges = [];
    const seen = new Set();
    lines.forEach(line => {
      const ids = rootSequence(line, model);
      for (let i = 0; i < ids.length - 1; i++) add(ids[i], ids[i + 1], line);
      if (lineIsLoop(line) && ids.length > 2) add(ids[ids.length - 1], ids[0], line);
    });
    function add(a, b, line) {
      if (!a || !b || a === b) return;
      const key = pairKey(a, b);
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ a, b, lines:[line] });
    }
    return edges;
  }

  function buildSegmentOwners(lines, model) {
    const buckets = new Map();
    lines.forEach(line => {
      const ids = rootSequence(line, model);
      for (let i = 0; i < ids.length - 1; i++) add(ids[i], ids[i + 1], line);
      if (lineIsLoop(line) && ids.length > 2) add(ids[ids.length - 1], ids[0], line);
    });
    function add(a, b, line) {
      if (!a || !b || a === b) return;
      const key = pairKey(a, b);
      if (!buckets.has(key)) buckets.set(key, []);
      const list = buckets.get(key);
      if (!list.some(item => sid(item.id) === sid(line.id))) list.push(line);
    }
    const owners = new Map();
    buckets.forEach((list, key) => {
      list.sort((a, b) => {
        const aParent = sid(a.parentLineId || a.throughParentLineId);
        const bParent = sid(b.parentLineId || b.throughParentLineId);
        if (aParent === sid(b.id)) return 1;
        if (bParent === sid(a.id)) return -1;
        if (!!aParent !== !!bParent) return aParent ? 1 : -1;
        return compareLines(a, b);
      });
      owners.set(key, list[0]);
    });
    return owners;
  }

  function normalizeGeography(model, lines) {
    const count = Math.max(2, model.stations.size);
    const dense = count > 320 || lines.length > 20;
    const width = dense
      ? Math.max(2100, Math.min(4300, 1780 + count * 5.2 + lines.length * 42))
      : Math.max(1120, Math.min(3600, 820 + count * 13));
    const height = dense
      ? Math.max(1400, Math.min(2850, 1040 + Math.ceil(count / 7) * 22 + lines.length * 18))
      : Math.max(760, Math.min(2500, 540 + Math.ceil(count / 5) * 34));
    const nodes = Array.from(model.stations.values()).filter(node => Number.isFinite(node.gx) && Number.isFinite(node.gy));
    if (!nodes.length) seedByTopology(model, lines, width, height);
    else {
      const xs = nodes.map(node => node.gx).sort((a, b) => a - b);
      const ys = nodes.map(node => node.gy).sort((a, b) => a - b);
      const coreNodes = nodes.filter(node => node.lines && node.lines.size > 1);
      const coreXs = (coreNodes.length >= 6 ? coreNodes : nodes).map(node => node.gx).sort((a, b) => a - b);
      const coreYs = (coreNodes.length >= 6 ? coreNodes : nodes).map(node => node.gy).sort((a, b) => a - b);
      const minX = quantile(xs, dense ? 0.18 : 0.06);
      const maxX = quantile(xs, dense ? 0.82 : 0.94);
      const minY = quantile(ys, dense ? 0.18 : 0.06);
      const maxY = quantile(ys, dense ? 0.82 : 0.94);
      const centerX = quantile(coreXs, 0.50);
      const centerY = quantile(coreYs, 0.50);
      const spanX = Math.max(0.0001, maxX - minX);
      const spanY = Math.max(0.0001, maxY - minY);
      const padX = 146;
      const padY = 138;
      model.stations.forEach((node, index) => {
        const gx = Number.isFinite(node.gx) ? node.gx : (minX + maxX) / 2;
        const gy = Number.isFinite(node.gy) ? node.gy : (minY + maxY) / 2;
        const px = compressedPosition(gx, centerX, spanX, dense);
        const py = compressedPosition(centerY * 2 - gy, centerY, spanY, dense);
        node.gx = padX + px * (width - padX * 2);
        node.gy = padY + py * (height - padY * 2);
        node.tx = snap(node.gx + ((index % 5) - 2) * 0.2);
        node.ty = snap(node.gy + ((index % 7) - 3) * 0.2);
        keepInside(node, width, height);
      });
    }
    return { width, height };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const p = clamp(q, 0, 1) * (sorted.length - 1);
    const lo = Math.floor(p);
    const hi = Math.ceil(p);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
  }

  function compressedPosition(value, center, span, dense) {
    const half = Math.max(0.0001, span / 2);
    const z = (value - center) / half;
    const k = dense ? 3.35 : 1.35;
    const t = Math.tanh(k * z) / Math.tanh(k);
    return clamp(0.5 + t * 0.5, dense ? -0.005 : -0.08, dense ? 1.005 : 1.08);
  }

  function seedByTopology(model, lines, width, height) {
    const rows = Math.max(1, lines.length);
    lines.forEach((line, row) => {
      const ids = rootSequence(line, model);
      const y = rows === 1 ? height / 2 : 150 + (height - 300) * row / Math.max(1, rows - 1);
      ids.forEach((id, index) => {
        const node = model.stations.get(id);
        if (!node || node.__seeded) return;
        node.gx = 132 + (width - 264) * index / Math.max(1, ids.length - 1);
        node.gy = y;
        node.tx = snap(node.gx);
        node.ty = snap(node.gy);
        node.__seeded = true;
      });
    });
    model.stations.forEach((node, index) => {
      if (Number.isFinite(node.tx) && Number.isFinite(node.ty)) return;
      node.gx = 132 + (index % 12) * GRID;
      node.gy = 150 + Math.floor(index / 12) * GRID;
      node.tx = snap(node.gx);
      node.ty = snap(node.gy);
    });
  }

  function snap(value) {
    return Math.round(num(value) / GRID) * GRID;
  }

  function keepInside(node, width, height, snapToGrid = true) {
    node.tx = clamp(snapToGrid ? snap(node.tx) : node.tx, 72, width - 72);
    node.ty = clamp(snapToGrid ? snap(node.ty) : node.ty, 128, height - 86);
  }

  function solveLayout(model, lines, options, width, height) {
    const settings = cfg(options);
    const nodes = Array.from(model.stations.values());
    const edges = buildGraphEdges(lines, model);
    const ideal = settings.idealStationDistance;
    let iterations = 0;

    for (; iterations < settings.maxIterations; iterations++) {
      const move = new Map(nodes.map(node => [node.stationId, { x:0, y:0 }]));
      edges.forEach(edge => {
        const a = model.stations.get(edge.a);
        const b = model.stations.get(edge.b);
        if (!a || !b) return;
        const dx = b.tx - a.tx;
        const dy = b.ty - a.ty;
        const unit = octolinearUnit(dx, dy);
        const nx = -unit.y;
        const ny = unit.x;
        const off = dx * nx + dy * ny;
        const strength = 0.105;
        move.get(a.stationId).x += nx * off * strength;
        move.get(a.stationId).y += ny * off * strength;
        move.get(b.stationId).x -= nx * off * strength;
        move.get(b.stationId).y -= ny * off * strength;
      });

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.tx - a.tx;
          let dy = b.ty - a.ty;
          let d = Math.hypot(dx, dy);
          if (d < 0.01) {
            dx = ((i * 37 + j * 19) % 5 - 2) * GRID;
            dy = ((i * 17 + j * 43) % 5 - 2) * GRID;
            d = Math.max(1, Math.hypot(dx, dy));
          }
          const minGap = (a.lines.size > 1 || b.lines.size > 1) ? ideal * 1.12 : ideal * 0.78;
          if (d >= minGap) continue;
          const force = Math.min(10, (minGap - d) * 0.16);
          move.get(a.stationId).x -= dx / d * force;
          move.get(a.stationId).y -= dy / d * force;
          move.get(b.stationId).x += dx / d * force;
          move.get(b.stationId).y += dy / d * force;
        }
      }

      nodes.forEach(node => {
        const m = move.get(node.stationId);
        m.x += (node.gx - node.tx) * settings.anchorWeight * 0.075;
        m.y += (node.gy - node.ty) * settings.anchorWeight * 0.075;
        node.tx += clamp(m.x, -12, 12);
        node.ty += clamp(m.y, -12, 12);
        keepInside(node, width, height, false);
      });
    }

    nodes.forEach(node => keepInside(node, width, height, true));
    spreadDuplicateGridNodes(nodes, width, height);
    fitLayoutToCanvas(nodes, width, height);
    spreadDuplicateGridNodes(nodes, width, height);
    return {
      iterations,
      points:nodes.map(node => ({ stationId:node.stationId, tx:node.tx, ty:node.ty }))
    };
  }

  function octolinearUnit(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.001) return { x:1, y:0 };
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snapped = Math.round(angle / step) * step;
    const x = Math.cos(snapped);
    const y = Math.sin(snapped);
    if (Math.abs(x) < 0.001) return { x:0, y:y >= 0 ? 1 : -1 };
    if (Math.abs(y) < 0.001) return { x:x >= 0 ? 1 : -1, y:0 };
    const s = Math.SQRT1_2;
    return { x:x >= 0 ? s : -s, y:y >= 0 ? s : -s };
  }

  function fitLayoutToCanvas(nodes, width, height) {
    if (!nodes.length) return;
    const xs = nodes.map(node => node.tx).sort((a, b) => a - b);
    const ys = nodes.map(node => node.ty).sort((a, b) => a - b);
    const dense = nodes.length > 320;
    const minX = quantile(xs, dense ? 0.18 : 0.03);
    const maxX = quantile(xs, dense ? 0.82 : 0.97);
    const minY = quantile(ys, dense ? 0.18 : 0.03);
    const maxY = quantile(ys, dense ? 0.82 : 0.97);
    const spanX = Math.max(GRID, maxX - minX);
    const spanY = Math.max(GRID, maxY - minY);
    const targetX = Math.max(GRID, (width - 192) * (dense ? 0.78 : 0.82));
    const targetY = Math.max(GRID, (height - 224) * (dense ? 0.76 : 0.78));
    const scaleX = clamp(targetX / spanX, dense ? 0.72 : 0.92, dense ? 2.15 : 3.2);
    const scaleY = clamp(targetY / spanY, dense ? 0.72 : 0.92, dense ? 2.0 : 2.6);
    const cx = layoutCoreCenter(nodes, 'tx');
    const cy = layoutCoreCenter(nodes, 'ty');
    const targetCx = width / 2;
    const targetCy = (128 + height - 86) / 2;
    nodes.forEach(node => {
      node.tx = targetCx + (node.tx - cx) * scaleX;
      node.ty = targetCy + (node.ty - cy) * scaleY;
    });
    fitAllNodesInside(nodes, width, height, targetCx, targetCy);
    nodes.forEach(node => {
      node.tx = snap(node.tx);
      node.ty = snap(node.ty);
    });
    shiftNodesInside(nodes, width, height);
    nodes.forEach(node => keepInside(node, width, height, true));
  }

  function layoutCoreCenter(nodes, prop) {
    const core = nodes.filter(node => node.lines && node.lines.size > 1);
    const source = core.length >= 6 ? core : nodes;
    return quantile(source.map(node => node[prop]).sort((a, b) => a - b), 0.50);
  }

  function fitAllNodesInside(nodes, width, height, centerX, centerY) {
    const bounds = nodeBounds(nodes);
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scaleX = Math.min(1, (width - 144) / spanX);
    const scaleY = Math.min(1, (height - 214) / spanY);
    if (scaleX < 0.999 || scaleY < 0.999) {
      nodes.forEach(node => {
        node.tx = centerX + (node.tx - centerX) * scaleX;
        node.ty = centerY + (node.ty - centerY) * scaleY;
      });
    }
    shiftNodesInside(nodes, width, height);
  }

  function shiftNodesInside(nodes, width, height) {
    const bounds = nodeBounds(nodes);
    const minAllowedX = 72;
    const maxAllowedX = width - 72;
    const minAllowedY = 128;
    const maxAllowedY = height - 86;
    let dx = 0;
    let dy = 0;
    if (bounds.minX < minAllowedX) dx = minAllowedX - bounds.minX;
    if (bounds.maxX + dx > maxAllowedX) dx = maxAllowedX - bounds.maxX;
    if (bounds.minY < minAllowedY) dy = minAllowedY - bounds.minY;
    if (bounds.maxY + dy > maxAllowedY) dy = maxAllowedY - bounds.maxY;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    nodes.forEach(node => {
      node.tx += dx;
      node.ty += dy;
    });
  }

  function nodeBounds(nodes) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      minX = Math.min(minX, node.tx);
      maxX = Math.max(maxX, node.tx);
      minY = Math.min(minY, node.ty);
      maxY = Math.max(maxY, node.ty);
    });
    return { minX, maxX, minY, maxY };
  }

  function spreadDuplicateGridNodes(nodes, width, height) {
    const used = new Map();
    nodes.sort((a, b) => (b.lines.size - a.lines.size) || sid(a.stationId).localeCompare(sid(b.stationId))).forEach(node => {
      const baseX = node.tx;
      const baseY = node.ty;
      let placed = false;
      const options = [
        [0,0], [1,0], [-1,0], [0,1], [0,-1],
        [1,1], [-1,1], [1,-1], [-1,-1],
        [2,0], [-2,0], [0,2], [0,-2]
      ];
      for (const offset of options) {
        node.tx = clamp(baseX + offset[0] * GRID, 72, width - 72);
        node.ty = clamp(baseY + offset[1] * GRID, 128, height - 86);
        const key = `${node.tx},${node.ty}`;
        if (used.has(key)) continue;
        used.set(key, node.stationId);
        placed = true;
        break;
      }
      if (!placed) {
        const n = used.size;
        node.tx = clamp(snap(baseX + ((n % 7) - 3) * GRID), 72, width - 72);
        node.ty = clamp(snap(baseY + (Math.floor(n / 7) + 1) * GRID), 128, height - 86);
        used.set(`${node.tx},${node.ty}`, node.stationId);
      }
    });
  }

  function visualMetrics(stationCount, lineCount) {
    const large = stationCount > 420 || lineCount > 22;
    const medium = stationCount > 220 || lineCount > 14;
    return {
      lineWidth: large ? 5.4 : medium ? 6.1 : RENDER.lineWidth,
      lineUnderlay: large ? 10.0 : medium ? 11.2 : RENDER.lineUnderlay,
      stationR: large ? 3.2 : medium ? 4.2 : RENDER.stationR,
      stationStroke: large ? 1.15 : medium ? 1.45 : RENDER.stationStroke,
      transferInnerR: (large ? 3.2 : medium ? 4.2 : RENDER.stationR) * RENDER.transferInnerRatio,
      breakR: large ? 6.2 : medium ? 7.4 : RENDER.crossingGapR,
      labelStroke: large ? 1.7 : medium ? 2.2 : RENDER.labelStroke,
      titleSize: large ? 18 : medium ? 22 : 26,
      subtitleSize: large ? 9.5 : medium ? 10.5 : 12,
      labelFont: large ? 5.7 : medium ? 7.0 : 9.3,
      transferLabelFont: large ? 6.4 : medium ? 7.9 : 10.4,
      legendFont: large ? 8.8 : medium ? 10.5 : 12.5,
      legendLine: large ? 4.2 : medium ? 5.4 : 6.8,
      topPad: large ? 76 : medium ? 88 : 104
    };
  }

  function stationNodes(model) {
    return Array.from(model.stations.values()).map(node => ({
      id:node.stationId,
      name:node.name,
      x:node.tx,
      y:node.ty,
      lines:node.lines,
      transfer:node.lines.size > 1 || node.members.size > 1,
      terminal:node.terminal
    }));
  }

  function lineFragments(line, model, owners) {
    const ids = rootSequence(line, model);
    if (lineIsLoop(line) && ids.length > 2) ids.push(ids[0]);
    const fragments = [];
    let current = [];
    let previousDir = '';

    for (let i = 0; i < ids.length - 1; i++) {
      const aId = ids[i], bId = ids[i + 1];
      const owner = owners.get(pairKey(aId, bId));
      if (!owner || sid(owner.id) !== sid(line.id)) {
        flush();
        continue;
      }
      const a = model.stations.get(aId);
      const b = model.stations.get(bId);
      if (!a || !b) {
        flush();
        continue;
      }
      const points = schematicSegmentPoints(
        { id:aId, x:a.tx, y:a.ty },
        { id:bId, x:b.tx, y:b.ty },
        previousDir
      );
      previousDir = lastDirection(points) || previousDir;
      appendPoints(current, points);
    }
    flush();
    return fragments;

    function flush() {
      if (current.length >= 2) fragments.push(sanitizeRoutePoints(enforceNoAcuteCorners(simplifyOrthogonalPoints(current))));
      current = [];
      previousDir = '';
    }
  }

  function schematicSegmentPoints(a, b, previousDir) {
    if (Math.abs(a.x - b.x) < 1) return [a, { id:b.id, x:a.x, y:b.y }];
    if (Math.abs(a.y - b.y) < 1) return [a, { id:b.id, x:b.x, y:a.y }];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const u = octolinearUnit(dx, dy);
    const nx = -u.y;
    const ny = u.x;
    const off = Math.abs(dx * nx + dy * ny);
    if (off <= GRID * 0.24) return [a, b];
    if (Math.abs(u.x) > 0 && Math.abs(u.y) > 0) {
      const sx = Math.sign(dx) || 1;
      const sy = Math.sign(dy) || 1;
      const d = Math.min(Math.abs(dx), Math.abs(dy));
      const bendA = { id:'', x:a.x + sx * d, y:a.y + sy * d, synthetic:true };
      const bendB = { id:'', x:b.x - sx * d, y:b.y - sy * d, synthetic:true };
      if (Math.hypot(b.x - bendA.x, b.y - bendA.y) >= GRID * 0.8) return [a, bendA, b];
      if (Math.hypot(a.x - bendB.x, a.y - bendB.y) >= GRID * 0.8) return [a, bendB, b];
    }
    let horizontalFirst = Math.abs(dx) >= Math.abs(dy);
    if (previousDir === 'H') horizontalFirst = true;
    if (previousDir === 'V') horizontalFirst = false;
    const bend = horizontalFirst
      ? { id:'', x:b.x, y:a.y, synthetic:true }
      : { id:'', x:a.x, y:b.y, synthetic:true };
    return [a, bend, b];
  }

  function appendPoints(target, points) {
    points.forEach(point => {
      const last = target[target.length - 1];
      if (last && Math.abs(last.x - point.x) < 0.1 && Math.abs(last.y - point.y) < 0.1) return;
      target.push(Object.assign({}, point));
    });
  }

  function lastDirection(points) {
    for (let i = points.length - 2; i >= 0; i--) {
      const a = points[i], b = points[i + 1];
      if (Math.abs(a.x - b.x) >= 1) return 'H';
      if (Math.abs(a.y - b.y) >= 1) return 'V';
    }
    return '';
  }

  function simplifyOrthogonalPoints(points) {
    const clean = [];
    points.forEach(point => {
      const last = clean[clean.length - 1];
      if (last && Math.abs(last.x - point.x) < 0.1 && Math.abs(last.y - point.y) < 0.1) return;
      clean.push(point);
    });
    if (clean.length <= 2) return clean;
    const out = [clean[0]];
    for (let i = 1; i < clean.length - 1; i++) {
      const a = out[out.length - 1], b = clean[i], c = clean[i + 1];
      const abH = Math.abs(a.y - b.y) < 0.1;
      const bcH = Math.abs(b.y - c.y) < 0.1;
      const abV = Math.abs(a.x - b.x) < 0.1;
      const bcV = Math.abs(b.x - c.x) < 0.1;
      if ((abH && bcH) || (abV && bcV)) continue;
      out.push(b);
    }
    out.push(clean[clean.length - 1]);
    return out;
  }

  function roundedOrthogonalPath(points, radius) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${round(points[0].x)} ${round(points[0].y)}`;
    let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], cur = points[i], next = points[i + 1];
      const v1 = unit(cur.x - prev.x, cur.y - prev.y);
      const v2 = unit(next.x - cur.x, next.y - cur.y);
      const len1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const len2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const dot = v1.x * v2.x + v1.y * v2.y;
      if (dot > 0.985 || dot < -0.985 || len1 < 4 || len2 < 4) {
        d += ` L ${round(cur.x)} ${round(cur.y)}`;
        continue;
      }
      const r = Math.min(radius, len1 / 2 - 1, len2 / 2 - 1);
      if (r < 3) {
        d += ` L ${round(cur.x)} ${round(cur.y)}`;
        continue;
      }
      const p1 = { x:cur.x - v1.x * r, y:cur.y - v1.y * r };
      const p2 = { x:cur.x + v2.x * r, y:cur.y + v2.y * r };
      d += ` L ${round(p1.x)} ${round(p1.y)} Q ${round(cur.x)} ${round(cur.y)} ${round(p2.x)} ${round(p2.y)}`;
    }
    const last = points[points.length - 1];
    d += ` L ${round(last.x)} ${round(last.y)}`;
    return d;
  }

  function unit(x, y) {
    const len = Math.hypot(x, y) || 1;
    return { x:x / len, y:y / len };
  }

  function cornerAngleDeg(prev, cur, next) {
    const ax = prev.x - cur.x;
    const ay = prev.y - cur.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 0.1 || lb < 0.1) return 180;
    const dot = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
    return Math.acos(dot) * 180 / Math.PI;
  }

  function hasAcuteCorner(prev, cur, next) {
    return cornerAngleDeg(prev, cur, next) < 89.5;
  }

  function enforceNoAcuteCorners(points) {
    if (points.length < 3) return points;
    let out = removeBacktrackSpurs(simplifyOrthogonalPoints(points));
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let i = 1; i < out.length - 1; i++) {
        const prev = out[i - 1];
        const cur = out[i];
        const next = out[i + 1];
        if (!hasAcuteCorner(prev, cur, next)) continue;
        const repair = acuteCornerRepair(prev, cur, next);
        if (repair.length) {
          out.splice(i + 1, 0, ...repair);
          changed = true;
          break;
        }
      }
      out = removeBacktrackSpurs(simplifyOrthogonalPoints(out));
      if (!changed) break;
    }
    return out;
  }

  function sanitizeRoutePoints(points) {
    let out = removeBacktrackSpurs(simplifyOrthogonalPoints(points));
    out = enforceNoAcuteCorners(out);
    return removeBacktrackSpurs(simplifyOrthogonalPoints(out));
  }

  function removeBacktrackSpurs(points) {
    if (points.length < 3) return points;
    let out = points.slice();
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (let i = 1; i < out.length - 1; i++) {
        const prev = out[i - 1];
        const cur = out[i];
        const next = out[i + 1];
        const nearReturn = Math.hypot(prev.x - next.x, prev.y - next.y) < 1;
        const needle = cornerAngleDeg(prev, cur, next) < 3;
        if (!nearReturn && !needle) continue;
        out.splice(i, 1);
        changed = true;
        break;
      }
      if (!changed) break;
      out = simplifyOrthogonalPoints(out);
    }
    return out;
  }

  function acuteCornerRepair(prev, cur, next) {
    const back = unit(prev.x - cur.x, prev.y - cur.y);
    const distance = clamp(Math.hypot(next.x - cur.x, next.y - cur.y) * 0.42, GRID * 0.75, GRID * 2.8);
    const dirs = [
      { x:1, y:0 }, { x:-1, y:0 }, { x:0, y:1 }, { x:0, y:-1 },
      { x:Math.SQRT1_2, y:Math.SQRT1_2 },
      { x:-Math.SQRT1_2, y:Math.SQRT1_2 },
      { x:Math.SQRT1_2, y:-Math.SQRT1_2 },
      { x:-Math.SQRT1_2, y:-Math.SQRT1_2 }
    ];
    const scored = [];
    dirs.forEach(dir => {
      if (back.x * dir.x + back.y * dir.y > 0.001) return;
      const q = { id:'', synthetic:true, x:snap(cur.x + dir.x * distance), y:snap(cur.y + dir.y * distance) };
      if (Math.hypot(q.x - cur.x, q.y - cur.y) < 1 || Math.hypot(q.x - next.x, q.y - next.y) < 1) return;
      const tail = schematicSegmentPoints(q, next, lastDirection([prev, cur, q])).slice(1);
      const candidate = [prev, cur, q].concat(tail);
      let acute = false;
      for (let i = 1; i < candidate.length - 1; i++) {
        if (hasAcuteCorner(candidate[i - 1], candidate[i], candidate[i + 1])) {
          acute = true;
          break;
        }
      }
      if (acute) return;
      const extra = Math.hypot(q.x - cur.x, q.y - cur.y) + Math.hypot(next.x - q.x, next.y - q.y);
      scored.push({ extra, points:[q].concat(tail.slice(0, -1)) });
    });
    scored.sort((a, b) => a.extra - b.extra);
    if (scored[0]) return scored[0].points;
    const perp = Math.abs(back.x) > Math.abs(back.y)
      ? { x:0, y:(next.y >= cur.y ? 1 : -1) || 1 }
      : { x:(next.x >= cur.x ? 1 : -1) || 1, y:0 };
    const q = { id:'', synthetic:true, x:snap(cur.x + perp.x * distance), y:snap(cur.y + perp.y * distance) };
    const r = { id:'', synthetic:true, x:snap(next.x + perp.x * distance), y:snap(next.y + perp.y * distance) };
    return [q, r];
  }

  function linePathSvg(line, fragments, metrics, mode, settings, underlay) {
    const stroke = underlay ? PAPER : mode === 'draft' ? '#111827' : (line.color || '#0a84ff');
    const width = underlay ? metrics.lineUnderlay : metrics.lineWidth;
    return fragments.map(points => {
      const d = roundedOrthogonalPath(points, settings.cornerRadius);
      return `<path d="${d}" fill="none" stroke="${esc(stroke)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
  }

  function lineSegmentList(lineFragmentsByLine) {
    const out = [];
    lineFragmentsByLine.forEach(item => {
      item.fragments.forEach(points => {
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i], b = points[i + 1];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 1) continue;
          out.push({ lineId:sid(item.line.id), x1:a.x, y1:a.y, x2:b.x, y2:b.y });
        }
      });
    });
    return out;
  }

  function nonTransferCrossings(segments) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i], b = segments[j];
        if (a.lineId === b.lineId) continue;
        const p = segmentIntersection(a, b);
        if (!p) continue;
        const key = `${Math.round(p.x / 12)},${Math.round(p.y / 12)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
    }
    return out;
  }

  function segmentIntersection(a, b) {
    const den = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
    if (Math.abs(den) < 0.0001) return null;
    const t = ((a.x1 - b.x1) * (b.y1 - b.y2) - (a.y1 - b.y1) * (b.x1 - b.x2)) / den;
    const u = ((a.x1 - b.x1) * (a.y1 - a.y2) - (a.y1 - b.y1) * (a.x1 - a.x2)) / den;
    if (t <= 0.12 || t >= 0.88 || u <= 0.12 || u >= 0.88) return null;
    return { x:a.x1 + t * (a.x2 - a.x1), y:a.y1 + t * (a.y2 - a.y1) };
  }

  function stationSvg(nodes, mode, metrics) {
    const stroke = mode === 'draft' || mode === 'points' ? '#111827' : '#111827';
    return nodes.map(node => {
      if (!node.transfer) return `<circle cx="${round(node.x)}" cy="${round(node.y)}" r="${metrics.stationR}" fill="${PAPER}" stroke="${stroke}" stroke-width="${metrics.stationStroke}"/>`;
      const w = Math.max(metrics.stationR * 3.2, 13);
      const h = Math.max(metrics.stationR * 1.75, 7);
      return `<rect x="${round(node.x - w / 2)}" y="${round(node.y - h / 2)}" width="${round(w)}" height="${round(h)}" rx="${round(h / 2)}" fill="${PAPER}" stroke="${stroke}" stroke-width="${metrics.stationStroke}"/>`;
    }).join('');
  }

  function incidentVectors(lineFragmentsByLine) {
    const map = new Map();
    lineFragmentsByLine.forEach(item => {
      item.fragments.forEach(points => {
        points.forEach((point, index) => {
          if (!point.id) return;
          if (!map.has(point.id)) map.set(point.id, []);
          const list = map.get(point.id);
          const prev = points[index - 1];
          const next = points[index + 1];
          if (prev) list.push({ x:point.x - prev.x, y:point.y - prev.y });
          if (next) list.push({ x:next.x - point.x, y:next.y - point.y });
        });
      });
    });
    return map;
  }

  function labelCandidates(node, vectors, metrics) {
    const list = vectors.get(node.id) || [];
    let vx = 0, vy = 0;
    list.forEach(v => { vx += v.x; vy += v.y; });
    if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01 && list[0]) {
      vx = list[0].x;
      vy = list[0].y;
    }
    const base = node.transfer ? metrics.transferLabelFont : metrics.labelFont;
    const gap = Math.max(10, metrics.stationR + 5);
    const horizontal = Math.abs(vx) > Math.abs(vy) * 1.2;
    const vertical = Math.abs(vy) > Math.abs(vx) * 1.2;
    if (horizontal) return [
      { x:0, y:-gap, anchor:'middle', size:base },
      { x:0, y:gap + base, anchor:'middle', size:base },
      { x:gap, y:base * .35, anchor:'start', size:base },
      { x:-gap, y:base * .35, anchor:'end', size:base }
    ];
    if (vertical) return [
      { x:gap, y:base * .35, anchor:'start', size:base },
      { x:-gap, y:base * .35, anchor:'end', size:base },
      { x:0, y:-gap, anchor:'middle', size:base },
      { x:0, y:gap + base, anchor:'middle', size:base }
    ];
    return [
      { x:gap, y:base * .35, anchor:'start', size:base },
      { x:-gap, y:base * .35, anchor:'end', size:base },
      { x:0, y:-gap, anchor:'middle', size:base },
      { x:0, y:gap + base, anchor:'middle', size:base }
    ];
  }

  function labelBox(x, y, text, anchor, size) {
    const width = Math.max(10, sid(text).length * size * 0.72);
    const height = size * 1.35;
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    return { left, right:left + width, top:y - height, bottom:y + height * 0.25 };
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function labelSvg(nodes, vectors, metrics, mode, settings) {
    if (mode !== 'final') return '';
    const placed = [];
    const ordered = nodes.slice().sort((a, b) => (b.transfer ? 1 : 0) - (a.transfer ? 1 : 0));
    const out = [];
    ordered.forEach(node => {
      const candidates = labelCandidates(node, vectors, metrics);
      let chosen = null;
      for (const c of candidates) {
        const x = node.x + c.x;
        const y = node.y + c.y;
        const box = labelBox(x, y, node.name, c.anchor, c.size);
        if (!settings.labelCollision || !placed.some(existing => intersects(existing, box))) {
          chosen = Object.assign({ x, y, box }, c);
          break;
        }
      }
      if (!chosen) {
        if (!node.transfer) return;
        const c = candidates[0];
        chosen = Object.assign({ x:node.x + c.x, y:node.y + c.y, box:labelBox(node.x + c.x, node.y + c.y, node.name, c.anchor, c.size) }, c);
      }
      placed.push(chosen.box);
      out.push(`<text x="${round(chosen.x)}" y="${round(chosen.y)}" text-anchor="${chosen.anchor}" font-size="${chosen.size}" font-weight="${node.transfer ? 820 : 620}" fill="${TEXT}" stroke="${PAPER}" stroke-width="${metrics.labelStroke}" paint-order="stroke" stroke-linejoin="round">${esc(node.name)}</text>`);
    });
    return out.join('');
  }

  function crossingBreakSvg(crossings, metrics) {
    return crossings.map(p => `<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${metrics.breakR}" fill="${PAPER}"/>`).join('');
  }

  function routeBadgeText(line) {
    const name = routeName(line).replace(/\s+/g, '');
    const numeric = name.match(/^(\d+[A-Za-z]?)(?:号线|线)?$/);
    if (numeric) return numeric[1].toUpperCase();
    const short = name.match(/^([A-Z]{1,3}\d*)线$/i);
    if (short) return short[1].toUpperCase();
    return name.replace(/线$/u, '').slice(0, 4);
  }

  function endpointBadges(lines, model, mode, metrics) {
    if (mode !== 'final') return '';
    const out = [];
    const placed = new Map();
    lines.forEach(line => {
      const ids = rootSequence(line, model);
      if (!ids.length) return;
      const badge = routeBadgeText(line);
      const color = line.color || '#0a84ff';
      [ids[0], ids[ids.length - 1]].forEach((id, index) => {
        const node = model.stations.get(id);
        if (!node) return;
        const key = `${Math.round(node.tx / 10)},${Math.round(node.ty / 10)}`;
        const n = placed.get(key) || 0;
        placed.set(key, n + 1);
        const x = round(node.tx + (index ? 11 : -11));
        const y = round(node.ty - 10 - n * 13);
        const w = Math.max(15, badge.length * 6.2 + 8);
        const h = 11.5;
        out.push(`<g opacity=".94"><rect x="${round(x - w / 2)}" y="${round(y - h / 2)}" width="${round(w)}" height="${h}" rx="2.2" fill="${esc(color)}"/><text x="${x}" y="${round(y + 3.3)}" text-anchor="middle" font-size="${metrics.legendFont}" font-weight="850" fill="#fff">${esc(badge)}</text></g>`);
      });
    });
    return out.join('');
  }

  function legendSvg(lines, width, height, mode, metrics) {
    if (mode !== 'final') return '';
    const legendX = 34;
    const rowH = lines.length > 22 ? 20 : 24;
    const legendY = height - Math.min(230, Math.max(88, Math.ceil(lines.length / 4) * rowH + 42));
    const legendCols = lines.length > 24 ? 5 : lines.length > 16 ? 4 : lines.length > 8 ? 3 : 2;
    const legendColW = Math.max(230, Math.floor((width - 72) / legendCols));
    const legendRows = Math.ceil(lines.length / legendCols);
    const items = lines.map((line, index) => {
      const col = index % legendCols;
      const row = Math.floor(index / legendCols);
      const x = legendX + col * legendColW;
      const y = legendY + 40 + row * rowH;
      return `<g><line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${esc(line.color || '#0a84ff')}" stroke-width="${metrics.legendLine}" stroke-linecap="round"/><text x="${x + 44}" y="${round(y + metrics.legendFont * .35)}" font-size="${metrics.legendFont}" font-weight="720" fill="${TEXT}">${esc(routeName(line))}</text></g>`;
    }).join('');
    return `<g><rect x="${legendX - 14}" y="${legendY}" width="${width - 40}" height="${legendRows * rowH + 54}" fill="${PAPER}" stroke="#e5e7eb" stroke-width="1" opacity=".94"/><text x="${legendX}" y="${legendY + 24}" font-size="${metrics.legendFont + 1}" font-weight="850" fill="${TEXT}">线路图例</text>${items}</g>`;
  }

  function gridSvg(width, height, metrics) {
    const out = [];
    const top = metrics.topPad + 20;
    for (let x = 64; x < width; x += GRID * 2) out.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${height - 78}"/>`);
    for (let y = top; y < height - 78; y += GRID * 2) out.push(`<line x1="30" y1="${y}" x2="${width - 30}" y2="${y}"/>`);
    return out.join('');
  }

  function topologySignature() {
    const s = state();
    const lineSig = (Array.isArray(s.lines) ? s.lines : []).map(line => [
      sid(line && line.id),
      sid(line && line.parentLineId),
      sid(line && line.throughParentLineId),
      sid(line && line.throughBranchLineId),
      Array.isArray(line && line.stationIds) ? line.stationIds.map(sid).join(',') : '',
      sid(line && line._topologyVersion),
      sid(line && line.color)
    ].join(':')).join('|');
    const stationSig = (Array.isArray(s.stations) ? s.stations : []).map(station => [
      sid(station && station.id),
      sid(station && station.name),
      Math.round(num(station && station.lat) * 1e6),
      Math.round(num(station && station.lng) * 1e6)
    ].join(':')).join('|');
    return `${lineSig}#${stationSig}`;
  }

  function buildSolvedLayout(options) {
    const lines = activeLines();
    const stations = stationMap();
    if (!lines.length) throw new Error('当前还没有可生成示意图的线路。');
    const model = buildDataModel(lines, stations);
    if (model.stations.size < 2) throw new Error('线路缺少有效车站，无法生成示意图。');
    const settings = cfg(options);
    const size = normalizeGeography(model, lines);
    const solve = solveLayout(model, lines, settings, size.width, size.height);
    return Object.assign({ lines, model, settings, solve }, size);
  }

  function buildSvg(options) {
    const mode = options && options.mode === 'points' ? 'points' : options && options.mode === 'draft' ? 'draft' : 'final';
    try {
      const layout = buildSolvedLayout(options);
      const { lines, model, width, height, settings, solve } = layout;
      const nodes = stationNodes(model);
      const metrics = visualMetrics(nodes.length, lines.length);
      const owners = buildSegmentOwners(lines, model);
      const lineFragmentsByLine = lines.map(line => ({ line, fragments:lineFragments(line, model, owners) }));
      const crossings = mode === 'points' ? [] : nonTransferCrossings(lineSegmentList(lineFragmentsByLine));
      const vectors = incidentVectors(lineFragmentsByLine);
      const transferCount = nodes.filter(n => n.transfer).length;
      const title = `${state().activeCityName || state().cityName || 'CityRail'} 线路示意图`;
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const modeName = mode === 'points' ? '拓扑点位预览' : mode === 'draft' ? '黑白拓扑线稿' : '拓扑成图';
      const titleY = metrics.topPad - 42;
      const subtitleY = metrics.topPad - 19;
      const linesSvg = mode === 'points' ? '' : `
  <g fill="none" opacity=".98">${lineFragmentsByLine.map(item => linePathSvg(item.line, item.fragments, metrics, mode, settings, true)).join('')}</g>
  <g fill="none">${lineFragmentsByLine.map(item => linePathSvg(item.line, item.fragments, metrics, mode, settings, false)).join('')}</g>
  <g>${crossingBreakSvg(crossings, metrics)}</g>`;
      const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <rect width="${width}" height="${height}" fill="#f7f8fa"/>
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" fill="${PAPER}" stroke="#eceff3" stroke-width="1"/>
  <text x="34" y="${titleY}" font-size="${metrics.titleSize}" font-weight="850" fill="${TEXT}">${esc(title)}</text>
  <text x="34" y="${subtitleY}" font-size="${metrics.subtitleSize}" font-weight="620" fill="${MUTED}">${esc(modeName)} · 弱地理锚定 · 八方向示意 · ${lines.length} 条线路 · ${nodes.length} 座车站 · ${transferCount} 座换乘站 · ${stamp}</text>
  <g opacity="${mode === 'points' ? '.12' : '.07'}" stroke="#dbe3ec" stroke-width="1">${gridSvg(width, height, metrics)}</g>
  ${linesSvg}
  <g>${stationSvg(nodes, mode, metrics)}</g>
  <g>${endpointBadges(lines, model, mode, metrics)}</g>
  <g>${labelSvg(nodes, vectors, metrics, mode, settings)}</g>
  ${legendSvg(lines, width, height, mode, metrics)}
</svg>`;
      return {
        ok:true,
        svg,
        title,
        width,
        height,
        mode,
        style:'orthogonal',
        lines:lines.length,
        stations:nodes.length,
        transfers:transferCount,
        nonTransferCrossings:crossings.length,
        solvedPoints:solve.points,
        iterations:solve.iterations,
        signature:topologySignature()
      };
    } catch(e) {
      return { ok:false, message:(e && e.message) || String(e) };
    }
  }

  function installStyle() {
    if (byId('cityrail-schematic-map-style')) return;
    const style = D.createElement('style');
    style.id = 'cityrail-schematic-map-style';
    style.textContent = `
      #ctrl-center-overlay:not([data-active-tab="schematic-map"]) .cr-sch-card{display:none!important;}
      #ctrl-center-overlay[data-active-tab="schematic-map"] #ctrl-content-grid>.ctrl-card:not(.cr-sch-card){display:none!important;}
      #ctrl-center-overlay[data-active-tab="schematic-map"] .cr-sch-card{display:block!important;grid-column:1 / -1;}
      .cr-sch-card{min-height:0;}
      .cr-sch-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px;}
      .cr-sch-title{font-size:18px;font-weight:900;color:var(--cr-chart-text,rgba(255,255,255,.94));letter-spacing:0;}
      .cr-sch-sub{font-size:12px;color:var(--cr-chart-text-faint,rgba(255,255,255,.48));margin-top:4px;}
      .cr-sch-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
      .cr-sch-tools button{height:32px;border:1px solid var(--cr-chart-border,rgba(255,255,255,.14));border-radius:8px;background:var(--cr-chart-panel,rgba(0,0,0,.22));color:var(--cr-chart-text-soft,rgba(255,255,255,.88));padding:0 10px;font-size:12px;font-weight:800;cursor:pointer;}
      .cr-sch-tools button.active,.cr-sch-tools button.primary{background:var(--cr-chart-express,#0A84FF);border-color:var(--cr-chart-express,#0A84FF);color:#fff;}
      .cr-sch-scroll{border:1px solid var(--cr-chart-border,rgba(255,255,255,.10));border-radius:8px;background:#e5e7eb;overflow:auto;max-height:calc(100dvh - 220px);min-height:520px;scrollbar-gutter:stable both-edges;overscroll-behavior:contain;}
      .cr-sch-canvas{width:max-content;min-width:100%;display:flex;align-items:flex-start;justify-content:center;padding:16px;}
      .cr-sch-canvas svg{display:block;max-width:none;box-shadow:0 18px 54px rgba(0,0,0,.28);}
      .cr-sch-empty{display:flex;align-items:center;justify-content:center;min-height:500px;color:rgba(15,23,42,.58);font-size:13px;font-weight:760;}
      html.cityrail-light-ui .cr-sch-scroll{background:#e5e7eb;}
      html.cityrail-light-ui .cr-sch-empty{color:rgba(15,23,42,.58);}
      @media(max-width:760px){.cr-sch-head{flex-direction:column;align-items:stretch}.cr-sch-tools{justify-content:flex-start}.cr-sch-scroll{min-height:420px;max-height:calc(100dvh - 260px)}}
    `;
    D.head.appendChild(style);
  }

  function ensureControlNav() {
    const nav = byId('ctrl-nav');
    if (!nav) return null;
    let btn = nav.querySelector('.ctrl-nav-item[data-tab="schematic-map"]');
    if (!btn) {
      btn = D.createElement('button');
      btn.className = 'ctrl-nav-item';
      btn.dataset.tab = 'schematic-map';
      btn.dataset.action = 'schematic-map';
      btn.title = '线路示意图';
      btn.setAttribute('aria-label', '线路示意图');
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h5c2.5 0 4 1.5 4 4v4c0 2.5 1.5 4 4 4h3"/><path d="M4 18h5c2.5 0 4-1.5 4-4v-4c0-2.5 1.5-4 4-4h3"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="6" r="1.5"/><circle cx="5" cy="18" r="1.5"/><circle cx="19" cy="18" r="1.5"/></svg>';
      nav.appendChild(btn);
    }
    return btn;
  }

  function ensureCard() {
    installStyle();
    ensureControlNav();
    const grid = byId('ctrl-content-grid');
    if (!grid) return null;
    let card = byId('cct-schematic-card');
    if (!card) {
      card = D.createElement('div');
      card.id = 'cct-schematic-card';
      card.className = 'ctrl-card full cr-sch-card';
      card.innerHTML = `
        <div class="cr-sch-head">
        <div><div class="cr-sch-title">线路示意图</div><div class="cr-sch-sub" id="cct-schematic-sub">弱地理锚定 · 八方向示意</div></div>
          <div class="cr-sch-tools">
            <button type="button" class="primary" data-sch-act="generate">生成</button>
            <button type="button" class="active" data-sch-mode="final">成图</button>
            <button type="button" data-sch-mode="draft">线稿</button>
            <button type="button" data-sch-mode="points">点位</button>
            <button type="button" data-sch-act="svg">导出 SVG</button>
            <button type="button" data-sch-act="png">导出 PNG</button>
          </div>
        </div>
        <div class="cr-sch-scroll"><div class="cr-sch-canvas" id="cct-schematic-canvas"><div class="cr-sch-empty">暂无成图</div></div></div>`;
      grid.appendChild(card);
    }
    return card;
  }

  function setModeButtons() {
    D.querySelectorAll('#cct-schematic-card [data-sch-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.schMode === currentMode);
    });
  }

  function showMessage(message) {
    if (typeof W.cityrailShowDialog === 'function') W.cityrailShowDialog(message, '线路示意图');
    else W.alert(message);
  }

  function render(force) {
    const card = ensureCard();
    if (!card) return false;
    const signature = `${currentMode}|${topologySignature()}`;
    if (!force && signature === lastRenderSignature && lastSvgText) return true;
    const result = buildSvg({ mode: currentMode });
    if (!result.ok) {
      showMessage(result.message || '无法生成线路示意图。');
      return false;
    }
    const canvas = byId('cct-schematic-canvas');
    const sub = byId('cct-schematic-sub');
    lastSvgText = result.svg;
    lastRenderSignature = signature;
    lastFileBase = `cityrail-schematic-${result.mode}-${new Date().toISOString().slice(0, 10)}`;
    if (canvas) canvas.innerHTML = result.svg;
    if (sub) {
      const modeName = result.mode === 'points' ? '点位' : result.mode === 'draft' ? '线稿' : '成图';
      sub.textContent = `${modeName} · ${result.lines} 条线路 · ${result.stations} 座车站 · ${result.transfers} 座换乘站 · ${result.iterations} 轮`;
    }
    setModeButtons();
    return true;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = D.createElement('a');
    a.href = url;
    a.download = filename;
    D.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function exportSvg() {
    if (!lastSvgText && !render(true)) return;
    downloadBlob(new Blob([lastSvgText], { type:'image/svg+xml;charset=utf-8' }), lastFileBase + '.svg');
  }

  function exportPng() {
    if (!lastSvgText && !render(true)) return;
    const image = new Image();
    const blob = new Blob([lastSvgText], { type:'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      const canvas = D.createElement('canvas');
      const match = lastSvgText.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/i);
      canvas.width = match ? Number(match[1]) : image.naturalWidth;
      canvas.height = match ? Number(match[2]) : image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(png => {
        if (png) downloadBlob(png, lastFileBase + '.png');
      }, 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      showMessage('PNG 导出失败，请先导出 SVG。');
    };
    image.src = url;
  }

  function activeTab() {
    const overlay = byId('ctrl-center-overlay');
    return overlay && overlay.getAttribute('data-active-tab') || '';
  }

  function bindEvents() {
    if (D.__cityrailSchematicMapEvents) return;
    D.__cityrailSchematicMapEvents = true;
    D.addEventListener('click', event => {
      const nav = event.target && event.target.closest && event.target.closest('#ctrl-nav .ctrl-nav-item[data-tab="schematic-map"]');
      if (nav) {
        setTimeout(() => render(true), 0);
        return;
      }
      const modeButton = event.target && event.target.closest && event.target.closest('#cct-schematic-card [data-sch-mode]');
      if (modeButton) {
        currentMode = modeButton.dataset.schMode || 'final';
        render(true);
        return;
      }
      const action = event.target && event.target.closest && event.target.closest('#cct-schematic-card [data-sch-act]');
      if (!action) return;
      const act = action.dataset.schAct;
      if (act === 'generate') render(true);
      else if (act === 'svg') exportSvg();
      else if (act === 'png') exportPng();
    }, true);
  }

  function registerControlPanel() {
    const api = W.CityRailControlCenterSystem || W.CityRailControlCenterRenderer;
    if (!api || typeof api.registerPanel !== 'function') return false;
    api.registerPanel('schematic-map', {
      order:96,
      ensure:ensureCard,
      render:() => {
        ensureCard();
        if (activeTab() === 'schematic-map') render(false);
      }
    });
    if (typeof api.registerScrollSurface === 'function') api.registerScrollSurface('schematic-map', '.cr-sch-scroll');
    return true;
  }

  function open() {
    const ctrl = byId('btn-ctrl-center');
    if (ctrl) ctrl.click();
    ensureCard();
    const nav = ensureControlNav();
    if (nav) nav.click();
    return render(true);
  }

  function boot() {
    installStyle();
    ensureControlNav();
    ensureCard();
    bindEvents();
    registerControlPanel();
  }

  W.CityRailSchematicMap = {
    version:VERSION,
    boot,
    open,
    buildSvg,
    exportSvg,
    exportPng,
    solvePoints:function(options){
      const layout = buildSolvedLayout(options || {});
      return layout.solve.points.slice();
    },
    config:function(){ return cfg(); },
    report:function(){
      return {
        version:VERSION,
        controlPanel:!!byId('cct-schematic-card'),
        nav:!!(byId('ctrl-nav') && byId('ctrl-nav').querySelector('[data-tab="schematic-map"]')),
        lastMode:currentMode,
        hasSvg:!!lastSvgText,
        signature:lastRenderSignature
      };
    }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
  [400, 1400, 3200].forEach(ms => W.setTimeout(boot, ms));
  try { W.addEventListener('cityrail-save-loaded', () => W.setTimeout(boot, 0)); } catch(e) {}
})();
