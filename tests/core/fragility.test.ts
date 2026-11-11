import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import {
  FragilityDataMissingError,
  shakeRates,
  liquefactionRates,
  tsunamiRates,
  useFragilityTable,
  validateFragilityTable,
  clearFragilityTable,
  type FragilityTable,
} from '../../src/core/fragility.ts';
import type { Era, Structure } from '../../src/core/types.ts';

// fixture は人工データ（出典なし）。実データ転記後は docs/fragility-data-todo.md を参照。
const table = fixture as unknown as FragilityTable;
const clone = (): FragilityTable => JSON.parse(JSON.stringify(fixture));
const structures: Structure[] = ['wood', 'steel', 'rc'];
const eras: Era[] = ['pre1981', 'y1981_2000', 'post2000'];

// 登録前に呼ぶテストを先頭に置く（node:test は同一ファイル内を宣言順に実行）
test('表を登録する前は FragilityDataMissingError を投げる', () => {
  clearFragilityTable();
  assert.throws(() => shakeRates(6, 'wood', 'pre1981'), FragilityDataMissingError);
  assert.throws(() => liquefactionRates(10, 'wood', 'pre1981'), FragilityDataMissingError);
  assert.throws(() => tsunamiRates(2, 'wood'), FragilityDataMissingError);
});

test('fixture は検証を通る', () => {
  assert.deepEqual(validateFragilityTable(table), []);
  useFragilityTable(table);
});

test('震度が上がると全壊率は減らない（全構造・全年代）', () => {
  for (const s of structures) for (const e of eras) {
    let prev = 0;
    for (let i = 3.0; i <= 7.6; i += 0.1) {
      const r = shakeRates(i, s, e);
      assert.ok(r.collapse >= prev - 1e-12, `${s}/${e} @${i}`);
      prev = r.collapse;
    }
  }
});

test('同じ震度なら古い年代ほど全壊率が高い（木造, 計測震度6.5）', () => {
  const r = (e: Era) => shakeRates(6.5, 'wood', e).collapse;
  assert.ok(r('pre1981') > r('y1981_2000'));
  assert.ok(r('y1981_2000') > r('post2000'));
});

test('steel/rc は y1981_2000 と post2000 が同一クラスなので >= で比較', () => {
  for (const s of ['steel', 'rc'] as Structure[]) {
    const r = (e: Era) => shakeRates(6.5, s, e).collapse;
    assert.ok(r('pre1981') >= r('y1981_2000'));
    assert.ok(r('y1981_2000') >= r('post2000'));
  }
});

test('表の範囲外は端の値で固定し、例外にしない', () => {
  assert.deepEqual(shakeRates(7.6, 'wood', 'pre1981'), shakeRates(7.0, 'wood', 'pre1981')); // fixture の上限は 7.0
  assert.deepEqual(shakeRates(3.0, 'rc', 'post2000'), { collapse: 0, half: 0 });
  assert.deepEqual(liquefactionRates(99, 'wood', 'pre1981'), liquefactionRates(35, 'wood', 'pre1981'));
  assert.deepEqual(tsunamiRates(30, 'wood'), tsunamiRates(8, 'wood'));
  assert.deepEqual(tsunamiRates(-1, 'rc'), { collapse: 0, half: 0 });
});

test('collapse + half <= 1、half >= 0（全キー・全点）', () => {
  for (const s of structures) for (const e of eras) {
    for (let i = 3.0; i <= 7.6; i += 0.1) {
      const r = shakeRates(i, s, e);
      assert.ok(r.half >= -1e-12 && r.collapse + r.half <= 1 + 1e-12);
    }
    for (let d = 0; d <= 40; d += 1) {
      const r = liquefactionRates(d, s, e);
      assert.ok(r.half >= -1e-12 && r.collapse + r.half <= 1 + 1e-12);
    }
  }
  for (const s of structures) for (let d = 0; d <= 10; d += 0.25) {
    const r = tsunamiRates(d, s);
    assert.ok(r.half >= -1e-12 && r.collapse + r.half <= 1 + 1e-12);
  }
});

