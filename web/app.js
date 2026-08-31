// @ts-check
import {
  compositeAlpha,
  compareImages,
  createStoredZip,
  decodeBrowserImage,
  decodeEncodedImage,
  emitCBundle,
  emitCSource,
  encodeImage,
  grayscaleImage,
  listTargets,
  optimizeTinyImageSet,
  reduceImageColors,
  rgb565,
  sanitizeIdentifier,
  targetFormats,
} from './gfx-image-tool.js';
import { applyTranslations, currentLocale, initI18n, setLocale, SUPPORTED_LOCALES, t } from './i18n.js';

/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ ($(id));
/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ ($(id));
/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

const SETTINGS_KEY = 'gfx-image-tool.project-settings.v2';
const DEFAULTS = {
  target: 'generic-c', mode: 'auto', format: 'rgb565be', colors: 16, dither: 'none', threshold: 128,
  alphaMode: 'auto', alphaThreshold: 128, alphaColor: 'auto', decoderCost: 400,
  preferBitmap: 'horizontal', alignedVblit: false, prefix: 'img_', outputFile: 'images.h',
};

/** @typedef {{symbol?: string, mode?: string, format?: string, colors?: number, threshold?: number, dither?: string}} Override */
/** @typedef {{id: number, name: string, image: import('../src/model/image.js').GfxImage, thumbnail: string, override: Override}} WorkspaceImage */
/** @type {typeof DEFAULTS} */
let settings = loadSettings();
/** @type {WorkspaceImage[]} */
let images = [];
let selectedId = 0;
let nextId = 1;
let selectedExportPath = '';
/** @type {{pattern: string, values: Record<string, string>}[]} */
let importedOverrides = [];
/** @type {null | {header: string, images: {item: WorkspaceImage, prepared: import('../src/model/image.js').GfxImage, encoded: import('../src/format/registry.js').EncodedImage, format: string, symbol: string, bytes: number}[], optimization?: ReturnType<typeof optimizeTinyImageSet>, report: object}} */
let computed = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

const targetEl = select('target');
for (const locale of SUPPORTED_LOCALES) select('language').add(new Option(locale.label, locale.id));

const modeValues = ['auto', 'monochrome', 'grayscale', 'indexed', 'true-color'];
const ditherValues = ['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8'];

/** @param {string} value */
function modeLabel(value) { return t(`value.mode.${value}`); }
/** @param {string} value */
function ditherLabel(value) { return t(`value.dither.${value}`); }
/** @param {string} value */
function formatLabel(value) { return t(`format.${value}`); }

/** @param {HTMLSelectElement} element @param {string[]} values @param {(value: string) => string} label @param {boolean} [inherit] */
function fillOptions(element, values, label, inherit = false) {
  const previous = element.value;
  element.textContent = '';
  if (inherit) element.add(new Option(t('editor.inherit'), ''));
  for (const value of values) element.add(new Option(label(value), value));
  if ([...element.options].some((option) => option.value === previous)) element.value = previous;
}

function fillTranslatedOptions() {
  const previousTarget = targetEl.value || settings.target;
  const targets = listTargets().map((value) => ({ value, label: t(`target.${value}`) }))
    .sort((a, b) => a.value.localeCompare(b.value, 'en', { sensitivity: 'base' }));
  targetEl.textContent = '';
  for (const target of targets) targetEl.add(new Option(target.label, target.value));
  targetEl.value = targets.some((target) => target.value === previousTarget) ? previousTarget : 'generic-c';
  fillOptions(select('mode'), modeValues, modeLabel);
  fillOptions(select('override-mode'), modeValues, modeLabel, true);
  fillOptions(select('dither'), ditherValues, ditherLabel);
  fillOptions(select('override-dither'), ditherValues, ditherLabel, true);
}

function tinyFormatOptions() {
  return [
    ['auto', formatLabel('auto-tinygfx')], ['raw565', formatLabel('raw565')], ['rle565', formatLabel('rle565')],
    ['rlepal4', formatLabel('rlepal4')], ['bitmap1h', formatLabel('bitmap1h')], ['bitmap1v', formatLabel('bitmap1v')],
  ];
}

