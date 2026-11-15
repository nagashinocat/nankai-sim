import { expect, test } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

const KOMONO = { lat: 35.02, lon: 136.5072 };

test('一度結果を出した後、通信が切れていても前回の結果が出る（住所は保存されない）', async ({ page, context }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
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
  await expect(last.getByText('想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ')).toBeVisible();
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

// ---- 近い避難場所を電波なしで（避難場所のデータを端末に保存） ----
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };

/** データセーバーをオンにする（自動では保存しない端末。手動の保存ボタンを試す） */
async function saveDataOn(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true }) });
  });
}

async function underServiceWorker(page: import('@playwright/test').Page) {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('避難場所のデータを保存すると、電波なしでも #near に一覧と簡易地図が出る（保存日だけ・専用キャッシュは更新で消えない名前）', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: YOKKAICHI.lat, longitude: YOKKAICHI.lon });
  await page.setViewportSize({ width: 390, height: 844 });
  await saveDataOn(page);
  await underServiceWorker(page);
  await page.goto('/#near');
  const panel = page.locator('#offline-panel');
  await expect(panel.getByText('まだ保存していません。')).toBeVisible();
  await panel.getByRole('button', { name: /^避難場所のデータをこのスマホに保存（約[\d.]+MB）$/ }).click();
  await expect(panel.locator('#offline-status')).toContainText('保存しました', { timeout: 60_000 });
  await expect(panel.locator('#offline-status')).toContainText(/保存済み（\d{4}年\d+月\d+日・[\d,]+か所）/);
  await expect(panel.getByRole('button', { name: '保存したデータを消す' })).toBeVisible();
  await expect(panel.locator('#offline-evict')).toHaveText('しばらく開かないと、スマホが保存したデータを消すことがあります。ホーム画面に追加して使う場合は、ホーム画面から開いて保存してください。');
  // localStorage は日付と件数だけ
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-saved')))!);
  expect(Object.keys(saved).sort()).toEqual(['count', 'savedAt', 'updated']);
  // 専用キャッシュは版つき（nankai-sim-…）と別の名前。activate は nankai-sim- で始まるものだけ消す
  const keys = await page.evaluate(() => caches.keys());
  expect(keys).toContain('nankai-offline-shelters-v1');
  expect(keys.some((k) => k.startsWith('nankai-sim-'))).toBe(true);
  expect('nankai-offline-shelters-v1'.startsWith('nankai-sim-')).toBe(false);
  // 避難場所のファイルは版つきキャッシュに入れない（保存のときも、現在地のまわりを見たときも）
  const dupOf = () => page.evaluate(async () => {
    const k = (await caches.keys()).find((n) => n.startsWith('nankai-sim-'))!;
    return (await (await caches.open(k)).keys()).filter((r) => r.url.includes('/data/shelters/')).length;
  });
  expect(await dupOf()).toBe(0);
  await page.locator('#near-locate').click();
  await expect(page.locator('#near-list')).toBeVisible({ timeout: 30_000 });
  expect(await dupOf()).toBe(0);

  await context.setOffline(true);
  await page.goto('/');
  await expect(page.locator('#offline-bar')).toHaveText('電波がありません。近い避難場所（保存済みなら）・前回の結果・家族の決まりは見られます');
  await page.locator('#near-entry').click();
  await page.locator('#near-locate').click();
  const list = page.locator('#near-list');
  await expect(list.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible({ timeout: 30_000 });
  await expect(list.locator('ol.shelters li').first()).toContainText('直線距離');
  await expect(list.locator('figure.minimap').first()).toBeVisible();
  await expect(page.locator('#near-tsunami')).toHaveText('ここが浸水するかは調べられません。海の近くなら、揺れたらすぐ高い所へ');
  await expect(page.locator('#offline-status')).toContainText('保存済み');
  await expect(page.locator('#near-offline-first')).toHaveCount(0);
  await expect(page.locator('#near-coverage')).toBeVisible();
  // 保存した一覧に無いファイル（海など、避難場所の無い2次メッシュ）は、電波なしでも「無い」（404）
  expect(await page.evaluate(() => fetch('data/shelters/000000.json').then((r) => r.status))).toBe(404);
  await page.screenshot({ path: 'reports/near-offline-390x844.png' });

  // 消す（電波が戻ってから）
  await context.setOffline(false);
  await expect(page.locator('#offline-bar')).toBeHidden();
  await page.getByRole('button', { name: '保存したデータを消す' }).click();
  await expect(page.locator('#offline-status')).toContainText('保存したデータを消しました');
  expect(await page.evaluate(() => caches.keys())).not.toContain('nankai-offline-shelters-v1');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-saved'))).toBeNull();
});

