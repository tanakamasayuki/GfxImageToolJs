#!/usr/bin/env node
// @ts-check
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  createImage,
  emitCSource,
  encodeTinyBitmap1,
  encodeTinyRaw565,
  encodeTinyRle565,
  encodeTinyRlePal4,
} from '../src/index.js';

const [fixturesArgument, outputArgument] = process.argv.slice(2);
if (!fixturesArgument || !outputArgument) {
  console.error('usage: node scripts/prepare-tinygfx-oracle.js <TinyGFX pairs dir> <output dir>');
  process.exit(3);
}

const fixtures = resolve(fixturesArgument);
const output = resolve(outputArgument);
const cases = [
  ['icon_raw565', 'raw565'],
  ['icon_rle565', 'rle565'],
  ['icon_rlepal4', 'rlepal4'],
  ['mono_h', 'bitmap1h'],
  ['mono_v', 'bitmap1v'],
];

/** @param {Uint8Array} bytes @param {string} name */
function decodeP6(bytes, name) {
  let at = 0;
  /** @returns {string} */
  function token() {
    while (at < bytes.length) {
      if (bytes[at] === 35) while (at < bytes.length && bytes[at] !== 10) at++;
      else if (bytes[at] <= 32) at++;
      else break;
    }
    const start = at;
    while (at < bytes.length && bytes[at] > 32 && bytes[at] !== 35) at++;
    return new TextDecoder().decode(bytes.subarray(start, at));
  }
  if (token() !== 'P6') throw new Error(`${name}: expected a binary P6 PPM.`);
  const width = Number(token());
  const height = Number(token());
  const maximum = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || maximum !== 255) {
    throw new Error(`${name}: unsupported PPM header.`);
  }
  if (bytes[at] === 13 && bytes[at + 1] === 10) at += 2;
  else if (bytes[at] <= 32) at++;
  else throw new Error(`${name}: missing whitespace before pixel data.`);
  const rgb = bytes.subarray(at);
  if (rgb.length !== width * height * 3) throw new Error(`${name}: expected ${width * height * 3} RGB bytes, got ${rgb.length}.`);
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = rgb[p * 3];
    rgba[p * 4 + 1] = rgb[p * 3 + 1];
    rgba[p * 4 + 2] = rgb[p * 3 + 2];
    rgba[p * 4 + 3] = 255;
  }
  return createImage(width, height, rgba, { source: { name } });
}

await mkdir(output, { recursive: true });
for (const [name, format] of cases) {
  const ppm = join(fixtures, `${name}.ppm`);
  const image = decodeP6(await readFile(ppm), basename(ppm));
  const encoded = format === 'raw565' ? encodeTinyRaw565(image)
    : format === 'rle565' ? encodeTinyRle565(image)
      : format === 'rlepal4' ? encodeTinyRlePal4(image)
        : encodeTinyBitmap1(image, format === 'bitmap1v' ? 'vertical' : 'horizontal');
  if (!encoded) throw new Error(`${name}: ${format} cannot encode the fixture.`);
  const { source } = emitCSource(encoded, 'tinygfx', { name });
  await writeFile(join(output, `${name}.h`), source, 'utf8');
  if (fixtures !== output) await copyFile(ppm, join(output, `${name}.ppm`));
  console.log(`${name}: ${format}, ${encoded.data.length + encoded.stats.paletteBytes} B`);
}
