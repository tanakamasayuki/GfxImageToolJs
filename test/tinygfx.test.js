// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImage,
  decodeEncodedImage,
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
  assert.deepEqual([.../** @type {NonNullable<ReturnType<typeof encodeTinyBitmap1>>} */ (encodeTinyBitmap1(image, 'horizontal', { force: true })).data], [0xc0]);
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
  assert.equal(optimizeTinyImage(mono, { monochrome: true, allowedFormats: ['bitmap1h', 'bitmap1v'], preferBitmap: 'horizontal' }).format, 'bitmap1h');
  assert.equal(optimizeTinyImage(mono, { monochrome: true, allowedFormats: ['bitmap1h', 'bitmap1v'], preferBitmap: 'vertical' }).format, 'bitmap1v');
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

test('TinyGFX raw565 supports a 240x240 image while oversized RLE is rejected by format selection', () => {
  const pixels = new Uint8Array(240 * 240 * 4);
  for (let pixel = 0; pixel < 240 * 240; pixel++) {
    const at = pixel * 4;
    pixels[at] = pixel % 2 ? 255 : 0;
    pixels[at + 2] = pixel % 2 ? 0 : 255;
    pixels[at + 3] = 255;
  }
  const image = createImage(240, 240, pixels);
  const raw = encodeTinyRaw565(image);
  assert.equal(raw.data.length, 115200);
  const emitted = emitCSource(raw, 'tinygfx', { name: 'splash240' });
  assert.match(emitted.source, /240, 240,\n  0,/);

  const automatic = optimizeTinyImageSet([
    { key: 'splash240.png', image, allowedFormats: ['raw565', 'rle565'] },
  ], { allowedFormats: ['raw565', 'rle565'] });
  assert.equal(automatic.images[0].format, 'raw565');
  assert.throws(
    () => optimizeTinyImageSet([{ key: 'splash240.png', image, allowedFormats: ['rle565'] }]),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, 'TINYGFX_RLE_DATA_LENGTH_LIMIT');
      assert.match(/** @type {Error} */ (error).message, /splash240\.png/);
      assert.match(/** @type {Error} */ (error).message, /65535 bytes/);
      return true;
    },
  );
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
  const preview = decodeEncodedImage(/** @type {NonNullable<typeof bitmap>} */ (bitmap), { target: 'tinygfx' });
  assert.deepEqual([...preview.pixels], [255, 255, 255, 255, 0, 0, 0, 0]);
});

test('TinyGFX auto never collapses two visible colors plus transparency into bitmap1', () => {
  const pixels = [];
  for (let i = 0; i < 16; i++) pixels.push(
    ...(i % 3 === 0 ? [255, 0, 0, 255] : i % 3 === 1 ? [0, 0, 255, 255] : [0, 0, 0, 0]),
  );
  const colorAlpha = createImage(16, 1, pixels);
  const candidates = encodeTinyCandidates(colorAlpha, { alphaThreshold: 128 });
  assert.ok(candidates.some((candidate) => candidate.format === 'tinygfx-rlepal4'));
  assert.ok(!candidates.some((candidate) => candidate.format === 'bitmap1-msb' || candidate.format === 'bitmap1-vertical'));

  const mono = createImage(16, 1, Array.from({ length: 16 }, (_, i) => i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]).flat());
  const optimized = optimizeTinyImageSet([
    { key: 'color-alpha', image: colorAlpha, alphaThreshold: 128 },
    { key: 'mono', image: mono, monochrome: true },
  ]);
  assert.doesNotMatch(optimized.images.find((item) => item.key === 'color-alpha')?.format ?? '', /^bitmap1/);
});

test('TinyGFX auto never collapses two opaque colors into background plus foreground', () => {
  const color = createImage(8, 1, [
    255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255,
    255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255,
  ]);
  const candidates = encodeTinyCandidates(color);
  assert.ok(candidates.some((candidate) => candidate.format === 'tinygfx-rlepal4'));
  assert.ok(!candidates.some((candidate) => candidate.format === 'bitmap1-msb' || candidate.format === 'bitmap1-vertical'));
  const bitmap = createImage(8, 1, Array.from({ length: 8 }, (_, i) => i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]).flat());
  const optimized = optimizeTinyImageSet([{ key: 'color', image: color }, { key: 'bitmap', image: bitmap, monochrome: true }]);
  assert.doesNotMatch(optimized.images.find((item) => item.key === 'color')?.format ?? '', /^bitmap1/);
});

test('TinyGFX forced incompatible format identifies the image', () => {
  const pixels = [];
  for (let i = 0; i < 17; i++) pixels.push(i * 15, 255 - i * 15, i * 7, 255);
  const color = createImage(17, 1, pixels);
  assert.throws(() => optimizeTinyImageSet([{ key: 'icons/color.png', image: color, allowedFormats: ['rlepal4'] }]), /icons\/color\.png/);
});

test('TinyGFX palette limit error explains color count, transparency budget, and recovery', () => {
  const pixels = [];
  for (let color = 0; color < 16; color++) pixels.push(color * 8, 0, 0, 255);
  pixels.push(0, 0, 0, 0);
  const image = createImage(17, 1, pixels);
  assert.throws(
    () => optimizeTinyImageSet([{
      key: '13', label: 'icons/13.png', image, alphaThreshold: 128, allowedFormats: ['rlepal4'],
    }]),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, 'TINYGFX_PALETTE_COLOR_LIMIT');
      assert.deepEqual(/** @type {{details?: object}} */ (error).details, {
        image: 'icons/13.png', format: 'rlepal4', colorCount: 17, visibleColorCount: 16,
        transparencyColors: 1, maxColors: 16, suggestedVisibleColors: 15,
      });
      assert.match(/** @type {Error} */ (error).message, /16 visible \+ 1 transparency key/);
      assert.match(/** @type {Error} */ (error).message, /color mode to indexed with at most 15 visible colors/);
      return true;
    },
  );

  assert.throws(
    () => optimizeTinyImage(image, { alphaThreshold: 128, allowedFormats: ['rlepal4'] }),
    (error) => /** @type {{code?: string}} */ (error).code === 'TINYGFX_PALETTE_COLOR_LIMIT',
  );
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
