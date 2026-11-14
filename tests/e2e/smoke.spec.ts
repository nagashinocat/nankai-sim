import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

const KOMONO = { lat: 35.02, lon: 136.5072 };
const OUTSIDE = '想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ';
const STRONG = '浸水が想定される場所です。強い揺れや長い揺れを感じたら、到達時間を待たずにすぐ高い所へ避難してください';
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const OWASE = { lat: 34.0711, lon: 136.1905 };
const ATAMI = { lat: 35.1037, lon: 139.0777 };
const gsiHit = (title: string, lat: number, lon: number) => ({
  geometry: { coordinates: [lon, lat], type: 'Point' },
  type: 'Feature',
  properties: { addressCode: '', title },
});

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page); // 既定は 404（浸水域外）。外部へは出さない
});

test('住所検索→結果（震度6弱・免責・共有文面に住所なし）', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) =>
    r.fulfill({ json: [gsiHit('三重県三重郡菰野町大字吉澤１３０６', KOMONO.lat, KOMONO.lon)] }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('これは耐震診断ではなく、統計的な目安です').first()).toBeVisible();

  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();

  await expect(page.getByText('震度6弱').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('耐震診断ではなく').first()).toBeVisible();
  await expect(page.getByText('最大クラス（国の想定）').first()).toBeVisible();
  // どの場所で計算したか（裁定 F4）。津波は含まれていないことの注意と、津波の避難場所リスト（裁定 F2）
  await expect(page.locator('#location-note')).toHaveText('三重県三重郡菰野町大字吉澤１３０６ 付近で計算しました');
  await expect(page.locator('#home-result').getByText(OUTSIDE)).toBeVisible();
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '地震の避難場所（近い順）' })).toBeVisible();

  const share = await page.locator('#share-text').inputValue();
  expect(share).toContain('菰野町');
  expect(share).not.toContain('吉澤');
  expect(share).not.toContain(String(KOMONO.lat));
  expect(share).not.toContain(String(KOMONO.lon));
  expect(share).not.toMatch(/\d{2}\.\d{3,}/); // 座標なし
  expect(share).not.toContain('三重県三重郡');

  // 経路リンクは避難場所の座標だけを持つ（自宅の座標を含まない）
  const href = await page.locator('a[href*="google.com/maps/dir"]').first().getAttribute('href');
  expect(href).toContain('destination=');
  expect(href).not.toContain(String(KOMONO.lat));
  expect(href).not.toContain(String(KOMONO.lon));
  expect(href).not.toContain('origin');

  await page.screenshot({ path: 'reports/web-app-result-390x844.png', fullPage: true });
});

test('複数候補は選択リストを出し、先頭を勝手に使わない', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) =>
    r.fulfill({ json: [gsiHit('候補A', 35.02, 136.5072), gsiHit('候補B', 35.03, 136.51)] }),
  );
  await page.goto('/');
  await page.getByLabel('住所').fill('吉澤');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('候補が複数見つかりました')).toBeVisible();
  await expect(page.locator('#result').getByText('震度')).toHaveCount(0);
  await page.getByRole('button', { name: '候補B' }).click();
  await expect(page.getByText(/震度\d/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#location-note')).toHaveText('候補B 付近で計算しました');
});

test('0件のときは地図でピンを決める', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByLabel('住所').fill('存在しない住所');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('見つかりませんでした')).toBeVisible();
  await expect(page.locator('#pin-map')).toBeVisible();
  await page.getByRole('button', { name: 'この場所で調べる' }).click();
  await expect(page.locator('#home-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('調べています')).toHaveCount(0);
  await expect(page.locator('#location-note')).toHaveText('地図で選んだ場所で計算しました');
});

test('0件の地図は最初に5県（和歌山県の西端〜静岡県の東端、串本町〜岐阜県の北端）を全部見せる', async ({ page }) => {
  const tiles: { z: number; x: number; y: number }[] = [];
  await page.unroute('**/cyberjapandata.gsi.go.jp/**');
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(r.request().url());
    if (m) tiles.push({ z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
    return r.abort();
  });
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill('存在しない住所');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#pin-map')).toBeVisible();
  // 見えている範囲（地図の四隅）が5県の外接矩形を含む
  const box = (await page.locator('#pin-map').boundingBox())!;
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  const bounds = await page.evaluate(() => {
    const el = document.querySelector('#pin-map .home-pin') as HTMLElement;
    const map = document.querySelector('#pin-map') as HTMLElement;
    const r = map.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return { w: r.width, h: r.height, pinX: p.left + p.width / 2 - r.left, pinY: p.top + p.height / 2 - r.top };
  });
  // 初期表示のズーム（タイルの z）で、5県の端の点がピン（5県の外接矩形の中心）からの画素オフセットで地図の中に入る
  const z = Math.max(...tiles.map((t) => t.z));
  const px = (lat: number, lon: number) => {
    const n = 256 * 2 ** z;
    const s = Math.sin((lat * Math.PI) / 180);
    return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  };
  const c = px((33.43 + 36.47) / 2, (134.99 + 139.18) / 2);
  for (const [lat, lon] of [[34.28, 134.99], [33.43, 135.76], [36.47, 137.3], [35.1, 139.15]] as const) {
    const q = px(lat, lon);
    const x = bounds.pinX + (q.x - c.x);
    const y = bounds.pinY + (q.y - c.y);
    expect(x, `${lat},${lon} at z${z}`).toBeGreaterThanOrEqual(0);
    expect(x, `${lat},${lon} at z${z}`).toBeLessThanOrEqual(box.width);
    expect(y, `${lat},${lon} at z${z}`).toBeGreaterThanOrEqual(0);
    expect(y, `${lat},${lon} at z${z}`).toBeLessThanOrEqual(box.height);
  }
});

