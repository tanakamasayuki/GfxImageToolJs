// @ts-check
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { decodeImageFile } from './decode.js';
import { IMAGES_CONFIG_TEMPLATE, parseImagesConfig, resolveImageConfig } from './config.js';
import { buildGlobMatcher, buildImagesIgnoreMatcher } from './ignore.js';
import { applyColorKey, grayscaleImage, transformImage } from '../transform/transform.js';
import { encodeImage, rgb565 } from '../format/registry.js';
import { reduceImageColors } from '../transform/quantize.js';
import { emitCBundle, emitCSource, sanitizeIdentifier } from '../target/csource.js';
import { optimizeTinyImageSet } from '../optimize/tinygfx.js';
import { HEADER_MANIFEST, planGeneratedOutputs } from './manifest.js';

/** @typedef {import('./config.js').ImagesConfig} ImagesConfig */
/** @typedef {{relative: string, absolute: string}} ImageEntry */
/** @typedef {{entry: ImageEntry, effective: ReturnType<typeof resolveImageConfig>, original: import('../model/image.js').GfxImage, image: import('../model/image.js').GfxImage, symbol: string, output: string}} PreparedImage */
/** @typedef {{input: string, relative: string, output: string, symbol: string, target: string, format: string, source: string, original: import('../model/image.js').GfxImage, prepared: import('../model/image.js').GfxImage, encoded: import('../format/registry.js').EncodedImage, dataBytes: number, paletteBytes: number}} BuiltImage */

export const IMAGE_PROJECT_DIR = 'images';
export const IMAGE_PROJECT_STATE_DIR = '.gfx-image-tool';
export const IMAGE_PROJECT_GITIGNORE = `${IMAGE_PROJECT_STATE_DIR}/\n`;

/** @param {string} name */
export function isImageProjectDirectoryName(name) {
  return String(name || '').toLowerCase() === IMAGE_PROJECT_DIR;
}

/** @param {string} path */
async function isDirectory(path) {
  try { return (await stat(path)).isDirectory(); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Resolve a sketch directory to its images/ project. Passing images/ itself also works.
 * @param {string} directory
 */
export async function resolveImageProjectDirectory(directory) {
  const root = resolve(directory);
  if (isImageProjectDirectoryName(basename(root))) return root;
  const nested = join(root, IMAGE_PROJECT_DIR);
  if (await isDirectory(nested)) return nested;
  throw new Error(`Image project directory not found: ${nested}. Run gfx-image-tool init ${root}, then move or copy the source images into ${nested}; images beside images/ are not scanned.`);
}

/** @param {string} path */
async function optionalText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return '';
    throw error;
  }
}

/** @param {string} root @param {ImagesConfig} config */
export async function collectImageEntries(root, config) {
  root = resolve(root);
  const outputRoot = resolve(root, config.general.outputDir);
  const previewRoot = config.preview.outputDir ? resolve(root, config.preview.outputDir) : undefined;
  const matchInput = buildGlobMatcher(config.input.patterns);
  const ignore = buildImagesIgnoreMatcher(await optionalText(join(root, '.imagesignore')));
  /** @type {ImageEntry[]} */
  const entries = [];
  /** @param {string} directory @param {string} prefix */
  async function visit(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const child of children) {
      const absolute = join(directory, child.name);
      const portable = (prefix ? `${prefix}/${child.name}` : child.name).replaceAll('\\', '/');
      if (child.isDirectory()) {
        if (child.name === IMAGE_PROJECT_STATE_DIR || resolve(absolute) === outputRoot || resolve(absolute) === previewRoot || ignore.shouldIgnore(portable, true)) continue;
        await visit(absolute, portable);
      } else if (child.isFile() && !ignore.shouldIgnore(portable, false) && matchInput(portable)) {
        entries.push({ relative: portable, absolute });
      }
    }
  }
  await visit(root, '');
  return entries;
}

