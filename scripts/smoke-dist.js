// @ts-check
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(join(root, 'dist', 'gfx-image-tool.js')).href);
const image = mod.createImage(1, 1, [255, 0, 0, 255]);
const encoded = mod.encodeImage(image, 'rgb565be');
if (encoded.data[0] !== 0xf8 || encoded.data[1] !== 0x00) throw new Error('RGB565 smoke failed.');
console.log(`dist smoke ok (v${mod.VERSION})`);
