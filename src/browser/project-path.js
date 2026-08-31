// @ts-check

/** @param {string} path */
function slash(path) { return path.replaceAll('\\', '/'); }

/**
 * Find the root included by a browser in a dropped .imagesconfig path.
 * Configuration image patterns are relative to this directory.
 * @param {string} configPath
 */
export function browserProjectRoot(configPath) {
  const normalized = slash(configPath);
  const at = normalized.lastIndexOf('/');
  return at < 0 ? '' : normalized.slice(0, at + 1);
}

/** @param {string} path @param {string} [root] */
export function browserProjectPath(path, root = '') {
  let normalized = slash(path);
  const normalizedRoot = slash(root);
  if (normalizedRoot && normalized.startsWith(normalizedRoot)) normalized = normalized.slice(normalizedRoot.length);
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) throw new Error(`Unsafe project path: ${path}`);
  return parts.join('/');
}
