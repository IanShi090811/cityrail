import {
  json, handleOptions, requireKV, requireRequestSession,
  workshopUserKey, workshopItemKey
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  try {
    const kv = requireKV(context.env);
    const username = await requireRequestSession(kv, context.request);
    const mineText = await kv.get(workshopUserKey(username));
    const ids = mineText ? JSON.parse(mineText) : [];
    const items = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      const text = await kv.get(workshopItemKey(id));
      if (!text) continue;
      const item = JSON.parse(text);
      const { save, ...meta } = item;
      items.push(meta);
    }
    return json({ success: true, items });
  } catch (err) {
    const message = String(err && err.message || err);
    const status = /登录|账号/.test(message) ? 401 : 500;
    return json({ error: status === 401 ? message : '读取我的作品失败', detail: status === 401 ? undefined : message }, status);
  }
}
