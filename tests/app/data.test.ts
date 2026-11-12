import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataSource, type Fetcher } from '../../src/app/data.ts';
import { latLonToMesh250 } from '../../src/core/mesh.ts';

function fake(files: Record<string, unknown>) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url in files) return { ok: true, status: 200, json: async () => files[url] };
    return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  };
  return { fetcher, calls };
}

const H = '/data/hazard/L2';
const hazardFiles = {
  [`${H}/index.json`]: ['523644', '523645'],
  // 5236442026 = 5県内だが想定値が無い（全項目 null の行）。行の無い 5236449999 は5県外（隣県）
  [`${H}/523644.json`]: { '5236442023': [6.5, 12.3, 4.5, 2.1, 25], '5236442024': [5.0, null, null, null, null], '5236442026': [null, null, null, null, null] },
  [`${H}/523645.json`]: { '5236452011': [6.0, 1, 2, 3, 4] },
};

test('hazardCell: 配列をオブジェクトに変換する', async () => {
  const ds = createDataSource(fake(hazardFiles).fetcher);
  assert.deepEqual(await ds.hazardCell('L2', '5236442023'), {
    intensity: 6.5, pl: 12.3, settlementCm: 4.5, tsunamiDepth: 2.1, tsunamiArrivalMin: 25,
  });
  assert.deepEqual(await ds.hazardCell('L2', '5236442024'), {
    intensity: 5.0, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null,
  });
});

test('hazardCell: 対応範囲（index.json）に無い2次メッシュは outside。ファイルは取りに行かない', async () => {
  const { fetcher, calls } = fake(hazardFiles);
  const ds = createDataSource(fetcher);
  assert.equal(await ds.hazardCell('L2', '5300001111'), 'outside');
  assert.deepEqual(calls, [`${H}/index.json`]);
});

test('covers: 250m メッシュ単位（Ruling F1）。index.json にあり、ファイルに行がある（null の行も）メッシュだけ true', async () => {
  const ds = createDataSource(fake(hazardFiles).fetcher);
  assert.equal(await ds.covers('L2', '5236442023'), true);
  assert.equal(await ds.covers('L2', '5236452011'), true);
  assert.equal(await ds.covers('L2', '5236442026'), true); // 5県内・想定値なし
  assert.equal(await ds.covers('L2', '5236449999'), false); // 同じ2次メッシュの隣県のメッシュ
  assert.equal(await ds.covers('L2', '5300001111'), false);
});

test('hazardCell: 対応範囲内なのにファイルが404 → 読み込み失敗（outside にしない）', async () => {
  const files = { [`${H}/index.json`]: ['523644', '999999'] };
  const ds = createDataSource(fake(files).fetcher);
  await assert.rejects(ds.hazardCell('L2', '9999991111'));
});

test('hazardCell: index.json が無い・壊れている → 読み込み失敗（outside にしない）', async () => {
  await assert.rejects(createDataSource(fake({}).fetcher).hazardCell('L2', '5236442023'));
  await assert.rejects(createDataSource(fake({ [`${H}/index.json`]: { not: 'a list' } }).fetcher).covers('L2', '5236442023'));
});

