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

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const e of ENTRIES) {
  const from = join(root, e);
  if (!existsSync(from)) continue;
  const to = e === 'public' ? dist : join(dist, e);
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
  if (/https?:\/\/(?!localhost)[^\s'"]*\.(js|css)\b/.test(text) && file.endsWith('.html')) {
    problems.push(`${relative(dist, file)} loads a remote script or stylesheet; vendor it instead`);
  }
}
if (problems.length) {
  console.error('Build check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Built ${walk(dist).length} files into dist/`);
