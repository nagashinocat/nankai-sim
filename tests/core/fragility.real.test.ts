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

test('階数を指定すると、その階数区分の曲線だけを使う（RC, 計測震度7.0, 1981年以前）', () => {
  const at7 = (cls: string) => table.shake.groups.rc!.classes[cls]!.find(([x]) => Math.abs(x - 7.0) < 1e-9)![1];
  const low = Math.max(at7('≤1971/1-6階'), at7('1972-80/1-6階'));
  const high = Math.max(at7('≤1971/11-15階'), at7('1972-80/11-15階'));
  assert.equal(shakeRates(7.0, 'rc', 'pre1981', 3).collapse, low);
  assert.equal(shakeRates(7.0, 'rc', 'pre1981', 12).collapse, high);
  assert.ok(low < high);
});

test('階数を指定しないときは全階数の包絡（従来どおり）', () => {
  assert.deepEqual(shakeRates(6.5, 'steel', 'pre1981'), shakeRates(6.5, 'steel', 'pre1981', 7));
});

test('16階以上の S造・RC造は被害なし（内閣府: 16階以上は損傷しない）', () => {
  assert.deepEqual(shakeRates(7.0, 'rc', 'pre1981', 16), { collapse: 0, half: 0 });
  assert.deepEqual(shakeRates(7.0, 'steel', 'post2000', 30), { collapse: 0, half: 0 });
});

test('木造は階数を無視する', () => {
  assert.deepEqual(shakeRates(6.4, 'wood', 'pre1981', 2), shakeRates(6.4, 'wood', 'pre1981'));
});

test('不正な階数は RangeError', () => {
  for (const f of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => shakeRates(6.0, 'rc', 'pre1981', f), RangeError);
  }
});

test("代表曲線: 木造 pre1981 @6.4 は 1963-71 クラス ≈59.2%", () => {
  const r = shakeRates(6.4, 'wood', 'pre1981', undefined, 'rep');
  assert.ok(Math.abs(r.collapse * 100 - 59.2) < 0.5, `${r.collapse}`);
  assert.ok(r.collapse < shakeRates(6.4, 'wood', 'pre1981').collapse);
});