/** @param {HTMLSelectElement} element @param {boolean} includeInherit */
function fillFormatOptions(element, includeInherit) {
  const previous = element.value;
  element.textContent = '';
  if (includeInherit) element.add(new Option(t('editor.inherit'), ''));
  const options = settings.target === 'tinygfx'
    ? tinyFormatOptions()
    : targetFormats(settings.target).map((format) => [format, formatLabel(format)]);
  for (const [value, label] of options) element.add(new Option(label, value));
  if ([...element.options].some((option) => option.value === previous)) element.value = previous;
}

function applySettingsToControls() {
  targetEl.value = settings.target;
  select('mode').value = settings.mode;
  fillFormatOptions(select('format'), false);
  select('format').value = [...select('format').options].some((option) => option.value === settings.format)
    ? settings.format : (settings.target === 'tinygfx' ? 'auto' : defaultFormat(settings.target));
  settings.format = select('format').value;
  input('colors').value = String(settings.colors);
  select('dither').value = settings.dither;
  input('threshold').value = String(settings.threshold);
  select('alpha-mode').value = settings.alphaMode;
  input('alpha-threshold').value = String(settings.alphaThreshold);
  input('alpha-color').value = settings.alphaColor;
  input('decoder-cost').value = String(settings.decoderCost);
  select('prefer-bitmap').value = settings.preferBitmap;
  input('aligned-vblit').checked = settings.alignedVblit;
  input('prefix').value = settings.prefix;
  input('output-file').value = settings.outputFile;
  fillFormatOptions(select('override-format'), true);
}

function readSettings() {
  settings = {
    target: targetEl.value,
    mode: select('mode').value,
    format: select('format').value,
    colors: clamp(Number(input('colors').value), 2, 256),
    dither: select('dither').value,
    threshold: clamp(Number(input('threshold').value), 0, 255),
    alphaMode: select('alpha-mode').value,
    alphaThreshold: clamp(Number(input('alpha-threshold').value), 0, 255),
    alphaColor: input('alpha-color').value.trim() || 'auto',
    decoderCost: Math.max(0, Number(input('decoder-cost').value) || 0),
    preferBitmap: select('prefer-bitmap').value,
    alignedVblit: input('aligned-vblit').checked,
    prefix: input('prefix').value,
    outputFile: input('output-file').value.trim() || 'images.h',
  };
  if (settings.alignedVblit) settings.preferBitmap = 'vertical';
  saveSettings();
}

/** @param {string} value */
function parseColor(value) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) throw new Error(`Invalid RGB color: ${value}`);
  return /** @type {[number, number, number]} */ ([0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16)));
}

/** @param {string} format */
function tinyAllowed(format) {
  return format === 'auto' ? undefined : [format];
}

/** @param {string} target */
function defaultFormat(target) {
  const formats = targetFormats(target);
  for (const preferred of ['rgb565be', 'rgb565le', 'bitmap1-msb']) if (formats.includes(preferred)) return preferred;
  return formats[0];
}

/** @param {WorkspaceImage} item */
function prepare(item) {
  const effective = { ...settings, ...item.override };
  let image = item.image;
  const alphaMode = effective.alphaMode === 'auto' ? (settings.target === 'tinygfx' ? 'color-key' : 'none') : effective.alphaMode;
  const keepsAlphaMask = settings.target !== 'tinygfx' && effective.format === 'mask1-msb';
  if (alphaMode === 'none' || (settings.target !== 'tinygfx' && !keepsAlphaMask)) image = compositeAlpha(image, [0, 0, 0]);
  if (effective.mode === 'grayscale') image = grayscaleImage(image);
  if (effective.mode === 'indexed') {
    if (effective.dither !== 'none' && effective.dither !== 'floyd-steinberg') throw new Error(`${item.name}: indexed mode supports none or floyd-steinberg dither.`);
    image = reduceImageColors(image, Number(effective.colors), { dither: /** @type {'none'|'floyd-steinberg'} */ (effective.dither) }).image;
  }
  return { image, effective };
}

