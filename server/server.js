import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json' };

// 可选读取 server/.env，部署平台建议直接配置环境变量，不要把密钥写进前端。
function loadLocalEnv() {
  const envPath = join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadLocalEnv();

const PAYMENT = {
  appid: process.env.XHP_APPID || '201906180967',
  secret: process.env.XHP_APPSECRET || '',
  gateway: process.env.XHP_GATEWAY || 'https://api.xunhupay.com/payment/do.html',
  amount: process.env.CITYRAIL_PRICE || '9.98',
  title: process.env.CITYRAIL_PRODUCT_TITLE || 'CityRail都市城轨完整版',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
};

// ── 简易密码哈希(使用 Node 内置 crypto) ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 32).toString('hex');
  return salt + ':' + key;
}

function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(derived));
}

// ── JSON 文件数据库 ──
const DB_PATH = join(__dirname, 'users.json');
const ORDERS_PATH = join(__dirname, 'orders.json');

function readJsonFile(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
}
function writeJsonFile(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}
function readUsers() { return readJsonFile(DB_PATH, {}); }
function writeUsers(users) { writeJsonFile(DB_PATH, users); }
function readOrders() { return readJsonFile(ORDERS_PATH, {}); }
function writeOrders(orders) { writeJsonFile(ORDERS_PATH, orders); }

function isUsernameTaken(username) { return !!readUsers()[username]; }
function createUser(username, hashedPassword) {
  const users = readUsers();
  users[username] = hashedPassword;
  writeUsers(users);
}
function findUserByUsername(username) {
  const users = readUsers();
  return users[username] ? { username, password: users[username] } : null;
}

// ── 请求体解析：支持 JSON、x-www-form-urlencoded、text/plain ──
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const type = String(req.headers['content-type'] || '').toLowerCase();
      if (!body) return resolve({});
      if (type.includes('application/json')) {
        try { return resolve(JSON.parse(body)); } catch { return resolve({}); }
      }
      if (type.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        return resolve(Object.fromEntries(params.entries()));
      }
      try { return resolve(JSON.parse(body)); } catch {}
      const params = new URLSearchParams(body);
      const obj = Object.fromEntries(params.entries());
      resolve(Object.keys(obj).length ? obj : { raw: body });
    });
    req.on('error', reject);
  });
}
const parseBody = parseRequestBody;

