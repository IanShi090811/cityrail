import {
  json, handleOptions, parseBody, requireKV, requireSession,
  workshopIndexKey, workshopItemKey, workshopUserKey
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost(context) {
  try {
    const kv = requireKV(context.env);
    const body = await parseBody(context.request);
    const username = await requireSession(kv, body.token);
    const id = String(body.id || '').trim();
    if (!id) return json({ error: '缺少作品 ID' }, 400);
    const text = await kv.get(workshopItemKey(id));
    if (!text) return json({ error: '作品不存在' }, 404);
    const item = JSON.parse(text);
    if (item.author !== username) return json({ error: '只能管理自己上传的作品' }, 403);

    await kv.delete(workshopItemKey(id));
    const indexText = await kv.get(workshopIndexKey());
    const index = indexText ? JSON.parse(indexText) : [];
    await kv.put(workshopIndexKey(), JSON.stringify((Array.isArray(index) ? index : []).filter(x => x && x.id !== id)));
    const mineText = await kv.get(workshopUserKey(username));
    const mine = mineText ? JSON.parse(mineText) : [];
    await kv.put(workshopUserKey(username), JSON.stringify((Array.isArray(mine) ? mine : []).filter(x => x !== id)));

    return json({ success: true });
  } catch (err) {
    const message = String(err && err.message || err);
    const status = /登录|账号/.test(message) ? 401 : 500;
    return json({ error: status === 401 ? message : '删除失败', detail: status === 401 ? undefined : message }, status);
  }
}
