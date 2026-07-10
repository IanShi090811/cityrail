import { handleOptions } from '../_shared/cityrail-cloudflare.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'CityRailGame/1.0 (+https://cityrailgame.pages.dev)';

function jsonResponse(data, status = 200, maxAge = 86400) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=604800`,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, num(value, min)));
}

function cleanName(raw) {
  let name = String(raw || '').trim();
  if (!name || /^中国$|^\d+$/.test(name)) return '';
  name = name.replace(/\s+/g, '');
  name = name.replace(/[（(][^）)]*在建[^）)]*[）)]/gu, '');
  name = name.replace(/在建$/u, '');
  name = name.replace(/(地铁站|公交站|站点)$/u, '');
  name = name.replace(/(号线|线)$/u, '');
  name = name.replace(/站站$/u, '站');
  if (/[\u3400-\u9fff]/u.test(name)) name = name.replace(/(?<=[\u3400-\u9fff])[^\u3400-\u9fff0-9·・（）()]+.*$/u, '');
  if (/[\u3400-\u9fff]/u.test(name)) name = name.replace(/[A-Za-z][A-Za-z0-9' -]*$/u, '');
  if (!/(火车站|汽车站)$/u.test(name)) name = name.replace(/站$/u, '');
  if (name.length > 18) name = name.slice(0, 18);
  return name;
}

function tagName(tags) {
  tags = tags || {};
  return tags['name:zh'] || tags['name:zh-Hans'] || tags['name:zh-Hant'] || tags['name:zh-CN'] || tags.name || tags['name:en'] || '';
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const r = 6371000;
  const rad = v => num(v) * Math.PI / 180;
  const dLat = rad(bLat) - rad(aLat);
  const dLng = rad(bLng) - rad(aLng);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(q), Math.sqrt(Math.max(0, 1 - q)));
}

function elementLatLng(el) {
  const center = el && el.center || {};
  const lat = num(el ? (el.lat ?? center.lat) : NaN, NaN);
  const lng = num(el ? (el.lon ?? center.lon) : NaN, NaN);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function isRailStation(el) {
  const tags = el && el.tags || {};
  const railway = String(tags.railway || '').toLowerCase();
  const station = String(tags.station || '').toLowerCase();
  const transport = String(tags.public_transport || '').toLowerCase();
  const subway = String(tags.subway || '').toLowerCase();
  const train = String(tags.train || '').toLowerCase();
  const lightRail = String(tags.light_rail || '').toLowerCase();
  if (railway === 'station' || railway === 'halt' || railway === 'tram_stop') return true;
  if (transport === 'station' && (station === 'subway' || station === 'train' || subway === 'yes' || train === 'yes' || lightRail === 'yes')) return true;
  return false;
}

function stationRowsFromOverpass(data, lat, lng, radiusM) {
  const rows = [];
  const seen = new Set();
  for (const el of Array.isArray(data && data.elements) ? data.elements : []) {
    if (!isRailStation(el)) continue;
    const ll = elementLatLng(el);
    if (!ll) continue;
    const name = cleanName(tagName(el.tags));
    if (!name) continue;
    const distanceM = Math.round(haversineMeters(lat, lng, ll.lat, ll.lng));
    if (distanceM > radiusM) continue;
    const key = `${name}:${Math.round(ll.lat * 10000)}:${Math.round(ll.lng * 10000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, lat: ll.lat, lng: ll.lng, distanceM, source: 'metro-overpass' });
  }
  rows.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name, 'zh-CN'));
  return rows;
}

function nearbyStationQuery(lat, lng, radiusM) {
  const r = Math.round(radiusM);
  return `[out:json][timeout:12];
(
  node(around:${r},${lat},${lng})["railway"~"^(station|halt|tram_stop)$"];
  way(around:${r},${lat},${lng})["railway"~"^(station|halt|tram_stop)$"];
  relation(around:${r},${lat},${lng})["railway"~"^(station|halt|tram_stop)$"];
  node(around:${r},${lat},${lng})["public_transport"="station"]["station"~"^(subway|train|light_rail)$"];
  way(around:${r},${lat},${lng})["public_transport"="station"]["station"~"^(subway|train|light_rail)$"];
  relation(around:${r},${lat},${lng})["public_transport"="station"]["station"~"^(subway|train|light_rail)$"];
);
out center tags 40;`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...options, signal: controller && controller.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function queryOverpass(query) {
  let lastError = '';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
      }, 12000);
      if (!res.ok) {
        lastError = `overpass ${res.status}`;
        continue;
      }
      return await res.json();
    } catch (err) {
      lastError = String(err && err.message || err);
    }
  }
  return { error: lastError || 'overpass unavailable', elements: [] };
}

function roadNameFromNominatim(data) {
  const address = data && data.address || {};
  return cleanName(address.road || address.pedestrian || address.footway || address.neighbourhood || address.suburb || address.town || address.city_district || data && data.name);
}

async function reverseRoadName(lat, lng) {
  const url = new URL(NOMINATIM_REVERSE);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const res = await fetchWithTimeout(url.toString(), {
    headers: {
      accept: 'application/json',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'user-agent': USER_AGENT,
      referer: 'https://cityrailgame.pages.dev/',
    },
  }, 8500);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const name = roadNameFromNominatim(data);
  return name ? { name, source: 'road', distanceM: null } : null;
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = num(url.searchParams.get('lat'), NaN);
  const lng = num(url.searchParams.get('lng'), NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ ok: false, error: 'invalid coordinate' }, 400, 60);
  }

  const radiusM = clamp(url.searchParams.get('metroRadiusM') || 1000, 120, 2000);
  const metroData = await queryOverpass(nearbyStationQuery(lat, lng, radiusM));
  const stations = stationRowsFromOverpass(metroData, lat, lng, radiusM);
  if (stations.length) {
    const best = stations[0];
    return jsonResponse({
      ok: true,
      name: best.name,
      source: best.source,
      distanceM: best.distanceM,
      lat: best.lat,
      lng: best.lng,
      candidates: stations.slice(0, 5),
    }, 200, 60 * 60 * 24 * 30);
  }

  const road = await reverseRoadName(lat, lng).catch(() => null);
  if (road && road.name) {
    return jsonResponse({ ok: true, name: road.name, source: 'road', distanceM: road.distanceM }, 200, 60 * 60 * 24 * 14);
  }

  return jsonResponse({ ok: false, error: metroData && metroData.error || 'no metro station or road name found' }, 200, 60 * 60 * 6);
}
