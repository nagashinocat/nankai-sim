import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_TEXT, accuracyNote, geoErrorKind, nearLists, walkText } from '../../src/app/near.ts';
import type { Shelter } from '../../src/core/types.ts';

const O = { lat: 34.7, lon: 136.5 };
// 緯度 0.001° ≒ 111m
const sh = (id: string, dLat: number, o: Partial<Shelter> = {}): Shelter => ({
  id, name: id, pos: { lat: O.lat + dLat, lon: O.lon }, earthquake: true, tsunami: true, ...o,
});

test('nearLists: 津波・地震の順、各5件、近い順。2km 以内があれば広げない', () => {
  const list = Array.from({ length: 8 }, (_, i) => sh(`s${i}`, 0.001 * (8 - i)));
  const [t, q] = nearLists(O, list);
  assert.equal(t.hazard, 'tsunami');
  assert.equal(q.hazard, 'earthquake');
  assert.deepEqual(t.hits.map((h) => h.shelter.id), ['s7', 's6', 's5', 's4', 's3']);
  assert.equal(t.widened, false);
  assert.equal(t.pool.length, 8);
});

test('nearLists: 災害の種類で分ける', () => {
  const [t, q] = nearLists(O, [sh('quakeOnly', 0.001, { tsunami: false }), sh('tsunamiOnly', 0.002, { earthquake: false })]);
  assert.deepEqual(t.hits.map((h) => h.shelter.id), ['tsunamiOnly']);
  assert.deepEqual(q.hits.map((h) => h.shelter.id), ['quakeOnly']);
});

test('nearLists: 2km 以内に無ければ 5km まで広げる。5km より遠いものは出さない', () => {
  const [t] = nearLists(O, [sh('3km', 0.027), sh('6km', 0.054)]);
  assert.deepEqual(t.hits.map((h) => h.shelter.id), ['3km']);
  assert.equal(t.widened, true);
  assert.deepEqual(t.pool.map((s) => s.id), ['3km']);
});

test('nearLists: 0件', () => {
  const lists = nearLists(O, [sh('far', 0.1)]);
  assert.ok(lists.every((l) => l.hits.length === 0 && !l.widened));
  assert.deepEqual(nearLists(O, []).map((l) => l.hits.length), [0, 0]);
});

test('walkText: 結果画面と同じ書き方', () => {
  assert.deepEqual(walkText(300), { standard: `約${Math.ceil((300 * 1.3) / 60)}分`, slow: `約${Math.ceil((300 * 1.3) / 0.5 / 60)}分` });
});

test('accuracyNote: 100m を超えたら', () => {
  assert.equal(accuracyNote(50), null);
  assert.equal(accuracyNote(100), null);
  assert.equal(accuracyNote(null), null);
  assert.equal(accuracyNote(Number.NaN), null);
  assert.match(accuracyNote(347)!, /^位置の誤差が約350mあります/);
  assert.match(accuracyNote(1500)!, /約1\.5km/);
});

test('geoErrorKind と文言: 拒否・失敗・非対応で、すること が書いてある', () => {
  assert.equal(geoErrorKind(1), 'denied');
  assert.equal(geoErrorKind(2), 'failed');
  assert.equal(geoErrorKind(3), 'failed');
  assert.equal(geoErrorKind(undefined), 'failed');
  assert.match(NEAR_TEXT.denied, /許可/);
  assert.match(NEAR_TEXT.failed, /もう一度/);
  assert.match(NEAR_TEXT.unsupported, /住所/);
  assert.match(NEAR_TEXT.tsunamiOffline, /調べられません/);
});
