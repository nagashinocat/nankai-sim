import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMoved, movedNote, originLabel, resetLabel, samePlace } from '../../src/app/movepin.ts';
import { createLatestOnly } from '../../src/app/scenario.ts';

const O = { lat: 34.9667, lon: 136.6247 };
const M_LAT = 1 / 111_320;
const M_LON = 1 / (111_320 * Math.cos((O.lat * Math.PI) / 180));
const off = (n: number, e: number) => ({ lat: O.lat + n * M_LAT, lon: O.lon + e * M_LON });
const addr = { kind: 'address', label: '三重県四日市市' } as const;

test('movedNote: 方向（8方位）と距離（10m 単位）', () => {
  assert.equal(movedNote(O, off(85, 85), addr), 'ピンの位置で計算しました（住所の位置から 北東へ約120m）');
  assert.equal(movedNote(O, off(-300, 0), addr), 'ピンの位置で計算しました（住所の位置から 南へ約300m）');
  assert.equal(movedNote(O, off(0, -44), addr), 'ピンの位置で計算しました（住所の位置から 西へ約40m）');
  assert.equal(movedNote(O, off(1500, -1500), addr), 'ピンの位置で計算しました（住所の位置から 北西へ約2.1km）');
});

test('movedNote: 10m 未満は向きを言わない', () => {
  assert.equal(movedNote(O, off(3, 3), addr), 'ピンの位置で計算しました（住所の位置のすぐ近く）');
  assert.equal(movedNote(O, O, addr), 'ピンの位置で計算しました（住所の位置のすぐ近く）');
});

test('元の地点の呼び方: 住所・現在地・地図で選んだ所', () => {
  assert.equal(originLabel(addr), '住所の位置');
  assert.equal(originLabel({ kind: 'gps' }), '現在地');
  assert.equal(originLabel({ kind: 'pin' }), '地図で選んだ位置');
  assert.equal(resetLabel(addr), '住所の位置にもどす');
  assert.equal(resetLabel({ kind: 'gps' }), '現在地にもどす');
  assert.equal(movedNote(O, off(0, 200), { kind: 'gps' }), 'ピンの位置で計算しました（現在地から 東へ約200m）');
});

test('isMoved / samePlace: 1m 未満は動かしていない', () => {
  assert.equal(isMoved({ origin: O, current: O }), false);
  assert.equal(isMoved({ origin: O, current: off(0.3, 0) }), false);
  assert.equal(isMoved({ origin: O, current: off(5, 0) }), true);
  assert.equal(samePlace(O, off(0.5, 0)), true);
  assert.equal(samePlace(O, off(20, 0)), false);
});

test('世代番号: 調べ直しを続けて押したら、先に始めた（遅く終わった）計算は捨てる', async () => {
  const runs = createLatestOnly();
  let release!: (v: string) => void;
  const slow = runs.run(() => new Promise<string>((r) => { release = r; }));
  const fast = runs.run(async () => 'B');
  assert.equal(await fast, 'B');
  release('A');
  assert.equal(await slow, null);
});

test('世代番号: 住所を入れ直した（invalidate）ら、進行中の調べ直しの結果も失敗も捨てる', async () => {
  const runs = createLatestOnly();
  let release!: (v: string) => void;
  let fail!: (e: Error) => void;
  const a = runs.run(() => new Promise<string>((r) => { release = r; }));
  const b = runs.run(() => new Promise<string>((_, j) => { fail = j; }));
  runs.invalidate();
  release('A');
  fail(new Error('x'));
  assert.equal(await a, null);
  assert.equal(await b, null);
});
