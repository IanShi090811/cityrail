import {
  text, handleOptions, parseBody, requireKV, paymentConfig, verifyXhpHash,
  orderKey, pendingUserKey, userKey
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const kv = requireKV(env);
    const cfg = paymentConfig(env);
    const body = await parseBody(request);
    if (!verifyXhpHash(body, cfg.secret)) return text('invalid hash', 400);

    const tradeId = String(body.trade_order_id || '');
    const orderText = await kv.get(orderKey(tradeId));
    if (!orderText) return text('order_not_found', 404);
    const order = JSON.parse(orderText);

    if (String(body.status || '') !== 'OD') {
      order.status = String(body.status || 'unknown');
      order.lastNotify = body;
      await kv.put(orderKey(tradeId), JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });
      return text('success');
    }

    if (String(body.total_fee || order.amount) !== String(order.amount)) {
      order.status = 'amount_mismatch';
      order.lastNotify = body;
      await kv.put(orderKey(tradeId), JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });
      return text('amount_mismatch', 400);
    }

    const user = {
      username: order.username,
      passwordHash: order.passwordHash,
      status: 'active',
      paid: true,
      activatedAt: Date.now(),
      trade_order_id: tradeId,
    };
    await kv.put(userKey(order.username), JSON.stringify(user));

    order.status = 'paid';
    order.paidAt = Date.now();
    order.transaction_id = body.transaction_id || '';
    order.open_order_id = body.open_order_id || '';
    order.lastNotify = body;
    delete order.passwordHash;
    await kv.put(orderKey(tradeId), JSON.stringify(order));
    await kv.delete(pendingUserKey(order.username));

    // 虎皮椒要求成功回调返回纯文本 success，否则会重试。
    return text('success');
  } catch (err) {
    return text('failed:' + String(err && err.message || err), 500);
  }
}
