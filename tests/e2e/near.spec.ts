import { expect, test, type Page } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

// #near（いまいる場所から近い避難場所）。390×844 の画面写しを reports/near-*.png に残す。
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const TOKYO = { lat: 35.6812, lon: 139.7671 }; // 5県の外（避難場所のデータなし）
const gsiHit = (title: string, lat: number, lon: number) => ({
  geometry: { coordinates: [lon, lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title },
});

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function openNearAt(page: Page, pos: { lat: number; lon: number }, accuracy?: number, button = '現在地を使う') {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: pos.lat, longitude: pos.lon, ...(accuracy ? { accuracy } : {}) });
  await page.goto('/');
  await page.locator('#near-entry').click();
  await expect(page).toHaveURL(/#near$/);
  const btn = page.locator('#near-locate');
  await expect(btn).toHaveText(button); // 入力画面の「現在地を使う」と取り違えない
  await btn.click();
}

test('入口: トップとフッターに「いまいる場所から近い避難場所」。押すまで現在地を取らない', async ({ page }) => {
  let asked = 0;
  await page.exposeFunction('__geoAsked', () => { asked++; });
  await page.addInitScript(() => {
    const g = navigator.geolocation;
    const orig = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (...a: Parameters<Geolocation['getCurrentPosition']>) => { (window as unknown as { __geoAsked(): void }).__geoAsked(); return orig(...a); };
  });
  await page.goto('/');
  await expect(page.locator('#near-entry')).toHaveText(/いまいる場所から近い避難場所/);
  await expect(page.locator('#near-footer-link')).toBeVisible();
  await page.locator('#near-footer-link').click();
  await expect(page.getByRole('heading', { name: /いまいる場所から近い避難場所/ })).toBeVisible();
  await expect(page.locator('#main-view')).toBeHidden();
  await expect(page.getByText('保存も送信もしません')).toBeVisible();
  // 国土地理院の注意（そのまま）と出典
  await expect(page.locator('#near').getByText('指定緊急避難場所（命を守るために緊急に逃げる場所）と指定避難所（一定期間滞在する施設）は別のものです')).toBeVisible();
  await expect(page.locator('#near').getByText(/出典: 国土地理院 指定緊急避難場所データ/)).toBeVisible();
  expect(asked).toBe(0);
  await page.getByRole('button', { name: 'トップにもどる' }).click();
  await expect(page.locator('#main-view')).toBeVisible();
});

