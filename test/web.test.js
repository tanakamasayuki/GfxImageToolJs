// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBrowserImage } from '../src/browser/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('browser decoder rejects non-Blob input before using browser globals', async () => {
  await assert.rejects(decodeBrowserImage(/** @type {any} */ (new Uint8Array())), /expects a Blob/);
});

test('web workspace exposes project inputs and core-only module entry', async () => {
  const html = await readFile(join(root, 'web', 'index.html'), 'utf8');
  const bridge = await readFile(join(root, 'web', 'gfx-image-tool.js'), 'utf8');
  assert.match(html, /id="files"[^>]+multiple/);
  assert.match(html, /id="download-header"/);
  assert.match(html, /id="download-converted"/);
  assert.match(html, /id="download-comparison"/);
  assert.match(html, /id="config-file"/);
  assert.match(bridge, /src\/index\.js/);
  assert.match(bridge, /src\/browser\/index\.js/);
});
