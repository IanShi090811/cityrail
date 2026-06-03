import { json, handleOptions } from '../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost() {
  return json({ error: '本版本为付费注册，请通过 /api/pay/create 创建支付订单，支付成功后自动开通账号。' }, 403);
}
