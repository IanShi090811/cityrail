import { json, handleOptions } from '../_shared/cityrail-cloudflare.js';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequest() {
  return json({ error: 'API route not found' }, 404);
}
