// @ts-check
import { createImage, validateImage } from '../model/image.js';
import { InvalidImageError } from '../util/errors.js';

/** @typedef {import('../model/image.js').GfxImage} GfxImage */

/** @param {unknown} value @param {string} field */
function byte(value, field) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 255) {
    throw new InvalidImageError('INVALID_COLOR', `${field} must be an integer from 0 to 255.`, { field, value });
  }
  return Number(value);
}

/**
 * @param {GfxImage} image
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function cropImage(image, rect) {
  validateImage(image);
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > image.width || y + height > image.height) {
    throw new InvalidImageError('INVALID_CROP', 'Crop rectangle must be inside the image.', { rect });
  }
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4;
    out.set(image.pixels.subarray(start, start + width * 4), row * width * 4);
  }
  return createImage(width, height, out, { source: image.source });
}

/**
 * Fixed nearest/bilinear resampler; does not depend on Canvas interpolation.
 * @param {GfxImage} image
 * @param {number} width
 * @param {number} height
 * @param {'nearest'|'bilinear'} [filter]
 */
export function resizeImage(image, width, height, filter = 'nearest') {
  validateImage(image);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new InvalidImageError('INVALID_RESIZE', 'Resize dimensions must be positive integers.', { width, height });
  }
  if (filter !== 'nearest' && filter !== 'bilinear') {
    throw new InvalidImageError('INVALID_FILTER', `Unknown resize filter: ${filter}`);
  }
  const out = new Uint8Array(width * height * 4);
  if (filter === 'nearest') {
    for (let y = 0; y < height; y++) {
      const sy = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / height));
      for (let x = 0; x < width; x++) {
        const sx = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / width));
        const src = (sy * image.width + sx) * 4;
        out.set(image.pixels.subarray(src, src + 4), (y * width + x) * 4);
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const fy = ((y + 0.5) * image.height) / height - 0.5;
      const sy = Math.max(0, Math.min(image.height - 1, fy));
      const y0 = Math.floor(sy);
      const y1 = Math.min(image.height - 1, y0 + 1);
      const wy = sy - y0;
      for (let x = 0; x < width; x++) {
        const fx = ((x + 0.5) * image.width) / width - 0.5;
        const sx = Math.max(0, Math.min(image.width - 1, fx));
        const x0 = Math.floor(sx);
        const x1 = Math.min(image.width - 1, x0 + 1);
        const wx = sx - x0;
        const dst = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) {
          const a = image.pixels[(y0 * image.width + x0) * 4 + c];
          const b = image.pixels[(y0 * image.width + x1) * 4 + c];
          const d = image.pixels[(y1 * image.width + x0) * 4 + c];
          const e = image.pixels[(y1 * image.width + x1) * 4 + c];
          out[dst + c] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy);
        }
      }
    }
  }
  return createImage(width, height, out, { source: image.source });
}

/** @param {GfxImage} image @param {ArrayLike<number>} [matte] */
export function compositeAlpha(image, matte = [0, 0, 0]) {
  validateImage(image);
  const mr = byte(matte[0] ?? 0, 'matte.r');
  const mg = byte(matte[1] ?? 0, 'matte.g');
  const mb = byte(matte[2] ?? 0, 'matte.b');
  const out = Uint8Array.from(image.pixels);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    out[i] = Math.round((out[i] * a + mr * (255 - a)) / 255);
    out[i + 1] = Math.round((out[i + 1] * a + mg * (255 - a)) / 255);
    out[i + 2] = Math.round((out[i + 2] * a + mb * (255 - a)) / 255);
    out[i + 3] = 255;
  }
  return createImage(image.width, image.height, out, { source: image.source });
}

/**
 * Make pixels whose source RGB exactly matches color fully transparent.
 * Existing alpha on all other pixels is preserved.
 * @param {GfxImage} image
 * @param {ArrayLike<number>} color
 */
export function applyColorKey(image, color) {
  image = validateImage(image);
  const r = byte(color[0], 'colorKey.r');
  const g = byte(color[1], 'colorKey.g');
  const b = byte(color[2], 'colorKey.b');
  const pixels = Uint8Array.from(image.pixels);
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at] === r && pixels[at + 1] === g && pixels[at + 2] === b) pixels[at + 3] = 0;
  }
  return createImage(image.width, image.height, pixels, { source: image.source });
}

/** @param {GfxImage} image */
export function grayscaleImage(image) {
  image = validateImage(image);
  const pixels = Uint8Array.from(image.pixels);
  for (let at = 0; at < pixels.length; at += 4) {
    const value = (54 * pixels[at] + 183 * pixels[at + 1] + 19 * pixels[at + 2] + 128) >> 8;
    pixels[at] = value;
    pixels[at + 1] = value;
    pixels[at + 2] = value;
  }
  return createImage(image.width, image.height, pixels, { source: image.source });
}

/**
 * @param {GfxImage} image
 * @param {{crop?: {x: number, y: number, width: number, height: number}, resize?: {width: number, height: number, filter?: 'nearest'|'bilinear'}, alpha?: {mode?: 'preserve'|'none', matte?: ArrayLike<number>}}} [options]
 */
export function transformImage(image, options = {}) {
  let out = validateImage(image);
  if (options.crop) out = cropImage(out, options.crop);
  if (options.resize) out = resizeImage(out, options.resize.width, options.resize.height, options.resize.filter);
  if (options.alpha?.mode === 'none') out = compositeAlpha(out, options.alpha.matte);
  return out;
}