/** @param {string} root @param {string} candidate */
function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** @param {string} relativePath */
function headerRelative(relativePath) {
  return relativePath.slice(0, relativePath.length - extname(relativePath).length) + '.h';
}

/** @param {string} relativePath */
function defaultSymbol(relativePath) {
  return relativePath.slice(0, relativePath.length - extname(relativePath).length).replaceAll('/', '_');
}

/** @param {'auto'|[number, number, number]} color */
function transparent565(color) {
  return color === 'auto' ? undefined : rgb565(color[0], color[1], color[2]);
}

/**
 * Build every prospective header without writing.
 * @param {string} projectDir
 * @param {{outputDir?: string, previewDir?: string, previewLayout?: 'converted'|'comparison'|'both', prefix?: string, format?: string, target?: string, mode?: 'auto'|'monochrome'|'grayscale'|'indexed'|'true-color', colors?: number, dither?: import('./config.js').Dither, threshold?: number, invert?: boolean, alphaThreshold?: number, alphaColor?: 'auto'|[number, number, number], matte?: [number, number, number], decoderCost?: number, preferBitmap?: 'horizontal'|'vertical', alignedVblit?: boolean}} [options]
 */
export async function buildImageProject(projectDir, options = {}) {
  const root = resolve(projectDir);
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${root}`);
  const config = parseImagesConfig(await optionalText(join(root, '.imagesconfig')));
  if (options.outputDir !== undefined) config.general.outputDir = options.outputDir;
  if (options.previewDir !== undefined) config.preview.outputDir = options.previewDir;
  if (options.previewLayout !== undefined) config.preview.layout = options.previewLayout;
  if (options.prefix !== undefined) config.general.prefix = options.prefix;
  if (options.target !== undefined) {
    const changedToTinyGfx = options.target === 'tinygfx' && config.general.target !== 'tinygfx';
    config.general.target = options.target;
    if (changedToTinyGfx && options.format === undefined) config.color.format = 'auto';
  }
  if (options.format !== undefined) config.color.format = options.format;
  else if (config.general.target === 'tinygfx' && config.color.format === 'rgb565be') {
    // Older configs inherited the generic target's default. TinyGFX's actual default is set optimization.
    config.color.format = 'auto';
  }
  if (options.mode !== undefined) config.color.mode = options.mode;
  if (options.colors !== undefined) config.color.colors = options.colors;
  if (options.dither !== undefined) config.color.dither = options.dither;
  if (options.threshold !== undefined) config.color.threshold = options.threshold;
  if (options.invert !== undefined) config.color.invert = options.invert;
  if (options.alphaThreshold !== undefined) config.alpha.threshold = options.alphaThreshold;
  if (options.alphaColor !== undefined) { config.alpha.mode = 'color-key'; config.alpha.color = options.alphaColor; }
  if (options.matte !== undefined) { config.alpha.mode = 'none'; config.alpha.matte = options.matte; }
  if (options.decoderCost !== undefined) config.optimize.decoderCost = options.decoderCost;
  if (options.alignedVblit !== undefined) config.optimize.alignedVblit = options.alignedVblit;
  if (options.preferBitmap !== undefined) config.optimize.preferBitmap = options.preferBitmap;
  else if (options.alignedVblit) config.optimize.preferBitmap = 'vertical';
  const outputRoot = resolve(root, config.general.outputDir);
  const bundleOutput = resolve(outputRoot, config.general.outputFile);
  if (!inside(outputRoot, bundleOutput)) throw new Error(`output_file escapes output_dir: ${config.general.outputFile}`);
  const entries = await collectImageEntries(root, config);
  /** @type {{code: string, image?: string, message: string, section?: string, key?: string, pattern?: string}[]} */
  const warnings = [...config.warnings];
  for (const override of config.overrides) {
    const matches = buildGlobMatcher([override.pattern]);
    if (!entries.some((entry) => matches(entry.relative))) warnings.push({
      code: 'UNMATCHED_IMAGE_OVERRIDE',
      pattern: override.pattern,
      message: `.imagesconfig: [image "${override.pattern}"] did not match any input image; check the path after renaming files.`,
    });
  }
  /** @type {PreparedImage[]} */
  const prepared = [];
  const symbols = new Map();
  for (const entry of entries) {
    const effective = resolveImageConfig(config, entry.relative);
    const original = await decodeImageFile(entry.absolute);
    let image = effective.alpha.sourceKey ? applyColorKey(original, effective.alpha.sourceKey) : original;
    const hasNonOpaquePixels = image.pixels.some((value, index) => index % 4 === 3 && value !== 255);
    const configuredAlphaMode = effective.alpha.mode;
    if (effective.alpha.mode === 'auto') effective.alpha.mode = effective.general.target === 'tinygfx' ? 'color-key' : 'none';
    if (effective.alpha.mode === 'none') {
      if (configuredAlphaMode === 'none' && hasNonOpaquePixels) warnings.push({
        code: 'ALPHA_COMPOSITED',
        image: entry.relative,
        message: `${entry.relative}: non-opaque pixels were composited onto matte because alpha mode is none.`,
      });
      image = transformImage(image, { alpha: { mode: 'none', matte: effective.alpha.matte } });
    }
    if (effective.color.mode === 'grayscale') image = grayscaleImage(image);
    if (effective.color.mode === 'indexed') {
      if (!['none', 'floyd-steinberg'].includes(effective.color.dither)) throw new Error(`Indexed color only supports none or floyd-steinberg dither: ${entry.relative}`);
      image = reduceImageColors(image, effective.color.colors, {
        dither: /** @type {'none'|'floyd-steinberg'} */ (effective.color.dither),
      }).image;
    }
    const symbol = sanitizeIdentifier(effective.symbol || `${config.general.prefix}${defaultSymbol(entry.relative)}`);
    const previous = symbols.get(symbol);
    if (previous) throw new Error(`C symbol collision: ${symbol} (${previous} and ${entry.relative})`);
    symbols.set(symbol, entry.relative);
    const relativeOutput = config.general.outputMode === 'bundle'
      ? config.general.outputFile
      : (effective.output || headerRelative(entry.relative)).replaceAll('\\', '/');
    const output = config.general.outputMode === 'bundle' ? bundleOutput : resolve(outputRoot, relativeOutput);
    if (!inside(outputRoot, output)) throw new Error(`Image output escapes output_dir: ${relativeOutput}`);
    prepared.push({ entry, effective, original, image, symbol, output });
  }
  const tinyInputs = prepared.filter((item) => item.effective.general.target === 'tinygfx');
  const tinyOptimization = tinyInputs.length ? optimizeTinyImageSet(tinyInputs.map((item) => ({
    key: item.entry.relative,
    image: item.image,
    monochrome: item.effective.color.mode === 'monochrome',
    threshold: item.effective.color.threshold,
    invert: item.effective.color.invert,
    dither: item.effective.color.dither,
    alphaThreshold: item.effective.alpha.mode === 'color-key' ? item.effective.alpha.threshold : undefined,
    transparentColor: transparent565(/** @type {'auto'|[number, number, number]} */ (item.effective.alpha.color)),
    allowedFormats: tinyAllowedFormats(item.effective.color.format),
  })), {
    decoderCost: config.optimize.decoderCost,
    preferBitmap: config.optimize.preferBitmap,
  }) : undefined;
  const optimization = tinyOptimization ? {
    ...tinyOptimization,
    vblit: {
      selected: config.optimize.alignedVblit ? 'aligned' : 'generic',
      alignedBytes: 244,
      genericBytes: 408,
    },
  } : undefined;
  const tinyChoices = new Map(optimization?.images.map((item) => [item.key, item]) ?? []);
  /** @type {BuiltImage[]} */
  const images = [];
  for (const item of prepared) {
    const { entry, effective, original, image, symbol, output } = item;
    const tinyChoice = tinyChoices.get(entry.relative);
    const encoded = tinyChoice?.encoded ?? encodeImage(image, effective.color.format, {
      threshold: effective.color.threshold, invert: effective.color.invert,
      dither: effective.color.dither, colors: effective.color.colors,
    });
    const emitted = emitCSource(encoded, effective.general.target, {
      name: symbol,
      storage: effective.csource.storage,
      align: effective.csource.align,
      static: effective.csource.static,
      fragment: config.general.outputMode === 'bundle',
    });
    images.push({
      input: entry.absolute,
      relative: entry.relative,
      output,
      symbol,
      target: effective.general.target,
      format: tinyChoice?.format ?? effective.color.format,
      source: emitted.source,
      original,
      prepared: image,
      encoded,
      dataBytes: encoded.stats.dataBytes,
      paletteBytes: encoded.stats.paletteBytes,
    });
  }
  const bundle = config.general.outputMode === 'bundle' && images.length ? {
    output: bundleOutput,
    source: emitCBundle(images.map((image, index) => ({
      encoded: image.encoded,
      target: prepared[index].effective.general.target,
      name: image.symbol,
      storage: prepared[index].effective.csource.storage,
      align: prepared[index].effective.csource.align,
      static: prepared[index].effective.csource.static,
      comment: image.relative,
    })), { prefix: config.general.prefix || 'images' }).source,
  } : undefined;
  let index;
  if (images.length && config.general.outputMode === 'split' && config.general.indexHeader) {
    const output = resolve(outputRoot, config.general.indexHeader);
    if (!inside(outputRoot, output)) throw new Error(`index_header escapes output_dir: ${config.general.indexHeader}`);
    const includes = images.map((image) => `#include "${relative(dirname(output), image.output).replaceAll('\\', '/')}"`);
    index = { output, source: `#pragma once\n\n${includes.join('\n')}\n` };
  }
  return { root, outputRoot, config, images, bundle, index, optimization, warnings };
}

