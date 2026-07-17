import { json, handleOptions, requireKV, orderKey, userKey, maskOrder, createSession } from '../../_shared/cityrail-cloudflare.js';

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
    const paid = order.status === 'paid';
    if (!paid) return json({ success: true, order: maskOrder(order), paid: false, token: '', username: '' });
    const userText = order.username ? await kv.get(userKey(order.username)) : '';
    if (!userText) return json({ error: '账号开通异常，请联系客服', order: maskOrder(order), paid: false }, 409);
    const user = JSON.parse(userText);
    if (!user.paid || user.status !== 'active') return json({ error: '账号未支付或未激活', order: maskOrder(order), paid: false }, 409);
    const token = await createSession(kv, order.username);
    return json({ success: true, order: maskOrder(order), paid, token, username: paid ? order.username : '' });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
