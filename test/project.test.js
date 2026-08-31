// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  buildImageProject,
  buildImagesIgnoreMatcher,
  collectImageEntries,
  createImagesConfig,
  parseImagesConfig,
  resolveImageConfig,
  resolveImageProjectDirectory,
  writeImageProject,
} from '../src/node/index.js';

/** @param {string} path @param {string[]} colors */
async function png(path, colors) {
  const canvas = createCanvas(colors.length, 1);
  const context = canvas.getContext('2d');
  colors.forEach((color, x) => {
    context.fillStyle = color;
    context.fillRect(x, 0, 1, 1);
  });
  await writeFile(path, await canvas.encode('png'));
}

test('config parses strict defaults, hex matte, and per-image overrides', () => {
  const config = parseImagesConfig(`
[general]
output_dir = out
prefix = ui_

[alpha]
matte = #102030
threshold = 96
color = 123456

[image "icons/*.png"]
format = indexed8
colors = 4
alpha_threshold = 64
source_key = FF00FF

[image "**/photo.png"]
threshold = 99
`);
  assert.deepEqual(config.alpha.matte, [0x10, 0x20, 0x30]);
  assert.equal(config.alpha.threshold, 96);
  assert.equal(config.preview.layout, 'converted');
  assert.deepEqual(config.alpha.color, [0x12, 0x34, 0x56]);
  const normal = resolveImageConfig(config, 'photo.png');
  assert.equal(normal.color.format, 'rgb565be');
  const icon = resolveImageConfig(config, 'icons/wifi.png');
  assert.equal(icon.color.format, 'indexed8');
  assert.equal(icon.color.colors, 4);
  assert.equal(icon.alpha.threshold, 64);
  assert.deepEqual(icon.alpha.sourceKey, [255, 0, 255]);
  assert.equal(resolveImageConfig(config, 'photo.png').color.threshold, 99);
});

test('project source_key creates TinyGFX transparency before encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-source-key-'));
  await png(join(root, 'keyed.png'), ['#ff00ff', '#ffffff']);
  await writeFile(join(root, '.imagesconfig'), '[general]\ntarget = tinygfx\n[image "keyed.png"]\nsource_key = FF00FF\n');
  const result = await buildImageProject(root);
  assert.ok(result.images[0].encoded.transparent || /^bitmap1/.test(result.images[0].format));
  assert.equal(result.images[0].prepared.pixels[3], 0);
});

test('project alpha auto preserves TinyGFX transparency and explicit none reports compositing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-alpha-auto-'));
  const canvas = createCanvas(2, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000'; context.fillRect(0, 0, 1, 1);
  context.clearRect(1, 0, 1, 1);
  await writeFile(join(root, 'alpha.png'), await canvas.encode('png'));

  const automatic = await buildImageProject(root, { target: 'tinygfx' });
  assert.equal(automatic.warnings.length, 0);
  assert.ok(automatic.images[0].encoded.transparent);
  assert.match(automatic.bundle?.source ?? '', /\n  1,\n};/);

  await writeFile(join(root, '.imagesconfig'), '[general]\ntarget = tinygfx\n[alpha]\nmode = none\n');
  const matte = await buildImageProject(root);
  assert.equal(matte.warnings[0].code, 'ALPHA_COMPOSITED');
  assert.equal(matte.images[0].encoded.transparent, undefined);
});

test('aligned vblit defaults TinyGFX bitmap ties to vertical', () => {
  const config = parseImagesConfig('[optimize]\naligned_vblit = true\n');
  assert.equal(config.optimize.alignedVblit, true);
  assert.equal(config.optimize.preferBitmap, 'vertical');
  const explicit = parseImagesConfig('[optimize]\naligned_vblit = true\nprefer_bitmap = horizontal\n');
  assert.equal(explicit.optimize.preferBitmap, 'horizontal');
});

test('imagesignore supports directories, basenames, and reinclusion', () => {
  const ignore = buildImagesIgnoreMatcher('*.psd\ntmp/\nsecret/*.png\n!secret/keep.png\n');
  assert.equal(ignore.shouldIgnore('nested/work.psd', false), true);
  assert.equal(ignore.shouldIgnore('tmp', true), true);
  assert.equal(ignore.shouldIgnore('secret/a.png', false), true);
  assert.equal(ignore.shouldIgnore('secret/keep.png', false), false);
  assert.equal(ignore.shouldIgnore('.imagesconfig', false), true);
});

