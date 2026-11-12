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
  await expect(page.getByText('震度')).toHaveCount(0);
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
  // 大阪市は内閣府の抽出（1次メッシュ 5235）に入るが、4県の建物が無い2次メッシュなので対応範囲外（Ruling T7-f）
  { name: '大阪市', title: '大阪府大阪市北区中之島', input: '大阪市北区中之島1', lat: 34.6937, lon: 135.5023 },
  { name: '仙台市', title: '宮城県仙台市青葉区国分町', input: '仙台市青葉区国分町1', lat: 38.2647, lon: 140.8697 },
]) {
  test(`対応範囲外（${c.name}）は「まだ対応していません」。揺れが小さいとは言わず、保存もしない`, async ({ page }) => {
    await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit(c.title, c.lat, c.lon)] }));
    await page.goto('/');
    await page.getByLabel('住所').fill(c.input);
    await page.getByRole('button', { name: '調べる' }).click();
    await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('静岡県・愛知県・岐阜県・三重県の想定データを使っています').first()).toBeVisible();
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
  // Ruling F2: 到達時間が分かっていても、自宅の津波の欄の先頭に強い一文
  await expect(home.locator('.tsunami-strong')).toHaveText(STRONG);
  expect(await home.locator('p').evaluateAll((ps, strong) => ps.findIndex((p) => p.textContent === strong) < ps.findIndex((p) => p.textContent?.startsWith('津波 浸水深')), STRONG)).toBe(true);
  await expect(home.getByText('揺れが収まったらすぐ高い所へ')).toHaveCount(0); // 15分なので urgent ではない
  await expect(home.getByText('到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください')).toBeVisible();
  await expect(page.getByText('この結果に津波の被害は含まれていません')).toHaveCount(0);
  // 到達15分 → 避難場所ごとの判定（3つの文言のどれか）が津波の避難場所リストに出る
  await expect(page.locator('#evac ol.shelters .reach').first()).toHaveText(/すぐ避難を始めれば間に合う可能性|ぎりぎり。より近い高い場所も考えて|間に合わないおそれ。近くの高い建物や高台へ/);
  // 地図の凡例（8色）と出典表示
  await expect(page.locator('.tsunami-legend li')).toHaveCount(8);
  await expect(page.locator('.tsunami-legend li').first()).toContainText('津波 0.3m未満');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('ハザードマップポータルサイト');
  await expect(page.locator('.leaflet-control-attribution')).not.toContainText('津波浸水想定');
  await expect(page.locator('.tsunami-attribution')).toContainText('津波浸水想定：各都道府県');
  // 津波タイルは全壊率の四角より上の別ペイン
  expect(await page.locator('.leaflet-tsunami-pane').evaluate((e) => Number(getComputedStyle(e).zIndex))).toBeGreaterThan(400);
  expect(await page.locator('.leaflet-tsunami-pane').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  await expect(page.locator('.leaflet-tsunami-pane .leaflet-layer').first()).toHaveCSS('opacity', '0.5');
  await expect(page.locator('#result-map img[src*="04_tsunami_newlegend_data"]').first()).toBeAttached();
  await page.screenshot({ path: 'reports/tsunami-result-390x844.png', fullPage: true });
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/tsunami-home-390x844.png' }); // 390×844 の画面（自宅の結果）
  // 保存は文言だけ（座標なし）
  const raw = await page.evaluate(() => localStorage.getItem('nankai-sim:last'));
  expect(raw).toContain('"v":3');
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

// --- 4県対応（Task 8）。実データが無い環境ではスキップする ---
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
  await expect(page.locator('#home-result .tsunami-strong')).toHaveText(STRONG);
  await expect(page.locator('#home-result .tsunami-urgent')).toHaveText('揺れが収まったらすぐ高い所へ');
  await expect(page.locator('#evac').getByText('揺れが収まったらすぐ高い所へ').first()).toBeVisible();
});

// Ruling F1: 対応範囲は 250m メッシュ単位（四角が4県の陸と重なるか。Ruling F4）。同じ2次メッシュでも隣県の場所は範囲外。
for (const c of [
  { name: '新宮市（和歌山県・紀宝町の対岸）', title: '和歌山県新宮市春日', lat: 33.7246, lon: 135.9928 },
  { name: '湯河原町（神奈川県・熱海市の隣）', title: '神奈川県足柄下郡湯河原町', lat: 35.148, lon: 139.108 },
]) {
  test(`4県に隣接する ${c.name} は「まだ対応していません」（避難場所を4県分だけで出さない）`, async ({ page }) => {
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