test('愛知県（豊橋市）も対応範囲。市町名と避難場所が出る', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('愛知県豊橋市今橋町', 34.7692, 137.3914)] }));
  await page.goto('/');
  await page.getByLabel('住所').fill('豊橋市今橋町1');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText(/震度/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  expect(await page.locator('#share-text').inputValue()).toContain('豊橋市');
  await expect(page.locator('#evac ol.shelters li').first()).toBeVisible();
});

for (const c of [
  // 大阪市は内閣府の抽出（1次メッシュ 5235）に入るが、5県の陸と重ならない2次メッシュなので対応範囲外（Ruling T7-f）
  { name: '大阪市', title: '大阪府大阪市北区中之島', input: '大阪市北区中之島1', lat: 34.6937, lon: 135.5023 },
  { name: '仙台市', title: '宮城県仙台市青葉区国分町', input: '仙台市青葉区国分町1', lat: 38.2647, lon: 140.8697 },
]) {
  test(`対応範囲外（${c.name}）は「まだ対応していません」。揺れが小さいとは言わず、保存もしない`, async ({ page }) => {
    await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit(c.title, c.lat, c.lon)] }));
    await page.goto('/');
    await page.getByLabel('住所').fill(c.input);
    await page.getByRole('button', { name: '調べる' }).click();
    await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('静岡県・愛知県・岐阜県・三重県・和歌山県の想定データを使っています').first()).toBeVisible();
    await expect(page.locator('#home-result a[href="https://disaportal.gsi.go.jp/"]')).toBeVisible();
    await expect(page.getByText('想定されていません')).toHaveCount(0);
    await expect(page.getByText('この結果に津波の被害は含まれていません').first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toBeNull();
  });
}

test('対応範囲内なのに想定データが読めない → 結果を出さず、再試行ボタン', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('菰野', KOMONO.lat, KOMONO.lon)] }));
  await page.route('**/data/hazard/L2/523644.json', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/');
  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('うまく調べられませんでした')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result')).toHaveCount(0);
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  await page.unroute('**/data/hazard/L2/523644.json');
  await page.getByRole('button', { name: 'もう一度試す' }).click();
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'もう一度試す' })).toHaveCount(0);
});

test('チェックリストの状態は再読み込み後も残る', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) =>
    r.fulfill({ json: [gsiHit('菰野', KOMONO.lat, KOMONO.lon)] }),
  );
  await page.goto('/');
  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#home-result')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('簡易トイレ').check();
  await page.reload();
  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByLabel('簡易トイレ')).toBeChecked({ timeout: 30_000 });
  await expect(page.getByLabel('家具の固定')).not.toBeChecked();
});

test('保存値が壊れていてもアプリは起動する', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nankai-sim:last', JSON.stringify({ savedAt: 'x', home: { status: 'ok' }, area: { status: 'ok' }, input: {} })));
  await page.goto('/');
  await expect(page.getByLabel('住所')).toBeVisible();
  await expect(page.locator('#last-result')).toHaveCount(0);
});

async function search(page: import('@playwright/test').Page, at: { lat: number; lon: number }, title: string) {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit(title, at.lat, at.lon)] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill(title);
  await page.getByRole('button', { name: '調べる' }).click();
}

