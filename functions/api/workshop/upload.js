import {
  json, handleOptions, parseBody, requireKV, requireRequestSession,
  makeWorkshopId, workshopIndexKey, workshopItemKey, workshopUserKey
} from '../../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

function cleanText(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function publicMeta(item) {
  const { save, ...meta } = item;
  return meta;
}

export async function onRequestPost(context) {
  try {
    const kv = requireKV(context.env);
    const body = await parseBody(context.request);
    const username = await requireRequestSession(kv, context.request);
    const title = cleanText(body.title, 36);
    const description = cleanText(body.description, 360);
    const thumbnail = body.thumbnail && typeof body.thumbnail === 'object' ? body.thumbnail : null;
    const save = body.save;
    if (!title) return json({ error: '请输入作品名称' }, 400);
    if (!description) return json({ error: '请输入作品介绍' }, 400);
    if (!save || typeof save !== 'object') return json({ error: '请上传有效存档' }, 400);
    const saveSize = JSON.stringify(save).length;
    if (saveSize > 4_500_000) return json({ error: '存档过大，请导出精简后的存档再上传' }, 413);
    if (thumbnail && JSON.stringify(thumbnail).length > 120000) return json({ error: '缩略图数据过大' }, 413);

    const now = Date.now();
    const id = makeWorkshopId();
    const summary = {
      stations: Array.isArray(save.state && save.state.stations) ? save.state.stations.length : (Array.isArray(save.stations) ? save.stations.length : 0),
      lines: Array.isArray(save.state && save.state.lines) ? save.state.lines.length : (Array.isArray(save.lines) ? save.lines.length : 0),
      trains: Array.isArray(save.state && save.state.trains) ? save.state.trains.length : (Array.isArray(save.trains) ? save.trains.length : 0),
    };
    const item = {
      id, title, description, thumbnail, summary,
      author: username, createdAt: now, updatedAt: now, downloads: 0,
      save,
    };
    await kv.put(workshopItemKey(id), JSON.stringify(item));

    const indexText = await kv.get(workshopIndexKey());
    const index = indexText ? JSON.parse(indexText) : [];
    const nextIndex = [publicMeta(item), ...(Array.isArray(index) ? index : []).filter(x => x && x.id !== id)].slice(0, 300);
    await kv.put(workshopIndexKey(), JSON.stringify(nextIndex));

    const mineText = await kv.get(workshopUserKey(username));
    const mine = mineText ? JSON.parse(mineText) : [];
    await kv.put(workshopUserKey(username), JSON.stringify([id, ...(Array.isArray(mine) ? mine.filter(x => x !== id) : [])].slice(0, 120)));

    return json({ success: true, item: publicMeta(item) });
  } catch (err) {
    const message = String(err && err.message || err);
    const status = /登录|账号/.test(message) ? 401 : 500;
    return json({ error: status === 401 ? message : '上传失败', detail: status === 401 ? undefined : message }, status);
  }
}
