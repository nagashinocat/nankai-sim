import { expect, test } from '@playwright/test';

const KOMONO = { lat: 35.02, lon: 136.5072 };

test('一度結果を出した後、通信が切れていても前回の結果が出る（住所は保存されない）', async ({ page, context }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await page.route('**/msearch.gsi.go.jp/**', (r) =>
    r.fulfill({
      json: [{ geometry: { coordinates: [KOMONO.lon, KOMONO.lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title: '三重県三重郡菰野町大字吉澤１３０６' } }],
    }),
  );
  await page.goto('/');
  // Service Worker の登録と有効化を待ち、オンラインのうちに一度読み込み直して SW 配下にする。
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.getByText('震度6弱').first()).toBeVisible({ timeout: 30_000 });

  // データファイルをページとして開いても、アプリ本体のキャッシュは上書きされない（review minor 1）
  await page.goto('/data/manifest.json');
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /前回の結果（/ })).toBeVisible();
  await expect(page.getByText('通信できないため')).toBeVisible();
  await expect(page.locator('#last-result').getByText('震度6弱')).toBeVisible();
  await expect(page.getByText('これは耐震診断ではなく、統計的な目安です').first()).toBeVisible();
  // オフラインでも避難場所（名前・距離）と津波の注意が出る（spec §1.4、裁定 F2/F3）
  const last = page.locator('#last-result');
  await expect(last.getByText('この結果に津波の被害は含まれていません')).toBeVisible();
  await expect(last.getByRole('heading', { name: '地震の避難場所（近い順）' })).toBeVisible();
  await expect(last.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible();
  await expect(last.locator('ol.shelters li').first()).toContainText('直線距離');
  await expect(last.getByText('付近で計算しました')).toHaveCount(0);

  // 保存内容に住所・座標が無い
  const raw = await page.evaluate(() => localStorage.getItem('nankai-sim:last'));
  expect(raw).not.toBeNull();
  expect(raw).not.toContain('吉澤');
  expect(raw).not.toContain(String(KOMONO.lat));
  expect(raw).not.toContain(String(KOMONO.lon));
  expect(raw).not.toMatch(/"(lat|lon|pos)"/);
  expect(raw).not.toContain('付近で計算しました');

  await page.getByRole('button', { name: '前回の結果を削除' }).click();
  await expect(page.locator('#last-result')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:last'))).toBeNull();
});
