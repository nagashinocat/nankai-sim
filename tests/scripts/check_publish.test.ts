import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublish } from '../../scripts/check_publish.ts';

const NO_INDEX = Symbol('no index');

function tmpDist(withHazard: boolean, index: unknown = ['523644']): string {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(d, 'data'), { recursive: true });
  writeFileSync(join(d, 'index.html'), '<html></html>');
  if (withHazard) {
    mkdirSync(join(d, 'data', 'hazard', 'L2'), { recursive: true });
    writeFileSync(join(d, 'data', 'hazard', 'L2', '523644.json'), '{}');
    if (index !== NO_INDEX) writeFileSync(join(d, 'data', 'hazard', 'L2', 'index.json'), JSON.stringify(index));
  }
  return d;
}

test('hazard あり＋allow=false → エラー1件', () => {
  const d = tmpDist(true);
  try {
    const errs = checkPublish(d, false);
    assert.equal(errs.length, 1);
    assert.match(errs[0]!, /ALLOW_HAZARD_PUBLISH/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('hazard あり＋allow=true → エラー0件', () => {
  const d = tmpDist(true);
  try { assert.deepEqual(checkPublish(d, true), []); } finally { rmSync(d, { recursive: true, force: true }); }
});

test('hazard なし → エラー（想定データの無い公開物は「対応していません」しか出せない）', () => {
  const d = tmpDist(false);
  try {
    for (const allow of [false, true]) {
      const errs = checkPublish(d, allow);
      assert.equal(errs.length, 1);
      assert.match(errs[0]!, /想定データ/);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('hazard/L2 の index.json が無い・空・壊れている → エラー', () => {
  for (const index of [NO_INDEX, [], 'oops', { a: 1 }]) {
    const d = tmpDist(true, index);
    try {
      if (index === 'oops') writeFileSync(join(d, 'data', 'hazard', 'L2', 'index.json'), 'oops');
      const errs = checkPublish(d, true);
      assert.equal(errs.length, 1, String(JSON.stringify(index)));
      assert.match(errs[0]!, /index\.json/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('dist が存在しない → エラー1件', () => {
  const errs = checkPublish(join(tmpdir(), 'no-such-dist-dir-xyz'), true);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /見つかりません/);
});
