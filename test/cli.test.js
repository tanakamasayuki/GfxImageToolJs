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
  assert.equal(result.candidates.length, 9);
});

test('CLI rejects invalid options with exit code 3', async () => {
  const { path } = await fixture();
  await assert.rejects(exec(process.execPath, [cli, 'build', path, '--threshold', '999']), (error) => {
    assert.equal(/** @type {{code?: number}} */ (error).code, 3);
    return true;
  });
});
