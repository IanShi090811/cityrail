import { handleOptions } from '../../_shared/cityrail-cloudflare.js';
import { analyticsSummary } from '../../_shared/cityrail-analytics.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet(context) {
  try {
    return await analyticsSummary(context);
  } catch (err) {
    return new Response(JSON.stringify({ error: '访问统计读取失败', detail: String(err && err.message || err) }), {
      status: 500,
      headers: {
        'content-type': 'application/json;charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  }
}