test('津波: 浸水深1〜3mの色 → 浸水深・到達時間・注記・避難場所の判定が出る', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, YOKKAICHI, '四日市市');
  const home = page.locator('#home-result');
  await expect(home.getByText('津波 浸水深 1〜3m（想定）・海岸への到達 最短約15分（30cm）')).toBeVisible({ timeout: 30_000 });
  await expect(home.locator('.tsunami-caveat')).toHaveCount(0); // 30cm は注意なし（Ruling W-d）
  // Ruling F2: 到達時間が分かっていても、自宅の津波の欄の先頭に強い一文
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  expect(await home.locator('p').evaluateAll((ps, strong) => ps.findIndex((p) => p.textContent === strong) < ps.findIndex((p) => p.textContent?.startsWith('津波 浸水深')), STRONG)).toBe(true);
  await expect(home.getByText('揺れが収まったらすぐ高い所へ')).toHaveCount(0); // 15分なので urgent ではない
  await expect(home.getByText('到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください')).toBeVisible();
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
  // 到達15分 → 避難場所ごとの判定（3つの文言のどれか）が津波の避難場所リストに出る
  await expect(page.locator('#evac ol.shelters .reach').first()).toHaveText(/すぐ避難を始めれば間に合う可能性|ぎりぎり。より近い高い場所も考えて|間に合わないおそれ。近くの高い建物や高台へ/);
  // 地図の凡例（8色）と出典表示。浸水深の8色と地理院の津波タイルは「津波」の表示のときだけ
  await expect(page.locator('.tsunami-legend li')).toHaveCount(0);
  await expect(page.locator('#result-map img[src*="04_tsunami_newlegend_data"]')).toHaveCount(0);
  await page.locator('#risk-mode-tsunami').click();
  await expect(page.locator('.tsunami-legend li')).toHaveCount(8);
  await expect(page.locator('.tsunami-legend li').first()).toContainText('津波 0.3m未満');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('ハザードマップポータルサイト');
  await expect(page.locator('.leaflet-control-attribution')).not.toContainText('津波浸水想定');
  await expect(page.locator('.tsunami-attribution')).toContainText('津波浸水想定：各都道府県');
  // 津波タイルはマスより上・自宅の印（overlay 400）より下の別ペイン
  const paneZ = (c: string) => page.locator(`#result-map .leaflet-${c}-pane`).evaluate((e) => Number(getComputedStyle(e).zIndex));
  expect(await paneZ('tsunami')).toBeGreaterThan(await paneZ('mesh'));
  expect(await paneZ('tsunami')).toBeLessThan(await paneZ('overlay'));
  expect(await page.locator('.leaflet-tsunami-pane').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  await expect(page.locator('.leaflet-tsunami-pane .leaflet-layer').first()).toHaveCSS('opacity', '0.5');
  await expect(page.locator('#result-map img[src*="04_tsunami_newlegend_data"]').first()).toBeAttached();
  await page.screenshot({ path: 'reports/tsunami-result-390x844.png', fullPage: true });
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/tsunami-home-390x844.png' }); // 390×844 の画面（自宅の結果）
  // 保存は文言だけ（座標なし）
  const raw = await page.evaluate(() => localStorage.getItem('nankai-sim:last'));
  expect(raw).toContain('"v":4');
  expect(raw).toContain('"scenario":"L2"');
  expect(raw).toContain('1〜3m');
  expect(raw).not.toMatch(/"(lat|lon|pos)"/);
});

test('津波: 到達時間が5分以内（尾鷲市3分）→ 判定せず「揺れが収まったらすぐ高い所へ」', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, OWASE, '尾鷲市');
  await expect(page.locator('#home-result').getByText('海岸への到達 最短約3分（30cm）')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
});

test('津波: 静岡県は +50cm の到達時間（熱海市24分）→「（50cm）」と表示', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, ATAMI, '熱海市');
  await expect(page.locator('#home-result').getByText('津波 浸水深 1〜3m（想定）・海岸への到達 最短約24分（50cm）')).toBeVisible({ timeout: 30_000 });
});

test('津波: HTTP 200 の完全に透明な PNG → 浸水域外の文言', async ({ page }) => {
  await stubTsunami(page, { rgb: [0, 0, 0], alpha: 0 });
  await search(page, OWASE, '尾鷲市');
  await expect(page.locator('#home-result').getByText(OUTSIDE)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
  await expect(page.locator('#home-result').getByText(STRONG)).toHaveCount(0);
});

test('津波（Ruling F3）: 自宅の点は浸水域外、約50m先は 3〜5m → 「すぐ近く（約50m以内）…（最大 3〜5m）」と強い一文。浸水域外の文言は出さない', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 183, 183], hole: { ...YOKKAICHI, radiusPx: 20 } });
  await search(page, YOKKAICHI, '四日市市');
  const home = page.locator('#home-result');
  await expect(home.getByText('すぐ近く（約50m以内）まで浸水が想定されています（最大 3〜5m）', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  await expect(home.getByText('海岸への到達 最短約15分（30cm）', { exact: true })).toBeVisible();
  await expect(home.getByText(OUTSIDE)).toHaveCount(0);
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/tsunami-nearby-home-390x844.png' });
  const raw = await page.evaluate(() => localStorage.getItem('nankai-sim:last'));
  expect(raw).toContain('"kind":"nearby"');
  await page.reload();
  await expect(page.locator('#last-result').getByText('すぐ近く（約50m以内）まで浸水が想定されています（最大 3〜5m）')).toBeVisible();
  await expect(page.locator('#last-result').getByText(STRONG)).toBeVisible();
});

test('津波（Ruling F3）: 浸水の無い穴が約50mより広い（半径80画素）→ 浸水域外の文言のまま', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 183, 183], hole: { ...YOKKAICHI, radiusPx: 80 } });
  await search(page, YOKKAICHI, '四日市市');
  await expect(page.locator('#home-result').getByText(OUTSIDE)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result').getByText(STRONG)).toHaveCount(0);
});

test('津波: 内陸の菰野町に 1〜3m の色 → 浸水深は出すが、到達時間が無いので判定せず注記も出さない', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, KOMONO, '菰野町吉澤');
  const home = page.locator('#home-result');
  await expect(home.getByText('津波 浸水深 1〜3m（想定）', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(home.getByText('到達時間は海岸に')).toHaveCount(0);
  await expect(home.getByText('揺れが収まったらすぐ高い所へ')).toBeVisible(); // 自宅の津波の欄にも
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
});

