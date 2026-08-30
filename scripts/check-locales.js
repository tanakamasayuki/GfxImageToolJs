// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (/** @type {string} */ name) => JSON.parse(readFileSync(join(root, 'web', 'locales', name), 'utf8'));
const english = load('en.json');
const japanese = load('ja.json');
const enKeys = Object.keys(english).sort();
const jaKeys = Object.keys(japanese).sort();
if (JSON.stringify(enKeys) !== JSON.stringify(jaKeys)) {
  const missingJa = enKeys.filter((key) => !(key in japanese));
  const missingEn = jaKeys.filter((key) => !(key in english));
  throw new Error(`Locale keys differ. Missing ja: ${missingJa.join(', ') || 'none'}; missing en: ${missingEn.join(', ') || 'none'}`);
}
const sources = [readFileSync(join(root, 'web', 'index.html'), 'utf8'), readFileSync(join(root, 'web', 'app.js'), 'utf8')].join('\n');
const used = new Set([
  ...Array.from(sources.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g), (match) => match[1]),
  ...Array.from(sources.matchAll(/\bt\(['"]([^'"]+)['"]/g), (match) => match[1]),
]);
const missing = [...used].filter((key) => !(key in english));
if (missing.length) throw new Error(`Missing locale keys: ${missing.join(', ')}`);
console.log(`${enKeys.length} locale keys synchronized (en/ja)`);
