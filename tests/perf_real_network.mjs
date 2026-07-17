#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CHROMIUM = CHROMIUM_CANDIDATES.find(path => existsSync(path));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolvePort(port));
    });
    srv.on('error', reject);
  });
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.html') return 'text/html;charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript;charset=utf-8';
  if (ext === '.css') return 'text/css;charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json;charset=utf-8';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function startServer(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = resolve(join(ROOT, path.replace(/^\/+/, '')));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise(resolveServer => server.listen(port, '127.0.0.1', () => resolveServer(server)));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result || {});
    });
  }
  static async connect(wsurl) {
    const ws = new WebSocket(wsurl);
    await new Promise((resolveOpen, reject) => {
      ws.addEventListener('open', resolveOpen, { once:true });
      ws.addEventListener('error', reject, { once:true });
    });
    return new CDP(ws);
  }
  cmd(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCmd, reject) => {
      this.pending.set(id, { resolve:resolveCmd, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 180000);
    });
  }
  async eval(expression, awaitPromise = false) {
    const res = await this.cmd('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue:true,
      timeout:180000,
    });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
    return res.result && res.result.value;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

function helperJs() {
  const py = readFileSync(join(ROOT, 'tests/perf_real_network.py'), 'utf8');
  const match = py.match(/HELPER_JS = r"""\n([\s\S]*?)\n"""/);
  if (!match) throw new Error('HELPER_JS not found in perf_real_network.py');
  return match[1];
}

function summarizeCpuProfile(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) return [];
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const dt = deltas[i] || 0;
    self.set(id, (self.get(id) || 0) + dt / 1000);
  }
  return Array.from(self.entries()).map(([id, ms]) => {
    const node = byId.get(id) || {};
    const call = node.callFrame || {};
    return {
      ms,
      functionName: call.functionName || '(anonymous)',
      url: call.url || '',
      line: call.lineNumber == null ? null : call.lineNumber + 1,
      column: call.columnNumber == null ? null : call.columnNumber + 1
    };
  }).sort((a, b) => b.ms - a.ms).slice(0, 30);
}

async function main() {
  if (!CHROMIUM) {
    console.log('SKIP: chromium not found');
    return;
  }
  let ticks = 30;
  let stressMode = false;
  let durationMs = 5000;
  let trainsPerLine = 4;
  let cpuProfile = false;
  const cities = [];
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--ticks=(\d+)$/);
    const durationMatch = arg.match(/^--duration=(\d+)$/);
    const trainsMatch = arg.match(/^--trains-per-line=(\d+)$/);
    if (match) ticks = Math.max(1, Number(match[1]) || 30);
    else if (durationMatch) durationMs = Math.max(500, Number(durationMatch[1]) || 5000);
    else if (trainsMatch) trainsPerLine = Math.max(1, Number(trainsMatch[1]) || 4);
    else if (arg === '--stress') stressMode = true;
    else if (arg === '--cpu-profile') cpuProfile = true;
    else cities.push(arg);
  }
  if (!cities.length) cities.push('beijing', 'shanghai', 'guangzhou');
  const port = await freePort();
  const dbg = await freePort();
  const server = await startServer(port);
  const profile = mkdtempSync(join(tmpdir(), 'cityrail-perf-'));
  const chrome = spawn(CHROMIUM, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}/index.html`,
  ], { stdio:'ignore' });
  let cdp = null;
  try {
    let wsurl = '';
    const pageUrl = `http://127.0.0.1:${port}/index.html`;
    for (let i = 0; i < 120; i++) {
      try {
        const tabs = await fetch(`http://127.0.0.1:${dbg}/json`).then(r => r.json());
        const tab = (tabs || []).find(item => item.type === 'page' && String(item.url || '').startsWith(pageUrl))
          || (tabs || []).find(item => item.type === 'page' && item.webSocketDebuggerUrl);
        if (tab && tab.webSocketDebuggerUrl) {
          wsurl = tab.webSocketDebuggerUrl;
          break;
        }
      } catch {}
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    if (!wsurl) throw new Error('cannot connect chromium devtools');
    cdp = await CDP.connect(wsurl);
    await cdp.cmd('Runtime.enable');
    await cdp.cmd('Page.enable');
    await cdp.cmd('Page.navigate', { url:pageUrl });
    for (let i = 0; i < 160; i++) {
      const ready = await cdp.eval('!!(window.state && typeof window.runSimulation === "function" && typeof window.updateTrains === "function")');
      if (ready) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    }
    const runtimeReady = await cdp.eval('!!(window.state && typeof window.runSimulation === "function" && typeof window.updateTrains === "function")');
    if (!runtimeReady) {
      const debug = await cdp.eval('({href:location.href,title:document.title,ready:document.readyState,state:typeof window.state,runSimulation:typeof window.runSimulation,updateTrains:typeof window.updateTrains,scripts:Array.from(document.scripts).slice(-12).map(s=>s.src||s.id||"inline"),body:(document.body&&document.body.innerText||"").slice(0,240),error:window.__cityrailInjectError||null})');
      throw new Error('CityRail runtime did not become ready: ' + JSON.stringify(debug));
    }
    await cdp.eval(helperJs());
    const results = [];
    for (const city of cities) {
      const expr = stressMode
        ? `window.__cityrailRealNetworkPerf.stress(${JSON.stringify(city)}, ${JSON.stringify({ durationMs, trainsPerLine })})`
        : `window.__cityrailRealNetworkPerf.bench(${JSON.stringify(city)}, ${ticks})`;
      if (cpuProfile) {
        await cdp.cmd('Profiler.enable');
        await cdp.cmd('Profiler.start');
      }
      const result = await cdp.eval(expr, true);
      if (cpuProfile) {
        const profileResult = await cdp.cmd('Profiler.stop');
        result.cpuTop = summarizeCpuProfile(profileResult.profile);
      }
      results.push(result);
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    if (cdp) cdp.close();
    await new Promise(resolve => {
      if (chrome.exitCode !== null || chrome.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try { chrome.kill('SIGKILL'); } catch {}
        resolve();
      }, 1500);
      timer.unref?.();
      chrome.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { chrome.kill('SIGTERM'); } catch { resolve(); }
    });
    try { server.closeAllConnections?.(); } catch {}
    await Promise.race([
      new Promise(resolve => server.close(resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
    try {
      rmSync(profile, { recursive:true, force:true, maxRetries:5, retryDelay:120 });
    } catch {}
  }
}

main().then(() => {
  process.exit(0);
}).catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
