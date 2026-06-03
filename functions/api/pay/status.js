import { json, handleOptions, requireKV, orderKey, maskOrder } from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const kv = requireKV(env);
    const url = new URL(request.url);
    const tradeId = String(url.searchParams.get('trade_order_id') || url.searchParams.get('order') || '');
    if (!tradeId) return json({ error: '缺少订单号' }, 400);
    const text = await kv.get(orderKey(tradeId));
    if (!text) return json({ error: '订单不存在', paid: false }, 404);
    const order = JSON.parse(text);
    return json({ success: true, order: maskOrder(order), paid: order.status === 'paid' });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
