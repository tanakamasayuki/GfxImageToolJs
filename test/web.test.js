// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStoredZip, crc32, decodeBrowserImage } from '../src/browser/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('browser decoder rejects non-Blob input before using browser globals', async () => {
  await assert.rejects(decodeBrowserImage(/** @type {any} */ (new Uint8Array())), /expects a Blob/);
});

test('web workspace exposes project inputs and core-only module entry', async () => {
  const html = await readFile(join(root, 'web', 'index.html'), 'utf8');
  const app = await readFile(join(root, 'web', 'app.js'), 'utf8');
  const bridge = await readFile(join(root, 'web', 'gfx-image-tool.js'), 'utf8');
  assert.match(html, /id="files"[^>]+multiple/);
  assert.match(html, /id="download-header"/);
  assert.match(html, /id="download-converted"/);
  assert.match(html, /id="download-comparison"/);
  assert.match(html, /id="config-file"/);
  assert.match(html, /id="download-zip"/);
  assert.match(html, /id="effective-settings"/);
  assert.match(html, /id="preview-background"/);
  assert.match(html, /id="remove-dialog"/);
  assert.match(app, /target: 'generic-c', mode: 'auto', format: 'rgb565be'/);
  assert.match(app, /existing\.image = image/);
  assert.match(app, /file\.name\.endsWith\('\.imagesconfig'\)/);
  assert.match(bridge, /src\/index\.js/);
  assert.match(bridge, /src\/browser\/index\.js/);
});

test('browser ZIP writer is deterministic and emits valid stored-file records', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const entries = [{ name: 'generated/images.h', data: 'header\n' }, { name: '.imagesconfig', data: new Uint8Array([1, 2, 3]) }];
  const first = createStoredZip(entries);
  const second = createStoredZip(entries);
  assert.deepEqual(first, second);
  const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(first.length - 22, true), 0x06054b50);
  assert.match(new TextDecoder().decode(first), /generated\/images\.h/);
  assert.throws(() => createStoredZip([{ name: '../outside', data: '' }]), /Unsafe ZIP entry/);
});
