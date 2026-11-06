// Post-build sanity checks for the published bundles (run in CI after `npm run build`).
//
//   - every bundle exists
//   - no root-absolute asset URLs ("/assets/…"), which resolve against the
//     consumer's site root and break npm/CDN installs
//   - the tile worker is inlined (blob: URL) in both library bundles
//   - the ES bundle imports in Node without a DOM (SSR safety)

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => resolve(root, 'dist', f);
const failures = [];

const bundles = ['treelet.es.js', 'treelet.cdn.standalone.js', 'treelet.worker.js', 'types/index.d.ts'];
for (const f of bundles) {
  if (!existsSync(dist(f))) failures.push(`missing dist/${f}`);
}

for (const f of ['treelet.es.js', 'treelet.cdn.standalone.js']) {
  if (!existsSync(dist(f))) continue;
  const code = readFileSync(dist(f), 'utf8');
  if (/["'`]\/assets\//.test(code)) failures.push(`dist/${f} references a root-absolute /assets/ URL`);
  if (!code.includes('createObjectURL')) failures.push(`dist/${f} does not inline the tile worker`);
}

if (existsSync(dist('treelet.es.js'))) {
  try {
    const mod = await import(pathToFileURL(dist('treelet.es.js')).href);
    if (typeof mod.Treelet !== 'function') failures.push('ES bundle does not export Treelet');
  } catch (err) {
    failures.push(`ES bundle failed to import without a DOM: ${err.message}`);
  }
}

if (failures.length) {
  console.error('dist check failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('dist check passed');
