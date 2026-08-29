// @ts-check
import { encodeTinyCandidates } from '../format/tinygfx.js';

/** @typedef {import('../model/image.js').GfxImage} GfxImage */
/** @typedef {import('../format/registry.js').EncodedImage} EncodedImage */

export const TINYGFX_CANDIDATES = Object.freeze(['raw565', 'rle565', 'rlepal4', 'bitmap1h', 'bitmap1v']);

/** @param {EncodedImage} encoded */
export function tinyCandidateId(encoded) {
  const ids = {
    'tinygfx-raw565': 'raw565',
    'tinygfx-rle565': 'rle565',
    'tinygfx-rlepal4': 'rlepal4',
    'bitmap1-msb': 'bitmap1h',
    'bitmap1-vertical': 'bitmap1v',
  };
  const id = ids[/** @type {keyof typeof ids} */ (encoded.format)];
  if (!id) throw new Error(`Not a TinyGFX candidate: ${encoded.format}`);
  return id;
}

/** @param {EncodedImage} encoded */
export function encodedBytes(encoded) {
  return encoded.stats.dataBytes + encoded.stats.paletteBytes + encoded.stats.maskBytes;
}

/** @param {Iterable<string>} formats @param {number} [decoderCost] */
export function tinyDecoderSetCost(formats, decoderCost = 400) {
  if (!Number.isFinite(decoderCost) || decoderCost < 0) throw new RangeError('decoderCost must be non-negative.');
  const used = new Set(formats);
  let cost = 0;
  if (used.has('bitmap1h') && used.has('bitmap1v')) {
    cost += Math.round(decoderCost * 1.3);
    used.delete('bitmap1h');
    used.delete('bitmap1v');
  }
  return cost + used.size * decoderCost;
}

/**
 * @param {{key: string, image: GfxImage, monochrome?: boolean, threshold?: number, alphaThreshold?: number, transparentColor?: number, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8', allowedFormats?: string[]}[]} inputs
 * @param {{decoderCost?: number, allowedFormats?: string[], preferBitmap?: 'horizontal'|'vertical'}} [options]
 */
export function optimizeTinyImageSet(inputs, options = {}) {
  if (!inputs.length) throw new Error('At least one image is required.');
  const decoderCost = options.decoderCost ?? 400;
  const allowed = options.allowedFormats ?? [...TINYGFX_CANDIDATES];
  for (const format of allowed) if (!TINYGFX_CANDIDATES.includes(format)) throw new Error(`Unknown TinyGFX candidate: ${format}`);
  const preferred = options.preferBitmap ?? 'horizontal';
  const rank = preferred === 'vertical'
    ? ['raw565', 'rle565', 'rlepal4', 'bitmap1v', 'bitmap1h']
    : ['raw565', 'rle565', 'rlepal4', 'bitmap1h', 'bitmap1v'];
  const perImage = inputs.map((input) => {
    const candidates = encodeTinyCandidates(input.image, { monochrome: input.monochrome, threshold: input.threshold, alphaThreshold: input.alphaThreshold, transparentColor: input.transparentColor, invert: input.invert, dither: input.dither });
    if (input.allowedFormats) for (const format of input.allowedFormats) {
      if (!TINYGFX_CANDIDATES.includes(format)) throw new Error(`Unknown TinyGFX candidate: ${format}`);
    }
    return {
      input,
      candidates: new Map(candidates.flatMap((encoded) => {
        const id = tinyCandidateId(encoded);
        return !input.allowedFormats || input.allowedFormats.includes(id) ? [[id, encoded]] : [];
      })),
    };
  });
  /** @type {null | {images: {key: string, format: string, encoded: EncodedImage, bytes: number}[], formats: string[], dataBytes: number, decoderBytes: number, totalBytes: number}} */
  let best = null;
  for (let mask = 1; mask < (1 << allowed.length); mask++) {
    const subset = allowed.filter((_, index) => mask & (1 << index));
    const selected = [];
    let possible = true;
    for (const item of perImage) {
      const candidates = subset.flatMap((format) => {
        const encoded = item.candidates.get(format);
        return encoded ? [{ format, encoded }] : [];
      });
      if (!candidates.length) { possible = false; break; }
      candidates.sort((a, b) => encodedBytes(a.encoded) - encodedBytes(b.encoded) || rank.indexOf(a.format) - rank.indexOf(b.format));
      const choice = candidates[0];
      selected.push({ key: item.input.key, format: choice.format, encoded: choice.encoded, bytes: encodedBytes(choice.encoded) });
    }
    if (!possible) continue;
    const formats = [...new Set(selected.map((item) => item.format))].sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
    const dataBytes = selected.reduce((sum, item) => sum + item.bytes, 0);
    const decoderBytes = tinyDecoderSetCost(formats, decoderCost);
    const candidate = { images: selected, formats, dataBytes, decoderBytes, totalBytes: dataBytes + decoderBytes };
    if (!best || candidate.totalBytes < best.totalBytes
      || (candidate.totalBytes === best.totalBytes && candidate.formats.length < best.formats.length)
      || (candidate.totalBytes === best.totalBytes && candidate.formats.length === best.formats.length
        && candidate.formats.map((format) => rank.indexOf(format)).join(',')
          < best.formats.map((format) => rank.indexOf(format)).join(','))) best = candidate;
  }
  if (!best) throw new Error('No allowed TinyGFX format can encode every image.');
  const report = perImage.map((item) => {
    const candidates = Array.from(item.candidates, ([format, encoded]) => ({ format, bytes: encodedBytes(encoded) }))
      .sort((a, b) => a.bytes - b.bytes || rank.indexOf(a.format) - rank.indexOf(b.format));
    const individualMinimum = candidates[0];
    const selected = best.images.find((image) => image.key === item.input.key);
    if (!individualMinimum || !selected) throw new Error(`TinyGFX report is incomplete for ${item.input.key}.`);
    return {
      key: item.input.key,
      candidates,
      individualMinimum,
      selected: { format: selected.format, bytes: selected.bytes },
      dataDelta: selected.bytes - individualMinimum.bytes,
    };
  });
  return { ...best, report };
}

/** @param {GfxImage} image @param {{decoderCost?: number, allowedFormats?: string[], preferBitmap?: 'horizontal'|'vertical', monochrome?: boolean, threshold?: number, alphaThreshold?: number, transparentColor?: number, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'}} [options] */
export function optimizeTinyImage(image, options = {}) {
  const result = optimizeTinyImageSet([{ key: 'image', image, monochrome: options.monochrome, threshold: options.threshold, alphaThreshold: options.alphaThreshold, transparentColor: options.transparentColor, invert: options.invert, dither: options.dither }], options);
  return { ...result.images[0], decoderBytes: result.decoderBytes, totalBytes: result.totalBytes, report: result.report };
}