function recompute() {
  if (!images.length) {
    computed = null;
    renderAll();
    return;
  }
  try {
    const prepared = images.map((item) => ({ item, ...prepare(item) }));
    /** @type {ReturnType<typeof optimizeTinyImageSet> | undefined} */
    let optimization;
    /** @type {{item: WorkspaceImage, prepared: import('../src/model/image.js').GfxImage, encoded: import('../src/format/registry.js').EncodedImage, format: string, symbol: string, bytes: number}[]} */
    let results;
    if (settings.target === 'tinygfx') {
      const alphaColor = settings.alphaColor === 'auto' ? undefined : parseColor(settings.alphaColor);
      optimization = optimizeTinyImageSet(prepared.map(({ item, image, effective }) => ({
        key: String(item.id), image,
        monochrome: effective.mode === 'monochrome', threshold: Number(effective.threshold),
        invert: false,
        dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (effective.dither),
        alphaThreshold: effective.alphaMode === 'color-key' || effective.alphaMode === 'auto' ? settings.alphaThreshold : undefined,
        transparentColor: alphaColor ? rgb565(alphaColor[0], alphaColor[1], alphaColor[2]) : undefined,
        allowedFormats: tinyAllowed(effective.format),
      })), { decoderCost: settings.decoderCost, preferBitmap: /** @type {'horizontal'|'vertical'} */ (settings.preferBitmap) });
      const choices = new Map(optimization.images.map((choice) => [choice.key, choice]));
      results = prepared.map(({ item, image }) => {
        const choice = choices.get(String(item.id));
        if (!choice) throw new Error(`No optimizer result for ${item.name}.`);
        return {
          item, prepared: image, encoded: choice.encoded, format: choice.format,
          symbol: sanitizeIdentifier(item.override.symbol || `${settings.prefix}${stem(item.name)}`), bytes: choice.bytes,
        };
      });
    } else {
      results = prepared.map(({ item, image, effective }) => {
        const format = effective.format === 'auto' ? defaultFormat(settings.target) : effective.format;
        const encoded = encodeImage(image, format, {
          colors: Number(effective.colors), threshold: Number(effective.threshold),
          alphaThreshold: settings.alphaThreshold,
          dither: /** @type {'none'|'floyd-steinberg'|'bayer2'|'bayer4'|'bayer8'} */ (effective.dither),
        });
        return {
          item, prepared: image, encoded, format,
          symbol: sanitizeIdentifier(item.override.symbol || `${settings.prefix}${stem(item.name)}`),
          bytes: encoded.stats.dataBytes + encoded.stats.paletteBytes + encoded.stats.maskBytes,
        };
      });
    }
    const header = emitCBundle(results.map((result) => ({
      encoded: result.encoded, target: settings.target, name: result.symbol,
      storage: 'PROGMEM', align: 4, static: true, comment: result.item.name,
    }))).source;
    const report = {
      version: 1, target: settings.target, generatedHeader: settings.outputFile,
      formats: optimization?.formats ?? [...new Set(results.map((result) => result.format))],
      dataBytes: optimization?.dataBytes ?? results.reduce((sum, result) => sum + result.bytes, 0),
      decoderBytes: optimization?.decoderBytes ?? 0,
      totalBytes: optimization?.totalBytes ?? results.reduce((sum, result) => sum + result.bytes, 0),
      images: optimization?.report.map((row) => ({ ...row, key: images.find((item) => String(item.id) === row.key)?.name ?? row.key })) ?? results.map((result) => ({
        key: result.item.name, candidates: [{ format: result.format, bytes: result.bytes }],
        individualMinimum: { format: result.format, bytes: result.bytes },
        selected: { format: result.format, bytes: result.bytes }, dataDelta: 0,
      })),
    };
    computed = { header, images: results, optimization, report };
    setStatus(t('status.ready', { count: images.length }));
  } catch (error) {
    computed = null;
    setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true);
  }
  renderAll();
}

/** @param {string} path */
function stem(path) { return path.replaceAll('\\', '/').split('/').pop()?.replace(/\.[^.]+$/, '') || 'image'; }

/** @param {string} message @param {boolean} [error] */
function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