test('hazardCell: 失敗は覚えず、再試行で取り直す', async () => {
  let fail = true;
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/523644.json') && fail) return { ok: false, status: 404, json: async () => ({}) };
    if (url in hazardFiles) return { ok: true, status: 200, json: async () => (hazardFiles as Record<string, unknown>)[url] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const ds = createDataSource(fetcher);
  await assert.rejects(ds.hazardCell('L2', '5236442023'));
  fail = false;
  assert.equal((await ds.hazardCell('L2', '5236442023') as { intensity: number }).intensity, 6.5);
  assert.equal(calls.filter((c) => c.endsWith('/523644.json')).length, 2);
});

test('hazardCell: ファイルはあるがメッシュの行が無い（5県外の隣県のメッシュ）→ outside（Ruling F1）', async () => {
  const ds = createDataSource(fake(hazardFiles).fetcher);
  assert.equal(await ds.hazardCell('L2', '5236449999'), 'outside');
});

test('hazardCell: 5県内で想定値の無いメッシュ（全項目 null の行）→ null（データなし。outside とは別）', async () => {
  const ds = createDataSource(fake(hazardFiles).fetcher);
  assert.equal(await ds.hazardCell('L2', '5236442026'), null);
});

test('同じ2次メッシュは1回だけ取得する（404も）', async () => {
  const { fetcher, calls } = fake(hazardFiles);
  const ds = createDataSource(fetcher);
  await ds.hazardCell('L2', '5236442023');
  await ds.hazardCell('L2', '5236442024');
  await ds.hazardFor('L2', ['5236442023']);
  await ds.hazardCell('L2', '5300001111');
  await ds.hazardCell('L2', '5300002222');
  assert.deepEqual(calls, [`${H}/index.json`, `${H}/523644.json`]);
});

test('hazardFor: 対応範囲内のファイルが読めなければ読み込み失敗', async () => {
  const files = { ...hazardFiles, [`${H}/index.json`]: ['523644', '523645', '530000'] };
  await assert.rejects(createDataSource(fake(files).fetcher).hazardFor('L2', ['5236442023', '5300001111']));
});

test('hazardFor: 複数の2次メッシュにまたがり、無いセルと範囲外は含めない', async () => {
  const ds = createDataSource(fake(hazardFiles).fetcher);
  const r = await ds.hazardFor('L2', ['5236442023', '5236452011', '5236449999', '5236442026', '5300001111']);
  assert.deepEqual(Object.keys(r).sort(), ['5236442023', '5236452011']);
  assert.equal(r['5236452011']!.tsunamiArrivalMin, 4);
});

test('stockFor: 複数の2次メッシュにまたがり、無いものは含めない', async () => {
  const a = { total: 2, shares: { 'wood:pre1981': 0.5 } };
  const b = { total: 3, shares: {} };
  const { fetcher } = fake({
    '/data/stock/523644.json': { '5236442023': a },
    '/data/stock/523645.json': { '5236452011': b },
  });
  const ds = createDataSource(fetcher);
  const r = await ds.stockFor(['5236442023', '5236452011', '5236442099', '5300001111']);
  assert.deepEqual(r, { '5236442023': a, '5236452011': b });
});

test('municipalityOf: 対応表を1回だけ取得して逆引きする', async () => {
  const { fetcher, calls } = fake({
    '/data/stock/municipality_meshes.json': { 津市: ['5236442023'], 四日市市: ['5236345944'] },
  });
  const ds = createDataSource(fetcher);
  assert.equal(await ds.municipalityOf('5236442023'), '津市');
  assert.equal(await ds.municipalityOf('5236345944'), '四日市市');
  assert.equal(await ds.municipalityOf('0000000000'), null);
  assert.deepEqual(calls, ['/data/stock/municipality_meshes.json']);
});

test('manifest: 取得して返す。base を変えられる', async () => {
  const m = { datasets: [{ id: 'x', source: 's' }] };
  const { fetcher, calls } = fake({ '/base/manifest.json': m });
  const ds = createDataSource(fetcher, '/base');
  assert.deepEqual(await ds.manifest(), m);
  assert.deepEqual(calls, ['/base/manifest.json']);
});

test('404以外のエラーは例外にする', async () => {
  const ds = createDataSource(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(ds.hazardCell('L2', '5236442023'));
});

test('sheltersNear: 隣接8メッシュ+中心のファイルを読み、404は空、半径で絞る', async () => {
  const center = { lat: 35.02, lon: 136.5072 };
  const m2 = latLonToMesh250(center).slice(0, 6);
  const mk = (id: string, lat: number, lon: number) => ({
    id, name: id, pos: { lat, lon }, earthquake: true, tsunami: false,
  });
  const east = latLonToMesh250({ lat: 35.02, lon: 136.5072 + 1 / 8 }).slice(0, 6);
  const far = latLonToMesh250({ lat: 35.02 + 2 / 12, lon: 136.5072 }).slice(0, 6);
  const { fetcher, calls } = fake({
    [`/data/shelters/${m2}.json`]: [mk('near', 35.0205, 136.5072), mk('mid', 35.03, 136.5072)],
    [`/data/shelters/${east}.json`]: [mk('east', 35.02, 136.5072 + 1 / 8 - 0.0005)],
    [`/data/shelters/${far}.json`]: [mk('far', 35.19, 136.5)],
  });
  const ds = createDataSource(fetcher);
  const r = await ds.sheltersNear(center, 1000);
  assert.deepEqual(r.map((s) => s.id).sort(), ['near'].sort());
  assert.equal(calls.length, 9);
  assert.ok(calls.includes(`/data/shelters/${east}.json`));
  assert.ok(!calls.includes(`/data/shelters/${far}.json`));
  // 境界の近く: 東隣のファイルの避難場所も拾う
  const edge = { lat: 35.02, lon: 136.5072 + 1 / 8 - 0.0008 };
  const r2 = await createDataSource(fetcher).sheltersNear(edge, 500);
  assert.ok(r2.some((s) => s.id === 'east'));
  // キャッシュ: 同じデータソースで再度呼んでも再取得しない
  await ds.sheltersNear(center, 1000);
  assert.equal(calls.length, 9 + 9);
});

test('sheltersNear: 全ファイル404なら空配列', async () => {
  const ds = createDataSource(fake({}).fetcher);
  assert.deepEqual(await ds.sheltersNear({ lat: 35.02, lon: 136.5072 }, 1000), []);
});

test('静的ホストが無いファイルを index.html（200）で返す（W6）: 避難場所は「無い」、ハザードは読み込み失敗', async () => {
  const html: Fetcher = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  const ds = createDataSource(html);
  await assert.rejects(ds.hazardCell('L2', '5236442023'));
  assert.deepEqual(await ds.sheltersNear({ lat: 35.02, lon: 136.5072 }, 1000), []);
  // content-type が無くても JSON として壊れていれば同じ
  const bare: Fetcher = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(createDataSource(bare).hazardCell('L2', '5236442023'));
  // index.json は読めるが、範囲内のファイルが HTML で返る
  const mixed: Fetcher = async (url) => url.endsWith('/index.json')
    ? { ok: true, status: 200, json: async () => ['523644'] }
    : html(url);
  await assert.rejects(createDataSource(mixed).hazardCell('L2', '5236442023'));
});

test('tsunamiArrival: 市町村名で {min, cm} を返す。min が null（「－」）もそのまま。無い名前は null', async () => {
  const ds = createDataSource(fake({ '/data/tsunami_arrival.json': { 尾鷲市: { min: 3, cm: 30 }, 朝日町: { min: null, cm: 30 }, 熱海市: { min: 24, cm: 50 } } }).fetcher);
  assert.deepEqual(await ds.tsunamiArrival('尾鷲市'), { min: 3, cm: 30 });
  assert.deepEqual(await ds.tsunamiArrival('熱海市'), { min: 24, cm: 50 });
  assert.deepEqual(await ds.tsunamiArrival('朝日町'), { min: null, cm: 30 });
  assert.equal(await ds.tsunamiArrival('どこかの市'), null);
});

test('tsunamiArrival: 形の違う値（古い形式の数値・cm 無し・文字列）は null', async () => {
  const ds = createDataSource(fake({ '/data/tsunami_arrival.json': { 旧: 3, 無cm: { min: 3 }, 文字: { min: '3', cm: 30 }, 負: { min: 3, cm: -1 }, ヌル: null } }).fetcher);
  for (const m of ['旧', '無cm', '文字', '負', 'ヌル']) assert.equal(await ds.tsunamiArrival(m), null, m);
});

test('tsunamiArrival: ファイルが404 → null', async () => {
  const ds = createDataSource(fake({}).fetcher);
  assert.equal(await ds.tsunamiArrival('尾鷲市'), null);
});
