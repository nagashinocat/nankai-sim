import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileAndPixel, tsunamiAt, TSUNAMI_TILE_URL, TSUNAMI_TILE_ZOOM, type PixelReader } from '../../src/app/tsunami-tile.ts';
import { TSUNAMI_BANDS } from '../../src/core/tsunami.ts';

test('定数', () => {
  assert.equal(TSUNAMI_TILE_ZOOM, 17);
  assert.equal(TSUNAMI_TILE_URL, 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png');
});

test('tileAndPixel: 既知の点（35.02, 136.5072, z=17）が手計算と一致する', () => {
  const n = 2 ** 17;
  const fx = ((136.5072 + 180) / 360) * n;
  const latRad = (35.02 * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const r = tileAndPixel({ lat: 35.02, lon: 136.5072 }, 17);
  assert.equal(r.x, Math.floor(fx));
  assert.equal(r.y, Math.floor(fy));
  assert.equal(r.px, Math.floor((fx - Math.floor(fx)) * 256));
  assert.equal(r.py, Math.floor((fy - Math.floor(fy)) * 256));
  assert.equal(r.x, 115236); // 316.5072/360×131072 = 115236.1（手計算）
  assert.ok(r.px >= 0 && r.px < 256 && r.py >= 0 && r.py < 256);
});

test('tileAndPixel: 赤道・経度0 は z=1 でタイル(1,1)の左上', () => {
  assert.deepEqual(tileAndPixel({ lat: 0, lon: 0 }, 1), { x: 1, y: 1, px: 0, py: 0 });
});

const pos = { lat: 34.07, lon: 136.19 };

test('tsunamiAt: 凡例色 → 段階、透明 → none', async () => {
  const band = TSUNAMI_BANDS[3];
  assert.equal(await tsunamiAt(pos, async () => [...band.rgb, 255]), band);
  assert.equal(await tsunamiAt(pos, async () => [0, 0, 0, 0]), 'none');
  assert.equal(await tsunamiAt(pos, async () => [10, 200, 10, 255]), 'unknown');
});

test('tsunamiAt: reader の例外 → unknown（失敗は覚えず再試行できる）', async () => {
  let fail = true;
  const reader: PixelReader = async () => {
    if (fail) throw new Error('network');
    return [0, 0, 0, 0];
  };
  const p = { lat: 34.5, lon: 136.5 };
  assert.equal(await tsunamiAt(p, reader), 'unknown');
  fail = false;
  assert.equal(await tsunamiAt(p, reader), 'none');
});

test('tsunamiAt: 同じ画素は1回しか読まない。URL は {z}/{x}/{y} が置換される', async () => {
  const urls: string[] = [];
  const reader: PixelReader = async (url) => { urls.push(url); return [0, 0, 0, 0]; };
  const p = { lat: 35.1, lon: 136.9 };
  await tsunamiAt(p, reader);
  await tsunamiAt(p, reader);
  assert.equal(urls.length, 1);
  const t = tileAndPixel(p, 17);
  assert.equal(urls[0], `https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/17/${t.x}/${t.y}.png`);
});

// --- Ruling F3: 中心が浸水域外なら、約50m の8方向も見る ---
import { metresPerPixel, NEARBY_RADIUS_M, tsunamiAround } from '../../src/app/tsunami-tile.ts';

/** URL と画素 → 中心の画素からの差 (dx, dy)（タイルをまたいでも通しの画素で数える） */
function fakeReader(center: { lat: number; lon: number }, color: (dx: number, dy: number) => [number, number, number, number] | 'throw') {
  const c = tileAndPixel(center, 17);
  const cx = c.x * 256 + c.px, cy = c.y * 256 + c.py;
  const seen: [number, number][] = [];
  const reader: PixelReader = async (url, px, py) => {
    const m = /\/17\/(\d+)\/(\d+)\.png$/.exec(url)!;
    const dx = Number(m[1]) * 256 + px - cx, dy = Number(m[2]) * 256 + py - cy;
    seen.push([dx, dy]);
    const v = color(dx, dy);
    if (v === 'throw') throw new Error('network');
    return v;
  };
  return { reader, seen };
}
const NONE: [number, number, number, number] = [0, 0, 0, 0];
const rgba = (label: string): [number, number, number, number] => [...TSUNAMI_BANDS.find((b) => b.label === label)!.rgb, 255];

test('metresPerPixel: 156543.03392 × cos(lat) / 2^z。z17・北緯34度で約0.99m', () => {
  assert.equal(NEARBY_RADIUS_M, 50);
  assert.ok(Math.abs(metresPerPixel(34, 17) - (156543.03392 * Math.cos((34 * Math.PI) / 180)) / 2 ** 17) < 1e-12);
  assert.ok(Math.abs(metresPerPixel(34, 17) - 0.99) < 0.01);
  assert.ok(Math.abs(metresPerPixel(0, 17) - 1.1943) < 0.001);
});

test('tsunamiAround: 中心が段階 → その段階（周りは読まない）', async () => {
  const p = { lat: 34.101, lon: 136.201 };
  const { reader, seen } = fakeReader(p, () => rgba('3〜5m'));
  assert.equal(await tsunamiAround(p, reader), TSUNAMI_BANDS.find((b) => b.label === '3〜5m'));
  assert.equal(seen.length, 1);
});

test('tsunamiAround: 中心は浸水域外、東の1点だけ 1〜3m → nearby（1〜3m）', async () => {
  const p = { lat: 34.102, lon: 136.202 };
  const { reader } = fakeReader(p, (dx, dy) => (dx > 40 && Math.abs(dy) < 5 ? rgba('1〜3m') : NONE));
  assert.deepEqual(await tsunamiAround(p, reader), { nearby: TSUNAMI_BANDS.find((b) => b.label === '1〜3m') });
});

test('tsunamiAround: 中心と8点を、約50m（画素に直して）の N・NE・E・SE・S・SW・W・NW で読む', async () => {
  const p = { lat: 34.103, lon: 136.203 };
  const { reader, seen } = fakeReader(p, () => NONE);
  assert.equal(await tsunamiAround(p, reader), 'none');
  assert.equal(seen.length, 9);
  const d = 50 / metresPerPixel(p.lat, 17); // 約50.5画素
  const dirs = seen.slice(1).map(([dx, dy]) => [Math.round(dx / d * 10) / 10, Math.round(dy / d * 10) / 10]);
  const r = Math.round(Math.SQRT1_2 * 10) / 10;
  const want = [[0, -1], [r, -r], [1, 0], [r, r], [0, 1], [-r, r], [-1, 0], [-r, -r]];
  for (const w of want) assert.ok(dirs.some(([x, y]) => Math.abs(x - w[0]) <= 0.05 && Math.abs(y - w[1]) <= 0.05), `方向 ${w} が無い: ${JSON.stringify(dirs)}`);
  for (const [dx, dy] of seen.slice(1)) assert.ok(Math.abs(Math.hypot(dx, dy) * metresPerPixel(p.lat, 17) - 50) < 2.5, `${dx},${dy}`);
});

test('tsunamiAround: 周りに複数の段階 → いちばん深い段階', async () => {
  const p = { lat: 34.104, lon: 136.204 };
  const { reader } = fakeReader(p, (dx, dy) => (dy < -40 ? rgba('0.3m未満') : dx < -40 ? rgba('5〜10m') : dy > 40 ? rgba('1〜3m') : NONE));
  assert.deepEqual(await tsunamiAround(p, reader), { nearby: TSUNAMI_BANDS.find((b) => b.label === '5〜10m') });
});

test('tsunamiAround: すべて読めない → unknown', async () => {
  const p = { lat: 34.105, lon: 136.205 };
  assert.equal(await tsunamiAround(p, fakeReader(p, () => 'throw').reader), 'unknown');
  const q = { lat: 34.1051, lon: 136.2051 };
  assert.equal(await tsunamiAround(q, fakeReader(q, () => [10, 200, 10, 255]).reader), 'unknown'); // 凡例に無い色
});

test('tsunamiAround: 中心は浸水域外、周りの一部が読めない（隣のタイルが500など）→ 読めない点は無視して none', async () => {
  const p = { lat: 34.106, lon: 136.206 };
  assert.equal(await tsunamiAround(p, fakeReader(p, (dx) => (dx > 40 ? 'throw' : NONE)).reader), 'none');
});

test('tsunamiAround: 中心が浸水域外で、周り8点がすべて読めない → unknown（浸水域外とは言わない）', async () => {
  const p = { lat: 34.107, lon: 136.207 };
  assert.equal(await tsunamiAround(p, fakeReader(p, (dx, dy) => (dx === 0 && dy === 0 ? NONE : 'throw')).reader), 'unknown');
});

test('tsunamiAround: 中心が読めなくても周りに段階 → nearby。周りに段階が無ければ unknown のまま', async () => {
  const p = { lat: 34.108, lon: 136.208 };
  const a = fakeReader(p, (dx, dy) => (dx === 0 && dy === 0 ? 'throw' : dy > 40 ? rgba('0.5〜1m') : NONE));
  assert.deepEqual(await tsunamiAround(p, a.reader), { nearby: TSUNAMI_BANDS.find((b) => b.label === '0.5〜1m') });
  const q = { lat: 34.1081, lon: 136.2081 };
  assert.equal(await tsunamiAround(q, fakeReader(q, (dx, dy) => (dx === 0 && dy === 0 ? 'throw' : NONE)).reader), 'unknown');
});

test('tsunamiAround: タイルの端では隣のタイルの URL を読む', async () => {
  // タイルの左上の角のすぐ内側（どの向きも隣のタイルに出る）
  const n = 2 ** 17;
  const lon = (115236 / n) * 360 - 180 + 1e-7;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * 52000) / n))) * 180) / Math.PI - 1e-7;
  const urls = new Set<string>();
  await tsunamiAround({ lat, lon }, async (url) => { urls.add(url); return NONE; });
  const t = tileAndPixel({ lat, lon }, 17);
  assert.equal(t.px, 0); assert.equal(t.py, 0);
  for (const u of [`17/${t.x - 1}/${t.y - 1}.png`, `17/${t.x}/${t.y - 1}.png`, `17/${t.x - 1}/${t.y}.png`, `17/${t.x}/${t.y}.png`])
    assert.ok([...urls].some((x) => x.endsWith(u)), u);
});