test('現在地から: 津波・地震の一覧と簡易地図（最初の1件は開いている）。保存しない', async ({ page }) => {
  await openNearAt(page, YOKKAICHI);
  const list = page.locator('#near-list');
  await expect(list.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible({ timeout: 30_000 });
  await expect(list.getByRole('heading', { name: '地震の避難場所（近い順）' })).toBeVisible();
  const items = list.locator('ol.shelters').first().locator('li');
  expect(await items.count()).toBeGreaterThan(0);
  expect(await items.count()).toBeLessThanOrEqual(5);
  await expect(items.first()).toContainText('直線距離');
  await expect(items.first()).toContainText('ゆっくり');
  // 最初の1件の簡易地図
  const fig = items.first().locator('figure.minimap');
  await expect(fig).toBeVisible();
  await expect(fig.getByRole('img', { name: /^簡易地図：いまの場所から.+は(北|北東|東|南東|南|南西|西|北西)へ 約[\d.]+k?m$|すぐ近く/ })).toBeVisible();
  await expect(fig.locator('.minimap-text')).toHaveText(/^((北|北東|東|南東|南|南西|西|北西)へ 約[\d.]+k?m|すぐ近く（約10m以内）)・ゆっくり歩いて約\d+分$/);
  await expect(fig.getByText('直線の方向と距離です。道は実際に確かめてください')).toBeVisible();
  await expect(fig.getByText('北が上です')).toBeVisible();
  await expect(fig.getByRole('button', { name: '🧭 向きを合わせる' })).toBeVisible();
  // 2件目は閉じていて、押すと開く
  const second = items.nth(1);
  if (await second.count()) {
    await expect(second.locator('figure.minimap')).toHaveCount(0);
    await second.getByRole('button', { name: '🗺 地図' }).click();
    await expect(second.locator('figure.minimap')).toBeVisible();
    await second.getByRole('button', { name: '🗺 地図を閉じる' }).click();
    await expect(second.locator('figure.minimap')).toHaveCount(0);
  }
  await expect(list.locator('.near-sea-first')).toHaveText('海の近くなら、まず近くの高い所へ');
  await expect(page.locator('#near-coverage')).toBeVisible();
  // 津波の行（スタブは浸水域外）
  await expect(page.locator('#near-tsunami')).toContainText('想定を超える津波もあり得ます');
  await noOverflow(page);
  await page.evaluate(() => document.getElementById('near-list')!.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/near-adult-390x844.png', fullPage: false });
  // 座標・住所はどこにも保存しない
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(String(YOKKAICHI.lat));
  expect(stored).not.toContain('34.96');
  expect(page.url()).not.toContain('34.9');
  // 画面を離れると消える
  await page.getByRole('button', { name: 'トップにもどる' }).click();
  await expect(page.locator('#near')).toBeEmpty();
});

test('コンパスが使えない端末では北が上のまま、と出る', async ({ page }) => {
  await openNearAt(page, YOKKAICHI);
  const fig = page.locator('#near-list figure.minimap').first();
  await expect(fig).toBeVisible({ timeout: 30_000 });
  await fig.getByRole('button', { name: '🧭 向きを合わせる' }).click();
  await expect(fig.getByText('この端末では向きを合わせられません。北が上のままです')).toBeVisible({ timeout: 10_000 });
  await expect(fig.getByRole('button', { name: '🧭 向きを合わせる' })).toBeVisible();
});

const grantOrientation = (page: Page) => page.addInitScript(() => {
  (DeviceOrientationEvent as unknown as { requestPermission(): Promise<string> }).requestPermission = () => Promise.resolve('granted');
});

async function northTipXAfter(page: Page, fire: () => void): Promise<number> {
  const fig = page.locator('#near-list figure.minimap').first();
  await expect(fig).toBeVisible({ timeout: 30_000 });
  await fig.getByRole('button', { name: '🧭 向きを合わせる' }).click();
  await page.evaluate(fire);
  await expect(fig.locator('.minimap-status')).toHaveText('向きを合わせています（スマホの上は東）');
  const d = (await fig.locator('.minimap-north').getAttribute('d'))!;
  return Number(/^M([\d.-]+)/.exec(d)![1]);
}

test('コンパス: iPhone（webkitCompassHeading）で東を向くと、北は左', async ({ page }) => {
  await grantOrientation(page);
  await openNearAt(page, YOKKAICHI);
  const x = await northTipXAfter(page, () => {
    const e = new Event('deviceorientation');
    Object.assign(e, { webkitCompassHeading: 90, alpha: 12, absolute: false }); // 東向き（alpha は北と関係ない値）
    window.dispatchEvent(e);
  });
  expect(x).toBeLessThan(40);
});

test('コンパス: Android（deviceorientationabsolute）で東を向くと、図が回る（iPhone と同じ向き）', async ({ page }) => {
  await grantOrientation(page);
  await openNearAt(page, YOKKAICHI);
  const fig = page.locator('#near-list figure.minimap').first();
  await expect(fig).toBeVisible({ timeout: 30_000 });
  const northBefore = await fig.locator('.minimap-north').getAttribute('d');
  const tipX = await northTipXAfter(page, () => {
    // 相対の deviceorientation（Android の既定）は使わない
    const rel = new Event('deviceorientation');
    Object.assign(rel, { alpha: 0, absolute: false });
    window.dispatchEvent(rel);
    const e = new Event('deviceorientationabsolute');
    Object.assign(e, { alpha: 270, absolute: true }); // 東向き
    window.dispatchEvent(e);
  });
  // 東を向くと、北は画面の左
  expect(await fig.locator('.minimap-north').getAttribute('d')).not.toBe(northBefore);
  expect(tipX).toBeLessThan(40);
  await fig.getByRole('button', { name: '北を上にもどす' }).click();
  await expect(fig.getByText('北が上です')).toBeVisible();
});

test('位置情報が拒否されたら、何をすればよいか出る', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => { err?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError); };
  });
  await page.goto('/#near');
  await page.getByRole('button', { name: '現在地を使う' }).click();
  await expect(page.locator('#near-error')).toHaveText(/現在地の利用が許可されていません。.*許可してから、もう一度/);
  await expect(page.locator('#near-list')).toHaveCount(0);
});

test('現在地を取得できない（時間切れ）', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => { err?.({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError); };
  });
  await page.goto('/#near');
  await page.getByRole('button', { name: '現在地を使う' }).click();
  await expect(page.locator('#near-error')).toHaveText(/現在地を取得できませんでした.*もう一度/);
});

