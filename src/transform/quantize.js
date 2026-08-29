// @ts-check
import { createImage, validateImage } from '../model/image.js';

/** @typedef {import('../model/image.js').GfxImage} GfxImage */
/** @typedef {{key: number, r: number, g: number, b: number, count: number}} Color */
/** @typedef {{colors: Color[], count: number, ranges: [number, number, number]}} Box */

/** @param {Color[]} colors @returns {Box} */
function makeBox(colors) {
  let count = 0;
  let minR = 255; let minG = 255; let minB = 255;
  let maxR = 0; let maxG = 0; let maxB = 0;
  for (const color of colors) {
    count += color.count;
    minR = Math.min(minR, color.r); minG = Math.min(minG, color.g); minB = Math.min(minB, color.b);
    maxR = Math.max(maxR, color.r); maxG = Math.max(maxG, color.g); maxB = Math.max(maxB, color.b);
  }
  return { colors, count, ranges: [maxR - minR, maxG - minG, maxB - minB] };
}

/** @param {Box} box */
function splitBox(box) {
  let channel = 0;
  if (box.ranges[1] > box.ranges[channel]) channel = 1;
  if (box.ranges[2] > box.ranges[channel]) channel = 2;
  const component = (/** @type {Color} */ color) => channel === 0 ? color.r : channel === 1 ? color.g : color.b;
  const colors = [...box.colors].sort((a, b) => component(a) - component(b) || a.key - b.key);
  const half = box.count / 2;
  let total = 0;
  let at = 1;
  for (; at < colors.length; at++) {
    total += colors[at - 1].count;
    if (total >= half) break;
  }
  return [makeBox(colors.slice(0, at)), makeBox(colors.slice(at))];
}

/** @param {Box} box */
function representative(box) {
  let r = 0; let g = 0; let b = 0;
  for (const color of box.colors) {
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
  }
  return [Math.round(r / box.count), Math.round(g / box.count), Math.round(b / box.count)];
}

/** @param {number} r @param {number} g @param {number} b @param {number[][]} palette */
function nearest(r, g, b, palette) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0]; const dg = g - palette[i][1]; const db = b - palette[i][2];
    const candidate = dr * dr + dg * dg + db * db;
    if (candidate < distance) { distance = candidate; best = i; }
  }
  return best;
}

/**
 * Deterministic weighted median-cut with stable channel/key tie breaks.
 * Alpha is intentionally ignored; callers must composite or mask it first.
 * @param {GfxImage} image
 * @param {number} maxColors
 * @param {{dither?: 'none'|'floyd-steinberg'}} [options]
 */
export function quantizeImage(image, maxColors, options = {}) {
  image = validateImage(image);
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 256) {
    throw new RangeError('maxColors must be an integer from 2 to 256.');
  }
  const counts = new Map();
  for (let i = 0; i < image.pixels.length; i += 4) {
    const key = (image.pixels[i] << 16) | (image.pixels[i + 1] << 8) | image.pixels[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  /** @type {Color[]} */
  const colors = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([key, count]) => ({
    key,
    r: key >> 16,
    g: (key >> 8) & 255,
    b: key & 255,
    count,
  }));
  /** @type {Box[]} */
  let boxes = [makeBox(colors)];
  while (boxes.length < maxColors) {
    let chosen = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      if (chosen < 0) chosen = i;
      else {
        const range = Math.max(...boxes[i].ranges);
        const bestRange = Math.max(...boxes[chosen].ranges);
        if (range > bestRange || (range === bestRange && boxes[i].count > boxes[chosen].count)) chosen = i;
      }
    }
    if (chosen < 0) break;
    const [left, right] = splitBox(boxes[chosen]);
    boxes.splice(chosen, 1, left, right);
  }
  const palette = boxes.map(representative);
  const paletteBytes = Uint8Array.from(palette.flat());
  const indices = new Uint8Array(image.width * image.height);
  const dither = options.dither ?? 'none';
  if (dither !== 'none' && dither !== 'floyd-steinberg') throw new RangeError(`Unsupported indexed dither: ${dither}`);
  if (dither === 'none') {
    for (let p = 0; p < indices.length; p++) {
      const at = p * 4;
      indices[p] = nearest(image.pixels[at], image.pixels[at + 1], image.pixels[at + 2], palette);
    }
  } else {
    const work = new Float64Array(indices.length * 3);
    for (let p = 0; p < indices.length; p++) {
      work[p * 3] = image.pixels[p * 4];
      work[p * 3 + 1] = image.pixels[p * 4 + 1];
      work[p * 3 + 2] = image.pixels[p * 4 + 2];
    }
    /** @param {number} p @param {number} c @param {number} value */
    const add = (p, c, value) => { work[p * 3 + c] += value; };
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const p = y * image.width + x;
        const r = Math.max(0, Math.min(255, work[p * 3]));
        const g = Math.max(0, Math.min(255, work[p * 3 + 1]));
        const b = Math.max(0, Math.min(255, work[p * 3 + 2]));
        const index = nearest(r, g, b, palette);
        indices[p] = index;
        for (let c = 0; c < 3; c++) {
          const error = [r, g, b][c] - palette[index][c];
          if (x + 1 < image.width) add(p + 1, c, error * 7 / 16);
          if (y + 1 < image.height) {
            if (x > 0) add(p + image.width - 1, c, error * 3 / 16);
            add(p + image.width, c, error * 5 / 16);
            if (x + 1 < image.width) add(p + image.width + 1, c, error / 16);
          }
        }
      }
    }
  }
  return { palette: paletteBytes, indices, colorCount: palette.length };
}

/**
 * Replace RGB with the deterministic quantized palette while retaining source alpha.
 * @param {GfxImage} image
 * @param {number} maxColors
 * @param {{dither?: 'none'|'floyd-steinberg'}} [options]
 */
export function reduceImageColors(image, maxColors, options = {}) {
  image = validateImage(image);
  const quantized = quantizeImage(image, maxColors, options);
  const pixels = new Uint8Array(image.pixels.length);
  for (let p = 0; p < quantized.indices.length; p++) {
    const paletteAt = quantized.indices[p] * 3;
    pixels[p * 4] = quantized.palette[paletteAt];
    pixels[p * 4 + 1] = quantized.palette[paletteAt + 1];
    pixels[p * 4 + 2] = quantized.palette[paletteAt + 2];
    pixels[p * 4 + 3] = image.pixels[p * 4 + 3];
  }
  return { image: createImage(image.width, image.height, pixels, { source: image.source }), ...quantized };
}