test('津波: タイルが 404 → 浸水域外の文言（注意文は出さない）', async ({ page }) => {
  await stubTsunami(page, 'none');
  await search(page, OWASE, '尾鷲市');
  await expect(page.locator('#home-result').getByText(OUTSIDE)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
});

test('津波: タイルが 500 → 「津波の被害は含まれていません」注意。結果全体は出る', async ({ page }) => {
  await stubTsunami(page, 'error');
  await search(page, OWASE, '尾鷲市');
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この結果に津波の被害は含まれていません').first()).toBeVisible();
  await expect(page.locator('#home-result').getByText(OUTSIDE)).toHaveCount(0);
  await expect(page.locator('#home-result').getByText('津波 浸水深')).toHaveCount(0);
});

// --- 4県対応（Task 8）・和歌山県の追加。実データが無い環境ではスキップする ---
const hasRealData = fs.existsSync('public/data/manifest.json') && fs.existsSync('public/data/tsunami_arrival.json');

test('愛知県の住所（名古屋市役所）→ 結果が出る（震度の行・市町村名の共有文）', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await search(page, { lat: 35.1815, lon: 136.9066 }, '愛知県名古屋市中区三の丸三丁目１－１');
  await expect(page.getByText(/震度\d/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  expect(await page.locator('#share-text').inputValue()).toContain('名古屋市');
  await expect(page.locator('a[href*="google.com/search"]').first()).toHaveAttribute('href', /%E5%90%8D%E5%8F%A4%E5%B1%8B%E5%B8%82/);
});

test('静岡県の沿岸（焼津市役所）に 3〜5m の色 → 「（50cm）」と「揺れが収まったらすぐ高い所へ」', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await stubTsunami(page, { rgb: [255, 183, 183] });
  await search(page, { lat: 34.8669, lon: 138.3237 }, '焼津市役所');
  await expect(page.locator('#home-result').getByText(/浸水深 3〜5m（想定）・海岸への到達 最短約2分（50cm）/)).toBeVisible({ timeout: 30_000 });
  // Ruling W-d: 30cm より高い到達時間には、より低い津波はもっと早く着くことがあると添える
  await expect(page.locator('#home-result .tsunami-caveat')).toHaveText('この時間は50cmの津波が着く時間です。それより低い津波はもっと早く着くことがあります');
  await expect(page.locator('#home-result .tsunami-strong')).toHaveText(STRONG);
  await expect(page.locator('#home-result .tsunami-urgent')).toHaveText('揺れが収まったらすぐ高い所へ');
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
});

// Ruling F1: 対応範囲は 250m メッシュ単位（四角が5県の陸と重なるか。Ruling F4）。同じ2次メッシュでも隣県の場所は範囲外。
for (const c of [
  { name: '湯河原町（神奈川県・熱海市の隣）', title: '神奈川県足柄下郡湯河原町', lat: 35.148, lon: 139.108 },
  { name: '岬町（大阪府・和歌山市の隣）', title: '大阪府泉南郡岬町深日', lat: 34.3163, lon: 135.1436 },
]) {
  test(`5県に隣接する ${c.name} は「まだ対応していません」（避難場所を5県分だけで出さない）`, async ({ page }) => {
    test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
    await stubTsunami(page, { rgb: [255, 216, 192] });
    await search(page, { lat: c.lat, lon: c.lon }, c.title);
    await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#home-result').getByText(/震度\d/)).toHaveCount(0);
    await expect(page.locator('#evac')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toBeNull();
  });
}

test('岐阜県の山林（高山市奥飛騨・建物データなし）も対応範囲 → 自宅の結果は出て、周辺は「建物データなし」', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await search(page, { lat: 36.24, lon: 137.55 }, '岐阜県高山市奥飛騨温泉郷');
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  await expect(page.getByText('建物データなし（周辺の棟数は推計できません）')).toBeVisible();
});

// --- 和歌山県（30）。到達時間は +1m（Ruling W-b） ---
test('和歌山県の住所（和歌山市役所）→ 結果が出る（震度の行・市町村名の共有文・避難場所）', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await search(page, { lat: 34.2306, lon: 135.1708 }, '和歌山県和歌山市七番丁２３');
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  expect(await page.locator('#share-text').inputValue()).toContain('和歌山市');
  await expect(page.locator('#evac ol.shelters li').first()).toBeVisible();
  // 和歌山市の到達時間は +1m で45分。津波の避難場所の判定の説明は「（1m）」
  await expect(page.locator('#evac').getByText(/到達時間（1m）と比べた目安/)).toBeVisible();
});

test('和歌山県 新宮市（以前は範囲外）に 1〜3m の色 → 到達 最短約5分（1m）・すぐ高い所へ', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, { lat: 33.7246, lon: 135.9928 }, '和歌山県新宮市春日');
  await expect(page.locator('#home-result').getByText('津波 浸水深 1〜3m（想定）・海岸への到達 最短約5分（1m）')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result .tsunami-caveat')).toHaveText('この時間は1mの津波が着く時間です。それより低い津波はもっと早く着くことがあります');
  await expect(page.getByText('この地域はまだ対応していません')).toHaveCount(0);
  await expect(page.locator('#home-result .tsunami-urgent')).toHaveText('揺れが収まったらすぐ高い所へ');
  // 5分以内は判定しない（避難場所リストも「すぐ高い所へ」で、比較の説明は出さない）
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
  await expect(page.locator('#evac').getByText(/と比べた目安/)).toHaveCount(0);
});

