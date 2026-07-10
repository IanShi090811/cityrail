import { json, handleOptions, parseBody, constantTimeEqual } from '../../_shared/cityrail-cloudflare.js';

const INVITE_SALT = 'cityrail-invite-v1:20260704';

export async function onRequestOptions() { return handleOptions(); }

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

function inviteHashes(env) {
  const raw = String(env && (env.CITYRAIL_INVITE_CODE_HASHES || env.CITYRAIL_INVITE_CODE_HASH) || '').trim();
  const configured = raw
    ? raw.split(/[\s,;|]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];
  return configured;
}

export async function onRequestPost(context) {
  try {
    const body = await parseBody(context.request);
    const code = String(body.code || '').replace(/\D/g, '').slice(0, 12);
    if (!/^\d{6}$/.test(code)) return json({ ok: false, error: '邀请码格式错误' }, 400);
    const hashes = inviteHashes(context.env);
    if (!hashes.length) return json({ ok: false, error: '邀请码服务未配置' }, 503);

    const actual = await sha256Hex(`${INVITE_SALT}:${code}`);
    const ok = hashes.some(expected => constantTimeEqual(actual, expected));
    if (!ok) return json({ ok: false, error: '邀请码错误' }, 403);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: '邀请码校验失败' }, 500);
  }
}
