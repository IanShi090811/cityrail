import { json, handleOptions, runtimeDiagnostics } from './_shared/cityrail-cloudflare.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet({ env, request }) {
  const d = runtimeDiagnostics(env || {});
  const ok = d.kvBound && d.hasSecret && d.hasAppId && d.hasGateway;
  return json({
    ok,
    version: 'v147.1-backend-connected',
    diagnostics: d,
    hint: ok ? 'Cloudflare Pages Functions, KV and payment env are connected.' : 'Check Production Variables and Bindings, then redeploy.',
  }, ok ? 200 : 503);
}
