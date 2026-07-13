import http from 'http';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash, webcrypto } from 'crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = 8080;
const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_PORT;
const DATA_DIR = path.resolve(process.env.CITYRAIL_DATA_DIR || path.join(__dirname, '.data'));
const STATIC_INDEX = path.join(ROOT_DIR, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
};

const FUNCTION_ROUTES = [
  { match: /^\/api\/workshop\/item\/([^/]+)\/?$/i, file: 'functions/api/workshop/item/[id].js', params: m => ({ id: decodeURIComponent(m[1]) }) },
  { match: /^\/api\/workshop\/mine\/?$/i, file: 'functions/api/workshop/mine.js' },
  { match: /^\/api\/workshop\/delete\/?$/i, file: 'functions/api/workshop/delete.js' },
  { match: /^\/api\/workshop\/upload\/?$/i, file: 'functions/api/workshop/upload.js' },
  { match: /^\/api\/workshop\/list\/?$/i, file: 'functions/api/workshop/list.js' },
  { match: /^\/api\/analytics\/visit\/?$/i, file: 'functions/api/analytics/visit.js' },
  { match: /^\/api\/admin\/analytics\/?$/i, file: 'functions/api/admin/analytics.js' },
  { match: /^\/api\/map-tile\/?(.*)$/i, file: 'functions/api/map-tile/[[path]].js', params: m => ({ path: m[1] ? m[1].split('/').filter(Boolean).map(decodeURIComponent) : [] }) },
  { match: /^\/api\/place-name\/?$/i, file: 'functions/api/place-name.js' },
  { match: /^\/api\/city-place-data\/?$/i, file: 'functions/api/city-place-data.js' },
  { match: /^\/api\/check-username\/([^/]+)\/?$/i, file: 'functions/api/check-username/[username].js', params: m => ({ username: decodeURIComponent(m[1]) }) },
  { match: /^\/api\/pay\/notify\/?$/i, file: 'functions/api/pay/notify.js' },
  { match: /^\/api\/pay\/create\/?$/i, file: 'functions/api/pay/create.js' },
  { match: /^\/api\/pay\/status\/?$/i, file: 'functions/api/pay/status.js' },
  { match: /^\/api\/register\/?$/i, file: 'functions/api/register.js' },
  { match: /^\/api\/invite\/verify\/?$/i, file: 'functions/api/invite/verify.js' },
  { match: /^\/api\/login\/?$/i, file: 'functions/api/login.js' },
  { match: /^\/api(?:\/.*)?$/i, file: 'functions/api/[[path]].js', params: m => ({ path: String(m[0] || '').replace(/^\/api\/?/i, '').split('/').filter(Boolean).map(decodeURIComponent) }) },
];

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function ensureInsideRoot(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved !== ROOT_DIR && !resolved.startsWith(ROOT_DIR + path.sep)) return null;
  return resolved;
}

