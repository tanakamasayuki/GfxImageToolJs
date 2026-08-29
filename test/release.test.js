// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseChangelog, syncSourceVersion, unreleasedEntries } from '../scripts/sync-version.js';

test('release helpers require and move pending changelog entries', () => {
  const changelog = '# Changelog\n\n## Unreleased\n\n- (EN) Added.\n- (JA) 追加。\n\n## 0.0.1\n\nold\n';
  assert.match(unreleasedEntries(changelog), /Added/);
  const released = releaseChangelog(changelog, '0.1.0');
  assert.match(released, /## Unreleased\n\n## 0\.1\.0\n\n- \(EN\) Added/);
});

test('source version synchronization is exact', () => {
  assert.equal(syncSourceVersion("export const VERSION = '0.0.1';\n", '1.2.3'), "export const VERSION = '1.2.3';\n");
});
