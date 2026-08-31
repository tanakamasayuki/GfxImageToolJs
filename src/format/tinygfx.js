// @ts-check
import { createImage, validateImage } from '../model/image.js';
import { encodeImage, packBitmap1, rgb565 } from './registry.js';

/** @typedef {import('../model/image.js').GfxImage} GfxImage */
/** @typedef {import('./registry.js').EncodedImage} EncodedImage */

/** @param {GfxImage} image */
function colors565(image) {
  const colors = new Uint16Array(image.width * image.height);
  for (let p = 0; p < colors.length; p++) {
    const at = p * 4;
    colors[p] = rgb565(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]);
  }
  return colors;
}

/** @param {Uint16Array} colors */
function runs(colors) {
  /** @type {{length: number, color: number}[]} */
  const result = [];
  let color = colors[0];
  let length = 1;
  for (let i = 1; i < colors.length; i++) {
    if (colors[i] === color) length++;
    else { result.push({ length, color }); color = colors[i]; length = 1; }
  }
  result.push({ length, color });
  return result;
}

/** @param {GfxImage} image @param {string} format @param {Uint8Array} data @param {number} stride @param {Uint16Array} [palette] @returns {EncodedImage} */
function result(image, format, data, stride, palette) {
  return {
    width: image.width,
    height: image.height,
    format,
    data,
    ...(palette ? { palette } : {}),
    stride,
    stats: { dataBytes: data.length, paletteBytes: palette?.byteLength ?? 0, maskBytes: 0 },
    options: {},
  };
}

/** @param {GfxImage} image @returns {EncodedImage} */
export function encodeTinyRaw565(image) {
  image = validateImage(image);
  const colors = colors565(image);
  const data = new Uint8Array(colors.length * 2);
  for (let i = 0; i < colors.length; i++) { data[i * 2] = colors[i] >> 8; data[i * 2 + 1] = colors[i]; }
  return result(image, 'tinygfx-raw565', data, image.width * 2);
}

/** @param {GfxImage} image @returns {EncodedImage} */
export function encodeTinyRle565(image) {
  image = validateImage(image);
  const bytes = [];
  for (const run of runs(colors565(image))) {
    let left = run.length;
    while (left > 0) {
      const take = Math.min(255, left);
      bytes.push(take, run.color >> 8, run.color & 255);
      left -= take;
    }
  }
  return result(image, 'tinygfx-rle565', Uint8Array.from(bytes), 0);
}

/** @param {GfxImage} image @returns {EncodedImage | null} */
export function encodeTinyRlePal4(image) {
  image = validateImage(image);
  const colors = colors565(image);
  const palette = Uint16Array.from(new Set(colors).values()).sort();
  if (palette.length > 16) return null;
  const index = new Map(Array.from(palette, (color, i) => [color, i]));
  const bytes = [];
  for (const run of runs(colors)) {
    let left = run.length;
    while (left > 0) {
      const take = Math.min(16, left);
      bytes.push(((take - 1) << 4) | /** @type {number} */ (index.get(run.color)));
      left -= take;
    }
  }
  return result(image, 'tinygfx-rlepal4', Uint8Array.from(bytes), 0, palette);
}

/**
 * @param {GfxImage} image
 * @param {'horizontal'|'vertical'} layout
 * @param {{threshold?: number, force?: boolean, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8', transparentMask?: Uint8Array}} [options]
 * @returns {EncodedImage | null}
 */
