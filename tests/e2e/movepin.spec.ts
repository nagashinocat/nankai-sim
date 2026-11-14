import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

const hasRealData = fs.existsSync('public/data/manifest.json') && fs.existsSync('public/data/tsunami_arrival.json');
/** 四日市市の北の端（東へ約1km 動かすと川越町） */
const YOKKAICHI_N = { lat: 35.01898, lon: 136.64548 };
const KAWAGOE = { lat: 35.01898, lon: 136.65645 };
/** 四日市市の住所の点（東へ約2km は海＝メッシュなし） */
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const ATAMI = { lat: 35.096, lon: 139.0717 };
const YUGAWARA = { lat: 35.148, lon: 139.108 };
const KOMONO = { lat: 35.02, lon: 136.5072 };
/** この経度より東だけ浸水（川越町の点は浸水域内、四日市の北の点は浸水域外） */
const COAST = { rgb: [255, 216, 192] as [number, number, number], floodEastOf: 136.65 };
const ESCAPE_RE = /^近い津波の避難場所「\d」：(北|北東|東|南東|南|南西|西|北西)に約[\d.]+k?m（直線）/;

async function routeAddress(page: Page, at: { lat: number; lon: number }, title: string): Promise<void> {
  await page.unroute('**/msearch.gsi.go.jp/**');
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [{ geometry: { coordinates: [at.lon, at.lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title } }] }));
}

async function search(page: Page, at: { lat: number; lon: number }, title: string, wait = true): Promise<void> {
  await routeAddress(page, at, title);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill(title);
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  if (wait) await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
}

/** Web メルカトルの画素（ズーム z、256px タイル） */
function worldPx(p: { lat: number; lon: number }, z: number): [number, number] {
  const n = 2 ** z * 256;
  const r = (p.lat * Math.PI) / 180;
  return [((p.lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** いまのズーム（地理院タイルの URL から。タイルは読めないが img は残る） */
async function mapZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const levels = [...document.querySelectorAll<HTMLElement>('#result-map .leaflet-tile-container')]
      .filter((c) => c.querySelector('img[src*="cyberjapandata"]'));
    const top = levels.sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0];
    const src = top.querySelector<HTMLImageElement>('img[src*="cyberjapandata"]')!.src;
    return Number(/\/(\d+)\/\d+\/\d+\.png/.exec(src)![1]);
  });
}

/** 地図をドラッグして、from（いまの中央）から to を中央に持ってくる（慣性で流れないよう、止まってから離す） */
async function panTo(page: Page, from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<void> {
  const z = await mapZoom(page);
  const [ax, ay] = worldPx(from, z);
  const [bx, by] = worldPx(to, z);
  let rx = -(bx - ax), ry = -(by - ay);
  const box = (await page.locator('#result-map').boundingBox())!;
  const cx = box.x + box.width / 2 + 30, cy = box.y + box.height / 2 + 40;
  const clamp = (v: number) => Math.max(-110, Math.min(110, v));
  while (Math.abs(rx) >= 1 || Math.abs(ry) >= 1) {
    const sx = Math.round(clamp(rx)), sy = Math.round(clamp(ry));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + sx / 2, cy + sy / 2, { steps: 4 });
    await page.mouse.move(cx + sx, cy + sy, { steps: 4 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    rx -= sx; ry -= sy;
    if (sx === 0 && sy === 0) break;
  }
  await page.waitForTimeout(150);
}

const noOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);
};
const savedRaw = (page: Page) => page.evaluate(() => localStorage.getItem('nankai-sim:last') ?? '');

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
});