test('project input scan excludes configured generated and preview directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-scan-'));
  await mkdir(join(root, 'images'));
  await mkdir(join(root, 'generated'));
  await mkdir(join(root, 'previews'));
  await mkdir(join(root, '.gfx-image-tool'));
  await png(join(root, 'images', 'source.png'), ['#ff0000']);
  await png(join(root, 'generated', 'stale.png'), ['#00ff00']);
  await png(join(root, 'previews', 'source.png'), ['#0000ff']);
  await png(join(root, '.gfx-image-tool', 'diagnostic.png'), ['#ffffff']);
  const config = parseImagesConfig('[general]\noutput_dir = generated\n[preview]\noutput_dir = previews\n');
  const entries = await collectImageEntries(root, config);
  assert.deepEqual(entries.map((entry) => entry.relative), ['images/source.png']);
});

test('sketch resolution accepts only the canonical images directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-resolve-'));
  await mkdir(join(root, 'images'));
  assert.equal(await resolveImageProjectDirectory(root), join(root, 'images'));
  assert.equal(await resolveImageProjectDirectory(join(root, 'images')), join(root, 'images'));
  const missing = await mkdtemp(join(tmpdir(), 'gfx-image-resolve-missing-'));
  await assert.rejects(resolveImageProjectDirectory(missing), /Image project directory not found/);
});

test('project writes one header per image and check is read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-project-'));
  await mkdir(join(root, 'icons'));
  await png(join(root, 'photo.png'), ['#ff0000', '#0000ff']);
  await png(join(root, 'icons', 'wifi.png'), ['#000000', '#ffffff']);
  await png(join(root, 'skip.png'), ['#00ff00']);
  await writeFile(join(root, '.imagesignore'), 'skip.png\n');
  await writeFile(join(root, '.imagesconfig'), `
[general]
output_dir = generated
output_mode = split
prefix = ui_
index_header = all_images.h

[color]
format = rgb565be

[image "icons/*.png"]
format = indexed8
colors = 2
`);
  const written = await writeImageProject(root);
  assert.equal(written.images.length, 2);
  assert.deepEqual(written.images.map((image) => image.relative), ['icons/wifi.png', 'photo.png']);
  assert.ok(written.results.every((result) => result.status === 'written'));
  assert.match(await readFile(join(root, 'generated', 'photo.h'), 'utf8'), /ui_photo_data/);
  assert.match(await readFile(join(root, 'generated', 'icons', 'wifi.h'), 'utf8'), /ui_icons_wifi_palette/);
  assert.match(await readFile(join(root, 'generated', 'all_images.h'), 'utf8'), /#include "icons\/wifi.h"/);

  const clean = await writeImageProject(root, { check: true });
  assert.ok(clean.results.every((result) => result.status === 'upToDate'));
  const before = await readFile(join(root, 'generated', 'photo.h'), 'utf8');
  await png(join(root, 'photo.png'), ['#00ff00', '#0000ff']);
  const dirty = await writeImageProject(root, { check: true });
  assert.equal(dirty.results.find((result) => result.path.endsWith('photo.h'))?.status, 'mismatch');
  assert.equal(await readFile(join(root, 'generated', 'photo.h'), 'utf8'), before);
});

test('split project manifest detects and removes headers orphaned by deleted sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-stale-split-'));
  await png(join(root, 'keep.png'), ['#ff0000']);
  await png(join(root, 'gone.png'), ['#00ff00']);
  await writeFile(join(root, '.imagesconfig'), '[general]\noutput_dir = generated\noutput_mode = split\n');
  await writeImageProject(root);
  const staleHeader = join(root, 'generated', 'gone.h');
  await access(staleHeader);
  await unlink(join(root, 'gone.png'));

  const checked = await writeImageProject(root, { check: true });
  assert.equal(checked.manifest.status, 'mismatch');
  assert.deepEqual(checked.stale, [{ path: staleHeader, status: 'stale' }]);
  await access(staleHeader);

  const rebuilt = await writeImageProject(root);
  assert.deepEqual(rebuilt.stale, [{ path: staleHeader, status: 'removed' }]);
  await assert.rejects(access(staleHeader), (error) => /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT');
});

