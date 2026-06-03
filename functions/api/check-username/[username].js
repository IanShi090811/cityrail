import { json, handleOptions, requireKV, userKey, pendingUserKey, normalizeUsername } from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  const { env, params } = context;
  try {
    const kv = requireKV(env);
    const username = normalizeUsername(params.username);
    const active = await kv.get(userKey(username));
    const pending = await kv.get(pendingUserKey(username));
    return json({ taken: !!active || !!pending });
  } catch (err) {
    return json({ error: '服务器内部错误', detail: String(err && err.message || err) }, 500);
  }
}
