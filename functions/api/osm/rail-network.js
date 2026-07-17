import { handleOptions } from '../../_shared/cityrail-cloudflare.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const USER_AGENT = 'CityRailGame/1.0 (+https://cityrailgame.com)';
const ROUTE_RE = /^(subway|light_rail|monorail|tram|train|rail)$/i;
const URBAN_ROUTE_RE = /^(subway|light_rail|monorail|tram)$/i;
const REGIONAL_URBAN_RAIL_RE = /地铁|軌道交通|轨道交通|市域|市郊|城际|城際|城郊|通勤|机场线|机场快线|空港|快线|捷运|磁浮|磁悬浮|云巴|有轨|tram|metro|subway|mrt|lrt|urban rail|commuter|suburban|intercity|airport|express|rapid transit|regional rail|\b[SR]\s*\d+\b/i;
const NON_URBAN_RAIL_RE = /货运|货物|货线|货车|货运铁路|专用线|支线货运|高速铁路|高铁|客运专线|普速铁路|干线铁路|national rail|freight|cargo|high[-\s]?speed|bullet train|mainline|main line|long[-\s]?distance/i;
const STOP_ROLE_RE = /stop|platform|station|halt/i;
const STOP_TAG_RE = /station|stop_position|platform|halt|tram_stop/i;
const NON_OPERATING_RE = /已停运|停运|暫停|暂停|未开通|未開通|规划|規劃|建设中|建設中|under construction|planned|proposed|abandoned|disused|closed/i;
const MAX_BBOX_SPAN = 1.9;
const MAX_ROUTES = 80;
const MAX_RELATIONS_TO_FETCH = 80;
const RELATION_BATCH_SIZE = 3;
const RELATION_BATCH_CONCURRENCY = 2;
const MAX_SEGMENT_WAYPOINTS = 18;
const MIN_POINT_DISTANCE_M = 55;
const SIMPLIFY_TOLERANCE_M = 42;
const LOOP_CLOSE_MAX_M = 180;
const LOOP_SAME_TERMINAL_MAX_M = 2000;
const ORDERED_WAY_JOIN_MAX_M = 350;
const MAX_SEGMENT_DETOUR_RATIO = 4.5;
const MAX_SEGMENT_DETOUR_EXTRA_M = 4500;
const SNAPSHOT_BBOXES = new Map([
  ['31.05,121.25,31.45,121.65', 'shanghai.json'],
  ['39.55,115.85,40.3,117.05', 'beijing.json'],
  ['22.75,113.05,23.55,113.85', 'guangzhou.json'],
  ['22.35,113.7,22.9,114.65', 'shenzhen.json'],
  ['30.35,103.75,30.95,104.35', 'chengdu.json'],
  ['29.35,106.2,29.85,106.85', 'chongqing.json'],
  ['30.3,114,30.8,114.65', 'wuhan.json'],
  ['31.85,118.55,32.2,119.05', 'nanjing.json'],
  ['30.05,119.95,30.45,120.45', 'hangzhou.json'],
  ['34.05,108.65,34.45,109.25', 'xian.json'],
  ['31.05,120.35,31.55,120.95', 'suzhou.json'],
  ['38.85,116.85,39.35,117.65', 'tianjin.json'],
  ['34.5,113.35,34.95,114.1', 'zhengzhou.json'],
  ['35.85,119.85,36.45,120.75', 'qingdao.json'],
  ['27.95,112.65,28.4,113.25', 'changsha.json'],
  ['41.55,123.15,42.05,123.75', 'shenyang.json'],
  ['38.75,121.25,39.15,122.1', 'dalian.json'],
]);
const snapshotCache = new Map();

function jsonResponse(data, status = 200, maxAge = 300) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
}

function num(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bboxFromUrl(url) {
  const bbox = String(url.searchParams.get('bbox') || '').split(',').map(v => num(v.trim()));
  if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))) return null;
  const [south, west, north, east] = bbox;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  if (south >= north || west >= east) return null;
  if ((north - south) > MAX_BBOX_SPAN || (east - west) > MAX_BBOX_SPAN) return null;
  return bbox.map(v => Math.round(v * 1000000) / 1000000);
}

function bboxKey(bbox) {
  return (bbox || []).map(v => String(Number(v))).join(',');
}

async function snapshotForBbox(bbox) {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return null;
  const file = SNAPSHOT_BBOXES.get(bboxKey(bbox));
  if (!file) return null;
  if (snapshotCache.has(file)) return snapshotCache.get(file);
  try {
    const [{ default: fs }, { default: path }] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    const fullPath = path.join(process.cwd(), 'fixtures', 'real-network', file);
    const data = JSON.parse(await fs.readFile(fullPath, 'utf8'));
    const normalized = normalizeNetworkResponse(data);
    snapshotCache.set(file, normalized);
    return normalized;
  } catch {
    return null;
  }
}

function relationSummaryQuery(bbox) {
  const box = bbox.join(',');
  return `[out:json][timeout:30];
  relation["type"="route"]["route"~"^(subway|light_rail|monorail|tram|train|rail)$"](${box});
out tags;`;
}

function relationDetailQuery(ids) {
  return `[out:json][timeout:55];
relation(id:${ids.join(',')});
(._;>;);
out body geom;`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 95000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller && controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function meters(a, b) {
  if (!a || !b) return Infinity;
  const r = 6371000;
  const lat1 = num(a.lat) * Math.PI / 180;
  const lat2 = num(b.lat) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (num(b.lng) - num(a.lng)) * Math.PI / 180;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

function displayName(tags, fallback) {
  const t = tags || {};
  return String(t['name:zh'] || t['name:zh-Hans'] || t.name || t['name:en'] || t.ref || fallback || '').trim();
}

function stationDisplayName(tags) {
  const t = tags || {};
  return String(t['name:zh'] || t['name:zh-Hans'] || t.name || t['name:en'] || '').trim();
}

function isGenericPlatformName(name) {
  const raw = String(name || '').trim();
  if (!raw) return true;
  if (/^(?:\d+(?:[-~–—]\d+)?|[一二三四五六七八九十]+)(?:号|號)?(?:站台|月台|platform)?$/i.test(raw)) return true;
  if (/(?:^|[\s/／、,，])(?:[A-Z]?\d+(?:[-~–—]\d+)?|[一二三四五六七八九十]+)(?:号|號)?(?:站台|月台)(?:$|[\s/／、,，])/i.test(raw)) return true;
  if (/^(?:站台|月台|platform)\b/i.test(raw)) return true;
  return false;
}

export function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/站$/u, '')
    .replace(/Station$/i, '')
    .replace(/[()（）［］\[\]【】]/g, '')
    .toLowerCase();
}

