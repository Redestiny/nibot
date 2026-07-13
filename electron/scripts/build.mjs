// Bundles the Electron main process and stages the web assets under build/.
// Everything the packaged app needs ends up in build/ (main.js + web/), so
// electron-builder ships no node_modules at all.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const electronDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const buildDir = `${electronDir}build`;
const webDist = `${repoRoot}dist/web`;

if (!existsSync(`${webDist}/index.html`)) {
  console.error('dist/web is missing. Run "npm run build" at the repo root first.');
  process.exit(1);
}

rmSync(buildDir, { recursive: true, force: true });

await build({
  entryPoints: [`${electronDir}src/main.ts`],
  outfile: `${buildDir}/main.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  // Bundled CJS dependencies (openai/anthropic SDKs) call require() at
  // runtime; esbuild's ESM shim delegates to a global `require` if present.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

cpSync(webDist, `${buildDir}/web`, { recursive: true });
console.log('Staged web assets into electron/build/web.');
