import { handleOptions } from '../_shared/cityrail-cloudflare.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
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

function stationRowsFromOverpass(data, centerLat, centerLng, radiusM) {
  const rows = [];
  const bestByName = new Map();
  for (const el of Array.isArray(data && data.elements) ? data.elements : []) {
    if (!isRailStation(el)) continue;
    const ll = elementLatLng(el);
    if (!ll) continue;
    const name = cleanName(tagName(el.tags));
    if (!name) continue;
    const distanceM = Math.round(haversineMeters(centerLat, centerLng, ll.lat, ll.lng));
    if (distanceM > radiusM) continue;
    const row = { name, lat: ll.lat, lng: ll.lng, distanceM, source: 'metro-overpass' };
    const old = bestByName.get(name);
    if (!old || row.distanceM < old.distanceM) bestByName.set(name, row);
  }
  bestByName.forEach(row => rows.push(row));
  rows.sort((a, b) => a.distanceM - b.distanceM || a.name.localeCompare(b.name, 'zh-CN'));
  return rows.slice(0, 1800);
}

function cityStationQuery(lat, lng, radiusM) {
  const r = Math.round(radiusM);
  return `[out:json][timeout:16];
(
  node(around:${r},${lat},${lng})["railway"~"^(station|halt|tram_stop)$"];
  node(around:${r},${lat},${lng})["public_transport"="station"]["station"~"^(subway|train|light_rail)$"];
  node(around:${r},${lat},${lng})["station"~"^(subway|train|light_rail)$"];
  node(around:${r},${lat},${lng})["subway"="yes"];
  node(around:${r},${lat},${lng})["train"="yes"];
  node(around:${r},${lat},${lng})["light_rail"="yes"];
);
out center tags 2200;`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
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
      }, 24000);
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

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const city = String(url.searchParams.get('city') || '').trim() || 'city';
  const cityName = String(url.searchParams.get('cityName') || city).trim();
  const cityEn = String(url.searchParams.get('cityEn') || city).trim();
  const lat = num(url.searchParams.get('cityLat'), NaN);
  const lng = num(url.searchParams.get('cityLng'), NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ ok: false, error: 'invalid city center', city, cityName, cityEn, stations: [] }, 400, 60);
  }

  const radiusM = clamp(url.searchParams.get('cityRadiusM') || 85000, 8000, 180000);
  const queryRadiusM = Math.min(radiusM, 8000);
  const data = await queryOverpass(cityStationQuery(lat, lng, queryRadiusM));
  const stations = stationRowsFromOverpass(data, lat, lng, queryRadiusM);
  if (!stations.length) {
    return jsonResponse({
      ok: false,
      city,
      cityName,
      cityEn,
      center: [lat, lng],
      radiusM,
      queryRadiusM,
      count: 0,
      source: 'empty-overpass',
      error: data && data.error || 'no station names returned',
      stations: [],
    }, 200, 60 * 60);
  }
  return jsonResponse({
    ok: true,
    city,
    cityName,
    cityEn,
    center: [lat, lng],
    radiusM,
    queryRadiusM,
    count: stations.length,
    source: stations.length ? 'overpass' : 'empty-overpass',
    error: data && data.error || '',
    stations,
  }, 200, 60 * 60 * 24 * 30);
}