function routeLoopNameHint(route) {
  const text = [
    route && route.name,
    route && route.ref,
    route && route.description,
    route && route.loopMode,
    route && route.loopReason,
  ].filter(Boolean).join(' ');
  return /环线|環線|外环|外環|内环|內環|环状|環狀|外圈|内圈|loop|circle|circular/i.test(text);
}

function routeNameClosedTerminal(route) {
  const raw = String(route && route.name || '').trim();
  const service = raw.split(/[：:]/).slice(1).join(':') || raw;
  const match = service.match(/^\s*(.+?)\s*(?:->|→|－|—|–|-|至)\s*(.+?)\s*(?:[（(].*)?$/u);
  if (!match) return false;
  return !!cleanName(match[1]) && cleanName(match[1]) === cleanName(match[2]);
}

function routeClosureWaypointCount(route) {
  const stationCount = Array.isArray(route && route.stations) ? route.stations.length : 0;
  if (stationCount < 3 || !Array.isArray(route && route.waypoints)) return 0;
  const closureSegIdx = stationCount - 1;
  return route.waypoints.filter(w => Math.round(num(w && w.segIdx, -1)) === closureSegIdx).length;
}

function routePathLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) length += meters(points[i], points[i + 1]);
  return length;
}

function segmentGeometryIsValid(from, to, waypoints) {
  if (!Array.isArray(waypoints) || !waypoints.length) return true;
  const direct = meters(from, to);
  if (!Number.isFinite(direct) || direct <= 0) return true;
  const pathLength = routePathLength([from, ...waypoints, to]);
  if (!Number.isFinite(pathLength) || pathLength <= 0) return true;
  return pathLength <= Math.max(direct * MAX_SEGMENT_DETOUR_RATIO, direct + MAX_SEGMENT_DETOUR_EXTRA_M);
}

function normalizeRouteWaypoints(route) {
  const stations = Array.isArray(route && route.stations) ? route.stations : [];
  const waypoints = Array.isArray(route && route.waypoints) ? route.waypoints : [];
  if (stations.length < 2 || !waypoints.length) return waypoints;
  const kept = [];
  for (let segIdx = 0; segIdx < stations.length - 1; segIdx++) {
    const segmentWaypoints = waypoints
      .filter(w => Math.round(num(w && w.segIdx, -1)) === segIdx)
      .sort((a, b) => num(a && a.order, 0) - num(b && b.order, 0));
    if (segmentGeometryIsValid(stations[segIdx], stations[segIdx + 1], segmentWaypoints)) kept.push(...segmentWaypoints);
  }
  const closureSegIdx = stations.length - 1;
  waypoints
    .filter(w => Math.round(num(w && w.segIdx, -1)) >= closureSegIdx)
    .forEach(w => kept.push(w));
  return kept.length === waypoints.length ? waypoints : kept;
}

function normalizedLoopRoute(route) {
  if (!route || typeof route !== 'object') return route;
  const stations = Array.isArray(route.stations) ? route.stations : [];
  if (stations.length < 3) return route;
  const first = stations[0];
  const last = stations[stations.length - 1];
  const terminalDistanceM = meters(first, last);
  const repeatedTerminal = cleanName(first && first.name) && cleanName(first && first.name) === cleanName(last && last.name) && terminalDistanceM <= LOOP_SAME_TERMINAL_MAX_M;
  const adjacentLoopTerminal = terminalDistanceM <= LOOP_SAME_TERMINAL_MAX_M && routeLoopNameHint(route);
  const explicitClosedName = routeNameClosedTerminal(route);
  const closureWaypoints = routeClosureWaypointCount(route);
  const isLoop = !!(route.isLoop || route.loopMode === 'closed-ring' || route.closedLoop || route.isCircular || repeatedTerminal || adjacentLoopTerminal || explicitClosedName || closureWaypoints > 0);
  if (!isLoop) return route;
  const next = { ...route };
  next.isLoop = true;
  next.loopMode = 'closed-ring';
  next.loopTerminalDistanceM = Number.isFinite(terminalDistanceM) ? Math.round(terminalDistanceM) : next.loopTerminalDistanceM;
  if (!next.loopReason) {
    next.loopReason = repeatedTerminal
      ? 'snapshot-repeated-terminal'
      : (explicitClosedName ? 'snapshot-closed-terminal-name' : (closureWaypoints > 0 ? 'snapshot-closure-waypoints' : 'snapshot-adjacent-loop-terminals'));
  }
  return next;
}

function normalizedNetworkRoute(route) {
  const loopNormalized = normalizedLoopRoute(route);
  if (!loopNormalized || typeof loopNormalized !== 'object') return loopNormalized;
  const waypoints = normalizeRouteWaypoints(loopNormalized);
  return waypoints === loopNormalized.waypoints ? loopNormalized : { ...loopNormalized, waypoints };
}

function normalizeNetworkRoutes(routes) {
  return Array.isArray(routes) ? routes.map(normalizedNetworkRoute) : [];
}

function normalizeNetworkResponse(data) {
  if (!data || typeof data !== 'object') return data;
  return { ...data, routes: normalizeNetworkRoutes(data.routes) };
}