test('保存していないと、電波なしの #near は「保存していないので出せません」とその場でできること', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: YOKKAICHI.lat, longitude: YOKKAICHI.lon });
  await saveDataOn(page);
  await underServiceWorker(page);
  await context.setOffline(true);
  await page.goto('/#near');
  await expect(page.locator('#offline-bar')).toBeVisible();
  // 開いたときから、ボタンの前に「出せません」とできること
  await expect(page.locator('#near-offline-first')).toContainText('保存していないので出せません');
  await expect(page.locator('#near-offline-first')).toContainText('いまできること');
  await page.locator('#near-locate').click();
  await expect(page.locator('#near-not-saved')).toHaveText('電波がなく、避難場所のデータをこのスマホに保存していないので出せません。', { timeout: 30_000 });
  await expect(page.getByText(/すぐ近くの高い所（高台・高い建物の上の階）へ逃げてください/)).toBeVisible();
  await expect(page.locator('#near-tsunami')).toHaveText('ここが浸水するかは調べられません。海の近くなら、揺れたらすぐ高い所へ');
  await expect(page.locator('#offline-status')).toContainText('電波があるときに保存してください。');
  await expect(page.locator('#offline-save')).toBeDisabled();
  // 国土地理院の注意は電波なしでも出る
  await expect(page.locator('#near').getByText(/出典: 国土地理院 指定緊急避難場所データ/)).toBeVisible();
});

// ---- 自動保存（電波があるときに開くと、裏で避難場所のデータを保存） ----
const AUTO_SAVED = /✅ 電波がなくても使えます（\d{4}年\d+月\d+日に自動で保存・[\d,]+か所）/;

test('開くだけで避難場所のデータを自動で保存し、電波なしでも #near に一覧が出る（保存日だけ・住所や座標は保存しない）', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: YOKKAICHI.lat, longitude: YOKKAICHI.lon });
  await underServiceWorker(page); // 1回目の読み込みで始まった保存は、読み込み直しで止まっても続きから
  await page.goto('/#near');
  const panel = page.locator('#offline-panel');
  await expect(panel.locator('#offline-status')).toHaveText(AUTO_SAVED, { timeout: 60_000 });
  await expect(panel.getByRole('button', { name: /^避難場所のデータをこのスマホに保存/ })).toBeHidden();
  await expect(panel.locator('#offline-evict')).toHaveText('一度も開いていないスマホでは使えません／iPhone はしばらく開かないと消えることがあります。ホーム画面に追加すると消えにくくなります');
  const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  expect(Object.keys(JSON.parse(ls['nankai-sim:shelters-saved']!)).sort()).toEqual(['auto', 'count', 'savedAt', 'updated']);
  expect(ls['nankai-sim:shelters-auto-pending']).toBeUndefined();
  expect(JSON.stringify(ls)).not.toMatch(/"(lat|lon|pos)"|34\.96|136\.62/);
  expect(await page.evaluate(() => caches.keys())).toContain('nankai-offline-shelters-v1');

  await context.setOffline(true);
  await page.goto('/');
  await page.locator('#near-entry').click();
  await expect(page.locator('#near-offline-first')).toHaveCount(0);
  await page.locator('#near-locate').click();
  const list = page.locator('#near-list');
  await expect(list.getByRole('heading', { name: '津波の避難場所（近い順）' })).toBeVisible({ timeout: 30_000 });
  await expect(list.locator('ol.shelters li').first()).toContainText('直線距離');
  await expect(page.locator('#offline-status')).toHaveText(AUTO_SAVED);
  // 開き直しても、保存し終えていれば取り直さない
  await context.setOffline(false);
  const saves: string[] = [];
  page.on('request', (r) => { if (/\/data\/shelters\/\d{6}\.json/.test(r.url())) saves.push(r.url()); });
  await page.goto('/');
  await page.waitForTimeout(4000);
  expect(saves).toEqual([]);
});

