import { expect, test } from '@playwright/test';

const KOMONO = { lat: 35.02, lon: 136.5072 };
const gsiHit = (title: string, lat: number, lon: number) => ({
  geometry: { coordinates: [lon, lat], type: 'Point' },
  type: 'Feature',
  properties: { addressCode: '', title },
});

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
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
  await expect(page.getByText('この結果に津波の被害は含まれていません').first()).toBeVisible();
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

test('対応範囲外（豊橋市）は「まだ対応していません」。揺れが小さいとは言わず、保存もしない', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('愛知県豊橋市今橋町', 34.7692, 137.3914)] }));
  await page.goto('/');
  await page.getByLabel('住所').fill('豊橋市今橋町1');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result a[href="https://disaportal.gsi.go.jp/"]')).toBeVisible();
  await expect(page.getByText('想定されていません')).toHaveCount(0);
  await expect(page.getByText('この結果に津波の被害は含まれていません').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toBeNull();
});

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
