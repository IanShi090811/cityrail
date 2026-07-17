import { webcrypto } from 'crypto';
import assert from 'node:assert/strict';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const shared = await import('../functions/_shared/cityrail-cloudflare.js');
const createPay = await import('../functions/api/pay/create.js');
const notifyPay = await import('../functions/api/pay/notify.js');
const statusPay = await import('../functions/api/pay/status.js');
const login = await import('../functions/api/login.js');
const checkUsername = await import('../functions/api/check-username/[username].js');

class MemoryKV {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    return this.map.get(key) || null;
  }
  async put(key, value) {
    this.map.set(key, String(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

function notifyBody(base, secret) {
  const body = { ...base };
  body.hash = shared.xhpHash(body, secret);
  return body;
}

const kv = new MemoryKV();
const secret = 'regression-secret';
const env = {
  CITYRAIL_KV: kv,
  XHP_APPSECRET: secret,
  XHP_GATEWAY: 'https://pay.example/create',
  PUBLIC_BASE_URL: 'https://cityrailgame.com',
};

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({
  errcode: 0,
  url: 'https://pay.example/order',
  url_qrcode: 'https://pay.example/qr.png',
}), { headers: { 'content-type': 'application/json' } });

try {
  const username = '付款回归用户';
  const passwordA = 'First123';
  const passwordB = 'Second123';

  const firstCreate = await readJson(await createPay.onRequestPost({
    request: jsonRequest('https://cityrailgame.com/api/pay/create', { username, password: passwordA }),
    env,
  }));
  assert.equal(firstCreate.success, true);

  const reusedCreate = await readJson(await createPay.onRequestPost({
    request: jsonRequest('https://cityrailgame.com/api/pay/create', { username, password: passwordB }),
    env,
  }));
  assert.equal(reusedCreate.success, true);
  assert.equal(reusedCreate.reused, true);

  const orderId = reusedCreate.trade_order_id;
  const pendingOrder = JSON.parse(await kv.get(shared.orderKey(orderId)));
  assert.equal(await shared.verifyPassword(passwordA, pendingOrder.passwordHash), false);
  assert.equal(await shared.verifyPassword(passwordB, pendingOrder.passwordHash), true);

  const checkPending = await readJson(await checkUsername.onRequestGet({ env, params: { username } }));
  assert.deepEqual(checkPending, { taken: true, active: false, pending: true });

  const pendingLogin = await readJson(await login.onRequestPost({
    request: jsonRequest('https://cityrailgame.com/api/login', { username, password: passwordB }),
    env,
  }));
  assert.equal(pendingLogin.pendingPayment, true);
  assert.equal(pendingLogin.order.trade_order_id, orderId);

  const paidNotify = notifyBody({
    trade_order_id: orderId,
    status: 'OD',
    total_fee: '18.80',
    transaction_id: 'txn-1',
    open_order_id: 'open-1',
  }, secret);
  const notifyResp = await notifyPay.onRequestPost({ request: jsonRequest('https://cityrailgame.com/api/pay/notify', paidNotify), env });
  assert.equal(await notifyResp.text(), 'success');

  const loginAfterPay = await readJson(await login.onRequestPost({
    request: jsonRequest('https://cityrailgame.com/api/login', { username, password: passwordB }),
    env,
  }));
  assert.equal(loginAfterPay.success, true);
  assert.equal(typeof loginAfterPay.token, 'string');
  assert.ok(loginAfterPay.token.length > 10);

  const duplicateNotify = await notifyPay.onRequestPost({ request: jsonRequest('https://cityrailgame.com/api/pay/notify', paidNotify), env });
  assert.equal(await duplicateNotify.text(), 'success');
  const userAfterDuplicate = JSON.parse(await kv.get(shared.userKey(username)));
  assert.equal(await shared.verifyPassword(passwordB, userAfterDuplicate.passwordHash), true);

  const lateNonPaidNotify = notifyBody({
    trade_order_id: orderId,
    status: 'WAIT',
    total_fee: '18.80',
  }, secret);
  const lateResp = await notifyPay.onRequestPost({ request: jsonRequest('https://cityrailgame.com/api/pay/notify', lateNonPaidNotify), env });
  assert.equal(await lateResp.text(), 'success');
  const orderAfterLate = JSON.parse(await kv.get(shared.orderKey(orderId)));
  assert.equal(orderAfterLate.status, 'paid');

  const statusAfterPay = await readJson(await statusPay.onRequestGet({
    request: new Request(`https://cityrailgame.com/api/pay/status?trade_order_id=${encodeURIComponent(orderId)}`),
    env,
  }));
  assert.equal(statusAfterPay.paid, true);
  assert.equal(statusAfterPay.username, username);
  assert.equal(typeof statusAfterPay.token, 'string');
  assert.ok(statusAfterPay.token.length > 10);
} finally {
  globalThis.fetch = realFetch;
}

console.log('payment_flow_regression: ok');
