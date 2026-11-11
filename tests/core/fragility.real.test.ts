import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { validateFragilityTable, useFragilityTable, shakeRates, tsunamiRates } from '../../src/core/fragility.ts';
import type { FragilityTable } from '../../src/core/fragility.ts';
import real from '../../src/data/fragility.json' with { type: 'json' };

const table = real as unknown as FragilityTable;
before(() => useFragilityTable(table));

test('内閣府の読み取り表は検証を通る', () => {
  assert.deepEqual(validateFragilityTable(table), []);
});

test('転記の抜き取り確認: 木造 全壊率 @計測震度6.4 が愛媛県資料(p.18)の値と ±1.5pt 以内', () => {
  // 愛媛県地震被害想定調査 p.18（内閣府の曲線を引用）: 71, 60, 41, 11, 4, 1 (%)
  const expected: Record<string, number> = { '≤1962': 71, '1963-71': 60, '1972-80': 41, '1981-89': 11, '1990-2001': 4, '2002-': 1 };
  for (const [cls, pct] of Object.entries(expected)) {
    const pt = table.shake.groups.wood!.classes[cls]!.find(([x]) => Math.abs(x - 6.4) < 1e-9)!;
    assert.ok(Math.abs(pt[1] * 100 - pct) <= 1.5, `${cls}: ${pt[1] * 100} vs ${pct}`);
  }
});

test('年代が新しいほど全壊率は低い（木造, 計測震度6.4, 包絡後）', () => {
  const r = (e: 'pre1981' | 'y1981_2000' | 'post2000') => shakeRates(6.4, 'wood', e).collapse;
  assert.ok(r('pre1981') > r('y1981_2000') && r('y1981_2000') > r('post2000'));
});

test('計測震度4.5未満・浸水深0mは被害なし', () => {
  assert.deepEqual(shakeRates(4.0, 'wood', 'pre1981'), { collapse: 0, half: 0 });
  assert.deepEqual(tsunamiRates(0, 'wood'), { collapse: 0, half: 0 });
});
