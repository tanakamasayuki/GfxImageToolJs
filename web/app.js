// @ts-check
import {
  compositeAlpha,
  compareImages,
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

const SETTINGS_KEY = 'gfx-image-tool.project-settings.v1';
const DEFAULTS = {
  target: 'tinygfx', mode: 'auto', format: 'auto', colors: 16, dither: 'none', threshold: 128,
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
for (const target of listTargets()) targetEl.add(new Option(target, target));
for (const locale of SUPPORTED_LOCALES) select('language').add(new Option(locale.label, locale.id));

const modeValues = ['auto', 'monochrome', 'grayscale', 'indexed', 'true-color'];
for (const value of modeValues) select('override-mode').add(new Option(value, value));
for (const value of ['none', 'floyd-steinberg', 'bayer2', 'bayer4', 'bayer8']) select('override-dither').add(new Option(value, value));

function tinyFormatOptions() {
  return [
    ['auto', 'auto (set optimizer)'], ['raw565', 'raw565'], ['rle565', 'rle565'],
    ['rlepal4', 'rlepal4'], ['bitmap1h', 'bitmap1h'], ['bitmap1v', 'bitmap1v'],
  ];
}

/** @param {HTMLSelectElement} element @param {boolean} includeInherit */
function fillFormatOptions(element, includeInherit) {
  const previous = element.value;
  element.textContent = '';
  if (includeInherit) element.add(new Option(t('editor.inherit'), ''));
  const options = settings.target === 'tinygfx'
    ? tinyFormatOptions()
    : [['auto', 'auto'], ...targetFormats(settings.target).map((format) => [format, format])];
  for (const [value, label] of options) element.add(new Option(label, value));
  if ([...element.options].some((option) => option.value === previous)) element.value = previous;
}

function applySettingsToControls() {
  targetEl.value = settings.target;
  select('mode').value = settings.mode;
  fillFormatOptions(select('format'), false);
  select('format').value = [...select('format').options].some((option) => option.value === settings.format) ? settings.format : 'auto';
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
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name)) continue;
    setStatus(t('status.decoding', { name: file.name }));
    try {
      const image = await decodeBrowserImage(file, { name: file.name });
      images.push({ id: nextId++, name: file.webkitRelativePath || file.name, image, thumbnail: imageUrl(image), override: {} });
      selectedId ||= images.at(-1)?.id ?? 0;
    } catch (error) { setStatus(t('status.error', { message: /** @type {Error} */ (error).message }), true); }
  }
  recompute();
}

