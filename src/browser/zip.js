// @ts-check

const encoder = new TextEncoder();

/** @type {Uint32Array | undefined} */
let crcTable;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    crcTable[value] = crc >>> 0;
  }
  return crcTable;
}

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
  let crc = 0xffffffff;
  const values = table();
  for (const byte of bytes) crc = values[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {DataView} view @param {number} at @param {number} value */
function u16(view, at, value) { view.setUint16(at, value, true); }
/** @param {DataView} view @param {number} at @param {number} value */
function u32(view, at, value) { view.setUint32(at, value >>> 0, true); }

/** @param {(Uint8Array|string)[]} chunks */
function concat(chunks) {
  const arrays = chunks.map((chunk) => typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
  const result = new Uint8Array(arrays.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of arrays) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/**
 * Creates a deterministic, uncompressed ZIP. Store mode is intentional: generated headers and
 * PNG previews are already compact, and avoiding a compression dependency keeps the web app static.
 * @param {{name: string, data: Uint8Array|string}[]} entries
 */
export function createStoredZip(entries) {
  const seen = new Set();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = entry.name.replaceAll('\\', '/').replace(/^\/+/, '');
    if (!name || name.includes('../') || name === '..') throw new RangeError(`Unsafe ZIP entry: ${entry.name}`);
    if (seen.has(name)) throw new RangeError(`Duplicate ZIP entry: ${name}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : Uint8Array.from(entry.data);
    const checksum = crc32(data);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u16(localView, 6, 0x0800);
    u16(localView, 8, 0); u16(localView, 10, 0); u16(localView, 12, 0);
    u32(localView, 14, checksum); u32(localView, 18, data.length); u32(localView, 22, data.length);
    u16(localView, 26, nameBytes.length); u16(localView, 28, 0);
    localChunks.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20);
    u16(centralView, 8, 0x0800); u16(centralView, 10, 0); u16(centralView, 12, 0); u16(centralView, 14, 0);
    u32(centralView, 16, checksum); u32(centralView, 20, data.length); u32(centralView, 24, data.length);
    u16(centralView, 28, nameBytes.length); u16(centralView, 30, 0); u16(centralView, 32, 0);
    u16(centralView, 34, 0); u16(centralView, 36, 0); u32(centralView, 38, 0); u32(centralView, 42, localOffset);
    centralChunks.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }
  if (entries.length > 0xffff) throw new RangeError('ZIP entry limit exceeded.');
  const central = concat(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50); u16(endView, 4, 0); u16(endView, 6, 0);
  u16(endView, 8, entries.length); u16(endView, 10, entries.length);
  u32(endView, 12, central.length); u32(endView, 16, localOffset); u16(endView, 20, 0);
  return concat([...localChunks, central, end]);
}

/**
 * Reads the uncompressed ZIPs produced by createStoredZip. Keeping this deliberately small avoids
 * shipping a general archive dependency in the static web app.
 * @param {Uint8Array} bytes
 * @returns {{name: string, data: Uint8Array}[]}
 */
export function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    if (at + 30 > bytes.length) throw new Error('Truncated ZIP local header.');
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const expectedCrc = view.getUint32(at + 14, true);
    const compressedSize = view.getUint32(at + 18, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    if (flags & 1) throw new Error('Encrypted ZIPs are not supported.');
    if (flags & 8) throw new Error('ZIP data descriptors are not supported.');
    if (method !== 0 || compressedSize !== size) throw new Error('Only uncompressed project ZIPs are supported.');
    const nameAt = at + 30;
    const dataAt = nameAt + nameLength + extraLength;
    const end = dataAt + size;
    if (end > bytes.length) throw new Error('Truncated ZIP entry.');
    const name = decoder.decode(bytes.subarray(nameAt, nameAt + nameLength));
    const data = Uint8Array.from(bytes.subarray(dataAt, end));
    if (!name || name.startsWith('/') || name.includes('../') || name === '..') throw new Error(`Unsafe ZIP entry: ${name}`);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP checksum failed: ${name}`);
    if (!name.endsWith('/')) entries.push({ name, data });
    at = end;
  }
  if (!entries.length) throw new Error('No readable files were found in the project ZIP.');
  return entries;
}
