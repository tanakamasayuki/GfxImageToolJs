// @ts-check
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} changelog */
export function unreleasedEntries(changelog) {
  const marker = '\n## Unreleased\n';
  const at = changelog.indexOf(marker);
  if (at < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  const body = changelog.slice(at + marker.length);
  const end = body.indexOf('\n## ');
  return (end < 0 ? body : body.slice(0, end + 1)).trim();
}

/** @param {string} changelog @param {string} version */
export function releaseChangelog(changelog, version) {
  if (!unreleasedEntries(changelog)) throw new Error('CHANGELOG.md has nothing under "## Unreleased".');
  if (changelog.includes(`\n## ${version}\n`)) throw new Error(`CHANGELOG.md already has a ${version} section.`);
  return changelog.replace('\n## Unreleased\n', `\n## Unreleased\n\n## ${version}\n`);
}

/** @param {string} source @param {string} version */
export function syncSourceVersion(source, version) {
  const next = source.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`);
  if (next === source) throw new Error('src/index.js VERSION declaration was not found.');
  return next;
}

async function main() {
  const version = process.env.npm_package_version;
  if (!version) throw new Error('npm_package_version is not set (run via npm version).');
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  const sourcePath = join(ROOT, 'src', 'index.js');
  writeFileSync(changelogPath, releaseChangelog(readFileSync(changelogPath, 'utf8'), version));
  writeFileSync(sourcePath, syncSourceVersion(readFileSync(sourcePath, 'utf8'), version));
  execFileSync('git', ['add', '--', changelogPath, sourcePath], { cwd: ROOT, stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}
