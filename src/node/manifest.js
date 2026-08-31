// @ts-check
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const HEADER_MANIFEST = '.gfx-image-tool-headers.json';
export const PREVIEW_MANIFEST = '.gfx-image-tool-previews.json';

/** @param {string} root @param {string} path */
function managedRelative(root, path) {
  const value = relative(root, resolve(path)).replaceAll('\\', '/');
  if (!value || value === '..' || value.startsWith('../') || isAbsolute(value)) {
    throw new Error(`Generated output is outside its managed directory: ${path}`);
  }
  return value;
}

/** @param {string} root @param {string} relativePath */
function managedAbsolute(root, relativePath) {
  if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error(`Invalid generated manifest path: ${relativePath}`);
  }
  const path = resolve(root, relativePath);
  managedRelative(root, path);
  return path;
}

/** @param {string} path */
async function exists(path) {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Compare the previous generated-file set with the current expected set.
 * Only files named by a previous manifest can become stale and be removed.
 * @param {string} root
 * @param {string} manifestName
 * @param {'headers'|'previews'} kind
 * @param {string[]} expectedPaths
 */
export async function planGeneratedOutputs(root, manifestName, kind, expectedPaths) {
  root = resolve(root);
  const manifestPath = resolve(root, manifestName);
  const files = [...new Set(expectedPaths.map((path) => managedRelative(root, path)))].sort();
  /** @type {string[]} */
  let previous = [];
  let hadManifest = true;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (parsed?.version !== 1 || parsed?.kind !== kind || !Array.isArray(parsed.files) || !parsed.files.every((/** @type {unknown} */ item) => typeof item === 'string')) {
      throw new Error(`Invalid generated manifest: ${manifestPath}`);
    }
    previous = parsed.files;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    hadManifest = false;
  }
  const expected = new Set(files);
  const stale = [];
  for (const item of previous) {
    const path = managedAbsolute(root, item);
    if (!expected.has(item) && await exists(path)) stale.push(path);
  }
  const source = `${JSON.stringify({ version: 1, kind, files }, null, 2)}\n`;
  return { manifestPath, source, stale, hadManifest };
}
