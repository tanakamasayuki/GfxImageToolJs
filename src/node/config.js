// @ts-check
import { buildGlobMatcher } from './ignore.js';

/** @typedef {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} Dither */
/**
 * @typedef {object} ImagesConfig
 * @property {{outputDir: string, prefix: string, target: string, indexHeader: string}} general
 * @property {{patterns: string[]}} input
 * @property {{format: string, mode: 'auto'|'monochrome'|'grayscale'|'indexed'|'true-color', colors: number, dither: Dither, threshold: number, invert: boolean}} color
 * @property {{mode: 'none'|'color-key', matte: [number, number, number], threshold: number, color: 'auto'|[number, number, number]}} alpha
 * @property {{storage: string, align: number, static: boolean}} csource
 * @property {{decoderCost: number, preferBitmap: 'horizontal'|'vertical', alignedVblit: boolean}} optimize
 * @property {{pattern: string, values: Record<string, string>}[]} overrides
 */

/** @param {string} text */
export function parseIniConfig(text) {
  /** @type {{name: string, values: Record<string, string>}[]} */
  const sections = [{ name: 'general', values: {} }];
  let current = sections[0];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      current = { name: section[1].trim(), values: {} };
      sections.push(current);
      continue;
    }
    const entry = /^([^=]+)=(.*)$/.exec(line);
    if (!entry) throw new Error(`Invalid .imagesconfig line: ${raw}`);
    current.values[entry[1].trim().toLowerCase()] = stripComment(entry[2]);
  }
  return sections;
}

/** @param {string} text */
function stripComment(text) {
  const value = text.trim();
  for (let i = 0; i < value.length; i++) {
    if ((value[i] === '#' || value[i] === ';') && i > 0 && /\s/.test(value[i - 1])) return value.slice(0, i).trim();
  }
  return value;
}

/** @param {string | undefined} value @param {boolean} fallback @param {string} key */
function bool(value, fallback, key) {
  if (value === undefined || value === '') return fallback;
  if (['true', 'yes', 'on', '1'].includes(value.toLowerCase())) return true;
  if (['false', 'no', 'off', '0'].includes(value.toLowerCase())) return false;
  throw new Error(`${key} must be true or false.`);
}

/** @param {string | undefined} value @param {number} fallback @param {number} min @param {number} max @param {string} key */
function integer(value, fallback, min, max, key) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  return parsed;
}

/** @param {string | undefined} value @returns {[number, number, number]} */
export function parseRgb(value) {
  const text = value || '000000';
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text);
  if (!match) throw new Error(`Invalid RGB color: ${text}`);
  return /** @type {[number, number, number]} */ ([0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16)));
}

