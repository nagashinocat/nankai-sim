import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import { useFragilityTable, type FragilityTable } from '../../src/core/fragility.ts';
import { ratesForCell } from '../../src/core/damage.ts';
import { estimateArea, meshCollapseRate } from '../../src/core/neighborhood.ts';
import type { BuildingStock, HazardCell } from '../../src/core/types.ts';

const cell = (o: Partial<HazardCell> = {}): HazardCell => ({
  intensity: 6, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null, ...o,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
const wood100: BuildingStock = { total: 100, shares: { 'wood:pre1981': 1 } };

before(() => useFragilityTable(fixture as unknown as FragilityTable));

test('建物100棟・全部 wood:pre1981 なら 100 × 全壊率', () => {
  const r = ratesForCell(cell(), 'wood', 'pre1981', undefined, 'rep')!;
  const out = estimateArea({ a: cell() }, { a: wood100 }, ['a']);
  close(out.collapse, 100 * r.collapse);
  close(out.half, 100 * r.half);
  assert.equal(out.countedMeshes, 1);
  close(meshCollapseRate(cell(), wood100)!, r.collapse);
});

test('cells か stock にないメッシュは数えず countedMeshes にも入れない', () => {
  const out = estimateArea({ a: cell(), c: cell() }, { a: wood100, b: wood100 }, ['a', 'b', 'c', 'd']);
  assert.equal(out.countedMeshes, 1);
  const r = ratesForCell(cell(), 'wood', 'pre1981', undefined, 'rep')!;
  close(out.collapse, 100 * r.collapse);
});

test('intensity が null のマスは数えず、meshCollapseRate は null', () => {
  const c = cell({ intensity: null });
  assert.equal(meshCollapseRate(c, wood100), null);
  assert.deepEqual(estimateArea({ a: c }, { a: wood100 }, ['a']), { collapse: 0, half: 0, countedMeshes: 0 });
});

test('構成比で按分する', () => {
  const s: BuildingStock = { total: 200, shares: { 'wood:pre1981': 0.5, 'rc:post2000': 0.5 } };
  const a = ratesForCell(cell(), 'wood', 'pre1981', undefined, 'rep')!;
  const b = ratesForCell(cell(), 'rc', 'post2000', undefined, 'rep')!;
  close(meshCollapseRate(cell(), s)!, 0.5 * a.collapse + 0.5 * b.collapse);
  close(estimateArea({ a: cell() }, { a: s }, ['a']).collapse, 200 * (0.5 * a.collapse + 0.5 * b.collapse));
});

test('shares の合計が 1 から 0.01 以上ずれていたら例外', () => {
  const bad: BuildingStock = { total: 100, shares: { 'wood:pre1981': 0.98 } };
  assert.throws(() => meshCollapseRate(cell(), bad));
  assert.throws(() => estimateArea({ a: cell() }, { a: bad }, ['a']));
  const ok: BuildingStock = { total: 100, shares: { 'wood:pre1981': 0.995 } };
  assert.ok(meshCollapseRate(cell(), ok) !== null);
});

test('BuildingStock の不正値は Error（FragilityDataMissingError ではない）', () => {
  const c = cell();
  const bad = (stock: BuildingStock) => assert.throws(
    () => meshCollapseRate(c, stock),
    (e: unknown) => e instanceof Error && e.name !== 'FragilityDataMissingError',
  );
  bad({ total: 10, shares: { 'wood:pre1981': 1.5, 'rc:post2000': -0.5 } });
  bad({ total: NaN, shares: { 'wood:pre1981': 1 } });
  bad({ total: -1, shares: { 'wood:pre1981': 1 } });
  bad({ total: Infinity, shares: { 'wood:pre1981': 1 } });
  bad({ total: 10, shares: { 'wood:unknown': 1 } as never });
  bad({ total: 10, shares: { 'brick:pre1981': 1 } as never });
  bad({ total: 10, shares: { 'wood:pre1981': NaN } });
  assert.throws(() => estimateArea({ a: c }, { a: { total: NaN, shares: { 'wood:pre1981': 1 } } }, ['a']), Error);
});

// ---- 時間差（先発→後発）の周辺推計 ----
import { estimateLag } from '../../src/core/damage.ts';
import { estimateAreaLag, meshLagCollapseRate } from '../../src/core/neighborhood.ts';

test('meshLagCollapseRate / estimateAreaLag: 全部 wood:pre1981 なら estimateLag(rep) の全壊率 × 棟数', () => {
  const f = cell({ intensity: 5.5, tsunamiDepth: 3 }), s = cell({ intensity: 6, tsunamiDepth: 2 });
  // 先発の津波は無視する（先発は揺れ・液状化だけ）
  const expect = estimateLag({ ...f, tsunamiDepth: null }, s, 'wood', 'pre1981', undefined, 'rep')!;
  close(meshLagCollapseRate(f, s, wood100)!, expect.collapse);
  const out = estimateAreaLag({ a: f }, { a: s }, { a: wood100 }, ['a']);
  close(out.collapse, 100 * expect.collapse);
  close(out.half, 100 * expect.half);
  assert.equal(out.countedMeshes, 1);
});

test('estimateAreaLag: 先発・後発・建物のどれかが無い/無効なメッシュは数えない。合計は先発だけ以上', () => {
  const f = { a: cell({ intensity: 5.5 }), b: cell({ intensity: 5.5 }), c: cell({ intensity: 5.5 }), d: cell({ intensity: null }) };
  const s = { a: cell({ intensity: 6 }), c: cell({ intensity: 6 }), d: cell({ intensity: 6 }) };
  const st = { a: wood100, b: wood100, d: wood100 };
  const out = estimateAreaLag(f, s, st, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(out.countedMeshes, 1); // a だけ（b は後発なし、c は建物なし、d は先発の震度 null）
  assert.ok(out.collapse >= estimateArea({ a: f.a }, { a: wood100 }, ['a']).collapse - 1e-9);
  assert.equal(meshLagCollapseRate(cell({ intensity: null }), cell(), wood100), null);
  assert.equal(meshLagCollapseRate(cell(), cell({ intensity: null }), wood100), null);
});
