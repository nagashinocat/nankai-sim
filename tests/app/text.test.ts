import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShareText } from '../../src/app/text.ts';

const r = { min: '1.0%', max: '9.0%', central: '3.0%' };

test('buildShareText: 最大クラスは従来の文面', () => {
  const t = buildShareText('菰野町', r, r);
  assert.ok(t.startsWith('南海トラフ地震（最大クラス（国の想定））の想定で、菰野町の自宅'));
  assert.ok(!t.includes('後発まで含めた合計'));
});

test('buildShareText: タブ名は入れ子の括弧にしない。時間差は「後発まで含めた合計」を数値の横に', () => {
  const half = buildShareText('菰野町', r, r, { label: '東側の半割れ' });
  assert.ok(half.startsWith('南海トラフ地震・東側の半割れの想定で、菰野町の自宅'));
  const lag = buildShareText(null, r, r, { label: '時間差（東→西）', lagTotal: true });
  assert.ok(lag.startsWith('南海トラフ地震・時間差（東→西）の想定で、この地域の自宅'));
  assert.ok(lag.includes('後発まで含めた合計：全壊 代表値3.0%'));
  assert.ok(!lag.includes('（時間差（'));
  assert.ok(!/住所|付近/.test(lag));
});