/** @param {FileList|File[]} files */
async function addFiles(files) {
  const incoming = Array.from(files);
  const configs = incoming.filter((file) => file.name === '.imagesconfig' || file.name.endsWith('.imagesconfig'));
  const replaced = [];
  for (const file of incoming.filter((candidate) => !configs.includes(candidate))) {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name)) continue;
    setStatus(t('status.decoding', { name: file.name }));
    try {
      const image = await decodeBrowserImage(file, { name: file.name });
      const name = file.webkitRelativePath || file.name;
      const existing = images.find((item) => item.name === name);
      if (existing) {
        existing.image = image;
        existing.thumbnail = imageUrl(image);
        replaced.push(name);
      } else {
        const item = { id: nextId++, name, image, thumbnail: imageUrl(image), override: {} };
        applyImportedOverride(item);
        images.push(item);
      }
    } catch (error) { setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true); }
  }
  images.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  selectedId ||= images[0]?.id ?? 0;
  if (configs.length) {
    try {
      const config = configs.at(-1);
      if (config) { importConfig(await config.text()); setStatus(t('status.configImported', { name: config.name })); }
    } catch (error) { setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true); }
  } else {
    recompute();
    if (replaced.length) setStatus(t('images.replaced', { name: replaced.join(', ') }));
  }
}

