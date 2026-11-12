import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subsidySearchUrl, subsidySearchLabel } from '../../src/app/ui/actions.ts';

for (const name of ['静岡市', '名古屋市', '岐阜市', '飛島村']) {
  test(`耐震補助の検索リンクに市町村名が入る（${name}）`, () => {
    const u = subsidySearchUrl(name);
    assert.ok(u.startsWith('https://www.google.com/search?q='));
    assert.ok(decodeURIComponent(u).includes(name));
    assert.ok(subsidySearchLabel(name).includes(name));
  });
}

test('市町村名が不明なときは一般的な検索語（住所・座標なし）', () => {
  const u = decodeURIComponent(subsidySearchUrl(null));
  assert.ok(u.includes('耐震診断'));
  assert.ok(!/\d{2}\.\d/.test(u));
  assert.equal(subsidySearchLabel(null), 'お住まいの市町村の耐震補助制度を検索する');
});
