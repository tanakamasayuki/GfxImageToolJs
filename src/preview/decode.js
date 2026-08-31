// @ts-check
import { createImage } from '../model/image.js';

/** @typedef {import('../format/registry.js').EncodedImage} EncodedImage */

/** @param {number} color @param {Uint8Array} pixels @param {number} p @param {number} alpha */
function put565(color, pixels, p, alpha = 255) {
  pixels[p * 4] = Math.round(((color >> 11) & 31) * 255 / 31);
  pixels[p * 4 + 1] = Math.round(((color >> 5) & 63) * 255 / 63);
  pixels[p * 4 + 2] = Math.round((color & 31) * 255 / 31);
  pixels[p * 4 + 3] = alpha;
}

/**
 * Decode an encoded asset to the exact pixels shown by the target format.
 * TinyGFX bitmap zero bits are transparent; generic bitmap zero bits are black.
 * @param {EncodedImage} encoded
 * @param {{target?: string}} [options]
 */
export function decodeEncodedImage(encoded, options = {}) {
  const count = encoded.width * encoded.height;
  const pixels = new Uint8Array(count * 4);
  const target = options.target ?? 'generic-c';

  if (encoded.format === 'rgb888') {
    for (let p = 0; p < count; p++) {
      pixels.set(encoded.data.subarray(p * 3, p * 3 + 3), p * 4);
      pixels[p * 4 + 3] = 255;
    }
    return createImage(encoded.width, encoded.height, pixels);
  }
  if (encoded.format === 'gray8') {
    for (let p = 0; p < count; p++) {
      pixels.fill(encoded.data[p], p * 4, p * 4 + 3);
      pixels[p * 4 + 3] = 255;
    }
    return createImage(encoded.width, encoded.height, pixels);
  }
  if (encoded.format === 'rgb332') {
    for (let p = 0; p < count; p++) {
      const value = encoded.data[p];
      pixels[p * 4] = Math.round(((value >> 5) & 7) * 255 / 7);
      pixels[p * 4 + 1] = Math.round(((value >> 2) & 7) * 255 / 7);
      pixels[p * 4 + 2] = (value & 3) * 85;
      pixels[p * 4 + 3] = 255;
    }
    return createImage(encoded.width, encoded.height, pixels);
  }
  if (encoded.format === 'indexed8' && encoded.palette instanceof Uint8Array) {
    for (let p = 0; p < count; p++) {
      const at = encoded.data[p] * 3;
      pixels[p * 4] = encoded.palette[at];
      pixels[p * 4 + 1] = encoded.palette[at + 1];
      pixels[p * 4 + 2] = encoded.palette[at + 2];
      pixels[p * 4 + 3] = 255;
    }
    return createImage(encoded.width, encoded.height, pixels);
  }
  if (['bitmap1-msb', 'bitmap1-lsb', 'bitmap1-vertical', 'mask1-msb'].includes(encoded.format)) {
    for (let p = 0; p < count; p++) {
      const x = p % encoded.width;
      const y = Math.floor(p / encoded.width);
      const bit = encoded.format === 'bitmap1-vertical'
        ? (encoded.data[(y >> 3) * encoded.width + x] >> (y & 7)) & 1
        : encoded.format === 'bitmap1-lsb'
          ? (encoded.data[y * encoded.stride + (x >> 3)] >> (x & 7)) & 1
          : (encoded.data[y * encoded.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      const alpha = encoded.format === 'mask1-msb' || target === 'tinygfx' ? (bit ? 255 : 0) : 255;
      put565(bit ? 0xffff : 0, pixels, p, alpha);
    }
    return createImage(encoded.width, encoded.height, pixels);
  }

  const colors = new Uint16Array(count);
  /** @type {Uint8Array | undefined} */
  let indices;
  if (encoded.format === 'tinygfx-raw565' || encoded.format === 'rgb565be' || encoded.format === 'rgb565le') {
    for (let p = 0; p < count; p++) {
      colors[p] = encoded.format === 'rgb565le'
        ? encoded.data[p * 2] | (encoded.data[p * 2 + 1] << 8)
        : (encoded.data[p * 2] << 8) | encoded.data[p * 2 + 1];
    }
  } else if (encoded.format === 'tinygfx-rle565') {
    let at = 0;
    let p = 0;
    while (at < encoded.data.length && p < count) {
      const run = encoded.data[at++];
      const color = (encoded.data[at++] << 8) | encoded.data[at++];
      colors.fill(color, p, Math.min(count, p + run));
      p += run;
    }
  } else if (encoded.format === 'tinygfx-rlepal4' && encoded.palette instanceof Uint16Array) {
    indices = new Uint8Array(count);
    let p = 0;
    for (const byte of encoded.data) {
      const run = (byte >> 4) + 1;
      const index = byte & 15;
      colors.fill(encoded.palette[index], p, Math.min(count, p + run));
      indices.fill(index, p, Math.min(count, p + run));
      p += run;
    }
  } else {
    throw new Error(`Preview decoding is not supported for ${encoded.format}.`);
  }
  for (let p = 0; p < count; p++) {
    const transparent = encoded.transparent?.kind === 'color'
      ? colors[p] === encoded.transparent.value
      : encoded.transparent?.kind === 'palette-index'
        ? indices?.[p] === encoded.transparent.value
        : false;
    put565(colors[p], pixels, p, transparent ? 0 : 255);
  }
  return createImage(encoded.width, encoded.height, pixels);
}

/**
 * Place source and converted pixels next to each other without scaling.
 * @param {import('../model/image.js').GfxImage} source
 * @param {import('../model/image.js').GfxImage} converted
 */
export function compareImages(source, converted) {
  const width = source.width + converted.width;
  const height = Math.max(source.height, converted.height);
  const pixels = new Uint8Array(width * height * 4);
  for (const [image, offsetX] of [[source, 0], [converted, source.width]]) {
    const current = /** @type {import('../model/image.js').GfxImage} */ (image);
    for (let y = 0; y < current.height; y++) {
      const from = y * current.width * 4;
      pixels.set(current.pixels.subarray(from, from + current.width * 4), (y * width + Number(offsetX)) * 4);
    }
  }
  return createImage(width, height, pixels);
}