// ── 发送响应 ──
function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}
function text(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ── 虎皮椒签名：非空参数按 ASCII 排序，排除 hash，拼接 APPSECRET 后 md5 小写 ──
function xhpHash(params, secret = PAYMENT.secret) {
  const pairs = Object.keys(params)
    .filter(k => k !== 'hash' && params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map(k => `${k}=${params[k]}`);
  return crypto.createHash('md5').update(pairs.join('&') + secret, 'utf8').digest('hex');
}
function verifyXhpHash(params) {
  if (!params || !params.hash || !PAYMENT.secret) return false;
  return xhpHash(params) === String(params.hash).toLowerCase();
}
function makeTradeId() {
  return ('CR' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')).slice(0, 32);
}
function getBaseUrl(req) {
  if (PAYMENT.publicBaseUrl) return PAYMENT.publicBaseUrl.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
async function postJson(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await resp.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { errcode: resp.status, errmsg: raw || resp.statusText }; }
  return { ok: resp.ok, status: resp.status, data, raw };
}
function maskOrder(order) {
  if (!order) return null;
  return {
    trade_order_id: order.trade_order_id,
    status: order.status,
    amount: order.amount,
    title: order.title,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    username: order.username,
  };
}

async function createPaymentOrder(req, res) {
  if (!PAYMENT.secret) {
    return json(res, 500, { error: '支付密钥未配置。请在 server/.env 或部署环境变量中设置 XHP_APPSECRET。' });
  }
  const body = await parseBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const payChannel = String(body.payChannel || body.channel || 'xunhupay');
  if (!username || !password) return json(res, 400, { error: '用户名和密码不能为空' });
  if (username.length < 3 || username.length > 15) return json(res, 400, { error: '用户名长度需在 3-15 个字符之间' });
  if (password.length < 3 || password.length > 15) return json(res, 400, { error: '密码长度需在 3-15 个字符之间' });
  if (isUsernameTaken(username)) return json(res, 409, { error: '用户名已被占用' });

  const orders = readOrders();
  const existing = Object.values(orders).find(o => o.username === username && o.status === 'pending');
  if (existing && Date.now() - existing.createdAt < 10 * 60 * 1000) {
    return json(res, 200, { success: true, reused: true, ...existing.clientResponse, order: maskOrder(existing) });
  }

  const base = getBaseUrl(req);
  const trade_order_id = makeTradeId();
  const params = {
    version: '1.1',
    appid: PAYMENT.appid,
    trade_order_id,
    total_fee: PAYMENT.amount,
    title: PAYMENT.title,
    time: Math.floor(Date.now() / 1000),
    notify_url: `${base}/api/pay/notify`,
    return_url: `${base}/?cityrail_paid=${encodeURIComponent(trade_order_id)}`,
    callback_url: `${base}/`,
    plugins: 'CityRail',
    attach: JSON.stringify({ username, payChannel }).slice(0, 240),
    nonce_str: crypto.randomBytes(8).toString('hex'),
  };
  params.hash = xhpHash(params);

  const upstream = await postJson(PAYMENT.gateway, params);
  const data = upstream.data || {};
  if (Number(data.errcode) !== 0) {
    console.error('[CityRail Pay] 虎皮椒创建订单失败:', data);
    return json(res, 502, { error: data.errmsg || '支付网关创建订单失败', detail: data.errcode || upstream.status });
  }
  if (data.hash && !verifyXhpHash(data)) {
    console.error('[CityRail Pay] 虎皮椒返回签名校验失败:', data);
    return json(res, 502, { error: '支付网关返回签名校验失败' });
  }

  const clientResponse = {
    trade_order_id,
    url: data.url || '',
    url_qrcode: data.url_qrcode || '',
    openid: data.openid || data.oderid || '',
  };
  orders[trade_order_id] = {
    trade_order_id,
    username,
    passwordHash: hashPassword(password),
    amount: PAYMENT.amount,
    title: PAYMENT.title,
    payChannel,
    status: 'pending',
    createdAt: Date.now(),
    upstream: { openid: clientResponse.openid },
    clientResponse,
  };
  writeOrders(orders);
  json(res, 200, { success: true, ...clientResponse, order: maskOrder(orders[trade_order_id]) });
}

function completePaidOrder(notify) {
  const tradeId = String(notify.trade_order_id || '');
  const orders = readOrders();
  const order = orders[tradeId];
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (String(notify.status || '') !== 'OD') {
    order.status = String(notify.status || 'unknown');
    order.lastNotify = notify;
    writeOrders(orders);
    return { ok: true, paid: false };
  }
  if (String(notify.total_fee || order.amount) !== String(order.amount)) {
    order.status = 'amount_mismatch';
    order.lastNotify = notify;
    writeOrders(orders);
    return { ok: false, reason: 'amount_mismatch' };
  }
  if (!isUsernameTaken(order.username)) createUser(order.username, order.passwordHash);
  order.status = 'paid';
  order.paidAt = Date.now();
  order.transaction_id = notify.transaction_id || '';
  order.open_order_id = notify.open_order_id || '';
  order.lastNotify = notify;
  delete order.passwordHash;
  writeOrders(orders);
  return { ok: true, paid: true };
}

async function handlePaymentNotify(req, res) {
  const body = await parseBody(req);
  if (!verifyXhpHash(body)) {
    console.error('[CityRail Pay] notify 签名校验失败:', body);
    return text(res, 400, 'invalid hash');
  }
  const result = completePaidOrder(body);
  if (!result.ok) {
    console.error('[CityRail Pay] notify 处理失败:', result, body);
    return text(res, 400, result.reason || 'failed');
  }
  // 虎皮椒要求成功时返回纯文本 success，否则会重试回调。
  return text(res, 200, 'success');
}

function getPaymentStatus(req, res, url) {
  const tradeId = String(url.searchParams.get('trade_order_id') || url.searchParams.get('order') || '');
  if (!tradeId) return json(res, 400, { error: '缺少订单号' });
  const order = readOrders()[tradeId];
  if (!order) return json(res, 404, { error: '订单不存在' });
  json(res, 200, { success: true, order: maskOrder(order), paid: order.status === 'paid' });
}

// ── 静态文件服务 ──
function serveStatic(res, pathname) {
  const root = join(__dirname, '..');
  const filePath = join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (!filePath.startsWith(root)) { json(res, 403, { error: 'Forbidden' }); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { json(res, 404, { error: 'Not Found' }); return; }
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

// ── HTTP 服务器 ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  try {
    // API: 查重
    if (req.method === 'GET' && pathname.startsWith('/api/check-username/')) {
      const username = decodeURIComponent(pathname.split('/').pop());
      json(res, 200, { taken: isUsernameTaken(username) });
      return;
    }

    // API: 注册（保留兼容；正式付费路径会通过 /api/pay/notify 自动注册）
    if (req.method === 'POST' && pathname === '/api/register') {
      const { username, password } = await parseBody(req);
      if (!username || !password) return json(res, 400, { error: '用户名和密码不能为空' });
      if (username.length < 3 || username.length > 15) return json(res, 400, { error: '用户名长度需在 3-15 个字符之间' });
      if (password.length < 3 || password.length > 15) return json(res, 400, { error: '密码长度需在 3-15 个字符之间' });
      if (isUsernameTaken(username)) return json(res, 409, { error: '用户名已被占用' });
      createUser(username, hashPassword(password));
      json(res, 200, { success: true });
      return;
    }

    // API: 登录
    if (req.method === 'POST' && pathname === '/api/login') {
      const { username, password } = await parseBody(req);
      if (!username || !password) return json(res, 400, { error: '用户名和密码不能为空' });
      const user = findUserByUsername(username);
      if (!user || !verifyPassword(password, user.password)) return json(res, 401, { error: '用户名或密码错误' });
      json(res, 200, { success: true });
      return;
    }

    // API: 虎皮椒创建支付订单、异步通知、状态查询
    if (req.method === 'POST' && pathname === '/api/pay/create') return createPaymentOrder(req, res);
    if (req.method === 'POST' && pathname === '/api/pay/notify') return handlePaymentNotify(req, res);
    if (req.method === 'GET' && pathname === '/api/pay/status') return getPaymentStatus(req, res, url);

    // 静态文件
    serveStatic(res, pathname);
  } catch (err) {
    console.error('[CityRail Server] 请求处理失败:', err);
    json(res, 500, { error: '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`CityRail 服务器已启动 → http://localhost:${PORT}`);
  console.log(`支付网关: ${PAYMENT.gateway}`);
  console.log(`支付 APPID: ${PAYMENT.appid}`);
  if (!PAYMENT.secret) console.warn('警告：XHP_APPSECRET 未配置，支付接口会拒绝创建订单。');
});
