// @ts-check
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createImage } from '../model/image.js';
import { CapabilityError, InvalidImageError } from '../util/errors.js';

/** @param {string} [mime] */
function normalizedMime(mime) {
  return mime ? String(mime).toLowerCase() : undefined;
}

/**
 * @param {Uint8Array} bytes
 * @param {{name?: string, mime?: string, maxPixels?: number}} [options]
 */
export async function decodeImageBytes(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new InvalidImageError('EMPTY_INPUT', 'Image input must be a non-empty Uint8Array.');
  }
  let canvas;
  try {
    canvas = await import('@napi-rs/canvas');
  } catch (error) {
    throw new CapabilityError(
      'NODE_DECODER_UNAVAILABLE',
      'Node image decoding needs the optional @napi-rs/canvas package.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  let decoded;
  try {
    decoded = await canvas.loadImage(Buffer.from(bytes));
  } catch (error) {
    throw new InvalidImageError('DECODE_FAILED', `Could not decode ${options.name ?? 'image input'}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const maxPixels = options.maxPixels ?? 64 * 1024 * 1024;
  const pixels = decoded.width * decoded.height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > maxPixels) {
    throw new InvalidImageError('IMAGE_TOO_LARGE', `Decoded image has ${pixels} pixels; limit is ${maxPixels}.`, {
      width: decoded.width,
      height: decoded.height,
      maxPixels,
    });
  }
  const surface = canvas.createCanvas(decoded.width, decoded.height);
  const context = surface.getContext('2d');
  context.clearRect(0, 0, decoded.width, decoded.height);
  context.drawImage(decoded, 0, 0);
  const rgba = context.getImageData(0, 0, decoded.width, decoded.height).data;
  return createImage(decoded.width, decoded.height, rgba, {
    source: { name: options.name, mime: normalizedMime(options.mime), decoder: '@napi-rs/canvas' },
  });
}

/** @param {string} path @param {{mime?: string, maxPixels?: number}} [options] */
export async function decodeImageFile(path, options = {}) {
  const bytes = await readFile(path);
  return decodeImageBytes(bytes, { ...options, name: basename(path) });
}
