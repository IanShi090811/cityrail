import {
  json, handleOptions, parseBody, requireKV, userKey, pendingUserKey, orderKey,
  maskOrder, normalizeUsername, verifyPassword, createSession
} from '../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const kv = requireKV(env);
    const body = await parseBody(request);
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
    const userText = await kv.get(userKey(username));
    if (!userText) {
      const pendingOrderId = await kv.get(pendingUserKey(username));
      if (pendingOrderId) {
        const orderText = await kv.get(orderKey(pendingOrderId));
        if (orderText) {
          const order = JSON.parse(orderText);
          const pendingPasswordOk = order.status === 'pending' && await verifyPassword(password, order.passwordHash);
          if (pendingPasswordOk) {
            return json({
              pendingPayment: true,
              error: '账号待支付，请继续完成支付',
              order: maskOrder(order),
              payment: order.clientResponse || {},
            }, 402);
          }
        }
      }
      return json({ error: '用户名或密码错误' }, 401);
    }
    const user = JSON.parse(userText);
    if (!user.paid || user.status !== 'active') return json({ error: '账号未支付或未激活' }, 403);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return json({ error: '用户名或密码错误' }, 401);
    const token = await createSession(kv, username);
    return json({ success: true, username, token });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