test('和歌山県 串本町に 1〜3m の色 → 到達 最短約1分（1m）と「揺れが収まったらすぐ高い所へ」', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ（npm run data などで生成が必要）');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, { lat: 33.4723, lon: 135.7814 }, '和歌山県東牟婁郡串本町串本');
  await expect(page.locator('#home-result').getByText('津波 浸水深 1〜3m（想定）・海岸への到達 最短約1分（1m）')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result .tsunami-caveat')).toHaveText('この時間は1mの津波が着く時間です。それより低い津波はもっと早く着くことがあります');
  await expect(page.locator('#home-result .tsunami-strong')).toHaveText(STRONG);
  await expect(page.locator('#home-result .tsunami-urgent')).toHaveText('揺れが収まったらすぐ高い所へ');
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
});

// --- シナリオのタブ（半割れ・時間差）。実データ（HALF_E / HALF_W）を使う ---
const TAB_NAMES = ['最大クラス', '東側の半割れ', '西側の半割れ', '時間差（東→西）', '時間差（西→東）'];
const HALF_TEXT = '南海トラフの東側（または西側）だけで大きな地震が起きた場合の想定です。残りの半分でも続けて大地震が起きるおそれがあり、『南海トラフ地震臨時情報（巨大地震警戒）』が出たら、1週間程度は事前避難や備えの再確認をしてください';
const LAG_TEXT = '先に片側で地震が起き、その後もう片側でも地震が起きた場合の想定です。先の地震で傷んだ建物は、後の地震で壊れやすくなります（国の手法：先の地震で半壊した建物は、後の地震で震度が0.5高い場合と同じ全壊率で計算）';
const TSUNAMI_SCENARIO_NOTE = '津波は最大クラスの想定を表示しています。半割れ・時間差では津波の高さや到達時間が異なる場合がありますが、強い揺れを感じたらすぐ高い所へ避難してください';

async function searchKomono(page: import('@playwright/test').Page) {
  await search(page, KOMONO, '菰野町吉澤');
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
}
const tab = (page: import('@playwright/test').Page, name: string) => page.getByRole('tab', { name, exact: true });

test('タブ: 5つが決まった順で並び、初期は「最大クラス」。結果の形は従来どおり', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await expect(page.getByRole('tablist')).toBeVisible();
  expect(await page.getByRole('tab').allTextContents()).toEqual(TAB_NAMES);
  await expect(tab(page, '最大クラス')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await expect(page.getByText('最大クラス（国の想定）').first()).toBeVisible();
  await expect(page.getByText(HALF_TEXT)).toHaveCount(0);
  await expect(page.getByText(TSUNAMI_SCENARIO_NOTE)).toHaveCount(0);
});

test('タブ: 「東側の半割れ」で説明文・数値が変わり、津波の注記が出る。最大クラスに戻すと元どおり', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await searchKomono(page);
  const home = page.locator('#home-result');
  await expect(home.getByText('津波 浸水深 1〜3m（想定）')).toBeVisible();
  const l2Text = await home.innerText();
  await tab(page, '東側の半割れ').click();
  await expect(tab(page, '東側の半割れ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(HALF_TEXT)).toBeVisible();
  await expect(page.getByText(TSUNAMI_SCENARIO_NOTE)).toBeVisible();
  await expect(home.getByText(/震度\d/)).toBeVisible();
  const halfText = await home.innerText();
  expect(halfText).not.toBe(l2Text);
  // 津波の行は最大クラスと同じ
  await expect(home.getByText('津波 浸水深 1〜3m（想定）')).toBeVisible();
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  // 津波の注記は津波の行の下
  const order = await home.locator('p').evaluateAll((ps) => ps.map((p) => p.textContent ?? ''));
  expect(order.findIndex((t) => t === '津波は最大クラスの想定を表示しています。半割れ・時間差では津波の高さや到達時間が異なる場合がありますが、強い揺れを感じたらすぐ高い所へ避難してください')).toBeGreaterThan(order.findIndex((t) => t.startsWith('津波 浸水深')));
  await expect(page.locator('#case-line')).toContainText('東側の半割れ');
  await tab(page, '最大クラス').click();
  await expect(page.getByText(HALF_TEXT)).toHaveCount(0);
  await expect(page.getByText(TSUNAMI_SCENARIO_NOTE)).toHaveCount(0);
  await expect.poll(() => home.innerText()).toBe(l2Text);
});

test('タブ: 「時間差（東→西）」は先発と合計の2段階。合計は先発以上。説明文と「先に東側で…、後に西側で…」', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await tab(page, '時間差（東→西）').click();
  const home = page.locator('#home-result');
  await expect(page.getByText(LAG_TEXT)).toBeVisible();
  await expect(home.getByRole('heading', { name: '先発（東側）' })).toBeVisible();
  await expect(home.getByRole('heading', { name: '後発まで含めた合計' })).toBeVisible();
  await expect(home.getByText(/先に東側で震度\d.*、後に西側で震度\d/)).toBeVisible();
  await expect(home.getByText(/先発 震度|後発 震度/)).toHaveCount(0);
  await expect(home.getByText(/全壊（代表値）/)).toHaveCount(2);
  await expect(home.getByText(/幅 .*〜/)).toHaveCount(4);
  const pct = (s: string) => Number(/([\d.]+)%/.exec(s)![1]);
  const mins = await home.locator('p.big', { hasText: '全壊' }).allTextContents();
  const lo = (t: string) => pct(/幅 ([^〜]+)〜/.exec(t)![1]);
  expect(lo(mins[1])).toBeGreaterThanOrEqual(lo(mins[0]));
  await expect(page.getByText(TSUNAMI_SCENARIO_NOTE)).toBeVisible();
  await page.getByRole('tablist').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/scenario-lag-tab-390x844.png' });
  await tab(page, '時間差（西→東）').click();
  await expect(home.getByRole('heading', { name: '先発（西側）' })).toBeVisible();
  await expect(home.getByText(/先に西側で震度\d.*、後に東側で震度\d/)).toBeVisible();
});

