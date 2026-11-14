import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxDistance, bearingDeg, dir8, dir8Kids, localXY, minimapModel, niceScale, walkMinutes } from '../../src/app/minimap.ts';
import type { Shelter } from '../../src/core/types.ts';

const O = { lat: 34.7, lon: 136.5 };
const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const sh = (id: string, lat: number, lon: number): Shelter => ({ id, name: id, pos: { lat, lon }, earthquake: true, tsunami: true });

test('bearingDeg: 真北・真東・南西', () => {
  near(bearingDeg(O, { lat: O.lat + 0.01, lon: O.lon }), 0, 1e-6);
  near(bearingDeg(O, { lat: O.lat, lon: O.lon + 0.01 }), 90, 0.01);
  near(bearingDeg(O, { lat: O.lat - 0.01, lon: O.lon }), 180, 1e-6);
  const sw = bearingDeg(O, { lat: O.lat - 0.005, lon: O.lon - 0.005 / Math.cos((O.lat * Math.PI) / 180) });
  near(sw, 225, 0.1);
  near(bearingDeg(O, { lat: O.lat, lon: O.lon - 0.01 }), 270, 0.01);
});

test('bearingDeg: 同じ地点は 0（NaN にならない）', () => {
  assert.equal(bearingDeg(O, O), 0);
});

test('dir8 / dir8Kids: 22.5° の境界', () => {
  assert.equal(dir8(0), '北');
  assert.equal(dir8(22.4), '北');
  assert.equal(dir8(22.5), '北東');
  assert.equal(dir8(67.4), '北東');
  assert.equal(dir8(67.5), '東');
  assert.equal(dir8(180), '南');
  assert.equal(dir8(225), '南西');
  assert.equal(dir8(337.4), '北西');
  assert.equal(dir8(337.5), '北');
  assert.equal(dir8(359.9), '北');
  assert.equal(dir8(360), '北');
  assert.equal(dir8(-10), '北');
  assert.equal(dir8Kids(0), 'きた');
  assert.equal(dir8Kids(45), 'きたひがし');
  assert.equal(dir8Kids(135), 'みなみひがし');
  assert.equal(dir8Kids(225), 'みなみにし');
  assert.equal(dir8Kids(315), 'きたにし');
});

test('localXY: 東が +x、北が +y', () => {
  const ne = localXY(O, { lat: O.lat + 0.001, lon: O.lon + 0.001 });
  assert.ok(ne.x > 0 && ne.y > 0);
  const sw = localXY(O, { lat: O.lat - 0.001, lon: O.lon - 0.001 });
  assert.ok(sw.x < 0 && sw.y < 0);
  near(localXY(O, { lat: O.lat + 0.001, lon: O.lon }).y, 111.19, 0.1);
  assert.deepEqual(localXY(O, O), { x: 0, y: 0 });
});

test('niceScale: 枠の幅の 1/4〜1/2', () => {
  assert.equal(niceScale(200), 100);
  assert.equal(niceScale(1000), 500);
  assert.equal(niceScale(600), 250);
  assert.equal(niceScale(450), 200);
  assert.equal(niceScale(4000), 2000);
  for (const w of [200, 333, 450, 600, 875, 1000, 1500, 2600, 3999, 4000]) {
    const s = niceScale(w);
    assert.ok(s >= w / 4 && s <= w / 2, `${w} → ${s}`);
  }
  assert.equal(niceScale(50), 50);
  assert.equal(niceScale(0), 50);
  assert.equal(niceScale(100_000), 2000);
});

test('approxDistance / walkMinutes', () => {
  assert.equal(approxDistance(347), '約350m');
  assert.equal(approxDistance(1234), '約1.2km');
  assert.equal(approxDistance(0), '約0m');
  assert.equal(approxDistance(Number.NaN), '約0m');
  assert.equal(walkMinutes(350, 0.5), Math.ceil((350 * 1.3) / 0.5 / 60));
  assert.equal(walkMinutes(0, 0.5), 0);
});

test('minimapModel: target は枠の 80% 以内、北東への文', () => {
  const t = sh('t', O.lat + 0.0025, O.lon + 0.003);
  const m = minimapModel(O, t, [], 240);
  const r = Math.hypot(m.target.x - 120, m.target.y - 120);
  assert.ok(r <= 0.8 * 120 + 1e-6, `r=${r}`);
  assert.ok(m.target.x > 120 && m.target.y < 120, '北東は右上');
  assert.equal(m.target.dir, '北東');
  assert.match(m.dirText, /^北東へ 約\d+m$/);
  assert.ok(m.scale.px > 0 && m.scale.px <= 120);
  assert.ok(m.walkSlowMin > 0);
});

test('minimapModel: 遠い target でも枠内', () => {
  const t = sh('far', O.lat - 0.03, O.lon - 0.02);
  const m = minimapModel(O, t, [], 300);
  const r = Math.hypot(m.target.x - 150, m.target.y - 150);
  near(r, 0.8 * 150, 1);
  assert.equal(m.target.dir, '南西');
  assert.match(m.dirText, /^南西へ 約\d\.\dkm$/);
  assert.match(m.scale.label, /^(\d+m|\dkm)$/);
});

test('minimapModel: ほかの避難場所は枠内だけ（target は除く）', () => {
  const t = sh('t', O.lat + 0.002, O.lon);
  const inBox = sh('in', O.lat - 0.001, O.lon + 0.001);
  const outBox = sh('out', O.lat + 0.05, O.lon + 0.05);
  const m = minimapModel(O, t, [t, inBox, outBox], 240);
  assert.deepEqual(m.others.map((o) => o.name), ['in']);
  for (const o of m.others) assert.ok(o.x >= 0 && o.x <= 240 && o.y >= 0 && o.y <= 240);
});

test('minimapModel: 距離 0m（同じ地点）でも NaN にならない', () => {
  const m = minimapModel(O, sh('same', O.lat, O.lon), [sh('o', O.lat, O.lon)], 240);
  for (const v of [m.target.x, m.target.y, m.target.bearing, m.scale.px, m.halfM, m.walkSlowMin]) assert.ok(Number.isFinite(v));
  assert.equal(m.target.x, 120);
  assert.equal(m.target.y, 120);
  assert.equal(m.here, true);
  assert.equal(m.dirText, 'すぐ近く（約10m以内）');
  assert.equal(m.halfM, 100);
});
