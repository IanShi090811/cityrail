import { handleOptions } from '../../_shared/cityrail-cloudflare.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'CityRailGame/1.0 (+https://cityrailgame.pages.dev)';
const ROUTE_RE = /^(subway|light_rail|monorail)$/i;
const STOP_ROLE_RE = /stop|platform|station|halt/i;
const STOP_TAG_RE = /station|stop_position|platform|halt/i;
const MAX_BBOX_SPAN = 1.9;
const MAX_ROUTES = 42;
const MAX_SEGMENT_WAYPOINTS = 18;
const MIN_POINT_DISTANCE_M = 55;
const SIMPLIFY_TOLERANCE_M = 42;
const LOOP_CLOSE_MAX_M = 180;
const LOOP_SAME_TERMINAL_MAX_M = 2000;

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

function overpassQuery(bbox) {
  const box = bbox.join(',');
  return `[out:json][timeout:90];
(
  relation["type"="route"]["route"~"^(subway|light_rail|monorail)$"](${box});
);
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

function cleanName(name) {
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

function mapsFromElements(elements) {
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

function routeNameLooksLoop(tags, name) {
  const raw = [
    name,
    tags && tags.name,
    tags && tags.ref,
    tags && tags.description,
  ].filter(Boolean).join(' ');
  return /环线|環線|环状|環状|循環|circle|circular|loop|ring|ringbahn/i.test(raw);
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

function parseRelation(relation, maps) {
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

function chooseBestRoutes(routes) {
  const grouped = new Map();
  for (const route of routes) {
    const key = route.key || String(route.relationId);
    const list = grouped.get(key) || [];
    list.push(route);
    grouped.set(key, list);
  }
  return Array.from(grouped.values()).map(list => list.sort((a, b) =>
    b.stations.length - a.stations.length
    || b.waypoints.length - a.waypoints.length
    || String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true })
  )[0]).sort((a, b) =>
    String(a.ref || a.name).localeCompare(String(b.ref || b.name), 'zh-CN', { numeric: true, sensitivity: 'base' })
  ).slice(0, MAX_ROUTES);
}

async function queryOverpass(bbox) {
  let lastError = '';
  const query = overpassQuery(bbox);
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
      return { endpoint, data: JSON.parse(text) };
    } catch (err) {
      lastError = String(err && err.message || err || 'overpass request failed');
    }
  }
  throw new Error(lastError || 'overpass request failed');
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
    const startedAt = Date.now();
    const { endpoint, data } = await queryOverpass(bbox);
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
        elapsedMs: Date.now() - startedAt,
      },
    }, 200, 300);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err || 'rail network unavailable') }, 502, 60);
  }
}
