// @ts-check
import { InvalidImageError } from '../util/errors.js';

/**
 * @typedef {object} GfxImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} pixels Row-major, straight-alpha RGBA8888.
 * @property {'srgb'} colorSpace
 * @property {'straight'} alphaMode
 * @property {{name?: string, mime?: string, decoder?: string}} [source]
 */

/** @param {number} value @param {string} field */
function dimension(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidImageError('INVALID_DIMENSION', `${field} must be a positive safe integer.`, {
      field,
      value,
    });
  }
  return value;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {ArrayLike<number>} [pixels]
 * @param {{source?: GfxImage['source']}} [options]
 * @returns {GfxImage}
 */
export function createImage(width, height, pixels, options = {}) {
  width = dimension(width, 'width');
  height = dimension(height, 'height');
  const length = width * height * 4;
  if (!Number.isSafeInteger(length)) {
    throw new InvalidImageError('IMAGE_TOO_LARGE', 'RGBA byte length is not a safe integer.', {
      width,
      height,
    });
  }
  const data = pixels === undefined ? new Uint8Array(length) : Uint8Array.from(pixels);
  if (data.length !== length) {
    throw new InvalidImageError('PIXEL_LENGTH_MISMATCH', `Expected ${length} RGBA bytes, got ${data.length}.`, {
      expected: length,
      actual: data.length,
    });
  }
  return {
    width,
    height,
    pixels: data,
    colorSpace: 'srgb',
    alphaMode: 'straight',
    ...(options.source ? { source: { ...options.source } } : {}),
  };
}

/** @param {GfxImage} image @returns {GfxImage} */
export function validateImage(image) {
  if (!image || !(image.pixels instanceof Uint8Array)) {
    throw new InvalidImageError('INVALID_IMAGE', 'Image pixels must be a Uint8Array.');
  }
  return createImage(image.width, image.height, image.pixels, { source: image.source });
}

/** @param {GfxImage} image @returns {GfxImage} */
export function cloneImage(image) {
  return createImage(image.width, image.height, image.pixels, { source: image.source });
}

/** @param {GfxImage} image @param {number} x @param {number} y */
export function pixelOffset(image, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw new RangeError(`Pixel (${x}, ${y}) is outside ${image.width}x${image.height}.`);
  }
  return (y * image.width + x) * 4;
}

/** @param {GfxImage} image @param {number} x @param {number} y @returns {[number, number, number, number]} */
export function getPixel(image, x, y) {
  const at = pixelOffset(image, x, y);
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2], image.pixels[at + 3]];
}

/** @param {GfxImage} image @param {number} x @param {number} y @param {ArrayLike<number>} rgba */
export function setPixel(image, x, y, rgba) {
  const at = pixelOffset(image, x, y);
  for (let i = 0; i < 4; i++) image.pixels[at + i] = rgba[i] ?? (i === 3 ? 255 : 0);
}
