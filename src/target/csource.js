// @ts-check
import { EncodeConstraintError, UnsupportedFormatError } from '../util/errors.js';
import { listTargets, targetSupports, targetUsage } from './presets.js';

const RESERVED = new Set([
  'alignas', 'alignof', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const',
  'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export',
  'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'namespace',
  'new', 'nullptr', 'operator', 'private', 'protected', 'public', 'register', 'return', 'short',
  'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try',
  'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while',
]);

/** @param {string} value */
export function sanitizeIdentifier(value) {
  let id = String(value || 'image').replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = `_${id}`;
  id = id.replace(/_+/g, '_');
  if (RESERVED.has(id)) id = `${id}_image`;
  return id || 'image';
}

/** @param {Uint8Array} data @param {number} [perLine] */
function byteArray(data, perLine = 16) {
  const lines = [];
  for (let i = 0; i < data.length; i += perLine) {
    lines.push(`  ${Array.from(data.subarray(i, i + perLine), (byte) => `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`).join(', ')}`);
  }
  return lines.join(',\n');
}

/** @param {number[]} data @param {number} [perLine] */
function wordArray(data, perLine = 8) {
  const lines = [];
  for (let i = 0; i < data.length; i += perLine) {
    lines.push(`  ${data.slice(i, i + perLine).map((word) => `0x${word.toString(16).toUpperCase().padStart(4, '0')}`).join(', ')}`);
  }
  return lines.join(',\n');
}

/** @param {Uint8Array} palette */
function palette565(palette) {
  const out = [];
  for (let i = 0; i < palette.length; i += 3) {
    out.push(((palette[i] & 0xf8) << 8) | ((palette[i + 1] & 0xfc) << 3) | (palette[i + 2] >> 3));
  }
  return out;
}

/** @param {import('../format/registry.js').EncodedImage} encoded @param {string} name @param {number} align @param {string} linkage */
function emitTinyGfx(encoded, name, align, linkage) {
  if (encoded.width > 0xffff || encoded.height > 0xffff || encoded.data.length > 0xffff) {
    throw new EncodeConstraintError('TINYGFX_FIELD_OVERFLOW', 'TinyGFX width, height, and data length must fit uint16_t.');
  }
  const ops = {
    'tinygfx-raw565': 'Raw565',
    'tinygfx-rle565': 'Rle565',
    'tinygfx-rlepal4': 'Rlepal4',
    'bitmap1-msb': 'Bitmap1h',
    'bitmap1-vertical': 'Bitmap1v',
  }[/** @type {'tinygfx-raw565'|'tinygfx-rle565'|'tinygfx-rlepal4'|'bitmap1-msb'|'bitmap1-vertical'} */ (encoded.format)];
  if (!ops) throw new EncodeConstraintError('TARGET_FORMAT_MISMATCH', `tinygfx does not accept ${encoded.format}.`);
  let palette = encoded.palette instanceof Uint16Array ? encoded.palette : undefined;
  if ((encoded.format === 'bitmap1-msb' || encoded.format === 'bitmap1-vertical') && !palette) palette = Uint16Array.from([0x0000, 0xffff]);
  const paletteName = palette ? `${name}Palette` : 'NULL';
  const lines = [
    '#pragma once',
    '#include <stdint.h>',
    '',
    '#if !defined(TINYGFX_IMAGE_SPEC_VERSION)',
    '#error "Include <TinyGFX/Image.h> before this generated image header"',
    '#endif',
    '',
    `// tinygfx: ${encoded.format}, ${encoded.width}x${encoded.height}, ${encoded.data.length} data bytes`,
    `alignas(${align}) ${linkage}const uint8_t ${name}Data[${encoded.data.length}] TINYGFX_IMAGE_PROGMEM = {`,
    byteArray(encoded.data),
    '};',
  ];
  if (palette) lines.push(
    '',
    `alignas(${align}) ${linkage}const uint16_t ${paletteName}[${palette.length}] TINYGFX_IMAGE_PROGMEM = {`,
    wordArray(Array.from(palette)),
    '};',
  );
  lines.push(
    '',
    `${linkage}const CellImage ${name} TINYGFX_IMAGE_PROGMEM = {`,
    `  ${name}Data,`,
    `  ${paletteName},`,
    `  ${encoded.width}, ${encoded.height},`,
    `  ${encoded.data.length},`,
    `  0x${(encoded.transparent?.value ?? 0).toString(16).toUpperCase().padStart(4, '0')},`,
    `  ${palette?.length ?? 0},`,
    `  ${encoded.transparent ? 1 : 0},`,
    '};',
    '',
    `${linkage}const TinyGFXImageRef ${name}Ref = {&${name}, &tinygfxImage${ops}Ops};`,
    '',
  );
  return { source: lines.join('\n'), usage: `lcd.drawImage(&${name}Ref, x, y);`, issues: [] };
}

