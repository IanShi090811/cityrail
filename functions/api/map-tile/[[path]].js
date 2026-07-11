import { handleOptions } from '../../_shared/cityrail-cloudflare.js';

const PROVIDERS = {
  'carto-dark': ({ z, x, y, sub }) => `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
  'carto-light': ({ z, x, y, sub }) => `https://${sub}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
  'carto-voyager': ({ z, x, y, sub }) => `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
  'esri-imagery': ({ z, x, y }) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  'gaode-road': ({ z, x, y, sub }) => `https://webrd0${sub}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`,
  'autonavi-2026-road': ({ z, x, y, sub }) => `https://webrd0${sub}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`,
  'gaode-satellite': ({ z, x, y, sub }) => `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`,
  'autonavi-2026-satellite': ({ z, x, y, sub }) => `https://webst0${sub}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`,
  'tencent-satellite': ({ z, x, y, sub }) => {
    const invY = (2 ** z) - 1 - y;
    return `https://p${sub}.map.gtimg.com/sateTiles/${z}/${x >> 4}/${invY >> 4}/${x}_${invY}.jpg`;
  },
  'tencent-terrain': ({ z, x, y, sub }) => {
    const invY = (2 ** z) - 1 - y;
    return `https://p${sub}.map.gtimg.com/demTiles/${z}/${x >> 4}/${invY >> 4}/${x}_${invY}.jpg`;
  },
  openrailway: ({ z, x, y, sub }) => `https://${sub}.tiles.openrailwaymap.org/standard/${z}/${x}/${y}.png`,
};

const SUBDOMAINS = {
  'carto-dark': ['a', 'b', 'c', 'd'],
  'carto-light': ['a', 'b', 'c', 'd'],
  'carto-voyager': ['a', 'b', 'c', 'd'],
  'gaode-road': ['1', '2', '3', '4'],
  'autonavi-2026-road': ['1', '2', '3', '4'],
  'gaode-satellite': ['1', '2', '3', '4'],
  'autonavi-2026-satellite': ['1', '2', '3', '4'],
  'tencent-satellite': ['0', '1', '2', '3'],
  'tencent-terrain': ['0', '1', '2', '3'],
  openrailway: ['a', 'b', 'c'],
};

const MAX_ZOOM = {
  openrailway: 19,
  'gaode-road': 18,
  'autonavi-2026-road': 18,
  'gaode-satellite': 18,
  'autonavi-2026-satellite': 18,
  'tencent-satellite': 18,
  'tencent-terrain': 18,
  'esri-imagery': 19,
};

function responseText(body, status, headers = {}) {
  return new Response(String(body), {
    status,
    headers: {
      'content-type': 'text/plain;charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...headers,
    },
  });
}

function normalizePathParam(param) {
  if (Array.isArray(param)) return param.join('/');
  return String(param || '');
}

function routeParts(context) {
  const fromParam = normalizePathParam(context.params && context.params.path);
  if (fromParam) return fromParam.split('/').filter(Boolean);
  const url = new URL(context.request.url);
  return url.pathname.replace(/^\/api\/map-tile\/?/i, '').split('/').filter(Boolean);
}

function parseTile(context) {
  const parts = routeParts(context);
  const provider = String(parts[0] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const z = Number(parts[1]);
  const x = Number(parts[2]);
  const yMatch = String(parts[3] || '').match(/^(\d+)(?:\.(?:png|jpg|jpeg|webp))?$/i);
  const y = yMatch ? Number(yMatch[1]) : NaN;
  if (!PROVIDERS[provider]) return { error: 'unknown provider' };
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return { error: 'bad tile coordinate' };
  const maxZoom = MAX_ZOOM[provider] || 20;
  if (z < 0 || z > maxZoom) return { error: 'zoom out of range' };
  const limit = 2 ** z;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return { error: 'tile out of range' };
  const subs = SUBDOMAINS[provider] || [''];
  const sub = subs[Math.abs((x * 31 + y * 17 + z * 13) % subs.length)];
  return { provider, z, x, y, sub };
}

function upstreamHeaders(provider) {
  const headers = {
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };
  if (provider === 'openrailway') {
    headers['user-agent'] = 'CityRailGame/1.0 (+https://cityrailgame.pages.dev; contact: cityrailgame.pages.dev)';
    headers.referer = 'https://cityrailgame.pages.dev/';
    headers['accept-language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
  }
  return headers;
}

function upstreamUrls(tile) {
  const subs = SUBDOMAINS[tile.provider] || [tile.sub || ''];
  const ordered = [tile.sub, ...subs].filter((sub, index, arr) => sub != null && arr.indexOf(sub) === index);
  return ordered.map(sub => PROVIDERS[tile.provider]({ ...tile, sub }));
}

async function fetchUpstream(url, provider) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 6500) : null;
  try {
    return await fetch(new Request(url, {
      headers: upstreamHeaders(provider),
      signal: controller && controller.signal,
    }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function detectImageType(bytes, fallback) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (arr.length >= 8 && arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47) return 'image/png';
  if (arr.length >= 3 && arr[0] === 0xff && arr[1] === 0xd8 && arr[2] === 0xff) return 'image/jpeg';
  if (arr.length >= 12 && arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46 && arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50) return 'image/webp';
  return fallback || 'image/png';
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const tile = parseTile(context);
  if (tile.error) return responseText(tile.error, tile.error === 'unknown provider' ? 404 : 400);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(context.request.url, { method: 'GET' });

  if (cache) {
    const cached = await cache.match(cacheKey).catch(() => null);
    if (cached) return cached;
  }

  let upstream;
  let body;
  let lastError = '';
  let lastStatus = 0;
  let lastType = '';
  let usedUrl = '';
  for (const url of upstreamUrls(tile)) {
    usedUrl = url;
    try {
      upstream = await fetchUpstream(url, tile.provider);
      lastStatus = upstream.status || 0;
      lastType = String(upstream.headers.get('content-type') || '').toLowerCase();
      if (!upstream.ok || !lastType.startsWith('image/')) {
        upstream = null;
        continue;
      }
      body = await upstream.arrayBuffer();
      break;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      upstream = null;
      body = null;
      continue;
    }
  }

  if (!upstream || !body) {
    return responseText(lastError ? `tile upstream fetch failed: ${lastError}` : `tile upstream returned ${lastStatus || 0}`, 502, {
      'x-cityrail-tile-provider': tile.provider,
      'x-cityrail-upstream-status': String(lastStatus || 0),
      'x-cityrail-upstream-type': lastType || 'unknown',
      'x-cityrail-upstream-url': usedUrl,
    });
  }

  const type = String(upstream.headers.get('content-type') || '').toLowerCase();
  if (!upstream.ok || !type.startsWith('image/')) {
    return responseText(`tile upstream returned ${upstream.status || 0}`, 502, {
      'x-cityrail-tile-provider': tile.provider,
      'x-cityrail-upstream-status': String(upstream.status || 0),
      'x-cityrail-upstream-type': type || 'unknown',
    });
  }

  const contentType = detectImageType(body, upstream.headers.get('content-type') || 'image/png');
  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=2592000, immutable',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });

  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
}

export async function onRequestHead(context) {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
