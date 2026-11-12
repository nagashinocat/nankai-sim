import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeArrival } from '../../src/app/arrival.ts';
import type { Arrival } from '../../src/app/data.ts';

const ds = (own: string | null, table: Record<string, Arrival | null>) => ({
  municipalityOf: async () => own,
  tsunamiArrival: async (m: string) => table[m] ?? null,
});

test('到達時間は自宅のマス自身の市町村から引く（高さ cm も一緒に）', async () => {
  assert.deepEqual(await homeArrival(ds('尾鷲市', { 尾鷲市: { min: 3, cm: 30 } }), 'm'), { min: 3, cm: 30 });
  assert.deepEqual(await homeArrival(ds('熱海市', { 熱海市: { min: 24, cm: 50 } }), 'm'), { min: 24, cm: 50 });
});

test('自宅のマスに市町村が無い（隣のマスには有る）→ null（判定しない）', async () => {
  // 周辺から推測した名前が表に有っても使わない: municipalityOf(自宅) が null なら到達時間なし
  assert.equal(await homeArrival(ds(null, { 四日市市: { min: 15, cm: 30 } }), 'home'), null);
});

test('表に無い・読み込み失敗は null', async () => {
  assert.equal(await homeArrival(ds('岐阜市', {}), 'm'), null);
  assert.equal(await homeArrival({ municipalityOf: async () => '津市', tsunamiArrival: async () => { throw new Error('x'); } }, 'm'), null);
});
