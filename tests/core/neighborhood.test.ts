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
  const r = ratesForCell(cell(), 'wood', 'pre1981')!;
  const out = estimateArea({ a: cell() }, { a: wood100 }, ['a']);
  close(out.collapse, 100 * r.collapse);
  close(out.half, 100 * r.half);
  assert.equal(out.countedMeshes, 1);
  close(meshCollapseRate(cell(), wood100)!, r.collapse);
});

test('cells か stock にないメッシュは数えず countedMeshes にも入れない', () => {
  const out = estimateArea({ a: cell(), c: cell() }, { a: wood100, b: wood100 }, ['a', 'b', 'c', 'd']);
  assert.equal(out.countedMeshes, 1);
  const r = ratesForCell(cell(), 'wood', 'pre1981')!;
  close(out.collapse, 100 * r.collapse);
});

test('intensity が null のマスは数えず、meshCollapseRate は null', () => {
  const c = cell({ intensity: null });
  assert.equal(meshCollapseRate(c, wood100), null);
  assert.deepEqual(estimateArea({ a: c }, { a: wood100 }, ['a']), { collapse: 0, half: 0, countedMeshes: 0 });
});

test('構成比で按分する', () => {
  const s: BuildingStock = { total: 200, shares: { 'wood:pre1981': 0.5, 'rc:post2000': 0.5 } };
  const a = ratesForCell(cell(), 'wood', 'pre1981')!;
  const b = ratesForCell(cell(), 'rc', 'post2000')!;
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
