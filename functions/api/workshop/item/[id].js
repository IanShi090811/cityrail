import { json, handleOptions, requireKV, workshopIndexKey, workshopItemKey } from '../../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  try {
    const kv = requireKV(context.env);
    const id = String(context.params.id || '').trim();
    if (!id) return json({ error: '缺少作品 ID' }, 400);
    const text = await kv.get(workshopItemKey(id));
    if (!text) return json({ error: '作品不存在' }, 404);
    const item = JSON.parse(text);
    const url = new URL(context.request.url);
    if (url.searchParams.get('download') === '1') {
      item.downloads = Number(item.downloads || 0) + 1;
      item.updatedAt = item.updatedAt || Date.now();
      await kv.put(workshopItemKey(id), JSON.stringify(item));
      const indexText = await kv.get(workshopIndexKey());
      const index = indexText ? JSON.parse(indexText) : [];
      if (Array.isArray(index)) {
        await kv.put(workshopIndexKey(), JSON.stringify(index.map(meta => meta && meta.id === id ? { ...meta, downloads: item.downloads } : meta)));
      }
    }
    return json({ success: true, item });
  } catch (err) {
    return json({ error: '作品读取失败', detail: String(err && err.message || err) }, 500);
  }
}
