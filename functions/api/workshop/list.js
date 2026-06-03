import { json, handleOptions, requireKV, workshopIndexKey } from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  try {
    const kv = requireKV(context.env);
    const text = await kv.get(workshopIndexKey());
    const items = text ? JSON.parse(text) : [];
    return json({ success: true, items: Array.isArray(items) ? items : [] });
  } catch (err) {
    return json({ error: '创意工坊读取失败', detail: String(err && err.message || err) }, 500);
  }
}