test('タブ: 周辺の推計と地図の色がタブに合わせて変わる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  const area = page.locator('section.card', { has: page.getByRole('heading', { name: '周辺1km（推計）' }) });
  // マスの色は「やること」の段階なので、タブで段階が変わらないこともある。マスごとの推計値（data-rate）で比べる
  const fills = () => page.locator('#result-map path.rm-cell').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-rate')).join(','));
  const l2Area = await area.innerText();
  const l2Fills = await fills();
  await tab(page, '時間差（東→西）').click();
  await expect(page.locator('#case-line')).toContainText('時間差（東→西）');
  await expect.poll(() => area.innerText()).not.toBe(l2Area);
  expect(await fills()).not.toBe(l2Fills);
});

test('タブ: 素早く2回切り替えても、最後に選んだタブの結果だけが出る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await page.route('**/data/hazard/HALF_E/**', async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
  await tab(page, '東側の半割れ').click();
  await tab(page, '西側の半割れ').click();
  await expect(tab(page, '西側の半割れ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#case-line')).toContainText('西側の半割れ');
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible();
  const shown = await page.locator('#home-result').innerText();
  await page.waitForTimeout(2500); // 遅れて東側の計算が終わっても描画しない
  await expect(page.locator('#case-line')).toContainText('西側の半割れ');
  await expect(page.locator('#case-line')).not.toContainText('東側の半割れ');
  expect(await page.locator('#home-result').innerText()).toBe(shown);
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toContain('"scenario":"HALF_W"');
});

test('タブ: 390px で折り返さず、横スクロールで最後のタブも選べる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  const list = page.getByRole('tablist');
  const m = await list.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX, tops: [...e.querySelectorAll('[role=tab]')].map((t) => (t as HTMLElement).offsetTop) }));
  expect(m.sw).toBeGreaterThan(m.cw);
  expect(['auto', 'scroll']).toContain(m.ox);
  expect(new Set(m.tops).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await tab(page, '時間差（西→東）').click();
  await expect(tab(page, '時間差（西→東）')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(LAG_TEXT)).toBeVisible();
});

test('タブ: 矢印キー・Home・End で移動できる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await tab(page, '最大クラス').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, '東側の半割れ')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, '東側の半割れ')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(page, '時間差（西→東）')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); // 端で先頭へ
  await expect(tab(page, '最大クラス')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, '時間差（西→東）')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, '最大クラス')).toHaveAttribute('tabindex', '-1');
});

test('タブ: 片方のデータが無いタブだけ「この想定のデータがありません」。通信エラーのタブは再読み込みできる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await page.route('**/data/hazard/HALF_W/**', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await tab(page, '西側の半割れ').click();
  await expect(page.locator('#home-result').getByText('この想定のデータがありません')).toBeVisible();
  await tab(page, '時間差（東→西）').click();
  await expect(page.locator('#home-result').getByText('この想定のデータがありません')).toBeVisible();
  await tab(page, '東側の半割れ').click();
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible();
  await expect(page.getByText('この想定のデータがありません')).toHaveCount(0);
});

test('タブ: 通信エラーのタブは「もう一度読み込む」でそのタブだけ再試行できる。他のタブは使える', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await page.route('**/data/hazard/HALF_W/**', (r) => r.fulfill({ status: 500, body: 'boom' }));
  await tab(page, '時間差（西→東）').click();
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
  await expect(page.getByText('この想定のデータがありません')).toHaveCount(0);
  await tab(page, '最大クラス').click(); // 他のタブは使える
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible();
  await tab(page, '時間差（西→東）').click();
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
  await page.unroute('**/data/hazard/HALF_W/**');
  await page.getByRole('button', { name: 'もう一度読み込む' }).click();
  await expect(page.locator('#home-result').getByRole('heading', { name: '先発（西側）' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'もう一度読み込む' })).toHaveCount(0);
});

test('タブ: 選んだタブの結果を保存し、前回の結果にそのタブ名と2段階が出る。新しい場所の検索ではタブが最大クラスに戻る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await tab(page, '時間差（東→西）').click();
  await expect(page.locator('#home-result').getByRole('heading', { name: '先発（東側）' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toContain('"scenario":"LAG_EW"');
  const raw = (await page.evaluate(() => localStorage.getItem('nankai-sim:last')))!;
  expect(raw).toContain('"stages"');
  expect(raw).not.toMatch(/"(lat|lon|pos)"/);
  await page.reload();
  const last = page.locator('#last-result');
  await expect(last.getByText('時間差（東→西）')).toBeVisible();
  await expect(last.getByText('最大クラス（国の想定）')).toHaveCount(0);
  await expect(last.getByRole('heading', { name: '先発（東側）' })).toBeVisible();
  await expect(last.getByRole('heading', { name: '後発まで含めた合計' })).toBeVisible();
  await expect(last.getByText(/先に東側で震度\d.*、後に西側で震度\d/)).toBeVisible();
  // もう一度調べると最大クラスから始まる
  await page.getByLabel('住所').fill('菰野町吉澤');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(tab(page, '最大クラス')).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
});

test('説明ページに半割れ・時間差と南海トラフ地震臨時情報の説明がある', async ({ page }) => {
  await page.goto('/#about');
  await expect(page.getByRole('heading', { name: '半割れ・時間差と臨時情報' })).toBeVisible();
  await expect(page.getByText(HALF_TEXT)).toBeVisible();
  await expect(page.getByText(LAG_TEXT)).toBeVisible();
});

test('タブ（I1）: 浸水域内の自宅。データなし・読み込み失敗のタブにも F2 の強い一文と津波の注記が出る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await searchKomono(page);
  const home = page.locator('#home-result');
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  await page.route('**/data/hazard/HALF_E/**', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await tab(page, '東側の半割れ').click();
  await expect(home.getByText('この想定のデータがありません')).toBeVisible();
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  await expect(home.getByText('津波 浸水深 1〜3m（想定）')).toBeVisible();
  await expect(home.getByText(TSUNAMI_SCENARIO_NOTE)).toBeVisible();
  // 周辺の推計は「建物データなし」ではなく、この想定のデータが無いこと
  const area = page.locator('section.card', { has: page.getByRole('heading', { name: '周辺1km（推計）' }) });
  await expect(area.getByText('この想定のデータがありません')).toBeVisible();
  await expect(area.getByText('建物データなし')).toHaveCount(0);
  await page.route('**/data/hazard/HALF_W/**', (r) => r.fulfill({ status: 500, body: 'boom' }));
  await tab(page, '西側の半割れ').click();
  await expect(home.getByRole('button', { name: 'もう一度読み込む' })).toBeVisible();
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  await expect(home.getByText(TSUNAMI_SCENARIO_NOTE)).toBeVisible();
  // L2 に戻ると注記は消え、津波の行は同じ
  await tab(page, '最大クラス').click();
  await expect(home.getByText(TSUNAMI_SCENARIO_NOTE)).toHaveCount(0);
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
});

test('タブ: タブを切り替えて戻しても、自宅の印が全壊率の四角より上に残る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await tab(page, '時間差（東→西）').click();
  await expect(page.locator('#case-line')).toContainText('時間差（東→西）');
  await tab(page, '最大クラス').click();
  await expect(page.locator('#case-line')).toContainText('最大クラス');
  const z = await page.evaluate(() => {
    const pane = (c: string) => Number(getComputedStyle(document.querySelector(`#result-map .leaflet-${c}-pane`)!).zIndex);
    return { mesh: pane('mesh'), home: pane('home'), shelters: pane('shelters') };
  });
  expect(z.mesh).toBeLessThan(z.home);
  expect(z.shelters).toBeLessThan(z.home);
  // 自宅の印の中心にある要素は、自宅の印（home ペインの円。避難場所の印より上）
  await page.locator('#result-map').scrollIntoViewIfNeeded();
  const hit = await page.evaluate(() => {
    const marker = [...document.querySelectorAll('#result-map .leaflet-home-pane path.rm-home-dot')][0]!;
    const r = marker.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === marker ? 'ok' : `${top?.tagName}.${top?.getAttribute('class')} fill=${top?.getAttribute('fill')}`;
  });
  expect(hit).toBe('ok');
});

test('タブ: 前回の結果（半割れ・時間差）にも説明文が出る。共有文面は入れ子の括弧なし', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await tab(page, '時間差（東→西）').click();
  const share = page.locator('#share-text');
  await expect(share).toHaveValue(/^南海トラフ地震・時間差（東→西）の想定で、菰野町の自宅/);
  await expect(share).toHaveValue(/後発まで含めた合計：全壊 代表値/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toContain('"scenario":"LAG_EW"');
  await page.reload();
  await expect(page.locator('#last-result').getByText(LAG_TEXT)).toBeVisible();
});

test('タブ: 読み込み中の表示は aria-live=polite', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page);
  await page.route('**/data/hazard/HALF_E/**', async (r) => { await new Promise((res) => setTimeout(res, 1500)); await r.continue(); });
  await tab(page, '東側の半割れ').click();
  await expect(page.locator('#home-result [role=status]')).toHaveAttribute('aria-live', 'polite');
});

// ---- 練習モード ----
const PRACTICE_NOTICE = 'これは練習です。臨時情報は地震の予知ではなく、発表されても実際に地震が起きるかはわかりません。実際に発表されたときは、テレビ・ラジオ・自治体の情報に従ってください';
const BEST = [
  'すぐ逃げられる服装で寝て、非常持出品を枕元に置く',
  '普段どおり行くが、非常持出品を持ち歩く',
  '避難場所と避難経路、家族との連絡方法、家具の固定、備蓄を確かめる',
  '倒れてくる家具がない、なるべく安全な部屋',
  '気象庁や自治体の情報を確かめ、むやみに広めない',
  '普段の生活に戻るが、地震の可能性がなくなったわけではないので備えは続ける',
];
const WRONG_FIRST = ['念のため家族全員で避難所に泊まりに行く'];

test('練習モード: 説明ページから入り、6問答えてまとめと出典。やり直すと点数が0に戻る。注意は常に見える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#about');
  await page.getByRole('link', { name: '臨時情報が出たら？ 1週間の練習' }).click();
  await expect(page.getByRole('heading', { name: '練習モード：南海トラフ地震臨時情報（巨大地震注意）' })).toBeVisible();
  const notice = page.getByText(PRACTICE_NOTICE);
  await expect(notice).toBeVisible();
  // 1問目: 最適でないものを選ぶ → 正誤と解説
  await page.getByRole('button', { name: WRONG_FIRST[0] }).click();
  await expect(page.getByText('最適な行動ではありません')).toBeVisible();
  await expect(page.getByText('巨大地震注意では事前の避難は求められません。')).toBeVisible();
  await expect(notice).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: 'reports/practice-scene-390x844.png' });
  await page.getByRole('button', { name: '次へ' }).click();
  // 前の場面にもどる → 答えが残る
  await page.getByRole('button', { name: '前の場面にもどる' }).click();
  await expect(page.getByText('最適な行動ではありません')).toBeVisible();
  await page.getByRole('button', { name: '次へ' }).click();
  for (let i = 1; i < 6; i++) {
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: BEST[i] }).click();
    await page.getByRole('button', { name: '次へ' }).click();
  }
  await expect(page.getByText('6問中 5問')).toBeVisible();
  await expect(page.getByText('1週間の事前避難が求められます')).toBeVisible();
  await expect(page.getByText('揺れへの備え')).toHaveCount(0); // 結果なし → 一行追加なし
  await expect(page.getByText('津波の到達が早い')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /内閣府/ })).toHaveAttribute('href', 'https://www.bousai.go.jp/jishin/nankai/rinji/pdf/r8pdf03.pdf');
  await expect(page.getByRole('link', { name: /気象庁/ })).toHaveAttribute('href', 'https://www.jma.go.jp/jma/kishou/know/jishin/nteq/info_criterion.html');
  await expect(notice).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: 'reports/practice-summary-390x844.png', fullPage: true });
  // やり直し: 点数が混ざらない（全部最適に答えると6問中 6問）
  await page.getByRole('button', { name: '最初からやり直す' }).click();
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: BEST[i] }).click();
    await page.getByRole('button', { name: '次へ' }).click();
  }
  await expect(page.getByText('6問中 6問')).toBeVisible();
  await page.getByRole('button', { name: '最初からやり直す' }).click();
  await page.getByRole('button', { name: 'いつもどおりパジャマで寝る' }).click();
  await page.getByRole('button', { name: '最初からやり直す' }).click();
  for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: BEST[i] }).click(); await page.getByRole('button', { name: '次へ' }).click(); }
  await expect(page.getByText('6問中 6問')).toBeVisible();
});

test('練習モード: 結果画面から入り、戻っても結果が残る。津波の段階があれば事前避難の一言', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await searchKomono(page);
  await expect(page.locator('#practice-entry')).toHaveText('臨時情報が出たら？ 1週間の練習');
  await page.locator('#practice-entry').click();
  await expect(page.locator('#practice-heading')).toBeVisible();
  for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: BEST[i] }).click(); await page.getByRole('button', { name: '次へ' }).click(); }
  await expect(page.getByText('6問中 6問')).toBeVisible();
  await expect(page.getByText('あなたの家は津波の到達が早い／浸水が想定される場所です。')).toBeVisible();
  await page.getByRole('button', { name: '結果の画面にもどる' }).click();
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible();
  await expect(page.locator('#practice')).toBeHidden();
});

test('練習モード: 結果の読み込みに失敗したあとは、前の結果の津波の一言を残さない', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await searchKomono(page);
  // 別の場所（データは読み込み済みでない）で失敗させる
  await page.unroute('**/msearch.gsi.go.jp/**');
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('四日市市', YOKKAICHI.lat, YOKKAICHI.lon)] }));
  await page.route('**/data/hazard/L2/**', (r) => r.fulfill({ status: 500, body: 'boom' }));
  await page.getByLabel('住所').fill('四日市市');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('うまく調べられませんでした')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { location.hash = '#practice'; });
  for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: BEST[i] }).click(); await page.getByRole('button', { name: '次へ' }).click(); }
  await expect(page.getByText('6問中 6問')).toBeVisible();
  await expect(page.getByText('津波の到達が早い')).toHaveCount(0);
  await expect(page.getByText('揺れへの備え')).toHaveCount(0);
  // 場面の見出しにフォーカスが移る（前の場面にもどる）
  await page.getByRole('button', { name: '前の場面にもどる' }).click();
  await expect(page.locator('#practice-scene h3')).toBeFocused();
});

test('練習モード: 津波なし・到達が遅い結果では揺れへの備えの一言', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await searchKomono(page); // 菰野町は内陸（津波なし・到達時間なし）
  await page.locator('#practice-entry').click();
  for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: BEST[i] }).click(); await page.getByRole('button', { name: '次へ' }).click(); }
  await expect(page.getByText('揺れへの備え（家具の固定・耐震）を確かめておきましょう')).toBeVisible();
});

test('内閣府データの出典（加工した値である旨）が表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hazard-attribution')).toContainText('内閣府 南海トラフの巨大地震モデル・被害想定手法検討会');
  await expect(page.locator('#hazard-attribution')).toContainText('加工して作成');
});
