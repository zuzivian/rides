#!/usr/bin/env node
// "Build" = copy the static app into dist/ and verify every relative import
// and asset reference resolves. There is no bundler on purpose: the app is
// plain ES modules so it can be read, audited and ported easily.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ENTRIES = ['index.html', 'src', 'data/sample-trips.csv', 'public'];
// The only third-party origins the app may use (AGENTS.md rules 1 and 3, DECISIONS.md).
const REMOTE_CODE = ['https://unpkg.com/maplibre-gl@4.7.1/dist/'];
const CSP_HOSTS = ['https://unpkg.com/maplibre-gl@4.7.1/', 'https://tiles.openfreemap.org'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const e of ENTRIES) {
  const from = join(root, e);
  if (!existsSync(from)) continue;
  const to = join(dist, e);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter: (p) => !p.endsWith('.test.js') && !p.includes('/core/__') });
}

// Verify references.
const problems = [];
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const file of walk(dist)) {
  if (!/\.(js|html|css)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  const refs = [
    ...text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g),
    ...text.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ...text.matchAll(/(?:src|href)=["']((?:\.\/|\/)?(?!https?:|data:|#|mailto:)[^"':]+\.(?:js|css|csv|svg|png|ico|webmanifest))["']/g),
  ].map((m) => m[1]);
  for (const ref of refs) {
    const target = ref.startsWith('/') ? join(dist, ref) : resolve(dirname(file), ref);
    if (!existsSync(target)) problems.push(`${relative(dist, file)} → ${ref}`);
  }
  // Remote scripts and stylesheets: only the pinned MapLibre (AGENTS.md rule 3).
  for (const m of text.matchAll(/https?:\/\/(?!localhost)[^\s'"`<>)]*?\.(?:js|css)\b/g)) {
    if (!REMOTE_CODE.some((p) => m[0].startsWith(p))) problems.push(`${relative(dist, file)} loads a remote script or stylesheet (${m[0]}); vendor it instead`);
  }
  for (const m of text.matchAll(/MAPLIBRE_BASE\s*=\s*'([^']*)'/g)) {
    if (!REMOTE_CODE.includes(m[1])) problems.push(`${relative(dist, file)}: MAPLIBRE_BASE must be one of ${REMOTE_CODE.join(', ')}`);
  }
}

// CSP: no host sources beyond the basemap allowlist (AGENTS.md rule 1).
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
if (!csp) problems.push('index.html has no Content-Security-Policy');
else {
  for (const host of csp.match(/https?:\/\/[^\s;]+/g) || []) {
    if (!CSP_HOSTS.includes(host)) problems.push(`CSP allows ${host}, which isn't in the build allowlist`);
  }
  if (/\*|'unsafe-eval'|https:(?=[\s;])/.test(csp)) problems.push('CSP has a wildcard, unsafe-eval or a bare https: source');
}
if (problems.length) {
  console.error('Build check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Built ${walk(dist).length} files into dist/`);
