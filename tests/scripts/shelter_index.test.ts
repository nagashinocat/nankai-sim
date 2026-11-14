import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildShelterIndex } from '../../scripts/shelter_index.ts';

test('buildShelterIndex: ファイル名の一覧（並べ替え）・件数・大きさ・manifest の更新日', () => {
  const d = mkdtempSync(join(tmpdir(), 'data-'));
  mkdirSync(join(d, 'shelters'));
  const a = JSON.stringify([{ id: '1' }, { id: '2' }]);
  const b = JSON.stringify([{ id: '3' }]);
  writeFileSync(join(d, 'shelters', '523644.json'), a);
  writeFileSync(join(d, 'shelters', '503515.json'), b);
  writeFileSync(join(d, 'shelters', 'index.json'), '{"files":[]}'); // 自分自身は入れない
  writeFileSync(join(d, 'shelters', 'README.txt'), 'x');
  writeFileSync(join(d, 'manifest.json'), JSON.stringify({ datasets: [{ id: 'other', processedDate: '2000-01-01' }, { id: 'gsi-shelters', processedDate: '2026-11-12' }] }));
  const idx = buildShelterIndex(d);
  assert.deepEqual(idx.files, ['503515.json', '523644.json']);
  assert.equal(idx.count, 3);
  assert.equal(idx.bytes, a.length + b.length);
  assert.equal(idx.updated, '2026-11-12');
});

test('buildShelterIndex: データが無くても空の一覧', () => {
  const d = mkdtempSync(join(tmpdir(), 'data-'));
  assert.deepEqual(buildShelterIndex(d), { files: [], updated: null, count: 0, bytes: 0 });
});
