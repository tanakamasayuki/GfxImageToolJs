// @ts-check

export { createImage, validateImage, cloneImage, getPixel, setPixel } from './model/image.js';
export { transformImage, cropImage, resizeImage, compositeAlpha } from './transform/transform.js';
export { encodeImage, canEncode, listFormats } from './format/registry.js';
export { inspectImage } from './inspect/inspect.js';
export { emitCSource, sanitizeIdentifier } from './target/csource.js';
export {
  GfxImageError,
  InvalidImageError,
  UnsupportedFormatError,
  EncodeConstraintError,
  CapabilityError,
} from './util/errors.js';

export const VERSION = '0.1.0';
