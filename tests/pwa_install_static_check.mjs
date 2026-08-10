import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const index = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const sw = read('sw.js');
const install = read('js/cityrail-pwa-install-authority.js');

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');
assert.equal(manifest.start_url, '/?source=pwa');
assert.equal(manifest.prefer_related_applications, false);
assert(manifest.icons.some(icon => String(icon.purpose || '').includes('maskable')));
assert(manifest.shortcuts.length >= 2);

for (const marker of [
  'apple-mobile-web-app-capable',
  'mobile-web-app-capable',
  'apple-mobile-web-app-status-bar-style',
  'apple-touch-icon',
  'js/cityrail-pwa-install-authority.js'
]) {
  assert(index.includes(marker), `${marker} missing from index.html`);
}

for (const marker of ['beforeinstallprompt', 'appinstalled', 'CityRailPwaInstall', '安装到桌面']) {
  assert(install.includes(marker), `${marker} missing from PWA install module`);
}

for (const marker of ['/manifest.webmanifest', '/logo.png', '/logo.webp', '/favicon.png']) {
  assert(sw.includes(marker), `${marker} missing from service worker shell cache`);
}

console.log(JSON.stringify({
  pwaInstallStaticCheck: 'pass',
  display: manifest.display,
  startUrl: manifest.start_url,
  maskableIcon: true
}, null, 2));
