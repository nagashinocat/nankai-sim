import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latLonToMesh250, meshCenter, mesh2Of, meshesWithin } from '../../src/core/mesh.ts';

// 値は J-SHIS 地震ハザードカルテのメッシュコードと中心座標
const cases: [number, number, string][] = [
  [34.9656, 136.6234, '5236345944'], // 四日市市諏訪町
  [34.8823, 136.5828, '5236245643'], // 鈴鹿市神戸
  [35.1823, 136.9078, '5236671243'], // 名古屋市中区三の丸
];
for (const [lat, lon, code] of cases) {
  test(`latLonToMesh250(${lat},${lon}) = ${code}`, () => {
    assert.equal(latLonToMesh250({ lat, lon }), code);
  });
}

test('meshCenter は元の中心から 0.0001度以内', () => {
  const c = meshCenter('5236345944');
  assert.ok(Math.abs(c.lat - 34.9656) < 1e-3);
  assert.ok(Math.abs(c.lon - 136.6234) < 1e-3);
});

test('境界上の点は南西側のメッシュに入る', () => {
  const c = meshCenter('5236345944');
  // 5次メッシュは 緯度7.5秒(1/480度) × 経度11.25秒(1/320度)。
  // 中心 + 半分 = 北東の角 = 北東隣のメッシュの南西の角 → 隣のメッシュに入る
  assert.notEqual(latLonToMesh250({ lat: c.lat + 1 / 960, lon: c.lon + 1 / 640 }), '5236345944');
});

test('mesh2Of', () => assert.equal(mesh2Of('5236345944'), '523634'));

test('meshesWithin 半径0は自分だけ、半径1000mは 40〜60 個', () => {
  const c = meshCenter('5236345944');
  assert.deepEqual(meshesWithin(c, 0), ['5236345944']);
  const n = meshesWithin(c, 1000).length;
  assert.ok(n >= 40 && n <= 60, `n=${n}`);
});