function normalizeColor(value) {
  const raw = String(value || '').trim();
  const hex = raw.match(/^#?[0-9a-f]{6}$/i);
  if (hex) return '#' + raw.replace('#', '').toLowerCase();
  const shortHex = raw.match(/^#?[0-9a-f]{3}$/i);
  if (!shortHex) return null;
  const s = raw.replace('#', '').toLowerCase();
  return '#' + s.split('').map(ch => ch + ch).join('');
}

function relationText(tags, name = '') {
  const t = tags || {};
  return [
    name,
    t['name:zh'],
    t['name:zh-Hans'],
    t.name,
    t['name:en'],
    t.ref,
    t.network,
    t.operator,
    t.description,
    t.from,
    t.to,
  ].filter(Boolean).join(' ');
}

function isUrbanRailRouteTags(tags, name = '') {
  const route = String(tags && tags.route || '').trim();
  if (!ROUTE_RE.test(route)) return false;
  const raw = relationText(tags, name);
  if (NON_OPERATING_RE.test(raw)) return false;
  if (URBAN_ROUTE_RE.test(route)) return true;
  if (NON_URBAN_RAIL_RE.test(raw) && !REGIONAL_URBAN_RAIL_RE.test(raw)) return false;
  return REGIONAL_URBAN_RAIL_RE.test(raw);
}

function isTrainServiceRef(tags) {
  const route = String(tags && tags.route || '').trim().toLowerCase();
  if (route !== 'train' && route !== 'rail') return false;
  const ref = String(tags && tags.ref || '').trim();
  if (!ref) return false;
  return /^(?:[CGDKTZ]\s*\d+[A-Z]?|\d{3,5})(?:\s*[;,/]\s*(?:[CGDKTZ]\s*)?\d+[A-Z]?)*$/i.test(ref);
}

export function mapsFromElements(elements) {
  const nodes = new Map();
  const ways = new Map();
  const relations = [];
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || !el.type) continue;
    if (el.type === 'node') nodes.set(el.id, el);
    else if (el.type === 'way') ways.set(el.id, el);
    else if (el.type === 'relation') relations.push(el);
  }
  return { nodes, ways, relations };
}

