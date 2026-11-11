import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, buildReport } from '../../scripts/reconcile.ts';

const row = (published: number | null, computed: number) => ({ municipality: 'A', case: 'L2', published, computed });

test('±30% の境界: 1.29 は合格、1.32 は不合格', () => {
  const [a] = reconcile([row(1000, 1290)]);
  const [b] = reconcile([row(1000, 1320)]);
  assert.equal(a!.pass, true);
  assert.equal(b!.pass, false);
  assert.ok(Math.abs(a!.ratio! - 1.29) < 1e-9);
});

test('下側の境界: 0.71 は合格、0.68 は不合格', () => {
  assert.equal(reconcile([row(1000, 710)])[0]!.pass, true);
  assert.equal(reconcile([row(1000, 680)])[0]!.pass, false);
});

test('ちょうど ±30% は合格', () => {
  assert.equal(reconcile([row(1000, 1300)])[0]!.pass, true);
  assert.equal(reconcile([row(1000, 700)])[0]!.pass, true);
});

test('許容幅は引数で変えられる', () => {
  assert.equal(reconcile([row(1000, 1290)], 0.2)[0]!.pass, false);
});

test('公表値が null（「-」）は ratio も pass も null', () => {
  const [r] = reconcile([row(null, 50)]);
  assert.equal(r!.ratio, null);
  assert.equal(r!.pass, null);
});

test('レポートに manifest の notes と合否表が載る', () => {
  const res = reconcile([row(1000, 1100), row(null, 3)]);
  const md = buildReport(res, [{ id: 'housing-land-survey', notes: '非住宅にも住宅の割合を当てた仮定' }]);
  assert.ok(md.includes('非住宅にも住宅の割合を当てた仮定'));
  assert.ok(md.includes('housing-land-survey'));
  assert.ok(md.includes('1/1') || md.includes('1 / 1'));
});

import { resolveHazardCase, prefectureTotal } from '../../scripts/reconcile.ts';

test('CSV の L2 は --hazard-case で指定したハザードに対応づく', () => {
  assert.equal(resolveHazardCase('L2', 'L2_RIKU'), 'L2_RIKU');
  assert.equal(resolveHazardCase('L2', 'L2'), 'L2');
});

test('未知の CSV ケースやハザードケースは例外', () => {
  assert.throws(() => resolveHazardCase('L1', 'L2_RIKU'));
  assert.throws(() => resolveHazardCase('L2', 'BOGUS'));
});

test('県計: 計算値の合計と 内閣府約157,000・県約152,000 との比', () => {
  const t = prefectureTotal([row(1000, 78500), row(null, 78500)]);
  assert.equal(t.computed, 157000);
  assert.ok(Math.abs(t.ratioCabinet - 1) < 1e-9);
  assert.ok(Math.abs(t.ratioPref - 157000 / 152000) < 1e-9);
});

test('レポートに県計行とスキップしたメッシュ数が載る', () => {
  const res = reconcile([row(1000, 1100)]);
  const md = buildReport(res, [], { hazardCase: 'L2_RIKU', skipped: 7, prefecture: prefectureTotal([row(1000, 1100)]) });
  assert.ok(md.includes('県計'));
  assert.ok(md.includes('157,000'));
  assert.ok(md.includes('L2_RIKU'));
  assert.ok(/スキップ.*7/.test(md));
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeMunicipality } from '../../scripts/reconcile.ts';
import { useFragilityTable, shakeRates } from '../../src/core/fragility.ts';
import type { FragilityTable } from '../../src/core/fragility.ts';

test('computeMunicipality: Σ total×share×collapse(Ia) と欠落メッシュのスキップ', () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/fragility.synthetic.json', import.meta.url)), 'utf8')) as FragilityTable;
  useFragilityTable(fx);
  const files: Record<string, unknown> = {
    'public/data/hazard/L2_RIKU/523644.json': { '5236442023': [6.0, null, null, null, null], '5236442024': [5.0, null, null, null, null] },
    'public/data/stock/523644.json': {
      '5236442023': { total: 100, shares: { 'wood:pre1981': 0.6, 'rc:post2000': 0.4 } },
      '5236442024': { total: 50, shares: { 'wood:y1981_2000': 1 } },
      '5236442025': { total: 10, shares: { 'wood:pre1981': 1 } }, // ハザードなし
    },
  };
  const reader = (p: string) => {
    if (!(p in files)) throw new Error(`unexpected ${p}`);
    return files[p];
  };
  const expected =
    100 * 0.6 * shakeRates(6.0, 'wood', 'pre1981', undefined, 'rep').collapse +
    100 * 0.4 * shakeRates(6.0, 'rc', 'post2000', undefined, 'rep').collapse +
    50 * 1 * shakeRates(5.0, 'wood', 'y1981_2000', undefined, 'rep').collapse;
  assert.ok(expected > 0);
  const r = computeMunicipality('L2_RIKU', ['5236442023', '5236442024'], new Map(), new Map(), reader);
  assert.ok(Math.abs(r.sum - expected) < 1e-9);
  assert.equal(r.skipped, 0);
  const r2 = computeMunicipality('L2_RIKU', ['5236442023', '5236442025', '5236442099'], new Map(), new Map(), reader);
  assert.equal(r2.skipped, 2);
});
