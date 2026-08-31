// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImage,
  compareImages,
  decodeEncodedImage,
  canEncode,
  cropImage,
  emitCSource,
  emitCBundle,
  encodeImage,
  inspectImage,
  listTargets,
  quantizeImage,
  resizeImage,
  sanitizeIdentifier,
} from '../src/index.js';

/** @typedef {[number, number, number, number]} Rgba */
/** @param {...Rgba} pixels */
const rgba = (...pixels) => createImage(pixels.length, 1, pixels.flat());

test('RGB encoders have exact channel and byte order', () => {
  const image = rgba([255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]);
  assert.deepEqual([...encodeImage(image, 'rgb565be').data], [0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f]);
  assert.deepEqual([...encodeImage(image, 'rgb565le').data], [0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00]);
  assert.deepEqual([...encodeImage(image, 'rgb332').data], [0xe0, 0x1c, 0x03]);
  assert.deepEqual([...encodeImage(image, 'rgb888').data], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
});

test('horizontal bit order and unused bits are exact', () => {
  const image = rgba(
    [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255],
    [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
    [255, 255, 255, 255],
  );
  assert.deepEqual([...encodeImage(image, 'bitmap1-msb').data], [0xa1, 0x80]);
  assert.deepEqual([...encodeImage(image, 'bitmap1-lsb').data], [0x85, 0x01]);
});

test('vertical 1bpp packs top pixel into LSB', () => {
  const pixels = [];
  for (let y = 0; y < 8; y++) pixels.push(y === 0 || y === 7 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const image = createImage(1, 8, pixels.flat());
  assert.deepEqual([...encodeImage(image, 'bitmap1-vertical').data], [0x81]);
  assert.equal(encodeImage(image, 'bitmap1-msb').data.length, 8);
});

test('mask uses alpha threshold independently from luminance', () => {
  const image = rgba([0, 0, 0, 127], [0, 0, 0, 128]);
  assert.deepEqual([...encodeImage(image, 'mask1-msb').data], [0x40]);
});

test('canEncode reports stable issues instead of throwing', () => {
  const image = rgba([0, 0, 0, 255]);
  assert.deepEqual(canEncode(image, 'rgb565be'), { ok: true, issues: [] });
  const result = canEncode(image, 'not-a-format');
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'UNSUPPORTED_FORMAT');
});

test('ordered and error-diffusion dithering produce stable bytes', () => {
  const gray = rgba(
    [96, 96, 96, 255], [96, 96, 96, 255], [96, 96, 96, 255], [96, 96, 96, 255],
    [96, 96, 96, 255], [96, 96, 96, 255], [96, 96, 96, 255], [96, 96, 96, 255],
  );
  assert.deepEqual([...encodeImage(gray, 'bitmap1-msb', { dither: 'bayer2' }).data], [0xaa]);
  assert.deepEqual([...encodeImage(gray, 'bitmap1-msb', { dither: 'floyd-steinberg' }).data], [0x49]);
});

test('weighted median-cut is deterministic and indexed8 carries RGB888 palette', () => {
  const image = rgba(
    [255, 0, 0, 255], [250, 0, 0, 255], [0, 0, 255, 255], [0, 0, 250, 255],
  );
  const first = quantizeImage(image, 2);
  const second = quantizeImage(image, 2);
  assert.deepEqual(first, second);
  assert.equal(first.colorCount, 2);
  assert.deepEqual([...first.palette], [0, 0, 253, 253, 0, 0]);
  assert.deepEqual([...first.indices], [1, 1, 0, 0]);
  const encoded = encodeImage(image, 'indexed8', { colors: 2 });
  assert.deepEqual(encoded.palette, first.palette);
  assert.equal(encoded.stats.paletteBytes, 6);
});

test('crop and deterministic nearest resize preserve pixels', () => {
  const image = createImage(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
  assert.deepEqual([...cropImage(image, { x: 1, y: 0, width: 1, height: 1 }).pixels], [0, 0, 255, 255]);
  assert.deepEqual([...resizeImage(image, 4, 1, 'nearest').pixels], [
    255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
  ]);
});

test('inspection reports alpha and all Phase 1 candidates', () => {
  const result = inspectImage(rgba([1, 2, 3, 0], [1, 2, 3, 128]));
  assert.equal(result.colors, 2);
  assert.equal(result.transparentPixels, 1);
  assert.equal(result.translucentPixels, 1);
  assert.equal(result.candidates.length, 10);
});

test('generic C output is deterministic and sanitizes identifiers', () => {
  const encoded = encodeImage(rgba([255, 0, 0, 255]), 'rgb565be');
  const { source } = emitCSource(encoded, 'generic-c', { name: '9 bad-name' });
  assert.equal(sanitizeIdentifier('9 bad-name'), '_9_bad_name');
  assert.equal(sanitizeIdentifier('class'), 'class_image');
  assert.match(source, /alignas\(4\) static const uint8_t _9_bad_name_data\[2\] PROGMEM/);
  assert.match(source, /0xF8, 0x00/);
  assert.ok(source.endsWith('\n'));
});

test('target presets constrain formats and preserve encoded RGB565 bytes', () => {
  assert.deepEqual(listTargets(), ['generic-c', 'adafruit-gfx', 'u8g2', 'lovyangfx', 'arduino-gfx', 'tft-espi', 'tinygfx']);
  const encoded = encodeImage(rgba([255, 0, 0, 255]), 'rgb565le');
  const adafruit = emitCSource(encoded, 'adafruit-gfx', { name: 'red' });
  assert.match(adafruit.source, /0x00, 0xF8/);
  assert.match(adafruit.source, /drawRGBBitmap\(x, y, reinterpret_cast<const uint16_t\*>\(red_data\)/);
  assert.throws(() => emitCSource(encoded, 'u8g2'), (error) => {
    assert.equal(/** @type {{code?: string}} */ (error).code, 'TARGET_FORMAT_MISMATCH');
    return true;
  });
});

test('indexed target palette is emitted as RGB565 words', () => {
  const encoded = encodeImage(rgba([255, 0, 0, 255], [0, 0, 255, 255]), 'indexed8', { colors: 2 });
  const arduino = emitCSource(encoded, 'arduino-gfx', { name: 'two' });
  assert.match(arduino.source, /const uint16_t two_palette\[2\]/);
  assert.match(arduino.source, /0x001F, 0xF800/);
  assert.match(arduino.usage, /drawIndexedBitmap/);
});

test('C bundle emits one preamble and rejects sanitized symbol collisions', () => {
  const image = createImage(1, 1, [255, 0, 0, 255]);
  const encoded = encodeImage(image, 'rgb565be');
  const bundled = emitCBundle([
    { encoded, name: 'icon-a', comment: 'a.png' },
    { encoded, name: 'icon_b', comment: 'b.png' },
  ]).source;
  assert.equal((bundled.match(/#pragma once/g) ?? []).length, 1);
  assert.match(bundled, /\/\/ ---- a\.png ----/);
  assert.match(bundled, /icon_a_data/);
  assert.match(bundled, /icon_b_data/);
  assert.throws(() => emitCBundle([
    { encoded, name: 'icon-a', comment: 'a.png' },
    { encoded, name: 'icon_a', comment: 'b.png' },
  ]), /C symbol collision/);
});

test('encoded preview reproduces RGB565 pixels and comparison is side by side', () => {
  const source = rgba([255, 0, 0, 255], [0, 255, 0, 255]);
  const converted = decodeEncodedImage(encodeImage(source, 'rgb565be'));
  assert.deepEqual([...converted.pixels], [255, 0, 0, 255, 0, 255, 0, 255]);
  const comparison = compareImages(source, converted);
  assert.equal(comparison.width, 4);
  assert.equal(comparison.height, 1);
  assert.deepEqual([...comparison.pixels.slice(0, 8)], [...source.pixels]);
  assert.deepEqual([...comparison.pixels.slice(8)], [...converted.pixels]);
});
