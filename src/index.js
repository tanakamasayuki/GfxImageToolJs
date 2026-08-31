// @ts-check

export { createImage, validateImage, cloneImage, getPixel, setPixel } from './model/image.js';
export { transformImage, cropImage, resizeImage, compositeAlpha, grayscaleImage } from './transform/transform.js';
export { quantizeImage, reduceImageColors } from './transform/quantize.js';
export { encodeImage, canEncode, listFormats, rgb565 } from './format/registry.js';
export {
  encodeTinyRaw565,
  encodeTinyRle565,
  encodeTinyRlePal4,
  encodeTinyBitmap1,
  encodeTinyCandidates,
} from './format/tinygfx.js';
export { inspectImage } from './inspect/inspect.js';
export {
  TINYGFX_CANDIDATES,
  encodedBytes,
  optimizeTinyImage,
  optimizeTinyImageSet,
  tinyCandidateId,
  tinyDecoderSetCost,
} from './optimize/tinygfx.js';
export { emitCSource, emitCBundle, sanitizeIdentifier } from './target/csource.js';
export { listTargets, targetFormats, targetSupports } from './target/presets.js';
export { decodeEncodedImage, compareImages } from './preview/decode.js';
export {
  GfxImageError,
  InvalidImageError,
  UnsupportedFormatError,
  EncodeConstraintError,
  CapabilityError,
} from './util/errors.js';

export const VERSION = '0.1.0';
