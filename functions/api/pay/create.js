import {
  json, handleOptions, parseBody, requireKV, paymentConfig, publicBaseUrl,
  validateCredentials, normalizeUsername, makeTradeId, makeNonce, xhpHash,
  hashPassword, userKey, pendingUserKey, orderKey, maskOrder, verifyXhpHash
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const kv = requireKV(env);
    const cfg = paymentConfig(env);
    if (!cfg.secret) return json({ error: '支付密钥未配置。请在 Cloudflare Pages 环境变量中设置 XHP_APPSECRET。' }, 500);

    const body = await parseBody(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    const payChannel = String(body.payChannel || body.channel || 'xunhupay');
    const credentialError = validateCredentials(username, password);
    if (credentialError) return json({ error: credentialError }, 400);

    const existingUser = await kv.get(userKey(username));
    if (existingUser) return json({ error: '用户名已被占用' }, 409);

    const existingOrderId = await kv.get(pendingUserKey(username));
    if (existingOrderId) {
      const existingText = await kv.get(orderKey(existingOrderId));
      if (existingText) {
        const existing = JSON.parse(existingText);
        if (existing.status === 'pending' && Date.now() - existing.createdAt < 10 * 60 * 1000) {
          return json({ success: true, reused: true, ...existing.clientResponse, order: maskOrder(existing) });
        }
      }
    }

    const base = publicBaseUrl(request, env);
    const trade_order_id = makeTradeId();
    const params = {
      version: '1.1',
      appid: cfg.appid,
      trade_order_id,
      total_fee: cfg.amount,
      title: cfg.title,
      time: Math.floor(Date.now() / 1000),
      notify_url: `${base}/api/pay/notify`,
      return_url: `${base}/?cityrail_paid=${encodeURIComponent(trade_order_id)}`,
      callback_url: `${base}/`,
      plugins: 'CityRailCloudflarePages',
      attach: JSON.stringify({ username, payChannel }).slice(0, 240),
      nonce_str: makeNonce(8),
    };
    params.hash = xhpHash(params, cfg.secret);

    const upstreamResp = await fetch(cfg.gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const raw = await upstreamResp.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { errcode: upstreamResp.status, errmsg: raw || upstreamResp.statusText }; }

    if (Number(data.errcode) !== 0) {
      return json({ error: data.errmsg || '支付网关创建订单失败', detail: data.errcode || upstreamResp.status }, 502);
    }
    if (data.hash && !verifyXhpHash(data, cfg.secret)) {
      return json({ error: '支付网关返回签名校验失败' }, 502);
    }

    const clientResponse = {
      trade_order_id,
      url: data.url || '',
      url_qrcode: data.url_qrcode || '',
      openid: data.openid || data.oderid || '',
    };

    const order = {
      trade_order_id,
      username,
      passwordHash: await hashPassword(password),
      amount: cfg.amount,
      title: cfg.title,
      payChannel,
      status: 'pending',
      createdAt: Date.now(),
      upstream: { openid: clientResponse.openid },
      clientResponse,
    };

    await kv.put(orderKey(trade_order_id), JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });
    await kv.put(pendingUserKey(username), trade_order_id, { expirationTtl: 60 * 60 * 24 });

    return json({ success: true, ...clientResponse, order: maskOrder(order) });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