test('表の点の間は線形補間する', () => {
  const pts = table.shake.groups.wood!.classes['2002-']!;
  const [x0, c0, t0] = pts[4]!;
  const [x1, c1, t1] = pts[5]!;
  const r = shakeRates((x0 + x1) / 2, 'wood', 'post2000');
  assert.ok(Math.abs(r.collapse - (c0 + c1) / 2) < 1e-12);
  assert.ok(Math.abs(r.collapse + r.half - (t0 + t1) / 2) < 1e-12);
});

test('エンベロープ: 対応クラスの全壊率・全半壊率それぞれの最大値を返す', () => {
  const classes = table.shake.groups.wood!.classes;
  const x = 6.5;
  const at = (k: string, col: 1 | 2) => {
    const p = classes[k]!;
    const i = p.findIndex(q => q[0] === x);
    return p[i]![col]!;
  };
  const ks = ['≤1962', '1963-71', '1972-80'];
  const r = shakeRates(x, 'wood', 'pre1981');
  assert.equal(r.collapse, Math.max(...ks.map(k => at(k, 1))));
  assert.ok(Math.abs(r.collapse + r.half - Math.max(...ks.map(k => at(k, 2)))) < 1e-12);
});

test('エンベロープ: 液状化 steel/rc は非木造の杭・アスペクト比クラスの最大、津波は DID/非DID の最大', () => {
  const nw = table.liquefaction.groups.nonwood!.classes;
  const at = (k: string, x: number) => nw[k]!.find(p => p[0] === x)![1]!;
  const r = liquefactionRates(15, 'rc', 'pre1981');
  assert.equal(r.collapse, Math.max(at('杭無し', 15), at('杭有り細長≤1974', 15), at('杭有り細長1975-83', 15)));
  const w = table.tsunami.groups.wood!.classes;
  const t = tsunamiRates(3, 'wood');
  assert.equal(t.collapse, Math.max(...Object.values(w).map(c => c.find(p => p[0] === 3)![1]!)));
});

test('検証: x が単調非減少でない表を拒否する', () => {
  const t = clone();
  const c = t.shake.groups.wood!.classes['≤1962']!;
  [c[2], c[3]] = [c[3]!, c[2]!];
  assert.ok(validateFragilityTable(t).length > 0);
  assert.throws(() => useFragilityTable(t));
});

test('検証: collapse + half > 1 を拒否する（全半壊率が 1 超 / 全壊率 > 全半壊率）', () => {
  const t = clone();
  t.tsunami.groups.wood!.classes['DID']![3] = [3, 0.5, 1.2];
  assert.ok(validateFragilityTable(t).length > 0);
  const u = clone();
  u.tsunami.groups.wood!.classes['DID']![3] = [3, 0.6, 0.5];
  assert.ok(validateFragilityTable(u).length > 0);
});

test('検証: 年代対応表が存在しないクラスを指すと拒否する', () => {
  const t = clone();
  t.shake.groups.wood!.eraMap!.post2000 = ['存在しない'];
  assert.ok(validateFragilityTable(t).length > 0);
});

test('失敗した useFragilityTable は直前の登録を壊さない', () => {
  const before = shakeRates(6.5, 'wood', 'pre1981');
  const t = clone();
  t.shake.groups.wood!.eraMap!.post2000 = ['存在しない'];
  assert.throws(() => useFragilityTable(t));
  assert.deepEqual(shakeRates(6.5, 'wood', 'pre1981'), before);
});

test('非有限の入力は RangeError（0 被害にしない）', () => {
  useFragilityTable(table);
  for (const x of [NaN, Infinity, -Infinity]) {
    assert.throws(() => shakeRates(x, 'wood', 'pre1981'), RangeError);
    assert.throws(() => liquefactionRates(x, 'wood', 'pre1981'), RangeError);
    assert.throws(() => tsunamiRates(x, 'wood'), RangeError);
  }
});