test('ピンを動かす: 十字を合わせて調べ直す → 市町村・矢印の文が変わり、タブと地図の表示は残る。保存に座標なし。もどすで元の結果', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  await expect(page.locator('#case-line')).toContainText('四日市市');
  await expect(page.locator('#location-note')).toHaveText('三重県四日市市 付近で計算しました');
  await expect(page.locator('#risk-escape-text')).toContainText('念のため');
  await expect(page.locator('#pin-reset')).toHaveCount(0);
  // タブと地図の表示を変えておく
  await page.getByRole('tab', { name: '東側の半割れ', exact: true }).click();
  await expect(page.locator('#case-line')).toContainText('東側の半割れ');
  await page.locator('#risk-mode-tsunami').click();

  // 編集モード: 十字・案内・ボタン。自宅の印は薄く
  const move = page.locator('#pin-move');
  await expect(move).toBeVisible();
  expect((await move.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await move.click();
  await expect(page.locator('#pin-crosshair')).toBeVisible();
  await expect(page.locator('#pin-crosshair')).toContainText('ここを調べる');
  await expect(page.locator('#pin-crosshair')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('#pin-status')).toHaveText('地図を動かして、十字を調べたい場所に合わせてください');
  await expect(page.locator('#pin-confirm')).toHaveText('ここで調べ直す');
  await expect(page.locator('#pin-cancel')).toHaveText('やめる');
  for (const b of ['#pin-confirm', '#pin-cancel']) expect((await page.locator(b).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(move).toBeHidden();
  expect(Number(await page.locator('#result-map .leaflet-home-pane').evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.5);
  // 十字は地図の真ん中
  const mb = (await page.locator('#result-map').boundingBox())!;
  const cb = (await page.locator('#pin-crosshair svg').boundingBox())!;
  expect(Math.abs(cb.x + cb.width / 2 - (mb.x + mb.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(cb.y + cb.height / 2 - (mb.y + mb.height / 2))).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await page.locator('#risk-panel').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'reports/movepin-edit-390x844.png' });

  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#case-line')).toContainText('川越町', { timeout: 30_000 });
  await expect(page.locator('#location-note')).toHaveText(/^ピンの位置で計算しました（住所の位置から 東へ約(9[89]0m|1\.0km)）$/);
  await expect(page.locator('#pin-reset')).toHaveText('住所の位置にもどす');
  await expect(page.locator('#risk-moved')).toContainText('ピンの位置で計算しました');
  // タブ（東側の半割れ）と地図の表示（津波）が残る
  await expect(page.getByRole('tab', { name: '東側の半割れ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#case-line')).toContainText('東側の半割れ');
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#risk-mode-tsunami')).toHaveAttribute('aria-pressed', 'true');
  // 新しい地点は浸水域内 → 矢印と文
  await expect(page.locator('#risk-escape-text')).toHaveText(ESCAPE_RE);
  await expect(page.locator('#result-map path.rm-arrow')).toHaveCount(1);
  await expect(page.locator('#pin-crosshair')).toHaveCount(0);
  // 保存は市町村名まで（座標・動かした旨の文・住所なし）。URL にも入れない
  await expect.poll(() => savedRaw(page)).toContain('川越町');
  const saved = await savedRaw(page);
  expect(saved).not.toMatch(/"lat"|"lon"|35\.01|136\.6|ピンの位置|住所の位置|四日市市/);
  expect(page.url()).not.toMatch(/35\.|136\.|[?#]./);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'reports/movepin-moved-390x844.png' });
  await page.locator('#result').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'reports/movepin-moved-top-390x844.png' });

  // もどす → 元の結果（タブは残る）
  await page.locator('#pin-reset').click();
  await expect(page.locator('#case-line')).toContainText('四日市市', { timeout: 30_000 });
  await expect(page.locator('#location-note')).toHaveText('三重県四日市市 付近で計算しました');
  await expect(page.locator('#pin-reset')).toHaveCount(0);
  await expect(page.locator('#risk-moved')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '東側の半割れ', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#risk-escape-text')).toContainText('念のため');
  await expect.poll(() => savedRaw(page)).toContain('四日市市');
  expect(errors).toEqual([]);
});

test('ピンを動かす: やめる → 十字が消え、計算し直さない。十字を動かさずに「ここで調べ直す」も何もしない', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  await page.locator('#pin-move').click();
  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-cancel').click();
  await expect(page.locator('#pin-crosshair')).toHaveCount(0);
  await expect(page.locator('#pin-move')).toBeVisible();
  await expect(page.locator('#pin-move')).toBeFocused();
  await expect(page.locator('#pin-status')).toBeHidden();
  await page.waitForTimeout(500);
  await expect(page.locator('#case-line')).toContainText('四日市市');
  await expect(page.locator('#location-note')).toHaveText('三重県四日市市 付近で計算しました');
  await page.locator('#pin-move').click();
  await page.locator('#pin-confirm').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#location-note')).toHaveText('三重県四日市市 付近で計算しました');
  await expect(page.locator('#pin-move')).toBeVisible();
});

test('ピンを動かす: 対応範囲外に動かす → 対応していない表示。もどすで元の市町村', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, 'none');
  await search(page, ATAMI, '静岡県熱海市');
  await expect(page.locator('#case-line')).toContainText('熱海市');
  await page.locator('#pin-move').click();
  // 縮小してから動かす（ズームは十字＝中央を中心に）
  for (let i = 0; i < 3; i++) { await page.locator('#result-map').getByRole('button', { name: 'Zoom out' }).click(); await page.waitForTimeout(350); }
  await panTo(page, ATAMI, YUGAWARA);
  await page.locator('#pin-confirm').click();
  await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#location-note')).toHaveText(/^ピンの位置で計算しました（住所の位置から 北東へ約6\.\dkm）$/);
  await expect(page.locator('#evac')).toHaveCount(0);
  await expect(page.locator('#risk-home .rm-home-title')).toHaveText('対応範囲外');
  // 範囲外でも動かし直せる・もどせる
  await expect(page.locator('#pin-move')).toBeVisible();
  await page.locator('#pin-reset').click();
  await expect(page.locator('#case-line')).toContainText('熱海市', { timeout: 30_000 });
  await expect(page.locator('#evac')).toBeVisible();
});

test('ピンを動かす: 海の上（メッシュなし）に動かしても壊れない', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubTsunami(page, 'none');
  await search(page, YOKKAICHI, '三重県四日市市');
  await page.locator('#pin-move').click();
  const sea = { lat: YOKKAICHI.lat, lon: YOKKAICHI.lon + 2200 / (111_320 * Math.cos((YOKKAICHI.lat * Math.PI) / 180)) };
  await panTo(page, YOKKAICHI, sea);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#location-note')).toHaveText(/^ピンの位置で計算しました（住所の位置から 東へ約2\.\dkm）$/, { timeout: 30_000 });
  await expect(page.locator('#home-result')).toContainText(/この場所のデータなし|対応していません|震度\d/);
  await expect(page.locator('#risk-panel')).toBeVisible();
  await expect(page.locator('#pin-move')).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('ピンを動かす: 調べ直しの最中に住所を入れ直すと、新しい住所の結果だけが残る（移動の状態もリセット）', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  // ここからのデータの読み込みを遅くする
  const slow = async (r: import('@playwright/test').Route) => { await new Promise((ok) => setTimeout(ok, 1500)); await r.fallback(); };
  await page.route('**/data/**', slow);
  await page.route('**/disaportaldata.gsi.go.jp/**', slow);
  await page.locator('#pin-move').click();
  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#pin-status')).toHaveText('この場所で計算しています…');
  // 計算中は結果に触れない（古い場所のタブの計算を始めない）
  expect(await page.locator('#result').evaluate((e) => (e as HTMLElement).inert)).toBe(true);
  await routeAddress(page, KOMONO, '三重県三重郡菰野町');
  await page.getByLabel('住所').fill('三重県三重郡菰野町');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#case-line')).toContainText('菰野町', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await expect(page.locator('#case-line')).toContainText('菰野町');
  await expect(page.locator('#location-note')).toHaveText('三重県三重郡菰野町 付近で計算しました');
  await expect(page.locator('#pin-reset')).toHaveCount(0);
  expect(await page.locator('#result').evaluate((e) => (e as HTMLElement).inert)).toBe(false);
});

test('ピンを動かす: 動かしたあと住所を入れ直すと、移動の状態はリセット', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  await page.locator('#pin-move').click();
  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#pin-reset')).toBeVisible({ timeout: 30_000 });
  await routeAddress(page, KOMONO, '三重県三重郡菰野町');
  await page.getByLabel('住所').fill('三重県三重郡菰野町');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#case-line')).toContainText('菰野町', { timeout: 30_000 });
  await expect(page.locator('#location-note')).toHaveText('三重県三重郡菰野町 付近で計算しました');
  await expect(page.locator('#pin-reset')).toHaveCount(0);
  await expect(page.locator('#risk-moved')).toHaveCount(0);
});

test('ピンを動かす（こども）: ボタンは出さない。動かした結果はこどもの画面にも反映。編集中に切り替えたら十字は消える', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#kid-risk')).toBeVisible();
  await expect(page.locator('#kid-risk #pin-move, #kid-risk .rm-move')).toHaveCount(0);
  await expect(page.locator('#pin-move')).toBeHidden();
  await expect(page.locator('#kid-risk-map path.rm-arrow')).toHaveCount(0);
  // おとなで動かして、こどもへ
  await page.getByRole('button', { name: 'おとな', exact: true }).click();
  await page.locator('#pin-move').click();
  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#case-line')).toContainText('川越町', { timeout: 30_000 });
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#kid-risk-map path.rm-arrow')).toHaveCount(1);
  await expect(page.locator('#pin-move')).toBeHidden();
  // 編集中にこどもへ → 十字は消える。おとなに戻すと編集前の状態
  await page.getByRole('button', { name: 'おとな', exact: true }).click();
  await page.locator('#pin-move').click();
  await expect(page.locator('#pin-crosshair')).toBeVisible();
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#pin-crosshair')).toHaveCount(0);
  await page.getByRole('button', { name: 'おとな', exact: true }).click();
  await expect(page.locator('#pin-move')).toBeVisible();
  await expect(page.locator('#pin-bar')).toBeHidden();
  await noOverflow(page);
});

test('ピンを動かす: 調べ直しに失敗したら、元の地点の結果のまま失敗の文。もう一度動かせる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI_N, '三重県四日市市');
  await page.route('**/data/**', (r) => r.abort());
  await page.locator('#pin-move').click();
  // 南へ約2.5km（別の2次メッシュ＝まだ読んでいないファイル）
  await panTo(page, YOKKAICHI_N, { lat: YOKKAICHI_N.lat - 2500 / 111_320, lon: YOKKAICHI_N.lon });
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#pin-status')).toContainText('うまく調べられませんでした', { timeout: 30_000 });
  await expect(page.locator('#case-line')).toContainText('四日市市');
  await expect(page.locator('#location-note')).toHaveText('三重県四日市市 付近で計算しました');
  expect(await page.locator('#result').evaluate((e) => (e as HTMLElement).inert)).toBe(false);
  await expect(page.locator('#pin-move')).toBeEnabled();
  await page.unroute('**/data/**');
  await page.locator('#pin-move').click();
  await expect(page.locator('#pin-status')).toHaveText('地図を動かして、十字を調べたい場所に合わせてください');
  await panTo(page, YOKKAICHI_N, KAWAGOE);
  await page.locator('#pin-confirm').click();
  await expect(page.locator('#case-line')).toContainText('川越町', { timeout: 30_000 });
});