function pointFromElement(el) {
  if (!el) return null;
  const lat = num(el.lat, NaN);
  const lng = num(el.lon ?? el.lng, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const geom = Array.isArray(el.geometry) ? el.geometry : [];
  if (!geom.length) return null;
  const sum = geom.reduce((acc, p) => {
    acc.lat += num(p.lat, 0);
    acc.lng += num(p.lon ?? p.lng, 0);
    return acc;
  }, { lat: 0, lng: 0 });
  return { lat: sum.lat / geom.length, lng: sum.lng / geom.length };
}

function wayGeometry(way) {
  return (Array.isArray(way && way.geometry) ? way.geometry : [])
    .map(p => ({ lat: num(p.lat, NaN), lng: num(p.lon ?? p.lng, NaN) }))
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function stationCandidate(member, maps) {
  if (!member) return null;
  let el = null;
  if (member.type === 'node') el = maps.nodes.get(member.ref);
  else if (member.type === 'way') el = maps.ways.get(member.ref);
  if (!el) return null;
  const tags = el.tags || {};
  const role = String(member.role || '');
  const isStop = STOP_ROLE_RE.test(role)
    || STOP_TAG_RE.test(String(tags.railway || ''))
    || STOP_TAG_RE.test(String(tags.public_transport || ''))
    || STOP_TAG_RE.test(String(tags.station || ''));
  if (!isStop) return null;
  const point = pointFromElement(el);
  const name = stationDisplayName(tags);
  if (!point || !name || isGenericPlatformName(name)) return null;
  return { osmType: member.type, osmId: member.ref, role, name, lat: point.lat, lng: point.lng };
}

function mergeStopCandidates(stops) {
  const out = [];
  for (const stop of stops) {
    const key = cleanName(stop.name);
    const existing = out.find(item =>
      (key && cleanName(item.name) === key && meters(item, stop) < 650)
      || meters(item, stop) < 65
      || (item.osmType === stop.osmType && item.osmId === stop.osmId)
    );
    if (existing) {
      existing.lat = (existing.lat + stop.lat) / 2;
      existing.lng = (existing.lng + stop.lng) / 2;
      existing.osmRefs.push(`${stop.osmType}/${stop.osmId}`);
    } else {
      out.push({ ...stop, osmRefs: [`${stop.osmType}/${stop.osmId}`] });
    }
  }
  return out;
}

function thinNearbyPoints(points, minMeters) {
  const out = [];
  for (const p of points) {
    if (!out.length || meters(out[out.length - 1], p) >= minMeters) out.push(p);
  }
  return out;
}

const MAX_STOP_GRAPH_SNAP_M = 1800;

function graphPointKey(point) {
  return `${Math.round(num(point && point.lat, 0) * 1e7)}:${Math.round(num(point && point.lng, 0) * 1e7)}`;
}

function buildWayGraph(members, ways) {
  const nodes = [];
  const indexByKey = new Map();
  function nodeIndex(point) {
    const key = graphPointKey(point);
    let index = indexByKey.get(key);
    if (index != null) return index;
    index = nodes.length;
    indexByKey.set(key, index);
    nodes.push({ lat: point.lat, lng: point.lng, edges: [] });
    return index;
  }
  for (const member of Array.isArray(members) ? members : []) {
    if (!member || member.type !== 'way' || STOP_ROLE_RE.test(String(member.role || ''))) continue;
    const pts = thinNearbyPoints(wayGeometry(ways.get(member.ref)), 3);
    if (pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = nodeIndex(pts[i]);
      const b = nodeIndex(pts[i + 1]);
      if (a === b) continue;
      const weight = meters(nodes[a], nodes[b]);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      nodes[a].edges.push({ to: b, weight });
      nodes[b].edges.push({ to: a, weight });
    }
  }
  assignGraphComponents(nodes);
  return nodes;
}

function appendOrderedWayPoints(out, points) {
  if (!Array.isArray(points) || points.length < 2) return { ok: false, distanceM: Infinity };
  let pts = points;
  let distanceM = 0;
  if (out.length) {
    const tail = out[out.length - 1];
    const forward = meters(tail, pts[0]);
    const reverse = meters(tail, pts[pts.length - 1]);
    if (reverse < forward) pts = pts.slice().reverse();
    distanceM = Math.min(forward, reverse);
    const connected = graphPointKey(tail) === graphPointKey(pts[0]) || distanceM <= 3;
    pts = connected ? pts.slice(1) : pts;
  }
  pts.forEach(point => out.push(point));
  return { ok: true, distanceM };
}

function routePathSupportsClosedService(points, stops) {
  if (!Array.isArray(points) || points.length < 4 || meters(points[0], points[points.length - 1]) > LOOP_CLOSE_MAX_M) return false;
  const projected = projectStopsOntoPath(points, stops);
  if (!projected || projected.length < 3) return false;
  return true;
}

function orderedMemberPoints(members, ways, tags, stops) {
  const points = [];
  let wayCount = 0;
  let disconnected = 0;
  for (const member of Array.isArray(members) ? members : []) {
    if (!member || member.type !== 'way' || STOP_ROLE_RE.test(String(member.role || ''))) continue;
    const pts = thinNearbyPoints(wayGeometry(ways.get(member.ref)), 3);
    if (pts.length < 2) continue;
    const appended = appendOrderedWayPoints(points, pts);
    if (!appended.ok) continue;
    if (wayCount > 0 && appended.distanceM > ORDERED_WAY_JOIN_MAX_M) disconnected++;
    wayCount++;
    if (wayCount >= 3 && routePathSupportsClosedService(points, stops)) return { points: points.slice(), closedLoopMemberPath: true };
  }
  if (wayCount < 1 || points.length < 2 || disconnected > 0) return null;
  return { points, closedLoopMemberPath: false };
}

function projectStopsOntoPath(points, stops) {
  const projected = [];
  for (let stopIndex = 0; stopIndex < stops.length; stopIndex++) {
    const stop = stops[stopIndex];
    const snap = nearestPathPointIndex(points, stop);
    if (snap.index < 0 || snap.distanceM > MAX_STOP_GRAPH_SNAP_M) continue;
    projected.push({ stop, stopIndex, routeIndex: snap.index, distanceM: snap.distanceM });
  }
  if (projected.length < 2) return null;
  projected.sort((a, b) => a.routeIndex - b.routeIndex || a.distanceM - b.distanceM);
  return projected;
}

function pathSliceBetween(points, from, to) {
  if (!Array.isArray(points) || !points.length) return [];
  if (from < 0 || to < 0 || from >= points.length || to >= points.length) return [];
  if (to >= from) return points.slice(from, to + 1);
  const closed = meters(points[0], points[points.length - 1]) <= LOOP_CLOSE_MAX_M;
  if (closed) return points.slice(from).concat(points.slice(0, to + 1));
  return points.slice(to, from + 1).reverse();
}

function orderedMemberRoutePath(members, ways, stops, tags) {
  const ordered = orderedMemberPoints(members, ways, tags, stops);
  if (!ordered || !Array.isArray(ordered.points)) return null;
  const points = ordered.points;
  const projected = projectStopsOntoPath(points, stops);
  if (!projected) return null;
  stops.splice(0, stops.length, ...projected.map(item => item.stop));
  projected.forEach((item, index) => {
    stops[index]._graphRouteIndex = item.routeIndex;
    stops[index]._graphSnapDistanceM = item.distanceM;
  });
  function pathBetweenStops(fromStop, toStop) {
    const from = Math.round(num(fromStop && fromStop._graphRouteIndex, -1));
    const to = Math.round(num(toStop && toStop._graphRouteIndex, -1));
    return pathSliceBetween(points, from, to);
  }
  return { points, pathBetweenStops, source: 'relation-member-order', closedLoopMemberPath: !!ordered.closedLoopMemberPath };
}

function assignGraphComponents(graph) {
  let component = 0;
  for (let i = 0; i < graph.length; i++) {
    if (graph[i].component != null) continue;
    const queue = [i];
    graph[i].component = component;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const node = graph[queue[cursor]];
      for (const edge of node.edges || []) {
        const next = graph[edge.to];
        if (!next || next.component != null) continue;
        next.component = component;
        queue.push(edge.to);
      }
    }
    component++;
  }
}

function graphComponentIds(graph) {
  return Array.from(new Set((graph || []).map(node => node && node.component).filter(id => id != null)));
}

function nearestGraphNode(graph, target, component = null) {
  let index = -1;
  let distanceM = Infinity;
  for (let i = 0; i < graph.length; i++) {
    if (component != null && graph[i].component !== component) continue;
    const d = meters(graph[i], target);
    if (d < distanceM) {
      distanceM = d;
      index = i;
    }
  }
  return { index, distanceM };
}

function routeAnchorsForStops(graph, stops) {
  let best = null;
  for (const component of graphComponentIds(graph)) {
    const anchors = stops.map(stop => nearestGraphNode(graph, stop, component));
    if (anchors.some(anchor => anchor.index < 0 || anchor.distanceM > MAX_STOP_GRAPH_SNAP_M)) continue;
    const score = anchors.reduce((sum, anchor) => sum + anchor.distanceM, 0);
    if (!best || score < best.score) best = { anchors, score, component };
  }
  if (best) return best.anchors;
  return stops.map(stop => nearestGraphNode(graph, stop));
}

function heapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].cost <= item.cost) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = item;
}