/** @param {import('../src/model/image.js').GfxImage} image */
function imageUrl(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function selectedItem() { return images.find((item) => item.id === selectedId); }

function renderImageList() {
  const list = $('image-list');
  list.textContent = '';
  $('image-empty').hidden = images.length > 0;
  for (const item of images) {
    const result = computed?.images.find((entry) => entry.item.id === item.id);
    const li = document.createElement('li');
    li.className = `image-row${item.id === selectedId ? ' selected' : ''}`;
    const thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.src = item.thumbnail; thumb.alt = '';
    const body = document.createElement('div');
    const name = document.createElement('div'); name.className = 'image-name'; name.textContent = item.name;
    const meta = document.createElement('div'); meta.className = 'image-meta'; meta.textContent = `${item.image.width}×${item.image.height}`;
    const format = document.createElement('div'); format.className = 'image-format'; format.textContent = result?.format ?? '—';
    body.append(name, meta, format);
    const size = document.createElement('div'); size.className = 'image-size'; size.textContent = result ? t('images.bytes', { bytes: result.bytes }) : '—';
    li.append(thumb, body, size);
    li.addEventListener('click', () => { selectedId = item.id; renderAll(); });
    list.append(li);
  }
}

function renderEditor() {
  const item = selectedItem();
  $('editor').hidden = !item;
  $('editor-empty').hidden = !!item;
  if (!item) return;
  fillFormatOptions(select('override-format'), true);
  input('override-symbol').value = item.override.symbol ?? '';
  select('override-mode').value = item.override.mode ?? '';
  select('override-format').value = item.override.format ?? '';
  input('override-colors').value = item.override.colors === undefined ? '' : String(item.override.colors);
  input('override-threshold').value = item.override.threshold === undefined ? '' : String(item.override.threshold);
  select('override-dither').value = item.override.dither ?? '';
  drawPreview(/** @type {HTMLCanvasElement} */ ($('original-preview')), item.image);
  const converted = computed?.images.find((entry) => entry.item.id === item.id);
  if (converted) drawPreview(/** @type {HTMLCanvasElement} */ ($('converted-preview')), decodeEncodedImage(converted.encoded, { target: settings.target }));
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
    for (const value of [item?.name ?? row.key, `${row.individualMinimum.format} · ${row.individualMinimum.bytes} B`, `${row.selected.format} · ${row.selected.bytes} B`, `${row.dataDelta >= 0 ? '+' : ''}${row.dataDelta} B`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const candidates = document.createElement('td'); candidates.className = 'candidates'; candidates.textContent = row.candidates.map((/** @type {{format: string, bytes: number}} */ candidate) => `${candidate.format} ${candidate.bytes} B`).join(' · '); tr.append(candidates);
    body.append(tr);
  }
}

function renderAll() {
  renderImageList(); renderEditor(); renderReport();
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

function serializeConfig() {
  const lines = [
    '# Generated by Gfx Image Tool web workspace', '[general]', 'output_dir = generated',
    'output_mode = bundle', `output_file = ${settings.outputFile}`, `prefix = ${settings.prefix}`, `target = ${settings.target}`, '',
    '[color]', `format = ${settings.format}`, `mode = ${settings.mode}`, `colors = ${settings.colors}`,
    `dither = ${settings.dither}`, `threshold = ${settings.threshold}`, 'invert = false', '',
    '[alpha]', `mode = ${settings.alphaMode}`, 'matte = 000000', `threshold = ${settings.alphaThreshold}`, `color = ${settings.alphaColor}`, '',
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
  for (const section of sections) {
    const match = /^image\s+["'](.+)["']$/.exec(section.name); if (!match) continue;
    const item = images.find((candidate) => candidate.name === match[1]); if (!item) continue;
    const value = section.values;
    item.override = {
      symbol: value.symbol || undefined, mode: value.mode || undefined, format: value.format || undefined,
      colors: value.colors ? Number(value.colors) : undefined, threshold: value.threshold ? Number(value.threshold) : undefined,
      dither: value.dither || undefined,
    };
  }
  saveSettings(); applySettingsToControls(); recompute();
}

const settingIds = ['target', 'mode', 'format', 'colors', 'dither', 'threshold', 'alpha-mode', 'alpha-threshold', 'alpha-color', 'decoder-cost', 'prefer-bitmap', 'aligned-vblit', 'prefix', 'output-file'];
for (const id of settingIds) $(id).addEventListener('input', () => {
  if (id === 'target') { settings.target = targetEl.value; fillFormatOptions(select('format'), false); fillFormatOptions(select('override-format'), true); }
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
$('remove').addEventListener('click', () => { images = images.filter((item) => item.id !== selectedId); selectedId = images[0]?.id ?? 0; recompute(); });
for (const id of ['zoom', 'grid']) $(id).addEventListener('input', renderEditor);

$('download-header').addEventListener('click', () => { if (computed) download(computed.header, settings.outputFile, 'text/x-c++hdr'); });
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
select('language').addEventListener('input', async () => { await setLocale(select('language').value); applyLanguage(); renderAll(); });

function applyLanguage() {
  document.title = t('app.title'); applyTranslations(); select('language').value = currentLocale();
}

await initI18n();
applyLanguage();
applySettingsToControls();
renderAll();
