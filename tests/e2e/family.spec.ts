import { expect, test } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
});

test('家族の決まり: 入力→再読み込みで残る・文面コピー・消去・390pxで横にはみ出さない', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#family');
  await expect(page.locator('#family-notice')).toContainText('このスマホの中だけに保存されます');
  await expect(page.locator('#family-171')).toContainText('171にかけて、録音は1、再生は2');
  await page.locator('#family-tsunami').fill('〇〇小学校の屋上');
  await page.locator('#family-quake').fill('△△公園');
  await page.locator('#family-meet1').fill('学校の校門');
  await page.locator('#family-meet2').fill('駅前のコンビニ');
  await page.locator('#family-contact').fill('まず171に伝言を入れる');
  await page.locator('#family-relay').fill('大阪の叔母');
  await page.locator('#family-items').fill('リュックは玄関');
  await page.locator('#family-add-row').click();
  await page.locator('.family-who').first().fill('たろう');
  await page.locator('.family-memo').first().fill('平日昼は〇〇小学校');
  await page.locator('#family-today').click();
  await expect(page.locator('#family-status')).toHaveText('保存しました');
  await page.screenshot({ path: 'reports/family-form-390x844.png', fullPage: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.locator('#family-tsunami')).toHaveValue('〇〇小学校の屋上');
  await expect(page.locator('#family-meet2')).toHaveValue('駅前のコンビニ');
  await expect(page.locator('.family-who').first()).toHaveValue('たろう');
  await expect(page.locator('#family-reviewed')).not.toHaveValue('');

  await page.locator('#family-copy').click();
  await expect(page.getByText('コピーしました')).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('【わが家の災害時の決まり】');
  for (const s of ['〇〇小学校の屋上', '△△公園', '第1：学校の校門', '大阪の叔母', '・たろう：平日昼は〇〇小学校', 'リュックは玄関', '見直した日：']) expect(clip).toContain(s);

  await page.locator('#family-print').click();
  await expect(page.locator('#family-print-text')).toContainText('〇〇小学校の屋上');
  await page.screenshot({ path: 'reports/family-print-390x844.png', fullPage: true });
  await page.locator('#family-print-back').click();
  await expect(page.locator('#family-tsunami')).toBeVisible();

  await page.locator('#family-clear').click();
  await expect(page.locator('#family-confirm')).toBeVisible();
  await page.locator('#family-clear-no').click();
  await expect(page.locator('#family-tsunami')).toHaveValue('〇〇小学校の屋上');
  await page.locator('#family-clear').click();
  await page.locator('#family-clear-yes').click();
  await expect(page.locator('#family-tsunami')).toHaveValue('');
  await page.reload();
  await expect(page.locator('#family-tsunami')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:family:v1'))).toBeNull();
});

test('コピーが使えないときは選べる文面を表示する', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) } }); });
  await page.goto('/#family');
  await page.locator('#family-meet1').fill('公園');
  await page.locator('#family-copy').click();
  await expect(page.locator('#family-copy-text')).toHaveValue(/第1：公園/);
});

test('壊れた保存値でも起動し、値はバックアップに残る', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('nankai-sim:family:v1')) localStorage.setItem('nankai-sim:family:v1', '{broken'); });
  await page.goto('/#family');
  await expect(page.locator('#family-tsunami')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:family:v1:backup'))).toBe('{broken');
});

test('フッターのリンクから開ける。練習モードにもリンクがある', async ({ page }) => {
  await page.goto('/');
  await page.locator('#family-footer-link').click();
  await expect(page).toHaveURL(/#family$/);
  await expect(page.locator('#family-tsunami')).toBeVisible();
  await page.goto('/#practice');
  await page.getByRole('link', { name: '家族の決まりを確認する' }).click();
  await expect(page).toHaveURL(/#family$/);
});

test('結果画面のリンクから開き、近くの避難場所から選ぶと欄に入る', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [{ geometry: { coordinates: [136.5072, 35.02], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title: '三重県三重郡菰野町大字吉澤１３０６' } }] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill('菰野町吉澤1306');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#home-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#family-entry')).toHaveText('家族の決まりをメモする');
  await page.locator('#family-entry').click();
  await expect(page).toHaveURL(/#family$/);
  const picks = page.locator('#family-pick-tsunami .family-pick-btn');
  expect(await picks.count()).toBeGreaterThan(0);
  expect(await picks.count()).toBeLessThanOrEqual(5);
  const label = (await picks.first().textContent())!;
  const name = label.replace(/（徒歩.*$/, '');
  await expect(picks.first()).toContainText('徒歩約');
  await picks.first().click();
  await expect(page.locator('#family-tsunami')).toHaveValue(name);
  await page.locator('#family-pick-quake .family-pick-btn').first().click();
  await expect(page.locator('#family-quake')).not.toHaveValue('');
  await page.screenshot({ path: 'reports/family-pick-390x844.png', fullPage: true });
  await expect(page.locator('#family-status')).toHaveText('保存しました');
  const saved = await page.evaluate(() => localStorage.getItem('nankai-sim:family:v1')!);
  expect(saved).not.toMatch(/lat|lon|35\.02|136\.50/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('行は8人まで（追加ボタンが無効）。行を消すと追加ボタンにフォーカスが移る', async ({ page }) => {
  await page.goto('/#family');
  for (let i = 0; i < 8; i++) await page.locator('#family-add-row').click();
  await expect(page.locator('.family-row')).toHaveCount(8);
  await expect(page.locator('#family-add-row')).toBeDisabled();
  await page.locator('.family-row-del').first().click();
  await expect(page.locator('.family-row')).toHaveCount(7);
  await expect(page.locator('#family-add-row')).toBeFocused();
});

test('画面が隠れたとき（visibilitychange）に保存待ちを保存する', async ({ page }) => {
  await page.goto('/#family');
  await page.locator('#family-meet1').fill('公園');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:family:v1'))).toContain('公園');
});

test('すべて消す: バックアップも消す。消せないときは「消せませんでした」でフォームはそのまま', async ({ page }) => {
  await page.goto('/#family');
  await page.evaluate(() => localStorage.setItem('nankai-sim:family:v1:backup', 'x'));
  await page.locator('#family-meet1').fill('公園');
  await expect(page.locator('#family-status')).toHaveText('保存しました');
  await page.evaluate(() => {
    const orig = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => { throw new Error('blocked'); };
    (window as unknown as { __orig: unknown }).__orig = orig;
  });
  await page.locator('#family-clear').click();
  await page.locator('#family-clear-yes').click();
  await expect(page.locator('#family-status')).toHaveText('消せませんでした');
  await expect(page.locator('#family-meet1')).toHaveValue('公園');
  await page.evaluate(() => { Storage.prototype.removeItem = (window as unknown as { __orig: typeof Storage.prototype.removeItem }).__orig; });
  await page.locator('#family-clear').click();
  await page.locator('#family-clear-yes').click();
  await expect(page.locator('#family-meet1')).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:family:v1:backup'))).toBeNull();
});