export function encodeTinyBitmap1(image, layout, options = {}) {
  image = validateImage(image);
  const colors = colors565(image);
  const visibleColors = options.transparentMask
    ? Array.from(colors).filter((_, index) => !options.transparentMask?.[index])
    : Array.from(colors);
  const palette = Uint16Array.from(new Set(visibleColors).values()).sort();
  // TinyGFX bitmap draws only bit 1 in palette[1]; bit 0 always preserves the destination.
  // It can therefore encode one visible color (optionally plus transparency) exactly. Accepting
  // two opaque colors would silently erase the lower color when a shared bitmap decoder becomes
  // attractive. Explicit bitmap or monochrome selection sets force and deliberately permits it.
  if (palette.length > 1 && !options.force) return null;
  /** @type {Uint8Array} */
  const bits = new Uint8Array(colors.length);
  if (palette.length <= 2) {
    const foreground = palette[palette.length - 1];
    for (let i = 0; i < colors.length; i++) bits[i] = !options.transparentMask?.[i] && colors[i] === foreground ? 1 : 0;
  } else {
    const generic = encodeImage(image, layout === 'vertical' ? 'bitmap1-vertical' : 'bitmap1-msb', {
      threshold: options.threshold,
      invert: options.invert,
      dither: options.dither,
    });
    const data = Uint8Array.from(generic.data);
    if (options.transparentMask) for (let p = 0; p < options.transparentMask.length; p++) if (options.transparentMask[p]) {
      const x = p % image.width;
      const y = Math.floor(p / image.width);
      if (layout === 'vertical') data[(y >> 3) * image.width + x] &= ~(1 << (y & 7));
      else data[y * generic.stride + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
    return result(image, generic.format, data, generic.stride, Uint16Array.from([0x0000, 0xffff]));
  }
  const packed = packBitmap1(bits, image.width, image.height, layout === 'vertical' ? 'bitmap1-vertical' : 'bitmap1-msb');
  const monoPalette = palette.length <= 2
    ? Uint16Array.from([palette[0] ?? 0, palette[palette.length - 1] ?? 0xffff])
    : Uint16Array.from([0x0000, 0xffff]);
  return result(image, layout === 'vertical' ? 'bitmap1-vertical' : 'bitmap1-msb', packed.data, packed.stride, monoPalette);
}

/** @param {GfxImage} image @param {{monochrome?: boolean, threshold?: number, alphaThreshold?: number, transparentColor?: number, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'}} [options] */
export function encodeTinyCandidates(image, options = {}) {
  const prepared = prepareTransparency(image, options.alphaThreshold, options.transparentColor);
  const candidates = [encodeTinyRaw565(prepared.image), encodeTinyRle565(prepared.image)];
  const palette = encodeTinyRlePal4(prepared.image);
  if (palette) candidates.push(palette);
  const bitmapOptions = { force: !!options.monochrome, threshold: options.threshold, invert: options.invert, dither: options.dither, transparentMask: prepared.mask };
  const horizontal = encodeTinyBitmap1(prepared.image, 'horizontal', bitmapOptions);
  const vertical = encodeTinyBitmap1(prepared.image, 'vertical', bitmapOptions);
  if (horizontal) candidates.push(horizontal);
  if (vertical) candidates.push(vertical);
  if (prepared.color !== undefined) for (const encoded of candidates) {
    if (encoded.format === 'bitmap1-msb' || encoded.format === 'bitmap1-vertical') continue;
    if (encoded.palette instanceof Uint16Array) {
      const index = encoded.palette.indexOf(prepared.color);
      if (index < 0) throw new Error('Transparent color is absent from TinyGFX palette.');
      encoded.transparent = { kind: 'palette-index', value: index };
    } else encoded.transparent = { kind: 'color', value: prepared.color };
  }
  return candidates;
}

/** @param {GfxImage} image @param {number | undefined} alphaThreshold @param {number | undefined} requestedColor */
function prepareTransparency(image, alphaThreshold, requestedColor) {
  image = validateImage(image);
  if (alphaThreshold === undefined) return { image, mask: undefined, color: undefined };
  if (!Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) throw new RangeError('alphaThreshold must be 0..255.');
  const mask = new Uint8Array(image.width * image.height);
  const used = new Set();
  let count = 0;
  for (let p = 0; p < mask.length; p++) {
    const at = p * 4;
    if (image.pixels[at + 3] < alphaThreshold) { mask[p] = 1; count++; }
    else used.add(rgb565(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2]));
  }
  if (!count) return { image, mask: undefined, color: undefined };
  if (requestedColor !== undefined && (!Number.isInteger(requestedColor) || requestedColor < 0 || requestedColor > 0xffff)) {
    throw new RangeError('transparentColor must be 0..65535.');
  }
  let color = requestedColor ?? 0;
  if (requestedColor !== undefined && used.has(color)) throw new Error(`Transparent RGB565 color 0x${color.toString(16).padStart(4, '0')} is used by a visible pixel.`);
  while (requestedColor === undefined && color <= 0xffff && used.has(color)) color++;
  if (color > 0xffff) throw new Error('No unused RGB565 color is available for transparency.');
  const pixels = Uint8Array.from(image.pixels);
  const r = ((color >> 11) & 31) << 3;
  const g = ((color >> 5) & 63) << 2;
  const b = (color & 31) << 3;
  for (let p = 0; p < mask.length; p++) if (mask[p]) {
    const at = p * 4;
    pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = 255;
  }
  return { image: createImage(image.width, image.height, pixels, { source: image.source }), mask, color };
}
