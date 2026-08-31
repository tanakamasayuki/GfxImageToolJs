// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';

const exec = promisify(execFile);
const cli = new URL('../bin/gfx-image-tool.js', import.meta.url).pathname;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gfx-image-tool-'));
  const path = join(dir, 'pixel.png');
  const canvas = createCanvas(2, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = '#0000ff';
  context.fillRect(1, 0, 1, 1);
  await writeFile(path, await canvas.encode('png'));
  return { dir, path };
}

test('CLI builds a header from PNG', async () => {
  const { dir, path } = await fixture();
  const out = join(dir, 'pixel.h');
  const { stdout } = await exec(process.execPath, [cli, 'build', path, '--format', 'rgb565be', '--out', out, '--json']);
  const result = JSON.parse(stdout);
  assert.equal(result.bytes, 4);
  assert.equal(result.format, 'rgb565be');
  const header = await readFile(out, 'utf8');
  assert.match(header, /0xF8, 0x00, 0x00, 0x1F/);
});

test('CLI inspect emits machine-readable candidates', async () => {
  const { path } = await fixture();
  const { stdout } = await exec(process.execPath, [cli, 'inspect', path, '--json']);
  const result = JSON.parse(stdout);
  assert.equal(result.width, 2);
  assert.equal(result.height, 1);
  assert.equal(result.candidates.length, 10);
});

test('CLI rejects invalid options with exit code 3', async () => {
  const { path } = await fixture();
  await assert.rejects(exec(process.execPath, [cli, 'build', path, '--threshold', '999']), (error) => {
    assert.equal(/** @type {{code?: number}} */ (error).code, 3);
    return true;
  });
});

test('CLI initializes, builds, and checks a directory project', async () => {
  const { dir, path } = await fixture();
  const init = await exec(process.execPath, [cli, 'init', dir, '--json']);
  const initialized = JSON.parse(init.stdout);
  assert.equal(initialized.status, 'created');
  assert.equal(initialized.path, join(dir, 'images', '.imagesconfig'));
  await mkdir(join(dir, 'images'), { recursive: true });
  const imagePath = join(dir, 'images', 'pixel.png');
  await writeFile(imagePath, await readFile(path));
  await unlink(path);
  const build = await exec(process.execPath, [cli, 'build', dir, '--json']);
  const built = JSON.parse(build.stdout);
  assert.equal(built.count, 1);
  assert.equal(built.root, join(dir, 'images'));
  assert.equal(built.results[0].path, '../images.h');
  assert.equal(built.manifest.path, '.gfx-image-tool/headers.json');
  await access(join(dir, 'images.h'));
  const check = await exec(process.execPath, [cli, 'build', dir, '--check', '--json']);
  assert.equal(JSON.parse(check.stdout).results[0].status, 'upToDate');
  await writeFile(imagePath, await createCanvas(1, 1).encode('png'));
  await assert.rejects(exec(process.execPath, [cli, 'build', dir, '--check']), (error) => {
    assert.equal(/** @type {{code?: number}} */ (error).code, 2);
    return true;
  });
});

test('CLI canonical project honors configured and command-line output directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-output-dir-'));
  await exec(process.execPath, [cli, 'init', root]);
  const canvas = createCanvas(1, 1);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  await writeFile(join(root, 'images', 'pixel.png'), await canvas.encode('png'));
  await writeFile(join(root, 'images', '.imagesconfig'), '[general]\noutput_dir = ../include/generated\noutput_file = artwork.h\n');
  await exec(process.execPath, [cli, 'build', root]);
  await access(join(root, 'include', 'generated', 'artwork.h'));
  await access(join(root, 'images', '.gfx-image-tool', 'headers.json'));

  const override = join(root, 'other-output');
  await exec(process.execPath, [cli, 'build', root, '--out', override]);
  await access(join(override, 'artwork.h'));
});

