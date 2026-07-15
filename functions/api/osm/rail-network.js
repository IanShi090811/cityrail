import { handleOptions } from '../../_shared/cityrail-cloudflare.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const USER_AGENT = 'CityRailGame/1.0 (+https://cityrailgame.com)';
const ROUTE_RE = /^(subway|light_rail|monorail)$/i;
const STOP_ROLE_RE = /stop|platform|station|halt/i;
const STOP_TAG_RE = /station|stop_position|platform|halt/i;
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
    snapshotCache.set(file, data);
    return data;
  } catch {
    return null;
  }
}

function relationSummaryQuery(bbox) {
  const box = bbox.join(',');
  return `[out:json][timeout:30];
  relation["type"="route"]["route"~"^(subway|light_rail|monorail)$"](${box});
out tags;`;
}

function relationDetailQuery(ids) {
  return `[out:json][timeout:55];
relation(id:${ids.join(',')});
(._;>;);
out body geom;`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 95000) {
  const nodeResponse = await fetchWithNodeHttp(url, options, timeoutMs);
  if (nodeResponse) return nodeResponse;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller && controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithNodeHttp(url, options = {}, timeoutMs = 95000) {
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) return null;
  let http;
  let https;
  let dns;
  try {
    [{ default: http }, { default: https }, dns] = await Promise.all([
      import('node:http'),
      import('node:https'),
      import('node:dns'),
    ]);
  } catch {
    return null;
  }
  if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body == null ? null : Buffer.from(String(options.body));
  const headers = { ...(options.headers || {}) };
  if (body && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length')) {
    headers['content-length'] = String(body.length);
  }
  return new Promise((resolve, reject) => {
    const req = transport.request(target, {
      method,
      headers,
      family: 4,
      timeout: timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          async text() { return text; },
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('overpass request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
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

export function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/站$/u, '')
    .replace(/Station$/i, '')
    .replace(/[()（）［］\[\]【】]/g, '')
    .toLowerCase();
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

function concatWays(members, ways) {
  const out = [];
  for (const member of members) {
    if (!member || member.type !== 'way' || STOP_ROLE_RE.test(String(member.role || ''))) continue;
    const ptsRaw = wayGeometry(ways.get(member.ref));
    if (ptsRaw.length < 2) continue;
    let pts = ptsRaw;
    if (out.length) {
      const last = out[out.length - 1];
      if (meters(last, pts[pts.length - 1]) < meters(last, pts[0])) pts = pts.slice().reverse();
      if (meters(last, pts[0]) < 8) pts = pts.slice(1);
    }
    pts.forEach(p => out.push(p));
  }
  return thinNearbyPoints(out, 8);
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
  const name = displayName(tags, member.ref);
  if (!point || !name) return null;
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

function nearestIndex(points, target) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = meters(points[i], target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function orientRoute(points, stops) {
  if (!points.length || stops.length < 2) return points;
  const idxs = stops.map(st => nearestIndex(points, st));
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < idxs.length; i++) idxs[i] >= idxs[i - 1] ? asc++ : desc++;
  return desc > asc ? points.slice().reverse() : points;
}

function thinNearbyPoints(points, minMeters) {
  const out = [];
  for (const p of points) {
    if (!out.length || meters(out[out.length - 1], p) >= minMeters) out.push(p);
  }
  return out;
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
  const ref = cleanName(tags && tags.ref || '');
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
  return routeTerminalKey(a) === routeTerminalKey(b) && routeOverlapRatio(aKeys, bKeys) >= 0.86;
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

function routeLooksOperating(route) {
  const raw = [
    route && route.name,
    route && route.ref,
    route && route.network,
    route && route.route,
  ].filter(Boolean).join(' ');
  return !NON_OPERATING_RE.test(raw);
}

function closedRoutePointDistance(points) {
  if (!Array.isArray(points) || points.length < 3) return Infinity;
  return meters(points[0], points[points.length - 1]);
}

function routeSegmentPoints(points, fromIdx, toIdx, circular) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const from = Math.max(0, Math.min(points.length - 1, Math.round(num(fromIdx, 0))));
  const to = Math.max(0, Math.min(points.length - 1, Math.round(num(toIdx, 0))));
  if (to > from) return points.slice(from + 1, to);
  if (!circular || to === from) return [];
  return points.slice(from + 1).concat(points.slice(0, to));
}

function compactSegmentWaypoints(points, fromStop, toStop) {
  const seg = points.filter(p => meters(p, fromStop) >= MIN_POINT_DISTANCE_M && meters(p, toStop) >= MIN_POINT_DISTANCE_M);
  return capPoints(simplifyPoints(seg, SIMPLIFY_TOLERANCE_M), MAX_SEGMENT_WAYPOINTS);
}

export function parseRelation(relation, maps) {
  const tags = relation.tags || {};
  if (!ROUTE_RE.test(String(tags.route || ''))) return null;
  const members = Array.isArray(relation.members) ? relation.members : [];
  let stops = mergeStopCandidates(members.map(member => stationCandidate(member, maps)).filter(Boolean));
  let routePoints = concatWays(members, maps.ways);
  if (stops.length < 2 || routePoints.length < 2) return null;
  routePoints = orientRoute(routePoints, stops);
  stops = stops.map(stop => {
    const routeIndex = nearestIndex(routePoints, stop);
    const snapped = routePoints[routeIndex];
    const useSnapped = snapped && meters(stop, snapped) <= 650;
    return {
      ...stop,
      rawLat: stop.lat,
      rawLng: stop.lng,
      lat: useSnapped ? snapped.lat : stop.lat,
      lng: useSnapped ? snapped.lng : stop.lng,
      routeIndex,
    };
  }).sort((a, b) => a.routeIndex - b.routeIndex);
  stops = stops.filter((stop, index, arr) => {
    if (index === 0) return true;
    const prev = arr[index - 1];
    return cleanName(prev.name) !== cleanName(stop.name) || meters(prev, stop) >= 120;
  });
  if (stops.length < 2) return null;
  const name = displayName(tags, tags.ref ? `线路 ${tags.ref}` : 'OSM 线路');
  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const terminalDistanceM = meters(firstStop, lastStop);
  const geometryClosedDistanceM = closedRoutePointDistance(routePoints);
  const loopByName = routeNameLooksLoop(tags, name);
  const sameTerminalName = !!cleanName(firstStop.name) && cleanName(firstStop.name) === cleanName(lastStop.name);
  const repeatedTerminal = stops.length >= 4 && sameTerminalName && terminalDistanceM <= LOOP_SAME_TERMINAL_MAX_M;
  const loopByTerminalDistance = terminalDistanceM <= LOOP_CLOSE_MAX_M;
  const loopByGeometry = geometryClosedDistanceM <= LOOP_CLOSE_MAX_M && (sameTerminalName || loopByName);
  const serviceStops = repeatedTerminal ? stops.slice(0, -1) : stops;
  const isLoop = serviceStops.length >= 3 && (repeatedTerminal || loopByTerminalDistance || loopByGeometry);
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
    const closing = compactSegmentWaypoints(routeSegmentPoints(routePoints, from.routeIndex, closingStop.routeIndex, true), from, to);
    closing.forEach((p, order) => waypoints.push({ lat: p.lat, lng: p.lng, segIdx: serviceStops.length - 1, order }));
  }
	  return {
	    relationId: relation.id,
	    key: routeKey(tags, name),
	    branchBaseKey: routeKey(tags, name),
	    name,
	    ref: tags.ref || '',
	    network: tags.network || '',
    route: tags.route || '',
    color: normalizeColor(tags.colour || tags.color),
    isLoop,
    loopMode: isLoop ? 'closed-ring' : '',
    loopReason: isLoop ? (repeatedTerminal ? 'repeated-terminal' : (loopByName ? 'closed-geometry-name' : 'closed-geometry')) : '',
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
	    if (!el || el.type !== 'relation' || !ROUTE_RE.test(String(el.tags && el.tags.route || ''))) continue;
	    if (NON_OPERATING_RE.test(Object.values(el.tags || {}).join(' '))) continue;
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
    const routes = chooseBestRoutes(parsed);
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
