import { json, parseBody, requireKV, constantTimeEqual } from './cityrail-cloudflare.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const MAX_ACTIVE_VISITORS = 5000;
const EVENT_TYPES = new Set(['visit', 'perf', 'heartbeat', 'error', 'resource-error', 'unhandledrejection', 'longtask']);
let analyticsWriteQueue = Promise.resolve();

function ymd(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function keyForDay(day) {
  return `analytics:day:${day}`;
}

function visitorKey(day, hash) {
  return `analytics:visitor:${day}:${hash}`;
}

function cleanText(value, max = 160) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function cleanKey(value, fallback = 'unknown') {
  const text = cleanText(value, 80).trim();
  return text || fallback;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function inc(map, key, amount = 1) {
  key = cleanKey(key);
  map[key] = (number(map[key]) || 0) + amount;
}

function trimTopMap(map, limit = 80) {
  const rows = Object.entries(map || {})
    .map(([key, value]) => [key, number(value)])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return Object.fromEntries(rows);
}

function addMetric(summary, key, value) {
  const v = number(value);
  if (!v) return;
  const metrics = summary.performance || (summary.performance = {});
  const row = metrics[key] || (metrics[key] = { count: 0, sum: 0, max: 0 });
  row.count += 1;
  row.sum += v;
  row.max = Math.max(row.max || 0, v);
}

function emptySummary(day) {
  return {
    version: 1,
    day,
    createdAt: new Date().toISOString(),
    updatedAt: '',
    totals: {
      events: 0,
      visits: 0,
      uniqueVisitors: 0,
      heartbeats: 0,
      perf: 0,
      errors: 0,
      resourceErrors: 0,
      unhandledRejections: 0,
      longTasks: 0,
      loggedInEvents: 0,
      active5m: 0,
    },
    hours: {},
    paths: {},
    builds: {},
    devices: {},
    languages: {},
    performance: {},
    errorKinds: {},
    errorMessages: {},
    errorSources: {},
    resourceHosts: {},
    activeVisitors: {},
  };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readSummary(kv, day) {
  const text = await kv.get(keyForDay(day));
  if (!text) return emptySummary(day);
  try {
    const parsed = JSON.parse(text);
    return Object.assign(emptySummary(day), parsed, {
      totals: Object.assign(emptySummary(day).totals, parsed.totals || {}),
      hours: parsed.hours || {},
      paths: parsed.paths || {},
      builds: parsed.builds || {},
      devices: parsed.devices || {},
      languages: parsed.languages || {},
      performance: parsed.performance || {},
      errorKinds: parsed.errorKinds || {},
      errorMessages: parsed.errorMessages || {},
      errorSources: parsed.errorSources || {},
      resourceHosts: parsed.resourceHosts || {},
      activeVisitors: parsed.activeVisitors || {},
    });
  } catch {
    return emptySummary(day);
  }
}

async function writeSummary(kv, summary) {
  summary.updatedAt = new Date().toISOString();
  await kv.put(keyForDay(summary.day), JSON.stringify(summary), { expirationTtl: 60 * 60 * 24 * 95 });
}

function pruneActive(summary, nowMs) {
  const active = summary.activeVisitors || {};
  const rows = Object.entries(active)
    .map(([hash, seenAt]) => [hash, Number(seenAt) || 0])
    .filter(([, seenAt]) => nowMs - seenAt <= ACTIVE_WINDOW_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ACTIVE_VISITORS);
  summary.activeVisitors = Object.fromEntries(rows);
  summary.totals.active5m = rows.length;
}

export async function recordVisit(context) {
  const task = () => recordVisitDirect(context);
  const next = analyticsWriteQueue.then(task, task);
  analyticsWriteQueue = next.catch(() => {});
  return next;
}

async function recordVisitDirect(context) {
  const { request, env } = context;
  const kv = requireKV(env);
  const body = await parseBody(request);
  const now = new Date();
  const nowMs = now.getTime();
  const day = ymd(now);
  const url = new URL(request.url);
  const eventText = String(body.event || 'visit');
  const event = EVENT_TYPES.has(eventText) ? eventText : 'visit';
  const rawVisitor = cleanText(body.visitorId || `${request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''}|${request.headers.get('user-agent') || ''}`, 220);
  const visitorHash = await sha256Hex(rawVisitor || makeAnonymousSeed(request));
  const uniqueKey = visitorKey(day, visitorHash);
  const isNewVisitor = !(await kv.get(uniqueKey));
  if (isNewVisitor) await kv.put(uniqueKey, '1', { expirationTtl: 60 * 60 * 24 * 35 });

  const summary = await readSummary(kv, day);
  summary.totals.events += 1;
  if (event === 'visit') summary.totals.visits += 1;
  if (event === 'heartbeat') summary.totals.heartbeats += 1;
  if (event === 'perf') summary.totals.perf += 1;
  if (event === 'error') summary.totals.errors += 1;
  if (event === 'resource-error') summary.totals.resourceErrors += 1;
  if (event === 'unhandledrejection') summary.totals.unhandledRejections += 1;
  if (event === 'longtask') summary.totals.longTasks += 1;
  if (body.loggedIn) summary.totals.loggedInEvents += 1;
  if (isNewVisitor) summary.totals.uniqueVisitors += 1;

  inc(summary.hours, String(new Date(nowMs + 8 * 60 * 60 * 1000).getUTCHours()).padStart(2, '0'));
  inc(summary.paths, cleanText(body.path || url.pathname || '/', 120));
  inc(summary.builds, cleanText(body.build || 'unknown', 120));
  inc(summary.devices, cleanText(body.device || 'unknown', 80));
  inc(summary.languages, cleanText(body.language || request.headers.get('accept-language') || 'unknown', 80));

  const metrics = body.metrics && typeof body.metrics === 'object' ? body.metrics : {};
  ['loadMs', 'domReadyMs', 'firstPaintMs', 'largestPaintMs', 'resourceCount', 'longTaskMs'].forEach(key => addMetric(summary, key, metrics[key]));

  if (event === 'error' || event === 'resource-error' || event === 'unhandledrejection') {
    const detail = body.error && typeof body.error === 'object' ? body.error : {};
    inc(summary.errorKinds, event);
    inc(summary.errorMessages, cleanText(detail.message || detail.name || event, 160));
    inc(summary.errorSources, cleanText(detail.source || detail.filename || body.path || 'unknown', 160));
    if (detail.resourceUrl) {
      try { inc(summary.resourceHosts, new URL(String(detail.resourceUrl)).host || 'unknown'); }
      catch { inc(summary.resourceHosts, cleanText(detail.resourceUrl, 80)); }
    }
    summary.errorKinds = trimTopMap(summary.errorKinds);
    summary.errorMessages = trimTopMap(summary.errorMessages);
    summary.errorSources = trimTopMap(summary.errorSources);
    summary.resourceHosts = trimTopMap(summary.resourceHosts);
  }

  summary.activeVisitors[visitorHash] = nowMs;
  pruneActive(summary, nowMs);
  await writeSummary(kv, summary);
  return json({ success: true, version: summary.version, day, active5m: summary.totals.active5m });
}

function makeAnonymousSeed(request) {
  return `${Date.now()}|${Math.random()}|${request.headers.get('user-agent') || ''}`;
}

function publicSummary(summary) {
  const active = summary.activeVisitors || {};
  const performance = {};
  Object.entries(summary.performance || {}).forEach(([key, row]) => {
    const count = number(row && row.count);
    performance[key] = {
      count,
      avg: count ? Math.round(number(row.sum) / count) : 0,
      max: Math.round(number(row && row.max)),
    };
  });
  return {
    version: summary.version,
    day: summary.day,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    totals: Object.assign({}, summary.totals, { active5m: Object.keys(active).length }),
    hours: summary.hours || {},
    paths: summary.paths || {},
    builds: summary.builds || {},
    devices: summary.devices || {},
    languages: summary.languages || {},
    performance,
    errors: {
      kinds: summary.errorKinds || {},
      messages: summary.errorMessages || {},
      sources: summary.errorSources || {},
      resourceHosts: summary.resourceHosts || {},
    },
  };
}

export async function analyticsSummary(context) {
  const { request, env } = context;
  if (!isAdminRequest(request, env)) return json({ error: '未授权访问统计后台' }, 403);
  const kv = requireKV(env);
  const url = new URL(request.url);
  const days = Math.max(1, Math.min(31, Math.round(Number(url.searchParams.get('days')) || 7)));
  const today = new Date();
  const rows = [];
  for (let i = 0; i < days; i++) {
    rows.push(publicSummary(await readSummary(kv, ymd(new Date(today.getTime() - i * DAY_MS)))));
  }
  const totals = rows.reduce((acc, row) => {
    acc.events += number(row.totals.events);
    acc.visits += number(row.totals.visits);
    acc.uniqueVisitors += number(row.totals.uniqueVisitors);
    acc.heartbeats += number(row.totals.heartbeats);
    acc.perf += number(row.totals.perf);
    acc.errors += number(row.totals.errors);
    acc.resourceErrors += number(row.totals.resourceErrors);
    acc.unhandledRejections += number(row.totals.unhandledRejections);
    acc.longTasks += number(row.totals.longTasks);
    acc.loggedInEvents += number(row.totals.loggedInEvents);
    return acc;
  }, { events: 0, visits: 0, uniqueVisitors: 0, heartbeats: 0, perf: 0, errors: 0, resourceErrors: 0, unhandledRejections: 0, longTasks: 0, loggedInEvents: 0 });
  return json({ success: true, days, active5m: rows[0] ? rows[0].totals.active5m : 0, totals, rows });
}

function isAdminRequest(request, env) {
  const token = cleanText(env && env.CITYRAIL_ADMIN_TOKEN, 256).trim();
  if (!token) return false;
  const url = new URL(request.url);
  const bearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const queryToken = String(url.searchParams.get('token') || '').trim();
  return constantTimeEqual(token, bearer) || constantTimeEqual(token, queryToken);
}
