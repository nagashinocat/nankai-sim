import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import { useFragilityTable, type FragilityTable } from '../../src/core/fragility.ts';
import { createDataSource, type Fetcher } from '../../src/app/data.ts';
import { areaLagViewModel, areaViewModel, homeLagViewModel, homeViewModel } from '../../src/app/viewmodel.ts';
import { SCENARIO_LABELS, SCENARIOS, computeScenario, createLatestOnly, type ScenarioContext } from '../../src/app/scenario.ts';
import { TSUNAMI_BANDS } from '../../src/core/tsunami.ts';
import type { HomeInput } from '../../src/core/types.ts';

before(() => useFragilityTable(fixture as unknown as FragilityTable));

const MESH = '5236442023';
const row = (i: number | null) => [i, null, null, null, null];
function files(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/data/hazard/L2/index.json': ['523644'],
    '/data/hazard/L2/523644.json': { [MESH]: row(6.5), '5236442024': row(6.4), '5236449998': row(null) },
    '/data/hazard/HALF_E/523644.json': { [MESH]: row(6.0), '5236442024': row(5.9), '5236449998': row(null) },
    '/data/hazard/HALF_W/523644.json': { [MESH]: row(5.4), '5236442024': row(5.3) },
    ...over,
  };
}
function dsOf(f: Record<string, unknown>, failing: string[] = []) {
  const fetcher: Fetcher = async (url) => {
    if (failing.some((x) => url.includes(x))) return { ok: false, status: 500, json: async () => ({}) };
    if (url in f) return { ok: true, status: 200, json: async () => f[url] };
    return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  };
  return createDataSource(fetcher);
}
const input: HomeInput = { structure: 'unknown', era: 'unknown', retrofitted: false };
const band = TSUNAMI_BANDS[1];
const stock = { [MESH]: { total: 500, shares: { 'wood:pre1981': 1 } }, '5236442024': { total: 300, shares: { 'wood:y1981_2000': 1 } } };
const ctx = (over: Partial<ScenarioContext> = {}): ScenarioContext => ({
  mesh: MESH, meshes: [MESH, '5236442024'], input, homeTsunami: band, arrival: { min: 20, cm: 30 }, stock,
  areaTsunamiDepth: async () => 1.5, ...over,
});
const cellOf = (i: number) => ({ intensity: i, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null });

test('シナリオ名はタブ名（この順）', () => {
  assert.deepEqual(SCENARIOS.map((s) => SCENARIO_LABELS[s]),
    ['最大クラス', '東側の半割れ', '西側の半割れ', '時間差（東→西）', '時間差（西→東）']);
});

test('L2: homeViewModel / areaViewModel と同じ結果。地図の色は全壊率', async () => {
  const r = await computeScenario(dsOf(files()), ctx(), 'L2');
  const cells = { [MESH]: { ...cellOf(6.5), tsunamiDepth: 1.5 }, '5236442024': { ...cellOf(6.4), tsunamiDepth: 1.5 } };
  assert.deepEqual(r.home, homeViewModel(cellOf(6.5), input, band, { min: 20, cm: 30 }));
  assert.deepEqual(r.area, areaViewModel(cells, stock, [MESH, '5236442024']));
  assert.equal(r.meshRates.length, 2);
  assert.ok(r.meshRates.every((m) => typeof m.rate === 'number'));
});

test('HALF_E / HALF_W はそのケースのセルで計算する', async () => {
  const d = dsOf(files());
  const e = await computeScenario(d, ctx(), 'HALF_E');
  assert.deepEqual(e.home, homeViewModel(cellOf(6.0), input, band, { min: 20, cm: 30 }));
  const w = await computeScenario(d, ctx(), 'HALF_W');
  assert.deepEqual(w.home, homeViewModel(cellOf(5.4), input, band, { min: 20, cm: 30 }));
});

test('時間差: EW は 先発 HALF_E・後発 HALF_W、WE は逆。周辺・地図も合計', async () => {
  const d = dsOf(files());
  const ew = await computeScenario(d, ctx(), 'LAG_EW');
  const L = ['先発（東側）', '後発まで含めた合計'] as const;
  assert.deepEqual(ew.home, homeLagViewModel(cellOf(6.0), cellOf(5.4), input, band, { min: 20, cm: 30 }, L, ['東側', '西側']));
  const we = await computeScenario(d, ctx(), 'LAG_WE');
  assert.deepEqual(we.home, homeLagViewModel(cellOf(5.4), cellOf(6.0), input, band, { min: 20, cm: 30 }, ['先発（西側）', '後発まで含めた合計'], ['西側', '東側']));
  const t = (i: number) => ({ ...cellOf(i), tsunamiDepth: 1.5 });
  assert.deepEqual(ew.area, areaLagViewModel(
    { [MESH]: cellOf(6.0), '5236442024': cellOf(5.9) }, { [MESH]: t(5.4), '5236442024': t(5.3) }, stock, [MESH, '5236442024']));
  assert.ok(ew.meshRates.every((m) => typeof m.rate === 'number'));
});