/**
 * @param {import('../format/registry.js').EncodedImage} encoded
 * @param {string} [target]
 * @param {{name?: string, storage?: string, align?: number, static?: boolean}} [options]
 */
export function emitCSource(encoded, target = 'generic-c', options = {}) {
  if (!listTargets().includes(target)) throw new UnsupportedFormatError('UNSUPPORTED_TARGET', `Unsupported target: ${target}`, { target });
  if (!targetSupports(target, encoded.format)) {
    throw new EncodeConstraintError('TARGET_FORMAT_MISMATCH', `${target} does not accept ${encoded.format}.`, { target, format: encoded.format });
  }
  if (!(encoded?.data instanceof Uint8Array)) throw new EncodeConstraintError('INVALID_ENCODED_IMAGE', 'Encoded image data must be Uint8Array.');
  const name = sanitizeIdentifier(options.name ?? 'image');
  const align = options.align ?? 4;
  if (!Number.isInteger(align) || align < 1) throw new EncodeConstraintError('INVALID_ALIGNMENT', 'Alignment must be a positive integer.');
  const storage = String(options.storage ?? 'PROGMEM').trim();
  const linkage = options.static === false ? '' : 'static ';
  const suffix = storage ? ` ${storage}` : '';
  if (target === 'tinygfx') return emitTinyGfx(encoded, name, align, linkage);
  const nativeWordPalette = encoded.palette instanceof Uint16Array;
  const wordPalette = nativeWordPalette || (target !== 'generic-c' && !!encoded.palette);
  const paletteCount = encoded.palette ? (nativeWordPalette ? encoded.palette.length : encoded.palette.length / 3) : 0;
  const source = [
    '#pragma once',
    '#include <stdint.h>',
    '',
    `// ${target}: ${encoded.format}, ${encoded.width}x${encoded.height}, ${encoded.data.length} data bytes`,
    `// Usage: ${targetUsage(target, encoded.format, name, encoded.width, encoded.height)}`,
    `alignas(${align}) ${linkage}const uint8_t ${name}_data[${encoded.data.length}]${suffix} = {`,
    byteArray(encoded.data),
    '};',
    ...(encoded.palette ? [
      '',
      `// ${wordPalette ? 'RGB565' : 'RGB888'} palette, ${paletteCount} entries`,
      `alignas(${align}) ${linkage}const ${wordPalette ? 'uint16_t' : 'uint8_t'} ${name}_palette[${wordPalette ? paletteCount : encoded.palette.length}]${suffix} = {`,
      wordPalette
        ? wordArray(nativeWordPalette ? Array.from(encoded.palette) : palette565(/** @type {Uint8Array} */ (encoded.palette)))
        : byteArray(/** @type {Uint8Array} */ (encoded.palette)),
      '};',
    ] : []),
    '',
    `${linkage}const uint16_t ${name}_width = ${encoded.width};`,
    `${linkage}const uint16_t ${name}_height = ${encoded.height};`,
    `${linkage}const uint16_t ${name}_stride = ${encoded.stride};`,
    `${linkage}const uint32_t ${name}_length = ${encoded.data.length};`,
    ...(encoded.palette ? [`${linkage}const uint16_t ${name}_palette_count = ${paletteCount};`] : []),
    '',
  ].join('\n');
  return { source, usage: targetUsage(target, encoded.format, name, encoded.width, encoded.height), issues: [] };
}
