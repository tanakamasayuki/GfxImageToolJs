// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  assert.equal(JSON.parse(init.stdout).status, 'created');
  const build = await exec(process.execPath, [cli, 'build', dir, '--json']);
  assert.equal(JSON.parse(build.stdout).count, 1);
  const check = await exec(process.execPath, [cli, 'build', dir, '--check', '--json']);
  assert.equal(JSON.parse(check.stdout).results[0].status, 'upToDate');
  await writeFile(path, await createCanvas(1, 1).encode('png'));
  await assert.rejects(exec(process.execPath, [cli, 'build', dir, '--check']), (error) => {
    assert.equal(/** @type {{code?: number}} */ (error).code, 2);
    return true;
  });
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
