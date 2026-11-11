import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGsiResponse, searchAddress } from '../../src/app/geocode.ts';
import type { Fetcher } from '../../src/app/data.ts';

const sample = [
  { geometry: { type: 'Point', coordinates: [136.5072, 35.02] }, properties: { title: '三重県三重郡菰野町吉澤' } },
  { geometry: { type: 'Point', coordinates: [136.4, 35.1] }, properties: { title: '三重県いなべ市' } },
];

test('parseGsiResponse: [lon,lat] を {lat,lon} に入れ替える', () => {
  assert.deepEqual(parseGsiResponse(sample), [
    { label: '三重県三重郡菰野町吉澤', pos: { lat: 35.02, lon: 136.5072 } },
    { label: '三重県いなべ市', pos: { lat: 35.1, lon: 136.4 } },
  ]);
});

test('parseGsiResponse: 不正な形式は []', () => {
  assert.deepEqual(parseGsiResponse(null), []);
  assert.deepEqual(parseGsiResponse({ a: 1 }), []);
  assert.deepEqual(parseGsiResponse([{ geometry: { coordinates: ['x', 1] }, properties: { title: 'a' } }]), []);
  assert.deepEqual(parseGsiResponse([{ geometry: {}, properties: {} }, 5, null]), []);
});

test('searchAddress: GSI の URL に encodeURIComponent した q で問い合わせる', async () => {
  const urls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => sample };
  };
  const r = await searchAddress(' 菰野町 役場 ', fetcher);
  assert.equal(r.length, 2);
  assert.deepEqual(urls, [
    'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent('菰野町 役場'),
  ]);
});

test('searchAddress: 空白のみは通信しない', async () => {
  let n = 0;
  const fetcher: Fetcher = async () => { n++; return { ok: true, status: 200, json: async () => [] }; };
  assert.deepEqual(await searchAddress('  　 ', fetcher), []);
  assert.equal(n, 0);
});

test('searchAddress: 通信エラー・HTTPエラーは例外', async () => {
  await assert.rejects(searchAddress('a', async () => { throw new TypeError('network'); }));
  await assert.rejects(searchAddress('a', async () => ({ ok: false, status: 500, json: async () => [] })));
});
