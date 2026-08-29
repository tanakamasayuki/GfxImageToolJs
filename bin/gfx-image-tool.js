#!/usr/bin/env node
// @ts-check
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodeImageFile } from '../src/node/index.js';
import { emitCSource, encodeImage, inspectImage, listFormats, transformImage } from '../src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

const USAGE = `gfx-image-tool — convert images into embedded C/C++ assets

  gfx-image-tool build <image> [options]    generate one .h file
  gfx-image-tool inspect <image> [options]  show image and candidate sizes
  gfx-image-tool --version                  print the installed version

options
  --out <path>          output header (build; default: <image>.h)
  --format <id>         ${listFormats().join(', ')}
  --name <identifier>   C symbol name (default: input stem)
  --threshold <0..255>  1bpp threshold (default: 128)
  --dither <mode>       none, floyd-steinberg, bayer2, bayer4, bayer8
  --alpha-threshold <n> mask threshold (default: 128)
  --invert              invert 1bpp output
  --matte <RRGGBB>      composite alpha onto a color before encoding
  --json                machine-readable output
  -h, --help            show this help
`;

class CliError extends Error {
  /** @param {string} message @param {number} [exitCode] */
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

const OPTIONS = /** @type {const} */ ({
  out: { type: 'string' },
  format: { type: 'string' },
  name: { type: 'string' },
  threshold: { type: 'string' },
  dither: { type: 'string' },
  'alpha-threshold': { type: 'string' },
  invert: { type: 'boolean' },
  matte: { type: 'string' },
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
  if (parsed.positionals.length !== 1) throw new CliError(`${command} requires exactly one image path.`, 3);
  const input = resolve(parsed.positionals[0]);
  const threshold = optionByte(parsed.values.threshold, '--threshold', 128);
  const alphaThreshold = optionByte(parsed.values['alpha-threshold'], '--alpha-threshold', 128);
  const dither = parsed.values.dither ?? 'none';
  if (!['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8'].includes(dither)) {
    throw new CliError(`unknown dither: ${dither}`, 3);
  }
  const matte = parseMatte(parsed.values.matte);
  let image = await decodeImageFile(input);
  if (matte) image = transformImage(image, { alpha: { mode: 'none', matte } });
  if (command === 'inspect') {
    const result = inspectImage(image, {
      threshold,
      alphaThreshold,
      invert: !!parsed.values.invert,
      dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
    });
    if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      console.log(`${input}  ${result.width}x${result.height}  ${result.colors} colors`);
      for (const candidate of result.candidates) console.log(`  ${candidate.format.padEnd(20)} ${String(candidate.bytes).padStart(8)} B`);
    }
    return;
  }
  if (command !== 'build') throw new CliError(`unknown command: ${command}`, 3);
  const format = parsed.values.format ?? 'rgb565be';
  if (!listFormats().includes(format)) throw new CliError(`unknown format: ${format}`, 3);
  const name = parsed.values.name ?? stem(input);
  const encoded = encodeImage(image, format, {
    threshold,
    alphaThreshold,
    invert: !!parsed.values.invert,
    dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (dither),
  });
  const emitted = emitCSource(encoded, 'generic-c', { name });
  const output = resolve(parsed.values.out ?? resolve(dirname(input), `${stem(input)}.h`));
  await writeFile(output, emitted.source, 'utf8');
  const result = { input, output, name, format, width: image.width, height: image.height, bytes: encoded.data.length };
  if (parsed.values.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else console.error(`${output}  ${format}  ${encoded.data.length} B  (${image.width}x${image.height})`);
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