test('CLI builds an auto-selected TinyGFX CellImage', async () => {
  const { dir } = await fixture();
  const input = join(dir, 'flat.png');
  const canvas = createCanvas(32, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 32, 1);
  await writeFile(input, await canvas.encode('png'));
  const out = join(dir, 'flat.h');
  const { stdout } = await exec(process.execPath, [cli, 'build', input, '--target', 'tinygfx', '--out', out, '--json']);
  const result = JSON.parse(stdout);
  assert.equal(result.target, 'tinygfx');
  assert.equal(result.format, 'rle565');
  assert.equal(result.decoderBytes, 400);
  assert.deepEqual(result.vblit, { selected: 'generic', alignedBytes: 244, genericBytes: 408 });
  assert.match(await readFile(out, 'utf8'), /tinygfxImageRle565Ops/);

  const inspected = await exec(process.execPath, [cli, 'inspect', input, '--target', 'tinygfx', '--json']);
  const report = JSON.parse(inspected.stdout);
  assert.equal(report.optimization.format, 'rle565');
  assert.ok(report.optimization.image.candidates.some((/** @type {{format: string}} */ candidate) => candidate.format === 'raw565'));
});

test('CLI directory TinyGFX override keeps auto candidates and matches one-image selection', async () => {
  const { dir } = await fixture();
  const flat = join(dir, 'flat.png');
  const canvas = createCanvas(32, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 32, 1);
  await writeFile(flat, await canvas.encode('png'));
  const single = JSON.parse((await exec(process.execPath, [cli, 'inspect', flat, '--target', 'tinygfx', '--json'])).stdout);
  const project = JSON.parse((await exec(process.execPath, [cli, 'inspect', dir, '--target', 'tinygfx', '--json'])).stdout);
  const row = project.optimization.images.find((/** @type {{key: string}} */ item) => item.key === 'flat.png');
  assert.equal(row.candidates.length, single.optimization.image.candidates.length);
  assert.deepEqual(row.individualMinimum, single.optimization.image.individualMinimum);
  assert.notEqual(row.individualMinimum.format, 'raw565');
});

test('CLI exports converted and side-by-side comparison PNG previews', async () => {
  const { dir, path } = await fixture();
  const convertedPath = join(dir, 'converted.png');
  const comparisonPath = join(dir, 'comparison.png');
  const bothPath = join(dir, 'both.png');
  await exec(process.execPath, [cli, 'build', path, '--format', 'rgb565be', '--preview', convertedPath]);
  await exec(process.execPath, [cli, 'build', path, '--format', 'rgb565be', '--preview', comparisonPath, '--preview-layout', 'comparison']);
  const both = JSON.parse((await exec(process.execPath, [cli, 'build', path, '--format', 'rgb565be', '--preview', bothPath, '--preview-layout', 'both', '--json'])).stdout);
  const { loadImage } = await import('@napi-rs/canvas');
  const converted = await loadImage(convertedPath);
  const comparison = await loadImage(comparisonPath);
  assert.deepEqual([converted.width, converted.height], [2, 1]);
  assert.deepEqual([comparison.width, comparison.height], [4, 1]);
  await access(join(dir, 'both.comparison.png'));
  assert.equal(both.preview.path, bothPath);
  assert.equal(both.comparisonPreview.path, join(dir, 'both.comparison.png'));
});

test('CLI file and directory TinyGFX builds both preserve source transparency by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-alpha-cli-'));
  const sources = join(root, 'sources');
  await mkdir(sources);
  const path = join(sources, 'alpha.png');
  const canvas = createCanvas(2, 1);
  const context = canvas.getContext('2d');
  context.fillStyle = '#00ff00'; context.fillRect(0, 0, 1, 1);
  context.clearRect(1, 0, 1, 1);
  await writeFile(path, await canvas.encode('png'));
  const single = join(root, 'single.h');
  await exec(process.execPath, [cli, 'build', path, '--target', 'tinygfx', '--out', single]);
  await exec(process.execPath, [cli, 'build', sources, '--target', 'tinygfx', '--out', join(root, 'generated')]);
  assert.match(await readFile(single, 'utf8'), /\n  1,\n};/);
  assert.match(await readFile(join(root, 'generated', 'images.h'), 'utf8'), /\n  1,\n};/);
});

