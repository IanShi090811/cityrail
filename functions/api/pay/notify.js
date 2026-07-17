import {
  text, handleOptions, parseBody, requireKV, paymentConfig, verifyXhpHash,
  orderKey, pendingUserKey, userKey
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

function amountCents(value) {
  const n = Number(String(value || '').trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

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

    if (order.status === 'paid') return text('success');

    if (String(body.status || '') !== 'OD') {
      order.status = String(body.status || 'unknown');
      order.lastNotify = body;
      await kv.put(orderKey(tradeId), JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });
      return text('success');
    }

    if (amountCents(order.amount) !== amountCents(cfg.amount) || amountCents(body.total_fee) !== amountCents(cfg.amount)) {
      order.status = 'amount_mismatch';
      order.expectedAmount = cfg.amount;
      order.lastNotify = body;
      await kv.put(orderKey(tradeId), JSON.stringify(order), { expirationTtl: 60 * 60 * 24 });
      return text('amount_mismatch', 400);
    }

    if (!order.passwordHash) return text('missing_password_hash', 409);

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