test('5県の外: 一覧を出さず「まだ対応していません」と市町村の確認。位置の誤差', async ({ page }) => {
  await openNearAt(page, TOKYO, 350);
  const out = page.locator('#near-outside');
  await expect(out).toContainText('この地域はまだ対応していません', { timeout: 30_000 });
  await expect(out).toContainText('最寄りの市町村のハザードマップ・避難場所を確認してください');
  await expect(page.locator('#near-list')).toHaveCount(0);
  await expect(page.locator('#near-coverage')).toHaveText('静岡・愛知・岐阜・三重・和歌山の5県のデータだけです。');
  await expect(page.locator('#near-accuracy')).toHaveText(/位置の誤差が約350mあります/);
});

test('5県の中でも避難場所のデータが無い（0件）', async ({ page }) => {
  await page.route('**/data/shelters/*.json', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await openNearAt(page, YOKKAICHI);
  await expect(page.locator('#near-none')).toHaveText(/近くに登録された避難場所がありません（5県の外か、データが無い場所）/, { timeout: 30_000 });
});

test('避難場所のデータが読めない（電波あり）: 文と「いまできること」', async ({ page }) => {
  await page.route('**/data/shelters/*.json', (r) => r.abort());
  await openNearAt(page, YOKKAICHI);
  await expect(page.locator('#near-error')).toHaveText('避難場所のデータを読み込めませんでした。通信状況を確認して、もう一度お試しください。', { timeout: 30_000 });
  await expect(page.locator('#near-todo')).toContainText('いまできること');
  await expect(page.locator('#near-todo')).toContainText('すぐ近くの高い所');
});

test('結果画面: 避難場所の「🗺 地図」で簡易地図を開閉（中心は自宅）', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('四日市市', YOKKAICHI.lat, YOKKAICHI.lon)] }));
  await page.goto('/');
  await page.getByLabel('住所').fill('四日市市');
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  const evac = page.locator('#evac');
  await expect(evac.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible({ timeout: 30_000 });
  const first = evac.locator('ol.shelters li').first();
  await expect(first.locator('figure.minimap')).toHaveCount(0);
  await first.getByRole('button', { name: '🗺 地図' }).click();
  const fig = first.locator('figure.minimap');
  await expect(fig).toBeVisible();
  await expect(fig.getByRole('img', { name: /^簡易地図：自宅の場所から/ })).toBeVisible();
  await expect(fig.getByText('直線の方向と距離です。道は実際に確かめてください')).toBeVisible();
  await expect(evac.locator('#near-entry-result')).toBeVisible();
  await noOverflow(page);
  await fig.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'reports/near-result-map-390x844.png' });
  await first.getByRole('button', { name: '🗺 地図を閉じる' }).click();
  await expect(fig).toHaveCount(0);
});

test('こども: 大きな矢印1つ「この むきに 約○m」', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#near-entry')).toHaveText(/いま いる ところから ちかい にげる ばしょ/);
  await openNearAt(page, YOKKAICHI, undefined, 'いまの ばしょを しらべる');
  const sec = page.locator('#kid-near-tsunami');
  await expect(sec).toBeVisible({ timeout: 30_000 });
  const fig = sec.locator('figure.kid-minimap');
  await expect(fig).toBeVisible();
  await expect(fig.locator('.minimap-text')).toHaveText(/^この むきに 約やく[\d.]+k?m$/);
  await expect(fig.locator('rt')).toHaveText('やく');
  await expect(fig.locator('.minimap-arrow')).toHaveCount(1);
  await expect(fig.locator('.minimap-other')).toHaveCount(0);
  await expect(fig.getByText('まっすぐの むきと きょり だよ。みちは おうちの ひとと たしかめてね')).toBeVisible();
  await expect(page.locator('#near').getByText(/出典: 国土地理院/)).toBeVisible();
  await expect(sec.locator('.near-sea-first')).toHaveText('うみの ちかくなら、まず ちかくの たかい ところへ');
  await noOverflow(page);
  await sec.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/near-kids-390x844.png' });
  // おとなに切り替えても、取り直さずに一覧が出る
  await page.locator('#near-adult').click();
  await expect(page.locator('#near-list')).toBeVisible();
});

test('こども: 位置が分からないときの文は赤くしない', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('nankai-sim:ui:kids', '1');
    navigator.geolocation.getCurrentPosition = (_ok, err) => { err?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError); };
  });
  await page.goto('/#near');
  await page.getByRole('button', { name: 'いまの ばしょを しらべる' }).click();
  const e = page.locator('#near-error');
  await expect(e).toHaveText('いまの ばしょが わからないよ。おうちの ひとに みて もらってね');
  expect(await e.evaluate((n) => getComputedStyle(n).color)).toBe('rgb(31, 42, 68)');
});
