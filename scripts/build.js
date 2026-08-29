// @ts-check
import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const minify of [false, true]) {
  await build({
    entryPoints: [join(root, 'src', 'index.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify,
    outfile: join(dist, `gfx-image-tool${minify ? '.min' : ''}.js`),
    logLevel: 'warning',
  });
}

console.log('dist/ ready');