// 実データの抜き取り確認は tests/core/fragility.real.test.ts に移動

test('mode: min <= rep <= max（木造 pre1981・RC pre1981 階数なし）', () => {
  useFragilityTable(table);
  for (const [st, e] of [['wood', 'pre1981'], ['rc', 'pre1981']] as const) {
    for (const i of [4.8, 5.3, 5.8, 6.2, 6.6, 7.0]) {
      const lo = shakeRates(i, st, e, undefined, 'min');
      const rep = shakeRates(i, st, e, undefined, 'rep');
      const hi = shakeRates(i, st, e, undefined, 'max');
      assert.ok(lo.collapse <= rep.collapse + 1e-12 && rep.collapse <= hi.collapse + 1e-12, `${st} @${i}`);
      assert.ok(lo.collapse + lo.half <= rep.collapse + rep.half + 1e-12, `${st} total @${i}`);
      assert.ok(rep.collapse + rep.half <= hi.collapse + hi.half + 1e-12, `${st} total @${i}`);
    }
  }
  assert.deepEqual(shakeRates(6, 'wood', 'pre1981'), shakeRates(6, 'wood', 'pre1981', undefined, 'max'));
});

test("mode 'rep': 木造 pre1981 は 1963-71 クラスの値", () => {
  useFragilityTable(table);
  const cls = table.shake.groups.wood!.classes['1963-71']!;
  const pt = cls.find(([x]) => x === 5.5)!;
  const r = shakeRates(5.5, 'wood', 'pre1981', undefined, 'rep');
  assert.ok(Math.abs(r.collapse - pt[1]) < 1e-12);
  assert.ok(Math.abs(r.half - (pt[2] - pt[1])) < 1e-12);
});

test("mode 'min': 木造 pre1981 は 3 クラスの最小", () => {
  useFragilityTable(table);
  const at = (c: string) => table.shake.groups.wood!.classes[c]!.find(([x]) => x === 5.5)![1];
  assert.ok(Math.abs(shakeRates(5.5, 'wood', 'pre1981', undefined, 'min').collapse - Math.min(at('≤1962'), at('1963-71'), at('1972-80'))) < 1e-12);
});

test("mode 'rep': 階数で代表クラスが残らなければ階数で絞った eraMap に戻す（RC pre1981, 12階）", () => {
  useFragilityTable(table);
  assert.deepEqual(shakeRates(6.5, 'rc', 'pre1981', 12, 'rep'), shakeRates(6.5, 'rc', 'pre1981', 12, 'max'));
});

test("repMap のない液状化・津波では 'rep' は 'max' と同じ。'min' <= 'max'", () => {
  useFragilityTable(table);
  assert.deepEqual(liquefactionRates(15, 'wood', 'pre1981', 'rep'), liquefactionRates(15, 'wood', 'pre1981'));
  assert.deepEqual(tsunamiRates(3, 'rc', 'rep'), tsunamiRates(3, 'rc'));
  assert.ok(tsunamiRates(3, 'rc', 'min').collapse <= tsunamiRates(3, 'rc').collapse);
});

test('validator: repMap のクラスが classes にない／eraMap にない', () => {
  const t = clone();
  t.shake.groups.wood!.repMap = { pre1981: ['nope'], y1981_2000: ['1981-89'], post2000: ['2002-'] };
  assert.ok(validateFragilityTable(t).some((m) => m.includes('repMap') && m.includes('nope')));
  const t2 = clone();
  t2.shake.groups.wood!.repMap = { pre1981: ['2002-'], y1981_2000: ['1981-89'], post2000: ['2002-'] };
  assert.ok(validateFragilityTable(t2).some((m) => m.includes('repMap.pre1981')));
});
