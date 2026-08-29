// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createImage,
  canEncode,
  cropImage,
  emitCSource,
  encodeImage,
  inspectImage,
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
  assert.equal(result.candidates.length, 9);
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
