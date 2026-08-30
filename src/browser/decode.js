// @ts-check
import { createImage } from '../model/image.js';
import { InvalidImageError } from '../util/errors.js';

/**
 * Decode a browser File/Blob through createImageBitmap and normalize it to RGBA8888.
 * @param {Blob} blob
 * @param {{name?: string, maxPixels?: number}} [options]
 */
export async function decodeBrowserImage(blob, options = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('decodeBrowserImage expects a Blob.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new InvalidImageError('DECODE_FAILED', `Could not decode ${options.name ?? 'image input'}.`, {
      cause: /** @type {Error} */ (error).message,
    });
  }
  try {
    const pixels = bitmap.width * bitmap.height;
    const maxPixels = options.maxPixels ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
      throw new InvalidImageError('IMAGE_TOO_LARGE', `${options.name ?? 'Image'} has ${pixels} pixels; maximum is ${maxPixels}.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new InvalidImageError('CANVAS_UNAVAILABLE', 'A 2D canvas context is required to decode images.');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return createImage(bitmap.width, bitmap.height, data, {
      source: { name: options.name, mime: blob.type || undefined, decoder: 'browser-createImageBitmap' },
    });
  } finally {
    bitmap.close();
  }
}
