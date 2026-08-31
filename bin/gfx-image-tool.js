#!/usr/bin/env node
// @ts-check
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildImageProject, createImagesConfig, decodeImageFile, encodePreviewPng, writeImageProject } from '../src/node/index.js';
import { decodeEncodedImage, emitCSource, encodeImage, grayscaleImage, inspectImage, listFormats, listTargets, optimizeTinyImage, reduceImageColors, rgb565, transformImage } from '../src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

const USAGE = `gfx-image-tool — convert images into embedded C/C++ assets

  gfx-image-tool build <path> [options]     generate .h file(s)
  gfx-image-tool inspect <path> [options]   show image or project information
  gfx-image-tool init [directory]           create a documented .imagesconfig
  gfx-image-tool --version                  print the installed version

options
  --out <path>          output header for a file, output directory for a project
  --preview <path>      converted PNG for a file, preview directory for a project
  --preview-layout <id> converted (default) or comparison (source | converted)
  --target <id>         ${listTargets().join(', ')}
  --format <id>         ${listFormats().join(', ')}
  --mode <mode>         auto, monochrome, grayscale, indexed, true-color
  --name <identifier>   C symbol name (default: input stem)
  --prefix <identifier> project symbol prefix
  --threshold <0..255>  1bpp threshold (default: 128)
  --dither <mode>       none, floyd-steinberg, bayer2, bayer4, bayer8
  --colors <2..256>     indexed8 palette size (default: 256)
  --decoder-cost <N>    TinyGFX decoder cost (default: 400)
  --prefer-bitmap <h|v> TinyGFX 1bpp tie-break
  --aligned-vblit      prefer vertical 1bpp and report TinyGFX fast-path cost
  --monochrome          allow TinyGFX 1bpp conversion after thresholding
  --alpha-threshold <n> mask threshold (default: 128)
  --transparent-color <RRGGBB|auto> TinyGFX color key (default: auto)
  --invert              invert 1bpp output
  --matte <RRGGBB>      composite alpha onto a color before encoding
  --check               do not write; exit 2 if output is absent or different
  --json                machine-readable output
  -h, --help            show this help
`;

class CliError extends Error {
  /** @param {string} message @param {number} [exitCode] */
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

const OPTIONS = /** @type {const} */ ({
  out: { type: 'string' },
  preview: { type: 'string' },
  'preview-layout': { type: 'string' },
  target: { type: 'string' },
  format: { type: 'string' },
  mode: { type: 'string' },
  name: { type: 'string' },
  prefix: { type: 'string' },
  threshold: { type: 'string' },
  dither: { type: 'string' },
  colors: { type: 'string' },
  'decoder-cost': { type: 'string' },
  'prefer-bitmap': { type: 'string' },
  'aligned-vblit': { type: 'boolean' },
  monochrome: { type: 'boolean' },
  'alpha-threshold': { type: 'string' },
  'transparent-color': { type: 'string' },
  invert: { type: 'boolean' },
  matte: { type: 'string' },
  check: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
});

/** @param {string | undefined} value @param {string} option @param {number} fallback */
function optionByte(value, option, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) throw new CliError(`${option} must be an integer from 0 to 255.`, 3);
  return parsed;
}

/** @param {string | undefined} value */
function parseMatte(value) {
  if (value === undefined) return undefined;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) throw new CliError('--matte must be RRGGBB.', 3);
  return [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
}

/** @param {string | undefined} value @returns {'auto'|[number, number, number]|undefined} */
function parseTransparentColor(value) {
  if (value === undefined) return undefined;
  if (value === 'auto') return 'auto';
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) throw new CliError('--transparent-color must be RRGGBB or auto.', 3);
  return /** @type {[number, number, number]} */ ([0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16)));
}

/** @param {string} path */
function stem(path) {
  const base = basename(path);
  return base.slice(0, base.length - extname(base).length) || 'image';
}