function heapPop(heap) {
  if (!heap.length) return null;
  const top = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let i = 0;
    while (true) {
      let child = i * 2 + 1;
      if (child >= heap.length) break;
      if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
      if (heap[child].cost >= last.cost) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  return top;
}

function shortestGraphPath(graph, from, to) {
  if (!Array.isArray(graph) || from < 0 || to < 0 || from >= graph.length || to >= graph.length) return null;
  if (from === to) return [from];
  const dist = new Array(graph.length).fill(Infinity);
  const prev = new Array(graph.length).fill(-1);
  const heap = [];
  dist[from] = 0;
  heapPush(heap, { node: from, cost: 0 });
  while (heap.length) {
    const current = heapPop(heap);
    if (!current || current.cost !== dist[current.node]) continue;
    if (current.node === to) break;
    for (const edge of graph[current.node].edges || []) {
      const next = current.cost + edge.weight;
      if (next >= dist[edge.to]) continue;
      dist[edge.to] = next;
      prev[edge.to] = current.node;
      heapPush(heap, { node: edge.to, cost: next });
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const path = [];
  for (let node = to; node >= 0; node = prev[node]) {
    path.push(node);
    if (node === from) break;
  }
  return path[path.length - 1] === from ? path.reverse() : null;
}

function nearestPathPointIndex(points, target) {
  let index = -1;
  let distanceM = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = meters(points[i], target);
    if (d < distanceM) {
      distanceM = d;
      index = i;
    }
  }
  return { index, distanceM };
}

function terminalRoutePath(graph, anchors, stops, tags) {
  const fromIndex = terminalStopIndex(stops, terminalName(tags, 'from'));
  const toIndex = terminalStopIndex(stops, terminalName(tags, 'to'));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  const path = shortestGraphPath(graph, anchors[fromIndex].index, anchors[toIndex].index);
  if (!path || path.length < 2) return null;
  const points = path.map(nodeIndex => ({ lat: graph[nodeIndex].lat, lng: graph[nodeIndex].lng }));
  const projected = projectStopsOntoPath(points, stops);
  if (!projected) return null;
  stops.splice(0, stops.length, ...projected.map(item => item.stop));
  projected.forEach((item, index) => {
    stops[index]._graphRouteIndex = item.routeIndex;
    stops[index]._graphAnchorIndex = anchors[item.stopIndex] ? anchors[item.stopIndex].index : nearestGraphNode(graph, item.stop).index;
    stops[index]._graphSnapDistanceM = item.distanceM;
  });
  function pathBetweenStops(fromStop, toStop) {
    const from = Math.round(num(fromStop && fromStop._graphRouteIndex, -1));
    const to = Math.round(num(toStop && toStop._graphRouteIndex, -1));
    return pathSliceBetween(points, from, to);
  }
  return { points, pathBetweenStops };
}

function buildRouteGeometry(members, ways, stops, tags = {}) {
  const orderedGeometry = orderedMemberRoutePath(members, ways, stops, tags);
  if (orderedGeometry) return orderedGeometry;
  const graph = buildWayGraph(members, ways);
  if (graph.length < 2 || !Array.isArray(stops) || stops.length < 2) return null;
  const anchors = routeAnchorsForStops(graph, stops);
  if (anchors.some(anchor => anchor.index < 0 || anchor.distanceM > MAX_STOP_GRAPH_SNAP_M)) return null;
  anchors.forEach((anchor, index) => {
    stops[index]._graphAnchorIndex = anchor.index;
    stops[index]._graphSnapDistanceM = anchor.distanceM;
  });
  const terminalGeometry = terminalRoutePath(graph, anchors, stops, tags);
  if (terminalGeometry) return terminalGeometry;
  const points = [];
  function appendPath(fromStopIndex, toStopIndex) {
    const path = shortestGraphPath(graph, anchors[fromStopIndex].index, anchors[toStopIndex].index);
    if (!path || path.length < 2) return false;
    const startIndex = points.length;
    const slice = points.length && graphPointKey(points[points.length - 1]) === graphPointKey(graph[path[0]])
      ? path.slice(1)
      : path;
    slice.forEach(nodeIndex => points.push({ lat: graph[nodeIndex].lat, lng: graph[nodeIndex].lng }));
    if (stops[fromStopIndex]._graphRouteIndex == null) stops[fromStopIndex]._graphRouteIndex = startIndex;
    stops[toStopIndex]._graphRouteIndex = points.length - 1;
    return true;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    if (!appendPath(i, i + 1)) return null;
  }
  function pathBetweenStops(fromStop, toStop) {
    const fromIndex = Math.round(num(fromStop && fromStop._graphAnchorIndex, -1));
    const toIndex = Math.round(num(toStop && toStop._graphAnchorIndex, -1));
    if (fromIndex < 0 || toIndex < 0) return [];
    const path = shortestGraphPath(graph, fromIndex, toIndex);
    return path ? path.map(nodeIndex => ({ lat: graph[nodeIndex].lat, lng: graph[nodeIndex].lng })) : [];
  }
  return { points, pathBetweenStops };
}

function perpendicularDistanceM(point, start, end) {
  if (!start || !end) return 0;
  const latScale = 111320;
  const lngScale = Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180) * 111320;
  const x = (point.lng - start.lng) * lngScale;
  const y = (point.lat - start.lat) * latScale;
  const x2 = (end.lng - start.lng) * lngScale;
  const y2 = (end.lat - start.lat) * latScale;
  const len2 = x2 * x2 + y2 * y2;
  if (!len2) return Math.sqrt(x * x + y * y);
  const t = Math.max(0, Math.min(1, (x * x2 + y * y2) / len2));
  const px = t * x2;
  const py = t * y2;
  return Math.sqrt((x - px) ** 2 + (y - py) ** 2);
}

function simplifyPoints(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return points ? points.slice() : [];
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistanceM(points[i], start, end);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }
  if (maxDist <= tolerance) return [start, end];
  const left = simplifyPoints(points.slice(0, index + 1), tolerance);
  const right = simplifyPoints(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

function capPoints(points, maxCount) {
  if (points.length <= maxCount) return points;
  const out = [];
  const step = (points.length - 1) / Math.max(1, maxCount - 1);
  for (let i = 0; i < maxCount; i++) out.push(points[Math.round(i * step)]);
  return out;
}

function routeKey(tags, name) {
  const network = cleanName(tags && (tags.network || tags.operator || ''));
  const ref = isTrainServiceRef(tags) ? '' : cleanName(tags && tags.ref || '');
  const baseName = cleanName(String(name || '').split(/[:：]|=>|→|↔|-/)[0]);
  return [network, ref || baseName].filter(Boolean).join('|') || baseName;
}

function stationNameKeys(route) {
  return (Array.isArray(route && route.stations) ? route.stations : [])
    .map(st => cleanName(st && st.name))
    .filter(Boolean);
}

function routeTerminalKey(route) {
  const keys = stationNameKeys(route);
  if (keys.length < 2) return keys.join('|');
  return [keys[0], keys[keys.length - 1]].sort().join('|');
}

function sequenceKey(keys) {
  return (keys || []).join('>');
}

function routeOverlapRatio(aKeys, bKeys) {
  const a = new Set(aKeys || []);
  const b = new Set(bKeys || []);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach(key => { if (b.has(key)) shared++; });
  return shared / Math.min(a.size, b.size);
}

function stationSubsetOf(aKeys, bKeys) {
  const b = new Set(bKeys || []);
  return !!(aKeys && aKeys.length) && aKeys.every(key => b.has(key));
}

function sameRouteVariant(a, b) {
  const aKeys = stationNameKeys(a);
  const bKeys = stationNameKeys(b);
  if (aKeys.length < 2 || bKeys.length < 2) return false;
  const aSeq = sequenceKey(aKeys);
  const bSeq = sequenceKey(bKeys);
  if (aSeq === bSeq || aSeq === sequenceKey(bKeys.slice().reverse())) return true;
  if (stationSubsetOf(aKeys, bKeys) || stationSubsetOf(bKeys, aKeys)) return true;
  const sameTerminals = routeTerminalKey(a) === routeTerminalKey(b);
  const overlap = routeOverlapRatio(aKeys, bKeys);
  if (sameTerminals && overlap >= 0.86) return true;
  const regional = [a && a.route, b && b.route].some(route => /^(train|rail)$/i.test(String(route || '')))
    || [a && a.routeCategory, b && b.routeCategory].some(category => /^(suburban_rail|intercity_rail|regional_urban_rail)$/i.test(String(category || '')));
  return regional && sameTerminals && overlap >= 0.6;
}

function branchJunctionName(main, branch) {
  const mainKeys = new Set(stationNameKeys(main));
  const stations = Array.isArray(branch && branch.stations) ? branch.stations : [];
  const shared = stations.filter(st => mainKeys.has(cleanName(st && st.name)));
  if (!shared.length) return '';
  return String((shared[shared.length - 1] && shared[shared.length - 1].name) || '').trim();
}

function branchJunctionByDistance(main, branch) {
  const mainStations = Array.isArray(main && main.stations) ? main.stations : [];
  const branchStations = Array.isArray(branch && branch.stations) ? branch.stations : [];
  let best = null;
  mainStations.forEach(mainStation => {
    branchStations.forEach(branchStation => {
      const distanceM = meters(mainStation, branchStation);
      if (Number.isFinite(distanceM) && (!best || distanceM < best.distanceM)) best = { mainStation, branchStation, distanceM };
    });
  });
  return best && best.distanceM <= 800 ? best : null;
}

function routeNameLooksLoop(tags, name) {
  const raw = [
    name,
    tags && tags.name,
    tags && tags.ref,
    tags && tags.description,
  ].filter(Boolean).join(' ');
  return /环线|環線|环状|環状|循環|circle|circular|loop|ring|ringbahn/i.test(raw);
}

function terminalName(tags, key) {
  const value = tags && tags[key];
  return String(value || '').replace(/\s+/g, '').trim();
}

function terminalStopIndex(stops, terminal) {
  const key = cleanName(terminal);
  if (!key) return -1;
  let loose = -1;
  for (let i = 0; i < stops.length; i++) {
    const stopKey = cleanName(stops[i] && stops[i].name);
    if (!stopKey) continue;
    if (stopKey === key) return i;
    if (loose < 0 && (stopKey.includes(key) || key.includes(stopKey))) loose = i;
  }
  return loose;
}

function routeLooksOperating(route) {
  const raw = [
    route && route.name,
    route && route.ref,
    route && route.network,
    route && route.route,
  ].filter(Boolean).join(' ');
  return !NON_OPERATING_RE.test(raw);
}

function routeCategory(tags, name) {
  const route = String(tags && tags.route || '').trim().toLowerCase();
  const raw = relationText(tags, name);
  if (route === 'tram') return 'tram';
  if (route === 'light_rail') return /有轨|tram/i.test(raw) ? 'tram' : 'light_rail';
  if (route === 'monorail') return /磁浮|磁悬浮|maglev/i.test(raw) ? 'maglev' : 'monorail';
  if (/市域|市郊|城郊|通勤|commuter|suburban|regional rail/i.test(raw)) return 'suburban_rail';
  if (/城际|城際|intercity/i.test(raw)) return 'intercity_rail';
  if (route === 'subway') return 'metro';
  return 'regional_urban_rail';
}

function closedRoutePointDistance(points) {
  if (!Array.isArray(points) || points.length < 3) return Infinity;
  return meters(points[0], points[points.length - 1]);
}

function compactSegmentWaypoints(points, fromStop, toStop) {
  const seg = points.filter(p => meters(p, fromStop) >= MIN_POINT_DISTANCE_M && meters(p, toStop) >= MIN_POINT_DISTANCE_M);
  return capPoints(simplifyPoints(seg, SIMPLIFY_TOLERANCE_M), MAX_SEGMENT_WAYPOINTS);
}

export function parseRelation(relation, maps) {
  const tags = relation.tags || {};
  const name = displayName(tags, tags.ref ? `线路 ${tags.ref}` : 'OSM 线路');
  if (!isUrbanRailRouteTags(tags, name)) return null;
  const members = Array.isArray(relation.members) ? relation.members : [];
  let stops = mergeStopCandidates(members.map(member => stationCandidate(member, maps)).filter(Boolean));
  const geometry = buildRouteGeometry(members, maps.ways, stops, tags);
  if (stops.length < 2 || !geometry || !Array.isArray(geometry.points) || geometry.points.length < 2) return null;
  const routePoints = geometry.points;
  stops = stops.map(stop => {
    const routeIndex = Math.round(num(stop._graphRouteIndex, -1));
    const snapped = routePoints[routeIndex];
    if (!snapped) return null;
    return {
      ...stop,
      rawLat: stop.lat,
      rawLng: stop.lng,
      lat: snapped.lat,
      lng: snapped.lng,
      routeIndex,
    };
  }).filter(Boolean).sort((a, b) => a.routeIndex - b.routeIndex);
  stops = stops.filter((stop, index, arr) => {
    if (index === 0) return true;
    const prev = arr[index - 1];
    return cleanName(prev.name) !== cleanName(stop.name) || meters(prev, stop) >= 120;
  });
  if (stops.length < 2) return null;
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const terminalDistanceM = meters(firstStop, lastStop);
  const geometryClosedDistanceM = closedRoutePointDistance(routePoints);
  const loopByName = routeNameLooksLoop(tags, name);
  const sameTerminalName = !!cleanName(firstStop.name) && cleanName(firstStop.name) === cleanName(lastStop.name);
  const repeatedTerminal = stops.length >= 4 && sameTerminalName && terminalDistanceM <= LOOP_SAME_TERMINAL_MAX_M;
  const loopByTerminalDistance = terminalDistanceM <= LOOP_CLOSE_MAX_M;
  const loopByGeometry = geometryClosedDistanceM <= LOOP_CLOSE_MAX_M && (sameTerminalName || loopByName);
  const loopByClosedAdjacentTerminals = geometryClosedDistanceM <= LOOP_CLOSE_MAX_M && terminalDistanceM <= LOOP_SAME_TERMINAL_MAX_M;
  const loopByOrderedMemberClosure = geometryClosedDistanceM <= LOOP_CLOSE_MAX_M && geometry.closedLoopMemberPath === true;
  const serviceStops = repeatedTerminal ? stops.slice(0, -1) : stops;
  const isLoop = serviceStops.length >= 3 && (repeatedTerminal || loopByTerminalDistance || loopByGeometry || loopByClosedAdjacentTerminals || loopByOrderedMemberClosure);
  const waypoints = [];
  for (let i = 0; i < serviceStops.length - 1; i++) {
    const a = serviceStops[i];
    const b = serviceStops[i + 1];
    if (b.routeIndex <= a.routeIndex) continue;
    const seg = compactSegmentWaypoints(routePoints.slice(a.routeIndex + 1, b.routeIndex), a, b);
    seg.forEach((p, order) => waypoints.push({ lat: p.lat, lng: p.lng, segIdx: i, order }));
  }
  if (isLoop) {
    const from = serviceStops[serviceStops.length - 1];
    const to = serviceStops[0];
    const closingStop = repeatedTerminal ? lastStop : to;
    const closing = compactSegmentWaypoints(geometry.pathBetweenStops(from, closingStop), from, to);
    closing.forEach((p, order) => waypoints.push({ lat: p.lat, lng: p.lng, segIdx: serviceStops.length - 1, order }));
  }
  return {
    relationId: relation.id,
    key: routeKey(tags, name),
    branchBaseKey: routeKey(tags, name),
    name,
    ref: isTrainServiceRef(tags) ? '' : (tags.ref || ''),
    network: tags.network || '',
    route: tags.route || '',
    routeCategory: routeCategory(tags, name),
    color: normalizeColor(tags.colour || tags.color),
    isLoop,
    loopMode: isLoop ? 'closed-ring' : '',
    loopReason: isLoop ? (repeatedTerminal ? 'repeated-terminal' : (loopByName ? 'closed-geometry-name' : (loopByOrderedMemberClosure ? 'ordered-member-closed-loop' : (loopByClosedAdjacentTerminals ? 'closed-geometry-adjacent-terminals' : 'closed-geometry')))) : '',
    loopTerminalDistanceM: Number.isFinite(terminalDistanceM) ? Math.round(terminalDistanceM) : null,
    stations: serviceStops.map((stop, index) => ({
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      rawLat: stop.rawLat,
      rawLng: stop.rawLng,
      transferKey: cleanName(stop.name),
      platformKey: `${relation.id}:${index}:${cleanName(stop.name)}`,
      osmRefs: Array.from(new Set(stop.osmRefs || [])),
    })),
    waypoints,
  };
}

export function chooseBestRoutes(routes) {
  const grouped = new Map();
  for (const route of routes.filter(routeLooksOperating)) {
    const key = route.key || String(route.relationId);
    const list = grouped.get(key) || [];
    list.push(route);
    grouped.set(key, list);
  }
  const selected = [];
  Array.from(grouped.values()).forEach(list => {
    const variants = [];
    list.sort((a, b) =>
      b.stations.length - a.stations.length
      || b.waypoints.length - a.waypoints.length
      || String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true })
    ).forEach(route => {
      if (!variants.some(existing => sameRouteVariant(existing, route))) variants.push(route);
    });
	    variants.forEach((route, index) => {
	      const namedJunction = index === 0 ? '' : branchJunctionName(variants[0], route);
	      const distanceJunction = index === 0 ? null : branchJunctionByDistance(variants[0], route);
	      const hasJunction = !!(namedJunction || distanceJunction);
	      route.branchBaseKey = route.key || String(route.relationId);
	      route.variantRole = index === 0 ? 'main' : (hasJunction ? 'branch' : 'section');
	      route.branchIndex = index;
	      route.branchGroupSize = variants.length;
	      route.branchJunctionName = index === 0 ? '' : (namedJunction || (distanceJunction && distanceJunction.mainStation && distanceJunction.mainStation.name) || '');
	      route.branchJunctionDistanceM = distanceJunction ? Math.round(distanceJunction.distanceM) : null;
	      route.key = variants.length > 1 ? `${route.branchBaseKey}|variant:${index}` : route.branchBaseKey;
	      selected.push(route);
	    });
  });
  return selected.sort((a, b) =>
    String(a.ref || a.name).localeCompare(String(b.ref || b.name), 'zh-CN', { numeric: true, sensitivity: 'base' })
    || (a.branchBaseKey || '').localeCompare(b.branchBaseKey || '', 'zh-CN', { numeric: true, sensitivity: 'base' })
    || (a.branchIndex || 0) - (b.branchIndex || 0)
  ).slice(0, MAX_ROUTES);
}