/** @param {string} format */
function tinyAllowedFormats(format) {
  const mapped = {
    raw565: 'raw565', 'tinygfx-raw565': 'raw565', rgb565be: 'raw565',
    rle565: 'rle565', 'tinygfx-rle565': 'rle565',
    rlepal4: 'rlepal4', 'tinygfx-rlepal4': 'rlepal4',
    bitmap1h: 'bitmap1h', 'bitmap1-msb': 'bitmap1h',
    bitmap1v: 'bitmap1v', 'bitmap1-vertical': 'bitmap1v',
  };
  if (format === 'auto') return undefined;
  const candidate = mapped[/** @type {keyof typeof mapped} */ (format)];
  if (!candidate) throw new Error(`Unknown TinyGFX format: ${format}`);
  return [candidate];
}

/**
 * @param {string} projectDir
 * @param {{outputDir?: string, previewDir?: string, previewLayout?: 'converted'|'comparison'|'both', prefix?: string, format?: string, target?: string, mode?: 'auto'|'monochrome'|'grayscale'|'indexed'|'true-color', colors?: number, dither?: import('./config.js').Dither, threshold?: number, invert?: boolean, alphaThreshold?: number, alphaColor?: 'auto'|[number, number, number], matte?: [number, number, number], decoderCost?: number, preferBitmap?: 'horizontal'|'vertical', alignedVblit?: boolean, check?: boolean}} [options]
 */