/** @param {string} command @param {string[]} argv */
async function run(command, argv) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }); }
  catch (error) { throw new CliError(/** @type {Error} */ (error).message, 3); }
  if (parsed.values.help) { process.stdout.write(USAGE); return; }
  if (parsed.positionals.length > 1) throw new CliError(`${command} accepts one path.`, 3);
  const input = resolve(parsed.positionals[0] ?? '.');
  if (command === 'init') {
    if (parsed.values.format || parsed.values.name || parsed.values.prefix || parsed.values.check || parsed.values.preview || parsed.values['preview-layout']) throw new CliError('init accepts only --json and --help.', 3);
    const result = await createImagesConfig(input);
    if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else console.error(`${result.path}  ${result.status === 'created' ? 'created' : 'already exists (unchanged)'}`);
    return;
  }
  const info = await stat(input);
  const threshold = optionByte(parsed.values.threshold, '--threshold', 128);
  const alphaThresholdOption = parsed.values['alpha-threshold'] === undefined
    ? undefined
    : optionByte(parsed.values['alpha-threshold'], '--alpha-threshold', 128);
  const alphaThreshold = alphaThresholdOption ?? 128;
  const colors = parsed.values.colors === undefined ? 256 : Number(parsed.values.colors);
  if (!Number.isInteger(colors) || colors < 2 || colors > 256) throw new CliError('--colors must be an integer from 2 to 256.', 3);
  const decoderCostOption = parsed.values['decoder-cost'] === undefined ? undefined : Number(parsed.values['decoder-cost']);
  if (decoderCostOption !== undefined && (!Number.isFinite(decoderCostOption) || decoderCostOption < 0)) throw new CliError('--decoder-cost must be non-negative.', 3);
  const preferValue = parsed.values['prefer-bitmap'];
  if (preferValue !== undefined && preferValue !== 'h' && preferValue !== 'v') throw new CliError('--prefer-bitmap must be h or v.', 3);
  const preferBitmapOption = preferValue === undefined
    ? (parsed.values['aligned-vblit'] ? /** @type {const} */ ('vertical') : undefined)
    : /** @type {'horizontal'|'vertical'} */ (preferValue === 'v' ? 'vertical' : 'horizontal');
  const dither = parsed.values.dither ?? 'none';
  if (!['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8'].includes(dither)) {
    throw new CliError(`unknown dither: ${dither}`, 3);
  }
  const modeOption = parsed.values.mode ?? (parsed.values.monochrome ? 'monochrome' : undefined);
  const mode = modeOption ?? 'auto';
  if (!['auto', 'monochrome', 'grayscale', 'indexed', 'true-color'].includes(mode)) throw new CliError(`unknown mode: ${mode}`, 3);
  const matte = parseMatte(parsed.values.matte);
  const transparentColor = parseTransparentColor(parsed.values['transparent-color']);
  if (matte && transparentColor !== undefined) throw new CliError('--matte and --transparent-color cannot be used together.', 3);
  const previewLayout = parsed.values['preview-layout'] ?? 'converted';
  if (previewLayout !== 'converted' && previewLayout !== 'comparison') throw new CliError('--preview-layout must be converted or comparison.', 3);
  if (info.isDirectory()) {
    const projectOptions = {
      outputDir: parsed.values.out === undefined ? undefined : resolve(parsed.values.out),
      previewDir: parsed.values.preview === undefined ? undefined : resolve(parsed.values.preview),
      previewLayout: parsed.values['preview-layout'] === undefined ? undefined : /** @type {'converted'|'comparison'} */ (previewLayout),
      prefix: parsed.values.prefix,
      format: parsed.values.format,
      target: parsed.values.target,
      mode: /** @type {'auto'|'monochrome'|'grayscale'|'indexed'|'true-color'|undefined} */ (modeOption),
      colors: parsed.values.colors === undefined ? undefined : colors,
      dither: parsed.values.dither === undefined ? undefined : /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
      threshold: parsed.values.threshold === undefined ? undefined : threshold,
      invert: parsed.values.invert || undefined,
      alphaThreshold: alphaThresholdOption,
      alphaColor: transparentColor,
      matte: /** @type {[number, number, number] | undefined} */ (matte),
      decoderCost: decoderCostOption,
      preferBitmap: preferBitmapOption,
      alignedVblit: parsed.values['aligned-vblit'] || undefined,
      check: !!parsed.values.check,
    };
    if (command === 'inspect') {
      if (parsed.values.preview !== undefined || parsed.values['preview-layout'] !== undefined) throw new CliError('--preview and --preview-layout are only available with build.', 3);
      const built = await buildImageProject(input, projectOptions);
      const result = {
        root: built.root,
        outputRoot: built.outputRoot,
        count: built.images.length,
        config: built.config,
        warnings: built.warnings,
        images: built.images.map((image) => ({
          input: image.relative,
          output: relative(built.root, image.output).replaceAll('\\', '/'),
          symbol: image.symbol,
          format: image.format,
          dataBytes: image.dataBytes,
          paletteBytes: image.paletteBytes,
        })),
        optimization: built.optimization ? {
          formats: built.optimization.formats,
          dataBytes: built.optimization.dataBytes,
          decoderBytes: built.optimization.decoderBytes,
          totalBytes: built.optimization.totalBytes,
          images: built.optimization.report,
          vblit: built.optimization.vblit,
        } : undefined,
      };
      if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        for (const warning of built.warnings) console.error(`warning: ${warning.message}`);
        console.log(`${result.root}  ${result.count} images  -> ${result.outputRoot}`);
        for (const image of result.images) console.log(`  ${image.input.padEnd(28)} ${image.format.padEnd(16)} ${image.dataBytes + image.paletteBytes} B`);
        if (result.optimization) {
          console.log(`  decoders: ${result.optimization.formats.join(', ')}; data ${result.optimization.dataBytes} B + decoder ${result.optimization.decoderBytes} B = ${result.optimization.totalBytes} B`);
          for (const image of result.optimization.images) {
            const choices = image.candidates.map((candidate) => `${candidate.format}:${candidate.bytes}`).join(', ');
            console.log(`  optimize ${image.key}: ${choices} -> ${image.selected.format} (${image.dataDelta >= 0 ? '+' : ''}${image.dataDelta} B vs individual)`);
          }
        }
      }
      return;
    }
    if (command !== 'build') throw new CliError(`unknown command: ${command}`, 3);
    const built = await writeImageProject(input, projectOptions);
    if (!built.images.length) throw new CliError(`no matching images in ${input}`, 1);
    const previewDirectory = built.config.preview.outputDir ? resolve(built.root, built.config.preview.outputDir) : undefined;
    if (parsed.values['preview-layout'] !== undefined && !previewDirectory) throw new CliError('--preview-layout requires --preview or [preview] output_dir.', 3);
    const previews = previewDirectory ? await writeProjectPreviews(
      built,
      previewDirectory,
      built.config.preview.layout,
      !!parsed.values.check,
    ) : [];
    const result = {
      root: built.root,
      outputRoot: built.outputRoot,
      count: built.images.length,
      warnings: built.warnings,
      optimization: built.optimization ? {
        formats: built.optimization.formats,
        dataBytes: built.optimization.dataBytes,
        decoderBytes: built.optimization.decoderBytes,
        totalBytes: built.optimization.totalBytes,
        images: built.optimization.report,
        vblit: built.optimization.vblit,
      } : undefined,
      results: built.results.map((item) => ({ ...item, path: relative(built.root, item.path).replaceAll('\\', '/') })),
      previews: previews.map((item) => ({ ...item, path: relative(built.root, item.path).replaceAll('\\', '/') })),
    };
    if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const warning of built.warnings) console.error(`warning: ${warning.message}`);
      for (const item of result.results) console.error(`${item.path}  ${item.status}`);
      for (const item of result.previews) console.error(`${item.path}  ${item.status}  preview`);
    }
    if ([...built.results, ...previews].some((item) => item.status === 'mismatch' || item.status === 'missingOutput')) {
      throw new CliError('--check: generated output differs or does not exist', 2);
    }
    return;
  }
  if (!info.isFile()) throw new CliError(`not a file or directory: ${input}`, 1);
  if (parsed.values['preview-layout'] !== undefined && parsed.values.preview === undefined) throw new CliError('--preview-layout requires --preview.', 3);
  const original = await decodeImageFile(input);
  let image = original;
  if (matte) image = transformImage(image, { alpha: { mode: 'none', matte } });
  if (mode === 'grayscale') image = grayscaleImage(image);
  if (mode === 'indexed') {
    if (dither !== 'none' && dither !== 'floyd-steinberg') throw new CliError('indexed mode only supports none or floyd-steinberg dither.', 3);
    image = reduceImageColors(image, colors, { dither }).image;
  }
  const target = parsed.values.target ?? 'generic-c';
  if (command === 'inspect') {
    if (parsed.values.preview !== undefined) throw new CliError('--preview is only available with build.', 3);
    const inspected = inspectImage(image, {
      threshold,
      alphaThreshold,
      invert: !!parsed.values.invert,
      dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
      colors,
    });
    const tinyFormat = parsed.values.format ?? 'auto';
    const tiny = target === 'tinygfx' ? optimizeTinyImage(image, {
      decoderCost: decoderCostOption ?? 400,
      preferBitmap: preferBitmapOption ?? 'horizontal',
      monochrome: mode === 'monochrome',
      threshold,
      invert: !!parsed.values.invert,
      dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
      alphaThreshold: matte ? undefined : alphaThreshold,
      transparentColor: Array.isArray(transparentColor) ? rgb565(...transparentColor) : undefined,
      allowedFormats: tinyCliFormats(tinyFormat),
    }) : undefined;
    const result = {
      ...inspected,
      target,
      optimization: tiny ? {
        format: tiny.format,
        dataBytes: tiny.bytes,
        decoderBytes: tiny.decoderBytes,
        totalBytes: tiny.totalBytes,
        image: tiny.report[0],
        vblit: {
          selected: parsed.values['aligned-vblit'] ? 'aligned' : 'generic',
          alignedBytes: 244,
          genericBytes: 408,
        },
      } : undefined,
    };
    if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(`${input}  ${result.width}x${result.height}  ${result.colors} colors`);
      for (const candidate of result.candidates) console.log(`  ${candidate.format.padEnd(20)} ${String(candidate.bytes).padStart(8)} B`);
      if (result.optimization) {
        console.log(`  TinyGFX: ${result.optimization.image.candidates.map((candidate) => `${candidate.format}:${candidate.bytes}`).join(', ')}`);
        console.log(`  selected ${result.optimization.format}: data ${result.optimization.dataBytes} B + decoder ${result.optimization.decoderBytes} B = ${result.optimization.totalBytes} B`);
      }
    }
    return;
  }
  if (command !== 'build') throw new CliError(`unknown command: ${command}`, 3);
  const format = parsed.values.format ?? (target === 'tinygfx' ? 'auto' : 'rgb565be');
  if (target !== 'tinygfx' && !listFormats().includes(format)) throw new CliError(`unknown format: ${format}`, 3);
  const name = parsed.values.name ?? stem(input);
  const tiny = target === 'tinygfx' ? optimizeTinyImage(image, {
    decoderCost: decoderCostOption ?? 400,
    preferBitmap: preferBitmapOption ?? 'horizontal',
    monochrome: mode === 'monochrome',
    threshold,
    invert: !!parsed.values.invert,
    dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
    alphaThreshold: matte ? undefined : alphaThreshold,
    transparentColor: Array.isArray(transparentColor) ? rgb565(...transparentColor) : undefined,
    allowedFormats: tinyCliFormats(format),
  }) : undefined;
  const encoded = tiny?.encoded ?? encodeImage(image, format, {
    threshold, alphaThreshold, invert: !!parsed.values.invert,
    dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither), colors,
  });
  const emitted = emitCSource(encoded, target, { name });
  const output = resolve(parsed.values.out ?? resolve(dirname(input), `${stem(input)}.h`));
  let status = 'written';
  if (parsed.values.check) {
    let previous;
    try { previous = await readFile(output, 'utf8'); } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    status = previous === undefined ? 'missingOutput' : previous === emitted.source ? 'upToDate' : 'mismatch';
  } else await writeFile(output, emitted.source, 'utf8');
  let preview;
  if (parsed.values.preview) {
    const previewPath = resolve(parsed.values.preview);
    const converted = decodeEncodedImage(encoded, { target });
    const bytes = await encodePreviewPng(original, converted, /** @type {'converted'|'comparison'} */ (previewLayout));
    preview = await writeBinaryOutput(previewPath, bytes, !!parsed.values.check);
  }
  const result = {
    input, output, name, target, format: tiny?.format ?? format, width: image.width, height: image.height,
    bytes: encoded.data.length + encoded.stats.paletteBytes, decoderBytes: tiny?.decoderBytes, totalBytes: tiny?.totalBytes,
    vblit: tiny ? {
      selected: parsed.values['aligned-vblit'] ? 'aligned' : 'generic',
      alignedBytes: 244,
      genericBytes: 408,
    } : undefined,
    status,
    ...(preview ? { preview } : {}),
  };
  if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.error(`${output}  ${status}  ${tiny?.format ?? format}  ${encoded.data.length} B  (${image.width}x${image.height})`);
    if (preview) console.error(`${preview.path}  ${preview.status}  preview`);
  }
  if (status === 'missingOutput' || status === 'mismatch' || preview?.status === 'missingOutput' || preview?.status === 'mismatch') throw new CliError('--check: generated output differs or does not exist', 2);
}