test('project symbols never start with an underscore or digit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-safe-symbol-'));
  await png(join(root, '2nd.png'), ['#ff0000']);
  const built = await buildImageProject(root, { target: 'tinygfx' });
  assert.equal(built.images[0].symbol, 'img_2nd');
  assert.match(built.bundle?.source ?? '', /img_2ndRef/);
});

test('init never overwrites an existing config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-init-'));
  const first = await createImagesConfig(root);
  const original = await readFile(first.path, 'utf8');
  const second = await createImagesConfig(root);
  assert.equal(first.status, 'created');
  assert.equal(first.path, join(root, 'images', '.imagesconfig'));
  assert.match(original, /output_dir = \.\./);
  assert.equal(await readFile(join(root, 'images', '.gitignore'), 'utf8'), '.gfx-image-tool/\n');
  assert.equal(second.status, 'exists');
  assert.equal(await readFile(first.path, 'utf8'), original);
});

test('TinyGFX project optimizes all images as one set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-tiny-project-'));
  await png(join(root, 'red.png'), Array(32).fill('#ff0000'));
  await png(join(root, 'blue.png'), Array(32).fill('#0000ff'));
  await writeFile(join(root, '.imagesconfig'), `
[general]
target = tinygfx
output_dir = generated

[color]
format = auto

[optimize]
decoder_cost = 400
prefer_bitmap = horizontal
`);
  const built = await writeImageProject(root);
  assert.equal(built.images.length, 2);
  assert.ok(built.optimization);
  assert.equal(built.optimization.formats.length, 1);
  assert.equal(built.optimization.decoderBytes, 400);
  assert.deepEqual(built.optimization.vblit, { selected: 'generic', alignedBytes: 244, genericBytes: 408 });
  const bundle = await readFile(join(root, 'generated', 'images.h'), 'utf8');
  assert.match(bundle, /const CellImage red/);
  assert.match(bundle, /const CellImage blue/);
  assert.match(bundle, /const TinyGFXImageRef\* const images_file_refs\[images_file_count\]/);
  assert.match(bundle, /&blueRef,\n  &redRef/);
  assert.equal(built.results.length, 1);
});

test('TinyGFX project defaults to auto and reports the same individual minimum as a one-image optimization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-tiny-auto-'));
  await png(join(root, 'flat.png'), Array(32).fill('#ff0000'));
  await writeFile(join(root, '.imagesconfig'), '[general]\ntarget = tinygfx\n[color]\nformat = rgb565be\n');
  const built = await buildImageProject(root);
  assert.equal(built.config.color.format, 'auto');
  assert.ok(built.optimization);
  assert.equal(built.optimization.report[0].candidates.length, 5);
  assert.equal(built.optimization.report[0].individualMinimum.format, 'rle565');
  assert.equal(built.images[0].format, 'rle565');
});

test('TinyGFX project preserves alpha through CellImage transparency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-tiny-alpha-'));
  const canvas = createCanvas(2, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, 1, 1);
  context.clearRect(1, 0, 1, 1);
  await writeFile(join(root, 'icon.png'), await canvas.encode('png'));
  await writeFile(join(root, '.imagesconfig'), `
[general]
target = tinygfx
output_dir = generated

[color]
format = raw565

[alpha]
mode = color-key
threshold = 128
`);
  await writeImageProject(root);
  const header = await readFile(join(root, 'generated', 'images.h'), 'utf8');
  assert.match(header, /  0x0001,\n  0,\n  1,/);
});

test('project bundle detects symbols that sanitize to the same identifier', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-symbol-collision-'));
  await png(join(root, 'a-b.png'), ['#ff0000']);
  await png(join(root, 'a_b.png'), ['#0000ff']);
  await assert.rejects(writeImageProject(root), /C symbol collision: a_b/);
});

test('indexed mode reduces TinyGFX input before a forced palette encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-tiny-indexed-'));
  await png(join(root, 'gradient.png'), Array.from({ length: 20 }, (_, i) => `rgb(${i * 12}, ${255 - i * 12}, ${i * 7})`));
  await writeFile(join(root, '.imagesconfig'), `
[general]
target = tinygfx
output_dir = generated

[color]
format = rlepal4
mode = indexed
colors = 4
`);
  const built = await writeImageProject(root);
  assert.equal(built.images[0].format, 'rlepal4');
  assert.ok(built.images[0].paletteBytes <= 8);
  assert.match(await readFile(join(root, 'generated', 'images.h'), 'utf8'), /tinygfxImageRlepal4Ops/);
});