/** @param {import('../src/model/image.js').GfxImage} image */
function imageUrl(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function selectedItem() { return images.find((item) => item.id === selectedId); }

/** @param {string} pattern @param {string} value */
function matchesImagePattern(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*').replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`).test(value);
}

/** @param {WorkspaceImage} item */
function applyImportedOverride(item) {
  for (const section of importedOverrides) {
    if (!matchesImagePattern(section.pattern, item.name)) continue;
    const value = section.values;
    item.override = {
      ...item.override,
      symbol: value.symbol || item.override.symbol,
      mode: value.mode || item.override.mode,
      format: value.format || item.override.format,
      colors: value.colors ? Number(value.colors) : item.override.colors,
      threshold: value.threshold ? Number(value.threshold) : item.override.threshold,
      dither: value.dither || item.override.dither,
    };
  }
}

function renderImageList() {
  const list = $('image-list');
  list.textContent = '';
  $('image-empty').hidden = images.length > 0;
  for (const [index, item] of images.entries()) {
    const result = computed?.images.find((entry) => entry.item.id === item.id);
    const li = document.createElement('li');
    li.className = `image-row${item.id === selectedId ? ' selected' : ''}`;
    const order = document.createElement('span'); order.className = 'image-index'; order.textContent = String(index + 1);
    const thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.src = item.thumbnail; thumb.alt = '';
    const body = document.createElement('div');
    const name = document.createElement('div'); name.className = 'image-name'; name.textContent = item.name;
    const meta = document.createElement('div'); meta.className = 'image-meta'; meta.textContent = `${item.image.width}×${item.image.height}`;
    const format = document.createElement('div'); format.className = 'image-format'; format.textContent = result?.format ?? '—';
    body.append(name, meta, format);
    const size = document.createElement('div'); size.className = 'image-size'; size.textContent = result ? t('images.bytes', { bytes: result.bytes }) : '—';
    li.append(order, thumb, body, size);
    li.addEventListener('click', () => { selectedId = item.id; renderAll(); });
    list.append(li);
  }
}

function renderEditor() {
  const item = selectedItem();
  $('editor').hidden = !item;
  $('editor-empty').hidden = !!item;
  if (!item) return;
  const converted = computed?.images.find((entry) => entry.item.id === item.id);
  const effective = { ...settings, ...item.override };
  fillFormatOptions(select('override-format'), true);
  select('override-mode').options[0].textContent = `${t('editor.inherit')} — ${modeLabel(settings.mode)}`;
  select('override-format').options[0].textContent = `${t('editor.inherit')} — ${converted ? formatLabel(converted.format) : formatLabel(settings.format)}`;
  select('override-dither').options[0].textContent = `${t('editor.inherit')} — ${ditherLabel(settings.dither)}`;
  input('override-symbol').value = item.override.symbol ?? '';
  input('override-symbol').placeholder = converted?.symbol ?? t('editor.inherit');
  select('override-mode').value = item.override.mode ?? '';
  select('override-format').value = item.override.format ?? '';
  input('override-colors').value = item.override.colors === undefined ? '' : String(item.override.colors);
  input('override-colors').placeholder = String(settings.colors);
  input('override-threshold').value = item.override.threshold === undefined ? '' : String(item.override.threshold);
  input('override-threshold').placeholder = String(settings.threshold);
  select('override-dither').value = item.override.dither ?? '';
  const summary = $('effective-settings'); summary.textContent = ''; summary.dataset.label = t('effective.title');
  const alphaMode = effective.alphaMode === 'auto' ? (settings.target === 'tinygfx' ? 'color-key' : 'none') : effective.alphaMode;
  const values = [
    t('effective.symbol', { value: converted?.symbol ?? '—' }),
    t('effective.mode', { value: modeLabel(effective.mode) }),
    t('effective.format', { value: converted ? formatLabel(converted.format) : '—' }),
    t('effective.colors', { value: effective.colors }),
    t('effective.dither', { value: ditherLabel(effective.dither) }),
    t('effective.threshold', { value: effective.threshold }),
    t('effective.alpha', { value: t(`value.alpha.${alphaMode}`) }),
    t('effective.size', { value: converted?.bytes ?? '—' }),
  ];
  for (const value of values) { const span = document.createElement('span'); span.className = 'effective-value'; span.textContent = value; summary.append(span); }
  drawPreview(/** @type {HTMLCanvasElement} */ ($('original-preview')), item.image);
  if (converted) drawPreview(/** @type {HTMLCanvasElement} */ ($('converted-preview')), decodeEncodedImage(converted.encoded, { target: settings.target }));
  else { const canvas = /** @type {HTMLCanvasElement} */ ($('converted-preview')); canvas.width = 1; canvas.height = 1; }
  applyPreviewBackground();
}

function applyPreviewBackground() {
  const background = select('preview-background').value;
  for (const id of ['original-wrap', 'converted-wrap']) {
    const wrapper = $(id);
    wrapper.classList.remove('checker', 'preview-white', 'preview-black', 'preview-magenta', 'preview-green');
    wrapper.classList.add(background === 'checker' ? 'checker' : `preview-${background}`);
  }
}

/** @param {HTMLCanvasElement} canvas @param {import('../src/model/image.js').GfxImage} image */
function drawPreview(canvas, image) {
  const requested = Number(select('zoom').value) || 1;
  const zoom = Math.max(1, Math.min(requested, Math.floor(4096 / Math.max(image.width, image.height)) || 1));
  canvas.width = image.width * zoom; canvas.height = image.height * zoom;
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (input('grid').checked && zoom >= 4) {
    context.strokeStyle = 'rgba(20,50,50,.2)'; context.lineWidth = 1;
    for (let x = 0; x <= image.width; x++) { context.beginPath(); context.moveTo(x * zoom + .5, 0); context.lineTo(x * zoom + .5, canvas.height); context.stroke(); }
    for (let y = 0; y <= image.height; y++) { context.beginPath(); context.moveTo(0, y * zoom + .5); context.lineTo(canvas.width, y * zoom + .5); context.stroke(); }
  }
}

function renderReport() {
  const report = /** @type {any} */ (computed?.report);
  $('report').hidden = !report; $('report-empty').hidden = !!report;
  if (!report) return;
  $('report-summary').textContent = t('report.summary', { data: report.dataBytes, decoder: report.decoderBytes, total: report.totalBytes });
  const body = $('report-body'); body.textContent = '';
  for (const row of report.images) {
    const item = images.find((image) => String(image.id) === String(row.key));
    const tr = document.createElement('tr');
    for (const value of [item?.name ?? row.key, `${formatLabel(row.individualMinimum.format)} · ${row.individualMinimum.bytes} B`, `${formatLabel(row.selected.format)} · ${row.selected.bytes} B`, `${row.dataDelta >= 0 ? '+' : ''}${row.dataDelta} B`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const candidates = document.createElement('td'); candidates.className = 'candidates'; candidates.textContent = row.candidates.map((/** @type {{format: string, bytes: number}} */ candidate) => `${formatLabel(candidate.format)} ${candidate.bytes} B`).join(' · '); tr.append(candidates);
    body.append(tr);
  }
}

function renderAll() {
  renderImageList(); renderEditor(); renderReport(); renderExport();
  /** @type {HTMLButtonElement} */ ($('download-zip')).disabled = !computed;
  /** @type {HTMLButtonElement} */ ($('download-header')).disabled = !computed;
  /** @type {HTMLButtonElement} */ ($('download-selected')).disabled = !computed || !selectedItem();
  /** @type {HTMLButtonElement} */ ($('download-converted')).disabled = !computed || !selectedItem();
  /** @type {HTMLButtonElement} */ ($('download-comparison')).disabled = !computed || !selectedItem();
  /** @type {HTMLButtonElement} */ ($('download-report')).disabled = !computed;
}

/** @param {BlobPart} content @param {string} name @param {string} type */
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** @param {import('../src/model/image.js').GfxImage} image @param {string} name */
function downloadPng(image, name) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  canvas.toBlob((blob) => { if (blob) download(blob, name, 'image/png'); }, 'image/png');
}

/** @param {import('../src/model/image.js').GfxImage} image @returns {Promise<Uint8Array>} */
function pngBytes(image) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('PNG encoding failed.')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

function projectTextFiles() {
  return new Map([
    [`generated/${settings.outputFile}`, computed?.header ?? ''],
    ['.imagesconfig', serializeConfig()],
    ['report.json', computed ? `${JSON.stringify(computed.report, null, 2)}\n` : ''],
  ]);
}

/** @param {number} index @param {WorkspaceImage} item */
function previewStem(index, item) {
  const safe = stem(item.name).replace(/[^A-Za-z0-9._-]+/g, '_') || 'image';
  return `${String(index + 1).padStart(2, '0')}-${safe}`;
}

function renderExport() {
  const tree = $('export-tree'); tree.textContent = '';
  const textFiles = projectTextFiles();
  const available = new Map(textFiles);
  /** @param {string} label @param {number} depth */
  const folder = (label, depth) => { const li = document.createElement('li'); li.className = `tree-folder tree-depth-${depth}`; li.textContent = label; tree.append(li); };
  /** @param {string} path @param {string} label @param {number} depth @param {string} preview */
  const file = (path, label, depth, preview) => {
    available.set(path, preview);
    const li = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.className = `tree-depth-${depth}`;
    button.textContent = label; button.classList.toggle('active', path === selectedExportPath);
    button.addEventListener('click', () => { selectedExportPath = path; renderExport(); });
    li.append(button); tree.append(li);
  };
  folder('gfx-image-project.zip', 0);
  file('.imagesconfig', '.imagesconfig', 1, textFiles.get('.imagesconfig') ?? '');
  file('report.json', 'report.json', 1, textFiles.get('report.json') ?? '');
  folder('generated/', 1);
  file(`generated/${settings.outputFile}`, settings.outputFile, 2, textFiles.get(`generated/${settings.outputFile}`) ?? '');
  folder('previews/', 1);
  for (const [index, result] of (computed?.images ?? []).entries()) {
    const name = previewStem(index, result.item);
    const description = t('export.pngPreview', { width: result.encoded.width, height: result.encoded.height });
    file(`previews/${name}.png`, `${name}.png`, 2, description);
    file(`previews/${name}.comparison.png`, `${name}.comparison.png`, 2, t('export.comparisonPreview', { width: result.encoded.width * 2, height: result.encoded.height }));
  }
  if (!selectedExportPath || !available.has(selectedExportPath)) selectedExportPath = `generated/${settings.outputFile}`;
  const source = available.get(selectedExportPath) ?? '';
  $('export-preview-title').textContent = `${t('export.preview')}: ${selectedExportPath}`;
  const lines = source.split('\n');
  $('export-preview').textContent = lines.length > 100 ? `${lines.slice(0, 100).join('\n')}\n\n${t('export.truncated', { lines: lines.length })}` : source;
  for (const button of tree.querySelectorAll('button')) button.classList.toggle('active', button.textContent === selectedExportPath.split('/').at(-1));
}

async function projectZip() {
  if (!computed) throw new Error('No generated project.');
  /** @type {{name: string, data: Uint8Array|string}[]} */
  const entries = [...projectTextFiles()].map(([name, data]) => ({ name, data }));
  for (const [index, result] of computed.images.entries()) {
    const name = previewStem(index, result.item);
    const converted = decodeEncodedImage(result.encoded, { target: settings.target });
    entries.push({ name: `previews/${name}.png`, data: /** @type {Uint8Array} */ (await pngBytes(converted)) });
    entries.push({ name: `previews/${name}.comparison.png`, data: /** @type {Uint8Array} */ (await pngBytes(compareImages(result.item.image, converted))) });
  }
  return createStoredZip(entries);
}

function serializeConfig() {
  const lines = [
    '# Generated by Gfx Image Tool web workspace', '[general]', 'output_dir = generated',
    'output_mode = bundle', `output_file = ${settings.outputFile}`, `prefix = ${settings.prefix}`, `target = ${settings.target}`, '',
    '[color]', `format = ${settings.format}`, `mode = ${settings.mode}`, `colors = ${settings.colors}`,
    `dither = ${settings.dither}`, `threshold = ${settings.threshold}`, 'invert = false', '',
    '[alpha]', `mode = ${settings.alphaMode}`, 'matte = 000000', `threshold = ${settings.alphaThreshold}`, `color = ${settings.alphaColor}`, '',
    '[preview]', 'output_dir = previews', 'layout = both', '',
    '[csource]', 'storage = PROGMEM', 'align = 4', 'static = true', '',
    '[optimize]', `decoder_cost = ${settings.decoderCost}`, `prefer_bitmap = ${settings.preferBitmap}`, `aligned_vblit = ${settings.alignedVblit}`, '',
  ];
  for (const item of images) {
    const entries = Object.entries(item.override).filter(([, value]) => value !== undefined && value !== '');
    if (!entries.length) continue;
    lines.push(`[image "${item.name.replaceAll('"', '_')}"]`);
    for (const [key, value] of entries) lines.push(`${key} = ${value}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** @param {string} text */
function importConfig(text) {
  /** @type {{name: string, values: Record<string, string>}[]} */
  const sections = []; let current = /** @type {{name: string, values: Record<string, string>}} */ ({ name: 'general', values: {} }); sections.push(current);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) { current = { name: section[1], values: {} }; sections.push(current); continue; }
    const entry = /^([^=]+)=(.*)$/.exec(line); if (entry) current.values[entry[1].trim()] = entry[2].trim();
  }
  const values = (/** @type {string} */ name) => /** @type {Record<string, string>} */ (Object.assign({}, ...sections.filter((section) => section.name === name).map((section) => section.values)));
  const general = values('general'); const color = values('color'); const alpha = values('alpha'); const optimize = values('optimize');
  settings = {
    ...settings, target: general.target || settings.target, prefix: general.prefix ?? settings.prefix,
    outputFile: general.output_file || settings.outputFile, mode: color.mode || settings.mode,
    format: color.format || settings.format, colors: Number(color.colors) || settings.colors,
    dither: color.dither || settings.dither, threshold: Number(color.threshold ?? settings.threshold),
    alphaMode: alpha.mode || settings.alphaMode, alphaThreshold: Number(alpha.threshold ?? settings.alphaThreshold),
    alphaColor: alpha.color || settings.alphaColor, decoderCost: Number(optimize.decoder_cost ?? settings.decoderCost),
    preferBitmap: optimize.prefer_bitmap || settings.preferBitmap,
    alignedVblit: /^(true|yes|1)$/i.test(optimize.aligned_vblit || 'false'),
  };
  importedOverrides = sections.flatMap((section) => {
    const match = /^image\s+["'](.+)["']$/.exec(section.name);
    return match ? [{ pattern: match[1], values: section.values }] : [];
  });
  for (const item of images) { item.override = {}; applyImportedOverride(item); }
  saveSettings(); applySettingsToControls(); recompute();
}

const settingIds = ['target', 'mode', 'format', 'colors', 'dither', 'threshold', 'alpha-mode', 'alpha-threshold', 'alpha-color', 'decoder-cost', 'prefer-bitmap', 'aligned-vblit', 'prefix', 'output-file'];
for (const id of settingIds) $(id).addEventListener('input', () => {
  if (id === 'target') {
    settings.target = targetEl.value;
    settings.format = settings.target === 'tinygfx' ? 'auto' : defaultFormat(settings.target);
    fillFormatOptions(select('format'), false); select('format').value = settings.format;
    fillFormatOptions(select('override-format'), true);
  }
  readSettings(); recompute();
});

for (const id of ['override-symbol', 'override-mode', 'override-format', 'override-colors', 'override-threshold', 'override-dither']) {
  $(id).addEventListener('input', () => {
    const item = selectedItem(); if (!item) return;
    const value = /** @type {HTMLInputElement|HTMLSelectElement} */ ($(id)).value;
    const key = id.replace('override-', '');
    if (key === 'colors' || key === 'threshold') item.override[key] = value === '' ? undefined : Number(value);
    else item.override[/** @type {'symbol'|'mode'|'format'|'dither'} */ (key)] = value || undefined;
    recompute();
  });
}

$('choose').addEventListener('click', () => input('files').click());
input('files').addEventListener('change', () => { const files = input('files').files; if (files) void addFiles(files); input('files').value = ''; });
const dropZone = $('drop-zone');
for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); });
dropZone.addEventListener('drop', (event) => { const files = /** @type {DragEvent} */ (event).dataTransfer?.files; if (files) void addFiles(files); });
document.addEventListener('paste', (event) => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) void addFiles(files); });
$('remove').addEventListener('click', () => {
  const item = selectedItem(); if (!item) return;
  $('remove-message').textContent = t('remove.message', { name: item.name });
  const dialog = /** @type {HTMLDialogElement} */ ($('remove-dialog')); dialog.returnValue = ''; dialog.showModal();
});
$('remove-dialog').addEventListener('close', () => {
  if (/** @type {HTMLDialogElement} */ ($('remove-dialog')).returnValue !== 'confirm') return;
  images = images.filter((item) => item.id !== selectedId); selectedId = images[0]?.id ?? 0; recompute();
});
for (const id of ['zoom', 'grid', 'preview-background']) $(id).addEventListener('input', renderEditor);

for (const tab of document.querySelectorAll('[data-export-tab]')) tab.addEventListener('click', () => {
  const selected = tab.getAttribute('data-export-tab');
  for (const button of document.querySelectorAll('[data-export-tab]')) {
    const active = button === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
  }
  $('export-project').hidden = selected !== 'project'; $('export-individual').hidden = selected !== 'individual';
});

$('download-header').addEventListener('click', () => { if (computed) download(computed.header, settings.outputFile, 'text/x-c++hdr'); });
$('download-zip').addEventListener('click', async () => {
  if (!computed) return;
  const button = /** @type {HTMLButtonElement} */ ($('download-zip')); button.disabled = true;
  setStatus(t('status.packaging'));
  try { download(await projectZip(), 'gfx-image-project.zip', 'application/zip'); setStatus(t('status.ready', { count: images.length })); }
  catch (error) { setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true); }
  finally { button.disabled = !computed; }
});
$('download-selected').addEventListener('click', () => {
  const result = computed?.images.find((entry) => entry.item.id === selectedId); if (!result) return;
  const source = emitCSource(result.encoded, settings.target, { name: result.symbol }).source;
  download(source, `${stem(result.item.name)}.h`, 'text/x-c++hdr');
});
$('download-converted').addEventListener('click', () => {
  const result = computed?.images.find((entry) => entry.item.id === selectedId); if (!result) return;
  downloadPng(decodeEncodedImage(result.encoded, { target: settings.target }), `${stem(result.item.name)}-converted.png`);
});
$('download-comparison').addEventListener('click', () => {
  const result = computed?.images.find((entry) => entry.item.id === selectedId); if (!result) return;
  const converted = decodeEncodedImage(result.encoded, { target: settings.target });
  downloadPng(compareImages(result.item.image, converted), `${stem(result.item.name)}-comparison.png`);
});
$('download-config').addEventListener('click', () => download(serializeConfig(), '.imagesconfig', 'text/plain'));
$('download-report').addEventListener('click', () => { if (computed) download(`${JSON.stringify(computed.report, null, 2)}\n`, 'report.json', 'application/json'); });
$('import-config').addEventListener('click', () => input('config-file').click());
input('config-file').addEventListener('change', async () => {
  const file = input('config-file').files?.[0]; if (!file) return;
  try { importConfig(await file.text()); } catch (error) { setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true); }
  input('config-file').value = '';
});
select('language').addEventListener('input', async () => { await setLocale(select('language').value); applyLanguage(); applySettingsToControls(); renderAll(); });

function applyLanguage() {
  document.title = t('app.title'); applyTranslations(); fillTranslatedOptions(); select('language').value = currentLocale();
  $('guide-link').setAttribute('href', `https://github.com/tanakamasayuki/GfxImageToolJs/blob/main/docs/GUIDE${currentLocale() === 'ja' ? '.ja' : ''}.md`);
  $('advanced-guide-link').setAttribute('href', `https://github.com/tanakamasayuki/GfxImageToolJs/blob/main/docs/ADVANCED${currentLocale() === 'ja' ? '.ja' : ''}.md`);
}

await initI18n();
applyLanguage();
applySettingsToControls();
renderAll();