/** @param {string} path @param {Uint8Array} bytes @param {boolean} check */
async function writeBinaryOutput(path, bytes, check) {
  let previous;
  try { previous = await readFile(path); } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
  const same = previous !== undefined && Buffer.from(previous).equals(Buffer.from(bytes));
  const status = previous === undefined ? 'missingOutput' : same ? 'upToDate' : 'mismatch';
  if (!check) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { path, status: /** @type {const} */ ('written') };
  }
  return { path, status: /** @type {'upToDate'|'mismatch'|'missingOutput'} */ (status) };
}

/**
 * @param {Awaited<ReturnType<typeof writeImageProject>>} built
 * @param {string} directory
 * @param {'converted'|'comparison'} layout
 * @param {boolean} check
 */
async function writeProjectPreviews(built, directory, layout, check) {
  const outputs = [];
  for (const item of built.images) {
    const converted = decodeEncodedImage(item.encoded, { target: item.target });
    const bytes = await encodePreviewPng(item.original, converted, layout);
    const relativePng = item.relative.slice(0, item.relative.length - extname(item.relative).length) + '.png';
    outputs.push(await writeBinaryOutput(resolve(directory, relativePng), bytes, check));
  }
  return outputs;
}

/** @param {string} format */
function tinyCliFormats(format) {
  if (format === 'auto') return undefined;
  const map = {
    raw565: 'raw565', 'tinygfx-raw565': 'raw565', rgb565be: 'raw565',
    rle565: 'rle565', 'tinygfx-rle565': 'rle565',
    rlepal4: 'rlepal4', 'tinygfx-rlepal4': 'rlepal4',
    bitmap1h: 'bitmap1h', 'bitmap1-msb': 'bitmap1h',
    bitmap1v: 'bitmap1v', 'bitmap1-vertical': 'bitmap1v',
  };
  const candidate = map[/** @type {keyof typeof map} */ (format)];
  if (!candidate) throw new CliError(`unknown TinyGFX format: ${format}`, 3);
  return [candidate];
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') { process.stdout.write(USAGE); return; }
  if (command === '--version' || command === '-v' || command === 'version') { process.stdout.write(`${VERSION}\n`); return; }
  await run(command, argv.slice(1));
}

main().catch((error) => {
  const code = error instanceof CliError ? error.exitCode : 1;
  console.error(`gfx-image-tool: ${error.message}`);
  process.exit(code);
});
