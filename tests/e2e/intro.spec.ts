import { expect, test } from '@playwright/test';

test('1ページ目: サイト説明と住所の扱いが入力欄より上に出る・くわしくでプライバシーへ', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const addr = page.locator('#intro-addr');
  await expect(page.getByRole('heading', { name: 'このサイトでできること' })).toBeVisible();
  await expect(addr).toBeVisible();
  await expect(addr).toContainText('保存しません');
  await expect(addr).toContainText('送りません');
  await expect(addr).toContainText('国土地理院には送ります');
  // 住所の扱いは入力欄より上
  const a = await addr.boundingBox();
  const f = await page.getByLabel('住所').boundingBox();
  expect(a!.y).toBeLessThan(f!.y);
  // 横にはみ出さない
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await addr.getByRole('link', { name: 'くわしく' }).click();
  await expect(page.locator('#privacy')).toBeVisible();
  await expect(page.locator('#privacy')).toBeInViewport();
});

test('1ページ目: 前回の結果がある人には1行、こどもモードは1行', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('nankai-sim:kids', '1'));
  await page.getByRole('button', { name: 'こども' }).click();
  await expect(page.locator('#intro-addr-line')).toContainText('おうちの ばしょは どこにも のこらないよ');
  await expect(page.locator('#intro-addr')).toHaveCount(0);
});
