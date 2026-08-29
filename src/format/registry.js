// @ts-check
import { validateImage } from '../model/image.js';
import { UnsupportedFormatError } from '../util/errors.js';

/** @typedef {import('../model/image.js').GfxImage} GfxImage */
/**
 * @typedef {object} EncodedImage
 * @property {number} width
 * @property {number} height
 * @property {string} format
 * @property {Uint8Array} data
 * @property {number} stride
 * @property {{dataBytes: number, paletteBytes: number, maskBytes: number}} stats
 * @property {Record<string, unknown>} options
 */

const FORMATS = Object.freeze([
  'bitmap1-msb',
  'bitmap1-lsb',
  'bitmap1-vertical',
  'gray8',
  'rgb332',
  'rgb565le',
  'rgb565be',
  'rgb888',
  'mask1-msb',
]);

export function listFormats() {
  return [...FORMATS];
}

/** @param {GfxImage} image @param {string} format */
export function canEncode(image, format) {
  /** @type {{code: string, message: string}[]} */
  const issues = [];
  try { validateImage(image); }
  catch (error) { issues.push({ code: 'INVALID_IMAGE', message: error instanceof Error ? error.message : String(error) }); }
  if (!FORMATS.includes(format)) issues.push({ code: 'UNSUPPORTED_FORMAT', message: `Unsupported output format: ${format}` });
  return { ok: issues.length === 0, issues };
}

/** @param {number} r @param {number} g @param {number} b */
export const luminance = (r, g, b) => (54 * r + 183 * g + 19 * b + 128) >> 8;

/** @param {number} r @param {number} g @param {number} b */
export const rgb565 = (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

const BAYER = Object.freeze({
  bayer2: [[0, 2], [3, 1]],
  bayer4: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
  bayer8: [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
  ],
});

/**
 * @param {GfxImage} image
 * @param {number} threshold
 * @param {boolean} invert
 * @param {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} dither
 */
function monochrome(image, threshold, invert, dither) {
  const count = image.width * image.height;
  const values = new Float64Array(count);
  for (let p = 0; p < count; p++) {
    const at = p * 4;
    values[p] = luminance(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]);
  }
  const result = new Uint8Array(count);
  if (dither === 'floyd-steinberg') {
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const p = y * image.width + x;
        const on = values[p] >= threshold;
        result[p] = on !== invert ? 1 : 0;
        const quantized = on ? 255 : 0;
        const error = values[p] - quantized;
        if (x + 1 < image.width) values[p + 1] += error * 7 / 16;
        if (y + 1 < image.height) {
          if (x > 0) values[p + image.width - 1] += error * 3 / 16;
          values[p + image.width] += error * 5 / 16;
          if (x + 1 < image.width) values[p + image.width + 1] += error / 16;
        }
      }
    }
    return result;
  }
  const matrix = dither === 'none' ? undefined : BAYER[dither];
  if (dither !== 'none' && !matrix) throw new RangeError(`Unknown dither: ${dither}`);
  const size = matrix?.length ?? 1;
  const levels = size * size;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const adjustment = matrix ? ((matrix[y % size][x % size] + 0.5) / levels - 0.5) * 255 : 0;
      const on = values[y * image.width + x] >= Math.max(0, Math.min(255, threshold + adjustment));
      result[y * image.width + x] = on !== invert ? 1 : 0;
    }
  }
  return result;
}

/**
 * @param {GfxImage} image
 * @param {string} format
 * @param {{threshold?: number, alphaThreshold?: number, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'}} [options]
 * @returns {EncodedImage}
 */
export function encodeImage(image, format, options = {}) {
  image = validateImage(image);
  if (!FORMATS.includes(format)) {
    throw new UnsupportedFormatError('UNSUPPORTED_FORMAT', `Unsupported output format: ${format}`, { format });
  }
  const threshold = options.threshold ?? 128;
  const alphaThreshold = options.alphaThreshold ?? 128;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new RangeError('threshold must be 0..255.');
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) throw new RangeError('alphaThreshold must be 0..255.');
  const dither = options.dither ?? 'none';
  const mono = format.startsWith('bitmap1-') ? monochrome(image, threshold, !!options.invert, dither) : undefined;

  let data;
  let stride;
  if (format === 'bitmap1-msb' || format === 'bitmap1-lsb' || format === 'mask1-msb') {
    stride = Math.ceil(image.width / 8);
    data = new Uint8Array(stride * image.height);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const at = (y * image.width + x) * 4;
        const on = format === 'mask1-msb'
          ? image.pixels[at + 3] >= alphaThreshold
          : mono?.[y * image.width + x] === 1;
        if (on) data[y * stride + (x >> 3)] |= format === 'bitmap1-lsb' ? 1 << (x & 7) : 1 << (7 - (x & 7));
      }
    }
  } else if (format === 'bitmap1-vertical') {
    stride = image.width;
    data = new Uint8Array(image.width * Math.ceil(image.height / 8));
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const on = mono?.[y * image.width + x] === 1;
        if (on) data[(y >> 3) * image.width + x] |= 1 << (y & 7);
      }
    }
  } else if (format === 'gray8') {
    stride = image.width;
    data = new Uint8Array(image.width * image.height);
    for (let p = 0; p < data.length; p++) {
      const at = p * 4;
      data[p] = luminance(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]);
    }
  } else if (format === 'rgb332') {
    stride = image.width;
    data = new Uint8Array(image.width * image.height);
    for (let p = 0; p < data.length; p++) {
      const at = p * 4;
      data[p] = (image.pixels[at] & 0xe0) | ((image.pixels[at + 1] & 0xe0) >> 3) | (image.pixels[at + 2] >> 6);
    }
  } else if (format === 'rgb565le' || format === 'rgb565be') {
    stride = image.width * 2;
    data = new Uint8Array(image.width * image.height * 2);
    for (let p = 0; p < image.width * image.height; p++) {
      const at = p * 4;
      const color = rgb565(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]);
      if (format === 'rgb565le') {
        data[p * 2] = color;
        data[p * 2 + 1] = color >> 8;
      } else {
        data[p * 2] = color >> 8;
        data[p * 2 + 1] = color;
      }
    }
  } else {
    stride = image.width * 3;
    data = new Uint8Array(image.width * image.height * 3);
    for (let p = 0; p < image.width * image.height; p++) {
      const src = p * 4;
      data.set(image.pixels.subarray(src, src + 3), p * 3);
    }
  }
  return {
    width: image.width,
    height: image.height,
    format,
    data,
    stride,
    stats: {
      dataBytes: format === 'mask1-msb' ? 0 : data.length,
      paletteBytes: 0,
      maskBytes: format === 'mask1-msb' ? data.length : 0,
    },
    options: { threshold, alphaThreshold, invert: !!options.invert, dither },
  };
}
