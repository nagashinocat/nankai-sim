import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import { useFragilityTable, shakeRates, type FragilityTable } from '../../src/core/fragility.ts';
import { combine, ratesForCell, estimateHome, estimateLag } from '../../src/core/damage.ts';
import type { Era, HazardCell, Structure } from '../../src/core/types.ts';

const structures: Structure[] = ['wood', 'steel', 'rc'];
const eras: Era[] = ['pre1981', 'y1981_2000', 'post2000'];
const cell = (o: Partial<HazardCell> = {}): HazardCell => ({
  intensity: 6, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null, ...o,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

before(() => useFragilityTable(fixture as unknown as FragilityTable));

test('combine は二重に数えない', () => {
  close(combine([{ collapse: 0.5, half: 0 }, { collapse: 0.5, half: 0 }]).collapse, 0.75);
});

test('combine の結果は collapse+half <= 1', () => {
  const r = combine([{ collapse: 0.6, half: 0.4 }, { collapse: 0.5, half: 0.5 }, { collapse: 0.9, half: 0.1 }]);
  assert.ok(r.collapse + r.half <= 1 + 1e-12);
  assert.ok(r.collapse >= 0 && r.half >= 0);
});

test('combine は空なら被害ゼロ', () => {
  assert.deepEqual(combine([]), { collapse: 0, half: 0 });
});

test('intensity が null のマスは null', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  assert.equal(estimateHome(cell({ intensity: null }), { structure: 'wood', era: 'pre1981', retrofitted: false }), null);
  assert.equal(ratesForCell(cell({ intensity: null }), 'wood', 'pre1981'), null);
});

test('intensity が有限でなければ NaN にせず null', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.equal(ratesForCell(cell({ intensity: v }), 'wood', 'pre1981'), null);
    assert.equal(estimateHome(cell({ intensity: v }), { structure: 'unknown', era: 'unknown', retrofitted: false }), null);
  }
});

test('ratesForCell: 揺れのみなら shakeRates と同じ。沈下・津波が加わると増える', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const base = ratesForCell(cell(), 'wood', 'pre1981')!;
  assert.deepEqual(base, shakeRates(6, 'wood', 'pre1981'));
  const more = ratesForCell(cell({ settlementCm: 30, tsunamiDepth: 3 }), 'wood', 'pre1981')!;
  assert.ok(more.collapse >= base.collapse);
  assert.ok(more.collapse + more.half >= base.collapse + base.half);
  assert.ok(more.collapse + more.half <= 1 + 1e-12);
});

test('幅は ±0.5 を含む: min <= 中央値 <= max', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  for (const s of structures) for (const e of eras) {
    const c = cell({ intensity: 5.7, settlementCm: 10 });
    const mid = ratesForCell(c, s, e, undefined, 'rep')!;
    const r = estimateHome(c, { structure: s, era: e, retrofitted: false })!;
    assert.ok(r.collapse[0] <= mid.collapse && mid.collapse <= r.collapse[1]);
    assert.ok(r.half[0] <= mid.half + 1e-12 && mid.half <= r.half[1] + 1e-12);
    const lo = ratesForCell(cell({ intensity: 5.2, settlementCm: 10 }), s, e, undefined, 'min')!;
    const hi = ratesForCell(cell({ intensity: 6.2, settlementCm: 10 }), s, e, undefined, 'max')!;
    assert.ok(r.collapse[0] <= lo.collapse + 1e-12);
    assert.ok(r.collapse[1] >= hi.collapse - 1e-12);
    assert.ok(r.collapse[0] <= r.central.collapse && r.central.collapse <= r.collapse[1]);
    close(r.central.collapse, mid.collapse);
  }
});

test('unknown の幅は既知のどの選択肢の幅も含む', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const c = cell({ intensity: 5.8, settlementCm: 15, tsunamiDepth: 1 });
  const u = estimateHome(c, { structure: 'unknown', era: 'unknown', retrofitted: false })!;
  for (const s of structures) for (const e of eras) {
    const k = estimateHome(c, { structure: s, era: e, retrofitted: false })!;
    assert.ok(u.collapse[0] <= k.collapse[0] + 1e-12 && k.collapse[1] <= u.collapse[1] + 1e-12);
    assert.ok(u.half[0] <= k.half[0] + 1e-12 && k.half[1] <= u.half[1] + 1e-12);
  }
  const ws = estimateHome(c, { structure: 'wood', era: 'unknown', retrofitted: false })!;
  const wk = estimateHome(c, { structure: 'wood', era: 'post2000', retrofitted: false })!;
  assert.ok(ws.collapse[0] <= wk.collapse[0] + 1e-12 && wk.collapse[1] <= ws.collapse[1] + 1e-12);
});

test('補強済み pre1981 = 未補強 y1981_2000', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const c = cell({ intensity: 6, settlementCm: 5 });
  assert.deepEqual(
    estimateHome(c, { structure: 'wood', era: 'pre1981', retrofitted: true }),
    estimateHome(c, { structure: 'wood', era: 'y1981_2000', retrofitted: false }),
  );
});

test('補強済み post2000 = 未補強 post2000', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const c = cell({ intensity: 6.5 });
  assert.deepEqual(
    estimateHome(c, { structure: 'wood', era: 'post2000', retrofitted: true }),
    estimateHome(c, { structure: 'wood', era: 'post2000', retrofitted: false }),
  );
});

