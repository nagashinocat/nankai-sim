import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestShelters, reachBeforeTsunami, WALK_SPEED, DETOUR_FACTOR } from '../../src/core/evacuation.ts';
import { distanceM } from '../../src/core/mesh.ts';
import type { Shelter } from '../../src/core/types.ts';

const origin = { lat: 34.7, lon: 136.5 };
const sh = (id: string, dLat: number, o: Partial<Shelter> = {}): Shelter => ({
  id, name: id, pos: { lat: origin.lat + dLat, lon: origin.lon }, earthquake: true, tsunami: true, ...o,
});
const opts = { hazard: 'tsunami' as const, speedMps: WALK_SPEED.standard, limit: 10 };

test('constants', () => {
  assert.equal(WALK_SPEED.standard, 1.0);
  assert.equal(WALK_SPEED.slow, 0.5);
  assert.equal(DETOUR_FACTOR, 1.3);
});

test('tsunami 指定では tsunami=false の施設を除外', () => {
  const r = nearestShelters(origin, [sh('a', 0.001, { tsunami: false }), sh('b', 0.002)], opts);
  assert.deepEqual(r.map((x) => x.shelter.id), ['b']);
});

test('earthquake 指定では earthquake=false の施設を除外', () => {
  const r = nearestShelters(origin, [sh('a', 0.001, { earthquake: false }), sh('b', 0.002)], { ...opts, hazard: 'earthquake' });
  assert.deepEqual(r.map((x) => x.shelter.id), ['b']);
});

test('近い順に limit 件', () => {
  const r = nearestShelters(origin, [sh('c', 0.003), sh('a', 0.001), sh('b', 0.002)], { ...opts, limit: 2 });
  assert.deepEqual(r.map((x) => x.shelter.id), ['a', 'b']);
});

test('同距離は入力順、limit<=0 は空', () => {
  const list = [sh('x', 0.001), sh('y', 0.001), sh('z', 0.001)];
  assert.deepEqual(nearestShelters(origin, list, opts).map((x) => x.shelter.id), ['x', 'y', 'z']);
  assert.deepEqual(nearestShelters(origin, list, { ...opts, limit: 0 }), []);
  assert.deepEqual(nearestShelters(origin, list, { ...opts, limit: -1 }), []);
});

test('walkMin = 直線距離 × 1.3 ÷ 速度 ÷ 60', () => {
  const s = sh('a', 0.01);
  const d = distanceM(origin, s.pos);
  for (const speed of [1.0, 0.5]) {
    const [r] = nearestShelters(origin, [s], { ...opts, speedMps: speed });
    assert.equal(r.distanceM, d);
    assert.ok(Math.abs(r.walkMin - (d * 1.3) / speed / 60) < 1e-9);
  }
});

for (const [walk, arr, want] of [
  [10, 20, 'ok'], [17, 20, 'tight'], [25, 20, 'no'], [10, null, 'n/a'],
  [16, 20, 'tight'], [20, 20, 'tight'],
] as const) {
  test(`reachBeforeTsunami(${walk},${arr})=${want}`, () => {
    assert.equal(reachBeforeTsunami(walk, arr), want);
  });
}