export async function writeImageProject(projectDir, options = {}) {
  const built = await buildImageProject(projectDir, options);
  const outputs = built.bundle
    ? [{ path: built.bundle.output, content: built.bundle.source }]
    : [...built.images.map((image) => ({ path: image.output, content: image.source })), ...(built.index ? [{ path: built.index.output, content: built.index.source }] : [])];
  const canonicalProject = isImageProjectDirectoryName(basename(built.root));
  const manifestPath = canonicalProject ? join(built.root, IMAGE_PROJECT_STATE_DIR, 'headers.json') : undefined;
  const metadata = headerGenerationSettings(built.config);
  const generation = await planGeneratedOutputs(
    built.outputRoot,
    HEADER_MANIFEST,
    'headers',
    outputs.map((output) => output.path),
    { ...(manifestPath ? { manifestPath } : {}), metadata },
  );
  const settingChanges = compareGenerationSettings(generation.previousMetadata, metadata);
  /** @type {{path: string, status: 'written'|'upToDate'|'mismatch'|'missingOutput'}[]} */
  const results = [];
  for (const output of outputs) {
    let previous;
    try { previous = await readFile(output.path, 'utf8'); }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    if (options.check) {
      results.push({ path: output.path, status: previous === undefined ? 'missingOutput' : previous === output.content ? 'upToDate' : 'mismatch' });
      continue;
    }
    await mkdir(dirname(output.path), { recursive: true });
    const temporary = `${output.path}.tmp-${process.pid}`;
    await writeFile(temporary, output.content, 'utf8');
    await rename(temporary, output.path);
    results.push({ path: output.path, status: 'written' });
  }
  let previousManifest;
  try { previousManifest = await readFile(generation.manifestPath, 'utf8'); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  /** @type {{path: string, status: 'written'|'upToDate'|'mismatch'|'missingOutput', hadManifest: boolean}} */
  let manifest;
  /** @type {{path: string, status: 'removed'|'stale'}[]} */
  const stale = [];
  if (options.check) {
    manifest = {
      path: generation.manifestPath,
      status: previousManifest === undefined ? 'missingOutput' : previousManifest === generation.source ? 'upToDate' : 'mismatch',
      hadManifest: generation.hadManifest,
    };
    stale.push(...generation.stale.map((path) => ({ path, status: /** @type {const} */ ('stale') })));
  } else {
    for (const path of generation.stale) {
      await unlink(path);
      stale.push({ path, status: 'removed' });
    }
    await mkdir(dirname(generation.manifestPath), { recursive: true });
    const temporary = `${generation.manifestPath}.tmp-${process.pid}`;
    await writeFile(temporary, generation.source, 'utf8');
    await rename(temporary, generation.manifestPath);
    manifest = { path: generation.manifestPath, status: 'written', hadManifest: generation.hadManifest };
  }
  return { ...built, results, manifest, stale, settingChanges };
}

/** @param {ImagesConfig} config */
function headerGenerationSettings(config) {
  return {
    target: config.general.target,
    outputMode: config.general.outputMode,
    outputFile: config.general.outputFile,
    prefix: config.general.prefix,
    indexHeader: config.general.indexHeader,
    patterns: config.input.patterns,
    color: config.color,
    alpha: config.alpha,
    csource: config.csource,
    optimize: config.optimize,
    overrides: config.overrides,
  };
}

/** @param {Record<string, unknown>|undefined} previous @param {Record<string, unknown>} current */
function compareGenerationSettings(previous, current) {
  if (!previous) return [];
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])].flatMap((key) => {
    const before = previous[key];
    const after = current[key];
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ key, before, after }];
  });
}

/** @param {string} projectDir */
export async function createImagesConfig(projectDir) {
  const requested = resolve(projectDir);
  const root = isImageProjectDirectoryName(basename(requested)) ? requested : join(requested, IMAGE_PROJECT_DIR);
  await mkdir(root, { recursive: true });
  const path = join(root, '.imagesconfig');
  let status;
  try {
    await writeFile(path, IMAGES_CONFIG_TEMPLATE, { encoding: 'utf8', flag: 'wx' });
    status = /** @type {const} */ ('created');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') status = /** @type {const} */ ('exists');
    else throw error;
  }
  try { await writeFile(join(root, '.gitignore'), IMAGE_PROJECT_GITIGNORE, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error; }
  return { path, status };
}
