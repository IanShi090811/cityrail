import { json, handleOptions, parseBody, requireKV, userKey, normalizeUsername, verifyPassword } from '../_shared/cityrail-cloudflare.js';

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
    if (!userText) return json({ error: '用户名或密码错误' }, 401);
    const user = JSON.parse(userText);
    if (!user.paid || user.status !== 'active') return json({ error: '账号未支付或未激活' }, 403);
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return json({ error: '用户名或密码错误' }, 401);
    return json({ success: true });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