async function mkdirp(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function tempFileName(file) {
  return `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

class FileKvStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  fileForKey(key) {
    return path.join(this.rootDir, sha(key) + '.json');
  }

  async get(key) {
    const file = this.fileForKey(key);
    try {
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.expiresAt && Date.now() >= record.expiresAt) {
        await fs.rm(file, { force: true });
        return null;
      }
      return typeof record.value === 'string' ? record.value : null;
    } catch {
      return null;
    }
  }

  async put(key, value, options = {}) {
    await mkdirp(this.rootDir);
    const ttl = Number(options.expirationTtl || 0);
    const record = {
      key: String(key),
      value: String(value),
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : 0,
      updatedAt: Date.now(),
    };
    const file = this.fileForKey(key);
    const tmp = tempFileName(file);
    await fs.writeFile(tmp, JSON.stringify(record), 'utf8');
    await fs.rename(tmp, file);
  }

  async delete(key) {
    await fs.rm(this.fileForKey(key), { force: true });
  }
}

class FileResponseCache {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  fileForRequest(request) {
    const url = request && request.url ? request.url : String(request || '');
    return path.join(this.rootDir, sha(url) + '.json');
  }

  async match(request) {
    const file = this.fileForRequest(request);
    try {
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.expiresAt && Date.now() >= record.expiresAt) {
        await fs.rm(file, { force: true });
        return null;
      }
      const body = Buffer.from(record.body || '', 'base64');
      return new Response(body, { status: record.status || 200, headers: record.headers || {} });
    } catch {
      return null;
    }
  }

  async put(request, response) {
    if (!response || response.status < 200 || response.status >= 300) return;
    await mkdirp(this.rootDir);
    const clone = response.clone();
    const headers = Object.fromEntries(clone.headers.entries());
    const maxAge = parseMaxAge(headers['cache-control']);
    const body = Buffer.from(await clone.arrayBuffer()).toString('base64');
    const record = {
      status: clone.status,
      headers,
      body,
      expiresAt: maxAge > 0 ? Date.now() + maxAge * 1000 : 0,
      updatedAt: Date.now(),
    };
    const file = this.fileForRequest(request);
    const tmp = tempFileName(file);
    await fs.writeFile(tmp, JSON.stringify(record), 'utf8');
    await fs.rename(tmp, file);
  }
}

function parseMaxAge(cacheControl) {
  const match = String(cacheControl || '').match(/(?:s-maxage|max-age)=(\d+)/i);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

const kvStore = new FileKvStore(path.join(DATA_DIR, 'kv'));
const responseCache = new FileResponseCache(path.join(DATA_DIR, 'cache'));
globalThis.caches = globalThis.caches || { default: responseCache };

function buildEnv() {
  return {
    ...process.env,
    CITYRAIL_KV: kvStore,
  };
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fsSync.existsSync(envPath)) return;
  const text = fsSync.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadLocalEnv();

function routeFor(pathname) {
  for (const route of FUNCTION_ROUTES) {
    const match = pathname.match(route.match);
    if (!match) continue;
    return {
      file: route.file,
      params: route.params ? route.params(match) : {},
    };
  }
  return null;
}

async function importFunction(file) {
  const fullPath = path.join(ROOT_DIR, file);
  return import(pathToFileURL(fullPath).href + '?v=' + fsSync.statSync(fullPath).mtimeMs);
}

function handlerName(method) {
  const normalized = String(method || 'GET').toLowerCase();
  return 'onRequest' + normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function requestFromIncoming(req, url) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
    else if (value != null) headers.set(key, String(value));
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Request(url, { method: req.method, headers });
  }
  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  return new Request(url, { method: req.method, headers, body });
}

async function sendWebResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  if (response.body && response.status !== 204) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } else {
    res.end();
  }
}

async function handleFunction(req, res, route, url) {
  const request = await requestFromIncoming(req, url.href);
  const mod = await importFunction(route.file);
  const methodHandler = mod[handlerName(req.method)];
  const handler = methodHandler || mod.onRequest;
  if (typeof handler !== 'function') {
    return sendWebResponse(res, new Response('Method Not Allowed', { status: 405 }));
  }
  const pending = [];
  const context = {
    request,
    env: buildEnv(),
    params: route.params || {},
    waitUntil(promise) {
      pending.push(Promise.resolve(promise).catch(err => console.warn('[CityRail Server] waitUntil failed:', err)));
    },
  };
  const response = await handler(context);
  await sendWebResponse(res, response instanceof Response ? response : new Response(String(response || ''), { status: 200 }));
  if (pending.length) Promise.allSettled(pending);
}

async function serveStatic(req, res, pathname) {
  let cleanPath = decodeURIComponent(pathname.split('?')[0] || '/');
  if (cleanPath === '/') cleanPath = '/index.html';
  let filePath = ensureInsideRoot(path.join(ROOT_DIR, cleanPath.replace(/^\/+/, '')));
  if (!filePath) return sendWebResponse(res, new Response('Forbidden', { status: 403 }));
  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fs.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    };
    if (filePath !== STATIC_INDEX && /\.(?:js|css|png|jpe?g|webp|svg|ico|json|wasm)$/i.test(filePath)) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['cache-control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fsSync.createReadStream(filePath).pipe(res);
  } catch {
    if (!pathname.includes('.') && pathname !== '/index.html') return serveStatic(req, res, '/index.html');
    return sendWebResponse(res, new Response('Not Found', { status: 404 }));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(req.url || '/', `${protocol}://${host}`);
    if (url.pathname === '/healthz' || url.pathname === '/api/health') {
      return sendWebResponse(res, new Response(JSON.stringify({
        ok: true,
        service: 'cityrail',
        port: PORT,
        uptime: Math.round(process.uptime()),
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json;charset=utf-8',
          'cache-control': 'no-store',
        },
      }));
    }
    const route = routeFor(url.pathname);
    if (route) return handleFunction(req, res, route, url);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[CityRail Server] request failed:', err);
    await sendWebResponse(res, new Response(JSON.stringify({ error: '服务器内部错误' }), {
      status: 500,
      headers: { 'content-type': 'application/json;charset=utf-8' },
    }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CityRail server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  if (!process.env.PUBLIC_BASE_URL) console.warn('PUBLIC_BASE_URL is not set; payment callbacks must use the final HTTPS domain.');
  if (!process.env.XHP_APPSECRET) console.warn('XHP_APPSECRET is not set; paid registration will reject order creation.');
});