test('CLI directory relative out and preview paths share the current working directory base', async () => {
  const work = await mkdtemp(join(tmpdir(), 'gfx-image-path-base-'));
  const sources = join(work, 'sources');
  await mkdir(sources);
  const canvas = createCanvas(1, 1);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  await writeFile(join(sources, 'pixel.png'), await canvas.encode('png'));
  const args = [cli, 'build', 'sources', '--out', 'outdir', '--preview', 'prevdir', '--json'];
  const built = JSON.parse((await exec(process.execPath, args, { cwd: work })).stdout);
  assert.equal(built.results[0].path, '../outdir/images.h');
  assert.equal(built.previews[0].path, '../prevdir/pixel.png');
  await access(join(work, 'outdir', 'images.h'));
  await access(join(work, 'prevdir', 'pixel.png'));
  const checked = JSON.parse((await exec(process.execPath, [...args.slice(0, -1), '--check', '--json'], { cwd: work })).stdout);
  assert.equal(checked.results[0].status, 'upToDate');
  assert.equal(checked.previews[0].status, 'upToDate');
});

test('CLI project preview config can emit and check converted and comparison images together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-preview-config-'));
  const canvas = createCanvas(1, 1);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  await writeFile(join(root, 'pixel.png'), await canvas.encode('png'));
  await writeFile(join(root, '.imagesconfig'), '[preview]\noutput_dir = previews\nlayout = both\n');
  const built = JSON.parse((await exec(process.execPath, [cli, 'build', root, '--json'])).stdout);
  assert.equal(built.previews[0].path, 'previews/pixel.png');
  assert.equal(built.previews[1].path, 'previews/pixel.comparison.png');
  const checked = JSON.parse((await exec(process.execPath, [cli, 'build', root, '--check', '--json'])).stdout);
  assert.equal(checked.previews[0].status, 'upToDate');
  assert.equal(checked.previews[1].status, 'upToDate');
  assert.equal(checked.count, 1);
});

test('CLI check rejects stale split headers and previews, then build removes them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-stale-cli-'));
  const canvas = createCanvas(1, 1);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  await writeFile(join(root, 'keep.png'), await canvas.encode('png'));
  await writeFile(join(root, 'gone.png'), await canvas.encode('png'));
  await writeFile(join(root, '.imagesconfig'), '[general]\noutput_mode = split\n[preview]\noutput_dir = previews\n');
  await exec(process.execPath, [cli, 'build', root]);
  const staleHeader = join(root, 'generated', 'gone.h');
  const stalePreview = join(root, 'previews', 'gone.png');
  await unlink(join(root, 'gone.png'));
  await assert.rejects(exec(process.execPath, [cli, 'build', root, '--check']), (error) => {
    assert.equal(/** @type {{code?: number}} */ (error).code, 2);
    return true;
  });
  await access(staleHeader);
  await access(stalePreview);
  const rebuilt = JSON.parse((await exec(process.execPath, [cli, 'build', root, '--json'])).stdout);
  assert.deepEqual(rebuilt.stale.map((/** @type {{status: string}} */ item) => item.status), ['removed']);
  assert.deepEqual(rebuilt.stalePreviews.map((/** @type {{status: string}} */ item) => item.status), ['removed']);
  await assert.rejects(access(staleHeader));
  await assert.rejects(access(stalePreview));
});

test('CLI names missing manifests instead of contradicting up-to-date output lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gfx-image-missing-manifest-'));
  const canvas = createCanvas(1, 1);
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  await writeFile(join(root, 'pixel.png'), await canvas.encode('png'));
  await writeFile(join(root, '.imagesconfig'), '[preview]\noutput_dir = previews\n');
  await exec(process.execPath, [cli, 'build', root]);
  await unlink(join(root, 'generated', '.gfx-image-tool-headers.json'));
  await unlink(join(root, 'previews', '.gfx-image-tool-previews.json'));
  await assert.rejects(exec(process.execPath, [cli, 'build', root, '--check']), (error) => {
    const failure = /** @type {{code?: number, stderr?: string}} */ (error);
    assert.equal(failure.code, 2);
    assert.match(failure.stderr ?? '', /generated\/\.gfx-image-tool-headers\.json  missing manifest/);
    assert.match(failure.stderr ?? '', /previews\/\.gfx-image-tool-previews\.json  missing manifest/);
    assert.match(failure.stderr ?? '', /output or manifest is stale, different, or missing/);
    return true;
  });
  const rebuilt = await exec(process.execPath, [cli, 'build', root]);
  assert.match(rebuilt.stderr, /header manifest was missing; stale headers could not be detected/);
  assert.match(rebuilt.stderr, /preview manifest was missing; stale previews could not be detected/);
});