test('片方のケースのファイルが無い → そのシナリオだけ nodata。L2 など他は無事', async () => {
  const f = files();
  delete f['/data/hazard/HALF_W/523644.json'];
  const d = dsOf(f);
  for (const s of ['HALF_W', 'LAG_EW', 'LAG_WE'] as const) assert.equal((await computeScenario(d, ctx(), s)).home.status, 'nodata', s);
  for (const s of ['L2', 'HALF_E'] as const) assert.equal((await computeScenario(d, ctx(), s)).home.status, 'ok', s);
});

test('そのメッシュの行が無い・震度 null → nodata。先発が null の時間差も nodata（後発だけで計算しない）', async () => {
  const f = files({ '/data/hazard/HALF_E/523644.json': { [MESH]: row(null) } });
  const d = dsOf(f);
  assert.equal((await computeScenario(d, ctx(), 'HALF_E')).home.status, 'nodata');
  assert.equal((await computeScenario(d, ctx(), 'LAG_EW')).home.status, 'nodata');
  assert.equal((await computeScenario(d, ctx(), 'LAG_WE')).home.status, 'nodata'); // 後発が null
  assert.equal((await computeScenario(d, ctx(), 'HALF_W')).home.status, 'ok');
});

test('通信エラー: 半割れ・時間差は error（nodata とは別）、L2 は例外（再試行できる）', async () => {
  const d = dsOf(files(), ['HALF_E/523644']);
  assert.equal((await computeScenario(d, ctx(), 'HALF_E')).home.status, 'error');
  assert.equal((await computeScenario(d, ctx(), 'LAG_EW')).home.status, 'error');
  assert.equal((await computeScenario(d, ctx(), 'LAG_WE')).home.status, 'error');
  assert.equal((await computeScenario(d, ctx(), 'HALF_W')).home.status, 'ok');
  await assert.rejects(computeScenario(dsOf(files(), ['L2/523644']), ctx(), 'L2'));
});

test('対応範囲外（L2 の index に無い）は全シナリオ outside', async () => {
  for (const s of SCENARIOS) assert.equal((await computeScenario(dsOf(files()), ctx({ mesh: '5300001111', meshes: [] }), s)).home.status, 'outside', s);
});

test('createLatestOnly: 古い要求の結果は捨てる（最後に選んだものだけ出る）', async () => {
  const latest = createLatestOnly();
  let slow!: (v: string) => void;
  const a = latest.run(() => new Promise<string>((r) => (slow = r)));
  const b = latest.run(async () => 'B');
  assert.equal(await b, 'B');
  slow('A');
  assert.equal(await a, null);
  // 単独なら返る。invalidate 後に完了したものは捨てる
  assert.equal(await latest.run(async () => 'C'), 'C');
  let late!: (v: string) => void;
  const d = latest.run(() => new Promise<string>((r) => (late = r)));
  latest.invalidate();
  late('D');
  assert.equal(await d, null);
});

test('createLatestOnly: 古い要求の失敗は黙って捨て、最新の失敗は投げる', async () => {
  const latest = createLatestOnly();
  let fail!: (e: Error) => void;
  const a = latest.run(() => new Promise<string>((_, rej) => (fail = rej)));
  const b = latest.run(async () => 'B');
  fail(new Error('x'));
  assert.equal(await a, null);
  assert.equal(await b, 'B');
  await assert.rejects(latest.run(async () => { throw new Error('y'); }));
});

test('自宅が範囲外でも、周辺（範囲内のマス）の推計と地図は出す（自宅だけ outside）', async () => {
  // 自宅 5236449998 は L2 のファイルに行はあるが…ここでは自宅を「行の無いメッシュ」にして隣県扱いにする
  const OUT = '5236449999';
  for (const s of SCENARIOS) {
    const r = await computeScenario(dsOf(files()), ctx({ mesh: OUT, meshes: [OUT, MESH, '5236442024'] }), s);
    assert.equal(r.home.status, 'outside', s);
    assert.equal(r.area.status, 'ok', s);
    assert.equal(r.meshRates.length, 3);
    assert.equal(r.meshRates[0].rate, null);
    assert.equal(typeof r.meshRates[1].rate, 'number', s);
  }
});

test('同じファイルは1回しか取りに行かない（L2 の事前確認 + computeScenario + 全タブ）', async () => {
  const f = files();
  const counts = new Map<string, number>();
  const ds = createDataSource(async (url) => {
    counts.set(url, (counts.get(url) ?? 0) + 1);
    return url in f ? { ok: true, status: 200, json: async () => f[url] } : { ok: false, status: 404, json: async () => ({}) };
  });
  await ds.hazardCell('L2', MESH); // main.ts の事前確認
  for (const s of SCENARIOS) await computeScenario(ds, ctx(), s);
  for (const [url, n] of counts) assert.equal(n, 1, url);
  assert.ok(counts.has('/data/hazard/L2/523644.json'));
});
