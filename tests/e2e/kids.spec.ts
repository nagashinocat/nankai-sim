import { expect, test, type Page } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

// こどもモード（表示だけ）。390×844 の画面写しを reports/kids-*.png に残す。
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const gsiHit = (title: string, lat: number, lon: number) => ({
  geometry: { coordinates: [lon, lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title },
});
const PHRASES = /ものが ゆれて おどろく|たなの ものが おちる ことも|あるくのが むずかしい|たって いるのが むずかしい|たって いられない。はって うごくのも むずかしい|たって いられない。からだが とばされる ことも/;

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
  await page.setViewportSize({ width: 390, height: 844 });
});

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function toKids(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.getByRole('button', { name: 'こども', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

async function search(page: Page) {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('四日市市', YOKKAICHI.lat, YOKKAICHI.lon)] }));
  await page.getByLabel('住所').fill('四日市市');
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
}

test('きりかえ: 既定は おとな。こどもを えらぶと 再読み込みのあとも のこる', async ({ page }) => {
  await page.goto('/');
  const kidsBtn = page.getByRole('button', { name: 'こども', exact: true });
  const adultBtn = page.getByRole('button', { name: 'おとな', exact: true });
  await expect(adultBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(kidsBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#kids-input-note')).toBeHidden();
  await kidsBtn.click();
  await expect(kidsBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#kids-input-note')).toHaveText('おうちの ひとと いっしょに いれてね');
  // 入力フォームは おとなの まま
  await expect(page.getByLabel('住所')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:ui:kids'))).toBe('1');
  await page.reload();
  await expect(page.getByRole('button', { name: 'こども', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/kids/);
  const box = await page.getByRole('button', { name: 'こども', exact: true }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'おとな', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'おとな', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('nankai-sim:ui:kids'))).toBe('0');
});

test('こどもの けっか: ゆれ・いえ・つなみ・やること。タブ・おとなへの きりかえ（計算しなおさない）', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  let hazardRequests = 0;
  page.on('request', (r) => { if (/\/data\/hazard\//.test(r.url())) hazardRequests++; });
  await toKids(page);
  await search(page);
  const shake = page.locator('#kid-shake');
  await expect(shake.locator('.kid-shindo')).toBeVisible({ timeout: 30_000 });
  await expect(shake.locator('.kid-shindo ruby').first()).toContainText('震度');
  await expect(shake.locator('.kid-shindo rt').first()).toHaveText('しんど');
  await expect(shake.locator('.kid-shindo .sr-only')).toHaveText(/^しんど\d/);
  expect(await shake.locator('.kid-shindo').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(31, 42, 68)');
  await expect(shake.locator('.kid-phrase')).toHaveText(PHRASES);
  await expect(shake.getByRole('img', { name: /^(おちついた|しんぱいな|こまった) かおの マーク$/ })).toBeVisible();
  await expect(shake.getByRole('img', { name: /^ゆれメーター：7だんかいの [1-7]ばんめ$/ })).toBeVisible();
  await expect(shake.locator('.kid-meter-on')).toHaveCount(1);
  // いえ
  const house = page.locator('#kid-house');
  await expect(house.locator('.kid-houses svg')).toHaveCount(10);
  await expect(house.locator('.kid-key-collapse')).toHaveText(/^こわれて すめなくなる … (\d+けんくらい|1けんより すくない)$/);
  await expect(house.locator('.kid-key-half')).toHaveText(/^かたむいたり ひびが はいる … (\d+けんくらい|1けんより すくない)$/);
  await expect(house.locator('.kid-key-ok')).toHaveText('のこり（すこしは こわれるかも）');
  await expect(house.locator('.kid-tip')).toHaveText('じょうぶな いえに すると、こわれる いえは へらせます。おうちの ひとと はなして みよう。');
  // 家の数は おとなの 10軒の列と同じ
  const kidCounts = await house.evaluate((h) => [h.querySelectorAll('.kid-house-collapse').length, h.querySelectorAll('.kid-house-half').length]);
  // つなみ
  const tsu = page.locator('#kid-tsunami');
  await expect(tsu.getByRole('img', { name: /つなみの え。みずの ふかさは 1から 3メートル/ })).toBeVisible();
  await expect(tsu.locator('svg text', { hasText: 'きみ（1.3m）' })).toHaveCount(1);
  await expect(tsu.locator('svg text', { hasText: 'おとな（1.7m）' })).toHaveCount(1);
  await expect(tsu.locator('.kid-tsunami-phrase')).toHaveText('おとなの せたけより ふかい。');
  await expect(tsu.locator('.kid-arrival-text')).toHaveText('はやいと 15ふんで うみに つく。もっと はやく くる ことも あるよ。まって いたら まにあわない！');
  // やること
  const act = page.locator('#kid-actions');
  await expect(act.locator('.kid-action')).toHaveCount(3);
  await expect(act.locator('#kid-action-escape .kid-big')).toHaveText('たかい ところへ にげる');
  await expect(act.locator('#kid-action-escape')).toHaveClass(/kid-tone-red/);
  await expect(page.locator('#kid-closing')).toHaveText('しって いれば、まもれる。おうちの ひとと いっしょに みてね。');
  await expect(page.getByRole('link', { name: 'かぞくの きまりを みる' })).toBeVisible();
  // ちず・ひなんばしょ・しゅうへんの かずは かくす
  await expect(page.locator('#result-map')).toBeHidden();
  await expect(page.locator('#evac')).toBeHidden();
  await expect(page.locator('#home-result')).toBeHidden();
  // タブは こどもの なまえ
  await expect(page.getByRole('tab', { name: 'いちばん おおきい じしん' })).toHaveAttribute('aria-selected', 'true');
  await noOverflow(page);
  await page.screenshot({ path: 'reports/kids-result-top-390x844.png' });
  await house.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/kids-result-house-390x844.png' });
  await tsu.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/kids-result-tsunami-390x844.png' });
  await act.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/kids-result-actions-390x844.png' });

  // タブを かえても こどもの まま
  await page.getByRole('tab', { name: 'ひがしがわ だけ' }).click();
  await expect(page.getByRole('tab', { name: 'ひがしがわ だけ' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#kid-shake')).toBeVisible();
  await expect(page.locator('#kid-shake .kid-shindo, #kid-shake .kid-nodata')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#home-result')).toBeHidden();
  await page.getByRole('tab', { name: 'いちばん おおきい じしん' }).click();
  await expect(page.locator('#kid-shake .kid-shindo')).toBeVisible();

  // おとなへ（計算しなおさない）
  const before = hazardRequests;
  await page.getByRole('button', { name: 'おとなの がめんで ちずを みる' }).click();
  await expect(page.getByRole('button', { name: 'おとな', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#home-result')).toBeVisible();
  await expect(page.locator('#result-map')).toBeVisible();
  await expect(page.getByRole('tab', { name: '最大クラス', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#kid-shake')).toHaveCount(0);
  // おとなの 10軒の列と同じ数
  const adultCounts = await page.locator('#home-result .house-icons').first().evaluate((h) => {
    const fills = [...h.querySelectorAll('path')].map((p) => p.getAttribute('fill'));
    return [fills.filter((f) => f === '#b3261e').length, fills.filter((f) => f === '#f0a040').length];
  });
  expect(adultCounts).toEqual(kidCounts);
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#kid-shake .kid-shindo')).toBeVisible();
  expect(hazardRequests).toBe(before);
});

test('うごきで みる（こども）: さいごは「きめた ばしょで あう」', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await toKids(page);
  await search(page);
  await page.getByRole('button', { name: 'うごきで みて みよう' }).click();
  const player = page.locator('#player');
  await expect(player.getByRole('heading', { name: 'うごきで みる' })).toBeVisible();
  await expect(player.locator('.player-clock')).toHaveText('じしんが おきた ところ');
  await expect(player.locator('#player-caption')).toHaveText('あたまを まもる');
  await expect(player.locator('.player-cap-small')).toHaveText('いま なにを する？');
  await expect(player.locator('svg text', { hasText: 'もしきず（ほんとうの きょりとは ちがいます）' })).toHaveCount(1);
  await expect(player.locator('.kid-badge ruby').first()).toContainText('震度');
  await player.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/kids-player-shake-390x844.png' });
  const next = player.getByRole('button', { name: 'つぎへ' });
  await next.click();
  await expect(player.locator('#player-caption')).toHaveText('たかい ところへ にげる');
  await expect(player.locator('#player-live')).toHaveClass(/kid-cap-red/);
  await expect(player.locator('.player-clock')).toHaveText('じしんから 5ふん');
  await page.screenshot({ path: 'reports/kids-player-evac-390x844.png' });
  await next.click();
  await expect(player.locator('#player-caption')).toHaveText('もどっては だめ');
  await expect(player.locator('.player-cap-note')).toContainText('はやいと 15ふんで うみに つく');
  await next.click();
  await expect(player.locator('#player-caption')).toHaveText('みずが ここまで くる かも');
  await expect(player.getByRole('img', { name: /つなみの え/ })).toBeVisible();
  await page.screenshot({ path: 'reports/kids-player-water-390x844.png' });
  await next.click();
  await expect(player.locator('#player-caption')).toHaveText('きめた ばしょで あう');
  await expect(next).toBeDisabled();
  await page.screenshot({ path: 'reports/kids-player-end-390x844.png' });
  await player.getByRole('button', { name: 'まえへ' }).click();
  await expect(player.locator('#player-caption')).toHaveText('みずが ここまで くる かも');
  await noOverflow(page);
  // おとなに きりかえると、ひらいて いた さいせいは おとなで ひらきなおす
  await page.getByRole('button', { name: 'おとな', exact: true }).click();
  await expect(page.locator('#player .player-clock')).toHaveText('地震発生から 0分00秒');
  await expect(page.getByRole('button', { name: '▶ 地震から津波までを再生' })).toHaveAttribute('aria-expanded', 'true');
});

test('かぞくの きまり（こども）: カードと「まだ きまって いないよ」。おとなに きりかえて かける', async ({ page }) => {
  await toKids(page);
  await page.goto('/#family');
  const fam = page.locator('#kid-family');
  await expect(fam.getByRole('heading', { name: /じしんの ときの きまり/ })).toBeVisible();
  await expect(fam.locator('#kid-fam-tsunami')).toContainText('つなみの ときに にげる ところ');
  await expect(fam.locator('#kid-fam-tsunami .kid-fam-empty')).toHaveText('まだ きまって いないよ。おうちの ひとと きめよう');
  await expect(fam.locator('#kid-fam-meet')).toContainText('まず ここ');
  await expect(fam.locator('#kid-fam-meet')).toContainText('だめなら ここ');
  await expect(fam.locator('#kid-fam-171')).toContainText('でんわで 171に かけて、きくときは「2」。いえの でんわばんごうを いれるよ。');
  await expect(fam.locator('#kid-fam-171')).toContainText('まいつき 1にち・15にちに れんしゅう できるよ。');
  await expect(fam.locator('#kid-fam-rows')).toContainText('だれが どこに いる？');
  await expect(fam.locator('input, textarea')).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: 'reports/kids-family-empty-390x844.png', fullPage: true });
  // おうちの ひとが かく
  await page.getByRole('button', { name: 'おうちの ひとが かく（おとなの がめん）' }).click();
  await expect(page.getByRole('button', { name: 'おとな', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#family-tsunami').fill('なかむらやま こうえん');
  await page.locator('#family-meet1').fill('こうえんの すべりだいの まえ');
  await page.locator('#family-add-row').click();
  await page.locator('.family-who').first().fill('わたし');
  await page.locator('.family-memo').first().fill('へいじつの ひるは がっこう');
  await page.locator('#family-today').click();
  await expect(page.locator('#family-status')).toHaveText('保存しました');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(fam.locator('#kid-fam-tsunami .kid-fam-value')).toHaveText('なかむらやま こうえん');
  await expect(fam.locator('#kid-fam-meet')).toContainText('こうえんの すべりだいの まえ');
  await expect(fam.locator('#kid-fam-meet .kid-fam-empty')).toHaveCount(1); // だめなら ここ は まだ
  await expect(fam.locator('.kid-fam-who')).toHaveText('わたし');
  await expect(fam.locator('#kid-fam-reviewed')).toHaveText(/^\d{4}ねん \d{1,2}がつ\d{1,2}にち に みなおしたよ$/);
  await noOverflow(page);
  await page.screenshot({ path: 'reports/kids-family-390x844.png', fullPage: true });
});

test('こどもの けっか: はんいの そと → つなみと けっかを かくし、やることは あかく しない', async ({ page }) => {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit('宮城県仙台市青葉区国分町', 38.2647, 140.8697)] }));
  await toKids(page);
  await page.getByLabel('住所').fill('仙台市青葉区国分町1');
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#kid-outside')).toHaveText('ここは この アプリの はんいの そとだよ。おうちの ひとと『おとな』で みてね', { timeout: 30_000 });
  await expect(page.locator('#kid-shake, #kid-house, #kid-tsunami')).toHaveCount(0);
  await expect(page.locator('#kid-action-escape .kid-big')).toHaveText('たかい ところへ');
  await expect(page.locator('#kid-action-escape')).not.toHaveClass(/kid-tone-red/);
  await expect(page.getByRole('button', { name: 'うごきで みて みよう' })).toHaveCount(0);
  await noOverflow(page);
});

test('こどもの けっか: よみこめない タブは「もう いちど」で よみなおせる（えらんで いる タブの まま）', async ({ page }) => {
  await toKids(page);
  await search(page);
  await expect(page.locator('#kid-shake .kid-shindo')).toBeVisible({ timeout: 30_000 });
  await page.route('**/data/hazard/HALF_E/**', (r) => r.fulfill({ status: 500, body: 'boom' }));
  await page.getByRole('tab', { name: 'ひがしがわ だけ' }).click();
  await expect(page.locator('#kid-error')).toContainText('よみこめなかったよ。もう いちど ためしてね', { timeout: 30_000 });
  await expect(page.locator('#kid-tsunami')).toBeVisible();
  await page.unroute('**/data/hazard/HALF_E/**');
  await page.getByRole('button', { name: 'もう いちど よみこむ' }).click();
  await expect(page.getByRole('tab', { name: 'ひがしがわ だけ' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#kid-error')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#kid-shake .kid-shindo, #kid-shake .kid-nodata')).toBeVisible();
});