test('時間差の全壊率 >= 後発単独の全壊率', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  for (const s of structures) for (const e of eras) {
    const first = cell({ intensity: 5.5 });
    const second = cell({ intensity: 6 });
    const lag = estimateLag(first, second, s, e)!;
    const alone = ratesForCell(second, s, e, undefined, 'rep')!;
    assert.ok(lag.collapse >= alone.collapse - 1e-12, `${s}/${e}`);
    assert.ok(lag.collapse + lag.half <= 1 + 1e-12);
    assert.ok(lag.half >= -1e-12);
  }
});

test('時間差で先発の被害がゼロなら後発単独と同じ', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  for (const s of structures) for (const e of eras) {
    const lag = estimateLag(cell({ intensity: 3 }), cell({ intensity: 6 }), s, e)!;
    const alone = ratesForCell(cell({ intensity: 6 }), s, e, undefined, 'rep')!;
    close(lag.collapse, alone.collapse);
    close(lag.half, alone.half);
  }
});

test('時間差: どちらかの intensity が null なら null', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  assert.equal(estimateLag(cell({ intensity: null }), cell(), 'wood', 'pre1981'), null);
  assert.equal(estimateLag(cell(), cell({ intensity: null }), 'wood', 'pre1981'), null);
});

test('沈下量・浸水深が非有限なら null（null は従来どおり対象外）', () => {
  const input = { structure: 'wood', era: 'pre1981', retrofitted: false } as const;
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(ratesForCell(cell({ tsunamiDepth: bad }), 'wood', 'pre1981'), null);
    assert.equal(ratesForCell(cell({ settlementCm: bad }), 'wood', 'pre1981'), null);
    assert.equal(estimateHome(cell({ tsunamiDepth: bad }), input), null);
    assert.equal(estimateLag(cell(), cell({ tsunamiDepth: bad }), 'wood', 'pre1981'), null);
  }
  assert.deepEqual(
    ratesForCell(cell({ tsunamiDepth: null, settlementCm: null }), 'wood', 'pre1981'),
    ratesForCell(cell(), 'wood', 'pre1981'),
  );
  assert.notEqual(estimateHome(cell({ tsunamiDepth: null }), input), null);
});

test('時間差は国の手法: 先発で半壊した分は、後発の計測震度+0.5 の全壊率で後発を受ける', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const first: HazardCell = { intensity: 6.0, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null };
  const second: HazardCell = { ...first, intensity: 5.5 };
  for (const e of ['pre1981', 'y1981_2000', 'post2000'] as const) {
    const f = ratesForCell(first, 'wood', e, undefined, 'rep')!;
    const ri = ratesForCell(second, 'wood', e, undefined, 'rep')!;
    const rd = ratesForCell({ ...second, intensity: 6.0 }, 'wood', e, undefined, 'rep')!;
    const u = 1 - f.collapse - f.half;
    const r = estimateLag(first, second, 'wood', e, undefined, 'rep')!;
    assert.ok(Math.abs(r.collapse - (f.collapse + u * ri.collapse + f.half * rd.collapse)) < 1e-12, e);
    assert.ok(Math.abs(r.half - (u * ri.half + f.half * (1 - rd.collapse))) < 1e-12, e);
  }
});

test('estimateHome は階数を渡す（RC, 階数3 と 階数12 で結果が違う）', () => {
  useFragilityTable(fixture as unknown as FragilityTable);
  const cell: HazardCell = { intensity: 6.5, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null };
  const lo = estimateHome(cell, { structure: 'rc', era: 'pre1981', retrofitted: false, floors: 3 })!;
  const hi = estimateHome(cell, { structure: 'rc', era: 'pre1981', retrofitted: false, floors: 12 })!;
  const c3 = ratesForCell(cell, 'rc', 'pre1981', 3, 'rep')!.collapse;
  const c12 = ratesForCell(cell, 'rc', 'pre1981', 12, 'rep')!.collapse;
  assert.ok(lo.collapse[0] <= c3 && c3 <= lo.collapse[1]);
  assert.ok(hi.collapse[0] <= c12 && c12 <= hi.collapse[1]);
  assert.ok(JSON.stringify(lo) !== JSON.stringify(hi));
});

test('estimateHome: collapse[0] <= central <= collapse[1]、unknown の central は組合せの平均', () => {
  const c = cell({ intensity: 6.2 });
  const w = estimateHome(c, { structure: 'wood', era: 'pre1981', retrofitted: false })!;
  assert.ok(w.collapse[0] <= w.central.collapse && w.central.collapse <= w.collapse[1]);
  close(w.central.collapse, shakeRates(6.2, 'wood', 'pre1981', undefined, 'rep').collapse);
  const u = estimateHome(c, { structure: 'unknown', era: 'unknown', retrofitted: false })!;
  let sum = 0;
  for (const s of structures) for (const e of eras) sum += ratesForCell(c, s, e, undefined, 'rep')!.collapse;
  close(u.central.collapse, sum / 9);
});

test('estimateHome: 木造 pre1981 の下限は 1972-80 クラス側（以前の包絡のみの幅より広い）', () => {
  const c = cell({ intensity: 6 });
  const r = estimateHome(c, { structure: 'wood', era: 'pre1981', retrofitted: false })!;
  const old = [-0.5, 0, 0.5].map((d) => shakeRates(6 + d, 'wood', 'pre1981').collapse);
  assert.ok(r.collapse[0] < Math.min(...old) - 1e-6);
  close(r.collapse[1], Math.max(...old));
  close(r.collapse[0], shakeRates(5.5, 'wood', 'pre1981', undefined, 'min').collapse);
});

test('estimateLag の既定は rep', () => {
  const a = cell({ intensity: 6 }), b = cell({ intensity: 5.5 });
  assert.deepEqual(estimateLag(a, b, 'wood', 'pre1981'), estimateLag(a, b, 'wood', 'pre1981', undefined, 'rep'));
});
