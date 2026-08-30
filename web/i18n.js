// @ts-check
export const SUPPORTED_LOCALES = [
  { id: 'en', label: 'English', tags: ['en'] },
  { id: 'ja', label: '日本語', tags: ['ja'] },
];

const STORAGE_KEY = 'gfx-image-tool.lang';
/** @type {Record<string, string>} */
let dictionary = {};
/** @type {Record<string, string>} */
let fallback = {};
let locale = 'en';

/** @param {string} tag */
function resolveTag(tag) {
  const lower = tag.toLowerCase();
  return SUPPORTED_LOCALES.find((entry) => entry.tags.some((candidate) => lower === candidate || lower.startsWith(`${candidate}-`)))?.id;
}

export function detectLocale() {
  const query = resolveTag(new URLSearchParams(location.search).get('lang') ?? '');
  if (query) return query;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LOCALES.some((entry) => entry.id === saved)) return saved;
  } catch { /* storage may be disabled */ }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const detected = resolveTag(tag);
    if (detected) return detected;
  }
  return 'en';
}

/** @param {string} id */
async function load(id) {
  const response = await fetch(new URL(`./locales/${id}.json`, import.meta.url));
  if (!response.ok) throw new Error(`locale load failed: ${id}`);
  return /** @type {Record<string, string>} */ (await response.json());
}

/** @param {string} id @param {{persist?: boolean}} [options] */
export async function setLocale(id, options = {}) {
  if (!SUPPORTED_LOCALES.some((entry) => entry.id === id)) id = 'en';
  if (!Object.keys(fallback).length) fallback = await load('en');
  dictionary = id === 'en' ? fallback : await load(id);
  locale = id;
  document.documentElement.lang = id;
  if (options.persist !== false) try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

export function currentLocale() { return locale; }

/** @param {string} key @param {Record<string, string|number>} [parameters] */
export function t(key, parameters) {
  let value = dictionary[key] ?? fallback[key] ?? key;
  for (const [name, replacement] of Object.entries(parameters ?? {})) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

/** @param {ParentNode} [root] */
export function applyTranslations(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.getAttribute('data-i18n') ?? '');
  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) /** @type {HTMLInputElement} */ (element).placeholder = t(element.getAttribute('data-i18n-placeholder') ?? '');
  for (const element of root.querySelectorAll('[data-i18n-title]')) /** @type {HTMLElement} */ (element).title = t(element.getAttribute('data-i18n-title') ?? '');
}

export async function initI18n() { await setLocale(detectLocale(), { persist: false }); }
