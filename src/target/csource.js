// @ts-check
import { EncodeConstraintError, UnsupportedFormatError } from '../util/errors.js';

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

/**
 * @param {import('../format/registry.js').EncodedImage} encoded
 * @param {'generic-c'} [target]
 * @param {{name?: string, storage?: string, align?: number, static?: boolean}} [options]
 */
export function emitCSource(encoded, target = 'generic-c', options = {}) {
  if (target !== 'generic-c') throw new UnsupportedFormatError('UNSUPPORTED_TARGET', `Unsupported target: ${target}`, { target });
  if (!(encoded?.data instanceof Uint8Array)) throw new EncodeConstraintError('INVALID_ENCODED_IMAGE', 'Encoded image data must be Uint8Array.');
  const name = sanitizeIdentifier(options.name ?? 'image');
  const align = options.align ?? 4;
  if (!Number.isInteger(align) || align < 1) throw new EncodeConstraintError('INVALID_ALIGNMENT', 'Alignment must be a positive integer.');
  const storage = String(options.storage ?? 'PROGMEM').trim();
  const linkage = options.static === false ? '' : 'static ';
  const suffix = storage ? ` ${storage}` : '';
  const source = [
    '#pragma once',
    '#include <stdint.h>',
    '',
    `// ${encoded.format}, ${encoded.width}x${encoded.height}, ${encoded.data.length} bytes`,
    `alignas(${align}) ${linkage}const uint8_t ${name}_data[${encoded.data.length}]${suffix} = {`,
    byteArray(encoded.data),
    '};',
    '',
    `${linkage}const uint16_t ${name}_width = ${encoded.width};`,
    `${linkage}const uint16_t ${name}_height = ${encoded.height};`,
    `${linkage}const uint16_t ${name}_stride = ${encoded.stride};`,
    `${linkage}const uint32_t ${name}_length = ${encoded.data.length};`,
    '',
  ].join('\n');
  return { source, usage: `${name}_data`, issues: [] };
}
