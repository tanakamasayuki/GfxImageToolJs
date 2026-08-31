// @ts-check
import { CapabilityError } from '../util/errors.js';
import { compareImages } from '../preview/decode.js';

/**
 * Encode converted pixels, or source and converted pixels side by side, as PNG.
 * @param {import('../model/image.js').GfxImage} source
 * @param {import('../model/image.js').GfxImage} converted
 * @param {'converted'|'comparison'} [layout]
 */
export async function encodePreviewPng(source, converted, layout = 'converted') {
  if (layout !== 'converted' && layout !== 'comparison') throw new RangeError(`Unknown preview layout: ${layout}`);
  const image = layout === 'comparison' ? compareImages(source, converted) : converted;
  let canvas;
  try { canvas = await import('@napi-rs/canvas'); }
  catch (error) {
    throw new CapabilityError('NODE_PREVIEW_UNAVAILABLE', 'PNG preview output needs the optional @napi-rs/canvas package.', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const surface = canvas.createCanvas(image.width, image.height);
  const context = surface.getContext('2d');
  const data = context.createImageData(image.width, image.height);
  data.data.set(image.pixels);
  context.putImageData(data, 0, 0);
  return new Uint8Array(await surface.encode('png'));
}
