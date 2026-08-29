// @ts-check
import { validateImage } from '../model/image.js';
import { encodeImage, listFormats } from '../format/registry.js';

/** @param {import('../model/image.js').GfxImage} image @param {{threshold?: number, alphaThreshold?: number, invert?: boolean, dither?: 'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'}} [options] */
export function inspectImage(image, options = {}) {
  image = validateImage(image);
  const colors = new Set();
  let transparentPixels = 0;
  let translucentPixels = 0;
  for (let i = 0; i < image.pixels.length; i += 4) {
    colors.add(`${image.pixels[i]},${image.pixels[i + 1]},${image.pixels[i + 2]},${image.pixels[i + 3]}`);
    if (image.pixels[i + 3] === 0) transparentPixels++;
    else if (image.pixels[i + 3] !== 255) translucentPixels++;
  }
  return {
    width: image.width,
    height: image.height,
    pixels: image.width * image.height,
    colors: colors.size,
    transparentPixels,
    translucentPixels,
    candidates: listFormats().map((format) => {
      const encoded = encodeImage(image, format, options);
      return { format, bytes: encoded.data.length, stride: encoded.stride };
    }),
  };
}