test('データセーバーの端末では自動で保存しない（今のボタンのまま）', async ({ page }) => {
  await saveDataOn(page);
  await underServiceWorker(page);
  await page.waitForTimeout(4000);
  await page.goto('/#near');
  await page.waitForTimeout(4000);
  const panel = page.locator('#offline-panel');
  await expect(panel.getByText('まだ保存していません。')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^避難場所のデータをこのスマホに保存（約[\d.]+MB）$/ })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).not.toContain('nankai-offline-shelters-v1');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-saved'))).toBeNull();
});

test('「保存したデータを消す」を押したら、次に開いても自動で保存しない（ボタンで保存し直すと元に戻る）', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: YOKKAICHI.lat, longitude: YOKKAICHI.lon });
  await underServiceWorker(page);
  await page.goto('/#near');
  const panel = page.locator('#offline-panel');
  await expect(panel.locator('#offline-status')).toHaveText(AUTO_SAVED, { timeout: 60_000 });
  await panel.getByRole('button', { name: '保存したデータを消す' }).click();
  await expect(panel.locator('#offline-status')).toContainText('保存したデータを消しました');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-auto-off'))).toBe('1');
  await page.reload();
  await page.waitForTimeout(4000);
  await expect(panel.getByText('まだ保存していません。')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^避難場所のデータをこのスマホに保存（約[\d.]+MB）$/ })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).not.toContain('nankai-offline-shelters-v1');
  await expect(panel.locator('#offline-evict')).toHaveText(/^しばらく開かないと/);
  // 電波なしの #near でも「自動で保存されます」は添えない（自動を止めた端末）
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#near-offline-first')).toContainText('保存していないので出せません');
  await expect(page.locator('.near-auto-note')).toHaveCount(0);
  // ボタンで保存し直すと、自動保存の停止を解除
  await context.setOffline(false);
  await page.reload();
  await panel.getByRole('button', { name: /^避難場所のデータをこのスマホに保存/ }).click();
  await expect(panel.locator('#offline-status')).toContainText('保存しました', { timeout: 60_000 });
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-auto-off'))).toBeNull();
});

test('自動保存が失敗しても画面にエラーを出さず、電波なしの #near は「一度開くと自動で保存されます」を添える', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: YOKKAICHI.lat, longitude: YOKKAICHI.lon });
  await context.route(/\/data\/shelters\/\d{6}\.json$/, (r) => r.abort());
  await underServiceWorker(page);
  await page.goto('/#near');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nankai-sim:shelters-auto-pending')), { timeout: 30_000 }).toBe('1');
  await expect.poll(() => page.locator('#offline-status').textContent(), { timeout: 30_000 }).toBe('まだ保存していません。');
  await expect(page.locator('#offline-save')).toBeVisible();
  await expect(page.getByText(/途中で止まりました|読み込めませんでした/)).toHaveCount(0);
  await context.unroute(/\/data\/shelters\/\d{6}\.json$/);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#near-offline-first')).toContainText('保存していないので出せません');
  await expect(page.locator('#near-offline-first .near-auto-note')).toHaveText('電波があるときに一度開くと自動で保存されます。');
  await page.locator('#near-locate').click();
  await expect(page.locator('#near-not-saved')).toHaveText('電波がなく、避難場所のデータをこのスマホに保存していないので出せません。', { timeout: 30_000 });
  await expect(page.locator('#near-status .near-auto-note')).toHaveText('電波があるときに一度開くと自動で保存されます。');
  // 電波が戻って開き直すと、続きから保存する
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#offline-status')).toHaveText(AUTO_SAVED, { timeout: 60_000 });
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:shelters-auto-pending'))).toBeNull();
});