async function requestOverpass(query, timeoutMs, validateData = null) {
  let lastError = '';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = `overpass ${response.status}`;
        continue;
      }
      const data = JSON.parse(text);
      if (validateData && !validateData(data)) {
        lastError = 'overpass empty result';
        continue;
      }
      return { endpoint, data };
    } catch (err) {
      lastError = String(err && err.message || err || 'overpass request failed');
    }
  }
  throw new Error(lastError || 'overpass request failed');
}

function relationSortKey(relation) {
  const tags = relation && relation.tags || {};
  const ref = String(tags.ref || '').trim();
  const name = String(tags['name:zh'] || tags.name || tags['name:en'] || '').trim();
  return `${ref || name}|${name}|${relation.id}`;
}

function uniqueRouteRelations(elements, maxRelations = MAX_RELATIONS_TO_FETCH) {
  const seen = new Set();
  const relations = [];
	  for (const el of Array.isArray(elements) ? elements : []) {
	    if (!el || el.type !== 'relation' || !isUrbanRailRouteTags(el.tags || {}, displayName(el.tags || {}, el.id))) continue;
	    const key = String(el.id);
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push(el);
  }
  return relations
    .sort((a, b) => relationSortKey(a).localeCompare(relationSortKey(b), 'zh-CN', { numeric: true, sensitivity: 'base' }))
    .slice(0, maxRelations);
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function mergeElements(elementLists) {
  const byKey = new Map();
  for (const elements of elementLists) {
    for (const el of Array.isArray(elements) ? elements : []) {
      if (!el || !el.type || el.id == null) continue;
      const key = `${el.type}:${el.id}`;
      const existing = byKey.get(key);
      if (!existing || JSON.stringify(el).length > JSON.stringify(existing).length) byKey.set(key, el);
    }
  }
  return Array.from(byKey.values());
}

async function queryOverpass(bbox, maxRelations = MAX_RELATIONS_TO_FETCH) {
  const summary = await requestOverpass(relationSummaryQuery(bbox), 22000, data =>
    Array.isArray(data && data.elements) && data.elements.some(el => el && el.type === 'relation')
  );
  const relations = uniqueRouteRelations(summary.data && summary.data.elements, maxRelations);
  if (!relations.length) return { endpoint: summary.endpoint, data: { elements: [] }, relationCount: 0, fetchedRelationCount: 0, failedBatchCount: 0 };

  const batches = chunk(relations.map(relation => relation.id), RELATION_BATCH_SIZE);
  const failures = [];
  const detailResults = await mapWithConcurrency(batches, RELATION_BATCH_CONCURRENCY, async ids => {
    try {
      return await requestOverpass(relationDetailQuery(ids), 30000, data => {
        const wanted = new Set(ids.map(String));
        return Array.isArray(data && data.elements)
          && data.elements.some(el => el && el.type === 'relation' && wanted.has(String(el.id)));
      });
    } catch (err) {
      failures.push({ ids, error: String(err && err.message || err || 'overpass batch failed') });
      return null;
    }
  });
  const successful = detailResults.filter(Boolean);
  if (!successful.length) throw new Error(failures[0] && failures[0].error || 'overpass request failed');
  return {
    endpoint: successful[0].endpoint || summary.endpoint,
    data: { elements: mergeElements(successful.map(result => result.data && result.data.elements)) },
    relationCount: relations.length,
    fetchedRelationCount: relations.length - failures.reduce((sum, failure) => sum + failure.ids.length, 0),
    failedBatchCount: failures.length,
  };
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const bbox = bboxFromUrl(url);
  if (!bbox) {
    const accept = String(context.request.headers.get('accept') || '').toLowerCase();
    const dest = String(context.request.headers.get('sec-fetch-dest') || '').toLowerCase();
    if (accept.includes('text/html') || dest === 'document') {
      return Response.redirect(`${url.origin}/?preview_v=real_network_importer`, 302);
    }
    return jsonResponse({ ok: false, error: 'invalid bbox' }, 400, 60);
  }

  try {
    const forceLive = url.searchParams.get('live') === '1';
    const maxRelations = Math.max(1, Math.min(160, Math.round(num(url.searchParams.get('maxRelations'), MAX_RELATIONS_TO_FETCH))));
    const snapshot = forceLive ? null : await snapshotForBbox(bbox);
    if (snapshot) return jsonResponse(snapshot, 200, 86400);

    const startedAt = Date.now();
    const { endpoint, data, relationCount, fetchedRelationCount, failedBatchCount } = await queryOverpass(bbox, maxRelations);
    const maps = mapsFromElements(data && data.elements);
    const parsed = maps.relations.map(relation => parseRelation(relation, maps)).filter(Boolean);
    const routes = normalizeNetworkRoutes(chooseBestRoutes(parsed));
    const stations = new Set();
    const waypointCount = routes.reduce((sum, route) => {
      route.stations.forEach(st => stations.add(`${cleanName(st.name)}:${Math.round(st.lat * 10000)}:${Math.round(st.lng * 10000)}`));
      return sum + route.waypoints.length;
    }, 0);
    return jsonResponse({
      ok: true,
      source: 'osm-overpass',
      endpoint,
      bbox,
      routes,
      summary: {
        routes: routes.length,
        stations: stations.size,
        waypoints: waypointCount,
        relationsRead: maps.relations.length,
        relationsMatched: relationCount,
        relationsFetched: fetchedRelationCount,
        failedBatches: failedBatchCount,
        elapsedMs: Date.now() - startedAt,
      },
    }, 200, 300);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'rail network unavailable',
      detail: String(err && err.message || err || 'overpass request failed'),
    }, 503, 60);
  }
}
