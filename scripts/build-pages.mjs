import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '_site');

const rootFiles = [
  '404.html',
  '_headers',
  '_redirects',
  'download.html',
  'favicon.png',
  'index.html',
  'logo.jpeg',
  'logo.png',
  'logo.webp',
  'manifest.webmanifest',
  'og-image.webp',
  'robots.txt',
  'sitemap.xml',
  'sw.js'
];

const rootDirs = [
  'assets',
  'css',
  'data',
  'docs',
  'fixtures',
  'functions',
  'js',
  'releases',
  'seo',
  'vendor'
];

const desktopInstallerPattern = /^releases\/desktop\/.*\.(dmg|exe)$/;

function copyPath(relativePath) {
  const from = join(root, relativePath);
  if (!existsSync(from)) return;
  cpSync(from, join(outDir, relativePath), {
    recursive: true,
    force: true,
    filter: (source) => {
      const relative = source.slice(root.length + 1);
      return !desktopInstallerPattern.test(relative);
    }
  });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of rootFiles) copyPath(file);
for (const dir of rootDirs) copyPath(dir);

const maxPagesFileBytes = 25 * 1024 * 1024;
const oversized = [];

function collectOversizedFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      collectOversizedFiles(path);
      continue;
    }
    if (stats.size > maxPagesFileBytes) {
      oversized.push(path.slice(outDir.length + 1));
    }
  }
}

collectOversizedFiles(outDir);
if (oversized.length) {
  throw new Error(`Pages output contains files over 25 MiB: ${oversized.join(', ')}`);
}

console.log(`Built ${basename(outDir)} for Cloudflare Pages.`);