/** @param {string} text @returns {ImagesConfig} */
export function parseImagesConfig(text) {
  const sections = parseIniConfig(text);
  /** @type {(name: string) => Record<string, string>} */
  const values = (name) => Object.assign(
    {},
    ...sections.filter((section) => section.name.toLowerCase() === name).map((section) => section.values),
  );
  const general = values('general');
  const input = values('input');
  const color = values('color');
  const alpha = values('alpha');
  const csource = values('csource');
  const optimize = values('optimize');
  const dither = color.dither || 'none';
  if (!['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8'].includes(dither)) throw new Error(`Unknown dither: ${dither}`);
  const alphaMode = alpha.mode || 'none';
  if (alphaMode !== 'none' && alphaMode !== 'color-key') throw new Error(`Unknown alpha mode: ${alphaMode}`);
  const alphaColor = !alpha.color || alpha.color === 'auto' ? 'auto' : parseRgb(alpha.color);
  const colorMode = color.mode || 'auto';
  if (!['auto', 'monochrome', 'grayscale', 'indexed', 'true-color'].includes(colorMode)) throw new Error(`Unknown color mode: ${colorMode}`);
  const alignedVblit = bool(optimize.aligned_vblit, false, 'optimize.aligned_vblit');
  const preferBitmap = optimize.prefer_bitmap || (alignedVblit ? 'vertical' : 'horizontal');
  if (preferBitmap !== 'horizontal' && preferBitmap !== 'vertical') throw new Error(`Unknown prefer_bitmap: ${preferBitmap}`);
  return {
    general: {
      outputDir: general.output_dir || 'generated',
      prefix: general.prefix || '',
      target: general.target || 'generic-c',
      indexHeader: general.index_header || '',
    },
    input: {
      patterns: (input.patterns || '**/*.png, **/*.jpg, **/*.jpeg, **/*.gif, **/*.bmp, **/*.webp')
        .split(',').map((part) => part.trim()).filter(Boolean),
    },
    color: {
      format: color.format || 'rgb565be',
      mode: /** @type {'auto'|'monochrome'|'grayscale'|'indexed'|'true-color'} */ (colorMode),
      colors: integer(color.colors, 256, 2, 256, 'color.colors'),
      dither: /** @type {Dither} */ (dither),
      threshold: integer(color.threshold, 128, 0, 255, 'color.threshold'),
      invert: bool(color.invert, false, 'color.invert'),
    },
    alpha: {
      mode: /** @type {'none'|'color-key'} */ (alphaMode),
      matte: parseRgb(alpha.matte),
      threshold: integer(alpha.threshold, 128, 0, 255, 'alpha.threshold'),
      color: /** @type {'auto'|[number, number, number]} */ (alphaColor),
    },
    csource: {
      storage: csource.storage ?? 'PROGMEM',
      align: integer(csource.align, 4, 1, 4096, 'csource.align'),
      static: bool(csource.static, true, 'csource.static'),
    },
    optimize: {
      decoderCost: integer(optimize.decoder_cost, 400, 0, 1000000, 'optimize.decoder_cost'),
      preferBitmap: /** @type {'horizontal'|'vertical'} */ (preferBitmap),
      alignedVblit,
    },
    overrides: sections.flatMap((section) => {
      const match = /^image\s+["'](.+)["']$/i.exec(section.name);
      return match ? [{ pattern: match[1], values: section.values }] : [];
    }),
  };
}

/** @param {ImagesConfig} config @param {string} relativePath */
export function resolveImageConfig(config, relativePath) {
  const effective = {
    general: { ...config.general },
    color: { ...config.color },
    alpha: {
      ...config.alpha,
      matte: /** @type {[number, number, number]} */ ([...config.alpha.matte]),
      color: config.alpha.color === 'auto' ? 'auto' : /** @type {[number, number, number]} */ ([...config.alpha.color]),
    },
    csource: { ...config.csource },
    optimize: { ...config.optimize },
    symbol: '',
    output: '',
  };
  for (const override of config.overrides) {
    if (!buildGlobMatcher([override.pattern])(relativePath)) continue;
    const value = override.values;
    if (value.target !== undefined) effective.general.target = value.target;
    if (value.format !== undefined) effective.color.format = value.format;
    if (value.mode !== undefined) {
      if (!['auto', 'monochrome', 'grayscale', 'indexed', 'true-color'].includes(value.mode)) throw new Error(`Unknown color mode: ${value.mode}`);
      effective.color.mode = /** @type {'auto'|'monochrome'|'grayscale'|'indexed'|'true-color'} */ (value.mode);
    }
    if (value.colors !== undefined) effective.color.colors = integer(value.colors, 256, 2, 256, 'image.colors');
    if (value.dither !== undefined) {
      if (!['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8'].includes(value.dither)) throw new Error(`Unknown dither: ${value.dither}`);
      effective.color.dither = /** @type {Dither} */ (value.dither);
    }
    if (value.threshold !== undefined) effective.color.threshold = integer(value.threshold, 128, 0, 255, 'image.threshold');
    if (value.invert !== undefined) effective.color.invert = bool(value.invert, false, 'image.invert');
    if (value.alpha_mode !== undefined) {
      if (value.alpha_mode !== 'none' && value.alpha_mode !== 'color-key') throw new Error(`Unknown alpha mode: ${value.alpha_mode}`);
      effective.alpha.mode = value.alpha_mode;
    }
    if (value.alpha_threshold !== undefined) effective.alpha.threshold = integer(value.alpha_threshold, 128, 0, 255, 'image.alpha_threshold');
    if (value.alpha_color !== undefined) effective.alpha.color = value.alpha_color === 'auto' ? 'auto' : parseRgb(value.alpha_color);
    if (value.matte !== undefined) effective.alpha.matte = parseRgb(value.matte);
    if (value.storage !== undefined) effective.csource.storage = value.storage;
    if (value.align !== undefined) effective.csource.align = integer(value.align, 4, 1, 4096, 'image.align');
    if (value.static !== undefined) effective.csource.static = bool(value.static, true, 'image.static');
    if (value.symbol !== undefined) effective.symbol = value.symbol;
    if (value.output !== undefined) effective.output = value.output;
    if (value.decoder_cost !== undefined) effective.optimize.decoderCost = integer(value.decoder_cost, 400, 0, 1000000, 'image.decoder_cost');
    if (value.prefer_bitmap !== undefined) {
      if (value.prefer_bitmap !== 'horizontal' && value.prefer_bitmap !== 'vertical') throw new Error(`Unknown prefer_bitmap: ${value.prefer_bitmap}`);
      effective.optimize.preferBitmap = value.prefer_bitmap;
    }
  }
  return effective;
}

export const IMAGES_CONFIG_TEMPLATE = `# gfx-image-tool project configuration

[general]
output_dir = generated
prefix =
target = generic-c
# index_header = images.h

[input]
patterns = **/*.png, **/*.jpg, **/*.jpeg, **/*.gif, **/*.bmp, **/*.webp

[color]
format = rgb565be
mode = auto
colors = 256
dither = none
threshold = 128
invert = false

[alpha]
mode = none
matte = 000000
threshold = 128
color = auto

[csource]
storage = PROGMEM
align = 4
static = true

[optimize]
decoder_cost = 400
prefer_bitmap = horizontal
aligned_vblit = false

# Per-image or glob override example:
# [image "icons/*.png"]
# format = indexed8
# colors = 16
# dither = floyd-steinberg
`;
