// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImage,
  emitCSource,
  encodeImage,
  encodeTinyBitmap1,
  encodeTinyCandidates,
  encodeTinyRaw565,
  encodeTinyRle565,
  encodeTinyRlePal4,
  optimizeTinyImage,
  optimizeTinyImageSet,
  tinyDecoderSetCost,
} from '../src/index.js';

test('TinyGFX raw, RLE, palette RLE, and bitmap bytes are exact', () => {
  const image = createImage(4, 1, [
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
  ]);
  assert.deepEqual([...encodeTinyRaw565(image).data], [0xf8, 0x00, 0xf8, 0x00, 0x00, 0x1f, 0x00, 0x1f]);
  assert.deepEqual([...encodeTinyRle565(image).data], [2, 0xf8, 0x00, 2, 0x00, 0x1f]);
  const palette = encodeTinyRlePal4(image);
  assert.ok(palette);
  assert.deepEqual([...palette.data], [0x11, 0x10]);
  assert.deepEqual([.../** @type {Uint16Array} */ (palette.palette)], [0x001f, 0xf800]);
  assert.deepEqual([.../** @type {NonNullable<ReturnType<typeof encodeTinyBitmap1>>} */ (encodeTinyBitmap1(image, 'horizontal')).data], [0xc0]);
});

test('TinyGFX run splitting uses 255 and 16 pixel limits', () => {
  const image = createImage(256, 1, new Uint8Array(256 * 4).fill(255));
  assert.deepEqual([...encodeTinyRle565(image).data], [255, 0xffff >> 8, 0xff, 1, 0xff, 0xff]);
  const palette = encodeTinyRlePal4(image);
  assert.ok(palette);
  assert.equal(palette.data.length, 16);
  assert.ok([...palette.data].every((byte) => byte === 0xf0));
});

test('fixed decoder cost and shared bitmap discount are exact', () => {
  assert.equal(tinyDecoderSetCost(['raw565']), 400);
  assert.equal(tinyDecoderSetCost(['raw565', 'rle565']), 800);
  assert.equal(tinyDecoderSetCost(['bitmap1h', 'bitmap1v']), 520);
  assert.equal(tinyDecoderSetCost(['bitmap1h', 'bitmap1v'], 333), 433);
});

test('optimizer evaluates the image set globally', () => {
  const flat = createImage(1000, 1, Uint8Array.from({ length: 4000 }, (_, i) => i % 4 === 3 ? 255 : i % 4 === 0 ? 255 : 0));
  const gradientBytes = [];
  for (let i = 0; i < 20; i++) gradientBytes.push(i * 12, 255 - i * 12, i * 7, 255);
  const gradient = createImage(20, 1, gradientBytes);
  const optimized = optimizeTinyImageSet([{ key: 'flat', image: flat }, { key: 'gradient', image: gradient }]);
  assert.deepEqual(optimized.formats, ['rle565']);
  assert.equal(optimized.images.find((image) => image.key === 'flat')?.format, 'rle565');
  assert.equal(optimized.images.find((image) => image.key === 'gradient')?.format, 'rle565');
  assert.equal(optimized.decoderBytes, 400);
  assert.equal(optimized.report.length, 2);
  assert.ok(optimized.report.every((image) => image.candidates.length >= 2));
  assert.ok(optimized.report.every((image) => image.selected.format === 'rle565'));
});

test('bitmap tie break follows preferBitmap', () => {
  const mono = createImage(8, 8, Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 2) * 255));
  assert.equal(optimizeTinyImage(mono, { allowedFormats: ['bitmap1h', 'bitmap1v'], preferBitmap: 'horizontal' }).format, 'bitmap1h');
  assert.equal(optimizeTinyImage(mono, { allowedFormats: ['bitmap1h', 'bitmap1v'], preferBitmap: 'vertical' }).format, 'bitmap1v');
});

test('TinyGFX emitter builds CellImage and ops reference', () => {
  const image = createImage(4, 1, [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  const encoded = /** @type {NonNullable<ReturnType<typeof encodeTinyRlePal4>>} */ (encodeTinyRlePal4(image));
  const emitted = emitCSource(encoded, 'tinygfx', { name: 'icon' });
  assert.match(emitted.source, /const uint16_t iconPalette\[2\]/);
  assert.match(emitted.source, /const CellImage icon/);
  assert.match(emitted.source, /tinygfxImageRlepal4Ops/);
  assert.equal(emitted.usage, 'lcd.drawImage(&iconRef, x, y);');
});

test('TinyGFX transparency reserves a non-colliding RGB565 key', () => {
  const image = createImage(2, 1, [
    0, 0, 0, 255,
    255, 0, 0, 0,
  ]);
  const candidates = encodeTinyCandidates(image, { alphaThreshold: 128 });
  const raw = candidates.find((candidate) => candidate.format === 'tinygfx-raw565');
  const pal = candidates.find((candidate) => candidate.format === 'tinygfx-rlepal4');
  const bitmap = candidates.find((candidate) => candidate.format === 'bitmap1-msb');
  assert.deepEqual(raw?.transparent, { kind: 'color', value: 1 });
  assert.deepEqual(pal?.transparent, { kind: 'palette-index', value: 1 });
  assert.deepEqual([.../** @type {Uint16Array} */ (pal?.palette)], [0, 1]);
  assert.deepEqual([.../** @type {Uint8Array} */ (bitmap?.data)], [0x80]);

  const emitted = emitCSource(/** @type {NonNullable<typeof raw>} */ (raw), 'tinygfx', { name: 'transparentIcon' });
  assert.match(emitted.source, /  0x0001,\n  0,\n  1,/);
});

test('TinyGFX bitmap forces transparent pixels to zero', () => {
  const image = createImage(2, 1, [
    255, 255, 255, 255,
    255, 255, 255, 0,
  ]);
  const bitmap = encodeTinyCandidates(image, { alphaThreshold: 128 })
    .find((candidate) => candidate.format === 'bitmap1-msb');
  assert.deepEqual([.../** @type {Uint8Array} */ (bitmap?.data)], [0x80]);
  assert.equal(bitmap?.transparent, undefined);
});

test('TinyGFX accepts an explicit non-colliding transparent color', () => {
  const image = createImage(2, 1, [0, 0, 0, 255, 255, 255, 255, 0]);
  const raw = encodeTinyCandidates(image, { alphaThreshold: 128, transparentColor: 0x1234 })
    .find((candidate) => candidate.format === 'tinygfx-raw565');
  assert.deepEqual(raw?.transparent, { kind: 'color', value: 0x1234 });
  assert.throws(() => encodeTinyCandidates(image, { alphaThreshold: 128, transparentColor: 0x0000 }), /used by a visible pixel/);
});

test('forced TinyGFX monochrome shares generic dither and invert bytes', () => {
  const pixels = [];
  for (let value = 0; value < 8; value++) pixels.push(value * 32, value * 32, value * 32, 255);
  const image = createImage(8, 1, pixels);
  const tiny = encodeTinyBitmap1(image, 'horizontal', { force: true, threshold: 112, invert: true, dither: 'bayer4' });
  const generic = encodeImage(image, 'bitmap1-msb', { threshold: 112, invert: true, dither: 'bayer4' });
  assert.deepEqual([.../** @type {NonNullable<typeof tiny>} */ (tiny).data], [...generic.data]);
});
